<p align="center">
  <a href="https://github.com/cardoe/ssh-agent-deploy-key"><img alt="ssh-agent-deploy-key status" src="https://github.com/cardoe/ssh-agent-deploy-key/workflows/build-test/badge.svg"></a>
</p>

# ssh-agent with GitHub deploy key support

This action is inspired by the [webfactory/ssh-agent](https://github.com/webfactory/ssh-agent) action.
My needs required adding some additional support and I wanted to add tests. I also preferred to use TypeScript
for some stronger validation.

This action starts an `ssh-agent` and loads the private keys you supply into it. All keys *must* not contain
a passphrase.

# Usage

<!-- start usage -->
```yaml
- uses: cardoe/ssh-agent-deploy-key@v1
  with:
    # SSH private keys to load into the ssh-agent
    ssh-private-key: |
      ${{ secrets.YOUR_KEY }}
      ${{ secrets.ANOTHER_KEY }}

    # Known hosts in addition to the user and global host key database. The
    # public SSH keys for a host may be obtained using the utility
    # `ssh-keyscan`. For example, `ssh-keyscan github.com`.
    ssh-known-hosts: ''
```
<!-- end usage -->

# GitHub Deploy Keys

The way that SSH works the GitHub servers will accept the first key and then
match that key for authorization to the repos it can access. No other SSH
keys will be tried. Since GitHub deploy keys are scoped to a single repo you
need a way to distingish them from each other. That's what this action provides.

## Setup

Create your keys with a comment identifying the repo they are for. e.g.
`ssh-keygen ... -C 'git@github.com:org/repo.git' and save the private key into
a GitHub Actions secret. Then supply that secret to the `ssh-private-key`
variable provided by this action.

## How It Works

The action will run an `ssh-agent` and create an alias host with the hash of
your public key for your repo. e.g. git@key-somevalue.github.com in your Git
config. Then in the SSH config it will map that aliased name back to github.com
but instruct SSH to only use that specific key for your connection instead of
trying each one in order.
