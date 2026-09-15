/**
 * Non-interactive toolchain preparation for the Action.
 *
 * A CI install cannot ask a person whether to trust today's download. It therefore installs pixi
 * only from the host-specific digest already committed in scrollcase.config.json. This is the same
 * reviewed pin the ordinary project-local installer records, but without rewriting the config and
 * making provenance dirty immediately before a build.
 */

import { readFile } from 'node:fs/promises';
import {
  CONDA_PACK_VERSION,
  installCondaPack,
  installPixi,
  pixiReleaseAsset,
} from '../../src/build/toolchain.mjs';
import { probeCondaPack, probePixi } from '../../src/build/pixi.mjs';

const SHA256 = /^[a-f0-9]{64}$/;

async function reviewedPixiDigest(workspace, version, asset) {
  if (!workspace.configPath) {
    throw new Error(
      'install-toolchain requires a committed scrollcase.config.json with a reviewed pixi asset digest; '
      + `run scrollcase init --install-toolchain --pixi-version ${version} locally first.`,
    );
  }
  const config = JSON.parse(await readFile(workspace.configPath, 'utf8'));
  const pin = config.toolchain?.pixi;
  const digest = pin?.version === version ? pin.assets?.[asset] : null;
  if (typeof digest !== 'string' || !SHA256.test(digest)) {
    throw new Error(
      `No reviewed pixi ${version} digest for ${asset} is committed in ${workspace.configPath}; `
      + `run scrollcase init --install-toolchain --pixi-version ${version} locally, review and commit the change.`,
    );
  }
  return digest;
}

/** Returns explicit tool paths, installing missing tools only when the Action input allowed it. */
export async function prepareActionToolchain({
  workspace,
  pixiVersion,
  install,
  host = process,
  fetchImpl = fetch,
  run,
  runResult,
  log = console.log,
}) {
  let pixi = probePixi({ runResult });
  let condaPack = probeCondaPack({ runResult });
  if (!install) {
    return {
      pixiPath: pixi?.version === pixiVersion ? pixi.path : null,
      condaPackPath: condaPack?.path ?? null,
    };
  }

  if (pixi?.version !== pixiVersion) {
    const release = pixiReleaseAsset(host);
    if (!release) {
      throw new Error(`pixi publishes no build for ${host.platform}/${host.arch}; install it before running the Action.`);
    }
    const expectedSha256 = await reviewedPixiDigest(workspace, pixiVersion, release.asset);
    pixi = await installPixi({
      version: pixiVersion,
      toolchainDir: workspace.toolchainDir,
      expectedSha256,
      host,
      fetchImpl,
      log,
    });
  }

  if (!condaPack) {
    condaPack = await installCondaPack({
      pixi: pixi.path,
      toolchainDir: workspace.toolchainDir,
      run,
      log,
    });
  }

  if (condaPack.version !== undefined && condaPack.version !== CONDA_PACK_VERSION) {
    throw new Error(`Expected conda-pack ${CONDA_PACK_VERSION}, received ${condaPack.version}.`);
  }
  return { pixiPath: pixi.path, condaPackPath: condaPack.path };
}
