import { chromium } from 'playwright';
const b = await chromium.launch({executablePath:'/root/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux-arm64/chrome-headless-shell',args:['--no-sandbox']});
const p = await (await b.newContext({viewport:{width:412,height:900}})).newPage();
p.on('console', m=>console.log('C:', m.text().slice(0,200)));
await p.goto('https://yiyucm.github.io/shiyuan/');
await p.waitForTimeout(3500);
const r = await p.evaluate(() => {
  const el = document.getElementById('deployBar');
  const cs = getComputedStyle(el);
  return { hidden: el.hidden, display: cs.display, h: el.getBoundingClientRect().height,
           net: document.getElementById('netState').textContent };
});
console.log(JSON.stringify(r));
await b.close();
