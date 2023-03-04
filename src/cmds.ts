import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as os from 'os';
import * as path from 'path';

export type setConfig = (
  name: string,
  value: string,
  replace?: boolean,
) => Promise<void>;

export type rmConfig = (name: string) => Promise<void>;

export interface IGitCmd {
  setConfig: setConfig;
  rmConfig: rmConfig;
}

export async function createGitCmd(): Promise<GitCmd> {
  return await GitCmd.createGitCmd();
}

class GitCmd {
  private gitPath = '';

  // Private constructor; use createSshCmd()
  private constructor() {}

  static async createGitCmd(): Promise<GitCmd> {
    const ret = new GitCmd();
    ret.gitPath = await io.which('git', true);
    return ret;
  }

  async setConfig(
    name: string,
    value: string,
    replace?: boolean,
  ): Promise<void> {
    const args = ['config', '--global'];
    if (replace === true) {
      args.push('--replace-all');
    } else {
      args.push('--add');
    }
    args.push(name);
    args.push(value);
    await exec.exec(`"${this.gitPath}"`, args);
  }

  async rmConfig(name: string): Promise<void> {
    const args = ['config', '--global', '--unset-all', name];
    await exec.exec(`"${this.gitPath}"`, args);
  }
}

export type getDotSshPath = () => Promise<string>;
export type listKeys = () => Promise<string[]>;
export type loadPrivateKeys = (keys: string[]) => Promise<void>;
export type startAgent = () => Promise<void>;
export type killAgent = () => Promise<void>;

export interface ISshCmd {
  getDotSshPath: getDotSshPath;
  listKeys: listKeys;
  loadPrivateKeys: loadPrivateKeys;
  startAgent: startAgent;
  killAgent: killAgent;
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

  async listKeys(): Promise<string[]> {
    // list current public key identities
    core.info(`Running ${this.sshAddPath} -L`);
    const { exitCode, stdout } = await exec.getExecOutput(
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
    return stdout.trim().split(/\r?\n/);
  }

  async loadPrivateKeys(keys: string[]): Promise<void> {
    core.debug(`Running ssh-add for each key`);
    for (const key of keys) {
      await exec.exec(`"${this.sshAddPath}"`, ['-'], {
        input: Buffer.from(`${key}\n`),
        ignoreReturnCode: true,
      });
    }
  }

  async startAgent(): Promise<void> {
    // start up ssh-agent
    core.info(`Running ${this.sshAgentPath}`);
    const { stdout } = await exec.getExecOutput(`"${this.sshAgentPath}"`, []);

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
    await exec.getExecOutput(`"${this.sshAgentPath}"`, ['-k']);
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
