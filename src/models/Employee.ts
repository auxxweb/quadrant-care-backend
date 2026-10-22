import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { USER_STATUS } from '../config/constants.js';

const employeeSchema = new Schema(
  {
    employeeId: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    fullName: { type: String, required: true, trim: true, index: true },
    email: { type: String, trim: true, lowercase: true },
    mobile: { type: String, trim: true },
    dateOfBirth: { type: Date },
    address: { type: String, trim: true },
    profilePhoto: { type: String },
    jobRoleIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'JobRole' }],
      required: true,
      validate: {
        validator(value: unknown) {
          return Array.isArray(value) && value.length >= 1;
        },
        message: 'Select at least one job role.',
      },
    },
    primaryJobRoleId: { type: Schema.Types.ObjectId, ref: 'JobRole', required: true, index: true },
    careHomeId: { type: Schema.Types.ObjectId, ref: 'CareHome', index: true },
    joiningDate: { type: Date, required: true },
    status: { type: String, enum: Object.values(USER_STATUS), default: USER_STATUS.ACTIVE, index: true },
    loginEnabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);

employeeSchema.index({ fullName: 'text', employeeId: 'text', email: 'text' });
employeeSchema.index({ careHomeId: 1, status: 1 });
employeeSchema.index({ jobRoleIds: 1 });

employeeSchema.pre('validate', function (next) {
  const ids = [...new Set((this.jobRoleIds ?? []).map((id) => String(id)))];
  this.set('jobRoleIds', ids);
  if (this.primaryJobRoleId && !ids.includes(String(this.primaryJobRoleId))) {
    this.invalidate('primaryJobRoleId', 'Primary job role must be one of the assigned roles.');
  }
  next();
});

export const EMPLOYEE_POPULATE = ['jobRoleIds', 'primaryJobRoleId', 'careHomeId'] as const;

export type EmployeeDocument = InferSchemaType<typeof employeeSchema> & { _id: mongoose.Types.ObjectId };
export const Employee = mongoose.model('Employee', employeeSchema);
