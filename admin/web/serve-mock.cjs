const http = require('http')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, 'dist-mock')
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
}

http
  .createServer(function (req, res) {
    let p = decodeURIComponent(req.url.split('?')[0])
    if (p === '/') p = '/index.html'
    let file = path.join(root, p)
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html')
    const ext = path.extname(file)
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  .listen(5055, '127.0.0.1', function () {
    console.log('serving dist-mock on http://127.0.0.1:5055')
  })
