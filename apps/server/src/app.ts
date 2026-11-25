import type { ErrorRequestHandler } from 'express';
import type { CaptureHandler } from './services/types.ts';

import express from 'express';
import { createScreenshotRouter } from './api/routes/screenshot.routes.ts';
import { CaptureError, createCaptureService } from './services/capture.ts';

export function createApp({ capture = createCaptureService() }: { capture?: CaptureHandler } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.locals.capture = capture;
  app.use('/api', createScreenshotRouter({ capture }));
  app.get('/', (req, res) => res.json({ status: 'ok' }));
  const handleError: ErrorRequestHandler = (error: unknown, req, res, next) => {
    if (error instanceof CaptureError) {
      return res.status(error.status).json({ error: { code: error.code, message: error.message, ...error.details } });
    }
    if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Provide a valid JSON body.' } });
    }
    if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'BODY_TOO_LARGE', message: 'Request body exceeds 16kb.' } });
    }
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
  };
  app.use(handleError);
  return app;
}
