const app = getApp()
const api = require('../../utils/api')

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
    checked: false,   // 是否已确认过身份
    isAdmin: false,
    loading: false,
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
        return api.adminTrashList(1)
      })
      .then((res) => {
        if (!res) return
        const list = (res.list || []).map(function (item) {
          return Object.assign({}, item, {
            typeName: item.type === 'comment' ? '评论' : '帖子',
            time: timeLabel(item.deletedAt),
          })
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

  onRestore(e) {
    const id = e.currentTarget.dataset.id
    const typeName = e.currentTarget.dataset.type === 'comment' ? '这条评论' : '这条帖子'
    wx.showModal({
      title: '恢复' + typeName + '？',
      content: '会回到原来的位置。帖子的点赞、评论和图片不会一起回来（那些删的时候就清掉了）。',
      confirmText: '恢复',
      success: (r) => {
        if (!r.confirm) return
        wx.showLoading({ title: '恢复中' })
        api.adminTrashRestore(id)
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已恢复', icon: 'success' })
            this.load()
          })
          .catch((err) => {
            wx.hideLoading()
            wx.showToast({ title: (err && err.message) || '恢复失败', icon: 'none' })
          })
      },
    })
  },

  onPurge(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '彻底删除？',
      content: '这条记录会从回收站里消失，再也找不回来。',
      confirmText: '彻底删除',
      confirmColor: '#e64340',
      success: (r) => {
        if (!r.confirm) return
        wx.showLoading({ title: '删除中' })
        api.adminTrashPurge(id)
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已删除', icon: 'success' })
            this.load()
          })
          .catch((err) => {
            wx.hideLoading()
            wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
          })
      },
    })
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' })
  },
})
