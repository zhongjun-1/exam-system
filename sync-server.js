var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');

var PORT = 8765;
var ROOT_DIR = __dirname;
var SYNC_FILE = path.join(ROOT_DIR, 'sync-data.json');
var MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function loadSyncData() {
  try {
    var raw = fs.readFileSync(SYNC_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return { data: {}, lastUpdate: 0, lastDevice: '', updateCount: 0 };
  }
}

function saveSyncData(obj) {
  obj.lastUpdate = Date.now();
  obj.updateCount = (obj.updateCount || 0) + 1;
  fs.writeFileSync(SYNC_FILE, JSON.stringify(obj, null, 2), 'utf-8');
}

function getBody(req, callback) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () {
    callback(Buffer.concat(chunks).toString('utf-8'));
  });
  req.on('error', function (e) { callback(null); });
}

function sendJSON(res, code, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function sendFile(res, filePath) {
  try {
    var stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stat = fs.statSync(filePath);
    }
    var ext = path.extname(filePath).toLowerCase();
    var mime = MIME_TYPES[ext] || 'application/octet-stream';
    var range = null;

    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    });
    var stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found: ' + path.basename(filePath));
  }
}

var server = http.createServer(function (req, res) {
  var parsed = url.parse(req.url, true);
  var pathname = decodeURIComponent(parsed.pathname);
  var method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // API routes
  if (pathname === '/api/sync/pull' && method === 'GET') {
    var syncData = loadSyncData();
    sendJSON(res, 200, syncData);
    return;
  }

  if (pathname === '/api/sync/push' && method === 'POST') {
    getBody(req, function (body) {
      if (!body) { sendJSON(res, 400, { error: 'Empty body' }); return; }
      try {
        var payload = JSON.parse(body);
        var current = loadSyncData();
        // Merge: incoming data overwrites existing keys
        if (!current.data) current.data = {};
        var newKeys = 0;
        var updatedKeys = 0;
        Object.keys(payload.data || {}).forEach(function (key) {
          if (current.data[key] !== payload.data[key]) {
            if (current.data[key] === undefined) newKeys++;
            else updatedKeys++;
            current.data[key] = payload.data[key];
          }
        });
        current.lastDevice = payload.device || 'unknown';
        saveSyncData(current);
        sendJSON(res, 200, {
          success: true,
          newKeys: newKeys,
          updatedKeys: updatedKeys,
          totalKeys: Object.keys(current.data).length,
          lastUpdate: current.lastUpdate,
          updateCount: current.updateCount
        });
      } catch (e) {
        sendJSON(res, 400, { error: 'Invalid JSON: ' + e.message });
      }
    });
    return;
  }

  if (pathname === '/api/sync/status' && method === 'GET') {
    var syncData2 = loadSyncData();
    var dataStr = JSON.stringify(syncData2.data || {});
    sendJSON(res, 200, {
      lastUpdate: syncData2.lastUpdate || 0,
      lastDevice: syncData2.lastDevice || '',
      updateCount: syncData2.updateCount || 0,
      keyCount: Object.keys(syncData2.data || {}).length,
      dataSize: dataStr.length
    });
    return;
  }

  if (pathname === '/api/sync/reset' && method === 'POST') {
    try {
      fs.unlinkSync(SYNC_FILE);
      sendJSON(res, 200, { success: true, message: 'Sync data cleared' });
    } catch (e) {
      sendJSON(res, 200, { success: true, message: 'Nothing to clear' });
    }
    return;
  }

  // Static file serving
  if (pathname === '/' || pathname === '') pathname = '/综合题库考试系统.html';
  var safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  var filePath = path.join(ROOT_DIR, safePath);
  if (filePath.indexOf(ROOT_DIR) !== 0) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }
  sendFile(res, filePath);
});

server.listen(PORT, '0.0.0.0', function () {
  var nets = [];
  try {
    var os = require('os');
    var ifaces = os.networkInterfaces();
    Object.keys(ifaces).forEach(function (name) {
      ifaces[name].forEach(function (iface) {
        if (iface.family === 'IPv4' && !iface.internal) {
          nets.push('http://' + iface.address + ':' + PORT);
        }
      });
    });
  } catch (e) {}

  console.log('========================================');
  console.log('  同步服务器已启动');
  console.log('========================================');
  console.log('');
  console.log('本机访问:');
  console.log('  http://127.0.0.1:' + PORT);
  console.log('');
  if (nets.length > 0) {
    console.log('局域网访问 (其他设备用这些地址):');
    nets.forEach(function (n) { console.log('  ' + n); });
  }
  console.log('');
  console.log('API 端点:');
  console.log('  GET  /api/sync/pull   - 拉取数据');
  console.log('  POST /api/sync/push   - 推送数据');
  console.log('  GET  /api/sync/status - 同步状态');
  console.log('  POST /api/sync/reset  - 清除同步数据');
  console.log('');
  console.log('按 Ctrl+C 停止服务器');
  console.log('');
});

process.on('uncaughtException', function (err) {
  console.error('服务器错误:', err.message);
});
