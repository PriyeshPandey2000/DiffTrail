import http from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createApp } from '../src/app.ts';

// Functional smoke through the actual HTTP route. Raw captures have no cleanup
// wait, so these pairs are not a matched efficacy or visual-fidelity benchmark.
const sites = JSON.parse(await readFile(new URL('./sites.json', import.meta.url)));
const requested = process.argv.slice(2);
const selected = requested.length ? sites.filter(site => requested.includes(site.id))
  : sites.filter(site => ['onetrust', 'cookiebot', 'guardian', 'github'].includes(site.id));
if (!selected.length || requested.some(id => !sites.some(site => site.id === id))) throw new Error('Unknown site ID');
const directory = new URL(`../../../artifacts/api-smoke/${new Date().toISOString().replaceAll(':', '-')}/`, import.meta.url);
await mkdir(directory, { recursive: true });
const app = createApp();
const server = http.createServer(app);
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const endpoint = `http://127.0.0.1:${server.address().port}/api/screenshot`;
const results = [];
try {
  for (const site of selected) for (const cleanup of ['none', 'standard']) {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: site.url, cleanup }), signal: AbortSignal.timeout(40_000),
    });
    const image = response.headers.get('content-type')?.startsWith('image/png');
    const name = `${site.id}-${cleanup}`;
    const result = { site: site.id, url: site.url, cleanup, httpStatus: response.status,
      metadata: JSON.parse(response.headers.get('x-difftrail-metadata') || 'null') };
    if (image) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid PNG');
      await writeFile(new URL(`${name}.png`, directory), bytes);
      result.file = `${name}.png`;
    } else result.error = await response.json();
    results.push(result);
    await writeFile(new URL('results.json', directory), JSON.stringify({ kind: 'functional-smoke-not-efficacy-benchmark', results }, null, 2));
    console.log(`${name}: HTTP ${response.status}; ${result.metadata?.status || result.error?.error?.code}; residual ${result.metadata?.residual.state || 'n/a'}`);
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await app.locals.capture.close();
  console.log(`Evidence: ${directory.pathname}`);
}
