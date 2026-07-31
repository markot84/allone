import { describe, it, expect } from 'vitest';
import { redactString, redactEmail, redact } from '../utils/logger';

describe('redactString', () => {
  it('masks email addresses in free text', () => {
    expect(redactString('Email sent to john.doe@example.com for x')).toBe('Email sent to j***@e*** for x');
  });
  it('masks tokens and keys', () => {
    expect(redactString('auth Bearer abcdefghij1234567890')).toBe('auth Bearer [token]');
    expect(redactString('enc:v1:abc:def==')).toBe('enc:v1:[token]');
  });
});

describe('redactEmail', () => {
  it('keeps only first chars of local and domain', () => {
    expect(redactEmail('p.ntinis@trustsecure.eu')).toBe('p***@t***');
  });
});

describe('redact (ctx)', () => {
  it('masks email-like keys and inline emails in string values', () => {
    const out = redact({ email: 'a@b.com', note: 'contact c@d.org now' }) as Record<string, string>;
    expect(out.email).toBe('a***@b***');
    expect(out.note).toBe('contact c***@d*** now');
  });
});
