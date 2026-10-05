import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError('The requested endpoint was not found.', 404, 'NOT_FOUND'));
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ message: err.issues[0]?.message ?? 'Invalid request.', code: 'VALIDATION_ERROR' });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ message: err.message, code: err.code });
    return;
  }
  logger.error(err);
  if (typeof err === 'object' && err && 'code' in err && (err as { code?: number }).code === 11000) {
    res.status(409).json({ message: 'A record with this name already exists.', code: 'CONFLICT' });
    return;
  }
  res.status(500).json({
    message: 'Something went wrong. Please try again.',
    code: 'INTERNAL_ERROR',
    ...(env.isProd ? {} : { debug: err instanceof Error ? err.message : String(err) }),
  });
}
