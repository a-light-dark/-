// pages/order/order.js —— 订单详情：
// 抢单有确认框、完成是双向确认（接单人标记 → 发布人确认），
// 发布人可撤销没人接的悬赏，接单人可取消接单。

const api = require('../../utils/api.js')

Page({
  data: {
    order: null,
    loading: true,
    statusClass: '',
    statusText: '',
    // 当前用户在这单里能做什么
    canGrab: false,      // 待接单 && 不是自己发的
    canDone: false,      // 我是接单人 && 已接单
    canConfirm: false,   // 我是发布人 && 待确认
    canCancel: false,    // 我是发布人 && 待接单
    canRelease: false,   // 我是接单人 && 已接单
    myReview: null,      // 我给对方的评价
    theirReview: null,   // 对方给我的评价
  },

  onLoad(options) {
    this.orderId = options && options.id ? String(options.id) : ''
    this.load()
  },

  onShow() {
    // 从别的页面改完状态回来刷新一次（比如发布人确认完）
    if (this.orderId) this.load()
  },

  load() {
    this.setData({ loading: true })
    Promise.all([
      api.fetchOrder(this.orderId),
      api.fetchOrderReviews(this.orderId).catch(() => null),
    ])
      .then((arr) => {
        const order = arr[0]
        const reviews = arr[1] || {}
        const s = order.status || ''
        this.setData({
          order: order,
          ownerAvatarIsImage: api.isImagePath(order.ownerAvatar),
          takerAvatarIsImage: api.isImagePath(order.takerAvatar),
          loading: false,
          statusClass: this.classOf(s),
          canGrab: s === '待接单' && !order.mine,
          canDone: s === '已接单' && order.takenByMe,
          canConfirm: s === '待确认' && order.mine,
          canCancel: s === '待接单' && order.mine,
          canRelease: s === '已接单' && order.takenByMe,
          myReview: reviews.myReview || null,
          theirReview: reviews.theirReview || null,
        })
        wx.setNavigationBarTitle({ title: '订单 · ' + s })
      })
      .catch((err) => {
        console.error('加载订单失败', err)
        this.setData({ loading: false })
        wx.showToast({ title: (err && err.message) || '订单不存在', icon: 'none' })
      })
  },

  // 进评价页（双方确认完成后才能评）
  goReview() {
    if (!this.orderId) return
    wx.navigateTo({ url: '/pages/review/review?id=' + this.orderId })
  },

  classOf(s) {
    if (s === '待接单') return 'pending'
    if (s === '已接单') return 'taken'
    if (s === '待确认') return 'confirming'
    if (s === '已撤销') return 'cancelled'
    return 'done'
  },

  // 通用动作壳：弹确认框 → 调 api → 刷新
  act(action, tip, fn) {
    const o = this.data.order || {}
    wx.showModal({
      title: '确认操作',
      content: tip,
      confirmText: action,
      confirmColor: '#07c160',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中', mask: true })
        fn(o.id)
          .then((r) => {
            wx.hideLoading()
            if (r && r.ok) {
              wx.showToast({ title: '操作成功', icon: 'success' })
              if (action === '确认完成') getApp().globalData.ordersDirty = true
              if (action === '撤销订单' || action === '取消接单') getApp().globalData.ordersDirty = true
              this.load()
            } else {
              wx.showToast({ title: (r && r.msg) || '操作失败', icon: 'none' })
            }
          })
          .catch((err) => {
            wx.hideLoading()
            console.error('操作失败', err)
            wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' })
          })
      },
    })
  },

  onGrab() {
    const o = this.data.order
    this.act('接单', '确认接下这个悬赏吗？金额 ¥' + o.amount + '。接单后请认真完成，完成要等对方确认。', (id) => api.grabOrder(id))
  },

  onDone() {
    this.act('标记完成', '确认已完成这份悬赏了吗？标记后要等发布人确认，对方确认完成才算数。', (id) => api.doneOrder(id))
  },

  onConfirm() {
    this.act('确认完成', '确认接单的同学已完成任务了吗？确认后这笔悬赏会记入对方的收益。', (id) => api.confirmOrder(id))
  },

  onCancel() {
    this.act('撤销订单', '确定撤销这条悬赏吗？撤销后大厅里就看不到了。', (id) => api.cancelOrder(id))
  },

  onRelease() {
    this.act('取消接单', '确定取消接单吗？取消后这条悬赏会重新回到大厅，其他人可以接。', (id) => api.releaseOrder(id))
  },

  goHelp() {
    wx.switchTab({ url: '/pages/help/help' })
  },
})
