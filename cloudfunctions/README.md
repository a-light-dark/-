# 云函数目录

云函数是跑在微信服务器上的后台代码（相当于「后端」），负责客户端没权限做的事，以及需要服务端校验的事。

## 现在有 19 个

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
| `deleteAccount/` | 注销账号：删自己的资料与全部内容 | 要跨集合批量删数据、改别人的帖子计数；有未完成订单时先拦下 |
| `reportPost/` | 举报帖子（写 `reports` 集合） | 举报记录不能由客户端直接写；理由白名单 + 防重复举报 |
| `notices/` | 消息通知：列表 / 未读数 / 单条已读 / 一键已读 | 通知文档的 `_openid` 是发送者，收件人读不到，只能按 `toOpenid` 由服务端查 |
| `adminReview/` | 举报处理：是否管理员 / 举报列表 / 删帖 / 忽略举报（管理员 openid 白名单） | 要删别人的帖子，客户端没权限；白名单放服务端，客户端改不了 |
| `feedback/` | 建议反馈：提交 / 我的反馈 / 管理员列表 / 标记已处理 / 删除 | 用户写的文字进官方反馈列表，需要服务端校验长度与身份；管理员动作走白名单 |
| `orderReview/` | 订单评价：创建 / 查这单的两条评价 / 查某人收到的评分列表 | 评价要校验订单已完成、调用者是双方之一、一单一人只能评一次；评分不能由客户端随便写 |
| `updatePost/` | 编辑自己的帖子（内容安全检测；只能改正文和话题，图片不动） | 要校验作者身份并过内容安全；客户端没有权限改已发布的帖子 |
| `adminApi/` | 管理后台网关：仪表盘 / 帖子·评论·举报·反馈·用户管理 / 公告 / 运营配置 / 审计日志 / 回收站（删除先进 `trash`，可恢复或彻底删除）/ 敏感词库（发帖·评论·悬赏先本地拦截）（全部动作过管理员白名单 + 写 `audit_logs`） | 管理动作不能由客户端直写；白名单和审计只能放服务端；封禁会改 `users.banned` 并被 5 个写入口校验 |
| `setupCollections/` | 开发辅助：建 `favorites` / `reports` / `notices` / `feedback` / `follows` / `reviews` / `announcements` / `bans` / `settings` / `audit_logs` 集合，测试用 seed/cleanup | 集合只能建在服务端；`seedPost`/`seedReport`/`seedNotice`/`seedOrder` 造的数据用来模拟「别人发的」 |

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
