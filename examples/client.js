#!/usr/bin/env node
const WebSocket = require('ws');
const readline = require('readline');

const HOST = process.env.AUTOBRIDGE_HOST || '127.0.0.1';
const PORT = parseInt(process.env.AUTOBRIDGE_PORT || '8765');
const API_KEY = process.env.AUTOBRIDGE_API_KEY || '';

let ws;
let reqId = 0;
const pending = new Map();
let connected = false;
let retries = 0;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;
let repl = null;

function connect() {
  ws = new WebSocket(`ws://${HOST}:${PORT}`);
  ws.on('open', () => {
    connected = true;
    retries = 0;
    console.log('[Connected]');
    if (API_KEY) auth();
    startRepl();
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.event) {
      console.log(`\n[EVENT] ${msg.event}:`, JSON.stringify(msg.data));
    } else if (msg.id && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    } else {
      console.log('[Response]', JSON.stringify(msg, null, 2));
    }
  });
  ws.on('close', () => {
    connected = false;
    console.log('[Disconnected]');
    for (const [id, { reject }] of pending) {
      pending.delete(id);
      reject(new Error('Disconnected'));
    }
    if (retries < MAX_RETRIES) {
      retries++;
      console.log(`[Reconnect] attempt ${retries}/${MAX_RETRIES} in ${RETRY_DELAY}ms`);
      setTimeout(connect, RETRY_DELAY);
    } else {
      console.log('[Reconnect] max retries reached. Exiting.');
      if (repl) repl.close();
      process.exit(1);
    }
  });
  ws.on('error', (err) => console.error('[Error]', err.message));
}

function auth() {
  send('auth', { apiKey: API_KEY }).then(r => {
    if (r.result?.success) console.log('[Authenticated]');
    else console.error('[Auth failed]', r.error);
  });
}

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!connected || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('Not connected'));
      return;
    }
    const id = ++reqId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, type, payload }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('Timeout'));
      }
    }, 30000);
  });
}

function startRepl() {
  if (repl) return;
  repl = readline.createInterface({ input: process.stdin });
  repl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const parts = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g);
    const type = parts[0];
    let payload = {};
    if (parts.length > 1) {
      const rest = parts.slice(1).join(' ');
      try { payload = JSON.parse(rest); }
      catch { payload = {}; }
    }
    try {
      const res = await send(type, payload);
      console.log(JSON.stringify(res, null, 2));
    } catch (err) {
      console.error('[Error]', err.message);
    }
  });
}

connect();
