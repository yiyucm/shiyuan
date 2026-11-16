import { chromium } from 'playwright';
const b = await chromium.launch({executablePath:'/root/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux-arm64/chrome-headless-shell',args:['--no-sandbox']});
const p = await (await b.newContext({viewport:{width:412,height:900}})).newPage();
p.on('console', m=>console.log('C:', m.text().slice(0,200)));
await p.goto('https://yiyucm.github.io/shiyuan/');
await p.waitForTimeout(3000);
const r = await p.evaluate(async () => {
  const resp = await fetch('/shiyuan/api/health').catch(e=>({status:'ERR '+e.message}));
  let body=null;
  try { body = await resp.text(); } catch(e){}
  return {
    host: location.hostname,
    proto: location.protocol,
    healthUrl: '/shiyuan/api/health',
    status: resp.status,
    body: (body||'').slice(0,150)
  };
});
console.log(JSON.stringify(r,null,1));
await b.close();
