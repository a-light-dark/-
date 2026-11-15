// pages/favorites/favorites.js —— 我的收藏列表（收藏记录存在 favorites 集合里）
const api = require('../../utils/api.js')

Page({
  data: {
    list: [],
    loading: true,
  },

  onShow() {
    this.load()
  },

  load() {
    this.setData({ loading: true })
    const app = getApp()
    app.ready()
      .then(() => api.fetchFavorites())
      .then((list) => {
        this.setData({ list: list || [], loading: false })
      })
      .catch((err) => {
        console.error('读取收藏失败', err)
        this.setData({ loading: false })
        wx.showToast({ title: '读取收藏失败，再下拉试试', icon: 'none' })
      })
  },

  onPullDownRefresh() {
    this.load()
    setTimeout(() => wx.stopPullDownRefresh(), 600)
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  // 帖子已被删除：点一下可以移除这条收藏记录
  onDeletedTap(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '帖子已被删除',
      content: '要不要把这条收藏记录也清掉？',
      confirmText: '清掉',
      confirmColor: '#e64340',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中' })
        api.toggleFavorite(id)
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已清理', icon: 'none' })
            this.load()
          })
          .catch((err) => {
            wx.hideLoading()
            wx.showToast({ title: (err && err.message) || '清理失败', icon: 'none' })
          })
      },
    })
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' })
  },
})
