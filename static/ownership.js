/* ============================================================
   OWNERSHIP CRM DASHBOARD — JavaScript Engine
   ============================================================ */

'use strict';

// ═══════════════════════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════════════════════

const GUEST_COLORS = ['#6366f1','#8b5cf6','#ec4899','#14b8a6','#f59e0b','#3b82f6','#10b981','#ef4444','#f97316','#06b6d4'];

const STATUS_LABELS = {
  complete:   'Complete',
  ongoing:    'Ongoing',
  pending:    'Pending',
  notrequired: 'Not Required',
};
const STATUS_FIELDS = [
  'proposalStatus',
  'flightsStatus',
  'visaStatus',
  'hotelsStatus',
  'sectorTicketsStatus',
  'sightseeingStatus',
  'insuranceStatus',
  'travelingStatus',
  'travefyTaskListStatus',
  'tripFeedbackFormStatus',
];

const ACTIVITY_LOG = [];
const OWNERSHIP_TRIPS_STORAGE_KEY = 'ownership_trips_cache_v1';
const OWNERSHIP_REALTIME_HUB_URL = '/static/realtime-hub.js?v=20260609_ws_fix';
const OWNERSHIP_REALTIME_WS_ENABLED = window.__OWNERSHIP_REALTIME_WS_ENABLED__ !== false;
const OWNERSHIP_LAST_EVENT_ID_KEY = 'ownership_last_event_id_v1';
const OWNERSHIP_REALTIME_TAB_ID = (() => {
  try {
    const key = 'ownership_realtime_tab_id_v1';
    let value = sessionStorage.getItem(key);
    if (!value) {
      value = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(key, value);
    }
    return value;
  } catch (_) {
    return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
})();

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
let trips = [];
let taskTemplates = [];
let employees = [];

let sortCol = '';
let sortDir = 1;
let searchQuery = '';
let filterStatus = '';
let filterOwner = '';
let filterMonth = '';
let currentPage = 1;
const PAGE_SIZE = 99999;
let expandedRows = new Set();
let selectedTrips = new Set();
let subtaskContext = null; // { tripId, statusKey }
function ewGetTodayDateStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const d2 = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + d2;
}
let pendingNewSubtaskReminder = { date: ewGetTodayDateStr(), label: 'Due today' };
let applyTemplateState = { tplId: '', tripId: '', selectedIndexes: [] };
let expandedTemplateIds = new Set();
let editingTripId = null;
let calMonth = new Date().getMonth();
let calYear = new Date().getFullYear();
let selectedCalDay = null;
let newTplTasks = [];
let isDark = false;
let ownershipRefreshQueued = false;
let ownershipRefreshTimer = null;
let tableRenderTimer = null;
let searchRenderTimer = null;
let ownershipCacheTimer = null;
let ownershipCachePendingTrips = null;
let ownershipKnownVersion = 0;
let ownershipServerRefreshPending = false;
let ownershipServerRefreshTimer = null;
let ownershipServerRefreshVersion = 0;
const ownershipPendingTripEvents = {};
let ownershipRealtimeManager = null;
let subtaskModalRefreshTimer = null;
let subtaskModalRefreshState = null;

// ═══════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════

async function apiJson(url, options = {}) {
  const nextOptions = { ...options };
  const method = String(nextOptions.method || 'GET').toUpperCase();
  const headers = { 'Content-Type': 'application/json', ...(nextOptions.headers || {}) };
  if (url.startsWith('/api/ownership/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    headers['X-Ownership-Sender-Id'] = OWNERSHIP_REALTIME_TAB_ID;
    if (nextOptions.body != null) {
      let payload = nextOptions.body;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch (_) { payload = null; }
      }
      if (payload && typeof payload === 'object' && !Array.isArray(payload) && !payload.senderId) {
        payload.senderId = OWNERSHIP_REALTIME_TAB_ID;
        nextOptions.body = JSON.stringify(payload);
      }
    }
  }
  const response = await fetch(url, {
    ...nextOptions,
    headers,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const err = new Error(error.error || `Request failed: ${response.status}`);
    err.status = response.status;
    err.payload = error;
    throw err;
  }
  return response.json();
}

function parseOwnershipVersion(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function rememberOwnershipVersion(version) {
  const parsed = parseOwnershipVersion(version);
  if (parsed > ownershipKnownVersion) {
    ownershipKnownVersion = parsed;
  }
  return ownershipKnownVersion;
}

function getStoredOwnershipEventId() {
  try {
    return localStorage.getItem(OWNERSHIP_LAST_EVENT_ID_KEY) || '';
  } catch (_) {
    return '';
  }
}

function rememberOwnershipEventId(eventId) {
  if (!eventId) return '';
  try {
    localStorage.setItem(OWNERSHIP_LAST_EVENT_ID_KEY, String(eventId));
  } catch (_) {}
  return String(eventId);
}

function parseOwnershipEventData(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (_) { return null; }
  }
  if (typeof raw === 'object') return raw;
  return null;
}

// ═══════════════════════════════════════════════════════════
// REALTIME SYNC MANAGER
// ═══════════════════════════════════════════════════════════
// One SharedWorker hub per origin when realtime transport is available.
// Fallback: direct WebSocket when supported, otherwise polling refreshes.

class OwnershipRealtimeManager {
  constructor() {
    this._hub = null;
    this._directWs = null;
    this._seenIds = new Map();
    this._seenMax = 128;
    this._wsReconnectTimer = null;
    this._wsReconnectDelay = 1000;
    this._lastKnownState = 'connecting';
    this._pollTimer = null;
    this._pollIntervalMs = 15000;
    this._disposed = false;
    this._mode = 'none';
  }

  connect() {
    if (this._disposed) return;
    if (!OWNERSHIP_REALTIME_WS_ENABLED) {
      this._startPollingFallback('websocket disabled by server');
      queueOwnershipServerRefresh(0, 'realtime polling fallback');
      return;
    }
    if (this._tryHub()) return;
    this._connectDirectWs();
  }

  disconnect() {
    this._disposed = true;
    this._closeHub();
    this._closeDirectWs();
    this._stopPollingFallback();
  }

  reconnect(reason = 'resume') {
    if (this._disposed) { this._disposed = false; }
    if (!OWNERSHIP_REALTIME_WS_ENABLED) {
      this._startPollingFallback(reason);
      queueOwnershipServerRefresh(0, reason);
      return;
    }
    if (this._hub) {
      try { this._hub.port.postMessage({ type: 'ping' }); } catch (_) { this._closeHub(); this.connect(); }
      return;
    }
    if (this._directWs && this._directWs.readyState === WebSocket.OPEN) return;
    this.connect();
  }

  _tryHub() {
    if (!OWNERSHIP_REALTIME_WS_ENABLED || !('SharedWorker' in window)) return false;
    try {
      this._hub = new SharedWorker(OWNERSHIP_REALTIME_HUB_URL, { name: 'realtime-hub-v2' });
      this._hub.onerror = () => {
        console.warn('[realtime] SharedWorker error, falling back to direct WS');
        this._closeHub();
        this._connectDirectWs();
      };
      this._hub.port.onmessage = (evt) => this._onHubMessage(evt.data);
      this._hub.port.start();
      this._hub.port.postMessage({ type: 'subscribe', lastEventId: getStoredOwnershipEventId() });
      this._mode = 'hub';
      return true;
    } catch (err) {
      console.warn('[realtime] SharedWorker init failed', err);
      this._hub = null;
      return false;
    }
  }

  _closeHub() {
    if (!this._hub) return;
    try { this._hub.port.postMessage({ type: 'unsubscribe' }); } catch (_) {}
    try { this._hub.port.close(); } catch (_) {}
    this._hub = null;
    if (this._mode === 'hub') this._mode = 'none';
  }

  _onHubMessage(data) {
    if (!data) return;
    if (data.type === 'stream-status') {
      const isReconnect = (this._lastKnownState === 'close' || this._lastKnownState === 'error') && data.state === 'open';
      this._lastKnownState = data.state;
      if (data.state === 'open') {
        console.debug('[realtime] hub connected');
        this._stopPollingFallback();
        if (isReconnect) {
          console.debug('[realtime] hub reconnected, refreshing state');
          queueOwnershipServerRefresh(0, 'hub reconnect');
        }
      } else if (data.state === 'close' || data.state === 'error') {
        this._startPollingFallback('hub unavailable');
      }
      return;
    }
    if (data.senderId && data.senderId === OWNERSHIP_REALTIME_TAB_ID) return;
    if (data.channel === 'system' && data.type === 'ping') {
      this._maybeRefreshFromPing(data);
      return;
    }
    this._dispatch(data);
  }

  _connectDirectWs() {
    if (this._disposed || this._directWs) return;
    if (!OWNERSHIP_REALTIME_WS_ENABLED || typeof WebSocket === 'undefined') {
      this._startPollingFallback('websocket unavailable');
      queueOwnershipServerRefresh(0, 'realtime polling fallback');
      return;
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const lastEventId = getStoredOwnershipEventId();
    const url = `${proto}//${location.host}/api/realtime/ws${lastEventId ? `?last_event_id=${encodeURIComponent(lastEventId)}` : ''}`;
    let socket;
    try { socket = new WebSocket(url); } catch (_) {
      this._startPollingFallback('websocket construction failed');
      queueOwnershipServerRefresh(0, 'realtime polling fallback');
      this._scheduleWsReconnect();
      return;
    }
    this._directWs = socket;
    this._mode = 'direct';
    socket.onopen = () => { 
      this._wsReconnectDelay = 1000; 
      console.debug('[realtime] direct WS connected'); 
      this._stopPollingFallback();
      if (this._lastKnownState === 'close' || this._lastKnownState === 'error') {
        queueOwnershipServerRefresh(0, 'direct WS reconnect');
      }
      this._lastKnownState = 'open';
    };
    socket.onmessage = (evt) => {
      if (typeof evt.data !== 'string') return;
      let msg;
      try { msg = JSON.parse(evt.data); } catch (_) { return; }
      if (msg.type === 'ping' && msg.channel === 'system') {
        this._maybeRefreshFromPing(msg);
        return;
      }
      if (msg.senderId && msg.senderId === OWNERSHIP_REALTIME_TAB_ID) return;
      this._dispatch(msg);
    };
    socket.onerror = () => {
      this._lastKnownState = 'error';
      this._startPollingFallback('direct websocket error');
    };
    socket.onclose = () => {
      this._directWs = null;
      this._lastKnownState = 'close';
      if (this._mode === 'direct') this._mode = 'none';
      this._startPollingFallback('direct websocket closed');
      if (!this._disposed) this._scheduleWsReconnect();
    };
  }

  _closeDirectWs() {
    if (this._wsReconnectTimer) { clearTimeout(this._wsReconnectTimer); this._wsReconnectTimer = null; }
    if (!this._directWs) return;
    try { this._directWs.onopen = null; this._directWs.onmessage = null; this._directWs.onerror = null; this._directWs.onclose = null; this._directWs.close(); } catch (_) {}
    this._directWs = null;
    if (this._mode === 'direct') this._mode = 'none';
  }

  _startPollingFallback(reason = 'polling fallback') {
    if (this._disposed || this._pollTimer) return;
    console.debug('[realtime] ownership polling fallback active', reason);
    this._pollTimer = setInterval(() => {
      if (this._disposed) return;
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      queueOwnershipServerRefresh(0, 'ownership polling fallback');
    }, this._pollIntervalMs);
  }

  _stopPollingFallback() {
    if (!this._pollTimer) return;
    clearInterval(this._pollTimer);
    this._pollTimer = null;
  }

  _maybeRefreshFromPing(msg) {
    const pingVersion = parseOwnershipVersion(msg?.version);
    if (pingVersion > ownershipKnownVersion) {
      queueOwnershipServerRefresh(pingVersion, 'ownership heartbeat');
    }
  }

  _scheduleWsReconnect() {
    if (this._wsReconnectTimer || this._disposed) return;
    const delay = this._wsReconnectDelay;
    this._wsReconnectDelay = Math.min(delay * 2, 30000);
    this._wsReconnectTimer = setTimeout(() => {
      this._wsReconnectTimer = null;
      if (!this._disposed && !this._hub) this._connectDirectWs();
    }, delay);
  }

  _isDuplicate(eventId) {
    if (!eventId) return false;
    if (this._seenIds.has(eventId)) return true;
    this._seenIds.set(eventId, true);
    if (this._seenIds.size > this._seenMax) {
      const first = this._seenIds.keys().next().value;
      this._seenIds.delete(first);
    }
    return false;
  }

  _dispatch(msg) {
    if (!msg) return;
    const eventId = msg.eventId;
    if (eventId && this._isDuplicate(eventId)) return;
    if (msg.channel === 'ownership') {
      if (eventId) rememberOwnershipEventId(eventId);
      const event = msg.event;
      if (!event) return;
      if (event === 'ready') { rememberOwnershipVersion(msg.version); return; }
      const handled = applyOwnershipRealtimeEvent(msg);
      if (!handled && msg.version) {
        queueOwnershipServerRefresh(msg.version, event || 'ownership update');
      }
      return;
    }
    if (msg.channel === 'tickets') {
      if (typeof window._onTicketRealtimeEvent === 'function') {
        window._onTicketRealtimeEvent(msg);
      }
      return;
    }
  }
}





function queueOwnershipServerRefresh(version = 0, reason = 'ownership update') {
  const parsedVersion = rememberOwnershipVersion(version);
  if (parsedVersion && parsedVersion <= ownershipServerRefreshVersion && !ownershipServerRefreshPending) {
    return;
  }
  if (parsedVersion > ownershipServerRefreshVersion) {
    ownershipServerRefreshVersion = parsedVersion;
  }
  ownershipServerRefreshPending = true;
  const runRefresh = async () => {
    ownershipServerRefreshTimer = null;
    if (!ownershipServerRefreshPending) return;
    if (Object.keys(patchQueue).length > 0) {
      ownershipServerRefreshTimer = setTimeout(runRefresh, 180);
      return;
    }
    ownershipServerRefreshPending = false;
    try {
      await reloadOwnershipData({ silent: true });
      if (parsedVersion > ownershipServerRefreshVersion) {
        ownershipServerRefreshVersion = parsedVersion;
      }
    } catch (err) {
      console.error('Ownership live refresh failed', reason, err);
    }
  };

  if (ownershipServerRefreshTimer) {
    clearTimeout(ownershipServerRefreshTimer);
  }
  ownershipServerRefreshTimer = setTimeout(runRefresh, parsedVersion ? 120 : 220);
}

function stashOwnershipTripEvent(payload) {
  if (!payload) return false;
  const tripId = payload.tripId || payload.trip?.id;
  if (!tripId) return false;
  const nextVersion = parseOwnershipVersion(payload.version);
  const current = ownershipPendingTripEvents[tripId];
  if (current && parseOwnershipVersion(current.version) > nextVersion) {
    return false;
  }
  ownershipPendingTripEvents[tripId] = payload;
  return true;
}

function flushOwnershipTripEvent(tripId) {
  if (!tripId || patchQueue[tripId]) return false;
  const payload = ownershipPendingTripEvents[tripId];
  if (!payload) return false;
  delete ownershipPendingTripEvents[tripId];
  return applyOwnershipRealtimeEvent(payload, { fromFlush: true });
}

function upsertOwnershipTripFromEvent(trip) {
  if (!trip || !trip.id) return false;
  const nextTrip = hydrateTripSearchIndex({ version: 1, ...trip });
  const idx = trips.findIndex(item => item.id === nextTrip.id);
  const queue = patchQueue[nextTrip.id];
  const hasPendingLocalPatch = !!(queue && (queue.inFlight || Object.keys(queue.patch || {}).length > 0));
  if (idx !== -1) {
    const currentVersion = parseOwnershipVersion(trips[idx].version);
    const nextVersion = parseOwnershipVersion(nextTrip.version);
    if (currentVersion > nextVersion) return true;
    if (hasPendingLocalPatch) {
      trips[idx] = { ...nextTrip, ...(queue?.patch || {}) };
    } else {
      trips[idx] = nextTrip;
    }
    cacheTripsForFastPaint(trips);
    if (typeof syncTripRowDom === 'function') {
      syncTripRowDom(trips[idx], { refreshExpanded: true });
    } else {
      scheduleOwnershipRefreshDeferred(150);
    }
    return true;
  }
  trips.unshift(nextTrip);
  cacheTripsForFastPaint(trips);
  refreshOwnershipViews();
  return true;
}

function removeOwnershipTripFromEvent(tripId, version = 0) {
  if (!tripId) return false;
  const idx = trips.findIndex(item => item.id === tripId);
  const queue = patchQueue[tripId];
  const hasPendingLocalPatch = !!(queue && (queue.inFlight || Object.keys(queue.patch || {}).length > 0));
  if (hasPendingLocalPatch) return true;
  const before = trips.length;
  trips = trips.filter(item => item.id !== tripId);
  if (trips.length === before) return true;
  cacheTripsForFastPaint(trips);
  refreshOwnershipViews();
  return true;
}

function upsertOwnershipTemplateFromEvent(template) {
  if (!template || !template.id) return false;
  const idx = taskTemplates.findIndex(item => item.id === template.id);
  if (idx !== -1) taskTemplates[idx] = template;
  else taskTemplates.push(template);
  renderSavedTemplates();
  return true;
}

function removeOwnershipTemplateFromEvent(templateId) {
  if (!templateId) return false;
  const before = taskTemplates.length;
  taskTemplates = taskTemplates.filter(item => item.id !== templateId);
  if (taskTemplates.length === before) return true;
  expandedTemplateIds.delete(templateId);
  renderSavedTemplates();
  return true;
}

function upsertOwnershipEmployeeFromEvent(employee) {
  if (!employee || !employee.id) return false;
  const idx = employees.findIndex(item => item.id === employee.id);
  if (idx !== -1) employees[idx] = employee;
  else employees.push(employee);
  employees.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  refreshOwnershipViews();
  return true;
}

function removeOwnershipEmployeeFromEvent(employeeId) {
  if (!employeeId) return false;
  const before = employees.length;
  employees = employees.filter(item => item.id !== employeeId);
  if (employees.length === before) return true;
  refreshOwnershipViews();
  return true;
}

function applyOwnershipRealtimeEvent(payload, options = {}) {
  if (!payload || !payload.event) return false;
  const eventVersion = parseOwnershipVersion(payload.version);
  rememberOwnershipVersion(eventVersion);

  switch (payload.event) {
    case 'trip_created':
    case 'trip_updated':
      if (!options.fromFlush && payload.trip?.id && patchQueue[payload.trip.id]) {
        stashOwnershipTripEvent(payload);
        return true;
      }
      if (payload.trip) {
        return upsertOwnershipTripFromEvent(payload.trip);
      }
      return false;
    case 'trip_deleted':
      if (!options.fromFlush && payload.tripId && patchQueue[payload.tripId]) {
        stashOwnershipTripEvent(payload);
        return true;
      }
      return removeOwnershipTripFromEvent(payload.tripId, payload.version);
    case 'template_created':
      if (payload.template) {
        return upsertOwnershipTemplateFromEvent(payload.template);
      }
      return false;
    case 'template_deleted':
      return removeOwnershipTemplateFromEvent(payload.templateId);
    case 'employee_saved':
      if (payload.employee) {
        return upsertOwnershipEmployeeFromEvent(payload.employee);
      }
      return false;
    case 'employee_deleted':
      return removeOwnershipEmployeeFromEvent(payload.employeeId);
    case 'sheet_imported':
      queueOwnershipServerRefresh(payload.version, 'sheet import');
      return true;
    case 'refresh':
      queueOwnershipServerRefresh(payload.version, 'realtime refresh');
      return true;
    default:
      return false;
  }
}


function save(trip = null) {
  const pending = trip ? [trip] : trips;
  for (const item of pending) {
    if (!item || !item.id) continue;
    apiJson(`/api/ownership/trips/${item.id}`, {
      method: 'PUT',
      body: JSON.stringify(item),
    }).catch(err => {
      console.error('Ownership save failed', err);
      toast('Could not save to database', '⚠️');
    });
  }
}

const patchQueue = {};

function getOwnershipPatchQueue(trip) {
  if (!trip || !trip.id) return null;
  const tripId = trip.id;
  if (!patchQueue[tripId]) {
    patchQueue[tripId] = {
      patch: {},
      resolvers: [],
      snapshot: JSON.parse(JSON.stringify(trip)),
      version: parseOwnershipVersion(trip.version),
      inFlight: false,
      timer: null,
    };
  }
  const queue = patchQueue[tripId];
  const tripVersion = parseOwnershipVersion(trip.version);
  if (tripVersion > queue.version) {
    queue.version = tripVersion;
  }
  return queue;
}

function scheduleOwnershipPatchFlush(tripId, delay = 600) {
  const queue = patchQueue[tripId];
  if (!queue || queue.inFlight) return;
  if (queue.timer) clearTimeout(queue.timer);
  queue.timer = setTimeout(() => {
    queue.timer = null;
    flushOwnershipTripPatch(tripId);
  }, delay);
}

async function flushOwnershipTripPatch(tripId) {
  const queue = patchQueue[tripId];
  if (!queue || queue.inFlight) return null;
  const patch = queue.patch;
  if (!patch || Object.keys(patch).length === 0) {
    if (!queue.resolvers.length && !queue.timer) {
      delete patchQueue[tripId];
    }
    return null;
  }

  queue.inFlight = true;
  queue.patch = {};
  const batchResolvers = queue.resolvers.splice(0);
  const requestVersion = queue.version || 0;
  try {
    const { trip: saved, cacheVersion } = await apiJson(`/api/ownership/trips/${tripId}`, {
      method: 'PATCH',
      body: JSON.stringify({ version: requestVersion, ...patch }),
    });
    if (saved) {
      const idx = trips.findIndex(t => t.id === saved.id);
      const hasPendingLocalChanges = !!(queue && (queue.inFlight || Object.keys(queue.patch || {}).length > 0));
      const mergedTrip = idx !== -1 && hasPendingLocalChanges ? { ...saved, ...(queue?.patch || {}) } : saved;
      if (idx !== -1) trips[idx] = mergedTrip;
      queue.snapshot = JSON.parse(JSON.stringify(mergedTrip));
      queue.version = parseOwnershipVersion(cacheVersion || mergedTrip.version || queue.version);
      rememberOwnershipVersion(cacheVersion || saved.version);
      cacheTripsForFastPaint(trips);
      syncTripRowDom(mergedTrip, { refreshExpanded: true });
    }
    batchResolvers.forEach(r => r.resolve(saved));
  } catch (err) {
    const serverTrip = err.status === 409 && err.payload?.trip ? err.payload.trip : null;
    const currentTrip = trips.find(t => t.id === tripId);
    const hasPendingLocalChanges = !!(queue && (queue.inFlight || Object.keys(queue.patch || {}).length > 0));
    const nextTrip = serverTrip ? (hasPendingLocalChanges ? { ...serverTrip, ...(queue?.patch || {}) } : serverTrip) : queue.snapshot;
    const idx = trips.findIndex(t => t.id === tripId);
    if (idx !== -1 && nextTrip) trips[idx] = nextTrip;
    if (serverTrip) {
      queue.snapshot = JSON.parse(JSON.stringify(nextTrip));
      queue.version = parseOwnershipVersion(err.payload?.cacheVersion || nextTrip.version || queue.version);
      rememberOwnershipVersion(err.payload?.cacheVersion || serverTrip.version);
      cacheTripsForFastPaint(trips);
      syncTripRowDom(nextTrip, { refreshExpanded: true });
      toast('Latest trip version loaded. Keep editing.', '⚠️');
    } else {
      cacheTripsForFastPaint(trips);
      syncTripRowDom(nextTrip, { refreshExpanded: true });
    }

    if (Object.keys(queue.patch).length > 0) {
      scheduleOwnershipPatchFlush(tripId, 0);
    }

    batchResolvers.forEach(r => {
      if (serverTrip) r.resolve(serverTrip);
      else r.reject(err);
    });
    if (!serverTrip) {
      queueOwnershipServerRefresh(err.payload?.cacheVersion || 0, 'trip patch failed');
    }
  } finally {
    queue.inFlight = false;
    if (Object.keys(queue.patch).length === 0 && queue.resolvers.length === 0 && !queue.timer) {
      delete patchQueue[tripId];
      flushOwnershipTripEvent(tripId);
    } else if (Object.keys(queue.patch).length > 0 && !queue.timer) {
      scheduleOwnershipPatchFlush(tripId, 0);
    }
  }
}

async function saveTripPatch(trip, patch) {
  if (!trip || !trip.id) return null;
  const tripId = trip.id;
  const queue = getOwnershipPatchQueue(trip);
  if (!queue) return null;
  Object.assign(queue.patch, patch);
  cacheTripsForFastPaint(trips);
  
  return new Promise((resolve, reject) => {
    queue.resolvers.push({ resolve, reject });
    scheduleOwnershipPatchFlush(tripId);
  });
}

function refreshOwnershipViews() {
  cacheTripsForFastPaint(trips);
  scheduleOwnershipRefresh();
}

function scheduleOwnershipRefresh() {
  if (ownershipRefreshQueued) return;
  ownershipRefreshQueued = true;
  requestAnimationFrame(() => {
    ownershipRefreshQueued = false;
    refreshOwnerControls();
    populateOwnerFilter();
    populateMonthFilter();
    renderTable();
    renderActivityFeed();
    renderCalendar();
    renderUpcomingTrips();
    if (window.location.pathname.startsWith('/ownership/employees')) {
      if (typeof refreshEmployeeWorkspaceFromOwnership === 'function') {
        refreshEmployeeWorkspaceFromOwnership();
      } else if (typeof syncEmployeeWorkspaceData === 'function') {
        syncEmployeeWorkspaceData();
      }
    }
  });
}

function scheduleOwnershipRefreshDeferred(delayMs = 220) {
  if (ownershipRefreshTimer) clearTimeout(ownershipRefreshTimer);
  ownershipRefreshTimer = setTimeout(() => {
    ownershipRefreshTimer = null;
    const runRefresh = () => scheduleOwnershipRefresh();
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(runRefresh, { timeout: 1200 });
    } else {
      setTimeout(runRefresh, 0);
    }
  }, delayMs);
}

function recalculateTableTextareaHeights() {
  document.querySelectorAll('td.col-sticky-3 textarea, td.col-sticky-5 textarea').forEach(ta => {
    if (ta.offsetParent !== null) {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    }
  });
}

function refreshAuxiliaryViews() {
  requestAnimationFrame(() => {
    refreshOwnerControls();
    populateOwnerFilter();
    populateMonthFilter();
    renderActivityFeed();
    renderCalendar();
    renderUpcomingTrips();
    recalculateTableTextareaHeights();
  });
}

function scheduleSubtaskModalRefresh(delayMs = 0) {
  if (!subtaskContext) return;
  subtaskModalRefreshState = { tripId: subtaskContext.tripId, key: subtaskContext.key };
  if (subtaskModalRefreshTimer) clearTimeout(subtaskModalRefreshTimer);
  subtaskModalRefreshTimer = setTimeout(() => {
    subtaskModalRefreshTimer = null;
    const state = subtaskModalRefreshState;
    subtaskModalRefreshState = null;
    if (!state) return;
    const trip = trips.find(t => t.id === state.tripId);
    if (!trip || !trip.subtasks || !trip.subtasks[state.key]) return;
    renderSubtaskBody(trip.subtasks[state.key]);
  }, delayMs);
}

function saveTemplates(template = null) {
  if (!template) return;
  apiJson('/api/ownership/templates', {
    method: 'POST',
    body: JSON.stringify(template),
  }).then(({ template: saved, cacheVersion }) => {
    if (saved) {
      rememberOwnershipVersion(cacheVersion);
      const idx = taskTemplates.findIndex(t => t.id === template.id);
      if (idx !== -1) taskTemplates[idx] = saved;
      else taskTemplates.push(saved);
      renderSavedTemplates();
    }
  }).catch(err => {
    console.error('Template save failed', err);
    toast('Could not save category list', '⚠️');
  });
}

function uid() {
  return 'id' + Math.random().toString(36).slice(2, 9);
}

function normalizeOwnershipStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'pending';
  const normalized = raw.replace(/\s+/g, '');
  if (normalized === 'completed') return 'complete';
  if (normalized === 'inprogress') return 'ongoing';
  if (normalized === 'notrequired') return 'notrequired';
  return STATUS_LABELS[normalized] ? normalized : 'pending';
}

function guestColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return GUEST_COLORS[Math.abs(hash) % GUEST_COLORS.length];
}

function statusBadge(status, field) {
  const normalized = normalizeOwnershipStatus(status);
  const label = STATUS_LABELS[normalized] || STATUS_LABELS.pending;
  const cls = normalized || 'pending';
  return `<span class="crm-badge ${cls}" data-field="${field}" onclick="openBadgeMenu(this, event)">${label}</span>`;
}

function statusLabelFor(value) {
  const normalized = normalizeOwnershipStatus(value);
  return STATUS_LABELS[normalized] || STATUS_LABELS.pending;
}

function findTripRow(tripId) {
  return Array.from(document.querySelectorAll('tr[data-id]')).find(row => row.dataset.id === tripId) || null;
}

function paintStatusBadgeInPlace(badge, value) {
  if (!badge) return;
  const normalized = normalizeOwnershipStatus(value);
  const label = statusLabelFor(normalized);
  badge.className = `crm-badge ${normalized}`;
  delete badge.dataset.tooltip;
  badge.textContent = label;
}

function applyOwnershipStatusOptimistically(trip, field, value) {
  if (!trip) return;
  const previous = trip[field];
  trip[field] = normalizeOwnershipStatus(value);
  hydrateTripSearchIndex(trip);
  cacheTripsForFastPaint(trips);
  return previous;
}

const TASK_GROUP_OPTIONS = [
  ['proposal', 'Initial Proposal'],
  ['flights', 'Flights'],
  ['visa', 'Visa'],
  ['hotels', 'Hotels'],
  ['sectorTickets', 'Sector Tickets'],
  ['sightseeing', 'Sightseeing'],
  ['insurance', 'Insurance'],
  ['travefy', 'Travefy'],
  ['travefyTaskList', 'Travefy Task List'],
  ['tripFeedbackForm', 'Trip Feedback Form'],
];

function taskGroupLabel(key) {
  return TASK_GROUP_OPTIONS.find(([k]) => k === key)?.[1] || key || 'Task';
}

function statusBadgeWithCount(trip, statusField, subtaskKey) {
  const status = normalizeOwnershipStatus(trip?.[statusField]);
  const count = getOwnershipSubtaskList(trip, subtaskKey).filter(sub => sub && !sub.done).length;
  const countBadge = count ? `<button type="button" class="crm-task-count crm-task-count-inline" title="${count} pending subtasks" onclick="openTripExpandedFromCount(event, '${trip.id}')">${count}</button>` : '';
  return `<div class="crm-status-cell"><div class="crm-status-pair"><span class="crm-status-slot"><span class="crm-badge ${status}" data-field="${statusField}" onclick="openBadgeMenu(this, event)" ondblclick="openSubtaskModal(event, '${trip.id}', '${subtaskKey}')">${STATUS_LABELS[status] || STATUS_LABELS.pending}</span></span><span class="crm-count-slot">${countBadge}</span></div></div>`;
}

function getOwnershipSubtaskList(trip, key) {
  const group = trip?.subtasks?.[key];
  return Array.isArray(group) ? group.filter(Boolean) : [];
}

const STATUS_CELL_MAP = {
  proposalStatus: 'proposal',
  flightsStatus: 'flights',
  visaStatus: 'visa',
  hotelsStatus: 'hotels',
  sectorTicketsStatus: 'sectorTickets',
  sightseeingStatus: 'sightseeing',
  insuranceStatus: 'insurance',
  travelingStatus: 'travefy',
  travefyTaskListStatus: 'travefyTaskList',
  tripFeedbackFormStatus: 'tripFeedbackForm',
};

function syncTripRowDom(trip, { refreshExpanded = false } = {}) {
  if (!trip || !trip.id) return false;
  hydrateTripSearchIndex(trip);
  const row = findTripRow(trip.id);
  if (!row) return false;

  const avatar = row.querySelector('.crm-link-avatar');
  if (avatar) {
    const masterSheetUrl = tripMasterSheetUrl(trip);
    avatar.style.background = guestColor(trip.guestName);
    avatar.textContent = initialsFor(trip.guestName, 'G');
    avatar.dataset.id = trip.id;
    avatar.dataset.url = escHtml(masterSheetUrl);
    avatar.title = masterSheetUrl ? 'Open master sheet link' : 'Link the master sheet';
    avatar.classList.toggle('has-link', !!masterSheetUrl);
    avatar.classList.toggle('no-link', !masterSheetUrl);
  }

  const guestName = row.querySelector('.crm-guest-name');
  if (guestName) {
    guestName.value = trip.guestName || '';
    if (guestName.offsetParent !== null) {
      guestName.style.height = 'auto';
      guestName.style.height = guestName.scrollHeight + 'px';
    }
  }

  const pax = row.querySelector('input[data-field="pax"]');
  if (pax) pax.value = trip.pax || 1;

  const destination = row.querySelector('textarea[data-field="destination"]');
  if (destination) {
    destination.value = trip.destination || '';
    if (destination.offsetParent !== null) {
      destination.style.height = 'auto';
      destination.style.height = destination.scrollHeight + 'px';
    }
  }

  const startDate = row.querySelector('input[data-field="startDate"]');
  if (startDate) {
    startDate.value = trip.startDate || '';
    startDate.className = `crm-inline-edit crm-date-cell ${dateSoonClass(trip.startDate)}`;
  }

  const ownerSelect = row.querySelector('select[data-field="owner"]');
  if (ownerSelect) ownerSelect.value = trip.owner || '';
  const ownerAvatar = row.querySelector('.crm-owner-avatar');
  if (ownerAvatar) {
    ownerAvatar.style.background = employeeColor(trip.owner);
    ownerAvatar.dataset.tooltip = escHtml(trip.owner || '');
    ownerAvatar.textContent = initialsFor(trip.owner, 'O');
  }

  const progressFill = row.querySelector('.crm-progress-bar-fill');
  const progressLabel = row.querySelector('.crm-progress-label');
  if (progressFill && progressLabel) {
    const prog = calcProgress(trip);
    progressFill.style.width = `${prog}%`;
    progressLabel.textContent = `${prog}%`;
  }

  for (const [field, key] of Object.entries(STATUS_CELL_MAP)) {
    const badge = row.querySelector(`.crm-badge[data-field="${field}"]`);
    if (!badge) continue;
    const cell = badge.closest('td');
    if (cell) cell.innerHTML = statusBadgeWithCount(trip, field, key);
  }

  if (refreshExpanded) {
    const expRow = row.nextElementSibling;
    if (expRow && expRow.classList.contains('crm-expanded-row') && expRow.dataset.expandFor === trip.id) {
      expRow.innerHTML = `<td colspan="18">${renderExpandedContent(trip)}</td>`;
    }
  }

  return true;
}

const PENCIL_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>';

function employeeColor(name) {
  const employee = employees.find(e => e.name === name);
  if (employee?.color) return employee.color;
  return guestColor(name || 'Employee');
}

function initialsFor(name, fallback = '?') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  return parts.slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw)) return `https://${raw}`;
  return raw;
}

function tripMasterSheetUrl(trip) {
  return normalizeUrl(trip?.masterSheetUrl || '');
}

function subtaskAvatarMarkup(name) {
  const color = employeeColor(name || 'Unassigned');
  const initials = initialsFor(name, '•');
  return `<span class="crm-subtask-avatar" style="background:${color}">${escHtml(initials)}</span>`;
}

