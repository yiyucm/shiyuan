import { chromium } from 'playwright';
const b = await chromium.launch({executablePath:'/root/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux-arm64/chrome-headless-shell',args:['--no-sandbox']});
const p = await (await b.newContext({viewport:{width:412,height:900}})).newPage();
p.on('console', m=>{ const t=m.text(); if(m.type()==='error'||/抓取|fetch|CORS/.test(t)) console.log('C:', t.slice(0,180)); });
await p.goto('https://yiyucm.github.io/shiyuan/');
await p.waitForTimeout(2500);
const r = await p.evaluate(async () => {
  const out = {};
  // 直接调离线 shim 的 api/fetch
  try {
    const resp = await fetch('api/fetch?url=' + encodeURIComponent('https://example.com/') + '&mode=static');
    const j = await resp.json();
    out.fetch = { ok: j.ok, error: j.error, htmlLen: (j.html||'').length, mode: j.mode };
  } catch(e){ out.fetch = 'ERR ' + e.message; }
  // 看 netFetch 的实现
  out.hasNetFetch = typeof netFetch !== 'undefined';
  return out;
});
console.log(JSON.stringify(r,null,1));
await b.close();
