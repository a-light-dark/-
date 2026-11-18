// 云函数：setupCollections —— 开发辅助工具
// 1) 建集合 favorites / reports / notices（已存在就跳过，可重复调用）
// 2) seedPost：插一条「别人发的」帖子（服务端写入没有 _openid，正好模拟另一台设备，用来测举报）
// 3) removePostId：删掉这条帖子，并把它的评论/点赞/收藏/举报一起清掉（测试收尾用）
// 4) seedNotice / removeNoticeId：塞一条「别人发来的」消息 / 删掉它（测试消息通知用）
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 1) 建全部集合（已存在就跳过，可重复调用）：换新环境后跑一次即可
const COLLECTIONS = [
  'ads','posts', 'comments', 'orders', 'users', 'likes', 'favorites', 'reports', 'notices', 'feedback', 'follows', 'reviews', 'announcements', 'bans', 'settings', 'audit_logs', 'trash', 'wordfilters', 'backups', 'admin_sessions', 'admin_accounts', 'approvals', 'meta', 'wordlist', 'login_attempts', 'security_alerts']

exports.main = async (event) => {
  const result = {}

  for (let i = 0; i < COLLECTIONS.length; i++) {
    const name = COLLECTIONS[i]
    try {
      await db.createCollection(name)
      result[name] = 'created'
    } catch (err) {
      result[name] = 'exists'
    }
  }


  // 版本号文档 + 词库汇总文档（单词库读 1 次顶扫 200 条；首页接口靠版本号判断要不要重算）
  try {
    let hasVersion = false
    try {
      const v = await db.collection('meta').doc('versions').get()
      hasVersion = !!(v && v.data)
    } catch (e) {
      hasVersion = false
    }
    if (!hasVersion) {
      await db.collection('meta').doc('versions').set({ data: { content: 0, ads: 0, config: 0, updatedAt: db.serverDate() } })
    }
    result.versions = hasVersion ? 'exists' : 'created'
  } catch (err) {
    result.versions = 'error'
  }
  try {
    let wl = null
    try {
      const w = await db.collection('wordlist').doc('main').get()
      wl = (w && w.data) || null
    } catch (e) {
      wl = null
    }
    if (!wl) {
      const ws = await db.collection('wordfilters').limit(200).get().catch(function () { return { data: [] } })
      const words = (ws.data || [])
        .map(function (w) { return { id: w._id, word: String(w.word || '') } })
        .filter(function (w) { return w.word })
      await db.collection('wordlist').doc('main').set({ data: { words: words, updatedAt: db.serverDate() } })
      result.wordlist = 'created:' + words.length
    } else {
      result.wordlist = 'exists:' + ((wl.words || []).length)
    }
  } catch (err) {
    result.wordlist = 'error'
  }

  // 压测辅助：分批造数据（kind = posts / comments / notices / reports / feedback）
  // 每次最多 60 行 —— 云函数默认 3 秒超时，一次插几百行会被掐断，所以由脚本循环调用
  if (event && event.seedBulk) {
    const cfg = event.seedBulk || {}
    const kind = String(cfg.kind || 'posts')
    const count = Math.min(60, Math.max(1, Number(cfg.count) || 20))
    const offset = Math.max(0, Number(cfg.offset) || 0)
    const toOpenid = String(cfg.toOpenid || '')
    const now = Date.now()
    const docs = []
    let ids = []

    if (kind === 'comments' || kind === 'reports') {
      const pp = await db.collection('posts').where({ nickname: db.RegExp({ regexp: '^压测同学' }) }).limit(20).get()
      ids = (pp.data || []).map(function (p) { return p._id })
    }

    if ((kind === 'comments' || kind === 'reports') && !ids.length) {
      result.seedBulk = { kind: kind, inserted: 0, msg: '还没有压测帖子可以挂' }
    } else if (kind === 'posts') {
      for (let i = 0; i < count; i++) {
        const n = offset + i + 1
        docs.push({
          content: '压测帖 ' + n + ' 号：图书馆占座 / 食堂新菜 / 二手书转让，这是一条用来测管理端性能的帖子',
          nickname: '压测同学' + (n % 20),
          avatar: '🙂',
          tags: ['日常投稿'],
          images: [],
          likeCount: n % 7,
          commentCount: 0,
          views: n % 13,
          createdAt: new Date(now - n * 60000),
        })
      }
    } else if (kind === 'comments') {
      for (let i = 0; i < count; i++) {
        const n = offset + i + 1
        docs.push({
          postId: ids[n % ids.length],
          content: '压测评论 ' + n + '：这条是压测数据，用来测量大量评论时管理端的加载和分页',
          nickname: '压测同学' + (n % 20),
          avatar: '🙂',
          createdAt: new Date(now - n * 30000),
        })
      }
    } else if (kind === 'notices') {
      for (let i = 0; i < count; i++) {
        const n = offset + i + 1
        docs.push({
          toOpenid: toOpenid,
          type: ['comment', 'like', 'order', 'system'][n % 4],
          text: '压测消息 ' + n + '：同学 A 评论/点赞了你的内容',
          fromNickname: '压测同学' + (n % 20),
          fromAvatar: '🙂',
          read: n % 3 === 0,
          createdAt: new Date(now - n * 20000),
        })
      }
    } else if (kind === 'reports') {
      for (let i = 0; i < count; i++) {
        const n = offset + i + 1
        docs.push({
          postId: ids[n % ids.length],
          reason: ['垃圾广告', '色情低俗', '人身攻击', '不实信息'][n % 4],
          createdAt: new Date(now - n * 45000),
        })
      }
    } else if (kind === 'feedback') {
      for (let i = 0; i < count; i++) {
        const n = offset + i + 1
        docs.push({
          content: '压测反馈 ' + n + '：这个功能挺好用，但希望加个夜间模式',
          contact: '',
          nickname: '压测同学' + (n % 20),
          avatar: '🙂',
          status: n % 4 === 0 ? '已处理' : '待处理',
          createdAt: new Date(now - n * 90000),
        })
      }
    }

    if (docs.length) {
      // 每 10 条并发插一批，比一条条 await 快很多
      for (let i = 0; i < docs.length; i += 10) {
        await Promise.all(docs.slice(i, i + 10).map(function (doc) {
          return db.collection(kind).add({ data: doc })
        }))
      }
    }
    result.seedBulk = { kind: kind, inserted: docs.length, offset: offset }
  }

  // 压测辅助：清掉 seedBulk 造的数据（按前缀批量删，顺序：举报 → 评论 → 消息 → 反馈 → 帖子）
  if (event && event.cleanupBulk) {
    const cfg = event.cleanupBulk || {}
    const toOpenid = String(cfg.toOpenid || '')
    const out = {}
    const posts = await db.collection('posts').where({ nickname: db.RegExp({ regexp: '^压测同学' }) }).limit(500).get().catch(function () { return { data: [] } })
    const ids = (posts.data || []).map(function (p) { return p._id })

    if (ids.length) {
      out.reports = (await db.collection('reports').where({ postId: db.command.in(ids) }).remove().catch(function () { return { stats: { removed: 0 } } })).stats.removed
    }
    out.comments = (await db.collection('comments').where({ nickname: db.RegExp({ regexp: '^压测同学' }) }).remove().catch(function () { return { stats: { removed: 0 } } })).stats.removed
    if (toOpenid) {
      out.notices = (await db.collection('notices').where({ toOpenid: toOpenid, text: db.RegExp({ regexp: '^压测消息' }) }).remove().catch(function () { return { stats: { removed: 0 } } })).stats.removed
    }
    out.feedback = (await db.collection('feedback').where({ nickname: db.RegExp({ regexp: '^压测同学' }) }).remove().catch(function () { return { stats: { removed: 0 } } })).stats.removed
    out.posts = (await db.collection('posts').where({ nickname: db.RegExp({ regexp: '^压测同学' }) }).remove().catch(function () { return { stats: { removed: 0 } } })).stats.removed
    result.cleanupBulk = out
  }

  // 测试辅助：插一条别人的帖子
  if (event && event.seedPost) {
    const added = await db.collection('posts').add({
      data: {
        content: String(event.seedPost),
        nickname: '另一个同学',
        avatar: '🙂',
        tags: [],
        images: [],
        likeCount: 0,
        commentCount: 0,
        createdAt: db.serverDate(),
      },
    })
    result.seedPostId = added._id
  }

  // 测试辅助：清理（帖子 + 关联数据）
  if (event && event.removePostId) {
    const postId = String(event.removePostId)
    await db.collection('posts').doc(postId).remove().catch(function () { return null })
    await Promise.all([
      db.collection('comments').where({ postId }).remove().catch(function () { return null }),
      db.collection('likes').where({ postId }).remove().catch(function () { return null }),
      db.collection('favorites').where({ postId }).remove().catch(function () { return null }),
      db.collection('reports').where({ postId }).remove().catch(function () { return null }),
    ])
    result.removedPostId = postId
  }

  // 测试辅助：给指定用户塞一条「别人发来的」消息（服务端写入，没有 _openid，模拟其他同学）
  if (event && event.seedNotice) {
    const target = event.seedNotice
    const added = await db.collection('notices').add({
      data: {
        toOpenid: String(target.toOpenid || ''),
        type: target.type || 'like',
        text: target.text || '赞了你的帖子',
        postId: target.postId || '',
        orderId: target.orderId || '',
        fromNickname: target.fromNickname || '测试同学',
        fromAvatar: target.fromAvatar || '🙂',
        read: false,
        createdAt: db.serverDate(),
      },
    })
    result.seedNoticeId = added._id
  }

  // 测试辅助：删掉一条消息
  if (event && event.removeNoticeId) {
    const noticeId = String(event.removeNoticeId)
    await db.collection('notices').doc(noticeId).remove().catch(function () { return null })
    result.removedNoticeId = noticeId
  }

  // 测试辅助：给一条帖子塞一条「别人举报的」记录（openid 指定举报人，可测处理结果通知）
  if (event && event.seedReport) {
    const target = event.seedReport
    const added = await db.collection('reports').add({
      data: {
        _openid: String(target.openid || ''),
        postId: String(target.postId || ''),
        reason: String(target.reason || '垃圾广告'),
        createdAt: db.serverDate(),
      },
    })
    result.seedReportId = added._id
  }

  // 测试辅助：造一条「别人提交的」反馈（openid 指定提交人）
  if (event && event.seedFeedback) {
    const target = event.seedFeedback
    const added = await db.collection('feedback').add({
      data: {
        _openid: String(target.openid || ''),
        content: String(target.content || '测试反馈'),
        contact: target.contact || '',
        nickname: target.nickname || '测试同学',
        avatar: target.avatar || '🙂',
        status: '待处理',
        createdAt: db.serverDate(),
      },
    })
    result.seedFeedbackId = added._id
  }

  // 测试辅助：查某人收到的通知（开发验证用）
  if (event && event.noticesFor) {
    const toOpenid = String(event.noticesFor)
    const got = await db.collection('notices').where({ toOpenid }).orderBy('createdAt', 'desc').limit(20).get().catch(function () { return { data: [] } })
    result.noticesFor = (got.data || []).map(function (n) {
      return { id: n._id, type: n.type, text: n.text, fromNickname: n.fromNickname, read: !!n.read }
    })
  }

  // 测试辅助：直接改某个用户的封禁状态（验证封禁在写入口的拦截，绕过 adminApi 的白名单保护）
  if (event && event.setBanned) {
    const target = event.setBanned
    const openid = String(target.openid || '')
    const banned = target.banned === true
    const found = await db.collection('users').where({ _openid: openid }).limit(1).get().catch(function () { return { data: [] } })
    if (found.data && found.data[0]) {
      await db.collection('users').doc(found.data[0]._id).update({
        data: { banned: banned, banReason: banned ? String(target.reason || '测试封禁') : '' },
      }).catch(function () { return null })
    } else {
      await db.collection('users').add({
        data: {
          _openid: openid,
          nickname: '测试账号',
          avatar: '🙂',
          banned: banned,
          banReason: banned ? String(target.reason || '测试封禁') : '',
          createdAt: db.serverDate(),
        },
      }).catch(function () { return null })
    }
    result.setBanned = { openid: openid, banned: banned }
  }

  // 测试辅助：造一条「别人发的」订单（owner 指定发布人，taker 指定接单人，可模拟任意状态）
  if (event && event.seedOrder) {
    const o = event.seedOrder
    const data = {
      _openid: String(o.owner || ''),
      nickname: o.ownerNickname || '测试同学',
      avatar: o.ownerAvatar || '🙂',
      content: String(o.content || '测试订单：帮取快递'),
      amount: Number(o.amount || 5),
      status: String(o.status || '待接单'),
      createdAt: db.serverDate(),
    }
    if (o.taker) {
      data.takerOpenid = String(o.taker)
      data.takerName = o.takerNickname || '接单测试'
      data.takenAt = db.serverDate()
    }
    if (o.status === '待确认') data.doneAt = db.serverDate()
    if (o.status === '已完成') {
      data.doneAt = db.serverDate()
      data.confirmedAt = db.serverDate()
    }
    const added = await db.collection('orders').add({ data: data })
    result.seedOrderId = added._id
  }

  // 测试辅助：删掉一条订单（连带这条订单的评价和通知）
  if (event && event.removeOrderId) {
    const orderId = String(event.removeOrderId)
    const removed = await db.collection('orders').doc(orderId).remove().catch(function () { return { stats: { removed: 0 } } })
    await Promise.all([
      db.collection('reviews').where({ orderId }).remove().catch(function () { return null }),
      db.collection('notices').where({ orderId }).remove().catch(function () { return null }),
    ])
    result.removedOrderId = orderId
    result.removed = removed.stats ? removed.stats.removed : 0
  }

  // 测试辅助：按内容前缀删一条帖子下的评论（客户端没有评论删除权限，只能走云函数）
  if (event && event.removeComments) {
    const target = event.removeComments
    const postId = String(target.postId || '')
    const prefix = String(target.prefix || '')
    const got = await db.collection('comments').where({ postId }).limit(100).get().catch(function () { return { data: [] } })
    const list = (got.data || []).filter(function (c) {
      return prefix ? String(c.content || '').indexOf(prefix) === 0 : true
    })
    await Promise.all(list.map(function (c) {
      return db.collection('comments').doc(c._id).remove().catch(function () { return null })
    }))
    if (postId && list.length) {
      await db.collection('posts').doc(postId).update({
        data: { commentCount: db.command.inc(-list.length) },
      }).catch(function () { return null })
    }
    result.removedComments = list.length
  }

  return { ok: true, result: result }
}
