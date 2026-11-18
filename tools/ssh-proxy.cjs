// tools/ssh-proxy.cjs —— 让 git 走本机 HTTP 代理连接 ssh.github.com:443
// 用法：GIT_SSH_COMMAND='ssh -o ProxyCommand="node tools/ssh-proxy.cjs %h %p"' git push
// 说明：本机 DNS 被代理接管（fake-ip 198.18.x.x），直连 443 会被关连接，所以用 HTTP CONNECT 打隧道。
const http = require('http')
const net = require('net')

const host = process.argv[2] || 'ssh.github.com'
const port = Number(process.argv[3] || 443)
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:7890'
const u = new URL(proxy)

const req = http.request({
  host: u.hostname,
  port: Number(u.port || 80),
  method: 'CONNECT',
  path: host + ':' + port,
  headers: { Host: host + ':' + port },
})

req.on('connect', (res, socket) => {
  if (res.statusCode !== 200) {
    process.stderr.write('proxy CONNECT failed: ' + res.statusCode + '\n')
    process.exit(1)
  }
  process.stdin.pipe(socket)
  socket.pipe(process.stdout)
  socket.on('error', () => process.exit(0))
  socket.on('close', () => process.exit(0))
})
req.on('error', (err) => {
  process.stderr.write('proxy error: ' + err.message + '\n')
  process.exit(1)
})
req.end()
