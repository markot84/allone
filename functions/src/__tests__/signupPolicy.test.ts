import { describe, it, expect } from 'vitest';
import { signupAllowed, isInvitePending } from '../signupPolicy';

const NOW = new Date('2026-07-31T12:00:00Z');
const FUTURE = '2026-08-05T00:00:00.000Z';
const PAST = '2026-07-01T00:00:00.000Z';

const base = {
  mode: undefined as string | undefined,
  email: 'user@example.com',
  superAdminEmails: new Set<string>(),
  matchingInvites: [],
  openInvites: [],
  now: NOW,
};

describe('isInvitePending', () => {
  it('pending when unused and unexpired', () => {
    expect(isInvitePending({ expiresAt: FUTURE }, NOW)).toBe(true);
  });
  it('rejects used and expired invites', () => {
    expect(isInvitePending({ usedAt: PAST, expiresAt: FUTURE }, NOW)).toBe(false);
    expect(isInvitePending({ expiresAt: PAST }, NOW)).toBe(false);
  });
});

describe('signupAllowed', () => {
  it('denies by default (invite-only, no invites)', () => {
    expect(signupAllowed(base)).toBe(false);
  });
  it('allows in open mode', () => {
    expect(signupAllowed({ ...base, mode: 'open' })).toBe(true);
  });
  it('allows super-admin emails', () => {
    expect(signupAllowed({ ...base, superAdminEmails: new Set(['user@example.com']) })).toBe(true);
  });
  it('allows a pending addressed invite, denies a used/expired one', () => {
    expect(signupAllowed({ ...base, matchingInvites: [{ email: 'user@example.com', expiresAt: FUTURE }] })).toBe(true);
    expect(signupAllowed({ ...base, matchingInvites: [{ email: 'user@example.com', expiresAt: FUTURE, usedAt: PAST }] })).toBe(false);
    expect(signupAllowed({ ...base, matchingInvites: [{ email: 'user@example.com', expiresAt: PAST }] })).toBe(false);
  });
  it('allows a pending open (unaddressed) invite', () => {
    expect(signupAllowed({ ...base, openInvites: [{ email: '', expiresAt: FUTURE }] })).toBe(true);
    expect(signupAllowed({ ...base, openInvites: [{ email: '', expiresAt: PAST }] })).toBe(false);
  });
  it('denies an email-less signup with no open invites', () => {
    expect(signupAllowed({ ...base, email: '' })).toBe(false);
  });
});
