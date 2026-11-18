# 校园圈 · PC 管理后台（Web）

和手机端共用同一套云函数（`adminApi` / `adminLogin`），只是换了个大屏幕、表格化的操作界面。

## 现在有什么

| 页面 | 能做什么 |
|---|---|
| 登录 | 账号 `admin` + 密码（第一次是 `campus2026`），登录后拿一个 7 天有效的 token |
| 工作台 | 帖子/评论/用户/订单总数、待处理举报与反馈、回收站、敏感词数量 + 最近举报 |
| 举报处理 | 分页（20/页）、看被举报帖子的原文和作者、忽略举报、删帖（进回收站，可恢复） |
| 帖子管理 | 关键词搜索、分页、置顶/取消置顶、删除（进回收站） |
| 用户管理 | 搜昵称、封禁（填原因）/解封、设/取消管理员（仅圈主可操作） |
| 建议反馈 | 分页、看联系方式和提交人、标记已处理（会给对方发系统消息）、删除 |
| 公告管理 | 发/编辑/删除公告、置顶、上架下架（首页最多取 3 条） |
| 运营配置 | 首页 banner 文案、公告开关、举报/反馈处理话术 + 改登录密码 + 操作日志 |
| 回收站 | 帖子/评论的删除记录、恢复、彻底删除 |
| 敏感词库 | 加词（≤20 字、上限 200）、查看命中列表、删词 |
| 数据备份 | 一键把 17 个集合导出 JSON 到云存储、拿临时下载链接、删备份 |
| 流量看板 | 7/14/30 天新增柱状图、浏览/点赞/活跃同学 KPI、浏览与点赞 Top5、话题分布（来自 adminApi analytics.overview） |
| 广告管理 | 首页 banner / 详情页底部广告位：图片、跳转（帖子/页面/不跳）、投放时间、权重、启用开关、曝光/点击/点击率 |

## 本地跑起来

```bash
cd admin/web
npm install
npm run dev
```

打开 http://localhost:5173 ，账号 `admin` / 密码 `campus2026`。

> 第一次登录时会把密码哈希写进云数据库（`settings.adminPasswordHash`），之后在「运营配置 → 修改登录密码」里改。

### 演示模式（不连云开发也能看界面）

```bash
# Windows PowerShell
$env:VITE_MOCK='true'; npm run dev
```

演示模式用 `src/mock.js` 里的假数据，不需要网络，适合先看布局。
想直接看打包后的演示版：`npm run build -- --outDir dist-mock`，再 `node serve-mock.cjs`（5055 端口）。

## 连云开发要打开一个开关

网页端没有微信 openid，所以走「匿名登录 + 账号密码换 token」：

1. 微信开发者工具 → 云开发控制台 → 环境 `cloud1` → **登录授权**（或「设置 → 登录方式」）
2. 打开 **匿名登录**
3. 确认云函数 `adminLogin`、`adminApi` 已部署（`cloudfunctions/` 目录里右键上传，或用 CLI）

> 如果不开匿名登录，也可以改用「云函数 HTTP 访问服务」，但那需要在控制台单独配置域名，先按匿名登录走最省事。

环境 ID 默认写死为 `cloud1-d6g26wz61eca836b8`；要换环境就在 `.env` 里写 `VITE_TCB_ENV=你的环境ID`。

## 打包 + 部署到云开发静态托管

```bash
npm run build          # 产物在 dist/
```

部署（二选一）：

- **控制台**：云开发控制台 → 静态网站托管 → 上传文件 → 把 `dist/` 里的内容整个拖进去
- **CLI**：`npx @cloudbase/cli hosting deploy dist -e cloud1-d6g26wz61eca836b8`（需要 `tcb login` 登录一次）

部署完会给你一个 `xxx.tcloudbaseapp.com` 的地址，用电脑浏览器打开就是后台。

### 已经部署的地址

https://cloud1-d6g26wz61eca836b8-1532263586.tcloudbaseapp.com/

两个会拦人的地方（都不是后台的 bug）：

1. 打开先弹出腾讯云开发的「页面访问提示」——默认测试域名的限制，点「确定访问」才进。要让别人也能用、并去掉这个提示，需要绑定自定义域名（要备案）。
2. 如果登录报 `连不上云开发：... unauthenticated ... credentials not found`，就是上面那个 **匿名登录** 开关还没打开。

## 目录

```
admin/web/
├─ index.html
├─ vite.config.js
├─ package.json
├─ serve-mock.cjs        本地静态预览 dist-mock
└─ src/
   ├─ main.js            入口（Element Plus + 路由）
   ├─ App.vue            整体布局（左侧菜单 + 顶栏）
   ├─ router.js          路由 + 未登录拦截（hash 路由，静态托管不用配 rewrite）
   ├─ api.js             云开发调用层（login / callAdmin / 各业务接口）
   ├─ mock.js            演示模式假数据
   ├─ styles.css         全局样式
   └─ views/
      ├─ Login.vue         登录
      ├─ Dashboard.vue     工作台
      ├─ Reports.vue       举报处理
      ├─ Posts.vue         帖子管理
      ├─ Users.vue         用户管理
      ├─ Feedback.vue      建议反馈
      ├─ Announcements.vue 公告管理
      ├─ Settings.vue      运营配置 + 改密码 + 操作日志
      ├─ Trash.vue         回收站
      ├─ Words.vue         敏感词库
      └─ Backup.vue        数据备份
```

## 和手机端的关系

- 手机端「我的 → 管理台」还在，圈主临时处理举报/公告用手机；批量操作（搜帖子、翻举报、封人）用电脑后台。
- 两边调的是同一个 `adminApi`，权限两边一致：手机端认 openid 白名单，网页端认登录 token。
- 网页端登录态的 token 存在 `admin_sessions` 集合（7 天过期），退出登录会删掉。

## 已知小问题

- token 过期后需要重新登录（没有自动续期）
- 数据备份是 JSON 快照，恢复需要人工导回
- 前端打包体积约 1.8 MB（Element Plus 占大头），后台用不追求首屏体积

## 身份与权限（RBAC）

PC 后台有 5 种身份，登录后菜单按身份显示，后端 `adminApi` 会再校验一次（前端藏菜单只是体验，真正的权限在云函数里）。

| 身份 | 能做什么 | 不能做什么 |
|---|---|---|
| 圈主 owner | 全部，包括新建/停用后台账号 | — |
| 开发者 developer | 全部只读 + 提交修改 | 修改不会立刻生效，要先经管理员/圈主审核 |
| 管理员 admin | 全部，含审核开发者的修改 | 不能管后台账号（账号管理只有圈主能进） |
| 运营 operator | 删帖、置顶、删评论、处理举报/反馈、发公告、维护敏感词、看审计日志 | 改运营配置、数据备份、账号管理、审核 |
| 数据分析员 analyst | 只读：工作台、举报、帖子、用户、反馈、公告、敏感词 | 任何修改都会被拒 |

- 审核：开发者写操作进入「修改审核」页，管理员点「通过」后由服务端用管理员身份重放一次；点「驳回」写原因。记录保存在 `approvals`。
- 账号：保存在 `admin_accounts`（密码只存 sha256），会话在 `admin_sessions`（7 天、带角色）。
- 演示模式切换身份：访问 `?role=analyst#/dashboard` 或 `?role=operator#/dashboard`。
