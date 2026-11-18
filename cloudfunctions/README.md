# 云函数目录

云函数是跑在微信服务器上的后台代码（相当于「后端」），负责客户端没权限做的事，以及需要服务端校验的事。

## 现在有 25 个

| 云函数 | 作用 | 为什么必须是云函数 |
|---|---|---|
| `login/` | 返回调用者的 openid | 用户身份只能由服务端拿 |
| `likePost/` | 点赞 / 取消点赞（点赞时通知作者） | 要给别人的帖子改 likeCount；通知也是写给别人的 |
| `addComment/` | 发评论（内容安全检测）+ 评论数 +1 + 通知作者 | 评论人不是帖子作者，改不了别人的帖子；要过内容安全 |
| `grabOrder/` | 抢单 / 标记完成（抢单时通知发单人） | 要改别人的订单，且要防两个人同时抢 |
| `createPost/` | 发帖（文字 + 图片内容安全检测） | 服务端补昵称头像、过滤违规内容、写 `_openid` |
| `createOrder/` | 发互助悬赏（内容安全检测） | 金额校验 + 服务端补昵称头像 |
| `updateProfile/` | 改昵称（内容安全检测）/ 头像 | 昵称是公开资料，要过审核；头像要校验是不是自己的云文件 |
| `deletePost/` | 删自己的帖子（连带清评论/点赞/收藏） | 客户端删不掉别人的帖子和关联数据；服务端做条件删除防止误删 |
| `deleteComment/` | 删自己的评论（顶层评论连同它的回复一起删，并回补 `posts.commentCount`） | 客户端只读评论；而且删完要改「别人的帖子」上的评论数，只能服务端做 |
| `viewPost/` | 浏览量 +1（进详情页时调用） | 客户端改不了别人帖子的 `views`；服务端用 `_.inc(1)` 原子加，避免并发丢更新 |
| `postDetail/` | 详情页一次拿全：正文 + 是否点赞/收藏 + 第一页评论（默认 30 条）+ 详情页广告；传 `withPost:false, commentFrom, commentLimit` 就只翻评论下一页 | 把原来 3 次云函数调用合并成 1 次（省调用费、打开更快）；评论分页不重复查帖子和广告 |
| `search/`（`action:'hot'`） | 热搜词榜：返回搜索次数前 10；每次真实搜索第 1 页会把词计数 +1（`search_hot` 集合，`_id` 就是词本身） | 搜一次写一次太贵，只记第一页；表没建时返回空数组，前端用默认词兜底 |
| `search/` | 服务端分页搜索（正文模糊 + 话题精确），一次返回 20 条 + `hasMore` | 之前客户端只拉最近 100 条本地过滤，帖子多了搜不全 |
| `board/` | 本周榜单：热帖 Top5 + 活跃同学 Top5（最近 7 天，服务端算完只回 10 条，60 秒缓存） | 以前是客户端拉 100 条帖子 + 200 条评论在本地算，一次进榜 400+ 次文档读、两个请求 |
| `maintain/` | 数据库维护：`action:'scan'` 抽样看各集合时间字段类型；`action:'migrate'` 把 ISO 字符串时间批量转成 `Date`（默认 dryRun） | 字符串时间会让 `createdAt >= 今天` 这类范围查询一条都查不到，得在服务端批量修；**只认后台登录 token**（`admin_sessions` 里角色为圈主/管理员），不带 token 返回 `NEED_ADMIN` |
| `deleteAccount/` | 注销账号：删自己的资料与全部内容 | 要跨集合批量删数据、改别人的帖子计数；有未完成订单时先拦下 |
| `reportPost/` | 举报帖子（写 `reports` 集合） | 举报记录不能由客户端直接写；理由白名单 + 防重复举报 |
| `notices/` | 消息通知：列表 / 未读数 / 单条已读 / 一键已读（类型 comment/like/order/**system**，system 是圈主处理举报/反馈后的结果通知） | 通知文档的 `_openid` 是发送者，收件人读不到，只能按 `toOpenid` 由服务端查 |
| `adminApi/` 的 `accounts.sessions` / `accounts.revoke` | 在线设备：列出未过期的后台登录会话（账号/身份/登录时间/到期时间），`revoke` 按会话 id 强制下线（删 `admin_sessions`，对方 token 最多 15 秒后失效） | 只有圈主能看/能踢；token 缓存 15 秒是「踢了能立刻生效」的关键 |
| `adminApi/` 的 `backup.restore` | 从云存储的备份 JSON 恢复：`{id, dryRun, from, limit, concurrency}`，每批 ≤200 条（默认 50、并发 10），返回 `{done, written, next, progress, collections}` | 云函数单次只跑 3 秒，一次写几百条会超时，所以必须在网页端循环分批调用 |
| `siteData/` | 公开数据网关：代读「公告」「首页 banner 文案」「广告位」，并接收广告曝光/点击上报（`{action:'adReport', id, type:'view|click'}`） | 公告/配置/广告集合对用户不可读写；广告下发按 enabled + 投放时间窗 + weight 过滤，曝光点击用 `_.inc(1)` 原子累加 |
| `adminReview/` | 举报处理：是否管理员 / 举报列表 / 删帖 / 忽略举报（管理员 openid 白名单） | 要删别人的帖子，客户端没权限；白名单放服务端，客户端改不了 |
| `feedback/` | 建议反馈：提交 / 我的反馈 / 管理员列表 / 标记已处理 / 删除 | 用户写的文字进官方反馈列表，需要服务端校验长度与身份；管理员动作走白名单 |
| `orderReview/` | 订单评价：创建 / 查这单的两条评价 / 查某人收到的评分列表 | 评价要校验订单已完成、调用者是双方之一、一单一人只能评一次；评分不能由客户端随便写 |
| `updatePost/` | 编辑自己的帖子（内容安全检测；只能改正文和话题，图片不动） | 要校验作者身份并过内容安全；客户端没有权限改已发布的帖子 |
| `adminLogin/` | PC 网页后台的账号密码登录：sha256 校验密码（存 `settings`）、发 7 天 token 存 `admin_sessions`、支持 logout / whoami / changePassword | 网页端没有 openid，只能用账号体系；密码不能明文入库 |
| `adminApi/` | 管理后台网关：仪表盘 / 帖子·评论·举报·反馈·用户管理 / 公告 / 运营配置 / 审计日志 / 回收站 / 敏感词库 / 数据备份（全部动作过管理员白名单 + 写 `audit_logs`；处理举报/反馈后会给当事人发「系统」消息，文案可在运营配置里改） | 管理动作不能由客户端直写；白名单和审计只能放服务端；封禁会改 `users.banned` 并被 5 个写入口校验 |
| `setupCollections/` | 开发辅助：建 `favorites` / `reports` / `notices` / `feedback` / `follows` / `reviews` / `announcements` / `bans` / `settings` / `audit_logs` 集合，测试用 seed/cleanup | 集合只能建在服务端；`seedPost`/`seedReport`/`seedNotice`/`seedOrder` 造的数据用来模拟「别人发的」；**种子/清理必须带后台 token**（全新环境还没有管理员账号时，只放行「建集合」） |

## 内容安全（msgSecCheck）怎么用

4 个带检测的函数里都有这段写法：

```js
const res = await cloud.openapi.security.msgSecCheck({
  content, version: 2, scene: 3, openid: OPENID,
})
const suggest = res.result.suggest   // pass / review / risky
```

`scene` 按场景选：`1` 资料（昵称）、`2` 评论、`3` 论坛（帖子/悬赏）。

**关键一步**：云函数要用 `cloud.openapi`，必须在函数目录放一个 `config.json` 声明权限，否则会报错（我们就踩过 `-604101`）：

```json
{
  "permissions": {
    "openapi": ["security.msgSecCheck", "security.imgSecCheck"]
  }
}
```

> `security.imgSecCheck` 只有 `createPost` 用得到（发帖带图时逐张检测）。同步接口单张上限 750KB，客户端会先压到 quality 70；超限的图直接拒绝，不放过去。

改完 `config.json` 或 `index.js` 都要重新「上传并部署」。

> 接口本身出错（超频、网络）时函数会先放行并 `console.warn`，不让整个发帖功能瘫掉。上线前可以在云开发 → 云函数 → 日志 里看有没有这种告警。

## 怎么部署

在微信开发者工具左侧的 `cloudfunctions` 目录下：

1. 右键某个云函数文件夹（比如 `login`）
2. 选 **「上传并部署：云端安装依赖」**
3. 等几秒，控制台出现「部署成功」即可
4. 11 个文件夹都部署一遍（新建的云函数第一次可能报 `当前函数处于Creating状态`，等 15–20 秒再部署一次就好）

> 云函数的依赖（`wx-server-sdk`）由云端按 `package.json` 自动安装，本地不用 `npm install`。
> 改完云函数代码必须重新「上传并部署」，否则线上跑的还是旧代码。

## 云函数里统一用到的写法

```js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 自动用当前环境
const db = cloud.database()
const { OPENID } = cloud.getWXContext()        // 调用者身份
```
