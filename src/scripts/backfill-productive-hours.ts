import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { backfillAllProductiveHours } from '../services/productiveHoursService.js';
import { logger } from '../utils/logger.js';

async function main() {
  await connectDatabase();
  const result = await backfillAllProductiveHours();
  logger.info(`Productive hours backfill complete: ${result.users} users, ${result.weeks} week buckets.`);
  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
