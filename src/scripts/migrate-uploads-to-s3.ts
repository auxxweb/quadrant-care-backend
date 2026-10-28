import fs from 'node:fs/promises';
import path from 'node:path';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';
import { getS3Client, mimeForKey, s3ObjectKey } from '../services/storageService.js';
import { logger } from '../utils/logger.js';

// Copies every file under UPLOAD_DIR to S3 using the same relative key, so stored paths keep working.
// Usage: npm run migrate:uploads-s3 [-- --dry-run]

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listFiles(full);
      return Promise.resolve(entry.isFile() ? [full] : []);
    }),
  );
  return nested.flat();
}

async function exists(key: string): Promise<boolean> {
  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: env.awsBucket, Key: key }));
    return true;
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!env.awsBucket || !env.awsRegion) {
    throw new Error('AWS_BUCKET and AWS_REGION must be set.');
  }
  const root = path.resolve(env.uploadDir);
  const files = await listFiles(root).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  logger.info(`Found ${files.length} files under ${root}${dryRun ? ' (dry run)' : ''}.`);

  let uploaded = 0;
  let skipped = 0;
  for (const file of files) {
    const key = s3ObjectKey(path.relative(root, file).split(path.sep).join('/'));
    if (await exists(key)) {
      skipped += 1;
      continue;
    }
    if (!dryRun) {
      await getS3Client().send(
        new PutObjectCommand({
          Bucket: env.awsBucket,
          Key: key,
          Body: await fs.readFile(file),
          ContentType: mimeForKey(key),
        }),
      );
    }
    uploaded += 1;
    logger.info(`${dryRun ? 'Would upload' : 'Uploaded'} ${key}`);
  }

  logger.info(`Done: ${uploaded} ${dryRun ? 'to upload' : 'uploaded'}, ${skipped} already in S3.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
