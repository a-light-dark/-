// 一次性补丁：给 adminApi 加流量看板 + 广告位接口；给三个内容入口加屏蔽词命中计数；siteData 加广告下发
// 跑完即可删除
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const write = (p, s) => fs.writeFileSync(path.join(ROOT, p), s, 'utf8')

// ---------- 1. adminApi ----------
let api = read('cloudfunctions/adminApi/index.js')

// 1.1 写操作清单加广告
api = api.replace(
  "  'trash.restore', 'trash.purge', 'wordfilters.add', 'wordfilters.remove',\n",
  "  'trash.restore', 'trash.purge', 'wordfilters.add', 'wordfilters.remove',\n  'ads.save', 'ads.remove', 'ads.toggle',\n"
)

// 1.2 运营 / 分析员可读流量看板与广告列表；运营可改广告
api = api.replace(
  "const OPERATOR_WRITE = ['posts.remove', 'posts.setTop', 'comments.remove', 'reports.dismiss', 'reports.removePost', 'feedback.resolve', 'announcements.create', 'announcements.update', 'announcements.remove', 'wordfilters.add', 'wordfilters.remove']",
  "const OPERATOR_WRITE = ['posts.remove', 'posts.setTop', 'comments.remove', 'reports.dismiss', 'reports.removePost', 'feedback.resolve', 'announcements.create', 'announcements.update', 'announcements.remove', 'wordfilters.add', 'wordfilters.remove', 'ads.save', 'ads.remove', 'ads.toggle']"
)
api = api.replace(
  "const OPERATOR_READ = ['dashboard', 'posts.list', 'comments.list', 'reports.list', 'users.list', 'feedback.list', 'announcements.list', 'settings.get', 'audit.list', 'trash.list', 'wordfilters.list', 'posts.trace']",
  "const OPERATOR_READ = ['dashboard', 'posts.list', 'comments.list', 'reports.list', 'users.list', 'feedback.list', 'announcements.list', 'settings.get', 'audit.list', 'trash.list', 'wordfilters.list', 'posts.trace', 'analytics.overview', 'ads.list']"
)
api = api.replace(
  "const ANALYST_READ = ['dashboard', 'posts.list', 'comments.list', 'reports.list', 'users.list', 'feedback.list', 'announcements.list', 'settings.get', 'trash.list', 'wordfilters.list']",
  "const ANALYST_READ = ['dashboard', 'posts.list', 'comments.list', 'reports.list', 'users.list', 'feedback.list', 'announcements.list', 'settings.get', 'trash.list', 'wordfilters.list', 'analytics.overview', 'ads.list']"
)

// 1.3 敏感词列表带命中次数
api = api.replace(
  "      return { id: w._id, word: w.word, createdAt: ts(w.createdAt) }",
  "      return { id: w._id, word: w.word, hits: Number(w.hits || 0), lastHitAt: ts(w.lastHitAt), createdAt: ts(w.createdAt) }"
)

