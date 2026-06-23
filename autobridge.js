var ServerSocket = Java.type('java.net.ServerSocket');
var Socket = Java.type('java.net.Socket');
var InetSocketAddress = Java.type('java.net.InetSocketAddress');
var BufferedReader = Java.type('java.io.BufferedReader');
var InputStreamReader = Java.type('java.io.InputStreamReader');
var OutputStream = Java.type('java.io.OutputStream');
var Thread = Java.type('java.lang.Thread');
var MessageDigest = Java.type('java.security.MessageDigest');
var Base64 = Java.type('java.util.Base64');
var AtomicBoolean = Java.type('java.util.concurrent.atomic.AtomicBoolean');
var Collections = Java.type('java.util.Collections');
var ArrayList = Java.type('java.util.ArrayList');
var ConcurrentHashMap = Java.type('java.util.concurrent.ConcurrentHashMap');
var String = Java.type('java.lang.String');
var ByteArrayOutputStream = Java.type('java.io.ByteArrayOutputStream');
var Paths = Java.type('java.nio.file.Paths');
var Files = Java.type('java.nio.file.Files');
var StandardCharsets = Java.type('java.nio.charset.StandardCharsets');
var Client = Java.type('net.minecraft.client.MinecraftClient').getInstance();

function setInterval(fn, ms) {
  var timer = new Java.type('java.util.Timer')('autobridge-event-timer', true);
  var task = Java.type('java.util.TimerTask')({ run: fn });
  timer.schedule(task, ms, ms);
  return timer;
}
function clearInterval(timer) {
  if (timer) try { timer.cancel(); } catch(e) {}
}

var _lastPosBroadcast = 0;
var _lastHealth = {health: 20, food: 20, saturation: 5};
var _lastPos = null;
var _eventSubscriptions = new ConcurrentHashMap();
var _eventInterval = null;
var _startTime = null;
var _lastChat = [];

var WS_MAGIC = '258EAFA5-E914-47DA-95CA-5AB5DC11B75B';
var MAX_CONNECTIONS = 10;
var MAX_FRAME_SIZE = 16 * 1024 * 1024;
var OPCODE_TEXT = 1;
var OPCODE_CLOSE = 8;
var OPCODE_PING = 9;
var OPCODE_PONG = 10;

var serverSocket = null;
var running = new AtomicBoolean(false);
var connList = Collections.synchronizedList(new ArrayList());
var connMap = new ConcurrentHashMap();
var acceptThread = null;
var idCounter = 0;
var onMessageCallback = null;
var onDisconnectCallback = null;

globalThis.__bridge = globalThis.__bridge || {};
globalThis.__bridge.ws = {};

function computeAccept(key) {
  var sha1 = MessageDigest.getInstance('SHA-1');
  var raw = sha1.digest(String(key + WS_MAGIC).getBytes('UTF-8'));
  return Base64.getEncoder().encodeToString(raw);
}

function buildFrame(payload) {
  var bytes = String(payload).getBytes('UTF-8');
  var len = bytes.length;
  var baos = new ByteArrayOutputStream();
  baos.write(0x81);
  if (len < 126) {
    baos.write(len);
  } else if (len < 65536) {
    baos.write(126);
    baos.write((len >> 8) & 0xFF);
    baos.write(len & 0xFF);
  } else {
    baos.write(127);
    for (var i = 7; i >= 0; i--) {
      baos.write((len >> (i * 8)) & 0xFF);
    }
  }
  for (var i = 0; i < len; i++) {
    baos.write(bytes[i]);
  }
  return baos.toByteArray();
}

function buildControlFrame(opcode) {
  var baos = new ByteArrayOutputStream();
  baos.write(0x80 | opcode);
  baos.write(0x00);
  return baos.toByteArray();
}

