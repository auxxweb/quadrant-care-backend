import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { Employee } from '../models/Employee.js';
import { logger } from '../utils/logger.js';

async function main() {
  await connectDatabase();
  const collection = Employee.collection;

  const copied = await collection.updateMany(
    {
      jobRoleId: { $exists: true, $ne: null },
      $or: [{ jobRoleIds: { $exists: false } }, { jobRoleIds: { $size: 0 } }, { primaryJobRoleId: { $exists: false } }],
    },
    [{ $set: { jobRoleIds: ['$jobRoleId'], primaryJobRoleId: '$jobRoleId' } }],
  );

  const unset = await collection.updateMany(
    { jobRoleId: { $exists: true } },
    { $unset: { jobRoleId: '' } },
  );

  logger.info(
    `Employee job-role backfill complete: copied ${copied.modifiedCount} document(s), removed jobRoleId from ${unset.modifiedCount} document(s).`,
  );
  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