// 1.4 插入 analytics / ads 实现
const helpers = `// ============ 流量看板（内容与互动数据） ============
function dayStart(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

async function grabRecent(col, limit) {
  try {
    const r = await db.collection(col).orderBy('createdAt', 'desc').limit(limit).get()
    return r.data || []
  } catch (err) {
    return []
  }
}

async function analyticsOverview(event) {
  const days = Math.min(30, Math.max(7, Number(event.days) || 7))
  const now = Date.now()
  const today0 = dayStart(now)
  const from = today0 - (days - 1) * 86400000
  const packs = await Promise.all([
    grabRecent('posts', 1000),
    grabRecent('comments', 1000),
    grabRecent('users', 1000),
    grabRecent('likes', 1000),
    grabRecent('orders', 1000),
  ])
  const posts = packs[0]
  const comments = packs[1]
  const users = packs[2]
  const likes = packs[3]
  const orders = packs[4]
  const series = []
  for (let i = 0; i < days; i++) {
    const start = from + i * 86400000
    const end = start + 86400000
    const bucket = { day: new Date(start).toISOString().slice(5, 10), posts: 0, comments: 0, users: 0 }
    posts.forEach(function (p) {
      const t = ts(p.createdAt)
      if (t >= start && t < end) bucket.posts++
    })
    comments.forEach(function (c) {
      const t = ts(c.createdAt)
      if (t >= start && t < end) bucket.comments++
    })
    users.forEach(function (u) {
      const t = ts(u.createdAt)
      if (t >= start && t < end) bucket.users++
    })
    series.push(bucket)
  }
  const today = {
    posts: posts.filter(function (p) { return ts(p.createdAt) >= today0 }).length,
    comments: comments.filter(function (c) { return ts(c.createdAt) >= today0 }).length,
    users: users.filter(function (u) { return ts(u.createdAt) >= today0 }).length,
  }
  let totalViews = 0
  posts.forEach(function (p) { totalViews += Number(p.views || 0) })
  const active = {}
  posts.concat(comments).forEach(function (d) {
    if (d._openid && ts(d.createdAt) >= from) active[d._openid] = 1
  })
  const tagCount = {}
  posts.forEach(function (p) {
    ;(p.tags || []).forEach(function (t) { tagCount[t] = (tagCount[t] || 0) + 1 })
  })
  const topics = Object.keys(tagCount)
    .map(function (t) { return { tag: t, count: tagCount[t] } })
    .sort(function (a, b) { return b.count - a.count })
    .slice(0, 6)
  const brief = function (p) {
    return {
      id: p._id,
      content: String(p.content || '').slice(0, 40),
      nickname: p.nickname || '',
      views: Number(p.views || 0),
      likes: Number(p.likeCount || 0),
      comments: Number(p.commentCount || 0),
    }
  }
  const topPosts = posts.slice().sort(function (a, b) { return Number(b.views || 0) - Number(a.views || 0) }).slice(0, 5).map(brief)
  const topLiked = posts.slice().sort(function (a, b) { return Number(b.likeCount || 0) - Number(a.likeCount || 0) }).slice(0, 5).map(brief)
  return {
    ok: true,
    days: days,
    totals: {
      users: users.length,
      posts: posts.length,
      comments: comments.length,
      likes: likes.length,
      orders: orders.length,
      views: totalViews,
    },
    today: today,
    activeUsers: Object.keys(active).length,
    series: series,
    topics: topics,
    topPosts: topPosts,
    topLiked: topLiked,
  }
}

// ============ 广告位（首页 banner / 详情页底部）============
const AD_POSITIONS = ['home_banner', 'detail_bottom']
const AD_LINK_TYPES = ['none', 'post', 'page']

async function adsList() {
  try {
    const res = await db.collection('ads').orderBy('createdAt', 'desc').limit(100).get()
    return {
      ok: true,
      total: (res.data || []).length,
      list: (res.data || []).map(function (a) {
        return {
          id: a._id,
          title: a.title || '',
          image: a.image || '',
          position: a.position || 'home_banner',
          linkType: a.linkType || 'none',
          linkValue: a.linkValue || '',
          enabled: a.enabled !== false,
          weight: Number(a.weight || 0),
          startAt: ts(a.startAt),
          endAt: ts(a.endAt),
          views: Number(a.views || 0),
          clicks: Number(a.clicks || 0),
          createdAt: ts(a.createdAt),
        }
      }),
    }
  } catch (err) {
    return { ok: true, total: 0, list: [], msg: 'ads 集合还没建，先运行 setupCollections' }
  }
}

function adPayload(event) {
  const title = String(event.title || '').trim()
  const image = String(event.image || '').trim()
  const position = AD_POSITIONS.indexOf(event.position) > -1 ? event.position : 'home_banner'
  const linkType = AD_LINK_TYPES.indexOf(event.linkType) > -1 ? event.linkType : 'none'
  const linkValue = String(event.linkValue || '').trim()
  const weight = Math.min(100, Math.max(0, Number(event.weight) || 0))
  const startAt = Number(event.startAt) || 0
  const endAt = Number(event.endAt) || 0
  const enabled = event.enabled !== false
  return { title: title, image: image, position: position, linkType: linkType, linkValue: linkValue, weight: weight, startAt: startAt, endAt: endAt, enabled: enabled }
}

async function adsSave(event) {
  const p = adPayload(event)
  if (!p.title) return { ok: false, msg: '标题不能为空' }
  if (!p.image) return { ok: false, msg: '图片地址不能为空' }
  if (p.linkType === 'post' && !p.linkValue) return { ok: false, msg: '跳转帖子请填帖子 id' }
  if (p.linkType === 'page' && !p.linkValue) return { ok: false, msg: '跳转页面请填页面路径' }
  try {
    if (event.id) {
      await db.collection('ads').doc(String(event.id)).update({
        data: Object.assign({}, p, { updatedAt: db.serverDate() }),
      })
      return { ok: true, id: String(event.id) }
    }
    const added = await db.collection('ads').add({
      data: Object.assign({}, p, { views: 0, clicks: 0, createdAt: db.serverDate(), updatedAt: db.serverDate() }),
    })
    return { ok: true, id: added._id }
  } catch (err) {
    return { ok: false, msg: '保存失败：' + ((err && err.errMsg) || '未知错误') }
  }
}

async function adsRemove(id) {
  if (!id) return { ok: false, msg: '缺少广告 id' }
  try {
    await db.collection('ads').doc(String(id)).remove()
  } catch (err) {
    return { ok: false, msg: '这条广告不存在了' }
  }
  return { ok: true }
}

async function adsToggle(event) {
  if (!event.id) return { ok: false, msg: '缺少广告 id' }
  try {
    await db.collection('ads').doc(String(event.id)).update({
      data: { enabled: event.enabled !== false, updatedAt: db.serverDate() },
    })
  } catch (err) {
    return { ok: false, msg: '这条广告不存在了' }
  }
  return { ok: true }
}

`

