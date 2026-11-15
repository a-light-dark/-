// pages/publish/publish.js —— 发帖 / 发互助，数据写进云数据库（没连上云开发就退回本地演示）

const api = require('../../utils/api.js')

// 帖子可以选的话题（首页四个分类入口也在这里，方便帖子被筛出来）
const TOPIC_NAMES = [
  '日常投稿', '树洞', '表白墙', '新鲜事', '二手',
  '跑腿代取', '学习搭子', '失物招领', '脱单交友',
]

// 生成话题列表（每个话题带 checked 选中标记）
// 注意：WXML 里不能调用 .indexOf() 之类的方法，所以选中状态要在这里提前算好
function buildTopics() {
  return TOPIC_NAMES.map((name) => ({ name, checked: false }))
}

// 压缩一张图（失败就用原图），发帖前压一下，能过 750KB 的图片检测限制
function compressImage(path) {
  return new Promise((resolve) => {
    wx.compressImage({
      src: path,
      quality: 70,
      success: (res) => resolve(res.tempFilePath),
      fail: () => resolve(path),
    })
  })
}

Page({
  data: {
    mode: 'choose',     // choose=选类型 / post=发帖子 / help=发互助
    topics: buildTopics(),
    content: '',        // 帖子正文
    images: [],         // 选好的图片（本地临时路径）
    helpContent: '',    // 互助描述
    amount: '',         // 悬赏金额
    anonymous: false,   // 是否匿名发布
    submitting: false,  // 正在提交（防重复提交）
  },

  // 从话题页 / 别的页面带参数进来：?mode=post&tag=树洞
  onLoad(options) {
    const opts = options || {}
    if (opts.mode === 'post' || opts.mode === 'help') {
      this.setData({ mode: opts.mode })
    }
    if (opts.tag) this.pickTopic(decodeURIComponent(opts.tag))
  },

  // 话题页点「参与话题」会先存 globalData.pendingTopic（switchTab 不能带参数）
  onShow() {
    const app = getApp()
    const tag = app && app.globalData ? app.globalData.pendingTopic : ''
    if (!tag) return
    app.globalData.pendingTopic = ''
    this.setData({ mode: 'post' })
    this.pickTopic(tag)
  },

  // 选中某个话题（其他都取消）
  pickTopic(name) {
    const topics = this.data.topics.map((t) => Object.assign({}, t, { checked: t.name === name }))
    this.setData({ topics })
  },

  // ===== 选类型 =====
  choosePost() {
    this.setData({ mode: 'post' })
  },
  chooseHelp() {
    this.setData({ mode: 'help' })
  },
  backToChoose() {
    this.setData({ mode: 'choose' })
  },

  // ===== 发帖子 =====
  onContentInput(e) {
    this.setData({ content: e.detail.value })
  },

  // 点话题：选中 / 取消选中
  onTopicTap(e) {
    const name = e.currentTarget.dataset.name
    const topics = this.data.topics.map((t) =>
      t.name === name ? Object.assign({}, t, { checked: !t.checked }) : t
    )
    this.setData({ topics })
  },

  // 匿名开关
  onAnonymousChange(e) {
    this.setData({ anonymous: e.detail.value })
  },

  // ===== 选图（最多 6 张）=====
  pickImages() {
    const left = 6 - this.data.images.length
    if (left <= 0) return
    wx.chooseMedia({
      count: left,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const files = res.tempFiles || []
        Promise.all(files.map((f) => compressImage(f.tempFilePath))).then((paths) => {
          this.setData({ images: this.data.images.concat(paths) })
        })
      },
    })
  },

  previewImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    wx.previewImage({ current: this.data.images[index], urls: this.data.images })
  },

  removeImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const images = this.data.images.slice()
    images.splice(index, 1)
    this.setData({ images })
  },

  submitPost() {
    // 防重复提交：上一次还没发完，直接忽略（双击/连续点不会发两条）
    if (this.data.submitting) return

    const content = this.data.content.trim()

    if (!content) {
      wx.showToast({ title: '先写点什么吧', icon: 'none' })
      return
    }

    // 选出勾选的话题；一个都没选就默认「日常投稿」
    const tags = this.data.topics
      .filter((t) => t.checked)
      .map((t) => t.name)
    if (tags.length === 0) tags.push('日常投稿')

    const localImages = this.data.images.slice()
    const anonymous = this.data.anonymous
    const useCloud = api.isCloudReady()
    const uploaded = [] // 已经传上去的 fileID，失败时用来清理

    this.setData({ submitting: true })
    wx.showLoading({
      title: useCloud && localImages.length ? '上传图片中' : '发布中',
      mask: true,
    })

    // 先把图片挨张传到云存储，拿到 fileID 再发帖（云函数会逐张做内容检测）
    // 没连云开发时跳过上传，直接把本地路径交给本地演示数据
    const uploading = localImages.reduce((chain, path, i) => chain.then(() => {
      return api.uploadPostImage(path)
        .then((fileID) => { uploaded.push(fileID) })
        .catch(() => { throw new Error('第 ' + (i + 1) + ' 张图片上传失败，检查下网络再试') })
    }), Promise.resolve())

    ;(useCloud ? uploading : Promise.resolve())
      .then(() => {
        if (useCloud && localImages.length) wx.showLoading({ title: '发布中', mask: true })
        const images = useCloud ? uploaded.slice() : localImages
        return api.createPost({ content, tags, anonymous, images })
      })
      .then(() => {
        wx.hideLoading()
        // 告诉首页「有新帖了」，回去时刷新一下列表
        const app = getApp()
        if (app && app.globalData) app.globalData.postsDirty = true
        this.setData({
          content: '',
          images: [],
          topics: buildTopics(),
          anonymous: false,
          mode: 'choose',
        })
        wx.showToast({ title: '发布成功', icon: 'success' })
        wx.switchTab({ url: '/pages/index/index' })
      })
      .catch((err) => {
        wx.hideLoading()
        console.error('发布失败', err)
        // 发帖失败（比如内容没过审核），把刚传上去的图删掉，别在云存储里留垃圾
        if (uploaded.length) api.deleteFiles(uploaded)
        wx.showToast({ title: (err && err.message) || '发布失败', icon: 'none' })
      })
      .then(() => this.setData({ submitting: false }))
  },

  // ===== 发互助 =====
  onHelpInput(e) {
    this.setData({ helpContent: e.detail.value })
  },

  onAmountInput(e) {
    this.setData({ amount: e.detail.value })
  },

  submitHelp() {
    if (this.data.submitting) return

    const helpContent = this.data.helpContent.trim()
    const amount = Number(this.data.amount)

    if (!helpContent) {
      wx.showToast({ title: '描述一下需要帮什么忙', icon: 'none' })
      return
    }
    if (!amount || amount <= 0) {
      wx.showToast({ title: '填一下悬赏金额', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '发布中', mask: true })
    api.createOrder({ content: helpContent, amount: amount })
      .then(() => {
        wx.hideLoading()
        this.setData({ helpContent: '', amount: '', mode: 'choose' })
        wx.showToast({ title: '发布成功', icon: 'success' })
        wx.switchTab({ url: '/pages/help/help' })
      })
      .catch((err) => {
        wx.hideLoading()
        console.error('发布互助失败', err)
        wx.showToast({ title: (err && err.message) || '发布失败', icon: 'none' })
      })
      .then(() => this.setData({ submitting: false }))
  },
})
