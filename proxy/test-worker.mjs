// 本地模拟 Worker 的行为，验证抓取逻辑（含 GBK 解码）
const UA_DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function handle(target) {
  const headers = {
    "User-Agent": UA_DESKTOP,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const resp = await fetch(target, { headers, redirect: "follow", signal: ctl.signal });
    clearTimeout(timer);
    const ctype = resp.headers.get("content-type") || "";
    const cte = (ctype.match(/charset=([\w\-]+)/i) || [])[1] || "";
    const buf = new Uint8Array(await resp.arrayBuffer());
    let charset = cte.toLowerCase();
    if (!charset) {
      const head = new TextDecoder("latin1").decode(buf.slice(0, 4096));
      const m = head.match(/charset\s*=\s*["']?([\w\-]+)/i);
      charset = m ? m[1].toLowerCase() : "utf-8";
    }
    const norm = /gb2312|gbk|gb18030/.test(charset) ? "gbk" : (/big5/.test(charset) ? "big5" : "utf-8");
    const html = new TextDecoder(norm, { fatal: false }).decode(buf);
    return { ok: true, status: resp.status, charset: norm, bytes: buf.length,
             title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]?.trim().slice(0,60),
             head: html.slice(0, 120) };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: String(e.message||e) };
  }
}

for (const u of [
  "https://example.com/",
  "http://www.tumanly.com/",
  "https://www.baidu.com/",
]) {
  const r = await handle(u);
  console.log(u, "→", JSON.stringify(r).slice(0, 260));
}
