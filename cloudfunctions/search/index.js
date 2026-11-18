// 云函数：search —— 服务端分页搜索
// 之前客户端只拉最近 100 条再本地过滤，帖子多了就搜不全；
// 这里把「关键字匹配 + 分页」都交给数据库，客户端只翻页。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const PAGE = 20

// 云数据库的正则匹配不了数组元素（tags），所以「话题」这层用精确值匹配：
// 用户搜「日常」时，把它补成「日常投稿」再去查 tags，搜「交友」补成「脱单交友」
const TOPICS = ['日常投稿', '树洞', '表白墙', '新鲜事', '二手', '跑腿代取', '学习搭子', '失物招领', '脱单交友']

function expandTopics(keyword) {
  const hit = TOPICS.filter(function (t) { return t.indexOf(keyword) > -1 || keyword.indexOf(t) > -1 })
  if (TOPICS.indexOf(keyword) > -1 && hit.indexOf(keyword) < 0) hit.push(keyword)
  return hit.length ? hit : [keyword]
}

// 用户输入里可能有正则特殊字符，先转义，避免把 . * + 当语法
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 统一转成前端搜索列表要的字段（跟 utils/api.js 里的 normalizePost 对齐）
function toRow(doc) {
  return {
    id: doc._id,
    nickname: doc.nickname || '同学',
    avatar: doc.avatar || '😀',
    content: doc.content || '',
    tags: doc.tags || [],
    images: doc.images || [],
    likeCount: doc.likeCount || 0,
    commentCount: doc.commentCount || 0,
    views: doc.views || 0,
    createdAt: doc.createdAt || null,
    authorOpenid: doc._openid || '',
    anonymous: doc.anonymous === true || doc.nickname === '匿名同学',
  }
}

exports.main = async (event) => {
  const keyword = String(event.keyword || '').trim().slice(0, 30)
  if (!keyword) return { ok: true, posts: [], hasMore: false, page: 1, pageSize: PAGE, keyword: '' }

  const page = Math.max(1, Number(event.page) || 1)
  const pageSize = Math.min(50, Math.max(5, Number(event.pageSize) || PAGE))
  const reg = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })

  // 正文模糊匹配，或者话题标签命中（tags 是数组，正则查不了，改成一串精确值）
  const topicNames = expandTopics(keyword)
  const where = _.or([
    { content: reg },
    { tags: _.in(topicNames) },
  ])

  try {
    // 多取一条用来判断还有没有下一页（比再跑一次 count 便宜）
    const res = await db.collection('posts')
      .where(where)
      .orderBy('createdAt', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize + 1)
      .get()

    const rows = res.data || []
    const hasMore = rows.length > pageSize
    return {
      ok: true,
      keyword: keyword,
      page: page,
      pageSize: pageSize,
      posts: rows.slice(0, pageSize).map(toRow),
      hasMore: hasMore,
    }
  } catch (err) {
    console.error('[search] 查询失败', err)
    return { ok: false, msg: '搜索失败了，稍后再试', posts: [], hasMore: false, page: page, pageSize: pageSize }
  }
}
