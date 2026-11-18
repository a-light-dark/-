// utils/api.js —— 数据层
// 页面只调用这里的函数：云开发可用时读写云数据库，不可用时自动退回本地演示数据
const mock = require('./mock.js')
const format = require('./format.js')

function app() {
  return getApp() || {}
}
function repo() {
  return (app() && app().globalData) || {}
}
function cloudReady() {
  return !!(wx.cloud && repo().cloudReady)
}
function db() {
  return wx.cloud.database()
}
function myOpenid() {
  return repo().openid || ''
}
function myProfile() {
  return repo().userInfo || { nickname: '我', avatar: '😀' }
}

// 头像可能是表情（😀）也可能是图片地址（cloud:// 或临时文件路径），渲染时用不同的标签
function isImagePath(value) {
  return /^(cloud|https?|wxfile):\/\//.test(String(value || ''))
}

// 本地演示模式下的收藏（内存里记着，重启就没了；云端模式存 favorites 集合）
const localFavorites = {}

// 等 app.js 里的云开发登录完成（只会真正执行一次）
function ensureLogin() {
  const a = app()
  if (!a || typeof a.ready !== 'function') return Promise.resolve(false)
  return a.ready()
}

// run(云端实现, 本地实现)：先等登录完成，再按云端是否可用来选
function run(cloudTask, mockTask) {
  return ensureLogin().then(function () {
    return cloudReady() ? cloudTask() : mockTask()
  })
}

// 各种时间值（Date / 时间戳 / 字符串）统一成毫秒数，方便排序
function toTs(value) {
  if (!value) return 0
  const ts = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return isNaN(ts) ? 0 : ts
}

/* ================= 用户资料 ================= */

// app.js 的 ready() 里兜底用：只「读」users 里的资料，不写库
// （users 集合权限已收紧成「所有用户可读」，客户端写不进去；首次创建由 login 云函数做）
function ensureProfile(openid) {
  return db().collection('users').where({ _openid: openid }).limit(1).get().then(function (res) {
    return (res.data || [])[0] || null
  })
}

// 读取当前用户的资料（带 _id，方便更新）；离线时返回全局缓存的那份
function fetchProfile() {
  return run(function () {
    return db().collection('users').where({ _openid: myOpenid() }).limit(1).get().then(function (res) {
      const doc = (res.data || [])[0]
      return doc || null
    })
  }, function () {
    return myProfile()
  })
}

// 把本地挑好的图片传到云存储，返回 cloud:// 开头的 fileID（<image> 能直接显示）
function uploadAvatar(localPath) {
  if (!cloudReady()) return Promise.reject(new Error('云开发没连上，头像先传不上去'))
  const matched = /\.(\w+)$/.exec(String(localPath || ''))
  const ext = matched ? matched[1].toLowerCase() : 'png'
  const cloudPath = 'avatars/' + myOpenid() + '/' + Date.now() + '.' + ext
  return wx.cloud.uploadFile({ cloudPath: cloudPath, filePath: localPath }).then(function (res) {
    return res.fileID
  })
}

// 发帖用的图片：传到云存储的 posts/<openid>/ 下，返回 cloud:// 开头的 fileID
function uploadPostImage(localPath) {
  if (!cloudReady()) return Promise.reject(new Error('云开发没连上，图片先传不上去'))
  if (!myOpenid()) return Promise.reject(new Error('还没登录成功，等一秒再试'))
  const matched = /\.(\w+)$/.exec(String(localPath || ''))
  let ext = matched ? matched[1].toLowerCase() : 'jpg'
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].indexOf(ext) === -1) ext = 'jpg'
  const cloudPath = 'posts/' + myOpenid() + '/' + Date.now() + '-' + Math.floor(Math.random() * 100000) + '.' + ext
  return wx.cloud.uploadFile({ cloudPath: cloudPath, filePath: localPath }).then(function (res) {
    return res.fileID
  })
}
// 当前是不是真的连着云开发（页面用来决定要不要先传图 / 走本地演示）
function isCloudReady() {
  return cloudReady()
}

// 删掉云存储里的文件（发帖失败时清理刚上传的图片，避免存储里堆孤儿文件）
function deleteFiles(fileIDs) {
  const list = (fileIDs || [])
    .map(function (id) { return String(id || '') })
    .filter(function (id) { return id.indexOf('cloud://') === 0 })
  if (!list.length || !cloudReady()) return Promise.resolve(false)
  return wx.cloud.deleteFile({ fileList: list }).then(function () {
    return true
  }).catch(function (err) {
    console.warn('清理图片失败（不影响使用）', err)
    return false
  })
}


function saveProfile(input) {
  const nickname = String((input && input.nickname) || '').trim()
  const avatar = (input && input.avatar) || ''
  if (nickname.length < 2 || nickname.length > 12) {
    return Promise.reject(new Error('昵称需要 2-12 个字'))
  }

  return run(function () {
    // 走云函数：昵称要过内容安全检测，头像 fileID 由客户端传上来
    return wx.cloud.callFunction({
      name: 'updateProfile',
      data: { nickname: nickname, avatar: avatar },
    }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '保存失败')
      return result.profile || { nickname: nickname, avatar: avatar || '😀' }
    })
  }, function () {
    return { nickname: nickname, avatar: avatar || myProfile().avatar }
  }).then(function (profile) {
    const g = repo()
    if (g) g.userInfo = profile
    return profile
  })
}

/* ================= 统一数据格式 ================= */

// 把 cloud:// 图片批量换成临时 https 链接：
// <image> 直接吃 cloud:// 在真机体验版上偶尔加载不出来，换成临时链接最稳。
function resolveImages(list) {
  if (!cloudReady() || !list || !list.length) return Promise.resolve(list)
  const fileIDs = []
  list.forEach(function (item) {
    if (!item || !item.images || !item.images.length) return
    item.images.forEach(function (fid) {
      if (fid && fileIDs.indexOf(fid) === -1) fileIDs.push(fid)
    })
  })
  if (!fileIDs.length) return Promise.resolve(list)
  return wx.cloud.getTempFileURL({ fileList: fileIDs }).then(function (res) {
    const map = {}
    ;(res.fileList || []).forEach(function (f) {
      map[f.fileID] = f.tempFileURL || f.fileID
    })
    list.forEach(function (item) {
      if (!item || !item.images || !item.images.length) return
      item.images = item.images.map(function (fid) { return map[fid] || fid })
    })
    return list
  }).catch(function () {
    return list
  })
}

function normalizePost(doc) {
  return {
    id: doc._id,
    nickname: doc.nickname || '同学',
    avatar: doc.avatar || '😀',
    avatarIsImage: isImagePath(doc.avatar),
    content: doc.content || '',
    tags: doc.tags || [],
    images: doc.images || [],
    likeCount: doc.likeCount || 0,
    commentCount: doc.commentCount || 0,
    views: doc.views || 0,
    createdAt: doc.createdAt,
    time: format.relativeTime(doc.createdAt),
    mine: doc._openid === myOpenid(),
    authorOpenid: doc._openid || '',
    anonymous: doc.anonymous === true || doc.nickname === '匿名同学',
  }
}

function normalizeLocalPost(p) {
  return {
    id: String(p.id),
    nickname: p.nickname || '我',
    avatar: p.avatar || '😀',
    avatarIsImage: isImagePath(p.avatar),
    content: p.content || '',
    tags: p.tags || [],
    images: p.images || [],
    likeCount: p.likeCount || 0,
    commentCount: p.commentCount || 0,
    views: p.views || 0,
    createdAt: null,
    time: p.time || '刚刚',
    mine: p.mine === true || p.nickname === '我',
    authorOpenid: '',
    anonymous: p.anonymous === true || p.nickname === '匿名同学',
  }
}

function normalizeComment(doc) {
  return {
    id: doc._id,
    postId: doc.postId || '',
    nickname: doc.nickname || '同学',
    avatar: doc.avatar || '😀',
    avatarIsImage: isImagePath(doc.avatar),
    content: doc.content || '',
    parentId: doc.parentId || '',
    replyTo: doc.replyTo || '',
    mine: doc._openid === myOpenid(),
    createdAt: doc.createdAt,
    time: format.relativeTime(doc.createdAt),
  }
}

function normalizeLocalComment(c) {
  return {
    id: String(c.id),
    postId: String(c.postId || ''),
    nickname: c.nickname || '同学',
    avatar: c.avatar || '😀',
    avatarIsImage: isImagePath(c.avatar),
    content: c.content || '',
    parentId: c.parentId ? String(c.parentId) : '',
    replyTo: c.replyTo || '',
    mine: c.mine === true,
    createdAt: null,
    time: c.time || '刚刚',
  }
}

function statusClassOf(status) {
  if (status === '待接单') return 'pending'
  if (status === '已接单') return 'taken'
  if (status === '待确认') return 'confirming'
  if (status === '已撤销') return 'cancelled'
  return 'done'
}

