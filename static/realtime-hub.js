'use strict';

const channels = new Set();
const portSubscriptions = new WeakMap();
const feeds = {
  ownership: {
    url: '/api/ownership/stream',
    source: null,
    subscribers: 0,
  },
  tickets: {
    url: '/api/tickets/stream',
    source: null,
    subscribers: 0,
  },
};

function safeParse(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function safePost(port, message) {
  try {
    port.postMessage(message);
  } catch (err) {
    // Ignore disconnected ports.
  }
}

function broadcast(channel, message) {
  const payload = {
    ...message,
    channel,
    senderId: 'realtime-hub',
    timestamp: Date.now(),
  };
  const deadPorts = [];
  for (const port of channels) {
    try {
      port.postMessage(payload);
    } catch (err) {
      deadPorts.push(port);
    }
  }
  for (const port of deadPorts) {
    removePort(port);
  }
}

function closeFeed(channel) {
  const feed = feeds[channel];
  if (!feed || !feed.source) return;
  try {
    feed.source.close();
  } catch (err) {
    // Ignore close failures.
  }
  feed.source = null;
}

function ensureFeed(channel) {
  const feed = feeds[channel];
  if (!feed || feed.source || feed.subscribers <= 0) return;

  const stream = new EventSource(feed.url);
  feed.source = stream;

  if (channel === 'ownership') {
    stream.onopen = () => {
      broadcast(channel, { type: 'stream-status', state: 'open' });
    };

    stream.addEventListener('ready', (event) => {
      const payload = safeParse(event?.data);
      broadcast(channel, { type: 'ownership-event', payload: { event: 'ready', version: payload?.version || 0 } });
    });

    stream.addEventListener('ownership', (event) => {
      const payload = safeParse(event?.data);
      if (!payload) return;
      broadcast(channel, { type: 'ownership-event', payload });
    });

    stream.addEventListener('ping', () => {
      // Keepalive only. The shared worker owns reconnection for the tabs.
    });

    stream.onmessage = (event) => {
      const payload = safeParse(event?.data);
      if (payload && payload.event === 'connected') {
        broadcast(channel, { type: 'ownership-event', payload: { event: 'ready', version: payload.version || 0 } });
      }
    };
  } else if (channel === 'tickets') {
    stream.onopen = () => {
      broadcast(channel, { type: 'stream-status', state: 'open' });
    };

    stream.onmessage = (event) => {
      const payload = safeParse(event?.data);
      if (!payload) return;
      broadcast(channel, { type: 'tickets-event', payload });
    };

    stream.addEventListener('ping', () => {
      // Keepalive only.
    });
  }

  stream.onerror = () => {
    broadcast(channel, { type: 'stream-status', state: 'error' });
    if (stream.readyState === EventSource.CLOSED) {
      closeFeed(channel);
      if (feed.subscribers > 0) {
        setTimeout(() => ensureFeed(channel), 2000);
      }
    }
  };
}

function updateSubscription(channel, delta) {
  const feed = feeds[channel];
  if (!feed) return;
  feed.subscribers = Math.max(0, feed.subscribers + delta);
  if (feed.subscribers > 0) {
    ensureFeed(channel);
  } else {
    closeFeed(channel);
  }
}

function removePort(port) {
  if (!channels.has(port)) return;
  const subscriptions = portSubscriptions.get(port) || new Set();
  channels.delete(port);
  for (const channel of subscriptions) {
    updateSubscription(channel, -1);
  }
  portSubscriptions.delete(port);
}

self.onconnect = (event) => {
  const port = event.ports[0];
  channels.add(port);
  portSubscriptions.set(port, new Set());

  port.onmessage = (messageEvent) => {
    const data = messageEvent?.data || {};
    if (data.type === 'subscribe' && data.channel) {
      if (data.channel in feeds) {
        const subscriptions = portSubscriptions.get(port) || new Set();
        if (!subscriptions.has(data.channel)) {
          subscriptions.add(data.channel);
          portSubscriptions.set(port, subscriptions);
          updateSubscription(data.channel, 1);
        }
        safePost(port, { channel: data.channel, type: 'subscribed', senderId: 'realtime-hub', timestamp: Date.now() });
      }
      return;
    }

    if (data.type === 'unsubscribe' && data.channel) {
      if (data.channel in feeds) {
        const subscriptions = portSubscriptions.get(port) || new Set();
        if (subscriptions.has(data.channel)) {
          subscriptions.delete(data.channel);
          portSubscriptions.set(port, subscriptions);
          updateSubscription(data.channel, -1);
        }
        if (subscriptions.size === 0) {
          removePort(port);
        }
      }
      return;
    }
  };
  port.start();
};
