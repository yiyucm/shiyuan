import { chromium } from 'playwright';
const b = await chromium.launch({executablePath:'/root/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux-arm64/chrome-headless-shell',args:['--no-sandbox']});
// 模拟用户已信任自签证书
const ctx = await b.newContext({viewport:{width:412,height:900}, deviceScaleFactor:2, ignoreHTTPSErrors:true});
const p = await ctx.newPage();
p.on('console', m=>{ if(m.type()==='error') console.log('ERR:', m.text().slice(0,110)); });

await p.goto('https://yiyucm.github.io/shiyuan/');
await p.waitForTimeout(2000);
await p.evaluate(()=>{ localStorage.setItem('rp.fetch.proxy','https://127.0.0.1:8443'); });
await p.reload();
await p.waitForTimeout(2000);

// 测试连通性
await p.click('[data-tab="inter"]');
await p.waitForTimeout(600);
await p.click('#proxyTest');
await p.waitForTimeout(3500);
console.log('连通性:', await p.locator('#proxyState').textContent().catch(()=>'?'));

// 抓取真实站
await p.goto('https://yiyucm.github.io/shiyuan/');
await p.waitForTimeout(1500);
await p.fill('#homeUrl','http://www.tumanly.com/');
await p.click('#hRss');
await p.waitForTimeout(7000);
console.log('状态:', await p.locator('#netState').textContent().catch(()=>'?'));
await p.screenshot({path:'/root/workspace/shiyuan-site/screenshots/live-https-proxy.png'});
await b.close();