function normalizeOrder(doc) {
  const status = doc.status || '待接单'
  return {
    id: doc._id,
    nickname: doc.nickname || '同学',
    avatar: doc.avatar || '😀',
    avatarIsImage: isImagePath(doc.avatar),
    content: doc.content || '',
    amount: Number(doc.amount || 0).toFixed(2),
    status: status,
    statusClass: statusClassOf(status),
    createdAt: doc.createdAt,
    time: format.relativeTime(doc.createdAt),
    mine: doc._openid === myOpenid(),
    takenByMe: !!doc.takerOpenid && doc.takerOpenid === myOpenid(),
    takerName: doc.takerName || '',
  }
}

function normalizeLocalOrder(o) {
  const status = o.status || '待接单'
  return {
    id: String(o.id),
    nickname: o.nickname || '我',
    avatar: o.avatar || '😀',
    avatarIsImage: isImagePath(o.avatar),
    content: o.content || '',
    amount: Number(o.amount || 0).toFixed(2),
    status: status,
    statusClass: statusClassOf(status),
    createdAt: null,
    time: o.time || '刚刚',
    mine: !!o.mine,
    takenByMe: !!o.takenByMe,
  }
}

/* ================= 帖子 ================= */

function fetchPosts(options) {
  const opts = options || {}
  const page = opts.page || 0
  const pageSize = opts.pageSize || 10
  const tag = opts.tag || ''
  // 排序：new 最新 / hot 最热（点赞）/ views 最多浏览
  const sort = opts.sort || 'new'
  const sortKey = sort === 'hot' ? 'likeCount' : sort === 'views' ? 'views' : 'createdAt'

  return run(function () {
    const coll = db().collection('posts')
    // 按板块筛选：先查出来再按时间排（避免 where + orderBy 要求复合索引）
    if (tag) {
      return coll.where({ tags: tag }).limit(100).get().then(function (res) {
        const list = (res.data || []).map(normalizePost)
        list.sort(function (a, b) {
          return sort === 'new'
            ? toTs(b.createdAt) - toTs(a.createdAt)
            : (b[sortKey] || 0) - (a[sortKey] || 0)
        })
        return resolveImages(list).then(function (l) {
          return { list: l, hasMore: false, offline: false }
        })
      })
    }
    return coll.orderBy(sortKey, 'desc').skip(page * pageSize).limit(pageSize).get().then(function (res) {
      const list = (res.data || []).map(normalizePost)
      return resolveImages(list).then(function (l) {
        return { list: l, hasMore: l.length === pageSize, offline: false }
      })
    })
  }, function () {
    let all = tag
      ? mock.POSTS.filter(function (p) { return (p.tags || []).indexOf(tag) > -1 })
      : mock.POSTS.slice()
    all = all.slice()
    if (sort === 'hot') {
      all.sort(function (a, b) { return (b.likeCount || 0) - (a.likeCount || 0) })
    } else if (sort === 'views') {
      all.sort(function (a, b) { return (b.views || 0) - (a.views || 0) })
    }
    return { list: all.map(normalizeLocalPost), hasMore: false, offline: true }
  })
}

// 「今日热榜」：优先取今天发的帖子里点赞最多的那条。
// 云数据库 where(createdAt >= 今天零点) + orderBy(likeCount) 需要复合索引，
// 所以按 createdAt 倒序拿最近 60 条，再在本地筛「今天」并按点赞排序；
// 今天还没人发帖时，退回全站点赞最高的一条，并把 isToday 标成 false（前端换标题）。
function fetchHotPost() {
  return run(function () {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const startMs = start.getTime()
    return db().collection('posts').orderBy('createdAt', 'desc').limit(60).get().then(function (res) {
      const docs = res.data || []
      const today = docs.filter(function (d) {
        return d.createdAt && new Date(d.createdAt).getTime() >= startMs
      })
      if (today.length) {
        today.sort(function (a, b) { return (b.likeCount || 0) - (a.likeCount || 0) })
        return resolveImages([normalizePost(today[0])]).then(function (l) {
          return { post: l[0], isToday: true }
        })
      }
      return db().collection('posts').orderBy('likeCount', 'desc').limit(1).get().then(function (r2) {
        const doc = r2.data && r2.data[0]
        if (!doc) return { post: null, isToday: false }
        return resolveImages([normalizePost(doc)]).then(function (l) {
          return { post: l[0], isToday: false }
        })
      })
    })
  }, function () {
    const sorted = mock.POSTS.slice().sort(function (a, b) {
      return (b.likeCount || 0) - (a.likeCount || 0)
    })
    return { post: sorted.length ? normalizeLocalPost(sorted[0]) : null, isToday: false }
  })
}

// ===== 话题 =====
// 9 个话题（5 个板块 + 4 个分类入口），每个带 emoji 和一句话介绍，话题页用
const TOPIC_LIST = [
  { name: '日常投稿', emoji: '📝', desc: '随手记录校园日常，分享今天的小确幸。' },
  { name: '树洞', emoji: '🌳', desc: '说点不方便当面说的话，这里匿名也没关系。' },
  { name: '表白墙', emoji: '💌', desc: '喜欢就说出来，说不定对方也在等这句话。' },
  { name: '新鲜事', emoji: '📢', desc: '校园里刚发生的事，第一时间告诉大家。' },
  { name: '二手', emoji: '📦', desc: '毕业甩卖、闲置出清，便宜好物别浪费。' },
  { name: '跑腿代取', emoji: '🏃', desc: '取快递、带饭、拿外卖，发个悬赏有人接。' },
  { name: '学习搭子', emoji: '📚', desc: '找自习、考试、保研一起卷的同学。' },
  { name: '失物招领', emoji: '🔑', desc: '丢了东西来这儿找，捡到东西也来这儿还。' },
  { name: '脱单交友', emoji: '💘', desc: '认真认识新朋友，先从共同话题开始。' },
]

// 拿话题的展示信息（没有配置的话题也能用，给个兜底）
function topicMeta(name) {
  for (let i = 0; i < TOPIC_LIST.length; i++) {
    if (TOPIC_LIST[i].name === name) return TOPIC_LIST[i]
  }
  return { name: name, emoji: '#', desc: '这个话题下的帖子' }
}

// 首页公开数据：公告 + banner 文案 + 广告位（由 siteData 云函数代读，普通用户读不到那几个集合）
function normalizeAd(a) {
  const image = String((a && a.image) || '')
  return {
    id: String((a && (a.id || a._id)) || ''),
    title: String((a && a.title) || ''),
    image: image,
    imageIsCloud: image.indexOf('cloud://') === 0,
    position: String((a && a.position) || 'home_banner'),
    linkType: String((a && a.linkType) || 'none'),
    linkValue: String((a && a.linkValue) || ''),
    startAt: Number((a && a.startAt) || 0),
    endAt: Number((a && a.endAt) || 0),
  }
}

// 广告只在投放时间窗内展示：服务端算过一次，客户端读缓存时再判一次，避免缓存里的广告过期还在
function liveAds(list) {
  const now = Date.now()
  return (list || []).filter(function (a) {
    if (a.startAt && a.startAt > now) return false
    if (a.endAt && a.endAt < now) return false
    return true
  })
}

// 广告图如果是云存储 fileID，换成临时 https 链接，<image> 能直接显示
function resolveAdImages(list) {
  const items = (list || []).map(normalizeAd)
  const cloudOnes = items.filter(function (a) { return a.imageIsCloud })
  if (!cloudOnes.length || !cloudReady()) return Promise.resolve(items)
  return wx.cloud
    .getTempFileURL({ fileList: cloudOnes.map(function (a) { return a.image }) })
    .then(function (res) {
      const map = {}
      ;((res && res.fileList) || []).forEach(function (f) {
        if (f && f.fileID) map[f.fileID] = f.tempFileURL || f.fileID
      })
      return items.map(function (a) {
        if (a.imageIsCloud && map[a.image]) a.image = map[a.image]
        return a
      })
    })
    .catch(function () {
      return items
    })
}

function fetchSiteData() {
  const empty = { ok: true, announcements: [], bannerText: '', ads: [] }
  if (!cloudReady()) return Promise.resolve(empty)
  return wx.cloud
    .callFunction({ name: 'siteData', data: {} })
    .then(function (r) {
      const res = (r && r.result) || empty
      return resolveAdImages(res.ads || []).then(function (ads) {
        return {
          ok: true,
          announcements: res.announcements || [],
          bannerText: res.bannerText || '',
          ads: ads,
        }
      })
    })
    .catch(function () {
      return empty
    })
}

// 广告曝光/点击上报（失败不影响用户看内容）
function reportAd(id, type) {
  if (!id || !cloudReady()) return Promise.resolve({ ok: false })
  return wx.cloud
    .callFunction({ name: 'siteData', data: { action: 'adReport', id: String(id), type: type === 'click' ? 'click' : 'view' } })
    .then(function (r) {
      return (r && r.result) || { ok: true }
    })
    .catch(function () {
      return { ok: false }
    })
}

