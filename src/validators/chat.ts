import { z } from 'zod';

export const directChatSchema = z.object({
  userId: z.string().min(1),
});

export const broadcastSchema = z.object({
  title: z.string().trim().max(80).optional(),
  body: z.string().trim().max(4000).optional(),
  sticker: z.string().trim().max(16).optional(),
  audience: z.enum(['STAFF', 'ADMIN', 'ALL', 'CUSTOM']).default('CUSTOM'),
  delivery: z.enum(['GROUP', 'INDIVIDUAL']).default('GROUP'),
  recipientIds: z.array(z.string().min(1)).optional(),
}).refine((value) => Boolean(value.body?.trim() || value.sticker), {
  message: 'Enter a message or choose a sticker.',
});

export const sendMessageSchema = z.object({
  body: z.string().trim().max(4000).optional(),
  sticker: z.string().trim().max(16).optional(),
}).refine((value) => Boolean(value.body?.trim() || value.sticker), {
  message: 'Enter a message or choose a sticker.',
});
