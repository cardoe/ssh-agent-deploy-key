import {
  computeKeyMapping,
  genSshConfig,
  getDeployKeys,
  parseDeployKey,
} from '../src/ssh';
import { describe, expect, it } from '@jest/globals';

describe('GitHub deploy key parsing', () => {
  it.each`
    keyComment                            | host            | repo_path          | org
    ${'git@github.com:username/repo.git'} | ${'github.com'} | ${'username/repo'} | ${false}
    ${'git@github.com:username/repo'}     | ${'github.com'} | ${'username/repo'} | ${false}
    ${'github.com:username/repo.git'}     | ${'github.com'} | ${'username/repo'} | ${false}
    ${'github.com:username/repo'}         | ${'github.com'} | ${'username/repo'} | ${false}
    ${'git@github.com/username/repo.git'} | ${'github.com'} | ${'username/repo'} | ${false}
    ${'git@github.com/username/repo'}     | ${'github.com'} | ${'username/repo'} | ${false}
    ${'github.com/username/repo.git'}     | ${'github.com'} | ${'username/repo'} | ${false}
    ${'github.com/username/repo'}         | ${'github.com'} | ${'username/repo'} | ${false}
    ${'git@gh.private:username/repo.git'} | ${'gh.private'} | ${'username/repo'} | ${false}
    ${'git@gh.private:username/repo'}     | ${'gh.private'} | ${'username/repo'} | ${false}
    ${'gh.private:username/repo.git'}     | ${'gh.private'} | ${'username/repo'} | ${false}
    ${'gh.private:username/repo'}         | ${'gh.private'} | ${'username/repo'} | ${false}
    ${'git@gh.private/username/repo.git'} | ${'gh.private'} | ${'username/repo'} | ${false}
    ${'git@gh.private/username/repo'}     | ${'gh.private'} | ${'username/repo'} | ${false}
    ${'gh.private/username/repo.git'}     | ${'gh.private'} | ${'username/repo'} | ${false}
    ${'gh.private/username/repo'}         | ${'gh.private'} | ${'username/repo'} | ${false}
    ${'git@github.com:username'}          | ${'github.com'} | ${'username'}      | ${true}
    ${'github.com:username'}              | ${'github.com'} | ${'username'}      | ${true}
    ${'git@github.com/username'}          | ${'github.com'} | ${'username'}      | ${true}
    ${'github.com/username'}              | ${'github.com'} | ${'username'}      | ${true}
    ${'git@gh.private:username'}          | ${'gh.private'} | ${'username'}      | ${true}
    ${'gh.private:username'}              | ${'gh.private'} | ${'username'}      | ${true}
    ${'git@gh.private/username'}          | ${'gh.private'} | ${'username'}      | ${true}
    ${'gh.private/username'}              | ${'gh.private'} | ${'username'}      | ${true}
  `(
    "should '$keyComment' parse as '$host:$repo_path', org: $org",
    async ({ keyComment, host, repo_path, org }) => {
      const key = { algo: '', key: '', comment: keyComment };
      expect(parseDeployKey(key)).toEqual({ ...key, host, repo_path, org });
    },
  );

  it('a non GitHub deploy key pattern should not match', async () => {
    const key = { algo: '', key: '', comment: 'not@deploy' };
    expect(parseDeployKey(key)).toBeNull();
  });

  it('filters deploy keys from a mix', async () => {
    const keys = [
      { algo: '', key: '', comment: 'not@deploy' },
      { algo: '', key: '', comment: 'git@github.com:org/repo' },
      { algo: '', key: '', comment: 'git@gh.private:org' },
      { algo: '', key: '', comment: 'blah' },
    ];

    const deployKeys = getDeployKeys(keys);
    expect(deployKeys.length).toEqual(2);
  });

  it.each`
    keyComment                            | host            | repo_path          | prefix
    ${'git@github.com:username/repo.git'} | ${'github.com'} | ${'username/repo'} | ${'repo-'}
    ${'git@github.com:username/repo'}     | ${'github.com'} | ${'username/repo'} | ${'repo-'}
    ${'github.com:username/repo.git'}     | ${'github.com'} | ${'username/repo'} | ${'repo-'}
    ${'github.com:username/repo'}         | ${'github.com'} | ${'username/repo'} | ${'repo-'}
    ${'git@github.com/username/repo.git'} | ${'github.com'} | ${'username/repo'} | ${'repo-'}
    ${'git@github.com/username/repo'}     | ${'github.com'} | ${'username/repo'} | ${'repo-'}
    ${'github.com/username/repo.git'}     | ${'github.com'} | ${'username/repo'} | ${'repo-'}
    ${'github.com/username/repo'}         | ${'github.com'} | ${'username/repo'} | ${'repo-'}
    ${'git@gh.private:username/repo.git'} | ${'gh.private'} | ${'username/repo'} | ${'repo-'}
    ${'git@gh.private:username/repo'}     | ${'gh.private'} | ${'username/repo'} | ${'repo-'}
    ${'gh.private:username/repo.git'}     | ${'gh.private'} | ${'username/repo'} | ${'repo-'}
    ${'gh.private:username/repo'}         | ${'gh.private'} | ${'username/repo'} | ${'repo-'}
    ${'git@gh.private/username/repo.git'} | ${'gh.private'} | ${'username/repo'} | ${'repo-'}
    ${'git@gh.private/username/repo'}     | ${'gh.private'} | ${'username/repo'} | ${'repo-'}
    ${'gh.private/username/repo.git'}     | ${'gh.private'} | ${'username/repo'} | ${'repo-'}
    ${'gh.private/username/repo'}         | ${'gh.private'} | ${'username/repo'} | ${'repo-'}
    ${'git@github.com:username'}          | ${'github.com'} | ${'username'}      | ${'org-'}
    ${'github.com:username'}              | ${'github.com'} | ${'username'}      | ${'org-'}
    ${'git@github.com/username'}          | ${'github.com'} | ${'username'}      | ${'org-'}
    ${'github.com/username'}              | ${'github.com'} | ${'username'}      | ${'org-'}
    ${'git@gh.private:username'}          | ${'gh.private'} | ${'username'}      | ${'org-'}
    ${'gh.private:username'}              | ${'gh.private'} | ${'username'}      | ${'org-'}
    ${'git@gh.private/username'}          | ${'gh.private'} | ${'username'}      | ${'org-'}
    ${'gh.private/username'}              | ${'gh.private'} | ${'username'}      | ${'org-'}
  `(
    "check '$keyComment' for key mapping generation",
    async ({ keyComment, host, repo_path, prefix }) => {
      const key = { algo: '', key: '', comment: keyComment };
      const deployKey = parseDeployKey(key);
      const mapping =
        deployKey !== null
          ? computeKeyMapping(deployKey)
          : { filename: '', mapped_host: '' };
      expect(mapping.mapped_host).toMatch(
        new RegExp(`${prefix}[a-z0-9]+.${host}`),
      );
      expect(mapping.filename.startsWith(prefix)).toBe(true);
    },
  );

  it('check ssh_config generation', () => {
    const key = { algo: '', key: '', comment: 'github.com:username/repo' };
    const deployKeyData = parseDeployKey(key);
    expect(deployKeyData).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const deployKey = computeKeyMapping(deployKeyData!);
    const ssh_config = genSshConfig('', [deployKey]);
    expect(ssh_config.find({ Host: deployKey.mapped_host })).toBeTruthy();
  });
});
