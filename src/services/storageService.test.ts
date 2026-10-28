import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';
import { assertSafeKey, storageService } from './storageService.js';

const PNG = `data:image/png;base64,${Buffer.from('fake-png').toString('base64')}`;
const original = { ...env };

afterEach(() => {
  Object.assign(env, original);
  vi.restoreAllMocks();
});

describe('assertSafeKey', () => {
  it('rejects keys that escape the upload root', () => {
    expect(() => assertSafeKey('../secret.png')).toThrow();
    expect(() => assertSafeKey('signatures/../../secret.png')).toThrow();
    expect(() => assertSafeKey('/etc/passwd')).toThrow();
    expect(() => assertSafeKey('')).toThrow();
  });

  it('accepts normal keys', () => {
    expect(assertSafeKey('signatures/a.png')).toBe('signatures/a.png');
  });
});

describe('local storage', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'quadrant-uploads-'));
    Object.assign(env, { storageProvider: 'local', uploadDir: dir });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('saves, copies and reads files', async () => {
    const key = await storageService.saveBase64Image(PNG, 'signatures');
    expect(key).toMatch(/^signatures\/\d+-[0-9a-f]{16}\.png$/);
    expect((await storageService.read(key))?.toString()).toBe('fake-png');

    const copy = await storageService.copyFile(key, 'signatures');
    expect(copy).not.toBe(key);
    expect((await storageService.read(copy))?.toString()).toBe('fake-png');
  });

  it('returns null for missing files', async () => {
    expect(await storageService.read('signatures/missing.png')).toBeNull();
  });
});

describe('s3 storage', () => {
  beforeEach(() => {
    Object.assign(env, { storageProvider: 's3', awsBucket: 'bucket', awsRegion: 'eu-west-2', awsS3Prefix: 'prod' });
    // Presigning needs credentials; the cached client picks these up through the default chain.
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'test-key');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('puts objects under the prefix with a content type', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const key = await storageService.saveBase64Image(PNG, 'photos');
    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({ Bucket: 'bucket', Key: `prod/${key}`, ContentType: 'image/png' });
  });

  it('copies objects within the bucket', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const key = await storageService.copyFile('signatures/a.png', 'signatures');
    const command = send.mock.calls[0][0] as CopyObjectCommand;
    expect(command).toBeInstanceOf(CopyObjectCommand);
    expect(command.input).toMatchObject({ CopySource: 'bucket/prod/signatures/a.png', Key: `prod/${key}` });
  });

  it('reads objects and returns null for missing keys', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send');
    send.mockResolvedValueOnce({ Body: { transformToByteArray: async () => new Uint8Array(Buffer.from('img')) } } as never);
    expect((await storageService.read('signatures/a.png'))?.toString()).toBe('img');
    expect((send.mock.calls[0][0] as GetObjectCommand).input.Key).toBe('prod/signatures/a.png');

    send.mockRejectedValueOnce(Object.assign(new Error('missing'), { name: 'NoSuchKey' }));
    expect(await storageService.read('signatures/missing.png')).toBeNull();
  });

  it('creates presigned URLs', async () => {
    const url = await storageService.getSignedUrl('signatures/a.png');
    expect(url).toContain('bucket');
    expect(url).toContain('prod/signatures/a.png');
    expect(url).toContain('X-Amz-Expires=300');
  });
});
