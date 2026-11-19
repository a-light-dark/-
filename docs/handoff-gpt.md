# 校园圈 · 交给 GPT 的改进任务单（含验收标准）

> 使用者：另一个 AI（代码执行方）。验收者：本仓库维护者（我来验，按第 1 节逐条跑）。
> 目标：把这 5 件事做完、做对、不引入新问题。**一次只做一件事，每件单独 commit。**

---

## 0. 环境与硬约束（先读，不然会白干）

- 项目根目录：`E:\steam\应用\软件\campus-forum`（Windows / PowerShell）。
- 代码结构：`miniprogram/`（小程序前端）、`cloudfunctions/`（25 个云函数，Node.js CommonJS）、`admin/web/`（Vue 3 + Vite + Element Plus 后台）、`tools/`（check.js 自检、smoke.js 冒烟）、`docs/`。
- 云开发环境：`cloud1-d6g26wz61eca836b8`；`tcb` CLI 已登录（默认环境已设），部署函数用 `tcb fn deploy <name> --force`，调用用 `tcb fn invoke <name> -d @file.json --json`。
- **PowerShell 传 JSON 会被吞引号**：任何 `--params` 都先把 payload 写成 UTF-8 无 BOM 的临时 `.json`（用 node 的 `fs.writeFileSync` 写），再 `cmd.exe /c tcb fn invoke ... -d @file.json`。
- 微信开发者工具 CLI：`E:\steam\NFS\微信web开发者工具\cli.bat`（部署云函数、`auto --auto-port 9420` 起自动化）。
- 前端（`admin/web`）构建：PowerShell 里必须先 `$env:TEMP='<项目>\.tmp'; $env:TMP=$env:TEMP`，否则 esbuild 在系统 `%TEMP%` 报 Access denied。
- 数据库：NoSQL 25+ 集合；**时间字段必须是 `Date`**（字符串会让范围查询直接失效，历史上踩过坑，见 `docs/database.md`）。
- 不许做的事：
  - 不许改数据库安全规则、不许改 `admin_sessions`/`admin_accounts` 的角色逻辑；
  - 不许删线上数据、不许跑 `setupCollections` 的 seed/cleanup 往库里塞垃圾；
  - 不许为了"顺手"大改 UI 文案、重命名现有 action/字段、升级大版本依赖；
  - 不许把 `new Date().toISOString()` 存进库（时间统一 `db.serverDate()` / `new Date()`）。
- 每次改完至少自证：`node --check` 改动的 js + `node tools/check.js` 全过。

---

## 1. 验收流程（我按这个逐条跑，你要提前自测过）

1. `git log --oneline -5` / `git show --stat` —— 确认只改了允许的文件，commit 分开。
2. `node tools/check.js` —— 必须「全部通过 ✅」。
3. `node --test tests/` —— 任务 5 建起来后必须全绿。
4. `node tools/smoke.js` —— 必须 **7/7**（登录、工作台、安全告警、siteData、search、board、postDetail 聚合）。
5. 我写针对性探针复验（小程序 automator 或 CLI 调函数），具体见每个任务的「验收标准」。
6. 抽查代码：不许留下 `console.log` 调试残留、不许 `as any`/`@ts-ignore` 式绕法、异常必须被 catch 住并给用户可读文案。

---

## 任务 1（P0，真 bug）：时区显式化——「今天 / 最近 N 天」统计现在按 UTC 算

**背景**：`cloudfunctions/adminApi/index.js:1373` 的 `dayStart(d)` 用 `x.setHours(0,0,0,0)`，取的是**运行时本地时区**。云函数默认跑在 UTC，于是「今天」实际从北京时间 08:00 才开始算：早上 8 点前的发帖不计入今日，0–8 点的数据被算进"昨天"。同理 `analyticsOverview` 的 7/14/30 天分桶（`series`）也按 UTC 切日。

**改哪里**：
- 新增纯函数模块 `cloudfunctions/adminApi/lib/time.js`，导出：
  - `SHANGHAI_OFFSET = 8 * 3600 * 1000`
  - `dayStartCN(ts)`：返回北京时间当天 00:00 的毫秒时间戳（用 `ts - ((ts + 8h) % 86400000)` 这类算法，别依赖运行时时区）
  - `dayKeyCN(ts)`：返回 `'YYYY-MM-DD'`（北京时间）
  - `seriesDays(endTs, days)`：返回 `[{ key, from, to }]`，从 `days` 天前到当天，按北京时间切段
- `cloudfunctions/adminApi/index.js`：`require('./lib/time')`，把 `dayStart`/`series` 的日期切分替换成上面的函数；`dashboard` 的 `todayPosts/todayComments`、`analyticsOverview` 的 `today`/`series` 都用新函数。**不要改返回值字段名**。
- 前端如果显示日期（`analytics` 图例/柱状图 x 轴），确认它拿到的就是 `key` 字符串，不需要另算。

