'use strict';

/* ═══════════════════════════════════════════════════════════════
   realtime-hub.js  —  SharedWorker WebSocket Connection Manager
   ═══════════════════════════════════════════════════════════════
   ONE WebSocket per origin.  All tabs share it via MessagePort.

   Protocol (tab → hub):
     { type: 'subscribe' }          — register port for events
     { type: 'unsubscribe' }        — remove port, close WS if no ports left
     { type: 'ping' }               — health-check from tab

   Protocol (hub → tab):
     { type: 'stream-status', state: 'connecting'|'open'|'close'|'error' }
     { channel: '...', ... }        — forwarded server events
   ═══════════════════════════════════════════════════════════════ */

const WS_PATH = '/api/realtime/ws';

// ── connection state ────────────────────────────────────────────
const ports = new Set();
let ws = null;
let wsState = 'closed'; // 'connecting' | 'open' | 'closed'
let reconnectTimer = null;
let reconnectDelay = 1000;
const RECONNECT_CAP = 30000;
const HEARTBEAT_INTERVAL = 25000;
let heartbeatTimer = null;
let lastOwnershipEventId = '';

// ── helpers ─────────────────────────────────────────────────────

function broadcast(msg) {
  const dead = [];
  for (const p of ports) {
    try { p.postMessage(msg); }
    catch (_) { dead.push(p); }
  }
  for (const p of dead) ports.delete(p);
}

function statusMsg(state) {
  return { type: 'stream-status', state, ts: Date.now() };
}

function buildWsUrl() {
  const proto = self.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = `${proto}//${self.location.host}${WS_PATH}`;
  return lastOwnershipEventId ? `${base}?last_event_id=${encodeURIComponent(lastOwnershipEventId)}` : base;
}

// ── heartbeat & watchdog ─────────────────────────────────────────

let watchdogTimer = null;
const WATCHDOG_TIMEOUT = 35000;

function resetWatchdog() {
  if (watchdogTimer) clearTimeout(watchdogTimer);
  watchdogTimer = setTimeout(() => {
    // If watchdog triggers, the connection is silently dead
    closeSocket();
    scheduleReconnect();
  }, WATCHDOG_TIMEOUT);
}

function startHeartbeat() {
  stopHeartbeat();
  resetWatchdog();
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'heartbeat' })); }
      catch (_) { /* send failure will trigger onerror/onclose */ }
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
}

// ── WebSocket lifecycle ─────────────────────────────────────────

function closeSocket() {
  stopHeartbeat();
  if (!ws) return;
  try {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    ws.close();
  } catch (_) { /* ignore */ }
  ws = null;
  wsState = 'closed';
}

function scheduleReconnect() {
  if (reconnectTimer || ports.size === 0) return;
  const delay = reconnectDelay;
  reconnectDelay = Math.min(delay * 2, RECONNECT_CAP);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  if (ws || ports.size === 0 || typeof WebSocket === 'undefined') return;

  wsState = 'connecting';
  broadcast(statusMsg('connecting'));

  const url = buildWsUrl();

  try { ws = new WebSocket(url); }
  catch (_) { ws = null; wsState = 'closed'; scheduleReconnect(); return; }

  ws.onopen = () => {
    wsState = 'open';
    reconnectDelay = 1000;          // reset backoff
    broadcast(statusMsg('open'));
    startHeartbeat();
  };

  ws.onmessage = (evt) => {
    resetWatchdog();
    if (typeof evt.data !== 'string') return;
    let msg;
    try { msg = JSON.parse(evt.data); } catch (_) { return; }
    if (msg && msg.eventId) lastOwnershipEventId = msg.eventId;
    // System pings are connection-health — don't relay to tabs
    if (msg.type === 'ping' && msg.channel === 'system') return;
    broadcast(msg);
  };

  ws.onerror = () => {
    broadcast(statusMsg('error'));
  };

  ws.onclose = () => {
    ws = null;
    wsState = 'closed';
    stopHeartbeat();
    broadcast(statusMsg('close'));
    scheduleReconnect();
  };
}

// ── port management ─────────────────────────────────────────────

function removePort(port) {
  ports.delete(port);
  if (ports.size === 0) {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectDelay = 1000;
    closeSocket();
  }
}

// ── SharedWorker entry point ────────────────────────────────────

self.onconnect = (evt) => {
  const port = evt.ports[0];
  ports.add(port);
  try { port.start(); } catch (_) { /* older browsers */ }

  // Send current status immediately
  const state = wsState === 'open' ? 'open' : wsState === 'connecting' ? 'connecting' : 'ready';
  try { port.postMessage(statusMsg(state)); } catch (_) { /* dead port */ }

  // Ensure connection exists
  if (!ws && wsState !== 'connecting') connect();

  port.onmessage = (msgEvt) => {
    const data = msgEvt.data || {};
    if (data.type === 'unsubscribe') { removePort(port); return; }
    if (data.type === 'subscribe')   {
      if (data.lastEventId) lastOwnershipEventId = data.lastEventId;
      if (!ws && wsState !== 'connecting') connect();
      return;
    }
    if (data.type === 'ping')        { try { port.postMessage(statusMsg(wsState === 'open' ? 'open' : 'connecting')); } catch (_) {} return; }
  };

  port.onmessageerror = () => removePort(port);
};
