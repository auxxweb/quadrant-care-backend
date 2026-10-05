import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { USER_STATUS } from '../config/constants.js';

const careHomeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true, index: true },
    address: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    postcode: { type: String, required: true, trim: true },
    contactPerson: { type: String, trim: true },
    contactNumber: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    notes: { type: String, trim: true },
    status: { type: String, enum: Object.values(USER_STATUS), default: USER_STATUS.ACTIVE, index: true },
  },
  { timestamps: true },
);

careHomeSchema.index({ name: 'text', city: 'text', postcode: 'text' });

export type CareHomeDocument = InferSchemaType<typeof careHomeSchema> & { _id: mongoose.Types.ObjectId };
export const CareHome = mongoose.model('CareHome', careHomeSchema);
