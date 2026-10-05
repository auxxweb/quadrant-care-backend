import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

export class StorageService {
  async saveBase64Image(base64: string, folder: string): Promise<string> {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(base64);
    if (!match) {
      throw new AppError('Unsupported image format. Please upload PNG, JPEG, or WebP.', 400, 'INVALID_FILE');
    }
    const mime = match[1];
    if (!ALLOWED_MIME.has(mime)) {
      throw new AppError('Unsupported image format.', 400, 'INVALID_FILE');
    }
    const buffer = Buffer.from(match[2], 'base64');
    const maxBytes = env.maxUploadMb * 1024 * 1024;
    if (buffer.length > maxBytes) {
      throw new AppError(`File is too large. Maximum size is ${env.maxUploadMb}MB.`, 400, 'FILE_TOO_LARGE');
    }
    const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
    const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
    const relative = path.posix.join(folder, filename);
    if (env.storageProvider === 's3') {
      throw new AppError('S3 storage is configured but not yet connected. Use local storage in this environment.', 500, 'STORAGE');
    }
    const dest = path.join(env.uploadDir, relative);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, buffer);
    return relative;
  }

  async saveBuffer(buffer: Buffer, folder: string, originalName: string, mime: string): Promise<string> {
    if (!ALLOWED_MIME.has(mime)) {
      throw new AppError('Unsupported file type.', 400, 'INVALID_FILE');
    }
    const maxBytes = env.maxUploadMb * 1024 * 1024;
    if (buffer.length > maxBytes) {
      throw new AppError(`File is too large. Maximum size is ${env.maxUploadMb}MB.`, 400, 'FILE_TOO_LARGE');
    }
    const ext = path.extname(originalName).toLowerCase() || '.png';
    const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    const relative = path.posix.join(folder, filename);
    const dest = path.join(env.uploadDir, relative);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, buffer);
    return relative;
  }

  resolve(relativePath: string): string {
    return path.join(env.uploadDir, relativePath);
  }

  async copyFile(relativePath: string, folder: string): Promise<string> {
    const source = this.resolve(relativePath);
    const ext = path.extname(relativePath) || '.png';
    const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    const relative = path.posix.join(folder, filename);
    const dest = path.join(env.uploadDir, relative);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(source, dest);
    return relative;
  }
}

export const storageService = new StorageService();
