import nodemailer from 'nodemailer';
import { env, APP_NAME, COMPANY_NAME } from '../config/env.js';
import { logger } from '../utils/logger.js';

type EmailTemplate =
  | 'welcome'
  | 'password-reset'
  | 'timesheet-submitted'
  | 'timesheet-rejected'
  | 'timesheet-approved'
  | 'admin-verification'
  | 'super-admin-approval';

interface SendEmailInput {
  to: string;
  template: EmailTemplate;
  data: Record<string, string>;
}

const templates: Record<EmailTemplate, (data: Record<string, string>) => { subject: string; html: string }> = {
  welcome: (data) => ({
    subject: `Welcome to ${APP_NAME}`,
    html: `<p>Hello ${data.name},</p><p>Your ${COMPANY_NAME} account is ready. You can sign in at ${data.loginUrl}.</p>`,
  }),
  'password-reset': (data) => ({
    subject: `${APP_NAME} password reset`,
    html: `<p>Hello ${data.name},</p><p>Reset your password using this link: <a href="${data.resetUrl}">${data.resetUrl}</a></p>`,
  }),
  'timesheet-submitted': (data) => ({
    subject: 'Timesheet submitted',
    html: `<p>A timesheet has been submitted by ${data.employeeName} for ${data.date}.</p>`,
  }),
  'timesheet-rejected': (data) => ({
    subject: 'Timesheet requires correction',
    html: `<p>Hello ${data.name},</p><p>Your timesheet for ${data.date} was rejected. Reason: ${data.reason}</p>`,
  }),
  'timesheet-approved': (data) => ({
    subject: 'Timesheet approved',
    html: `<p>Hello ${data.name},</p><p>Your timesheet for ${data.date} has been approved.</p>`,
  }),
  'admin-verification': (data) => ({
    subject: 'Timesheet verified by admin',
    html: `<p>Timesheet ${data.timesheetId} has been verified and is waiting for final approval.</p>`,
  }),
  'super-admin-approval': (data) => ({
    subject: 'Timesheet approved',
    html: `<p>Timesheet ${data.timesheetId} has received final approval.</p>`,
  }),
};

function getTransport() {
  if (!env.smtpHost) return null;
  return nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPassword } : undefined,
  });
}

export async function sendEmail({ to, template, data }: SendEmailInput): Promise<void> {
  if (!to) return;
  const content = templates[template](data);
  const transporter = getTransport();
  if (!transporter) {
    logger.info(`[email:${template}] to=${to} subject=${content.subject}`);
    return;
  }
  try {
    await transporter.sendMail({
      from: env.smtpFrom,
      to,
      subject: content.subject,
      html: content.html,
    });
  } catch (error) {
    logger.error('Email delivery failed', error);
  }
}