// 首页汇总：热榜 + 话题运营位 + 公告 + banner + 广告，一次请求拿全。
// 服务端带版本号（meta.versions）回来：没变就直接用本地缓存，连数据库都不读。
function fetchHomeMeta(force) {
  const empty = { hot: null, topics: [], announcements: [], bannerText: '', ads: [] }
  const cached = wx.getStorageSync('homeMeta') || null
  function fromCache() {
    const base = (cached && cached.meta) || empty
    const list = liveAds(base.ads || [])
    return {
      unchanged: true,
      meta: Object.assign({}, base, { ads: list }),
      staleAd: list.length !== ((base.ads || []).length),
    }
  }
  if (!cloudReady()) {
    return Promise.resolve(fromCache())
  }
  return wx.cloud
    .callFunction({
      name: 'siteData',
      data: { action: 'homeMeta', force: !!force, versions: (cached && cached.versions) || null },
    })
    .then(function (r) {
      const res = (r && r.result) || {}
      if (res.unchanged && cached) return fromCache()
      if (!res.ok) throw new Error(res.msg || '首页数据加载失败')
      const topics = (res.topics || []).map(function (t) {
        const m = topicMeta(t.tag)
        return { tag: t.tag, emoji: m.emoji, desc: m.desc, count: t.count }
      })
      const hot = res.hot && res.hot.post ? { post: normalizePost(res.hot.post), isToday: !!res.hot.isToday } : null
      return resolveAdImages(res.ads || []).then(function (ads) {
        const meta = {
          hot: hot,
          topics: topics,
          announcements: (res.announcements || []).slice(0, 3),
          bannerText: res.bannerText || '',
          ads: liveAds(ads)
            .filter(function (a) {
              return (a.position || 'home_banner') === 'home_banner'
            })
            .slice(0, 1),
        }
        wx.setStorageSync('homeMeta', { versions: res.versions || null, meta: meta })
        return { unchanged: false, meta: meta }
      })
    })
    .catch(function (err) {
      if (cached && cached.meta) return fromCache()
      throw err
    })
}


function fetchHotTopics(limit) {  const n = limit || 6
  function countFrom(posts) {
    const map = {}
    posts.forEach(function (p) {
      const tags = p.tags || []
      tags.forEach(function (t) {
        const name = String(t || '').trim()
        if (!name) return
        map[name] = (map[name] || 0) + 1
      })
    })
    return Object.keys(map)
      .map(function (name) {
        const meta = topicMeta(name)
        return { tag: name, emoji: meta.emoji, desc: meta.desc, count: map[name] }
      })
      .sort(function (a, b) { return b.count - a.count })
      .slice(0, n)
  }
  return run(function () {
    return db().collection('posts').orderBy('createdAt', 'desc').limit(200).get().then(function (res) {
      return countFrom(res.data || [])
    })
  }, function () {
    return countFrom(mock.POSTS)
  })
}

// 本周榜单（热帖 Top5 + 活跃同学 Top5）：一次云函数拿全。
// 以前是客户端拉 100 条帖子 + 200 条评论在本地算（一次进榜 400+ 次文档读、两个请求）；
// 现在服务端按最近 7 天查（走 createdAt 索引）+ 60 秒缓存，客户端只拿 10 条结果。
function fetchBoard(hotN, userN) {
  const hot = hotN || 5
  const users = userN || 5
  function normalizeRow(row) {
    const avatar = row.avatar || '😀'
    return {
      id: row.id,
      content: row.content || '',
      nickname: row.nickname || '同学',
      avatar: avatar,
      avatarIsImage: isImagePath(avatar),
      likeCount: Number(row.likeCount) || 0,
      score: Number(row.score) || 0,
      ts: Number(row.ts) || 0,
    }
  }
  return run(function () {
    return wx.cloud.callFunction({ name: 'board', data: { hot: hot, users: users } }).then(function (res) {
      const r = res.result || {}
      if (!r.ok) throw new Error(r.msg || '榜单加载失败')
      return {
        hot: (r.hot || []).map(normalizeRow),
        users: (r.users || []).map(normalizeRow),
      }
    })
  }, function () {
    const sorted = mock.POSTS.slice().sort(function (a, b) {
      return (b.likeCount || 0) - (a.likeCount || 0)
    })
    const map = {}
    mock.POSTS.forEach(function (p) {
      const n = String(p.nickname || '').trim()
      if (!n || n === '匿名同学') return
      if (!map[n]) map[n] = { nickname: n, avatar: p.avatar || '😀', postCount: 0, commentCount: 0, score: 0 }
      map[n].postCount += 1
      map[n].score += 2
    })
    ;(mock.COMMENTS || []).forEach(function (c) {
      const n = String(c.nickname || '').trim()
      if (!n || n === '匿名同学') return
      if (!map[n]) map[n] = { nickname: n, avatar: c.avatar || '😀', postCount: 0, commentCount: 0, score: 0 }
      map[n].commentCount += 1
      map[n].score += 1
    })
    return {
      hot: sorted.slice(0, hot).map(normalizeLocalPost),
      users: Object.keys(map).map(function (k) { return map[k] })
        .sort(function (a, b) { return b.score - a.score })
        .slice(0, users)
        .map(function (u) {
          return {
            nickname: u.nickname,
            avatar: u.avatar,
            avatarIsImage: isImagePath(u.avatar),
            postCount: u.postCount,
            commentCount: u.commentCount,
            score: u.score,
          }
        }),
    }
  })
}

// 搜索：内容 / 话题 / 昵称
// 云数据库的正则没法直接匹配数组里的元素（tags），校园圈子数据量小，
// 就取最近 100 条在本地过滤：简单、不会漏话题，也不用建索引。
function matchKeyword(post, kw) {
  const keyword = String(kw || '').toLowerCase()
  if (!keyword) return false
  const content = String(post.content || '').toLowerCase()
  const nick = String(post.nickname || '').toLowerCase()
  const tags = (post.tags || []).join(' ').toLowerCase()
  return content.indexOf(keyword) > -1 || nick.indexOf(keyword) > -1 || tags.indexOf(keyword) > -1
}

// 搜索：走 search 云函数按页取（服务端匹配 + 分页），不再只查最近 100 条
// 返回 { posts, hasMore, page }，posts 里的图片已换成可直接渲染的临时链接
function searchPosts(keyword, page) {
  const kw = String(keyword || '').trim()
  const pageNo = Math.max(1, Number(page) || 1)
  if (!kw) return Promise.resolve({ posts: [], hasMore: false, page: 1 })
  return run(function () {
    return wx.cloud.callFunction({ name: 'search', data: { keyword: kw, page: pageNo } }).then(function (res) {
      const result = (res && res.result) || {}
      if (result.ok === false) throw new Error(result.msg || '搜索失败')
      const list = (result.posts || []).map(normalizePost)
      return resolveImages(list).then(function (ready) {
        return { posts: ready, hasMore: result.hasMore === true, page: pageNo }
      })
    })
  }, function () {
    const all = mock.POSTS.map(normalizeLocalPost).filter(function (p) {
      return matchKeyword(p, kw)
    })
    const pageSize = 20
    const start = (pageNo - 1) * pageSize
    return { posts: all.slice(start, start + pageSize), hasMore: all.length > start + pageSize, page: pageNo }
  })
}

// 热搜词：search 云函数统计的真实搜索次数榜（没网/没表时返回默认词）
const DEFAULT_HOT_WORDS = ['图书馆', '食堂', '考试周', '社团', '失物招领', '二手', '跑腿', '脱单']

function searchHotWords() {
  return wx.cloud.callFunction({ name: 'search', data: { action: 'hot' } })
    .then(function (res) {
      const result = (res && res.result) || {}
      const words = (result.words || []).map(function (w) { return w.word }).filter(Boolean)
      // 真实热词不够 6 个时用默认词补位，页面不至于空荡荡
      const merged = words.slice()
      DEFAULT_HOT_WORDS.forEach(function (w) {
        if (merged.length < 8 && merged.indexOf(w) < 0) merged.push(w)
      })
      return merged
    })
    .catch(function (err) {
      console.warn('[api] 热搜词取不到，用默认词', err && (err.errMsg || err.message))
      return DEFAULT_HOT_WORDS
    })
}

function fetchPost(id) {
  const postId = String(id || '')
  return run(function () {
    return db().collection('posts').doc(postId).get().then(function (res) {
      const post = normalizePost(res.data)
      const openid = myOpenid()
      // 收藏集合可能还没建，查不到就当没收藏，别让整页报错
      const favQuery = db().collection('favorites').where({ postId: postId, _openid: openid }).limit(1).get()
        .catch(function () { return { data: [] } })
      return Promise.all([
        db().collection('likes').where({ postId: postId, _openid: openid }).limit(1).get(),
        favQuery,
      ]).then(function (rs) {
        return resolveImages([post]).then(function (l) {
          return {
            post: l[0],
            liked: (rs[0].data || []).length > 0,
            favorited: (rs[1].data || []).length > 0,
            offline: false,
          }
        })
      })
    })
  }, function () {
    const found = mock.POSTS.filter(function (p) { return String(p.id) === postId })[0]
    return {
      post: found ? normalizeLocalPost(found) : null,
      liked: found ? !!found.likedByMe : false,
      favorited: !!localFavorites[postId],
      offline: true,
    }
  })
}

