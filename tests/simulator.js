'use strict';

const crypto = require('crypto');

// =============================================================================
// SECTION 1: Java Interop Mock Layer
// =============================================================================

const Java = {
  _types: {},
  type(name) {
    if (this._types[name]) return this._types[name];
    throw new Error('Java.type not mocked: ' + name);
  },
  array(type, len) {
    if (type === 'byte') return new Array(len).fill(0);
    return new Array(len).fill(null);
  },
  synchronized(obj, fn) {
    return fn();
  }
};

function JavaString(value) {
  if (!(this instanceof JavaString)) {
    return new JavaString(value, arguments[1]);
  }
  if (typeof value === 'string') {
    this._str = value;
  } else if (Array.isArray(value)) {
    var encoding = arguments[1] || 'UTF-8';
    this._str = Buffer.from(value).toString(encoding === 'UTF-8' ? 'utf8' : encoding);
  } else {
    this._str = String(value);
  }
}
JavaString.prototype.getBytes = function(enc) {
  var buf = Buffer.from(this._str, enc || 'UTF-8');
  var arr = new Array(buf.length);
  for (var i = 0; i < buf.length; i++) arr[i] = buf[i];
  return arr;
};
JavaString.prototype.length = function() { return this._str.length; };
JavaString.prototype.toLowerCase = function() { return this._str.toLowerCase(); };
JavaString.prototype.indexOf = function(s) { return this._str.indexOf(s); };
JavaString.prototype.split = function(d) { return this._str.split(d); };
JavaString.prototype.trim = function() { return this._str.trim(); };
JavaString.prototype.toString = function() { return this._str; };
JavaString.prototype.charAt = function(i) { return this._str.charAt(i); };
JavaString.prototype[Symbol.toPrimitive] = function(hint) { return this._str; };

Java._types['java.lang.String'] = JavaString;
Java._types['java.lang.String'].getBytes = function(s, enc) {
  return new JavaString(s).getBytes(enc);
};

// =============================================================================
// SECTION 2: Java Standard Library Mocks
// =============================================================================

Java._types['java.security.MessageDigest'] = {
  getInstance: function(algo) {
    return {
      digest: function(bytes) {
        var str = '';
        for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
        var hash = crypto.createHash('sha1').update(str).digest();
        var arr = new Array(hash.length);
        for (var i = 0; i < hash.length; i++) arr[i] = hash[i];
        return arr;
      }
    };
  }
};

Java._types['java.util.Base64'] = {
  getEncoder: function() {
    return {
      encodeToString: function(bytes) {
        var str = '';
        for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i] & 0xFF);
        return Buffer.from(str, 'binary').toString('base64');
      }
    };
  }
};

Java._types['java.util.concurrent.atomic.AtomicBoolean'] = function(val) { this._val = !!val; };
Java._types['java.util.concurrent.atomic.AtomicBoolean'].prototype.get = function() { return this._val; };
Java._types['java.util.concurrent.atomic.AtomicBoolean'].prototype.set = function(v) { this._val = !!v; };

Java._types['java.util.Collections'] = { synchronizedList: function(list) { return list; } };

Java._types['java.util.ArrayList'] = function() { this._items = []; };
Java._types['java.util.ArrayList'].prototype.size = function() { return this._items.length; };
Java._types['java.util.ArrayList'].prototype.add = function(item) { this._items.push(item); };
Java._types['java.util.ArrayList'].prototype.remove = function(item) {
  var idx = this._items.indexOf(item);
  if (idx >= 0) { this._items.splice(idx, 1); return true; }
  return false;
};
Java._types['java.util.ArrayList'].prototype.get = function(i) { return this._items[i]; };
Java._types['java.util.ArrayList'].prototype.clear = function() { this._items = []; };
Java._types['java.util.ArrayList'].prototype.toArray = function() { return this._items.slice(); };

Java._types['java.util.concurrent.ConcurrentHashMap'] = function() { this._map = new Map(); };
Java._types['java.util.concurrent.ConcurrentHashMap'].prototype.get = function(k) {
  var v = this._map.get(k); return v !== undefined ? v : null;
};
Java._types['java.util.concurrent.ConcurrentHashMap'].prototype.put = function(k, v) { this._map.set(k, v); };
Java._types['java.util.concurrent.ConcurrentHashMap'].prototype.remove = function(k) { this._map.delete(k); };
Java._types['java.util.concurrent.ConcurrentHashMap'].prototype.values = function() {
  var arr = Array.from(this._map.values());
  return { toArray: function() { return arr; } };
};
Java._types['java.util.concurrent.ConcurrentHashMap'].prototype.clear = function() { this._map.clear(); };

Java._types['java.io.ByteArrayOutputStream'] = function() { this._bytes = []; };
Java._types['java.io.ByteArrayOutputStream'].prototype.write = function(b) {
  if (typeof b === 'number') { this._bytes.push(b & 0xFF); }
  else if (Array.isArray(b)) { for (var i = 0; i < b.length; i++) this._bytes.push(b[i] & 0xFF); }
};
Java._types['java.io.ByteArrayOutputStream'].prototype.toByteArray = function() { return this._bytes.slice(); };

