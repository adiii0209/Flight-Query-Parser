'use strict';

const HUB_URL = '/api/realtime/ws';
const HUB_NAME = 'realtime-hub-v2';

const ports = new Set();
let socket = null;
let reconnectTimer = null;
let reconnectBackoffMs = 1000;

function safeParse(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function safeSend(port, message) {
  try {
    port.postMessage(message);
  } catch (err) {
    // Ignore dead ports.
  }
}

function broadcast(message) {
  const payload = {
    ...message,
    senderId: 'realtime-hub',
    timestamp: Date.now(),
  };
  const deadPorts = [];
  for (const port of ports) {
    try {
      port.postMessage(payload);
    } catch (err) {
      deadPorts.push(port);
    }
  }
  for (const port of deadPorts) {
    ports.delete(port);
  }
}

function closeSocket() {
  if (!socket) return;
  try {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.close();
  } catch (err) {
    // Ignore close failures.
  }
  socket = null;
}

function scheduleReconnect() {
  if (reconnectTimer || ports.size === 0) return;
  const delay = reconnectBackoffMs;
  reconnectBackoffMs = Math.min(Math.max(delay * 2, 1000), 30000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectSocket();
  }, delay);
}

function connectSocket() {
  if (socket || ports.size === 0 || typeof WebSocket === 'undefined') return;

  const protocol = self.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socketUrl = `${protocol}//${self.location.host}${HUB_URL}`;

  try {
    socket = new WebSocket(socketUrl);
  } catch (err) {
    socket = null;
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    reconnectBackoffMs = 1000;
    broadcast({ type: 'stream-status', state: 'open' });
  };

  socket.onmessage = (event) => {
    const message = safeParse(event?.data);
    if (!message) return;
    if (message.type === 'ping' || message.channel === 'system') {
      return;
    }
    broadcast(message);
  };

  socket.onerror = () => {
    broadcast({ type: 'stream-status', state: 'error' });
  };

  socket.onclose = () => {
    socket = null;
    broadcast({ type: 'stream-status', state: 'close' });
    scheduleReconnect();
  };
}

function ensureSocket() {
  if (socket || ports.size === 0) return;
  connectSocket();
}

function removePort(port) {
  if (!ports.has(port)) return;
  ports.delete(port);
  if (ports.size === 0) {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectBackoffMs = 1000;
    closeSocket();
  }
}

self.onconnect = (event) => {
  const port = event.ports[0];
  ports.add(port);

  try {
    port.start();
  } catch (err) {
    // Older browsers may not need explicit start().
  }

  safeSend(port, { type: 'stream-status', state: 'ready', senderId: 'realtime-hub', timestamp: Date.now() });
  ensureSocket();

  port.onmessage = (messageEvent) => {
    const data = messageEvent?.data || {};
    if (data.type === 'unsubscribe') {
      removePort(port);
      return;
    }
    if (data.type === 'subscribe') {
      ensureSocket();
      return;
    }
  };

  port.onmessageerror = () => {
    removePort(port);
  };
};