function createPost(input) {
  const profile = myProfile()
  const content = String((input && input.content) || '').trim()
  const tags = (input && input.tags) || []
  const images = ((input && input.images) || []).slice()
  const anonymous = !!(input && input.anonymous)
  const nickname = anonymous ? '匿名同学' : profile.nickname
  const avatar = anonymous ? '🎭' : profile.avatar

  if (!content) return Promise.reject(new Error('内容不能为空'))

  return run(function () {
    // 走云函数：服务端会做文字检测 + 图片检测，并从 users 取真实的昵称头像
    return wx.cloud.callFunction({
      name: 'createPost',
      data: { content: content, tags: tags, images: images, anonymous: anonymous },
    }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '发布失败')
      return { id: result.id, offline: false }
    })
  }, function () {
    mock.POSTS.unshift({
      id: Date.now(),
      nickname: nickname,
      avatar: avatar,
      content: content,
      tags: tags,
      images: images,
      likeCount: 0,
      commentCount: 0,
      time: '刚刚',
      mine: true,
      anonymous: !!anonymous,
    })
    return { offline: true }
  })
}

// 编辑自己的帖子：只能改正文和话题，图片保持不变
// 走云函数是因为帖子集合对客户端只读，而且改后的文字也要过内容安全
function updatePost(postId, input) {
  const id = String(postId || '')
  const content = String((input && input.content) || '').trim()
  const tags = ((input && input.tags) || []).slice(0, 3)

  if (!id) return Promise.reject(new Error('缺少帖子 id'))
  if (!content) return Promise.reject(new Error('内容不能为空'))

  return run(function () {
    return wx.cloud.callFunction({
      name: 'updatePost',
      data: { postId: id, content: content, tags: tags },
    }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '保存失败')
      return { ok: true, offline: false }
    })
  }, function () {
    const post = mock.POSTS.filter(function (p) { return String(p.id) === id })[0]
    if (post) {
      post.content = content
      post.tags = tags
      post.time = '刚刚'
    }
    return { ok: true, offline: true }
  })
}

// 点赞 / 取消点赞：云端交给 likePost 云函数（因为要给别人的帖子改数字）
function toggleLike(postId) {
  const id = String(postId || '')
  return run(function () {
    return wx.cloud.callFunction({ name: 'likePost', data: { postId: id } }).then(function (res) {
      const result = res.result || {}
      if (result.ok === false) throw new Error(result.msg || '点赞失败')
      return { liked: !!result.liked, likeCount: Math.max(0, result.likeCount || 0) }
    })
  }, function () {
    const post = mock.POSTS.filter(function (p) { return String(p.id) === id })[0]
    if (!post) return { liked: false, likeCount: 0 }
    post.likedByMe = !post.likedByMe
    post.likeCount = Math.max(0, (post.likeCount || 0) + (post.likedByMe ? 1 : -1))
    return { liked: post.likedByMe, likeCount: post.likeCount }
  })
}

/* ================= 收藏 ================= */

// 收藏 / 取消收藏：favorites 集合里「每人每帖一条」
// 集合权限是「仅创建者可读写」，所以客户端直接读写自己的记录就行，不用云函数
function toggleFavorite(postId) {
  const id = String(postId || '')
  if (!id) return Promise.reject(new Error('缺少帖子 id'))
  return run(function () {
    const favs = db().collection('favorites')
    return favs.where({ postId: id, _openid: myOpenid() }).limit(1).get().then(function (res) {
      const row = (res.data || [])[0]
      if (row) {
        return favs.doc(row._id).remove().then(function () { return { favorited: false } })
      }
      return favs.add({ data: { postId: id, createdAt: db().serverDate() } }).then(function () {
        return { favorited: true }
      })
    })
  }, function () {
    if (localFavorites[id]) {
      delete localFavorites[id]
      return { favorited: false }
    }
    localFavorites[id] = true
    return { favorited: true }
  })
}

// 我的收藏列表（按收藏时间倒序，最多 30 条）
// 帖子被作者删了也保留一行（deleted: true），页面显示成灰色「帖子已被删除」
function fetchFavorites() {
  return run(function () {
    return db().collection('favorites').where({ _openid: myOpenid() })
      .orderBy('createdAt', 'desc').limit(30).get().then(function (res) {
        const ids = (res.data || []).map(function (f) { return f.postId })
        if (!ids.length) return []
        const _ = db().command
        return db().collection('posts').where({ _id: _.in(ids) }).limit(30).get().then(function (p) {
          const byId = {}
          ;(p.data || []).forEach(function (row) { byId[row._id] = normalizePost(row) })
          // 按收藏顺序排（刚收藏的在前）；查不到的帖子补一条占位，别让列表断档
          const list = ids.map(function (id) {
            return byId[id] || {
              id: id,
              deleted: true,
              content: '',
              nickname: '',
              avatar: '😀',
              time: '',
              tags: [],
              images: [],
              likeCount: 0,
              commentCount: 0,
              avatarIsImage: false,
            }
          })
          return resolveImages(list)
        })
      })
  }, function () {
    return mock.POSTS.filter(function (p) { return localFavorites[String(p.id)] }).map(normalizeLocalPost)
  })
}

/* ================= 我的内容（我的帖子 / 历史评论） ================= */

// 我发过的帖子（最多 50 条）
function fetchMyPosts() {
  return run(function () {
    return db().collection('posts').where({ _openid: myOpenid() })
      .orderBy('createdAt', 'desc').limit(50).get().then(function (res) {
        return resolveImages((res.data || []).map(normalizePost))
      })
  }, function () {
    return mock.POSTS.map(normalizeLocalPost).filter(function (p) { return p.mine })
  })
}

// 我发过的评论（带上原帖内容；原帖被删时 postContent 为空）
function fetchMyComments() {
  return run(function () {
    return db().collection('comments').where({ _openid: myOpenid() })
      .orderBy('createdAt', 'desc').limit(50).get().then(function (res) {
        const list = (res.data || []).map(normalizeComment)
        const ids = []
        list.forEach(function (c) {
          if (c.postId && ids.indexOf(c.postId) === -1) ids.push(c.postId)
        })
        if (!ids.length) return list
        const _ = db().command
        return db().collection('posts').where({ _id: _.in(ids) }).limit(100).get().then(function (p) {
          const contentOf = {}
          ;(p.data || []).forEach(function (row) { contentOf[row._id] = row.content || '' })
          list.forEach(function (c) {
            c.postContent = contentOf[c.postId] || ''
            c.postExists = !!contentOf[c.postId]
          })
          return list
        }).catch(function () { return list })
      })
  }, function () {
    return mock.COMMENTS.filter(function (c) { return c.nickname === '我' }).map(function (c) {
      const item = normalizeLocalComment(c)
      const post = mock.POSTS.find(function (p) { return String(p.id) === item.postId })
      item.postContent = post ? post.content : ''
      item.postExists = !!post
      return item
    })
  })
}

/* ================= 删帖 / 举报 ================= */

// 删自己的帖子（云函数里做条件删除：只能删 _openid 是自己的）
function deletePost(postId) {
  const id = String(postId || '')
  return run(function () {
    return wx.cloud.callFunction({ name: 'deletePost', data: { postId: id } }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '删除失败')
      return { ok: true }
    })
  }, function () {
    const index = mock.POSTS.findIndex(function (p) { return String(p.id) === id })
    if (index > -1) mock.POSTS.splice(index, 1)
    return { ok: true, offline: true }
  })
}

// 举报理由（详情页弹菜单用）
const REPORT_REASONS = ['垃圾广告', '色情低俗', '人身攻击', '不实信息', '其他']

function reportPost(postId, reason) {
  const id = String(postId || '')
  return run(function () {
    return wx.cloud.callFunction({ name: 'reportPost', data: { postId: id, reason: reason } }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '举报失败')
      return { ok: true, duplicate: !!result.duplicate }
    })
  }, function () {
    return { ok: true }
  })
}

// 注销账号：删除自己的资料、帖子、评论、点赞、收藏、通知
function deleteAccount() {
  return run(function () {
    return wx.cloud.callFunction({ name: 'deleteAccount' }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '注销失败')
      return result
    })
  }, function () {
    // 离线演示：只清本地假数据里「我」的内容
    mock.POSTS = mock.POSTS.filter(function (p) { return p.nickname !== '我' && p.nickname !== '匿名同学' })
    return { ok: true, offline: true }
  })
}

/* ================= 建议反馈 ================= */

// 离线演示用的本地反馈
const localFeedback = []

function normalizeFeedback(row) {
  return {
    id: String(row.id),
    content: row.content || '',
    contact: row.contact || '',
    nickname: row.nickname || '同学',
    avatar: row.avatar || '😀',
    avatarIsImage: isImagePath(row.avatar),
    status: row.status || '待处理',
    done: (row.status || '待处理') === '已处理',
    time: format.relativeTime(row.ts),
  }
}

// 提交反馈（云函数里校验长度、写入 _openid 和昵称头像）
function createFeedback(content, contact) {
  return run(function () {
    return wx.cloud.callFunction({
      name: 'feedback',
      data: { action: 'create', content: content, contact: contact || '' },
    }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '提交失败')
      return { ok: true, id: result.id }
    })
  }, function () {
    localFeedback.unshift({
      id: 'local-' + Date.now(),
      content: content,
      contact: contact || '',
      nickname: '我',
      avatar: '😀',
      status: '待处理',
      ts: Date.now(),
    })
    return { ok: true, offline: true }
  })
}