Java._types['java.net.InetSocketAddress'] = function(host, port) { this.host = host; this.port = port; };
Java._types['java.net.ServerSocket'] = function() { this._closed = false; };
Java._types['java.net.ServerSocket'].prototype.setReuseAddress = function() {};
Java._types['java.net.ServerSocket'].prototype.bind = function() {};
Java._types['java.net.ServerSocket'].prototype.accept = function() { return null; };
Java._types['java.net.ServerSocket'].prototype.close = function() { this._closed = true; };
Java._types['java.net.ServerSocket'].prototype.isClosed = function() { return this._closed; };

Java._types['java.net.Socket'] = function() {
  this._closed = false;
  this._in = { read: function() { return -1; } };
  this._out = { write: function() {}, flush: function() {} };
};
Java._types['java.net.Socket'].prototype.getInputStream = function() { return this._in; };
Java._types['java.net.Socket'].prototype.getOutputStream = function() { return this._out; };
Java._types['java.net.Socket'].prototype.isClosed = function() { return this._closed; };
Java._types['java.net.Socket'].prototype.close = function() { this._closed = true; };

Java._types['java.io.BufferedReader'] = function(r) { this._r = r; };
Java._types['java.io.BufferedReader'].prototype.readLine = function() { return null; };
Java._types['java.io.InputStreamReader'] = function(s, e) {};
Java._types['java.io.OutputStream'] = function() {};
Java._types['java.io.OutputStream'].prototype.write = function() {};
Java._types['java.io.OutputStream'].prototype.flush = function() {};

Java._types['java.lang.Thread'] = function(fn) { this._fn = fn; this._d = false; };
Java._types['java.lang.Thread'].prototype.setDaemon = function(v) { this._d = v; };
Java._types['java.lang.Thread'].prototype.start = function() {};

Java._types['java.lang.System'] = { out: { println: function(msg) { console.log(msg); } } };
Java._types['java.lang.Runtime'] = { getRuntime: function() { return { addShutdownHook: function() {} }; } };

Java._types['java.util.Timer'] = function(name, daemon) {
  this._tasks = [];
  var self = this;
  // Bypass: immediately run any scheduled task (sync simulation)
  this.schedule = function(task, delay, period) {
    self._tasks.push({ task: task, period: period });
    try { task.run(); } catch (e) { /* ignore */ }
  };
  this.cancel = function() { self._tasks = []; };
};
Java._types['java.util.TimerTask'] = function() {};
Java._types['java.util.TimerTask'].prototype.run = function() {};

Java.extend = function(baseClass, methods) {
  function Extended() { baseClass.call(this); }
  Extended.prototype = Object.create(baseClass.prototype);
  for (var k in methods) {
    if (methods.hasOwnProperty(k)) Extended.prototype[k] = methods[k];
  }
  return Extended;
};

Java._types['java.nio.file.Paths'] = {
  get: function(path) {
    return {
      toString: function() { return path; },
      toAbsolutePath: function() { return { toString: function() { return '/' + path; } }; },
      getParent: function() {
        var parts = path.split('/'); parts.pop();
        var p = parts.join('/') || '.';
        return { toString: function() { return p; } };
      }
    };
  }
};

// Config mock: no apiKey by default (auth tests will set it)
var _MOCK_CONFIG = JSON.stringify({ rateLimit: 200 });
Java._types['java.nio.file.Files'] = {
  exists: function(path) {
    return path && path.toString && path.toString().indexOf('config.json') >= 0;
  },
  createDirectories: function() {},
  write: function() {},
  readAllBytes: function(path) {
    if (path && path.toString && path.toString().indexOf('config.json') >= 0) {
      var buf = Buffer.from(_MOCK_CONFIG);
      var arr = new Array(buf.length);
      for (var i = 0; i < buf.length; i++) arr[i] = buf[i];
      return arr;
    }
    return null;
  }
};

Java._types['java.nio.charset.StandardCharsets'] = { UTF_8: 'utf-8' };

// =============================================================================
// SECTION 3: Minecraft Client Mocks
// =============================================================================

var _mockGameState = {
  player: {
    x: 0, y: 64, z: 0, yaw: 0, pitch: 0, onGround: true,
    health: 20, food: 20, saturation: 5,
    sprinting: false, sneaking: false,
    lastSwingHand: null, lastChatMessage: null, raycastResult: null
  },
  world: { timeOfDay: 6000, dimension: 'minecraft:overworld', blocks: {} }
};

Java._types['net.minecraft.text.Text'] = function(s) { this._s = s; };
Java._types['net.minecraft.text.Text'].prototype.getString = function() { return this._s; };

Java._types['net.minecraft.util.Identifier'] = function(ns, p) { this._ns = ns; this._p = p; };
Java._types['net.minecraft.util.Identifier'].prototype.toString = function() { return this._ns + ':' + this._p; };

Java._types['net.minecraft.util.Hand'] = { MAIN_HAND: 'MAIN_HAND' };

Java._types['net.minecraft.util.hit.HitResult.Type'] = {
  MISS: { name: function() { return 'MISS'; } },
  BLOCK: { name: function() { return 'BLOCK'; } },
  ENTITY: { name: function() { return 'ENTITY'; } }
};
Java._types['net.minecraft.util.hit.HitResult'] = function(type, pos) { this._type = type; this._pos = pos; };
Java._types['net.minecraft.util.hit.HitResult'].prototype.getType = function() { return this._type; };
Java._types['net.minecraft.util.hit.HitResult'].prototype.getPos = function() { return this._pos; };

