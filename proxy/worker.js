/**
 * 拾源 · 网页抓取代理（Cloudflare Worker）
 *
 * 作用：解决 GitHub Pages 上浏览器直连目标站的 CORS 限制。
 * 契约：GET /__net?url=<目标URL>&method=POST&body=<请求体>
 *   → { ok: true, html, url, status, charset, bytes }
 *   → { ok: false, error }
 *
 * 部署：
 *   1. Cloudflare Dashboard → Workers & Pages → Create → Worker
 *   2. 粘贴本文件 → Deploy
 *   3. 拿到 https://<你的worker>.workers.dev
 *   4. 把地址填到拾源页面「设置 → 抓取代理」
 */

// ---- 可配置 ----
const ALLOW_HOSTS = "*";          // "*" 允许任意站；也可填 "example.com,foo.cn" 白名单
const UA_DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const UA_MOBILE = "Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const TIMEOUT_MS = 20000;
const MAX_BYTES = 6 * 1024 * 1024;   // 单页上限 6MB

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function hostAllowed(host) {
  if (ALLOW_HOSTS === "*") return true;
  const list = ALLOW_HOSTS.split(",").map(s => s.trim()).filter(Boolean);
  return list.some(h => host === h || host.endsWith("." + h));
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
    }

    // 健康检查
    if (url.pathname === "/__ping" || url.pathname === "/") {
      return json({ ok: true, service: "shiyuan-proxy", time: Date.now() }, request);
    }

    if (url.pathname !== "/__net") {
      return json({ ok: false, error: "未知端点：" + url.pathname }, request, 404);
    }

    const target = url.searchParams.get("url") || "";
    const method = (url.searchParams.get("method") || "GET").toUpperCase();
    const body = url.searchParams.get("body") || "";

    if (!/^https?:\/\//i.test(target)) {
      return json({ ok: false, error: "url 参数必须是 http/https" }, request);
    }

    let parsed;
    try { parsed = new URL(target); } catch (e) {
      return json({ ok: false, error: "url 解析失败" }, request);
    }

    if (!hostAllowed(parsed.hostname)) {
      return json({ ok: false, error: "该域名不在代理白名单：" + parsed.hostname }, request);
    }

    // 允许对任意目标的 GET；POST 只允许同族（防 SSRF 到内网）
    if (method === "POST") {
      const self = new URL(request.url).hostname;
      const sameSite = parsed.hostname.endsWith(self) || self.endsWith(parsed.hostname);
      if (!sameSite && !/^https?:$/.test(new URL(request.url).protocol)) {
        return json({ ok: false, error: "POST 跨站被拒绝" }, request);
      }
    }

    const headers = {
      "User-Agent": UA_DESKTOP,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      "Upgrade-Insecure-Requests": "1",
    };
    if (parsed.origin !== new URL(target).origin) headers["Referer"] = parsed.origin + "/";

    const init = {
      method,
      headers,
      redirect: "follow",
      cf: { cacheTtl: 0, cacheEverything: false },
    };
    if (method !== "GET" && method !== "HEAD" && body) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      init.body = body;
    }

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(target, { ...init, signal: ctl.signal });
      clearTimeout(timer);

      const status = resp.status;
      const finalUrl = resp.url || target;
      const ctype = resp.headers.get("content-type") || "";
      const cte = (ctype.match(/charset=([\w\-]+)/i) || [])[1] || "";
      const buf = new Uint8Array(await resp.arrayBuffer());
      const bytes = buf.length;

      // 文本类才解码；二进制（图片/视频）直接报不支持
      const isText = /text|html|xml|json|javascript/i.test(ctype) || !ctype;
      if (!isText) {
        return json({ ok: false, error: "该资源不是文本内容（" + (ctype || "未知类型") + "），抓取代理只处理网页" }, request);
      }
      if (bytes > MAX_BYTES) {
        return json({ ok: false, error: "页面过大（" + (bytes / 1048576).toFixed(1) + "MB），超过 6MB 限制" }, request);
      }

      // 编码判定：优先 HTTP 头，其次 meta charset，最后 utf-8
      let charset = cte.toLowerCase();
      if (!charset) {
        const head = new TextDecoder("latin1").decode(buf.slice(0, 4096));
        const m = head.match(/charset\s*=\s*["']?([\w\-]+)/i);
        charset = m ? m[1].toLowerCase() : "utf-8";
      }
      const norm = /gb2312|gbk|gb18030/.test(charset) ? "gbk" : (/big5/.test(charset) ? "big5" : "utf-8");
      let html;
      try {
        html = new TextDecoder(norm, { fatal: false }).decode(buf);
      } catch (e) {
        html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
        norm = "utf-8";
      }
      // 非 utf-8 时，插入 charset 声明，避免浏览器二次乱码
      if (norm !== "utf-8" && !/<meta[^>]+charset/i.test(html.slice(0, 2000))) {
        html = html.replace(/<head([^>]*)>/i, `<head$1><meta charset="utf-8">`);
      }

      return json({
        ok: true,
        html,
        url: finalUrl,
        status,
        charset: norm,
        bytes,
        mode: "worker",
      }, request);
    } catch (e) {
      clearTimeout(timer);
      const msg = e && e.name === "AbortError" ? "抓取超时（" + (TIMEOUT_MS / 1000) + "s）" : String(e && e.message || e);
      return json({ ok: false, error: msg }, request);
    }
  },
};

function json(obj, request, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request.headers.get("Origin")),
    },
  });
}