function renderExpandedSubtask(sub, trip) {
  const assignee = sub.assignee || trip.owner || 'Unassigned';
  const reminder = sub?.metadata?.reminder;
  return `
    <div class="crm-subtask-mini ${sub.done ? 'done' : ''}" title="${escHtml(sub.text)}">
      ${subtaskAvatarMarkup(assignee)}
      <div class="crm-subtask-mini-main">
        <div class="crm-subtask-mini-text">${escHtml(sub.text)}</div>
        <div class="crm-subtask-mini-meta">
          ${reminder ? `<span>${escHtml(reminder.label || `${reminder.days} days before`)}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

function subtaskCountForTrip(trip, key) {
  return ((trip?.subtasks || {})[key] || []).filter(Boolean).length;
}

function employeeNames() {
  return [...new Set([...employees.map(e => e.name).filter(Boolean), ...trips.map(t => t.owner).filter(Boolean)])].sort();
}

function ownerOptions(selectedOwner = '') {
  const owners = employeeNames();
  return owners.map(owner => `<option value="${escHtml(owner)}" ${owner===selectedOwner?'selected':''}>${escHtml(owner)}</option>`).join('');
}

function calcProgress(trip) {
  let score = 0;
  let maxScore = 0;
  for (const f of STATUS_FIELDS) {
    const s = normalizeOwnershipStatus(trip[f]);
    maxScore += 2;
    if (s === 'complete' || s === 'notrequired') score += 2;
    else if (s === 'ongoing') score += 1;
  }
  return Math.round((score / maxScore) * 100);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const parts = String(dateStr).split('-');
  if (parts.length === 3) {
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    if (!isNaN(d.getTime())) return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
  }
  const fallback = new Date(dateStr);
  if (!isNaN(fallback.getTime())) return fallback.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
  return '—';
}

function dateSoonClass(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const d = new Date(dateStr + 'T00:00:00');
  const diff = (d - now) / 86400000;
  if (diff < 0) return 'crm-date-past';
  if (diff <= 14) return 'crm-date-soon';
  return '';
}

function toast(msg, icon = '✅') {
  const el = document.createElement('div');
  el.className = 'crm-toast';
  el.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  document.getElementById('crmToastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function renderSkeleton() {
  const tbody = document.getElementById('crmTbody');
  if (tbody) {
    tbody.innerHTML = Array.from({ length: 8 }).map(() => `
      <tr class="crm-skeleton-row">
        ${Array.from({ length: 18 }).map(() => '<td><div class="crm-skeleton-pill"></div></td>').join('')}
      </tr>
    `).join('');
  }
  const footerInfo = document.getElementById('tableFooterInfo');
  if (footerInfo) footerInfo.textContent = 'Loading ownership data...';

  ['kpiTotal', 'kpiFlights', 'kpiVisa', 'kpiHotels', 'kpiTasks', 'kpiMonth'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<div class="crm-skeleton-pill" style="width: 40px; height: 28px; border-radius: 6px;"></div>';
  });
}

function buildTripSearchText(trip) {
  return [
    trip?.guestName || '',
    trip?.destination || '',
    trip?.owner || '',
  ].join(' ').toLowerCase();
}

function hydrateTripSearchIndex(trip) {
  if (!trip) return trip;
  for (const field of STATUS_FIELDS) {
    trip[field] = normalizeOwnershipStatus(trip[field]);
  }
  trip._searchText = buildTripSearchText(trip);
  return trip;
}

function cancelScheduledTableRender() {
  if (tableRenderTimer) {
    clearTimeout(tableRenderTimer);
    tableRenderTimer = null;
  }
}

function scheduleTableRender(delayMs = 90) {
  cancelScheduledTableRender();
  tableRenderTimer = setTimeout(() => {
    tableRenderTimer = null;
    renderTable();
  }, delayMs);
}

function cancelScheduledSearchRender() {
  if (searchRenderTimer) {
    cancelAnimationFrame(searchRenderTimer);
    searchRenderTimer = null;
  }
}

function scheduleSearchRender() {
  cancelScheduledSearchRender();
  searchRenderTimer = window.requestAnimationFrame(() => {
    searchRenderTimer = null;
    renderTable();
  });
}

function refreshOwnerControls() {
  populateOwnerFilter();
  populateAssigneeSelect();
  const ownerSelect = document.getElementById('tf-owner');
  if (ownerSelect) ownerSelect.innerHTML = ownerOptions(ownerSelect.value);
}

function syncStatsPanelButton() {
  const button = document.getElementById('btnToggleStats');
  const grid = document.getElementById('kpiGrid');
  if (!button || !grid) return;
  const expanded = !grid.classList.contains('collapsed');
  button.classList.toggle('expanded', expanded);
  button.classList.toggle('collapsed', !expanded);
}

function toggleStatsPanel(forceExpanded = null) {
  const grid = document.getElementById('kpiGrid');
  if (!grid) return;
  const shouldExpand = forceExpanded === null ? grid.classList.contains('collapsed') : !!forceExpanded;
  grid.classList.toggle('collapsed', !shouldExpand);
  syncStatsPanelButton();
}

// ═══════════════════════════════════════════════════════════
// FILTER + SORT + PAGINATE
// ═══════════════════════════════════════════════════════════

function getFiltered() {
  let data = [...trips];
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    data = data.filter(t =>
      (t._searchText || buildTripSearchText(t)).includes(q)
    );
  }
  if (filterStatus) {
    const fields = ['proposalStatus','flightsStatus','visaStatus','hotelsStatus','sightseeingStatus','insuranceStatus','travelingStatus'];
    data = data.filter(t => fields.some(f => t[f] === filterStatus));
  }
  if (filterOwner) data = data.filter(t => t.owner === filterOwner);
  if (filterMonth) {
    data = data.filter(t => {
      if (!t.startDate) return false;
      const d = new Date(t.startDate + 'T00:00:00');
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` === filterMonth;
    });
  }

  data.sort((a, b) => {
    if (sortCol === 'startDate') {
      const aHasDate = !!a.startDate;
      const bHasDate = !!b.startDate;
      if (aHasDate && !bHasDate) return -1;
      if (!aHasDate && bHasDate) return 1;
      if (!aHasDate && !bHasDate) return 0;
      const av = new Date(`${a.startDate}T00:00:00`).getTime();
      const bv = new Date(`${b.startDate}T00:00:00`).getTime();
      if (av < bv) return -sortDir;
      if (av > bv) return sortDir;
      return 0;
    }
    let av = a[sortCol] ?? '', bv = b[sortCol] ?? '';
    if (av < bv) return -sortDir;
    if (av > bv) return sortDir;
    return 0;
  });

  return data;
}

function paginate(data) {
  const total = data.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > pages) currentPage = pages;
  return { page: data.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE), total, pages };
}

// ═══════════════════════════════════════════════════════════
// KPI
// ═══════════════════════════════════════════════════════════

function updateKPIs() {
  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();

  document.getElementById('kpiTotal').textContent = trips.length;
  document.getElementById('kpiFlights').textContent = trips.filter(t => t.flightsStatus === 'pending').length;
  document.getElementById('kpiVisa').textContent = trips.filter(t => t.visaStatus === 'pending').length;
  document.getElementById('kpiHotels').textContent = trips.filter(t => t.hotelsStatus === 'pending').length;

  let tasksOpen = 0;
  for (const t of trips) {
    if (t.subtasks) {
      for (const subs of Object.values(t.subtasks)) {
        tasksOpen += subs.filter(s => !s.done).length;
      }
    }
  }
  document.getElementById('kpiTasks').textContent = tasksOpen;

  document.getElementById('kpiMonth').textContent = trips.filter(t => {
    if (!t.startDate) return false;
    const d = new Date(t.startDate + 'T00:00:00');
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  }).length;

  document.getElementById('totalTripsBadge').textContent = trips.length;
}

// ═══════════════════════════════════════════════════════════
// RENDER TABLE
// ═══════════════════════════════════════════════════════════

function renderTable() {
  try {
  cancelScheduledTableRender();
  const filtered = getFiltered();
  const { page, total, pages } = paginate(filtered);

  const tbody = document.getElementById('crmTbody');
  const fragment = document.createDocumentFragment();

  if (page.length === 0) {
    const emptyRow = document.createElement('tr');
    emptyRow.innerHTML = `<td colspan="18"><div class="crm-empty"><div class="crm-empty-icon">🔍</div><div class="crm-empty-title">No trips found</div><div class="crm-empty-sub">Try adjusting your filters or search query</div></div></td>`;
    fragment.appendChild(emptyRow);
  } else {
    for (const trip of page) {
      const prog = calcProgress(trip);
      const avatar = guestColor(trip.guestName);
      const initials = initialsFor(trip.guestName, 'G');
      const ownerColor = employeeColor(trip.owner);
      const ownerInitials = initialsFor(trip.owner, 'O');
      const dateClass = dateSoonClass(trip.startDate);
      const isExpanded = expandedRows.has(trip.id);
      const masterSheetUrl = tripMasterSheetUrl(trip);

      const row = document.createElement('tr');
      row.dataset.id = trip.id;
      if (isExpanded) row.classList.add('row-expanded');

      row.innerHTML = `
        <td class="col-sticky-1"><input type="checkbox" class="crm-checkbox row-check" data-id="${trip.id}" ${selectedTrips.has(trip.id) ? 'checked' : ''}></td>
        <td class="col-sticky-2">
          <button class="crm-expand-btn ${isExpanded ? 'expanded' : ''}" data-id="${trip.id}" title="Expand row">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </td>
        <td class="col-sticky-3">
          <div class="crm-guest-cell" style="align-items: flex-start;">
            <button type="button" class="crm-guest-avatar crm-link-avatar ${masterSheetUrl ? 'has-link' : 'no-link'}" style="background:${avatar};margin-top:2px;" data-id="${trip.id}" data-url="${escHtml(masterSheetUrl)}" title="${masterSheetUrl ? 'Open master sheet link' : 'Link the master sheet'}">${initials}</button>
            <textarea class="crm-inline-edit crm-guest-name" style="background:transparent;width:95px;display:block;margin-left:-0.3rem;resize:none;overflow:hidden;height:auto;line-height:1.2;font-family:inherit;padding:0.2rem 0.3rem;white-space:pre-wrap;word-break:normal;overflow-wrap:break-word;" rows="1" data-id="${trip.id}" data-field="guestName" title="Edit Guest Name" placeholder="Guest Name" oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'" onfocus="this.style.height='auto';this.style.height=this.scrollHeight+'px'">${escHtml(trip.guestName)}</textarea>
          </div>
        </td>
        <td class="col-sticky-4">
          <input type="number" class="crm-inline-edit crm-edit-flush no-spin" style="background:transparent;font-size:inherit;color:inherit;width:3ch;text-align:center;" value="${trip.pax || 1}" data-id="${trip.id}" data-field="pax" title="Edit Pax" min="1">
        </td>
        <td class="col-sticky-5" style="font-weight:500;">
          <textarea class="crm-inline-edit" style="background:transparent;width:75px;font-weight:inherit;resize:none;overflow:hidden;height:auto;line-height:1.2;font-family:inherit;padding:0.2rem 0.3rem;display:block;" rows="1" data-id="${trip.id}" data-field="destination" title="Edit Country" placeholder="Country" oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'" onfocus="this.style.height='auto';this.style.height=this.scrollHeight+'px'">${escHtml(trip.destination || '')}</textarea>
        </td>
        <td class="col-sticky-6">
          <input type="date" class="crm-inline-edit crm-date-cell ${dateClass}" style="background:transparent;font-size:.74rem;width:120px;" value="${trip.startDate}" data-id="${trip.id}" data-field="startDate" title="Edit Start Date">
        </td>
        <td>${statusBadgeWithCount(trip, 'proposalStatus', 'proposal')}</td>
        <td>${statusBadgeWithCount(trip, 'flightsStatus', 'flights')}</td>
        <td>${statusBadgeWithCount(trip, 'visaStatus', 'visa')}</td>
        <td>${statusBadgeWithCount(trip, 'hotelsStatus', 'hotels')}</td>
        <td>${statusBadgeWithCount(trip, 'sectorTicketsStatus', 'sectorTickets')}</td>
        <td>${statusBadgeWithCount(trip, 'sightseeingStatus', 'sightseeing')}</td>
        <td>${statusBadgeWithCount(trip, 'insuranceStatus', 'insurance')}</td>
        <td>${statusBadgeWithCount(trip, 'travelingStatus', 'travefy')}</td>
        <td>${statusBadgeWithCount(trip, 'travefyTaskListStatus', 'travefyTaskList')}</td>
        <td>${statusBadgeWithCount(trip, 'tripFeedbackFormStatus', 'tripFeedbackForm')}</td>
        <td>
          <div class="crm-owner-cell">
            <div class="crm-owner-avatar" style="background:${ownerColor}" data-tooltip="${escHtml(trip.owner)}">${ownerInitials}</div>
            <select class="crm-inline-edit crm-owner-name" style="background:transparent;font-size:inherit;width:68px;cursor:pointer;" data-id="${trip.id}" data-field="owner" title="Edit Owner">
              ${ownerOptions(trip.owner)}
            </select>
          </div>
        </td>
        <td>
          <div class="crm-progress-wrap">
            <div class="crm-progress-bar-bg">
              <div class="crm-progress-bar-fill" style="width:${prog}%"></div>
            </div>
            <div class="crm-progress-label">${prog}%</div>
          </div>
        </td>
      `;
      fragment.appendChild(row);

      // Expanded row
      if (isExpanded) {
        const expRow = document.createElement('tr');
        expRow.className = 'crm-expanded-row';
        expRow.dataset.expandFor = trip.id;
        expRow.innerHTML = `<td colspan="18">${renderExpandedContent(trip)}</td>`;
        fragment.appendChild(expRow);
      }
    }
  }

  tbody.replaceChildren(fragment);

  // Footer
  document.getElementById('tableFooterInfo').textContent = `Showing ${page.length} of ${total} trips`;
  renderPagination(pages);

  // Sorting indicators
  document.querySelectorAll('.crm-table thead th').forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (th.dataset.col === sortCol) {
      th.classList.add(sortDir === 1 ? 'sorted-asc' : 'sorted-desc');
    }
  });

  // Attach events
  attachTableEvents();
  
  // Adjust textarea heights for wrapping guest names and countries
  document.querySelectorAll('td.col-sticky-3 textarea, td.col-sticky-5 textarea').forEach(ta => {
    if (ta.offsetParent !== null) {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    }
  });
  
  updateKPIs();
  } catch (err) {
    console.error('Failed to render ownership table', err);
    const tbody = document.getElementById('crmTbody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="18"><div class="crm-empty"><div class="crm-empty-icon">⚠️</div><div class="crm-empty-title">Could not render ownership data</div><div class="crm-empty-sub">Refresh the page to recover from this live update error.</div></div></td></tr>`;
    }
    const footer = document.getElementById('tableFooterInfo');
    if (footer) footer.textContent = 'Render error — please refresh';
  }
}

function renderExpandedContent(trip) {
  const taskMap = [
    ['proposal', 'Initial Proposal'],
    ['flights', 'Flights'],
    ['visa', 'Visa'],
    ['hotels', 'Hotels'],
    ['sectorTickets', 'Sector Tickets'],
    ['sightseeing', 'Sightseeing'],
    ['insurance', 'Insurance'],
    ['travefy', 'Travefy'],
    ['travefyTaskList', 'Travefy Task List'],
    ['tripFeedbackForm', 'Trip Feedback Form'],
  ];
  const masterSheetUrl = tripMasterSheetUrl(trip);
  const remindersHtml = (trip.reminders || []).map(r => `<span class="crm-reminder-tag">⏰ ${r.label}</span>`).join(' ') || '<span style="color:var(--crm-text-3);font-size:.75rem;">No reminders</span>';
  const taskCards = taskMap.map(([key, label]) => {
    const subs = ((trip.subtasks || {})[key] || []).filter(Boolean);
    const done = subs.filter(s => s.done).length;
    const progress = subs.length ? `${done}/${subs.length}` : '';
    const preview = subs.length
      ? `<div class="crm-task-subtasks-inline">${subs.slice(0, 2).map(sub => renderExpandedSubtask(sub, trip)).join('')}${subs.length > 2 ? `<div class="crm-task-more">+${subs.length - 2} more</div>` : ''}</div>`
      : '';
    return `
      <section class="crm-task-card compact">
        <div class="crm-task-card-head">
          <div>
            <div class="crm-task-title">${label}</div>
            ${progress ? `<div class="crm-task-meta">${progress}</div>` : ''}
          </div>
          <div class="crm-task-actions">
            <button class="crm-task-edit-btn crm-task-icon-btn" title="Edit subtasks" aria-label="Edit subtasks" onclick="openSubtaskModal(event,'${trip.id}','${key}')">${PENCIL_ICON}</button>
          </div>
        </div>
        ${preview}
      </section>
    `;
  }).join('');
  const notesHtml = escHtml(trip.latestUpdate || 'No notes yet.');

  return `
    <div class="crm-expanded-content crm-expanded-grid">
      <div class="crm-exp-section crm-trip-details-pane">
        <div class="crm-exp-title">Trip Details</div>
        <div class="crm-exp-row"><span class="crm-exp-key">Destination</span><span class="crm-exp-val">${escHtml(trip.destination||'—')}</span></div>
        <div class="crm-exp-row"><span class="crm-exp-key">Start Date</span><span class="crm-exp-val">${formatDate(trip.startDate)}</span></div>
        <div class="crm-exp-row"><span class="crm-exp-key">Pax</span><span class="crm-exp-val">${trip.pax || 1}</span></div>
        <div class="crm-exp-row"><span class="crm-exp-key">Owner</span><span class="crm-exp-val">${escHtml(trip.owner)}</span></div>
        <div class="crm-exp-row crm-link-editor">
          <span class="crm-exp-key">Master Sheet</span>
          <div class="crm-link-editor-controls">
            <input class="crm-master-sheet-input" type="text" spellcheck="false" value="${escHtml(masterSheetUrl)}" placeholder="https://docs.google.com/..." data-trip-id="${trip.id}">
            <button class="crm-task-edit-btn" type="button" onclick="saveTripMasterSheetFromExpanded('${trip.id}')">Save</button>
            <button class="crm-task-edit-btn crm-task-edit-secondary" type="button" onclick="openTripMasterSheet('${trip.id}')">Open</button>
          </div>
        </div>
        <div style="margin-top:.5rem;display:flex;gap:.4rem;flex-wrap:wrap;">
          <button class="crm-btn crm-btn-danger" onclick="deleteTrip('${trip.id}')" style="font-size:.72rem;padding:.3rem .7rem;">🗑️ Delete</button>
        </div>
        <div class="crm-trip-mini-section">
          <div class="crm-exp-title">Reminders & Notes</div>
          <div class="crm-trip-mini-reminders">${remindersHtml}</div>
          <div class="crm-trip-mini-notes">${notesHtml}</div>
        </div>
      </div>
      <div class="crm-exp-section crm-task-section">
        <div class="crm-exp-title">Task Breakdown</div>
        <div class="crm-task-grid">
          ${taskCards}
        </div>
      </div>
    </div>
  `;
}

function renderPagination(pages) {
  const el = document.getElementById('crmPagination');
  el.innerHTML = '';
  if (pages <= 1) return;
  const prev = document.createElement('button');
  prev.className = 'crm-page-btn';
  prev.textContent = '‹';
  prev.onclick = () => { if (currentPage > 1) { currentPage--; renderTable(); } };
  el.appendChild(prev);
  for (let i = 1; i <= pages; i++) {
    const btn = document.createElement('button');
    btn.className = 'crm-page-btn' + (i === currentPage ? ' active' : '');
    btn.textContent = i;
    btn.onclick = ((p) => () => { currentPage = p; renderTable(); })(i);
    el.appendChild(btn);
  }
  const next = document.createElement('button');
  next.className = 'crm-page-btn';
  next.textContent = '›';
  next.onclick = () => { if (currentPage < pages) { currentPage++; renderTable(); } };
  el.appendChild(next);
}

// ═══════════════════════════════════════════════════════════
// TABLE EVENTS
// ═══════════════════════════════════════════════════════════

function attachTableEvents() {
  // Expand buttons
  document.querySelectorAll('.crm-expand-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const row = btn.closest('tr');
      const nextRow = row?.nextElementSibling;
      if (nextRow && nextRow.classList.contains('crm-expanded-row') && nextRow.dataset.expandFor === id) {
        nextRow.remove();
        expandedRows.delete(id);
        row?.classList.remove('row-expanded');
        btn.classList.remove('expanded');
        return;
      }
      const trip = trips.find(t => t.id === id);
      if (!trip || !row) return;
      const expRow = document.createElement('tr');
      expRow.className = 'crm-expanded-row';
      expRow.dataset.expandFor = id;
      expRow.innerHTML = `<td colspan="18">${renderExpandedContent(trip)}</td>`;
      row.insertAdjacentElement('afterend', expRow);
      expandedRows.add(id);
      row.classList.add('row-expanded');
      btn.classList.add('expanded');
    });
  });

  // Inline edits
  document.querySelectorAll('.crm-inline-edit').forEach(inp => {
    const saveEdit = e => {
      const { id, field } = inp.dataset;
      const trip = trips.find(t => t.id === id);
      const val = inp.isContentEditable ? inp.innerText.trim() : inp.value;
      if (trip && trip[field] !== val) {
        trip[field] = val;
        syncTripRowDom(trip);
        saveTripPatch(trip, { [field]: val }).catch(err => {
          console.error('Ownership field save failed', err);
          toast('Could not save to database', '⚠️');
        });
        logActivity(`${trip.guestName} — ${field} updated`, '#6366f1');
        toast('Saved!');
      }
    };
    if (inp.isContentEditable) {
      inp.addEventListener('blur', saveEdit);
    } else {
      inp.addEventListener('change', saveEdit);
    }
    // Prevent row click from bubbling
    inp.addEventListener('click', e => e.stopPropagation());
  });

  document.querySelectorAll('.crm-link-avatar').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (btn.dataset.url) openTripMasterSheet(btn.dataset.id);
      else editTripMasterSheet(btn.dataset.id);
    });
  });

  document.querySelectorAll('.crm-master-sheet-input').forEach(input => {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveTripMasterSheetFromExpanded(input.dataset.tripId);
      }
    });
    input.addEventListener('blur', () => {
      const trip = trips.find(t => t.id === input.dataset.tripId);
      if (!trip) return;
      const current = tripMasterSheetUrl(trip);
      const next = normalizeUrl(input.value);
      if (next !== current) saveTripMasterSheetFromExpanded(input.dataset.tripId);
    });
  });

  // Row selection checkboxes
  document.querySelectorAll('.row-check').forEach(chk => {
    chk.addEventListener('change', e => {
      if (e.target.checked) selectedTrips.add(e.target.dataset.id);
      else selectedTrips.delete(e.target.dataset.id);
      updateSelectionStrip();
      updateSelectAllCheckbox();
    });
  });

  // Select all checkbox
  const selectAll = document.getElementById('selectAllTrips');
  if (selectAll) {
    selectAll.addEventListener('change', e => {
      const isChecked = e.target.checked;
      document.querySelectorAll('.row-check').forEach(chk => {
        chk.checked = isChecked;
        if (isChecked) selectedTrips.add(chk.dataset.id);
        else selectedTrips.delete(chk.dataset.id);
      });
      updateSelectionStrip();
    });
    updateSelectAllCheckbox();
  }
}

function updateSelectAllCheckbox() {
  const selectAll = document.getElementById('selectAllTrips');
  const allChecks = Array.from(document.querySelectorAll('.row-check'));
  if (!selectAll || allChecks.length === 0) {
    if (selectAll) selectAll.checked = false;
    return;
  }
  const allChecked = allChecks.every(chk => chk.checked);
  const someChecked = allChecks.some(chk => chk.checked);
  selectAll.checked = allChecked;
  selectAll.indeterminate = someChecked && !allChecked;
}

function updateSelectionStrip() {
  const strip = document.getElementById('crmSelectionStrip');
  const countSpan = document.getElementById('crmSelectionCount');
  if (!strip || !countSpan) return;
  if (selectedTrips.size > 0) {
    countSpan.textContent = selectedTrips.size;
    strip.classList.add('show');
  } else {
    strip.classList.remove('show');
  }
}

// Badge status dropdown (inline click on badge)
const statusMenu = (() => {
  const menu = document.createElement('div');
  menu.style.cssText = 'position:fixed;z-index:9999;background:var(--crm-surface);border:1px solid var(--crm-border);border-radius:10px;box-shadow:var(--crm-shadow-lg);padding:.4rem;min-width:150px;display:none;flex-direction:column;gap:.2rem;font-family:Inter,sans-serif;';
  document.body.appendChild(menu);
  document.addEventListener('click', () => { menu.style.display = 'none'; });
  return menu;
})();