Java._types['net.minecraft.util.math.BlockPos'] = function(x, y, z) { this.x = x; this.y = y; this.z = z; };
Java._types['net.minecraft.util.math.Vec3d'] = function(x, y, z) { this.x = x; this.y = y; this.z = z; };

Java._types['net.minecraft.block.Block'] = function(tk, dn) { this._tk = tk; this._dn = dn; };
Java._types['net.minecraft.block.Block'].prototype.getTranslationKey = function() { return this._tk; };
Java._types['net.minecraft.block.Block'].prototype.getName = function() {
  return new (Java._types['net.minecraft.text.Text'])(this._dn);
};

Java._types['net.minecraft.block.BlockState'] = function(b) { this._b = b; };
Java._types['net.minecraft.block.BlockState'].prototype.getBlock = function() { return this._b; };

function SimpleInventory(size) {
  this._size = size;
  this._stacks = [];
  for (var i = 0; i < size; i++) this._stacks.push(_createEmptyStack());
}
SimpleInventory.prototype.size = function() { return this._size; };
SimpleInventory.prototype.get = function(i) {
  if (i < 0 || i >= this._size) return _createEmptyStack();
  return this._stacks[i];
};
SimpleInventory.prototype.set = function(i, s) { if (i >= 0 && i < this._size) this._stacks[i] = s; };

Java._types['net.minecraft.item.Item'] = function(tk, dn) { this._tk = tk; this._dn = dn; };
Java._types['net.minecraft.item.Item'].prototype.getTranslationKey = function() { return this._tk; };
Java._types['net.minecraft.item.Item'].prototype.getName = function() {
  return new (Java._types['net.minecraft.text.Text'])(this._dn);
};

Java._types['net.minecraft.item.ItemStack'] = function(item, count) {
  this._item = item || null; this._count = count || 0;
};
Java._types['net.minecraft.item.ItemStack'].prototype.isEmpty = function() {
  return this._item === null || this._count <= 0;
};
Java._types['net.minecraft.item.ItemStack'].prototype.getItem = function() { return this._item; };
Java._types['net.minecraft.item.ItemStack'].prototype.getCount = function() { return this._count; };
Java._types['net.minecraft.item.ItemStack'].prototype.getName = function() {
  if (!this._item) return new (Java._types['net.minecraft.text.Text'])('Air');
  return this._item.getName();
};

function _createEmptyStack() { return new (Java._types['net.minecraft.item.ItemStack'])(null, 0); }

Java._types['net.minecraft.entity.player.PlayerInventory'] = function() {
  this.main = new SimpleInventory(36);
  this.armor = new SimpleInventory(4);
  this.offHand = new SimpleInventory(1);
};
Java._types['net.minecraft.entity.player.PlayerInventory'].prototype.getStack = function(slot) {
  if (slot >= 0 && slot < 36) return this.main.get(slot);
  if (slot >= 36 && slot < 40) return this.armor.get(slot - 36);
  if (slot === 40) return this.offHand.get(0);
  return _createEmptyStack();
};
Java._types['net.minecraft.entity.player.PlayerInventory'].prototype.setStack = function(slot, stack) {
  if (slot >= 0 && slot < 36) this.main.set(slot, stack);
  else if (slot >= 36 && slot < 40) this.armor.set(slot - 36, stack);
  else if (slot === 40) this.offHand.set(0, stack);
};

var _lastSentPacket = null;
var _sentPackets = [];
Java._types['net.minecraft.client.network.ClientPlayerEntity$NetworkHandler'] = function() {};
Java._types['net.minecraft.client.network.ClientPlayerEntity$NetworkHandler'].prototype.sendPacket = function(p) {
  _lastSentPacket = p; _sentPackets.push(p);
};

Java._types['net.minecraft.client.network.ClientPlayerEntity'] = function() {
  this.networkHandler = new (Java._types['net.minecraft.client.network.ClientPlayerEntity$NetworkHandler'])();
  this._inventory = new (Java._types['net.minecraft.entity.player.PlayerInventory'])();
  this._sprinting = false; this._sneaking = false;
};
Java._types['net.minecraft.client.network.ClientPlayerEntity'].prototype.jump = function() { _mockGameState.player.y += 1.25; };
Java._types['net.minecraft.client.network.ClientPlayerEntity'].prototype.setSprinting = function(v) { this._sprinting = v; _mockGameState.player.sprinting = v; };
Java._types['net.minecraft.client.network.ClientPlayerEntity'].prototype.setSneaking = function(v) { this._sneaking = v; _mockGameState.player.sneaking = v; };
Java._types['net.minecraft.client.network.ClientPlayerEntity'].prototype.swingHand = function(h) { _mockGameState.player.lastSwingHand = h; };
Java._types['net.minecraft.client.network.ClientPlayerEntity'].prototype.sendChatMessage = function(m) { _mockGameState.player.lastChatMessage = m; };
Java._types['net.minecraft.client.network.ClientPlayerEntity'].prototype.raycast = function() {
  if (_mockGameState.player.raycastResult) return _mockGameState.player.raycastResult;
  return new (Java._types['net.minecraft.util.hit.HitResult'])(
    Java._types['net.minecraft.util.hit.HitResult.Type'].MISS,
    new (Java._types['net.minecraft.util.math.Vec3d'])(0, 0, 0));
};
Java._types['net.minecraft.client.network.ClientPlayerEntity'].prototype.getPos = function() {
  return new (Java._types['net.minecraft.util.math.Vec3d'])(_mockGameState.player.x, _mockGameState.player.y, _mockGameState.player.z);
};
Java._types['net.minecraft.client.network.ClientPlayerEntity'].prototype.getYaw = function() { return _mockGameState.player.yaw; };
Java._types['net.minecraft.client.network.ClientPlayerEntity'].prototype.getPitch = function() { return _mockGameState.player.pitch; };
Java._types['net.minecraft.client.network.ClientPlayerEntity'].prototype.isOnGround = function() { return _mockGameState.player.onGround; };
Java._types['net.minecraft.client.network.ClientPlayerEntity'].prototype.getInventory = function() { return this._inventory; };

