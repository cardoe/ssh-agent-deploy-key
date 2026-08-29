import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';
import * as io from '@actions/io';
import SSHConfig from 'ssh-config';
import { IGitCmd, ISshCmd } from './cmds';

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
            sshRepoUri(key),
          ],
        };
      }),
    );

    for (const mappedHost in sshHostMapping) {
      let replace = true;
      for (const target of sshHostMapping[mappedHost]) {
        await gitCmd.setConfig(`url.${mappedHost}.insteadOf`, target, replace);
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
  } catch (_e) {
    // nothing to clean up
  }
  // $HOME/.ssh/config by default
  const sshConfigPath: string = core.getState('SSH_CONFIG_PATH');
  // list of keyfiles we need to clean up, empty by default
  let keyFiles: string[] = [];
  try {
    keyFiles = JSON.parse(core.getState('SSH_KEY_FILES')) as string[];
  } catch (_e) {
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

  if (sshMappedHosts) {
    for (const mappedHost of sshMappedHosts) {
      core.info(`Removing ${mappedHost.mapped_uri} override in git config`);
      gitCmd.rmConfig(`url.${mappedHost.mapped_uri}.insteadOf`);
    }
  }
}

interface PubKey {
  algo: string;
  key: string;
  comment: string;
}

interface DeployKeyMatch extends PubKey {
  user: string;
  host: string;
  repo_path: string;
  org: boolean;
}

interface DeployKey extends DeployKeyMatch {
  filename: string;
  mapped_host: string;
}

function origRepoUri(key: DeployKey): string {
  return `${key.user}@${key.host}:${key.repo_path}`;
}

function sshRepoUri(key: DeployKey): string {
  return `ssh://${key.user}@${key.host}/${key.repo_path}`;
}

function mappedRepoUri(key: DeployKey): string {
  return `${key.user}@${key.mapped_host}:${key.repo_path}`;
}

export async function getPublicKeys(ssh: ISshCmd): Promise<PubKey[]> {
  const lines = await ssh.listKeys();
  return lines.map(line => {
    // the parts of the identity are split by a space
    const parts = line.trim().split(' ');
    return { algo: parts[0], key: parts[1], comment: parts[2] };
  });
}

const OWNER_REPO_MATCH = /\b([\w.-]+)[:/]([_.a-z0-9-]+\/[_.a-z0-9-]+)?$/i;
const OWNER_MATCH = /\b([\w.-]+)[:/]([_.a-z0-9-]+)$/i;
const USER_MATCH = /^(\w+)@/i;

export function parseDeployKey(key: PubKey): DeployKeyMatch | null {
  const match = key.comment.match(USER_MATCH);
  let user;
  if (match) {
    user = match[1];
  } else {
    user = 'git';
  }
  {
    const data = key.comment.match(OWNER_REPO_MATCH);
    if (data) {
      core.info(
        `key comment '${key.comment}' matched GitHub deploy key repo pattern`,
      );
      // trim off the .git
      const repo = data[2].replace(/.git$/, '');
      return { ...key, user, host: data[1], repo_path: repo, org: false };
    }
  }
  {
    const repo = key.comment.match(OWNER_MATCH);
    if (repo) {
      core.info(
        `key comment '${key.comment}' matched GitHub deploy key org pattern`,
      );
      return { ...key, user, host: repo[1], repo_path: repo[2], org: true };
    }
  }

  core.info(
    `key comment '${key.comment}' did not match GitHub deploy key pattern`,
  );
  return null;
}

export function getDeployKeys(keys: PubKey[]): DeployKeyMatch[] {
  return keys.map(parseDeployKey).filter(key => key != null);
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
      IdentityFile: path.join(basePath, key.filename),
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

async function writeSshConfig(
  basePath: string,
  keys: DeployKey[],
): Promise<string> {
  const localSshConfig = genSshConfig(basePath, keys);
  const sshConfigPath = path.join(basePath, 'config');
  let sshConfigFile = null;
  try {
    sshConfigFile = await fs.promises.open(sshConfigPath, 'a', 0o600);
    await sshConfigFile.appendFile('\n');
    await sshConfigFile.appendFile(SSHConfig.stringify(localSshConfig));
  } finally {
    await sshConfigFile?.close();
  }
  return sshConfigPath;
}

const KEY_MATCH =
  /-----BEGIN OPENSSH PRIVATE KEY-----[\r\nA-Za-z0-9+=/]+-----END OPENSSH PRIVATE KEY-----\r?\n?/g;

export function parsePrivateKeys(data: string): string[] {
  return Array.from(data.matchAll(KEY_MATCH), m => m[0].replace(/\r\n/g, '\n'));
}

export async function loadKnownHosts(
  sshCmd: ISshCmd,
  keys: string[],
): Promise<string[]> {
  const sshBasePath = await sshCmd.getDotSshPath();

  // get all unique host names
  const hostnames = new Set(
    keys
      .map(key => {
        // parse out the hostname from the known_host entry to see if we need to add it
        try {
          return key.split(' ')[0];
        } catch (_e) {
          return null;
        }
      })
      .filter(item => item !== null),
  );

  // check for hosts that already exist to skip them
  for (const hostname in hostnames) {
    if (await sshCmd.hasHostKey(hostname)) {
      hostnames.delete(hostname);
    }
  }

  for (const key of keys) {
    let hostname;
    try {
      hostname = key.split(' ')[0];
    } catch (_e) {
      hostname = null;
    }

    if (hostname === null || !hostnames.has(hostname)) {
      core.info(
        `Skipping known_host entry for ${hostname} as it already exists`,
      );
      continue;
    }
    core.info(`Writing known_host entry for ${hostname}`);
    await fs.promises.appendFile(`${sshBasePath}/known_hosts`, `${key}\n`, {
      mode: 0o600,
    });
  }
  core.saveState('SSH_KNOWN_HOSTS', [...hostnames]);
  return [...hostnames];
}

export async function cleanupKnownHosts(sshCmd: ISshCmd): Promise<void> {
  let sshKnownHosts: string[] = [];
  try {
    sshKnownHosts = JSON.parse(core.getState('SSH_KNOWN_HOSTS')) as string[];
  } catch (_e) {
    // nothing to clean up
  }

  for (const hostname of sshKnownHosts) {
    core.info(`Removing known_host entry for ${hostname}`);
    await sshCmd.rmHostKey(hostname);
  }
}
