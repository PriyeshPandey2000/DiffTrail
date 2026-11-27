import type { CaptureHandler } from '../../services/types.ts';

import express from 'express';
import { normalizeOptions } from '../../services/options.ts';
import { listDevices } from '../../services/emulation.ts';

export function createScreenshotRouter({ capture }: { capture: CaptureHandler }) {
  const router = express.Router();
  router.get('/devices', (req, res) => { res.json({ devices: listDevices() }); });
  router.post('/screenshot', async (req, res, next) => {
    try {
      const options = normalizeOptions(req.body as unknown);
      const { image, contentType, cleanup, metadata } = await capture(options);
      res.set({
        'Content-Type': contentType, 'Cache-Control': 'no-store',
        'X-DiffTrail-Cleanup': cleanup,
        'X-DiffTrail-Residual': metadata.residual.state,
        'X-DiffTrail-Rules-Version': metadata.rulesVersion ?? 'none',
        'X-DiffTrail-Metadata': JSON.stringify(metadata),
        ...(metadata.output.truncated ? { 'X-DiffTrail-Truncated': 'true' } : {}),
      }).send(image);
    } catch (error) { next(error); }
  });
  return router;
}