// Packet types
Java._types['net.minecraft.network.packet.c2s.play.PlayerMoveC2SPacket$PositionAndOnGround'] = function(x, y, z, g) {
  this.x = x; this.y = y; this.z = z; this.g = g;
};
Java._types['net.minecraft.network.packet.c2s.play.PlayerMoveC2SPacket$LookAndOnGround'] = function(yaw, pitch, g) {
  this.yaw = yaw; this.pitch = pitch; this.g = g;
};

Java._types['net.minecraft.world.RegistryKey'] = function(v) { this._v = v; };
Java._types['net.minecraft.world.RegistryKey'].prototype.getValue = function() { return this._v; };

Java._types['net.minecraft.world.World'] = function() {
  this._blocks = _mockGameState.world.blocks;
  this._timeOfDay = _mockGameState.world.timeOfDay;
  this._regKey = new (Java._types['net.minecraft.world.RegistryKey'])(
    new (Java._types['net.minecraft.util.Identifier'])('minecraft', _mockGameState.world.dimension.split(':')[1]));
};
Java._types['net.minecraft.world.World'].prototype.getBlockState = function(pos) {
  var k = pos.x + ',' + pos.y + ',' + pos.z;
  return this._blocks[k] || new (Java._types['net.minecraft.block.BlockState'])(
    new (Java._types['net.minecraft.block.Block'])('minecraft.air', 'Air'));
};
Java._types['net.minecraft.world.World'].prototype.getTimeOfDay = function() { return this._timeOfDay; };
Java._types['net.minecraft.world.World'].prototype.getRegistryKey = function() { return this._regKey; };

var _lastInteractItem = null;
Java._types['net.minecraft.client.MinecraftClient$InteractionManager'] = function() {};
Java._types['net.minecraft.client.MinecraftClient$InteractionManager'].prototype.interactItem = function(p, w, h) {
  _lastInteractItem = { player: p, world: w, hand: h };
};

Java._types['net.minecraft.client.MinecraftClient'] = function() {
  this.player = null; this.world = null; this.interactionManager = null;
  this.runDirectory = { toPath: function() { return { resolve: function(p) { return { toString: function() { return '/mock-dir/' + p; }, toAbsolutePath: function() { return { toString: function() { return '/' + p; } }; }, getParent: function() { return { toString: function() { return '/config'; } }; } }; } }; } };
};
Java._types['net.minecraft.client.MinecraftClient'].prototype.execute = function(fn) { fn(); };
Java._types['net.minecraft.client.MinecraftClient'].getInstance = function() {
  if (!Java._types['net.minecraft.client.MinecraftClient']._inst)
    Java._types['net.minecraft.client.MinecraftClient']._inst = new Java._types['net.minecraft.client.MinecraftClient']();
  return Java._types['net.minecraft.client.MinecraftClient']._inst;
};

function _initMockClient() {
  var C = Java._types['net.minecraft.client.MinecraftClient'].getInstance();
  C.player = new Java._types['net.minecraft.client.network.ClientPlayerEntity']();
  C.world = new Java._types['net.minecraft.world.World']();
  C.interactionManager = new Java._types['net.minecraft.client.MinecraftClient$InteractionManager']();

  var inv = C.player._inventory;
  var di = new Java._types['net.minecraft.item.Item']('block.minecraft.dirt', 'Dirt');
  var st = new Java._types['net.minecraft.item.Item']('block.minecraft.cobblestone', 'Cobblestone');
  var pk = new Java._types['net.minecraft.item.Item']('item.minecraft.stone_pickaxe', 'Stone Pickaxe');
  var dm = new Java._types['net.minecraft.item.Item']('item.minecraft.diamond', 'Diamond');
  var hl = new Java._types['net.minecraft.item.Item']('item.minecraft.diamond_helmet', 'Diamond Helmet');
  var sh = new Java._types['net.minecraft.item.Item']('item.minecraft.shield', 'Shield');

  inv.main.set(0, new Java._types['net.minecraft.item.ItemStack'](di, 64));
  inv.main.set(1, new Java._types['net.minecraft.item.ItemStack'](pk, 1));
  inv.main.set(2, new Java._types['net.minecraft.item.ItemStack'](st, 32));
  inv.main.set(3, new Java._types['net.minecraft.item.ItemStack'](dm, 8));
  inv.armor.set(0, new Java._types['net.minecraft.item.ItemStack'](hl, 1));
  inv.offHand.set(0, new Java._types['net.minecraft.item.ItemStack'](sh, 1));

  C.world._blocks['0,63,0'] = new Java._types['net.minecraft.block.BlockState'](
    new Java._types['net.minecraft.block.Block']('block.minecraft.grass_block', 'Grass Block'));
  C.world._blocks['0,62,0'] = new Java._types['net.minecraft.block.BlockState'](
    new Java._types['net.minecraft.block.Block']('block.minecraft.stone', 'Stone'));
  C.world._blocks['5,63,5'] = new Java._types['net.minecraft.block.BlockState'](
    new Java._types['net.minecraft.block.Block']('block.minecraft.diamond_ore', 'Diamond Ore'));
  C.world._blocks['0,64,0'] = new Java._types['net.minecraft.block.BlockState'](
    new Java._types['net.minecraft.block.Block']('minecraft.air', 'Air'));

  return C;
}