window.openBadgeMenu = function(badge, event) {
  event.stopPropagation();
  cancelPendingOwnershipWork();
  const row = badge.closest('tr');
  const tripId = row?.dataset.id;
  const field = badge.dataset.field;
  if (!tripId || !field) return;

  statusMenu.innerHTML = '';
  for (const [val, label] of Object.entries(STATUS_LABELS)) {
    const opt = document.createElement('button');
    opt.style.cssText = 'display:flex;align-items:center;gap:.5rem;padding:.45rem .7rem;border:none;background:none;cursor:pointer;border-radius:7px;width:100%;text-align:left;font-size:.78rem;font-family:inherit;color:var(--crm-text);transition:background .1s;';
    opt.onmouseenter = () => opt.style.background = 'var(--crm-primary-light)';
    opt.onmouseleave = () => opt.style.background = 'none';
    const dot = document.createElement('span');
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${val==='complete'?'#10b981':val==='ongoing'?'#f59e0b':val==='pending'?'#ef4444':'#94a3b8'};display:inline-block;`;
    opt.appendChild(dot);
    opt.appendChild(document.createTextNode(label));
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const trip = trips.find(t => t.id === tripId);
      if (trip) {
        const previous = applyOwnershipStatusOptimistically(trip, field, val);
        syncTripRowDom(trip);
        saveTripPatch(trip, { [field]: val }).catch(err => {
          console.error('Ownership status save failed', err);
          if (previous !== undefined) {
            trip[field] = previous;
            cacheTripsForFastPaint(trips);
            syncTripRowDom(trip);
          }
          toast('Could not save status', '⚠️');
        });
        logActivity(`${trip.guestName} — ${field} → ${label}`, '#6366f1');
        toast(`Status updated to ${label}`);
      }
      statusMenu.style.display = 'none';
    });
    statusMenu.appendChild(opt);
  }

  // Separator + double-click hint for status cells
  const isStatusCell = [
    'proposalStatus',
    'flightsStatus',
    'visaStatus',
    'hotelsStatus',
    'sectorTicketsStatus',
    'sightseeingStatus',
    'insuranceStatus',
    'travelingStatus',
    'travefyTaskListStatus',
    'tripFeedbackFormStatus',
  ].includes(field);
  if (isStatusCell) {
    const hr = document.createElement('hr');
    hr.style.cssText = 'border:none;border-top:1px solid var(--crm-border);margin:.3rem 0;';
    statusMenu.appendChild(hr);
    const catMap = {
      proposalStatus: 'proposal',
      flightsStatus: 'flights',
      visaStatus: 'visa',
      hotelsStatus: 'hotels',
      sectorTicketsStatus: 'sectorTickets',
      sightseeingStatus: 'sightseeing',
      insuranceStatus: 'insurance',
      travelingStatus: 'travefy',
      travefyTaskListStatus: 'travefyTaskList',
      tripFeedbackFormStatus: 'tripFeedbackForm'
    };
    const btn = document.createElement('button');
    btn.style.cssText = 'display:flex;align-items:center;gap:.5rem;padding:.45rem .7rem;border:none;background:none;cursor:pointer;border-radius:7px;width:100%;text-align:left;font-size:.78rem;font-family:inherit;color:var(--crm-text);transition:background .1s;';
    btn.innerHTML = '📝 Manage Subtasks';
    btn.onmouseenter = () => btn.style.background = 'var(--crm-surface-2)';
    btn.onmouseleave = () => btn.style.background = 'none';
    btn.onclick = (e) => {
      e.stopPropagation();
      openSubtaskModal(e, tripId, catMap[field]);
      statusMenu.style.display = 'none';
    };
    statusMenu.appendChild(btn);
  }

  const r = badge.getBoundingClientRect();
  statusMenu.style.display = 'flex';
  const menuRect = statusMenu.getBoundingClientRect();
  
  if (r.bottom + 6 + menuRect.height > window.innerHeight) {
    statusMenu.style.top = (r.top - menuRect.height - 6) + 'px';
  } else {
    statusMenu.style.top = (r.bottom + 6) + 'px';
  }
  statusMenu.style.left = r.left + 'px';
};

window.openTripExpandedFromCount = function(event, tripId) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const row = document.querySelector(`tr[data-id="${tripId}"]`);
  if (!row) return;
  const btn = row.querySelector('.crm-expand-btn');
  if (btn) btn.click();
};

function persistTripMasterSheet(trip, url) {
  if (!trip) return null;
  trip.masterSheetUrl = normalizeUrl(url);
  cacheTripsForFastPaint(trips);
  syncTripRowDom(trip, { refreshExpanded: true });
  const patch = { masterSheetUrl: trip.masterSheetUrl };
  saveTripPatch(trip, patch).catch(err => {
    console.error('Master sheet save failed', err);
    toast('Could not save master sheet link', '⚠️');
  });
  return trip;
}

window.editTripMasterSheet = async function(tripId) {
  const trip = trips.find(t => t.id === tripId);
  if (!trip) return;
  const current = tripMasterSheetUrl(trip);
  const entered = prompt(`Enter the master sheet URL for ${trip.guestName}`, current || '');
  if (entered === null) return;
  const next = normalizeUrl(entered);
  if (!next) {
    if (!current) {
      toast('No URL saved', '⚠️');
      return;
    }
    trip.masterSheetUrl = '';
    try {
      persistTripMasterSheet(trip, '');
      toast('Master sheet link cleared');
    } catch (err) {
      console.error('Master sheet clear failed', err);
      toast('Could not clear master sheet link', '⚠️');
    }
    return;
  }
  try {
    persistTripMasterSheet(trip, next);
    toast('Master sheet link saved');
    if (current && next === current) {
      openTripMasterSheet(tripId);
    }
  } catch (err) {
    console.error('Master sheet save failed', err);
    toast('Could not save master sheet link', '⚠️');
  }
};

window.openTripMasterSheet = function(tripId) {
  const trip = trips.find(t => t.id === tripId);
  const url = tripMasterSheetUrl(trip);
  if (!url) {
    editTripMasterSheet(tripId);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
};

window.saveTripMasterSheetFromExpanded = async function(tripId) {
  const input = document.querySelector(`.crm-master-sheet-input[data-trip-id="${tripId}"]`);
  const trip = trips.find(t => t.id === tripId);
  if (!trip || !input) return;
  const next = normalizeUrl(input.value);
  try {
    persistTripMasterSheet(trip, next);
    if (next) toast('Master sheet link saved');
    else toast('Master sheet link cleared');
  } catch (err) {
    console.error('Master sheet save failed', err);
    toast('Could not save master sheet link', '⚠️');
  }
};

// ═══════════════════════════════════════════════════════════
// SUBTASK MODAL
// ═══════════════════════════════════════════════════════════

const STATUS_KEY_MAP = {
  visa: 'visaStatus', flights: 'flightsStatus', hotels: 'hotelsStatus',
  sectorTickets: 'sectorTicketsStatus',
  sightseeing: 'sightseeingStatus', insurance: 'insuranceStatus', travefy: 'travelingStatus',
  travefyTaskList: 'travefyTaskListStatus', tripFeedbackForm: 'tripFeedbackFormStatus'
};

const BELL_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path><path d="M18 8A6 6 0 0 0 6 8c0 7-3 7-3 9h18c0-2-3-2-3-9"></path></svg>';

function subtaskReminder(sub) {
  return sub?.metadata?.reminder || null;
}

function formatReminderDateLabel(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  if (isNaN(d.getTime())) return dateStr;
  if (d.getTime() === today.getTime()) return 'Due today';
  if (d.getTime() === tomorrow.getTime()) return 'Due tomorrow';
  return `Due ${new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(d)}`;
}

function reminderLabel(reminder) {
  if (reminder?.date) return formatReminderDateLabel(reminder.date);
  const days = parseInt(reminder?.days, 10);
  if (!days) return '';
  const dir = days < 0 ? 'after' : 'before';
  return `${Math.abs(days)} days ${dir}`;
}

function openSubtaskReminderModal(subtaskId) {
  const trip = trips.find(t => t.id === subtaskContext?.tripId);
  const sub = (trip?.subtasks?.[subtaskContext?.key] || []).find(item => item.id === subtaskId);
  if (!trip || !sub) return;

  let modal = document.getElementById('subtaskReminderModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'crm-mini-modal-overlay';
    modal.id = 'subtaskReminderModal';
    modal.innerHTML = `
      <div class="crm-mini-modal" role="dialog" aria-modal="true">
        <div class="crm-mini-modal-title">${BELL_ICON}<span>Subtask Reminder</span></div>
        <div class="crm-reminder-row" style="gap:0.4rem;">
          <span style="font-size:0.75rem;color:var(--crm-text-3);">Type</span>
          <select id="subtaskReminderType" class="crm-form-input" style="padding:0.2rem 0.4rem; height:auto; width:auto; font-size:0.75rem;">
            <option value="date">On specific date</option>
            <option value="relative">Days before/after trip</option>
          </select>
        </div>
        <div id="subtaskReminderDateRow" class="crm-reminder-row">
          <span style="font-size:0.75rem;color:var(--crm-text-3);">Date</span>
          <input type="date" id="subtaskReminderDate" class="crm-form-input" style="font-size:0.75rem;height:auto;padding:0.2rem 0.4rem;">
        </div>
        <div id="subtaskReminderRelativeRow" class="crm-reminder-row" style="display:none;">
          <span style="font-size:0.75rem;color:var(--crm-text-3);">Alert</span>
          <input type="number" id="subtaskReminderDays" min="1" max="180" value="7" style="width:4rem;">
          <select id="subtaskReminderDir" class="crm-form-input" style="padding:0.2rem 0.4rem; height:auto; width:auto; font-size:0.75rem;">
            <option value="before">days before trip</option>
            <option value="after">days after trip</option>
          </select>
        </div>
        <div id="subtaskReminderCalcDateRow" style="font-size:0.7rem;color:var(--crm-primary);margin-top:0.35rem;text-align:right;display:none;">
          Target Date: <span id="subtaskReminderCalcDateVal" style="font-weight:700;">—</span>
        </div>
        <div class="crm-mini-modal-actions">
          <button class="crm-btn crm-btn-ghost" id="clearSubtaskReminder">Clear</button>
          <button class="crm-btn crm-btn-ghost" id="cancelSubtaskReminder">Cancel</button>
          <button class="crm-btn crm-btn-primary" id="saveSubtaskReminder">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  modal.dataset.subtaskId = subtaskId;
  const currentReminder = sub.metadata?.reminder;
  const typeSelect = document.getElementById('subtaskReminderType');
  const dateRow = document.getElementById('subtaskReminderDateRow');
  const relRow = document.getElementById('subtaskReminderRelativeRow');

  const _updateCalcDate = () => {
    let days = parseInt(document.getElementById('subtaskReminderDays').value, 10);
    if (isNaN(days) || days < 1) {
      document.getElementById('subtaskReminderCalcDateVal').textContent = '—';
      return;
    }
    const dir = document.getElementById('subtaskReminderDir').value;
    const calculatedDate = window.getCalculatedRelativeDate ? getCalculatedRelativeDate(trip.startDate, days, dir) : null;
    if (calculatedDate) {
      document.getElementById('subtaskReminderCalcDateVal').textContent = calculatedDate.toISOString().slice(0, 10);
    } else {
      document.getElementById('subtaskReminderCalcDateVal').textContent = '—';
    }
  };

  const _syncReminderTypeView = () => {
    const isDate = typeSelect.value === 'date';
    dateRow.style.display = isDate ? '' : 'none';
    relRow.style.display = isDate ? 'none' : '';
    const calcRow = document.getElementById('subtaskReminderCalcDateRow');
    if (calcRow) {
      if (typeSelect.value === 'relative') {
        calcRow.style.display = '';
        _updateCalcDate();
      } else {
        calcRow.style.display = 'none';
      }
    }
  };
  typeSelect.onchange = _syncReminderTypeView;
  document.getElementById('subtaskReminderDays').oninput = _updateCalcDate;
  document.getElementById('subtaskReminderDir').onchange = _updateCalcDate;

  if (currentReminder?.days !== undefined) {
    typeSelect.value = 'relative';
    document.getElementById('subtaskReminderDays').value = Math.abs(currentReminder.days);
    document.getElementById('subtaskReminderDir').value = currentReminder.days < 0 ? 'after' : 'before';
  } else if (currentReminder?.date) {
    typeSelect.value = 'date';
    document.getElementById('subtaskReminderDate').value = currentReminder.date;
  } else {
    typeSelect.value = 'date';
    const todayStr = new Date().toISOString().slice(0, 10);
    document.getElementById('subtaskReminderDate').value = todayStr;
  }
  _syncReminderTypeView();
  modal.classList.add('open');

  document.getElementById('cancelSubtaskReminder').onclick = () => modal.classList.remove('open');
  modal.onclick = e => { if (e.target === modal) modal.classList.remove('open'); };
  document.getElementById('clearSubtaskReminder').onclick = () => {
    sub.metadata = { ...(sub.metadata || {}) };
    delete sub.metadata.reminder;
    modal.classList.remove('open');
    scheduleSubtaskModalRefresh();
  };
  document.getElementById('saveSubtaskReminder').onclick = () => {
    const type = document.getElementById('subtaskReminderType').value;
    if (type === 'date') {
      const dateVal = document.getElementById('subtaskReminderDate').value;
      if (!dateVal) return;
      sub.metadata = { ...(sub.metadata || {}), reminder: { date: dateVal, label: formatReminderDateLabel(dateVal) } };
    } else {
      let days = parseInt(document.getElementById('subtaskReminderDays').value, 10);
      if (isNaN(days) || days < 1) return;
      const dir = document.getElementById('subtaskReminderDir').value;
      const targetDate = window.getCalculatedRelativeDate ? getCalculatedRelativeDate(trip.startDate, days, dir) : null;
      let dateVal = '';
      if (targetDate) {
        dateVal = targetDate.toISOString().slice(0, 10);
      }
      if (dir === 'after') days = -days;
      sub.metadata = { ...(sub.metadata || {}), reminder: { days, date: dateVal, label: dateVal || `${Math.abs(days)} days ${dir}` } };
    }
    modal.classList.remove('open');
    scheduleSubtaskModalRefresh();
  };
}

function openNewSubtaskReminderModal() {
  let modal = document.getElementById('newSubtaskReminderModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'crm-mini-modal-overlay';
    modal.id = 'newSubtaskReminderModal';
    modal.innerHTML = `
      <div class="crm-mini-modal" role="dialog" aria-modal="true">
        <div class="crm-mini-modal-title">${BELL_ICON}<span>New Subtask Reminder</span></div>
        <div class="crm-reminder-row" style="gap:0.4rem;">
          <span style="font-size:0.75rem;color:var(--crm-text-3);">Type</span>
          <select id="newSubtaskReminderType" class="crm-form-input" style="padding:0.2rem 0.4rem; height:auto; width:auto; font-size:0.75rem;">
            <option value="date">On specific date</option>
            <option value="relative">Days before/after trip</option>
          </select>
        </div>
        <div id="newSubtaskReminderDateRow" class="crm-reminder-row">
          <span style="font-size:0.75rem;color:var(--crm-text-3);">Date</span>
          <input type="date" id="newSubtaskReminderDate" class="crm-form-input" style="font-size:0.75rem;height:auto;padding:0.2rem 0.4rem;">
        </div>
        <div id="newSubtaskReminderRelativeRow" class="crm-reminder-row" style="display:none;">
          <span style="font-size:0.75rem;color:var(--crm-text-3);">Alert</span>
          <input type="number" id="newSubtaskReminderDays" min="1" max="180" value="7" style="width:4rem;">
          <select id="newSubtaskReminderDir" class="crm-form-input" style="padding:0.2rem 0.4rem; height:auto; width:auto; font-size:0.75rem;">
            <option value="before">days before trip</option>
            <option value="after">days after trip</option>
          </select>
        </div>
        <div id="newSubtaskReminderCalcDateRow" style="font-size:0.7rem;color:var(--crm-primary);margin-top:0.35rem;text-align:right;display:none;">
          Target Date: <span id="newSubtaskReminderCalcDateVal" style="font-weight:700;">—</span>
        </div>
        <div class="crm-mini-modal-actions">
          <button class="crm-btn crm-btn-ghost" id="clearNewSubtaskReminder">Clear</button>
          <button class="crm-btn crm-btn-ghost" id="cancelNewSubtaskReminder">Cancel</button>
          <button class="crm-btn crm-btn-primary" id="saveNewSubtaskReminder">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const typeSelect = document.getElementById('newSubtaskReminderType');
  const dateRow = document.getElementById('newSubtaskReminderDateRow');
  const relRow = document.getElementById('newSubtaskReminderRelativeRow');
  const todayStr = new Date().toISOString().slice(0, 10);

  const trip = trips.find(t => t.id === subtaskContext?.tripId);
  const _updateCalcDate = () => {
    let days = parseInt(document.getElementById('newSubtaskReminderDays').value, 10);
    if (isNaN(days) || days < 1) {
      document.getElementById('newSubtaskReminderCalcDateVal').textContent = '—';
      return;
    }
    const dir = document.getElementById('newSubtaskReminderDir').value;
    const calculatedDate = (trip && window.getCalculatedRelativeDate) ? getCalculatedRelativeDate(trip.startDate, days, dir) : null;
    if (calculatedDate) {
      document.getElementById('newSubtaskReminderCalcDateVal').textContent = calculatedDate.toISOString().slice(0, 10);
    } else {
      document.getElementById('newSubtaskReminderCalcDateVal').textContent = '—';
    }
  };

  const _syncNewReminderTypeView = () => {
    const isDate = typeSelect.value === 'date';
    dateRow.style.display = isDate ? '' : 'none';
    relRow.style.display = isDate ? 'none' : '';
    const calcRow = document.getElementById('newSubtaskReminderCalcDateRow');
    if (calcRow) {
      if (typeSelect.value === 'relative') {
        calcRow.style.display = '';
        _updateCalcDate();
      } else {
        calcRow.style.display = 'none';
      }
    }
  };
  typeSelect.onchange = _syncNewReminderTypeView;
  document.getElementById('newSubtaskReminderDays').oninput = _updateCalcDate;
  document.getElementById('newSubtaskReminderDir').onchange = _updateCalcDate;

  if (pendingNewSubtaskReminder?.date) {
    typeSelect.value = 'date';
    document.getElementById('newSubtaskReminderDate').value = pendingNewSubtaskReminder.date;
  } else if (pendingNewSubtaskReminder?.days) {
    typeSelect.value = 'relative';
    const currentDays = pendingNewSubtaskReminder.days;
    document.getElementById('newSubtaskReminderDays').value = Math.abs(currentDays);
    document.getElementById('newSubtaskReminderDir').value = currentDays < 0 ? 'after' : 'before';
  } else {
    typeSelect.value = 'date';
    document.getElementById('newSubtaskReminderDate').value = todayStr;
  }
  _syncNewReminderTypeView();
  modal.classList.add('open');
  modal.onclick = e => { if (e.target === modal) modal.classList.remove('open'); };
  document.getElementById('cancelNewSubtaskReminder').onclick = () => modal.classList.remove('open');
  document.getElementById('clearNewSubtaskReminder').onclick = () => {
    pendingNewSubtaskReminder = null;
    modal.classList.remove('open');
    document.getElementById('newSubtaskReminderBtn')?.classList.remove('active');
  };
  document.getElementById('saveNewSubtaskReminder').onclick = () => {
    const type = document.getElementById('newSubtaskReminderType').value;
    if (type === 'date') {
      const dateVal = document.getElementById('newSubtaskReminderDate').value;
      if (!dateVal) return;
      pendingNewSubtaskReminder = { date: dateVal, label: formatReminderDateLabel(dateVal) };
    } else {
      let days = parseInt(document.getElementById('newSubtaskReminderDays').value, 10);
      if (isNaN(days) || days < 1) return;
      const dir = document.getElementById('newSubtaskReminderDir').value;
      const targetDate = (trip && window.getCalculatedRelativeDate) ? getCalculatedRelativeDate(trip.startDate, days, dir) : null;
      let dateVal = '';
      if (targetDate) dateVal = targetDate.toISOString().slice(0, 10);
      if (dir === 'after') days = -days;
      pendingNewSubtaskReminder = { days, date: dateVal, label: dateVal || `${Math.abs(days)} days ${dir}` };
    }
    modal.classList.remove('open');
    document.getElementById('newSubtaskReminderBtn')?.classList.add('active');
  };
}

function draftReminderFromRow(row) {
  if (row?.dataset?.reminderDate) return { date: row.dataset.reminderDate, label: row.dataset.reminderLabel };
  const days = parseInt(row?.dataset?.reminderDays || '', 10);
  if (isNaN(days)) return null;
  const dir = days < 0 ? 'after' : 'before';
  return { days, label: row.dataset.reminderLabel || `${Math.abs(days)} days ${dir}` };
}

function syncDraftReminderButton(row) {
  const btn = row?.querySelector('.crm-draft-reminder-btn');
  if (!btn) return;
  const reminder = draftReminderFromRow(row);
  btn.classList.toggle('active', !!reminder);
  btn.title = reminder ? reminderLabel(reminder) : 'Set reminder';
}

function openDraftSubtaskReminderModal(row) {
  if (!row) return;
  let modal = document.getElementById('draftSubtaskReminderModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'crm-mini-modal-overlay';
    modal.id = 'draftSubtaskReminderModal';
    modal.innerHTML = `
      <div class="crm-mini-modal" role="dialog" aria-modal="true">
        <div class="crm-mini-modal-title">${BELL_ICON}<span>Draft Subtask Reminder</span></div>
        <div class="crm-reminder-row" style="gap:0.4rem;">
          <span style="font-size:0.75rem;color:var(--crm-text-3);">Type</span>
          <select id="draftSubtaskReminderType" class="crm-form-input" style="padding:0.2rem 0.4rem; height:auto; width:auto; font-size:0.75rem;">
            <option value="date">On specific date</option>
            <option value="relative">Days before/after trip</option>
          </select>
        </div>
        <div id="draftSubtaskReminderDateRow" class="crm-reminder-row">
          <span style="font-size:0.75rem;color:var(--crm-text-3);">Date</span>
          <input type="date" id="draftSubtaskReminderDate" class="crm-form-input" style="font-size:0.75rem;height:auto;padding:0.2rem 0.4rem;">
        </div>
        <div id="draftSubtaskReminderRelativeRow" class="crm-reminder-row" style="display:none;">
          <span style="font-size:0.75rem;color:var(--crm-text-3);">Alert</span>
          <input type="number" id="draftSubtaskReminderDays" min="1" max="180" value="7" style="width:4rem;">
          <select id="draftSubtaskReminderDir" class="crm-form-input" style="padding:0.2rem 0.4rem; height:auto; width:auto; font-size:0.75rem;">
            <option value="before">days before trip</option>
            <option value="after">days after trip</option>
          </select>
        </div>
        <div id="draftSubtaskReminderCalcDateRow" style="font-size:0.7rem;color:var(--crm-primary);margin-top:0.35rem;text-align:right;display:none;">
          Target Date: <span id="draftSubtaskReminderCalcDateVal" style="font-weight:700;">—</span>
        </div>
        <div class="crm-mini-modal-actions">
          <button class="crm-btn crm-btn-ghost" id="clearDraftSubtaskReminder">Clear</button>
          <button class="crm-btn crm-btn-ghost" id="cancelDraftSubtaskReminder">Cancel</button>
          <button class="crm-btn crm-btn-primary" id="saveDraftSubtaskReminder">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const trip = trips.find(t => t.id === subtaskContext?.tripId);
  const typeSelect = document.getElementById('draftSubtaskReminderType');
  const dateRow = document.getElementById('draftSubtaskReminderDateRow');
  const relRow = document.getElementById('draftSubtaskReminderRelativeRow');
  const calcRow = document.getElementById('draftSubtaskReminderCalcDateRow');

  const _updateCalcDate = () => {
    let days = parseInt(document.getElementById('draftSubtaskReminderDays').value, 10);
    if (isNaN(days) || days < 1) {
      document.getElementById('draftSubtaskReminderCalcDateVal').textContent = '—';
      return;
    }
    const dir = document.getElementById('draftSubtaskReminderDir').value;
    const calculatedDate = (trip && window.getCalculatedRelativeDate) ? getCalculatedRelativeDate(trip.startDate, days, dir) : null;
    if (calculatedDate) {
      document.getElementById('draftSubtaskReminderCalcDateVal').textContent = calculatedDate.toISOString().slice(0, 10);
    } else {
      document.getElementById('draftSubtaskReminderCalcDateVal').textContent = '—';
    }
  };

  const _syncDraftReminderTypeView = () => {
    const isDate = typeSelect.value === 'date';
    dateRow.style.display = isDate ? '' : 'none';
    relRow.style.display = isDate ? 'none' : '';
    if (calcRow) {
      if (typeSelect.value === 'relative') {
        calcRow.style.display = '';
        _updateCalcDate();
      } else {
        calcRow.style.display = 'none';
      }
    }
  };
  typeSelect.onchange = _syncDraftReminderTypeView;
  document.getElementById('draftSubtaskReminderDays').oninput = _updateCalcDate;
  document.getElementById('draftSubtaskReminderDir').onchange = _updateCalcDate;

  const currentReminder = draftReminderFromRow(row);
  if (currentReminder?.days !== undefined && !currentReminder?.date) {
    typeSelect.value = 'relative';
    document.getElementById('draftSubtaskReminderDays').value = Math.abs(currentReminder.days);
    document.getElementById('draftSubtaskReminderDir').value = currentReminder.days < 0 ? 'after' : 'before';
  } else if (currentReminder?.date) {
    typeSelect.value = 'date';
    document.getElementById('draftSubtaskReminderDate').value = currentReminder.date;
  } else {
    typeSelect.value = 'date';
    document.getElementById('draftSubtaskReminderDate').value = new Date().toISOString().slice(0, 10);
  }
  _syncDraftReminderTypeView();

  modal.classList.add('open');
  modal.onclick = e => { if (e.target === modal) modal.classList.remove('open'); };
  document.getElementById('cancelDraftSubtaskReminder').onclick = () => modal.classList.remove('open');
  document.getElementById('clearDraftSubtaskReminder').onclick = () => {
    delete row.dataset.reminderDate;
    delete row.dataset.reminderDays;
    delete row.dataset.reminderLabel;
    syncDraftReminderButton(row);
    modal.classList.remove('open');
  };
  document.getElementById('saveDraftSubtaskReminder').onclick = () => {
    const type = document.getElementById('draftSubtaskReminderType').value;
    if (type === 'date') {
      const dateVal = document.getElementById('draftSubtaskReminderDate').value;
      if (!dateVal) return;
      delete row.dataset.reminderDays;
      row.dataset.reminderDate = dateVal;
      row.dataset.reminderLabel = formatReminderDateLabel(dateVal);
    } else {
      let days = parseInt(document.getElementById('draftSubtaskReminderDays').value, 10);
      if (isNaN(days) || days < 1) return;
      const dir = document.getElementById('draftSubtaskReminderDir').value;
      const targetDate = (trip && window.getCalculatedRelativeDate) ? getCalculatedRelativeDate(trip.startDate, days, dir) : null;
      let dateVal = '';
      if (targetDate) dateVal = targetDate.toISOString().slice(0, 10);
      if (dir === 'after') days = -days;
      
      row.dataset.reminderDays = String(days);
      if (dateVal) {
        row.dataset.reminderDate = dateVal;
      } else {
        delete row.dataset.reminderDate;
      }
      row.dataset.reminderLabel = dateVal || `${Math.abs(days)} days ${dir}`;
    }
    syncDraftReminderButton(row);
    modal.classList.remove('open');
  };
}

window.openSubtaskModal = function(event, tripId, key) {
  event.stopPropagation();
  statusMenu.style.display = 'none'; // hide single-click dropdown
  const trip = trips.find(t => t.id === tripId);
  if (!trip) return;
  if (!trip.subtasks) trip.subtasks = {};
  if (!trip.subtasks[key]) trip.subtasks[key] = [];
  subtaskContext = { tripId, key };

  document.getElementById('subtaskModalTitle').textContent = `${escHtml(trip.guestName)} · ${key.charAt(0).toUpperCase()+key.slice(1)} Subtasks`;
  document.getElementById('subtaskModalSubtitle').textContent = `${trip.destination} · ${formatDate(trip.startDate)}`;
  scheduleSubtaskModalRefresh();
  openModal('subtaskModal');
};

function renderSubtaskBody(subtasks) {
  const body = document.getElementById('subtaskModalBody');
  body.innerHTML = '';

  for (const sub of subtasks) {
    const item = document.createElement('div');
    item.className = 'crm-subtask-item';
    const reminder = subtaskReminder(sub);
    item.innerHTML = `
      <input type="checkbox" class="crm-subtask-check" ${sub.done ? 'checked' : ''} data-sid="${sub.id}">
      <input class="crm-subtask-text ${sub.done ? 'done' : ''}" value="${escHtml(sub.text)}" data-sid="${sub.id}">
      <select class="crm-subtask-assignee" data-sid="${sub.id}" title="Assign subtask">
        <option value="">Unassigned</option>
        ${ownerOptions(sub.assignee || '')}
      </select>
      <button class="crm-subtask-reminder ${reminder ? 'active' : ''}" data-sid="${sub.id}" title="${reminder ? escHtml(reminderLabel(reminder)) : 'Set reminder'}">${BELL_ICON}</button>
      <button class="crm-subtask-del" data-sid="${sub.id}" title="Delete">🗑</button>
    `;
    body.appendChild(item);

    // checkbox
    item.querySelector('.crm-subtask-check').addEventListener('change', e => {
      sub.done = e.target.checked;
      item.querySelector('.crm-subtask-text').classList.toggle('done', sub.done);
    });
    // text edit
    item.querySelector('.crm-subtask-text').addEventListener('change', e => {
      sub.text = e.target.value;
    });
    // assignee edit
    item.querySelector('.crm-subtask-assignee').addEventListener('change', e => {
      sub.assignee = e.target.value;
    });
    item.querySelector('.crm-subtask-reminder').addEventListener('click', () => {
      openSubtaskReminderModal(sub.id);
    });
    // delete
    item.querySelector('.crm-subtask-del').addEventListener('click', () => {
      const trip = trips.find(t => t.id === subtaskContext.tripId);
      trip.subtasks[subtaskContext.key] = trip.subtasks[subtaskContext.key].filter(s => s.id !== sub.id);
      scheduleSubtaskModalRefresh();
    });
  }

  // Add new subtask row
  const addRow = document.createElement('div');
  addRow.className = 'crm-add-subtask-row';
  const addInput = document.createElement('input');
  addInput.className = 'crm-add-subtask-input';
  addInput.placeholder = 'Add a subtask…';
  addInput.id = 'subtaskNewInput';
  addRow.appendChild(document.createTextNode('+ '));
  addRow.appendChild(addInput);
  const addAssignee = document.createElement('select');
  addAssignee.className = 'crm-filter-select';
  addAssignee.style.cssText = 'font-size:.75rem;min-width:130px;';
  addAssignee.innerHTML = `<option value="">Assign to...</option>${ownerOptions('')}`;
  addRow.appendChild(addAssignee);
  const addReminderBtn = document.createElement('button');
  addReminderBtn.className = `crm-subtask-reminder ${pendingNewSubtaskReminder ? 'active' : ''}`;
  addReminderBtn.id = 'newSubtaskReminderBtn';
  addReminderBtn.type = 'button';
  addReminderBtn.title = pendingNewSubtaskReminder ? reminderLabel(pendingNewSubtaskReminder) : 'Set reminder';
  addReminderBtn.innerHTML = BELL_ICON;
  addRow.appendChild(addReminderBtn);
  const addBtn = document.createElement('button');
  addBtn.className = 'crm-subtask-add-btn';
  addBtn.type = 'button';
  addBtn.title = 'Add subtask';
  addBtn.textContent = '+';
  addRow.appendChild(addBtn);
  body.appendChild(addRow);

  const doAdd = () => {
    const val = addInput.value.trim();
    if (!val) return;
    const trip = trips.find(t => t.id === subtaskContext.tripId);
    const assignee = addAssignee.value || '';
    const newSub = { id: uid(), text: val, done: false, assignee, createdAt: new Date().toISOString() };
    if (pendingNewSubtaskReminder) {
      newSub.metadata = { reminder: pendingNewSubtaskReminder };
      pendingNewSubtaskReminder = { date: ewGetTodayDateStr(), label: 'Due today' };
    } else {
      pendingNewSubtaskReminder = { date: ewGetTodayDateStr(), label: 'Due today' };
    }
    trip.subtasks[subtaskContext.key].push(newSub);
    scheduleSubtaskModalRefresh();
    addInput.focus();
  };
  addBtn.addEventListener('click', doAdd);
  addReminderBtn.addEventListener('click', openNewSubtaskReminderModal);
  addInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });

  // Reminder section
  const trip = trips.find(t => t.id === subtaskContext.tripId);
  const remDiv = document.createElement('div');
  remDiv.style.cssText = 'border-top:1px solid var(--crm-border);padding-top:.65rem;display:flex;flex-direction:column;gap:.5rem; margin-top:.5rem;';
  remDiv.innerHTML = `
    <div class="crm-form-label" style="display:flex; align-items:center;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;color:var(--crm-text-3);"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> Reminders for this trip
    </div>
    <div class="crm-reminder-row" id="reminderBuildRow">
      <span style="font-size:.78rem;color:var(--crm-text-3);">Alert me</span>
      <input type="number" id="reminderDaysInput" min="1" max="180" value="7" placeholder="7">
      <select id="reminderDirInput" class="crm-form-input" style="padding:0.1rem 0.2rem; height:auto; width:auto; font-size:0.75rem; border-color:transparent;">
        <option value="before">days before trip</option>
        <option value="after">days after trip</option>
      </select>
      <button class="crm-btn crm-btn-ghost crm-icon-btn" id="addReminderBtn" title="Add reminder">${BELL_ICON}</button>
    </div>
    <div id="reminderTagsWrap" style="display:flex;gap:.4rem;flex-wrap:wrap;">
      ${(trip.reminders||[]).map(r => `<span class="crm-reminder-tag"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-right:2px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> ${escHtml(r.label)} <button onclick="removeReminder(${r.days})" style="background:none;border:none;cursor:pointer;font-size:.75rem;margin-left:.2rem;">✕</button></span>`).join('')}
    </div>
  `;
  body.appendChild(remDiv);

  document.getElementById('addReminderBtn').addEventListener('click', () => {
    let days = parseInt(document.getElementById('reminderDaysInput').value, 10);
    if (isNaN(days) || days < 1) return;
    const dir = document.getElementById('reminderDirInput').value;
    if (dir === 'after') days = -days;
    const trip = trips.find(t => t.id === subtaskContext.tripId);
    if (!trip.reminders) trip.reminders = [];
    if (!trip.reminders.find(r => r.days === days)) {
      trip.reminders.push({ days, label: `${Math.abs(days)} days ${dir}` });
      scheduleSubtaskModalRefresh();
    }
  });
}

