// pages/message/message.js —— 消息通知（评论 / 点赞 / 订单 / 系统），支持分类 tab 与分页
const api = require('../../utils/api.js')
const subscribe = require('../../utils/subscribe.js')

const PAGE_SIZE = 20

Page({
  data: {
    list: [],
    unread: 0,
    total: 0,
    hasMore: false,
    loading: true,
    loadingMore: false,
    subscribeReady: false, // 后台配了订阅模板才显示「开启提醒」
    readingAll: false,     // 正在一键已读（防连点）
    typeTab: 'all',        // all / comment / like / order / system
    tabs: [
      { key: 'all', label: '全部' },
      { key: 'comment', label: '评论' },
      { key: 'like', label: '点赞' },
      { key: 'order', label: '订单' },
      { key: 'system', label: '系统' },
    ],
  },

  onShow() {
    this.setData({ subscribeReady: subscribe.isReady() })
    this.load()
  },

  onPullDownRefresh() {
    this.load()
    setTimeout(() => wx.stopPullDownRefresh(), 600)
  },

  // 上拉加载更多
  onReachBottom() {
    this.loadMore()
  },

  load() {
    this.setData({ loading: true })
    getApp().ready()
      .then(() => api.fetchMessageCenter(1, this.data.typeTab))
      .then((res) => {
        this.setData({
          list: res.list || [],
          unread: res.unread || 0,
          total: res.total || 0,
          hasMore: res.hasMore === true,
          loading: false,
        })
        if (res.unread > 0) {
          wx.setTabBarBadge({ index: 3, text: res.unread > 99 ? '99+' : String(res.unread), fail: function () {} })
        } else {
          wx.removeTabBarBadge({ index: 3, fail: function () {} })
        }
      })
      .catch((err) => {
        console.error('读取消息失败', err)
        this.setData({ loading: false })
        wx.showToast({ title: '消息没加载出来，下拉刷新试试', icon: 'none' })
      })
  },

  loadMore() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.loading) return
    this.setData({ loadingMore: true })
    const next = Math.floor(this.data.list.length / PAGE_SIZE) + 1
    api.fetchMessageCenter(next, this.data.typeTab)
      .then((res) => {
        this.setData({
          list: this.data.list.concat(res.list || []),
          unread: res.unread || 0,
          total: res.total || 0,
          hasMore: res.hasMore === true,
          loadingMore: false,
        })
      })
      .catch(() => {
        this.setData({ loadingMore: false })
        wx.showToast({ title: '没加载出来，再上拉一次', icon: 'none' })
      })
  },

  // 切分类 tab：交给服务端按 type 查（本地筛在分页时会漏数据）
  onTypeTap(e) {
    const key = e.currentTarget.dataset.key || 'all'
    if (key === this.data.typeTab) return
    this.setData({ typeTab: key, list: [], total: 0, hasMore: false })
    this.load()
  },

  // 一键已读
  readAll() {
    if (this.data.readingAll) return
    if (!this.data.unread) {
      wx.showToast({ title: '暂无未读消息', icon: 'none' })
      return
    }
    this.setData({ readingAll: true })
    api.markAllNoticesRead()
      .then(() => {
        const list = this.data.list.map((item) => Object.assign({}, item, { read: true }))
        this.setData({ list: list, unread: 0, readingAll: false })
        wx.removeTabBarBadge({ index: 3, fail: function () {} })
        wx.showToast({ title: '已全部已读', icon: 'success' })
      })
      .catch(() => {
        this.setData({ readingAll: false })
        wx.showToast({ title: '操作失败，再试一次', icon: 'none' })
      })
  },

  // 点「去开启」：弹一次授权框，三个模板一次授权完
  onSubscribe() {
    subscribe.requestSubscribe()
      .then((res) => {
        const rejected = Object.keys(res).filter(function (k) {
          return k !== 'errMsg' && res[k] !== 'accept'
        })
        if (rejected.length) {
          wx.showToast({ title: '有 ' + rejected.length + ' 项没开，下次可以再来点一次', icon: 'none' })
        } else {
          wx.showToast({ title: '已开启，有消息微信会提醒你', icon: 'success' })
        }
      })
      .catch((err) => {
        const msg = (err && (err.errMsg || err.message)) || ''
        wx.showToast({
          title: msg.indexOf('还没配置') > -1 ? '后台还没配订阅模板，先看 README' : '没开启成功，稍后再试',
          icon: 'none',
        })
      })
  },

  // 长按某条消息：标为已读 / 删除这条消息
  onNoticeLongPress(e) {
    const index = e.currentTarget.dataset.index
    const notice = this.data.list[index]
    if (!notice) return
    const items = []
    if (!notice.read) items.push('标为已读')
    items.push('删除这条消息')
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const label = items[res.tapIndex]
        if (label === '标为已读') {
          this.markRead(notice)
        } else {
          this.confirmDeleteNotice(notice)
        }
      },
    })
  },

  // 标为已读（点消息卡和长按菜单共用）
  markRead(notice) {
    if (!notice || notice.read) return
    api.markNoticeRead(notice.id).catch(() => null)
    const list = this.data.list.slice()
    const at = list.findIndex(function (n) { return n.id === notice.id })
    if (at > -1) list[at] = Object.assign({}, list[at], { read: true })
    this.setData({ list: list, unread: Math.max(0, this.data.unread - 1) })
  },

  // 删除通知：确认后调云函数删除，再从本地列表移除
  confirmDeleteNotice(notice) {
    if (!notice) return
    wx.showModal({
      title: '删除这条消息？',
      content: '只删掉这条提醒，帖子、评论和订单本身不会动。',
      confirmText: '删除',
      confirmColor: '#e64340',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中', mask: true })
        api.deleteNotice(notice.id)
          .then(() => {
            wx.hideLoading()
            const list = this.data.list.filter(function (n) { return n.id !== notice.id })
            const unread = notice.read ? this.data.unread : Math.max(0, this.data.unread - 1)
            this.setData({ list: list, unread: unread, total: Math.max(0, this.data.total - 1) })
            wx.showToast({ title: '已删除', icon: 'success' })
          })
          .catch((err) => {
            wx.hideLoading()
            wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
          })
      },
    })
  },

  // 点某条消息：先标已读，再跳到对应页面
  onNoticeTap(e) {
    const index = e.currentTarget.dataset.index
    const notice = this.data.list[index]
    if (!notice) return

    this.markRead(notice)

    if (notice.orderId) {
      wx.navigateTo({ url: '/pages/order/order?id=' + notice.orderId })
      return
    }
    if (notice.postId) {
      wx.navigateTo({ url: '/pages/detail/detail?id=' + notice.postId })
      return
    }
    wx.showToast({ title: '这条内容已经删掉了', icon: 'none' })
  },
})
