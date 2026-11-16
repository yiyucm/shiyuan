# 拾源 · 抓取代理部署指南

GitHub Pages 是**静态托管**，没有后端。浏览器直接 `fetch` 目标网站会被 **CORS** 拦截，
所以要抓取任意网站，必须有一个**公网 HTTPS 代理**帮你转发。

```
拾源页面 (HTTPS, github.io)
        │  fetch https://你的代理/__net?url=...
        ▼
   你的代理 (公网 HTTPS)  ──►  目标网站
        │  返回 { html, url, status, charset }
        ▼
   拾源页面清洗 → 渲染 → 点选拾取
```

---

## 方案 A：Cloudflare Worker（推荐）

免费、部署快、自动 HTTPS。

### 部署

1. 打开 <https://dash.cloudflare.com> → 注册/登录
2. 左侧 **Workers & Pages** → **Create** → **Start with Hello World!** → **Deploy**
   （会给你一个形如 `https://xxx.workers.dev` 的地址）
3. 进入该 Worker → 右侧 **Edit code** → 把本目录 `worker.js` 的**全部内容**替换进去 → **Deploy**
4. 复制 Worker 地址

### 在拾源里启用

1. 打开拾源 → 底部 **设置**
2. **抓取代理** → 填入 `https://xxx.workers.dev` → 点 **测试**
3. 显示「代理可用」→ 点 **保存**
4. 回首页输入网址，点「书源 / 订阅源」即可抓取真实网页

### 限制

- Cloudflare Workers 免费额度：每天 10 万次请求，足够日常使用
- 国内网络访问 `workers.dev` 有时不稳定，若不通改用方案 B

---

## 方案 B：自己的服务器 / VPS

任何有公网 IP、能跑 Node 或反向代理的机器都行。

### 用本仓库的脚本

```bash
node proxy/server.js --host 0.0.0.0 --port 8787
```

然后用 Nginx / Caddy 反代到你的域名并配好 HTTPS：

```nginx
server {
    server_name proxy.example.com;
    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header Origin $http_origin;
        proxy_read_timeout 30s;
    }
}
```

在拾源里填 `https://proxy.example.com`。

### 白名单（可选）

```bash
node proxy/server.js --allow example.com,foo.cn
```

只允许抓这些域名，更安全。

---

## 方案 C：本机 / 局域网（仅限 HTTP 访问页面时）

如果你把拾源部署在**自己的 HTTP 服务**上（不是 GitHub Pages），可以用本机代理：

```bash
node proxy/server.js --port 8787
```

拾源里填 `http://127.0.0.1:8787`（同一台电脑）或 `http://192.168.x.x:8787`（同局域网设备）。

> ⚠️ 浏览器有「私有网络访问」保护（PNA）：
> **HTTPS 页面不能请求 `127.0.0.1` / 局域网地址**。
> 所以这个方案只在「页面本身是 HTTP」时可用，例如本地 `python3 -m http.server` 打开的拾源。

---

## 接口契约

页面和代理之间只约定两个端点：

```
GET /__ping
  → { ok: true, service: "shiyuan-proxy", time: <ms> }

GET /__net?url=<目标URL>[&method=POST&body=<请求体>]
  → { ok: true, html, url, status, charset, bytes, mode }
  → { ok: false, error: "<失败原因>" }
```

`worker.js` 与 `server.js` 实现完全一致，可任选其一。

---

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 「代理不可用：Failed to fetch」 | 代理地址填了本机/局域网，而页面是 HTTPS | 换公网 HTTPS 代理 |
| 「代理不可用」但地址是 https | 证书无效或 Worker 未部署 | 检查地址是否可 `curl` 通 |
| 抓到页面但图片不显示 | 站点图片有防盗链 | 换「直出」模式看图，或用代理的 Referer |
| 抓取超时 | 目标站慢 | 代理超时 20s，可在 `worker.js` / `server.js` 调 `TIMEOUT_MS` |
| 提示「该域名不在白名单」 | 用了 `--allow` | 把域名加进白名单 |
| 页面显示「离线模式 · Pages」 | 没配代理 | 去设置填代理地址并保存 |

---

## 没配代理时会怎样

拾源**不会白屏**，只是能力受限：

| 能力 | 状态 |
|---|---|
| 首页、书源/订阅源编辑、字段页、正文页套件 | ✅ 正常 |
| 规则生成与校验（`/api/validate`） | ✅ 正常（内置离线实现） |
| 工程存储（`/api/projects`） | ✅ 正常（localStorage） |
| 导入/导出 JSON | ✅ 正常 |
| 内置离线示例（tags / list / post） | ✅ 正常，可完整体验拾取流程 |
| 抓取任意网站 | ❌ 需代理 |
| 「直出」模式浏览真实网页 | ✅ 正常（能看，不能拾取） |
