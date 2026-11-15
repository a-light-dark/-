// pages/feedback/feedback.js —— 建议反馈：提交 + 我的反馈记录
const api = require('../../utils/api.js')

Page({
  data: {
    content: '',
    contact: '',
    submitting: false,
    loading: false,
    list: [],
    maxLen: 500,
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    const that = this
    this.load()
    setTimeout(function () {
      wx.stopPullDownRefresh()
    }, 500)
  },

  load() {
    const that = this
    this.setData({ loading: true })
    api.fetchMyFeedback()
      .then(function (list) {
        that.setData({ list: list, loading: false })
      })
      .catch(function (err) {
        console.error('读取我的反馈失败', err)
        that.setData({ loading: false })
      })
  },

  onInput(e) {
    this.setData({ content: e.detail.value })
  },

  onContactInput(e) {
    this.setData({ contact: e.detail.value })
  },

  onSubmit() {
    if (this.data.submitting) return
    const content = String(this.data.content || '').trim()
    if (content.length < 5) {
      wx.showToast({ title: '多写几个字吧（至少 5 个字）', icon: 'none' })
      return
    }
    const that = this
    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中', mask: true })
    api.createFeedback(content, String(this.data.contact || '').trim())
      .then(function (res) {
        wx.hideLoading()
        that.setData({ submitting: false, content: '', contact: '' })
        wx.showToast({ title: res && res.offline ? '已记下（本地演示）' : '已收到，谢谢', icon: 'none' })
        that.load()
      })
      .catch(function (err) {
        wx.hideLoading()
        that.setData({ submitting: false })
        wx.showToast({ title: (err && err.message) || '提交失败', icon: 'none' })
      })
  },
})
