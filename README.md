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
