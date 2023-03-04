import * as exec from '@actions/exec';
import * as io from '@actions/io';

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
