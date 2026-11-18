// 云函数：board —— 本周榜单（热帖 Top5 + 活跃同学 Top5）
// 为什么放到服务端：
// 1) 以前是客户端拉 100 条帖子 + 200 条评论在本地算（一次进榜 400+ 次文档读）；
// 2) 现在只在服务端按「最近 7 天」查一次（走 createdAt 索引），60 秒内复用，客户端只拿 10 条结果；
// 3) 顺带避免把别人的 openid/全文一次性下发到客户端。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const WEEK_MS = 7 * 24 * 3600 * 1000
const SCAN_LIMIT = 200
const CACHE_MS = 60 * 1000

let cache = { at: 0, data: null }

function ts(v) {
  return v ? Number(new Date(v).getTime()) || 0 : 0
}

function topBy(list, key, n) {
  return list
    .slice()
    .sort(function (a, b) { return (Number(b[key]) || 0) - (Number(a[key]) || 0) })
    .slice(0, n)
}

async function loadWeek(since) {
  // 注意：库里的 createdAt 有可能是 ISO 字符串（历史数据/探针写入），
  // 直接用「时间范围 + 排序」查会一条都命中不到，所以先按时间倒序取一页，再在内存里筛 7 天。
  const safe = function (p) {
    return p.catch(function (err) {
      console.warn('榜单查询失败（按空处理）', err && (err.errMsg || err.message))
      return { data: [] }
    })
  }
  const [postsRes, commentsRes] = await Promise.all([
    safe(db.collection('posts').orderBy('createdAt', 'desc').limit(SCAN_LIMIT).get()),
    safe(db.collection('comments').orderBy('createdAt', 'desc').limit(SCAN_LIMIT).get()),
  ])
  const sinceMs = since.getTime()
  const keep = function (d) {
    return ts(d.createdAt) >= sinceMs
  }
  return {
    posts: (postsRes.data || []).filter(keep),
    comments: (commentsRes.data || []).filter(keep),
  }
}

function buildBoard(posts, comments, hotN, userN) {
  const hot = topBy(posts.filter(function (p) { return !p.deleted }), 'likeCount', hotN).map(function (p) {
    return {
      id: p._id,
      content: String(p.content || '').slice(0, 60),
      nickname: p.nickname || '同学',
      avatar: p.avatar || '😀',
      likeCount: Number(p.likeCount) || 0,
      score: Number(p.likeCount) || 0,
      ts: ts(p.createdAt),
    }
  })

  const map = {}
  function add(doc, field, weight) {
    const nick = String(doc.nickname || '').trim()
    if (!nick || nick === '匿名同学') return
    if (!map[nick]) {
      map[nick] = { nickname: nick, avatar: doc.avatar || '😀', postCount: 0, commentCount: 0, score: 0 }
    }
    map[nick][field] += 1
    map[nick].score += weight
  }
  posts.forEach(function (d) { add(d, 'postCount', 2) })
  comments.forEach(function (d) { add(d, 'commentCount', 1) })

  const users = Object.keys(map)
    .map(function (k) { return map[k] })
    .sort(function (a, b) { return b.score - a.score || a.nickname.localeCompare(b.nickname) })
    .slice(0, userN)

  return {
    hot: hot,
    users: users,
    counts: { posts: posts.length, comments: comments.length },
  }
}

exports.main = async (event) => {
  const hotN = Math.min(10, Math.max(1, Number(event && event.hot) || 5))
  const userN = Math.min(10, Math.max(1, Number(event && event.users) || 5))
  const force = !!(event && event.force)

  const now = Date.now()
  if (!force && cache.data && now - cache.at < CACHE_MS) {
    return Object.assign({ ok: true, cached: true, since: cache.data.since }, cache.data)
  }

  const sinceDate = new Date(now - WEEK_MS)
  const { posts, comments } = await loadWeek(sinceDate)
  const data = buildBoard(posts, comments, hotN, userN)
  data.since = ts(sinceDate)
  data.cached = false
  cache = { at: now, data: data }
  return Object.assign({ ok: true }, data)
}
