import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  CopyObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export function mimeForKey(key: string): string {
  return MIME_BY_EXT[path.extname(key).toLowerCase()] ?? 'application/octet-stream';
}

/** Rejects keys that could escape the upload root, e.g. `../x` or `/etc/x`. */
export function assertSafeKey(key: string): string {
  const normalized = path.posix.normalize(key.replace(/\\/g, '/'));
  if (!key || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    throw new AppError('Invalid file path.', 400, 'INVALID_FILE');
  }
  return normalized;
}

function isNotFound(error: unknown): boolean {
  const err = error as { name?: string; code?: string; $metadata?: { httpStatusCode?: number } };
  return err?.code === 'ENOENT' || err?.name === 'NoSuchKey' || err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404;
}

let s3Client: S3Client | undefined;

export function getS3Client(): S3Client {
  if (!s3Client) {
    const config: S3ClientConfig = { region: env.awsRegion };
    // Without explicit keys the SDK falls back to its default chain (IAM role, AWS_PROFILE, ...).
    if (env.awsAccessKey && env.awsSecretKey) {
      config.credentials = { accessKeyId: env.awsAccessKey, secretAccessKey: env.awsSecretKey };
    }
    s3Client = new S3Client(config);
  }
  return s3Client;
}

export function s3ObjectKey(key: string): string {
  return env.awsS3Prefix ? path.posix.join(env.awsS3Prefix, key) : key;
}

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
    this.assertSize(buffer);
    const ext = mime === 'image/jpeg' ? '.jpg' : `.${mime.split('/')[1]}`;
    const key = this.newKey(folder, ext);
    await this.put(key, buffer, mime);
    return key;
  }

  async saveBuffer(buffer: Buffer, folder: string, originalName: string, mime: string): Promise<string> {
    if (!ALLOWED_MIME.has(mime)) {
      throw new AppError('Unsupported file type.', 400, 'INVALID_FILE');
    }
    this.assertSize(buffer);
    const key = this.newKey(folder, path.extname(originalName).toLowerCase() || '.png');
    await this.put(key, buffer, mime);
    return key;
  }

  async copyFile(relativePath: string, folder: string): Promise<string> {
    const source = assertSafeKey(relativePath);
    const key = this.newKey(folder, path.extname(source) || '.png');
    if (env.storageProvider === 's3') {
      await getS3Client().send(
        new CopyObjectCommand({
          Bucket: env.awsBucket,
          CopySource: encodeURI(`${env.awsBucket}/${s3ObjectKey(source)}`),
          Key: s3ObjectKey(key),
        }),
      );
    } else {
      const dest = this.localPath(key);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(this.localPath(source), dest);
    }
    return key;
  }

  /** Returns the file contents, or null if it does not exist. */
  async read(relativePath: string): Promise<Buffer | null> {
    const key = assertSafeKey(relativePath);
    try {
      if (env.storageProvider === 's3') {
        const result = await getS3Client().send(new GetObjectCommand({ Bucket: env.awsBucket, Key: s3ObjectKey(key) }));
        if (!result.Body) return null;
        return Buffer.from(await result.Body.transformToByteArray());
      }
      return await fs.readFile(this.localPath(key));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** Short-lived presigned GET URL. Only valid for the S3 provider. */
  async getSignedUrl(relativePath: string): Promise<string> {
    const key = assertSafeKey(relativePath);
    return getSignedUrl(getS3Client(), new GetObjectCommand({ Bucket: env.awsBucket, Key: s3ObjectKey(key) }), {
      expiresIn: env.s3UrlExpirySeconds,
    });
  }

  private async put(key: string, buffer: Buffer, mime: string) {
    if (env.storageProvider === 's3') {
      await getS3Client().send(
        new PutObjectCommand({ Bucket: env.awsBucket, Key: s3ObjectKey(key), Body: buffer, ContentType: mime }),
      );
      return;
    }
    const dest = this.localPath(key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, buffer);
  }

  private localPath(key: string): string {
    return path.join(env.uploadDir, key);
  }

  private newKey(folder: string, ext: string): string {
    return path.posix.join(folder, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  }

  private assertSize(buffer: Buffer) {
    const maxBytes = env.maxUploadMb * 1024 * 1024;
    if (buffer.length > maxBytes) {
      throw new AppError(`File is too large. Maximum size is ${env.maxUploadMb}MB.`, 400, 'FILE_TOO_LARGE');
    }
  }
}

export const storageService = new StorageService();
