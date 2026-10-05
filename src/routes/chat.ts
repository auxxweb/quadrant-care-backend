import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import { broadcastSchema, directChatSchema, sendMessageSchema } from '../validators/chat.js';
import {
  chatDirectory,
  createBroadcast,
  getMessages,
  listConversations,
  markChatRead,
  openDirectChat,
  sendMessage,
  unreadCount,
} from '../controllers/chatController.js';

export const chatRouter = Router();
chatRouter.use(authenticate);
chatRouter.get('/directory', chatDirectory);
chatRouter.get('/unread', unreadCount);
chatRouter.get('/conversations', listConversations);
chatRouter.post('/conversations/direct', validate(directChatSchema), openDirectChat);
chatRouter.post('/conversations/broadcast', authorize('ADMIN', 'SUPER_ADMIN'), validate(broadcastSchema), createBroadcast);
chatRouter.get('/conversations/:id/messages', getMessages);
chatRouter.post('/conversations/:id/messages', validate(sendMessageSchema), sendMessage);
chatRouter.post('/conversations/:id/read', markChatRead);
