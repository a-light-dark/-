// pages/detail/detail.js —— 帖子详情：点赞 / 收藏 / 评论（数据来自云数据库）

const api = require('../../utils/api.js')

Page({
  data: {
    post: null,
    comments: [],
    inputValue: '',
    liked: false,     // 我有没有点过赞
    loading: true,
    replyId: '',      // 正在回复的「根评论」id，空表示发顶层评论
    replyNick: '',    // 正在回复谁（展示用）
    inputFocus: false,
    replyPlaceholder: '说点什么…',
  },

  onLoad(options) {
    this.postId = String(options.id || '')
    this._loaded = true
    this.loadAll()
    // 浏览量 +1（5 分钟内重复进同一条不重复算）
    api.incView(this.postId).then((views) => {
      if (views && this.data.post) {
        this.setData({ post: Object.assign({}, this.data.post, { views: views }) })
      }
    }).catch(() => {})
  },

  // 从编辑页回来时刷新，避免还显示旧正文
  onShow() {
    if (!this._loaded || !this.postId) return
    const app = getApp()
    if (app && app.globalData && app.globalData.postsDirty) {
      this.loadAll()
    }
  },

  loadAll() {
    this.setData({ loading: true })
    Promise.all([
      api.fetchPost(this.postId),
      api.fetchComments(this.postId),
    ])
      .then((res) => {
        const detail = res[0]
        this.setData({
          post: detail.post,
          liked: !!detail.liked,
          favorited: !!detail.favorited,
          comments: res[1] || [],
          loading: false,
        })
      })
      .catch((err) => {
        console.error('打开帖子失败', err)
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败，看控制台', icon: 'none' })
      })
  },

  // 点赞 / 取消点赞（云端由 likePost 云函数处理）
  // 先本地翻转给即时反馈，请求失败再回滚，避免「点了没反应」
  toggleLike() {
    const post = this.data.post
    if (!post || this._liking) return
    this._liking = true

    const wasLiked = !!this.data.liked
    const wasCount = Number(post.likeCount) || 0
    const nextLiked = !wasLiked
    const nextCount = Math.max(0, wasCount + (nextLiked ? 1 : -1))

    this.setData({
      liked: nextLiked,
      post: Object.assign({}, post, { likeCount: nextCount }),
    })
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })

    api.toggleLike(this.postId)
      .then((res) => {
        this.setData({
          liked: !!res.liked,
          post: Object.assign({}, this.data.post, { likeCount: res.likeCount }),
        })
      })
      .catch((err) => {
        console.error('点赞失败', err)
        this.setData({
          liked: wasLiked,
          post: Object.assign({}, this.data.post, { likeCount: wasCount }),
        })
        const title = (err && err.message) ? err.message : '网络慢了点，再点一次'
        wx.showToast({ title: title.length > 16 ? '点赞失败，再试一次' : title, icon: 'none' })
      })
      .then(() => {
        setTimeout(() => { this._liking = false }, 300)
      })
  },

  // 收藏（写进 favorites 集合，重启后还在）
  // 和点赞一样先本地翻转，失败再回滚
  toggleCollect() {
    if (this._collecting) return
    this._collecting = true
    const wasFavorited = !!this.data.favorited
    const next = !wasFavorited
    this.setData({ favorited: next })
    api.toggleFavorite(this.postId)
      .then((res) => {
        this.setData({ favorited: !!res.favorited })
        wx.showToast({ title: res.favorited ? '已收藏' : '已取消收藏', icon: 'none' })
      })
      .catch((err) => {
        console.error('收藏失败', err)
        this.setData({ favorited: wasFavorited })
        wx.showToast({ title: '收藏失败，再试一次', icon: 'none' })
      })
      .then(() => { this._collecting = false })
  },

  // ===== 自己的帖子：编辑 =====
  // 发布页是 tabBar 页，switchTab 带不了参数，所以先把 id 存到 globalData
  onEdit() {
    const post = this.data.post
    if (!post) return
    const app = getApp()
    if (!app || !app.globalData) return
    if (!api.isCloudReady()) {
      wx.showToast({ title: '离线演示模式不能编辑', icon: 'none' })
      return
    }
    app.globalData.pendingEdit = String(post.id)
    wx.switchTab({
      url: '/pages/publish/publish',
      fail: () => {
        app.globalData.pendingEdit = ''
        wx.showToast({ title: '打开编辑页失败，再试一次', icon: 'none' })
      },
    })
  },

  // ===== 自己的帖子：删除 =====
  onDelete() {
    const post = this.data.post
    if (!post) return
    wx.showModal({
      title: '删除这条帖子？',
      content: '删除后这条帖子、它的评论和点赞都会一起消失，无法恢复。',
      confirmText: '删除',
      confirmColor: '#e64340',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中', mask: true })
        api.deletePost(post.id)
          .then(() => {
            wx.hideLoading()
            // 告诉首页「列表变了」，回去刷新
            const app = getApp()
            if (app && app.globalData) app.globalData.postsDirty = true
            wx.showToast({ title: '已删除', icon: 'success' })
            // 从分享/通知直接进来的详情页没有上一页，退回首页
            setTimeout(() => {
              wx.navigateBack({
                fail: () => wx.switchTab({ url: '/pages/index/index' }),
              })
            }, 600)
          })
          .catch((err) => {
            wx.hideLoading()
            wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
          })
      },
    })
  },

  // ===== 别人的帖子：举报 =====
  onReport() {
    const post = this.data.post
    if (!post) return
    wx.showActionSheet({
      itemList: api.REPORT_REASONS,
      success: (res) => {
        const reason = api.REPORT_REASONS[res.tapIndex]
        wx.showLoading({ title: '提交中', mask: true })
        api.reportPost(post.id, reason)
          .then((r) => {
            wx.hideLoading()
            wx.showToast({ title: r.duplicate ? '你已经举报过啦' : '已收到举报，谢谢你', icon: 'none' })
          })
          .catch((err) => {
            wx.hideLoading()
            wx.showToast({ title: (err && err.message) || '举报失败', icon: 'none' })
          })
      },
    })
  },

  onInput(e) {
    // 只在实例里记草稿，不 setData，避免每敲一个字整页重渲染
    this._draft = e.detail.value || ''
  },

  // 点某条评论的「回复」：记住根评论 id 和对方昵称
  onReplyTap(e) {
    const ds = e.currentTarget.dataset
    this.startReply(String(ds.root || ds.id || ''), String(ds.nick || ''))
  },

  // 开始回复某条评论（长按菜单和「回复」按钮都走这里）
  startReply(rootId, nick) {
    if (!rootId) return
    this._draft = ''
    this.setData({
      replyId: rootId,
      replyNick: nick,
      replyPlaceholder: '回复 @' + nick + '…',
      inputValue: '',
      inputFocus: true,
    })
  },

  // 长按帖子正文：复制内容 / 举报（别人的）或删除（自己的）
  onPostLongPress() {
    const post = this.data.post
    if (!post) return
    const items = ['复制内容']
    items.push(post.mine ? '删除这条帖子' : '举报')
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        if (res.tapIndex === 0) {
          this.copyText(post.content)
        } else if (post.mine) {
          this.onDelete()
        } else {
          this.onReport()
        }
      },
    })
  },

  // 长按评论 / 回复：复制 / 回复 / 删除（自己的）
  onCommentLongPress(e) {
    const ds = e.currentTarget.dataset
    const id = String(ds.id || '')
    if (!id) return
    const items = ['复制', '回复']
    if (ds.mine === true || ds.mine === 'true') items.push('删除')
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const label = items[res.tapIndex]
        if (label === '复制') {
          this.copyText(ds.content)
        } else if (label === '回复') {
          this.startReply(String(ds.root || id), String(ds.nick || ''))
        } else if (label === '删除') {
          this.confirmDeleteComment(ds)
        }
      },
    })
  },

  // 复制到剪贴板，方便发给微信好友
  copyText(text) {
    const t = String(text || '').trim()
    if (!t) return
    wx.setClipboardData({
      data: t,
      success: () => wx.showToast({ title: '已复制', icon: 'none' }),
    })
  },

  // 删除评论前确认；顶层评论有回复会连带删掉
  confirmDeleteComment(ds) {
    const id = String(ds.id || '')
    if (!id) return
    const isReply = ds.parent === true || ds.parent === 'true'
    const replyCount = Number(ds.replies || 0)
    let content = '删除后不可恢复'
    if (!isReply && replyCount > 0) {
      content = '这条评论下面还有 ' + replyCount + ' 条回复，会一起删掉，删除后不可恢复'
    }
    wx.showModal({
      title: isReply ? '删除这条回复？' : '删除这条评论？',
      content: content,
      confirmText: '删除',
      confirmColor: '#e64340',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中', mask: true })
        api.deleteComment(id)
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已删除', icon: 'success' })
            this.loadAll()
          })
          .catch((err) => {
            wx.hideLoading()
            wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
          })
      },
    })
  },

  onCancelReply() {
    this._draft = ''
    this.setData({ replyId: '', replyNick: '', replyPlaceholder: '说点什么…', inputValue: '' })
  },

  // 从草稿里取内容（点击「发送」和键盘发送都走这里）
  getDraft() {
    return String(this._draft !== undefined ? this._draft : this.data.inputValue || '').trim()
  },

  // 右上角「…」→ 转发给同学 / 群：带帖子内容和第一张图
  onShareAppMessage() {
    const post = this.data.post || {}
    const content = String(post.content || '').replace(/\s+/g, ' ').trim()
    return {
      title: content ? content.slice(0, 30) : '校园圈 · 看看这条帖子',
      path: '/pages/detail/detail?id=' + this.postId,
      imageUrl: post.images && post.images.length ? post.images[0] : '',
    }
  },

  // 分享到朋友圈
  onShareTimeline() {
    const post = this.data.post || {}
    const content = String(post.content || '').replace(/\s+/g, ' ').trim()
    return {
      title: content ? content.slice(0, 30) : '校园圈 · 看看这条帖子',
      query: 'id=' + this.postId,
      imageUrl: post.images && post.images.length ? post.images[0] : '',
    }
  },

  // 点图片放大看
  previewImage(e) {
    const src = e.currentTarget.dataset.src
    const images = (this.data.post && this.data.post.images) || []
    if (!images.length) return
    wx.previewImage({ current: src, urls: images })
  },

  // 点话题标签进话题页
  goTopic(e) {
    const tag = e.currentTarget.dataset.tag
    if (!tag) return
    wx.navigateTo({ url: '/pages/topic/topic?tag=' + encodeURIComponent(tag) })
  },

  // 帖子被删/不存在时，给一个回首页的出口
  goHome() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  // 点作者头像/昵称：进个人主页
  goUser(e) {
    const openid = e.currentTarget.dataset.openid
    if (e.currentTarget.dataset.anon) { wx.showToast({ title: '匿名帖不显示作者主页', icon: 'none' }); return }
    if (!openid) {
      wx.showToast({ title: '演示数据没有主页', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/user/user?openid=' + encodeURIComponent(openid) })
  },

  // 发评论：写进 comments 集合，同时给帖子评论数 +1
  // 楼中楼：replyId 有值就挂在那条根评论下面
  sendComment() {
    const text = this.getDraft()
    if (!text) {
      wx.showToast({ title: '说点什么吧', icon: 'none' })
      return
    }
    if (this._sending) return // 防连点发两条
    this._sending = true

    const parentId = this.data.replyId
    const replyTo = this.data.replyNick
    const isReply = !!parentId

    api.addComment(this.postId, text, parentId, replyTo)
      .then((res) => {
        const comment = res.comment
        this._draft = ''

        let comments = this.data.comments
        if (isReply) {
          comments = comments.map((c) => {
            if (String(c.id) !== String(parentId)) return c
            return Object.assign({}, c, { replies: (c.replies || []).concat([comment]) })
          })
        } else {
          comments = [comment].concat(comments)
        }

        this.setData({
          comments: comments,
          replyId: '',
          replyNick: '',
          replyPlaceholder: '说点什么…',
          inputValue: '',
          inputFocus: false,
          post: Object.assign({}, this.data.post, {
            commentCount: (this.data.post.commentCount || 0) + 1,
          }),
        })
        wx.showToast({ title: isReply ? '回复成功' : '评论成功', icon: 'success' })
        // 滚到评论开头，让人看到自己刚发的那条
        wx.pageScrollTo({ selector: '#comments', duration: 200 })
      })
      .catch((err) => {
        console.error('评论失败', err)
        wx.showToast({ title: err.message || '评论失败，再试一次', icon: 'none' })
      })
      .then(() => { this._sending = false })
  },
})
