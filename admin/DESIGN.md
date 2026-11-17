# 校园圈 · 管理后台系统设计（参考开源项目）

> 调研时间：2026-11-16。本文档记录「为什么这么设计后台」+「后台长什么样」+「怎么一步步做」。
> 所有参考项目均为开源，我们只借鉴设计思路与模块划分，代码全部自研（避免版权与风格问题）。

## 1. 背景

校园圈现在的状态：

- 用户端：微信小程序原生开发，25 个页面（5 tab + 20 非 tab）
- 后端：微信云开发——18 个云函数、11 个集合（posts/comments/orders/users/likes/favorites/reports/notices/feedback/follows/reviews）、云存储
- 已有的「管理」能力：小程序里一个 `pages/admin/admin` 页（举报处理）+ `feedback-admin`（反馈处理），管理员身份用 `ADMIN_OPENIDS` 白名单硬编码在云函数里
- 缺口：没有公告、没有封禁、没有数据看板、没有操作审计、举报处理不闭环（处理完用户无感知）、管理员只能在小程序里点

## 2. GitHub 开源项目调研结论

| 项目 | 地址 | 定位 | 我们借鉴什么 |
|---|---|---|---|
| **CampusHub**（墨荧校园，Apache-2.0） | <https://github.com/badhope/campushub> | uni-app 三端 + **微信云开发**的校园内容社区，v0.12，管理台/仪表盘/回收站/词库/公告齐全 | **系统设计主要参考**：运营仪表盘聚合、举报审核、封禁、置顶/加精、公告、敏感词三级（拒发/替换/送审）、内容回收站（软删可恢复）、审计日志、自动备份、定时任务。它的「一校一署」「管理台」和我们形态一致 |
| **谈校间 BBS**（Apache-2.0） | <https://github.com/liu6238819/tanxiaojian-BBS> | 校园社区小程序（数十万用户），后端 Java + 管理端基于若依 | **管理端功能清单参考**：内容审核与关键词拦截、用户管理、公告/广告设置、分站与管理员、社群推送。它验证了「校园论坛该有哪些后台功能」 |
| **RuoYi-Vue（若依）** | <https://gitee.com/y_project/RuoYi-Vue> | SpringBoot+Vue 前后端分离快速开发框架，管理端事实标准 | **后台模块划分参考**：用户/角色/菜单/参数配置/通知公告/操作日志/登录日志/在线用户/定时任务/服务监控——我们把其中适用的模块映射到云开发 |
| **vue-element-admin**（MIT） | <https://github.com/PanJiaChen/vue-element-admin> | 企业级中后台前端解决方案（Vue + Element UI） | **Web 后台前端骨架参考**（阶段 2）：侧边栏 + 动态路由 + 权限 + 表格 + ECharts 仪表盘 |

**技术栈结论**：谈校间的 Java/RuoYi 栈不适合我们（我们全部在云开发上，没有也不打算买服务器跑 Java）；CampusHub 证明了「校园社区 + 纯云开发 + 管理台」完全可行且零服务器，**我们采用同款路线**。

## 3. 总体架构决策

### 3.1 管理后台形态：两步走

| | 阶段 1（现在） | 阶段 2（换公司主体后） |
|---|---|---|
| 形态 | 小程序内「管理台」（扩展现有 admin 页为多页管理台） | 独立 Web 后台（Vue3 + Element Plus，参考 vue-element-admin 布局） |
| 前端 | WXML/WXSS，圈主手机随时管 | 部署到云开发「静态网站托管」，电脑浏览器用 |
| 登录 | 微信 openid（天然登录） | 管理员口令登录 → 换取短时会话（admin_sessions） |
| 优点 | 0 新依赖，今天就能上线 | 大屏操作爽、可以多人分工、导出数据 |
| 为什么分两步 | 个人主体阶段用户就自己一个人管，小程序内完全够用；Web 后台值得做但要等主体/域名确定后一步到位 | |

两阶段共用**同一套后台 API**（adminApi 网关），阶段 2 只是换个前端壳，后端零改动。

