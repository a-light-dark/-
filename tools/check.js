// tools/check.js —— 项目自检脚本（不参与小程序打包）
// 用法：在 campus-forum 目录下执行  node tools/check.js
// 检查：JSON 语法、页面文件齐不齐、tabBar 配置、WXML 事件函数有没有定义、
//       WXML 里有没有非法的方法调用、require 路径对不对

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const mp = path.join(root, 'miniprogram')
let problems = 0

function fail(msg) {
  problems += 1
  console.log('✗ ' + msg)
}

// 一段检查：里面没报错才算通过
function step(name, fn) {
  const before = problems
  fn()
  if (problems === before) console.log('✓ ' + name)
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue
      walk(p, out)
    } else {
      out.push(p)
    }
  }
  return out
}

const files = walk(root)
const appJson = JSON.parse(fs.readFileSync(path.join(mp, 'app.json'), 'utf8'))

// 1) JSON 全部可解析
step('JSON 全部可解析', () => {
  for (const f of files.filter((f) => f.endsWith('.json'))) {
    try {
      JSON.parse(fs.readFileSync(f, 'utf8'))
    } catch (e) {
      fail('JSON 语法错误: ' + path.relative(root, f) + ' — ' + e.message)
    }
  }
})

// 2) app.json 里注册的页面，4 个文件都要存在
step('页面文件齐全（' + appJson.pages.length + ' 个页面）', () => {
  for (const p of appJson.pages) {
    for (const ext of ['.js', '.json', '.wxml', '.wxss']) {
      const f = path.join(mp, p + ext)
      if (!fs.existsSync(f)) fail('缺少文件: ' + path.relative(root, f))
    }
  }
})

// 3) tabBar 里的页面必须在 pages 注册
step('tabBar 配置正常', () => {
  for (const item of appJson.tabBar.list) {
    if (!appJson.pages.includes(item.pagePath)) {
      fail('tabBar 页面没在 pages 里注册: ' + item.pagePath)
    }
  }
})

// 4) WXML 里绑定的事件，JS 里必须有同名方法
step('事件处理函数全部有定义', () => {
  for (const p of appJson.pages) {
    const wxml = fs.readFileSync(path.join(mp, p + '.wxml'), 'utf8')
    const js = fs.readFileSync(path.join(mp, p + '.js'), 'utf8')
    const names = new Set()
    const re = /(?:bind|catch)[a-z]*="([A-Za-z_$][\w$]*)"/g
    let m
    while ((m = re.exec(wxml))) names.add(m[1])
    for (const name of names) {
      if (!new RegExp('\\b' + name + '\\s*\\(').test(js)) {
        fail(p + '.wxml 用了事件 ' + name + '，但 ' + p + '.js 里没定义')
      }
    }
  }
})

// 5) WXML 表达式里不能调用方法（小程序不支持，比如 arr.indexOf(x)）
step('WXML 表达式没有方法调用', () => {
  for (const f of files.filter((f) => f.endsWith('.wxml'))) {
    const text = fs.readFileSync(f, 'utf8')
    const re = /\{\{[^}]*\.[A-Za-z_$][\w$]*\s*\(/g
    let m
    while ((m = re.exec(text))) {
      fail('WXML 表达式里调用了方法（不支持）: ' + path.relative(root, f) + ' → ' + m[0])
    }
  }
})

// 6) require 的路径要真实存在（跳过 fs / path 这类 Node 内置模块）
step('require 路径全部存在', () => {
  for (const f of files.filter((f) => f.endsWith('.js'))) {
    const text = fs.readFileSync(f, 'utf8')
    const re = /require\('([^']+)'\)/g
    let m
    while ((m = re.exec(text))) {
      if (!m[1].startsWith('.')) continue
      const target = path.resolve(path.dirname(f), m[1])
      const candidates = [target, target + '.js', path.join(target, 'index.js')]
      if (!candidates.some((c) => fs.existsSync(c))) {
        fail('require 路径不存在: ' + m[1] + '（在 ' + path.relative(root, f) + '）')
      }
    }
  }
})

console.log('')
console.log(problems === 0 ? '全部通过 ✅' : '发现 ' + problems + ' 个问题 ❌')
process.exit(problems === 0 ? 0 : 1)