// 我提交过的反馈
function fetchMyFeedback() {
  return run(function () {
    return wx.cloud.callFunction({ name: 'feedback', data: { action: 'mine' } }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '读取失败')
      return (result.list || []).map(normalizeFeedback)
    })
  }, function () {
    return localFeedback.map(normalizeFeedback)
  })
}

// 管理员：全部反馈
function fetchFeedbackList() {
  return run(function () {
    return wx.cloud.callFunction({ name: 'feedback', data: { action: 'list' } }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '读取失败')
      return (result.list || []).map(normalizeFeedback)
    })
  }, function () {
    return localFeedback.map(normalizeFeedback)
  })
}

// 管理员：标记已处理
function resolveFeedback(id) {
  const fid = String(id)
  return run(function () {
    return wx.cloud.callFunction({ name: 'feedback', data: { action: 'resolve', id: fid } }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '操作失败')
      return { ok: true }
    })
  }, function () {
    localFeedback.forEach(function (item) {
      if (String(item.id) === fid) item.status = '已处理'
    })
    return { ok: true, offline: true }
  })
}

/* ================= 消息通知 ================= */

function normalizeNotice(row) {
  return {
    id: row.id,
    type: row.type || 'comment',
    text: row.text || '',
    fromNickname: row.fromNickname || '同学',
    fromAvatar: row.fromAvatar || '😀',
    avatarIsImage: isImagePath(row.fromAvatar),
    postId: row.postId || '',
    orderId: row.orderId || '',
    read: !!row.read,
    time: format.relativeTime(row.ts),
    icon: row.type === 'like' ? '👍' : row.type === 'order' ? '🛵' : row.type === 'system' ? '🛎' : '💬',
  }
}

// 我的通知列表；type 传 comment / like / order 就只看那一类
function fetchNotices(type) {
  const t = type && type !== 'all' ? String(type) : ''
  return run(function () {
    return wx.cloud.callFunction({ name: 'notices', data: { action: 'list', type: t } }).then(function (res) {
      const result = res.result || {}
      return (result.list || []).map(normalizeNotice)
    })
  }, function () {
    return []
  })
}

// 消息页首屏：一次云调用拿「列表 + 未读数」（notices 的 bundle 动作）
function fetchMessageCenter(page, type) {
  const pageNo = Math.max(1, Number(page) || 1)
  return run(function () {
    return wx.cloud.callFunction({ name: 'notices', data: { action: 'bundle', page: pageNo, type: type || 'all' } }).then(function (res) {
      const result = res.result || {}
      return {
        list: (result.list || []).map(normalizeNotice),
        unread: result.unread || 0,
        total: result.total || 0,
        page: result.page || pageNo,
        hasMore: result.hasMore === true,
      }
    })
  }, function () {
    return { list: [], unread: 0, total: 0, page: pageNo, hasMore: false }
  })
}

// 未读条数（tab 红点用）
function fetchUnreadCount() {
  return run(function () {
    return wx.cloud.callFunction({ name: 'notices', data: { action: 'unread' } }).then(function (res) {
      return (res.result && res.result.count) || 0
    })
  }, function () {
    return 0
  })
}

// 一键已读
function markAllNoticesRead() {
  return run(function () {
    return wx.cloud.callFunction({ name: 'notices', data: { action: 'readAll' } }).then(function (res) {
      return (res.result && res.result.updated) || 0
    })
  }, function () {
    return 0
  })
}

// 单条已读
function markNoticeRead(noticeId) {
  const id = String(noticeId || '')
  if (!id) return Promise.resolve(0)
  return run(function () {
    return wx.cloud.callFunction({ name: 'notices', data: { action: 'read', noticeId: id } }).then(function () {
      return 1
    })
  }, function () {
    return 1
  })
}

// 未读数 → 消息 tab 上的红点（index 3 是「消息」）
function refreshBadge() {
  return fetchUnreadCount().then(function (count) {
    const text = count > 99 ? '99+' : String(count)
    if (count > 0) {
      wx.setTabBarBadge({ index: 3, text: text, fail: function () {} })
    } else {
      wx.removeTabBarBadge({ index: 3, fail: function () {} })
    }
    return count
  }).catch(function () {
    return 0
  })
}

/* 浏览量：同一条帖子 5 分钟内重复打开只算一次，避免刷数 */
const viewedAt = {}

function incView(postId) {
  const id = String(postId || '')
  if (!id) return Promise.resolve(null)
  const last = viewedAt[id] || 0
  if (Date.now() - last < 5 * 60 * 1000) return Promise.resolve(null)
  viewedAt[id] = Date.now()
  return run(function () {
    return wx.cloud.callFunction({ name: 'viewPost', data: { postId: id } }).then(function (res) {
      const r = res.result || {}
      return r.ok ? r.views : null
    })
  }, function () {
    const p = mock.POSTS.filter(function (x) { return String(x.id) === id })[0]
    if (p) p.views = (p.views || 0) + 1
    return p ? p.views || 1 : null
  })
}

/* ================= 评论 ================= */

function fetchComments(postId) {
  const id = String(postId || '')
  return run(function () {
    return db().collection('comments').where({ postId: id }).limit(100).get().then(function (res) {
      const list = (res.data || []).map(normalizeComment)
      return buildCommentTree(list)
    })
  }, function () {
    return buildCommentTree(mock.COMMENTS
      .filter(function (c) { return String(c.postId) === id })
      .map(normalizeLocalComment))
  })
}

// 详情页一次拿全：正文 + 点赞/收藏状态 + 第一页评论 + 详情页广告
// 老代码是 fetchPost + fetchComments + incView 三次云函数，现在合并成 postDetail 一次
function fetchPostBundle(postId, opts) {
  const id = String(postId || '')
  // 浏览量 5 分钟内同一帖子只算一次（跟原来 incView 的节流一致）
  const now = Date.now()
  const last = viewedAt[id] || 0
  const withView = !(opts && opts.withView === false) && now - last > 5 * 60 * 1000
  if (withView) viewedAt[id] = now
  const commentLimit = Number((opts && opts.commentLimit) || 30)
  return run(function () {
    return wx.cloud
      .callFunction({
        name: 'postDetail',
        data: { postId: id, withView: withView, commentLimit: commentLimit },
      })
      .then(function (r) {
        const res = (r && r.result) || {}
        if (!res.ok) throw new Error(res.msg || '帖子不存在或已删除')
        return resolveImages([res.post || {}]).then(function (posts) {
          const post = normalizePost(posts[0] || {})
          const rows = (res.comments || []).map(normalizeComment)
          return resolveAdImages(res.ad ? [res.ad] : []).then(function (ads) {
            return {
              post: post,
              liked: !!res.liked,
              favorited: !!res.favorited,
              comments: buildCommentTree(rows),
              commentRows: rows,
              commentCount: Number(res.commentCount || 0),
              commentHasMore: !!res.hasMore,
              ad: ads[0] || null,
              offline: false,
            }
          })
        })
      })
  }, function () {
    const found = mock.POSTS.filter(function (p) { return String(p.id) === id })[0]
    const comments = (mock.COMMENTS || [])
      .filter(function (c) { return String(c.postId) === id })
      .map(normalizeLocalComment)
    return {
      post: found ? normalizeLocalPost(found) : null,
      liked: found ? !!found.likedByMe : false,
      favorited: !!localFavorites[id],
      comments: buildCommentTree(comments),
      commentCount: found ? Number(found.commentCount || 0) : 0,
      commentHasMore: false,
      ad: null,
      offline: true,
    }
  })
}

// 详情页滑到底：只取下一页评论（withPost:false，不重复查帖子/广告）
function fetchCommentsMore(postId, from, limit) {
  const id = String(postId || '')
  const start = Math.max(Number(from) || 0, 0)
  const size = Math.min(Math.max(Number(limit) || 30, 1), 100)
  return run(function () {
    return wx.cloud
      .callFunction({
        name: 'postDetail',
        data: { postId: id, withPost: false, commentFrom: start, commentLimit: size },
      })
      .then(function (r) {
        const res = (r && r.result) || {}
        if (!res.ok) throw new Error(res.msg || '加载失败')
        const rows = (res.comments || []).map(normalizeComment)
        return { comments: rows, hasMore: !!res.hasMore, from: start, limit: size }
      })
  }, function () {
    return { comments: [], hasMore: false, from: start, limit: size }
  })
}

// 把扁平的评论列表整理成「顶层评论 + replies」两层结构
function buildCommentTree(list) {
  const byId = {}
  const tops = []
  list.forEach(function (c) { byId[String(c.id)] = c })
  list.forEach(function (c) {
    if (!c.parentId) { tops.push(c); return }
    let parent = byId[String(c.parentId)]
    if (parent && parent.parentId) parent = byId[String(parent.parentId)] || parent
    if (!parent) { tops.push(c); return }
    if (String(parent.id) === String(c.id)) { tops.push(c); return }
    if (!parent.replies) parent.replies = []
    parent.replies.push(c)
  })
  tops.forEach(function (c) {
    c.replies = c.replies || []
    c.replies.sort(function (a, b) { return toTs(a.createdAt) - toTs(b.createdAt) })
  })
  tops.sort(function (a, b) {
    const ta = toTs(a.createdAt) || (a.time === '刚刚' ? Date.now() : 0)
    const tb = toTs(b.createdAt) || (b.time === '刚刚' ? Date.now() : 0)
    return tb - ta
  })
  return tops
}