// =============================================================================
// SECTION 4: Set up globals and load autobridge
// =============================================================================

globalThis.Java = Java;
_initMockClient();

var autobridgeLoaded = false;
try {
  require('/root/autobridge/autobridge.js');
  autobridgeLoaded = true;
} catch (e) {
  console.error('[simulator] Failed to load autobridge.js:', e.message);
}

// =============================================================================
// SECTION 5: Capture responses and fake Date.now
// =============================================================================

var _capturedResponses = {};
var _allResponses = [];
var _fakeNow = 1000000;
var _realDateNow = Date.now;
Date.now = function() { return _fakeNow; };
function advanceTime(ms) { _fakeNow += ms; }

if (globalThis.__bridge && globalThis.__bridge.ws) {
  globalThis.__bridge.ws.send = function(connId, msg) {
    if (!_capturedResponses[connId]) _capturedResponses[connId] = [];
    var parsed = typeof msg === 'string' ? JSON.parse(msg) : msg;
    _capturedResponses[connId].push(parsed);
    _allResponses.push({ connId: connId, response: parsed });
  };
}

// =============================================================================
// SECTION 6: Simulation helpers
// =============================================================================

var _msgIdCounter = 1;

function simulateCommand(connId, type, payload) {
  advanceTime(50); // Ensure rate limit is not hit
  var msg = { id: _msgIdCounter++, type: type, payload: payload || {} };
  if (globalThis.__bridge && globalThis.__bridge.ws && globalThis.__bridge.ws.onMessage) {
    globalThis.__bridge.ws.onMessage(connId, JSON.stringify(msg));
  }
  var responses = _capturedResponses[connId] || [];
  return responses.length > 0 ? responses[responses.length - 1] : null;
}

function simulateRaw(connId, rawStr) {
  advanceTime(50);
  if (globalThis.__bridge && globalThis.__bridge.ws && globalThis.__bridge.ws.onMessage) {
    globalThis.__bridge.ws.onMessage(connId, rawStr);
  }
  var responses = _capturedResponses[connId] || [];
  return responses.length > 0 ? responses[responses.length - 1] : null;
}

function clearAllResponses() {
  _capturedResponses = {};
  _allResponses = [];
  _msgIdCounter = 1;
  _fakeNow = 1000000;
}

// =============================================================================
// SECTION 7: Reset game state
// =============================================================================

function resetGameState() {
  _mockGameState.player.x = 0; _mockGameState.player.y = 64; _mockGameState.player.z = 0;
  _mockGameState.player.yaw = 0; _mockGameState.player.pitch = 0; _mockGameState.player.onGround = true;
  _mockGameState.player.sprinting = false; _mockGameState.player.sneaking = false;
  _mockGameState.player.lastSwingHand = null; _mockGameState.player.lastChatMessage = null;
  _mockGameState.player.raycastResult = null;
  _lastInteractItem = null; _lastSentPacket = null; _sentPackets = [];

  var inv = Java._types['net.minecraft.client.MinecraftClient'].getInstance().player.getInventory();
  for (var i = 0; i < 36; i++) inv.main.set(i, _createEmptyStack());
  for (var i = 0; i < 4; i++) inv.armor.set(i, _createEmptyStack());
  inv.offHand.set(0, _createEmptyStack());

  var di = new Java._types['net.minecraft.item.Item']('block.minecraft.dirt', 'Dirt');
  var st = new Java._types['net.minecraft.item.Item']('block.minecraft.cobblestone', 'Cobblestone');
  var pk = new Java._types['net.minecraft.item.Item']('item.minecraft.stone_pickaxe', 'Stone Pickaxe');
  var dm = new Java._types['net.minecraft.item.Item']('item.minecraft.diamond', 'Diamond');
  var hl = new Java._types['net.minecraft.item.Item']('item.minecraft.diamond_helmet', 'Diamond Helmet');
  var sh = new Java._types['net.minecraft.item.Item']('item.minecraft.shield', 'Shield');

  inv.main.set(0, new Java._types['net.minecraft.item.ItemStack'](di, 64));
  inv.main.set(1, new Java._types['net.minecraft.item.ItemStack'](pk, 1));
  inv.main.set(2, new Java._types['net.minecraft.item.ItemStack'](st, 32));
  inv.main.set(3, new Java._types['net.minecraft.item.ItemStack'](dm, 8));
  inv.armor.set(0, new Java._types['net.minecraft.item.ItemStack'](hl, 1));
  inv.offHand.set(0, new Java._types['net.minecraft.item.ItemStack'](sh, 1));

  _mockGameState.world.timeOfDay = 6000;
}

