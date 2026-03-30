import * as nodemailer from 'nodemailer';
import { logger } from 'firebase-functions/v2';
import { defineString } from 'firebase-functions/params';

export const NOREPLY_EMAIL = 'noreply@performanceplus.gr';
export const APP_NAME = 'Performance+';
export const SENDER = `"${APP_NAME}" <${NOREPLY_EMAIL}>`;

/**
 * Papaki (και γενικά custom SMTP): π.χ. linux230.papaki.gr (Outgoing mail / SMTP στο Papaki).
 * https://support.papaki.com/help/which-settings-should-i-use-in-a-mail-client/
 * Συνιστάται: θύρα 465 + SSL/TLS. Εναλλακτικά: 587 + STARTTLS.
 */
const smtpHostParam = defineString('SMTP_HOST', { default: '' });
const smtpPortParam = defineString('SMTP_PORT', { default: '465' });

/**
 * Δημιουργεί transporter: αν έχει οριστεί SMTP_HOST → Papaki/custom SMTP, αλλιώς Gmail (legacy).
 * Απαιτεί secrets: SMTP_EMAIL, SMTP_PASSWORD (πλήρες email + κωδικός mailbox).
 */
export function createTransporter(): nodemailer.Transporter | null {
  const user = process.env.SMTP_EMAIL || '';
  const pass = process.env.SMTP_PASSWORD || '';
  if (!user || !pass) {
    logger.warn('[SMTP] Credentials not configured (SMTP_EMAIL / SMTP_PASSWORD)');
    return null;
  }

  const host = smtpHostParam.value().trim();
  const port = parseInt(smtpPortParam.value().trim(), 10) || 465;

  if (host) {
    const secure = port === 465;
    return nodemailer.createTransport({
      host,
      port,
      secure,
      ...(secure ? {} : { requireTLS: true }),
      auth: { user, pass },
      tls: { minVersion: 'TLSv1.2' },
    });
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}
