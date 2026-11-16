// 离线/演示模式的数据（VITE_MOCK=true 时使用，方便没有云环境时看界面）
const now = Date.now()

const POSTS = Array.from({ length: 26 }, (_, i) => ({
  id: 'post_' + i,
  content: i % 3 === 0 ? '图书馆三楼靠窗的位置有人一起自习吗？带杯奶茶请你' : '压测示例帖子 #' + (i + 1),
  nickname: i % 4 === 0 ? '匿名同学' : '同学' + (1000 + i),
  avatar: i % 4 === 0 ? '🎭' : '😀',
  images: [],
  tags: ['日常投稿'],
  likeCount: (i * 7) % 23,
  commentCount: (i * 3) % 11,
  views: (i * 37) % 90,
  top: i === 0,
  createdAt: now - i * 3600 * 1000,
}))

const REPORTS = Array.from({ length: 26 }, (_, i) => ({
  id: 'report_' + i,
  postId: 'post_' + i,
  reason: ['垃圾广告', '色情低俗', '人身攻击', '不实信息'][i % 4],
  createdAt: now - i * 1800 * 1000,
  post: {
    content: '被举报的帖子内容 ' + (i + 1) + '：这里是一段比较长的示例文字，用来测试表格截断效果',
    nickname: '同学' + (2000 + i),
    avatar: '😀',
    images: [],
  },
}))

const USERS = Array.from({ length: 16 }, (_, i) => ({
  openid: 'openid_' + i,
  nickname: '同学' + (3000 + i),
  avatar: '😀',
  banned: i % 5 === 0,
  role: '',
  postCount: i % 4,
  createdAt: now - i * 86400 * 1000,
}))

function page(list, page, pageSize) {
  const p = Math.max(1, Number(page) || 1)
  const s = Math.min(50, Number(pageSize) || 20)
  const start = (p - 1) * s
  return {
    ok: true,
    list: list.slice(start, start + s),
    total: list.length,
    page: p,
    pageSize: s,
    hasMore: start + s < list.length,
  }
}

export function mockCall(name, data) {
  const d = data || {}
  if (name === 'adminLogin') {
    if (d.username === 'admin' && d.password === 'campus2026') {
      return { ok: true, token: 'mock-token', username: 'admin' }
    }
    return { ok: false, msg: '账号或密码不对（演示模式：admin / campus2026）' }
  }
  const action = d.action
  if (action === 'dashboard') {
    return {
      ok: true,
      posts: POSTS.length,
      comments: 12,
      orders: 5,
      users: USERS.length,
      pendingReports: REPORTS.length,
      pendingFeedback: 3,
      trashCount: 2,
      wordCount: 4,
      recentReports: REPORTS.slice(0, 3),
    }
  }
  if (action === 'reports.list') return page(REPORTS, d.page, d.pageSize)
  if (action === 'posts.list') {
    const kw = String(d.keyword || '').trim()
    const list = kw ? POSTS.filter((p) => p.content.indexOf(kw) > -1) : POSTS
    return page(list, d.page, d.pageSize)
  }
  if (action === 'users.list') {
    const kw = String(d.keyword || '').trim()
    const list = kw ? USERS.filter((u) => u.nickname.indexOf(kw) > -1) : USERS
    return page(list, d.page, d.pageSize)
  }
  if (action === 'feedback.list') return page([], d.page, d.pageSize)
  if (
    action === 'reports.dismiss' ||
    action === 'reports.removePost' ||
    action === 'posts.remove' ||
    action === 'posts.setTop' ||
    action === 'users.ban' ||
    action === 'users.unban' ||
    action === 'feedback.resolve'
  ) {
    return { ok: true }
  }
  return { ok: false, msg: '演示模式没有实现：' + action }
}
