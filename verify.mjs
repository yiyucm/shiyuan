import { chromium } from 'playwright';
import fs from 'fs';
const OUT = '/root/workspace/shiyuan-site/screenshots';
fs.mkdirSync(OUT, { recursive: true });
const EXE = '/root/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux-arm64/chrome-headless-shell';
const BASE = process.env.BASE || 'http://127.0.0.1:8901';

const shot = async (p, n, full = true) => {
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: full });
  console.log('  ✓', n);
};

const run = async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.goto(BASE + '/index.html?static=1', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);

  console.log('Pages 版：');
  await shot(p, '01-home');

  // 部署提示条是否出现
  const barHidden = await p.locator('#deployBar').evaluate(el => el.hidden).catch(() => true);
  console.log('  部署提示条已显示:', !barHidden);

  // 离线示例
  await p.goto(BASE + '/index.html?selftest', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  await shot(p, '02-selftest');
  const st = await p.locator('#selftest-out').textContent().catch(() => '');
  console.log('  自检结果:', (st || '').split('\n').slice(-2).join(' | ').slice(0, 160));

  // 离线示例页（用地址栏需先回到网页视图；改用直接调 openFixture 的入口）
  await p.goto(BASE + '/index.html?home', { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.evaluate(() => { location.href = '?selftest'; });
  await p.waitForTimeout(2500);
  await shot(p, '03-fixture-tags', false);

  // 字段页
  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.click('#hRss').catch(() => console.log('  (无法点 #hRss)'));
  await p.waitForTimeout(600);
  await shot(p, '04-panel', false);

  await b.close();
  console.log('\n完成 →', OUT);
};
run().catch(e => { console.error(e); process.exit(1); });