### 3.2 后端：新增一个管理网关，不动现有 18 个函数

参考 CampusHub 的「资源型网关」思路（44 个入口收敛为 7 个网关），但我们**不推倒重来**：现有函数保持不动，新增：

- `cloudfunctions/adminApi/` —— 管理网关，按 `event.action` 分发，所有动作先过 `ADMIN_OPENIDS` 白名单 + 写审计日志
- 现有 `adminReview`（举报删帖/忽略）、`feedback`（反馈处理）继续可用，adminApi 里提供等价动作，客户端逐步切到 adminApi

### 3.3 权限模型（参考 RuoYi 角色 → 简化为两级）

- **超管（owner）**：openid 白名单第一个；能改白名单、改系统参数
- **运营（admin）**：白名单其余成员；内容审核、用户管理、公告
- 身份判定：云函数读 `users` 文档的 `role` 字段（'owner'/'admin'），老白名单 `ADMIN_OPENIDS` 作为兜底
- 所有管理动作写 `audit_logs`：谁、什么时候、对什么、做了什么

## 4. 数据模型：新增 5 个集合（11 → 16）

| 集合 | 字段 | 说明 |
|---|---|---|
| `announcements` | `{title, content, active, pinned, createdAt, createdBy}` | 公告；小程序首页/消息页展示 |
| `bans` | `{openid, nickname, avatar, reason, by, createdAt, until}` | 封禁记录（users 上同步 `banned/bannedAt/banReason`） |
| `settings` | `{key, value, updatedAt}` | 参数配置：banner 文案、公告开关、举报处理提示等 |
| `audit_logs` | `{action, targetType, targetId, detail, by, at}` | 管理操作审计（RuoYi「操作日志」的云开发版） |
| `admin_sessions`（阶段 2） | `{token, openid, createdAt, expireAt}` | Web 后台登录会话 |

users 集合增加：`role`（'owner'/'admin'/缺省）、`banned`、`bannedAt`、`banReason`。

## 5. 管理 API 设计（adminApi 网关 action 清单）

```js
// 工作台（CampusHub dashboard 思路：一次聚合）
dashboard          → { posts, comments, orders, users, pendingReports, pendingFeedback, todayPosts, todayComments, recentReports[] }

// 内容管理
posts.list         → { page, pageSize, keyword, onlyTop } → 帖子分页（含作者信息）
posts.setTop / posts.unsetTop
posts.remove       → 复用 deletePost 的级联（评论/点赞/收藏 + 云存储图片）
comments.list / comments.remove

// 举报处理
reports.list       → 举报 + 被举报帖（join）
reports.dismiss    → 忽略
reports.removePost → 删帖并处理举报

// 用户管理（RuoYi 用户管理思路）
users.list         → 分页 + 搜索（昵称/uid）
users.ban / users.unban   → 写 bans + 更新 users.banned
users.setRole      → 管理员任免（仅 owner）

// 反馈
feedback.list / feedback.resolve / feedback.remove

// 公告（RuoYi 通知公告思路）
announcements.list / announcements.create / announcements.update / announcements.remove

// 参数配置（RuoYi 参数管理思路）
settings.get / settings.set

// 系统
audit.list         → 操作日志分页
```

**封禁生效点**（参考 CampusHub 的 `requireActiveUser` 集中拦截）：`createPost` / `addComment` / `createOrder` / `grabOrder` / `likePost` 五个写入口，开头查一次 `users.banned`，封禁则拒绝。

## 6. 管理台页面结构（阶段 1，小程序内）

```
管理台（我的 → 管理台，原 admin 页升级为入口）
├── 工作台        ← dashboard 数字卡 + 待处理举报
├── 内容管理
│   ├── 帖子管理   ← 列表/搜索/置顶/删除
│   └── 评论管理   ← 按帖看评论/删评论
├── 举报处理       ← 现有 admin 页迁入（忽略/删帖）
├── 用户管理       ← 列表/封禁/解封/任免管理员
├── 反馈处理       ← 现有 feedback-admin 迁入
├── 公告管理       ← 增删改 + 上下线 + 置顶
└── 系统
    ├── 参数设置    ← banner 文案等
    └── 操作日志    ← audit.list
```

