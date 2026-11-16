# 拾源 · 用户脚本

在**任意网页上**点选元素，生成 Legado 书源 / 订阅源规则。

## 为什么用用户脚本，而不是抓取代理

GitHub Pages 是静态托管，页面里 `fetch` 目标站会被 **CORS** 拦截，必须额外部署代理。
用户脚本运行在**目标站自己的源**里，DOM 直接可读 —— **没有 CORS 问题，不需要任何服务器**。

| | Pages + 代理 | 用户脚本 |
|---|---|---|
| 需要服务器 | 要（Worker/VPS） | 不要 |
| CORS | 代理解决 | 天然没有 |
| 装东西 | 无 | 装一个浏览器扩展 |
| 抓取范围 | 任意站点 | 任意站点（更直接） |

## 安装

1. 装 **Tampermonkey** 或 **Violentmonkey**（Chrome / Edge / Firefox 都有）
2. 新建脚本，粘贴 `shiyuan.user.js` 全文，保存
3. 打开任意网页，右下角出现橙色「拾」按钮

## 用法

1. 点「拾」展开面板
2. 选「订阅源」或「书源」
3. 点「拾取列表」→ 在页面上点**一个条目**（不是它的子元素）
   → 自动找到列表容器和所有同构兄弟，生成 `@css:` 规则
4. 点「拾取标题」→ 点标题文字 → 生成**相对容器作用域**规则
5. 依次拾取链接 / 时间 / 封面 / 描述
6. 「复制 JSON」→ 直接导入 Legado

## 规则示例

以 tumanly.com/wenzhang 为例，拾取结果：

```json
{
  "ruleArticles": "@css:div.post.grid",
  "ruleTitle":    "tag.div.con@tag.h3@text",
  "ruleLink":     "tag.div.con@tag.h3@tag.a@href",
  "rulePubDate":  "tag.div.con@tag.div.grid-meta@tag.span.time@text",
  "ruleImage":    "tag.div.img@tag.a@tag.img.thumb@src"
}
```

注意条目级规则都是**相对列表容器**的作用域规则 —— 这正是 Legado 的正确用法，
规则短、且站点微调时只需改一处。

## 算法

与拾源 APK 用同一套逻辑：

| 函数 | 作用 |
|---|---|
| `candidates()` | 生成 CSS / XPath / Default / 唯一定位 四类候选并按稳定性排序 |
| `collectionPath()` | 沿祖先链收集「能命中多个」的路径 → 定位列表容器 |
| `uniquePath()` | 逐级向上找到唯一命中的路径 |
| `stableClasses()` | 过滤动态类名（`css-xxx` / `flex` / `md:flex-row` / hash 等） |
| `fingerprint()` | 元素结构指纹 → 找同构兄弟 |
| `relativeRule()` | 生成相对容器作用域的 Default 规则 |