**验收标准**：
- `node --test tests/time.test.js` 全绿，且测试必须覆盖：北京时间 00:30、07:59、08:00、23:59 四个点落到的 `dayKeyCN` 都是同一天；UTC 时间和北京时间的差为 +8h。
- `tcb fn invoke adminApi --params '{"action":"analytics.overview","days":7}'` 返回的 `series` 最后一天 `key` 等于北京时间的今天。
- 造一条帖子（发帖时间=现在），`dashboard` 的 `todayPosts` 立刻 +1；等 0 点后不能凭空变化（这条我只做逻辑核对，不真等）。
- 回归：`tools/smoke.js` 7/7。

---

## 任务 2（P1，安全）：给写操作加频率限制（防刷）

**背景**：现在同一个用户可以无限连发帖子/评论/求单/举报/反馈，没有节流，刷屏或脚本灌水只能靠事后删。`adminLogin` 已有「单账号 10 分钟 5 次 + 全环境 1 分钟 30 次」的限流，可以照它的思路做内容侧的限流。

**改哪里**：
- 新增云端公共模块（复制到需要的函数目录内，云函数不能跨目录 require）：`cloudfunctions/createPost/lib/limit.js`，导出 `checkRate(col, key, limit, windowMs)`；实现用固定窗口计数：
  - 文档 `_id = key`（如 `post_<openid>`），字段 `{ count, windowStart }`；
  - 读不到 → `add({_id, count: 1, windowStart: now})`，放行；
  - `now - windowStart >= windowMs` → 重置为 1，放行；
  - 否则 `count + 1`（用 `db.command.inc(1)`），超限返回 `{ ok:false, msg:'太频繁了，N 秒后再试' }`。
  - 并发下允许轻微超发（不是钱相关，别上事务）。
- 用在 5 个写操作入口（都在 `exports.main` 里、参数校验后、真正写库前）：
  | 函数 | key | 限制 |
  |---|---|---|
  | `createPost` | `post_<openid>` | 5 次 / 60 秒 |
  | `addComment` | `comment_<openid>` | 10 次 / 60 秒 |
  | `createOrder` | `order_<openid>` | 3 次 / 60 秒 |
  | `reportPost` | `report_<openid>` | 5 次 / 60 秒 |
  | `feedback` | `feedback_<openid>` | 3 次 / 60 秒 |
- 新建集合 `rate_limits`：加进 `cloudfunctions/setupCollections/index.js` 的 `COLLECTIONS`，并把集合安全规则设为「所有用户不可读写」（和其他内部表一致，别让客户端读）。
- 限流文案统一：「操作太频繁了，先歇 N 秒再试」，N 用剩余秒数向上取整。

**验收标准**：
- 我用 automator 连发 6 条帖子：前 5 条 `ok:true`，第 6 条 `ok:false` 且 `msg` 含「太频繁」；等 61 秒后能再发 1 条。
- 评论/求单/举报各自同样的探针。
- 清理探针造的数据（帖子删到回收站并 purge、评论删掉）。
- `tools/smoke.js` 7/7（注意 smoke 会发东西的话别撞限流——它只读，不受影响）。
- `rate_limits` 集合存在且客户端读不到（`wx.cloud.database().collection('rate_limits').get()` 报权限错误）。

---

## 任务 3（P1，安全）：屏蔽词匹配前做归一化（防绕过）

**背景**：`createPost` / `addComment` / `createOrder` 里的 `checkWords` 是直接把用户文本和 `wordlist/main` 里的词做 `indexOf` 匹配。加空格（「代 发 票」）、全角（「代发票１」）、大小写（英文词）都能绕过。

**改哪里**：
- 新增纯函数模块 `cloudfunctions/createPost/lib/normalize.js`（复制一份到 `addComment`、`createOrder`，保持三处逻辑一致）：
  - `normalizeText(s)`：`String(s||'')` → 全角转半角（`\uFF01-\uFF5E` 减 `0xFEE0`、`\u3000`→空格）→ 去掉所有空白/零宽字符（`\s`、`\u200b-\u200f`、`\uFEFF`）→ 转小写。
  - `matchWord(text, words)`：两侧都归一化后做 `indexOf`，返回命中的原词或 `''`。
- `checkWords` 改成用 `matchWord`；命中后的提示文案和 `wordfilters.hits` 计数逻辑保持不变（计数仍按原词 +1）。
- `cloudfunctions/adminApi/index.js` 的 `wordfilters.add`：存词时同时存 `word`（原样，给后台展示）和 `normalized`（归一化后的词），重复判断用 `normalized`。

