import http from 'node:http';
import { createApp } from './app.js';
import { connectDatabase } from './config/db.js';
import { env, APP_NAME } from './config/env.js';
import { logger } from './utils/logger.js';
import { initSocket } from './services/socketService.js';

process.on('unhandledRejection', (reason) => {
  logger.error(reason);
});

process.on('uncaughtException', (error) => {
  logger.error(error);
  // Exit so PM2 (or another supervisor) can restart a clean process.
  process.exit(1);
});

async function bootstrap() {
  await connectDatabase();
  const app = createApp();
  const server = http.createServer(app);
  // Bulk PDF streaming can exceed the default headers idle window on slow links.
  server.requestTimeout = 120_000;
  server.headersTimeout = 125_000;
  initSocket(server);
  server.listen(env.port, () => {
    logger.info(`${APP_NAME} API running on port ${env.port}`);
  });
}

bootstrap().catch((error) => {
  logger.error(error);
  process.exit(1);
});
