import * as core from '@actions/core';
import * as git from './git';
import * as ssh from './ssh';

async function main(): Promise<void> {
  try {
    const privateKeyData = core.getInput('ssh-private-key', {
      required: true,
      trimWhitespace: true,
    });
    const privateKeys = ssh.parsePrivateKeys(privateKeyData);

    core.startGroup('Gathering utilities');
    const sshCmd = await ssh.createSshCmd();
    const gitCmd = await git.createGitCmd();
    core.endGroup();

    core.startGroup('Starting ssh-agent');
    await sshCmd.startAgent();
    core.endGroup();

    core.startGroup(`Loading ${privateKeys.length} private key(s)`);
    await sshCmd.loadPrivateKeys(privateKeys);
    core.endGroup();

    core.startGroup('Configuring GitHub deploy keys');
    const pubKeys = await sshCmd.listKeys();
    core.info(`Got ${pubKeys.length} key(s) to check`);
    const sshBasePath = await sshCmd.getDotSshPath();
    core.info(`Using ${sshBasePath} for SSH key storage and config`);
    const deployed = await ssh.configDeployKeys(sshBasePath, pubKeys, gitCmd);
    core.info(`Configured ${deployed} key(s) to use as GitHub deploy keys`);
    core.endGroup();
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    core.setFailed(`${(error as any)?.message ?? error}`);
  }
}

async function cleanup(): Promise<void> {
  try {
    core.startGroup('Gathering utilities');
    const sshCmd = await ssh.createSshCmd();
    const gitCmd = await git.createGitCmd();
    core.endGroup();

    core.startGroup('Killing ssh-agent');
    await sshCmd.killAgent();
    core.endGroup();

    core.startGroup('Cleaning up GitHub deploy keys');
    await ssh.cleanupDeployKeys(gitCmd);
    core.endGroup();
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    core.setFailed(`${(error as any)?.message ?? error}`);
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
