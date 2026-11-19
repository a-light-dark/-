# 数据库与性能（云开发 NoSQL）

> 一句话：这个项目的数据库不是「建个集合就能用」那么简单——**索引、字段类型、查询姿势**决定了同样一个页面是 10ms 还是 1s。这份文档把现在的家底、这次的改动、以及还没做的顺手列清楚。

## 1. 集合清单（27 个）

| 集合 | 存什么 | 客户端能直接读写吗 |
| --- | --- | --- |
| `posts` | 帖子（正文、图片、话题、点赞/评论数、浏览量、置顶） | 只读（写走云函数） |
| `comments` | 评论 + 楼中楼回复 | 只读 |
| `users` | 用户资料（昵称、头像、banned、role） | 只读 |
| `likes` / `favorites` | 点赞 / 收藏（每人每帖一条） | 仅创建者（客户端直接写自己的） |
| `follows` | 关注的话题 | 仅创建者 |
| `orders` | 互助/跑腿订单 | 只读（抢单、完成走云函数） |
| `reviews` | 订单互评 | 只读 |
| `notices` | 消息通知（评论/点赞/抢单/系统） | 自定义规则：只读 `toOpenid == 自己`，写禁止 |
| `reports` / `feedback` | 举报 / 建议反馈 | 不可读写（走云函数） |
| `announcements` | 公告 | 只读 |
| `ads` | 广告位（首页 banner / 详情页底部） | 只读 |
| `bans` | 封禁记录 | 不可读写 |
| `settings` | 运营配置（banner 文案、公告开关、话术） | 只读 |
| `wordfilters` / `wordlist` | 敏感词（明细 / 汇总单文档，给发帖时用） | 不可读写 |
| `audit_logs` | 管理台操作日志 | 不可读写 |
| `trash` | 删帖删除评论的回收站 | 不可读写 |
| `backups` | 数据库备份（JSON 存云存储） | 不可读写 |
| `admin_accounts` / `admin_sessions` | 后台账号 / 登录会话 | 不可读写 |
| `approvals` | 开发者改动待审单 | 不可读写 |
| `login_attempts` | 登录失败次数（限流） | 不可读写 |
| `rate_limits` | 按操作和用户计数。主键为操作前缀与 openid，`count` 为次数，`windowStart` 为窗口起点（Date） | 所有客户端不可读写，仅云函数访问 |
| `security_alerts` | 内容安全接口失败告警 | 不可读写 |
| `search_hot` | 热搜词计数 | 不可读写 |
| `meta` | 全局版本号 `versions {content, ads, config}` | 不可读写 |

安全规则的总原则：**客户端只能读（而且只读公开内容），所有写操作都在云函数里做**。`posts/comments/users/orders` 等用自定义规则 `{"read": true, "write": false}`；`notices/reports/feedback/...` 用 `{"read": false, "write": false}`。

## 2. 索引：现在有什么、还缺什么

### 已有

- `posts`：`createdAt` 降序、`likeCount` 降序、`views` 降序
- `notices`：`toOpenid` 升序 + `createdAt` 降序（复合，名字 `toOpenid_createdAt`）
- `admin_sessions`：`token` 升序（唯一，`token_1`）
- `admin_accounts`：`username` 升序（唯一，`username_1`）
- `comments`：`postId` 升序 + `createdAt` 降序（`postId_1_createdAt_-1`）
- 各集合的 `_id` 默认索引

> 上面三个 P0 索引是 2026-11-18 用 `tcb db nosql execute` 直接下 Mongo `createIndexes` 建的（见第 6 节命令），不用再手点。

### 还建议补（按收益排序，控制台 → 数据库 → 选集合 → 索引管理 → 添加索引）

| 集合 | 字段 | 为什么 | 优先级 |
| --- | --- | --- | --- |
| `likes` | `postId` 升序 + `_openid` 升序 | 点赞状态、点赞数 | P1 |
| `favorites` | `_openid` 升序 + `createdAt` 降序 | 我的收藏 | P1 |
| `posts` | `_openid` 升序 + `createdAt` 降序 | 我的帖子 | P1 |
| `comments` | `_openid` 升序 + `createdAt` 降序 | 历史评论 | P1 |
| `orders` | `createdAt` 降序 | 互助大厅列表 | P1 |
| `notices` | `toOpenid` 升序 + `read` 升序 | 未读红点 `count()` | P1 |
| `reports` / `feedback` | `createdAt` 降序 | 后台列表 | P2 |
| `trash` | `deletedAt` 降序 | 回收站列表 | P2 |
| `audit_logs` | `targetId` 升序 + `at` 降序 | 操作追溯 | P2 |
| `security_alerts` | `kind` 升序 + `createdAt` 降序 | 告警筛选 | P2 |
| `search_hot` | `count` 降序 | 热搜榜 | P2 |

数据量还小的时候缺索引「只是慢一点」，一旦帖子过千、会话过百，缺 P0 索引就是肉眼可见的卡。

## 3. 时间字段：统一用 `Date`，别存字符串

- 写入统一用 `db.serverDate()`（云函数里）或 `new Date()`（一次性脚本），**不要** `new Date().toISOString()`。
- 原因：范围查询（`createdAt >= 今天 0 点`、最近 7 天）对字符串是**直接查不到**的，而且排序结果也会乱。
- 历史数据已经踩过这个坑（帖子/评论/消息/订单/举报/用户/封禁里混进了 ISO 字符串），已经用 `maintain` 云函数统一转成 `Date`：46 条文档，0 失败。
- 以后再遇到，跑一遍（`maintain` 现在只认后台登录 token，先登录拿一个）：

