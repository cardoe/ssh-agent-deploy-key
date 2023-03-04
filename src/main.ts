import * as core from '@actions/core';
import * as cmds from './cmds';
import * as ssh from './ssh';

async function main(): Promise<void> {
  try {
    const privateKeyData = core.getInput('ssh-private-key', {
      required: true,
      trimWhitespace: true,
    });
    const privateKeys = ssh.parsePrivateKeys(privateKeyData);

    const sshKnownHosts = core.getMultilineInput('ssh-known-hosts');

    core.startGroup('Gathering utilities');
    const sshCmd = await cmds.createSshCmd();
    const gitCmd = await cmds.createGitCmd();
    core.endGroup();

    core.startGroup('Starting ssh-agent');
    await sshCmd.startAgent();
    core.endGroup();

    core.startGroup(`Loading ${privateKeys.length} private key(s)`);
    await sshCmd.loadPrivateKeys(privateKeys);
    core.endGroup();

    core.startGroup('Configuring SSH known_hosts');
    await ssh.loadKnownHosts(sshCmd, sshKnownHosts);
    core.endGroup();

    core.startGroup('Configuring GitHub deploy keys');
    const pubKeys = await ssh.getPublicKeys(sshCmd);
    core.info(`Got ${pubKeys.length} key(s) to check`);
    const sshBasePath = await sshCmd.getDotSshPath();
    core.info(`Using ${sshBasePath} for SSH key storage and config`);
    const deployed = await ssh.configDeployKeys(sshBasePath, pubKeys, gitCmd);
    core.info(`Configured ${deployed} key(s) to use as GitHub deploy keys`);
    core.endGroup();
  } catch (error) {
    core.setFailed(`${(error as Error)?.message ?? error}`);
  }
}

async function cleanup(): Promise<void> {
  try {
    core.startGroup('Gathering utilities');
    const sshCmd = await cmds.createSshCmd();
    const gitCmd = await cmds.createGitCmd();
    core.endGroup();

    core.startGroup('Killing ssh-agent');
    await sshCmd.killAgent();
    core.endGroup();

    core.startGroup('Cleaning up SSH known_hosts');
    await ssh.cleanupKnownHosts(sshCmd);
    core.endGroup();

    core.startGroup('Cleaning up GitHub deploy keys');
    await ssh.cleanupDeployKeys(gitCmd);
    core.endGroup();
  } catch (error) {
    core.setFailed(`${(error as Error)?.message ?? error}`);
  }
}

async function run(): Promise<void> {
  if (core.getState('IS_POST')) {
    cleanup();
  } else {
    core.saveState('IS_POST', true);
    main();
  }
}

run();
