import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { USER_STATUS } from '../config/constants.js';

const jobRoleSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true, index: true },
    description: { type: String, trim: true },
    status: { type: String, enum: Object.values(USER_STATUS), default: USER_STATUS.ACTIVE, index: true },
  },
  { timestamps: true },
);

export type JobRoleDocument = InferSchemaType<typeof jobRoleSchema> & { _id: mongoose.Types.ObjectId };
export const JobRole = mongoose.model('JobRole', jobRoleSchema);
