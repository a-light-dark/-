// pages/profile/profile.js —— 个人资料：改昵称、换头像
const api = require('../../utils/api.js')

Page({
  data: {
    nickname: '',        // 昵称输入框里的值
    avatar: '😀',        // 已经保存的头像（表情，或者云存储图片地址）
    avatarPreview: '',   // 刚选好、还没保存的本地图片
    hasAvatarImage: false, // 已保存的头像是不是图片
    saving: false,
  },

  onLoad() {
    const app = getApp()
    app.ready()
      .then(() => api.fetchProfile())
      .then((doc) => {
        const avatar = (doc && doc.avatar) || '😀'
        this.setData({
          nickname: (doc && doc.nickname) || '',
          avatar: avatar,
          hasAvatarImage: api.isImagePath(avatar),
        })
      })
      .catch((err) => {
        console.error('读取个人资料失败', err)
        wx.showToast({ title: '读取资料失败', icon: 'none' })
      })
  },

  // 点头像：微信官方的「头像昵称填写」能力（按钮 open-type="chooseAvatar"）
  onChooseAvatar(e) {
    const url = e.detail && e.detail.avatarUrl
    if (url) this.setData({ avatarPreview: url })
  },

  // 兜底：从相册/相机选一张（开发者工具里更好测）
  onPickImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (file) this.setData({ avatarPreview: file.tempFilePath })
      },
    })
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value })
  },

  // 头像先压一下再传：同步图片检测接口单张上限 750KB，压过之后基本都能过
  compressAvatar(path) {
    return new Promise((resolve) => {
      if (!wx.compressImage) {
        resolve(path)
        return
      }
      wx.compressImage({
        src: path,
        quality: 70,
        success: (res) => resolve(res.tempFilePath || path),
        fail: () => resolve(path),
      })
    })
  },

  onSave() {
    const nickname = String(this.data.nickname || '').trim()
    if (nickname.length < 2 || nickname.length > 12) {
      wx.showToast({ title: '昵称 2-12 个字', icon: 'none' })
      return
    }
    if (this.data.saving) return

    this.setData({ saving: true })
    wx.showLoading({ title: '保存中', mask: true })

    // 选了新头像就先压缩、传到云存储，拿到 fileID 再存进 users
    const preview = this.data.avatarPreview
    const avatarTask = preview
      ? this.compressAvatar(preview).then((localPath) => api.uploadAvatar(localPath))
      : Promise.resolve(this.data.avatar)

    avatarTask
      .then((avatar) => api.saveProfile({ nickname: nickname, avatar: avatar }))
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: '已保存', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 600)
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
        this.setData({ saving: false })
      })
  },
})
