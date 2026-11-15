// 云函数：updateProfile —— 改昵称/头像
// 昵称会公开展示，所以也要过内容安全（scene 1 = 资料）
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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

// 图片内容安全：把云存储里的头像下下来送检
// 返回 {ok:true} 通过 / {ok:false,msg} 违规（同时删掉这张图）/ {ok:true,apiError:true} 接口异常先放行
async function checkImage(fileID) {
  let file = null
  try {
    file = await cloud.downloadFile({ fileID: fileID })
  } catch (err) {
    console.warn('downloadFile 失败（先放行）', fileID, err && err.errMsg)
    return { ok: true, apiError: true }
  }
  const buffer = file && file.fileContent
  if (!buffer || !buffer.length) return { ok: false, msg: '头像读取失败，重新选一张' }
  if (buffer.length > 750 * 1024) return { ok: false, msg: '头像有点大（超过 750KB），换一张小点儿的' }

  const matched = /\.(\w+)(\?|$)/.exec(String(fileID))
  const ext = matched ? matched[1].toLowerCase() : 'png'
  const contentType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'gif' ? 'image/gif'
      : ext === 'webp' ? 'image/webp'
        : 'image/png'

  try {
    const res = await cloud.openapi.security.imgSecCheck({
      media: { contentType: contentType, value: buffer },
    })
    if (Number(res.errCode) === 87014) {
      await cloud.deleteFile({ fileList: [fileID] }).catch(function () {})
      return { ok: false, msg: '头像不太合适，换一张试试' }
    }
    return { ok: true }
  } catch (err) {
    if (Number(err.errCode) === 87014) {
      await cloud.deleteFile({ fileList: [fileID] }).catch(function () {})
      return { ok: false, msg: '头像不太合适，换一张试试' }
    }
    console.warn('imgSecCheck 调用失败（先放行）', err && err.errCode, err && err.errMsg)
    return { ok: true, apiError: true }
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const nickname = String(event.nickname || '').trim()
  const avatar = String(event.avatar || '')

  if (nickname.length < 2 || nickname.length > 12) {
    return { ok: false, msg: '昵称需要 2-12 个字' }
  }

  // 头像只接受两种：短表情（😀 这种）或者自己 avatars/<openid>/ 下的云文件
  // 防止客户端塞进别人的图或任意网址
  if (avatar) {
    const isCloudFile = avatar.indexOf('cloud://') === 0
    if (isCloudFile) {
      if (avatar.indexOf('avatars/' + OPENID + '/') === -1) {
        return { ok: false, msg: '头像地址不对，重新上传一下' }
      }
    } else if (avatar.length > 8 || avatar.indexOf('://') > -1) {
      return { ok: false, msg: '头像格式不对，重新选一张' }
    }
  }

  const check = await checkText(nickname, 1, OPENID) // scene 1 = 资料
  if (!check.ok) return { ok: false, msg: '昵称可能不太合适，换一个试试', suggest: check.suggest }

  // 头像是云文件的话，还要过一遍图片内容安全（违规会顺手删掉刚传的图）
  if (avatar && avatar.indexOf('cloud://') === 0) {
    const img = await checkImage(avatar)
    if (!img.ok) return { ok: false, msg: img.msg }
  }

  // 先看 users 里有没有这条记录
  const found = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
  const doc = (found.data || [])[0]
  const data = { nickname: nickname, updatedAt: db.serverDate() }
  if (avatar) data.avatar = avatar

  if (!doc) {
    await db.collection('users').add({
      data: {
        nickname: nickname,
        avatar: avatar || '😀',
        createdAt: db.serverDate(),
        _openid: OPENID,
      },
    })
    return { ok: true, profile: { nickname: nickname, avatar: avatar || '😀' } }
  }

  await db.collection('users').doc(doc._id).update({ data: data })
  return { ok: true, profile: { nickname: nickname, avatar: avatar || doc.avatar || '😀' } }
}
