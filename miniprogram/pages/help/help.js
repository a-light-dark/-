// pages/help/help.js —— 互助大厅：悬赏订单列表（数据来自云数据库）
// 订单点击进入详情页；抢单前弹确认框；完成需要发布人确认（双向确认）。

const api = require('../../utils/api.js')

const TABS = ['全部订单', '未被接单', '我发布的', '我帮助的']
const TAB_KEYS = ['all', 'pending', 'mine', 'helping']

Page({
  data: {
    tabs: TABS,
    currentTab: 0,
    orders: [],
    loading: false,
  },

  // 每次显示都重新拉一次（发完互助回来能看到自己的订单）
  onShow() {
    this.loadOrders()
  },

  loadOrders() {
    const key = TAB_KEYS[this.data.currentTab] || 'all'
    this.setData({ loading: true })
    api.fetchOrders(key)
      .then((res) => {
        this.setData({ orders: res.list, loading: false })
      })
      .catch((err) => {
        console.error('加载订单失败', err)
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败，看控制台', icon: 'none' })
      })
  },

  // 切换分类
  onTabTap(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (index === this.data.currentTab) return
    this.setData({ currentTab: index })
    this.loadOrders()
  },

  // 去发互助
  goPublish() {
    wx.switchTab({ url: '/pages/publish/publish' })
  },

  // 「我的接单」= 切到「我帮助的」
  goMyOrders() {
    this.setData({ currentTab: 3 })
    this.loadOrders()
  },

  // 点整张订单卡 → 订单详情页
  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/order/order?id=' + id })
  },

  // 抢单：先弹确认框，再接（云端条件更新，只有第一个人能成功）
  grab(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.orders.find(function (o) { return o.id === id })
    const amount = item ? item.amount : ''
    wx.showModal({
      title: '确认接单',
      content: '确认接下这个悬赏吗？金额 ¥' + amount + '。接单后请认真完成，完成要等对方确认。',
      confirmText: '接单',
      confirmColor: '#07c160',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '抢单中', mask: true })
        api.grabOrder(id)
          .then((r) => {
            wx.hideLoading()
            if (r && r.ok) {
              wx.showToast({ title: '接单成功', icon: 'success' })
              this.loadOrders()
              // 接完直接进详情页，双方信息一目了然
              setTimeout(() => {
                wx.navigateTo({ url: '/pages/order/order?id=' + id })
              }, 600)
            } else {
              wx.showToast({ title: (r && r.msg) || '抢单失败', icon: 'none' })
            }
          })
          .catch((err) => {
            wx.hideLoading()
            console.error('抢单失败', err)
            wx.showToast({ title: (err && err.message) || '抢单失败', icon: 'none' })
          })
      },
    })
  },

  // 接单人标记完成（进「待确认」，详情页里也能操作）
  done(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '标记完成',
      content: '确认已完成这份悬赏了吗？标记后要等发布人确认，确认完成才算数。',
      confirmText: '标记完成',
      confirmColor: '#07c160',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中', mask: true })
        api.doneOrder(id)
          .then((r) => {
            wx.hideLoading()
            if (r && r.ok) {
              wx.showToast({ title: '已标记，等对方确认', icon: 'none' })
              this.loadOrders()
            } else {
              wx.showToast({ title: (r && r.msg) || '操作失败', icon: 'none' })
            }
          })
          .catch((err) => {
            wx.hideLoading()
            console.error('标记完成失败', err)
            wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' })
          })
      },
    })
  },

  comingSoon() {
    wx.showToast({ title: '功能即将上线', icon: 'none' })
  },
})