function addComment(postId, content, parentId, replyTo) {
  const id = String(postId || '')
  const text = String(content || '').trim()
  const profile = myProfile()
  const pid = String(parentId || '')
  const toNick = String(replyTo || '')
  if (!text) return Promise.reject(new Error('评论不能为空'))

  return run(function () {
    return wx.cloud.callFunction({
      name: 'addComment',
      data: { postId: id, content: text, nickname: profile.nickname, avatar: profile.avatar, parentId: pid, replyTo: toNick },
    }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '评论失败')
      return {
        comment: {
          id: result.id,
          postId: id,
          nickname: result.nickname || profile.nickname,
          avatar: result.avatar || profile.avatar,
          avatarIsImage: isImagePath(result.avatar || profile.avatar),
          content: text,
          parentId: result.parentId || pid,
          replyTo: result.replyTo || toNick,
          mine: true,
          createdAt: new Date(),
          time: '刚刚',
          replies: [],
        },
        offline: false,
      }
    })
  }, function () {
    const comment = {
      id: Date.now(),
      postId: id,
      nickname: profile.nickname,
      avatar: profile.avatar,
      content: text,
      parentId: pid,
      replyTo: toNick,
      time: '刚刚',
    }
    mock.COMMENTS.unshift(comment)
    return { comment: normalizeLocalComment(comment), offline: true }
  })
}

// 删除自己的评论；删顶层评论时，它下面的回复一起删
function deleteComment(commentId) {
  const cid = String(commentId || '')
  if (!cid) return Promise.reject(new Error('缺少评论 id'))
  return run(function () {
    return wx.cloud.callFunction({
      name: 'deleteComment',
      data: { commentId: cid },
    }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '删除失败')
      return { ok: true, removed: result.removed || 1 }
    })
  }, function () {
    const idx = mock.COMMENTS.findIndex(function (c) { return String(c.id) === cid })
    if (idx > -1) mock.COMMENTS.splice(idx, 1)
    mock.COMMENTS.slice().forEach(function (c) {
      if (String(c.parentId) === cid) {
        const i = mock.COMMENTS.findIndex(function (x) { return x === c })
        if (i > -1) mock.COMMENTS.splice(i, 1)
      }
    })
    return { ok: true, removed: 1, offline: true }
  })
}

// 删除一条站内通知（只删自己的）
function deleteNotice(noticeId) {
  const nid = String(noticeId || '')
  if (!nid) return Promise.reject(new Error('缺少通知 id'))
  return run(function () {
    return wx.cloud.callFunction({
      name: 'notices',
      data: { action: 'remove', noticeId: nid },
    }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '删除失败')
      return { ok: true, offline: false }
    })
  }, function () {
    return { ok: true, offline: true }
  })
}

/* ================= 互助订单 ================= */
function fetchOrders(key) {
  const tab = key || 'all'
  const openid = myOpenid()

  return run(function () {
    const coll = db().collection('orders')
    if (tab === 'pending') {
      return coll.where({ status: '待接单' }).limit(30).get().then(function (res) {
        const list = (res.data || []).map(normalizeOrder)
        list.sort(function (a, b) { return toTs(b.createdAt) - toTs(a.createdAt) })
        return { list: list, offline: false }
      })
    }
    if (tab === 'mine') {
      return coll.where({ _openid: openid }).limit(30).get().then(function (res) {
        const list = (res.data || []).map(normalizeOrder)
        list.sort(function (a, b) { return toTs(b.createdAt) - toTs(a.createdAt) })
        return { list: list, offline: false }
      })
    }
    if (tab === 'helping') {
      return coll.where({ takerOpenid: openid }).limit(30).get().then(function (res) {
        const list = (res.data || []).map(normalizeOrder)
        list.sort(function (a, b) { return toTs(b.createdAt) - toTs(a.createdAt) })
        return { list: list, offline: false }
      })
    }
    return coll.orderBy('createdAt', 'desc').limit(30).get().then(function (res) {
      return { list: (res.data || []).map(normalizeOrder), offline: false }
    })
  }, function () {
    let list = mock.HELP_ORDERS.map(normalizeLocalOrder)
    if (tab === 'pending') list = list.filter(function (o) { return o.status === '待接单' })
    if (tab === 'mine') list = list.filter(function (o) { return o.mine })
    if (tab === 'helping') list = list.filter(function (o) { return o.takenByMe })
    return { list: list, offline: true }
  })
}

function createOrder(input) {
  const profile = myProfile()
  const content = String((input && input.content) || '').trim()
  const amount = Number((input && input.amount) || 0)
  if (!content) return Promise.reject(new Error('描述不能为空'))
  if (!amount || amount <= 0) return Promise.reject(new Error('金额不对'))

  return run(function () {
    // 走云函数：描述要过内容安全检测，昵称头像由服务端补
    return wx.cloud.callFunction({
      name: 'createOrder',
      data: { content: content, amount: Number(amount.toFixed(2)) },
    }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '发布失败')
      return { id: result.id, offline: false }
    })
  }, function () {
    mock.HELP_ORDERS.unshift({
      id: Date.now(),
      nickname: profile.nickname,
      avatar: profile.avatar,
      time: '刚刚',
      content: content,
      amount: amount.toFixed(2),
      status: '待接单',
      mine: true,
    })
    return { offline: true }
  })
}

// 订单详情（订单详情页用；服务端顺带补发布人/接单人的最新昵称头像）
function fetchOrder(orderId) {
  const id = String(orderId || '')
  return run(function () {
    return wx.cloud.callFunction({
      name: 'grabOrder',
      data: { orderId: id, action: 'get' },
    }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '订单不存在或已删除')
      return result.order
    })
  }, function () {
    const o = mock.HELP_ORDERS.filter(function (x) { return String(x.id) === id })[0]
    if (!o) return Promise.reject(new Error('订单不存在'))
    const base = normalizeLocalOrder(o)
    base.ownerNickname = base.nickname
    base.ownerAvatar = base.avatar
    base.takerNickname = base.takenByMe ? myProfile().nickname : '同学'
    base.takerAvatar = base.takenByMe ? myProfile().avatar : '🙂'
    return base
  })
}

// 抢单：云端用 grabOrder 云函数做「条件更新」，防止两个人同时抢到
function grabOrder(orderId) {
  const id = String(orderId || '')

  return run(function () {
    return wx.cloud.callFunction({
      name: 'grabOrder',
      data: { orderId: id, action: 'grab' },
    }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '抢单失败')
      return { ok: true, status: result.status }
    })
  }, function () {
    const order = mock.HELP_ORDERS.filter(function (o) { return String(o.id) === id })[0]
    if (!order || order.status !== '待接单') return { ok: false, msg: '手慢了，已经被别人接走' }
    order.status = '已接单'
    order.takenByMe = true
    return { ok: true, status: '已接单', offline: true }
  })
}

// 接单人把订单标记完成（进「待确认」，等发布人确认才真正完成）
function doneOrder(orderId) {
  const id = String(orderId || '')

  return run(function () {
    return wx.cloud.callFunction({
      name: 'grabOrder',
      data: { orderId: id, action: 'done' },
    }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '标记完成失败')
      return { ok: true, status: result.status }
    })
  }, function () {
    const order = mock.HELP_ORDERS.filter(function (o) { return String(o.id) === id })[0]
    if (!order || !order.takenByMe) return { ok: false, msg: '只有接单人可以标记完成' }
    order.status = '待确认'
    return { ok: true, status: '待确认', offline: true }
  })
}

// 发布人确认完成（双向确认的最后一环，之后收益才到账）
function confirmOrder(orderId) {
  const id = String(orderId || '')

  return run(function () {
    return wx.cloud.callFunction({
      name: 'grabOrder',
      data: { orderId: id, action: 'confirm' },
    }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '确认失败')
      return { ok: true, status: result.status }
    })
  }, function () {
    const order = mock.HELP_ORDERS.filter(function (o) { return String(o.id) === id })[0]
    if (!order || !order.mine || order.status !== '待确认') return { ok: false, msg: '当前状态不能确认完成' }
    order.status = '已完成'
    return { ok: true, status: '已完成', offline: true }
  })
}

// 发布人撤销订单（只能撤还没人接的单）
function cancelOrder(orderId) {
  const id = String(orderId || '')

  return run(function () {
    return wx.cloud.callFunction({
      name: 'grabOrder',
      data: { orderId: id, action: 'cancel' },
    }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '撤销失败')
      return { ok: true, status: result.status }
    })
  }, function () {
    const order = mock.HELP_ORDERS.filter(function (o) { return String(o.id) === id })[0]
    if (!order || !order.mine) return { ok: false, msg: '只有发布人可以撤销订单' }
    if (order.status !== '待接单') return { ok: false, msg: '订单已经有人接了，撤销不了' }
    order.status = '已撤销'
    return { ok: true, status: '已撤销', offline: true }
  })
}

