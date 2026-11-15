# 校园圈 · 提审与上线清单

> 更新时间：2026-11-15　当前体验版：0.5.5
>
> 这份文档是给「把体验版变成正式版」用的：提审前要改哪里、审核会看什么、材料怎么准备、哪些坑踩过。
>
> 审核员问答、截图清单、驳回应答模板在 `RELEASE-APPENDIX.md`（提审答辩包）。

---

## 一、提审前必须替换的地方（不替换大概率被驳）

项目里现在写的是**示例主体信息**，提审前换成真实公司的：

| 文件 | 位置 | 现在写的 | 要改成 |
|---|---|---|---|
| `miniprogram/pages/agreement/agreement.wxml` | 底部「运营主体」段 | 体验版示例文本 | 公司全称 + 统一社会信用代码 |
| `miniprogram/pages/privacy/privacy.wxml` | 「运营主体」「联系我们」 | 体验版示例文本 / 示例邮箱 | 公司全称 + 真实邮箱 |
| `miniprogram/pages/rules/rules.wxml` | 文末说明 | 体验版示例文本 | 公司全称 |
| `miniprogram/pages/account/account.wxml` | 注销说明 | 体验版示例文本 | 公司全称 |

排查命令（在项目根目录跑）：

```powershell
Select-String -Path miniprogram\pages\*\*.wxml -Pattern '示例文本|example@|体验版示例'
```

> 另外 `README.md` 里的项目说明不用改，它不参与审核。

---

## 二、UGC 安全合规（审核必问，也写进了协议）

这是「社交-社区/论坛」类目最容易被卡的点，我们已经在代码里做了：

| 合规要求 | 实现方式 | 代码位置 |
|---|---|---|
| 文字内容检测 | 发帖、发悬赏、评论、改昵称，都走 `security.msgSecCheck`（scene 3/3/2/1） | `cloudfunctions/createPost`、`createOrder`、`addComment`、`updateProfile` |
| 图片内容检测 | 帖子图片、头像都走 `security.imgSecCheck`（单张 ≤750KB，客户端先压 quality 70） | 同上（`checkImage`）+ `createPost` |
| 举报入口 | 帖子详情页「举报」，5 个理由，写 `reports` 集合 | `pages/detail/detail.js` → `cloudfunctions/reportPost` |
| 举报处理 | 管理员在「我的 → 举报处理」看列表，可「删除帖子」或「忽略」 | `cloudfunctions/adminReview`、`pages/admin/admin` |
| 删帖连带清理 | 删帖同时删评论/点赞/云存储图片，保留收藏占位提示 | `cloudfunctions/deletePost` |
| 注销账号 | 「我的 → 注销账号」，真删数据（帖子/评论/点赞/收藏/通知/资料），有未结束订单时拦截 | `cloudfunctions/deleteAccount` |
| 隐私政策 / 用户协议 / 社区规范 | 三个独立页面，首页首次启动弹隐私提示 | `pages/privacy`、`pages/agreement`、`pages/rules`、`pages/index` 弹窗 |
| 建议反馈 | 用户可提交，管理员可标记已处理 | `pages/feedback`、`pages/feedback-admin`、`cloudfunctions/feedback` |
| 管理员白名单 | 圈主 openid 写死在云函数里 | `cloudfunctions/adminReview/index.js`、`feedback/index.js` 的 `ADMIN_OPENIDS` |

**答辩口径**（如果审核打电话问）：
> 本小程序为校园信息交流社区，用户发布内容均经过微信内容安全接口（文字 msgSecCheck、图片 imgSecCheck）检测；提供举报入口并由管理员（圈主）在管理页处理；提供账号注销与隐私政策；未成年人不做定向运营。

---

## 三、上线方式：企业主体 + 类目 + 备案

个人主体做不了「社交-社区/论坛」，必须企业/个体工商户。两种落地方式：

### 方案 A：用公司新注册一个小程序（推荐，数据少时最省事）

