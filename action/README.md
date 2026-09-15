# Scrollcase GitHub Action

The Action builds and verifies one signed box on the runner that matches its target. It uses the
same `buildBox` and `verifyBox` implementations as the Scrollcase CLI; the runtime (`python`, `node`
or `native`) comes from the scroll rather than from an Action input.

```yaml
- uses: actions/checkout@v4

- uses: suffro/scrollcase@action-v1
  id: scrollcase
  with:
    scroll: my-box
    target: linux-x86_64-cpu
    private-key: ${{ runner.temp }}/signing-private.pem
    public-key: trust/signing-public.json

- uses: actions/upload-artifact@v4
  with:
    name: my-box-linux-x86_64-cpu
    path: |
      ${{ steps.scrollcase.outputs.archive }}
      ${{ steps.scrollcase.outputs.release }}
```

`working-directory` defaults to the checkout root and is needed only when the Scrollcase project is
nested in a monorepo. `install-toolchain` and `self-test` default to `true`; `channel` defaults to
`beta`. `namespace`, `publish-base-url`, `private-key`, `public-key` and `signer-command` map to the
same build decisions as the CLI.

The managed toolchain installer accepts only a pixi archive digest already recorded in the
project's committed `scrollcase.config.json`. Run `scrollcase init --install-toolchain` locally,
review that pin and commit it before relying on CI to install the toolchain.

The Action does not choose runners, create a matrix, upload files, publish releases or receive
private-key contents. Those remain explicit steps in the caller's workflow.
