// pages/message/message.js —— 消息通知（评论 / 点赞 / 抢单）
const api = require('../../utils/api.js')

Page({
  data: {
    list: [],
    unread: 0,
    loading: true,
  },

  onShow() {
    this.load()
  },

  load() {
    this.setData({ loading: true })
    getApp().ready()
      .then(() => Promise.all([api.fetchNotices(), api.fetchUnreadCount()]))
      .then((res) => {
        this.setData({ list: res[0] || [], unread: res[1] || 0, loading: false })
        api.refreshBadge()
      })
      .catch((err) => {
        console.error('读取消息失败', err)
        this.setData({ loading: false })
      })
  },

  onPullDownRefresh() {
    this.load()
    setTimeout(() => wx.stopPullDownRefresh(), 600)
  },

  // 一键已读
  readAll() {
    if (!this.data.unread) {
      wx.showToast({ title: '暂无未读消息', icon: 'none' })
      return
    }
    api.markAllNoticesRead()
      .then(() => {
        const list = this.data.list.map((item) => Object.assign({}, item, { read: true }))
        this.setData({ list: list, unread: 0 })
        wx.removeTabBarBadge({ index: 3, fail: function () {} })
        wx.showToast({ title: '已全部置为已读', icon: 'none' })
      })
      .catch(() => wx.showToast({ title: '操作失败，再试一次', icon: 'none' }))
  },

  // 点某条消息：先标已读，再跳到对应页面
  onNoticeTap(e) {
    const index = e.currentTarget.dataset.index
    const notice = this.data.list[index]
    if (!notice) return

    if (!notice.read) {
      api.markNoticeRead(notice.id)
        .then(() => api.refreshBadge())
        .catch(() => null)
      this.setData({
        ['list[' + index + '].read']: true,
        unread: Math.max(0, this.data.unread - 1),
      })
    }

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