// =============================================================================
// SECTION 8: Test Framework
// =============================================================================

var _tests = [];
var _passed = 0;
var _failed = 0;
var _categories = {};

function test(category, name, fn) {
  if (!_categories[category]) _categories[category] = [];
  _categories[category].push({ name: name, fn: fn });
  _tests.push({ category: category, name: name, fn: fn });
}

function assert(c, m) { if (!c) throw new Error('Assertion failed: ' + (m || '')); }
function assertEquals(a, e, m) {
  if (a !== e) throw new Error((m || 'assertEquals') + ': expected ' + JSON.stringify(e) + ' but got ' + JSON.stringify(a));
}
function assertNotNull(v, m) {
  if (v === null || v === undefined) throw new Error((m || 'assertNotNull') + ': value is null/undefined');
}

function runAllTests() {
  console.log('');
  for (var i = 0; i < _tests.length; i++) {
    var t = _tests[i];
    resetGameState();
    clearAllResponses();
    var connId = 'test_' + (i + 1);
    try {
      t.fn(connId);
      _passed++;
      console.log('[' + t.category + '] ' + t.name + ' ... PASS');
    } catch (e) {
      _failed++;
      console.log('[' + t.category + '] ' + t.name + ' ... FAIL');
      console.log('        ' + e.message);
    }
  }
  console.log('');
  console.log('========================================');
  console.log('Total: ' + (_passed + _failed) + ' tests | PASS: ' + _passed + ' | FAIL: ' + _failed);
  if (_failed > 0) process.exit(1);
}

// =============================================================================
// SECTION 9: Test Cases
// =============================================================================

// --- MOVE ---
test('MOVE', 'Test valid move with x/y/z', function(c) {
  var r = simulateCommand(c, 'move', { x: 10, y: 65, z: 20 });
  assertEquals(r.type, 'move');
  assertEquals(r.result.success, true);
  assertEquals(_sentPackets.length, 1);
});

test('MOVE', 'Test invalid move (missing x)', function(c) {
  var r = simulateCommand(c, 'move', { y: 65, z: 20 });
  assertEquals(r.result.success, false);
  assertNotNull(r.result.error);
});

test('MOVE', 'Test invalid move (string x)', function(c) {
  var r = simulateCommand(c, 'move', { x: 'abc', y: 65, z: 20 });
  assertEquals(r.result.success, false);
});

// --- LOOK ---
test('LOOK', 'Test valid look with yaw/pitch', function(c) {
  var r = simulateCommand(c, 'look', { yaw: 90, pitch: -45 });
  assertEquals(r.type, 'look');
  assertEquals(r.result.success, true);
  assertEquals(_sentPackets.length, 1);
});

test('LOOK', 'Test invalid look (missing pitch)', function(c) {
  var r = simulateCommand(c, 'look', { yaw: 90 });
  assertEquals(r.result.success, false);
});

// --- JUMP ---
test('JUMP', 'Test jump', function(c) {
  var r = simulateCommand(c, 'jump', {});
  assertEquals(r.result.success, true);
  var C = Java._types['net.minecraft.client.MinecraftClient'].getInstance();
  assertEquals(C.player.getPos().y, 65.25);
});

// --- SPRINT ---
test('SPRINT', 'Test sprint enable', function(c) {
  var r = simulateCommand(c, 'sprint', { state: true });
  assertEquals(r.result.success, true);
  assertEquals(_mockGameState.player.sprinting, true);
});

test('SPRINT', 'Test sprint disable', function(c) {
  var r = simulateCommand(c, 'sprint', { state: false });
  assertEquals(r.result.success, true);
  assertEquals(_mockGameState.player.sprinting, false);
});

// --- SNEAK ---
test('SNEAK', 'Test sneak enable', function(c) {
  var r = simulateCommand(c, 'sneak', { state: true });
  assertEquals(r.result.success, true);
  assertEquals(_mockGameState.player.sneaking, true);
});

// --- ATTACK ---
test('ATTACK', 'Test attack', function(c) {
  var r = simulateCommand(c, 'attack', {});
  assertEquals(r.result.success, true);
  assertEquals(_mockGameState.player.lastSwingHand, 'MAIN_HAND');
});

// --- USE ---
test('USE', 'Test use', function(c) {
  var r = simulateCommand(c, 'use', {});
  assertEquals(r.result.success, true);
  assertNotNull(_lastInteractItem);
});

// --- SENDCHAT ---
test('SENDCHAT', 'Test sendChat with valid message', function(c) {
  var r = simulateCommand(c, 'sendChat', { message: 'hello' });
  assertEquals(r.result.success, true);
  assertEquals(_mockGameState.player.lastChatMessage, 'hello');
});