function readFrameInfo(inputStream) {
  var b = inputStream.read();
  if (b < 0) return null;
  var masked = (b & 0x80) !== 0;
  var len = b & 0x7F;
  if (len === 126) {
    var hi = inputStream.read();
    var lo = inputStream.read();
    if (hi < 0 || lo < 0) return null;
    len = (hi << 8) | lo;
  } else if (len === 127) {
    len = 0;
    for (var i = 0; i < 8; i++) {
      var c = inputStream.read();
      if (c < 0) return null;
      len = (len << 8) | c;
    }
  }
  if (len > MAX_FRAME_SIZE) return null;
  return { length: len, masked: masked };
}

function handleConnection(socket, connId) {
  try {
    var inputStream = socket.getInputStream();
    var reader = new BufferedReader(new InputStreamReader(inputStream, 'UTF-8'));
    var outputStream = socket.getOutputStream();

    var upgradeKey = null;
    while (true) {
      var line = reader.readLine();
      if (line === null || line.length() === 0) break;
      if (line.toLowerCase().indexOf('sec-websocket-key:') === 0) {
        upgradeKey = line.split(':').slice(1).join(':').trim();
      }
    }

    if (upgradeKey === null) {
      socket.close();
      return;
    }

    var acceptValue = computeAccept(upgradeKey);
    var response = 'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + acceptValue + '\r\n' +
      '\r\n';
    outputStream.write(String(response).getBytes('UTF-8'));
    outputStream.flush();

    while (running.get() && !socket.isClosed()) {
      try {
        var b1 = inputStream.read();
        if (b1 < 0) break;

        var fin = (b1 & 0x80) !== 0;
        var rsv = b1 & 0x70;
        if (rsv !== 0) {
          try {
            var closeFrame = Java.array('byte', 2);
            closeFrame[0] = 0x88;
            closeFrame[1] = 0x02;
            outputStream.write(closeFrame);
            outputStream.flush();
          } catch (e) {}
          break;
        }

        var opcode = b1 & 0x0F;
        var frameInfo = readFrameInfo(inputStream);
        if (frameInfo === null) break;
        var masked = frameInfo.masked;
        var payloadLen = frameInfo.length;

        if (!masked) {
          try {
            var closeFrame = Java.array('byte', 2);
            closeFrame[0] = 0x88;
            closeFrame[1] = 0x02;
            outputStream.write(closeFrame);
            outputStream.flush();
          } catch (e) {}
          break;
        }

        var mask = Java.array('byte', 4);
        var m0 = inputStream.read();
        var m1 = inputStream.read();
        var m2 = inputStream.read();
        var m3 = inputStream.read();
        if (m0 < 0 || m1 < 0 || m2 < 0 || m3 < 0) break;
        mask[0] = (m0 & 0xFF);
        mask[1] = (m1 & 0xFF);
        mask[2] = (m2 & 0xFF);
        mask[3] = (m3 & 0xFF);

        var payload = Java.array('byte', payloadLen);
        if (payloadLen > 0) {
          for (var i = 0; i < payloadLen; i++) {
            var pb = inputStream.read();
            if (pb < 0) break;
            payload[i] = (pb & 0xFF);
          }
        }

        for (var i = 0; i < payloadLen; i++) {
          payload[i] = (payload[i] ^ mask[i % 4]);
        }

        if (opcode === OPCODE_TEXT) {
          var text = new String(payload, 'UTF-8');
          if (onMessageCallback !== null) {
            onMessageCallback(connId, text);
          }
        } else if (opcode === OPCODE_PING) {
          outputStream.write(buildControlFrame(OPCODE_PONG));
          outputStream.flush();
        } else if (opcode === OPCODE_CLOSE) {
          outputStream.write(buildControlFrame(OPCODE_CLOSE));
          outputStream.flush();
          break;
        }
      } catch (e) {
        try { removeConnection(connId); } catch (e2) {}
        break;
      }
    }
  } catch (e) {
    try {
      if (!socket.isClosed()) {
        socket.close();
      }
    } catch (e2) {}
  } finally {
    removeConnection(connId);
    try { socket.close(); } catch (e2) {}
  }
}

