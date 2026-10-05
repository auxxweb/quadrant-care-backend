import http from 'node:http';
import { createApp } from './app.js';
import { connectDatabase } from './config/db.js';
import { env, APP_NAME } from './config/env.js';
import { logger } from './utils/logger.js';
import { initSocket } from './services/socketService.js';

async function bootstrap() {
  await connectDatabase();
  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);
  server.listen(env.port, () => {
    logger.info(`${APP_NAME} API running on port ${env.port}`);
  });
}

bootstrap().catch((error) => {
  logger.error(error);
  process.exit(1);
});
