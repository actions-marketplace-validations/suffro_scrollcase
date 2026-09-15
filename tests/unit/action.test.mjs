import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readActionOptions } from '../../action/src/options.mjs';
import { executeAction, resolveActionDirectory } from '../../action/src/run.mjs';
import { prepareActionToolchain } from '../../action/src/toolchain.mjs';

const created = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const inputs = (values) => (name) => values[name] ?? '';

describe('GitHub Action inputs', () => {
  it('applies the safe defaults', () => {
    expect(readActionOptions(inputs({ scroll: 'demo-box', target: 'linux-x86_64-cpu' }))).toMatchObject({
      scroll: 'demo-box',
      target: 'linux-x86_64-cpu',
      workingDirectory: '.',
      installToolchain: true,
      selfTest: true,
      channel: 'beta',
    });
  });

  it.each([
    [{ target: 'linux-x86_64-cpu' }, /scroll is required/],
    [{ scroll: 'demo-box' }, /target is required/],
    [{ scroll: 'demo-box/linux-x86_64-cpu', target: 'linux-x86_64-cpu' }, /lowercase box id/],
    [{ scroll: 'demo-box', target: 'linux-x86_64-cpu', 'self-test': 'yes' }, /true or false/],
    [{ scroll: 'demo-box', target: 'linux-x86_64-cpu', channel: 'production' }, /channel must be/],
    [{ scroll: 'demo-box', target: 'linux-x86_64-cpu', namespace: 'Acme.Box' }, /namespace/],
    [{ scroll: 'demo-box', target: 'linux-x86_64-cpu', 'publish-base-url': 's3://bucket' }, /http or https/],
    [{ scroll: 'demo-box', target: 'linux-x86_64-cpu', 'signer-command': 'kms-sign' }, /requires public-key/],
    [{ scroll: 'demo-box', target: 'linux-x86_64-cpu', 'signer-command': 'kms-sign', 'public-key': 'key.json', 'private-key': 'key.pem' }, /mutually exclusive/],
  ])('rejects invalid input before work starts', (values, message) => {
    expect(() => readActionOptions(inputs(values))).toThrow(message);
  });
});

describe('GitHub Action path boundary', () => {
  it('accepts the checkout root and a nested project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scrollcase-action-path-'));
    created.push(root);
    await mkdir(join(root, 'packages', 'model'), { recursive: true });
    const canonicalRoot = await realpath(root);
    await expect(resolveActionDirectory(root, '.')).resolves.toBe(canonicalRoot);
    await expect(resolveActionDirectory(root, 'packages/model'))
      .resolves.toBe(join(canonicalRoot, 'packages', 'model'));
  });

  it('rejects lexical and symbolic-link escapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scrollcase-action-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'scrollcase-action-outside-'));
    created.push(root, outside);
    await symlink(outside, join(root, 'outside'));
    await expect(resolveActionDirectory(root, '..')).rejects.toThrow(/inside GITHUB_WORKSPACE/);
    await expect(resolveActionDirectory(root, 'outside')).rejects.toThrow(/symbolic links/);
  });
});

describe('GitHub Action toolchain', () => {
  it('refuses an unreviewed pixi download before fetching it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scrollcase-action-toolchain-'));
    created.push(root);
    const fetchImpl = vi.fn();
    await expect(prepareActionToolchain({
      workspace: { root, configPath: null, toolchainDir: join(root, '.scrollcase', 'toolchain') },
      pixiVersion: '0.73.0',
      install: true,
      host: { platform: 'darwin', arch: 'arm64' },
      fetchImpl,
      run: vi.fn(),
      runResult: () => ({ status: 127, error: new Error('ENOENT') }),
    })).rejects.toThrow(/reviewed pixi asset digest/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not install anything when installation is disabled', async () => {
    const run = vi.fn();
    const result = await prepareActionToolchain({
      workspace: { toolchainDir: '/unused' },
      pixiVersion: '0.73.0',
      install: false,
      run,
      runResult: () => ({ status: 127, error: new Error('ENOENT') }),
    });
    expect(result).toEqual({ pixiPath: null, condaPackPath: null });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('GitHub Action orchestration', () => {
  it.each(['python', 'node', 'native'])('builds and verifies the %s runtime through the shared implementation', async (runtime) => {
    const root = await mkdtemp(join(tmpdir(), 'scrollcase-action-run-'));
    created.push(root);
    const archivePath = join(root, 'box.zip');
    const releasePath = join(root, 'release.json');
    const channelPath = join(root, 'channel.json');
    await Promise.all([archivePath, releasePath, channelPath].map((path) => writeFile(path, 'fixture')));
    const calls = [];
    const options = readActionOptions(inputs({
      scroll: 'demo-box',
      target: 'linux-x86_64-cpu',
      'install-toolchain': 'false',
    }));
    const result = await executeAction(options, {
      githubWorkspace: root,
      configure: () => ({ root, keysDir: join(root, '.scrollcase', 'keys') }),
      reset: vi.fn(),
      read: async (name, selected) => {
        calls.push(['read', name, selected]);
        return {
          reference: 'demo-box/linux-x86_64-cpu',
          targetId: 'linux-x86_64-cpu',
          adapter: { id: 'linux-x86_64' },
          scroll: { boxId: 'demo-box', version: '1.0.0', pixiVersion: '0.73.0', runtime: { id: runtime } },
        };
      },
      assertHost: () => calls.push(['host']),
      ensureSigning: async () => calls.push(['signing']),
      prepareToolchain: async () => ({ pixiPath: '/pixi', condaPackPath: '/conda-pack' }),
      build: async (reference, buildOptions) => {
        calls.push(['build', reference, buildOptions]);
        return { archivePath, releasePath, channelPath, archiveSha256: 'a'.repeat(64) };
      },
      verify: async (path, verifyOptions) => calls.push(['verify', path, verifyOptions]),
      log: vi.fn(),
    });
    expect(calls.map((call) => call[0])).toEqual(['read', 'host', 'signing', 'build', 'verify']);
    expect(calls[3][1]).toBe('demo-box/linux-x86_64-cpu');
    expect(calls[3][2]).toMatchObject({ pixiPath: '/pixi', condaPackPath: '/conda-pack', channel: 'beta' });
    expect(calls[4][2]).toMatchObject({ selfTest: true });
    expect(result).toMatchObject({ runtime, archive: archivePath, release: releasePath });
  });
});
