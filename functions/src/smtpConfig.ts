import * as nodemailer from 'nodemailer';
import dns from 'node:dns';
import { logger } from './utils/logger';
import { defineString } from 'firebase-functions/params';

/** Πολλοί SMTP (Papaki/Plesk) ακούνε μόνο IPv4· το Cloud Run μπορεί να δοκιμάζει IPv6 πρώτα → ETIMEDOUT στο CONN. */
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

export const NOREPLY_EMAIL = 'noreply@performanceplus.gr';
export const APP_NAME = 'Performance+';
export const SENDER = `"${APP_NAME}" <${NOREPLY_EMAIL}>`;

/**
 * Papaki mail server for performanceplus.gr. The root domain points to Firebase
 * Hosting and the MX host's TLS cert is issued for the Papaki server hostname.
 * https://support.papaki.com/help/which-settings-should-i-use-in-a-mail-client/
 */
const DEFAULT_SMTP_HOST = 'linux230.papaki.gr';
const smtpHostParam = defineString('SMTP_HOST', { default: DEFAULT_SMTP_HOST });
const smtpPortParam = defineString('SMTP_PORT', { default: '465' });

/**
 * Πάντα explicit SMTP host (όχι magic Gmail) — για Gmail βάλτε SMTP_HOST=smtp.gmail.com, π.χ. port 587.
 * Απαιτεί secrets: SMTP_EMAIL, SMTP_PASSWORD (πλήρες email + κωδικός mailbox).
 */
export type SmtpCredentialInput = { email: string; password: string };
type SmtpTimeoutOptions = {
  connectionTimeout?: number;
  greetingTimeout?: number;
  socketTimeout?: number;
};

function sanitizeDisplayName(name: string): string {
  return name.replace(/["\r\n]/g, '').trim() || APP_NAME;
}

/**
 * Για transactional mail προτιμάμε From ίδιο με το authenticated mailbox.
 * Αυτό μειώνει SPF/DMARC mismatches όταν το SMTP login είναι π.χ. support@notthesame.gr.
 */
export function createSender(credentials?: Partial<SmtpCredentialInput>, displayName = APP_NAME): string {
  const configuredFrom = (process.env.SMTP_FROM_EMAIL ?? '').trim();
  const authenticatedUser = (credentials?.email ?? process.env.SMTP_EMAIL ?? '').trim();
  const email = configuredFrom || authenticatedUser || NOREPLY_EMAIL;
  return `"${sanitizeDisplayName(displayName)}" <${email}>`;
}

/**
 * @param credentials — Προαιρετικά από `defineSecret().value()` (Gen2)· αλλιώς `process.env` (τοπικά / CI).
 */
export function createTransporter(
  credentials?: Partial<SmtpCredentialInput>,
  timeouts: SmtpTimeoutOptions = {}
): nodemailer.Transporter | null {
  // Trim: secrets που κόβουν με newline/space στο τέλος → 535 παρά «σωστό» password στο webmail
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
    /** Αργά δίκτυα / SMTP που κάνουν greylisting — defaults για scheduled emails, override για public forms. */
    connectionTimeout: timeouts.connectionTimeout ?? 120_000,
    greetingTimeout: timeouts.greetingTimeout ?? 45_000,
    socketTimeout: timeouts.socketTimeout ?? 120_000,
    // SNI ώστε το cert να ταιριάζει με το domain (Plesk warning για certificate)
    tls: { minVersion: 'TLSv1.2', servername: host },
  });
}