```bash
# 1) 拿 token（密码换成你自己的）
tcb fn invoke adminLogin --params '{"action":"login","username":"admin","password":"campus2026"}'
# 2) 抽样看类型
tcb fn invoke maintain --params '{"action":"scan","token":"<上一步返回的 token>"}'
# 3) 试算（不写库）
tcb fn invoke maintain --params '{"action":"migrate","collections":["posts","comments"],"dryRun":true,"token":"<token>"}'
# 4) 真转
tcb fn invoke maintain --params '{"action":"migrate","collections":["posts","comments"],"dryRun":false,"token":"<token>"}'
```

> 为什么要 token：`maintain` 能批量改数据，之前它对任何小程序用户都开放（任何人不带 token 都能触发写入），属于权限漏洞；现在已经改成只允许圈主/管理员。`setupCollections` 同理：带 token 才能塞/删测试数据，全新环境还没建管理员账号时只放行「建集合」。

## 4. 查询姿势（写代码时照这个来）

1. **任何列表都有 `limit`**：没有 `limit` 的 `.get()` 在云开发里默认只给 100 条，但会让你误以为「数据就这么多」。
2. **`where + orderBy` 尽量命中索引**：没有复合索引时，云数据库仍能查，但会先按条件取再内存排序，数据一多就慢。
3. **`count()` 不要每屏都刷**：工作台已经加了 30 秒缓存（`dashboard`），红点用 `notices` 的 `unread`，别在首页反复 `count`。
4. **列表页一次拿全**：详情页从 3 次调用合并成 `postDetail` 一次；榜单从客户端 400 次文档读改成 `board` 一次（服务端 60 秒缓存）。
5. **配置类读取加版本号**：`meta.versions` + `siteData.homeMeta`，版本没变就只读 1 次。
6. **敏感词不要每次拉 200 条**：读 `wordlist/main` 单文档。注意汇总文档为空时会回退到 `wordfilters` 明细表（2026-11-19 踩过：`wordlist/main` 存在但 `words: []`，导致屏蔽词整体失效、连精确词都放行；现在两个文件都有兜底，后台词库为空时也会弹提示）。

## 5. 这轮实测的数字

| 场景 | 改之前 | 改之后 |
| --- | --- | --- |
| 首页首次加载（帖子+热榜+话题+公告广告） | ~225 次文档读 + 4 次云函数 | ~21 次读 + 2 次调用（20 秒内复访只读 1 次版本号） |
| 本周榜单（热帖+活跃同学） | 客户端 1+100+200 次读、2 次调用 | 1 次调用、服务端 60 秒缓存、客户端只拿 10 条 |
| 详情页打开 | 3 次云函数（帖子/点赞/评论） | 1 次 `postDetail` |
| 发帖/评论敏感词 | 每次读 200 条词 | 读 1 个汇总文档 |
| 管理台每个操作 | 每次查一次 `admin_sessions` | 内存缓存 15 秒（强制下线也能在 15 秒内生效） |
| 工作台刷新 | 12 次查询 | 30 秒内复用上一次结果 |
| 搜索热词写入 | 每搜一次写一次 | 同词 60 秒内只记一次 |

## 6. 用 CLI 直接改数据库（索引 / 安全规则）

给 `tcb` CLI 传 JSON 时，PowerShell 会把引号吃掉，所以用 node 直接调 CLI 入口最稳（`%TEMP%` 里放过一个 `tcb.cjs` 小工具，项目里也可以用同样的写法）：

```bash
# 建索引：Mongo 原生命令 createIndexes
tcb db nosql execute --command '[{"TableName":"comments","CommandType":"COMMAND","Command":"{\"createIndexes\":\"comments\",\"indexes\":[{\"key\":{\"postId\":1,\"createdAt\":-1},\"name\":\"postId_1_createdAt_-1\"}]}"}]'

# 看现有索引：listIndexes
tcb db nosql execute --command '[{"TableName":"comments","CommandType":"COMMAND","Command":"{\"listIndexes\":\"comments\"}"}]'

# 改集合安全规则（notices 现在就是这条）
tcb api tcb ModifySafeRule --body '{"EnvId":"cloud1-d6g26wz61eca836b8","CollectionName":"notices","AclTag":"CUSTOM","Rule":"{\"read\":\"doc.toOpenid == auth.openid\",\"write\":false}"}'
```

注意第二条规则的含义：客户端**只能读到 `toOpenid` 等于自己的消息**。所以客户端查询必须带上 `toOpenid`（`app.js` 的实时红点已经这么写了）；不带这个条件会被云开发判成「无法证明安全」而直接 `DATABASE_PERMISSION_DENIED`——这是设计如此，不是故障。

## 7. 已知还没做的

- **评论只加载前 100 条**：`postDetail` 现在一次给 100 条，超长楼中楼还没有「加载更多」。
- **搜索是正则全表扫**：`content` 上的模糊匹配用不到索引，数据上万后建议换成「分词 + 关键词字段」或外部搜索。
- **`audit_logs` / `backups` 没有自动清理**：现在量小，建议以后加「保留最近 N 条」的定时清理。
- **后台列表的 `count()` 仍每次执行**：帖子/举报/反馈列表都带 `count`，可以后续改成「估算 + 上拉加载」。
