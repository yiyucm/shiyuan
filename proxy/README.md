# 拾源 · 网页抓取代理

GitHub Pages 是静态托管，浏览器直连目标站会被 **CORS** 拦截。本目录提供一个
Cloudflare Worker 代理，把服务端抓取的结果以 JSON 返回给页面。

## 部署（Cloudflare Workers）

1. 打开 <https://dash.cloudflare.com> → 登录 → **Workers & Pages**
2. **Create** → **Worker** → 起名（如 `shiyuan-proxy`）→ Deploy
3. 进入 Worker → **Edit code** → 把 `worker.js` 全文粘贴进去 → **Deploy**
4. 拿到地址：`https://shiyuan-proxy.<你的子域>.workers.dev`

## 在拾源里启用

打开拾源 → 底部 **设置** → **抓取代理** → 填入地址 → 点 **测试** →
显示「代理可用」后点 **保存**。

之后在首页输入网址点「书源 / 订阅源」，就会走代理抓取真实页面。

## 接口契约

```
GET /__ping
  → { ok: true, service: "shiyuan-proxy", time: <ms> }

GET /__net?url=<目标URL>[&method=POST&body=<请求体>]
  → { ok: true, html, url, status, charset, bytes, mode }
  → { ok: false, error: "<原因>" }
```

## 安全说明

- 默认 `ALLOW_HOSTS = "*"`，允许抓取任意站点。若要收紧，改成
  `"example.com,foo.cn"` 这样的白名单（支持后缀匹配）。
- Worker 只做 **GET/POST 网页抓取**，不代理 TCP 端口、不访问内网地址。
- 超时 20 秒，单页上限 6MB。
- Cloudflare Workers 有每日请求额度，免费版够日常使用。

## 本地调试

```bash
node local-proxy.mjs        # 起在 :8799，行为与 Worker 一致
# 然后在拾源「设置 → 抓取代理」填 http://127.0.0.1:8799
```
