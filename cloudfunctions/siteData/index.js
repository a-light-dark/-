// 公开数据网关：公告 / banner 文案 / 广告位 / 首页汇总（热榜+话题+公告+广告+版本号）
// 说明：announcements / settings / ads / meta 集合权限是「所有用户不可读写」，
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

// ---------- 进程级缓存（云函数实例复用期间有效，减少重复读） ----------
const CACHE_TTL = 20000
let cfgCache = { at: 0, data: null }
let postsCache = { at: 0, data: null }

async function loadConfig() {
  if (cfgCache.data && Date.now() - cfgCache.at < CACHE_TTL) return cfgCache.data
  const out = { announcements: [], bannerText: '', ads: [] }
  let enabled = true
  try {
    const s = await db.collection('settings').where({ key: 'announcementEnabled' }).limit(1).get()
    if (s.data && s.data[0] && (s.data[0].value === false || String(s.data[0].value).toLowerCase() === 'false')) enabled = false
  } catch (err) {}
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
    } catch (err) {}
  }
  try {
    const b = await db.collection('settings').where({ key: 'bannerText' }).limit(1).get()
    if (b.data && b.data[0]) out.bannerText = String(b.data[0].value || '')
  } catch (err) {}
  try {
    const now = Date.now()
    const res = await db.collection('ads').where({ enabled: true }).limit(20).get()
    out.ads = (res.data || [])
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
  } catch (err) {}
  cfgCache = { at: Date.now(), data: out }
  return out
}

async function versionsDoc() {
  try {
    const r = await db.collection('meta').doc('versions').get()
    const d = r.data || {}
    return { content: Number(d.content || 0), ads: Number(d.ads || 0), config: Number(d.config || 0) }
  } catch (err) {
    return { content: 0, ads: 0, config: 0 }
  }
}

// 最近 60 条帖子：热榜 + 话题分布都从这一份算，避免每个模块各扫一遍库
async function recentPosts() {
  if (postsCache.data && Date.now() - postsCache.at < CACHE_TTL) return postsCache.data
  try {
    const r = await db.collection('posts').orderBy('createdAt', 'desc').limit(60).get()
    postsCache = { at: Date.now(), data: r.data || [] }
    return postsCache.data
  } catch (err) {
    return []
  }
}

async function homeMeta(event) {
  const v = await versionsDoc()
  const want = event && event.versions
  if (
    !event.force &&
    want &&
    Number(want.content) === v.content &&
    Number(want.ads) === v.ads &&
    Number(want.config) === v.config
  ) {
    return { ok: true, unchanged: true, versions: v }
  }
  const posts = await recentPosts()
  const cfg = await loadConfig()
  // 今日热榜：今天发的帖子里点赞最多；今天没人发就退回最近帖子里点赞最多的
  let hot = null
  const today0 = new Date().setHours(0, 0, 0, 0)
  const todayPosts = posts.filter(function (p) {
    return ts(p.createdAt) >= today0
  })
  const pool = todayPosts.length ? todayPosts : posts
  if (pool.length) {
    const best = pool.slice().sort(function (a, b) {
      return Number(b.likeCount || 0) - Number(a.likeCount || 0)
    })[0]
    if (best) {
      hot = {
        post: {
          id: best._id,
          _id: best._id,
          content: best.content || '',
          tags: best.tags || [],
          nickname: best.nickname || '',
          avatar: best.avatar || '😀',
          likeCount: Number(best.likeCount || 0),
          commentCount: Number(best.commentCount || 0),
          views: Number(best.views || 0),
          createdAt: ts(best.createdAt),
          _openid: best._openid || '',
          anonymous: best.anonymous === true,
        },
        isToday: todayPosts.length > 0,
      }
    }
  }
  const tagCount = {}
  posts.forEach(function (p) {
    ;(p.tags || []).forEach(function (t) {
      tagCount[t] = (tagCount[t] || 0) + 1
    })
  })
  const topics = Object.keys(tagCount)
    .map(function (t) {
      return { tag: t, count: tagCount[t] }
    })
    .sort(function (a, b) {
      return b.count - a.count
    })
    .slice(0, 6)

  return {
    ok: true,
    unchanged: false,
    versions: v,
    hot: hot,
    topics: topics,
    announcements: cfg.announcements,
    bannerText: cfg.bannerText,
    ads: cfg.ads,
    debug: { postsRead: posts.length, cachedPosts: postsCache.at > 0 },
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
  if (action === 'homeMeta') return homeMeta(event || {})

  // 兼容旧接口：只返回公告 / banner / 广告
  const out = { ok: true, announcements: [], bannerText: '', ads: [] }
  const cfg = await loadConfig()
  out.announcements = cfg.announcements
  out.bannerText = cfg.bannerText
  out.ads = cfg.ads
  out.versions = await versionsDoc()
  return out
}
