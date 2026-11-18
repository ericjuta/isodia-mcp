import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { prepareWalkthrough, WALKTHROUGH_MAX_BYTES, walkthroughId } from '../src/core/walkthrough';

try {
  const [model, manifest, output, ...extra] = process.argv.slice(2);
  if (!model || !manifest || !output || extra.length) {
    throw new Error('Usage: bun scripts/prepare-walkthrough.ts <model.json> <manifest.json> <publication-id.json>');
  }
  if (!output.endsWith('.json') || !walkthroughId.safeParse(basename(output, '.json')).success) {
    throw new Error('The output filename must be a lowercase publication slug ending in .json.');
  }
  const artifact = prepareWalkthrough(await Bun.file(model).json(), await Bun.file(manifest).json());
  const json = JSON.stringify(artifact, null, 2) + '\n';
  if (Buffer.byteLength(json) > WALKTHROUGH_MAX_BYTES) throw new Error('The publication may not exceed 5 MiB.');
  await writeFile(output, json, { flag: 'wx' });
  console.log(`Wrote ${output}. Review the whole file before publishing; every included view and note will be public.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