1. 朋友公司在 [mp.weixin.qq.com](https://mp.weixin.qq.com) 注册小程序（企业主体）
2. 微信认证（300 元/年，对公账户打款或法人扫脸）
3. 选类目：**社交 → 社区/论坛**
4. 小程序备案（微信后台「设置 → 基本设置 → 小程序备案」，1–3 周，法人/负责人扫脸）
5. 我把 `project.config.json` 的 `appid` 换成新 AppID → 新建云开发环境（19.9/月个人版）→ 18 个云函数一键部署 → 11 个集合按权限矩阵建好 → 数据导出导入（目前只有几条测试帖，可不导）
6. 上传代码 → 提审 → 发布

### 方案 B：现有小程序做「主体变更」（个人 → 企业）

后台「设置 → 基本设置 → 主体信息 → 主体变更」，个人转企业通常要求**公证书**（微信指定模板，去公证处办），周期 1–2 周。好处是 AppID、体验成员、云环境都不用动。

> 建议：数据还很少，走 A 更干净；A 的代价是换 AppID 和云环境，我把 appid/环境 ID 改掉、重部署、重加体验成员就行。

---

## 四、提审材料清单

| 材料 | 谁准备 | 备注 |
|---|---|---|
| 营业执照（企业/个体户） | 朋友公司 | 拍照或扫描 |
| 法人身份证正反面 | 朋友公司 | 备案扫脸时用 |
| 管理员姓名/手机号/邮箱 | 朋友公司 | 备案和审核联系用 |
| 对公账户 | 朋友公司 | 微信认证打款 |
| 类目资质 | 可能需要 | 「社交-社区/论坛」有时要《互联网信息服务安全评估报告》，按后台提示补 |
| 小程序截图 6 张 | 我 | 首页、发帖、详情、互助大厅、我的、举报/管理页 |
| 测试账号 | 无 | 我们不强制登录微信以外账号，直接用微信身份 |

**审核常见驳回点，我们已规避：**

- ❌ 没有隐私政策 → ✅ 有独立页 + 首次启动弹窗
- ❌ 没有举报/删除入口 → ✅ 详情页举报 + 管理员删帖
- ❌ 内容无审核 → ✅ msgSecCheck + imgSecCheck
- ❌ 没有账号注销 → ✅ 注销页 + 云函数真删
- ❌ 类目与内容不符 → ⚠️ 必须选「社交-社区/论坛」，别选「工具」
- ❌ 页面空白/报错 → 提审前用体验版走一遍全流程

---

## 五、上线前最后检查（10 分钟）

- [ ] 协议页主体信息已替换（见第一节）
- [ ] 云开发控制台：`createPost` 超时改 **20 秒**（默认 3 秒，传图+检测会超）
- [ ] 云开发控制台：`posts` 建 `createdAt` 降序、`likeCount` 降序、`views` 降序索引
- [ ] 订阅消息模板 ID 填好（`miniprogram/utils/subscribe.js` + 3 个云函数），`MINIPROGRAM_STATE` 改 `'formal'`
- [ ] 集合权限按第六节矩阵设好
- [ ] 云存储权限：「所有用户可读，仅创建者可读写」
- [ ] 删除测试数据（`posts`/`orders` 里带「测试」「seed」字样的记录）
- [ ] 版本号改成 1.0.0（`cli upload --version 1.0.0`），描述写清楚
- [ ] 真机跑一遍：发图帖 → 评论 → 点赞 → 收藏 → 进主页 → 抢单 → 完成 → 确认 → 互评 → 举报 → 管理员删

---

## 六、数据与权限矩阵（上线后也不要随意改）

| 集合 | 权限 | 谁能写 |
|---|---|---|
| `posts` | 自定义规则 `{"read": true, "write": false}` | 只云函数 |
| `users` | 同上 | 只云函数 |
| `comments` | 同上 | 只云函数 |
| `likes` | 同上 | 只云函数 |
| `orders` | 同上 | 只云函数 |
| `favorites` | 仅创建者可读写 | 客户端本人（收藏是私有数据） |
| `follows` | 仅创建者可读写 | 客户端本人 |
| `reports` | 所有用户不可读写 | 只云函数（管理员看结果） |
| `notices` | 所有用户不可读写 | 只云函数 |
| `reviews` | 所有用户不可读写 | 只云函数 |
| `feedback` | 所有用户不可读写 | 只云函数 |

> 为什么不用微信预设的「所有用户可读」？因为它仍然给创建者写权限——作者能绕过云函数直接改自己帖子的 `likeCount`。必须用「自定义安全规则」。

云存储：`posts/<openid>/…`（帖子图）、`avatars/<openid>/…`（头像），权限「所有用户可读，仅创建者可读写」。

云函数共 18 个：`login` `likePost` `addComment` `deleteComment` `grabOrder` `createPost` `createOrder` `updateProfile` `updatePost` `deletePost` `deleteAccount` `reportPost` `notices` `viewPost` `adminReview` `feedback` `orderReview` `setupCollections`。

`posts` 文档字段：`content` `tags` `images` `likeCount` `commentCount` `views` `anonymous` `nickname` `avatar` `createdAt` `_openid`；`comments` 多了 `parentId`（顶层评论 id）与 `replyTo`（被回复人昵称）两个字段。

---

## 七、版本记录

| 版本 | 内容 |
|---|---|
| 0.1.0 | 帖子 / 互助 / 图片 / 收藏 / 举报 |
| 0.2.x | 搜索、我的内容、首页分类筛选、分享 |
| 0.3.0 | 订单双向确认 / 撤销悬赏 / 我的收益 / 图片加载修复 |
| 0.4.x | 合规四页 + 隐私弹窗、建议反馈、删帖清图、收藏占位 |
| 0.5.x | 个人主页 / 话题关注 / 订单评价、tabBar 图标、话题页与榜单、流畅度、订阅消息 / 朋友圈 / 水印 / 话题位、评论楼中楼 / 浏览量 / 排序 / 消息分类 |

---

## 八、出问题怎么查

- 编译/上传报 `compile_start`：看 `%LOCALAPPDATA%\微信开发者工具\User Data\*\WeappLog\logs\` 最新日志里的 `exec error`
- 云函数报 `-501001 resource not found`：集合不存在，跑一次 `setupCollections`
- 云函数报 `-604101`：缺 `config.json` 的 openapi 权限
- 新函数部署报 `Creating`：等 15–20 秒再部署一次
- 图片加载不出：存储权限不是「所有用户可读」，或 `getTempFileURL` 失败（看 `resolveImages`）