window.removeReminder = function(days) {
  const trip = trips.find(t => t.id === subtaskContext.tripId);
  if (trip) trip.reminders = (trip.reminders||[]).filter(r => r.days !== days);
  scheduleSubtaskModalRefresh();
};

function renderSubtaskBody(subtasks) {
  const body = document.getElementById('subtaskModalBody');
  body.innerHTML = '';
  const trip = trips.find(t => t.id === subtaskContext.tripId);
  if (!trip) return;

  for (const sub of subtasks) {
    const item = document.createElement('div');
    item.className = 'crm-subtask-item';
    const reminder = subtaskReminder(sub);
    item.innerHTML = `
      <input type="checkbox" class="crm-subtask-check" ${sub.done ? 'checked' : ''} data-sid="${sub.id}">
      <input class="crm-subtask-text ${sub.done ? 'done' : ''}" value="${escHtml(sub.text)}" data-sid="${sub.id}">
      <select class="crm-subtask-assignee" data-sid="${sub.id}" title="Assign subtask">
        ${ownerOptions(sub.assignee || trip.owner || '')}
      </select>
      <button class="crm-subtask-reminder ${reminder ? 'active' : ''}" data-sid="${sub.id}" title="${reminder ? escHtml(reminderLabel(reminder)) : 'Set reminder'}">${BELL_ICON}</button>
      <button class="crm-subtask-del" data-sid="${sub.id}" title="Delete">🗑</button>
    `;
    body.appendChild(item);

    item.querySelector('.crm-subtask-check').addEventListener('change', e => {
      sub.done = e.target.checked;
      item.querySelector('.crm-subtask-text').classList.toggle('done', sub.done);
    });
    item.querySelector('.crm-subtask-text').addEventListener('change', e => {
      sub.text = e.target.value;
    });
    item.querySelector('.crm-subtask-assignee').addEventListener('change', e => {
      sub.assignee = e.target.value;
    });
    item.querySelector('.crm-subtask-reminder').addEventListener('click', () => {
      openSubtaskReminderModal(sub.id);
    });
    item.querySelector('.crm-subtask-del').addEventListener('click', () => {
      const trip = trips.find(t => t.id === subtaskContext.tripId);
      trip.subtasks[subtaskContext.key] = trip.subtasks[subtaskContext.key].filter(s => s.id !== sub.id);
      scheduleSubtaskModalRefresh();
    });
  }

  const draftsWrap = document.createElement('div');
  draftsWrap.className = 'crm-subtask-drafts';
  draftsWrap.innerHTML = `
    <div class="crm-subtask-drafts-head">
      <div class="crm-form-label" style="margin:0;">Add subtasks</div>
      <button class="crm-subtask-add-btn" type="button" title="Add another subtask">+</button>
    </div>
    <div class="crm-subtask-draft-list"></div>
  `;
  const draftList = draftsWrap.querySelector('.crm-subtask-draft-list');

  const addDraftRow = (draft = {}) => {
    const row = document.createElement('div');
    row.className = 'crm-subtask-draft-row';
    row.dataset.rowId = draft.id || uid();

    const core = document.createElement('div');
    core.className = 'crm-subtask-draft-core';

    const text = document.createElement('input');
    text.className = 'crm-subtask-draft-input';
    text.placeholder = 'Add a subtask...';
    text.value = draft.text || '';

    const assignee = document.createElement('select');
    assignee.className = 'crm-subtask-draft-assignee';
    assignee.innerHTML = ownerOptions(draft.assignee || trip.owner || '');
    assignee.value = draft.assignee || trip.owner || '';

    core.appendChild(text);
    core.appendChild(assignee);

    const actions = document.createElement('div');
    actions.className = 'crm-subtask-draft-actions';

    const reminderBtn = document.createElement('button');
    reminderBtn.type = 'button';
    reminderBtn.className = 'crm-subtask-reminder crm-draft-reminder-btn';
    reminderBtn.innerHTML = BELL_ICON;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'crm-subtask-del crm-draft-remove-btn';
    removeBtn.title = 'Remove draft';
    removeBtn.textContent = '✕';

    actions.appendChild(reminderBtn);
    actions.appendChild(removeBtn);

    row.appendChild(core);
    row.appendChild(actions);
    draftList.appendChild(row);
    syncDraftReminderButton(row);

    reminderBtn.addEventListener('click', () => openDraftSubtaskReminderModal(row));
    removeBtn.addEventListener('click', () => row.remove());
    text.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        draftsWrap.querySelector('.crm-subtask-add-btn')?.click();
      }
    });

    return row;
  };

  addDraftRow();
  draftsWrap.querySelector('.crm-subtask-add-btn').addEventListener('click', () => {
    const row = addDraftRow();
    row.querySelector('.crm-subtask-draft-input')?.focus();
  });
  body.appendChild(draftsWrap);

  const remDiv = document.createElement('div');
  remDiv.style.cssText = 'border-top:1px solid var(--crm-border);padding-top:.65rem;display:flex;flex-direction:column;gap:.5rem; margin-top:.5rem;';
  remDiv.innerHTML = `
    <div class="crm-form-label" style="display:flex; align-items:center;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;color:var(--crm-text-3);"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> Reminders for this trip
    </div>
    <div class="crm-reminder-row" id="reminderBuildRow">
      <span style="font-size:.78rem;color:var(--crm-text-3);">Alert me</span>
      <input type="number" id="reminderDaysInput" min="1" max="180" value="7" placeholder="7">
      <select id="reminderDirInput" class="crm-form-input" style="padding:0.1rem 0.2rem; height:auto; width:auto; font-size:0.75rem; border-color:transparent;">
        <option value="before">days before trip</option>
        <option value="after">days after trip</option>
      </select>
      <button class="crm-btn crm-btn-ghost crm-icon-btn" id="addReminderBtn" title="Add reminder">${BELL_ICON}</button>
    </div>
    <div id="reminderTagsWrap" style="display:flex;gap:.4rem;flex-wrap:wrap;">
      ${(trip.reminders||[]).map(r => `<span class="crm-reminder-tag"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-right:2px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> ${escHtml(r.label)} <button onclick="removeReminder(${r.days})" style="background:none;border:none;cursor:pointer;font-size:.75rem;margin-left:.2rem;">✕</button></span>`).join('')}
    </div>
  `;
  body.appendChild(remDiv);

  document.getElementById('addReminderBtn').addEventListener('click', () => {
    let days = parseInt(document.getElementById('reminderDaysInput').value, 10);
    if (isNaN(days) || days < 1) return;
    const dir = document.getElementById('reminderDirInput').value;
    if (dir === 'after') days = -days;
    const trip = trips.find(t => t.id === subtaskContext.tripId);
    if (!trip.reminders) trip.reminders = [];
    if (!trip.reminders.find(r => r.days === days)) {
      trip.reminders.push({ days, label: `${Math.abs(days)} days ${dir}` });
      scheduleSubtaskModalRefresh();
    }
  });
}

