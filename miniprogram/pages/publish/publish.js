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
    editPostId: '',     // 非空表示「正在编辑这条帖子」
    fromDetail: false,  // 编辑是从详情页点进来的（保存后回到详情，而不是首页）
  },

  // 从话题页 / 别的页面带参数进来：?mode=post&tag=树洞
  // 也支持 ?edit=<帖子 id>（编辑模式）
  onLoad(options) {
    const opts = options || {}
    if (opts.mode === 'post' || opts.mode === 'help') {
      this.setData({ mode: opts.mode })
    }
    if (opts.tag) this.pickTopic(decodeURIComponent(opts.tag))
    if (opts.edit) this.loadForEdit(String(opts.edit))
  },

  // 话题页点「参与话题」、详情页点「编辑」都会先存 globalData（switchTab 不能带参数）
  onShow() {
    const app = getApp()
    if (!app || !app.globalData) return

    const editId = app.globalData.pendingEdit
    if (editId) {
      app.globalData.pendingEdit = ''
      if (String(editId) !== this.data.editPostId) {
        this.setData({ fromDetail: true })
        this.loadForEdit(String(editId))
      }
      return
    }

    // 普通发帖：把之前编辑留下的标题/状态复原
    if (!this.data.editPostId && this._titleEdited) {
      wx.setNavigationBarTitle({ title: '发帖' })
      this._titleEdited = false
    }

    const tag = app.globalData.pendingTopic
    if (!tag) return
    app.globalData.pendingTopic = ''
    this.setData({ mode: 'post', content: this._content || '', editPostId: '' })
    this.pickTopic(tag)
  },

  // 载入一条帖子到编辑模式：正文、话题回填（图片暂不支持编辑）
  loadForEdit(postId) {
    wx.showLoading({ title: '加载中', mask: true })
    api.fetchPost(postId).then((res) => {
      wx.hideLoading()
      const post = (res && res.post) || null
      if (!post) {
        this.resetEdit('帖子不存在或已删除')
        return
      }
      // 别人的帖子不能编辑（列表缓存可能过期，服务端也会再拦一次）
      if (post.mine === false) {
        this.resetEdit('只能编辑自己发的帖子')
        return
      }
      const tags = post.tags || []
      if (tags.length === 0) tags.push('日常投稿')
      // 老帖子可能挂了 5 个以上话题，编辑时只保留前 5 个（和服务端上限一致）
      const checkedNames = tags.slice(0, 5)
      this._content = post.content || ''
      this.setData({
        mode: 'post',
        editPostId: postId,
        content: post.content || '',
        topics: TOPIC_NAMES.map((name) => ({ name, checked: checkedNames.indexOf(name) > -1 })).slice(0, 9),
        images: [],
        anonymous: false,
      })
      wx.setNavigationBarTitle({ title: '编辑帖子' })
      this._titleEdited = true
    }).catch((err) => {
      wx.hideLoading()
      this.resetEdit((err && err.message) || '加载失败')
    })
  },

  // 编辑状态兜底：加载失败 / 点了「取消编辑」都走这里，避免页面卡在编辑模式
  resetEdit(tip) {
    this._content = ''
    this._titleEdited = false
    this.setData({ mode: 'choose', editPostId: '', fromDetail: false, content: '', topics: buildTopics() })
    wx.setNavigationBarTitle({ title: '发帖' })
    if (tip) wx.showToast({ title: tip, icon: 'none' })
  },

  onCancelEdit() {
    this.resetEdit('已退出编辑')
  },

  // 选中某个话题（其他都取消）
  pickTopic(name) {
    const topics = this.data.topics.map((t) => Object.assign({}, t, { checked: t.name === name }))
    this.setData({ topics })
  },

  // ===== 选类型 =====
  // 切回发帖/发互助时，把之前的草稿从实例变量还原到 textarea（textarea 是受 value 控制的）
  choosePost() {
    this.setData({ mode: 'post', content: this._content || '' })
  },
  chooseHelp() {
    this.setData({ mode: 'help', helpContent: this._helpContent || '' })
  },
  backToChoose() {
    this.setData({ mode: 'choose' })
  },

  // ===== 发帖子 =====
  // 输入时只存到页面实例上，不 setData：少一次整页重渲染，长文打字不卡
  onContentInput(e) {
    this._content = e.detail.value
  },

  // 取正文：优先用输入缓存，其次 data（程序重置后的兜底）
  getContent() {
    return String(this._content !== undefined ? this._content : this.data.content || '').trim()
  },

  // 点话题：选中 / 取消选中
  onTopicTap(e) {
    const name = e.currentTarget.dataset.name
    const target = this.data.topics.filter((t) => t.name === name)[0]
    if (!target) return
    // 没勾的想勾上时，先看是不是已经选了 5 个（和服务端上限一致）
    if (!target.checked) {
      const checkedCount = this.data.topics.filter((t) => t.checked).length
      if (checkedCount >= 5) {
        wx.showToast({ title: '最多选 5 个话题', icon: 'none' })
        return
      }
    }
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

    const content = this.getContent()

    if (!content) {
      wx.showToast({ title: '先写点什么吧', icon: 'none' })
      return
    }

    // 编辑模式：只保存正文和话题，图片保持原样
    if (this.data.editPostId) {
      this.saveEdit(content)
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

    // 图片并行上传：串行 6 张要等好几个来回，并行快很多
    // 没连云开发时跳过上传，直接把本地路径交给本地演示数据
    const fileIDs = new Array(localImages.length)
    const uploading = useCloud && localImages.length
      ? Promise.all(localImages.map((path, i) => {
          return api.uploadPostImage(path).then((fileID) => {
            fileIDs[i] = fileID
            uploaded.push(fileID)
          }).catch(() => {
            throw new Error('第 ' + (i + 1) + ' 张图片上传失败，检查下网络再试')
          })
        }))
      : Promise.resolve()

    uploading
      .then(() => {
        if (useCloud && localImages.length) wx.showLoading({ title: '发布中', mask: true })
        const images = useCloud ? fileIDs.filter(Boolean) : localImages
        return api.createPost({ content, tags, anonymous, images })
      })
      .then(() => {
        wx.hideLoading()
        // 告诉首页「有新帖了」，回去时刷新一下列表
        const app = getApp()
        if (app && app.globalData) app.globalData.postsDirty = true
        this._content = ''
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

  // ===== 编辑已有帖子（只改正文和话题）=====
  saveEdit(content) {
    const tags = this.data.topics.filter((t) => t.checked).map((t) => t.name)
    if (tags.length === 0) tags.push('日常投稿')

    const editId = this.data.editPostId
    const fromDetail = !!this.data.fromDetail

    this.setData({ submitting: true })
    wx.showLoading({ title: '保存中', mask: true })

    api.updatePost(editId, { content, tags })
      .then(() => {
        wx.hideLoading()
        const app = getApp()
        if (app && app.globalData) app.globalData.postsDirty = true
        this._content = ''
        this.setData({ editPostId: '', fromDetail: false, content: '', topics: buildTopics(), mode: 'choose' })
        if (this._titleEdited) {
          wx.setNavigationBarTitle({ title: '发帖' })
          this._titleEdited = false
        }
        wx.showToast({ title: '已保存', icon: 'success' })
        // 编辑入口在详情页：switchTab 已经把详情页关掉了，这里重新打开它
        setTimeout(() => {
          if (fromDetail && editId) {
            wx.navigateTo({ url: '/pages/detail/detail?id=' + editId })
          } else {
            wx.switchTab({ url: '/pages/index/index' })
          }
        }, 500)
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
      })
      .then(() => this.setData({ submitting: false }))
  },

  // ===== 发互助 =====
  onHelpInput(e) {
    this._helpContent = e.detail.value
  },

  getHelpContent() {
    return String(this._helpContent !== undefined ? this._helpContent : this.data.helpContent || '').trim()
  },

  onAmountInput(e) {
    this.setData({ amount: e.detail.value })
  },

  submitHelp() {
    if (this.data.submitting) return

    const helpContent = this.getHelpContent()
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
        const app = getApp()
        if (app && app.globalData) app.globalData.ordersDirty = true
        this._helpContent = ''
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
