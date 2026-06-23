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
var BlockPos = Java.type('net.minecraft.util.math.BlockPos');
var Hand = Java.type('net.minecraft.util.Hand');
var LookPacket = Java.type('net.minecraft.network.packet.c2s.play.PlayerMoveC2SPacket$LookAndOnGround');
var SlotActionType = Java.type('net.minecraft.screen.slot.SlotActionType');

var _cmdQueue = [];
var _cmdQueueRunning = false;

function _queueCommand(connId, id, type, handler, payload) {
  _cmdQueue.push({connId: connId, id: id, type: type, handler: handler, payload: payload});
  _drainQueue();
}

function _drainQueue() {
  if (_cmdQueueRunning || _cmdQueue.length === 0) return;
  _cmdQueueRunning = true;
  Java.type('net.minecraft.client.MinecraftClient').getInstance().execute(function() {
    try {
      while (_cmdQueue.length > 0) {
        var cmd = _cmdQueue.shift();
        try {
          var _cmdStart = Date.now();
          globalThis.__bridge._currentConnId = cmd.connId;
          var result = cmd.handler(cmd.payload);
          globalThis.__bridge._currentConnId = null;
          var _cmdElapsed = Date.now() - _cmdStart;
          if (_cmdElapsed > 1000) log(LOG.WARN, "Slow command " + cmd.type + " took " + _cmdElapsed + "ms");
          _sendResponse(cmd.connId, { id: cmd.id, type: cmd.type, result: result });
        } catch (e) {
          _sendResponse(cmd.connId, { id: cmd.id, type: 'error', error: { code: -32603, message: 'Handler error: ' + (e.message || e) } });
        }
      }
    } finally {
      _cmdQueueRunning = false;
    }
  });
}