document.getElementById('btnSaveSubtasks').addEventListener('click', () => {
  const trip = trips.find(t => t.id === subtaskContext?.tripId);
  if (trip) {
    closeModal('subtaskModal');
    toast('Subtasks saved!');
    const tripId = trip.id;
    const key = subtaskContext.key;
    requestAnimationFrame(() => {
      const currentTrip = trips.find(t => t.id === tripId);
      if (!currentTrip) return;
      const body = document.getElementById('subtaskModalBody');
      if (!body) return;

      const nextSubs = [];
      body.querySelectorAll('.crm-subtask-item').forEach(item => {
        const text = item.querySelector('.crm-subtask-text')?.value.trim();
        if (!text) return;
        const sid = item.querySelector('.crm-subtask-text')?.dataset.sid || uid();
        const existing = (currentTrip.subtasks?.[key] || []).find(s => s.id === sid);
        nextSubs.push({
          id: sid,
          text,
          done: !!item.querySelector('.crm-subtask-check')?.checked,
          assignee: item.querySelector('.crm-subtask-assignee')?.value || currentTrip.owner || '',
          createdAt: existing?.createdAt || '',
          metadata: existing?.metadata || {},
        });
      });

      body.querySelectorAll('.crm-subtask-draft-row').forEach(row => {
        const text = row.querySelector('.crm-subtask-draft-input')?.value.trim();
        if (!text) return;
        const reminder = draftReminderFromRow(row) || { date: ewGetTodayDateStr(), label: 'Due today' };
        nextSubs.push({
          id: uid(),
          text,
          done: false,
          assignee: row.querySelector('.crm-subtask-draft-assignee')?.value || currentTrip.owner || '',
          createdAt: new Date().toISOString(),
          ...(reminder ? { metadata: { reminder } } : {}),
        });
      });

      const previousSubtasks = currentTrip.subtasks ? JSON.parse(JSON.stringify(currentTrip.subtasks)) : {};
      currentTrip.subtasks[key] = nextSubs;
      cacheTripsForFastPaint(trips);
      syncTripRowDom(currentTrip, { refreshExpanded: true });
      saveTripPatch(currentTrip, { subtasks: currentTrip.subtasks, reminders: currentTrip.reminders || [] }).catch(err => {
        console.error('Subtask save failed', err);
        currentTrip.subtasks = previousSubtasks;
        cacheTripsForFastPaint(trips);
        syncTripRowDom(currentTrip, { refreshExpanded: true });
        toast('Could not save subtasks', '⚠️');
      });
    });
  }
});

// Final override so the expandable saved-list renderer wins over older legacy definitions above.
renderSavedTemplates = function() {
  const el = document.getElementById('savedTemplatesList');
  if (!el) return;
  if (!taskTemplates.length) {
    el.innerHTML = '<div style="font-size:.78rem;color:var(--crm-text-3);padding:.5rem 0;">No category lists yet. Create one above.</div>';
    return;
  }
  el.innerHTML = taskTemplates.map(tpl => {
    const isExpanded = expandedTemplateIds.has(tpl.id);
    const label = taskGroupLabel(tpl.taskGroup) || 'Category List';
    return `
      <div class="crm-tpl-item" id="tpl-${tpl.id}" style="display:flex;flex-direction:column;gap:.4rem;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.6rem;">
          <div style="min-width:0;">
            <div class="crm-tpl-name">${escHtml(label)}</div>
            <div class="crm-tpl-meta">${tpl.tasks.length} tasks</div>
          </div>
          <div style="display:flex;align-items:center;gap:.35rem;flex-shrink:0;">
            <button type="button" onclick="event.stopPropagation();toggleTemplateDetails('${tpl.id}')" title="${isExpanded ? 'Collapse' : 'Expand'}" style="background:none;border:none;cursor:pointer;padding:0;color:var(--crm-text-3);font-size:.95rem;line-height:1;transform:${isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'};transition:transform .15s ease;">›</button>
            <button onclick="event.stopPropagation();openApplyTemplateModal('${tpl.id}')" class="crm-btn crm-btn-ghost" style="font-size:.7rem;padding:.25rem .6rem;">Apply</button>
            <button onclick="event.stopPropagation();deleteTemplate('${tpl.id}')" style="background:none;border:none;cursor:pointer;color:var(--crm-text-3);font-size:.85rem;" title="Delete">🗑</button>
          </div>
        </div>
        ${isExpanded ? `
          <div style="border-top:1px solid var(--crm-border-1);padding-top:.45rem;display:flex;flex-direction:column;gap:.35rem;">
            ${tpl.tasks.map(task => `
              <div style="display:flex;align-items:flex-start;gap:.5rem;padding:.35rem .45rem;border:1px solid var(--crm-border-1);border-radius:10px;background:var(--crm-surface-1);">
                <div style="flex:1;min-width:0;">
                  <div style="font-size:.82rem;font-weight:700;color:var(--crm-text-1);">${escHtml(task.text || '')}</div>
                  <div style="font-size:.72rem;color:var(--crm-text-3);">${task.reminderDays ? `${task.reminderDays} day reminder` : 'No reminder'}</div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
};

renderSavedTemplates = function() {
  const el = document.getElementById('savedTemplatesList');
  if (!el) return;
  if (!taskTemplates.length) {
    el.innerHTML = '<div style="font-size:.78rem;color:var(--crm-text-3);padding:.5rem 0;">No category lists yet. Create one above.</div>';
    return;
  }
  el.innerHTML = taskTemplates.map(tpl => `
    <div class="crm-tpl-item" id="tpl-${tpl.id}">
      <div>
        <div class="crm-tpl-name">${escHtml(taskGroupLabel(tpl.taskGroup) || 'Category List')}</div>
        <div class="crm-tpl-meta">${tpl.tasks.length} tasks · ${escHtml(taskGroupLabel(tpl.taskGroup))}</div>
      </div>
      <div style="display:flex;gap:.4rem;">
        <button onclick="openApplyTemplateModal('${tpl.id}')" class="crm-btn crm-btn-ghost" style="font-size:.7rem;padding:.25rem .6rem;">Apply</button>
        <button onclick="deleteTemplate('${tpl.id}')" style="background:none;border:none;cursor:pointer;color:var(--crm-text-3);font-size:.85rem;" title="Delete">🗑</button>
      </div>
    </div>
  `).join('');
};

function renderSavedTemplates() {
  const el = document.getElementById('savedTemplatesList');
  if (!el) return;
  if (!taskTemplates.length) {
    el.innerHTML = '<div style="font-size:.78rem;color:var(--crm-text-3);padding:.5rem 0;">No category lists yet. Create one above.</div>';
    return;
  }
  el.innerHTML = taskTemplates.map(tpl => `
    <div class="crm-tpl-item" id="tpl-${tpl.id}">
      <div>
        <div class="crm-tpl-name">${escHtml(taskGroupLabel(tpl.taskGroup) || 'Category List')}</div>
        <div class="crm-tpl-meta">${escHtml(taskGroupLabel(tpl.taskGroup))} · ${tpl.tasks.length} tasks</div>
      </div>
      <div style="display:flex;gap:.4rem;">
        <button onclick="openApplyTemplateModal('${tpl.id}')" class="crm-btn crm-btn-ghost" style="font-size:.7rem;padding:.25rem .6rem;">Apply</button>
        <button onclick="deleteTemplate('${tpl.id}')" style="background:none;border:none;cursor:pointer;color:var(--crm-text-3);font-size:.85rem;" title="Delete">🗑</button>
      </div>
    </div>
  `).join('');
}

function renderSavedTemplates() {
  const el = document.getElementById('savedTemplatesList');
  if (!el) return;
  if (!taskTemplates.length) {
    el.innerHTML = '<div style="font-size:.78rem;color:var(--crm-text-3);padding:.5rem 0;">No category lists yet. Create one above.</div>';
    return;
  }
  el.innerHTML = taskTemplates.map(tpl => `
    <div class="crm-tpl-item" id="tpl-${tpl.id}">
      <div>
        <div class="crm-tpl-name">${escHtml(taskGroupLabel(tpl.taskGroup) || 'Category List')}</div>
        <div class="crm-tpl-meta">${escHtml(taskGroupLabel(tpl.taskGroup))} · ${tpl.tasks.length} tasks</div>
      </div>
      <div style="display:flex;gap:.4rem;">
        <button onclick="openApplyTemplateModal('${tpl.id}')" class="crm-btn crm-btn-ghost" style="font-size:.7rem;padding:.25rem .6rem;">Apply</button>
        <button onclick="deleteTemplate('${tpl.id}')" style="background:none;border:none;cursor:pointer;color:var(--crm-text-3);font-size:.85rem;" title="Delete">🗑</button>
      </div>
    </div>
  `).join('');
}

document.getElementById('btnApplyTemplate').addEventListener('click', () => {
  if (!taskTemplates.length) { toast('No category lists saved yet!', '⚠️'); return; }
  // Show quick pick
  const trip = trips.find(t => t.id === subtaskContext.tripId);
  const key = subtaskContext.key;
  const labels = taskTemplates.map(t => `${taskGroupLabel(t.taskGroup)} · ${t.tasks.length} tasks`);
  const chosen = prompt(`Apply category list to ${key}:\n${labels.map((n,i) => `${i+1}. ${n}`).join('\n')}\n\nEnter number:`);
  if (!chosen) return;
  const idx = parseInt(chosen, 10) - 1;
  if (isNaN(idx) || !taskTemplates[idx]) { toast('Invalid choice', '⚠️'); return; }
  const tpl = taskTemplates[idx];
  if (!trip.subtasks[key]) trip.subtasks[key] = [];
  for (const task of tpl.tasks) {
    const taskText = String(task?.text || task || '').trim();
    if (!taskText) continue;
    const newTask = { id: uid(), text: taskText, done: false, assignee: trip.owner };
    const reminderDays = parseInt(task?.reminderDays, 10);
    if (Number.isFinite(reminderDays) && reminderDays !== 0) {
      const dir = reminderDays < 0 ? 'after' : 'before';
      newTask.metadata = { reminder: { days: reminderDays, label: `${Math.abs(reminderDays)} days ${dir}` } };
    }
    trip.subtasks[key].push(newTask);
  }
  scheduleSubtaskModalRefresh();
  toast(`Category list for ${taskGroupLabel(tpl.taskGroup)} applied!`);
});

function renderApplyTemplateModal() {
  const tplSel = document.getElementById('applyTemplateSelect');
  const tripSel = document.getElementById('applyTripSelect');
  const taskList = document.getElementById('applyTemplateTaskList');
  if (!tplSel || !tripSel || !taskList) return;

  if (!taskTemplates.length) {
    tplSel.innerHTML = '<option value="">No category lists saved</option>';
    tripSel.innerHTML = '<option value="">No trips available</option>';
    taskList.innerHTML = '<div style="font-size:.78rem;color:var(--crm-text-3);padding:.25rem 0;">Save a category list first.</div>';
    return;
  }

  const tplId = applyTemplateState.tplId && taskTemplates.some(t => t.id === applyTemplateState.tplId)
    ? applyTemplateState.tplId
    : taskTemplates[0].id;
  applyTemplateState.tplId = tplId;
  tplSel.innerHTML = taskTemplates.map(tpl => `
    <option value="${tpl.id}" ${tpl.id === tplId ? 'selected' : ''}>
      ${escHtml(taskGroupLabel(tpl.taskGroup) || 'Category List')} (${tpl.tasks.length} tasks)
    </option>
  `).join('');

  const tripId = applyTemplateState.tripId && trips.some(t => t.id === applyTemplateState.tripId)
    ? applyTemplateState.tripId
    : (subtaskContext?.tripId || trips[0]?.id || '');
  applyTemplateState.tripId = tripId;
  tripSel.innerHTML = trips.map(trip => `
    <option value="${trip.id}" ${trip.id === tripId ? 'selected' : ''}>
      ${escHtml(trip.guestName || 'Unnamed Trip')} · ${escHtml(trip.destination || 'No destination')}
    </option>
  `).join('');

  const tpl = taskTemplates.find(t => t.id === tplId);
  const tasks = tpl?.tasks || [];
  if (!applyTemplateState.selectedIndexes.length || applyTemplateState.selectedIndexes.some(i => i >= tasks.length)) {
    applyTemplateState.selectedIndexes = tasks.map((_, idx) => idx);
  }
  const selected = new Set(applyTemplateState.selectedIndexes);
  taskList.innerHTML = tasks.length ? tasks.map((task, idx) => `
    <label class="crm-subtask-draft-row crm-template-task-card" style="align-items:center;gap:.6rem;padding:.45rem .55rem;cursor:pointer;">
      <input type="checkbox" class="apply-template-task-check" data-index="${idx}" ${selected.has(idx) ? 'checked' : ''} style="width:14px;height:14px;flex:0 0 auto;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:.82rem;font-weight:700;color:var(--crm-text-1);">${escHtml(task.text || '')}</div>
        <div style="font-size:.72rem;color:var(--crm-text-3);">${task.reminderDays ? `${Math.abs(task.reminderDays)} days ${task.reminderDays < 0 ? 'after' : 'before'}` : 'No reminder'}</div>
      </div>
    </label>
  `).join('') : '<div style="font-size:.78rem;color:var(--crm-text-3);padding:.25rem 0;">No tasks in this list.</div>';

  taskList.querySelectorAll('.apply-template-task-check').forEach(cb => {
    cb.addEventListener('change', () => {
      applyTemplateState.selectedIndexes = [...taskList.querySelectorAll('.apply-template-task-check:checked')]
        .map(el => parseInt(el.dataset.index, 10))
        .filter(Number.isFinite);
    });
  });
}

function openApplyTemplateModal(tplId = '') {
  if (!taskTemplates.length) {
    toast('No category lists saved yet!', 'âš ï¸');
    return;
  }
  applyTemplateState.tplId = tplId || taskTemplates[0]?.id || '';
  applyTemplateState.tripId = subtaskContext?.tripId || trips[0]?.id || '';
  applyTemplateState.selectedIndexes = [];
  renderApplyTemplateModal();
  openModal('applyTemplateModal');
}

function applySelectedTemplateTasks() {
  const tpl = taskTemplates.find(t => t.id === applyTemplateState.tplId);
  const trip = trips.find(t => t.id === applyTemplateState.tripId);
  if (!tpl) { toast('Pick a category list', '⚠️'); return; }
  if (!trip) { toast('Pick a trip', '⚠️'); return; }
  const indexes = [...document.querySelectorAll('#applyTemplateTaskList .apply-template-task-check:checked')]
    .map(el => parseInt(el.dataset.index, 10))
    .filter(Number.isFinite);
  if (!indexes.length) { toast('Pick at least one task', '⚠️'); return; }
  const key = tpl.taskGroup || 'visa';
  if (!trip.subtasks) trip.subtasks = {};
  if (!trip.subtasks[key]) trip.subtasks[key] = [];
  let added = 0;
  for (const idx of indexes) {
    const task = tpl.tasks[idx];
    const taskText = String(task?.text || '').trim();
    if (!taskText) continue;
    const newTask = { id: uid(), text: taskText, done: false, assignee: trip.owner };
    const reminderDays = parseInt(task?.reminderDays, 10);
    if (Number.isFinite(reminderDays) && reminderDays > 0) {
      newTask.metadata = { reminder: { days: reminderDays, label: `${reminderDays} days before` } };
    }
    trip.subtasks[key].push(newTask);
    added++;
  }
  saveTripPatch(trip, { subtasks: trip.subtasks }).catch(() => {});
  if (subtaskContext?.tripId === trip.id && subtaskContext?.key === key) {
    scheduleSubtaskModalRefresh();
  } else {
    syncTripRowDom(trip, { refreshExpanded: true });
  }
  closeModal('applyTemplateModal');
  toast(`Applied ${added} task${added === 1 ? '' : 's'} to ${trip.guestName || 'the trip'}`);
}

// Populate assignee select
function populateAssigneeSelect() {
  const sel = document.getElementById('subtaskAssignSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">Assign to…</option>';
  for (const name of employeeNames()) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  }
}

// ═══════════════════════════════════════════════════════════
// TASK TEMPLATE MODAL
// ═══════════════════════════════════════════════════════════

document.getElementById('btnTaskTemplates').addEventListener('click', () => {
  newTplTasks = [];
  document.getElementById('tplTaskGroup').value = 'visa';
  renderTplTasksList();
  renderSavedTemplates();
  openModal('templateModal');
});

function renderTplTasksList() {
  const el = document.getElementById('tplTasksList');
  el.innerHTML = newTplTasks.map((t, i) => `
    <div class="crm-subtask-draft-row" style="padding:.45rem .55rem;">
      <div class="crm-subtask-draft-core" style="gap:.45rem;">
        <span style="color:var(--crm-text-3);font-size:.75rem;font-weight:700;flex-shrink:0;">${i+1}.</span>
        <input class="crm-subtask-draft-input tpl-task-input" data-index="${i}" value="${escHtml(t.text || '')}" placeholder="Add a task..." style="font-size:.82rem;">
        <input class="crm-subtask-draft-input tpl-task-reminder" data-index="${i}" value="${Math.abs(t.reminderDays) || ''}" placeholder="Reminder days" style="font-size:.82rem;max-width:100px;">
        <select class="crm-subtask-draft-input tpl-task-reminder-dir" data-index="${i}" style="font-size:.82rem; max-width: 80px; padding: 0.2rem;">
          <option value="before" ${!t.reminderDays || t.reminderDays > 0 ? 'selected' : ''}>before</option>
          <option value="after" ${t.reminderDays < 0 ? 'selected' : ''}>after</option>
        </select>
      </div>
      <div class="crm-subtask-draft-actions">
        <button onclick="removeTplTask(${i})" class="crm-subtask-del crm-draft-remove-btn" type="button" title="Remove task">✕</button>
      </div>
    </div>
  `).join('');
  el.querySelectorAll('.tpl-task-input').forEach(inp => {
    inp.addEventListener('input', e => {
      const idx = parseInt(e.target.dataset.index, 10);
      if (isNaN(idx)) return;
      newTplTasks[idx].text = e.target.value;
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btnAddTplTask').click();
      }
    });
  });
  
  const updateReminderDir = (idx, wrapper) => {
    const valInput = wrapper.querySelector('.tpl-task-reminder').value;
    const dirInput = wrapper.querySelector('.tpl-task-reminder-dir').value;
    let val = parseInt(valInput, 10);
    if (!Number.isFinite(val) || val < 1) {
      newTplTasks[idx].reminderDays = '';
    } else {
      newTplTasks[idx].reminderDays = dirInput === 'after' ? -val : val;
    }
  };

  el.querySelectorAll('.crm-subtask-draft-row').forEach((row, i) => {
    const rInp = row.querySelector('.tpl-task-reminder');
    const dInp = row.querySelector('.tpl-task-reminder-dir');
    if(rInp) rInp.addEventListener('input', () => updateReminderDir(i, row));
    if(dInp) dInp.addEventListener('change', () => updateReminderDir(i, row));
  });
}

window.removeTplTask = function(i) {
  newTplTasks.splice(i, 1);
  renderTplTasksList();
};

document.getElementById('btnAddTplTask').addEventListener('click', () => {
  newTplTasks.push({ text: '', reminderDays: '' });
  renderTplTasksList();
  const inputs = document.querySelectorAll('#tplTasksList .tpl-task-input');
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
});

document.getElementById('btnSaveTemplate').addEventListener('click', () => {
  const taskGroup = document.getElementById('tplTaskGroup').value || '';
  const tasks = newTplTasks
    .map(t => ({
      text: String(t?.text || '').trim(),
      reminderDays: parseInt(t?.reminderDays, 10) || null,
    }))
    .filter(t => t.text);
  if (!taskGroup) { toast('Choose a task category', '⚠️'); return; }
  if (!tasks.length) { toast('Add at least one task', '⚠️'); return; }
  const template = { id: uid(), taskGroup, tasks: [...tasks], reminderDays: null };
  taskTemplates.push(template);
  renderSavedTemplates();
  saveTemplates(template);
  newTplTasks = [];
  document.getElementById('tplTaskGroup').value = 'visa';
  renderTplTasksList();
  toast(`Category list for ${taskGroupLabel(taskGroup)} saved!`);
});

function renderSavedTemplates() {
  const el = document.getElementById('savedTemplatesList');
  if (!taskTemplates.length) {
    el.innerHTML = '<div style="font-size:.78rem;color:var(--crm-text-3);padding:.5rem 0;">No category lists yet. Create one above.</div>';
    return;
  }
  el.innerHTML = taskTemplates.map(tpl => {
    const isExpanded = expandedTemplateIds.has(tpl.id);
    return `
    <div class="crm-tpl-item" id="tpl-${tpl.id}" style="display:flex;flex-direction:column;gap:.4rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:.6rem;cursor:pointer;" onclick="toggleTemplateDetails('${tpl.id}')">
        <div style="min-width:0;">
          <div class="crm-tpl-name">${escHtml(taskGroupLabel(tpl.taskGroup) || 'Category List')}</div>
          <div class="crm-tpl-meta">${tpl.tasks.length} tasks</div>
        </div>
        <div style="display:flex;align-items:center;gap:.35rem;flex-shrink:0;">
          <span style="font-size:.85rem;color:var(--crm-text-3);transform:${isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'};transition:transform .15s ease;">›</span>
          <button onclick="event.stopPropagation();openApplyTemplateModal('${tpl.id}')" class="crm-btn crm-btn-ghost" style="font-size:.7rem;padding:.25rem .6rem;">Apply</button>
          <button onclick="event.stopPropagation();deleteTemplate('${tpl.id}')" style="background:none;border:none;cursor:pointer;color:var(--crm-text-3);font-size:.85rem;" title="Delete">🗑</button>
        </div>
      </div>
      ${isExpanded ? `
        <div style="border-top:1px solid var(--crm-border-1);padding-top:.45rem;display:flex;flex-direction:column;gap:.35rem;">
          ${tpl.tasks.map(task => `
            <div style="display:flex;align-items:flex-start;gap:.5rem;padding:.35rem .45rem;border:1px solid var(--crm-border-1);border-radius:10px;background:var(--crm-surface-1);">
              <div style="flex:1;min-width:0;">
                <div style="font-size:.82rem;font-weight:700;color:var(--crm-text-1);">${escHtml(task.text || '')}</div>
                <div style="font-size:.72rem;color:var(--crm-text-3);">${task.reminderDays ? `${task.reminderDays} day reminder` : 'No reminder'}</div>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `}).join('');
}

window.toggleTemplateDetails = function(id) {
  if (expandedTemplateIds.has(id)) expandedTemplateIds.delete(id);
  else expandedTemplateIds.add(id);
  renderSavedTemplates();
};

window.deleteTemplate = function(id) {
  const previousTemplate = taskTemplates.find(t => t.id === id);
  taskTemplates = taskTemplates.filter(t => t.id !== id);
  expandedTemplateIds.delete(id);
  apiJson(`/api/ownership/templates/${id}`, { method: 'DELETE' }).then(({ cacheVersion }) => {
    rememberOwnershipVersion(cacheVersion);
    renderSavedTemplates();
    toast('Template deleted', '🗑️');
  }).catch(err => {
    console.error('Template delete failed', err);
    if (previousTemplate) {
      taskTemplates.push(previousTemplate);
      taskTemplates.sort((a, b) => String(a.taskGroup || '').localeCompare(String(b.taskGroup || '')) || String(a.name || '').localeCompare(String(b.name || '')));
    }
    renderSavedTemplates();
    toast('Could not delete template', '⚠️');
  });
};

window.applyTemplateToAll = function(tplId) {
  openApplyTemplateModal(tplId);
};

// ═══════════════════════════════════════════════════════════
// NEW / EDIT TRIP MODAL
// ═══════════════════════════════════════════════════════════

document.getElementById('btnNewTrip').addEventListener('click', () => {
  editingTripId = null;
  document.getElementById('tripModalTitle').textContent = 'New Trip';
  clearTripForm();
  openModal('tripModal');
});

window.openEditTrip = function(id) {
  const trip = trips.find(t => t.id === id);
  if (!trip) return;
  editingTripId = id;
  document.getElementById('tripModalTitle').textContent = `Edit · ${trip.guestName}`;
  fillTripForm(trip);
  closeExpandedRows();
  openModal('tripModal');
};

function clearTripForm() {
  ['guestName','destination'].forEach(f => {
    if(document.getElementById('tf-'+f)) document.getElementById('tf-'+f).value = '';
  });
  if(document.getElementById('tf-pax')) document.getElementById('tf-pax').value = '';
  if(document.getElementById('tf-startDate')) document.getElementById('tf-startDate').value = '';
  if(document.getElementById('tf-endDate')) document.getElementById('tf-endDate').value = '';
  ['proposalStatus','flightsStatus','visaStatus','hotelsStatus','sectorTicketsStatus','sightseeingStatus','insuranceStatus','travelingStatus','travefyTaskListStatus','tripFeedbackFormStatus'].forEach(f => {
    const el = document.getElementById('tf-'+f);
    if (el) el.value = el.options[0]?.value || '';
  });
  if(document.getElementById('tf-owner')) document.getElementById('tf-owner').value = employeeNames()[0] || '';
}

function fillTripForm(trip) {
  const setVal = (id, val) => { if(document.getElementById(id)) document.getElementById(id).value = val; };
  setVal('tf-guestName', trip.guestName || '');
  setVal('tf-destination', trip.destination || '');
  setVal('tf-pax', trip.pax || '');
  setVal('tf-startDate', trip.startDate || '');
  setVal('tf-endDate', trip.endDate || '');
  setVal('tf-proposalStatus', trip.proposalStatus || 'pending');
  setVal('tf-flightsStatus', trip.flightsStatus || 'pending');
  setVal('tf-visaStatus', trip.visaStatus || 'pending');
  setVal('tf-hotelsStatus', trip.hotelsStatus || 'pending');
  setVal('tf-sectorTicketsStatus', trip.sectorTicketsStatus || 'pending');
  setVal('tf-sightseeingStatus', trip.sightseeingStatus || 'pending');
  setVal('tf-insuranceStatus', trip.insuranceStatus || 'pending');
  setVal('tf-travelingStatus', trip.travelingStatus || 'pending');
  setVal('tf-travefyTaskListStatus', trip.travefyTaskListStatus || 'pending');
  setVal('tf-tripFeedbackFormStatus', trip.tripFeedbackFormStatus || 'pending');
  setVal('tf-owner', trip.owner || employeeNames()[0] || '');
}

document.getElementById('tripModalSave').addEventListener('click', async () => {
  const name = document.getElementById('tf-guestName').value.trim();
  if (!name) { toast('Enter a guest name', '⚠️'); return; }
  const dest = document.getElementById('tf-destination').value.trim();
  if (!dest) { toast('Enter a destination', '⚠️'); return; }

  const data = {
    guestName: name,
    destination: dest,
    pax: document.getElementById('tf-pax') ? parseInt(document.getElementById('tf-pax').value) || 1 : 1,
    startDate: document.getElementById('tf-startDate').value,
    endDate: document.getElementById('tf-endDate') ? document.getElementById('tf-endDate').value : '',
    proposalStatus: document.getElementById('tf-proposalStatus') ? document.getElementById('tf-proposalStatus').value : 'pending',
    flightsStatus: document.getElementById('tf-flightsStatus') ? document.getElementById('tf-flightsStatus').value : 'pending',
    visaStatus: document.getElementById('tf-visaStatus') ? document.getElementById('tf-visaStatus').value : 'pending',
    hotelsStatus: document.getElementById('tf-hotelsStatus') ? document.getElementById('tf-hotelsStatus').value : 'pending',
    sectorTicketsStatus: document.getElementById('tf-sectorTicketsStatus') ? document.getElementById('tf-sectorTicketsStatus').value : 'pending',
    sightseeingStatus: document.getElementById('tf-sightseeingStatus') ? document.getElementById('tf-sightseeingStatus').value : 'pending',
    insuranceStatus: document.getElementById('tf-insuranceStatus') ? document.getElementById('tf-insuranceStatus').value : 'pending',
    travelingStatus: document.getElementById('tf-travelingStatus') ? document.getElementById('tf-travelingStatus').value : 'pending',
    travefyTaskListStatus: document.getElementById('tf-travefyTaskListStatus') ? document.getElementById('tf-travefyTaskListStatus').value : 'pending',
    tripFeedbackFormStatus: document.getElementById('tf-tripFeedbackFormStatus') ? document.getElementById('tf-tripFeedbackFormStatus').value : 'pending',
    owner: document.getElementById('tf-owner').value,
  };

  if (editingTripId) {
    const idx = trips.findIndex(t => t.id === editingTripId);
    if (idx !== -1) {
      const previousTrip = trips[idx];
      const optimisticTrip = { ...previousTrip, ...data };
      trips[idx] = optimisticTrip;
      cacheTripsForFastPaint(trips);
      closeModal('tripModal');
      logActivity(`${name} — trip updated`, '#3b82f6');
      toast('Trip updated!');
      syncTripRowDom(optimisticTrip, { refreshExpanded: true });
      saveTripPatch(optimisticTrip, data).catch(err => {
        console.error('Trip update failed', err);
        trips[idx] = previousTrip;
        cacheTripsForFastPaint(trips);
        syncTripRowDom(previousTrip, { refreshExpanded: true });
        if (err.status === 409) {
          toast('Someone else updated this trip. We refreshed the latest data.', '⚠️');
          return;
        }
        toast('Could not update trip', '⚠️');
      });
      return;
    }
  } else {
    const tempId = `tmp-${uid()}`;
    const optimisticTrip = {
      id: tempId,
      ...data,
      subtasks: { visa:[], flights:[], hotels:[], sectorTickets:[], sightseeing:[], insurance:[], travefy:[], travefyTaskList:[], tripFeedbackForm:[] },
      reminders: [],
    };
    trips.unshift(optimisticTrip);
    logActivity(`New trip added: ${name}`, '#10b981');
    toast('Trip created!');
    scheduleOwnershipRefreshDeferred();
    closeModal('tripModal');
    apiJson('/api/ownership/trips', {
      method: 'POST',
      body: JSON.stringify({ ...data, subtasks: optimisticTrip.subtasks, reminders: [] }),
    }).then(({ trip: newTrip, cacheVersion }) => {
      const idx = trips.findIndex(t => t.id === tempId);
      if (idx !== -1 && newTrip) {
        trips[idx] = newTrip;
        rememberOwnershipVersion(cacheVersion || newTrip.version);
        scheduleOwnershipRefreshDeferred(0);
      }
    }).catch(err => {
      console.error('Trip create failed', err);
      trips = trips.filter(t => t.id !== tempId);
      scheduleOwnershipRefreshDeferred(0);
      toast('Could not create trip', '⚠️');
    });
    return;
  }
});

window.deleteTrip = function(id) {
  if (!confirm('Delete this trip?')) return;
  const trip = trips.find(t => t.id === id);
  trips = trips.filter(t => t.id !== id);
  expandedRows.delete(id);
  apiJson(`/api/ownership/trips/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ version: trip?.version || 0 }),
  }).catch(err => {
    console.error('Trip delete failed', err);
    if (trip) {
      trips.unshift(trip);
      refreshOwnershipViews();
    }
    if (err.status === 409) {
      queueOwnershipServerRefresh(err.payload?.cacheVersion || 0, 'trip delete conflict');
    }
    toast('Could not delete from database', '⚠️');
  });
  refreshOwnershipViews();
  if (trip) logActivity(`Trip deleted: ${trip.guestName}`, '#ef4444');
  toast('Trip deleted', '🗑️');
};

function closeExpandedRows() {
  expandedRows.clear();
}

// ═══════════════════════════════════════════════════════════
// FILTER / SORT HANDLERS
// ═══════════════════════════════════════════════════════════

document.getElementById('crmSearch').addEventListener('input', e => {
  searchQuery = e.target.value;
  currentPage = 1;
  scheduleTableRender(45);
});

document.getElementById('filterStatus').addEventListener('change', e => {
  filterStatus = e.target.value;
  currentPage = 1;
  renderTable();
});

document.getElementById('filterOwner').addEventListener('change', e => {
  filterOwner = e.target.value;
  currentPage = 1;
  renderTable();
});

document.getElementById('filterMonth').addEventListener('change', e => {
  filterMonth = e.target.value;
  currentPage = 1;
  renderTable();
});

document.getElementById('btnClearFilters').addEventListener('click', () => {
  searchQuery = ''; filterStatus = ''; filterOwner = ''; filterMonth = '';
  document.getElementById('crmSearch').value = '';
  document.getElementById('filterStatus').value = '';
  document.getElementById('filterOwner').value = '';
  document.getElementById('filterMonth').value = '';
  currentPage = 1;
  cancelScheduledTableRender();
  renderTable();
});

// Sort on column header click
document.querySelectorAll('.crm-table thead th[data-col]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (sortCol === col) sortDir *= -1;
    else { sortCol = col; sortDir = 1; }
    renderTable();
  });
});

