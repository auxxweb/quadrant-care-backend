import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    senderName: { type: String, required: true },
    senderRole: { type: String, required: true },
    kind: { type: String, enum: ['TEXT', 'STICKER'], default: 'TEXT' },
    body: { type: String, trim: true, maxlength: 4000 },
    sticker: { type: String, trim: true, maxlength: 16 },
    deliveredTo: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    readBy: [
      {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ conversationId: 1, senderId: 1, createdAt: -1 });

export type MessageDocument = InferSchemaType<typeof messageSchema> & { _id: mongoose.Types.ObjectId };
export const Message = mongoose.model('Message', messageSchema);
