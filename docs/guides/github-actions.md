# GitHub Actions

The official Action builds and verifies **one target on the current runner**. A workflow chooses the
runner; Scrollcase checks that it matches the target before installing a toolchain or building.
The scroll itself declares whether the box runtime is `python`, `node` or `native`.

```yaml
name: box

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Materialize the signing key
        shell: bash
        env:
          SCROLLCASE_SIGNING_KEY: ${{ secrets.SCROLLCASE_SIGNING_KEY }}
        run: |
          test -n "$SCROLLCASE_SIGNING_KEY"
          printf '%s' "$SCROLLCASE_SIGNING_KEY" > "$RUNNER_TEMP/signing-private.pem"
          chmod 600 "$RUNNER_TEMP/signing-private.pem"

      - uses: suffro/scrollcase@action-v1
        id: box
        with:
          scroll: my-box
          target: linux-x86_64-cpu
          private-key: ${{ runner.temp }}/signing-private.pem
          public-key: trust/signing-public.json

      - uses: actions/upload-artifact@v4
        with:
          name: my-box-linux-x86_64-cpu
          path: |
            ${{ steps.box.outputs.archive }}
            ${{ steps.box.outputs.release }}
```

The Action validates all inputs before build work. `scroll` is the box id and `target` is the exact
target id; they must name one existing, valid scroll. `working-directory` is optional and defaults
to `.`. Set it only when the Scrollcase project is below the checkout root, such as
`packages/model` in a monorepo.

| Input | Default | Meaning |
| --- | --- | --- |
| `scroll` | required | Lowercase box id |
| `target` | required | Exact target id, such as `linux-x86_64-cpu` |
| `working-directory` | `.` | Project directory inside the checkout |
| `install-toolchain` | `true` | Install missing pinned pixi and conda-pack |
| `self-test` | `true` | Extract the result and run its signed self-test |
| `channel` | `beta` | `nightly`, `beta` or `stable` |
| `namespace` | `scrollcase.box` | Publishing project's document namespace |
| `publish-base-url` | unset | HTTP(S) base written into signed documents |
| `private-key` | workspace default | Local key path; pass a file path, never key contents |
| `public-key` | workspace default | Trusted public-key path |
| `signer-command` | unset | External signer; excludes `private-key` and requires `public-key` |

Successful runs expose `archive`, `release`, `channel-document`, `archive-sha256`, `box-id`,
`box-version`, `runtime` and `target`. Upload and publication are intentionally separate: the
Action prepares local files and never becomes a distribution system.

## Toolchain trust

When the required pixi is absent, the Action installs it only if the host-specific SHA-256 is
already committed under `toolchain.pixi.assets` in `scrollcase.config.json`. Bootstrap that pin once
on a trusted machine:

```bash
scrollcase init --install-toolchain --no-example --no-templates --pixi-version 0.73.0
```

Review and commit the configuration change. CI then verifies the downloaded archive against that
reviewed digest without rewriting the configuration or dirtying build provenance. Set
`install-toolchain: false` when the workflow supplies pixi and conda-pack itself; normal Scrollcase
tool discovery still applies.

For multiple targets, put this Action inside a workflow matrix whose operating systems match the
targets. The Action deliberately does not infer or allocate runners.