const anchor = '// ============ exports.main ============'
if (api.indexOf(anchor) < 0) throw new Error('adminApi anchor missing')
api = api.replace(anchor, helpers + anchor)

// 1.5 插入 switch 分支
const caseAnchor = "      case 'posts.trace':"
const cases = `      case 'analytics.overview':
        res = await analyticsOverview(event)
        break
      case 'ads.list':
        res = await adsList()
        break
      case 'ads.save':
        res = await adsSave(event)
        if (res.ok) await audit('ads.save', 'ad', res.id, event.title || '')
        break
      case 'ads.remove':
        res = await adsRemove(event.id)
        if (res.ok) await audit('ads.remove', 'ad', event.id, '')
        break
      case 'ads.toggle':
        res = await adsToggle(event)
        if (res.ok) await audit('ads.toggle', 'ad', event.id, event.enabled === false ? 'off' : 'on')
        break
`
if (api.indexOf(caseAnchor) < 0) throw new Error('adminApi case anchor missing')
api = api.replace(caseAnchor, cases + caseAnchor)

write('cloudfunctions/adminApi/index.js', api)
console.log('adminApi patched')

// ---------- 2. 三个内容入口：屏蔽词命中计数 ----------
const wordPatch = (file, msgText) => {
  let s = read(file)
  const old = `async function checkWords(content) {
  try {
    const res = await db.collection('wordfilters').limit(200).get()
    const words = (res.data || []).map(function (w) { return String((w && w.word) || '').trim() }).filter(Boolean)
    if (!words.length) return { ok: true }
    const hit = words.find(function (w) { return content.indexOf(w) > -1 })
    if (hit) return { ok: false, msg: '${msgText}' }
    return { ok: true }
  } catch (err) {
    console.warn('读敏感词库失败（先放行）', err && err.errCode)
    return { ok: true }
  }
}`
  const neu = `async function checkWords(content) {
  try {
    const res = await db.collection('wordfilters').limit(200).get()
    const list = (res.data || []).filter(function (w) { return w && String(w.word || '').trim() })
    if (!list.length) return { ok: true }
    const hit = list.find(function (w) { return content.indexOf(String(w.word).trim()) > -1 })
    if (hit) {
      // 命中次数给管理台看（失败不影响拦截）
      try {
        await db.collection('wordfilters').doc(hit._id).update({
          data: { hits: db.command.inc(1), lastHitAt: db.serverDate() },
        })
      } catch (err) {
        console.warn('记录敏感词命中失败', err && err.errCode)
      }
      return { ok: false, msg: '${msgText}' }
    }
    return { ok: true }
  } catch (err) {
    console.warn('读敏感词库失败（先放行）', err && err.errCode)
    return { ok: true }
  }
}`
  if (s.indexOf(old) < 0) throw new Error(file + ' checkWords pattern missing')
  s = s.replace(old, neu)
  write(file, s)
  console.log(file + ' patched')
}
wordPatch('cloudfunctions/createPost/index.js', '内容里有不合适的词，换一下再发')
wordPatch('cloudfunctions/addComment/index.js', '评论里有不合适的词，换一下再发')
wordPatch('cloudfunctions/createOrder/index.js', '描述里有不合适的词，换一下再发')

