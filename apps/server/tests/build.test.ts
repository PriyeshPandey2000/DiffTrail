import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { cases } from './fixtures/cleanup.ts';

// Load emitted code through its file URL, while sharing the source contract.
const { createApp } = await import(new URL('../dist/app.js', import.meta.url).href) as typeof import('../src/app.ts');
const { createCaptureService } = await import(new URL('../dist/services/capture.js', import.meta.url).href) as typeof import('../src/services/capture.ts');
let target: http.Server;
let origin: string;
before(async () => {
  target = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(cases.banner.html);
  });
  target.listen(0, '127.0.0.1');
  await once(target, 'listening');
  const address = target.address();
  assert.ok(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  target.closeAllConnections();
  await new Promise<void>(resolve => target.close(() => resolve()));
});

for (const engine of ['raw', 'cosmetic', 'adguard'] as const) {
  test(`compiled HTTP server captures with ${engine} and resolves runtime assets`, {
    skip: engine === 'adguard' && process.env.RUN_ADGUARD_TESTS !== '1',
  }, async () => {
    const capture = createCaptureService({ cleanupEngine: engine === 'cosmetic' ? 'cosmetic' : 'adguard' });
    const server = http.createServer(createApp({ capture }));
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/screenshot`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: origin, cleanup: engine === 'raw' ? 'none' : 'standard' }),
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.equal(response.headers.get('x-difftrail-cleanup'),
        engine === 'raw' ? 'skipped' : engine === 'cosmetic' ? 'applied' : 'enabled');
      assert.equal(response.headers.get('x-difftrail-residual'), engine === 'raw' ? 'not-checked' : 'none-detected');
      const image = Buffer.from(await response.arrayBuffer());
      assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(image.readUInt32BE(16), 3840);
      assert.equal(image.readUInt32BE(20), 2160);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await capture.close();
    }
  });
}
