// 云函数：createPost —— 发帖
// 做四件事：① 文字内容安全检测（msgSecCheck）② 图片内容安全检测（imgSecCheck）
//           ③ 服务端补昵称/头像（不让客户端伪造）④ 写进 posts
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 允许的话题白名单：只收这几个名字，防止客户端塞任意字符串当标签
const TOPIC_NAMES = [
  '日常投稿', '树洞', '表白墙', '新鲜事', '二手',
  '跑腿代取', '学习搭子', '失物招领', '脱单交友',
]

// 调微信文字内容安全接口
// suggest: pass 通过 / review 人工审核 / risky 违规
// 接口本身报错（没权限、超频、网络）时先放行并打日志，避免整个功能不可用
async function checkText(content, scene, openid) {
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      content: String(content || '').slice(0, 2500),
      version: 2,
      scene: scene,
      openid: openid,
    })
    const suggest = (res.result && res.result.suggest) || 'pass'
    return { ok: suggest === 'pass', suggest: suggest }
  } catch (err) {
    console.warn('msgSecCheck 调用失败（先放行）', err && err.errCode, err && err.errMsg)
    return { ok: true, apiError: true }
  }
}

// 检查一张云存储图片：下载下来交给 imgSecCheck
// 同步接口限制 750KB，所以客户端会先压缩；超了直接拒绝，不放过去
async function checkImage(fileID) {
  try {
    const download = await cloud.downloadFile({ fileID: fileID })
    const buffer = download && download.fileContent
    if (!buffer || !buffer.length) return { ok: false, msg: '图片读不出来，重新传一下' }
    if (buffer.length > 750 * 1024) return { ok: false, msg: '图片有点大（超过 750KB），换一张小一点儿的' }

    const matched = /\.(\w+)(?:\?|$)/.exec(fileID)
    const ext = matched ? matched[1].toLowerCase() : 'jpg'
    const contentType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg'

    const res = await cloud.openapi.security.imgSecCheck({
      media: { contentType: contentType, value: buffer },
    })
    // 87014 = 内容含违规信息
    if (res && Number(res.errCode) === 87014) return { ok: false, suggest: 'risky' }
    return { ok: true }
  } catch (err) {
    const code = Number((err && (err.errCode || err.code)) || 0)
    if (code === 87014) return { ok: false, suggest: 'risky' }
    console.warn('imgSecCheck 调用失败（先放行）', code, err && (err.errMsg || err.message))
    return { ok: true, apiError: true }
  }
}

// 云函数默认超时只有 3 秒，图片检测卡住就先放行，别让整个发帖失败
function checkImageGuarded(fileID) {
  return Promise.race([
    checkImage(fileID),
    new Promise((resolve) => setTimeout(() => resolve({ ok: true, timeout: true }), 1500)),
  ])
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const content = String(event.content || '').trim()
  const tags = Array.isArray(event.tags)
    ? event.tags.filter((t) => TOPIC_NAMES.indexOf(t) > -1).slice(0, 5)
    : []
  const anonymous = !!event.anonymous
  const rawImages = Array.isArray(event.images) ? event.images.slice(0, 9) : []
  const images = rawImages.map((v) => String(v || '')).filter(Boolean)

  if (!content) return { ok: false, msg: '内容不能为空' }
  if (content.length > 1000) return { ok: false, msg: '内容太长啦，1000 字以内' }
  if (images.length > 9) return { ok: false, msg: '图片最多 9 张' }

  // 只认「自己上传到 posts/<openid>/ 下」的 fileID，防止冒用别人的文件
  const ownPrefix = 'posts/' + OPENID + '/'
  for (let i = 0; i < images.length; i++) {
    if (images[i].indexOf('cloud://') !== 0 || images[i].indexOf(ownPrefix) === -1) {
      return { ok: false, msg: '第 ' + (i + 1) + ' 张图片地址不对，重新上传一下' }
    }
  }

  // 昵称、头像从 users 读：客户端传什么都不可信
  let nickname = '同学' + String(OPENID).slice(-4)
  let avatar = '😀'
  try {
    const user = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
    if (user.data && user.data[0]) {
      nickname = user.data[0].nickname || nickname
      avatar = user.data[0].avatar || avatar
    }
  } catch (err) {
    console.warn('读取用户资料失败', err && err.errMsg)
  }
  if (anonymous) {
    nickname = '匿名同学'
    avatar = '🎭'
  }

  const textCheck = await checkText(content, 3, OPENID) // scene 3 = 论坛
  if (!textCheck.ok) return { ok: false, msg: '内容可能不太合适，换个说法再试试', suggest: textCheck.suggest }

  // 图片检测（并行），任何一张不过就整帖拒绝，并删掉刚传的文件
  if (images.length) {
    const imageChecks = await Promise.all(images.map(checkImageGuarded))
    for (let i = 0; i < imageChecks.length; i++) {
      if (!imageChecks[i].ok) {
        try { await cloud.deleteFile({ fileList: images }) } catch (e) {}
        return {
          ok: false,
          msg: imageChecks[i].msg || ('第 ' + (i + 1) + ' 张图片没通过审核，换一张试试'),
          suggest: imageChecks[i].suggest || 'risky',
        }
      }
    }
  }

  const added = await db.collection('posts').add({
    data: {
      content: content,
      tags: tags,
      images: images,
      nickname: nickname,
      avatar: avatar,
      anonymous: anonymous,
      likeCount: 0,
      commentCount: 0,
      createdAt: db.serverDate(),
      _openid: OPENID,
    },
  })

  return { ok: true, id: added._id, nickname: nickname, avatar: avatar, imageCount: images.length }
}
