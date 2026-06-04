/**
 * smoke.spec.ts — Always-runnable E2E smoke test for Performance+.
 *
 * Intentionally CHEAP and login-free: it verifies that the deployed app
 * (STAGING by default — see playwright.config.ts baseURL) serves the SPA and
 * that a visitor can reach the sign-in form. The app root ("/") is the PUBLIC
 * MARKETING LANDING page (hero + a "Σύνδεση"/Sign-in button); the email/password
 * form is opened from that button — so the smoke first asserts the landing
 * renders, then opens the auth form and checks the three sign-in controls.
 *
 * It does NOT authenticate, hit any connector, or mutate any data, so it is
 * safe to run on every push against a live deployment. STAGING target only —
 * never production.
 *
 * Locators are deliberately resilient: the real login inputs (see
 * src/components/auth/LoginPage.tsx) carry no <label>/aria-label, so we try
 * role/label-based queries first and fall back to type/placeholder selectors.
 */

import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/** The "Σύνδεση" (Sign in) entry point on the landing page — button or link. */
function signInEntry(page: Page): Locator {
  return page
    .getByRole('button', { name: /σύνδεση|σύνδεσου|sign\s*in|log\s*in|login/i })
    .or(page.getByRole('link', { name: /σύνδεση|σύνδεσου|sign\s*in|log\s*in|login/i }))
    .first();
}

/**
 * Resolve the email field with progressively looser locators.
 * Order: accessible label/role → autocomplete hint → input[type=email] →
 * placeholder text (Greek UI uses "Email").
 */
function emailField(page: Page): Locator {
  return page
    .getByLabel(/email/i)
    .or(page.getByRole('textbox', { name: /email/i }))
    .or(page.locator('input[autocomplete="email"]'))
    .or(page.locator('input[type="email"]'))
    .or(page.getByPlaceholder(/email/i))
    .first();
}

/**
 * Resolve the password field. Password inputs expose no implicit ARIA role,
 * so role-based queries don't apply; fall back to type/placeholder. The Greek
 * placeholder is "Κωδικός".
 */
function passwordField(page: Page): Locator {
  return page
    .getByLabel(/password|κωδικ/i)
    .or(page.locator('input[type="password"]'))
    .or(page.getByPlaceholder(/password|κωδικ/i))
    .first();
}

/**
 * Resolve the form's submit control. The Greek UI button text is "Σύνδεση"/
 * "Συνδέσου"; accept English equivalents, then fall back to a type=submit button.
 */
function submitControl(page: Page): Locator {
  return page
    .locator('button[type="submit"]')
    .or(page.getByRole('button', { name: /σύνδεση|σύνδεσου|sign\s*in|log\s*in|login/i }))
    .first();
}

test.describe('Performance+ public smoke', () => {
  test('serves the SPA landing at / with an OK response and a sign-in entry', async ({ page }) => {
    // Arrange + Act: navigate to the deployed root (public marketing landing).
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Assert: HTTP-level OK (response is null only for non-navigations).
    expect(response, 'navigation should produce a response').not.toBeNull();
    expect(response?.ok(), `expected an OK status, got ${response?.status()}`).toBe(true);

    // Assert: the HTML document rendered and a non-empty title is present.
    await expect(page.locator('body')).toBeAttached();
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);

    // Assert: the landing exposes a way to sign in.
    await expect(signInEntry(page), 'sign-in entry should be visible on the landing').toBeVisible();
  });

  test('opening sign-in exposes email, password, and submit controls', async ({ page }) => {
    // Arrange: load the landing.
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Act: open the auth form via the landing's sign-in entry.
    await signInEntry(page).click();

    // Assert: the email field appearing confirms the login form rendered, then
    // the password field and a submit control are present and visible.
    await expect(emailField(page), 'email field should be visible after opening sign-in').toBeVisible();
    await expect(passwordField(page), 'password field should be visible').toBeVisible();
    await expect(submitControl(page), 'submit control should be visible').toBeVisible();
  });
});
