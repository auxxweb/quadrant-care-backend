import { Router } from 'express';
import { loginLimiter, signupLimiter } from '../middlewares/rateLimit.js';
import { authenticate } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { forgotPasswordSchema, loginSchema, passcodeLoginSchema, resetPasswordSchema, staffSignupSchema, updateMeSchema } from '../validators/auth.js';
import {
  forgotPassword,
  login,
  loginPasscode,
  logoutHandler,
  me,
  publicAuthOptions,
  refresh,
  resetPasswordHandler,
  signupOptions,
  staffSignup,
  updateMe,
} from '../controllers/authController.js';

export const authRouter = Router();

authRouter.get('/options', publicAuthOptions);
authRouter.get('/signup-options', signupOptions);
authRouter.post('/signup', signupLimiter, validate(staffSignupSchema), staffSignup);
authRouter.post('/login', loginLimiter, validate(loginSchema), login);
authRouter.post('/login-passcode', loginLimiter, validate(passcodeLoginSchema), loginPasscode);
authRouter.post('/refresh', refresh);
authRouter.post('/logout', optionalLogoutAuth, logoutHandler);
authRouter.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword);
authRouter.post('/reset-password', validate(resetPasswordSchema), resetPasswordHandler);
authRouter.get('/me', authenticate, me);
authRouter.patch('/me', authenticate, validate(updateMeSchema), updateMe);

function optionalLogoutAuth(...args: Parameters<typeof authenticate>) {
  const header = args[0].headers.authorization;
  if (header) return authenticate(...args);
  args[2]();
}
