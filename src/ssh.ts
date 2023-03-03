import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as core from '@actions/core';
import { exec, getExecOutput } from '@actions/exec';
import * as io from '@actions/io';
import SSHConfig from 'ssh-config';
import { IGitCmd } from './git';

interface MappedHostSaveState {
  mapped_host: string;
  mapped_uri: string;
}

export async function configDeployKeys(
  sshPath: string,
  pubKeys: PubKey[],
  gitCmd: IGitCmd,
): Promise<number> {
  const keys = getDeployKeys(pubKeys).map(computeKeyMapping);

  // handle GitHub deploy keys
  if (keys.length > 0) {
    core.info('Writing public SSH deploy keys');
    const keyFileMapping: Record<string, string> = {};
    for (const key of keys) {
      const keyFilePath = await writeDeployKey(sshPath, key);
      keyFileMapping[origRepoUri(key)] = keyFilePath;
    }

    core.info('Wrote keys. Now the SSH config');

    const sshConfigPath = await writeSshConfig(sshPath, keys);
    core.info(`Wrote SSH config with deploy key mappings to ${sshConfigPath}`);
    const sshHostMapping: Record<string, string[]> = Object.assign(
      {},
      ...keys.map((key: DeployKey) => {
        return {
          [mappedRepoUri(key)]: [
            `https://${key.host}/${key.repo_path}`,
            origRepoUri(key),
          ],
        };
      }),
    );

    for (const mappedHost in sshHostMapping) {
      let replace = true;
      for (const target of sshHostMapping[mappedHost]) {
        gitCmd.setConfig(`url."${mappedHost}".insteadOf`, target, replace);
        replace = false;
      }
    }
    const mappedHosts: MappedHostSaveState[] = keys.map((key: DeployKey) => {
      return { mapped_host: key.mapped_host, mapped_uri: mappedRepoUri(key) };
    });
    core.saveState('SSH_MAPPED_HOSTS', mappedHosts);
    core.saveState('SSH_KEY_FILES', Object.values(keyFileMapping));
    core.saveState('SSH_CONFIG_PATH', sshConfigPath);
  }
  return keys.length;
}

export async function cleanupDeployKeys(gitCmd: IGitCmd): Promise<void> {
  // attempt to parse the data from the saved state
  // default to an empty array
  let sshMappedHosts: MappedHostSaveState[] = [];
  try {
    sshMappedHosts = JSON.parse(
      core.getState('SSH_MAPPED_HOSTS'),
    ) as MappedHostSaveState[];
  } catch (e) {
    // nothing to clean up
  }
  // $HOME/.ssh/config by default
  const sshConfigPath: string = core.getState('SSH_CONFIG_PATH');
  // list of keyfiles we need to clean up, empty by default
  let keyFiles: string[] = [];
  try {
    keyFiles = JSON.parse(core.getState('SSH_KEY_FILES')) as string[];
  } catch (e) {
    // nothing to clean up
  }
  for (const file of keyFiles) {
    core.info(`Removing ${file}`);
    await io.rmRF(file);
  }

  if (sshConfigPath) {
    core.info(`Cleaning up SSH config at ${sshConfigPath}`);
    const sshConfigStr = (await fs.promises.readFile(sshConfigPath)).toString();
    const sshConfig = SSHConfig.parse(sshConfigStr);
    for (const host of sshMappedHosts) {
      core.info(`Removing ${host.mapped_host} from SSH config`);
      sshConfig.remove({ Host: host.mapped_host });
    }
    await fs.promises.writeFile(sshConfigPath, sshConfig);
  }

  for (const mappedHost of sshMappedHosts) {
    gitCmd.rmConfig(`url."${mappedHost.mapped_uri}".insteadOf`);
  }
}

export interface ISshCmd {
  getDotSshPath(): Promise<string>;
  listKeys(): Promise<PubKey[]>;
  loadPrivateKeys(keys: string[]): Promise<void>;
  startAgent(): Promise<void>;
  killAgent(): Promise<void>;
}

export async function createSshCmd(): Promise<ISshCmd> {
  return await SshCmd.createSshCmd();
}

class SshCmd {
  private sshAddPath = '';
  private sshAgentPath = '';
  private dotSshPath = '';

  // Private constructor; use createSshCmd()
  private constructor() {}

  static async createSshCmd(): Promise<SshCmd> {
    const ret = new SshCmd();
    ret.sshAddPath = await io.which('ssh-add', true);
    ret.sshAgentPath = await io.which('ssh-agent', true);
    return ret;
  }

  async listKeys(): Promise<PubKey[]> {
    // list current public key identities
    core.info(`Running ${this.sshAddPath} -L`);
    const { exitCode, stdout } = await getExecOutput(
      `"${this.sshAddPath}"`,
      ['-L'],
      {
        ignoreReturnCode: true,
        silent: true,
      },
    );

    if (exitCode > 1 || exitCode < 0) {
      throw new Error(`Failed to run ${this.sshAddPath} -L`);
    }

    // take the output and split it on each new line
    const lines = stdout.trim().split(/\r?\n/);
    // we'll build up a list of key data to return
    const ret: PubKey[] = [];
    for (const identity of lines) {
      // the parts of the identity are split by a space
      const parts = identity.trim().split(' ');
      const pubKey = { algo: parts[0], key: parts[1], comment: parts[2] };
      ret.push(pubKey);
    }

    return ret;
  }

  async loadPrivateKeys(keys: string[]): Promise<void> {
    core.debug(`Running ssh-add for each key`);
    for (const key of keys) {
      await exec(`"${this.sshAddPath}"`, ['-'], {
        input: Buffer.from(`${key}\n`),
        ignoreReturnCode: true,
      });
    }
  }

