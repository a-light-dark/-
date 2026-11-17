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
  openid: 'oO3Q4x' + (1000 + i) + 'LjdjHG-yb77GFRSkzTWs' + (i % 10),
  nickname: '同学' + (3000 + i),
  avatar: '😀',
  banned: i % 5 === 0,
  banReason: i % 5 === 0 ? '压测封禁' : '',
  role: i === 1 ? 'admin' : '',
  postCount: i % 4,
  createdAt: now - i * 86400 * 1000,
}))

const FEEDBACK = Array.from({ length: 8 }, (_, i) => ({
  id: 'fb_' + i,
  content: '反馈内容 ' + (i + 1) + '：希望增加按楼栋筛选的跑腿分类，顺便能不能加个夜间模式？',
  contact: i % 2 ? '' : 'wechat_' + i,
  nickname: '同学' + (4000 + i),
  avatar: '😀',
  status: i < 3 ? '待处理' : '已处理',
  done: i >= 3,
  time: '11-' + String(10 + (i % 5)).padStart(2, '0') + ' 20:0' + (i % 9),
  ts: now - i * 7200 * 1000,
}))

const ANNOUNCEMENTS = [
  { id: 'ann_0', title: '校园圈体验版上线啦', content: '有问题点「我的 → 建议反馈」，我们一条条看。', active: true, pinned: true, createdAt: now - 86400000 },
  { id: 'ann_1', title: '今晚 22:00 维护十分钟', content: '期间可能打不开帖子详情，忍一下。', active: true, pinned: false, createdAt: now - 3600 * 5000 },
  { id: 'ann_2', title: '五一假期互助单提醒', content: '放假期间跑腿单请写清楼栋和时间，避免白跑。', active: false, pinned: false, createdAt: now - 3600 * 9000 },
]

const TRASH = Array.from({ length: 6 }, (_, i) => ({
  id: 'trash_' + i,
  type: i % 3 === 0 ? 'comment' : 'post',
  docId: 'doc_' + i,
  content: i % 3 === 0 ? '被删评论：这里是一段测试评论内容' : '被删帖子：图书馆占座提醒，记得把书包拿走',
  deletedAt: now - i * 5400 * 1000,
  deletedBy: 'oO3Q4xlLjdjHG-yb77GFRSkzTWsU',
  by: '圈主',
}))

const WORDS = ['代开发票', '包过', '刷单', '加微信', '贷款', '博彩'].map((word, i) => ({
  id: 'word_' + i,
  word,
  createdAt: now - i * 86400 * 1000,
}))

const BACKUPS = Array.from({ length: 2 }, (_, i) => ({
  id: 'backup_' + i,
  size: 20264 + i * 1024,
  createdAt: now - i * 86400 * 1000,
  time: '11-1' + (5 + i) + ' 09:2' + i,
}))

const AUDIT = Array.from({ length: 12 }, (_, i) => ({
  id: 'audit_' + i,
  action: ['posts.setTop', 'users.ban', 'reports.removePost', 'settings.set', 'backup.create'][i % 5],
  targetType: 'post',
  targetId: 'post_' + i,
  detail: i % 5 === 3 ? 'bannerText = 校园圈公告位测试' : '',
  at: now - i * 1800 * 1000,
}))

const SETTINGS = {
  bannerText: '校园圈体验版上线啦',
  announcementEnabled: 'true',
  reportReplyText: '你举报的帖子已经被圈主删除了，感谢反馈～',
  feedbackReplyText: '谢谢反馈，已经收到了～',
}

function page(list, p, size) {
  const cur = Math.max(1, Number(p) || 1)
  const s = Math.min(50, Number(size) || 20)
  const start = (cur - 1) * s
  return {
    ok: true,
    list: list.slice(start, start + s),
    total: list.length,
    page: cur,
    pageSize: s,
    hasMore: start + s < list.length,
  }
}

export function mockCall(name, data) {
  const d = data || {}
  if (name === 'adminLogin') {
    if (d.action === 'changePassword') return { ok: true }
    if (d.action === 'logout') return { ok: true }
    if (d.action === 'whoami') return { ok: true, username: 'admin' }
    if (d.username === 'admin' && d.password === 'campus2026') {
      return { ok: true, token: 'mock-token', username: 'admin' }
    }
    return { ok: false, msg: '账号或密码不对（演示模式：admin / campus2026）' }
  }

  const action = d.action

  if (action === 'isAdmin') return { ok: true, admin: true, owner: true }

  if (action === 'dashboard') {
    return {
      ok: true,
      posts: POSTS.length,
      comments: 12,
      orders: 5,
      users: USERS.length,
      pendingReports: REPORTS.length,
      pendingFeedback: FEEDBACK.filter((f) => !f.done).length,
      trashCount: TRASH.length,
      wordCount: WORDS.length,
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
  if (action === 'feedback.list') return page(FEEDBACK, d.page, d.pageSize)
  if (action === 'announcements.list') return { ok: true, list: ANNOUNCEMENTS }
  if (action === 'settings.get') return { ok: true, settings: SETTINGS }
  if (action === 'audit.list') return page(AUDIT, d.page, d.pageSize)
  if (action === 'trash.list') return page(TRASH, d.page, d.pageSize)
  if (action === 'wordfilters.list') return { ok: true, list: WORDS, total: WORDS.length }
  if (action === 'backup.list') return { ok: true, list: BACKUPS, total: BACKUPS.length }

  if (action === 'backup.download') {
    return { ok: true, url: 'https://example.com/backup-demo.json' }
  }

  if (
    action === 'reports.dismiss' ||
    action === 'reports.removePost' ||
    action === 'posts.remove' ||
    action === 'posts.setTop' ||
    action === 'users.ban' ||
    action === 'users.unban' ||
    action === 'users.setRole' ||
    action === 'feedback.resolve' ||
    action === 'feedback.remove' ||
    action === 'announcements.create' ||
    action === 'announcements.update' ||
    action === 'announcements.remove' ||
    action === 'settings.set' ||
    action === 'trash.restore' ||
    action === 'trash.purge' ||
    action === 'wordfilters.add' ||
    action === 'wordfilters.remove' ||
    action === 'backup.create' ||
    action === 'backup.remove'
  ) {
    if (action === 'announcements.create') return { ok: true, id: 'ann_new_' + Date.now() }
    if (action === 'wordfilters.add') return { ok: true, id: 'word_new_' + Date.now() }
    if (action === 'backup.create') return { ok: true, id: 'backup_new_' + Date.now(), size: 20264 }
    return { ok: true }
  }

  return { ok: false, msg: '演示模式没有实现：' + action }
}
