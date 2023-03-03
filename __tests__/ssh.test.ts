import * as git from '../src/git';
import {
  cleanupDeployKeys,
  computeKeyMapping,
  configDeployKeys,
  genSshConfig,
  getDeployKeys,
  parseDeployKey,
  parsePrivateKeys,
} from '../src/ssh';
import * as fs from 'fs';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import forge from 'node-forge';

const mockGitCmd: git.IGitCmd = {
  setConfig: jest.fn<git.setConfig>(),
  rmConfig: jest.fn<git.rmConfig>(),
};

function generateRsaKeyPair(comment: string): {
  public: string;
  private: string;
} {
  const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });

  return {
    public: forge.ssh.publicKeyToOpenSSH(keypair.publicKey, comment),
    private: forge.ssh
      .privateKeyToOpenSSH(keypair.privateKey, '')
      .replace(/RSA PRIVATE/g, 'OPENSSH PRIVATE'),
  };
}

describe('Private key parsing', () => {
  it('parse 1 private key', () => {
    const keypair = generateRsaKeyPair('fake@user');
    const parsed = parsePrivateKeys(keypair.private);
    expect(parsed.length).toEqual(1);
  });

  it('parse 3 private keys', () => {
    // generate 3 keys and store only the private part
    const privateKeys = [
      generateRsaKeyPair('fake@user'),
      generateRsaKeyPair('something'),
      generateRsaKeyPair('another'),
    ].map(item => {
      return item.private;
    });
    // we get our input as one giant string so do that and test the parse
    const keyData = privateKeys.join('\n');
    const parsed = parsePrivateKeys(keyData);
    expect(parsed.length).toEqual(privateKeys.length);
  });
});

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
      const key = { algo: '', key: '', comment: keyComment as string };
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
      expect(mapping.filename.endsWith('.pub')).toBe(true);
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

describe('end-to-end GitHub deploy keys handling', () => {
  beforeAll(() => {
    fs.mkdirSync('./ssh-test-dir/');
  });
  afterAll(() =>
    fs.rmSync('./ssh-test-dir/', { recursive: true, force: true }),
  );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('configure with no keys', async () => {
    const ret = await configDeployKeys('./ssh-test-dir/', [], mockGitCmd);
    expect(ret).toBe(0);
    expect(mockGitCmd.setConfig).not.toBeCalled();
    await cleanupDeployKeys(mockGitCmd);
    expect(mockGitCmd.rmConfig).not.toBeCalled();
  });

  it('configure non-matching key', async () => {
    const keypair = generateRsaKeyPair('fake@user');
    const parts = keypair.public.trim().split(' ');
    const key = { algo: parts[0], key: parts[1], comment: parts[2] };
    const ret = await configDeployKeys('./ssh-test-dir/', [key], mockGitCmd);
    expect(ret).toBe(0);
    expect(mockGitCmd.setConfig).not.toBeCalled();
  });

  it('configure 1 matching key', async () => {
    const keypair = generateRsaKeyPair('github.com/org/repo');
    const parts = keypair.public.trim().split(' ');
    const key = { algo: parts[0], key: parts[1], comment: parts[2] };
    const ret = await configDeployKeys('./ssh-test-dir/', [key], mockGitCmd);
    expect(ret).toBe(1);
    expect(mockGitCmd.setConfig).toBeCalled();
  });
});