// Check all
document.getElementById('selectAllTrips')?.addEventListener('change', e => {
  document.querySelectorAll('.row-check').forEach(cb => cb.checked = e.target.checked);
});

// ═══════════════════════════════════════════════════════════
// POPULATE FILTERS
// ═══════════════════════════════════════════════════════════

function populateOwnerFilter() {
  const sel = document.getElementById('filterOwner');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All Owners</option>';
  const owners = [...new Set(trips.map(t => t.owner).filter(Boolean))].sort();
  for (const o of owners) {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    sel.appendChild(opt);
  }
  sel.value = cur;
}

function populateMonthFilter() {
  const sel = document.getElementById('filterMonth');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All Months</option>';
  const months = [...new Set(trips.filter(t => t.startDate).map(t => {
    const d = new Date(t.startDate + 'T00:00:00');
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }))].sort();
  const fmt = m => {
    const [y, mo] = m.split('-');
    return new Date(+y, +mo-1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  };
  for (const m of months) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = fmt(m);
    sel.appendChild(opt);
  }
  sel.value = cur;
}

// ═══════════════════════════════════════════════════════════
// PANEL TOGGLE
// ═══════════════════════════════════════════════════════════

document.getElementById('btnTogglePanel').addEventListener('click', () => {
  const panel = document.getElementById('crmRightPanel');
  panel.classList.toggle('collapsed');
});

document.getElementById('btnToggleStats')?.addEventListener('click', () => {
  toggleStatsPanel();
});

// ═══════════════════════════════════════════════════════════
// DARK MODE
// ═══════════════════════════════════════════════════════════

function syncTheme() {
  const switchEl = document.getElementById('crmThemeToggleSwitch');
  if (isDark) {
    document.getElementById('crmPage').setAttribute('data-crm-theme', 'dark');
    if (switchEl) switchEl.checked = true;
  } else {
    document.getElementById('crmPage').setAttribute('data-crm-theme', 'light');
    if (switchEl) switchEl.checked = false;
  }
  localStorage.setItem('crm_theme', isDark ? 'dark' : 'light');
}

const themeSwitchEl = document.getElementById('crmThemeToggleSwitch');
if (themeSwitchEl) {
  themeSwitchEl.addEventListener('change', (e) => {
    isDark = e.target.checked;
    syncTheme();
  });
}

// ═══════════════════════════════════════════════════════════
// ACTIVITY FEED
// ═══════════════════════════════════════════════════════════

let activityLog = [...ACTIVITY_LOG];

function logActivity(text, color = '#6366f1') {
  activityLog.unshift({ color, text, time: 'just now' });
  if (activityLog.length > 20) activityLog.pop();
  renderActivityFeed();
}

