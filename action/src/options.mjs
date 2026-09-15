/**
 * The Action's public input contract.
 *
 * GitHub exposes every input as an untyped string. Parse the entire surface before resolving a
 * path, reading a scroll or installing a tool: a misspelled boolean or incompatible signing mode
 * must fail as usage, before an expensive build has had any chance to start.
 */

import { CHANNELS, documentKinds } from '../../src/contract/document-shape.mjs';

const BOX_ID = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

function usage(message) {
  throw new Error(`Invalid Action input: ${message}`);
}

function text(input, name, { fallback = '', required = false } = {}) {
  const value = String(input(name) ?? '').trim() || fallback;
  if (required && !value) usage(`${name} is required.`);
  if (value.includes('\0')) usage(`${name} contains a null byte.`);
  return value;
}

function boolean(input, name, fallback) {
  const value = text(input, name, { fallback: String(fallback) }).toLowerCase();
  if (value !== 'true' && value !== 'false') usage(`${name} must be true or false.`);
  return value === 'true';
}

/** Parses and cross-validates every public Action input. */
export function readActionOptions(input) {
  const scroll = text(input, 'scroll', { required: true });
  if (!BOX_ID.test(scroll)) {
    usage('scroll must be a lowercase box id; pass the target through the target input.');
  }

  const target = text(input, 'target', { required: true });
  const channel = text(input, 'channel', { fallback: 'beta' });
  if (!CHANNELS.includes(channel)) {
    usage(`channel must be ${CHANNELS.join(', ')}.`);
  }

  const namespace = text(input, 'namespace') || undefined;
  if (namespace !== undefined) {
    try {
      documentKinds(namespace);
    } catch {
      usage('namespace must be a lowercase dotted or hyphenated identifier.');
    }
  }

  const publishBaseUrl = text(input, 'publish-base-url') || undefined;
  if (publishBaseUrl !== undefined) {
    let url;
    try {
      url = new URL(publishBaseUrl);
    } catch {
      usage('publish-base-url must be an absolute http or https URL.');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      usage('publish-base-url must be an absolute http or https URL.');
    }
  }

  const privateKey = text(input, 'private-key') || undefined;
  const publicKey = text(input, 'public-key') || undefined;
  const signerCommand = text(input, 'signer-command') || undefined;
  if (signerCommand && privateKey) {
    usage('signer-command and private-key are mutually exclusive.');
  }
  if (signerCommand && !publicKey) {
    usage('signer-command requires public-key so its result can be verified locally.');
  }

  return Object.freeze({
    scroll,
    target,
    workingDirectory: text(input, 'working-directory', { fallback: '.' }),
    installToolchain: boolean(input, 'install-toolchain', true),
    selfTest: boolean(input, 'self-test', true),
    channel,
    namespace,
    publishBaseUrl,
    privateKey,
    publicKey,
    signerCommand,
  });
}
