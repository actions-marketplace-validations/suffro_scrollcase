/**
 * One Action run: validate one scroll/target, build it through Scrollcase's real library path, then
 * verify the exact archive and signed release that will be handed to a later workflow step.
 *
 * Runner selection, matrices, upload and publication deliberately stay outside. They belong to the
 * caller's CI and distribution system; this Action prepares one local box and reports its files.
 */

import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { buildBox } from '../../src/build/box.mjs';
import { run, runResult } from '../../src/build/process.mjs';
import { readScroll } from '../../src/build/scroll.mjs';
import { configureWorkspace, resetWorkspace } from '../../src/build/workspace.mjs';
import { ensureBuildSigningKeys } from '../../src/cli-signing.mjs';
import { assertNativeHost } from '../../src/contract/targets.mjs';
import { verifyBox } from '../../src/build/verify.mjs';
import { prepareActionToolchain } from './toolchain.mjs';

function inside(root, candidate) {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

/** Resolves an existing project directory without allowing a workflow input to escape its checkout. */
export async function resolveActionDirectory(githubWorkspace, workingDirectory) {
  if (!githubWorkspace) throw new Error('GITHUB_WORKSPACE is not set by the runner.');
  const root = await realpath(githubWorkspace);
  const requested = resolve(root, workingDirectory);
  let project;
  try {
    project = await realpath(requested);
  } catch {
    throw new Error(`working-directory does not exist: ${requested}`);
  }
  if (!inside(root, project)) {
    throw new Error('working-directory must stay inside GITHUB_WORKSPACE, including through symbolic links.');
  }
  if (!(await stat(project)).isDirectory()) {
    throw new Error(`working-directory is not a directory: ${project}`);
  }
  return project;
}

const absoluteFrom = (root, value, fallback) => resolve(root, value || fallback);

/**
 * Executes the build with injectable edges so unit tests exercise the orchestration without a real
 * solve, download or signing key.
 */
export async function executeAction(options, {
  githubWorkspace = process.env.GITHUB_WORKSPACE,
  resolveDirectory = resolveActionDirectory,
  configure = configureWorkspace,
  reset = resetWorkspace,
  read = readScroll,
  assertHost = assertNativeHost,
  ensureSigning = ensureBuildSigningKeys,
  prepareToolchain = prepareActionToolchain,
  build = buildBox,
  verify = verifyBox,
  subprocess = run,
  subprocessResult = runResult,
  log = console.log,
} = {}) {
  const project = await resolveDirectory(githubWorkspace, options.workingDirectory);
  const previousDirectory = process.cwd();
  process.chdir(project);
  reset();
  try {
    const workspace = configure({ cwd: project });
    const selected = await read(options.scroll, { targetId: options.target });
    assertHost(selected.adapter);

    const privatePath = absoluteFrom(project, options.privateKey, join(workspace.keysDir, 'signing-private.pem'));
    const publicPath = absoluteFrom(project, options.publicKey, join(workspace.keysDir, 'signing-public.json'));
    const signing = { privatePath, publicPath, signerCommand: options.signerCommand ?? null };
    await ensureSigning(signing);

    const tools = await prepareToolchain({
      workspace,
      pixiVersion: selected.scroll.pixiVersion,
      install: options.installToolchain,
      run: subprocess,
      runResult: subprocessResult,
      log,
    });
    const built = await build(selected.reference, {
      ...signing,
      channel: options.channel,
      namespace: options.namespace,
      publishBaseUrl: options.publishBaseUrl,
      pixiPath: tools.pixiPath,
      condaPackPath: tools.condaPackPath,
      log,
    });
    await verify(built.releasePath, {
      publicPath,
      selfTest: options.selfTest,
      log,
    });

    return Object.freeze({
      archive: built.archivePath,
      release: built.releasePath,
      channelDocument: built.channelPath,
      archiveSha256: built.archiveSha256,
      boxId: selected.scroll.boxId,
      boxVersion: selected.scroll.version,
      runtime: selected.scroll.runtime.id,
      target: selected.targetId,
      selfTest: options.selfTest,
    });
  } finally {
    reset();
    process.chdir(previousDirectory);
  }
}

export function actionSummary(result) {
  return [
    '## Scrollcase box',
    '',
    `- Box: \`${result.boxId}\` \`${result.boxVersion}\``,
    `- Target: \`${result.target}\``,
    `- Runtime: \`${result.runtime}\``,
    `- Archive SHA-256: \`${result.archiveSha256}\``,
    `- Self-test: ${result.selfTest ? 'passed' : 'not requested'}`,
    '',
    'Scrollcase prepared and verified the files locally. Upload and publication remain separate workflow steps.',
    '',
  ].join('\n');
}
