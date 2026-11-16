// 本地模拟 Cloudflare Worker（用于端到端验证前端接入）
import http from "node:http";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PORT = 8799;
http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  if (u.pathname === "/__ping") {
    res.writeHead(200, {"Content-Type":"application/json"});
    return res.end(JSON.stringify({ ok:true, service:"local-proxy" }));
  }
  if (u.pathname !== "/__net") {
    res.writeHead(404, {"Content-Type":"application/json"});
    return res.end(JSON.stringify({ ok:false, error:"未知端点" }));
  }
  const target = u.searchParams.get("url") || "";
  const method = (u.searchParams.get("method")||"GET").toUpperCase();
  const body = u.searchParams.get("body") || "";
  if (!/^https?:\/\//i.test(target)) {
    res.writeHead(200, {"Content-Type":"application/json"});
    return res.end(JSON.stringify({ ok:false, error:"url 参数必须是 http/https" }));
  }
  const ctl = new AbortController();
  const timer = setTimeout(()=>ctl.abort(), 20000);
  try {
    const headers = { "User-Agent": UA, "Accept":"text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language":"zh-CN,zh;q=0.9" };
    const init = { method, headers, redirect:"follow", signal: ctl.signal };
    if (method !== "GET" && body) { headers["Content-Type"]="application/x-www-form-urlencoded"; init.body = body; }
    const resp = await fetch(target, init);
    clearTimeout(timer);
    const ctype = resp.headers.get("content-type")||"";
    const cte = (ctype.match(/charset=([\w\-]+)/i)||[])[1]||"";
    const buf = new Uint8Array(await resp.arrayBuffer());
    let charset = cte.toLowerCase();
    if (!charset) {
      const head = new TextDecoder("latin1").decode(buf.slice(0,4096));
      const m = head.match(/charset\s*=\s*["']?([\w\-]+)/i);
      charset = m ? m[1].toLowerCase() : "utf-8";
    }
    const norm = /gb2312|gbk|gb18030/.test(charset)?"gbk":(/big5/.test(charset)?"big5":"utf-8");
    let html = new TextDecoder(norm,{fatal:false}).decode(buf);
    if (norm!=="utf-8" && !/<meta[^>]+charset/i.test(html.slice(0,2000))) {
      html = html.replace(/<head([^>]*)>/i, `<head$1><meta charset="utf-8">`);
    }
    res.writeHead(200, {"Content-Type":"application/json"});
    res.end(JSON.stringify({ ok:true, html, url:resp.url||target, status:resp.status, charset:norm, bytes:buf.length, mode:"worker" }));
  } catch(e) {
    clearTimeout(timer);
    res.writeHead(200, {"Content-Type":"application/json"});
    res.end(JSON.stringify({ ok:false, error: e.name==="AbortError"?"抓取超时":String(e.message||e) }));
  }
}).listen(PORT, "0.0.0.0", ()=>console.log("本地代理已启动 :"+PORT));
