// ==UserScript==
// @name         拾源 · 网页规则拾取器
// @namespace    https://github.com/yiyucm/shiyuan
// @version      1.0.0
// @description  在任意网页上点选元素，生成 Legado 书源 / 订阅源规则，一键复制或导出。
// @author       yiyucm
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * 为什么需要用户脚本？
 *   GitHub Pages 是静态托管，页面里 fetch 目标站会被 CORS 拦截。
 *   用户脚本运行在「目标站自己的源」里，DOM 直接可读，没有 CORS 问题，
 *   也就完全不需要任何服务端代理。
 *
 * 用法：
 *   1. 装好 Tampermonkey / Violentmonkey
 *   2. 打开任意网页，右上角出现「拾源」按钮
 *   3. 点「拾取列表」→ 在页面上点一个条目 → 自动生成列表规则
 *   4. 再点「拾取标题」「拾取链接」等，逐个填字段
 *   5. 「导出 JSON」得到可直接导入 Legado 的规则
 */

(function () {
  "use strict";

  if (window.__SHIYUAN__) return;
  window.__SHIYUAN__ = true;

  /* ============================================================
     一、选择器生成算法（与拾源 APK 同一套逻辑）
     ============================================================ */

  const DYNAMIC = /(?:^|[-_])(css|scss|js|jsx|emotion|styled|tw|md|lg|xl|2xl|hover|focus|active|disabled|selected|open|show|hide)(?:[-_]|$)|^(?:sm|md|lg|xl|2xl)$|^[a-z]{1,3}[0-9a-f]{4,}$|^[0-9a-f]{6,}$|^sc-[a-zA-Z0-9]{4,}$|^css-[a-zA-Z0-9]{4,}$|^jsx-\d+$|^v-[a-z0-9]{4,}$|^\d+$/i;
  const HASHY = /(?:^|[-_])[a-z]{0,3}[0-9a-f]{5,}(?:$|[-_])|^[a-z]+-[0-9a-f]{6,}$/i;
  const RP_CLASSES = ["rp-hv", "rp-picked", "rp-hit", "rp-ins-hl", "rp-shy", "rp-panel"];

  const qsa = (root, sel) => {
    try { return Array.from(root.querySelectorAll(sel)); } catch { return []; }
  };
  const isDynamic = (s) => DYNAMIC.test(String(s)) || HASHY.test(String(s));

  function stableClasses(el) {
    const out = [];
    const raw = typeof el?.className === "string" ? el.className : el?.getAttribute?.("class") || "";
    for (const c of String(raw).split(/\s+/)) {
      if (!c || !/^[a-zA-Z][\w-]*$/.test(c)) continue;
      if (isDynamic(c) || RP_CLASSES.includes(c)) continue;
      out.push(c);
    }
    return out;
  }

  function seg(el) {
    if (!el || el.nodeType !== 1) return "";
    const tag = el.tagName.toLowerCase();
    const id = (el.id || "").trim();
    if (id && /^[a-zA-Z][\w-]*$/.test(id) && !isDynamic(id) && !/^\d+$/.test(id)) return `${tag}#${id}`;
    const cls = stableClasses(el);
    if (cls.length) return `${tag}.${cls.slice(0, 2).join(".")}`;
    return tag;
  }

  function collectionPath(root, el, stop) {
    const out = [];
    let cur = el;
    const parts = [];
    while (cur && cur.nodeType === 1 && cur !== stop && cur !== root) {
      parts.unshift(seg(cur));
      const sel = parts.join(" > ");
      out.push({ el: cur, sel, n: qsa(root, sel).length });
      cur = cur.parentElement;
    }
    return out.reverse();
  }

  function uniquePath(root, el, stop) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== stop && cur !== root) {
      const parent = cur.parentElement;
      let s = cur.tagName.toLowerCase();
      if (parent) {
        const same = Array.from(parent.children).filter((n) => n.tagName === cur.tagName);
        if (same.length > 1) s += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(s);
      const sel = parts.join(" > ");
      if (qsa(root, sel).length === 1) return sel;
      cur = parent;
    }
    return parts.join(" > ");
  }

  function xpathOf(el, stop) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== stop) {
      const parent = cur.parentElement;
      const same = parent ? Array.from(parent.children).filter((n) => n.tagName === cur.tagName) : [cur];
      let s = cur.tagName.toLowerCase();
      if (same.length > 1) s += `[${same.indexOf(cur) + 1}]`;
      parts.unshift(s);
      cur = parent;
    }
    return "//" + parts.join("/");
  }

  function defaultRule(el) {
    if (!el || el.nodeType !== 1) return "";
    const cls = stableClasses(el);
    let s = cls.length ? `class.${cls[0]}.0` : `tag.${el.tagName.toLowerCase()}.0`;
    if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) s = `id.${el.id}.0`;
    return s + "@text";
  }

  function fingerprint(el) {
    if (!el || el.nodeType !== 1) return "";
    const kids = Array.from(el.children || []).slice(0, 6).map((k) => k.tagName.toLowerCase()).join(",");
    const cls = stableClasses(el).slice(0, 3).sort().join(".");
    const flags = ["img", "a", "h1", "h2", "h3", "time"].filter((t) => el.querySelector && el.querySelector(t)).join("");
    return `${el.tagName.toLowerCase()}|${kids}|${cls}|${flags}`;
  }

  function candidates(root, el, stop) {
    const paths = collectionPath(root, el, stop);
    const multi = paths.filter((p) => p.n >= 2);
    const best = multi.length ? multi[multi.length - 1] : paths[paths.length - 1] || { sel: seg(el), n: 1 };
    const uniq = uniquePath(root, el, stop);
    const scoreOf = (sel) => {
      let s = 0;
      if (/#[\w-]+/.test(sel)) s += 100;
      if (/\.[\w-]+/.test(sel)) s += 30;
      s -= (sel.split(">").length || 1) * 3;
      if (isDynamic(sel)) s -= 40;
      return s;
    };
    return [
      { kind: "CSS", rule: "@css:" + best.sel, n: best.n, score: scoreOf(best.sel), sel: best.sel },
      { kind: "XPath", rule: xpathOf(el, stop), n: 1, score: 20, sel: "" },
      { kind: "Default", rule: defaultRule(el), n: 1, score: 10, sel: "" },
      { kind: "唯一定位", rule: "@css:" + uniq, n: qsa(root, uniq).length, score: 5, sel: uniq }
    ].sort((a, b) => b.score - a.score);
  }

  /** 找出「条目容器」：自身或祖先中，有同构兄弟的那个 */
  function findItemRoot(root, el) {
    const chain = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== root) {
      chain.push(cur);
      cur = cur.parentElement;
    }
    for (const node of chain) {
      const parent = node.parentElement;
      if (!parent || !parent.children) continue;
      const fp = fingerprint(node);
      if (!fp || !node.children || node.children.length === 0) continue;
      const sibs = Array.from(parent.children).filter((n) => n !== node && fingerprint(n) === fp);
      if (sibs.length >= 1) return node;
    }
    return null;
  }

  /** 相对容器作用域的规则（如 tag.h3@text），按字段类型给对内容获取器 */
  function getterFor(kind) {
    if (kind === "link") return "@href";
    if (kind === "image") return "@src";
    if (kind === "list") return "";
    return "@text";
  }

  function relativeRule(container, el, kind) {
    if (!container || !el) return "";
    const parts = [];
    let cur = el;
    while (cur && cur !== container && cur.nodeType === 1) {
      const tag = cur.tagName.toLowerCase();
      const cls = stableClasses(cur);
      const sameTag = cur.parentElement
        ? Array.from(cur.parentElement.children).filter((n) => n.tagName === cur.tagName)
        : [];
      if (cls.length) parts.unshift(`tag.${tag}.${cls[0]}`);
      else if (sameTag.length > 1) parts.unshift(`tag.${tag}.${sameTag.indexOf(cur)}`);
      else parts.unshift(`tag.${tag}`);
      cur = cur.parentElement;
    }
    if (!parts.length) return "";
    return parts.join("@") + getterFor(kind);
  }

  /** 取元素上的链接/图片地址（优先 href，其次 data-*） */
  function attrOf(el, kind) {
    if (!el) return "";
    if (kind === "link") {
      const a = el.tagName === "A" ? el : el.querySelector?.("a[href]");
      return a ? (a.getAttribute("href") || "") : "";
    }
    if (kind === "image") {
      const img = el.tagName === "IMG" ? el : el.querySelector?.("img");
      if (!img) return "";
      return img.getAttribute("data-src") || img.getAttribute("data-original")
        || img.getAttribute("src") || "";
    }
    return "";
  }

  /* ============================================================
     二、状态
     ============================================================ */

  const KEY = "shiyuan.rules";
  const FIELDS = [
    { key: "ruleArticles", label: "列表规则", kind: "list" },
    { key: "ruleTitle", label: "标题规则", kind: "title" },
    { key: "ruleLink", label: "链接规则", kind: "link" },
    { key: "rulePubDate", label: "时间规则", kind: "date" },
    { key: "ruleDescription", label: "描述规则", kind: "desc" },
    { key: "ruleImage", label: "封面规则", kind: "image" },
    { key: "ruleContent", label: "正文规则", kind: "content" }
  ];

  const S = {
    mode: "rss",
    rules: {},
    container: null,
    pending: null,
    candidates: [],
    picked: []
  };

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
      S.rules = raw.rules || {};
      S.mode = raw.mode || "rss";
      S.picked = raw.picked || [];
    } catch (e) { }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ rules: S.rules, mode: S.mode, picked: S.picked }));
    } catch (e) { }
  }
  function ruleVal(key) {
    return (S.rules[S.mode] && S.rules[S.mode][key]) || "";
  }
  function setRuleVal(key, v) {
    if (!S.rules[S.mode]) S.rules[S.mode] = {};
    S.rules[S.mode][key] = v;
    save();
  }

  /* ============================================================
     三、界面
     ============================================================ */

  const CSS = `
  .rp-shy{position:fixed;right:10px;bottom:74px;z-index:2147483000;
    font:13px/1.5 -apple-system,"PingFang SC","Noto Sans CJK SC",system-ui,sans-serif;color:#e8e8e8}
  .rp-shy .rp-fab{width:46px;height:46px;border-radius:50%;background:#ff8a3d;color:#2a1405;
    border:none;font-size:20px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.45);
    display:grid;place-items:center}
  .rp-shy .rp-fab:active{transform:scale(.94)}
  .rp-shy .rp-panel{position:absolute;right:0;bottom:56px;width:min(330px,calc(100vw - 20px));
    background:#1b1b1b;border:1px solid #3a3a3a;border-radius:12px;padding:12px;
    box-shadow:0 8px 28px rgba(0,0,0,.6);display:none;max-height:74vh;overflow:auto}
  .rp-shy.is-open .rp-panel{display:block}
  .rp-shy h4{margin:0 0 8px;font-size:13px;color:#ff8a3d;display:flex;justify-content:space-between;align-items:center}
  .rp-shy .rp-row{display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid #262626}
  .rp-shy .rp-row:last-child{border-bottom:none}
  .rp-shy .rp-lb{flex:1;font-size:12px;color:#9a9a9a}
  .rp-shy .rp-val{flex:1.6;font:11px/1.4 ui-monospace,Menlo,monospace;color:#7ee787;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rp-shy .rp-btn{padding:4px 9px;border-radius:6px;background:#2f3b42;border:1px solid #546e7a;
    color:#eceff1;font-size:11.5px;cursor:pointer;white-space:nowrap}
  .rp-shy .rp-btn.pri{background:#ff8a3d;border-color:#ff8a3d;color:#2a1405;font-weight:600}
  .rp-shy .rp-btn:active{opacity:.8}
  .rp-shy .rp-tip{margin-top:8px;padding:7px 9px;border-radius:7px;background:rgba(255,183,77,.12);
    border-left:3px solid #ffb74d;color:#ffd08a;font-size:11px;line-height:1.55}
  .rp-shy .rp-tip.info{background:rgba(79,195,247,.12);border-left-color:#4fc3f7;color:#a8dcff}
  .rp-shy .rp-acts{display:flex;gap:6px;margin-top:10px}
  .rp-shy .rp-acts .rp-btn{flex:1;text-align:center;padding:8px 0}
  .rp-shy .rp-mode{display:flex;gap:6px;margin-bottom:8px}
  .rp-shy .rp-mode .rp-btn{flex:1;text-align:center}
  .rp-shy .rp-mode .rp-btn.on{background:#ff8a3d;border-color:#ff8a3d;color:#2a1405;font-weight:600}
  .rp-shy .rp-cands{margin-top:6px;max-height:170px;overflow:auto}
  .rp-shy .rp-cand{padding:6px 8px;border-radius:7px;background:#202020;border:1px solid #333;
    margin-bottom:5px;cursor:pointer}
  .rp-shy .rp-cand.on{border-color:#4fc3f7;background:rgba(79,195,247,.08)}
  .rp-shy .rp-cand .s{font:11px/1.4 ui-monospace,Menlo,monospace;color:#7ee787;word-break:break-all}
  .rp-shy .rp-cand .n{font-size:10.5px;color:#9a9a9a;margin-top:2px}
  .rp-shy .rp-cand .n b{color:#66bb6a}
  .rp-shy .rp-cand .n b.z{color:#ef5350}
  .rp-shy pre{background:#111;border:1px solid #333;border-radius:7px;padding:8px;
    font:10.5px/1.5 ui-monospace,Menlo,monospace;color:#c9d5e0;max-height:190px;overflow:auto;
    white-space:pre-wrap;word-break:break-all;margin:6px 0 0}
  .rp-hv{outline:2px solid #ff5252 !important;outline-offset:1px;background:rgba(255,82,82,.10) !important;cursor:crosshair !important}
  .rp-picked{outline:3px solid #4fc3f7 !important;background:rgba(79,195,247,.14) !important}
  `;

  const style = document.createElement("style");
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  let root, fab, panel;

  function buildUI() {
    root = el("div", "rp-shy");
    fab = el("button", "rp-fab", "拾");
    fab.title = "拾源 · 规则拾取器";
    panel = el("div", "rp-panel");
    root.appendChild(panel);
    root.appendChild(fab);
    document.body.appendChild(root);

    fab.addEventListener("click", (e) => {
      e.stopPropagation();
      root.classList.toggle("is-open");
      if (root.classList.contains("is-open")) render();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && S.pending) { stopPick(); }
    });
  }

  function render() {
    const modeBtns = ["rss", "book"].map(m =>
      `<button class="rp-btn ${S.mode === m ? "on" : ""}" data-mode="${m}">${m === "rss" ? "订阅源" : "书源"}</button>`
    ).join("");

    const rows = FIELDS.map(f => {
      const v = ruleVal(f.key);
      return `<div class="rp-row">
        <span class="rp-lb">${f.label}</span>
        <span class="rp-val" title="${escapeHtml(v)}">${v ? escapeHtml(v) : "—"}</span>
        <button class="rp-btn" data-pick="${f.key}">${S.pending === f.key ? "点选…" : "拾取"}</button>
      </div>`;
    }).join("");

    const cands = S.candidates.length ? `
      <div class="rp-cands">${S.candidates.map((c, i) => `
        <div class="rp-cand ${i === (S.candIdx || 0) ? "on" : ""}" data-cand="${i}">
          <div class="s">${escapeHtml(c.rule)}</div>
          <div class="n">${c.kind} · 命中 <b class="${c.n ? "" : "z"}">${c.n}</b> · ${escapeHtml(c.note || "")}</div>
        </div>`).join("")}</div>` : "";

    panel.innerHTML = `
      <h4><span>拾源 · 规则拾取</span><button class="rp-btn" id="rpClose">收起</button></h4>
      <div class="rp-mode">${modeBtns}</div>
      ${rows}
      ${S.pending ? `<div class="rp-tip">正在拾取「${fieldLabel(S.pending)}」——请在页面上点击目标元素。<br>按 Esc 取消。</div>` : ""}
      ${cands}
      <div class="rp-acts">
        <button class="rp-btn" id="rpJson">预览 JSON</button>
        <button class="rp-btn pri" id="rpExport">复制 JSON</button>
      </div>
      <div class="rp-tip info" style="margin-top:8px">
        条目级规则（标题/链接/时间/封面）是<b>相对「列表容器」</b>的作用域规则，
        导入 Legado 时要配合列表规则一起生效。
      </div>
      <pre id="rpOut" style="display:none"></pre>
    `;

    panel.querySelector("#rpClose").onclick = (e) => { e.stopPropagation(); root.classList.remove("is-open"); };
    panel.querySelectorAll("[data-mode]").forEach(b => b.onclick = (e) => {
      e.stopPropagation(); S.mode = b.dataset.mode; save(); render();
    });
    panel.querySelectorAll("[data-pick]").forEach(b => b.onclick = (e) => {
      e.stopPropagation(); startPick(b.dataset.pick);
    });
    panel.querySelectorAll("[data-cand]").forEach(c => c.onclick = (e) => {
      e.stopPropagation();
      S.candIdx = +c.dataset.cand;
      applyCandidate();
      render();
    });
    panel.querySelector("#rpJson").onclick = (e) => { e.stopPropagation(); showJson(); };
    panel.querySelector("#rpExport").onclick = (e) => { e.stopPropagation(); copyJson(); };
  }

  function fieldLabel(key) {
    const f = FIELDS.find(x => x.key === key);
    return f ? f.label : key;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ============================================================
     四、拾取交互
     ============================================================ */

  function startPick(key) {
    S.pending = key;
    S.candidates = [];
    S.candIdx = 0;
    root.classList.add("is-open");
    render();
    document.addEventListener("mouseover", onHover, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  }

  function stopPick() {
    S.pending = null;
    S.candidates = [];
    document.removeEventListener("mouseover", onHover, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    document.querySelectorAll(".rp-hv,.rp-picked").forEach(n => n.classList.remove("rp-hv", "rp-picked"));
    render();
  }

  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); stopPick(); }
  }

  function onHover(e) {
    if (!S.pending) return;
    const t = e.target;
    if (!t || t.nodeType !== 1) return;
    if (t.closest && t.closest(".rp-shy")) return;
    document.querySelectorAll(".rp-hv").forEach(n => n.classList.remove("rp-hv"));
    t.classList.add("rp-hv");
  }

  function onClick(e) {
    if (!S.pending) return;
    const t = e.target;
    if (!t || t.nodeType !== 1) return;
    if (t.closest && t.closest(".rp-shy")) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    document.querySelectorAll(".rp-hv,.rp-picked").forEach(n => n.classList.remove("rp-hv", "rp-picked"));
    t.classList.add("rp-picked");

    const field = FIELDS.find(f => f.key === S.pending);
    const root0 = document.body;

    if (field && field.kind === "list") {
      // 列表：找条目容器 + 同构兄弟
      const item = findItemRoot(root0, t) || t;
      S.container = item;
      const cands = candidates(root0, item, null).filter(c => c.n >= 2 || c.rule.includes("nth-of-type"));
      S.candidates = cands.length ? cands : candidates(root0, item, null);
      S.candIdx = 0;
      applyCandidate();
    } else {
      // 其他字段：相对容器作用域
      const cands = [];
      const kind = field ? field.kind : "text";
      const container = S.container || findItemRoot(root0, t);

      // 链接/封面：把目标换成真正带地址的元素（a / img）
      let target = t;
      if (kind === "link") {
        const a = t.tagName === "A" ? t : t.querySelector?.("a[href]");
        if (a) target = a;
      } else if (kind === "image") {
        const img = t.tagName === "IMG" ? t : t.querySelector?.("img");
        if (img) target = img;
      }

      if (container && container !== target) {
        const rel = relativeRule(container, target, kind);
        if (rel) {
          cands.push({ kind: "Default", rule: rel, n: 1, note: "相对列表容器作用域（推荐）" });
        }
      }
      // 绝对候选
      for (const c of candidates(root0, target, container)) {
        cands.push({ ...c, note: c.note || (container ? "绝对路径" : "") });
      }
      // 兜底：用属性直取
      const attr = attrOf(target, kind);
      if (attr) {
        const c2 = candidates(root0, target, container)[0];
        if (c2) {
          const sel = c2.sel || "";
          if (sel) {
            cands.push({
              kind: kind === "link" ? "Default@href" : kind === "image" ? "Default@src" : "Default",
              rule: (sel.startsWith("@css:") ? sel : "@css:" + sel) + (kind === "link" ? "@href" : kind === "image" ? "@src" : "@text"),
              n: qsa(root0, sel).length, note: "按属性取值"
            });
          }
        }
      }
      S.candidates = cands.length ? cands : candidates(root0, target, null);
      S.candIdx = 0;
      applyCandidate();
    }
    stopPick();
    render();
  }

  function applyCandidate() {
    const c = S.candidates[S.candIdx];
    if (!c || !S.pending) return;
    setRuleVal(S.pending, c.rule);
    // 列表被拾取时，清掉依赖它的条目级规则
    if (S.pending === "ruleArticles") {
      for (const k of ["ruleTitle", "ruleLink", "rulePubDate", "ruleDescription", "ruleImage"]) {
        if (S.rules[S.mode]) delete S.rules[S.mode][k];
      }
    }
  }

  /* ============================================================
     五、导出
     ============================================================ */

  function buildJson() {
    const r = S.rules[S.mode] || {};
    const base = location.origin + "/";
    if (S.mode === "rss") {
      return {
        sourceName: document.title ? document.title.split(/[-|｜]/)[0].trim() : base,
        sourceUrl: base,
        sourceGroup: "",
        sourceComment: "",
        sortUrl: "",
        enabled: true,
        enabledCookieJar: false,
        enableJs: false,
        loadWithBaseUrl: true,
        articleStyle: 0,
        style: "",
        ruleArticles: r.ruleArticles || "",
        ruleTitle: r.ruleTitle || "",
        ruleLink: r.ruleLink || "",
        ruleDescription: r.ruleDescription || "",
        rulePubDate: r.rulePubDate || "",
        ruleImage: r.ruleImage || "",
        ruleContent: r.ruleContent || ""
      };
    }
    return {
      bookSourceName: document.title ? document.title.split(/[-|｜]/)[0].trim() : base,
      bookSourceUrl: base,
      bookSourceGroup: "",
      bookSourceComment: "",
      enabled: true,
      enabledCookieJar: false,
      enabledExplore: false,
      searchUrl: `https://www.google.com/search?q={{key}}`,
      ruleSearch: {
        bookList: r.ruleArticles || "",
        name: r.ruleTitle || "",
        author: r.ruleAuthor || "",
        kind: "",
        wordCount: "",
        lastChapter: r.rulePubDate || "",
        intro: r.ruleDescription || "",
        coverUrl: r.ruleImage || "",
        bookUrl: r.ruleLink || ""
      },
      ruleBookInfo: {},
      ruleToc: {},
      ruleContent: { content: r.ruleContent || "" }
    };
  }

  function showJson() {
    const json = JSON.stringify([buildJson()], null, 2);
    const pre = panel.querySelector("#rpOut");
    if (pre) {
      pre.style.display = "block";
      pre.textContent = json;
    }
    return json;
  }

  async function copyJson() {
    const json = JSON.stringify([buildJson()], null, 2);
    try {
      await navigator.clipboard.writeText(json);
      toast("规则 JSON 已复制，可直接导入 Legado");
    } catch (e) {
      showJson();
      toast("复制失败，已显示 JSON，请手动复制");
    }
  }

  let toastTimer = null;
  function toast(msg) {
    let t = document.getElementById("rp-toast");
    if (!t) {
      t = el("div", "");
      t.id = "rp-toast";
      t.style.cssText = "position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:2147483100;"
        + "background:#323232;color:#fff;padding:9px 15px;border-radius:18px;font-size:12px;"
        + "box-shadow:0 4px 16px rgba(0,0,0,.5);max-width:84vw;text-align:center";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.opacity = "0"; }, 2200);
  }

  /* ============================================================
     六、启动
     ============================================================ */

  load();
  const boot = () => {
    buildUI();
    // 页面上已有的规则（同一站点）可复用
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
      if (saved.origin && saved.origin !== location.origin) {
        // 换站了，清空条目级规则
        for (const m of ["rss", "book"]) {
          if (S.rules[m]) {
            for (const k of ["ruleTitle", "ruleLink", "rulePubDate", "ruleDescription", "ruleImage"]) {
              delete S.rules[m][k];
            }
          }
        }
        save();
      }
      S.rules.__origin = undefined;
      const o = JSON.parse(localStorage.getItem(KEY) || "{}");
      o.origin = location.origin;
      localStorage.setItem(KEY, JSON.stringify(o));
    } catch (e) { }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
