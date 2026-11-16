#!/usr/bin/env node
/**
 * 拾源 · 本地抓取代理
 *
 * 作用：让 GitHub Pages 版也能抓取任意网站。
 *   Pages 是静态托管，浏览器直连目标站会被 CORS 拦截；
 *   本脚本在本地跑一个带 CORS 的转发服务，页面填入它的地址即可。
 *
 * 用法：
 *   node proxy/server.js                                  # http  127.0.0.1:8787
 *   node proxy/server.js --host 0.0.0.0                   # 允许局域网访问
 *   node proxy/server.js --port 9000
 *   node proxy/server.js --allow example.com,foo.cn       # 域名白名单
 *   node proxy/server.js --cert key.pem --key cert.pem    # https（自签）
 *
 * 然后在拾源页面「设置 → 抓取代理」填：
 *   http://127.0.0.1:8787          同一台电脑
 *   http://192.168.x.x:8787        同一局域网的其他设备（手机可用）
 *
 * 注意：拾源页面部署在 GitHub Pages 时是 HTTPS，浏览器会拦截 http:// 代理
 * （混合内容）。此时需要用 https 代理，或让页面走 http:// 访问。
 */

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import os from "node:os";
import { URL } from "node:url";

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const PORT = parseInt(argOf("--port", "8787"), 10);
const HOST = argOf("--host", "0.0.0.0");
const ALLOW = argOf("--allow", "*");
const CERT = argOf("--cert", "");
const KEY = argOf("--key", "");
const USE_TLS = !!(CERT && KEY);
const SCHEME = USE_TLS ? "https" : "http";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT_MS = 20000;
const MAX_BYTES = 6 * 1024 * 1024;

const hostAllowed = (host) => {
  if (ALLOW === "*") return true;
  return ALLOW.split(",").map(s => s.trim()).filter(Boolean)
    .some(h => host === h || host.endsWith("." + h));
};

function cors(req, res) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Requested-With");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function sendJson(req, res, obj, status = 200) {
  cors(req, res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

/** 解码响应体：优先 HTTP 头 charset，其次 meta charset，最后 utf-8 */
function decode(buf, ctype) {
  let charset = ((ctype.match(/charset=([\w\-]+)/i) || [])[1] || "").toLowerCase();
  if (!charset) {
    const head = buf.subarray(0, 4096).toString("latin1");
    const m = head.match(/charset\s*=\s*["']?([\w\-]+)/i);
    charset = m ? m[1].toLowerCase() : "utf-8";
  }
  const norm = /gb2312|gbk|gb18030/.test(charset) ? "gbk"
    : /big5/.test(charset) ? "big5" : "utf-8";
  let html;
  try {
    html = new TextDecoder(norm, { fatal: false }).decode(buf);
  } catch {
    html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    return { html, charset: "utf-8" };
  }
  if (norm !== "utf-8" && !/<meta[^>]+charset/i.test(html.slice(0, 2000))) {
    html = html.replace(/<head([^>]*)>/i, `<head$1><meta charset="utf-8">`);
  }
  return { html, charset: norm };
}

async function handler(req, res) {
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    cors(req, res);
    res.writeHead(204);
    return res.end();
  }

  if (u.pathname === "/__ping" || u.pathname === "/") {
    return sendJson(req, res, { ok: true, service: "shiyuan-local-proxy", allow: ALLOW, time: Date.now() });
  }

  if (u.pathname !== "/__net") {
    return sendJson(req, res, { ok: false, error: "未知端点：" + u.pathname }, 404);
  }

  const target = u.searchParams.get("url") || "";
  const method = (u.searchParams.get("method") || "GET").toUpperCase();
  const body = u.searchParams.get("body") || "";

  if (!/^https?:\/\//i.test(target)) {
    return sendJson(req, res, { ok: false, error: "url 参数必须是 http/https" });
  }
  let parsed;
  try { parsed = new URL(target); } catch {
    return sendJson(req, res, { ok: false, error: "url 解析失败" });
  }
  if (!hostAllowed(parsed.hostname)) {
    return sendJson(req, res, { ok: false, error: `该域名不在白名单：${parsed.hostname}` });
  }
  // 拒绝内网地址，避免变成 SSRF 跳板
  if (/^(localhost$|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(parsed.hostname)) {
    return sendJson(req, res, { ok: false, error: "拒绝抓取内网地址" });
  }

  const headers = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    "Upgrade-Insecure-Requests": "1",
  };
  if (method !== "GET" && method !== "HEAD" && body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const init = { method, headers, redirect: "follow", signal: ctl.signal };
    if (method !== "GET" && method !== "HEAD" && body) init.body = body;
    const resp = await fetch(target, init);
    clearTimeout(timer);

    const ctype = resp.headers.get("content-type") || "";
    const isText = /text|html|xml|json|javascript/i.test(ctype) || !ctype;
    if (!isText) {
      return sendJson(req, res, { ok: false, error: `该资源不是文本内容（${ctype || "未知类型"}）` });
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      return sendJson(req, res, { ok: false, error: `页面过大（${(buf.length / 1048576).toFixed(1)}MB），超过 6MB` });
    }
    const { html, charset } = decode(buf, ctype);
    return sendJson(req, res, {
      ok: true, html, url: resp.url || target, status: resp.status,
      charset, bytes: buf.length, mode: "local",
    });
  } catch (e) {
    clearTimeout(timer);
    const msg = e && e.name === "AbortError" ? `抓取超时（${TIMEOUT_MS / 1000}s）` : String(e && e.message || e);
    return sendJson(req, res, { ok: false, error: msg });
  }
}

const server = USE_TLS
  ? https.createServer({ cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY) }, handler)
  : http.createServer(handler);

server.listen(PORT, HOST, () => {
  console.log("拾源本地代理已启动");
  console.log(`  监听      ${SCHEME}://${HOST}:${PORT}`);
  console.log(`  白名单    ${ALLOW}`);
  console.log(`  填到拾源  设置 → 抓取代理 → ${SCHEME}://<本机IP>:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === "IPv4" && !a.internal) console.log(`  局域网    ${SCHEME}://${a.address}:${PORT}`);
    }
  }
});
