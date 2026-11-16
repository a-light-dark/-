// pages/feedback-admin/feedback-admin.js —— 圈主：反馈管理（支持上拉分页）
const api = require('../../utils/api.js')

Page({
  data: {
    checked: false,   // 是否已确认管理员身份
    isAdmin: false,
    loading: true,
    list: [],
    total: 0,
    hasMore: false,
    loadingMore: false,
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load().then(function () {
      wx.stopPullDownRefresh()
    })
  },

  onReachBottom() {
    this.loadMore()
  },

  load() {
    const that = this
    return getApp().ready()
      .then(function () {
        return api.fetchIsAdmin().catch(function () { return false })
      })
      .then(function (admin) {
        that.setData({ isAdmin: admin, checked: true })
        if (!admin) return { list: [], total: 0, hasMore: false }
        return api.adminFeedbackList(1).catch(function (err) {
          console.error('读取反馈列表失败', err)
          return { list: [], total: 0, hasMore: false }
        })
      })
      .then(function (res) {
        that.setData({ list: (res && res.list) || [], total: (res && res.total) || 0, hasMore: !!(res && res.hasMore), loading: false })
      })
      .catch(function (err) {
        console.error('反馈管理加载失败', err)
        that.setData({ loading: false })
      })
  },

  loadMore() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.loading) return
    const that = this
    this.setData({ loadingMore: true })
    const next = Math.floor(this.data.list.length / 20) + 1
    api.adminFeedbackList(next)
      .then(function (res) {
        that.setData({
          list: that.data.list.concat((res && res.list) || []),
          total: (res && res.total) || 0,
          hasMore: !!(res && res.hasMore),
          loadingMore: false,
        })
      })
      .catch(function () {
        that.setData({ loadingMore: false })
        wx.showToast({ title: '没加载出来，再上拉一次', icon: 'none' })
      })
  },

  onResolve(e) {
    const id = e.currentTarget.dataset.id
    const that = this
    wx.showModal({
      title: '标记为已处理？',
      content: '标记后这条反馈会显示「已处理」，提交人也能看到。',
      confirmText: '标记已处理',
      confirmColor: '#07c160',
      success(res) {
        if (!res.confirm) return
        api.adminFeedbackResolve(id)
          .then(function () {
            wx.showToast({ title: '已标记', icon: 'none' })
            that.load()
          })
          .catch(function (err) {
            wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' })
          })
      },
    })
  },
})
