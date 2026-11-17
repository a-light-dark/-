const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')

const section = `## 流量看板 / 广告位 / 屏蔽词命中（管理后台）

- **流量看板**（Web 后台 / 小程序管理台同数据）：近 7/14/30 天新增帖子、评论、同学柱状图；帖子总数 / 浏览总量 / 点赞 / 互助单 / 活跃同学（7 天内发过帖或评论）；浏览最多、点赞最多 Top5；话题分布。数据来自 \`adminApi\` 的 \`analytics.overview\`（扫最近 1000 条聚合，不额外花钱）。
- **真实 UV/PV 不在云开发里**：微信小程序后台 → 统计 → 访问分析，才有启动次数、访问人数、留存；本页是「内容与互动流量」。
- **广告位**：集合 \`ads\`（22 个集合之一），字段 \`title/image/position/linkType/linkValue/weight/enabled/startAt/endAt/views/clicks\`。位置 \`home_banner\`（首页 banner，已接入小程序首页）和 \`detail_bottom\`（详情页底部，接口已留、前端未放）。管理台「广告管理」负责增删改、开关、看曝光/点击/点击率。
- **广告下发接口**：\`siteData\`（公开云函数）返回 \`ads\` 数组，只给 \`enabled=true\` 且在投放时间窗内、按 \`weight\` 倒序；小程序端 \`api.fetchSiteData()\` 拿到的 \`ads\` 已把云存储 fileID 换成临时 https 链接。
- **曝光/点击上报**：\`siteData\` 的 \`adReport\` 动作（\`{action:'adReport', id, type:'view|click'}\`），小程序端 \`api.reportAd(id, type)\` 封装；首页加载时曝光一次、点广告时点击一次。
- **屏蔽词命中**：\`wordfilters\` 每个词多了 \`hits\`/\`lastHitAt\`；\`createPost\`/\`addComment\`/\`createOrder\` 命中时自动 \`inc(1)\`。Web 敏感词库支持「批量导入（一行一个/逗号分隔，单次 ≤100）」「复制全部」「按命中次数排序」，能直接看出哪类内容最常被拦。

`

function patch(file, anchor, text) {
  let s = fs.readFileSync(path.join(ROOT, file), 'utf8')
  if (s.indexOf('## 流量看板 / 广告位') > -1) {
    console.log(file + ' already patched')
    return
  }
  if (s.indexOf(anchor) < 0) throw new Error(file + ' anchor missing')
  s = s.replace(anchor, text + anchor)
  fs.writeFileSync(path.join(ROOT, file), s, 'utf8')
  console.log(file + ' patched')
}

patch('README.md', '## 怎么在微信开发者工具里打开', section)

// Web README：功能表补两行 + 数据来源说明
let web = fs.readFileSync(path.join(ROOT, 'admin/web/README.md'), 'utf8')
if (web.indexOf('流量看板') < 0) {
  web = web.replace(
    '| 数据备份 | 一键把 17 个集合导出 JSON 到云存储、拿临时下载链接、删备份 |',
    '| 数据备份 | 一键把 17 个集合导出 JSON 到云存储、拿临时下载链接、删备份 |\n| 流量看板 | 7/14/30 天新增柱状图、浏览/点赞/活跃同学 KPI、浏览与点赞 Top5、话题分布（来自 adminApi analytics.overview） |\n| 广告管理 | 首页 banner / 详情页底部广告位：图片、跳转（帖子/页面/不跳）、投放时间、权重、启用开关、曝光/点击/点击率 |'
  )
  fs.writeFileSync(path.join(ROOT, 'admin/web/README.md'), web, 'utf8')
  console.log('web README patched')
} else {
  console.log('web README already patched')
}
