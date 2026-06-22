var LOG = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
var _logLevel = LOG.INFO;

function log(level, msg) {
  if (level >= _logLevel) {
    Java.type('java.lang.System').out.println('[autobridge] ' + ['DEBUG','INFO','WARN','ERROR'][level] + ' ' + msg);
  }
}

var _config = {
  host: "127.0.0.1",
  port: 8765,
  apiKey: "",
  rateLimit: 50,
  logLevel: "INFO"
};

function loadConfig() {
  try {
    var Paths = Java.type('java.nio.file.Paths');
    var Files = Java.type('java.nio.file.Files');
    var configPath = Paths.get('config/autobridge/config.json');
    if (Files.exists(configPath)) {
      var bytes = Files.readAllBytes(configPath);
      var content = Java.type('java.lang.String')(bytes, Java.type('java.nio.charset.StandardCharsets').UTF_8);
      var parsed = JSON.parse(content);
      for (var k in _config) {
        if (parsed[k] !== undefined) {
          _config[k] = parsed[k];
        }
      }
      if (_config.logLevel === "DEBUG") _logLevel = LOG.DEBUG;
      else if (_config.logLevel === "INFO") _logLevel = LOG.INFO;
      else if (_config.logLevel === "WARN") _logLevel = LOG.WARN;
      else if (_config.logLevel === "ERROR") _logLevel = LOG.ERROR;
      _config.port = Math.max(1024, Math.min(65535, Math.floor(_config.port)));
      if (_config.host !== '127.0.0.1') {
        _config.host = '127.0.0.1';
      }
      _config.rateLimit = Math.max(1, Math.min(200, Math.floor(_config.rateLimit)));
      log(LOG.DEBUG, "Config loaded from " + configPath.toAbsolutePath().toString());
    } else {
      Files.createDirectories(configPath.getParent());
      var defaultContent = JSON.stringify(_config, null, 2);
      Files.write(configPath, defaultContent.getBytes(Java.type('java.nio.charset.StandardCharsets').UTF_8));
      log(LOG.INFO, "Created default config at config/autobridge/config.json");
    }
  } catch (e) {
    log(LOG.ERROR, "Config load error: " + (e.message || e));
  }
}

var _authMap = new Java.type('java.util.concurrent.ConcurrentHashMap')();
var _lastCmdTime = {};
var _connectTime = {};

function _checkRateLimit(connId) {
  var now = Date.now();
  var last = _lastCmdTime[connId] || 0;
  var minInterval = 1000 / (_config.rateLimit || 50);
  if (now - last < minInterval) return false;
  _lastCmdTime[connId] = now;
  return true;
}

function _sendResponse(connId, msg) {
  try {
    globalThis.__bridge.ws.send(connId, JSON.stringify(msg));
  } catch (e) {
    log(LOG.ERROR, "Send error: " + (e.message || e));
  }
}

function _handleMessage(connId, raw) {
  var msg;
  try {
    msg = JSON.parse(raw);
  } catch (e) {
    _sendResponse(connId, { id: null, type: 'error', error: { code: -32700, message: 'Parse error' } });
    return;
  }
  if (typeof msg.type !== 'string' || msg.type === '') {
    _sendResponse(connId, { id: msg.id || null, type: 'error', error: { code: -32602, message: 'Missing type field' } });
    return;
  }
  if (_config.apiKey && _config.apiKey.length > 0) {
    if (!_connectTime[connId]) _connectTime[connId] = Date.now();
    if (Date.now() - _connectTime[connId] > 30000) {
      _sendResponse(connId, { id: msg.id || null, type: 'error', error: { code: 4003, message: 'Auth timeout' } });
      _authMap.remove(connId);
      delete _connectTime[connId];
      return;
    }
    if (msg.type !== 'auth' && !_authMap.get(connId)) {
      _sendResponse(connId, { id: msg.id || null, type: 'error', error: { code: 4001, message: 'Not authenticated' } });
      return;
    }
    if (msg.type === 'auth') {
      var p = msg.payload || {};
      if (p.apiKey === _config.apiKey) {
        _authMap.put(connId, true);
        _sendResponse(connId, { id: msg.id || null, type: 'auth', result: { success: true } });
        log(LOG.INFO, "Client authenticated: " + connId);
      } else {
        _sendResponse(connId, { id: msg.id || null, type: 'error', error: { code: 4002, message: 'Invalid API key' } });
        log(LOG.WARN, "Auth failed for: " + connId);
      }
      return;
    }
  }
  if (!_checkRateLimit(connId)) {
    _sendResponse(connId, { id: msg.id || null, type: 'error', error: { code: 429, message: 'Rate limited' } });
    return;
  }
  var handler = globalThis.__bridge.commands.handlers[msg.type];
  if (!handler) {
    _sendResponse(connId, { id: msg.id || null, type: 'error', error: { code: -32601, message: 'Method not found: ' + msg.type } });
    return;
  }
  try {
    var _cmdStart = Date.now();
    var result = handler(msg.payload || {});
    var _cmdElapsed = Date.now() - _cmdStart;
    if (_cmdElapsed > 1000) log(LOG.WARN, "Slow command " + msg.type + " took " + _cmdElapsed + "ms");
    _sendResponse(connId, { id: msg.id, type: msg.type, result: result });
  } catch (e) {
    _sendResponse(connId, { id: msg.id, type: 'error', error: { code: -32603, message: 'Handler error: ' + (e.message || e) } });
  }
}

function startBridge() {
  if (!globalThis.__bridge || !globalThis.__bridge.ws || !globalThis.__bridge.ws.start || !globalThis.__bridge.commands || !globalThis.__bridge.commands.handlers) {
    log(LOG.ERROR, "Dependencies not loaded — ensure ws-server.js and commands.js are loaded before main.js");
    return;
  }
  try {
    loadConfig();
    globalThis.__bridge.ws.start(_config.host, _config.port);
    globalThis.__bridge.ws.onMessage = function(connId, raw) {
      _handleMessage(connId, raw);
    };
    globalThis.__bridge.ws.onDisconnect = function(connId) {
      _authMap.remove(connId);
      delete _lastCmdTime[connId];
      delete _connectTime[connId];
    };
    log(LOG.INFO, "Bridge started on " + _config.host + ":" + _config.port);
  } catch (e) {
    log(LOG.ERROR, "Failed to start bridge: " + (e.message || e));
  }
}

function stopBridge() {
  try {
    globalThis.__bridge.ws.stop();
    _authMap.clear();
    log(LOG.INFO, "Bridge stopped");
  } catch (e) {
    log(LOG.ERROR, "Stop error: " + (e.message || e));
  }
}

globalThis.__bridge = globalThis.__bridge || {};
globalThis.__bridge.start = startBridge;
globalThis.__bridge.stop = stopBridge;

try {
  startBridge();
} catch (e) {
  log(LOG.ERROR, "Auto-start error: " + (e.message || e));
}

try {
  Java.type('java.lang.Runtime').getRuntime().addShutdownHook(new Java.type('java.lang.Thread')(function() {
    stopBridge();
  }));
} catch (e) {
  log(LOG.ERROR, "Shutdown hook registration failed: " + (e.message || e));
}

var _prevOnUnload = globalThis.onunload;
globalThis.onunload = function() {
  try { stopBridge(); } catch(e) {}
  if (typeof _prevOnUnload === 'function') _prevOnUnload();
};
