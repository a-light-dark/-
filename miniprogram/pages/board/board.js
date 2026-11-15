// pages/board/board.js —— 本周榜单：热帖 Top5 + 活跃同学 Top5
const api = require('../../utils/api.js')

Page({
  data: {
    hot: [],
    users: [],
    loading: true,
    offline: false,
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
    this.setData({ loading: true })
    return Promise.all([
      api.fetchWeeklyHot(5),
      api.fetchActiveUsers(5),
    ]).then((res) => {
      this.setData({
        hot: res[0] || [],
        users: res[1] || [],
        loading: false,
        offline: !api.isCloudReady(),
      })
    }).catch((err) => {
      console.error('榜单加载失败', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败，看控制台', icon: 'none' })
    })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  goUser(e) {
    const name = e.currentTarget.dataset.name
    wx.showToast({ title: '@' + name + ' 的个人主页还在做', icon: 'none' })
  },
})
