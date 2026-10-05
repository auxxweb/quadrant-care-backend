import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/tokenService.js';
import { UnauthorizedError } from '../utils/errors.js';

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) {
    next(new UnauthorizedError());
    return;
  }
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    next(new UnauthorizedError('Your session has expired. Please sign in again.'));
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (token) {
    try {
      req.user = verifyAccessToken(token);
    } catch {
      /* ignore */
    }
  }
  next();
}
