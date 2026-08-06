import { chromium } from '@playwright/test';

const OUT = '/tmp/claude-1001/-home-mkotoulas-projects-makis-allone/f4522134-141b-4c82-a0db-4ca3aa147207/scratchpad';
const path = process.argv[2] ?? '/styleguide';
const name = process.argv[3] ?? 'styleguide';

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript((t) => localStorage.setItem('allone_theme', t), theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  await page.goto(`http://localhost:5173${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${name}-${theme}.png`, fullPage: true });
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  console.log(`${theme}: data-theme=${applied} body-bg=${bg} errors=${errors.length}`);
  errors.slice(0, 4).forEach((e) => console.log('   ', e));
  await ctx.close();
}
await browser.close();
