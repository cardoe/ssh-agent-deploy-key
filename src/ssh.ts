import * as crypto from 'crypto';
import * as core from '@actions/core';

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