  async startAgent(): Promise<void> {
    // start up ssh-agent
    core.info(`Running ${this.sshAgentPath}`);
    const { stdout } = await getExecOutput(`"${this.sshAgentPath}"`, []);

    // grab up the output as lines
    const lines = stdout.trim().split(/\r?\n/);
    for (const line of lines) {
      const parts = line.match(
        /^(SSH_AUTH_SOCK|SSH_AGENT_PID)=(.*); export \1/,
      );

      if (!parts) {
        continue;
      }

      // export this data for future steps
      core.exportVariable(parts[1], parts[2]);
    }
  }

  async killAgent(): Promise<void> {
    await getExecOutput(`"${this.sshAgentPath}"`, ['-k']);
  }

  async getDotSshPath(): Promise<string> {
    // realistically we want this to be a temporary file
    // that we don't tinker with the system setup
    // it will also allow this to be exposed into a Docker
    // build context to function correctly
    if (this.dotSshPath === '') {
      const dotSshPath = path.join(os.homedir(), '.ssh');
      await io.mkdirP(dotSshPath);
      this.dotSshPath = dotSshPath;
      return dotSshPath;
    } else {
      return this.dotSshPath;
    }
  }
}

interface PubKey {
  algo: string;
  key: string;
  comment: string;
}

interface DeployKeyMatch extends PubKey {
  host: string;
  repo_path: string;
  org: boolean;
}

interface DeployKey extends DeployKeyMatch {
  filename: string;
  mapped_host: string;
}

function origRepoUri(key: DeployKey): string {
  return `git@${key.host}:${key.repo_path}`;
}

function mappedRepoUri(key: DeployKey): string {
  return `git@${key.mapped_host}:${key.repo_path}`;
}

const OWNER_REPO_MATCH = /\b([\w.]+)[:/]([_.a-z0-9-]+\/[_.a-z0-9-]+)?$/i;
const OWNER_MATCH = /\b([\w.]+)[:/]([_.a-z0-9-]+)$/i;

export function parseDeployKey(key: PubKey): DeployKeyMatch | null {
  {
    const data = key.comment.match(OWNER_REPO_MATCH);
    if (data) {
      core.info(
        `key comment '${key.comment}' matched GitHub deploy key repo pattern`,
      );
      // trim off the .git
      const repo = data[2].replace(/.git$/, '');
      return { ...key, host: data[1], repo_path: repo, org: false };
    }
  }
  {
    const repo = key.comment.match(OWNER_MATCH);
    if (repo) {
      core.info(
        `key comment '${key.comment}' matched GitHub deploy key org pattern`,
      );
      return { ...key, host: repo[1], repo_path: repo[2], org: true };
    }
  }

  core.info(
    `key comment '${key.comment}' did not match GitHub deploy key pattern`,
  );
  return null;
}

export function getDeployKeys(keys: PubKey[]): DeployKeyMatch[] {
  return keys
    .map(parseDeployKey)
    .filter(key => key != null) as DeployKeyMatch[];
}

export function computeKeyMapping(key: DeployKeyMatch): DeployKey {
  // generates a mapping for the deploy key using a hash of the
  // repo/org info
  const hash = crypto.createHash('sha256').update(key.comment).digest('hex');
  const type = key.org ? 'org' : 'repo';
  return {
    ...key,
    filename: `${type}-${hash}.pub`,
    mapped_host: `${type}-${hash}.${key.host}`,
  };
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function genSshConfig(basePath: string, keys: DeployKey[]) {
  const config = new SSHConfig();
  for (const key of keys) {
    config.append({
      Host: key.mapped_host,
      HostName: key.host,
      IdentityFile: `${basePath}/${key.filename}`,
      IdentitiesOnly: 'yes',
    });
  }
  return config;
}

async function writeDeployKey(
  basePath: string,
  key: DeployKey,
): Promise<string> {
  const keypath = path.join(basePath, key.filename);
  await fs.promises.writeFile(keypath, `${key.algo} ${key.key} ${key.comment}`);
  return keypath;
}

async function existing(filePath: string): Promise<fs.Stats | undefined> {
  try {
    return await fs.promises.stat(filePath);
  } catch (_) {
    return undefined;
  }
}

async function writeSshConfig(
  basePath: string,
  keys: DeployKey[],
): Promise<string> {
  const localSshConfig = genSshConfig(basePath, keys);
  const sshConfigPath = `${basePath}/config`;
  const existingConfig = await existing(sshConfigPath);
  if (existingConfig !== undefined) {
    core.info(`Found existing SSH config at ${sshConfigPath}`);
    const userSshConfigStr = (
      await fs.promises.readFile(sshConfigPath)
    ).toString();
    const userSshConfig = SSHConfig.parse(userSshConfigStr);
    localSshConfig.push(...userSshConfig);
  }

  await fs.promises.writeFile(
    sshConfigPath,
    SSHConfig.stringify(localSshConfig),
    {
      mode: existingConfig !== undefined ? existingConfig.mode : 0o600,
    },
  );
  return sshConfigPath;
}

const KEY_MATCH =
  /-----BEGIN OPENSSH PRIVATE KEY-----[\r\nA-Za-z0-9+=/]+-----END OPENSSH PRIVATE KEY-----\r?\n?/g;

export function parsePrivateKeys(data: string): string[] {
  return Array.from(data.matchAll(KEY_MATCH), m => m[0].replace(/\r\n/g, '\n'));
}
