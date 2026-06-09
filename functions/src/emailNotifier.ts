import * as admin from 'firebase-admin';
import { logger } from './utils/logger';
import { ALERT } from './utils/alertKeys';
import type { Firestore } from 'firebase-admin/firestore';
import type { Transporter } from 'nodemailer';
import { createTransporter, SENDER, NOREPLY_EMAIL } from './smtpConfig';
import { escapeHtml } from './escapeHtml';

let _db: Firestore;
export function setDb(db: Firestore) { _db = db; }

export async function sendNotificationEmail(
  userId: string,
  notification: {
    title: string;
    body: string;
    type: string;
    brandId: string;
    entityType?: string;
    entityId?: string;
  },
  /** Αν δοθεί (π.χ. από HTTP handler με secrets), αποφεύγεται δεύτερο createTransporter. */
  reuseTransporter?: Transporter
): Promise<void> {
  if (!_db) {
    logger.error('emailNotifier: db not set', { alertKey: ALERT.emailSendFailed });
    throw new Error('emailNotifier db not set');
  }

  const transporter = reuseTransporter ?? createTransporter();
  if (!transporter) {
    logger.warn('[emailNotifier] SMTP not configured — cannot send');
    throw new Error('SMTP not configured');
  }

  const userDoc = await _db.collection('users').doc(userId).get();
  const userData = userDoc.data();
  let toEmail = userData?.email as string | undefined;
  if (!toEmail) {
    try {
      const rec = await admin.auth().getUser(userId);
      toEmail = rec.email || undefined;
    } catch (e) {
      logger.warn(`[emailNotifier] Auth lookup failed for ${userId}`, { err: e });
    }
  }
  if (!toEmail && notification.brandId) {
    try {
      const mem = await _db
        .collection('brands')
        .doc(notification.brandId)
        .collection('members')
        .doc(userId)
        .get();
      toEmail = (mem.data()?.email as string | undefined) || undefined;
    } catch (e) {
      logger.warn(`[emailNotifier] Member doc lookup failed for ${userId}`, { err: e });
    }
  }
  if (!toEmail) {
    logger.warn(`[emailNotifier] No email for user ${userId} (users / Auth / brand member)`);
    throw new Error('No recipient email');
  }

  let brandName = '';
  try {
    const brandDoc = await _db.collection('brands').doc(notification.brandId).get();
    brandName = brandDoc.data()?.name || '';
  } catch { /* ignore */ }

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
      <div style="background: #111; border-radius: 12px 12px 0 0; padding: 20px 24px; text-align: center;">
        <span style="color: #fff; font-size: 18px; font-weight: 700;">Performance+</span>
        ${brandName ? `<span style="color: rgba(255,255,255,0.6); font-size: 13px; display: block; margin-top: 4px;">${escapeHtml(brandName)}</span>` : ''}
      </div>
      <div style="border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px; padding: 24px;">
        <h2 style="margin: 0 0 8px; font-size: 16px; color: #111827;">${escapeHtml(notification.title)}</h2>
        <p style="margin: 0 0 20px; font-size: 14px; color: #6B7280; line-height: 1.5;">${escapeHtml(notification.body)}</p>
        <a href="https://performanceplus.gr/#coordination"
           style="display: inline-block; padding: 10px 24px; background: #F97316; color: #fff; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
          Δες στην εφαρμογή
        </a>
      </div>
      <p style="text-align: center; margin-top: 16px; font-size: 11px; color: #9CA3AF;">
        Αυτό το email εστάλη αυτόματα από το Performance+ · ${NOREPLY_EMAIL}
      </p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: SENDER,
      to: toEmail,
      // SEC-M1: strip CR/LF so a crafted title can't inject extra mail headers.
      subject: `[Performance+] ${notification.title.replace(/[\r\n]+/g, ' ')}`,
      html,
    });
    logger.info(`Email sent to ${toEmail} for notification: ${notification.title}`);
  } catch (err) {
    logger.error('Failed to send email:', { alertKey: ALERT.emailSendFailed, err });
    throw err;
  }
}
