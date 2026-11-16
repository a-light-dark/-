# 校园圈 · PC 管理后台（Web）

和手机端共用同一套云函数（`adminApi` / `adminLogin`），只是换了个大屏幕、表格化的操作界面。

## 现在有什么

| 页面 | 能做什么 |
|---|---|
| 登录 | 账号 `admin` + 密码（第一次是 `campus2026`），登录后拿一个 7 天有效的 token |
| 工作台 | 帖子/评论/用户/订单总数、待处理举报与反馈、回收站、敏感词数量 + 最近举报 |
| 举报处理 | 列表分页（20/页）、看到被举报帖子的原文和作者、忽略举报、删除帖子（进回收站，可恢复） |
| 帖子管理 | 关键词搜索、分页、置顶/取消置顶、删除（进回收站） |

后续可以按同样方式补：用户管理、反馈处理、公告、运营配置、回收站、敏感词、备份——后端接口 `adminApi` 都已经有了，只是加页面。

## 本地跑起来

```bash
cd admin/web
npm install
npm run dev
```

打开 http://localhost:5173 ，账号 `admin` / 密码 `campus2026`。

> 第一次登录时会把密码哈希写进云数据库（`settings.adminPasswordHash`），之后可以调 `adminLogin` 的 `changePassword` 改密码。

### 演示模式（不连云开发也能看界面）

```bash
# Windows PowerShell
$env:VITE_MOCK='true'; npm run dev
```

演示模式用 `src/mock.js` 里的假数据，不需要网络，适合先看布局。

## 连云开发要打开一个开关

网页端没有微信 openid，所以走「匿名登录 + 账号密码换 token」：

1. 微信开发者工具 → 云开发控制台 → 环境 `cloud1` → **登录授权**（或「设置 → 登录方式」）
2. 打开 **匿名登录**
3. 确认云函数 `adminLogin`、`adminApi` 已经部署（`cloudfunctions/` 目录里右键上传，或用 CLI）

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

## 目录

```
admin/web/
├─ index.html
├─ vite.config.js
├─ package.json
└─ src/
   ├─ main.js           入口（Element Plus + 路由）
   ├─ App.vue           整体布局（左侧菜单 + 顶栏）
   ├─ router.js         路由 + 未登录拦截（hash 路由，静态托管不用配 rewrite）
   ├─ api.js            云开发调用层（login / callAdmin / 各业务接口）
   ├─ mock.js           演示模式假数据
   ├─ styles.css        全局样式
   └─ views/
      ├─ Login.vue
      ├─ Dashboard.vue
      ├─ Reports.vue
      └─ Posts.vue
```

## 和手机端的关系

- 手机端「我的 → 管理台」还在，圈主临时处理举报/公告用手机；批量操作（搜帖子、翻举报、封人）用电脑后台。
- 两边调的是同一个 `adminApi`，权限两边一致：手机端认 openid 白名单，网页端认登录 token。
- 网页端登录态的 token 存在 `admin_sessions` 集合（7 天过期），退出登录会删掉。
