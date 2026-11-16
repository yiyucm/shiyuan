import { chromium } from 'playwright';
import fs from 'fs';
const OUT = '/root/workspace/shiyuan-site/screenshots';
fs.mkdirSync(OUT, { recursive: true });
const EXE = '/root/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux-arm64/chrome-headless-shell';
const URL = 'https://yiyucm.github.io/shiyuan/';

const shot = async (p, n, full = true) => {
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: full });
  console.log('  ✓', n);
};

const run = async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  p.on('console', m => { if (m.type() === 'error') console.log('  CONSOLE-ERR:', m.text().slice(0, 120)); });

  console.log('线上站点 ' + URL);
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  await shot(p, 'live-01-home');

  const barHidden = await p.locator('#deployBar').evaluate(el => el.hidden).catch(() => true);
  const net = await p.locator('#netState').textContent().catch(() => '');
  console.log('  部署提示条:', !barHidden ? '已显示' : '未显示');
  console.log('  顶栏状态:', net);

  // 离线示例
  await p.goto(URL + '?selftest', { waitUntil: 'networkidle' });
  await p.waitForTimeout(3000);
  await shot(p, 'live-02-selftest');
  const st = await p.locator('#selftest-out').textContent().catch(() => '');
  const m = (st || '').match(/合计\s*\d+\s*PASS\s*\/\s*\d+\s*FAIL/);
  console.log('  自检:', m ? m[0] : '(无输出)');

  // 字段页
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  await p.click('#hRss').catch(() => console.log('  (点不到 #hRss)'));
  await p.waitForTimeout(800);
  await shot(p, 'live-03-panel', false);

  await p.click('#subtabs [data-g="webview"]').catch(() => {});
  await p.waitForTimeout(500);
  await shot(p, 'live-04-webview', false);

  await b.close();
  console.log('\n完成 →', OUT);
};
run().catch(e => { console.error(e); process.exit(1); });
