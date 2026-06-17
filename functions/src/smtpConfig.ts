import * as nodemailer from 'nodemailer';
import dns from 'node:dns';
import { logger } from './utils/logger';
import { defineString } from 'firebase-functions/params';

/** Many SMTP servers (Papaki/Plesk) listen on IPv4 only; Cloud Run may try IPv6 first → ETIMEDOUT on connect. */
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

export const NOREPLY_EMAIL = 'noreply@performanceplus.gr';
export const APP_NAME = 'Performance+';
export const SENDER = `"${APP_NAME}" <${NOREPLY_EMAIL}>`;

/** Papaki mail server for performanceplus.gr (root domain points to Firebase Hosting;
 * the MX host's TLS cert is issued for the Papaki server hostname). */
const DEFAULT_SMTP_HOST = 'linux230.papaki.gr';
const smtpHostParam = defineString('SMTP_HOST', { default: DEFAULT_SMTP_HOST });
const smtpPortParam = defineString('SMTP_PORT', { default: '465' });

/** Always an explicit SMTP host (for Gmail set SMTP_HOST=smtp.gmail.com, port 587).
 * Requires secrets SMTP_EMAIL, SMTP_PASSWORD (full email + mailbox password). */
export type SmtpCredentialInput = { email: string; password: string };
type SmtpTimeoutOptions = {
  connectionTimeout?: number;
  greetingTimeout?: number;
  socketTimeout?: number;
};

function sanitizeDisplayName(name: string): string {
  return name.replace(/["\r\n]/g, '').trim() || APP_NAME;
}

/** Prefer a From matching the authenticated mailbox to reduce SPF/DMARC mismatches
 * (e.g. when the SMTP login is a support@ address). */
export function createSender(credentials?: Partial<SmtpCredentialInput>, displayName = APP_NAME): string {
  const configuredFrom = (process.env.SMTP_FROM_EMAIL ?? '').trim();
  const authenticatedUser = (credentials?.email ?? process.env.SMTP_EMAIL ?? '').trim();
  const email = configuredFrom || authenticatedUser || NOREPLY_EMAIL;
  return `"${sanitizeDisplayName(displayName)}" <${email}>`;
}

/** credentials optionally from `defineSecret().value()` (Gen2); otherwise `process.env` (local / CI). */
export function createTransporter(
  credentials?: Partial<SmtpCredentialInput>,
  timeouts: SmtpTimeoutOptions = {}
): nodemailer.Transporter | null {
  // Trim: secrets with a trailing newline/space cause 535 despite a "correct" password in webmail
  const user = (credentials?.email ?? process.env.SMTP_EMAIL ?? '').trim();
  const pass = (credentials?.password ?? process.env.SMTP_PASSWORD ?? '').trim();
  if (!user || !pass) {
    logger.warn('[SMTP] Credentials not configured (SMTP_EMAIL / SMTP_PASSWORD)');
    return null;
  }

  const host = smtpHostParam.value().trim() || DEFAULT_SMTP_HOST;
  const port = parseInt(smtpPortParam.value().trim(), 10) || 465;
  const secure = port === 465;

  const userDomain = user.includes('@') ? user.split('@')[1] : 'invalid-missing-@';
  logger.info(
    `[SMTP] connect host=${host} port=${port} secure=${secure} mailboxDomain=${userDomain} passwordLen=${pass.length}`
  );

  return nodemailer.createTransport({
    host,
    port,
    secure,
    ...(secure ? {} : { requireTLS: true }),
    auth: { user, pass },
    /** Slow networks / greylisting SMTP — defaults for scheduled emails, override for public forms. */
    connectionTimeout: timeouts.connectionTimeout ?? 120_000,
    greetingTimeout: timeouts.greetingTimeout ?? 45_000,
    socketTimeout: timeouts.socketTimeout ?? 120_000,
    // SNI so the cert matches the domain (avoids Plesk certificate warning)
    tls: { minVersion: 'TLSv1.2', servername: host },
  });
}