function renderActivityFeed() {
  const el = document.getElementById('activityFeed');
  el.innerHTML = activityLog.slice(0, 8).map(a => `
    <div class="crm-activity-item">
      <div class="crm-activity-dot" style="background:${a.color}"></div>
      <div>
        <div class="crm-activity-text">${escHtml(a.text)}</div>
        <div class="crm-activity-meta">${a.time}</div>
      </div>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════════════════════
// CALENDAR WIDGET
// ═══════════════════════════════════════════════════════════

function renderCalendar() {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  document.getElementById('calMonthLabel').textContent = `${months[calMonth]} ${calYear}`;
  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';

  const dayNames = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  for (const d of dayNames) {
    const el = document.createElement('div');
    el.className = 'crm-cal-day-name';
    el.textContent = d;
    grid.appendChild(el);
  }

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();

  // Trip dates set
  const tripDates = new Set(trips.filter(t => t.startDate).map(t => {
    const d = new Date(t.startDate + 'T00:00:00');
    if (d.getMonth() === calMonth && d.getFullYear() === calYear) return d.getDate();
    return null;
  }).filter(Boolean));

  for (let i = 0; i < firstDay; i++) {
    const blank = document.createElement('div');
    blank.className = 'crm-cal-day other-month';
    grid.appendChild(blank);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const el = document.createElement('div');
    el.className = 'crm-cal-day';
    el.textContent = d;
    const isToday = d === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();
    if (isToday) el.classList.add('today');
    if (tripDates.has(d)) el.classList.add('has-trip');
    if (selectedCalDay === d) el.classList.add('selected');
    el.title = tripDates.has(d) ? `Trip departure on ${months[calMonth]} ${d}` : '';
    
    el.addEventListener('click', () => {
      if (selectedCalDay === d) {
        selectedCalDay = null;
      } else {
        selectedCalDay = d;
      }
      renderCalendar();
      renderUpcomingTrips();
    });

    grid.appendChild(el);
  }
}

document.getElementById('calPrev').addEventListener('click', () => {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  selectedCalDay = null;
  renderCalendar();
  renderUpcomingTrips();
});
document.getElementById('calNext').addEventListener('click', () => {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  selectedCalDay = null;
  renderCalendar();
  renderUpcomingTrips();
});
document.getElementById('calToday')?.addEventListener('click', () => {
  const todayObj = new Date();
  calMonth = todayObj.getMonth();
  calYear = todayObj.getFullYear();
  selectedCalDay = null;
  renderCalendar();
  renderUpcomingTrips();
});

// ═══════════════════════════════════════════════════════════
// UPCOMING TRIPS PANEL
// ═══════════════════════════════════════════════════════════

function renderUpcomingTrips() {
  const el = document.getElementById('upcomingTrips');
  const titleEl = document.getElementById('upcomingTripsTitle');
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const isCurrentMonthYear = calMonth === now.getMonth() && calYear === now.getFullYear();
  
  let filteredList = [];
  let mode = ''; // 'default', 'day', 'month'
  
  if (selectedCalDay !== null) {
    mode = 'day';
    filteredList = trips
      .filter(t => {
        if (!t.startDate) return false;
        const d = new Date(t.startDate + 'T00:00:00');
        return d.getDate() === selectedCalDay && d.getMonth() === calMonth && d.getFullYear() === calYear;
      })
      .sort((a, b) => a.guestName.localeCompare(b.guestName));
    
    if (titleEl) {
      titleEl.textContent = `Trips on ${selectedCalDay} ${months[calMonth]} ${calYear}`;
    }
  } else if (!isCurrentMonthYear) {
    mode = 'month';
    filteredList = trips
      .filter(t => {
        if (!t.startDate) return false;
        const d = new Date(t.startDate + 'T00:00:00');
        return d.getMonth() === calMonth && d.getFullYear() === calYear;
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
      
    if (titleEl) {
      titleEl.textContent = `Trips in ${months[calMonth]} ${calYear}`;
    }
  } else {
    mode = 'default';
    filteredList = trips
      .filter(t => t.startDate && new Date(t.startDate + 'T00:00:00') >= todayStart)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .slice(0, 6);
      
    if (titleEl) {
      titleEl.textContent = 'Trips Soon';
    }
  }

  if (!filteredList.length) {
    const emptyMsg = mode === 'day' 
      ? `No departures on ${selectedCalDay} ${months[calMonth]}` 
      : mode === 'month' 
      ? `No departures in ${months[calMonth]} ${calYear}` 
      : 'No upcoming trips';
    el.innerHTML = `<div style="color:var(--crm-text-3);font-size:.78rem;text-align:center;padding:1.5rem 0;">${emptyMsg}</div>`;
    return;
  }

  el.innerHTML = filteredList.map(t => {
    const col = guestColor(t.guestName);
    const initials = t.guestName.split(' ').map(w => w[0]).slice(0,2).join('');
    
    const d = new Date(t.startDate + 'T00:00:00');
    const tripStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((tripStart - todayStart) / 86400000);
    
    let diffLabel = '';
    let labelColor = '';
    
    if (diff === 0) {
      diffLabel = 'Today!';
      labelColor = '#ef4444';
    } else if (diff === 1) {
      diffLabel = 'Tomorrow';
      labelColor = '#f59e0b';
    } else if (diff > 1 && diff <= 7) {
      diffLabel = `${diff}d away`;
      labelColor = '#ef4444';
    } else if (diff > 7 && diff <= 14) {
      diffLabel = `${diff}d away`;
      labelColor = '#f59e0b';
    } else if (diff > 14) {
      diffLabel = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      labelColor = '#10b981';
    } else {
      diffLabel = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      labelColor = 'var(--crm-text-3)';
    }

    return `
      <div class="crm-cal-trip-card" onclick="highlightTripRow('${t.id}')" title="Click to scroll to this trip">
        <div style="width:24px;height:24px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;font-size:.6rem;font-weight:700;color:white;flex-shrink:0;">${initials}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:.75rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(t.guestName)}</div>
          <div style="font-size:.65rem;color:var(--crm-text-3);">${escHtml(t.destination)}</div>
        </div>
        <span style="font-size:.65rem;font-weight:600;color:${labelColor};white-space:nowrap;">${diffLabel}</span>
      </div>
    `;
  }).join('');
}

function smoothScrollTrip(tripId, callback) {
  const row = document.querySelector(`tr[data-id="${tripId}"]`);
  const tableScroll = document.querySelector('.crm-table-scroll');
  const mainScroll = document.querySelector('.crm-main');
  
  if (!row) return;

  const startTableScrollTop = tableScroll ? tableScroll.scrollTop : 0;
  let targetTableScrollTop = startTableScrollTop;
  if (tableScroll) {
    const rowTop = row.offsetTop;
    const rowHeight = row.offsetHeight;
    const containerHeight = tableScroll.clientHeight;
    targetTableScrollTop = Math.max(0, rowTop - (containerHeight / 2) + (rowHeight / 2));
    const maxScroll = tableScroll.scrollHeight - tableScroll.clientHeight;
    targetTableScrollTop = Math.min(targetTableScrollTop, maxScroll);
  }

  const startMainScrollTop = mainScroll ? mainScroll.scrollTop : 0;
  let targetMainScrollTop = startMainScrollTop;
  if (mainScroll) {
    targetMainScrollTop = 0; // Keep the toolbar and table top visible
  }

  const tableChange = targetTableScrollTop - startTableScrollTop;
  const mainChange = targetMainScrollTop - startMainScrollTop;

  const distance = Math.abs(tableChange);
  
  // If the target is near (scroll distance < 50px), show it immediately (duration = 0)
  // If it is far, scroll smoothly with a duration of exactly 1 second (1000ms)
  const duration = distance < 50 ? 0 : 1000;

  if (duration === 0) {
    if (tableScroll) tableScroll.scrollTop = targetTableScrollTop;
    if (mainScroll) mainScroll.scrollTop = targetMainScrollTop;
    if (callback) callback();
    return;
  }

  const startTime = performance.now();

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function animate(currentTime) {
    const timeElapsed = currentTime - startTime;
    const progress = Math.min(timeElapsed / duration, 1);
    const eased = easeOutCubic(progress);

    if (tableScroll) {
      tableScroll.scrollTop = startTableScrollTop + tableChange * eased;
    }
    if (mainScroll) {
      mainScroll.scrollTop = startMainScrollTop + mainChange * eased;
    }

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      if (tableScroll) tableScroll.scrollTop = targetTableScrollTop;
      if (mainScroll) mainScroll.scrollTop = targetMainScrollTop;
      if (callback) callback();
    }
  }

  requestAnimationFrame(animate);
}

window.highlightTripRow = function(tripId) {
  let row = document.querySelector(`tr[data-id="${tripId}"]`);
  if (!row) {
    // Clear all filters so the row is displayed
    searchQuery = '';
    filterStatus = '';
    filterOwner = '';
    filterMonth = '';
    
    const searchInput = document.getElementById('crmSearch');
    if (searchInput) searchInput.value = '';
    
    ['filterStatus', 'filterOwner', 'filterMonth'].forEach(id => {
      const select = document.getElementById(id);
      if (select) select.value = '';
    });
    
    currentPage = 1;
    renderTable(); // Re-render unfiltered
    row = document.querySelector(`tr[data-id="${tripId}"]`);
  }
  
  if (row) {
    // Scroll programmatically (instant if near, 1s if far), and trigger flash highlight AFTER scrolling finishes
    smoothScrollTrip(tripId, () => {
      row.classList.add('row-highlight-flash');
      setTimeout(() => {
        row.classList.remove('row-highlight-flash');
      }, 2000);
    });
  } else {
    toast('Trip not found in table', '⚠️');
  }
};

// ═══════════════════════════════════════════════════════════
// MODAL HELPERS
// ═══════════════════════════════════════════════════════════

function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}

// Close buttons
document.getElementById('subtaskModalClose').addEventListener('click', () => closeModal('subtaskModal'));
document.getElementById('templateModalClose').addEventListener('click', () => closeModal('templateModal'));
document.getElementById('applyTemplateModalClose').addEventListener('click', () => closeModal('applyTemplateModal'));
document.getElementById('tripModalClose').addEventListener('click', () => closeModal('tripModal'));
document.getElementById('tripModalCancel').addEventListener('click', () => closeModal('tripModal'));

// Close on overlay click
['subtaskModal','templateModal','applyTemplateModal','tripModal'].forEach(id => {
  document.getElementById(id).addEventListener('click', e => {
    if (e.target === document.getElementById(id)) closeModal(id);
  });
});

document.getElementById('btnApplyTemplate').addEventListener('click', e => {
  e.preventDefault();
  e.stopImmediatePropagation();
  openApplyTemplateModal();
}, true);

document.getElementById('applyTemplateSelect').addEventListener('change', e => {
  applyTemplateState.tplId = e.target.value;
  applyTemplateState.selectedIndexes = [];
  renderApplyTemplateModal();
});

document.getElementById('applyTripSelect').addEventListener('change', e => {
  applyTemplateState.tripId = e.target.value;
});

document.getElementById('btnConfirmApplyTemplate').addEventListener('click', () => {
  applySelectedTemplateTasks();
});

// Esc key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['subtaskModal','templateModal','applyTemplateModal','tripModal'].forEach(id => closeModal(id));
    statusMenu.style.display = 'none';
  }
});

// ═══════════════════════════════════════════════════════════
// XSS helper
// ═══════════════════════════════════════════════════════════

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════

async function loadOwnershipData() {
  const [tripResult, templateResult, employeeResult] = await Promise.allSettled([
    apiJson('/api/ownership/trips'),
    apiJson('/api/ownership/templates'),
    apiJson('/api/ownership/employees'),
  ]);

  const loadErrors = [];

  if (tripResult.status === 'fulfilled') {
    const tripData = tripResult.value || {};
    trips = (tripData.trips || []).map(trip => hydrateTripSearchIndex({ version: 1, ...trip }));
    cacheTripsForFastPaint(trips);
  } else if (!trips.length) {
    throw tripResult.reason;
  } else {
    loadErrors.push(tripResult.reason);
  }

  if (templateResult.status === 'fulfilled') {
    const templateData = templateResult.value || {};
    taskTemplates = templateData.templates || [];
  } else {
    loadErrors.push(templateResult.reason);
  }

  if (employeeResult.status === 'fulfilled') {
    const employeeData = employeeResult.value || {};
    employees = employeeData.employees || [];
  } else {
    loadErrors.push(employeeResult.reason);
  }

  const versions = [
    parseOwnershipVersion(tripResult.status === 'fulfilled' ? tripResult.value?.cacheVersion : 0),
    parseOwnershipVersion(templateResult.status === 'fulfilled' ? templateResult.value?.cacheVersion : 0),
    parseOwnershipVersion(employeeResult.status === 'fulfilled' ? employeeResult.value?.cacheVersion : 0),
  ];
  rememberOwnershipVersion(Math.max(...versions));

  if (loadErrors.length) {
    console.warn('Ownership data loaded with partial failures', loadErrors);
  }
}

function cacheTripsForFastPaint(nextTrips) {
  ownershipCachePendingTrips = Array.isArray(nextTrips) ? nextTrips : [];
  if (ownershipCacheTimer) clearTimeout(ownershipCacheTimer);
  ownershipCacheTimer = setTimeout(() => {
    ownershipCacheTimer = null;
    try {
      localStorage.setItem(OWNERSHIP_TRIPS_STORAGE_KEY, JSON.stringify({
        savedAt: Date.now(),
        trips: ownershipCachePendingTrips || [],
      }));
    } catch (err) {
      // Storage can fail in private mode or under quota pressure; the API remains authoritative.
    }
  }, 150);
}

function cancelPendingOwnershipWork() {
  if (ownershipRefreshTimer) {
    clearTimeout(ownershipRefreshTimer);
    ownershipRefreshTimer = null;
  }
  if (ownershipCacheTimer) {
    clearTimeout(ownershipCacheTimer);
    ownershipCacheTimer = null;
  }
  if (subtaskModalRefreshTimer) {
    clearTimeout(subtaskModalRefreshTimer);
    subtaskModalRefreshTimer = null;
  }
  if (ownershipServerRefreshTimer) {
    clearTimeout(ownershipServerRefreshTimer);
    ownershipServerRefreshTimer = null;
  }

}

function restoreTripsForFastPaint() {
  try {
    const cached = JSON.parse(localStorage.getItem(OWNERSHIP_TRIPS_STORAGE_KEY) || 'null');
    if (!cached || !Array.isArray(cached.trips)) return false;
    trips = cached.trips.map(trip => hydrateTripSearchIndex({ version: 1, ...trip }));
    refreshOwnerControls();
    populateMonthFilter();
    renderTable();
    renderActivityFeed();
    renderCalendar();
    renderUpcomingTrips();
    return true;
  } catch (err) {
    localStorage.removeItem(OWNERSHIP_TRIPS_STORAGE_KEY);
    return false;
  }
}

async function reloadOwnershipData({ silent = true } = {}) {
  try {
    await loadOwnershipData();
    refreshOwnerControls();
    renderTable();
    renderActivityFeed();
    renderCalendar();
    renderUpcomingTrips();
    if (window.location.pathname.startsWith('/ownership/employees')) {
      if (typeof refreshEmployeeWorkspaceFromOwnership === 'function') {
        refreshEmployeeWorkspaceFromOwnership();
      } else if (typeof syncEmployeeWorkspaceData === 'function') {
        syncEmployeeWorkspaceData();
      }
    }
    if (!silent) toast('Ownership data refreshed');
  } catch (err) {
    console.error('Ownership reload failed', err);
    if (!silent) toast('Could not refresh ownership data', '⚠️');
  }
}



async function init() {
  // Restore theme
  const saved = localStorage.getItem('crm_theme');
  if (saved === 'dark') { isDark = true; syncTheme(); }

  renderSkeleton();
  const renderedCachedTrips = restoreTripsForFastPaint();
  let loadError = null;
  try {
    await loadOwnershipData();
  } catch (err) {
    console.error('Ownership load failed', err);
    if (!renderedCachedTrips) trips = [];
    taskTemplates = [];
    employees = [];
    loadError = err;
  }

  refreshOwnerControls();
  populateMonthFilter();
  if (window.location.pathname.startsWith('/ownership/employees')) {
    if (typeof syncEmployeeWorkspaceData === 'function') {
      syncEmployeeWorkspaceData();
    } else if (typeof refreshEmployeeWorkspaceFromOwnership === 'function') {
      refreshEmployeeWorkspaceFromOwnership();
    }
  }

  if (loadError && !renderedCachedTrips) {
    const tbody = document.getElementById('crmTbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="18"><div class="crm-empty"><div class="crm-empty-icon">⚠️</div><div class="crm-empty-title">Could not load ownership data</div><div class="crm-empty-sub">Please check your connection and refresh. ${loadError.message || ''}</div></div></td></tr>`;
    document.getElementById('tableFooterInfo').textContent = 'Database error — please refresh';
    toast('Could not load ownership data — please refresh the page', '⚠️');
  } else {
    renderTable();
  }

  renderActivityFeed();
  renderCalendar();
  renderUpcomingTrips();

  // Animate KPI numbers
  setTimeout(() => {
    document.querySelectorAll('.crm-kpi-value').forEach(el => {
      el.style.transition = 'opacity .4s';
    });
  }, 300);

  // Initialize correct view based on URL
  document.getElementById('crmRightPanel')?.classList.add('collapsed');
  document.getElementById('kpiGrid')?.classList.add('collapsed');
  syncStatsPanelButton();
  toggleSpaView();

  // Start realtime sync
  ownershipRealtimeManager = new OwnershipRealtimeManager();
  ownershipRealtimeManager.connect();
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  window.addEventListener('beforeunload', () => {
    if (ownershipRealtimeManager) ownershipRealtimeManager.disconnect();
  });
  window.addEventListener('pagehide', () => {
    if (ownershipRealtimeManager) ownershipRealtimeManager.disconnect();
  });
  window.addEventListener('pageshow', () => {
    restoreTripsForFastPaint();
    if (ownershipRealtimeManager) ownershipRealtimeManager.reconnect('pageshow');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ownershipRealtimeManager) {
      ownershipRealtimeManager.reconnect('visibilitychange');
    }
  });
  window.addEventListener('online', () => {
    if (ownershipRealtimeManager) ownershipRealtimeManager.reconnect('online');
  });

  const btnFilterMenu = document.getElementById('btnFilterMenu');
  const filterDropdown = document.getElementById('filterDropdown');
  if (btnFilterMenu && filterDropdown) {
    btnFilterMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      filterDropdown.classList.toggle('show');
    });
    document.addEventListener('click', (e) => {
      if (!filterDropdown.contains(e.target) && !btnFilterMenu.contains(e.target)) {
        filterDropdown.classList.remove('show');
      }
    });
  }

  const btnCancelSelection = document.getElementById('btnCancelSelection');
  if (btnCancelSelection) {
    btnCancelSelection.addEventListener('click', () => {
      selectedTrips.clear();
      document.querySelectorAll('.row-check').forEach(chk => chk.checked = false);
      updateSelectAllCheckbox();
      updateSelectionStrip();
    });
  }

  const bulkStatusSelect = document.getElementById('bulkStatusSelect');
  if (bulkStatusSelect) {
    bulkStatusSelect.addEventListener('change', async (e) => {
      const status = e.target.value;
      if (!status) return;
      if (selectedTrips.size === 0) {
        bulkStatusSelect.value = '';
        return;
      }
      if (!confirm(`Apply "${status}" to all tasks for ${selectedTrips.size} selected trips?`)) {
        bulkStatusSelect.value = '';
        return;
      }

      const idsToUpdate = Array.from(selectedTrips);
      const idsToUpdateSet = new Set(idsToUpdate);
      const updatedTrips = [];
      const statusPatch = {
        proposalStatus: status,
        flightsStatus: status,
        visaStatus: status,
        hotelsStatus: status,
        sectorTicketsStatus: status,
        sightseeingStatus: status,
        insuranceStatus: status,
        travelingStatus: status,
        travefyTaskListStatus: status,
        tripFeedbackFormStatus: status,
      };
      const taskKeys = [
        'proposalStatus', 'flightsStatus', 'visaStatus', 'hotelsStatus',
        'sectorTicketsStatus', 'sightseeingStatus', 'insuranceStatus',
        'travelingStatus', 'travefyTaskListStatus', 'tripFeedbackFormStatus'
      ];
      
      for (const t of trips) {
        if (idsToUpdateSet.has(t.id)) {
          for (const k of taskKeys) t[k] = status;
          t.version = (t.version || 0) + 1;
          updatedTrips.push(t);
          hydrateTripSearchIndex(t);
        }
      }

      selectedTrips.clear();
      document.querySelectorAll('.row-check').forEach(chk => chk.checked = false);
      updateSelectAllCheckbox();
      updateSelectionStrip();
      cacheTripsForFastPaint(trips);
      renderTable();
      bulkStatusSelect.value = '';
      toast(`Updated status for ${updatedTrips.length} trips`);

      // Save all updated trips using apiJson
      const results = await Promise.allSettled(
        updatedTrips.map(t => {
          return apiJson(`/api/ownership/trips/${t.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              version: t.version || 0,
              ...statusPatch,
            }),
          });
        })
      );
      
      const failedIds = updatedTrips.filter((_, idx) => results[idx].status !== 'fulfilled').map(t => t.id);
      if (failedIds.length) {
        toast(`Failed to update ${failedIds.length} trips.`, 'error');
      }
    });
  }

  const btnBulkDelete = document.getElementById('btnBulkDelete');
  if (btnBulkDelete) {
    btnBulkDelete.addEventListener('click', async () => {
      if (selectedTrips.size === 0) return;
      if (!confirm(`Are you sure you want to delete ${selectedTrips.size} trips? This cannot be undone.`)) return;
      
      const idsToDelete = Array.from(selectedTrips);
      const originalText = btnBulkDelete.innerHTML;
      btnBulkDelete.innerHTML = 'Deleting...';
      btnBulkDelete.disabled = true;

      const deletedTrips = trips.filter(t => idsToDelete.includes(t.id));
      trips = trips.filter(t => !idsToDelete.includes(t.id));
      selectedTrips.clear();
      refreshOwnershipViews();
      updateSelectionStrip();
      btnBulkDelete.innerHTML = originalText;
      btnBulkDelete.disabled = false;
      toast(`Deleted ${deletedTrips.length} trips`);

      const results = await Promise.allSettled(
        deletedTrips.map(tripItem => apiJson(`/api/ownership/trips/${tripItem.id}`, {
          method: 'DELETE',
          body: JSON.stringify({ version: tripItem.version || 0 }),
        }))
      );
      const failedIds = deletedTrips.filter((tripItem, idx) => results[idx].status !== 'fulfilled').map(tripItem => tripItem.id);
      if (failedIds.length) {
        trips = [...deletedTrips.filter(t => failedIds.includes(t.id)), ...trips];
        refreshOwnershipViews();
        toast(`Could not delete ${failedIds.length} trips`, '⚠️');
      }
    });
  }
});

function renderTemplateTaskCard(task) {
  const text = escHtml(task?.text || '');
  const reminder = task?.reminderDays ? `${task.reminderDays} day reminder` : 'No reminder';
  return `
    <div class="crm-template-task-card">
      <div class="crm-template-task-main">
        <div class="crm-template-task-text">${text}</div>
        <div class="crm-template-task-meta">${escHtml(reminder)}</div>
      </div>
    </div>
  `;
}

// Absolute final override for the saved category list accordion.
renderSavedTemplates = function() {
  const el = document.getElementById('savedTemplatesList');
  if (!el) return;
  if (!taskTemplates.length) {
    el.innerHTML = '<div style="font-size:.78rem;color:var(--crm-text-3);padding:.5rem 0;">No category lists yet. Create one above.</div>';
    return;
  }
  el.innerHTML = taskTemplates.map(tpl => {
    const isExpanded = expandedTemplateIds.has(tpl.id);
    const label = taskGroupLabel(tpl.taskGroup) || 'Category List';
    const taskCount = Array.isArray(tpl.tasks) ? tpl.tasks.length : 0;
    return `
      <div class="crm-tpl-item crm-tpl-card" id="tpl-${tpl.id}" role="button" tabindex="0" aria-expanded="${isExpanded ? 'true' : 'false'}" onclick="toggleTemplateDetails('${tpl.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleTemplateDetails('${tpl.id}');}">
        <div class="crm-tpl-card-head">
          <div class="crm-tpl-card-copy">
            <div class="crm-tpl-name">${escHtml(label)}</div>
            <div class="crm-tpl-meta">${taskCount} task${taskCount === 1 ? '' : 's'}</div>
          </div>
          <div class="crm-tpl-card-actions">
            <button type="button" onclick="event.stopPropagation();toggleTemplateDetails('${tpl.id}')" title="${isExpanded ? 'Collapse' : 'Expand'}" class="crm-tpl-toggle-btn">${isExpanded ? '▾' : '▸'}</button>
            <button onclick="event.stopPropagation();openApplyTemplateModal('${tpl.id}')" class="crm-btn crm-btn-ghost" style="font-size:.7rem;padding:.25rem .6rem;">Apply</button>
            <button onclick="event.stopPropagation();deleteTemplate('${tpl.id}')" style="background:none;border:none;cursor:pointer;color:var(--crm-text-3);font-size:.85rem;" title="Delete">🗑</button>
          </div>
        </div>
        ${isExpanded ? `
          <div class="crm-tpl-card-body">
            ${tpl.tasks.map(task => renderTemplateTaskCard(task)).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
};

// ============================================================================
// SPA ROUTER LOGIC
// ============================================================================
function toggleSpaView() {
  const isEmployee = window.location.pathname.startsWith('/ownership/employees');
  
  requestAnimationFrame(() => {
    const crmPage = document.getElementById('crmPage');
    const picker = document.getElementById('employeePickerScreen');
    const workspace = document.getElementById('employeeWorkspace');

    if (isEmployee) {
      if (crmPage) crmPage.style.display = 'none';
      if (typeof initEmployeeWorkspace === 'function') {
        initEmployeeWorkspace();
      }
    } else {
      if (picker) picker.style.display = 'none';
      if (workspace) workspace.style.display = 'none';
      if (crmPage) crmPage.style.display = 'block';
      setTimeout(() => {
        if (typeof refreshAuxiliaryViews === 'function') {
          refreshAuxiliaryViews();
        }
      }, 0);
    }
  });
}

window.addEventListener('popstate', toggleSpaView);

document.addEventListener('click', e => {
  const a = e.target.closest('a');
  if (!a || !a.href) return;
  const url = new URL(a.href);
  if (url.origin === window.location.origin && url.pathname.startsWith('/ownership')) {
    e.preventDefault();
    history.pushState(null, '', url.pathname);
    toggleSpaView();
  }
});
