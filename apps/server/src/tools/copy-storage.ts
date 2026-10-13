/**
 * Copies every blob from a local storage directory to the configured S3
 * bucket (moving an existing installation from STORAGE_DRIVER=local to s3).
 * Existing objects are overwritten; the source is left untouched.
 *
 *   node dist/copy-storage.js /data        (inside the app container)
 */
import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { config as loadEnv } from 'dotenv';
import { loadConfig } from '../config.js';
import { createStorage, prepareStorage } from '../storage/create.js';

loadEnv({ path: [path.resolve('.env'), path.resolve('../../.env')], quiet: true });

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && !entry.name.endsWith('.tmp')) yield full;
  }
}

const source = path.resolve(process.argv[2] ?? process.env.DATA_DIR ?? './data');
const config = loadConfig();
if (config.STORAGE_DRIVER !== 's3') {
  console.error('Set STORAGE_DRIVER=s3 and the S3_* variables of the target bucket.');
  process.exit(1);
}
const target = createStorage(config);
await prepareStorage(target, config);
let copied = 0;
for await (const file of walk(source)) {
  const key = path.relative(source, file).split(path.sep).join('/');
  await target.put(key, await readFile(file));
  if (++copied % 500 === 0) console.log(`${copied} objects copied`);
}
console.log(`Done: ${copied} objects copied from ${source} to s3://${config.S3_BUCKET}/${config.S3_PREFIX}`);
