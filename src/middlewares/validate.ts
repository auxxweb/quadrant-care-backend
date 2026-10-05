import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { AppError } from '../utils/errors.js';

export function validate(schema: ZodTypeAny, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req[source] = schema.parse(req[source]);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new AppError(error.issues[0]?.message ?? 'Invalid request.', 400, 'VALIDATION_ERROR', error.issues));
        return;
      }
      next(error);
    }
  };
}
