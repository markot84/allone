/**
 * Log in, switch to the demo brand, then screenshot a list of app sections by hash route.
 * Usage: UI_TEST_EMAIL=… UI_TEST_PASSWORD=… node scripts/shot-section.mjs <outDir> <base> <tag> <section…>
 */
import { chromium } from '@playwright/test';

const [OUT, BASE, TAG, ...sections] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });

await p.goto(BASE, { waitUntil: 'load' });
await p.waitForTimeout(2500);
const signIn = p.locator('text=Σύνδεση').first();
if (await signIn.count()) { await signIn.click().catch(() => {}); await p.waitForTimeout(1500); }
await p.locator('input[type="email"]').first().fill(process.env.UI_TEST_EMAIL);
await p.locator('input[type="password"]').first().fill(process.env.UI_TEST_PASSWORD);
await p.locator('button[type="submit"]').first().click();
await p.waitForTimeout(9000);

const brandBtn = p.locator('header button').filter({ hasText: /^(mk|SportFlow)/ }).first();
if (await brandBtn.count()) {
  await brandBtn.click().catch(() => {});
  await p.waitForTimeout(1200);
  await p.locator('text=SportFlow').first().click().catch(() => {});
  await p.waitForTimeout(9000);
}

for (const section of sections) {
  await p.evaluate((s) => { window.location.hash = s; }, section);
  await p.waitForTimeout(7000);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: `${OUT}/${TAG}-${section}.png` });
  console.log(section, 'ok');
}

await b.close();
