// pages/earnings/earnings.js —— 我的收益：
// 我帮别人完成、且对方已确认的悬赏订单（金额合计 + 明细）

const api = require('../../utils/api.js')

Page({
  data: {
    total: '0.00',
    count: 0,
    list: [],
    loading: true,
    offline: false,
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh())
  },

  load() {
    this.setData({ loading: true })
    return api.fetchEarnings()
      .then((res) => {
        this.setData({
          total: res.total,
          count: res.count,
          list: res.list,
          loading: false,
          offline: !!res.offline,
        })
      })
      .catch((err) => {
        console.error('加载收益失败', err)
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败，看控制台', icon: 'none' })
      })
  },

  goOrder(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/order/order?id=' + id })
  },

  goHelp() {
    wx.switchTab({ url: '/pages/help/help' })
  },
})