test('SENDCHAT', 'Test sendChat with empty message', function(c) {
  var r = simulateCommand(c, 'sendChat', { message: '' });
  assertEquals(r.result.success, false);
});

test('SENDCHAT', 'Test sendChat with missing message', function(c) {
  var r = simulateCommand(c, 'sendChat', {});
  assertEquals(r.result.success, false);
});

// --- GETBLOCK ---
test('GETBLOCK', 'Test getBlock grass_block at (0,63,0)', function(c) {
  var r = simulateCommand(c, 'getBlock', { x: 0, y: 63, z: 0 });
  assertEquals(r.result.success, true);
  assertEquals(r.result.blockId, 'block.minecraft.grass_block');
  assertEquals(r.result.blockName, 'Grass Block');
});

test('GETBLOCK', 'Test getBlock stone at (0,62,0)', function(c) {
  var r = simulateCommand(c, 'getBlock', { x: 0, y: 62, z: 0 });
  assertEquals(r.result.success, true);
  assertEquals(r.result.blockId, 'block.minecraft.stone');
});

test('GETBLOCK', 'Test getBlock diamond_ore at (5,63,5)', function(c) {
  var r = simulateCommand(c, 'getBlock', { x: 5, y: 63, z: 5 });
  assertEquals(r.result.success, true);
  assertEquals(r.result.blockId, 'block.minecraft.diamond_ore');
});

test('GETBLOCK', 'Test getBlock air at (0,0,0)', function(c) {
  var r = simulateCommand(c, 'getBlock', { x: 0, y: 0, z: 0 });
  assertEquals(r.result.success, true);
  assertEquals(r.result.blockId, 'minecraft.air');
});

// --- RAYCAST ---
test('RAYCAST', 'Test raycast miss', function(c) {
  _mockGameState.player.raycastResult = new Java._types['net.minecraft.util.hit.HitResult'](
    Java._types['net.minecraft.util.hit.HitResult.Type'].MISS,
    new Java._types['net.minecraft.util.math.Vec3d'](0, 0, 0));
  var r = simulateCommand(c, 'raycast', { maxDistance: 5.0 });
  assertEquals(r.result.success, true);
  assertEquals(r.result.hit, false);
});

test('RAYCAST', 'Test raycast hit block', function(c) {
  _mockGameState.player.raycastResult = new Java._types['net.minecraft.util.hit.HitResult'](
    Java._types['net.minecraft.util.hit.HitResult.Type'].BLOCK,
    new Java._types['net.minecraft.util.math.Vec3d'](1.5, 63.0, 2.5));
  var r = simulateCommand(c, 'raycast', { maxDistance: 5.0 });
  assertEquals(r.result.success, true);
  assertEquals(r.result.hit, true);
  assertEquals(r.result.x, 1.5);
  assertEquals(r.result.y, 63.0);
  assertEquals(r.result.z, 2.5);
});

test('RAYCAST', 'Test raycast error handling (no world)', function(c) {
  var C = Java._types['net.minecraft.client.MinecraftClient'].getInstance();
  var savedWorld = C.world;
  C.world = null;
  try {
    var r = simulateCommand(c, 'raycast', { maxDistance: 5.0 });
    assertEquals(r.result.success, false);
  } finally {
    C.world = savedWorld;
  }
});

// --- GETPOSITION ---
test('GETPOSITION', 'Test getPosition returns x/y/z/yaw/pitch', function(c) {
  var r = simulateCommand(c, 'getPosition', {});
  assertEquals(r.result.success, true);
  assertEquals(r.result.x, 0);
  assertEquals(r.result.y, 64);
  assertEquals(r.result.z, 0);
  assertEquals(r.result.yaw, 0);
  assertEquals(r.result.pitch, 0);
  assertEquals(r.result.onGround, true);
  assertEquals(r.result.dimension, 'minecraft:overworld');
});

// --- GETTIME ---
test('GETTIME', 'Test getTime returns time', function(c) {
  var r = simulateCommand(c, 'getTime', {});
  assertEquals(r.result.success, true);
  assertEquals(r.result.time, 6000);
});

// --- GETINVENTORY ---
test('GETINVENTORY', 'Test getInventory returns slots', function(c) {
  var r = simulateCommand(c, 'getInventory', {});
  assertEquals(r.result.success, true);
  assertNotNull(r.result.slots);
  assert(r.result.slots.length > 0, 'Should have items');

  var dirt = r.result.slots.find(function(s) { return s.slot === 0; });
  assertNotNull(dirt, 'Dirt at slot 0');
  assertEquals(dirt.itemId, 'block.minecraft.dirt');
  assertEquals(dirt.count, 64);
  assertEquals(dirt.slotType, 'main');
});

// --- GETITEM ---
test('GETITEM', 'Test getItem slot 0 (dirt)', function(c) {
  var r = simulateCommand(c, 'getItem', { slot: 0 });
  assertEquals(r.result.success, true);
  assertEquals(r.result.slot, 0);
  assertEquals(r.result.itemId, 'block.minecraft.dirt');
  assertEquals(r.result.count, 64);
  assertEquals(r.result.name, 'Dirt');
});

