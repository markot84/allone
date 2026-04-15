import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { createTransporter, SENDER, type SmtpCredentialInput } from './smtpConfig';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Παραλήπτες ειδοποίησης (ίδιο με marketing mailto). Override: env INTEREST_LEAD_NOTIFY_EMAILS (comma-separated). */
const DEFAULT_TEAM_NOTIFY = 'makis@notthesame.gr,dimitris@notthesame.gr,eleana@notthesame.gr';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendInterestLeadEmails(
  data: {
    fullName: string;
    email: string;
    phone: string | null;
    company: string | null;
    message: string | null;
  },
  smtp?: SmtpCredentialInput
): Promise<void> {
  const transporter = createTransporter(smtp);
  if (!transporter) {
    logger.warn('[interestLead] SMTP not configured — lead saved in Firestore only');
    return;
  }

  const teamRaw = (process.env.INTEREST_LEAD_NOTIFY_EMAILS || '').trim() || DEFAULT_TEAM_NOTIFY;
  const teamTo = teamRaw.split(',').map((x) => x.trim()).filter(Boolean);
  if (teamTo.length === 0) return;

  const textBody = [
    'Νέα εκδήλωση ενδιαφέροντος (marketing landing)',
    '',
    `Ονοματεπώνυμο: ${data.fullName}`,
    `Email: ${data.email}`,
    `Τηλέφωνο: ${data.phone || '—'}`,
    `Εταιρεία: ${data.company || '—'}`,
    `Μήνυμα: ${data.message || '—'}`,
  ].join('\n');

  try {
    await transporter.sendMail({
      from: SENDER,
      to: teamTo.join(', '),
      replyTo: data.email,
      subject: `Performance+ — Νέο lead: ${data.fullName}`,
      text: textBody,
      html: `<pre style="font-family:system-ui,sans-serif;font-size:14px;white-space:pre-wrap;">${escapeHtml(textBody)}</pre>`,
    });
  } catch (e) {
    logger.error('[interestLead] Team notify email failed', e);
  }

  try {
    await transporter.sendMail({
      from: SENDER,
      to: data.email,
      subject: 'Performance+ — Λάβαμε το αίτημά σας',
      text: [
        `Γεια σας ${data.fullName},`,
        '',
        'Ευχαριστούμε για το ενδιαφέρον σας. Η ομάδα μας θα επικοινωνήσει μαζί σας σύντομα.',
        '',
        'Ομάδα Performance+',
      ].join('\n'),
      html: `<p>Γεια σας ${escapeHtml(data.fullName)},</p>
<p>Ευχαριστούμε για το ενδιαφέρον σας. Η ομάδα μας θα επικοινωνήσει μαζί σας σύντομα.</p>
<p style="color:#666;font-size:13px;">Ομάδα Performance+</p>`,
    });
  } catch (e) {
    logger.error('[interestLead] User confirmation email failed', e);
  }
}

function clamp(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, max);
}

/**
 * Δημόσια υποβολή φόρμας ενδιαφέροντος (landing). Honeypot: πεδίο `hp` πρέπει να είναι κενό.
 */
export async function persistInterestLead(
  db: Firestore,
  body: Record<string, unknown>,
  meta: { forwardedFor?: string; smtp?: SmtpCredentialInput }
): Promise<{ ok: boolean; silent?: boolean; error?: string }> {
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

  await db.collection('interest_leads').add({
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

  logger.info(`[interestLead] Saved lead from ${email}`);

  await sendInterestLeadEmails(
    {
      fullName,
      email,
      phone: phone || null,
      company: company || null,
      message: message || null,
    },
    meta.smtp
  );

  return { ok: true };
}
