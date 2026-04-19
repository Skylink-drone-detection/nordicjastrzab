const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=UTF-8',
  '.txt': 'text/plain; charset=UTF-8'
};

const root = __dirname;

function serveFile(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = err.code === 'ENOENT' ? 404 : 500;
      res.end(err.code === 'ENOENT' ? 'Not Found' : 'Server Error');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURI((req.url || '/').split('?')[0]);
  let filePath = urlPath === '/' ? '/index.html' : urlPath;

  const resolved = path.normalize(path.join(root, filePath));
  if (!resolved.startsWith(root)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  fs.stat(resolved, (err, stats) => {
    if (!err && stats.isDirectory()) {
      const indexPath = path.join(resolved, 'index.html');
      fs.access(indexPath, fs.constants.F_OK, (e) => {
        if (e) {
          res.statusCode = 404;
          res.end('Not Found');
        } else {
          serveFile(indexPath, res);
        }
      });
      return;
    }
    serveFile(resolved, res);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