// 接单人取消接单（把单放回大厅）
function releaseOrder(orderId) {
  const id = String(orderId || '')

  return run(function () {
    return wx.cloud.callFunction({
      name: 'grabOrder',
      data: { orderId: id, action: 'release' },
    }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '取消接单失败')
      return { ok: true, status: result.status }
    })
  }, function () {
    const order = mock.HELP_ORDERS.filter(function (o) { return String(o.id) === id })[0]
    if (!order || !order.takenByMe) return { ok: false, msg: '只有接单人可以取消接单' }
    if (order.status !== '已接单') return { ok: false, msg: '当前状态不能取消接单' }
    order.status = '待接单'
    order.takenByMe = false
    return { ok: true, status: '待接单', offline: true }
  })
}

// 我的收益：我帮别人完成、且对方已确认的订单
function fetchEarnings() {
  const openid = myOpenid()

  return run(function () {
    return db().collection('orders').where({ takerOpenid: openid, status: '已完成' }).limit(100).get().then(function (res) {
      const list = (res.data || []).map(normalizeOrder)
      let total = 0
      list.forEach(function (o) { total += Number(o.amount || 0) })
      return { total: total.toFixed(2), count: list.length, list: list }
    })
  }, function () {
    const list = mock.HELP_ORDERS.map(normalizeLocalOrder).filter(function (o) {
      return o.takenByMe && o.status === '已完成'
    })
    let total = 0
    list.forEach(function (o) { total += Number(o.amount || 0) })
    return { total: total.toFixed(2), count: list.length, list: list, offline: true }
  })
}

/* ================= 我的页面 ================= */

function fetchMyStats() {
  const profile = myProfile()

  return run(function () {
    return db().collection('posts').where({ _openid: myOpenid() }).limit(100).get().then(function (res) {
      const list = res.data || []
      let likes = 0
      list.forEach(function (p) { likes += p.likeCount || 0 })
      return { nickname: profile.nickname, avatar: profile.avatar, postCount: list.length, likeCount: likes }
    })
  }, function () {
    const mine = mock.POSTS.filter(function (p) { return p.nickname === '我' || p.nickname === '匿名同学' })
    let likes = 0
    mine.forEach(function (p) { likes += p.likeCount || 0 })
    return { nickname: profile.nickname, avatar: profile.avatar, postCount: mine.length, likeCount: likes }
  })
}

/* ================= 管理端（举报处理） ================= */

// 当前用户是不是管理员（白名单在云函数 adminReview 里）
function fetchIsAdmin() {
  if (!cloudReady()) return Promise.resolve(false)
  return wx.cloud.callFunction({ name: 'adminReview', data: { action: 'isAdmin' } })
    .then(function (res) {
      return !!(res.result && res.result.admin)
    })
    .catch(function () {
      return false
    })
}

// 举报列表（只有管理员调得动，服务端会再校验一次）
function fetchReports() {
  return run(function () {
    return wx.cloud.callFunction({ name: 'adminReview', data: { action: 'listReports' } }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '读取举报失败')
      const posts = []
      const list = (result.list || []).map(function (item) {
        const p = item.post
        const post = p ? {
          id: p._id,
          content: p.content,
          nickname: p.nickname,
          avatar: p.avatar,
          avatarIsImage: isImagePath(p.avatar),
          images: p.images || [],
          time: format.relativeTime(p.createdAt),
        } : null
        if (post) posts.push(post)
        return {
          id: item.id,
          postId: item.postId,
          reason: item.reason,
          time: format.relativeTime(item.createdAt),
          post: post,
        }
      })
      return resolveImages(posts).then(function () { return list })
    })
  }, function () {
    return []
  })
}

// 管理员删帖（连带评论、点赞、收藏、举报）
function adminDeletePost(postId) {
  return run(function () {
    return wx.cloud.callFunction({ name: 'adminReview', data: { action: 'deletePost', postId: postId } }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '删除失败')
      return result
    })
  }, function () {
    return { ok: true, offline: true }
  })
}

// 忽略一条举报
function dismissReport(reportId) {
  return run(function () {
    return wx.cloud.callFunction({ name: 'adminReview', data: { action: 'dismissReport', id: reportId } }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '操作失败')
      return result
    })
  }, function () {
    return { ok: true, offline: true }
  })
}

/* ================= 管理后台网关（adminApi） ================= */

// 统一调 adminApi：失败抛 err.message，页面直接 toast
function callAdmin(action, data) {
  return run(function () {
    return wx.cloud.callFunction({ name: 'adminApi', data: Object.assign({ action: action }, data || {}) }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '操作失败')
      return result
    })
  }, function () {
    throw new Error('云开发没连上，管理功能用不了')
  })
}

function adminWhoAmI() {
  return run(function () {
    return wx.cloud.callFunction({ name: 'adminApi', data: { action: 'isAdmin' } }).then(function (res) {
      return res.result || { ok: false, admin: false, owner: false }
    })
  }, function () {
    return { ok: false, admin: false, owner: false }
  })
}

function adminDashboard() { return callAdmin('dashboard') }
function adminPostsList(page, keyword) { return callAdmin('posts.list', { page: page || 1, pageSize: 20, keyword: keyword || '' }) }
function adminSetPostTop(postId, top) { return callAdmin('posts.setTop', { postId: postId, top: !!top }) }
function adminRemovePost(postId) { return callAdmin('posts.remove', { postId: postId }) }
function adminUsersList(keyword, page) { return callAdmin('users.list', { keyword: keyword || '', page: page || 1, pageSize: 20 }) }
function adminBanUser(openid, reason) { return callAdmin('users.ban', { openid: openid, reason: reason || '' }) }
function adminUnbanUser(openid) { return callAdmin('users.unban', { openid: openid }) }
function adminSetUserRole(openid, role) { return callAdmin('users.setRole', { openid: openid, role: role }) }
function adminAnnouncements() { return callAdmin('announcements.list') }

// 举报列表走 adminApi（reports 集合是「所有用户不可读写」，客户端读不到，只能服务端代读）
function adminReportsList(page) {
  return callAdmin('reports.list', { page: page || 1, pageSize: 20 }).then(function (res) {
    const rows = res.list || []
    const posts = rows.map(function (r) { return r.post }).filter(Boolean)
    return resolveImages(posts).then(function (withImg) {
      const byId = {}
      withImg.forEach(function (p) { byId[p.id] = p })
      const list = rows.map(function (r) {
        const p = r.post ? (byId[r.post.id] || r.post) : null
        return {
          id: r.id,
          postId: r.postId,
          reason: r.reason,
          createdAt: r.createdAt,
          time: format.relativeTime(r.createdAt),
          post: p ? {
            id: p.id,
            content: p.content,
            nickname: p.nickname,
            avatar: p.avatar,
            avatarIsImage: isImagePath(p.avatar),
            images: p.images || [],
            time: format.relativeTime(p.createdAt),
          } : null,
        }
      })
      return { list: list, total: res.total || 0, page: res.page || 1, hasMore: res.hasMore === true }
    })
  })
}

// 反馈列表同样走 adminApi（feedback 集合「所有用户不可读写」）
function adminFeedbackList(page) {
  return callAdmin('feedback.list', { page: page || 1, pageSize: 20 }).then(function (res) {
    const list = (res.list || []).map(function (f) {
      return {
        id: f.id,
        content: f.content,
        contact: f.contact,
        nickname: f.nickname,
        avatar: f.avatar,
        avatarIsImage: isImagePath(f.avatar),
        status: f.status,
        done: f.status === '已处理',
        time: format.relativeTime(f.ts),
      }
    })
    return { list: list, total: res.total || 0, page: res.page || 1, hasMore: res.hasMore === true }
  })
}
function adminCreateAnnouncement(title, content, pinned) { return callAdmin('announcements.create', { title: title, content: content, pinned: !!pinned }) }
function adminUpdateAnnouncement(id, data) { return callAdmin('announcements.update', Object.assign({ id: id }, data || {})) }
function adminRemoveAnnouncement(id) { return callAdmin('announcements.remove', { id: id }) }
function adminSettings() { return callAdmin('settings.get') }
function adminSetSetting(key, value) { return callAdmin('settings.set', { key: key, value: value }) }
function adminAuditList(page) { return callAdmin('audit.list', { page: page || 1, pageSize: 20 }) }
function adminDismissReport(id) { return callAdmin('reports.dismiss', { id: id }) }
function adminReportRemovePost(postId) { return callAdmin('reports.removePost', { postId: postId }) }
function adminFeedbackResolve(id) { return callAdmin('feedback.resolve', { id: id }) }
function adminTrashList(page) { return callAdmin('trash.list', { page: page || 1, pageSize: 20 }) }
function adminTrashRestore(id) { return callAdmin('trash.restore', { id: id }) }
function adminTrashPurge(id) { return callAdmin('trash.purge', { id: id }) }
function adminWordsList() { return callAdmin('wordfilters.list') }
function adminWordAdd(word) { return callAdmin('wordfilters.add', { word: word }) }
function adminWordRemove(id) { return callAdmin('wordfilters.remove', { id: id }) }
function adminBackupList() { return callAdmin('backup.list') }
function adminBackupCreate() { return callAdmin('backup.create') }
function adminBackupDownload(id) { return callAdmin('backup.download', { id: id }) }
function adminBackupRemove(id) { return callAdmin('backup.remove', { id: id }) }

