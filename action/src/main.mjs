import * as core from '@actions/core';
import { readActionOptions } from './options.mjs';
import { actionSummary, executeAction } from './run.mjs';

async function main() {
  try {
    const options = readActionOptions(core.getInput);
    // Written before any filesystem or toolchain work so CI can distinguish a loaded bundle from
    // an action.yml parse failure while still testing the ordinary failure path.
    core.setOutput('target', options.target);
    const result = await executeAction(options, { log: core.info });
    for (const [name, value] of Object.entries({
      archive: result.archive,
      release: result.release,
      'channel-document': result.channelDocument,
      'archive-sha256': result.archiveSha256,
      'box-id': result.boxId,
      'box-version': result.boxVersion,
      runtime: result.runtime,
      target: result.target,
    })) {
      core.setOutput(name, value);
    }
    await core.summary.addRaw(actionSummary(result)).write();
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

void main();
