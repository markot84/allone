import * as nodemailer from 'nodemailer';
import { logger } from 'firebase-functions/v2';

export const NOREPLY_EMAIL = 'noreply@performanceplus.gr';
export const APP_NAME = 'Performance+';
export const SENDER = `"${APP_NAME}" <${NOREPLY_EMAIL}>`;

/**
 * Creates a nodemailer transporter using SMTP credentials from env.
 * SMTP_EMAIL / SMTP_PASSWORD must be set — these are the mailbox
 * credentials used to authenticate (can differ from the From address).
 */
export function createTransporter(): nodemailer.Transporter | null {
  const user = process.env.SMTP_EMAIL || '';
  const pass = process.env.SMTP_PASSWORD || '';
  if (!user || !pass) {
    logger.warn('[SMTP] Credentials not configured (SMTP_EMAIL / SMTP_PASSWORD)');
    return null;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}