function addConnection(socket, connId) {
  var result = false;
  Java.synchronized(connList, function() {
    if (connList.size() >= MAX_CONNECTIONS) {
      try { socket.close(); } catch (e) {}
      result = false;
      return;
    }
    var conn = { id: connId, socket: socket };
    connList.add(conn);
    connMap.put(connId, conn);
    result = true;
  });
  return result;
}

function removeConnection(connId) {
  var conn = connMap.get(connId);
  if (conn !== null) {
    connMap.remove(connId);
    connList.remove(conn);
    try { conn.socket.close(); } catch (e) {}
    if (onDisconnectCallback !== null) {
      try { onDisconnectCallback(connId); } catch (e) {}
    }
  }
}

function sendFrameToSocket(socket, data) {
  try {
    if (socket.isClosed()) return false;
    var out = socket.getOutputStream();
    out.write(buildFrame(data));
    out.flush();
    return true;
  } catch (e) {
    return false;
  }
}

globalThis.__bridge.ws.start = function(host, port) {
  if (running.get()) return;
  try {
    serverSocket = new ServerSocket();
    serverSocket.setReuseAddress(true);
    serverSocket.bind(new InetSocketAddress(host || '0.0.0.0', port || 8765), 50);
    running.set(true);
    idCounter = 0;

    acceptThread = new Thread(function() {
      while (running.get()) {
        try {
          var socket = serverSocket.accept();
          var connId = 'conn_' + (++idCounter);
          if (addConnection(socket, connId)) {
            var t = new Thread(function() {
              handleConnection(socket, connId);
            });
            t.setDaemon(true);
            t.start();
          }
        } catch (e) {
          if (!running.get()) break;
        }
      }
    });
    acceptThread.setDaemon(true);
    acceptThread.start();
  } catch (e) {
    running.set(false);
  }
};

globalThis.__bridge.ws.stop = function() {
  running.set(false);
  var snapshot = connMap.values().toArray();
  for (var i = 0; i < snapshot.length; i++) {
    var conn = snapshot[i];
    try {
      if (!conn.socket.isClosed()) {
        var out = conn.socket.getOutputStream();
        out.write(buildControlFrame(OPCODE_CLOSE));
        out.flush();
      }
    } catch (e) {}
    try { conn.socket.close(); } catch (e2) {}
  }
  connList.clear();
  connMap.clear();
  if (serverSocket !== null) {
    try { serverSocket.close(); } catch (e) {}
    serverSocket = null;
  }
};

globalThis.__bridge.ws.broadcast = function(type, data) {
  if (!running.get()) return;
  var msg = JSON.stringify({ type: type, data: data });
  var snapshot = connMap.values().toArray();
  for (var i = 0; i < snapshot.length; i++) {
    sendFrameToSocket(snapshot[i].socket, msg);
  }
};

globalThis.__bridge.ws.send = function(connId, msg) {
  if (!running.get()) return;
  var conn = connMap.get(connId);
  if (conn !== null) {
    var str = typeof msg === 'string' ? msg : JSON.stringify(msg);
    sendFrameToSocket(conn.socket, str);
  }
};

globalThis.__bridge.ws.isRunning = function() {
  return running.get();
};

Object.defineProperty(globalThis.__bridge.ws, 'onMessage', {
  get: function() { return onMessageCallback; },
  set: function(fn) { onMessageCallback = fn; },
  configurable: true
});

Object.defineProperty(globalThis.__bridge.ws, 'onDisconnect', {
  get: function() { return onDisconnectCallback; },
  set: function(fn) { onDisconnectCallback = fn; },
  configurable: true
});

