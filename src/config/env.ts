import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 5050),
  mongoUri: required('MONGO_URI'),
  jwtSecret: required('JWT_SECRET', 'dev-quadrant-care-access-secret-change-me-now-32chars'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET', 'dev-quadrant-care-refresh-secret-change-me-now'),
  accessTokenExpiry: process.env.ACCESS_TOKEN_EXPIRY ?? '15m',
  refreshTokenExpiry: process.env.REFRESH_TOKEN_EXPIRY ?? '7d',
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPassword: process.env.SMTP_PASSWORD ?? '',
  smtpFrom: process.env.SMTP_FROM ?? 'Quadrant Care <noreply@quadrantcare.local>',
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
  storageProvider: (process.env.STORAGE_PROVIDER ?? 'local') as 'local' | 's3' | 'cloudinary',
  awsAccessKey: process.env.AWS_ACCESS_KEY ?? '',
  awsSecretKey: process.env.AWS_SECRET_KEY ?? '',
  awsBucket: process.env.AWS_BUCKET ?? '',
  awsRegion: process.env.AWS_REGION ?? '',
  uploadDir: process.env.UPLOAD_DIR ?? path.resolve(__dirname, '../../uploads'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 5),
  cookieSecure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
  isProd: (process.env.NODE_ENV ?? 'development') === 'production',
};

export const APP_NAME = 'Quadrant Care';
export const COMPANY_NAME = 'Quadrant Care Services Ltd';