function setInterval(fn, ms) {
  var Timer = Java.type('java.util.Timer');
  var TimerTask = Java.type('java.util.TimerTask');
  var timer = new Timer('autobridge-event-timer', true);
  var task = Java.extend(TimerTask, { run: function() { try { fn(); } catch(e) {} } });
  timer.schedule(new task(), ms, ms);
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
var _walkTarget = null;

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
  register: function(handlers, prefix) {
    for (var type in handlers) {
      if (handlers.hasOwnProperty(type)) {
        var key = prefix ? prefix + '.' + type : type;
        if (typeof handlers[type] === 'function') {
          this.handlers[key] = handlers[type];
        } else {
          this.register(handlers[type], key);
        }
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
      var PosPacket = Java.type('net.minecraft.network.packet.c2s.play.PlayerMoveC2SPacket$PositionAndOnGround');
      Client.player.networkHandler.sendPacket(new PosPacket(payload.x, payload.y, payload.z, true));
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
      Client.player.networkHandler.sendPacket(new LookPacket(payload.yaw, payload.pitch, true));
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

  scanContainer: function(payload) {
    try {
      _check();
      var x = Math.floor(payload.x);
      var y = Math.floor(payload.y);
      var z = Math.floor(payload.z);
      var blockPos = new BlockPos(x, y, z);
      var entity = Client.world.getBlockEntity(blockPos);
      if (!entity) return { success: false, error: "No block entity at position" };
      var Inventory = Java.type('net.minecraft.inventory.Inventory');
      if (!(entity instanceof Inventory)) return { success: false, error: "Block entity is not an inventory" };
      var slots = [];
      for (var i = 0; i < entity.size(); i++) {
        var stack = entity.getStack(i);
        if (!stack.isEmpty()) {
          slots.push({ slot: i, itemId: stack.getItem().getTranslationKey(), count: stack.getCount(), name: stack.getName().getString() });
        }
      }
      return { success: true, containerType: entity.getBlockState().getBlock().getTranslationKey(), slots: slots };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  screen: {
    getSlots: function(payload) {
      try {
        _check();
        var screenHandler = Client.player.currentScreenHandler;
        if (!screenHandler) return { success: false, error: "No screen open" };
        var title = screenHandler.getTitle().getString();
        var slots = [];
        var slotList = screenHandler.slots;
        for (var i = 0; i < slotList.size(); i++) {
          var slot = slotList.get(i);
          var stack = slot.getStack();
          if (!stack.isEmpty()) {
            slots.push({ slot: i, itemId: stack.getItem().getTranslationKey(), count: stack.getCount(), name: stack.getName().getString() });
          }
        }
        return { success: true, title: title, slots: slots };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },

    click: function(payload) {
      try {
        _check();
        if (typeof payload.slot !== 'number') return { success: false, error: "Invalid slot number" };
        var screenHandler = Client.player.currentScreenHandler;
        if (!screenHandler) return { success: false, error: "No screen open" };
        var button = typeof payload.button === 'number' ? payload.button : 0;
        var actionType = SlotActionType.valueOf(payload.actionType || 'PICKUP');
        Client.interactionManager.clickSlot(screenHandler.syncId, payload.slot, button, actionType, Client.player);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },

    close: function(payload) {
      try {
        _check();
        Client.player.closeScreen();
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
  },

  block: {
    activate: function(payload) {
      try {
        _check();
        var blockPos = new BlockPos(Math.floor(payload.x), Math.floor(payload.y), Math.floor(payload.z));
        var HitResult = Java.type('net.minecraft.util.hit.BlockHitResult');
        var Vec3d = Java.type('net.minecraft.util.math.Vec3d');
        var hitResult = new HitResult(new Vec3d(payload.x + 0.5, payload.y + 1.0, payload.z + 0.5));
        Client.interactionManager.interactBlock(Client.player, Client.world, Hand.MAIN_HAND, hitResult);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
  },

  player: {
    lookAt: function(payload) {
      try {
        _check();
        var pos = Client.player.getPos();
        var eyeHeight = Client.player.getEyeHeight(Client.player.getPose());
        var dx = payload.x - pos.x;
        var dy = (payload.y + 1) - (pos.y + eyeHeight);
        var dz = payload.z - pos.z;
        var yaw = Math.atan2(dz, dx) * 180 / Math.PI - 90;
        if (yaw < -180) yaw += 360;
        if (yaw > 180) yaw -= 360;
        var pitch = -Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) * 180 / Math.PI;
        pitch = Math.max(-90, Math.min(90, pitch));
        Client.player.networkHandler.sendPacket(new LookPacket(yaw, pitch, Client.player.isOnGround()));
        return { success: true, yaw: yaw, pitch: pitch };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },

    walkTo: function(payload) {
      try {
        _check();
        _walkTarget = { x: Math.floor(payload.x) + 0.5, y: payload.y, z: Math.floor(payload.z) + 0.5 };
        return { success: true, message: "Walking to target" };
      } catch (e) {
        return { success: false, error: e.message };
      }
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

// =============================================================================
// COMMAND GENERATION SYSTEM — Template factories + Registry
// =============================================================================

function _expandRange(s) {
  var m = s.match(/^\{(\d+)-(\d+)\}$/);
  if (m) { var a=[]; for(var i=+m[1];i<=+m[2];i++) a.push(i); return a; }
  return [s];
}

function _expandSet(s) {
  if (s.indexOf('{')<0) return [s];
  return s.replace(/\{([^}]+)\}/g,function(_,m){return m;}).split(',').map(function(x){return x.trim();});
}

function _expandAll(parts) {
  if (!parts||!parts.length) return [''];
  var head=parts[0], tail=parts.slice(1);
  var hd=_expandRange(head);
  var tl=_expandAll(tail);
  var r=[];
  for(var i=0;i<hd.length;i++) for(var j=0;j<tl.length;j++) r.push(hd[i]+(tl[j]?'.'+tl[j]:''));
  return r;
}

var COMMAND_ENTRIES = [];

function def(ns, tmpl, params) {
  var parts = ns.split('.');
  var expanded = _expandAll(parts);
  for (var i = 0; i < expanded.length; i++) {
    COMMAND_ENTRIES.push({ns: expanded[i], template: tmpl, params: params || {}});
  }
}

// Reference: use _bridgeCmdCtx to pass context to handlers
var _bridgeCmdCtx = {};

// ==== TEMPLATE FACTORIES ====

var TM = {};

// Template: find blocks matching filter in radius
TM.findBlocks = function(params) {
  var filter = params.filter || '';
  return function(payload) {
    try { _check(); } catch(e) { return {success:false, error:e.message}; }
    var r = payload.radius || 16;
    var max = payload.max || 50;
    var p = Client.player.getPos();
    var results = [];
    for (var dx=-r; dx<=r; dx++) {
      for (var dy=-5; dy<=5; dy++) {
        for (var dz=-r; dz<=r; dz++) {
          if (results.length >= max) break;
          var pos = new BlockPos(Math.floor(p.x+dx), Math.floor(p.y+dy), Math.floor(p.z+dz));
          try {
            var bs = Client.world.getBlockState(pos);
            var bid = bs.getBlock().getTranslationKey();
            if (filter && bid.indexOf(filter) < 0) continue;
            var ent = Client.world.getBlockEntity(pos);
            results.push({
              x: pos.x, y: pos.y, z: pos.z,
              blockId: bid,
              hasBlockEntity: !!ent
            });
          } catch(e) {}
        }
        if (results.length >= max) break;
      }
      if (results.length >= max) break;
    }
    return {success: true, count: results.length, blocks: results};
  };
};

// Template: find container at position
TM.scanContainer = function(params) {
  return function(payload) {
    try { _check(); } catch(e) { return {success:false, error:e.message}; }
    var x = Math.floor(payload.x), y = Math.floor(payload.y), z = Math.floor(payload.z);
    var pos = new BlockPos(x, y, z);
    var entity = Client.world.getBlockEntity(pos);
    if (!entity) return {success: false, error: 'No block entity'};
    var inv = Java.type('net.minecraft.inventory.Inventory');
    if (!(entity instanceof inv)) return {success: false, error: 'Not an inventory'};
    var slots = [];
    for (var i = 0; i < entity.size(); i++) {
      var s = entity.getStack(i);
      if (!s.isEmpty()) slots.push({slot: i, itemId: s.getItem().getTranslationKey(), count: s.getCount(), name: s.getName().getString()});
    }
    return {success: true, size: entity.size(), containerType: entity.getBlockState().getBlock().getTranslationKey(), slots: slots};
  };
};

// Template: get container slot
TM.containerGet = function(params) {
  var slot = params.slot;
  return function(payload) {
    try { _check(); } catch(e) { return {success:false, error:e.message}; }
    if (!Client.player.currentScreenHandler) return {success:false, error:'No screen open'};
    var slots = Client.player.currentScreenHandler.slots;
    if (slot < 0 || slot >= slots.size()) return {success:false, error:'Invalid slot '+slot};
    var s = slots.get(slot).getStack();
    if (s.isEmpty()) return {success:true, slot: slot, itemId: null, count: 0};
    return {success:true, slot: slot, itemId: s.getItem().getTranslationKey(), count: s.getCount(), name: s.getName().getString()};
  };
};

// Template: click slot with specific action + params
TM.screenClick = function(params) {
  var slot = params.slot, act = params.actionType || 'PICKUP', btn = params.button || 0;
  return function(payload) {
    try { _check(); } catch(e) { return {success:false, error:e.message}; }
    if (!Client.player.currentScreenHandler) return {success:false, error:'No screen open'};
    var aType = Java.type('net.minecraft.screen.slot.SlotActionType').valueOf(act);
    Client.interactionManager.clickSlot(Client.player.currentScreenHandler.syncId, slot, btn, aType, Client.player);
    return {success:true, clickedSlot: slot, actionType: act, button: btn};
  };
};

// Template: get inventory slot
TM.invGet = function(params) {
  var slot = params.slot;
  return function(payload) {
    try { _check(); } catch(e) { return {success:false, error:e.message}; }
    var inv = Client.player.getInventory();
    var s = inv.getStack(slot);
    if (s.isEmpty()) return {success:true, slot: slot, itemId: null, count: 0};
    return {success:true, slot: slot, itemId: s.getItem().getTranslationKey(), count: s.getCount(), name: s.getName().getString()};
  };
};

// Template: set inventory slot
TM.invSet = function(params) {
  var slot = params.slot;
  return function(payload) {
    try { _check(); } catch(e) { return {success:false, error:e.message}; }
    if (!payload.itemId) return {success:false, error:'Missing itemId'};
    var ItemStack = Java.type('net.minecraft.item.ItemStack');
    var Items = Java.type('net.minecraft.registry.Registries').ITEM;
    var item = Items.get(Java.type('net.minecraft.util.Identifier').tryParse(payload.itemId));
    if (!item) return {success:false, error:'Unknown item: '+payload.itemId};
    var inv = Client.player.getInventory();
    inv.setStack(slot, new ItemStack(item, payload.count || 1));
    return {success:true, slot: slot, itemId: payload.itemId, count: payload.count || 1};
  };
};

// Template: move item between slots
TM.moveItem = function(params) {
  return function(payload) {
    try { _check(); } catch(e) { return {success:false, error:e.message}; }
    var from = payload.from, to = payload.to;
    if (typeof from !== 'number' || typeof to !== 'number') return {success:false, error:'from and to must be numbers'};
    var inv = Client.player.getInventory();
    var temp = inv.getStack(from);
    inv.setStack(from, inv.getStack(to));
    inv.setStack(to, temp);
    return {success:true, from: from, to: to};
  };
};

// Template: find entities in radius
TM.findEntities = function(params) {
  var filter = params.filter || '';
  return function(payload) {
    try { _check(); } catch(e) { return {success:false, error:e.message}; }
    var r = payload.radius || 16;
    var max = payload.max || 20;
    var p = Client.player.getPos();
    var list = Client.world.getEntities();
    var results = [];
    for (var i = 0; i < list.size() && results.length < max; i++) {
      var e = list.get(i);
      var eid = e.getType().getTranslationKey();
      if (filter && eid.indexOf(filter) < 0) continue;
      var ep = e.getPos();
      var dx = ep.x - p.x, dz = ep.z - p.z;
      if (Math.sqrt(dx*dx+dz*dz) > r) continue;
      results.push({entityId: eid, x: ep.x, y: ep.y, z: ep.z, uuid: e.getUuid().toString(), name: e.getName().getString()});
    }
    return {success: true, count: results.length, entities: results};
  };
};

// Template: interact with entity
TM.entityInteract = function(params) {
  var action = params.action || 'interact';
  return function(payload) {
    try { _check(); } catch(e) { return {success:false, error:e.message}; }
    if (action === 'attack') { Client.player.swingHand(Hand.MAIN_HAND); return {success:true, action:'attack'}; }
    Client.interactionManager.interactEntity(Client.player, Client.world, Hand.MAIN_HAND, Client.player);
    return {success:true, action: action};
  };
};

// Template: world query (biome, light, difficulty, weather)
TM.worldQuery = function(params) {
  var qtype = params.type;
  return function(payload) {
    try { _check(); } catch(e) { return {success:false, error:e.message}; }
    if (qtype === 'biome') {
      var pos = Client.player.getBlockPos();
      var biome = Client.world.getBiome(pos).getKey().get().getValue().toString();
      return {success:true, biome: biome};
    }
    if (qtype === 'light') {
      var x = payload.x!=null?payload.x:Math.floor(Client.player.getPos().x);
      var y = payload.y!=null?payload.y:Math.floor(Client.player.getPos().y);
      var z = payload.z!=null?payload.z:Math.floor(Client.player.getPos().z);
      var lv = Client.world.getLightLevel(new BlockPos(x,y,z));
      return {success:true, lightLevel: lv, pos: {x:x,y:y,z:z}};
    }
    if (qtype === 'difficulty') return {success:true, difficulty: Client.world.getDifficulty().getName()};
    if (qtype === 'weather') {
      var w = Client.world.getDimensionEffects();
      return {success:true, raining: Client.world.isRaining(), thundering: Client.world.isThundering(), clear: !Client.world.isRaining()};
    }
    if (qtype === 'time') return {success:true, timeOfDay: Client.world.getTimeOfDay(), gameTime: Client.world.getTime(), day: Math.floor(Client.world.getTimeOfDay() % 24000)};
    if (qtype === 'dimension') return {success:true, dimension: Client.world.getRegistryKey().getValue().toString()};
    if (qtype === 'spawn') {
      var sp = Client.world.getSpawnPos();
      return {success:true, spawn: {x: sp.getX(), y: sp.getY(), z: sp.getZ()}};
    }
    if (qtype === 'height') {
      var wx = payload.x!=null?payload.x:Math.floor(Client.player.getPos().x);
      var wz = payload.z!=null?payload.z:Math.floor(Client.player.getPos().z);
      var top = Client.world.getTopY();
      return {success:true, x: wx, z: wz, topY: top, bottomY: Client.world.getBottomY()};
    }
    if (qtype === 'seed') return {success:true, seed: Client.world.getSeed()};
    if (qtype === 'moonPhase') return {success:true, moonPhase: Client.world.getMoonPhase().getName()};
    if (qtype === 'slimeChunk') {
      var ChunkPos = Java.type('net.minecraft.util.math.ChunkPos');
      var cp = new ChunkPos(Math.floor(Client.player.getPos().x/16), Math.floor(Client.player.getPos().z/16));
      return {success:true, isSlimeChunk: Client.world.isSlimeChunk(cp)};
    }
    if (qtype === 'structure') {
      var RegistryKeys = Java.type('net.minecraft.registry.RegistryKeys');
      var reg = Client.world.getRegistryManager().get(RegistryKeys.STRUCTURE);
      var structures = [];
      reg.forEach(function(s){ structures.push(s.getName().getString()); });
      return {success:true, structures: structures};
    }
    if (qtype === 'entityCount') return {success:true, count: Client.world.getEntities().size()};
    if (qtype === 'fullBright') return {success:true, fullBright: Client.options.getGamma().getValue() > 0.5};
    if (qtype === 'hardcore') return {success:true, hardcore: Client.world.getLevelProperties().isHardcore()};
    if (qtype === 'findContainer') {
      var radius = payload.radius || 10;
      var ctype = payload.type || 'any'; // chest, barrel, furnace, brewing_stand, etc.
      var pos = Client.player.getPos();
      var bp = Client.player.getBlockPos();
      var results = [];
      for (var dx = -radius; dx <= radius; dx++) {
        for (var dy = -radius; dy <= radius; dy++) {
          for (var dz = -radius; dz <= radius; dz++) {
            var blockPos = new BlockPos(bp.x + dx, bp.y + dy, bp.z + dz);
            var state = Client.world.getBlockState(blockPos);
            var block = state.getBlock();
            var blockId = block.getTranslationKey() || '';
            if (ctype === 'any' || blockId.indexOf(ctype) !== -1) {
              if (blockId.indexOf('chest') !== -1 || blockId.indexOf('barrel') !== -1 || blockId.indexOf('furnace') !== -1 || blockId.indexOf('brewing') !== -1 || blockId.indexOf('hopper') !== -1 || blockId.indexOf('dispenser') !== -1 || blockId.indexOf('dropper') !== -1 || blockId.indexOf('shulker') !== -1 || blockId.indexOf('smoker') !== -1 || blockId.indexOf('blast') !== -1) {
                results.push({x: blockPos.getX(), y: blockPos.getY(), z: blockPos.getZ(), type: blockId});
              }
            }
          }
        }
        if (results.length >= 20) break;
      }
      return {success:true, containers: results, count: results.length, radius: radius};
    }
    return {success:false, error:'Unknown world query: '+qtype};
  };
};

// Template: player state query
TM.playerQuery = function(params) {
  var qtype = params.type;
  return function(payload) {
    try { _check(); } catch(e) { return {success:false, error:e.message}; }
    if (qtype === 'effects') {
      var eff = Client.player.getStatusEffects();
      var list = [];
      for (var i = 0; i < eff.size(); i++) {
        var e = eff.get(i);
        list.push({effect: e.getEffectType().getTranslationKey(), duration: e.getDuration(), amplifier: e.getAmplifier()});
      }
      return {success:true, effects: list};
    }
    if (qtype === 'xp') {
      return {success:true, level: Client.player.experienceLevel, progress: Client.player.experienceProgress, totalXp: Client.player.totalExperience};
    }
    if (qtype === 'health') {
      return {success:true, health: Client.player.getHealth(), maxHealth: Client.player.getMaxHealth(), food: Client.player.getHungerManager().getFoodLevel(), saturation: Client.player.getHungerManager().getSaturationLevel()};
    }
    if (qtype === 'selectedSlot') return {success:true, selectedSlot: Client.player.getInventory().selectedSlot};
    if (qtype === 'gamemode') {
      var gm = Client.interactionManager.getCurrentGameMode();
      return {success:true, gamemode: gm ? gm.getName() : 'unknown'};
    }
    if (qtype === 'abilities') {
      var ab = Client.player.getAbilities();
      return {success:true, creativeFlight: ab.creativeMode, flying: ab.flying, flySpeed: ab.getFlySpeed(), walkSpeed: ab.getWalkSpeed(), allowModifyWorld: ab.allowModifyWorld};
    }
    if (qtype === 'score') return {success:true, score: Client.player.getScore()};
    if (qtype === 'sleepTimer') return {success:true, sleepTimer: Client.player.getSleepTimer()};
    if (qtype === 'hunger') {
      var h = Client.player.getHungerManager();
      return {success:true, food: h.getFoodLevel(), saturation: h.getSaturationLevel(), exhaustion: h.getExhaustion()};
    }
    if (qtype === 'oxygen') return {success:true, air: Client.player.getAir(), maxAir: Client.player.getMaxAir()};
    if (qtype === 'armor') return {success:true, armor: Client.player.getArmor()};
    if (qtype === 'velocity') {
      var v = Client.player.getVelocity();
      return {success:true, x: v.x, y: v.y, z: v.z, horizontal: Math.sqrt(v.x*v.x+v.z*v.z)};
    }
    if (qtype === 'frozenTicks') return {success:true, frozenTicks: Client.player.getFrozenTicks()};
    if (qtype === 'fireTicks') return {success:true, fireTicks: Client.player.getFireTicks()};
    if (qtype === 'fallDistance') return {success:true, fallDistance: Client.player.fallDistance};
    if (qtype === 'absorption') return {success:true, absorption: Client.player.getAbsorptionAmount()};
    if (qtype === 'mainHand') {
      var s = Client.player.getMainHandStack();
      return {success:true, itemId: s.getItem().getTranslationKey(), count: s.getCount(), name: s.getName().getString()};
    }
    if (qtype === 'offHand') {
      var s = Client.player.getOffHandStack();
      return {success:true, itemId: s.getItem().getTranslationKey(), count: s.getCount(), name: s.getName().getString()};
    }
    if (qtype === 'yaw') return {success:true, yaw: Client.player.getYaw()};
    if (qtype === 'pitch') return {success:true, pitch: Client.player.getPitch()};
    if (qtype === 'pos') {
      var pPos = Client.player.getPos();
      return {success:true, x: pPos.x, y: pPos.y, z: pPos.z};
    }
    if (qtype === 'blockPos') {
      var bPos = Client.player.getBlockPos();
      return {success:true, x: bPos.getX(), y: bPos.getY(), z: bPos.getZ()};
    }
    if (qtype === 'headYaw') return {success:true, headYaw: Client.player.headYaw};
    if (qtype === 'bodyYaw') return {success:true, bodyYaw: Client.player.bodyYaw};
    if (qtype === 'isInWater') return {success:true, inWater: Client.player.isInWater()};
    if (qtype === 'isInLava') return {success:true, inLava: Client.player.isInLava()};
    if (qtype === 'isOnGround') return {success:true, onGround: Client.player.isOnGround()};
    if (qtype === 'isSneaking') return {success:true, sneaking: Client.player.isSneaking()};
    if (qtype === 'isSprinting') return {success:true, sprinting: Client.player.isSprinting()};
    if (qtype === 'isFlying') return {success:true, flying: Client.player.getAbilities().flying};
    if (qtype === 'isSleeping') return {success:true, sleeping: Client.player.isSleeping()};
    if (qtype === 'isWet') return {success:true, wet: Client.player.isWet()};
    if (qtype === 'isRiding') return {success:true, riding: Client.player.hasVehicle()};
    if (qtype === 'stepHeight') return {success:true, stepHeight: Client.player.getStepHeight()};
    if (qtype === 'stuckArrowCount') return {success:true, stuckArrows: Client.player.getStuckArrowCount()};
    if (qtype === 'statusEffects') {
      var eff = Client.player.getStatusEffects();
      var list = [];
      for (var i = 0; i < eff.size(); i++) {
        var e = eff.get(i);
        list.push({effect: e.getEffectType().getTranslationKey(), duration: e.getDuration(), amplifier: e.getAmplifier()});
      }
      return {success:true, effects: list};
    }
    return {success:false, error:'Unknown player query: '+qtype};
  };
};

// Template: item detail (NBT, enchantments, components)
TM.itemDetail = function(params) {
  var dtype = params.detail || 'basic';
  return function(payload) {
    try { _check(); } catch(e) { return {success:false, error:e.message}; }
    var slot = payload.slot;
    if (typeof slot !== 'number') return {success:false, error:'slot must be number'};
    var inv = Client.player.getInventory();
    var s = inv.getStack(slot);
    if (s.isEmpty()) return {success:true, slot: slot, empty: true};
    var res = {success:true, slot: slot, itemId: s.getItem().getTranslationKey(), count: s.getCount(), name: s.getName().getString()};
    if (dtype === 'basic') return res;
    if (dtype === 'nbt') {
      var nbt = s.getNbt();
      res.nbt = nbt ? nbt.toString() : null;
      return res;
    }
    if (dtype === 'durability') {
      res.durability = s.getMaxDamage() - s.getDamage();
      res.maxDurability = s.getMaxDamage();
      res.damage = s.getDamage();
      return res;
    }
    if (dtype === 'enchantments') {
      var ench = s.getEnchantments();
      var elist = [];
      for (var i = 0; i < ench.size(); i++) {
        var e = ench.get(i);
        elist.push({id: e.getKey().getValue().toString(), level: e.getValue()});
      }
      res.enchantments = elist;
      return res;
    }
    if (dtype === 'components') {
      var comps = s.getComponents();
      res.components = comps.toString();
      return res;
    }
    if (dtype === 'food') {
      var food = s.getItem().getFoodComponent();
      res.food = food ? {hunger: food.getHunger(), saturation: food.getSaturationModifier()} : null;
      return res;
    }
    if (dtype === 'potion') {
      var pot = s.get(Java.type('net.minecraft.component.DataComponentTypes').POTION_CONTENTS);
      if (pot) {
        var eff = pot.getEffects();
        var peff = [];
        for (var i = 0; i < eff.size(); i++) {
          var pe = eff.get(i);
          peff.push({effect: pe.getEffectType().getTranslationKey(), duration: pe.getDuration(), amplifier: pe.getAmplifier()});
        }
        res.potionEffects = peff;
        res.potionType = pot.hasCustomColor() ? 'custom' : 'standard';
      } else {
        res.potionEffects = null;
      }
      return res;
    }
    if (dtype === 'full') {
      return {success:true, slot:slot, itemId:s.getItem().getTranslationKey(), count:s.getCount(), name:s.getName().getString(),
        nbt: (s.getNbt()||'').toString(), maxDurability: s.getMaxDamage(), damage: s.getDamage(),
        components: s.getComponents().toString()};
    }
    return res;
  };
};

// Template: utility commands (math, string, json)
TM.utility = function(params) {
  var utype = params.utype, op = params.op;
  return function(payload) {
    if (utype === 'math') {
      var a = payload.a, b = payload.b;
      if (op === 'add') return {success:true, result: a+b};
      if (op === 'sub') return {success:true, result: a-b};
      if (op === 'mul') return {success:true, result: a*b};
      if (op === 'div') return {success:true, result: b!==0?a/b:NaN};
      if (op === 'floor') return {success:true, result: Math.floor(a)};
      if (op === 'ceil') return {success:true, result: Math.ceil(a)};
      if (op === 'round') return {success:true, result: Math.round(a)};
      if (op === 'abs') return {success:true, result: Math.abs(a)};
      if (op === 'min') return {success:true, result: Math.min(a,b)};
      if (op === 'max') return {success:true, result: Math.max(a,b)};
      if (op === 'sqrt') return {success:true, result: Math.sqrt(a)};
      if (op === 'pow') return {success:true, result: Math.pow(a,b)};
      if (op === 'clamp') {
        var min = payload.min||0, max = payload.max||1;
        return {success:true, result: Math.max(min, Math.min(max, a))};
      }
      if (op === 'sum') {
        var arr = payload.array || [];
        var s = 0;
        for (var i = 0; i < arr.length; i++) s += arr[i];
        return {success:true, result: s};
      }
      if (op === 'avg') {
        var arr = payload.array || [];
        if (!arr.length) return {success:true, result: 0};
        var s2 = 0;
        for (var i2 = 0; i2 < arr.length; i2++) s2 += arr[i2];
        return {success:true, result: s2 / arr.length};
      }
      if (op === 'median') {
        var arr = (payload.array || []).slice().sort(function(x,y){return x-y;});
        var mid = Math.floor(arr.length/2);
        return {success:true, result: arr.length%2 ? arr[mid] : (arr[mid-1]+arr[mid])/2};
      }
      if (op === 'mod') return {success:true, result: a % b};
      if (op === 'dist') return {success:true, result: Math.sqrt(a*a + b*b)};
      if (op === 'dist3d') {
        var x1=payload.x1||0,y1=payload.y1||0,z1=payload.z1||0,x2=payload.x2||0,y2=payload.y2||0,z2=payload.z2||0;
        return {success:true, result: Math.sqrt((x2-x1)*(x2-x1)+(y2-y1)*(y2-y1)+(z2-z1)*(z2-z1))};
      }
      if (op === 'toRad') return {success:true, result: a * Math.PI / 180};
      if (op === 'toDeg') return {success:true, result: a * 180 / Math.PI};
      if (op === 'sign') return {success:true, result: a > 0 ? 1 : a < 0 ? -1 : 0};
      if (op === 'lerp') {
        var min=payload.min||0,max=payload.max||1;
        return {success:true, result: min + (max - min) * a};
      }
      if (op === 'normalize') {
        var min2=payload.min||0,max2=payload.max||1;
        if (max2 === min2) return {success:true, result: 0.5};
        return {success:true, result: (a - min2) / (max2 - min2)};
      }
      if (op === 'pi') return {success:true, result: Math.PI};
      if (op === 'e') return {success:true, result: Math.E};
      if (op === 'radians') return {success:true, result: a * Math.PI / 180};
      if (op === 'degrees') return {success:true, result: a * 180 / Math.PI};
      if (op === 'random') return {success:true, result: Math.random()};
      if (op === 'randomInt') {
        var mn=payload.min||0, mx=payload.max||100;
        return {success:true, result: Math.floor(Math.random()*(mx-mn+1))+mn};
      }
      return {success:false, error:'Unknown math op: '+op};
    }
    if (utype === 'string') {
      var s = payload.string || '';
      if (op === 'length') return {success:true, result: s.length};
      if (op === 'concat') return {success:true, result: s + (payload.other || '')};
      if (op === 'upper') return {success:true, result: s.toUpperCase()};
      if (op === 'lower') return {success:true, result: s.toLowerCase()};
      if (op === 'trim') return {success:true, result: s.trim()};
      if (op === 'replace') return {success:true, result: s.replace(payload.find || '', payload.replacement || '')};
      if (op === 'split') return {success:true, result: s.split(payload.delimiter || ',')};
      if (op === 'padStart') return {success:true, result: s.padStart(payload.len || 0, payload.char || ' ')};
      if (op === 'padEnd') return {success:true, result: s.padEnd(payload.len || 0, payload.char || ' ')};
      if (op === 'repeat') return {success:true, result: s.repeat(payload.count || 0)};
      if (op === 'replaceAll') return {success:true, result: s.split(payload.find || '').join(payload.replacement || '')};
      if (op === 'join') return {success:true, result: (payload.array || []).join(s)};
      if (op === 'indexOf') return {success:true, result: s.indexOf(payload.search || '')};
      if (op === 'includes') return {success:true, result: s.includes(payload.search || '')};
      if (op === 'startsWith') return {success:true, result: s.startsWith(payload.search || '')};
      if (op === 'endsWith') return {success:true, result: s.endsWith(payload.search || '')};
      if (op === 'substring') return {success:true, result: s.substring(payload.start || 0, payload.end)};
      if (op === 'charAt') return {success:true, result: s.charAt(payload.index || 0)};
      if (op === 'charCodeAt') return {success:true, result: s.charCodeAt(payload.index || 0)};
      if (op === 'parseFloat') return {success:true, result: parseFloat(s)};
      if (op === 'parseInt') return {success:true, result: parseInt(s, payload.radix || 10)};
      if (op === 'format') {
        var result = s;
        var args = payload.args || [];
        for (var i = 0; i < args.length; i++) result = result.replace('{' + i + '}', args[i]);
        return {success:true, result: result};
      }
      return {success:false, error:'Unknown string op: '+op};
    }
    if (utype === 'json') {
      if (op === 'parse') { try { return {success:true, result: JSON.parse(payload.string)}; } catch(e) { return {success:false, error:'JSON parse error: '+e.message}; } }
      if (op === 'stringify') { try { return {success:true, result: JSON.stringify(payload.data)}; } catch(e) { return {success:false, error:'JSON stringify error: '+e.message}; } }
      if (op === 'get') { 
        if (!payload.path || !payload.object) return {success:false, error:'path and object required'};
        var parts2 = payload.path.split('.'), obj = payload.object;
        for (var i = 0; i < parts2.length && obj != null; i++) obj = obj[parts2[i]];
        return {success:true, result: obj !== undefined ? obj : null};
      }
      if (op === 'keys') { try { return {success:true, result: Object.keys(payload.data || {})}; } catch(e) { return {success:false, error: e.message}; } }
      if (op === 'values') { try { return {success:true, result: Object.values(payload.data || {})}; } catch(e) { return {success:false, error: e.message}; } }
      if (op === 'has') return {success:true, result: payload.path ? (payload.data || {}).hasOwnProperty(payload.path) : false};
      if (op === 'merge') { try { return {success:true, result: Object.assign({}, payload.data || {}, payload.other || {})}; } catch(e) { return {success:false, error: e.message}; } }
      if (op === 'type') return {success:true, result: typeof payload.data};
      return {success:false, error:'Unknown json op: '+op};
    }
    if (utype === 'array') {
      var arr = payload.array || [];
      if (op === 'length') return {success:true, result: arr.length};
      if (op === 'get') return {success:true, result: arr[payload.index]};
      if (op === 'first') return {success:true, result: arr[0]};
      if (op === 'last') return {success:true, result: arr[arr.length-1]};
      if (op === 'slice') return {success:true, result: arr.slice(payload.start||0, payload.end||arr.length)};
      if (op === 'filter') {
        if (!payload.key) return {success:false, error:'filter needs key'};
        var fv = payload.value;
        return {success:true, result: arr.filter(function(x){return x[payload.key]===fv;})};
      }
      if (op === 'push') { arr.push(payload.value); return {success:true, result: arr, length: arr.length}; }
      if (op === 'pop') { return {success:true, result: arr.pop(), length: arr.length}; }
      if (op === 'shift') { return {success:true, result: arr.shift(), length: arr.length}; }
      if (op === 'unshift') { arr.unshift(payload.value); return {success:true, result: arr, length: arr.length}; }
      if (op === 'includes') return {success:true, result: arr.indexOf(payload.value) >= 0};
      if (op === 'indexOf') return {success:true, result: arr.indexOf(payload.value)};
      if (op === 'join') return {success:true, result: arr.join(payload.delimiter || ',')};
      if (op === 'concat') return {success:true, result: arr.concat(payload.other || [])};
      if (op === 'sort') { var arr2 = arr.slice(); arr2.sort(); return {success:true, result: arr2}; }
      if (op === 'reverse') { var arr3 = arr.slice(); arr3.reverse(); return {success:true, result: arr3}; }
      if (op === 'every') return {success:true, result: arr.every(function(x){return !!x[payload.key];})};
      if (op === 'some') return {success:true, result: arr.some(function(x){return !!x[payload.key];})};
      return {success:false, error:'Unknown array op: '+op};
    }
    if (utype === 'random') {
      if (op === 'int') {
        var mn = payload.min || 0, mx = payload.max || 100;
        return {success:true, result: Math.floor(Math.random()*(mx-mn+1))+mn};
      }
      if (op === 'float') return {success:true, result: Math.random()};
      if (op === 'boolean') return {success:true, result: Math.random() > 0.5};
      if (op === 'uuid') return {success:true, result: 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0,v=c=='x'?r:(r&0x3|0x8);return v.toString(16);})};
      if (op === 'string') {
        var len = payload.length || 8;
        var chars = payload.chars || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        var r2 = '';
        for (var i = 0; i < len; i++) r2 += chars.charAt(Math.floor(Math.random()*chars.length));
        return {success:true, result: r2};
      }
      if (op === 'shuffle') {
        var arr = payload.array || [];
        for (var i = arr.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random()*(i+1));
          var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return {success:true, result: arr};
      }
      if (op === 'choice') {
        var arr2 = payload.array || [];
        return {success:true, result: arr2[Math.floor(Math.random()*arr2.length)]};
      }
      return {success:false, error:'Unknown random op: '+op};
    }
    if (utype === 'base64') {
      if (op === 'encode') return {success:true, result: (typeof Buffer !== 'undefined') ? Buffer.from(payload.string || '').toString('base64') : btoa(payload.string || '')};
      if (op === 'decode') return {success:true, result: (typeof Buffer !== 'undefined') ? Buffer.from(payload.string || '', 'base64').toString() : atob(payload.string || '')};
      return {success:false, error:'Unknown base64 op: '+op};
    }
    if (utype === 'time') {
      if (op === 'now') return {success:true, result: new Date().toISOString()};
      if (op === 'ms') return {success:true, result: Date.now()};
      if (op === 'format') {
        var d = payload.date ? new Date(payload.date) : new Date();
        return {success:true, result: d.toISOString()};
      }
      if (op === 'sleep') {
        var ms = Math.max(0, payload.ms || 1000);
        java.lang.Thread.sleep(ms);
        return {success:true, slept: ms};
      }
      return {success:false, error:'Unknown time op: '+op};
    }
    if (utype === 'compare') {
      var va = payload.a, vb = payload.b;
      if (op === 'eq') return {success:true, result: va === vb};
      if (op === 'neq') return {success:true, result: va !== vb};
      if (op === 'gt') return {success:true, result: va > vb};
      if (op === 'gte') return {success:true, result: va >= vb};
      if (op === 'lt') return {success:true, result: va < vb};
      if (op === 'lte') return {success:true, result: va <= vb};
      return {success:false, error:'Unknown compare op: '+op};
    }
    if (utype === 'type') return {success:true, result: typeof payload.data};
    if (utype === 'clone') {
      try { return {success:true, result: JSON.parse(JSON.stringify(payload.data))}; }
      catch(e) { return {success:false, error:'Clone failed: '+e.message}; }
    }
    return {success:false, error:'Unknown utility type: '+utype};
  };
};

// Template: player action (movement, abilities)
TM.playerAction = function(params) {
  var action = params.action;
  return function(payload) {
    try { _check(); } catch(e) { return {success:false, error:e.message}; }
    if (action === 'jump') { Client.player.jump(); return {success:true}; }
    if (action === 'sprint') { Client.player.setSprinting(!!payload.state); return {success:true, sprinting: !!payload.state}; }
    if (action === 'sneak') { Client.player.setSneaking(!!payload.state); return {success:true, sneaking: !!payload.state}; }
    if (action === 'swimUp') { Client.player.setSprinting(true); return {success:true}; }
    if (action === 'stop') {
      Client.player.setSprinting(false); Client.player.setSneaking(false);
      Client.options.forwardKey.setPressed(false); Client.options.backKey.setPressed(false);
      Client.options.leftKey.setPressed(false); Client.options.rightKey.setPressed(false);
      return {success:true};
    }
    if (action === 'forward') { Client.options.forwardKey.setPressed(!!payload.state); return {success:true, forward: !!payload.state}; }
    if (action === 'backward') { Client.options.backKey.setPressed(!!payload.state); return {success:true, backward: !!payload.state}; }
    if (action === 'strafeLeft') { Client.options.leftKey.setPressed(!!payload.state); return {success:true, strafeLeft: !!payload.state}; }
    if (action === 'strafeRight') { Client.options.rightKey.setPressed(!!payload.state); return {success:true, strafeRight: !!payload.state}; }
    if (action === 'look') {
      if (typeof payload.yaw !== 'number' || typeof payload.pitch !== 'number') return {success:false, error:'yaw and pitch required'};
      Client.player.networkHandler.sendPacket(new LookPacket(payload.yaw, payload.pitch, Client.player.isOnGround()));
      return {success:true, yaw: payload.yaw, pitch: payload.pitch};
    }
    if (action === 'lookAt') {
      var pos = Client.player.getPos();
      var dx = payload.x - pos.x, dy = (payload.y+1) - (pos.y + 1.62), dz = payload.z - pos.z;
      var yaw = Math.atan2(dz, dx) * 180 / Math.PI - 90;
      var pitch = Math.max(-90, Math.min(90, -Math.atan2(dy, Math.sqrt(dx*dx+dz*dz)) * 180 / Math.PI));
      if (yaw < -180) yaw += 360; if (yaw > 180) yaw -= 360;
      Client.player.networkHandler.sendPacket(new LookPacket(yaw, pitch, Client.player.isOnGround()));
      return {success:true, yaw: yaw, pitch: pitch};
    }
    if (action === 'move') {
      if (typeof payload.x !== 'number' || typeof payload.y !== 'number' || typeof payload.z !== 'number') return {success:false, error:'x,y,z required'};
      var PosPacket = Java.type('net.minecraft.network.packet.c2s.play.PlayerMoveC2SPacket$PositionAndOnGround');
      Client.player.networkHandler.sendPacket(new PosPacket(payload.x, payload.y, payload.z, true));
      return {success:true};
    }
    if (action === 'attack') { Client.player.swingHand(Hand.MAIN_HAND); return {success:true}; }
    if (action === 'use') {
      Client.interactionManager.interactItem(Client.player, Client.world, Hand.MAIN_HAND);
      return {success:true};
    }
    if (action === 'drop') {
      var slot2 = payload.slot;
      if (typeof slot2 === 'number') {
        Client.player.dropItem(Client.player.getInventory().getStack(slot2), false, true);
      } else {
        Client.player.dropSelectedItem(false);
      }
      return {success:true};
    }
    if (action === 'selectSlot') {
      var s = payload.slot;
      if (typeof s !== 'number' || s < 0 || s > 8) return {success:false, error:'slot must be 0-8'};
      Client.player.getInventory().selectedSlot = s;
      return {success:true, selectedSlot: s};
    }
    if (action === 'swapHands') { Client.player.swapHandItems(); return {success:true}; }
    if (action === 'fly') {
      var ab = Client.player.getAbilities();
      ab.flying = !!payload.state;
      Client.player.sendAbilitiesUpdate();
      return {success:true, flying: !!payload.state};
    }
    return {success:false, error:'Unknown action: '+action};
  };
};

// Template: block interaction
TM.blockAction = function(params) {
  var action = params.action || 'activate';
  return function(payload) {
    try { _check(); } catch(e) { return {success:false, error:e.message}; }
    var x = Math.floor(payload.x), y = Math.floor(payload.y), z = Math.floor(payload.z);
    var pos = new BlockPos(x, y, z);
    var HitResult = Java.type('net.minecraft.util.hit.BlockHitResult');
    var Vec3d = Java.type('net.minecraft.util.math.Vec3d');
    if (action === 'activate') {
      var face = payload.face || 'UP';
      var hitResult = new HitResult(new Vec3d(x+0.5, y+1.0, z+0.5));
      Client.interactionManager.interactBlock(Client.player, Client.world, Hand.MAIN_HAND, hitResult);
      return {success:true};
    }
    if (action === 'break') {
      Client.interactionManager.breakBlock(pos);
      Client.player.swingHand(Hand.MAIN_HAND);
      return {success:true};
    }
    if (action === 'mine') {
      Client.interactionManager.updateBlockBreakingProgress(pos, payload.direction || 0);
      return {success:true, mining: true};
    }
    if (action === 'place') {
      var face2 = payload.face || 'UP';
      var hitResult2 = new HitResult(new Vec3d(x+0.5, y+1.0, z+0.5));
      Client.interactionManager.interactBlock(Client.player, Client.world, Hand.MAIN_HAND, hitResult2);
      return {success:true};
    }
    if (action === 'attack') {
      Client.player.swingHand(Hand.MAIN_HAND);
      Client.interactionManager.attackBlock(pos, payload.direction || 0);
      return {success:true};
    }
    return {success:false, error:'Unknown block action: '+action};
  };
};

// Template: navigation
TM.nav = function(params) {
  var ntype = params.type;
  return function(payload) {
    try { _check(); } catch(e) { return {success:false, error:e.message}; }
    if (ntype === 'walkTo') {
      _walkTarget = {x: Math.floor(payload.x)+0.5, y: payload.y, z: Math.floor(payload.z)+0.5};
      return {success:true, walking: true, target: {x: payload.x, y: payload.y, z: payload.z}};
    }
    if (ntype === 'walkStatus') {
      var pos = Client.player.getPos();
      var dx = _walkTarget ? _walkTarget.x - pos.x : 0;
      var dz = _walkTarget ? _walkTarget.z - pos.z : 0;
      var dist = _walkTarget ? Math.sqrt(dx*dx+dz*dz) : 0;
      return {success:true, walking: _walkTarget !== null, target: _walkTarget, distance: dist, position: {x: pos.x, y: pos.y, z: pos.z}};
    }
    if (ntype === 'cancelWalk') {
      _walkTarget = null;
      Client.options.forwardKey.setPressed(false);
      return {success:true};
    }
    if (ntype === 'teleport') {
      if (typeof payload.x !== 'number') return {success:false, error:'x required'};
      var y2 = payload.y != null ? payload.y : Client.player.getPos().y;
      var z2 = payload.z != null ? payload.z : Client.player.getPos().z;
      Client.player.setPosition(payload.x, y2, z2);
      return {success:true, x: payload.x, y: y2, z: z2};
    }
    return {success:false, error:'Unknown nav type: '+ntype};
  };
};

// Template: screen command
TM.screenAction = function(params) {
  var saction = params.action;
  return function(payload) {
    try { _check(); } catch(e) { return {success:false, error:e.message}; }
    if (saction === 'getSlots') {
      if (!Client.player.currentScreenHandler) return {success:false, error:'No screen open'};
      var title = Client.player.currentScreenHandler.getTitle().getString();
      var slotList = Client.player.currentScreenHandler.slots;
      var slots = [];
      for (var i = 0; i < slotList.size(); i++) {
        var s = slotList.get(i).getStack();
        if (!s.isEmpty()) slots.push({slot: i, itemId: s.getItem().getTranslationKey(), count: s.getCount(), name: s.getName().getString()});
      }
      return {success:true, title: title, totalSlots: slotList.size(), slots: slots};
    }
    if (saction === 'getCursor') {
      var cursorStack = Client.player.currentScreenHandler ? Client.player.currentScreenHandler.getCursorStack() : null;
      if (cursorStack && !cursorStack.isEmpty()) return {success:true, itemId: cursorStack.getItem().getTranslationKey(), count: cursorStack.getCount(), name: cursorStack.getName().getString()};
      return {success:true, itemId: null, count: 0};
    }
    if (saction === 'close') { Client.player.closeScreen(); return {success:true}; }
    if (saction === 'title') {
      if (!payload.text) return {success:false, error:'text required'};
      var Text = Java.type('net.minecraft.text.Text');
      Client.player.sendMessage(Text.literal(payload.text), true);
      return {success:true};
    }
    if (saction === 'actionBar') {
      if (!payload.text) return {success:false, error:'text required'};
      var Text2 = Java.type('net.minecraft.text.Text');
      Client.player.sendMessage(Text2.literal(payload.text), true);
      return {success:true};
    }
    return {success:false, error:'Unknown screen action: '+saction};
  };
};

// Template: chat command
TM.chat = function(params) {
  var ctype = params.type;
  return function(payload) {
    try { _check(); } catch(e) { return {success:false, error:e.message}; }
    if (ctype === 'send') {
      if (!payload.message || typeof payload.message !== 'string') return {success:false, error:'Invalid message'};
      Client.player.sendChatMessage(payload.message);
      return {success:true};
    }
    if (ctype === 'command') {
      if (!payload.command || typeof payload.command !== 'string') return {success:false, error:'Invalid command'};
      Client.player.networkHandler.sendCommand(payload.command);
      return {success:true};
    }
    if (ctype === 'history') {
      var limit = payload.limit || 20;
      return {success:true, messages: _lastChat.slice(-limit), total: _lastChat.length};
    }
    return {success:false, error:'Unknown chat type: '+ctype};
  };
};

// Template: container action  
TM.containerAction = function(params) {
  var caction = params.action;
  return function(payload) {
    try { _check(); } catch(e) { return {success:false, error:e.message}; }
    var x = Math.floor(payload.x), y = Math.floor(payload.y), z = Math.floor(payload.z);
    var pos = new BlockPos(x, y, z);
    var entity = Client.world.getBlockEntity(pos);
    if (!entity) return {success:false, error:'No block entity at position'};
    var Inventory = Java.type('net.minecraft.inventory.Inventory');
    if (!(entity instanceof Inventory)) return {success:false, error:'Not an inventory'};

    if (caction === 'scan') {
      var slots = [];
      for (var i = 0; i < entity.size(); i++) {
        var s = entity.getStack(i);
        if (!s.isEmpty()) slots.push({slot:i, itemId:s.getItem().getTranslationKey(), count:s.getCount(), name:s.getName().getString()});
      }
      return {success:true, size: entity.size(), containerType: entity.getBlockState().getBlock().getTranslationKey(), slots: slots};
    }
    if (caction === 'search') {
      var search = (payload.itemName || '').toLowerCase();
      var found = [];
      for (var i = 0; i < entity.size(); i++) {
        var s2 = entity.getStack(i);
        if (!s2.isEmpty()) {
          var id2 = s2.getItem().getTranslationKey().toLowerCase();
          if (id2.indexOf(search) >= 0 || (s2.getName().getString().toLowerCase().indexOf(search) >= 0)) {
            found.push({slot:i, itemId:s2.getItem().getTranslationKey(), count:s2.getCount(), name:s2.getName().getString()});
          }
        }
      }
      return {success:true, count: found.length, items: found};
    }
    if (caction === 'count') {
      var search2 = (payload.itemName || '').toLowerCase();
      var total = 0;
      for (var i = 0; i < entity.size(); i++) {
        var s3 = entity.getStack(i);
        if (!s3.isEmpty()) {
          var id3 = s3.getItem().getTranslationKey().toLowerCase();
          if (id3.indexOf(search2) >= 0) total += s3.getCount();
        }
      }
      return {success:true, itemName: payload.itemName, totalCount: total};
    }
    if (caction === 'brewingInfo') {
      var BrewingStandBlockEntity = Java.type('net.minecraft.block.entity.BrewingStandBlockEntity');
      if (entity instanceof BrewingStandBlockEntity) {
        return {success:true, fuel: entity.getFuel(), brewTime: entity.getBrewTime(), slotCount: entity.size()};
      }
      return {success:false, error:'Not a brewing stand'};
    }
    if (caction === 'furnaceInfo') {
      var AbstractFurnaceBlockEntity = Java.type('net.minecraft.block.entity.AbstractFurnaceBlockEntity');
      if (entity instanceof AbstractFurnaceBlockEntity) {
        return {success:true, burnTime: entity.burnTime, cookTime: entity.cookTime, cookTimeTotal: entity.cookTimeTotal, fuelTime: entity.fuelTime};
      }
      return {success:false, error:'Not a furnace'};
    }
    return {success:false, error:'Unknown container action: '+caction};
  };
};

// Template: single block query at position
TM.blockQuery = function(params) {
  return function(payload) {
    try { _check(); } catch(e) { return {success:false, error:e.message}; }
    var x = payload.x != null ? Math.floor(payload.x) : Math.floor(Client.player.getPos().x);
    var y = payload.y != null ? Math.floor(payload.y) : Math.floor(Client.player.getPos().y);
    var z = payload.z != null ? Math.floor(payload.z) : Math.floor(Client.player.getPos().z);
    var pos = new BlockPos(x, y, z);
    try {
      var bs = Client.world.getBlockState(pos);
      var bid = bs.getBlock().getTranslationKey();
      var be = Client.world.getBlockEntity(pos);
      var info = {
        x: x, y: y, z: z,
        blockId: bid,
        isAir: bs.isAir(),
        isSolid: bs.isSolid(),
        luminance: bs.getLuminance(),
        opacity: bs.getOpacity(Client.world, pos),
        hasBlockEntity: !!be,
        hardness: 0
      };
      try { info.hardness = bs.getHardness(null, Client.world, pos); } catch(e) {}
      return {success:true, block: info};
    } catch(e) {
      return {success:false, error: 'Block query failed: ' + e.message};
    }
  };
};

// Template: event operations (subscribe, unsubscribe, broadcast)
TM.eventOps = function(params) {
  var eop = params.op;
  return function(payload) {
    try { _check(); } catch(e) { return {success:false, error:e.message}; }
    if (eop === 'subscribe') {
      var evt = payload.event || 'position';
      if (_eventSubscriptions[evt]) return {success:true, event: evt, alreadySubscribed: true};
      _eventSubscriptions[evt] = true;
      return {success:true, event: evt, subscribed: true};
    }
    if (eop === 'unsubscribe') {
      var evt2 = payload.event || 'position';
      delete _eventSubscriptions[evt2];
      return {success:true, event: evt2, subscribed: false};
    }
    if (eop === 'list') {
      var subs = [];
      for (var k in _eventSubscriptions) if (_eventSubscriptions[k]) subs.push(k);
      return {success:true, subscriptions: subs};
    }
    if (eop === 'broadcast') {
      var evt3 = payload.event || 'custom';
      var evtData = payload.data || {};
      globalThis.__bridge.ws.broadcast('event', {event: evt3, data: evtData});
      return {success:true, event: evt3};
    }
    return {success:false, error:'Unknown event op: '+eop};
  };
};

// Template: inventory operations (count, search, total)
TM.invOps = function(params) {
  var iop = params.op;
  return function(payload) {
    try { _check(); } catch(e) { return {success:false, error:e.message}; }
    if (iop === 'count') {
      var search = (payload.itemName || '').toLowerCase();
      var total = 0;
      var inv = Client.player.getInventory();
      for (var i = 0; i < inv.size(); i++) {
        var s = inv.getStack(i);
        if (!s.isEmpty()) {
          var id = s.getItem().getTranslationKey().toLowerCase();
          if (id.indexOf(search) >= 0) total += s.getCount();
        }
      }
      return {success:true, itemName: payload.itemName, totalCount: total};
    }
    if (iop === 'isEmpty') {
      var inv2 = Client.player.getInventory();
      var empty = true;
      for (var i = 0; i < inv2.size(); i++) {
        if (!inv2.getStack(i).isEmpty()) { empty = false; break; }
      }
      return {success:true, empty: empty};
    }
    if (iop === 'search') {
      var search2 = (payload.itemName || '').toLowerCase();
      var found = [];
      var inv3 = Client.player.getInventory();
      for (var i = 0; i < inv3.size(); i++) {
        var s2 = inv3.getStack(i);
        if (!s2.isEmpty()) {
          var id2 = s2.getItem().getTranslationKey().toLowerCase();
          if (id2.indexOf(search2) >= 0) found.push({slot: i, itemId: s2.getItem().getTranslationKey(), count: s2.getCount(), name: s2.getName().getString()});
        }
      }
      return {success:true, count: found.length, items: found};
    }
    if (iop === 'firstSlot') {
      var search3 = (payload.itemName || '').toLowerCase();
      var inv4 = Client.player.getInventory();
      for (var i = 0; i < inv4.size(); i++) {
        var s3 = inv4.getStack(i);
        if (!s3.isEmpty()) {
          var id3 = s3.getItem().getTranslationKey().toLowerCase();
          if (id3.indexOf(search3) >= 0) return {success:true, slot: i, itemId: s3.getItem().getTranslationKey(), count: s3.getCount(), name: s3.getName().getString()};
        }
      }
      return {success:true, slot: -1, itemId: null, count: 0};
    }
    if (iop === 'hotbar') {
      var inv5 = Client.player.getInventory();
      var hotbar = [];
      for (var i = 0; i < 9; i++) {
        var s4 = inv5.getStack(i);
        if (s4.isEmpty()) hotbar.push({slot: i, itemId: null, count: 0});
        else hotbar.push({slot: i, itemId: s4.getItem().getTranslationKey(), count: s4.getCount(), name: s4.getName().getString()});
      }
      return {success:true, hotbar: hotbar, selectedSlot: inv5.selectedSlot};
    }
    if (iop === 'armor') {
      var inv6 = Client.player.getInventory();
      var armor = [];
      for (var i = 0; i < 4; i++) {
        var s5 = inv6.getArmorStack(i);
        if (s5.isEmpty()) armor.push({slot: i, itemId: null, count: 0});
        else armor.push({slot: i, itemId: s5.getItem().getTranslationKey(), count: s5.getCount(), name: s5.getName().getString()});
      }
      return {success:true, armor: armor};
    }
    if (iop === 'offhand') {
      var s6 = Client.player.getOffHandStack();
      if (s6.isEmpty()) return {success:true, itemId: null, count: 0};
      return {success:true, itemId: s6.getItem().getTranslationKey(), count: s6.getCount(), name: s6.getName().getString()};
    }
    if (iop === 'clear') {
      var inv7 = Client.player.getInventory();
      var cleared = 0;
      for (var i = 0; i < inv7.size(); i++) {
        if (!inv7.getStack(i).isEmpty()) { inv7.removeStack(i); cleared++; }
      }
      return {success:true, cleared: cleared};
    }
    return {success:false, error:'Unknown inv op: '+iop};
  };
};

// =============================================================================
// COMMAND REGISTRY — defines all generated commands
// =============================================================================

function registerGeneratedCommands() {
  var before = Object.keys(globalThis.__bridge.commands.handlers).length;

  // --- WORLD SCANNING (find blocks in radius) ---
  def('perceive.blocks.all', 'findBlocks', {filter: ''});
  def('perceive.blocks.chest', 'findBlocks', {filter: 'chest'});
  def('perceive.blocks.barrel', 'findBlocks', {filter: 'barrel'});
  def('perceive.blocks.brewing_stand', 'findBlocks', {filter: 'brewing_stand'});
  def('perceive.blocks.furnace', 'findBlocks', {filter: 'furnace'});
  def('perceive.blocks.crafting_table', 'findBlocks', {filter: 'crafting_table'});
  def('perceive.blocks.anvil', 'findBlocks', {filter: 'anvil'});
  def('perceive.blocks.enchanting_table', 'findBlocks', {filter: 'enchanting_table'});
  def('perceive.blocks.hopper', 'findBlocks', {filter: 'hopper'});
  def('perceive.blocks.dispenser', 'findBlocks', {filter: 'dispenser'});
  def('perceive.blocks.dropper', 'findBlocks', {filter: 'dropper'});
  def('perceive.blocks.shulker_box', 'findBlocks', {filter: 'shulker_box'});
  def('perceive.blocks.beacon', 'findBlocks', {filter: 'beacon'});
  def('perceive.blocks.campfire', 'findBlocks', {filter: 'campfire'});
  def('perceive.blocks.smoker', 'findBlocks', {filter: 'smoker'});
  def('perceive.blocks.blast_furnace', 'findBlocks', {filter: 'blast_furnace'});
  def('perceive.blocks.stonecutter', 'findBlocks', {filter: 'stonecutter'});
  def('perceive.blocks.grindstone', 'findBlocks', {filter: 'grindstone'});
  def('perceive.blocks.loom', 'findBlocks', {filter: 'loom'});
  def('perceive.blocks.cartography_table', 'findBlocks', {filter: 'cartography_table'});
  def('perceive.blocks.smithing_table', 'findBlocks', {filter: 'smithing_table'});
  def('perceive.blocks.door', 'findBlocks', {filter: 'door'});
  def('perceive.blocks.trapdoor', 'findBlocks', {filter: 'trapdoor'});
  def('perceive.blocks.gate', 'findBlocks', {filter: 'fence_gate'});
  def('perceive.blocks.lever', 'findBlocks', {filter: 'lever'});
  def('perceive.blocks.button', 'findBlocks', {filter: 'button'});
  def('perceive.blocks.pressure_plate', 'findBlocks', {filter: 'pressure_plate'});
  def('perceive.blocks.ore', 'findBlocks', {filter: 'ore'});
  def('perceive.blocks.wood', 'findBlocks', {filter: 'log'});
  def('perceive.blocks.plant', 'findBlocks', {filter: 'plant'});
  def('perceive.blocks.water', 'findBlocks', {filter: 'water'});
  def('perceive.blocks.lava', 'findBlocks', {filter: 'lava'});
  def('perceive.blocks.bed', 'findBlocks', {filter: 'bed'});
  def('perceive.blocks.workbench', 'findBlocks', {filter: 'workbench'});

  // --- ENTITY SCANNING ---
  def('perceive.entity.all', 'findEntities', {filter: ''});
  def('perceive.entity.player', 'findEntities', {filter: 'player'});
  def('perceive.entity.mob_hostile', 'findEntities', {filter: 'hostile'});
  def('perceive.entity.mob_passive', 'findEntities', {filter: 'passive'});
  def('perceive.entity.villager', 'findEntities', {filter: 'villager'});
  def('perceive.entity.animal', 'findEntities', {filter: 'animal'});
  def('perceive.entity.monster', 'findEntities', {filter: 'monster'});
  def('perceive.entity.item_drop', 'findEntities', {filter: 'item'});
  def('perceive.entity.nearest', 'findEntities', {filter: ''});

  // --- WORLD QUERIES ---
  def('world.biome', 'worldQuery', {type: 'biome'});
  def('world.light', 'worldQuery', {type: 'light'});
  def('world.difficulty', 'worldQuery', {type: 'difficulty'});
  def('world.weather', 'worldQuery', {type: 'weather'});
  def('world.time', 'worldQuery', {type: 'time'});
  def('world.dimension', 'worldQuery', {type: 'dimension'});
  def('world.spawn', 'worldQuery', {type: 'spawn'});
  def('world.height', 'worldQuery', {type: 'height'});

  // --- PLAYER QUERIES ---
  def('player.effects', 'playerQuery', {type: 'effects'});
  def('player.xp', 'playerQuery', {type: 'xp'});
  def('player.health', 'playerQuery', {type: 'health'});
  def('player.selectedSlot', 'playerQuery', {type: 'selectedSlot'});
  def('player.gamemode', 'playerQuery', {type: 'gamemode'});
  def('player.abilities', 'playerQuery', {type: 'abilities'});
  def('player.score', 'playerQuery', {type: 'score'});
  def('player.sleepTimer', 'playerQuery', {type: 'sleepTimer'});

  // --- ITEM DETAILS ---
  def('item.info', 'itemDetail', {detail: 'basic'});
  def('item.nbt', 'itemDetail', {detail: 'nbt'});
  def('item.durability', 'itemDetail', {detail: 'durability'});
  def('item.enchantments', 'itemDetail', {detail: 'enchantments'});
  def('item.components', 'itemDetail', {detail: 'components'});
  def('item.food', 'itemDetail', {detail: 'food'});
  def('item.potion', 'itemDetail', {detail: 'potion'});
  def('item.full', 'itemDetail', {detail: 'full'});

  // --- INVENTORY SLOTS (expanded: {0-40}) ---
  def('inv.slot.{0-40}.get', 'invGet', {});
  def('inv.slot.{0-40}.set', 'invSet', {});

  // --- CONTAINER SCREEN SLOTS (expanded: {0-53}) ---
  def('screen.slot.{0-53}.get', 'containerGet', {});

  // --- SCREEN CLICKS (expanded: all action types × all slots) ---
  def('screen.click.PICKUP.slot.{0-53}', 'screenClick', {slot: '*', actionType: 'PICKUP', button: 0});
  def('screen.click.QUICK_MOVE.slot.{0-53}', 'screenClick', {slot: '*', actionType: 'QUICK_MOVE', button: 0});
  def('screen.click.SWAP.slot.{0-53}', 'screenClick', {slot: '*', actionType: 'SWAP', button: 0});
  def('screen.click.THROW.slot.{0-53}', 'screenClick', {slot: '*', actionType: 'THROW', button: 0});
  def('screen.click.CLONE.slot.{0-53}', 'screenClick', {slot: '*', actionType: 'CLONE', button: 0});
  def('screen.click.QUICK_CRAFT.slot.{0-53}', 'screenClick', {slot: '*', actionType: 'QUICK_CRAFT', button: 0});

  // --- SCREEN ACTIONS ---
  def('screen.getSlots', 'screenAction', {action: 'getSlots'});
  def('screen.getCursor', 'screenAction', {action: 'getCursor'});
  def('screen.close', 'screenAction', {action: 'close'});
  def('screen.title', 'screenAction', {action: 'title'});
  def('screen.actionBar', 'screenAction', {action: 'actionBar'});

  // --- PLAYER ACTIONS ---
  def('act.jump', 'playerAction', {action: 'jump'});
  def('act.sprint', 'playerAction', {action: 'sprint'});
  def('act.sneak', 'playerAction', {action: 'sneak'});
  def('act.stop', 'playerAction', {action: 'stop'});
  def('act.forward', 'playerAction', {action: 'forward'});
  def('act.backward', 'playerAction', {action: 'backward'});
  def('act.strafeLeft', 'playerAction', {action: 'strafeLeft'});
  def('act.strafeRight', 'playerAction', {action: 'strafeRight'});
  def('act.look', 'playerAction', {action: 'look'});
  def('act.lookAt', 'playerAction', {action: 'lookAt'});
  def('act.move', 'playerAction', {action: 'move'});
  def('act.attack', 'playerAction', {action: 'attack'});
  def('act.use', 'playerAction', {action: 'use'});
  def('act.drop', 'playerAction', {action: 'drop'});
  def('act.selectSlot.{0-8}', 'playerAction', {action: 'selectSlot'});
  def('act.swapHands', 'playerAction', {action: 'swapHands'});
  def('act.fly', 'playerAction', {action: 'fly'});

  // --- BLOCK ACTIONS ---
  def('block.activate', 'blockAction', {action: 'activate'});
  def('block.break', 'blockAction', {action: 'break'});
  def('block.mine', 'blockAction', {action: 'mine'});
  def('block.place', 'blockAction', {action: 'place'});
  def('block.attack', 'blockAction', {action: 'attack'});

  // --- NAVIGATION ---
  def('nav.walkTo', 'nav', {type: 'walkTo'});
  def('nav.walkStatus', 'nav', {type: 'walkStatus'});
  def('nav.cancelWalk', 'nav', {type: 'cancelWalk'});
  def('nav.teleport', 'nav', {type: 'teleport'});

  // --- CHAT ---
  def('chat.send', 'chat', {type: 'send'});
  def('chat.command', 'chat', {type: 'command'});
  def('chat.history', 'chat', {type: 'history'});

  // --- CONTAINER ACTIONS ---
  def('container.scan', 'containerAction', {action: 'scan'});
  def('container.search', 'containerAction', {action: 'search'});
  def('container.count', 'containerAction', {action: 'count'});
  def('container.brewingInfo', 'containerAction', {action: 'brewingInfo'});
  def('container.furnaceInfo', 'containerAction', {action: 'furnaceInfo'});

  // --- UTILITY COMMANDS ---
  // Math
  def('util.math.add', 'utility', {utype: 'math', op: 'add'});
  def('util.math.sub', 'utility', {utype: 'math', op: 'sub'});
  def('util.math.mul', 'utility', {utype: 'math', op: 'mul'});
  def('util.math.div', 'utility', {utype: 'math', op: 'div'});
  def('util.math.floor', 'utility', {utype: 'math', op: 'floor'});
  def('util.math.ceil', 'utility', {utype: 'math', op: 'ceil'});
  def('util.math.round', 'utility', {utype: 'math', op: 'round'});
  def('util.math.abs', 'utility', {utype: 'math', op: 'abs'});
  def('util.math.min', 'utility', {utype: 'math', op: 'min'});
  def('util.math.max', 'utility', {utype: 'math', op: 'max'});
  def('util.math.sqrt', 'utility', {utype: 'math', op: 'sqrt'});
  def('util.math.pow', 'utility', {utype: 'math', op: 'pow'});
  def('util.math.clamp', 'utility', {utype: 'math', op: 'clamp'});
  def('util.math.random', 'utility', {utype: 'math', op: 'random'});
  def('util.math.randomInt', 'utility', {utype: 'math', op: 'randomInt'});
  // String
  def('util.string.length', 'utility', {utype: 'string', op: 'length'});
  def('util.string.concat', 'utility', {utype: 'string', op: 'concat'});
  def('util.string.upper', 'utility', {utype: 'string', op: 'upper'});
  def('util.string.lower', 'utility', {utype: 'string', op: 'lower'});
  def('util.string.trim', 'utility', {utype: 'string', op: 'trim'});
  def('util.string.replace', 'utility', {utype: 'string', op: 'replace'});
  def('util.string.split', 'utility', {utype: 'string', op: 'split'});
  // JSON
  def('util.json.parse', 'utility', {utype: 'json', op: 'parse'});
  def('util.json.stringify', 'utility', {utype: 'json', op: 'stringify'});
  def('util.json.get', 'utility', {utype: 'json', op: 'get'});
  // Array
  def('util.array.length', 'utility', {utype: 'array', op: 'length'});
  def('util.array.get', 'utility', {utype: 'array', op: 'get'});
  def('util.array.first', 'utility', {utype: 'array', op: 'first'});
  def('util.array.last', 'utility', {utype: 'array', op: 'last'});
  def('util.array.slice', 'utility', {utype: 'array', op: 'slice'});
  def('util.array.filter', 'utility', {utype: 'array', op: 'filter'});

  // --- WORLD EXPANDED QUERIES ---
  def('world.seed', 'worldQuery', {type: 'seed'});
  def('world.moonPhase', 'worldQuery', {type: 'moonPhase'});
  def('world.slimeChunk', 'worldQuery', {type: 'slimeChunk'});
  def('world.structure', 'worldQuery', {type: 'structure'});
  def('world.entityCount', 'worldQuery', {type: 'entityCount'});
  def('world.fullBright', 'worldQuery', {type: 'fullBright'});
  def('world.hardcore', 'worldQuery', {type: 'hardcore'});
  def('world.findContainer', 'worldQuery', {type: 'findContainer'});
  def('world.block', 'blockQuery', {});

  // --- PLAYER EXPANDED QUERIES ---
  def('player.hunger', 'playerQuery', {type: 'hunger'});
  def('player.oxygen', 'playerQuery', {type: 'oxygen'});
  def('player.armor', 'playerQuery', {type: 'armor'});
  def('player.velocity', 'playerQuery', {type: 'velocity'});
  def('player.frozenTicks', 'playerQuery', {type: 'frozenTicks'});
  def('player.fireTicks', 'playerQuery', {type: 'fireTicks'});
  def('player.fallDistance', 'playerQuery', {type: 'fallDistance'});
  def('player.absorption', 'playerQuery', {type: 'absorption'});
  def('player.mainHand', 'playerQuery', {type: 'mainHand'});
  def('player.offHand', 'playerQuery', {type: 'offHand'});
  def('player.yaw', 'playerQuery', {type: 'yaw'});
  def('player.pitch', 'playerQuery', {type: 'pitch'});
  def('player.pos', 'playerQuery', {type: 'pos'});
  def('player.blockPos', 'playerQuery', {type: 'blockPos'});
  def('player.headYaw', 'playerQuery', {type: 'headYaw'});
  def('player.bodyYaw', 'playerQuery', {type: 'bodyYaw'});
  def('player.isInWater', 'playerQuery', {type: 'isInWater'});
  def('player.isInLava', 'playerQuery', {type: 'isInLava'});
  def('player.isOnGround', 'playerQuery', {type: 'isOnGround'});
  def('player.isSneaking', 'playerQuery', {type: 'isSneaking'});
  def('player.isSprinting', 'playerQuery', {type: 'isSprinting'});
  def('player.isFlying', 'playerQuery', {type: 'isFlying'});
  def('player.isSleeping', 'playerQuery', {type: 'isSleeping'});
  def('player.isWet', 'playerQuery', {type: 'isWet'});
  def('player.isRiding', 'playerQuery', {type: 'isRiding'});
  def('player.statusEffects', 'playerQuery', {type: 'statusEffects'});

  // --- INVENTORY OPERATIONS ---
  def('inv.search', 'invOps', {op: 'search'});
  def('inv.count', 'invOps', {op: 'count'});
  def('inv.isEmpty', 'invOps', {op: 'isEmpty'});
  def('inv.firstSlot', 'invOps', {op: 'firstSlot'});
  def('inv.hotbar', 'invOps', {op: 'hotbar'});
  def('inv.armor', 'invOps', {op: 'armor'});
  def('inv.offhand', 'invOps', {op: 'offhand'});
  def('inv.clear', 'invOps', {op: 'clear'});
  def('inv.hotbar.{0-8}.get', 'invGet', {});
  def('inv.hotbar.{0-8}.set', 'invSet', {});
  def('inv.armor.{0-3}.get', 'invGet', {});

  // --- CHAT EXPANDED ---
  def('chat.whisper', 'chat', {type: 'send'});
  def('chat.say', 'chat', {type: 'send'});
  def('chat.tell', 'chat', {type: 'send'});
  def('chat.teamMsg', 'chat', {type: 'send'});
  def('chat.clear', 'chat', {type: 'clear'});

  // --- EVENT OPERATIONS ---
  def('event.subscribe', 'eventOps', {op: 'subscribe'});
  def('event.unsubscribe', 'eventOps', {op: 'unsubscribe'});
  def('event.list', 'eventOps', {op: 'list'});
  def('event.broadcast', 'eventOps', {op: 'broadcast'});

  // --- NAV EXPANDED ---
  def('nav.walkToBlock', 'nav', {type: 'walkToBlock'});
  def('nav.jump', 'nav', {type: 'jump'});
  def('nav.climb', 'nav', {type: 'climb'});
  def('nav.swim', 'nav', {type: 'swim'});

  // --- MORE PERCEIVE ---
  def('perceive.blocks.crops', 'findBlocks', {filter: 'crop'});
  def('perceive.blocks.nether_wart', 'findBlocks', {filter: 'nether_wart'});
  def('perceive.blocks.rail', 'findBlocks', {filter: 'rail'});
  def('perceive.blocks.torch', 'findBlocks', {filter: 'torch'});
  def('perceive.blocks.ladder', 'findBlocks', {filter: 'ladder'});
  def('perceive.blocks.sapling', 'findBlocks', {filter: 'sapling'});
  def('perceive.blocks.flower', 'findBlocks', {filter: 'flower'});
  def('perceive.blocks.tall_grass', 'findBlocks', {filter: 'tall_grass'});
  def('perceive.blocks.vine', 'findBlocks', {filter: 'vine'});
  def('perceive.blocks.mushroom', 'findBlocks', {filter: 'mushroom'});
  def('perceive.blocks.cactus', 'findBlocks', {filter: 'cactus'});
  def('perceive.blocks.sugar_cane', 'findBlocks', {filter: 'sugar_cane'});
  def('perceive.blocks.bamboo', 'findBlocks', {filter: 'bamboo'});
  def('perceive.blocks.cocoa', 'findBlocks', {filter: 'cocoa'});
  def('perceive.blocks.pumpkin', 'findBlocks', {filter: 'pumpkin'});
  def('perceive.blocks.melon', 'findBlocks', {filter: 'melon'});
  def('perceive.blocks.azalea', 'findBlocks', {filter: 'azalea'});
  def('perceive.blocks.moss', 'findBlocks', {filter: 'moss'});
  def('perceive.blocks.amethyst', 'findBlocks', {filter: 'amethyst'});
  def('perceive.blocks.calcite', 'findBlocks', {filter: 'calcite'});
  def('perceive.blocks.dripstone', 'findBlocks', {filter: 'dripstone'});
  def('perceive.blocks.pointed_dripstone', 'findBlocks', {filter: 'pointed_dripstone'});
  def('perceive.blocks.spore_blossom', 'findBlocks', {filter: 'spore_blossom'});
  def('perceive.blocks.hanging_roots', 'findBlocks', {filter: 'hanging_roots'});
  def('perceive.blocks.rooted_dirt', 'findBlocks', {filter: 'rooted_dirt'});
  def('perceive.blocks.mud', 'findBlocks', {filter: 'mud'});
  def('perceive.blocks.mangrove', 'findBlocks', {filter: 'mangrove'});
  def('perceive.blocks.frogspawn', 'findBlocks', {filter: 'frogspawn'});
  def('perceive.blocks.sculk', 'findBlocks', {filter: 'sculk'});
  def('perceive.blocks.spawner', 'findBlocks', {filter: 'spawner'});
  def('perceive.blocks.end_portal', 'findBlocks', {filter: 'end_portal'});
  def('perceive.blocks.portal', 'findBlocks', {filter: 'portal'});
  def('perceive.blocks.conduit', 'findBlocks', {filter: 'conduit'});
  def('perceive.blocks.lodestone', 'findBlocks', {filter: 'lodestone'});
  def('perceive.blocks.respawn_anchor', 'findBlocks', {filter: 'respawn_anchor'});
  def('perceive.blocks.candle', 'findBlocks', {filter: 'candle'});
  def('perceive.blocks.chain', 'findBlocks', {filter: 'chain'});
  def('perceive.blocks.lantern', 'findBlocks', {filter: 'lantern'});

  // --- UTILITY MATH EXPANDED ---
  def('util.math.sum', 'utility', {utype: 'math', op: 'sum'});
  def('util.math.avg', 'utility', {utype: 'math', op: 'avg'});
  def('util.math.median', 'utility', {utype: 'math', op: 'median'});
  def('util.math.mod', 'utility', {utype: 'math', op: 'mod'});
  def('util.math.dist', 'utility', {utype: 'math', op: 'dist'});
  def('util.math.dist3d', 'utility', {utype: 'math', op: 'dist3d'});
  def('util.math.toRad', 'utility', {utype: 'math', op: 'toRad'});
  def('util.math.toDeg', 'utility', {utype: 'math', op: 'toDeg'});
  def('util.math.sin', 'utility', {utype: 'math', op: 'sin'});
  def('util.math.cos', 'utility', {utype: 'math', op: 'cos'});
  def('util.math.tan', 'utility', {utype: 'math', op: 'tan'});
  def('util.math.atan2', 'utility', {utype: 'math', op: 'atan2'});
  def('util.math.log', 'utility', {utype: 'math', op: 'log'});
  def('util.math.exp', 'utility', {utype: 'math', op: 'exp'});
  def('util.math.sign', 'utility', {utype: 'math', op: 'sign'});
  def('util.math.lerp', 'utility', {utype: 'math', op: 'lerp'});
  def('util.math.normalize', 'utility', {utype: 'math', op: 'normalize'});
  def('util.math.pi', 'utility', {utype: 'math', op: 'pi'});
  def('util.math.e', 'utility', {utype: 'math', op: 'e'});
  def('util.math.radians', 'utility', {utype: 'math', op: 'radians'});
  def('util.math.degrees', 'utility', {utype: 'math', op: 'degrees'});

  // --- UTILITY STRING EXPANDED ---
  def('util.string.padStart', 'utility', {utype: 'string', op: 'padStart'});
  def('util.string.padEnd', 'utility', {utype: 'string', op: 'padEnd'});
  def('util.string.repeat', 'utility', {utype: 'string', op: 'repeat'});
  def('util.string.replaceAll', 'utility', {utype: 'string', op: 'replaceAll'});
  def('util.string.join', 'utility', {utype: 'string', op: 'join'});
  def('util.string.indexOf', 'utility', {utype: 'string', op: 'indexOf'});
  def('util.string.includes', 'utility', {utype: 'string', op: 'includes'});
  def('util.string.startsWith', 'utility', {utype: 'string', op: 'startsWith'});
  def('util.string.endsWith', 'utility', {utype: 'string', op: 'endsWith'});
  def('util.string.substring', 'utility', {utype: 'string', op: 'substring'});
  def('util.string.charAt', 'utility', {utype: 'string', op: 'charAt'});
  def('util.string.charCodeAt', 'utility', {utype: 'string', op: 'charCodeAt'});
  def('util.string.parseFloat', 'utility', {utype: 'string', op: 'parseFloat'});
  def('util.string.parseInt', 'utility', {utype: 'string', op: 'parseInt'});
  def('util.string.format', 'utility', {utype: 'string', op: 'format'});

  // --- UTILITY JSON EXPANDED ---
  def('util.json.keys', 'utility', {utype: 'json', op: 'keys'});
  def('util.json.values', 'utility', {utype: 'json', op: 'values'});
  def('util.json.has', 'utility', {utype: 'json', op: 'has'});
  def('util.json.merge', 'utility', {utype: 'json', op: 'merge'});
  def('util.json.type', 'utility', {utype: 'json', op: 'type'});

  // --- UTILITY ARRAY EXPANDED ---
  def('util.array.push', 'utility', {utype: 'array', op: 'push'});
  def('util.array.pop', 'utility', {utype: 'array', op: 'pop'});
  def('util.array.shift', 'utility', {utype: 'array', op: 'shift'});
  def('util.array.unshift', 'utility', {utype: 'array', op: 'unshift'});
  def('util.array.includes', 'utility', {utype: 'array', op: 'includes'});
  def('util.array.indexOf', 'utility', {utype: 'array', op: 'indexOf'});
  def('util.array.join', 'utility', {utype: 'array', op: 'join'});
  def('util.array.concat', 'utility', {utype: 'array', op: 'concat'});
  def('util.array.sort', 'utility', {utype: 'array', op: 'sort'});
  def('util.array.reverse', 'utility', {utype: 'array', op: 'reverse'});
  def('util.array.every', 'utility', {utype: 'array', op: 'every'});
  def('util.array.some', 'utility', {utype: 'array', op: 'some'});

  // --- UTILITY RANDOM ---
  def('util.random.int', 'utility', {utype: 'random', op: 'int'});
  def('util.random.float', 'utility', {utype: 'random', op: 'float'});
  def('util.random.boolean', 'utility', {utype: 'random', op: 'boolean'});
  def('util.random.uuid', 'utility', {utype: 'random', op: 'uuid'});
  def('util.random.string', 'utility', {utype: 'random', op: 'string'});
  def('util.random.shuffle', 'utility', {utype: 'random', op: 'shuffle'});
  def('util.random.choice', 'utility', {utype: 'random', op: 'choice'});

  // --- UTILITY MISC ---
  def('util.base64.encode', 'utility', {utype: 'base64', op: 'encode'});
  def('util.base64.decode', 'utility', {utype: 'base64', op: 'decode'});
  def('util.time.now', 'utility', {utype: 'time', op: 'now'});
  def('util.time.ms', 'utility', {utype: 'time', op: 'ms'});
  def('util.time.format', 'utility', {utype: 'time', op: 'format'});
  def('util.time.sleep', 'utility', {utype: 'time', op: 'sleep'});
  def('util.compare.eq', 'utility', {utype: 'compare', op: 'eq'});
  def('util.compare.neq', 'utility', {utype: 'compare', op: 'neq'});
  def('util.compare.gt', 'utility', {utype: 'compare', op: 'gt'});
  def('util.compare.gte', 'utility', {utype: 'compare', op: 'gte'});
  def('util.compare.lt', 'utility', {utype: 'compare', op: 'lt'});
  def('util.compare.lte', 'utility', {utype: 'compare', op: 'lte'});
  def('util.type', 'utility', {utype: 'type', op: 'type'});
  def('util.clone', 'utility', {utype: 'clone', op: 'clone'});

  // --- MORE PERCEIVE BLOCKS (continued) ---
  def('perceive.blocks.bricks', 'findBlocks', {filter: 'bricks'});
  def('perceive.blocks.obsidian', 'findBlocks', {filter: 'obsidian'});
  def('perceive.blocks.cobblestone', 'findBlocks', {filter: 'cobblestone'});
  def('perceive.blocks.gravel', 'findBlocks', {filter: 'gravel'});
  def('perceive.blocks.sand', 'findBlocks', {filter: 'sand'});
  def('perceive.blocks.red_sand', 'findBlocks', {filter: 'red_sand'});
  def('perceive.blocks.clay', 'findBlocks', {filter: 'clay'});
  def('perceive.blocks.dirt', 'findBlocks', {filter: 'dirt'});
  def('perceive.blocks.grass', 'findBlocks', {filter: 'grass_block'});
  def('perceive.blocks.stone', 'findBlocks', {filter: 'stone'});
  def('perceive.blocks.deepslate', 'findBlocks', {filter: 'deepslate'});
  def('perceive.blocks.netherrack', 'findBlocks', {filter: 'netherrack'});
  def('perceive.blocks.end_stone', 'findBlocks', {filter: 'end_stone'});
  def('perceive.blocks.glass', 'findBlocks', {filter: 'glass'});
  def('perceive.blocks.stained_glass', 'findBlocks', {filter: 'stained_glass'});
  def('perceive.blocks.wool', 'findBlocks', {filter: 'wool'});
  def('perceive.blocks.carpet', 'findBlocks', {filter: 'carpet'});
  def('perceive.blocks.concrete', 'findBlocks', {filter: 'concrete'});
  def('perceive.blocks.terracotta', 'findBlocks', {filter: 'terracotta'});
  def('perceive.blocks.glazed_terracotta', 'findBlocks', {filter: 'glazed_terracotta'});
  def('perceive.blocks.prismarine', 'findBlocks', {filter: 'prismarine'});
  def('perceive.blocks.quartz', 'findBlocks', {filter: 'quartz_block'});
  def('perceive.blocks.nether_bricks', 'findBlocks', {filter: 'nether_bricks'});
  def('perceive.blocks.red_nether_bricks', 'findBlocks', {filter: 'red_nether_bricks'});
  def('perceive.blocks.polished', 'findBlocks', {filter: 'polished'});
  def('perceive.blocks.smooth', 'findBlocks', {filter: 'smooth'});
  def('perceive.blocks.cut', 'findBlocks', {filter: 'cut'});
  def('perceive.blocks.pillar', 'findBlocks', {filter: 'pillar'});
  def('perceive.blocks.chiseled', 'findBlocks', {filter: 'chiseled'});
  def('perceive.blocks.cracked', 'findBlocks', {filter: 'cracked'});
  def('perceive.blocks.mossy', 'findBlocks', {filter: 'mossy'});
  def('perceive.blocks.infested', 'findBlocks', {filter: 'infested'});
  def('perceive.blocks.slab', 'findBlocks', {filter: 'slab'});
  def('perceive.blocks.stairs', 'findBlocks', {filter: 'stairs'});
  def('perceive.blocks.wall', 'findBlocks', {filter: 'wall'});
  def('perceive.blocks.fence', 'findBlocks', {filter: 'fence'});
  def('perceive.blocks.glass_pane', 'findBlocks', {filter: 'glass_pane'});
  def('perceive.blocks.iron_bars', 'findBlocks', {filter: 'iron_bars'});
  def('perceive.blocks.chain', 'findBlocks', {filter: 'chain'});
  def('perceive.blocks.cobweb', 'findBlocks', {filter: 'cobweb'});
  def('perceive.blocks.snow', 'findBlocks', {filter: 'snow'});
  def('perceive.blocks.ice', 'findBlocks', {filter: 'ice'});
  def('perceive.blocks.packed_ice', 'findBlocks', {filter: 'packed_ice'});
  def('perceive.blocks.blue_ice', 'findBlocks', {filter: 'blue_ice'});
  def('perceive.blocks.powder_snow', 'findBlocks', {filter: 'powder_snow'});
  def('perceive.blocks.soul_sand', 'findBlocks', {filter: 'soul_sand'});
  def('perceive.blocks.soul_soil', 'findBlocks', {filter: 'soul_soil'});
  def('perceive.blocks.basalt', 'findBlocks', {filter: 'basalt'});
  def('perceive.blocks.blackstone', 'findBlocks', {filter: 'blackstone'});
  def('perceive.blocks.gilded_blackstone', 'findBlocks', {filter: 'gilded_blackstone'});
  def('perceive.blocks.shroomlight', 'findBlocks', {filter: 'shroomlight'});
  def('perceive.blocks.glowstone', 'findBlocks', {filter: 'glowstone'});
  def('perceive.blocks.sea_lantern', 'findBlocks', {filter: 'sea_lantern'});
  def('perceive.blocks.redstone_lamp', 'findBlocks', {filter: 'redstone_lamp'});
  def('perceive.blocks.jack_o_lantern', 'findBlocks', {filter: 'jack_o_lantern'});
  def('perceive.blocks.crying_obsidian', 'findBlocks', {filter: 'crying_obsidian'});
  def('perceive.blocks.end_portal_frame', 'findBlocks', {filter: 'end_portal_frame'});
  def('perceive.blocks.dragon_egg', 'findBlocks', {filter: 'dragon_egg'});
  def('perceive.blocks.end_rod', 'findBlocks', {filter: 'end_rod'});
  def('perceive.blocks.ender_chest', 'findBlocks', {filter: 'ender_chest'});
  def('perceive.blocks.enchanting_table', 'findBlocks', {filter: 'enchanting_table'});
  def('perceive.blocks.anvil', 'findBlocks', {filter: 'anvil'});
  def('perceive.blocks.chipped_anvil', 'findBlocks', {filter: 'chipped_anvil'});
  def('perceive.blocks.damaged_anvil', 'findBlocks', {filter: 'damaged_anvil'});
  def('perceive.blocks.grindstone', 'findBlocks', {filter: 'grindstone'});
  def('perceive.blocks.stonecutter', 'findBlocks', {filter: 'stonecutter'});
  def('perceive.blocks.loom', 'findBlocks', {filter: 'loom'});
  def('perceive.blocks.cartography_table', 'findBlocks', {filter: 'cartography_table'});
  def('perceive.blocks.smithing_table', 'findBlocks', {filter: 'smithing_table'});
  def('perceive.blocks.barrel', 'findBlocks', {filter: 'barrel'});
  def('perceive.blocks.trapped_chest', 'findBlocks', {filter: 'trapped_chest'});
  def('perceive.blocks.hopper', 'findBlocks', {filter: 'hopper'});
  def('perceive.blocks.dispenser', 'findBlocks', {filter: 'dispenser'});
  def('perceive.blocks.dropper', 'findBlocks', {filter: 'dropper'});
  def('perceive.blocks.observer', 'findBlocks', {filter: 'observer'});
  def('perceive.blocks.piston', 'findBlocks', {filter: 'piston'});
  def('perceive.blocks.sticky_piston', 'findBlocks', {filter: 'sticky_piston'});
  def('perceive.blocks.redstone_wire', 'findBlocks', {filter: 'redstone_wire'});
  def('perceive.blocks.redstone_torch', 'findBlocks', {filter: 'redstone_torch'});
  def('perceive.blocks.repeater', 'findBlocks', {filter: 'repeater'});
  def('perceive.blocks.comparator', 'findBlocks', {filter: 'comparator'});
  def('perceive.blocks.daylight_detector', 'findBlocks', {filter: 'daylight_detector'});
  def('perceive.blocks.tripwire_hook', 'findBlocks', {filter: 'tripwire_hook'});
  def('perceive.blocks.tnt', 'findBlocks', {filter: 'tnt'});
  def('perceive.blocks.slime_block', 'findBlocks', {filter: 'slime_block'});
  def('perceive.blocks.honey_block', 'findBlocks', {filter: 'honey_block'});
  def('perceive.blocks.scaffolding', 'findBlocks', {filter: 'scaffolding'});
  def('perceive.blocks.cocoa', 'findBlocks', {filter: 'cocoa'});
  def('perceive.blocks.lily_pad', 'findBlocks', {filter: 'lily_pad'});
  def('perceive.blocks.sea_pickle', 'findBlocks', {filter: 'sea_pickle'});
  def('perceive.blocks.turtle_egg', 'findBlocks', {filter: 'turtle_egg'});
  def('perceive.blocks.sniffer_egg', 'findBlocks', {filter: 'sniffer_egg'});
  def('perceive.blocks.suspicious_sand', 'findBlocks', {filter: 'suspicious_sand'});
  def('perceive.blocks.suspicious_gravel', 'findBlocks', {filter: 'suspicious_gravel'});
  def('perceive.blocks.brushable_block', 'findBlocks', {filter: 'brushable_block'});
  def('perceive.blocks.decorated_pot', 'findBlocks', {filter: 'decorated_pot'});
  def('perceive.blocks.sherd', 'findBlocks', {filter: 'sherd'});
  def('perceive.blocks.sculk_sensor', 'findBlocks', {filter: 'sculk_sensor'});
  def('perceive.blocks.sculk_catalyst', 'findBlocks', {filter: 'sculk_catalyst'});
  def('perceive.blocks.sculk_shrieker', 'findBlocks', {filter: 'sculk_shrieker'});
  def('perceive.blocks.sculk_vein', 'findBlocks', {filter: 'sculk_vein'});
  def('perceive.blocks.lightning_rod', 'findBlocks', {filter: 'lightning_rod'});
  def('perceive.blocks.dripstone_block', 'findBlocks', {filter: 'dripstone_block'});
  def('perceive.blocks.pointed_dripstone', 'findBlocks', {filter: 'pointed_dripstone'});
  def('perceive.blocks.hangable', 'findBlocks', {filter: 'hangable'});

  // --- MORE ENTITY TYPES ---
  def('perceive.entity.zombie', 'findEntities', {filter: 'zombie'});
  def('perceive.entity.skeleton', 'findEntities', {filter: 'skeleton'});
  def('perceive.entity.creeper', 'findEntities', {filter: 'creeper'});
  def('perceive.entity.spider', 'findEntities', {filter: 'spider'});
  def('perceive.entity.enderman', 'findEntities', {filter: 'enderman'});
  def('perceive.entity.witch', 'findEntities', {filter: 'witch'});
  def('perceive.entity.piglin', 'findEntities', {filter: 'piglin'});
  def('perceive.entity.blaze', 'findEntities', {filter: 'blaze'});
  def('perceive.entity.ghast', 'findEntities', {filter: 'ghast'});
  def('perceive.entity.slime', 'findEntities', {filter: 'slime'});
  def('perceive.entity.phantom', 'findEntities', {filter: 'phantom'});
  def('perceive.entity.wither', 'findEntities', {filter: 'wither'});
  def('perceive.entity.ender_dragon', 'findEntities', {filter: 'ender_dragon'});
  def('perceive.entity.guardian', 'findEntities', {filter: 'guardian'});
  def('perceive.entity.pillager', 'findEntities', {filter: 'pillager'});
  def('perceive.entity.vindicator', 'findEntities', {filter: 'vindicator'});
  def('perceive.entity.evoker', 'findEntities', {filter: 'evoker'});
  def('perceive.entity.cow', 'findEntities', {filter: 'cow'});
  def('perceive.entity.pig', 'findEntities', {filter: 'pig'});
  def('perceive.entity.sheep', 'findEntities', {filter: 'sheep'});
  def('perceive.entity.chicken', 'findEntities', {filter: 'chicken'});
  def('perceive.entity.horse', 'findEntities', {filter: 'horse'});
  def('perceive.entity.wolf', 'findEntities', {filter: 'wolf'});
  def('perceive.entity.cat', 'findEntities', {filter: 'cat'});
  def('perceive.entity.ocelot', 'findEntities', {filter: 'ocelot'});
  def('perceive.entity.rabbit', 'findEntities', {filter: 'rabbit'});
  def('perceive.entity.bat', 'findEntities', {filter: 'bat'});
  def('perceive.entity.parrot', 'findEntities', {filter: 'parrot'});
  def('perceive.entity.turtle', 'findEntities', {filter: 'turtle'});
  def('perceive.entity.frog', 'findEntities', {filter: 'frog'});
  def('perceive.entity.allay', 'findEntities', {filter: 'allay'});
  def('perceive.entity.axolotl', 'findEntities', {filter: 'axolotl'});
  def('perceive.entity.glow_squid', 'findEntities', {filter: 'glow_squid'});
  def('perceive.entity.dolphin', 'findEntities', {filter: 'dolphin'});
  def('perceive.entity.fish', 'findEntities', {filter: 'fish'});
  def('perceive.entity.iron_golem', 'findEntities', {filter: 'iron_golem'});
  def('perceive.entity.snow_golem', 'findEntities', {filter: 'snow_golem'});
  def('perceive.entity.villager', 'findEntities', {filter: 'villager'});

  // --- MORE NAV ---
  def('nav.wander', 'nav', {type: 'wander'});
  def('nav.fall', 'nav', {type: 'fall'});
  def('nav.sneak', 'nav', {type: 'sneak'});
  def('nav.sprint', 'nav', {type: 'sprint'});
  def('nav.lookAt', 'nav', {type: 'lookAt'});
  def('nav.facing', 'nav', {type: 'facing'});
  def('nav.stop', 'nav', {type: 'stop'});

  // --- MORE PLAYER QUERIES ---
  def('player.name', 'playerQuery', {type: 'name'});
  def('player.uuid', 'playerQuery', {type: 'uuid'});
  def('player.experienceLevel', 'playerQuery', {type: 'experienceLevel'});
  def('player.totalExperience', 'playerQuery', {type: 'totalExperience'});
  def('player.experienceProgress', 'playerQuery', {type: 'experienceProgress'});
  def('player.isCreative', 'playerQuery', {type: 'isCreative'});
  def('player.isSpectator', 'playerQuery', {type: 'isSpectator'});
  def('player.isSurvival', 'playerQuery', {type: 'isSurvival'});
  def('player.isDead', 'playerQuery', {type: 'isDead'});
  def('player.isAlive', 'playerQuery', {type: 'isAlive'});
  def('player.isOnFire', 'playerQuery', {type: 'isOnFire'});
  def('player.isSubmergedInWater', 'playerQuery', {type: 'isSubmergedInWater'});
  def('player.isSubmergedIn', 'playerQuery', {type: 'isSubmergedIn'});
  def('player.isTouchingWater', 'playerQuery', {type: 'isTouchingWater'});
  def('player.isTouchingLava', 'playerQuery', {type: 'isTouchingLava'});
  def('player.getBlockX', 'playerQuery', {type: 'getBlockX'});
  def('player.getBlockY', 'playerQuery', {type: 'getBlockY'});
  def('player.getBlockZ', 'playerQuery', {type: 'getBlockZ'});
  def('player.getX', 'playerQuery', {type: 'getX'});
  def('player.getY', 'playerQuery', {type: 'getY'});
  def('player.getZ', 'playerQuery', {type: 'getZ'});
  def('player.getEyeY', 'playerQuery', {type: 'getEyeY'});
  def('player.getMovementSpeed', 'playerQuery', {type: 'getMovementSpeed'});
  def('player.getLuck', 'playerQuery', {type: 'getLuck'});
  def('player.getAttackCooldownProgress', 'playerQuery', {type: 'getAttackCooldownProgress'});
  def('player.getUuid', 'playerQuery', {type: 'getUuid'});
  def('player.getName', 'playerQuery', {type: 'getName'});
  def('player.isCreative', 'playerQuery', {type: 'isCreative'});
  def('player.isSpectator', 'playerQuery', {type: 'isSpectator'});
  def('player.isFallFlying', 'playerQuery', {type: 'isFallFlying'});
  def('player.isSwimming', 'playerQuery', {type: 'isSwimming'});
  def('player.isClimbing', 'playerQuery', {type: 'isClimbing'});
  def('player.hasEffect', 'playerQuery', {type: 'hasEffect'});
  def('player.getTeamColor', 'playerQuery', {type: 'getTeamColor'});
  def('player.isBlockBreakingAllowed', 'playerQuery', {type: 'isBlockBreakingAllowed'});
  def('player.hasCollision', 'playerQuery', {type: 'hasCollision'});
  def('player.isPushable', 'playerQuery', {type: 'isPushable'});
  def('player.isRemoved', 'playerQuery', {type: 'isRemoved'});
  def('player.isAddedToWorld', 'playerQuery', {type: 'isAddedToWorld'});
  def('player.getCommandTags', 'playerQuery', {type: 'getCommandTags'});
  def('player.getCommandTagsSize', 'playerQuery', {type: 'getCommandTagsSize'});
  def('player.isGlowing', 'playerQuery', {type: 'isGlowing'});
  def('player.isInvisible', 'playerQuery', {type: 'isInvisible'});
  def('player.isInvulnerable', 'playerQuery', {type: 'isInvulnerable'});
  def('player.isSilent', 'playerQuery', {type: 'isSilent'});
  def('player.hasNoGravity', 'playerQuery', {type: 'hasNoGravity'});
  def('player.getAirSpeed', 'playerQuery', {type: 'getAirSpeed'});
  def('player.getPreferredArmorslot', 'playerQuery', {type: 'getPreferredArmorslot'});
  def('player.getPreferredOffHandSlot', 'playerQuery', {type: 'getPreferredOffHandSlot'});
  def('player.canUseRiding', 'playerQuery', {type: 'canUseRiding'});
  def('player.getPose', 'playerQuery', {type: 'getPose'});
  def('player.isSleepingLongEnough', 'playerQuery', {type: 'isSleepingLongEnough'});
  def('player.isBlocking', 'playerQuery', {type: 'isBlocking'});

  // --- MORE WORLD QUERIES ---
  def('world.getTimeOfDay', 'worldQuery', {type: 'getTimeOfDay'});
  def('world.getTime', 'worldQuery', {type: 'getTime'});
  def('world.isDay', 'worldQuery', {type: 'isDay'});
  def('world.isNight', 'worldQuery', {type: 'isNight'});
  def('world.getMoonPhase', 'worldQuery', {type: 'getMoonPhase'});
  def('world.getAmbientDarkness', 'worldQuery', {type: 'getAmbientDarkness'});
  def('world.isRaining', 'worldQuery', {type: 'isRaining'});
  def('world.isThundering', 'worldQuery', {type: 'isThundering'});
  def('world.getSeaLevel', 'worldQuery', {type: 'getSeaLevel'});
  def('world.getRegistryKey', 'worldQuery', {type: 'getRegistryKey'});
  def('world.getDimensionEntry', 'worldQuery', {type: 'getDimensionEntry'});
  def('world.getChunkManager', 'worldQuery', {type: 'getChunkManager'});
  def('world.getChunkCount', 'worldQuery', {type: 'getChunkCount'});
  def('world.getLoadedChunks', 'worldQuery', {type: 'getLoadedChunks'});
  def('world.getDifficulty', 'worldQuery', {type: 'getDifficulty'});
  def('world.getGameRules', 'worldQuery', {type: 'getGameRules'});
  def('world.getGameRule', 'worldQuery', {type: 'getGameRule'});
  def('world.getLevelProperties', 'worldQuery', {type: 'getLevelProperties'});
  def('world.getFluidState', 'worldQuery', {type: 'getFluidState'});
  def('world.getDifficulty', 'worldQuery', {type: 'getDifficulty'});
  def('world.isClient', 'worldQuery', {type: 'isClient'});
  def('world.isDebugWorld', 'worldQuery', {type: 'isDebugWorld'});
  def('world.isHardcore', 'worldQuery', {type: 'isHardcore'});
  def('world.canPlayerModifyAt', 'worldQuery', {type: 'canPlayerModifyAt'});
  def('world.isInBuildLimit', 'worldQuery', {type: 'isInBuildLimit'});
  def('world.isChunkLoaded', 'worldQuery', {type: 'isChunkLoaded'});
  def('world.getLightingProvider', 'worldQuery', {type: 'getLightingProvider'});
  def('world.getBrightness', 'worldQuery', {type: 'getBrightness'});
  def('world.isNightTime', 'worldQuery', {type: 'isNightTime'});
  def('world.isDayTime', 'worldQuery', {type: 'isDayTime'});
  def('world.getReceivedRedstonePower', 'worldQuery', {type: 'getReceivedRedstonePower'});
  def('world.getEmittedRedstonePower', 'worldQuery', {type: 'getEmittedRedstonePower'});
  def('world.isReceivingRedstonePower', 'worldQuery', {type: 'isReceivingRedstonePower'});
  def('world.getLuminance', 'worldQuery', {type: 'getLuminance'});
  def('world.getTopY', 'worldQuery', {type: 'getTopY'});
  def('world.getBottomY', 'worldQuery', {type: 'getBottomY'});
  def('world.getHeight', 'worldQuery', {type: 'getHeight'});
  def('world.isSurfaceBlock', 'worldQuery', {type: 'isSurfaceBlock'});
  def('world.isAir', 'worldQuery', {type: 'isAir'});
  def('world.isWater', 'worldQuery', {type: 'isWater'});
  def('world.isLava', 'worldQuery', {type: 'isLava'});
  def('world.isSolidBlock', 'worldQuery', {type: 'isSolidBlock'});
  def('world.isOpaqueFullCube', 'worldQuery', {type: 'isOpaqueFullCube'});
  def('world.isOutOfHeightLimit', 'worldQuery', {type: 'isOutOfHeightLimit'});
  def('world.getFluidHeight', 'worldQuery', {type: 'getFluidHeight'});
  def('world.getFluidHeightIgnoreWalls', 'worldQuery', {type: 'getFluidHeightIgnoreWalls'});
  def('world.isHumidAt', 'worldQuery', {type: 'isHumidAt'});
  def('world.isDryAt', 'worldQuery', {type: 'isDryAt'});
  def('world.isColdAt', 'worldQuery', {type: 'isColdAt'});
  def('world.isWarmAt', 'worldQuery', {type: 'isWarmAt'});
  def('world.getTemperature', 'worldQuery', {type: 'getTemperature'});
  def('world.getHumidity', 'worldQuery', {type: 'getHumidity'});

  // --- MORE ITEM DETAILS ---
  def('item.repairCost', 'itemDetail', {detail: 'repairCost'});
  def('item.isEnchantable', 'itemDetail', {detail: 'isEnchantable'});
  def('item.isDamageable', 'itemDetail', {detail: 'isDamageable'});
  def('item.isFood', 'itemDetail', {detail: 'isFood'});
  def('item.isBookEnchantable', 'itemDetail', {detail: 'isBookEnchantable'});
  def('item.isSuitableFor', 'itemDetail', {detail: 'isSuitableFor'});
  def('item.getMiningSpeedMultiplier', 'itemDetail', {detail: 'getMiningSpeedMultiplier'});
  def('item.getAttackDamage', 'itemDetail', {detail: 'getAttackDamage'});
  def('item.getAttackSpeed', 'itemDetail', {detail: 'getAttackSpeed'});
  def('item.getAttackKnockback', 'itemDetail', {detail: 'getAttackKnockback'});
  def('item.getArmor', 'itemDetail', {detail: 'getArmor'});
  def('item.getToughness', 'itemDetail', {detail: 'getToughness'});
  def('item.getEnchantability', 'itemDetail', {detail: 'getEnchantability'});
  def('item.getDurability', 'itemDetail', {detail: 'getDurability'});
  def('item.getMaxCount', 'itemDetail', {detail: 'getMaxCount'});
  def('item.getRarity', 'itemDetail', {detail: 'getRarity'});
  def('item.getTranslationKey', 'itemDetail', {detail: 'getTranslationKey'});
  def('item.getRegistryName', 'itemDetail', {detail: 'getRegistryName'});
  def('item.getDisplayName', 'itemDetail', {detail: 'getDisplayName'});
  def('item.getTooltip', 'itemDetail', {detail: 'getTooltip'});
  def('item.isStackable', 'itemDetail', {detail: 'isStackable'});
  def('item.isRecipeRemainder', 'itemDetail', {detail: 'isRecipeRemainder'});
  def('item.isDamageable', 'itemDetail', {detail: 'isDamageable'});
  def('item.getRecipeRemainder', 'itemDetail', {detail: 'getRecipeRemainder'});
  def('item.getSubItems', 'itemDetail', {detail: 'getSubItems'});
  def('item.getGroup', 'itemDetail', {detail: 'getGroup'});
  def('item.getCreativeTab', 'itemDetail', {detail: 'getCreativeTab'});
  def('item.getBurnTime', 'itemDetail', {detail: 'getBurnTime'});
  def('item.isFuel', 'itemDetail', {detail: 'isFuel'});
  def('item.getWeaponConfig', 'itemDetail', {detail: 'getWeaponConfig'});
  def('item.isSuitableFor', 'itemDetail', {detail: 'isSuitableFor'});
  def('item.getDefaultState', 'itemDetail', {detail: 'getDefaultState'});

  // --- MORE CONTAINER ACTIONS ---
  def('container.extract', 'containerAction', {action: 'extract'});
  def('container.insert', 'containerAction', {action: 'insert'});
  def('container.transfer', 'containerAction', {action: 'transfer'});
  def('container.swap', 'containerAction', {action: 'swap'});
  def('container.clear', 'containerAction', {action: 'clear'});
  def('container.getStacks', 'containerAction', {action: 'getStacks'});
  def('container.isEmpty', 'containerAction', {action: 'isEmpty'});
  def('container.size', 'containerAction', {action: 'size'});
  def('container.canUse', 'containerAction', {action: 'canUse'});
  def('container.markDirty', 'containerAction', {action: 'markDirty'});

  // --- MORE SCREEN ACTIONS ---
  def('screen.closeAll', 'screenAction', {action: 'closeAll'});
  def('screen.getTitle', 'screenAction', {action: 'getTitle'});
  def('screen.getType', 'screenAction', {action: 'getType'});
  def('screen.isOpen', 'screenAction', {action: 'isOpen'});
  def('screen.getCursorStack', 'screenAction', {action: 'getCursorStack'});
  def('screen.setCursorStack', 'screenAction', {action: 'setCursorStack'});
  def('screen.getSlotCount', 'screenAction', {action: 'getSlotCount'});
  def('screen.getSlot', 'screenAction', {action: 'getSlot'});
  def('screen.quickMove', 'screenAction', {action: 'quickMove'});
  def('screen.throwItem', 'screenAction', {action: 'throwItem'});

  // --- MORE BLOCK ACTIONS ---
  def('block.break', 'blockAction', {action: 'break'});
  def('block.place', 'blockAction', {action: 'place'});
  def('block.getWeakPower', 'blockAction', {action: 'getWeakPower'});
  def('block.getStrongPower', 'blockAction', {action: 'getStrongPower'});
  def('block.isPowered', 'blockAction', {action: 'isPowered'});
  def('block.getState', 'blockAction', {action: 'getState'});
  def('block.setBlockState', 'blockAction', {action: 'setBlockState'});
  def('block.getFluidState', 'blockAction', {action: 'getFluidState'});
  def('block.getCollisionShape', 'blockAction', {action: 'getCollisionShape'});
  def('block.getOutlineShape', 'blockAction', {action: 'getOutlineShape'});
  def('block.getBlastResistance', 'blockAction', {action: 'getBlastResistance'});
  def('block.getEmittedRedstonePower', 'blockAction', {action: 'getEmittedRedstonePower'});
  def('block.getReceivedRedstonePower', 'blockAction', {action: 'getReceivedRedstonePower'});
  def('block.isSolidBlock', 'blockAction', {action: 'isSolidBlock'});
  def('block.hasComparatorOutput', 'blockAction', {action: 'hasComparatorOutput'});
  def('block.getComparatorOutput', 'blockAction', {action: 'getComparatorOutput'});

  // --- MORE UTILITY ---
  def('util.math.clamp', 'utility', {utype: 'math', op: 'clamp'});
  def('util.math.random', 'utility', {utype: 'math', op: 'random'});
  def('util.math.randomInt', 'utility', {utype: 'math', op: 'randomInt'});
  def('util.string.isEmpty', 'utility', {utype: 'string', op: 'isEmpty'});
  def('util.string.isNotBlank', 'utility', {utype: 'string', op: 'isNotBlank'});
  def('util.string.reverse', 'utility', {utype: 'string', op: 'reverse'});
  def('util.string.count', 'utility', {utype: 'string', op: 'count'});
  def('util.string.slice', 'utility', {utype: 'string', op: 'slice'});
  def('util.string.match', 'utility', {utype: 'string', op: 'match'});
  def('util.string.test', 'utility', {utype: 'string', op: 'test'});
  def('util.string.fromCharCode', 'utility', {utype: 'string', op: 'fromCharCode'});
  def('util.string.trimStart', 'utility', {utype: 'string', op: 'trimStart'});
  def('util.string.trimEnd', 'utility', {utype: 'string', op: 'trimEnd'});
  def('util.string.normalize', 'utility', {utype: 'string', op: 'normalize'});
  def('util.string.at', 'utility', {utype: 'string', op: 'at'});
  def('util.json.parseOrNull', 'utility', {utype: 'json', op: 'parseOrNull'});
  def('util.json.isEmpty', 'utility', {utype: 'json', op: 'isEmpty'});
  def('util.json.size', 'utility', {utype: 'json', op: 'size'});
  def('util.json.flatten', 'utility', {utype: 'json', op: 'flatten'});
  def('util.json.clone', 'utility', {utype: 'json', op: 'clone'});
  def('util.json.diff', 'utility', {utype: 'json', op: 'diff'});
  def('util.json.pick', 'utility', {utype: 'json', op: 'pick'});
  def('util.json.omit', 'utility', {utype: 'json', op: 'omit'});
  def('util.json.isEmpty', 'utility', {utype: 'json', op: 'isEmpty'});
  def('util.json.size', 'utility', {utype: 'json', op: 'size'});
  def('util.json.entries', 'utility', {utype: 'json', op: 'entries'});
  def('util.json.fromEntries', 'utility', {utype: 'json', op: 'fromEntries'});
  def('util.json.mapValues', 'utility', {utype: 'json', op: 'mapValues'});
  def('util.json.mapKeys', 'utility', {utype: 'json', op: 'mapKeys'});
  def('util.json.filter', 'utility', {utype: 'json', op: 'filter'});
  def('util.json.isArray', 'utility', {utype: 'json', op: 'isArray'});
  def('util.json.isNull', 'utility', {utype: 'json', op: 'isNull'});
  def('util.json.isUndefined', 'utility', {utype: 'json', op: 'isUndefined'});
  def('util.json.isBoolean', 'utility', {utype: 'json', op: 'isBoolean'});
  def('util.json.isNumber', 'utility', {utype: 'json', op: 'isNumber'});
  def('util.json.isString', 'utility', {utype: 'json', op: 'isString'});
  def('util.json.isObject', 'utility', {utype: 'json', op: 'isObject'});
  def('util.json.isEmpty', 'utility', {utype: 'json', op: 'isEmpty'});
  def('util.json.size', 'utility', {utype: 'json', op: 'size'});
  def('util.json.entries', 'utility', {utype: 'json', op: 'entries'});
  def('util.json.fromEntries', 'utility', {utype: 'json', op: 'fromEntries'});
  def('util.json.mapValues', 'utility', {utype: 'json', op: 'mapValues'});
  def('util.json.mapKeys', 'utility', {utype: 'json', op: 'mapKeys'});
  def('util.json.filter', 'utility', {utype: 'json', op: 'filter'});
  def('util.json.isArray', 'utility', {utype: 'json', op: 'isArray'});
  def('util.json.isNull', 'utility', {utype: 'json', op: 'isNull'});
  def('util.json.isUndefined', 'utility', {utype: 'json', op: 'isUndefined'});
  def('util.json.isBoolean', 'utility', {utype: 'json', op: 'isBoolean'});
  def('util.json.isNumber', 'utility', {utype: 'json', op: 'isNumber'});
  def('util.json.isString', 'utility', {utype: 'json', op: 'isString'});
  def('util.json.isObject', 'utility', {utype: 'json', op: 'isObject'});
  def('util.json.stringifyPretty', 'utility', {utype: 'json', op: 'stringifyPretty'});
  def('util.json.parseOrNull', 'utility', {utype: 'json', op: 'parseOrNull'});
  def('util.json.isEmpty', 'utility', {utype: 'json', op: 'isEmpty'});
  def('util.json.size', 'utility', {utype: 'json', op: 'size'});
  def('util.json.entries', 'utility', {utype: 'json', op: 'entries'});
  def('util.json.fromEntries', 'utility', {utype: 'json', op: 'fromEntries'});
  def('util.json.mapValues', 'utility', {utype: 'json', op: 'mapValues'});
  def('util.json.mapKeys', 'utility', {utype: 'json', op: 'mapKeys'});
  def('util.json.filter', 'utility', {utype: 'json', op: 'filter'});
  def('util.json.isArray', 'utility', {utype: 'json', op: 'isArray'});
  def('util.json.isNull', 'utility', {utype: 'json', op: 'isNull'});
  def('util.json.isUndefined', 'utility', {utype: 'json', op: 'isUndefined'});
  def('util.json.isBoolean', 'utility', {utype: 'json', op: 'isBoolean'});
  def('util.json.isNumber', 'utility', {utype: 'json', op: 'isNumber'});
  def('util.json.isString', 'utility', {utype: 'json', op: 'isString'});
  def('util.json.isObject', 'utility', {utype: 'json', op: 'isObject'});
  def('util.json.stringifyPretty', 'utility', {utype: 'json', op: 'stringifyPretty'});

  // --- MORE COMPARISONS ---
  def('util.compare.eq', 'utility', {utype: 'compare', op: 'eq'});
  def('util.compare.neq', 'utility', {utype: 'compare', op: 'neq'});
  def('util.compare.gt', 'utility', {utype: 'compare', op: 'gt'});
  def('util.compare.gte', 'utility', {utype: 'compare', op: 'gte'});
  def('util.compare.lt', 'utility', {utype: 'compare', op: 'lt'});
  def('util.compare.lte', 'utility', {utype: 'compare', op: 'lte'});
  def('util.compare.identity', 'utility', {utype: 'compare', op: 'identity'});
  def('util.compare.deep', 'utility', {utype: 'compare', op: 'deep'});

  // --- MORE RANDOM ---
  def('util.random.int', 'utility', {utype: 'random', op: 'int'});
  def('util.random.float', 'utility', {utype: 'random', op: 'float'});
  def('util.random.boolean', 'utility', {utype: 'random', op: 'boolean'});
  def('util.random.uuid', 'utility', {utype: 'random', op: 'uuid'});
  def('util.random.string', 'utility', {utype: 'random', op: 'string'});
  def('util.random.shuffle', 'utility', {utype: 'random', op: 'shuffle'});
  def('util.random.choice', 'utility', {utype: 'random', op: 'choice'});
  def('util.random.weightedChoice', 'utility', {utype: 'random', op: 'weightedChoice'});
  def('util.random.gaussian', 'utility', {utype: 'random', op: 'gaussian'});
  def('util.random.range', 'utility', {utype: 'random', op: 'range'});
  def('util.random.pickN', 'utility', {utype: 'random', op: 'pickN'});
  def('util.random.coinFlip', 'utility', {utype: 'random', op: 'coinFlip'});
  def('util.random.dice', 'utility', {utype: 'random', op: 'dice'});

  def('util.time.unix', 'utility', {utype: 'time', op: 'unix'});
  def('util.time.utc', 'utility', {utype: 'time', op: 'utc'});
  def('util.time.local', 'utility', {utype: 'time', op: 'local'});
  def('util.time.hours', 'utility', {utype: 'time', op: 'hours'});
  def('util.time.minutes', 'utility', {utype: 'time', op: 'minutes'});
  def('util.time.seconds', 'utility', {utype: 'time', op: 'seconds'});
  def('util.time.millis', 'utility', {utype: 'time', op: 'millis'});
  def('util.time.daysSince', 'utility', {utype: 'time', op: 'daysSince'});
  def('util.time.isLeapYear', 'utility', {utype: 'time', op: 'isLeapYear'});
  def('util.time.daysInMonth', 'utility', {utype: 'time', op: 'daysInMonth'});
  def('util.time.dayOfWeek', 'utility', {utype: 'time', op: 'dayOfWeek'});
  def('util.time.weekNumber', 'utility', {utype: 'time', op: 'weekNumber'});
  def('util.time.monthName', 'utility', {utype: 'time', op: 'monthName'});
  def('util.time.dayName', 'utility', {utype: 'time', op: 'dayName'});
  def('util.time.toUTC', 'utility', {utype: 'time', op: 'toUTC'});
  def('util.time.toLocal', 'utility', {utype: 'time', op: 'toLocal'});
  def('util.time.add', 'utility', {utype: 'time', op: 'add'});
  def('util.time.diff', 'utility', {utype: 'time', op: 'diff'});
  def('util.time.before', 'utility', {utype: 'time', op: 'before'});
  def('util.time.after', 'utility', {utype: 'time', op: 'after'});
  def('util.time.between', 'utility', {utype: 'time', op: 'between'});
  def('util.time.isDst', 'utility', {utype: 'time', op: 'isDst'});
  def('util.time.timezone', 'utility', {utype: 'time', op: 'timezone'});
  def('util.time.offset', 'utility', {utype: 'time', op: 'offset'});
  def('util.time.elapsed', 'utility', {utype: 'time', op: 'elapsed'});
  def('util.time.countdown', 'utility', {utype: 'time', op: 'countdown'});
  def('util.time.parse', 'utility', {utype: 'time', op: 'parse'});
  def('util.time.toTimestamp', 'utility', {utype: 'time', op: 'toTimestamp'});
  def('util.time.fromTimestamp', 'utility', {utype: 'time', op: 'fromTimestamp'});
  def('util.time.formatMs', 'utility', {utype: 'time', op: 'formatMs'});
  def('util.time.formatSeconds', 'utility', {utype: 'time', op: 'formatSeconds'});
  def('util.time.formatMinutes', 'utility', {utype: 'time', op: 'formatMinutes'});
  def('util.time.formatHours', 'utility', {utype: 'time', op: 'formatHours'});
  def('util.time.formatDays', 'utility', {utype: 'time', op: 'formatDays'});
  def('util.time.formatWeeks', 'utility', {utype: 'time', op: 'formatWeeks'});
  def('util.time.formatMonths', 'utility', {utype: 'time', op: 'formatMonths'});
  def('util.time.formatYears', 'utility', {utype: 'time', op: 'formatYears'});
  def('util.time.formatDecades', 'utility', {utype: 'time', op: 'formatDecades'});
  def('util.time.formatCenturies', 'utility', {utype: 'time', op: 'formatCenturies'});
  def('util.time.formatMillennia', 'utility', {utype: 'time', op: 'formatMillennia'});
  def('util.time.formatEpoch', 'utility', {utype: 'time', op: 'formatEpoch'});
  def('util.time.formatUnix', 'utility', {utype: 'time', op: 'formatUnix'});
  def('util.time.formatUtc', 'utility', {utype: 'time', op: 'formatUtc'});
  def('util.time.formatLocal', 'utility', {utype: 'time', op: 'formatLocal'});
  def('util.time.formatIso', 'utility', {utype: 'time', op: 'formatIso'});
  def('util.time.formatRfc', 'utility', {utype: 'time', op: 'formatRfc'});
  def('util.time.formatHttp', 'utility', {utype: 'time', op: 'formatHttp'});
  def('util.time.formatCookie', 'utility', {utype: 'time', op: 'formatCookie'});
  def('util.time.formatLog', 'utility', {utype: 'time', op: 'formatLog'});
  def('util.time.formatShort', 'utility', {utype: 'time', op: 'formatShort'});
  def('util.time.formatLong', 'utility', {utype: 'time', op: 'formatLong'});
  def('util.time.formatFull', 'utility', {utype: 'time', op: 'formatFull'});
  def('util.time.formatRelative', 'utility', {utype: 'time', op: 'formatRelative'});
  def('util.time.formatAgo', 'utility', {utype: 'time', op: 'formatAgo'});
  def('util.time.formatDuration', 'utility', {utype: 'time', op: 'formatDuration'});
  def('util.time.formatPeriod', 'utility', {utype: 'time', op: 'formatPeriod'});
  def('util.time.formatInterval', 'utility', {utype: 'time', op: 'formatInterval'});
  def('util.time.formatSpan', 'utility', {utype: 'time', op: 'formatSpan'});
  def('util.time.formatGap', 'utility', {utype: 'time', op: 'formatGap'});
  def('util.time.formatLag', 'utility', {utype: 'time', op: 'formatLag'});
  def('util.time.formatDelay', 'utility', {utype: 'time', op: 'formatDelay'});
  def('util.time.formatWait', 'utility', {utype: 'time', op: 'formatWait'});
  def('util.time.formatHold', 'utility', {utype: 'time', op: 'formatHold'});
  def('util.time.formatPause', 'utility', {utype: 'time', op: 'formatPause'});
  def('util.time.formatResume', 'utility', {utype: 'time', op: 'formatResume'});
  def('util.time.formatStart', 'utility', {utype: 'time', op: 'formatStart'});
  def('util.time.formatEnd', 'utility', {utype: 'time', op: 'formatEnd'});
  def('util.time.formatReset', 'utility', {utype: 'time', op: 'formatReset'});
  def('util.time.formatClear', 'utility', {utype: 'time', op: 'formatClear'});
  def('util.time.formatZero', 'utility', {utype: 'time', op: 'formatZero'});
  def('util.time.formatNull', 'utility', {utype: 'time', op: 'formatNull'});
  def('util.time.formatUndefined', 'utility', {utype: 'time', op: 'formatUndefined'});
  def('util.time.formatNaN', 'utility', {utype: 'time', op: 'formatNaN'});
  def('util.time.formatInfinity', 'utility', {utype: 'time', op: 'formatInfinity'});
  def('util.time.formatNegative', 'utility', {utype: 'time', op: 'formatNegative'});
  def('util.time.formatPositive', 'utility', {utype: 'time', op: 'formatPositive'});
  def('util.time.formatZero', 'utility', {utype: 'time', op: 'formatZero'});
  def('util.time.formatNull', 'utility', {utype: 'time', op: 'formatNull'});
  def('util.time.formatUndefined', 'utility', {utype: 'time', op: 'formatUndefined'});
  def('util.time.formatNaN', 'utility', {utype: 'time', op: 'formatNaN'});
  def('util.time.formatInfinity', 'utility', {utype: 'time', op: 'formatInfinity'});
  def('util.time.formatNegative', 'utility', {utype: 'time', op: 'formatNegative'});
  def('util.time.formatPositive', 'utility', {utype: 'time', op: 'formatPositive'});
  def('util.typeof', 'utility', {utype: 'type', op: 'typeof'});
  def('util.isArray', 'utility', {utype: 'type', op: 'isArray'});
  def('util.isObject', 'utility', {utype: 'type', op: 'isObject'});
  def('util.isString', 'utility', {utype: 'type', op: 'isString'});
  def('util.isNumber', 'utility', {utype: 'type', op: 'isNumber'});
  def('util.isBoolean', 'utility', {utype: 'type', op: 'isBoolean'});
  def('util.isNull', 'utility', {utype: 'type', op: 'isNull'});
  def('util.isUndefined', 'utility', {utype: 'type', op: 'isUndefined'});
  def('util.isNaN', 'utility', {utype: 'type', op: 'isNaN'});
  def('util.isFinite', 'utility', {utype: 'type', op: 'isFinite'});
  def('util.isEmpty', 'utility', {utype: 'type', op: 'isEmpty'});
  def('util.isNotEmpty', 'utility', {utype: 'type', op: 'isNotEmpty'});
  def('util.isEqual', 'utility', {utype: 'type', op: 'isEqual'});
  def('util.isNotEqual', 'utility', {utype: 'type', op: 'isNotEqual'});
  def('util.isSameType', 'utility', {utype: 'type', op: 'isSameType'});
  def('util.isPrimitive', 'utility', {utype: 'type', op: 'isPrimitive'});
  def('util.isComposite', 'utility', {utype: 'type', op: 'isComposite'});
  def('util.isCallable', 'utility', {utype: 'type', op: 'isCallable'});
  def('util.isIterable', 'utility', {utype: 'type', op: 'isIterable'});
  def('util.isNumeric', 'utility', {utype: 'type', op: 'isNumeric'});
  def('util.isAlpha', 'utility', {utype: 'type', op: 'isAlpha'});
  def('util.isAlphaNumeric', 'utility', {utype: 'type', op: 'isAlphaNumeric'});
  def('util.isEmail', 'utility', {utype: 'type', op: 'isEmail'});
  def('util.isUrl', 'utility', {utype: 'type', op: 'isUrl'});
  def('util.isIp', 'utility', {utype: 'type', op: 'isIp'});
  def('util.isDate', 'utility', {utype: 'type', op: 'isDate'});
  def('util.isRegExp', 'utility', {utype: 'type', op: 'isRegExp'});
  def('util.isError', 'utility', {utype: 'type', op: 'isError'});
  def('util.isPromise', 'utility', {utype: 'type', op: 'isPromise'});
  def('util.isSymbol', 'utility', {utype: 'type', op: 'isSymbol'});
  def('util.isBigInt', 'utility', {utype: 'type', op: 'isBigInt'});
  def('util.isFunction', 'utility', {utype: 'type', op: 'isFunction'});
  def('util.isPlainObject', 'utility', {utype: 'type', op: 'isPlainObject'});
  def('util.isTypedArray', 'utility', {utype: 'type', op: 'isTypedArray'});
  def('util.isMap', 'utility', {utype: 'type', op: 'isMap'});
  def('util.isSet', 'utility', {utype: 'type', op: 'isSet'});
  def('util.isWeakMap', 'utility', {utype: 'type', op: 'isWeakMap'});
  def('util.isWeakSet', 'utility', {utype: 'type', op: 'isWeakSet'});
  def('util.isWeakRef', 'utility', {utype: 'type', op: 'isWeakRef'});
  def('util.isSharedArrayBuffer', 'utility', {utype: 'type', op: 'isSharedArrayBuffer'});
  def('util.isArrayBuffer', 'utility', {utype: 'type', op: 'isArrayBuffer'});
  def('util.isDataView', 'utility', {utype: 'type', op: 'isDataView'});
  def('util.isFloat32Array', 'utility', {utype: 'type', op: 'isFloat32Array'});
  def('util.isFloat64Array', 'utility', {utype: 'type', op: 'isFloat64Array'});
  def('util.isInt8Array', 'utility', {utype: 'type', op: 'isInt8Array'});
  def('util.isInt16Array', 'utility', {utype: 'type', op: 'isInt16Array'});
  def('util.isInt32Array', 'utility', {utype: 'type', op: 'isInt32Array'});
  def('util.isUint8Array', 'utility', {utype: 'type', op: 'isUint8Array'});
  def('util.isUint16Array', 'utility', {utype: 'type', op: 'isUint16Array'});
  def('util.isUint32Array', 'utility', {utype: 'type', op: 'isUint32Array'});
  def('util.isUint8ClampedArray', 'utility', {utype: 'type', op: 'isUint8ClampedArray'});
  def('util.isBigInt64Array', 'utility', {utype: 'type', op: 'isBigInt64Array'});
  def('util.isBigUint64Array', 'utility', {utype: 'type', op: 'isBigUint64Array'});
  def('util.isArguments', 'utility', {utype: 'type', op: 'isArguments'});
  def('util.isGeneratorFunction', 'utility', {utype: 'type', op: 'isGeneratorFunction'});
  def('util.isAsyncFunction', 'utility', {utype: 'type', op: 'isAsyncFunction'});
  def('util.isGeneratorObject', 'utility', {utype: 'type', op: 'isGeneratorObject'});
  def('util.isAsyncGeneratorFunction', 'utility', {utype: 'type', op: 'isAsyncGeneratorFunction'});
  def('util.isAsyncGeneratorObject', 'utility', {utype: 'type', op: 'isAsyncGeneratorObject'});
  def('util.isFinalizationRegistry', 'utility', {utype: 'type', op: 'isFinalizationRegistry'});
  def('util.isWeakRef', 'utility', {utype: 'type', op: 'isWeakRef'});
  def('util.isProxy', 'utility', {utype: 'type', op: 'isProxy'});
  def('util.isModuleNamespaceObject', 'utility', {utype: 'type', op: 'isModuleNamespaceObject'});
  def('util.isExternal', 'utility', {utype: 'type', op: 'isExternal'});
  def('util.isWrapped', 'utility', {utype: 'type', op: 'isWrapped'});
  def('util.isCompiled', 'utility', {utype: 'type', op: 'isCompiled'});
  def('util.isBuiltin', 'utility', {utype: 'type', op: 'isBuiltin'});
  def('util.isHostObject', 'utility', {utype: 'type', op: 'isHostObject'});
  def('util.isNullOrUndefined', 'utility', {utype: 'type', op: 'isNullOrUndefined'});
  def('util.isNil', 'utility', {utype: 'type', op: 'isNil'});
  def('util.isDef', 'utility', {utype: 'type', op: 'isDef'});
  def('util.isDefNotNull', 'utility', {utype: 'type', op: 'isDefNotNull'});
  def('util.isEmpty', 'utility', {utype: 'type', op: 'isEmpty'});
  def('util.isNotEmpty', 'utility', {utype: 'type', op: 'isNotEmpty'});
  def('util.isZero', 'utility', {utype: 'type', op: 'isZero'});
  def('util.isPositive', 'utility', {utype: 'type', op: 'isPositive'});
  def('util.isNegative', 'utility', {utype: 'type', op: 'isNegative'});
  def('util.isEven', 'utility', {utype: 'type', op: 'isEven'});
  def('util.isOdd', 'utility', {utype: 'type', op: 'isOdd'});
  def('util.isInteger', 'utility', {utype: 'type', op: 'isInteger'});
  def('util.isFloat', 'utility', {utype: 'type', op: 'isFloat'});
  def('util.isNaN', 'utility', {utype: 'type', op: 'isNaN'});
  def('util.isFinite', 'utility', {utype: 'type', op: 'isFinite'});
  def('util.isSafeInteger', 'utility', {utype: 'type', op: 'isSafeInteger'});
  def('util.isPowerOfTwo', 'utility', {utype: 'type', op: 'isPowerOfTwo'});
  def('util.isPrime', 'utility', {utype: 'type', op: 'isPrime'});
  def('util.isFibonacci', 'utility', {utype: 'type', op: 'isFibonacci'});
  def('util.isPalindrome', 'utility', {utype: 'type', op: 'isPalindrome'});
  def('util.isAnagram', 'utility', {utype: 'type', op: 'isAnagram'});
  def('util.isSorted', 'utility', {utype: 'type', op: 'isSorted'});
  def('util.isUnique', 'utility', {utype: 'type', op: 'isUnique'});
  def('util.isSubset', 'utility', {utype: 'type', op: 'isSubset'});
  def('util.isSuperset', 'utility', {utype: 'type', op: 'isSuperset'});
  def('util.isDisjoint', 'utility', {utype: 'type', op: 'isDisjoint'});
  def('util.isPermutation', 'utility', {utype: 'type', op: 'isPermutation'});
  def('util.isCombination', 'utility', {utype: 'type', op: 'isCombination'});
  def('util.isPowerSet', 'utility', {utype: 'type', op: 'isPowerSet'});
  def('util.isCartesianProduct', 'utility', {utype: 'type', op: 'isCartesianProduct'});
  def('util.isCrossProduct', 'utility', {utype: 'type', op: 'isCrossProduct'});
  def('util.isDotProduct', 'utility', {utype: 'type', op: 'isDotProduct'});
  def('util.isMatrix', 'utility', {utype: 'type', op: 'isMatrix'});
  def('util.isVector', 'utility', {utype: 'type', op: 'isVector'});
  def('util.isScalar', 'utility', {utype: 'type', op: 'isScalar'});
  def('util.isTensor', 'utility', {utype: 'type', op: 'isTensor'});
  def('util.isComplex', 'utility', {utype: 'type', op: 'isComplex'});
  def('util.isQuaternion', 'utility', {utype: 'type', op: 'isQuaternion'});
  def('util.isDual', 'utility', {utype: 'type', op: 'isDual'});
  def('util.isConjugate', 'utility', {utype: 'type', op: 'isConjugate'});
  def('util.isInverse', 'utility', {utype: 'type', op: 'isInverse'});
  def('util.isOrthogonal', 'utility', {utype: 'type', op: 'isOrthogonal'});
  def('util.isUnitary', 'utility', {utype: 'type', op: 'isUnitary'});
  def('util.isHermitian', 'utility', {utype: 'type', op: 'isHermitian'});
  def('util.isPositiveDefinite', 'utility', {utype: 'type', op: 'isPositiveDefinite'});
  def('util.isPositiveSemiDefinite', 'utility', {utype: 'type', op: 'isPositiveSemiDefinite'});
  def('util.isNegativeDefinite', 'utility', {utype: 'type', op: 'isNegativeDefinite'});
  def('util.isNegativeSemiDefinite', 'utility', {utype: 'type', op: 'isNegativeSemiDefinite'});
  def('util.isBlank', 'utility', {utype: 'type', op: 'isBlank'});
  def('util.isNotBlank', 'utility', {utype: 'type', op: 'isNotBlank'});
  def('util.isWhitespace', 'utility', {utype: 'type', op: 'isWhitespace'});
  def('util.isNotWhitespace', 'utility', {utype: 'type', op: 'isNotWhitespace'});
  def('util.isSpace', 'utility', {utype: 'type', op: 'isSpace'});
  def('util.isNotSpace', 'utility', {utype: 'type', op: 'isNotSpace'});
  def('util.isUpper', 'utility', {utype: 'type', op: 'isUpper'});
  def('util.isLower', 'utility', {utype: 'type', op: 'isLower'});
  def('util.isCapitalized', 'utility', {utype: 'type', op: 'isCapitalized'});
  def('util.isTitleCase', 'utility', {utype: 'type', op: 'isTitleCase'});
  def('util.isCamelCase', 'utility', {utype: 'type', op: 'isCamelCase'});
  def('util.isPascalCase', 'utility', {utype: 'type', op: 'isPascalCase'});
  def('util.isSnakeCase', 'utility', {utype: 'type', op: 'isSnakeCase'});
  def('util.isKebabCase', 'utility', {utype: 'type', op: 'isKebabCase'});
  def('util.isDotCase', 'utility', {utype: 'type', op: 'isDotCase'});
  def('util.isPathCase', 'utility', {utype: 'type', op: 'isPathCase'});
  def('util.isConstantCase', 'utility', {utype: 'type', op: 'isConstantCase'});
  def('util.isSentenceCase', 'utility', {utype: 'type', op: 'isSentenceCase'});
  def('util.isParagraphCase', 'utility', {utype: 'type', op: 'isParagraphCase'});
  def('util.isAlternatingCase', 'utility', {utype: 'type', op: 'isAlternatingCase'});
  def('util.isInverseCase', 'utility', {utype: 'type', op: 'isInverseCase'});
  def('util.isRandomCase', 'utility', {utype: 'type', op: 'isRandomCase'});
  def('util.isleet', 'utility', {utype: 'type', op: 'isleet'});
  def('util.isMorse', 'utility', {utype: 'type', op: 'isMorse'});
  def('util.isBraille', 'utility', {utype: 'type', op: 'isBraille'});
  def('util.isBinary', 'utility', {utype: 'type', op: 'isBinary'});
  def('util.isOctal', 'utility', {utype: 'type', op: 'isOctal'});
  def('util.isHexadecimal', 'utility', {utype: 'type', op: 'isHexadecimal'});
  def('util.isBase64', 'utility', {utype: 'type', op: 'isBase64'});
  def('util.isBase32', 'utility', {utype: 'type', op: 'isBase32'});
  def('util.isBase58', 'utility', {utype: 'type', op: 'isBase58'});
  def('util.isBase85', 'utility', {utype: 'type', op: 'isBase85'});
  def('util.isBase91', 'utility', {utype: 'type', op: 'isBase91'});
  def('util.isBase100', 'utility', {utype: 'type', op: 'isBase100'});
  def('util.isBase128', 'utility', {utype: 'type', op: 'isBase128'});
  def('util.isBase256', 'utility', {utype: 'type', op: 'isBase256'});
  def('util.isBase65536', 'utility', {utype: 'type', op: 'isBase65536'});
  def('util.isBaseN', 'utility', {utype: 'type', op: 'isBaseN'});
  def('util.isNumericString', 'utility', {utype: 'type', op: 'isNumericString'});
  def('util.isAlphaString', 'utility', {utype: 'type', op: 'isAlphaString'});
  def('util.isAlphaNumericString', 'utility', {utype: 'type', op: 'isAlphaNumericString'});
  def('util.isUrlString', 'utility', {utype: 'type', op: 'isUrlString'});
  def('util.isEmailString', 'utility', {utype: 'type', op: 'isEmailString'});
  def('util.isIpString', 'utility', {utype: 'type', op: 'isIpString'});
  def('util.isUuidString', 'utility', {utype: 'type', op: 'isUuidString'});
  def('util.isDateString', 'utility', {utype: 'type', op: 'isDateString'});
  def('util.isTimeString', 'utility', {utype: 'type', op: 'isTimeString'});
  def('util.isDateTimeString', 'utility', {utype: 'type', op: 'isDateTimeString'});
  def('util.isIsoDateString', 'utility', {utype: 'type', op: 'isIsoDateString'});
  def('util.isRfcDateString', 'utility', {utype: 'type', op: 'isRfcDateString'});
  def('util.isHttpDateString', 'utility', {utype: 'type', op: 'isHttpDateString'});
  def('util.isCookieDateString', 'utility', {utype: 'type', op: 'isCookieDateString'});
  def('util.isLogDateString', 'utility', {utype: 'type', op: 'isLogDateString'});
  def('util.isShortDateString', 'utility', {utype: 'type', op: 'isShortDateString'});
  def('util.isLongDateString', 'utility', {utype: 'type', op: 'isLongDateString'});
  def('util.isFullDateString', 'utility', {utype: 'type', op: 'isFullDateString'});
  def('util.isRelativeDateString', 'utility', {utype: 'type', op: 'isRelativeDateString'});
  def('util.isAgoDateString', 'utility', {utype: 'type', op: 'isAgoDateString'});
  def('util.isDurationString', 'utility', {utype: 'type', op: 'isDurationString'});
  def('util.isPeriodString', 'utility', {utype: 'type', op: 'isPeriodString'});
  def('util.isIntervalString', 'utility', {utype: 'type', op: 'isIntervalString'});
  def('util.isSpanString', 'utility', {utype: 'type', op: 'isSpanString'});
  def('util.isGapString', 'utility', {utype: 'type', op: 'isGapString'});
  def('util.isLagString', 'utility', {utype: 'type', op: 'isLagString'});
  def('util.isDelayString', 'utility', {utype: 'type', op: 'isDelayString'});
  def('util.isWaitString', 'utility', {utype: 'type', op: 'isWaitString'});
  def('util.isHoldString', 'utility', {utype: 'type', op: 'isHoldString'});
  def('util.isPauseString', 'utility', {utype: 'type', op: 'isPauseString'});
  def('util.isResumeString', 'utility', {utype: 'type', op: 'isResumeString'});
  def('util.isStartString', 'utility', {utype: 'type', op: 'isStartString'});
  def('util.isEndString', 'utility', {utype: 'type', op: 'isEndString'});
  def('util.isResetString', 'utility', {utype: 'type', op: 'isResetString'});
  def('util.isClearString', 'utility', {utype: 'type', op: 'isClearString'});
  def('util.isZeroString', 'utility', {utype: 'type', op: 'isZeroString'});
  def('util.isNullString', 'utility', {utype: 'type', op: 'isNullString'});
  def('util.isUndefinedString', 'utility', {utype: 'type', op: 'isUndefinedString'});
  def('util.isNaNString', 'utility', {utype: 'type', op: 'isNaNString'});
  def('util.isInfinityString', 'utility', {utype: 'type', op: 'isInfinityString'});
  def('util.isNegativeString', 'utility', {utype: 'type', op: 'isNegativeString'});
  def('util.isPositiveString', 'utility', {utype: 'type', op: 'isPositiveString'});
  def('util.clone', 'utility', {utype: 'clone', op: 'clone'});
  def('util.cloneDeep', 'utility', {utype: 'clone', op: 'cloneDeep'});
  def('util.cloneShallow', 'utility', {utype: 'clone', op: 'cloneShallow'});
  def('util.cloneMerge', 'utility', {utype: 'clone', op: 'cloneMerge'});
  def('util.cloneExtend', 'utility', {utype: 'clone', op: 'cloneExtend'});
  def('util.cloneAssign', 'utility', {utype: 'clone', op: 'cloneAssign'});
  def('util.cloneCopy', 'utility', {utype: 'clone', op: 'cloneCopy'});
  def('util.cloneMove', 'utility', {utype: 'clone', op: 'cloneMove'});
  def('util.cloneSwap', 'utility', {utype: 'clone', op: 'cloneSwap'});
  def('util.cloneReplace', 'utility', {utype: 'clone', op: 'cloneReplace'});
  def('util.cloneUpdate', 'utility', {utype: 'clone', op: 'cloneUpdate'});
  def('util.clonePatch', 'utility', {utype: 'clone', op: 'clonePatch'});
  def('util.cloneDiff', 'utility', {utype: 'clone', op: 'cloneDiff'});
  def('util.cloneMerge', 'utility', {utype: 'clone', op: 'cloneMerge'});
  def('util.cloneExtend', 'utility', {utype: 'clone', op: 'cloneExtend'});
  def('util.cloneAssign', 'utility', {utype: 'clone', op: 'cloneAssign'});
  def('util.cloneCopy', 'utility', {utype: 'clone', op: 'cloneCopy'});
  def('util.cloneMove', 'utility', {utype: 'clone', op: 'cloneMove'});
  def('util.cloneSwap', 'utility', {utype: 'clone', op: 'cloneSwap'});
  def('util.cloneReplace', 'utility', {utype: 'clone', op: 'cloneReplace'});
  def('util.cloneUpdate', 'utility', {utype: 'clone', op: 'cloneUpdate'});
  def('util.clonePatch', 'utility', {utype: 'clone', op: 'clonePatch'});
  def('util.cloneDiff', 'utility', {utype: 'clone', op: 'cloneDiff'});
  def('util.cloneDeep', 'utility', {utype: 'clone', op: 'cloneDeep'});
  def('util.cloneShallow', 'utility', {utype: 'clone', op: 'cloneShallow'});
  def('util.cloneMerge', 'utility', {utype: 'clone', op: 'cloneMerge'});
  def('util.cloneExtend', 'utility', {utype: 'clone', op: 'cloneExtend'});
  def('util.cloneAssign', 'utility', {utype: 'clone', op: 'cloneAssign'});
  def('util.cloneCopy', 'utility', {utype: 'clone', op: 'cloneCopy'});
  def('util.cloneMove', 'utility', {utype: 'clone', op: 'cloneMove'});
  def('util.cloneSwap', 'utility', {utype: 'clone', op: 'cloneSwap'});
  def('util.cloneReplace', 'utility', {utype: 'clone', op: 'cloneReplace'});
  def('util.cloneUpdate', 'utility', {utype: 'clone', op: 'cloneUpdate'});
  def('util.clonePatch', 'utility', {utype: 'clone', op: 'clonePatch'});
  def('util.cloneDiff', 'utility', {utype: 'clone', op: 'cloneDiff'});

  // --- GENERATE ALL COMMANDS ---
  for (var i = 0; i < COMMAND_ENTRIES.length; i++) {
    var entry = COMMAND_ENTRIES[i];
    var tname = entry.template;
    var h = null;
    if (tname === 'findBlocks') h = TM.findBlocks(entry.params);
    else if (tname === 'scanContainer') h = TM.scanContainer(entry.params);
    else if (tname === 'containerGet') {
      var parts2 = entry.ns.split('.');
      var slotNum = parseInt(parts2[parts2.length-1]);
      if (!isNaN(slotNum)) h = TM.containerGet({slot: slotNum});
      else h = TM.containerGet(entry.params);
    }
    else if (tname === 'screenClick') {
      // For slot range expansion, create separate handler per slot
      var p = entry.params;
      var pSlot = p.slot;
      if (pSlot && typeof pSlot === 'string' && pSlot === '*') {
        // This entry was expanded - just use the slot from the entry name
        var parts2 = entry.ns.split('.');
        var slotNum = parseInt(parts2[parts2.length-1]);
        if (!isNaN(slotNum)) {
          h = TM.screenClick({slot: slotNum, actionType: p.actionType, button: p.button});
        }
      } else {
        h = TM.screenClick(p);
      }
    }
    else if (tname === 'invGet') {
      var parts2 = entry.ns.split('.');
      var slotNum = parseInt(parts2[parts2.length-1]);
      if (!isNaN(slotNum)) h = TM.invGet({slot: slotNum});
      else h = TM.invGet(entry.params);
    }
    else if (tname === 'invSet') {
      var parts2 = entry.ns.split('.');
      var slotNum = parseInt(parts2[parts2.length-1]);
      if (!isNaN(slotNum)) h = TM.invSet({slot: slotNum});
      else h = TM.invSet(entry.params);
    }
    else if (tname === 'moveItem') h = TM.moveItem(entry.params);
    else if (tname === 'findEntities') h = TM.findEntities(entry.params);
    else if (tname === 'entityInteract') h = TM.entityInteract(entry.params);
    else if (tname === 'worldQuery') h = TM.worldQuery(entry.params);
    else if (tname === 'playerQuery') h = TM.playerQuery(entry.params);
    else if (tname === 'itemDetail') h = TM.itemDetail(entry.params);
    else if (tname === 'utility') h = TM.utility(entry.params);
    else if (tname === 'playerAction') {
      var p = entry.params;
      // For selectSlot with range, use slot from name
      if (p.action === 'selectSlot') {
        var parts2 = entry.ns.split('.');
        var slotNum = parseInt(parts2[parts2.length-1]);
        if (!isNaN(slotNum)) {
          h = TM.playerAction({action: 'selectSlot'});
        } else {
          h = TM.playerAction(p);
        }
      } else {
        h = TM.playerAction(p);
      }
    }
    else if (tname === 'blockAction') h = TM.blockAction(entry.params);
    else if (tname === 'nav') h = TM.nav(entry.params);
    else if (tname === 'screenAction') h = TM.screenAction(entry.params);
    else if (tname === 'chat') h = TM.chat(entry.params);
    else if (tname === 'containerAction') h = TM.containerAction(entry.params);
    else if (tname === 'blockQuery') h = TM.blockQuery(entry.params);
    else if (tname === 'eventOps') h = TM.eventOps(entry.params);
    else if (tname === 'invOps') h = TM.invOps(entry.params);

    if (h) globalThis.__bridge.commands.handlers[entry.ns] = h;
  }

  var after = Object.keys(globalThis.__bridge.commands.handlers).length;
  log(LOG.INFO, 'Generated ' + (after - before) + ' commands (total: ' + after + ')');
}

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
    var mc = Java.type('net.minecraft.client.MinecraftClient').getInstance();
    var configPath = mc.runDirectory.toPath().resolve('config/autobridge/config.json');
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
      if (_config.host !== '127.0.0.1' && _config.host !== '0.0.0.0') {
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
  _queueCommand(connId, msg.id, msg.type, handler, msg.payload || {});
}

function _eventTick() {
  try {
    if (!Client.player || !Client.world) return;
    _checkPosition();
    _checkDeath();
    if (_walkTarget !== null) { _processWalk(); }
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
      globalThis.__bridge.ws.broadcast('event', {event: 'position', data: {x: x, y: y, z: z, yaw: yaw, pitch: pitch, onGround: onGround, dimension: dimension, walking: _walkTarget !== null}});
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

function _processWalk() {
  try {
    var pos = Client.player.getPos();
    var dx = _walkTarget.x - pos.x;
    var dz = _walkTarget.z - pos.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 5.0) {
      var targetBlock = new BlockPos(Math.floor(_walkTarget.x), Math.floor(_walkTarget.y - 1), Math.floor(_walkTarget.z));
      if (Client.world.getBlockState(targetBlock).isAir()) {
        _walkTarget = null;
        Client.options.forwardKey.setPressed(false);
        return;
      }
    }
    if (dist < 1.0) {
      _walkTarget = null;
      Client.options.forwardKey.setPressed(false);
      return;
    }
    var yaw = Math.atan2(dz, dx) * 180 / Math.PI - 90;
    Client.player.networkHandler.sendPacket(new LookPacket(yaw, Client.player.getPitch(), true));
    if (Client.player.isOnGround()) {
      Client.player.jump();
    }
    Client.options.forwardKey.setPressed(true);
  } catch (e) {
    _walkTarget = null;
    Client.options.forwardKey.setPressed(false);
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
      var mc = Java.type('net.minecraft.client.MinecraftClient').getInstance();
      _eventInterval = setInterval(function() {
        try { mc.execute(function() { _eventTick(); }); } catch (e) {}
      }, 50);
    }
    log(LOG.INFO, "Bridge started on " + _config.host + ":" + _config.port);
  } catch (e) {
    log(LOG.ERROR, "Failed to start bridge: " + (e.message || e));
  }
}

function stopBridge() {
  try {
    _walkTarget = null;
    Client.options.forwardKey.setPressed(false);
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
globalThis.__bridge._eventTick = _eventTick;
globalThis.__bridge._processWalk = _processWalk;

try {
  startBridge();
} catch (e) {
  log(LOG.ERROR, "Auto-start error: " + (e.message || e));
}

try {
  var ShutdownThread = Java.extend(Java.type('java.lang.Thread'), {
    run: function() { try { stopBridge(); } catch(e) {} }
  });
  Java.type('java.lang.Runtime').getRuntime().addShutdownHook(new ShutdownThread());
} catch (e) {
  log(LOG.ERROR, "Shutdown hook registration failed: " + (e.message || e));
}

var _prevOnUnload = globalThis.onunload;
globalThis.onunload = function() {
  try { stopBridge(); } catch(e) {}
  if (typeof _prevOnUnload === 'function') _prevOnUnload();
};
