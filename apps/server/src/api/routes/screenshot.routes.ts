import type { CaptureHandler } from '../../services/types.ts';

import express from 'express';
import { normalizeOptions } from '../../services/options.ts';

export function createScreenshotRouter({ capture }: { capture: CaptureHandler }) {
  const router = express.Router();
  router.post('/screenshot', async (req, res, next) => {
    try {
      const options = normalizeOptions(req.body as unknown);
      const { image, cleanup, metadata } = await capture(options);
      res.set({
        'Content-Type': 'image/png', 'Cache-Control': 'no-store',
        'X-DiffTrail-Cleanup': cleanup,
        'X-DiffTrail-Residual': metadata.residual.state,
        'X-DiffTrail-Rules-Version': metadata.rulesVersion ?? 'none',
        'X-DiffTrail-Metadata': JSON.stringify(metadata),
      }).send(image);
    } catch (error) { next(error); }
  });
  return router;
}
