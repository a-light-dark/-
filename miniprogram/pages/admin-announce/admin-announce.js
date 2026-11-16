// pages/admin-announce/admin-announce.js —— 公告管理

const api = require('../../utils/api.js')

Page({
  data: {
    loading: true,
    checked: false,
    isAdmin: false,
    list: [],
    // 新建表单
    composing: false,
    title: '',
    content: '',
    pinned: false,
    saving: false,
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load(true)
  },

  load(fromPull) {
    const app = getApp()
    if (!fromPull) this.setData({ loading: true })

    const stop = () => {
      this.setData({ loading: false })
      if (fromPull) wx.stopPullDownRefresh()
    }

    return app.ready()
      .then(() => api.adminWhoAmI())
      .then((who) => {
        this.setData({ checked: true, isAdmin: who.admin })
        if (!who.admin) return null
        return api.adminAnnouncements().then((res) => this.setData({ list: res.list || [] }))
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || '读取失败', icon: 'none' })
      })
      .then(stop)
  },

  openComposer() {
    this.setData({ composing: true, title: '', content: '', pinned: false })
  },

  noop() {},

  closeComposer() {
    this.setData({ composing: false })
  },

  onTitleInput(e) {
    this._title = e.detail.value
  },

  onContentInput(e) {
    this._content = e.detail.value
  },

  onPinnedToggle(e) {
    this.setData({ pinned: e.detail.value })
  },

  save() {
    const title = String(this._title || '').trim()
    const content = String(this._content || '').trim()
    if (!title || !content) {
      wx.showToast({ title: '标题和内容都要填', icon: 'none' })
      return
    }
    if (this.data.saving) return
    this.setData({ saving: true })
    wx.showLoading({ title: '发布中', mask: true })
    api.adminCreateAnnouncement(title, content, this.data.pinned)
      .then(() => {
        wx.hideLoading()
        this.setData({ saving: false, composing: false })
        wx.showToast({ title: '公告已发布', icon: 'success' })
        this.load()
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ saving: false })
        wx.showToast({ title: (err && err.message) || '发布失败', icon: 'none' })
      })
  },

  onPin(e) {
    const id = e.currentTarget.dataset.id
    const pinned = e.currentTarget.dataset.pinned
    const title = e.currentTarget.dataset.title
    const content = e.currentTarget.dataset.content
    if (!id) return
    api.adminUpdateAnnouncement(id, { title: title, content: content, pinned: !pinned })
      .then(() => {
        wx.showToast({ title: pinned ? '已取消置顶' : '已置顶', icon: 'success' })
        this.load()
      })
      .catch((err) => wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }))
  },

  onToggleActive(e) {
    const id = e.currentTarget.dataset.id
    const active = e.currentTarget.dataset.active
    const title = e.currentTarget.dataset.title
    const content = e.currentTarget.dataset.content
    if (!id) return
    api.adminUpdateAnnouncement(id, { title: title, content: content, active: !active })
      .then(() => {
        wx.showToast({ title: active ? '已下架' : '已上架', icon: 'success' })
        this.load()
      })
      .catch((err) => wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }))
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showModal({
      title: '删除这条公告？',
      content: '删除后首页不会再显示它。',
      confirmText: '删除',
      confirmColor: '#e64340',
      success: (res) => {
        if (!res.confirm) return
        api.adminRemoveAnnouncement(id)
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' })
            this.load()
          })
          .catch((err) => wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' }))
      },
    })
  },
})
