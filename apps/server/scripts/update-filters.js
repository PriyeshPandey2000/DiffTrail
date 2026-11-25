import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { selectRule } from '../src/services/filter-policy.ts';

const destination = new URL('../resources/filters/', import.meta.url);
const ids = { cookies: 18, popups: 19, chat: 22, ads: 2 };
const sha256 = value => createHash('sha256').update(value).digest('hex');
const manifest = { engine: '@ghostery/adblocker-playwright@2.20.3', policy: 'cosmetic-only-v1; ads-network-opt-in', sources: {} };
await mkdir(destination, { recursive: true });
await mkdir(new URL('upstream/', destination), { recursive: true });
for (const [category, id] of Object.entries(ids)) {
  const url = `https://filters.adtidy.org/extension/chromium/filters/${id}.txt`;
  const cached = process.argv.includes('--cached');
  const bundled = process.argv.includes('--from-snapshot');
  const response = cached || bundled ? null : await fetch(url);
  if (response && !response.ok) throw new Error(`Filter download failed: ${response.status}`);
  const source = bundled
    ? gunzipSync(await readFile(new URL(`upstream/${category}.txt.gz`, destination))).toString()
    : cached ? await readFile(new URL(`../../../.cache/rules/${category}.txt`, import.meta.url), 'utf8') : await response.text();
  const upstream = gzipSync(source, { level: 9 });
  await writeFile(new URL(`upstream/${category}.txt.gz`, destination), upstream);
  const rules = [];
  const inventory = {};
  for (const line of source.split(/\r?\n/)) {
    const result = selectRule(line, category);
    const key = result.kind || result.reason;
    inventory[key] = (inventory[key] || 0) + 1;
    if (result.rule) rules.push(result.rule);
  }
  const text = [...new Set(rules)].join('\n');
  const compressed = gzipSync(text, { level: 9 });
  await writeFile(new URL(`${category}.txt.gz`, destination), compressed);
  manifest.sources[category] = {
    url, title: source.match(/^! Title: (.+)$/m)?.[1].trim(),
    version: source.match(/^! Version: (.+)$/m)?.[1].trim(),
    updated: source.match(/^! TimeUpdated: (.+)$/m)?.[1].trim(),
    license: 'https://github.com/AdguardTeam/AdguardFilters/blob/master/LICENSE',
    sourceSha256: sha256(source), sourceCompressedSha256: sha256(upstream), sha256: sha256(text), compressedSha256: sha256(compressed), rules: rules.length, inventory,
  };
}
manifest.version = sha256(JSON.stringify(manifest)).slice(0, 16);
await writeFile(new URL('manifest.json', destination), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Bundled rules ${manifest.version}`);
console.log(Object.fromEntries(Object.entries(manifest.sources).map(([name, source]) => [name, source.inventory])));
