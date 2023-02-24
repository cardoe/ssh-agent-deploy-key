import * as crypto from 'crypto';
import * as core from '@actions/core';
import { exec, getExecOutput } from '@actions/exec';
import * as io from '@actions/io';
import SSHConfig from 'ssh-config';

export interface ISshCmd {
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
    const { stdout } = await getExecOutput(`"${this.sshAddPath}"`, ['-L'], {
      silent: true,
    });

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
    filename: `${type}-${hash}`,
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

const KEY_MATCH =
  /-----BEGIN OPENSSH PRIVATE KEY-----[\r\nA-Za-z0-9+=/]+-----END OPENSSH PRIVATE KEY-----\r?\n?/g;

export function parsePrivateKeys(data: string): string[] {
  return Array.from(data.matchAll(KEY_MATCH), m => m[0].replace(/\r\n/g, '\n'));
}