test('GETITEM', 'Test getItem slot 1 (pickaxe)', function(c) {
  var r = simulateCommand(c, 'getItem', { slot: 1 });
  assertEquals(r.result.success, true);
  assertEquals(r.result.slot, 1);
  assertEquals(r.result.itemId, 'item.minecraft.stone_pickaxe');
  assertEquals(r.result.count, 1);
});

test('GETITEM', 'Test getItem slot 9 (empty)', function(c) {
  var r = simulateCommand(c, 'getItem', { slot: 9 });
  assertEquals(r.result.success, true);
  assertEquals(r.result.slot, 9);
  assertEquals(r.result.itemId, null);
  assertEquals(r.result.count, 0);
});

test('GETITEM', 'Test getItem invalid slot (99)', function(c) {
  var r = simulateCommand(c, 'getItem', { slot: 99 });
  assertEquals(r.result.success, false);
  assertNotNull(r.result.error);
});

test('GETITEM', 'Test getItem invalid slot (-1)', function(c) {
  var r = simulateCommand(c, 'getItem', { slot: -1 });
  assertEquals(r.result.success, false);
});

// --- MOVEITEM ---
test('MOVEITEM', 'Test moveItem swap from:0 to:2', function(c) {
  var r = simulateCommand(c, 'moveItem', { from: 0, to: 2 });
  assertEquals(r.result.success, true);

  var slot0 = simulateCommand(c, 'getItem', { slot: 0 });
  assertEquals(slot0.result.itemId, 'block.minecraft.cobblestone');

  var slot2 = simulateCommand(c, 'getItem', { slot: 2 });
  assertEquals(slot2.result.itemId, 'block.minecraft.dirt');
});

test('MOVEITEM', 'Test moveItem invalid slot', function(c) {
  var r = simulateCommand(c, 'moveItem', { from: -1, to: 5 });
  assertEquals(r.result.success, false);
});

// --- AUTH ---
test('AUTH', 'Test auth required before command', function(c) {
  globalThis.__bridge._config.apiKey = 'test-key-123';
  var r = simulateCommand(c, 'getPosition', {});
  assertEquals(r.type, 'error');
  assertEquals(r.error.code, 4001);
  globalThis.__bridge._config.apiKey = '';
  globalThis.__bridge._authMap.clear();
});

test('AUTH', 'Test auth with wrong key', function(c) {
  globalThis.__bridge._config.apiKey = 'test-key-123';
  var r = simulateCommand(c, 'auth', { apiKey: 'wrong-key' });
  assertEquals(r.type, 'error');
  assertEquals(r.error.code, 4002);
  globalThis.__bridge._config.apiKey = '';
  globalThis.__bridge._authMap.clear();
});

test('AUTH', 'Test auth with correct key', function(c) {
  globalThis.__bridge._config.apiKey = 'test-key-123';
  var r = simulateCommand(c, 'auth', { apiKey: 'test-key-123' });
  assertEquals(r.type, 'auth');
  assertEquals(r.result.success, true);
  globalThis.__bridge._config.apiKey = '';
  globalThis.__bridge._authMap.clear();
});

test('AUTH', 'Test command works after auth', function(c) {
  globalThis.__bridge._config.apiKey = 'test-key-123';
  simulateCommand(c, 'auth', { apiKey: 'test-key-123' });
  var r = simulateCommand(c, 'getPosition', {});
  assertEquals(r.type, 'getPosition');
  assertEquals(r.result.success, true);
  globalThis.__bridge._config.apiKey = '';
  globalThis.__bridge._authMap.clear();
});

// --- RATE LIMIT ---
test('RATELIMIT', 'Test rate limit with rapid commands', function(c) {
  globalThis.__bridge._config.rateLimit = 1;
  clearAllResponses();
  _fakeNow = 2000000;

  simulateCommand(c, 'jump', {});
  _fakeNow = 2000000; // Same timestamp
  var second = simulateCommand(c, 'jump', {});
  _fakeNow = 2000000; // Same timestamp
  var third = simulateCommand(c, 'jump', {});

  var responses = _capturedResponses[c] || [];
  var rateLimited = responses.filter(function(r) { return r.error && r.error.code === 429; });
  assert(rateLimited.length >= 1, 'At least 1 rate limited response expected, got ' + rateLimited.length);

  globalThis.__bridge._config.rateLimit = 200;
});

// --- UNKNOWN COMMAND ---
test('ERROR', 'Test unknown command returns error', function(c) {
  var r = simulateCommand(c, 'nonexistent_command', {});
  assertEquals(r.type, 'error');
  assertEquals(r.error.code, -32601);
});

// --- PARSE ERROR ---
test('ERROR', 'Test malformed JSON returns parse error', function(c) {
  var r = simulateRaw(c, 'not-json');
  assertEquals(r.type, 'error');
  assertEquals(r.error.code, -32700);
});

// --- MISSING TYPE ---
test('ERROR', 'Test missing type field returns error', function(c) {
  var r = simulateRaw(c, JSON.stringify({ id: 1, payload: {} }));
  assertEquals(r.type, 'error');
  assertEquals(r.error.code, -32602);
});

// =============================================================================
// SECTION 10: Run
// =============================================================================

if (!autobridgeLoaded) {
  console.error('Cannot run tests: autobridge.js failed to load');
  process.exit(1);
}

runAllTests();
