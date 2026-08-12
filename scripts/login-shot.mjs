import { chromium } from '@playwright/test';

const OUT = process.argv[2];
const BASE = process.argv[3] || 'http://localhost:5173';
const TAG = process.argv[4] || 'app';
const EMAIL = process.env.UI_TEST_EMAIL;
const PASSWORD = process.env.UI_TEST_PASSWORD;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 980 } });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });

await p.goto(BASE, { waitUntil: 'load' });
await p.waitForTimeout(2500);

// The marketing page fronts the app; the login form is behind its "Σύνδεση" CTA.
const signIn = p.locator('text=Σύνδεση').first();
if (await signIn.count()) {
  await signIn.click().catch(() => {});
  await p.waitForTimeout(1500);
}

const emailField = p.locator('input[type="email"], input[name="email"]').first();
if (await emailField.count()) {
  await emailField.fill(EMAIL);
  await p.locator('input[type="password"]').first().fill(PASSWORD);
  await p.locator('button[type="submit"]').first().click();
  await p.waitForTimeout(9000);
} else {
  console.log('!! no email field found');
}

// Super-admins see every brand and land on whichever sorts first, which is the empty one.
// Switch to the demo brand so the dashboard actually has numbers in it.
const brandBtn = p.locator('header button, header [role="button"]').filter({ hasText: /^(mk|SportFlow)/ }).first();
if (await brandBtn.count()) {
  await brandBtn.click().catch(() => {});
  await p.waitForTimeout(1200);
  const opt = p.locator('text=SportFlow').first();
  if (await opt.count()) {
    await opt.click().catch(() => {});
    await p.waitForTimeout(8000);
  }
}

await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(2500);
await p.screenshot({ path: `${OUT}/${TAG}-01.png` });

// Scroll the tallest scroller to capture below the fold — #root is height:100vh; overflow:hidden.
await p.evaluate(() => {
  let best = null, bh = 0;
  for (const el of document.querySelectorAll('*')) {
    if (el.scrollHeight > el.clientHeight + 50 && el.scrollHeight > bh) { bh = el.scrollHeight; best = el; }
  }
  if (best) { best.setAttribute('data-sc', '1'); best.scrollTop = best.clientHeight; }
});
await p.waitForTimeout(1200);
await p.screenshot({ path: `${OUT}/${TAG}-02.png` });

console.log('url:', p.url());
console.log('errors:', errs.slice(0, 4));
await b.close();
