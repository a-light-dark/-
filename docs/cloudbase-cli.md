# 用 CloudBase CLI（tcb）管云开发

这份文档记录 2026-11-18 接好的命令行链路：**不打开微信开发者工具也能部署云函数、调函数、看日志**。

## 一次性的准备（本机已做过）

```powershell
npm i -g @cloudbase/cli      # 装 CLI，当前 3.9.3
tcb login                    # 浏览器里授权（设备码流程），凭据存本机
tcb env list                 # 看环境
tcb env use cloud1-d6g26wz61eca836b8   # 设默认环境（本项目）
```

登录后本机保存凭据，后续命令不用再登录。凭据属于个人账号，**不要提交到仓库**。

## 本项目常用命令

```powershell
# 部署一个云函数（--dir 指目录，--force 覆盖）
tcb fn deploy search --dir cloudfunctions/search --force

# 看函数列表 / 函数详情
tcb fn list
tcb fn detail adminApi

# 直接在云端调用（不依赖小程序，调试接口最方便）
tcb fn invoke search --params '{"keyword":"日常","page":1}'
tcb fn invoke siteData --params '{"action":"homeMeta"}'

# 看日志
tcb logs search --query 'function_name:"search"'

# PC 后台静态托管（admin/web 构建出的 dist）
tcb hosting deploy admin/web/dist -e cloud1-d6g26wz61eca836b8
```

## 边界（很重要）

| 事情 | 能不能用 tcb | 替代办法 |
| --- | --- | --- |
| 部署/删除/调用云函数 | ✅ | — |
| 看函数日志、发布版本 | ✅ | — |
| 静态网站托管（PC 后台） | ✅ | — |
| 云存储文件管理 | ✅ `tcb storage` | — |
| **读/写 NoSQL 文档库**（posts、notices…） | ❌ 当前 CLI 的 `tcb db` 只面向 MySQL / 数据模型 | 云开发控制台「数据库」；或在支持 MCP 的客户端里挂 CloudBase MCP |
| 上传小程序体验版 | ❌ | 微信开发者工具 CLI（`cli.bat upload`） |

## 排错

- `No valid identity found` → 重新 `tcb login`。
- 登录页打不开或超时 → 本机走代理时先试 `Test-NetConnection 127.0.0.1 7890`；必要时给 `HTTPS_PROXY` 设好再跑。
- 新函数刚创建就部署会报「函数处于 Creating 状态」→ 等 20–30 秒重试（和微信开发者工具 CLI 的老问题一样）。
- 部署完调用返回 `FunctionName parameter could not be found` → 函数名拼错或环境不对，先 `tcb fn list` 确认。
