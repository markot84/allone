import { describe, it, expect } from 'vitest';
import { escapeHtml } from './escapeHtml';

describe('escapeHtml (SEC-C2/H1/M1)', () => {
  it('escapes the five HTML-significant chars', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('neutralizes an img/onerror XSS payload', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('neutralizes a script payload', () => {
    expect(escapeHtml('<script>alert(document.cookie)</script>'))
      .toBe('&lt;script&gt;alert(document.cookie)&lt;/script&gt;');
  });

  it('encodes & first (no double-encoding)', () => {
    expect(escapeHtml('a & b < c')).toBe('a &amp; b &lt; c');
  });

  it('leaves the structural rationale markers (|| — •) intact for the PDF transform', () => {
    expect(escapeHtml('first || second — third • fourth'))
      .toBe('first || second — third • fourth');
  });

  it('is null/undefined-safe', () => {
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(null)).toBe('');
  });
});
