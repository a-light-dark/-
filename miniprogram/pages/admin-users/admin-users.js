// pages/admin-users/admin-users.js —— 用户管理（封禁 / 解封 / 设管理员）

const api = require('../../utils/api.js')

Page({
  data: {
    loading: true,
    checked: false,
    isAdmin: false,
    isOwner: false,
    keyword: '',
    list: [],
    total: 0,
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
        this.setData({ checked: true, isAdmin: who.admin, isOwner: who.owner })
        if (!who.admin) return null
        return api.adminUsersList(this.data.keyword, 1).then((res) => {
          const list = (res.list || []).map(function (u) {
            u.uid = String(u.openid || '').slice(-6)
            return u
          })
          this.setData({ list: list, total: res.total || 0 })
        })
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || '读取失败', icon: 'none' })
      })
      .then(stop)
  },

  onKeywordInput(e) {
    this._keyword = e.detail.value
  },

  doSearch() {
    this.setData({ keyword: (this._keyword || '').trim() })
    this.load()
  },

  clearSearch() {
    this._keyword = ''
    this.setData({ keyword: '' })
    this.load()
  },

  // 封禁：弹框填原因
  onBan(e) {
    const openid = e.currentTarget.dataset.openid
    const nick = e.currentTarget.dataset.nick
    if (!openid) return
    wx.showModal({
      title: '封禁 ' + nick + '？',
      content: '封禁后他不能发帖、评论、发悬赏、抢单、点赞。',
      editable: true,
      placeholderText: '封禁原因（选填）',
      confirmText: '封禁',
      confirmColor: '#e64340',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '封禁中', mask: true })
        api.adminBanUser(openid, res.content || '违规行为')
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已封禁', icon: 'success' })
            this.load()
          })
          .catch((err) => {
            wx.hideLoading()
            wx.showToast({ title: (err && err.message) || '封禁失败', icon: 'none' })
          })
      },
    })
  },

  onUnban(e) {
    const openid = e.currentTarget.dataset.openid
    const nick = e.currentTarget.dataset.nick
    if (!openid) return
    wx.showModal({
      title: '给 ' + nick + ' 解封？',
      content: '解封后他就能正常发言了。',
      confirmText: '解封',
      confirmColor: '#07c160',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '解封中', mask: true })
        api.adminUnbanUser(openid)
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已解封', icon: 'success' })
            this.load()
          })
          .catch((err) => {
            wx.hideLoading()
            wx.showToast({ title: (err && err.message) || '解封失败', icon: 'none' })
          })
      },
    })
  },

  // 设为管理员 / 取消管理员（只有圈主能用）
  onToggleRole(e) {
    const openid = e.currentTarget.dataset.openid
    const nick = e.currentTarget.dataset.nick
    const role = e.currentTarget.dataset.role
    if (!openid) return
    const toAdmin = role !== 'admin'
    wx.showModal({
      title: toAdmin ? ('把 ' + nick + ' 设为管理员？') : ('取消 ' + nick + ' 的管理员？'),
      content: toAdmin ? '他会多出「管理台」入口，可以处理举报、删帖、封人。' : '取消后他只剩普通用户权限。',
      confirmText: toAdmin ? '设为管理员' : '取消管理员',
      confirmColor: '#07c160',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中', mask: true })
        api.adminSetUserRole(openid, toAdmin ? 'admin' : '')
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已生效', icon: 'success' })
            this.load()
          })
          .catch((err) => {
            wx.hideLoading()
            wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' })
          })
      },
    })
  },

  goUser(e) {
    const openid = e.currentTarget.dataset.openid
    if (!openid) return
    wx.navigateTo({ url: '/pages/user/user?openid=' + encodeURIComponent(openid) })
  },
})
