// pages/feedback-admin/feedback-admin.js —— 圈主：反馈管理
const api = require('../../utils/api.js')

Page({
  data: {
    checked: false,   // 是否已确认管理员身份
    isAdmin: false,
    loading: true,
    list: [],
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load().then(function () {
      wx.stopPullDownRefresh()
    })
  },

  load() {
    const that = this
    return getApp().ready()
      .then(function () {
        return api.fetchIsAdmin().catch(function () { return false })
      })
      .then(function (admin) {
        that.setData({ isAdmin: admin, checked: true })
        if (!admin) return []
        return api.fetchFeedbackList().catch(function (err) {
          console.error('读取反馈列表失败', err)
          return []
        })
      })
      .then(function (list) {
        that.setData({ list: list || [], loading: false })
      })
      .catch(function (err) {
        console.error('反馈管理加载失败', err)
        that.setData({ loading: false })
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
        api.resolveFeedback(id)
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
