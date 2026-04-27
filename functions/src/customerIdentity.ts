import { createHash } from 'crypto';

export function normalizeCustomerEmail(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

export function getCustomerEmailIdentity(raw: unknown): { customerEmail?: string; customerEmailHash?: string } {
  const customerEmail = normalizeCustomerEmail(raw);
  if (!customerEmail || !customerEmail.includes('@')) return {};

  return {
    customerEmail,
    customerEmailHash: createHash('sha256').update(customerEmail).digest('hex'),
  };
}
