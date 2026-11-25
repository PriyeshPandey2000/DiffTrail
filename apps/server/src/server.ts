import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

// Construct the capture service only after loading environment configuration.
const { createApp } = await import('./app.ts');
const { createCaptureService } = await import('./services/capture.ts');
const capture = createCaptureService();
const app = createApp({ capture });

const port = Number(process.env.PORT || 3000);
// Development server: public hosting needs network isolation and authentication.
const server = app.listen(port, '127.0.0.1', () => console.log(`DiffTrail listening at http://127.0.0.1:${port}`));
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close();
  await capture.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