**验收标准**：
- 小程序端探针：发帖内容 `代 发 票`、`代发票１`、`ＤＡＩ发票`（如果词库里有）→ 全部被拦，文案「内容里有不合适的词，换一下再发」。
- 正常内容（如「今天食堂排队好久」）能发出去。
- 后台「敏感词库」页仍显示原词，命中次数会 +1。
- `node tools/check.js` 全过。

---

## 任务 4（P1，隐私）：注销账号的级联删除漏了 3 个集合

**背景**：`cloudfunctions/deleteAccount/index.js` 目前清理了 posts / comments / likes / favorites / notices / users / reports，**没清** `follows`、`reviews`、`feedback`。用户点「注销」后，昵称头像和「他关注的tag / 收到的订单评价 / 提的建议」还留在库里，违反隐私政策里写的「注销后删除相关信息」。

**改哪里**：
- `cloudfunctions/deleteAccount/index.js`：在已有的 `removeWhere` 序列里补三条：
  - `removeWhere('follows', { _openid: OPENID })`
  - `removeWhere('reviews', { fromOpenid: OPENID })` 以及 `removeWhere('reviews', { toOpenid: OPENID })`（订单评价双向都清，避免别人的评价列表里还挂着已注销的人）
  - `removeWhere('feedback', { _openid: OPENID })`
- 返回结果里加上这三项的删除条数（沿用现有返回结构，新增字段即可，别改老字段名）。
- 顺序上放在 `removeWhere('users', { _openid: OPENID })` **之前**（用户档案最后删）。
- 补一段注释说明「审计类集合（audit_logs/security_alerts）必须保留，法律与排障需要，明文写清楚」。

**验收标准**：
- 我用一个测试 openid 造数据：关注 1 个 tag、写 1 条订单评价、发 1 条反馈 → 调 `deleteAccount` → 再查这 3 个集合对应记录为 0，且返回体里有这三项计数。
- 造的数据全部清理（评价/反馈/关注），库里无残留。
- `tools/smoke.js` 7/7（注销逻辑不影响它）。

---

## 任务 5（P2，工程）：把纯函数抽出来做单测 + 加 CI

**背景**：现在只有 `tools/check.js`（语法/命名）和 `tools/smoke.js`（7 个线上冒烟项），**没有一个单元测试**。上面任务 1/2/3 都会新增纯函数（时区、限流窗口、归一化），正好一起测。

**改哪里**：
- 新建 `tests/`：`tests/time.test.js`、`tests/normalize.test.js`、`tests/limit.test.js`，用 Node 内置 `node:test` + `node:assert/strict`（不加新依赖）。
- `package.json` 加 `"test": "node --test tests/"`（`type` 保持 `commonjs`）。
- 每个测试文件覆盖：
  - 时区：`dayKeyCN` 四个边界点、`seriesDays(7)` 长度与首尾、跨月/跨年不出错。
  - 归一化：全角/空格/零宽/大小写/中英混合；空串与 `null` 不炸。
  - 限流：窗口内第 N 次放行、第 N+1 次拒绝、窗口滚动后重置（把时间当参数传入，别依赖真实时钟）。
- 新建 `.github/workflows/ci.yml`：`on: [push, pull_request]`，`runs-on: ubuntu-latest`，步骤：checkout → setup-node 20 → `node tools/check.js` → `node --test tests/`。**不要**在里面配任何云开发凭据。

**验收标准**：
- `npm test` 全绿，输出里能看到三个文件、至少 12 个用例通过。
- `node tools/check.js` 全过。
- workflow 文件 YAML 能被 `node -e "require('fs').readFileSync(...)"` 读通（我不跑 GitHub Actions，只看结构合法 + 本地两步能跑）。

---

## 交付约定

1. **一个任务一个 commit**，消息格式：`fix(time): 今日统计改用北京时间` / `feat(limit): 写操作频率限制` / `feat(words): 屏蔽词归一化匹配` / `fix(privacy): 注销账号补清 follows/reviews/feedback` / `test: 纯函数单测 + CI`。
2. 每个 commit 里**同时**更新相关文档（`README.md` 对应章节、`docs/database.md` 若新增集合、`cloudfunctions/README.md` 若新增函数/集合）。
3. 不要一次改多个任务；不要顺手重构无关代码；不要动 `admin/web` 的样式体系。
4. 做完在 `docs/handoff-gpt.md` 末尾追加一段「完成记录」：任务号、commit hash、自测命令与输出摘要。

## 已评估但**不**让 GPT 做的（避免返工）

- `adminApi/index.js` 拆模块（1800 行）：收益是长期可维护性，但一次大改很容易破坏 RBAC/审计，留给人工分步做。
- 图片流量优化（云存储缩略图/图片处理参数）：涉及控制台与 CDN 配置，我用 CLI 验证后自己来。
- 订阅消息、类目/备案、主体变更：卡在资质与平台审核，不是代码问题。