globalThis.__bridge.commands = {
  handlers: {},
  register: function(handlers) {
    for (var type in handlers) {
      if (handlers.hasOwnProperty(type)) {
        this.handlers[type] = handlers[type];
      }
    }
  },
  handle: function(type, payload) {
    var handler = this.handlers[type];
    if (!handler) {
      return { success: false, error: "Unknown command: " + type };
    }
    try {
      return handler(payload || {});
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
};

function _check() {
  if (!Client.player) throw new Error("Player not available");
  if (!Client.world) throw new Error("World not available");
}

globalThis.__bridge.commands.register({
  move: function(payload) {
    try {
      _check();
      if (typeof payload.x !== 'number' || typeof payload.y !== 'number' || typeof payload.z !== 'number') {
        return { success: false, error: "Invalid move payload: x, y, z must be numbers" };
      }
      var Packet = Java.type('net.minecraft.network.packet.c2s.play.PlayerMoveC2SPacket$PositionAndOnGround');
      Client.player.networkHandler.sendPacket(new Packet(payload.x, payload.y, payload.z, true));
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  look: function(payload) {
    try {
      _check();
      if (typeof payload.yaw !== 'number' || typeof payload.pitch !== 'number') {
        return { success: false, error: "Invalid look payload: yaw and pitch must be numbers" };
      }
      var Packet = Java.type('net.minecraft.network.packet.c2s.play.PlayerMoveC2SPacket$LookAndOnGround');
      Client.player.networkHandler.sendPacket(new Packet(payload.yaw, payload.pitch, true));
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  jump: function(payload) {
    try {
      _check();
      Client.player.jump();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  sprint: function(payload) {
    try {
      _check();
      Client.player.setSprinting(!!payload.state);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  sneak: function(payload) {
    try {
      _check();
      Client.player.setSneaking(!!payload.state);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  attack: function(payload) {
    try {
      _check();
      Client.player.swingHand(Java.type('net.minecraft.util.Hand').MAIN_HAND);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  use: function(payload) {
    try {
      _check();
      Client.interactionManager.interactItem(Client.player, Client.world, Java.type('net.minecraft.util.Hand').MAIN_HAND);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  sendChat: function(payload) {
    try {
      _check();
      if (!payload.message || typeof payload.message !== 'string') {
        return { success: false, error: "Invalid message" };
      }
      Client.player.sendChatMessage(payload.message);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  getBlock: function(payload) {
    try {
      _check();
      var BlockPos = Java.type('net.minecraft.util.math.BlockPos');
      var pos = new BlockPos(Math.floor(payload.x), Math.floor(payload.y), Math.floor(payload.z));
      var state = Client.world.getBlockState(pos);
      var block = state.getBlock();
      return {
        success: true,
        blockId: block.getTranslationKey(),
        blockName: block.getName().getString()
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  raycast: function(payload) {
    try {
      _check();
      var maxDist = payload.maxDistance || 5.0;
      var hit = Client.player.raycast(maxDist, 0.0, false);
      if (hit.getType().name() === 'MISS') {
        return { success: true, hit: false };
      }
      var pos = hit.getPos();
      var BlockPos = Java.type('net.minecraft.util.math.BlockPos');
      var blockPos = new BlockPos(pos.x, pos.y, pos.z);
      var state = Client.world.getBlockState(blockPos);
      return {
        success: true,
        hit: true,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        blockId: state.getBlock().getTranslationKey()
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  getPosition: function(payload) {
    try {
      _check();
      var pos = Client.player.getPos();
      return {
        success: true,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        yaw: Client.player.getYaw(),
        pitch: Client.player.getPitch(),
        onGround: Client.player.isOnGround(),
        dimension: Client.world.getRegistryKey().getValue().toString()
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  getInventory: function(payload) {
    try {
      _check();
      var inv = Client.player.getInventory();
      var slots = [];
      var main = inv.main;
      for (var i = 0; i < main.size(); i++) {
        var stack = main.get(i);
        if (!stack.isEmpty()) {
          slots.push({
            slot: i,
            itemId: stack.getItem().getTranslationKey(),
            count: stack.getCount(),
            name: stack.getName().getString(),
            slotType: 'main'
          });
        }
      }
      var armor = inv.armor;
      for (var i = 0; i < armor.size(); i++) {
        var stack = armor.get(i);
        if (!stack.isEmpty()) {
          slots.push({
            slot: 36 + i,
            itemId: stack.getItem().getTranslationKey(),
            count: stack.getCount(),
            name: stack.getName().getString(),
            slotType: 'armor'
          });
        }
      }
      var offHand = inv.offHand;
      var stack = offHand.get(0);
      if (!stack.isEmpty()) {
        slots.push({
          slot: 40,
          itemId: stack.getItem().getTranslationKey(),
          count: stack.getCount(),
          name: stack.getName().getString(),
          slotType: 'offhand'
        });
      }
      return { success: true, slots: slots };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  getItem: function(payload) {
    try {
      _check();
      if (typeof payload.slot !== 'number' || payload.slot < 0 || payload.slot > 40) {
        return { success: false, error: "Invalid slot: must be a number between 0 and 40" };
      }
      var stack = Client.player.getInventory().getStack(payload.slot);
      if (stack.isEmpty()) {
        return { success: true, slot: payload.slot, itemId: null, count: 0, name: '' };
      }
      return {
        success: true,
        slot: payload.slot,
        itemId: stack.getItem().getTranslationKey(),
        count: stack.getCount(),
        name: stack.getName().getString()
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  moveItem: function(payload) {
    try {
      _check();
      if (typeof payload.from !== 'number' || typeof payload.to !== 'number' || payload.from < 0 || payload.from > 40 || payload.to < 0 || payload.to > 40) {
        return { success: false, error: "Invalid moveItem payload: from and to must be numbers between 0 and 40" };
      }
      var inv = Client.player.getInventory();
      var temp = inv.getStack(payload.from);
      inv.setStack(payload.from, inv.getStack(payload.to));
      inv.setStack(payload.to, temp);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  getTime: function(payload) {
    try {
      _check();
      return { success: true, time: Client.world.getTimeOfDay() };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  subscribe: function(payload) {
    try {
      var events = payload.events || [];
      if (!Array.isArray(events)) return {success: false, error: "events must be an array"};
      var connId = globalThis.__bridge._currentConnId;
      if (connId) {
        _eventSubscriptions.put(connId, events);
      }
      return {success: true, subscribed: events};
    } catch (e) {
      return {success: false, error: e.message};
    }
  },

  reload: function(payload) {
    try {
      loadConfig();
      return {success: true, message: "Config reloaded"};
    } catch (e) {
      return {success: false, error: e.message};
    }
  },

  status: function(payload) {
    try {
      return {
        success: true,
        running: globalThis.__bridge.ws.isRunning(),
        connections: connMap.size(),
        uptime: Date.now() - (_startTime || Date.now()),
        config: {
          host: _config.host,
          port: _config.port,
          hasApiKey: !!_config.apiKey,
          rateLimit: _config.rateLimit,
          logLevel: _config.logLevel
        }
      };
    } catch (e) {
      return {success: false, error: e.message};
    }
  }
});

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
    var configPath = Paths.get('config/autobridge/config.json');
    if (Files.exists(configPath)) {
      var bytes = Files.readAllBytes(configPath);
      var content = String(bytes, StandardCharsets.UTF_8);
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
      Files.write(configPath, defaultContent.getBytes(StandardCharsets.UTF_8));
      log(LOG.INFO, "Created default config at config/autobridge/config.json");
    }
  } catch (e) {
    log(LOG.ERROR, "Config load error: " + (e.message || e));
  }
}

var _authMap = new ConcurrentHashMap();
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
    globalThis.__bridge._currentConnId = connId;
    var result = handler(msg.payload || {});
    globalThis.__bridge._currentConnId = null;
    var _cmdElapsed = Date.now() - _cmdStart;
    if (_cmdElapsed > 1000) log(LOG.WARN, "Slow command " + msg.type + " took " + _cmdElapsed + "ms");
    _sendResponse(connId, { id: msg.id, type: msg.type, result: result });
  } catch (e) {
    _sendResponse(connId, { id: msg.id, type: 'error', error: { code: -32603, message: 'Handler error: ' + (e.message || e) } });
  }
}

function _eventTick() {
  try {
    if (!Client.player || !Client.world) return;
    _checkPosition();
    _checkDeath();
    _checkHealth();
  } catch (e) {
  }
}

function _checkPosition() {
  try {
    var now = Date.now();
    if (now - _lastPosBroadcast < 200) return;
    var pos = Client.player.getPos();
    var x = pos.x;
    var y = pos.y;
    var z = pos.z;
    var yaw = Client.player.getYaw();
    var pitch = Client.player.getPitch();
    var onGround = Client.player.isOnGround();
    var dimension = Client.world.getRegistryKey().getValue().toString();
    if (_lastPos === null || x !== _lastPos.x || y !== _lastPos.y || z !== _lastPos.z || yaw !== _lastPos.yaw || pitch !== _lastPos.pitch || onGround !== _lastPos.onGround || dimension !== _lastPos.dimension) {
      _lastPos = {x: x, y: y, z: z, yaw: yaw, pitch: pitch, onGround: onGround, dimension: dimension};
      _lastPosBroadcast = now;
      globalThis.__bridge.ws.broadcast('event', {event: 'position', data: {x: x, y: y, z: z, yaw: yaw, pitch: pitch, onGround: onGround, dimension: dimension}});
    }
  } catch (e) {
  }
}

function _checkHealth() {
  try {
    var health = Client.player.getHealth();
    var maxHealth = Client.player.getMaxHealth();
    var food = Client.player.getHungerManager().getFoodLevel();
    var saturation = Client.player.getHungerManager().getSaturationLevel();
    if (health !== _lastHealth.health || food !== _lastHealth.food || saturation !== _lastHealth.saturation) {
      _lastHealth = {health: health, food: food, saturation: saturation};
      globalThis.__bridge.ws.broadcast('event', {event: 'health', data: {health: health, maxHealth: maxHealth, food: food, saturation: saturation}});
    }
  } catch (e) {
  }
}

function _checkDeath() {
  try {
    var health = Client.player.getHealth();
    if (_lastHealth.health > 0 && health <= 0) {
      globalThis.__bridge.ws.broadcast('event', {event: 'death', data: {message: 'Player died', source: 'unknown'}});
    }
  } catch (e) {
  }
}

globalThis.onChat = function(chat, event) {
  try {
    var msg = typeof chat === 'string' ? chat : (chat.getMessage ? chat.getMessage().getString() : String(chat));
    _lastChat.push(msg);
    if (_lastChat.length > 50) _lastChat.shift();
    globalThis.__bridge.ws.broadcast('event', {event: 'chat', data: {message: msg, sender: 'unknown', timestamp: Date.now()}});
  } catch (e) {
  }
};

function startBridge() {
  if (!globalThis.__bridge || !globalThis.__bridge.ws || !globalThis.__bridge.ws.start || !globalThis.__bridge.commands || !globalThis.__bridge.commands.handlers) {
    log(LOG.ERROR, "Dependencies not loaded — ensure ws-server.js and commands.js are loaded before main.js");
    return;
  }
  try {
    loadConfig();
    _startTime = Date.now();
    globalThis.__bridge.ws.start(_config.host, _config.port);
    globalThis.__bridge.ws.onMessage = function(connId, raw) {
      _handleMessage(connId, raw);
    };
    globalThis.__bridge.ws.onDisconnect = function(connId) {
      _authMap.remove(connId);
      delete _lastCmdTime[connId];
      delete _connectTime[connId];
    };
    if (_eventInterval === null) {
      _eventInterval = setInterval(_eventTick, 50);
    }
    log(LOG.INFO, "Bridge started on " + _config.host + ":" + _config.port);
  } catch (e) {
    log(LOG.ERROR, "Failed to start bridge: " + (e.message || e));
  }
}

function stopBridge() {
  try {
    if (_eventInterval !== null) {
      clearInterval(_eventInterval);
      _eventInterval = null;
    }
    globalThis.__bridge.ws.stop();
    _authMap.clear();
    log(LOG.INFO, "Bridge stopped");
  } catch (e) {
    log(LOG.ERROR, "Stop error: " + (e.message || e));
  }
}

globalThis.__bridge.start = startBridge;
globalThis.__bridge.stop = stopBridge;
globalThis.__bridge._config = _config;
globalThis.__bridge._authMap = _authMap;

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
