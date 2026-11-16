const app = getApp()
const api = require('../../utils/api')

function sizeLabel(size) {
  if (!size) return '0 KB'
  if (size < 1024) return size + ' B'
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB'
  return (size / 1024 / 1024).toFixed(2) + ' MB'
}

function timeLabel(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
  return Math.floor(diff / 86400000) + ' 天前'
}

Page({
  data: {
    checked: false,
    isAdmin: false,
    loading: false,
    backing: false,
    list: [],
    total: 0,
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
        return api.adminBackupList()
      })
      .then((res) => {
        if (!res) return
        const list = (res.list || []).map(function (b) {
          return Object.assign({}, b, { sizeLabel: sizeLabel(b.size), time: timeLabel(b.createdAt) })
        })
        this.setData({ list: list, total: res.total || 0, loading: false })
        finish()
      })
      .catch((err) => {
        this.setData({ loading: false })
        wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' })
        finish()
      })
  },

  onBackup() {
    if (this.data.backing) return
    wx.showModal({
      title: '立即备份？',
      content: '会把帖子、评论、订单、用户等 17 个集合导出成一个 JSON 文件存到云存储，可以下载保存。',
      confirmText: '开始备份',
      success: (r) => {
        if (!r.confirm) return
        this.setData({ backing: true })
        wx.showLoading({ title: '备份中…', mask: true })
        api.adminBackupCreate()
          .then((res) => {
            wx.hideLoading()
            this.setData({ backing: false })
            wx.showToast({ title: '备份完成（' + sizeLabel(res.size) + '）', icon: 'success' })
            this.load()
          })
          .catch((err) => {
            wx.hideLoading()
            this.setData({ backing: false })
            wx.showToast({ title: (err && err.message) || '备份失败', icon: 'none' })
          })
      },
    })
  },

  onCopy(e) {
    const id = e.currentTarget.dataset.id
    wx.showLoading({ title: '生成链接…', mask: true })
    api.adminBackupDownload(id)
      .then((res) => {
        wx.hideLoading()
        wx.setClipboardData({
          data: res.url,
          success: function () {
            wx.showToast({ title: '下载链接已复制，去浏览器打开', icon: 'none' })
          },
        })
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: (err && err.message) || '链接生成失败', icon: 'none' })
      })
  },

  onRemove(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除这份备份？',
      content: '云存储里的备份文件也会一起删掉。',
      confirmText: '删除',
      confirmColor: '#e64340',
      success: (r) => {
        if (!r.confirm) return
        api.adminBackupRemove(id)
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
