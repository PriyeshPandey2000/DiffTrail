import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { archiveSha256, extensionDirectory, extensionVersion } from './config.js';

const directory = dirname(extensionDirectory);
await mkdir(directory, { recursive: true });
const archive = resolve(directory, 'chromium.zip');
let bytes;
try { bytes = await readFile(archive); } catch {
  const url = `https://github.com/uBlockOrigin/uBOL-home/releases/download/${extensionVersion}/uBOLite_${extensionVersion}.chromium.zip`;
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Extension download failed: HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
const digest = createHash('sha256').update(bytes).digest('hex');
if (digest !== archiveSha256) throw new Error('Extension checksum mismatch; refusing to extract. Remove the cached archive and retry.');
await writeFile(archive, bytes);
const staging = resolve(directory, `extract-${process.pid}`);
await rm(staging, { recursive: true, force: true });
await mkdir(staging);
try {
  const result = spawnSync('unzip', ['-q', archive, '-d', staging], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`unzip failed. Install unzip and retry. ${result.error?.message || result.stderr}`);
  const manifest = JSON.parse(await readFile(resolve(staging, 'manifest.json'), 'utf8'));
  if (manifest.version !== extensionVersion || manifest.manifest_version !== 3) throw new Error('Unexpected extension manifest');
  await rm(extensionDirectory, { recursive: true, force: true });
  await rename(staging, extensionDirectory);
} finally { await rm(staging, { recursive: true, force: true }); }
console.log(`Verified uBlock Origin Lite ${extensionVersion} (${digest}).\n${extensionDirectory}`);
