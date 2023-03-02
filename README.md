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
```
<!-- end usage -->

# Contributing

> First, you'll need to have a reasonably modern version of `node` handy.

Install the dependencies
```bash
$ npm install
```

Build the typescript and package it for distribution
```bash
$ npm run build && npm run package
```

Run the tests :heavy_check_mark:
```bash
$ npm test
```

Now open a PR with your changes.
