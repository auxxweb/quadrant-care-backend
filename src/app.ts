import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { apiLimiter } from './middlewares/rateLimit.js';
import { apiRouter } from './routes/index.js';
import { errorHandler, notFound } from './middlewares/errorHandler.js';

const FRONTEND_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    if (req.path === '/sw.js' || req.path.endsWith('.webmanifest')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Service-Worker-Allowed', '/');
    }
    next();
  });
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      strictTransportSecurity: env.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", ...env.corsOrigins, 'ws:', 'wss:'],
          workerSrc: ["'self'"],
          manifestSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          ...(env.isProd ? { upgradeInsecureRequests: [] } : {}),
        },
      },
    }),
  );
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use('/uploads', express.static(path.resolve(env.uploadDir)));
  app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'Quadrant Care' }));
  app.use('/api', apiLimiter, apiRouter);

  if (env.isProd && fs.existsSync(FRONTEND_DIST)) {
    app.use(
      express.static(FRONTEND_DIST, {
        setHeaders(res, filePath) {
          if (filePath.endsWith('index.html') || filePath.endsWith('sw.js') || filePath.endsWith('.webmanifest')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          }
          if (filePath.endsWith('sw.js')) {
            res.setHeader('Service-Worker-Allowed', '/');
          }
        },
      }),
    );
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/socket.io')) return next();
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
