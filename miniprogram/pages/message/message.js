// pages/message/message.js —— 消息通知（评论 / 点赞 / 抢单）
const api = require('../../utils/api.js')
const subscribe = require('../../utils/subscribe.js')

Page({
  data: {
    list: [],
    allList: [],      // 原始列表，切分类 tab 时本地筛
    unread: 0,
    loading: true,
    subscribeReady: false, // 后台配了订阅模板才显示「开启提醒」
    readingAll: false,     // 正在一键已读（防连点）
    typeTab: 'all',        // all / comment / like / order
    tabs: [
      { key: 'all', label: '全部' },
      { key: 'comment', label: '评论' },
      { key: 'like', label: '点赞' },
      { key: 'order', label: '订单' },
    ],
  },

  onShow() {
    this.setData({ subscribeReady: subscribe.isReady() })
    this.load()
  },

  load() {
    this.setData({ loading: true })
    getApp().ready()
      .then(() => api.fetchMessageCenter())
      .then((res) => {
        const all = res.list || []
        const unread = res.unread || 0
        this.setData({ allList: all, list: this.filterList(all), unread: unread, loading: false })
        // 红点直接用同一次请求拿到的未读数，省掉一次云调用
        if (unread > 0) {
          wx.setTabBarBadge({ index: 3, text: unread > 99 ? '99+' : String(unread), fail: function () {} })
        } else {
          wx.removeTabBarBadge({ index: 3, fail: function () {} })
        }
      })
      .catch((err) => {
        console.error('读取消息失败', err)
        this.setData({ loading: false })
      })
  },

  // 按当前分类 tab 过滤（本地筛，不用再请求一次）
  filterList(all, key) {
    const t = key || this.data.typeTab || 'all'
    if (!t || t === 'all') return all
    return all.filter(function (n) { return n.type === t })
  },

  // 切分类 tab
  onTypeTap(e) {
    const key = e.currentTarget.dataset.key || 'all'
    if (key === this.data.typeTab) return
    // setData 里 this.data 还没更新，筛选要显式把 key 传进去
    this.setData({ typeTab: key, list: this.filterList(this.data.allList, key) })
  },

  onPullDownRefresh() {
    this.load()
    setTimeout(() => wx.stopPullDownRefresh(), 600)
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
        const all = this.data.allList.map((item) => Object.assign({}, item, { read: true }))
        this.setData({ allList: all, list: this.filterList(all), unread: 0, readingAll: false })
        api.refreshBadge()
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
    api.markNoticeRead(notice.id)
      .then(() => api.refreshBadge())
      .catch(() => null)
    const all = this.data.allList.slice()
    const at = all.findIndex(function (n) { return n.id === notice.id })
    if (at > -1) all[at] = Object.assign({}, all[at], { read: true })
    this.setData({
      allList: all,
      list: this.filterList(all),
      unread: Math.max(0, this.data.unread - 1),
    })
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
            const all = this.data.allList.filter(function (n) { return n.id !== notice.id })
            const unread = notice.read ? this.data.unread : Math.max(0, this.data.unread - 1)
            this.setData({ allList: all, list: this.filterList(all), unread: unread })
            api.refreshBadge()
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
