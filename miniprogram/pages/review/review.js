// pages/review/review.js —— 订单评价：给这单的对方打分 + 写一句话，也可以投诉
const api = require('../../utils/api.js')

const COMPLAIN_REASONS = ['服务态度差', '东西有问题', '临时加价', '联系不上', '其他']

Page({
  data: {
    orderId: '',
    loading: true,
    order: null,
    stars: [1, 2, 3, 4, 5],
    score: 5,
    text: '',
    submitting: false,
    canReview: false,
    reviews: { count: 0, myReview: null, theirReview: null },
    otherName: '',
  },

  onLoad(options) {
    this.setData({ orderId: String((options && options.id) || '') })
    this.load()
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh())
  },

  load() {
    if (!this.data.orderId) {
      this.setData({ loading: false })
      return Promise.resolve()
    }
    return getApp().ready()
      .then(() => Promise.all([api.fetchOrder(this.data.orderId), api.fetchOrderReviews(this.data.orderId)]))
      .then((arr) => {
        const order = arr[0] || null
        const reviews = arr[1] || { count: 0, myReview: null, theirReview: null }
        const isParticipant = !!(order && (order.mine || order.takenByMe))
        this.setData({
          loading: false,
          order: order,
          reviews: reviews,
          canReview: !!order && order.status === '已完成' && isParticipant && !reviews.myReview,
          otherName: order ? (order.mine ? order.takerNickname : order.ownerNickname) : '',
        })
      })
      .catch((err) => {
        console.error('加载评价页失败', err)
        this.setData({ loading: false })
        wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' })
      })
  },

  onStarTap(e) {
    this.setData({ score: Number(e.currentTarget.dataset.score) })
  },

  onTextInput(e) {
    this.setData({ text: e.detail.value })
  },

  submit() {
    if (this.data.submitting) return
    if (!this.data.score) {
      wx.showToast({ title: '先打个星级', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中', mask: true })
    api.createReview(this.data.orderId, this.data.score, this.data.text)
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: '评价成功', icon: 'success' })
        this.setData({ submitting: false })
        setTimeout(() => this.load(), 800)
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ submitting: false })
        wx.showToast({ title: (err && err.message) || '评价失败', icon: 'none' })
      })
  },

  // 投诉：不单独建集合，直接写进「建议反馈」，圈主在反馈管理里处理
  onComplain() {
    const that = this
    wx.showActionSheet({
      itemList: COMPLAIN_REASONS,
      success(res) {
        const reason = COMPLAIN_REASONS[res.tapIndex]
        const o = that.data.order || {}
        const content = '订单投诉：' + reason + '（订单 ' + String(o.id || '').slice(-6) + '，金额 ¥' + (o.amount || '0.00') + '）'
        wx.showLoading({ title: '提交中', mask: true })
        api.createFeedback(content, '')
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已提交给圈主', icon: 'none' })
          })
          .catch((err) => {
            wx.hideLoading()
            wx.showToast({ title: (err && err.message) || '提交失败', icon: 'none' })
          })
      },
    })
  },

  goOrder() {
    wx.navigateBack()
  },
})
