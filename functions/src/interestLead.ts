import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { logger } from './utils/logger';
import { ALERT } from './utils/alertKeys';
import { createSender, createTransporter, type SmtpCredentialInput } from './smtpConfig';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INTEREST_EMAIL_TIMEOUT_MS = 20_000;

/** Fallback if Firestore lookup fails or returns empty. */
const DEFAULT_TEAM_NOTIFY = 'support@notthesame.gr';

/** Recipients from Firestore `appConfig/notifications.interestLeadNotifyEmails`;
 * cached per cold-start to avoid hitting Firestore on every submission. */
const INTEREST_LEAD_NOTIFY_TTL_MS = 5 * 60_000;
let notifyCache: { emails: string[]; fetchedAt: number } | null = null;

async function loadInterestLeadRecipients(db: Firestore): Promise<string[]> {
  const now = Date.now();
  if (notifyCache && now - notifyCache.fetchedAt < INTEREST_LEAD_NOTIFY_TTL_MS) {
    return notifyCache.emails;
  }
  try {
    const snap = await db.doc('appConfig/notifications').get();
    const data = snap.data() ?? {};
    const raw = data.interestLeadNotifyEmails;
    const emails = Array.isArray(raw)
      ? raw.filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];
    notifyCache = { emails, fetchedAt: now };
    return emails;
  } catch (err) {
    logger.warn('[interestLead] appConfig/notifications fetch failed; using default recipient', { err });
    return [];
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildUserConfirmationText(fullName: string): string {
  return [
    `Γεια σας ${fullName},`,
    '',
    'Λάβαμε το αίτημά σας για το Performance+ και σας ευχαριστούμε για την επικοινωνία.',
    '',
    'Η ομάδα μας θα εξετάσει τα στοιχεία που στείλατε και θα επανέλθει με το επόμενο βήμα για μια σύντομη, ουσιαστική συζήτηση γύρω από τις ανάγκες του e-shop σας.',
    '',
    'Αν θέλετε να μιλήσουμε άμεσα, μπορείτε να μας καλέσετε στο 2310.321625.',
    '',
    'Με εκτίμηση,',
    'Η ομάδα Performance+',
  ].join('\n');
}

function buildUserConfirmationHtml(fullName: string): string {
  const safeName = escapeHtml(fullName);
  return `<!doctype html>
<html lang="el">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Performance+ — Λάβαμε το αίτημά σας</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f8fa;color:#24292f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#f6f8fa;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:20px;overflow:hidden;box-shadow:0 18px 42px rgba(16,24,40,0.10);">
            <tr>
              <td style="background:#111827;padding:24px 28px;">
                <div style="font-size:20px;line-height:1.2;font-weight:700;color:#ffffff;">Performance<span style="color:#f97316;">+</span></div>
                <div style="margin-top:6px;font-size:13px;line-height:1.5;color:rgba(255,255,255,0.72);">Εμπορική νοημοσύνη για e-shops</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <div style="display:inline-block;margin-bottom:16px;padding:6px 10px;border-radius:999px;background:#fff7ed;color:#c2410c;font-size:12px;font-weight:700;letter-spacing:0.02em;">Το αίτημά σας καταγράφηκε</div>
                <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#111827;font-weight:700;">Γεια σας ${safeName},</h1>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#374151;">Λάβαμε το αίτημά σας για το <strong>Performance+</strong> και σας ευχαριστούμε για την επικοινωνία.</p>
                <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#374151;">Η ομάδα μας θα εξετάσει τα στοιχεία που στείλατε και θα επανέλθει με το επόμενο βήμα για μια σύντομη, ουσιαστική συζήτηση γύρω από τις ανάγκες του e-shop σας.</p>
                <div style="margin:22px 0;padding:16px 18px;border-radius:16px;background:#fafafa;border:1px solid #eceff3;">
                  <p style="margin:0;font-size:14px;line-height:1.6;color:#4b5563;"><strong style="color:#111827;">Σημείωση:</strong> Αν θέλετε να μιλήσουμε άμεσα, μπορείτε να μας καλέσετε στο <a href="tel:+302310321625" style="color:#f97316;font-weight:600;text-decoration:none;">2310.321625</a>.</p>
                </div>
                <p style="margin:0;font-size:15px;line-height:1.7;color:#374151;">Με εκτίμηση,<br /><strong style="color:#111827;">Η ομάδα Performance+</strong></p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;background:#fbfbfc;border-top:1px solid #eef0f3;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280;">Αυτό είναι αυτοματοποιημένο μήνυμα επιβεβαίωσης μετά την υποβολή της φόρμας ενδιαφέροντος.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendInterestLeadEmails(
  db: Firestore,
  data: {
    fullName: string;
    email: string;
    phone: string | null;
    company: string | null;
    message: string | null;
  },
  smtp?: SmtpCredentialInput
): Promise<{ teamNotified: boolean; userConfirmed: boolean }> {
  const transporter = createTransporter(smtp, {
    connectionTimeout: 10_000,
    greetingTimeout: 8_000,
    socketTimeout: 20_000,
  });
  if (!transporter) {
    logger.warn('[interestLead] SMTP not configured — lead saved in Firestore only');
    throw new Error('SMTP not configured');
  }

  const recipients = await loadInterestLeadRecipients(db);
  const teamTo = recipients.length > 0 ? recipients : [DEFAULT_TEAM_NOTIFY];
  const from = createSender(smtp);
  const supportReplyTo = teamTo[0] || DEFAULT_TEAM_NOTIFY;

  const textBody = [
    'Νέα εκδήλωση ενδιαφέροντος (marketing landing)',
    '',
    `Ονοματεπώνυμο: ${data.fullName}`,
    `Email: ${data.email}`,
    `Τηλέφωνο: ${data.phone || '—'}`,
    `Εταιρεία: ${data.company || '—'}`,
    `Μήνυμα: ${data.message || '—'}`,
  ].join('\n');

  let teamNotified = false;
  let userConfirmed = false;

  try {
    await transporter.sendMail({
      from,
      to: teamTo.join(', '),
      replyTo: data.email,
      subject: `Performance+ — Νέο lead: ${data.fullName}`,
      text: textBody,
      html: `<pre style="font-family:system-ui,sans-serif;font-size:14px;white-space:pre-wrap;">${escapeHtml(textBody)}</pre>`,
      headers: {
        'X-Auto-Response-Suppress': 'All',
      },
    });
    teamNotified = true;
    logger.info('[interestLead] Team notify email sent', { email: teamTo.join(', ') });
  } catch (e) {
    logger.error('[interestLead] Team notify email failed', { alertKey: ALERT.interestLeadFailed, err: e });
  }

  try {
    const confirmationText = buildUserConfirmationText(data.fullName);
    await transporter.sendMail({
      from,
      to: data.email,
      replyTo: supportReplyTo,
      subject: 'Performance+ — Λάβαμε το αίτημά σας',
      text: confirmationText,
      html: buildUserConfirmationHtml(data.fullName),
      headers: {
        'X-Auto-Response-Suppress': 'All',
      },
    });
    userConfirmed = true;
    logger.info('[interestLead] User confirmation email sent', { email: data.email });
  } catch (e) {
    logger.error('[interestLead] User confirmation email failed', { alertKey: ALERT.interestLeadFailed, err: e });
  }

  return { teamNotified, userConfirmed };
}

async function sendInterestLeadEmailsBestEffort(
  db: Firestore,
  data: {
    fullName: string;
    email: string;
    phone: string | null;
    company: string | null;
    message: string | null;
  },
  smtp?: SmtpCredentialInput
): Promise<{ teamNotified: boolean; userConfirmed: boolean }> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      sendInterestLeadEmails(db, data, smtp),
      new Promise<{ teamNotified: boolean; userConfirmed: boolean }>((_resolve, reject) => {
        timer = setTimeout(() => {
          logger.warn('[interestLead] Email notification timed out; lead was saved');
          reject(new Error('Email notification timed out'));
        }, INTEREST_EMAIL_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    logger.error('[interestLead] Email notification failed; lead remains saved', { alertKey: ALERT.interestLeadFailed, err: e });
    return { teamNotified: false, userConfirmed: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function clamp(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, max);
}

/** Public interest-form submission (landing). Honeypot: the `hp` field must be empty. */
export async function persistInterestLead(
  db: Firestore,
  body: Record<string, unknown>,
  meta: { forwardedFor?: string; smtp?: SmtpCredentialInput }
): Promise<{
  ok: boolean;
  silent?: boolean;
  error?: string;
  emailResult?: { teamNotified: boolean; userConfirmed: boolean };
}> {
  const hp = typeof body.hp === 'string' ? body.hp : '';
  if (hp.length > 0) {
    logger.info('[interestLead] Honeypot triggered, ignoring');
    return { ok: true, silent: true };
  }

  const fullName = clamp(body.fullName, 120);
  const email = clamp(body.email, 200).toLowerCase();
  const phone = clamp(body.phone, 40);
  const company = clamp(body.company, 120);
  const message = clamp(body.message, 2000);
  const consent = body.consent === true;

  if (!fullName || fullName.length < 2) {
    return { ok: false, error: 'Το όνομα είναι υποχρεωτικό.' };
  }
  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, error: 'Έγκυρο email είναι υποχρεωτικό.' };
  }
  if (!consent) {
    return { ok: false, error: 'Απαιτείται αποδοχή της επεξεργασίας στοιχείων.' };
  }

  const leadRef = await db.collection('interest_leads').add({
    fullName,
    email,
    phone: phone || null,
    company: company || null,
    message: message || null,
    consent: true,
    source: 'marketing_landing',
    createdAt: FieldValue.serverTimestamp(),
    ipHint: meta.forwardedFor?.split(',')[0]?.trim()?.slice(0, 45) || null,
  });

  logger.info('[interestLead] Saved lead', { email });

  const emailResult = await sendInterestLeadEmailsBestEffort(
    db,
    {
      fullName,
      email,
      phone: phone || null,
      company: company || null,
      message: message || null,
    },
    meta.smtp
  );

  await leadRef.update({
    emailResult,
    teamNotificationStatus: emailResult.teamNotified ? 'sent' : 'failed',
    userConfirmationStatus: emailResult.userConfirmed ? 'sent' : 'failed',
    notificationCheckedAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, emailResult };
}