// ---------- 3. siteData：下发广告 + 上报曝光/点击 ----------
const site = `// 公开数据网关：给所有用户读「公告」「首页 banner 文案」「广告位」
// 说明：announcements / settings / ads 集合权限是「所有用户不可读写」，
// 普通用户读不到，所以统一由这个云函数代读（服务端有管理员权限）。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function ts(v) {
  if (!v) return 0
  const d = new Date(v)
  return isNaN(d.getTime()) ? Number(v) || 0 : d.getTime()
}

async function loadAds() {
  try {
    const res = await db.collection('ads').where({ enabled: true }).limit(20).get()
    const now = Date.now()
    return (res.data || [])
      .filter(function (a) {
        const start = ts(a.startAt)
        const end = ts(a.endAt)
        return (!start || start <= now) && (!end || end >= now)
      })
      .sort(function (a, b) { return Number(b.weight || 0) - Number(a.weight || 0) })
      .map(function (a) {
        return {
          id: a._id,
          title: a.title || '',
          image: a.image || '',
          position: a.position || 'home_banner',
          linkType: a.linkType || 'none',
          linkValue: a.linkValue || '',
        }
      })
  } catch (err) {
    return []
  }
}

async function adReport(event) {
  const id = String(event.id || '')
  const type = event.type === 'click' ? 'click' : 'view'
  if (!id) return { ok: false, msg: '缺少广告 id' }
  try {
    const data = type === 'click' ? { clicks: _.inc(1) } : { views: _.inc(1) }
    await db.collection('ads').doc(id).update({ data: data })
    return { ok: true }
  } catch (err) {
    return { ok: false, msg: '广告不存在' }
  }
}

exports.main = async (event) => {
  const action = String((event && event.action) || '')
  if (action === 'adReport') return adReport(event || {})

  const out = { ok: true, announcements: [], bannerText: '', ads: [] }
  // 圈主在运营配置里可以关掉公告展示（announcementEnabled = false）
  let enabled = true
  try {
    const s = await db.collection('settings').where({ key: 'announcementEnabled' }).limit(1).get()
    if (s.data && s.data[0] && (s.data[0].value === false || String(s.data[0].value).toLowerCase() === 'false')) enabled = false
  } catch (err) {
    // 集合还没建/读不到时默认开
  }
  if (enabled) {
    try {
      const ann = await db
        .collection('announcements')
        .where({ active: true })
        .orderBy('pinned', 'desc')
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get()
      out.announcements = (ann.data || []).map(function (a) {
        return { id: a._id, title: a.title, content: a.content, pinned: a.pinned === true }
      })
    } catch (err) {
      // 集合还没建/读不到时给空列表，不挡首页
    }
  }
  try {
    const b = await db.collection('settings').where({ key: 'bannerText' }).limit(1).get()
    if (b.data && b.data[0]) out.bannerText = String(b.data[0].value || '')
  } catch (err) {
    // 同上
  }
  out.ads = await loadAds()
  return out
}
`
write('cloudfunctions/siteData/index.js', site)
console.log('siteData rewritten')

// ---------- 4. setupCollections 加 ads ----------
let setup = read('cloudfunctions/setupCollections/index.js')
if (setup.indexOf("'ads'") < 0) {
  setup = setup.replace(
    "const COLLECTIONS = [",
    "const COLLECTIONS = [\n  'ads',"
  )
  write('cloudfunctions/setupCollections/index.js', setup)
  console.log('setupCollections patched')
} else {
  console.log('setupCollections already has ads')
}
