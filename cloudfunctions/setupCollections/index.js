// 云函数：setupCollections —— 开发辅助工具
// 1) 建集合 favorites / reports / notices（已存在就跳过，可重复调用）
// 2) seedPost：插一条「别人发的」帖子（服务端写入没有 _openid，正好模拟另一台设备，用来测举报）
// 3) removePostId：删掉这条帖子，并把它的评论/点赞/收藏/举报一起清掉（测试收尾用）
// 4) seedNotice / removeNoticeId：塞一条「别人发来的」消息 / 删掉它（测试消息通知用）
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 1) 建全部集合（已存在就跳过，可重复调用）：换新环境后跑一次即可
const COLLECTIONS = ['posts', 'comments', 'orders', 'users', 'likes', 'favorites', 'reports', 'notices', 'feedback', 'follows', 'reviews', 'announcements', 'bans', 'settings', 'audit_logs', 'trash', 'wordfilters']

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

  // 测试辅助：给一条帖子塞一条「别人举报的」记录（没有 _openid，模拟其他同学）
  if (event && event.seedReport) {
    const target = event.seedReport
    const added = await db.collection('reports').add({
      data: {
        postId: String(target.postId || ''),
        reason: String(target.reason || '垃圾广告'),
        createdAt: db.serverDate(),
      },
    })
    result.seedReportId = added._id
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
