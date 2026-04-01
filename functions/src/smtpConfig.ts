import * as nodemailer from 'nodemailer';
import dns from 'node:dns';
import { logger } from 'firebase-functions/v2';
import { defineString } from 'firebase-functions/params';

/** Πολλοί SMTP (Papaki/Plesk) ακούνε μόνο IPv4· το Cloud Run μπορεί να δοκιμάζει IPv6 πρώτα → ETIMEDOUT στο CONN. */
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

export const NOREPLY_EMAIL = 'noreply@performanceplus.gr';
export const APP_NAME = 'Performance+';
export const SENDER = `"${APP_NAME}" <${NOREPLY_EMAIL}>`;

/**
 * Papaki / Plesk: το Manual setup δίνει συχνά ως Outgoing server το **domain** (π.χ. performanceplus.gr),
 * όχι το linux###.papaki.gr (αυτό είναι συχνά το URL του panel). SMTP port 465 SSL.
 * https://support.papaki.com/help/which-settings-should-i-use-in-a-mail-client/
 */
const DEFAULT_SMTP_HOST = 'performanceplus.gr';
const smtpHostParam = defineString('SMTP_HOST', { default: DEFAULT_SMTP_HOST });
const smtpPortParam = defineString('SMTP_PORT', { default: '465' });

/**
 * Πάντα explicit SMTP host (όχι magic Gmail) — για Gmail βάλτε SMTP_HOST=smtp.gmail.com, π.χ. port 587.
 * Απαιτεί secrets: SMTP_EMAIL, SMTP_PASSWORD (πλήρες email + κωδικός mailbox).
 */
export function createTransporter(): nodemailer.Transporter | null {
  // Trim: secrets που κόβουν με newline/space στο τέλος → 535 παρά «σωστό» password στο webmail
  const user = (process.env.SMTP_EMAIL || '').trim();
  const pass = (process.env.SMTP_PASSWORD || '').trim();
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
    /** Αργά δίκτυα / SMTP που κάνουν greylisting — default nodemailer 60s μερικές φορές δεν φτάνει. */
    connectionTimeout: 120_000,
    greetingTimeout: 45_000,
    socketTimeout: 120_000,
    // SNI ώστε το cert να ταιριάζει με το domain (Plesk warning για certificate)
    tls: { minVersion: 'TLSv1.2', servername: host },
  });
}