首页展示：公告卡（读 announcements，`active` 且 `pinned` 优先，≤5 条）。

## 7. 阶段 2：Web 后台（换主体后）

- 前端：Vue3 + Vite + Element Plus + Pinia（参考 RuoYi-Vue3 结构、vue-element-admin 布局与 ECharts 仪表盘）
- 部署：云开发静态网站托管（免费额度）或朋友服务器 Nginx 静态托管
- 后端：完全复用 adminApi；登录页输口令 → `adminApi login` 签发 `admin_sessions` 短时 token；HTTP 访问服务转发
- 加分项（CampusHub 有、我们阶段 2 补）：内容回收站（软删可恢复）、敏感词三级词库、编辑历史、自动备份定时器、任务帖 TTL

## 8. 安全与合规（延续 RELEASE.md 的口径）

1. 所有管理动作服务端验白名单，前端「隐藏按钮」只是体验优化
2. 敏感动作（删帖、封禁、任免）双确认 + 审计日志
3. 封禁对 5 个写入口集中生效，fail-closed
4. 删除继续走硬删 + 云存储图片清理（阶段 2 升级为软删回收站）
5. 公告、参数同样可被审计追溯

## 9. 实施路线

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | 本设计文档 + 调研 | ✅ 本文件 |
| M1 | `adminApi` 网关（dashboard/内容/举报/用户/反馈/公告/参数/审计）+ 5 个写入口封禁检查 + `setupCollections` 建新集合 | ⏳ 进行中 |
| M2 | 小程序内「管理台」页面群（工作台/帖子/评论/用户/公告/参数/日志）+ 首页公告卡 | 待办 |
| M3 | 阶段 2：Web 后台（Vue3+Element Plus）+ 口令登录 + 静态托管 | 等公司主体 |
| M4 | 回收站/词库/备份/编辑历史（可选增强） | 待办 |

## 10. 风险与说明

- **类目**：管理功能不改变类目要求；正式上线仍需企业主体 + 社交-社区/论坛类目
- **成本**：新增集合与查询量很小，19.9/月个人版完全够；Web 后台走静态托管免费额度
- **许可证**：只参考设计，不引入参考项目代码；我们项目保持自有代码
- **审计存储**：audit_logs 会随时间增长，后续加按月归档定时器（参考 CampusHub task-expire）


## M3 进展：PC 网页后台（骨架已落地）

- 已完成：`adminLogin` 云函数（账号密码 → token，sha256 存 settings，token 存 admin_sessions，7 天过期；支持 logout / whoami / changePassword）；`adminApi` 支持 token 鉴权（网页 token 或小程序 openid 二选一）。
- 已完成：`admin/web/`（Vue 3 + Vite + Element Plus）——登录 / 工作台 / 举报处理 / 帖子管理，列表统一 20 条分页，删除走回收站。
- 已完成：演示模式（`VITE_MOCK=true`）与生产构建（`npm run build` → `dist/`），可直接上传云开发静态托管。
- 已完成：用户管理 / 建议反馈 / 公告管理 / 运营配置（含改密码 + 操作日志）/ 回收站 / 敏感词库 / 数据备份（共 10 个页面）。
- 待做：token 自动续期；备份的一键恢复（目前是导出 JSON，恢复需人工或脚本）。

## M3.5 身份与权限（RBAC + 审核）

- 角色：owner / developer / admin / operator / analyst；账号 `admin_accounts`，会话 `admin_sessions`（带 role）。
- 入口统一 `allowRole(role, action)`；小程序端沿用 openid 白名单 + `users.role`。
- 开发者写操作写 `approvals`（payload + action），返回 pending；管理员 `approvals.approve` 时服务端重放（_fromApproval 防递归），状态 executed/failed。
- 审计加 by/role；`posts.trace` 按 targetId 追溯。
- Web：Accounts.vue（圈主）、Approvals.vue（圈主/管理员），菜单按角色过滤，演示模式支持 ?role=analyst。
