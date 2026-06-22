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

function readFrameInfo(in) {
  var b = in.read();
  if (b < 0) return null;
  var masked = (b & 0x80) !== 0;
  var len = b & 0x7F;
  if (len === 126) {
    var hi = in.read();
    var lo = in.read();
    if (hi < 0 || lo < 0) return null;
    len = (hi << 8) | lo;
  } else if (len === 127) {
    len = 0;
    for (var i = 0; i < 8; i++) {
      var c = in.read();
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
