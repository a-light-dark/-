const app = getApp()
const api = require('../../utils/api')

Page({
  data: {
    checked: false,
    isAdmin: false,
    loading: false,
    list: [],
    total: 0,
    word: '',
    adding: false,
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load(function () {
      wx.stopPullDownRefresh()
    })
  },

  load(done) {
    const finish = done || function () {}
    this.setData({ loading: true })
    app.ready()
      .then(function () {
        return api.adminWhoAmI()
      })
      .then((res) => {
        if (!res.admin) {
          this.setData({ checked: true, isAdmin: false, loading: false })
          finish()
          return null
        }
        this.setData({ checked: true, isAdmin: true })
        return api.adminWordsList()
      })
      .then((res) => {
        if (!res) return
        this.setData({ list: res.list || [], total: res.total || 0, loading: false })
        finish()
      })
      .catch((err) => {
        this.setData({ loading: false })
        wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' })
        finish()
      })
  },

  onWordInput(e) {
    this.setData({ word: e.detail.value })
  },

  onAdd() {
    const word = String(this.data.word || '').trim()
    if (!word) return wx.showToast({ title: '先输入一个词', icon: 'none' })
    if (this.data.adding) return
    this.setData({ adding: true })
    api.adminWordAdd(word)
      .then(() => {
        this.setData({ word: '', adding: false })
        wx.showToast({ title: '已加入词库', icon: 'success' })
        this.load()
      })
      .catch((err) => {
        this.setData({ adding: false })
        wx.showToast({ title: (err && err.message) || '添加失败', icon: 'none' })
      })
  },

  onRemove(e) {
    const id = e.currentTarget.dataset.id
    const word = e.currentTarget.dataset.word
    wx.showModal({
      title: '删掉「' + word + '」？',
      content: '删掉后，带这个词的内容就能正常发布了。',
      confirmText: '删除',
      confirmColor: '#e64340',
      success: (r) => {
        if (!r.confirm) return
        api.adminWordRemove(id)
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' })
            this.load()
          })
          .catch((err) => {
            wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
          })
      },
    })
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' })
  },
})