/* ================= 话题关注 ================= */

// 本地演示模式下的关注（内存里记着，重启就没了；云端模式存 follows 集合）
const localFollows = {}

// 我关注了哪些话题（返回话题名数组）
function fetchFollowedTopics() {
  return run(function () {
    return db().collection('follows').where({ _openid: myOpenid() }).limit(100).get().then(function (res) {
      return (res.data || []).map(function (d) { return d.tag })
    })
  }, function () {
    return Object.keys(localFollows).filter(function (tag) { return localFollows[tag] })
  })
}

// 关注 / 取关一个话题（一人一话题一条记录，删掉就是取关）
function toggleFollowTopic(tag) {
  if (!tag) return Promise.reject(new Error('缺少话题'))
  return run(function () {
    const col = db().collection('follows')
    return col.where({ tag: tag, _openid: myOpenid() }).limit(1).get().then(function (res) {
      const doc = (res.data || [])[0]
      if (doc) {
        return col.doc(doc._id).remove().then(function () {
          return { following: false }
        })
      }
      return col.add({ data: { tag: tag, createdAt: db().serverDate() } }).then(function () {
        return { following: true }
      })
    })
  }, function () {
    localFollows[tag] = !localFollows[tag]
    return { following: !!localFollows[tag] }
  })
}

/* ================= 个人主页 ================= */

// 看某个同学的主页：资料 + 最近帖子 + 统计（发帖数 / 被赞数）+ 收到的评分
function fetchUserProfile(openid) {
  const target = String(openid || '')
  return run(function () {
    const postsReq = db().collection('posts').where({ _openid: target }).orderBy('createdAt', 'desc').limit(30).get()
    const userReq = db().collection('users').where({ _openid: target }).limit(1).get()
      .catch(function () { return { data: [] } })
    const reviewReq = wx.cloud.callFunction({ name: 'orderReview', data: { action: 'list', openid: target } })
      .then(function (res) { return res.result || {} })
      .catch(function () { return { ok: true, count: 0, avg: 0 } })
    return Promise.all([postsReq, userReq, reviewReq]).then(function (arr) {
      const docs = arr[0].data || []
      const u = (arr[1].data || [])[0] || {}
      const review = arr[2] || {}
      // 查无此人：没有用户档案、也没发过帖子 → 返回 null，页面显示「没有找到这位同学」
      if (!u._id && docs.length === 0) {
        return { profile: null, posts: [], stats: { postCount: 0, likeCount: 0 }, offline: false }
      }
      const posts = docs.map(normalizePost)
      let likeSum = 0
      posts.forEach(function (p) { likeSum += p.likeCount || 0 })
      const nickname = u.nickname || (posts[0] ? posts[0].nickname : '同学')
      const avatar = u.avatar || (posts[0] ? posts[0].avatar : '😀')
      return resolveImages(posts).then(function (list) {
        return {
          profile: {
            openid: target,
            nickname: nickname,
            avatar: avatar,
            avatarIsImage: isImagePath(avatar),
            score: review.avg ? Number(review.avg).toFixed(1) : '',
            reviewCount: review.count || 0,
          },
          posts: list,
          stats: { postCount: docs.length, likeCount: likeSum },
          offline: false,
        }
      })
    })
  }, function () {
    const posts = (mock.POSTS || []).map(normalizeLocalPost)
    let likeSum = 0
    posts.forEach(function (p) { likeSum += p.likeCount || 0 })
    return {
      profile: { openid: target, nickname: '演示同学', avatar: '😀', avatarIsImage: false, score: '', reviewCount: 0 },
      posts: posts,
      stats: { postCount: posts.length, likeCount: likeSum },
      offline: true,
    }
  })
}

/* ================= 订单评价 ================= */

// 给这单的对方打分（1-5 星 + 一句评价）；服务端校验订单双方、已完成、只能评一次
function createReview(orderId, score, text) {
  return run(function () {
    return wx.cloud.callFunction({
      name: 'orderReview',
      data: { action: 'create', orderId: String(orderId || ''), score: Number(score), text: String(text || '').slice(0, 200) },
    }).then(function (res) {
      const result = res.result || {}
      if (!result.ok) throw new Error(result.msg || '评价失败')
      return result
    })
  }, function () {
    return { ok: true, offline: true }
  })
}

// 查这条订单的评价（含「我评过没有」）
function fetchOrderReviews(orderId) {
  return run(function () {
    return wx.cloud.callFunction({ name: 'orderReview', data: { action: 'ofOrder', orderId: String(orderId || '') } })
      .then(function (res) {
        const result = res.result || {}
        if (!result.ok) throw new Error(result.msg || '读取评价失败')
        return result
      })
  }, function () {
    return { ok: true, count: 0, myReview: null, theirReview: null, offline: true }
  })
}

module.exports = {
  ensureProfile: ensureProfile,
  fetchProfile: fetchProfile,
  uploadAvatar: uploadAvatar,
  uploadPostImage: uploadPostImage,
  saveProfile: saveProfile,
  fetchPosts: fetchPosts,
  fetchHotPost: fetchHotPost,
  incView: incView,
  fetchBoard: fetchBoard,
  fetchSiteData: fetchSiteData,
  reportAd: reportAd,
  fetchHomeMeta: fetchHomeMeta,
  fetchHotTopics: fetchHotTopics,
  TOPIC_LIST: TOPIC_LIST,
  topicMeta: topicMeta,
  searchPosts: searchPosts,
  searchHotWords: searchHotWords,
  fetchPost: fetchPost,
  fetchPostBundle: fetchPostBundle,
  fetchCommentsMore: fetchCommentsMore,
  buildCommentTree: buildCommentTree,
  createPost: createPost,
  toggleLike: toggleLike,
  fetchComments: fetchComments,
  addComment: addComment,
  deleteComment: deleteComment,
  deleteNotice: deleteNotice,
  updatePost: updatePost,
  fetchOrders: fetchOrders,
  createOrder: createOrder,
  fetchOrder: fetchOrder,
  grabOrder: grabOrder,
  doneOrder: doneOrder,
  confirmOrder: confirmOrder,
  cancelOrder: cancelOrder,
  releaseOrder: releaseOrder,
  fetchEarnings: fetchEarnings,
  fetchMyStats: fetchMyStats,
  isImagePath: isImagePath,
  isCloudReady: isCloudReady,
  deleteFiles: deleteFiles,
  toggleFavorite: toggleFavorite,
  fetchFavorites: fetchFavorites,
  fetchFollowedTopics: fetchFollowedTopics,
  toggleFollowTopic: toggleFollowTopic,
  fetchUserProfile: fetchUserProfile,
  createReview: createReview,
  fetchOrderReviews: fetchOrderReviews,
  fetchMyPosts: fetchMyPosts,
  fetchMyComments: fetchMyComments,
  deletePost: deletePost,
  deleteAccount: deleteAccount,
  createFeedback: createFeedback,
  fetchMyFeedback: fetchMyFeedback,
  fetchFeedbackList: fetchFeedbackList,
  resolveFeedback: resolveFeedback,
  reportPost: reportPost,
  REPORT_REASONS: REPORT_REASONS,
  fetchNotices: fetchNotices,
  fetchMessageCenter: fetchMessageCenter,
  fetchUnreadCount: fetchUnreadCount,
  markAllNoticesRead: markAllNoticesRead,
  markNoticeRead: markNoticeRead,
  refreshBadge: refreshBadge,
  fetchIsAdmin: fetchIsAdmin,
  fetchReports: fetchReports,
  adminDeletePost: adminDeletePost,
  dismissReport: dismissReport,
  adminWhoAmI: adminWhoAmI,
  adminDashboard: adminDashboard,
  adminPostsList: adminPostsList,
  adminSetPostTop: adminSetPostTop,
  adminRemovePost: adminRemovePost,
  adminUsersList: adminUsersList,
  adminBanUser: adminBanUser,
  adminUnbanUser: adminUnbanUser,
  adminSetUserRole: adminSetUserRole,
  adminAnnouncements: adminAnnouncements,
  adminCreateAnnouncement: adminCreateAnnouncement,
  adminUpdateAnnouncement: adminUpdateAnnouncement,
  adminRemoveAnnouncement: adminRemoveAnnouncement,
  adminSettings: adminSettings,
  adminSetSetting: adminSetSetting,
  adminAuditList: adminAuditList,
  adminReportsList: adminReportsList,
  adminFeedbackList: adminFeedbackList,
  adminDismissReport: adminDismissReport,
  adminReportRemovePost: adminReportRemovePost,
  adminFeedbackResolve: adminFeedbackResolve,
  adminTrashList: adminTrashList,
  adminTrashRestore: adminTrashRestore,
  adminTrashPurge: adminTrashPurge,
  adminWordsList: adminWordsList,
  adminWordAdd: adminWordAdd,
  adminWordRemove: adminWordRemove,
  adminBackupList: adminBackupList,
  adminBackupCreate: adminBackupCreate,
  adminBackupDownload: adminBackupDownload,
  adminBackupRemove: adminBackupRemove,
}
