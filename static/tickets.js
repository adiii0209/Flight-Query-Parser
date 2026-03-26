// ==================== STATE ====================
let allTickets = [];
let currentTicket = null;
let currentFilter = 'all';
let editedData = {};
let changeAttachmentState = { token: '', filename: '' };
let selectedPaxIndices = new Set();
let passengerSortMode = '';
let autoSaveTimeout = null;
let pendingSavePromise = null;
let isDetailDirty = false;
let fareFieldsTouched = false;
let knownTicketIds = new Set();
let hasInitializedTicketFeed = false;
let ticketsPollingHandle = null;
let ticketDetailCache = new Map();
let _lastProcessingCount = 0;
let _processingIndicatorMode = 'idle';
let _processingDoneTimeout = null;
let _processingRefreshTimeout = null;
let _processingJustCompleted = false;
let _pendingArrivalToastMessage = '';
let totalAvailableTickets = 0;
let lastFullTicketsSyncAt = 0;
let fullTicketsSyncPromise = null;
let ticketsEventSource = null;
let realtimeRefreshHandle = null;
let isSaveInFlight = false;
let suppressRealtimeUntil = 0;
let ticketEditBaseSnapshot = null;
let dashboardLiveUpdatesPaused = false;
let draftRetryHandle = null;
let hasPendingLocalDraft = false;
let duplicatePanelTickets = [];
let duplicatePanelTotalCount = 0;
let duplicatePanelIsLoadingMore = false;
const INITIAL_TICKETS_BATCH_SIZE = 6;
const DUPLICATES_BATCH_SIZE = 6;
const TICKETS_POLL_INTERVAL_MS = 5000;
const TICKETS_FULL_SYNC_INTERVAL_MS = 30000;
const TICKETS_CACHE_KEY = 'ticketsDashboard.topCache.v1';
const DUPLICATES_CACHE_KEY = 'ticketsDashboard.duplicatesCache.v1';
const TICKET_DRAFT_CACHE_PREFIX = 'ticketsDashboard.ticketDraft.';
const ACTIVE_FIELD_AUTOSAVE_IDLE_MS = 1200;
let lastDetailInputAt = 0;

// ==================== SIDEBAR & THEME ====================
function initializeSidebar() {
    const menuToggle = document.getElementById('menuToggle');
    const sidebarClose = document.getElementById('sidebarClose');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const sidebar = document.getElementById('sidebar');
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.add('active');
            sidebarOverlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        });
    }
    const closeSidebar = () => {
        sidebar.classList.remove('active');
        sidebarOverlay.classList.remove('active');
        document.body.style.overflow = '';
    };
    if (sidebarClose) sidebarClose.addEventListener('click', closeSidebar);
    if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);
    const savedTheme = localStorage.getItem('theme') || 'light';
    updateTheme(savedTheme);
    const themeBtn = document.getElementById('sidebarThemeToggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            localStorage.setItem('theme', next);
            updateTheme(next);
        });
    }
}
function updateTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const text = document.getElementById('themeToggleText');
    const icon = document.querySelector('.theme-icon-container');
    if (text && icon) {
        if (theme === 'dark') { icon.textContent = '☀️'; text.textContent = 'Light Mode'; }
        else { icon.textContent = '🌙'; text.textContent = 'Dark Mode'; }
    }
}

// ==================== AUTH ====================
async function checkAuth() {
    try {
        const r = await fetch('/api/user');
        if (!r.ok) { return false; }
        const u = await r.json();
        const nameEl = document.getElementById('sidebarUserName');
        if (nameEl) nameEl.textContent = u.full_name || u.username;
        const emailEl = document.getElementById('sidebarUserEmail');
        if (emailEl) emailEl.textContent = u.email || 'Member';
        const avatarEl = document.getElementById('sidebarAvatar');
        if (avatarEl) avatarEl.textContent = (u.full_name || u.username).charAt(0).toUpperCase();
        const authBtn = document.getElementById('sidebarAuthBtn');
        if (authBtn) {
            authBtn.textContent = '🚪 Logout';
            authBtn.classList.add('logout');
            authBtn.onclick = async () => { if (confirm('Logout?')) { await fetch('/api/logout', { method: 'POST' }); window.location.href = '/login'; } };
        }
        try {
            localStorage.setItem('ticketsDashboard.userCache.v1', JSON.stringify({
                full_name: u.full_name || u.username,
                username: u.username,
                email: u.email || 'Member'
            }));
        } catch (e) {
            console.warn('Failed to cache user info', e);
        }
        return true;
    } catch (e) {
        return false;
    }
}
function handleAuthClick() { window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname); }

// ==================== HELPERS ====================
function setTicketsLoadingState(message = 'Loading recent tickets...') {
    const container = document.getElementById('ticketCards');
    if (!container) return;
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <div class="icon">🎫</div>
        <p>${message}</p>
    </div>`;
}

function renderTicketSkeletons(count = INITIAL_TICKETS_BATCH_SIZE) {
    const container = document.getElementById('ticketCards');
    if (!container) return;
    container.innerHTML = Array.from({ length: count }).map(() => `
        <div class="itin-card" style="pointer-events:none;opacity:0.92;">
            <div class="itin-card-top draft"></div>
            <div class="itin-card-body">
                <div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;margin-bottom:0.8rem;">
                    <div style="flex:1;">
                        <div style="height:12px;width:120px;border-radius:999px;background:rgba(148,163,184,0.18);margin-bottom:0.7rem;"></div>
                        <div style="height:18px;width:180px;border-radius:999px;background:rgba(148,163,184,0.16);margin-bottom:0.7rem;"></div>
                    </div>
                    <div style="height:28px;width:74px;border-radius:8px;background:rgba(148,163,184,0.18);"></div>
                </div>
                <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.8rem;">
                    <div style="height:12px;width:72px;border-radius:999px;background:rgba(148,163,184,0.14);"></div>
                    <div style="height:12px;width:90px;border-radius:999px;background:rgba(148,163,184,0.14);"></div>
                </div>
                <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:1rem;">
                    <div style="height:26px;width:110px;border-radius:8px;background:rgba(148,163,184,0.12);"></div>
                    <div style="height:26px;width:120px;border-radius:8px;background:rgba(148,163,184,0.12);"></div>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div style="height:18px;width:90px;border-radius:999px;background:rgba(148,163,184,0.18);"></div>
                    <div style="height:12px;width:72px;border-radius:999px;background:rgba(148,163,184,0.14);"></div>
                </div>
            </div>
        </div>
    `).join('');
}

function setTicketsLoadingState() {
    const container = document.getElementById('ticketCards');
    if (!container || container.querySelector('[data-ticket-id]')) return;
    renderTicketSkeletons();
}

function readCachedJson(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function writeCachedJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.warn('Failed to cache data', e);
    }
}

function removeCachedJson(key) {
    try {
        localStorage.removeItem(key);
    } catch (e) {
        console.warn('Failed to remove cached data', e);
    }
}

function getTicketDraftCacheKey(ticketId) {
    return ticketId ? `${TICKET_DRAFT_CACHE_PREFIX}${ticketId}` : '';
}

function readTicketDraft(ticketId) {
    const key = getTicketDraftCacheKey(ticketId);
    return key ? readCachedJson(key) : null;
}

function persistTicketDraft(ticket = editedData) {
    const ticketId = ticket?.id || currentTicket?.id;
    if (!ticketId || !ticket) return;
    hasPendingLocalDraft = true;
    writeCachedJson(getTicketDraftCacheKey(ticketId), {
        saved_at: Date.now(),
        ticket: JSON.parse(JSON.stringify(ticket)),
        base_snapshot: ticketEditBaseSnapshot ? JSON.parse(JSON.stringify(ticketEditBaseSnapshot)) : null
    });
}

function clearTicketDraft(ticketId = currentTicket?.id) {
    const key = getTicketDraftCacheKey(ticketId);
    if (!key) return;
    hasPendingLocalDraft = false;
    removeCachedJson(key);
}

function scheduleDraftRetry(delayMs = 2000) {
    clearTimeout(draftRetryHandle);
    draftRetryHandle = setTimeout(() => {
        if (!currentTicket || !editedData || !isDetailDirty || isSaveInFlight) return;
        void queueSave(true);
    }, delayMs);
}

function applyTicketDraftIfPresent(ticketId, { showToastMessage = false } = {}) {
    const draft = readTicketDraft(ticketId);
    if (!draft?.ticket) return false;
    editedData = normalizeTicketFareData(JSON.parse(JSON.stringify(draft.ticket)));
    fareFieldsTouched = false;
    hasPendingLocalDraft = true;
    ticketEditBaseSnapshot = draft.base_snapshot
        ? JSON.parse(JSON.stringify(draft.base_snapshot))
        : (currentTicket ? JSON.parse(JSON.stringify(currentTicket)) : null);
    isDetailDirty = true;
    if (showToastMessage) {
        showToast('Recovered unsaved local changes. Syncing in background...', 'info');
    }
    scheduleDraftRetry(1200);
    return true;
}

function hydrateUserFromCache() {
    const cachedUser = readCachedJson('ticketsDashboard.userCache.v1');
    if (!cachedUser) return;
    const nameEl = document.getElementById('sidebarUserName');
    if (nameEl) nameEl.textContent = cachedUser.full_name || cachedUser.username || '';
    const emailEl = document.getElementById('sidebarUserEmail');
    if (emailEl) emailEl.textContent = cachedUser.email || 'Member';
    const avatarEl = document.getElementById('sidebarAvatar');
    const avatarSource = cachedUser.full_name || cachedUser.username || '';
    if (avatarEl && avatarSource) avatarEl.textContent = avatarSource.charAt(0).toUpperCase();
}

const safe = (val, fallback = '') => {
    if (val === undefined || val === null || val === 'N/A' || val === 'Not Specified') return fallback;
    return val;
};
function formatDate(d) { if (!d) return '-'; return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
function parseMoneyValue(value) {
    if (value === undefined || value === null) return 0;
    if (typeof value === 'string') {
        const normalized = value.trim();
        if (!normalized || normalized.toUpperCase() === 'N/A' || normalized.toLowerCase() === 'not specified') {
            return 0;
        }
    }
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function inferDuplicatedConsolidatedFareFromPassengers(passengers) {
    const rows = (passengers || []).map((passenger) => {
        const fare = passenger?.fare || {};
        return {
            base_fare: parseMoneyValue(fare.base_fare),
            k3_gst: parseMoneyValue(fare.k3_gst),
            other_taxes: parseMoneyValue(fare.other_taxes),
            total_fare: parseMoneyValue(fare.total_fare)
        };
    }).filter((row) => row.base_fare || row.k3_gst || row.other_taxes || row.total_fare);

    if (rows.length <= 1) return null;
    const first = rows[0];
    const allIdentical = rows.every((row) =>
        row.base_fare === first.base_fare &&
        row.k3_gst === first.k3_gst &&
        row.other_taxes === first.other_taxes &&
        row.total_fare === first.total_fare
    );
    if (!allIdentical) return null;
    return {
        base_fare: first.base_fare,
        k3_gst: first.k3_gst,
        other_taxes: first.other_taxes
    };
}

function normalizeTicketFareData(ticket) {
    if (!ticket || typeof ticket !== 'object') return ticket;
    const normalized = JSON.parse(JSON.stringify(ticket));
    normalized.currency = safe(normalized.currency, 'INR');
    normalized.grand_total = parseMoneyValue(normalized.grand_total);
    const persistedGrandTotal = normalized.grand_total;
    const rawBookingGrandTotal = parseMoneyValue((((normalized.raw_data || {}).booking || {}).grand_total));
    if (persistedGrandTotal <= 0 && rawBookingGrandTotal > 0) {
        normalized.grand_total = rawBookingGrandTotal;
    }
    if (normalized.journey) {
        normalized.journey.global_markup = parseMoneyValue(normalized.journey.global_markup);
        if (!normalized.journey.consolidated_fare) {
            const inferredConsolidated = inferDuplicatedConsolidatedFareFromPassengers(normalized.passengers || []);
            if (inferredConsolidated) {
                normalized.journey.consolidated_fare = inferredConsolidated;
            }
        }
        if (normalized.journey.consolidated_fare) {
            normalized.journey.consolidated_fare.base_fare = parseMoneyValue(normalized.journey.consolidated_fare.base_fare);
            normalized.journey.consolidated_fare.k3_gst = parseMoneyValue(normalized.journey.consolidated_fare.k3_gst);
            normalized.journey.consolidated_fare.other_taxes = parseMoneyValue(normalized.journey.consolidated_fare.other_taxes);
            if (normalized.grand_total > 0 && normalized.journey.global_markup <= 0) {
                const consolidatedSubtotal =
                    normalized.journey.consolidated_fare.base_fare +
                    normalized.journey.consolidated_fare.k3_gst +
                    normalized.journey.consolidated_fare.other_taxes;
                const passengerCount = (normalized.passengers || []).length || 1;
                normalized.journey.global_markup = Math.max(normalized.grand_total - consolidatedSubtotal, 0) / passengerCount;
            }
        }
    }
    normalized.passengers = (normalized.passengers || []).map((passenger) => {
        const fare = passenger.fare || {};
        return {
            ...passenger,
            fare: {
                ...fare,
                base_fare: parseMoneyValue(fare.base_fare),
                k3_gst: parseMoneyValue(fare.k3_gst),
                other_taxes: parseMoneyValue(fare.other_taxes),
                total_fare: parseMoneyValue(fare.total_fare)
            }
        };
    });
    return normalized;
}
function formatCurrency(n, curr) {
    let currencyCode = curr || 'INR';
    if (currencyCode === 'N/A' || currencyCode === 'Not Specified') currencyCode = 'INR';
    const currencySymbols = {
        INR: '\u20B9',
        USD: '$',
        EUR: '\u20AC',
        GBP: '\u00A3',
        AED: 'AED ',
        SGD: 'S$',
        THB: '\u0E3F'
    };
    const sym = currencySymbols[currencyCode] || `${currencyCode} `;
    return sym + parseMoneyValue(n).toLocaleString('en-IN');
}
function showToast(msg, type = 'info') {
    const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 3500);
}
function getTripLabel(t) {
    switch (t) { case 'round_trip': return 'Round Trip'; case 'multi_city': return 'Multi-City'; default: return 'One Way'; }
}
function getPaxLabel(type) {
    if (!type) return 'Adult';
    const t = type.toUpperCase();
    if (t === 'CHD' || t === 'CNN' || t === 'CHILD') return 'Child';
    if (t === 'INF' || t === 'INFANT') return 'Infant';
    return 'Adult';
}

function _flushArrivalToastIfReady(force = false) {
    if (!_pendingArrivalToastMessage) return;
    if (!force && !_processingJustCompleted) return;
    showToast(_pendingArrivalToastMessage, 'success');
    _pendingArrivalToastMessage = '';
    _processingJustCompleted = false;
}

function getSegmentDurationValue(segment) {
    if (!segment || typeof segment !== 'object') return '';
    if (segment.duration_calculated && segment.duration_calculated !== 'N/A') {
        return segment.duration_calculated;
    }
    if (segment.duration_extracted && segment.duration_extracted !== 'N/A') {
        return segment.duration_extracted;
    }
    return safe(segment.duration);
}

function parseDurationToMinutes(value) {
    if (!value || value === 'N/A' || value === 'Not Specified') return 0;
    const text = String(value).trim().toLowerCase();
    const hoursMatch = text.match(/(\d+)\s*h/);
    const minutesMatch = text.match(/(\d+)\s*m/);
    const hours = hoursMatch ? Number.parseInt(hoursMatch[1], 10) : 0;
    const minutes = minutesMatch ? Number.parseInt(minutesMatch[1], 10) : 0;
    return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

function formatDurationFromMinutes(totalMinutes) {
    if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return '';
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h`;
    return `${minutes}m`;
}

function getLegDurationValue(legIndices, segments, journey, legIdx) {
    let totalMinutes = 0;
    (legIndices || []).forEach((segIdx) => {
        totalMinutes += parseDurationToMinutes(getSegmentDurationValue((segments || [])[segIdx]));
        const seg = (segments || [])[segIdx] || {};
        totalMinutes += parseDurationToMinutes(seg.layover_duration);
    });
    return formatDurationFromMinutes(totalMinutes);
}

function getJourneyDurationValue(legs, segments, journey) {
    let totalMinutes = 0;
    (legs || []).forEach((legIndices, legIdx) => {
        totalMinutes += parseDurationToMinutes(getLegDurationValue(legIndices, segments, journey, legIdx));
    });
    return formatDurationFromMinutes(totalMinutes);
}

function getSegmentBookingClassValue(segment) {
    if (!segment || typeof segment !== 'object') return '';
    const bookingClass = segment.booking_class;
    let value = '';
    if (bookingClass && typeof bookingClass === 'object') {
        value = bookingClass.full_form || bookingClass.cabin || bookingClass.letter || bookingClass.code || '';
    } else if (typeof bookingClass === 'string') {
        value = bookingClass.trim();
    }
    if (!value) return '';
    const normalized = value.trim();
    if (!normalized || ['N/A', 'NONE', 'NULL', '-'].includes(normalized.toUpperCase())) {
        return '';
    }
    return normalized;
}

// ==================== LEG GROUPING ====================
function groupSegmentsIntoLegs(segments) {
    if (!segments || segments.length === 0) return [];
    const legs = [];
    let currentLeg = [0];
    for (let i = 1; i < segments.length; i++) {
        const prevArr = (segments[i - 1].arrival || {}).airport || '';
        const currDep = (segments[i].departure || {}).airport || '';
        const hasLayover = segments[i].layover_duration && segments[i].layover_duration !== 'N/A';
        if ((prevArr && currDep && prevArr.toUpperCase() === currDep.toUpperCase()) || hasLayover) {
            currentLeg.push(i);
        } else {
            legs.push(currentLeg);
            currentLeg = [i];
        }
    }
    legs.push(currentLeg);
    return legs;
}

function getLegLabel(legIdx, totalLegs, tripType) {
    if (tripType === 'round_trip') {
        return legIdx === 0 ? 'Outbound' : 'Return';
    } else if (tripType === 'multi_city') {
        return 'Flight ' + (legIdx + 1);
    }
    return 'Flight';
}

function getTicketSearchText(ticket) {
    const segments = ticket.segments || [];
    const cityText = segments.map((seg) => {
        const dep = seg.departure || {};
        const arr = seg.arrival || {};
        return [
            dep.city,
            dep.airport,
            arr.city,
            arr.airport,
            seg.airline,
            seg.flight_number
        ].filter(Boolean).join(' ');
    }).join(' ');

    return [
        ticket.pnr || '',
        ticket.route || '',
        (ticket.passenger_names || []).join(' '),
        cityText
    ].join(' ').toLowerCase();
}

function mergeTicketLists(primaryTickets, secondaryTickets) {
    const merged = [];
    const seenIds = new Set();
    const pushTicket = (ticket) => {
        if (!ticket) return;
        const ticketId = ticket.id;
        if (ticketId) {
            if (seenIds.has(ticketId)) return;
            seenIds.add(ticketId);
        }
        merged.push(ticket);
    };
    (primaryTickets || []).forEach(pushTicket);
    (secondaryTickets || []).forEach(pushTicket);
    return merged;
}

function cacheTicketDetail(ticket) {
    if (!ticket || !ticket.id) return;
    const normalized = normalizeTicketFareData(ticket);
    ticketDetailCache.set(normalized.id, normalized);
}

function setTicketEditBaseline(ticket) {
    if (!ticket) {
        ticketEditBaseSnapshot = null;
        return;
    }
    ticketEditBaseSnapshot = JSON.parse(JSON.stringify(ticket));
    if (Array.isArray(ticketEditBaseSnapshot.segments)) {
        ticketEditBaseSnapshot.segments = getPersistableSegments(ticketEditBaseSnapshot.segments);
    }
}

function getCachedTicketDetail(id) {
    if (!id) return null;
    const fromMemory = ticketDetailCache.get(id);
    if (fromMemory) return normalizeTicketFareData(fromMemory);
    const fromList = allTickets.find((ticket) => ticket && ticket.id === id);
    return fromList ? normalizeTicketFareData(fromList) : null;
}

function hydrateTicketsFromCache() {
    const cached = readCachedJson(TICKETS_CACHE_KEY);
    const cachedTickets = Array.isArray(cached?.tickets) ? cached.tickets.map(normalizeTicketFareData) : [];
    if (!cachedTickets.length) {
        renderTicketSkeletons();
        return false;
    }
    allTickets = cachedTickets;
    knownTicketIds = new Set(cachedTickets.map((ticket) => ticket.id).filter(Boolean));
    renderTicketCards();
    return true;
}

// ==================== LOAD DATA ====================
async function loadTickets(options = {}) {
    const {
        limit = 0,
        offset = 0,
        showLoading = false,
        render = true,
        notifyNewTickets = true
    } = options;
    try {
        if (showLoading && allTickets.length === 0) {
            setTicketsLoadingState(offset > 0 ? 'Loading more tickets...' : 'Loading recent tickets...');
        }
        const params = new URLSearchParams();
        if (limit > 0) params.set('limit', String(limit));
        if (offset > 0) params.set('offset', String(offset));
        const query = params.toString();
        const r = await fetch(`/api/tickets/list${query ? `?${query}` : ''}`);
        if (r.status === 401) {
            window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
            return null;
        }
        if (!r.ok) return null;
        const d = await r.json();
        const incomingTickets = (d.tickets || []).map(normalizeTicketFareData);
        totalAvailableTickets = Number.isFinite(Number(d.total_count)) ? Number(d.total_count) : incomingTickets.length;
        if (notifyNewTickets && hasInitializedTicketFeed && offset === 0) {
            const newTickets = incomingTickets.filter((ticket) => ticket && ticket.id && !knownTicketIds.has(ticket.id));
            if (newTickets.length > 0) {
                const firstTicket = newTickets[0];
                const title = (firstTicket.passenger_names || []).filter(Boolean).slice(0, 2).join(', ')
                    || firstTicket.pnr
                    || 'New ticket';
                _pendingArrivalToastMessage = newTickets.length === 1
                    ? `New ticket received: ${title}`
                    : `${newTickets.length} new tickets received`;
                const activeProcessingTotal = Array.isArray(_notifData.processing_batches)
                    ? _notifData.processing_batches.reduce((sum, batch) => sum + parseMoneyValue(batch.pending_count), 0)
                    : parseMoneyValue(_notifData.processing_count);
                _flushArrivalToastIfReady(activeProcessingTotal <= 0);
            }
        }
        if (limit > 0 || offset > 0) {
            allTickets = offset === 0
                ? mergeTicketLists(incomingTickets, allTickets)
                : mergeTicketLists(allTickets, incomingTickets);
        } else {
            allTickets = incomingTickets;
            lastFullTicketsSyncAt = Date.now();
        }
        if (!d.has_more && allTickets.length >= totalAvailableTickets) {
            lastFullTicketsSyncAt = Date.now();
        }
        knownTicketIds = new Set(allTickets.map((ticket) => ticket.id).filter(Boolean));
        allTickets.forEach(cacheTicketDetail);
        if (allTickets.length > 0) {
            writeCachedJson(TICKETS_CACHE_KEY, {
                cached_at: Date.now(),
                tickets: allTickets.slice(0, INITIAL_TICKETS_BATCH_SIZE)
            });
        }
        hasInitializedTicketFeed = true;
        if (render) {
            renderTicketCards();
        }
        return {
            totalCount: totalAvailableTickets,
            returnedCount: incomingTickets.length,
            hasMore: Boolean(d.has_more)
        };
    } catch (e) { console.error('Load error:', e); }
    return null;
}

async function syncAllTicketsInBackground() {
    if (fullTicketsSyncPromise) return fullTicketsSyncPromise;
    fullTicketsSyncPromise = (async () => {
        await loadTickets({ render: true, notifyNewTickets: false });
    })().finally(() => {
        fullTicketsSyncPromise = null;
    });
    return fullTicketsSyncPromise;
}

async function syncCurrentTicketFromServer() {
    if (!currentTicket || isDetailDirty || isSaveInFlight || Date.now() < suppressRealtimeUntil) return;
    const syncTicketId = currentTicket.id;
    const syncStartedAt = Date.now();
    try {
        const r = await fetch('/api/tickets/' + syncTicketId);
        if (!r.ok) return;
        const freshTicket = normalizeTicketFareData(await r.json());
        if (
            !currentTicket
            || currentTicket.id !== syncTicketId
            || isDetailDirty
            || isSaveInFlight
            || Date.now() < suppressRealtimeUntil
            || lastDetailInputAt > syncStartedAt
        ) {
            return;
        }
        currentTicket = freshTicket;
        cacheTicketDetail(currentTicket);
        editedData = JSON.parse(JSON.stringify(currentTicket));
        fareFieldsTouched = false;
        setTicketEditBaseline(currentTicket);
        renderDetailView();
    } catch (e) {
        console.error('Failed to refresh current ticket', e);
    }
}

function scheduleRealtimeRefresh(payload = {}) {
    if (payload.notifications) {
        _notifData = payload.notifications;
        _updateNotifBadges();
    }
    if (payload.ticket_id && currentTicket && currentTicket.id === payload.ticket_id) {
        if (!isDetailDirty && !isSaveInFlight && Date.now() >= suppressRealtimeUntil) {
            void syncCurrentTicketFromServer();
        }
    }
    clearTimeout(realtimeRefreshHandle);
    realtimeRefreshHandle = setTimeout(async () => {
        try {
            await loadNotifications();
            const snapshot = await loadTickets({ limit: INITIAL_TICKETS_BATCH_SIZE, render: true });
            if (snapshot && (allTickets.length < totalAvailableTickets || payload.event === 'ticket_created')) {
                void syncAllTicketsInBackground();
            }
        } catch (e) {
            console.error('Realtime refresh failed', e);
        }
    }, 120);
}

function startTicketsRealtime() {
    if (dashboardLiveUpdatesPaused) return false;
    if (!('EventSource' in window) || ticketsEventSource) return false;
    try {
        const stream = new EventSource('/api/tickets/stream');
        stream.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data || '{}');
                scheduleRealtimeRefresh(payload);
            } catch (e) {
                console.error('Invalid realtime payload', e);
            }
        };
        stream.onerror = () => {
            try {
                stream.close();
            } catch (e) {
                console.error('Failed to close realtime stream', e);
            }
            ticketsEventSource = null;
            startTicketsPolling();
        };
        ticketsEventSource = stream;
        return true;
    } catch (e) {
        console.error('Realtime stream unavailable', e);
        return false;
    }
}

function startTicketsPolling() {
    if (dashboardLiveUpdatesPaused) return;
    if (ticketsPollingHandle) return;
    ticketsPollingHandle = setInterval(async () => {
        if (document.hidden) return;
        try {
            await loadNotifications();
            const snapshot = await loadTickets({ limit: INITIAL_TICKETS_BATCH_SIZE, render: true });
            const needsFullSync = (
                allTickets.length < totalAvailableTickets
                || !lastFullTicketsSyncAt
                || (Date.now() - lastFullTicketsSyncAt) >= TICKETS_FULL_SYNC_INTERVAL_MS
            );
            if (snapshot && needsFullSync) {
                void syncAllTicketsInBackground();
            }
        } catch (e) {
            console.error('Tickets polling failed', e);
        }
    }, TICKETS_POLL_INTERVAL_MS);
}

function stopTicketsRealtime() {
    if (!ticketsEventSource) return;
    try {
        ticketsEventSource.close();
    } catch (e) {
        console.error('Failed to close realtime stream', e);
    }
    ticketsEventSource = null;
}

function stopTicketsPolling() {
    if (!ticketsPollingHandle) return;
    clearInterval(ticketsPollingHandle);
    ticketsPollingHandle = null;
}

function pauseDashboardLiveUpdates() {
    dashboardLiveUpdatesPaused = true;
    stopTicketsRealtime();
    stopTicketsPolling();
    clearTimeout(realtimeRefreshHandle);
    realtimeRefreshHandle = null;
}

function resumeDashboardLiveUpdates({ refresh = false } = {}) {
    dashboardLiveUpdatesPaused = false;
    if (!startTicketsRealtime()) {
        startTicketsPolling();
    }
    if (refresh) {
        void loadNotifications();
        void loadTickets({ limit: INITIAL_TICKETS_BATCH_SIZE, render: true, notifyNewTickets: false });
        void syncAllTicketsInBackground();
    }
}

// ==================== FILTER & CARDS ====================
function filterTickets(status, btn) {
    currentFilter = status;
    _mergedViewActive = false;
    document.querySelectorAll('.filter-bar .tab').forEach(t => t.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderTicketCards();
}

function renderTicketCards() {
    const container = document.getElementById('ticketCards');
    let items = allTickets;
    const searchInput = document.getElementById('ticketSearch');
    if (searchInput && searchInput.value.trim()) {
        const q = searchInput.value.toLowerCase().trim();
        items = items.filter(t => {
            return getTicketSearchText(t).includes(q);
        });
    }
    if (_mergedViewActive) {
        items = items.filter(t => t.booking_group_id);
    } else if (currentFilter !== 'all') {
        items = items.filter(t => t.status === currentFilter);
    }
    if (items.length === 0) {
        const emptyMsg = _mergedViewActive
            ? 'No merged bookings yet. Merge PNR groups to see combined bookings here.'
            : (searchInput && searchInput.value ? 'No tickets matched your search.' : 'No tickets found. Tickets will appear here when received from the parser.');
        container.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
            <div class="icon">${_mergedViewActive ? '📦' : '🎫'}</div>
            <p>${emptyMsg}</p>
        </div>`;
        return;
    }
    container.innerHTML = items.map(t => {
        const segments = t.segments || [];
        const passengers = t.passengers || [];
        const journey = t.journey || {};

        // Use journey legs if available (API format has {segments: [idx...], from, to})
        let legs;
        if (journey.legs && journey.legs.length > 0) {
            legs = journey.legs.map(leg => leg.segments || []);
        } else if (t.legs) {
            legs = t.legs;
        } else {
            legs = groupSegmentsIntoLegs(segments);
        }

        // Get overall origin/destination
        const firstLegIndices = legs[0] || [];
        const lastLegIndices = legs[legs.length - 1] || [];
        const firstSeg = segments[firstLegIndices[0]] || segments[0] || {};
        let arrCode = '';
        if (t.trip_type === 'round_trip' && legs.length >= 2) {
            const outboundLastSeg = segments[legs[0][legs[0].length - 1]] || {};
            arrCode = (outboundLastSeg.arrival || {}).airport || '';
        } else {
            const lastSeg = segments[lastLegIndices[lastLegIndices.length - 1] || 0] || segments[segments.length - 1] || {};
            arrCode = (lastSeg.arrival || {}).airport || '';
        }
        const depCode = (firstSeg.departure || {}).airport || '';
        const airline = firstSeg.airline || '';
        const flightNum = firstSeg.flight_number || '';
        const depDate = (firstSeg.departure || {}).date || '';

        // Build route HTML based on trip type
        let routeHtml = '';
        if (t.trip_type === 'multi_city') {
            const dests = [];
            legs.forEach(l => {
                const fs = segments[l[0]] || {};
                const apt = (fs.departure || {}).airport;
                if (apt) dests.push(apt);
            });
            const ls = segments[lastLegIndices[lastLegIndices.length - 1] || 0] || segments[segments.length - 1] || {};
            const finalApt = (ls.arrival || {}).airport;
            if (finalApt) dests.push(finalApt);
            routeHtml = dests.filter(Boolean).map(d => `<span class="route-code">${d}</span>`).join('<span class="route-arrow"> → </span>');
        } else {
            const arrow = t.trip_type === 'round_trip' ? ' ↔ ' : ' → ';
            routeHtml = `<span class="route-code">${depCode}</span><span class="route-arrow">${arrow}</span><span class="route-code">${arrCode}</span>`;
        }

        // Count layovers
        const totalSegments = segments.length;
        const totalLegs = legs.length;
        let layoverCount = totalSegments - totalLegs;
        let layoverLabel = '';
        if (layoverCount > 0) {
            layoverLabel = `<span class="layover-chip">${layoverCount} stop${layoverCount > 1 ? 's' : ''}</span>`;
        }

        // Trip type display
        const tripDisplay = journey.trip_type_display || getTripLabel(t.trip_type);

        const statusClass = t.status === 'matched' ? 'confirmed' : 'draft';
        const statusBadge = t.status === 'matched'
            ? '<span class="match-badge matched">✅ Matched</span>'
            : '<span class="match-badge unmatched">Unmatched</span>';

        // Ticket status badge (live/cancelled/changed)
        const tStatus = t.ticket_status || 'live';
        const tStatusBadge = tStatus === 'cancelled'
            ? '<span style="background:rgba(239,68,68,0.12);color:#ef4444;padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">🔴 Cancelled</span>'
            : tStatus === 'changed'
            ? '<span style="background:rgba(245,158,11,0.12);color:#f59e0b;padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">🟡 Changed</span>'
            : '<span style="background:rgba(16,185,129,0.12);color:#10b981;padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">🟢 Live</span>';
        const splitBadge = t.parent_ticket_id
            ? '<span style="background:rgba(15,23,42,0.08);color:var(--text-secondary);padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">Split Booking</span>'
            : (t.children && t.children.length ? '<span style="background:rgba(37,99,235,0.08);color:var(--primary);padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">Has Splits</span>' : '');
        const mergedBadge = t.booking_group_id
            ? '<span style="background:rgba(5,150,105,0.12);color:#059669;padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">Merged Booking</span>'
            : '';

        // Calculate actual total for display on card
        let calculatedTotal = 0;
        const globalMarkup = parseMoneyValue(journey.global_markup);

        passengers.forEach(p => {
            const f = p.fare || {};
            calculatedTotal += parseMoneyValue(f.base_fare) +
                parseMoneyValue(f.k3_gst) +
                parseMoneyValue(f.other_taxes) +
                globalMarkup;
        });

        // Use override if present, otherwise use calculated total
        const grandTotal = parseMoneyValue(t.grand_total);
        const displayTotal = grandTotal > 0 ? grandTotal : calculatedTotal;

        return `<div class="itin-card" onclick="openTicket('${t.id}')">
            <div class="itin-card-top ${statusClass}"></div>
            <div class="itin-card-body">
                <div class="itin-card-header">
                    <div>
                        <div class="ticket-card-airline">
                            <span class="airline-tag">${safe(airline, 'Airline')}</span>
                            <span>${safe(flightNum)}</span>
                        </div>
                        <div class="ticket-card-route">
                            ${routeHtml}
                            ${layoverLabel}
                        </div>
                    </div>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.4rem;">
                        <span class="pnr-label">${safe(t.pnr, '---')}</span>
                        ${statusBadge}
                        ${tStatusBadge}
                        ${splitBadge}
                        ${mergedBadge}
                    </div>
                </div>
                <div class="itin-card-meta">
                    <span class="meta-item"><b>Type:</b> ${tripDisplay}</span>
                    <span class="meta-item"><b>Date:</b> ${safe(depDate, '-')}</span>
                    ${t.class_of_travel && t.class_of_travel !== 'None' ? `<span class="meta-item"><b>Class:</b> ${safe(t.class_of_travel, 'Economy')}</span>` : ''}
                </div>
                <div class="ticket-card-pax">
                    ${passengers.map(p => `<span class="pax-chip">👤 ${safe(p.name, 'Passenger')}<br><span style="font-size:0.68rem;color:var(--text-secondary);">${safe(p.system_ticket_number, '')}</span></span>`).join('')}
                </div>
                <div class="itin-card-footer">
                    <span class="itin-amount">${formatCurrency(displayTotal, t.currency || 'INR')}</span>
                    <span class="itin-date">${formatDate(t.created_at)}</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

function getVisibleTicketItems() {
    let items = allTickets;
    const searchInput = document.getElementById('ticketSearch');
    if (searchInput && searchInput.value.trim()) {
        const q = searchInput.value.toLowerCase().trim();
        items = items.filter(t => getTicketSearchText(t).includes(q));
    }
    if (_mergedViewActive) {
        items = items.filter(t => t.booking_group_id);
    } else if (currentFilter !== 'all') {
        items = items.filter(t => t.status === currentFilter);
    }
    return items;
}

function buildEmptyTicketsStateHtml() {
    const searchInput = document.getElementById('ticketSearch');
    const emptyMsg = _mergedViewActive
        ? 'No merged bookings yet. Merge PNR groups to see combined bookings here.'
        : (searchInput && searchInput.value ? 'No tickets matched your search.' : 'No tickets found. Tickets will appear here when received from the parser.');
    return `<div class="empty-state" style="grid-column:1/-1">
        <div class="icon">${_mergedViewActive ? 'ðŸ“¦' : 'ðŸŽ«'}</div>
        <p>${emptyMsg}</p>
    </div>`;
}

function buildTicketCardHtml(t) {
    const segments = t.segments || [];
    const passengers = t.passengers || [];
    const journey = t.journey || {};

    let legs;
    if (journey.legs && journey.legs.length > 0) {
        legs = journey.legs.map(leg => leg.segments || []);
    } else if (t.legs) {
        legs = t.legs;
    } else {
        legs = groupSegmentsIntoLegs(segments);
    }

    const firstLegIndices = legs[0] || [];
    const lastLegIndices = legs[legs.length - 1] || [];
    const firstSeg = segments[firstLegIndices[0]] || segments[0] || {};
    let arrCode = '';
    if (t.trip_type === 'round_trip' && legs.length >= 2) {
        const outboundLastSeg = segments[legs[0][legs[0].length - 1]] || {};
        arrCode = (outboundLastSeg.arrival || {}).airport || '';
    } else {
        const lastSeg = segments[lastLegIndices[lastLegIndices.length - 1] || 0] || segments[segments.length - 1] || {};
        arrCode = (lastSeg.arrival || {}).airport || '';
    }
    const depCode = (firstSeg.departure || {}).airport || '';
    const airline = firstSeg.airline || '';
    const flightNum = firstSeg.flight_number || '';
    const depDate = (firstSeg.departure || {}).date || '';

    let routeHtml = '';
    if (t.trip_type === 'multi_city') {
        const dests = [];
        legs.forEach(l => {
            const fs = segments[l[0]] || {};
            const apt = (fs.departure || {}).airport;
            if (apt) dests.push(apt);
        });
        const ls = segments[lastLegIndices[lastLegIndices.length - 1] || 0] || segments[segments.length - 1] || {};
        const finalApt = (ls.arrival || {}).airport;
        if (finalApt) dests.push(finalApt);
        routeHtml = dests.filter(Boolean).map(d => `<span class="route-code">${d}</span>`).join('<span class="route-arrow"> â†’ </span>');
    } else {
        const arrow = t.trip_type === 'round_trip' ? ' â†” ' : ' â†’ ';
        routeHtml = `<span class="route-code">${depCode}</span><span class="route-arrow">${arrow}</span><span class="route-code">${arrCode}</span>`;
    }

    const layoverCount = segments.length - legs.length;
    const layoverLabel = layoverCount > 0
        ? `<span class="layover-chip">${layoverCount} stop${layoverCount > 1 ? 's' : ''}</span>`
        : '';

    const tripDisplay = journey.trip_type_display || getTripLabel(t.trip_type);
    const statusClass = t.status === 'matched' ? 'confirmed' : 'draft';
    const statusBadge = t.status === 'matched'
        ? '<span class="match-badge matched">âœ… Matched</span>'
        : '<span class="match-badge unmatched">Unmatched</span>';
    const tStatus = t.ticket_status || 'live';
    const tStatusBadge = tStatus === 'cancelled'
        ? '<span style="background:rgba(239,68,68,0.12);color:#ef4444;padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">ðŸ”´ Cancelled</span>'
        : tStatus === 'changed'
        ? '<span style="background:rgba(245,158,11,0.12);color:#f59e0b;padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">ðŸŸ¡ Changed</span>'
        : '<span style="background:rgba(16,185,129,0.12);color:#10b981;padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">ðŸŸ¢ Live</span>';
    const splitBadge = t.parent_ticket_id
        ? '<span style="background:rgba(15,23,42,0.08);color:var(--text-secondary);padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">Split Booking</span>'
        : (t.children && t.children.length ? '<span style="background:rgba(37,99,235,0.08);color:var(--primary);padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">Has Splits</span>' : '');
    const mergedBadge = t.booking_group_id
        ? '<span style="background:rgba(5,150,105,0.12);color:#059669;padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">Merged Booking</span>'
        : '';

    let calculatedTotal = 0;
    const globalMarkup = parseMoneyValue(journey.global_markup);
    passengers.forEach(p => {
        const f = p.fare || {};
        calculatedTotal += parseMoneyValue(f.base_fare) +
            parseMoneyValue(f.k3_gst) +
            parseMoneyValue(f.other_taxes) +
            globalMarkup;
    });
    const grandTotal = parseMoneyValue(t.grand_total);
    const displayTotal = grandTotal > 0 ? grandTotal : calculatedTotal;

    return `<div class="itin-card" data-ticket-id="${safe(t.id)}" onclick="openTicket('${t.id}')">
        <div class="itin-card-top ${statusClass}"></div>
        <div class="itin-card-body">
            <div class="itin-card-header">
                <div>
                    <div class="ticket-card-airline">
                        <span class="airline-tag">${safe(airline, 'Airline')}</span>
                        <span>${safe(flightNum)}</span>
                    </div>
                    <div class="ticket-card-route">
                        ${routeHtml}
                        ${layoverLabel}
                    </div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.4rem;">
                    <span class="pnr-label">${safe(t.pnr, '---')}</span>
                    ${statusBadge}
                    ${tStatusBadge}
                    ${splitBadge}
                    ${mergedBadge}
                </div>
            </div>
            <div class="itin-card-meta">
                <span class="meta-item"><b>Type:</b> ${tripDisplay}</span>
                <span class="meta-item"><b>Date:</b> ${safe(depDate, '-')}</span>
                ${t.class_of_travel && t.class_of_travel !== 'None' ? `<span class="meta-item"><b>Class:</b> ${safe(t.class_of_travel, 'Economy')}</span>` : ''}
            </div>
            <div class="ticket-card-pax">
                ${passengers.map(p => `<span class="pax-chip">ðŸ‘¤ ${safe(p.name, 'Passenger')}<br><span style="font-size:0.68rem;color:var(--text-secondary);">${safe(p.system_ticket_number, '')}</span></span>`).join('')}
            </div>
            <div class="itin-card-footer">
                <span class="itin-amount">${formatCurrency(displayTotal, t.currency || 'INR')}</span>
                <span class="itin-date">${formatDate(t.created_at)}</span>
            </div>
        </div>
    </div>`;
}

function patchTicketCards(items) {
    const container = document.getElementById('ticketCards');
    if (!container) return;

    if (items.length === 0) {
        container.innerHTML = buildEmptyTicketsStateHtml();
        return;
    }

    const itemIds = new Set(items.map(ticket => String(ticket.id || '')).filter(Boolean));
    const existingMap = new Map(
        Array.from(container.querySelectorAll('[data-ticket-id]')).map(node => [node.dataset.ticketId, node])
    );

    items.forEach((ticket, index) => {
        const ticketId = String(ticket.id || '');
        if (!ticketId) return;

        const nextHtml = buildTicketCardHtml(ticket);
        let currentNode = existingMap.get(ticketId);

        if (currentNode) {
            if (currentNode.outerHTML !== nextHtml) {
                const wrapper = document.createElement('div');
                wrapper.innerHTML = nextHtml;
                const replacementNode = wrapper.firstElementChild;
                currentNode.replaceWith(replacementNode);
                currentNode = replacementNode;
                existingMap.set(ticketId, currentNode);
            }
        } else {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = nextHtml;
            currentNode = wrapper.firstElementChild;
            existingMap.set(ticketId, currentNode);
        }

        const anchorNode = container.children[index];
        if (anchorNode !== currentNode) {
            container.insertBefore(currentNode, anchorNode || null);
        }
    });

    Array.from(container.querySelectorAll('[data-ticket-id]')).forEach(node => {
        if (!itemIds.has(node.dataset.ticketId)) {
            node.remove();
        }
    });

    Array.from(container.children).forEach(node => {
        if (!node.dataset || !node.dataset.ticketId) {
            node.remove();
        }
    });
}

function buildTicketCardHtml(t) {
    const segments = t.segments || [];
    const passengers = t.passengers || [];
    const journey = t.journey || {};

    let legs;
    if (journey.legs && journey.legs.length > 0) {
        legs = journey.legs.map(leg => leg.segments || []);
    } else if (t.legs) {
        legs = t.legs;
    } else {
        legs = groupSegmentsIntoLegs(segments);
    }

    const firstLegIndices = legs[0] || [];
    const lastLegIndices = legs[legs.length - 1] || [];
    const firstSeg = segments[firstLegIndices[0]] || segments[0] || {};
    let arrCode = '';
    if (t.trip_type === 'round_trip' && legs.length >= 2) {
        const outboundLastSeg = segments[legs[0][legs[0].length - 1]] || {};
        arrCode = (outboundLastSeg.arrival || {}).airport || '';
    } else {
        const lastSeg = segments[lastLegIndices[lastLegIndices.length - 1] || 0] || segments[segments.length - 1] || {};
        arrCode = (lastSeg.arrival || {}).airport || '';
    }
    const depCode = (firstSeg.departure || {}).airport || '';
    const airline = firstSeg.airline || '';
    const flightNum = firstSeg.flight_number || '';
    const depDate = (firstSeg.departure || {}).date || '';

    let routeHtml = '';
    if (t.trip_type === 'multi_city') {
        const dests = [];
        legs.forEach(l => {
            const fs = segments[l[0]] || {};
            const apt = (fs.departure || {}).airport;
            if (apt) dests.push(apt);
        });
        const ls = segments[lastLegIndices[lastLegIndices.length - 1] || 0] || segments[segments.length - 1] || {};
        const finalApt = (ls.arrival || {}).airport;
        if (finalApt) dests.push(finalApt);
        routeHtml = dests.filter(Boolean).map(d => `<span class="route-code">${d}</span>`).join('<span class="route-arrow">&rarr;</span>');
    } else {
        const arrow = t.trip_type === 'round_trip' ? '&harr;' : '&rarr;';
        routeHtml = `<span class="route-code">${depCode}</span><span class="route-arrow">${arrow}</span><span class="route-code">${arrCode}</span>`;
    }

    const layoverCount = segments.length - legs.length;
    const layoverLabel = layoverCount > 0
        ? `<span class="layover-chip">${layoverCount} stop${layoverCount > 1 ? 's' : ''}</span>`
        : '';

    const tripDisplay = journey.trip_type_display || getTripLabel(t.trip_type);
    const statusClass = t.status === 'matched' ? 'confirmed' : 'draft';
    const statusBadge = t.status === 'matched'
        ? '<span class="match-badge matched">&#10004; Matched</span>'
        : '<span class="match-badge unmatched">Unmatched</span>';
    const tStatus = t.ticket_status || 'live';
    const tStatusBadge = tStatus === 'cancelled'
        ? '<span style="background:rgba(239,68,68,0.12);color:#ef4444;padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">Cancelled</span>'
        : tStatus === 'changed'
        ? '<span style="background:rgba(245,158,11,0.12);color:#f59e0b;padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">Changed</span>'
        : '<span style="background:rgba(16,185,129,0.12);color:#10b981;padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">Live</span>';
    const splitBadge = t.parent_ticket_id
        ? '<span style="background:rgba(15,23,42,0.08);color:var(--text-secondary);padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">Split Booking</span>'
        : (t.children && t.children.length ? '<span style="background:rgba(37,99,235,0.08);color:var(--primary);padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">Has Splits</span>' : '');
    const mergedBadge = t.booking_group_id
        ? '<span style="background:rgba(5,150,105,0.12);color:#059669;padding:0.15rem 0.5rem;border-radius:6px;font-size:0.72rem;font-weight:700;">Merged Booking</span>'
        : '';

    let calculatedTotal = 0;
    const globalMarkup = parseMoneyValue(journey.global_markup);
    passengers.forEach(p => {
        const f = p.fare || {};
        calculatedTotal += parseMoneyValue(f.base_fare) +
            parseMoneyValue(f.k3_gst) +
            parseMoneyValue(f.other_taxes) +
            globalMarkup;
    });
    const grandTotal = parseMoneyValue(t.grand_total);
    const displayTotal = grandTotal > 0 ? grandTotal : calculatedTotal;

    return `<div class="itin-card" data-ticket-id="${safe(t.id)}" onclick="openTicket('${t.id}')">
        <div class="itin-card-top ${statusClass}"></div>
        <div class="itin-card-body">
            <div class="itin-card-header">
                <div>
                    <div class="ticket-card-airline">
                        <span class="airline-tag">${safe(airline, 'Airline')}</span>
                        <span>${safe(flightNum)}</span>
                    </div>
                    <div class="ticket-card-route">
                        ${routeHtml}
                        ${layoverLabel}
                    </div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.4rem;">
                    <span class="pnr-label">${safe(t.pnr, '---')}</span>
                    ${statusBadge}
                    ${tStatusBadge}
                    ${splitBadge}
                    ${mergedBadge}
                </div>
            </div>
            <div class="itin-card-meta">
                <span class="meta-item"><b>Type:</b> ${tripDisplay}</span>
                <span class="meta-item"><b>Date:</b> ${safe(depDate, '-')}</span>
                ${t.class_of_travel && t.class_of_travel !== 'None' ? `<span class="meta-item"><b>Class:</b> ${safe(t.class_of_travel, 'Economy')}</span>` : ''}
            </div>
            <div class="ticket-card-pax">
                ${passengers.map(p => `<span class="pax-chip">👤 ${safe(p.name, 'Passenger')}<br><span style="font-size:0.68rem;color:var(--text-secondary);">${safe(p.system_ticket_number, '')}</span></span>`).join('')}
            </div>
            <div class="itin-card-footer">
                <span class="itin-amount">${formatCurrency(displayTotal, t.currency || 'INR')}</span>
                <span class="itin-date">${formatDate(t.created_at)}</span>
            </div>
        </div>
    </div>`;
}

function renderTicketCards() {
    patchTicketCards(getVisibleTicketItems());
}

// ==================== OPEN TICKET DETAIL ====================
async function openTicket(id) {
    const showDetailView = () => {
        document.getElementById('listView').style.display = 'none';
        document.getElementById('detailView').style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    try {
        pauseDashboardLiveUpdates();
        const cachedTicket = getCachedTicketDetail(id);
        if (cachedTicket) {
            currentTicket = cachedTicket;
            fareFieldsTouched = false;
            editedData = JSON.parse(JSON.stringify(currentTicket));
            setTicketEditBaseline(currentTicket);
            applyTicketDraftIfPresent(currentTicket.id, { showToastMessage: true });
            renderDetailView();
            showDetailView();
            void syncCurrentTicketFromServer();
            return;
        }

        document.getElementById('listView').style.display = 'none';
        document.getElementById('detailView').style.display = 'block';
        document.getElementById('ticketDetailHeader').innerHTML = `<div><h1>Loading ticket...</h1></div>`;
        window.scrollTo({ top: 0, behavior: 'smooth' });

        const r = await fetch('/api/tickets/' + id);
        if (!r.ok) { showToast('Failed to load ticket', 'error'); showListView(); return; }
        currentTicket = normalizeTicketFareData(await r.json());
        cacheTicketDetail(currentTicket);
        fareFieldsTouched = false;
        editedData = JSON.parse(JSON.stringify(currentTicket));
        setTicketEditBaseline(currentTicket);
        applyTicketDraftIfPresent(currentTicket.id, { showToastMessage: true });
        renderDetailView();
        showDetailView();
    } catch (e) {
        console.error(e);
        showToast('Error loading ticket', 'error');
        await showListView();
    }
}

async function showListView() {
    if (currentTicket && editedData) {
        clearTimeout(autoSaveTimeout);
        if (isDetailDirty) {
            await queueSave(true);
        }
    }
    document.getElementById('detailView').style.display = 'none';
    document.getElementById('listView').style.display = 'block';
    currentTicket = null;
    editedData = {};
    changeAttachmentState = { token: '', filename: '' };
    selectedPaxIndices.clear();
    _removePaxActionBar();
    resumeDashboardLiveUpdates({ refresh: true });
}

// ==================== NOTIFICATION PANEL SYSTEM ====================
let _notifData = { merge_count: 0, merge_groups: [], duplicate_count: 0, processing_count: 0, processing_batches: [] };
let _activeNotifPanel = null;
let _mergedViewActive = false;

async function loadNotifications() {
    try {
        const r = await fetch('/api/tickets/notifications');
        if (!r.ok) return;
        const previousActiveProcessingCount = Array.isArray(_notifData.processing_batches)
            ? _notifData.processing_batches.reduce((sum, batch) => sum + parseMoneyValue(batch.pending_count), 0)
            : parseMoneyValue(_notifData.processing_count);
        _notifData = await r.json();
        const nextActiveProcessingCount = Array.isArray(_notifData.processing_batches)
            ? _notifData.processing_batches.reduce((sum, batch) => sum + parseMoneyValue(batch.pending_count), 0)
            : parseMoneyValue(_notifData.processing_count);
        if (nextActiveProcessingCount > 0) {
            _processingIndicatorMode = 'processing';
            if (_processingDoneTimeout) {
                clearTimeout(_processingDoneTimeout);
                _processingDoneTimeout = null;
            }
        } else if (previousActiveProcessingCount > 0 && nextActiveProcessingCount === 0) {
            _processingIndicatorMode = 'done';
            _processingJustCompleted = true;
            if (_processingDoneTimeout) clearTimeout(_processingDoneTimeout);
            _processingDoneTimeout = setTimeout(() => {
                _processingIndicatorMode = 'idle';
                _processingDoneTimeout = null;
                _updateNotifBadges();
            }, 3000);
        }
        _lastProcessingCount = nextActiveProcessingCount;
        _updateNotifBadges();
        _scheduleProcessingRefresh();
        _flushArrivalToastIfReady();
    } catch (e) { console.error('Failed to load notifications', e); }
}

function _scheduleProcessingRefresh() {
    if (_processingRefreshTimeout) {
        clearTimeout(_processingRefreshTimeout);
        _processingRefreshTimeout = null;
    }

    const batches = Array.isArray(_notifData.processing_batches) ? _notifData.processing_batches : [];
    if (!batches.length) return;

    const nowTs = Date.now() / 1000;
    let nextRefreshMs = null;

    batches.forEach((batch) => {
        const pendingCount = parseMoneyValue(batch.pending_count);
        const visibleUntilTs = Number.parseFloat(batch.visible_until_ts);
        if (pendingCount <= 0 && Number.isFinite(visibleUntilTs) && visibleUntilTs > nowTs) {
            const remainingMs = Math.max(250, Math.ceil((visibleUntilTs - nowTs) * 1000) + 100);
            if (nextRefreshMs === null || remainingMs < nextRefreshMs) {
                nextRefreshMs = remainingMs;
            }
        }
    });

    if (nextRefreshMs !== null) {
        _processingRefreshTimeout = setTimeout(() => {
            _processingRefreshTimeout = null;
            void loadNotifications();
        }, nextRefreshMs);
    }
}

function _updateNotifBadges() {
    const mergeBadge = document.getElementById('mergeBadge');
    const dupBadge = document.getElementById('dupBadge');
    const mergeBtn = document.getElementById('mergeNotifBtn');
    const dupBtn = document.getElementById('dupNotifBtn');
    const processingIndicator = document.getElementById('processingIndicator');
    const processingCount = document.getElementById('processingCount');
    const processingLabel = document.getElementById('processingLabel');

    if (mergeBadge) {
        if (_notifData.merge_count > 0) {
            mergeBadge.textContent = _notifData.merge_count;
            mergeBadge.style.display = 'flex';
            if (mergeBtn) mergeBtn.classList.add('has-items');
        } else {
            mergeBadge.style.display = 'none';
            if (mergeBtn) mergeBtn.classList.remove('has-items');
        }
    }
    if (dupBadge) {
        if (_notifData.duplicate_count > 0) {
            dupBadge.textContent = _notifData.duplicate_count;
            dupBadge.style.display = 'flex';
            if (dupBtn) dupBtn.classList.add('has-items');
        } else {
            dupBadge.style.display = 'none';
            if (dupBtn) dupBtn.classList.remove('has-items');
        }
    }

    if (processingIndicator && processingCount && processingLabel) {
        const processingTotal = parseMoneyValue(_notifData.processing_count);
        const activeProcessingTotal = Array.isArray(_notifData.processing_batches)
            ? _notifData.processing_batches.reduce((sum, batch) => sum + parseMoneyValue(batch.pending_count), 0)
            : processingTotal;
        if (activeProcessingTotal > 0) {
            processingIndicator.classList.remove('done');
            processingCount.textContent = activeProcessingTotal;
            const activeBatchCount = (_notifData.processing_batches || []).length;
            processingLabel.textContent = activeProcessingTotal === 1
                ? 'ticket processing'
                : 'tickets processing';
            processingIndicator.style.display = 'inline-flex';
            processingIndicator.title = activeBatchCount > 1
                ? `${activeProcessingTotal} tickets are being parsed across ${activeBatchCount} batches`
                : `${activeProcessingTotal} tickets are being parsed`;
        } else if (_processingIndicatorMode === 'done') {
            processingIndicator.classList.add('done');
            processingCount.textContent = '';
            processingLabel.textContent = 'Done processing';
            processingIndicator.style.display = 'inline-flex';
            processingIndicator.title = 'Done processing';
        } else {
            processingIndicator.classList.remove('done');
            processingIndicator.style.display = 'none';
            processingIndicator.title = '';
        }
    }
}

function toggleNotifPanel(type) {
    const panel = document.getElementById('notifPanel');
    if (!panel) return;

    if (_activeNotifPanel === type) {
        // Close if same panel
        panel.style.display = 'none';
        _activeNotifPanel = null;
        return;
    }

    _activeNotifPanel = type;
    panel.style.display = 'block';

    if (type === 'merge') {
        _renderMergePanel(panel);
    } else if (type === 'duplicate') {
        _renderDuplicatePanel(panel);
    }
}

function _closeNotifPanel() {
    const panel = document.getElementById('notifPanel');
    if (panel) panel.style.display = 'none';
    _activeNotifPanel = null;
}

function _renderMergePanel(panel) {
    const groups = _notifData.merge_groups || [];
    const pendingGroups = groups.filter(g => g.merged_ticket_count < g.ticket_count);

    if (!pendingGroups.length) {
        panel.innerHTML = `<div class="notif-panel">
            <div class="notif-panel-header">
                <h3>🔔 PNR Merge Requests</h3>
                <button class="close-btn" onclick="_closeNotifPanel()">✕</button>
            </div>
            <div class="empty-notif">
                <div style="font-size:2rem;margin-bottom:0.5rem;">✅</div>
                No pending merge requests
            </div>
        </div>`;
        return;
    }

    const cardsHtml = pendingGroups.map(group => {
        const discCount = Object.keys(group.discrepancies || {}).length;
        const statusBadge = group.can_auto_merge
            ? '<span style="background:rgba(16,185,129,0.12);color:#10b981;padding:0.15rem 0.45rem;border-radius:999px;font-size:0.7rem;font-weight:700;">Ready</span>'
            : `<span style="background:rgba(245,158,11,0.12);color:#f59e0b;padding:0.15rem 0.45rem;border-radius:999px;font-size:0.7rem;font-weight:700;">${discCount} issues</span>`;
        const paxBadge = group.has_different_passengers
            ? '<span style="background:rgba(16,185,129,0.12);color:#10b981;padding:0.15rem 0.45rem;border-radius:999px;font-size:0.7rem;font-weight:700;">Different pax</span>'
            : '<span style="background:rgba(239,68,68,0.12);color:#ef4444;padding:0.15rem 0.45rem;border-radius:999px;font-size:0.7rem;font-weight:700;">Same pax</span>';
        const paxNames = (group.normalized_passengers || []).join(', ') || 'Unknown';

        return `<div class="notif-card">
            <div class="notif-card-header">
                <div>
                    <div style="font-weight:800;font-size:0.95rem;">PNR ${group.pnr}</div>
                    <div style="font-size:0.78rem;color:var(--text-secondary);margin-top:0.15rem;">${group.ticket_count} tickets · ${paxNames}</div>
                </div>
                <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">${statusBadge}${paxBadge}</div>
            </div>
            <div class="notif-card-actions">
                <button class="notif-btn review" onclick='openPnrGroupDetail(${JSON.stringify(group).replace(/"/g, "&quot;")})'>🔍 Review</button>
                ${group.has_different_passengers ? (group.can_auto_merge
                    ? `<button class="notif-btn merge" onclick='mergePnrGroup("${group.pnr}", false, ${JSON.stringify(group.tickets.map(t => t.ticket_id)).replace(/"/g, "&quot;")})'>📦 Merge</button>`
                    : `<button class="notif-btn merge" style="background:linear-gradient(135deg,#d97706,#f59e0b);" onclick='mergePnrGroup("${group.pnr}", true, ${JSON.stringify(group.tickets.map(t => t.ticket_id)).replace(/"/g, "&quot;")})'>⚠️ Force Merge</button>`)
                : ''}
            </div>
        </div>`;
    }).join('');

    panel.innerHTML = `<div class="notif-panel">
        <div class="notif-panel-header">
            <h3>🔔 PNR Merge Requests <span style="font-size:0.8rem;font-weight:600;color:var(--text-secondary);">(${pendingGroups.length})</span></h3>
            <button class="close-btn" onclick="_closeNotifPanel()">✕</button>
        </div>
        <div style="max-height:50vh;overflow-y:auto;">${cardsHtml}</div>
    </div>`;
}

async function _renderDuplicatePanel(panel) {
    panel.innerHTML = `<div class="notif-panel">
        <div class="notif-panel-header">
            <h3>⚠️ Duplicate Tickets</h3>
            <button class="close-btn" onclick="_closeNotifPanel()">✕</button>
        </div>
        <div class="empty-notif">Loading duplicates...</div>
    </div>`;

    try {
        const r = await fetch('/api/tickets/duplicates');
        if (!r.ok) throw new Error('Failed to load');
        const data = await r.json();
        const dups = data.duplicates || [];

        if (!dups.length) {
            panel.innerHTML = `<div class="notif-panel">
                <div class="notif-panel-header">
                    <h3>⚠️ Duplicate Tickets</h3>
                    <button class="close-btn" onclick="_closeNotifPanel()">✕</button>
                </div>
                <div class="empty-notif">
                    <div style="font-size:2rem;margin-bottom:0.5rem;">✅</div>
                    No pending duplicate tickets
                </div>
            </div>`;
            return;
        }

        const cardsHtml = dups.map(dup => {
            const orig = dup.original_ticket;
            const dupNames = (dup.passenger_names || []).join(', ') || 'Unknown';
            const origNames = orig ? (orig.passenger_names || []).join(', ') || 'Unknown' : '—';
            const dupRoute = dup.route || '—';
            const origRoute = orig ? (orig.route || '—') : '—';

            const timeAgo = _timeAgo(dup.created_at);

            return `<div class="notif-card" id="dup-card-${dup.id}">
                <div class="notif-card-header">
                    <div>
                        <div style="font-weight:800;font-size:0.95rem;">PNR ${dup.pnr || '—'} <span style="font-size:0.76rem;font-weight:500;color:var(--text-secondary);">· ${timeAgo}</span></div>
                        <div style="font-size:0.78rem;color:var(--text-secondary);margin-top:0.15rem;">${dupRoute} · ${dupNames}</div>
                    </div>
                    <span style="background:rgba(245,158,11,0.12);color:#d97706;padding:0.15rem 0.45rem;border-radius:999px;font-size:0.7rem;font-weight:700;">Suspected Duplicate</span>
                </div>
                ${orig ? `<div class="dup-compare">
                    <div class="dup-side">
                        <div class="label">Original Ticket</div>
                        <div style="font-weight:700;">${origNames}</div>
                        <div style="color:var(--text-secondary);font-size:0.78rem;">${origRoute}</div>
                        <div style="color:var(--text-secondary);font-size:0.75rem;">${formatCurrency(orig.grand_total, orig.currency || 'INR')}</div>
                    </div>
                    <div class="vs">VS</div>
                    <div class="dup-side">
                        <div class="label">New (Duplicate)</div>
                        <div style="font-weight:700;">${dupNames}</div>
                        <div style="color:var(--text-secondary);font-size:0.78rem;">${dupRoute}</div>
                        <div style="color:var(--text-secondary);font-size:0.75rem;">${formatCurrency(dup.grand_total, dup.currency || 'INR')}</div>
                    </div>
                </div>` : ''}
                <div class="notif-card-actions">
                    <button class="notif-btn approve" onclick="approveDuplicate('${dup.id}')">✅ Approve & Add</button>
                    <button class="notif-btn reject" onclick="rejectDuplicate('${dup.id}')">🗑️ Reject</button>
                </div>
            </div>`;
        }).join('');

        panel.innerHTML = `<div class="notif-panel">
            <div class="notif-panel-header">
                <h3>⚠️ Duplicate Tickets <span style="font-size:0.8rem;font-weight:600;color:var(--text-secondary);">(${dups.length})</span></h3>
                <button class="close-btn" onclick="_closeNotifPanel()">✕</button>
            </div>
            <div style="max-height:50vh;overflow-y:auto;">${cardsHtml}</div>
        </div>`;
    } catch (e) {
        console.error(e);
        panel.innerHTML = `<div class="notif-panel">
            <div class="notif-panel-header">
                <h3>⚠️ Duplicate Tickets</h3>
                <button class="close-btn" onclick="_closeNotifPanel()">✕</button>
            </div>
            <div class="empty-notif">Failed to load duplicates</div>
        </div>`;
    }
}

function _timeAgo(isoDate) {
    if (!isoDate) return '';
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

function _getSelectedPnrReviewTicketIds(pnr) {
    const checked = Array.from(document.querySelectorAll(`.pnr-review-checkbox[data-pnr="${pnr}"]:checked`));
    return checked.map(node => node.value).filter(Boolean);
}

function togglePnrReviewSelection(pnr, checked) {
    document.querySelectorAll(`.pnr-review-checkbox[data-pnr="${pnr}"]`).forEach(node => {
        node.checked = !!checked;
    });
}

async function approveDuplicate(ticketId) {
    try {
        const r = await fetch(`/api/tickets/${ticketId}/approve-duplicate`, { method: 'POST' });
        const data = await r.json();
        if (!r.ok) { showToast(data.error || 'Failed', 'error'); return; }
        showToast('Ticket approved and added to dashboard', 'success');
        duplicatePanelTickets = duplicatePanelTickets.filter((dup) => dup.id !== ticketId);
        duplicatePanelTotalCount = Math.max(0, duplicatePanelTotalCount - 1);
        // Remove the card with animation
        const card = document.getElementById('dup-card-' + ticketId);
        if (card) {
            card.style.transition = 'all 0.3s ease';
            card.style.opacity = '0';
            card.style.transform = 'translateX(30px)';
            setTimeout(() => card.remove(), 300);
        }
        await loadNotifications();
        await loadTickets({ limit: INITIAL_TICKETS_BATCH_SIZE });
        if (_activeNotifPanel === 'duplicate') {
            _renderDuplicatePanelLayout(document.getElementById('notifPanel'));
            if (duplicatePanelTickets.length < duplicatePanelTotalCount) {
                void loadMoreDuplicateTickets();
            }
        }
    } catch (e) { showToast('Network error', 'error'); }
}

async function rejectDuplicate(ticketId) {
    if (!confirm('Reject this duplicate? It will be hidden permanently.')) return;
    try {
        const r = await fetch(`/api/tickets/${ticketId}/reject-duplicate`, { method: 'POST' });
        const data = await r.json();
        if (!r.ok) { showToast(data.error || 'Failed', 'error'); return; }
        showToast('Duplicate rejected and hidden', 'info');
        duplicatePanelTickets = duplicatePanelTickets.filter((dup) => dup.id !== ticketId);
        duplicatePanelTotalCount = Math.max(0, duplicatePanelTotalCount - 1);
        const card = document.getElementById('dup-card-' + ticketId);
        if (card) {
            card.style.transition = 'all 0.3s ease';
            card.style.opacity = '0';
            card.style.transform = 'translateX(30px)';
            setTimeout(() => card.remove(), 300);
        }
        await loadNotifications();
        if (_activeNotifPanel === 'duplicate') {
            _renderDuplicatePanelLayout(document.getElementById('notifPanel'));
            if (duplicatePanelTickets.length < duplicatePanelTotalCount) {
                void loadMoreDuplicateTickets();
            }
        }
    } catch (e) { showToast('Network error', 'error'); }
}

function _getSelectedDuplicateIds() {
    return Array.from(document.querySelectorAll('.duplicate-review-checkbox:checked'))
        .map(node => node.value)
        .filter(Boolean);
}

function toggleDuplicateSelection(checked) {
    document.querySelectorAll('.duplicate-review-checkbox').forEach(node => {
        node.checked = !!checked;
    });
}

async function approveSelectedDuplicates() {
    const ticketIds = _getSelectedDuplicateIds();
    if (ticketIds.length === 0) {
        showToast('Select at least one duplicate ticket', 'error');
        return;
    }
    try {
        for (const ticketId of ticketIds) {
            const r = await fetch(`/api/tickets/${ticketId}/approve-duplicate`, { method: 'POST' });
            const data = await r.json();
            if (!r.ok) {
                showToast(data.error || 'Failed to approve duplicates', 'error');
                return;
            }
        }
        showToast(`Approved ${ticketIds.length} duplicate ticket${ticketIds.length > 1 ? 's' : ''}`, 'success');
        await loadNotifications();
        await loadTickets();
        if (_activeNotifPanel === 'duplicate') {
            _renderDuplicatePanel(document.getElementById('notifPanel'));
        }
    } catch (e) {
        console.error(e);
        showToast('Network error', 'error');
    }
}

async function rejectSelectedDuplicates() {
    const ticketIds = _getSelectedDuplicateIds();
    if (ticketIds.length === 0) {
        showToast('Select at least one duplicate ticket', 'error');
        return;
    }
    if (!confirm(`Reject ${ticketIds.length} selected duplicate ticket${ticketIds.length > 1 ? 's' : ''}?`)) return;
    try {
        for (const ticketId of ticketIds) {
            const r = await fetch(`/api/tickets/${ticketId}/reject-duplicate`, { method: 'POST' });
            const data = await r.json();
            if (!r.ok) {
                showToast(data.error || 'Failed to reject duplicates', 'error');
                return;
            }
        }
        showToast(`Rejected ${ticketIds.length} duplicate ticket${ticketIds.length > 1 ? 's' : ''}`, 'info');
        await loadNotifications();
        if (_activeNotifPanel === 'duplicate') {
            _renderDuplicatePanel(document.getElementById('notifPanel'));
        }
    } catch (e) {
        console.error(e);
        showToast('Network error', 'error');
    }
}

async function _renderDuplicatePanel(panel) {
    panel.innerHTML = `<div class="notif-panel">
        <div class="notif-panel-header">
            <h3>⚠️ Duplicate Tickets</h3>
            <button class="close-btn" onclick="_closeNotifPanel()">✕</button>
        </div>
        <div class="empty-notif">Loading duplicates...</div>
    </div>`;

    try {
        const r = await fetch('/api/tickets/duplicates');
        if (!r.ok) throw new Error('Failed to load');
        const data = await r.json();
        const dups = data.duplicates || [];

        if (!dups.length) {
            panel.innerHTML = `<div class="notif-panel">
                <div class="notif-panel-header">
                    <h3>⚠️ Duplicate Tickets</h3>
                    <button class="close-btn" onclick="_closeNotifPanel()">✕</button>
                </div>
                <div class="empty-notif">
                    <div style="font-size:2rem;margin-bottom:0.5rem;">✅</div>
                    No pending duplicate tickets
                </div>
            </div>`;
            return;
        }

        const cardsHtml = dups.map(dup => {
            const orig = dup.original_ticket;
            const dupNames = (dup.passenger_names || []).join(', ') || 'Unknown';
            const origNames = orig ? (orig.passenger_names || []).join(', ') || 'Unknown' : '—';
            const dupRoute = dup.route || '—';
            const origRoute = orig ? (orig.route || '—') : '—';
            const timeAgo = _timeAgo(dup.created_at);

            return `<div class="notif-card" id="dup-card-${dup.id}">
                <div class="notif-card-header">
                    <div style="display:flex;gap:0.8rem;align-items:flex-start;">
                        <label style="display:flex;align-items:center;margin-top:0.2rem;">
                            <input type="checkbox" class="duplicate-review-checkbox" value="${dup.id}" checked>
                        </label>
                        <div>
                            <div style="font-weight:800;font-size:0.95rem;">PNR ${dup.pnr || '—'} <span style="font-size:0.76rem;font-weight:500;color:var(--text-secondary);">· ${timeAgo}</span></div>
                            <div style="font-size:0.78rem;color:var(--text-secondary);margin-top:0.15rem;">${dupRoute} · ${dupNames}</div>
                        </div>
                    </div>
                    <span style="background:rgba(245,158,11,0.12);color:#d97706;padding:0.15rem 0.45rem;border-radius:999px;font-size:0.7rem;font-weight:700;">Suspected Duplicate</span>
                </div>
                ${orig ? `<div class="dup-compare">
                    <div class="dup-side">
                        <div class="label">Original Ticket</div>
                        <div style="font-weight:700;">${origNames}</div>
                        <div style="color:var(--text-secondary);font-size:0.78rem;">${origRoute}</div>
                        <div style="color:var(--text-secondary);font-size:0.75rem;">${formatCurrency(orig.grand_total, orig.currency || 'INR')}</div>
                    </div>
                    <div class="vs">VS</div>
                    <div class="dup-side">
                        <div class="label">New (Duplicate)</div>
                        <div style="font-weight:700;">${dupNames}</div>
                        <div style="color:var(--text-secondary);font-size:0.78rem;">${dupRoute}</div>
                        <div style="color:var(--text-secondary);font-size:0.75rem;">${formatCurrency(dup.grand_total, dup.currency || 'INR')}</div>
                    </div>
                </div>` : ''}
                <div class="notif-card-actions">
                    <button class="notif-btn approve" onclick="approveDuplicate('${dup.id}')">✅ Approve & Add</button>
                    <button class="notif-btn reject" onclick="rejectDuplicate('${dup.id}')">🗑️ Reject</button>
                </div>
            </div>`;
        }).join('');

        panel.innerHTML = `<div class="notif-panel">
            <div class="notif-panel-header">
                <h3>⚠️ Duplicate Tickets <span style="font-size:0.8rem;font-weight:600;color:var(--text-secondary);">(${dups.length})</span></h3>
                <button class="close-btn" onclick="_closeNotifPanel()">✕</button>
            </div>
            <div style="display:flex;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;align-items:center;margin-bottom:0.85rem;padding:0.85rem 1rem;border-radius:12px;border:1px solid var(--border);background:var(--bg-main);">
                <div style="font-size:0.84rem;color:var(--text-secondary);font-weight:600;">Select duplicate tickets to approve into the dashboard or reject.</div>
                <div style="display:flex;gap:0.55rem;flex-wrap:wrap;">
                    <button class="btn-action secondary" onclick="toggleDuplicateSelection(true)">Select All</button>
                    <button class="btn-action secondary" onclick="toggleDuplicateSelection(false)">Clear</button>
                    <button class="btn-action secondary" style="border-color:rgba(239,68,68,0.35);color:#dc2626;" onclick="rejectSelectedDuplicates()">Reject Selected</button>
                    <button class="btn-action primary" onclick="approveSelectedDuplicates()">Approve Selected</button>
                </div>
            </div>
            <div style="max-height:50vh;overflow-y:auto;">${cardsHtml}</div>
        </div>`;
    } catch (e) {
        console.error(e);
        panel.innerHTML = `<div class="notif-panel">
            <div class="notif-panel-header">
                <h3>⚠️ Duplicate Tickets</h3>
                <button class="close-btn" onclick="_closeNotifPanel()">✕</button>
            </div>
            <div class="empty-notif">Failed to load duplicates</div>
        </div>`;
    }
}

function _renderDuplicateCardsHtmlV2(dups) {
    return dups.map((dup) => {
        const orig = dup.original_ticket;
        const dupNames = (dup.passenger_names || []).join(', ') || 'Unknown';
        const origNames = orig ? (orig.passenger_names || []).join(', ') || 'Unknown' : '-';
        const dupRoute = dup.route || '-';
        const origRoute = orig ? (orig.route || '-') : '-';
        const timeAgo = _timeAgo(dup.created_at);

        return `<div class="notif-card" id="dup-card-${dup.id}">
            <div class="notif-card-header">
                <div style="display:flex;gap:0.8rem;align-items:flex-start;">
                    <label style="display:flex;align-items:center;margin-top:0.2rem;">
                        <input type="checkbox" class="duplicate-review-checkbox" value="${dup.id}" checked>
                    </label>
                    <div>
                        <div style="font-weight:800;font-size:0.95rem;">PNR ${dup.pnr || '-'} <span style="font-size:0.76rem;font-weight:500;color:var(--text-secondary);">· ${timeAgo}</span></div>
                        <div style="font-size:0.78rem;color:var(--text-secondary);margin-top:0.15rem;">${dupRoute} · ${dupNames}</div>
                    </div>
                </div>
                <span style="background:rgba(245,158,11,0.12);color:#d97706;padding:0.15rem 0.45rem;border-radius:999px;font-size:0.7rem;font-weight:700;">Suspected Duplicate</span>
            </div>
            ${orig ? `<div class="dup-compare">
                <div class="dup-side">
                    <div class="label">Original Ticket</div>
                    <div style="font-weight:700;">${origNames}</div>
                    <div style="color:var(--text-secondary);font-size:0.78rem;">${origRoute}</div>
                    <div style="color:var(--text-secondary);font-size:0.75rem;">${formatCurrency(orig.grand_total, orig.currency || 'INR')}</div>
                </div>
                <div class="vs">VS</div>
                <div class="dup-side">
                    <div class="label">New (Duplicate)</div>
                    <div style="font-weight:700;">${dupNames}</div>
                    <div style="color:var(--text-secondary);font-size:0.78rem;">${dupRoute}</div>
                    <div style="color:var(--text-secondary);font-size:0.75rem;">${formatCurrency(dup.grand_total, dup.currency || 'INR')}</div>
                </div>
            </div>` : ''}
            <div class="notif-card-actions">
                <button class="notif-btn approve" onclick="approveDuplicate('${dup.id}')">Approve & Add</button>
                <button class="notif-btn reject" onclick="rejectDuplicate('${dup.id}')">Reject</button>
            </div>
        </div>`;
    }).join('');
}

function _renderDuplicatePanelLayout(panel) {
    if (!duplicatePanelTickets.length) {
        panel.innerHTML = `<div class="notif-panel">
            <div class="notif-panel-header">
                <h3>Duplicate Tickets</h3>
                <button class="close-btn" onclick="_closeNotifPanel()">×</button>
            </div>
            <div class="empty-notif">
                <div style="font-size:2rem;margin-bottom:0.5rem;">✓</div>
                No pending duplicate tickets
            </div>
        </div>`;
        return;
    }

    panel.innerHTML = `<div class="notif-panel">
        <div class="notif-panel-header">
            <h3>Duplicate Tickets <span id="duplicatePanelTotal" style="font-size:0.8rem;font-weight:600;color:var(--text-secondary);">(${duplicatePanelTotalCount})</span></h3>
            <button class="close-btn" onclick="_closeNotifPanel()">×</button>
        </div>
        <div style="display:flex;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;align-items:center;margin-bottom:0.85rem;padding:0.85rem 1rem;border-radius:12px;border:1px solid var(--border);background:var(--bg-main);">
            <div id="duplicatePanelSummary" style="font-size:0.84rem;color:var(--text-secondary);font-weight:600;">Showing ${duplicatePanelTickets.length} of ${duplicatePanelTotalCount} duplicate tickets.</div>
            <div style="display:flex;gap:0.55rem;flex-wrap:wrap;">
                <button class="btn-action secondary" onclick="toggleDuplicateSelection(true)">Select All</button>
                <button class="btn-action secondary" onclick="toggleDuplicateSelection(false)">Clear</button>
                <button class="btn-action secondary" style="border-color:rgba(239,68,68,0.35);color:#dc2626;" onclick="rejectSelectedDuplicates()">Reject Selected</button>
                <button class="btn-action primary" onclick="approveSelectedDuplicates()">Approve Selected</button>
            </div>
        </div>
        <div id="duplicateListBody" style="max-height:50vh;overflow-y:auto;">${_renderDuplicateCardsHtmlV2(duplicatePanelTickets)}</div>
    </div>`;
}

function _updateDuplicatePanelMeta() {
    const totalEl = document.getElementById('duplicatePanelTotal');
    if (totalEl) totalEl.textContent = `(${duplicatePanelTotalCount})`;
    const summaryEl = document.getElementById('duplicatePanelSummary');
    if (summaryEl) summaryEl.textContent = `Showing ${duplicatePanelTickets.length} of ${duplicatePanelTotalCount} duplicate tickets.`;
}

async function loadDuplicateTicketsPage(offset = 0) {
    const params = new URLSearchParams({
        limit: String(DUPLICATES_BATCH_SIZE),
        offset: String(offset)
    });
    const r = await fetch(`/api/tickets/duplicates?${params.toString()}`);
    if (!r.ok) throw new Error('Failed to load duplicates');
    return r.json();
}

async function loadMoreDuplicateTickets() {
    if (duplicatePanelIsLoadingMore || duplicatePanelTickets.length >= duplicatePanelTotalCount) return;
    duplicatePanelIsLoadingMore = true;
    try {
        while (_activeNotifPanel === 'duplicate' && duplicatePanelTickets.length < duplicatePanelTotalCount) {
            const previousCount = duplicatePanelTickets.length;
            const data = await loadDuplicateTicketsPage(duplicatePanelTickets.length);
            duplicatePanelTickets = mergeTicketLists(duplicatePanelTickets, data.duplicates || []);
            duplicatePanelTotalCount = Number(data.total_count || duplicatePanelTickets.length);
            writeCachedJson(DUPLICATES_CACHE_KEY, {
                cached_at: Date.now(),
                total_count: duplicatePanelTotalCount,
                duplicates: duplicatePanelTickets.slice(0, DUPLICATES_BATCH_SIZE)
            });
            const panel = document.getElementById('notifPanel');
            if (panel && _activeNotifPanel === 'duplicate') {
                const body = document.getElementById('duplicateListBody');
                if (body && previousCount > 0) {
                    const newItems = duplicatePanelTickets.slice(previousCount);
                    if (newItems.length) {
                        body.insertAdjacentHTML('beforeend', _renderDuplicateCardsHtmlV2(newItems));
                    }
                    _updateDuplicatePanelMeta();
                } else {
                    _renderDuplicatePanelLayout(panel);
                }
            } else {
                break;
            }
        }
    } catch (e) {
        console.error(e);
        showToast('Failed to load more duplicates', 'error');
    } finally {
        duplicatePanelIsLoadingMore = false;
    }
}

async function _renderDuplicatePanel(panel) {
    const cachedDuplicates = readCachedJson(DUPLICATES_CACHE_KEY);
    duplicatePanelTickets = Array.isArray(cachedDuplicates?.duplicates)
        ? cachedDuplicates.duplicates.map(normalizeTicketFareData)
        : [];
    duplicatePanelTotalCount = Number(cachedDuplicates?.total_count || duplicatePanelTickets.length || 0);
    duplicatePanelIsLoadingMore = false;
    if (duplicatePanelTickets.length) {
        _renderDuplicatePanelLayout(panel);
    } else {
        panel.innerHTML = `<div class="notif-panel">
            <div class="notif-panel-header">
                <h3>Duplicate Tickets</h3>
                <button class="close-btn" onclick="_closeNotifPanel()">×</button>
            </div>
            <div class="empty-notif">Loading recent duplicates...</div>
        </div>`;
    }

    try {
        const data = await loadDuplicateTicketsPage(0);
        duplicatePanelTickets = data.duplicates || [];
        duplicatePanelTotalCount = Number(data.total_count || duplicatePanelTickets.length);
        writeCachedJson(DUPLICATES_CACHE_KEY, {
            cached_at: Date.now(),
            total_count: duplicatePanelTotalCount,
            duplicates: duplicatePanelTickets.slice(0, DUPLICATES_BATCH_SIZE)
        });
        _renderDuplicatePanelLayout(panel);
        if (data.has_more) {
            void loadMoreDuplicateTickets();
        }
    } catch (e) {
        console.error(e);
        panel.innerHTML = `<div class="notif-panel">
            <div class="notif-panel-header">
                <h3>Duplicate Tickets</h3>
                <button class="close-btn" onclick="_closeNotifPanel()">×</button>
            </div>
            <div class="empty-notif">Failed to load duplicates</div>
        </div>`;
    }
}

function openPnrGroupDetail(group) {
    const compareFields = [
        ['airline', 'Airline'],
        ['route', 'Route'],
        ['flight_numbers', 'Flight Numbers'],
        ['departure_airport', 'Departure Airport'],
        ['arrival_airport', 'Arrival Airport'],
        ['departure_datetime', 'Departure Time'],
        ['arrival_datetime', 'Arrival Time']
    ];

    const discrepancyKeys = new Set(Object.keys(group.discrepancies || {}));
    const fieldSummaryHtml = compareFields.map(([key, label]) => {
        const mismatched = discrepancyKeys.has(key);
        return `<div style="padding:0.75rem;border-radius:12px;border:1px solid ${mismatched ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.25)'};background:${mismatched ? 'rgba(245,158,11,0.06)' : 'rgba(16,185,129,0.06)'};">
            <div style="font-size:0.76rem;color:var(--text-secondary);text-transform:uppercase;font-weight:700;">${label}</div>
            <div style="margin-top:0.3rem;font-weight:700;color:${mismatched ? '#d97706' : '#059669'};">${mismatched ? 'Mismatch detected' : 'All tickets match'}</div>
        </div>`;
    }).join('');

    const ticketsHtml = (group.tickets || []).map(ticket => {
        const rows = compareFields.map(([key, label]) => {
            const mismatched = discrepancyKeys.has(key);
            return `<tr>
                <td style="padding:0.45rem 0.5rem;font-size:0.82rem;color:var(--text-secondary);">${label}</td>
                <td style="padding:0.45rem 0.5rem;font-size:0.82rem;font-weight:600;color:${mismatched ? '#d97706' : 'var(--text-primary)'};">${ticket[key] || '—'}</td>
            </tr>`;
        }).join('');
        return `<div style="padding:1rem;border:1px solid var(--border);border-radius:14px;background:var(--bg-main);">
            <div style="display:flex;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;align-items:flex-start;">
                <div>
                    <div style="font-weight:800;">${(ticket.passenger_names || []).join(', ') || 'Passenger'}</div>
                    <div style="font-size:0.76rem;color:var(--text-secondary);margin-top:0.2rem;">${(ticket.system_ticket_numbers || []).join(', ') || 'No system ID'} | Ticket ${ticket.ticket_id}</div>
                </div>
                ${ticket.booking_group_id ? '<span style="background:rgba(37,99,235,0.12);color:var(--primary);padding:0.2rem 0.55rem;border-radius:999px;font-size:0.72rem;font-weight:700;">Already linked</span>' : ''}
            </div>
            <table style="width:100%;margin-top:0.85rem;border-collapse:collapse;">${rows}</table>
        </div>`;
    }).join('');

    const warningHtml = group.can_auto_merge
        ? '<div style="padding:0.85rem 1rem;border-radius:12px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);color:#059669;font-weight:700;">All compared booking fields match. This group can be merged safely.</div>'
        : group.has_different_passengers
            ? '<div style="padding:0.85rem 1rem;border-radius:12px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);color:#b45309;font-weight:700;">Discrepancies were detected. Review carefully before forcing a merge.</div>'
            : '<div style="padding:0.85rem 1rem;border-radius:12px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);color:#b91c1c;font-weight:700;">These tickets appear to belong to the same passenger after ignoring title prefixes and letter case, so they should not be merged.</div>';

    const html = `<h3 style="margin-top:0;">PNR ${group.pnr}</h3>
        ${warningHtml}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0.75rem;margin-top:1rem;">${fieldSummaryHtml}</div>
        <div style="display:grid;gap:0.85rem;max-height:45vh;overflow:auto;margin-top:1rem;">${ticketsHtml}</div>
        <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:1.25rem;">
            <button class="btn-action secondary" onclick="_closeModal()">Close</button>
            ${group.has_different_passengers
                ? (group.can_auto_merge
                    ? `<button class="btn-action primary" onclick='mergePnrGroup("${group.pnr}", false, ${JSON.stringify(group.tickets.map(t => t.ticket_id)).replace(/"/g, '&quot;')})'>Merge Booking</button>`
                    : `<button class="btn-action primary" style="background:linear-gradient(135deg,#d97706,#f59e0b);" onclick='mergePnrGroup("${group.pnr}", true, ${JSON.stringify(group.tickets.map(t => t.ticket_id)).replace(/"/g, '&quot;')})'>Merge Anyway</button>`)
                : ''}
        </div>`;
    _createModalOverlay(html);
}

async function mergePnrGroup(pnr, forceMerge, ticketIds) {
    try {
        const r = await fetch(`/api/tickets/pnr-groups/${encodeURIComponent(pnr)}/merge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force_merge: forceMerge, ticket_ids: ticketIds })
        });
        const result = await r.json();
        if (!r.ok) {
            showToast(result.error || 'Merge failed', 'error');
            return;
        }
        showToast(result.message || 'Booking merged', 'success');
        _closeModal();
        _closeNotifPanel();
        await loadNotifications();
        await loadTickets();
    } catch (e) {
        console.error(e);
        showToast('Merge failed', 'error');
    }
}

function mergeSelectedPnrTickets(pnr, forceMerge, fallbackTicketIds) {
    const ticketIds = _getSelectedPnrReviewTicketIds(pnr);
    mergePnrGroup(pnr, forceMerge, ticketIds.length ? ticketIds : (fallbackTicketIds || []));
}

async function deleteSelectedPnrTickets(pnr) {
    const ticketIds = _getSelectedPnrReviewTicketIds(pnr);
    if (ticketIds.length === 0) {
        showToast('Select at least one ticket to delete', 'error');
        return;
    }
    if (!confirm(`Delete ${ticketIds.length} selected ticket${ticketIds.length > 1 ? 's' : ''} from PNR ${pnr}?`)) return;
    try {
        const r = await fetch(`/api/tickets/pnr-groups/${encodeURIComponent(pnr)}/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticket_ids: ticketIds })
        });
        const result = await r.json();
        if (!r.ok) {
            showToast(result.error || 'Delete failed', 'error');
            return;
        }
        showToast(result.message || 'Selected tickets deleted', 'success');
        _closeModal();
        _closeNotifPanel();
        await loadNotifications();
        await loadTickets();
    } catch (e) {
        console.error(e);
        showToast('Delete failed', 'error');
    }
}

function openPnrGroupDetail(group) {
    const compareFields = [
        ['airline', 'Airline'],
        ['route', 'Route'],
        ['flight_numbers', 'Flight Numbers'],
        ['departure_airport', 'Departure Airport'],
        ['arrival_airport', 'Arrival Airport'],
        ['departure_datetime', 'Departure Time'],
        ['arrival_datetime', 'Arrival Time']
    ];

    const discrepancyKeys = new Set(Object.keys(group.discrepancies || {}));
    const allTicketIds = (group.tickets || []).map(t => t.ticket_id);
    const encodedAllTicketIds = JSON.stringify(allTicketIds).replace(/"/g, '&quot;');

    const fieldSummaryHtml = compareFields.map(([key, label]) => {
        const mismatched = discrepancyKeys.has(key);
        return `<div style="padding:0.75rem;border-radius:12px;border:1px solid ${mismatched ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.25)'};background:${mismatched ? 'rgba(245,158,11,0.06)' : 'rgba(16,185,129,0.06)'};">
            <div style="font-size:0.76rem;color:var(--text-secondary);text-transform:uppercase;font-weight:700;">${label}</div>
            <div style="margin-top:0.3rem;font-weight:700;color:${mismatched ? '#d97706' : '#059669'};">${mismatched ? 'Mismatch detected' : 'All tickets match'}</div>
        </div>`;
    }).join('');

    const ticketsHtml = (group.tickets || []).map(ticket => {
        const rows = compareFields.map(([key, label]) => {
            const mismatched = discrepancyKeys.has(key);
            return `<tr>
                <td style="padding:0.45rem 0.5rem;font-size:0.82rem;color:var(--text-secondary);">${label}</td>
                <td style="padding:0.45rem 0.5rem;font-size:0.82rem;font-weight:600;color:${mismatched ? '#d97706' : 'var(--text-primary)'};">${ticket[key] || '—'}</td>
            </tr>`;
        }).join('');
        return `<div style="padding:1rem;border:1px solid var(--border);border-radius:14px;background:var(--bg-main);">
            <div style="display:flex;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;align-items:flex-start;">
                <div style="display:flex;gap:0.8rem;align-items:flex-start;">
                    <label style="display:flex;align-items:center;margin-top:0.15rem;">
                        <input type="checkbox" class="pnr-review-checkbox" data-pnr="${group.pnr}" value="${ticket.ticket_id}" checked>
                    </label>
                    <div>
                        <div style="font-weight:800;">${(ticket.passenger_names || []).join(', ') || 'Passenger'}</div>
                        <div style="font-size:0.76rem;color:var(--text-secondary);margin-top:0.2rem;">${(ticket.system_ticket_numbers || []).join(', ') || 'No system ID'} | Ticket ${ticket.ticket_id}</div>
                    </div>
                </div>
                ${ticket.booking_group_id ? '<span style="background:rgba(37,99,235,0.12);color:var(--primary);padding:0.2rem 0.55rem;border-radius:999px;font-size:0.72rem;font-weight:700;">Already linked</span>' : ''}
            </div>
            <table style="width:100%;margin-top:0.85rem;border-collapse:collapse;">${rows}</table>
        </div>`;
    }).join('');

    const warningHtml = group.can_auto_merge
        ? '<div style="padding:0.85rem 1rem;border-radius:12px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);color:#059669;font-weight:700;">All compared booking fields match. This group can be merged safely.</div>'
        : group.has_different_passengers
            ? '<div style="padding:0.85rem 1rem;border-radius:12px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);color:#b45309;font-weight:700;">Discrepancies were detected. Review carefully before forcing a merge.</div>'
            : '<div style="padding:0.85rem 1rem;border-radius:12px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);color:#b91c1c;font-weight:700;">These tickets appear to belong to the same passenger after ignoring title prefixes and letter case, so they should not be merged.</div>';

    const html = `<h3 style="margin-top:0;">PNR ${group.pnr}</h3>
        ${warningHtml}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0.75rem;margin-top:1rem;">${fieldSummaryHtml}</div>
        <div style="display:flex;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;align-items:center;margin-top:1rem;padding:0.85rem 1rem;border-radius:12px;border:1px solid var(--border);background:var(--bg-main);">
            <div style="font-size:0.84rem;color:var(--text-secondary);font-weight:600;">Select the tickets you want to merge or delete from this PNR group.</div>
            <div style="display:flex;gap:0.55rem;flex-wrap:wrap;">
                <button class="btn-action secondary" onclick="togglePnrReviewSelection('${group.pnr}', true)">Select All</button>
                <button class="btn-action secondary" onclick="togglePnrReviewSelection('${group.pnr}', false)">Clear</button>
            </div>
        </div>
        <div style="display:grid;gap:0.85rem;max-height:45vh;overflow:auto;margin-top:1rem;">${ticketsHtml}</div>
        <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:1.25rem;">
            <button class="btn-action secondary" onclick="_closeModal()">Close</button>
            <button class="btn-action secondary" style="border-color:rgba(239,68,68,0.35);color:#dc2626;" onclick='deleteSelectedPnrTickets("${group.pnr}")'>Delete Selected</button>
            ${group.has_different_passengers
                ? (group.can_auto_merge
                    ? `<button class="btn-action primary" onclick='mergeSelectedPnrTickets("${group.pnr}", false, ${encodedAllTicketIds})'>Merge Selected</button>`
                    : `<button class="btn-action primary" style="background:linear-gradient(135deg,#d97706,#f59e0b);" onclick='mergeSelectedPnrTickets("${group.pnr}", true, ${encodedAllTicketIds})'>Merge Selected Anyway</button>`)
                : ''}
        </div>`;
    _createModalOverlay(html);
}

function renderActionsSection() {
    const tStatus = editedData.ticket_status || 'live';
    const isCancelled = tStatus === 'cancelled';
    const isMergedView = !!editedData.is_merged_view;

    document.getElementById('actionsSection').innerHTML = `
        <div class="section-header-row"><h2>⚡ Actions</h2></div>
                <div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:center;">
                    <div class="pdf-btn-group">
                        <button class="pdf-btn with-fare" onclick="downloadPDF(true)">📄 PDF (With Fare)</button>
                        <button class="pdf-btn without-fare" onclick="downloadPDF(false)">📄 PDF (Without Fare)</button>
                    </div>
                    <div style="display:flex; align-items:center; gap:0.5rem; background:var(--bg-main); padding:0.5rem 1rem; border-radius:12px; border:1px solid var(--border);">
                        <span style="font-size:0.75rem; color:var(--text-secondary); font-weight:700; text-transform:uppercase;">Sheet Export:</span>
                        <button class="pdf-btn" style="background: #10b981; color:white; padding: 0.5rem 0.8rem;" onclick="exportToSheet('AB')">📊 AB</button>
                        <button class="pdf-btn" style="background: #6366f1; color:white; padding: 0.5rem 0.8rem;" onclick="exportToSheet('CK')">📊 CK</button>
                    </div>
                    ${!editedData.ledger_hash ? `
                    <div id="ledgerBtnGroup" style="display:flex; align-items:center; gap:0.5rem; background:var(--bg-main); padding:0.5rem 1rem; border-radius:12px; border:1px solid var(--border);">
                        <span style="font-size:0.75rem; color:var(--text-secondary); font-weight:700; text-transform:uppercase;">Add to Ledger:</span>
                        <select id="ledgerAggSelect" style="padding:0.35rem 0.5rem; border-radius:8px; border:1px solid var(--border); font-family:inherit; font-size:0.82rem; background:var(--bg-card); color:var(--text-primary);">
                            <option value="">Loading...</option>
                        </select>
                        <button class="pdf-btn" style="background: #10b981; color:white; padding: 0.5rem 0.8rem;" onclick="addToLedger('AB')">📒 AB</button>
                        <button class="pdf-btn" style="background: #6366f1; color:white; padding: 0.5rem 0.8rem;" onclick="addToLedger('CK')">📒 CK</button>
                    </div>` : `
                    <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(16,185,129,0.08); padding:0.6rem 1.2rem; border-radius:12px; border:1px solid rgba(16,185,129,0.2);">
                        <span style="font-weight:700; color:#10b981;">✅ In Ledger</span>
                    </div>`}
                    ${!isCancelled ? `
                    <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(239,68,68,0.05); padding:0.5rem 1rem; border-radius:12px; border:1px solid rgba(239,68,68,0.2);">
                        <button class="pdf-btn" style="background:linear-gradient(135deg,#dc2626,#ef4444); color:white; padding:0.5rem 1rem;" onclick="openCancelModal()">❌ Cancel / Split</button>
                        <button class="pdf-btn" style="background:linear-gradient(135deg,#d97706,#f59e0b); color:white; padding:0.5rem 1rem;" onclick="openChangeModal()">🔄 Change</button>
                    </div>` : `
                    <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(239,68,68,0.08); padding:0.6rem 1.2rem; border-radius:12px; border:1px dashed rgba(239,68,68,0.3);">
                        <span style="font-weight:700; color:#ef4444;">🔴 This ticket is cancelled</span>
                    </div>`}
                    ${isMergedView ? `
                    <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(5,150,105,0.08); padding:0.6rem 1.2rem; border-radius:12px; border:1px solid rgba(5,150,105,0.2);">
                        <span style="font-weight:700; color:#059669;">Merged booking view. These actions apply to the grouped booking shown here.</span>
                    </div>` : ''}
                </div>`;
    loadLedgerAggregators();
}

// ==================== MERGED HISTORY TAB ====================
function switchToMergedView(btn) {
    document.querySelectorAll('.filter-bar .tab').forEach(t => t.classList.remove('active'));
    if (btn) btn.classList.add('active');
    _mergedViewActive = true;
    currentFilter = 'all';
    renderTicketCards();
}

// Keep openPnrMergeModal as backward-compatible alias
async function openPnrMergeModal() {
    toggleNotifPanel('merge');
}

function renderActionsSection() {
    const tStatus = editedData.ticket_status || 'live';
    const isCancelled = tStatus === 'cancelled';
    const isMergedView = !!editedData.is_merged_view;

    document.getElementById('actionsSection').innerHTML = `
        <div class="section-header-row"><h2>⚡ Actions</h2></div>
                <div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:center;">
                    <div class="pdf-btn-group">
                        <button class="pdf-btn with-fare" onclick="downloadPDF(true)">📄 PDF (With Fare)</button>
                        <button class="pdf-btn without-fare" onclick="downloadPDF(false)">📄 PDF (Without Fare)</button>
                    </div>
                    <div style="display:flex; align-items:center; gap:0.5rem; background:var(--bg-main); padding:0.5rem 1rem; border-radius:12px; border:1px solid var(--border);">
                        <span style="font-size:0.75rem; color:var(--text-secondary); font-weight:700; text-transform:uppercase;">Sheet Export:</span>
                        <button class="pdf-btn" style="background: #10b981; color:white; padding: 0.5rem 0.8rem;" onclick="exportToSheet('AB')">📊 AB</button>
                        <button class="pdf-btn" style="background: #6366f1; color:white; padding: 0.5rem 0.8rem;" onclick="exportToSheet('CK')">📊 CK</button>
                    </div>
                    ${!editedData.ledger_hash ? `
                    <div id="ledgerBtnGroup" style="display:flex; align-items:center; gap:0.5rem; background:var(--bg-main); padding:0.5rem 1rem; border-radius:12px; border:1px solid var(--border);">
                        <span style="font-size:0.75rem; color:var(--text-secondary); font-weight:700; text-transform:uppercase;">Add to Ledger:</span>
                        <select id="ledgerAggSelect" style="padding:0.35rem 0.5rem; border-radius:8px; border:1px solid var(--border); font-family:inherit; font-size:0.82rem; background:var(--bg-card); color:var(--text-primary);">
                            <option value="">Loading...</option>
                        </select>
                        <button class="pdf-btn" style="background: #10b981; color:white; padding: 0.5rem 0.8rem;" onclick="addToLedger('AB')">📒 AB</button>
                        <button class="pdf-btn" style="background: #6366f1; color:white; padding: 0.5rem 0.8rem;" onclick="addToLedger('CK')">📒 CK</button>
                    </div>` : `
                    <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(16,185,129,0.08); padding:0.6rem 1.2rem; border-radius:12px; border:1px solid rgba(16,185,129,0.2);">
                        <span style="font-weight:700; color:#10b981;">✅ In Ledger</span>
                    </div>`}
                    ${!isCancelled ? `
                    <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(239,68,68,0.05); padding:0.5rem 1rem; border-radius:12px; border:1px solid rgba(239,68,68,0.2);">
                        <button class="pdf-btn" style="background:linear-gradient(135deg,#dc2626,#ef4444); color:white; padding:0.5rem 1rem;" onclick="openCancelModal()">❌ Cancel / Split</button>
                        <button class="pdf-btn" style="background:linear-gradient(135deg,#d97706,#f59e0b); color:white; padding:0.5rem 1rem;" onclick="openChangeModal()">🔄 Change</button>
                    </div>` : `
                    <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(239,68,68,0.08); padding:0.6rem 1.2rem; border-radius:12px; border:1px dashed rgba(239,68,68,0.3);">
                        <span style="font-weight:700; color:#ef4444;">🔴 This ticket is cancelled</span>
                    </div>`}
                    ${isMergedView ? `
                    <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(5,150,105,0.08); padding:0.6rem 1.2rem; border-radius:12px; border:1px solid rgba(5,150,105,0.2);">
                        <span style="font-weight:700; color:#059669;">Merged booking view. These actions apply to the grouped booking shown here.</span>
                    </div>` : ''}
                </div>`;
    loadLedgerAggregators();
}

// ==================== RENDER DETAIL ====================
function renderDetailView() {
    const t = editedData;
    if (!t) return;
    if (!t.currency) t.currency = 'INR';
    const segments = t.segments || [];
    const journey = t.journey || {};

    // Use journey legs if available
    let legs;
    if (journey.legs && journey.legs.length > 0) {
        legs = journey.legs.map(leg => leg.segments || []);
    } else {
        legs = groupSegmentsIntoLegs(segments);
    }

    const firstLegIndices = legs[0] || [];
    const lastLegIndices = legs[legs.length - 1] || [];
    const firstSeg = segments[firstLegIndices[0]] || segments[0] || {};
    let arrCode = '';
    if (t.trip_type === 'round_trip' && legs.length >= 2) {
        const outboundLastSeg = segments[legs[0][legs[0].length - 1]] || {};
        arrCode = (outboundLastSeg.arrival || {}).airport || '';
    } else {
        const lastSeg = segments[lastLegIndices[lastLegIndices.length - 1] || 0] || segments[segments.length - 1] || {};
        arrCode = (lastSeg.arrival || {}).airport || '';
    }
    const depCode = (firstSeg.departure || {}).airport || '';

    const tripDisplay = journey.trip_type_display || getTripLabel(t.trip_type);
    const summaryDuration = getJourneyDurationValue(legs, segments, journey);
    const summaryDurationHtml = summaryDuration
        ? `&nbsp;<span style="font-weight:700;color:var(--primary);">⏱ ${summaryDuration}</span>`
        : '';

    let headerRouteHtml = '';
    if (t.trip_type === 'multi_city') {
        const dests = [];
        legs.forEach(l => {
            const fs = segments[l[0]] || {};
            const apt = (fs.departure || {}).airport;
            if (apt) dests.push(apt);
        });
        const lastL = legs[legs.length - 1] || [];
        const ls = segments[lastL[lastL.length - 1] || 0] || segments[segments.length - 1] || {};
        const finalApt = (ls.arrival || {}).airport;
        if (finalApt) dests.push(finalApt);
        headerRouteHtml = dests.filter(Boolean).join(' → ');
    } else {
        headerRouteHtml = `${depCode} ${t.trip_type === 'round_trip' ? '↔' : '→'} ${arrCode}`;
    }

    // Ticket status badge for detail
    const detailTStatus = t.ticket_status || 'live';
    const detailTStatusBadge = detailTStatus === 'cancelled'
        ? '<span style="background:rgba(239,68,68,0.12);color:#ef4444;padding:0.2rem 0.7rem;border-radius:8px;font-size:0.82rem;font-weight:700;">🔴 Cancelled</span>'
        : detailTStatus === 'changed'
        ? '<span style="background:rgba(245,158,11,0.12);color:#f59e0b;padding:0.2rem 0.7rem;border-radius:8px;font-size:0.82rem;font-weight:700;">🟡 Changed</span>'
        : '<span style="background:rgba(16,185,129,0.12);color:#10b981;padding:0.2rem 0.7rem;border-radius:8px;font-size:0.82rem;font-weight:700;">🟢 Live</span>';

    // Cancellation charge display
    const charge = parseFloat(t.cancellation_charge) || 0;
    const chargeHtml = charge > 0 ? `<span style="background:rgba(239,68,68,0.1); color:#dc2626; padding:0.2rem 0.6rem; border-radius:8px; font-size:0.8rem; font-weight:700; border:1px solid rgba(239,68,68,0.2);">⚠️ XXD: ₹${charge.toLocaleString('en-IN')}</span>` : '';

    document.getElementById('ticketDetailHeader').innerHTML = `
        <div>
            <h1>${headerRouteHtml}</h1>
            <div class="detail-subtitle">
                <span class="pnr-label" style="font-size:0.9rem;">${safe(t.pnr, 'No PNR')}</span>
                &nbsp;${t.status === 'matched' ? '<span class="match-badge matched">✅ Matched</span>' : '<span class="match-badge unmatched">Unmatched</span>'}
                &nbsp;${detailTStatusBadge}
                &nbsp;${chargeHtml}
                ${summaryDurationHtml}
                &nbsp;•&nbsp; ${tripDisplay}
            </div>
        </div>
        <div class="detail-actions">
            <button class="btn-action small danger" onclick="deleteTicket()">🗑️ Delete</button>
        </div>`;
    renderBookingSection();
    renderSegmentsSection();
    renderPassengersSection();
    renderFareSection();
    renderActionsSection();
}

function renderBookingSection() {
    const t = editedData;
    if (!t.raw_data) t.raw_data = {};
    if (!t.raw_data.gst_details) t.raw_data.gst_details = {};
    const gst = t.raw_data.gst_details;

    const gstHtml = `
        <div style="margin-top:1rem; padding:1rem; background:var(--bg-main); border-radius:10px; border:1px solid var(--border);">
            <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.75rem;">
                <span style="font-size:1rem;">🏢</span>
                <span style="font-weight:700; font-size:0.9rem; color:var(--text-primary);">GST Details</span>
            </div>
            <div class="field-grid">
                <div class="field-item">
                    <label>Company Name</label>
                    <input type="text" value="${safe(gst.company_name)}" placeholder="Enter company name" oninput="editedData.raw_data.gst_details.company_name=this.value; triggerAutoSave()" onchange="editedData.raw_data.gst_details.company_name=this.value; triggerAutoSave()">
                </div>
                <div class="field-item">
                    <label>GSTIN</label>
                    <input type="text" value="${safe(gst.gst_number)}" placeholder="Enter full GST number" style="font-family:monospace;" oninput="editedData.raw_data.gst_details.gst_number=this.value; triggerAutoSave()" onchange="editedData.raw_data.gst_details.gst_number=this.value; triggerAutoSave()">
                </div>
            </div>
        </div>`;

    document.getElementById('bookingSection').innerHTML = `
        <div class="section-header-row"><h2>📋 Booking Information</h2></div>
        <div class="field-grid">
            <div class="field-item"><label>PNR</label><input type="text" value="${safe(t.pnr)}" oninput="editedData.pnr=this.value; triggerAutoSave()" onchange="editedData.pnr=this.value; triggerAutoSave()"></div>
            <div class="field-item"><label>Booking Date</label><input type="text" value="${safe(t.booking_date)}" oninput="editedData.booking_date=this.value; triggerAutoSave()" onchange="editedData.booking_date=this.value; triggerAutoSave()"></div>
            <div class="field-item"><label>Phone</label><input type="text" value="${safe(t.phone)}" oninput="editedData.phone=this.value; triggerAutoSave()" onchange="editedData.phone=this.value; triggerAutoSave()"></div>
            <div class="field-item"><label>Currency</label>
                <select onchange="setTicketCurrency(this.value)">
                    <option value="INR" ${(t.currency || 'INR') === 'INR' ? 'selected' : ''}>INR</option>
                    <option value="USD" ${t.currency === 'USD' ? 'selected' : ''}>USD</option>
                    <option value="EUR" ${t.currency === 'EUR' ? 'selected' : ''}>EUR</option>
                    <option value="GBP" ${t.currency === 'GBP' ? 'selected' : ''}>GBP</option>
                    <option value="AED" ${t.currency === 'AED' ? 'selected' : ''}>AED</option>
                    <option value="SGD" ${t.currency === 'SGD' ? 'selected' : ''}>SGD</option>
                    <option value="THB" ${t.currency === 'THB' ? 'selected' : ''}>THB</option>
                </select>
            </div>
            <div class="field-item"><label>Class of Travel</label>
                <select onchange="editedData.class_of_travel=this.value; triggerAutoSave()">
                    <option value="None" ${!t.class_of_travel || t.class_of_travel === 'None' ? 'selected' : ''}>None (Mixed / Hidden)</option>
                    <option value="Economy" ${t.class_of_travel === 'Economy' ? 'selected' : ''}>Economy</option>
                    <option value="Premium Economy" ${t.class_of_travel === 'Premium Economy' ? 'selected' : ''}>Premium Economy</option>
                    <option value="Business" ${t.class_of_travel === 'Business' ? 'selected' : ''}>Business</option>
                    <option value="First" ${t.class_of_travel === 'First' ? 'selected' : ''}>First</option>
                </select></div>
            <div class="field-item"><label>Trip Type</label>
                <select onchange="editedData.trip_type=this.value; renderDetailView(); triggerAutoSave()">
                    <option value="one_way" ${t.trip_type === 'one_way' ? 'selected' : ''}>One Way</option>
                    <option value="round_trip" ${t.trip_type === 'round_trip' ? 'selected' : ''}>Round Trip</option>
                    <option value="multi_city" ${t.trip_type === 'multi_city' ? 'selected' : ''}>Multi-City</option>
                </select></div>
        </div>
        ${gstHtml}`;
}

function renderSegmentsSection() {
    const segments = editedData.segments || [];
    const journey = editedData.journey || {};
    const tripType = editedData.trip_type || 'one_way';
    const cabinClassOptions = ['Economy', 'Premium Economy', 'Business', 'First'];

    // Use journey legs from API if available, otherwise fall back to grouping
    let legs;
    if (journey.legs && journey.legs.length > 0) {
        legs = journey.legs.map(leg => leg.segments || []);
    } else {
        legs = groupSegmentsIntoLegs(segments);
    }

    // Build a lookup for layover info from journey data
    const layoverMap = {};
    if (journey.layovers && journey.layovers.length > 0) {
        journey.layovers.forEach(lo => {
            layoverMap[lo.after_segment] = lo;
        });
    }

    // Trip type display
    const tripDisplay = journey.trip_type_display || getTripLabel(tripType);
    const hasLayovers = journey.has_layovers || legs.some(l => l.length > 1);

    let html = `<div class="section-header-row">
        <h2>✈️ Flight Segments</h2>
        <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
            <span class="trip-type-chip">${tripDisplay}</span>
            <span class="badge">${legs.length} leg${legs.length > 1 ? 's' : ''} • ${segments.length} segment${segments.length > 1 ? 's' : ''}</span>
        </div>
    </div>`;

    legs.forEach((legIndices, legIdx) => {
        const legLabel = getLegLabel(legIdx, legs.length, tripType);
        const firstSeg = segments[legIndices[0]] || {};
        const lastSeg = segments[legIndices[legIndices.length - 1]] || {};
        const legOrigin = (firstSeg.departure || {}).airport || '---';
        const legOriginCity = (firstSeg.departure || {}).city || '';
        const legDest = (lastSeg.arrival || {}).airport || '---';
        const legDestCity = (lastSeg.arrival || {}).city || '';
        const hasStops = legIndices.length > 1;
        const stopCount = legIndices.length - 1;
        const depDate = (firstSeg.departure || {}).date || '';
        const depTime = (firstSeg.departure || {}).time || '';
        const arrTime = (lastSeg.arrival || {}).time || '';
        const arrDate = (lastSeg.arrival || {}).date || '';

        // Get total duration from journey leg data if available
        const legDuration = getLegDurationValue(legIndices, segments, journey, legIdx);

        // Collect layover airport codes for summary
        const layoverAirports = [];
        if (hasStops) {
            for (let k = 0; k < legIndices.length - 1; k++) {
                const segIdx = legIndices[k];
                const lo = layoverMap[segIdx];
                if (lo) {
                    layoverAirports.push(lo.at_airport);
                } else {
                    const seg = segments[segIdx];
                    layoverAirports.push((seg.arrival || {}).airport || '?');
                }
            }
        }

        const legId = `leg-${legIdx}`;
        const isCollapsible = hasStops;

        html += `<div class="leg-group-v2" style="${(function() {
            const segs = legIndices.map(i => segments[i]);
            const isFullyCancelled = segs.every(s => s.status === 'cancelled');
            return isFullyCancelled ? 'border: 2px solid #ef4444; background: rgba(239, 68, 68, 0.05);' : '';
        })()}">
            <div class="leg-header-v2" ${isCollapsible ? `onclick="toggleLeg('${legId}')" style="cursor:pointer;"` : ''}>
                <div style="display:flex; width:100%; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:1rem;">
                    
                    <!-- Left: Badge -->
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                        <span class="leg-badge-v2">${legLabel}</span>
                        ${(function() {
                            const segs = legIndices.map(i => segments[i]);
                            const cancelled = segs.every(s => s.status === 'cancelled');
                            const partial = !cancelled && segs.some(s => s.status === 'cancelled');
                            if (cancelled) return '<span style="background:#ef4444; color:white; font-size:0.65rem; padding:1px 6px; border-radius:4px; font-weight:700;">CANCELLED</span>';
                            if (partial) return '<span style="background:#f59e0b; color:white; font-size:0.65rem; padding:1px 6px; border-radius:4px; font-weight:700;">PARTIAL CANCEL</span>';
                            return '';
                        })()}
                    </div>

                    <!-- Middle: Visual Route + Duration -->
                    <div style="display:flex; flex:1; justify-content:center; align-items:center; gap:1.5rem; min-width:300px;">
                        <!-- Departure Info -->
                        <div style="display:flex; flex-direction:column; align-items:flex-start; text-align:left;">
                            <div style="display:flex; align-items:baseline; gap:0.3rem;">
                                <span class="leg-code">${legOrigin}</span>
                                ${legOriginCity ? `<span class="leg-city" style="font-size:0.75rem; color:var(--text-secondary);">(${legOriginCity})</span>` : ''}
                            </div>
                            <div style="display:flex; gap:0.4rem; align-items:baseline; margin-top:2px;">
                                <span style="font-weight:700; font-size:0.95rem;">${depTime || '--:--'}</span>
                                <span style="font-size:0.7rem; color:var(--text-secondary);">${depDate}</span>
                            </div>
                        </div>

                        <!-- Arrow & Duration -->
                        <div style="flex:1; max-width:180px; position:relative; display:flex; flex-direction:column; align-items:center; min-height:40px; justify-content:center;">
                            ${legDuration ? `<div style="position:absolute; top:-12px; left:50%; transform:translateX(-50%); font-size:0.72rem; font-weight:600; color:var(--primary); padding:0.1rem 0.4rem; background:rgba(37,99,235,0.08); border-radius:6px; white-space:nowrap;">🕐 ${legDuration}</div>` : ''}
                            
                            <div style="width:100%; height:2px; background:linear-gradient(90deg, var(--primary), #8b5cf6); border-radius:2px; position:relative; margin: 4px 0;">
                                <div style="position:absolute; left:50%; top:50%; transform:translate(-50%, -50%); font-size:0.95rem; color:#8b5cf6; background:transparent; z-index:1;">✈</div>
                            </div>
                            
                            <div style="position:absolute; top:24px; left:50%; transform:translateX(-50%); white-space:nowrap; display:flex; flex-direction:column; align-items:center;">
                                ${hasStops ? `<div style="font-size:0.65rem; color:#f59e0b; font-weight:600; text-align:center;">${stopCount} stop${stopCount > 1 ? 's' : ''} in ${layoverAirports.join(', ')}</div>` : '<span class="leg-stops-badge direct" style="padding:0.15rem 0.5rem; font-size:0.65rem; font-weight:600;">Direct</span>'}
                            </div>
                        </div>

                        <!-- Arrival Info -->
                        <div style="display:flex; flex-direction:column; align-items:flex-start; text-align:left;">
                            <div style="display:flex; align-items:baseline; gap:0.3rem;">
                                <span class="leg-code">${legDest}</span>
                                ${legDestCity ? `<span class="leg-city" style="font-size:0.75rem; color:var(--text-secondary);">(${legDestCity})</span>` : ''}
                            </div>
                            <div style="display:flex; gap:0.4rem; align-items:baseline; margin-top:2px;">
                                <span style="font-weight:700; font-size:0.95rem;">${arrTime || '--:--'}</span>
                                <span style="font-size:0.7rem; color:var(--text-secondary);">${arrDate}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Right: Toggle Icon -->
                    <div style="display:flex; align-items:center; min-width:20px; justify-content:flex-end;">
                        ${isCollapsible ? '<span class="leg-expand-icon" id="icon-' + legId + '">▼</span>' : '<span style="width:12px;"></span>'}
                    </div>

                </div>
            </div>
            <div class="leg-segments-v2 ${isCollapsible ? 'collapsed' : ''}" id="${legId}">`;

        legIndices.forEach((segIdx, posInLeg) => {
            const seg = segments[segIdx];
            const dep = seg.departure || {};
            const arr = seg.arrival || {};
            const duration = getSegmentDurationValue(seg);

            // Layover indicator between segments in same leg
            if (posInLeg > 0) {
                const lo = layoverMap[legIndices[posInLeg - 1]];
                const layoverDur = lo ? lo.duration : (seg.layover_duration || '');
                const layoverCity = lo ? lo.at_airport : (dep.city || dep.airport || '');
                html += `<div class="layover-indicator-v2">
                    <div class="layover-line-v2"></div>
                    <div class="layover-info-v2">
                        <span class="layover-icon-v2">⏱️</span>
                        <span class="layover-text">Layover${layoverDur && layoverDur !== 'N/A' ? ' <strong>' + layoverDur + '</strong>' : ''} at <strong>${layoverCity}</strong></span>
                    </div>
                    <div class="layover-line-v2"></div>
                </div>`;
            }

            const bkClassStr = getSegmentBookingClassValue(seg);
            const showCabinClass = !!bkClassStr;
            const segmentCardClass = showCabinClass ? 'segment-card-v2 has-cabin-class' : 'segment-card-v2';
            const depDateTimeClass = showCabinClass ? 'tl-datetime has-cabin-class' : 'tl-datetime';
            const arrDateTimeClass = showCabinClass ? 'tl-datetime has-cabin-class' : 'tl-datetime';

            html += `<div class="${segmentCardClass}" style="${seg.status === 'cancelled' ? 'opacity:0.85; border-left:6px solid #ef4444; background:rgba(239,68,68,0.08); box-shadow: inset 0 0 10px rgba(239,68,68,0.1);' : ''}">
                <div class="segment-header-v2">
                    <div class="segment-airline-info">
                        <div class="segment-airline-main">
                            <span class="segment-airline-v2">${safe(seg.airline, 'Airline')}</span>
                            <span class="segment-fltnum-v2">${safe(seg.flight_number)}</span>
                        </div>
                        ${showCabinClass ? `<span class="seg-class-chip">${bkClassStr}</span>` : ''}
                        ${seg.status === 'cancelled' ? `
                            <span class="status-badge" style="background:#ef4444; color:white; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:700; box-shadow:0 2px 4px rgba(239,68,68,0.2);">🔴 CANCELLED</span>
                            ${editedData.cancellation_charge > 0 ? `<span style="background:rgba(239,68,68,0.08); color:#ef4444; font-size:0.75rem; font-weight:700; padding:2px 8px; border-radius:10px; border:1px solid rgba(239,68,68,0.2);">Charge: ₹${editedData.cancellation_charge}</span>` : ''}
                        ` : ''}
                    </div>
                    <div style="display:flex;align-items:center;gap:0.5rem;">
                        <button class="btn-action small secondary" onclick="editSegment(${segIdx})">✏️ Edit</button>
                    </div>
                </div>
                <div class="segment-timeline-v2">
                    <div class="timeline-point dep">
                        <div class="timeline-dot"></div>
                        <div class="timeline-details" style="display:flex; flex-direction:column; align-items:flex-start;">
                            <div style="display:flex; align-items:baseline; gap:0.3rem;">
                                <span class="tl-code">${safe(dep.airport, '---')}</span>
                                ${dep.city ? `<span class="tl-city" style="font-size:0.75rem; color:var(--text-secondary);">(${safe(dep.city)})</span>` : ''}
                            </div>
                            <div class="${depDateTimeClass}" style="display:flex; gap:0.4rem; align-items:baseline; margin-top:2px; justify-content:flex-start;">
                                <span class="tl-time">${safe(dep.time, '--:--')}</span>
                                <span class="tl-date">${safe(dep.date)}</span>
                            </div>
                            ${dep.terminal && dep.terminal !== 'N/A' ? `<span class="tl-terminal">Terminal ${dep.terminal}</span>` : ''}
                        </div>
                    </div>
                    <div class="timeline-connector">
                        ${duration ? `<span class="timeline-duration">${duration}</span>` : ''}
                    </div>
                    <div class="timeline-point arr">
                        <div class="timeline-dot arr-dot"></div>
                        <div class="timeline-details" style="display:flex; flex-direction:column; align-items:flex-start; text-align:left;">
                            <div style="display:flex; align-items:baseline; gap:0.3rem;">
                                <span class="tl-code">${safe(arr.airport, '---')}</span>
                                ${arr.city ? `<span class="tl-city" style="font-size:0.75rem; color:var(--text-secondary);">(${safe(arr.city)})</span>` : ''}
                            </div>
                            <div class="${arrDateTimeClass}" style="display:flex; gap:0.4rem; align-items:baseline; margin-top:2px; justify-content:flex-start;">
                                <span class="tl-time">${safe(arr.time, '--:--')}</span>
                                <span class="tl-date">${safe(arr.date)}</span>
                            </div>
                            ${arr.terminal && arr.terminal !== 'N/A' ? `<span class="tl-terminal">Terminal ${arr.terminal}</span>` : ''}
                        </div>
                    </div>
                </div>
            </div>`;
        });

        html += `</div></div>`;
    });

    document.getElementById('segmentsSection').innerHTML = html;
}

function toggleLeg(legId) {
    const el = document.getElementById(legId);
    const icon = document.getElementById('icon-' + legId);
    if (!el) return;
    el.classList.toggle('collapsed');
    if (icon) icon.textContent = el.classList.contains('collapsed') ? '▼' : '▲';
}

function setPassengerSortMode(mode) {
    passengerSortMode = mode || '';
    renderPassengersSection();
}

function setTicketCurrency(currency) {
    editedData.currency = currency || 'INR';
    isDetailDirty = true;
    if (currentTicket && currentTicket.id === editedData.id) {
        currentTicket.currency = editedData.currency;
    }
    const ticketIndex = allTickets.findIndex(ticket => ticket.id === editedData.id);
    if (ticketIndex !== -1) {
        allTickets[ticketIndex].currency = editedData.currency;
    }
    renderTicketCards();
    renderDetailView();
    triggerAutoSave();
}

function renderPassengersSection() {
    const passengers = editedData.passengers || [];
    const segments = editedData.segments || [];
    const legs = groupSegmentsIntoLegs(segments);
    const tripType = editedData.trip_type || 'one_way';
    const hasMultipleSegments = segments.length > 1;

    const totalPax = passengers.length;
    const allSelected = totalPax > 0 && selectedPaxIndices.size === totalPax;
    const someSelected = selectedPaxIndices.size > 0;
    const normalizePassengerSortValue = (value) => safe(value, '').toString().trim();
    const passengerRows = passengers.map((passenger, originalIndex) => ({ passenger, originalIndex }));

    if (passengerSortMode === 'name') {
        passengerRows.sort((a, b) => normalizePassengerSortValue(a.passenger.name).localeCompare(
            normalizePassengerSortValue(b.passenger.name),
            undefined,
            { sensitivity: 'base', numeric: true }
        ));
    } else if (passengerSortMode === 'ticket_number') {
        passengerRows.sort((a, b) => normalizePassengerSortValue(a.passenger.ticket_number).localeCompare(
            normalizePassengerSortValue(b.passenger.ticket_number),
            undefined,
            { sensitivity: 'base', numeric: true }
        ));
    }

    let html = `<div class="section-header-row">
        <h2>👥 Passengers</h2>
        <div style="display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap;">
            <label style="display:flex; align-items:center; gap:0.45rem; font-size:0.9rem; color:var(--text-secondary);">
                <span>Sort</span>
                <select onchange="setPassengerSortMode(this.value)" style="min-width:160px;">
                    <option value="" ${passengerSortMode === '' ? 'selected' : ''}>No Sort</option>
                    <option value="name" ${passengerSortMode === 'name' ? 'selected' : ''}>Name</option>
                    <option value="ticket_number" ${passengerSortMode === 'ticket_number' ? 'selected' : ''}>Ticket Number</option>
                </select>
            </label>
            <button class="btn-action small primary" onclick="addPassenger()">+ Add Passenger</button>
        </div>
    </div>`;

    if (totalPax > 0) {
        html += `<div class="pax-select-bar">
            <label>
                <input type="checkbox" class="pax-checkbox" id="paxSelectAll"
                    ${allSelected ? 'checked' : ''}
                    onchange="toggleSelectAllPax(this.checked)">
                Select All
            </label>
            <span class="pax-select-count" id="paxSelectCount">${someSelected ? selectedPaxIndices.size + ' of ' + totalPax + ' selected' : 'Select passengers to download tickets'}</span>
        </div>`;
    }

    passengerRows.forEach(({ passenger: p, originalIndex: i }) => {
        const paxType = getPaxLabel(p.pax_type || p.type);
        const typeClass = paxType.toLowerCase();
        const seats = p.seats || [];

        const isChecked = selectedPaxIndices.has(i);
        html += `<div class="pax-edit-card ${isChecked ? 'pax-selected' : ''}" id="pax-card-${i}">
            <div class="pax-edit-header">
                <div style="display:flex;align-items:center;gap:0.6rem;">
                    <input type="checkbox" class="pax-checkbox" id="paxCheck-${i}"
                        ${isChecked ? 'checked' : ''}
                        onchange="togglePaxSelection(${i}, this.checked)">
                    <h4 style="margin:0;">👤 ${safe(p.name, 'Passenger ' + (i + 1))}</h4>
                </div>
                <div style="display:flex;align-items:center;gap:0.5rem;">
                    <span class="pax-type-badge ${typeClass}">${paxType}</span>
                    <button class="btn-action small danger" onclick="removePassenger(${i})" style="padding:0.3rem 0.5rem;">✕</button>
                </div>
            </div>
            <div class="field-grid">
                <div class="field-item"><label>Name</label><input type="text" value="${safe(p.name)}" oninput="updatePassengerField(${i}, 'name', this.value)" onchange="updatePassengerField(${i}, 'name', this.value)"></div>
                <div class="field-item"><label>Pax Type</label>
                    <select onchange="updatePassengerField(${i}, 'pax_type', this.value)">
                        <option value="ADT" ${(p.pax_type || '').toUpperCase() === 'ADT' ? 'selected' : ''}>Adult</option>
                        <option value="CHD" ${(p.pax_type || '').toUpperCase() === 'CHD' ? 'selected' : ''}>Child</option>
                        <option value="INF" ${(p.pax_type || '').toUpperCase() === 'INF' ? 'selected' : ''}>Infant</option>
                    </select></div>
                <div class="field-item"><label>Ticket Number</label><input type="text" value="${safe(p.ticket_number)}" oninput="updatePassengerField(${i}, 'ticket_number', this.value)" onchange="updatePassengerField(${i}, 'ticket_number', this.value)"></div>
                <div class="field-item"><label>Frequent Flyer</label><input type="text" value="${safe(p.frequent_flyer_number)}" oninput="updatePassengerField(${i}, 'frequent_flyer_number', this.value)" onchange="updatePassengerField(${i}, 'frequent_flyer_number', this.value)"></div>
                <div class="field-item"><label>Baggage</label><input type="text" value="${safe(p.baggage)}" oninput="updatePassengerField(${i}, 'baggage', this.value)" onchange="updatePassengerField(${i}, 'baggage', this.value)"></div>
            </div>`;

        const getAncHTML = (paxIdx, segIdx) => {
            const ancs = p.ancillaries || [];
            const hasAnc = ancs.some(anc => anc.segment_index === segIdx);
            if (!hasAnc) return '';

            let aHtml = `<div style="margin-top: 0.5rem; display:flex; flex-direction:column; gap:0.5rem; border-top: 1px dashed var(--border); padding-top: 0.5rem;">`;
            ancs.forEach((anc, globalAncIdx) => {
                if (anc.segment_index === segIdx) {
                    aHtml += `<div style="display:flex; flex-direction:row; align-items:center; gap:0.5rem;">
                        <input type="text" placeholder="Ancillary Service (e.g. Wheelchair)" value="${safe(anc.name)}" onchange="updateAncillaryForSegment(${paxIdx}, ${globalAncIdx}, this.value)" style="flex:1;">
                        <button class="btn-action small danger" onclick="removeAncillary(${paxIdx}, ${globalAncIdx})" style="flex: 0 0 auto; padding: 0.4rem 0.8rem;">✕</button>
                    </div>`;
                }
            });
            aHtml += `</div>`;
            return aHtml;
        };

        const getBarcodeHTML = (segIdx) => {
            const seg = segments[segIdx] || {};
            if (!seg.barcode_image) return '';
            return `<div style="margin-top:0.75rem; border-top:1px dashed var(--border); padding-top:0.75rem;">
                <div style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:0.35rem;">Boarding Barcode</div>
                <img src="${seg.barcode_image}" alt="PDF417 barcode for segment ${segIdx + 1}" style="display:block; width:100%; max-width:280px; height:auto; background:#fff; border:1px solid var(--border); border-radius:10px; padding:0.35rem;">
            </div>`;
        };

        // Section-wise seat and meal assignment
        if (hasMultipleSegments) {
            html += `<div class="seat-section-title">Seat & Meal Assignments by Segment</div>
            <div class="seat-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem;">`;
            legs.forEach((legIndices, legIdx) => {
                const legLabel = getLegLabel(legIdx, legs.length, tripType);
                legIndices.forEach((segIdx) => {
                    const seg = segments[segIdx];
                    const dep = (seg.departure || {}).airport || '?';
                    const arr = (seg.arrival || {}).airport || '?';
                    // Find seat for this segment
                    const seatObj = seats.find(s => s.segment_index === segIdx) || {};
                    const seatNum = seatObj.seat_number || '';

                    // Find meal for this segment
                    const mealObj = (p.meals || []).find(m => m.segment_index === segIdx) || {};
                    const mealName = mealObj.name || mealObj.code || '';

                    html += `<div class="field-item seat-field" style="background:var(--bg-main); padding:0.5rem; border-radius:8px; border:1px solid var(--border);">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <label style="color:var(--primary); font-weight:700; margin:0;">${dep} → ${arr}</label>
                            <button class="btn-action small success" onclick="addAncillary(${i}, ${segIdx})" style="padding: 2px 8px; font-size: 11px;">+ Service</button>
                        </div>
                        <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
                            <input type="text" placeholder="Seat (e.g. 12A)" value="${safe(seatNum)}" onchange="updateSeatForSegment(${i}, ${segIdx}, this.value)" style="flex:1;">
                            <input type="text" placeholder="Meal (e.g. VGML)" value="${safe(mealName)}" onchange="updateMealForSegment(${i}, ${segIdx}, this.value)" style="flex:1;">
                        </div>
                        ${getAncHTML(i, segIdx)}
                        ${getBarcodeHTML(segIdx)}
                    </div>`;
                });
            });
            html += `</div>`;
        } else {
            const seatNum = seats.length > 0 ? (seats[0].seat_number || (typeof seats[0] === 'string' ? seats[0] : '')) : '';
            const mealObj = (p.meals || []).length > 0 ? (p.meals[0].name || p.meals[0].code || '') : (typeof p.meal === 'string' ? p.meal : '');
            const firstSeg = segments[0] || {};
            const dep = (firstSeg.departure || {}).airport || '?';
            const arr = (firstSeg.arrival || {}).airport || '?';

            html += `<div class="seat-section-title">Seat & Meal Assignment</div>
            <div class="seat-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem;">
                <div class="field-item seat-field" style="background:var(--bg-main); padding:0.5rem; border-radius:8px; border:1px solid var(--border);">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <label style="color:var(--primary); font-weight:700; margin:0;">${dep} → ${arr}</label>
                        <button class="btn-action small success" onclick="addAncillary(${i}, 0)" style="padding: 2px 8px; font-size: 11px;">+ Service</button>
                    </div>
                    <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
                        <input type="text" placeholder="Seat (e.g. 12A)" value="${safe(typeof seatNum === 'object' ? seatNum.seat_number : seatNum)}" onchange="updateSeatForSegment(${i}, 0, this.value)" style="flex:1;">
                        <input type="text" placeholder="Meal (e.g. VGML)" value="${safe(mealObj)}" onchange="updateMealForSegment(${i}, 0, this.value)" style="flex:1;">
                    </div>
                    ${getAncHTML(i, 0)}
                    ${getBarcodeHTML(0)}
                </div>
            </div>`;
        }

        html += `</div>`;
    });

    html += `<button class="add-pax-btn" onclick="addPassenger()">+ Add New Passenger</button>`;
    document.getElementById('passengersSection').innerHTML = html;
}

function getNormalizedFareState() {
    const passengers = editedData.passengers || [];
    const journey = editedData.journey || {};
    const fareDisplayMode = journey.fare_display || (passengers.length <= 1 ? 'per_passenger' : 'consolidated');
    const passengerCount = passengers.length || 1;
    const fallbackGrandTotal = parseMoneyValue(editedData.grand_total);
    if (!editedData.journey) editedData.journey = {};
    if (!editedData.journey.consolidated_fare) {
        editedData.journey.consolidated_fare = { base_fare: 0, k3_gst: 0, other_taxes: 0 };
    }
    const consolidated = journey.consolidated_fare || null;
    const explicitPassengerFareRows = passengers.map((p) => {
        const fare = p.fare || {};
        return {
            base: parseMoneyValue(fare.base_fare),
            k3: parseMoneyValue(fare.k3_gst),
            other: parseMoneyValue(fare.other_taxes)
        };
    });
    const hasExplicitPassengerFares = explicitPassengerFareRows.some(row => row.base || row.k3 || row.other);

    const passengerTotals = explicitPassengerFareRows.reduce((acc, row) => {
        acc.base += row.base;
        acc.k3 += row.k3;
        acc.other += row.other;
        return acc;
    }, { base: 0, k3: 0, other: 0 });

    const rawConsolidatedTotals = consolidated ? {
        base: parseMoneyValue(consolidated.base_fare),
        k3: parseMoneyValue(consolidated.k3_gst),
        other: parseMoneyValue(consolidated.other_taxes)
    } : { base: 0, k3: 0, other: 0 };
    const hasRawConsolidatedFare = !!(rawConsolidatedTotals.base || rawConsolidatedTotals.k3 || rawConsolidatedTotals.other);
    const useConsolidatedSource = fareDisplayMode === 'consolidated'
        ? (fareFieldsTouched || hasRawConsolidatedFare)
        : (!fareFieldsTouched && hasRawConsolidatedFare);
    const canInferMarkupFromGrandTotal = hasRawConsolidatedFare && fallbackGrandTotal > 0;
    const inferredMarkupTotal = canInferMarkupFromGrandTotal
        ? Math.max(fallbackGrandTotal - (rawConsolidatedTotals.base + rawConsolidatedTotals.k3 + rawConsolidatedTotals.other), 0)
        : 0;
    const globalMarkup = (!fareFieldsTouched && canInferMarkupFromGrandTotal)
        ? inferredMarkupTotal / passengerCount
        : parseMoneyValue(journey.global_markup);
    let hasConsolidatedFare = useConsolidatedSource;
    let consolidatedTotals = useConsolidatedSource ? rawConsolidatedTotals : passengerTotals;

    const hasAnyFareBreakup = (
        consolidatedTotals.base ||
        consolidatedTotals.k3 ||
        consolidatedTotals.other ||
        passengerTotals.base ||
        passengerTotals.k3 ||
        passengerTotals.other
    );

    if (!hasAnyFareBreakup && fallbackGrandTotal > 0 && !fareFieldsTouched) {
        hasConsolidatedFare = true;
        consolidatedTotals = {
            base: fallbackGrandTotal,
            k3: 0,
            other: 0
        };
        editedData.journey.consolidated_fare = {
            base_fare: fallbackGrandTotal,
            k3_gst: 0,
            other_taxes: 0
        };
    }

    const perPassengerRows = passengers.map((_, index) => {
        if (useConsolidatedSource) {
            return {
                base: consolidatedTotals.base / passengerCount,
                k3: consolidatedTotals.k3 / passengerCount,
                other: consolidatedTotals.other / passengerCount
            };
        }
        return explicitPassengerFareRows[index] || { base: 0, k3: 0, other: 0 };
    });

    return {
        passengerRows: perPassengerRows,
        consolidatedTotals,
        globalMarkup,
        hasExplicitPassengerFares: hasConsolidatedFare ? false : hasExplicitPassengerFares
    };
}

function updateConsolidatedFareField(field, value) {
    fareFieldsTouched = true;
    if (!editedData.journey) editedData.journey = {};
    if (!editedData.journey.consolidated_fare) {
        editedData.journey.consolidated_fare = { base_fare: 0, k3_gst: 0, other_taxes: 0 };
    }
    editedData.journey.consolidated_fare[field] = parseMoneyValue(value);
    recalcFareGlobal();
    triggerAutoSave();
}

function updatePassengerFareField(index, field, value) {
    fareFieldsTouched = true;
    if (!editedData.passengers) editedData.passengers = [];
    if (!editedData.passengers[index]) return;
    if (!editedData.passengers[index].fare) editedData.passengers[index].fare = {};
    editedData.passengers[index].fare[field] = parseMoneyValue(value);
    if (!editedData.journey) editedData.journey = {};
    if (!editedData.journey.consolidated_fare) {
        editedData.journey.consolidated_fare = { base_fare: 0, k3_gst: 0, other_taxes: 0 };
    }
    let totalBase = 0;
    let totalK3 = 0;
    let totalOther = 0;
    (editedData.passengers || []).forEach((passenger) => {
        const fare = passenger.fare || {};
        totalBase += parseMoneyValue(fare.base_fare);
        totalK3 += parseMoneyValue(fare.k3_gst);
        totalOther += parseMoneyValue(fare.other_taxes);
    });
    editedData.journey.consolidated_fare.base_fare = totalBase;
    editedData.journey.consolidated_fare.k3_gst = totalK3;
    editedData.journey.consolidated_fare.other_taxes = totalOther;
    recalcFareGlobal();
    triggerAutoSave();
}

function updateGlobalMarkupTotal(value, passengerCount) {
    fareFieldsTouched = true;
    const safePassengerCount = passengerCount || (editedData.passengers || []).length || 1;
    if (!editedData.journey) editedData.journey = {};
    editedData.journey.global_markup = parseMoneyValue(value) / safePassengerCount;
    recalcFareGlobal();
    triggerAutoSave();
}

function updateGlobalMarkupPerPassenger(value) {
    fareFieldsTouched = true;
    if (!editedData.journey) editedData.journey = {};
    editedData.journey.global_markup = parseMoneyValue(value);
    recalcFareGlobal();
    triggerAutoSave();
}

function updateOverrideGrandTotal(value, currencyCode) {
    fareFieldsTouched = true;
    editedData.grand_total = parseMoneyValue(value);
    const grandTotalEl = document.getElementById('grand-total-val');
    if (grandTotalEl) {
        grandTotalEl.textContent = formatCurrency(editedData.grand_total, currencyCode || editedData.currency || 'INR');
    }
    triggerAutoSave();
}

function switchFareDisplay(nextMode) {
    if (!editedData.journey) editedData.journey = {};
    const passengers = editedData.passengers || [];
    const passengerCount = passengers.length || 1;
    const fareState = getNormalizedFareState();
    const globalMarkup = fareState.globalMarkup;

    if (nextMode === 'per_passenger') {
        const splitBase = fareState.consolidatedTotals.base / passengerCount;
        const splitK3 = fareState.consolidatedTotals.k3 / passengerCount;
        const splitOther = fareState.consolidatedTotals.other / passengerCount;
        passengers.forEach((passenger) => {
            if (!passenger.fare) passenger.fare = {};
            passenger.fare.base_fare = splitBase;
            passenger.fare.k3_gst = splitK3;
            passenger.fare.other_taxes = splitOther;
            passenger.fare.total_fare = splitBase + splitK3 + splitOther + globalMarkup;
        });
    } else {
        let totalBase = 0;
        let totalK3 = 0;
        let totalOther = 0;
        passengers.forEach((passenger) => {
            const fare = passenger.fare || {};
            totalBase += parseMoneyValue(fare.base_fare);
            totalK3 += parseMoneyValue(fare.k3_gst);
            totalOther += parseMoneyValue(fare.other_taxes);
        });
        if (!editedData.journey.consolidated_fare) {
            editedData.journey.consolidated_fare = { base_fare: 0, k3_gst: 0, other_taxes: 0 };
        }
        editedData.journey.consolidated_fare.base_fare = totalBase;
        editedData.journey.consolidated_fare.k3_gst = totalK3;
        editedData.journey.consolidated_fare.other_taxes = totalOther;
    }

    editedData.journey.fare_display = nextMode;
    fareFieldsTouched = true;
    recalcFareGlobal(false);
    renderFareSection();
    triggerAutoSave();
}

function renderFareSection() {
    const passengers = editedData.passengers || [];
    const curr = editedData.currency || 'INR';
    if (!editedData.journey) editedData.journey = {};
    if (!editedData.journey.fare_display) {
        editedData.journey.fare_display = passengers.length <= 1 ? 'per_passenger' : 'consolidated';
    }
    const isConsolidated = editedData.journey.fare_display === 'consolidated';
    const fareState = getNormalizedFareState();
    const globalMarkup = fareState.globalMarkup;

    let html = `<div class="section-header-row">
        <h2>💰 Fare Details</h2>
        <button class="btn-action small secondary" onclick="switchFareDisplay('${isConsolidated ? 'per_passenger' : 'consolidated'}')">
            🔄 Show ${isConsolidated ? 'Per Passenger' : 'Consolidated'}
        </button>
    </div>`;

    if (isConsolidated) {
        const base = fareState.consolidatedTotals.base;
        const k3 = fareState.consolidatedTotals.k3;
        const other = fareState.consolidatedTotals.other;
        const markupTotal = globalMarkup * passengers.length;
        const bothAddition = other + markupTotal;
        const total = base + k3 + bothAddition;

        html += `<table class="fare-table">
            <thead><tr>
                <th>Pax</th><th>Total Base Fare</th>
                <th>Airline GST (K3)</th><th>Other Taxes</th>
                <th>Markup (MU)</th>
                <th>Taxes + MU (PDF)</th>
                <th>Total Fare</th>
            </tr></thead><tbody>
            <tr>
                <td>${passengers.length}</td>
                <td><input type="number" value="${base}" oninput="updateConsolidatedFareField('base_fare', this.value)" onchange="updateConsolidatedFareField('base_fare', this.value)"></td>
                <td><input type="number" value="${k3}" oninput="updateConsolidatedFareField('k3_gst', this.value)" onchange="updateConsolidatedFareField('k3_gst', this.value)"></td>
                <td>
                    <input type="number" id="cons-other" value="${other}" oninput="updateConsolidatedFareField('other_taxes', this.value)" onchange="updateConsolidatedFareField('other_taxes', this.value)">
                </td>
                <td>
                    <input type="number" id="cons-markup" value="${markupTotal}" oninput="updateGlobalMarkupTotal(this.value, ${passengers.length || 1})" onchange="updateGlobalMarkupTotal(this.value, ${passengers.length || 1})">
                    <div id="cons-markup-hint" style="font-size:0.7rem; color:var(--text-secondary); margin-top:4px;">
                        ${globalMarkup} / pax
                    </div>
                </td>
                <td style="color:var(--accent-primary); font-weight:600;" id="cons-both">${formatCurrency(bothAddition, curr)}</td>
                <td><strong id="cons-total">${formatCurrency(total, curr)}</strong></td>
            </tr>
            </tbody></table>`;
    } else {
        html += `<table class="fare-table">
            <thead><tr>
                <th>Sr</th><th>Passenger</th><th>Base Fare</th>
                <th>Airline GST (K3)</th><th>Other Taxes</th>
                <th>Markup (MU)</th>
                <th>Taxes + MU (PDF)</th>
                <th>Total Fare</th>
            </tr></thead><tbody>`;

        passengers.forEach((p, i) => {
            const fare = fareState.passengerRows[i] || { base: 0, k3: 0, other: 0 };
            const paxType = getPaxLabel(p.pax_type || p.type);
            const base = parseMoneyValue(fare.base);
            const k3 = parseMoneyValue(fare.k3);
            const other = parseMoneyValue(fare.other);
            const bothAddition = other + globalMarkup;
            const total = base + k3 + bothAddition;

            if (!editedData.passengers[i].fare) editedData.passengers[i].fare = {};
            if (!fareState.hasExplicitPassengerFares) {
                editedData.passengers[i].fare.base_fare = base;
                editedData.passengers[i].fare.k3_gst = k3;
                editedData.passengers[i].fare.other_taxes = other;
            }
            if (parseMoneyValue(editedData.passengers[i].fare.total_fare) !== total) {
                if (!editedData.passengers[i].fare) editedData.passengers[i].fare = {};
                editedData.passengers[i].fare.total_fare = total;
            }

            html += `<tr>
                <td>${i + 1}</td>
                <td><strong>${safe(p.name, paxType)}</strong><br><small style="color:var(--text-secondary)">${paxType}</small></td>
                <td><input type="number" value="${base}" oninput="updatePassengerFareField(${i}, 'base_fare', this.value)" onchange="updatePassengerFareField(${i}, 'base_fare', this.value)"></td>
                <td><input type="number" value="${k3}" oninput="updatePassengerFareField(${i}, 'k3_gst', this.value)" onchange="updatePassengerFareField(${i}, 'k3_gst', this.value)"></td>
                <td>
                    <input type="number" id="pax-other-${i}" value="${other}" oninput="updatePassengerFareField(${i}, 'other_taxes', this.value)" onchange="updatePassengerFareField(${i}, 'other_taxes', this.value)">
                </td>
                <td>
                    <input type="number" id="pax-markup-${i}" value="${globalMarkup}" oninput="updateGlobalMarkupPerPassenger(this.value)" onchange="updateGlobalMarkupPerPassenger(this.value)">
                </td>
                <td style="color:var(--accent-primary); font-weight:600;" id="pax-both-${i}">${formatCurrency(bothAddition, curr)}</td>
                <td><strong id="pax-total-${i}">${formatCurrency(total, curr)}</strong></td>
            </tr>`;
        });

        html += `</tbody></table>`;
    }

    recalcFareGlobal(false);

    html += `<div style="margin-top:1.5rem; display:flex; gap:1.5rem; flex-wrap:wrap; align-items:flex-end;">
        <div class="field-item">
            <label style="color:var(--primary);font-weight:700;">Global Markup <small>(per passenger)</small></label>
            <input type="number" value="${globalMarkup}" oninput="updateGlobalMarkupPerPassenger(this.value)" onchange="updateGlobalMarkupPerPassenger(this.value)">
        </div>
        <div class="field-item">
            <label>Override Grand Total</label>
            <input type="number" id="override-grand-total" value="${parseMoneyValue(editedData.grand_total)}" oninput="updateOverrideGrandTotal(this.value, '${curr}')" onchange="updateOverrideGrandTotal(this.value, '${curr}')">
        </div>
        <div style="flex:1; display:flex; justify-content:flex-end; font-size:1.15rem; font-weight:700;">
            Grand Total : &nbsp;<span id="grand-total-val" style="color:var(--primary);">${formatCurrency(editedData.grand_total, curr)}</span>
        </div>
    </div>`;

    document.getElementById('fareSection').innerHTML = html;
}

function renderActionsSection() {
    const tStatus = editedData.ticket_status || 'live';
    const isCancelled = tStatus === 'cancelled';
    const isMergedView = !!editedData.is_merged_view;

    if (isMergedView) {
        document.getElementById('actionsSection').innerHTML = `
            <div class="section-header-row"><h2>âš¡ Actions</h2></div>
            <div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:center;">
                <div class="pdf-btn-group">
                    <button class="pdf-btn with-fare" onclick="downloadPDF(true)">ðŸ“„ PDF (With Fare)</button>
                    <button class="pdf-btn without-fare" onclick="downloadPDF(false)">ðŸ“„ PDF (Without Fare)</button>
                </div>
                <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(5,150,105,0.08); padding:0.6rem 1.2rem; border-radius:12px; border:1px solid rgba(5,150,105,0.2);">
                    <span style="font-weight:700; color:#059669;">Merged booking view. Passenger tickets are grouped here as one booking.</span>
                </div>
            </div>`;
        return;
    }

    document.getElementById('actionsSection').innerHTML = `
        <div class="section-header-row"><h2>⚡ Actions</h2></div>
                <div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:center;">
                    <div class="pdf-btn-group">
                        <button class="pdf-btn with-fare" onclick="downloadPDF(true)">📄 PDF (With Fare)</button>
                        <button class="pdf-btn without-fare" onclick="downloadPDF(false)">📄 PDF (Without Fare)</button>
                    </div>
                    <div style="display:flex; align-items:center; gap:0.5rem; background:var(--bg-main); padding:0.5rem 1rem; border-radius:12px; border:1px solid var(--border);">
                        <span style="font-size:0.75rem; color:var(--text-secondary); font-weight:700; text-transform:uppercase;">Sheet Export:</span>
                        <button class="pdf-btn" style="background: #10b981; color:white; padding: 0.5rem 0.8rem;" onclick="exportToSheet('AB')">📊 AB</button>
                        <button class="pdf-btn" style="background: #6366f1; color:white; padding: 0.5rem 0.8rem;" onclick="exportToSheet('CK')">📊 CK</button>
                    </div>
                    ${!editedData.ledger_hash ? `
                    <div id="ledgerBtnGroup" style="display:flex; align-items:center; gap:0.5rem; background:var(--bg-main); padding:0.5rem 1rem; border-radius:12px; border:1px solid var(--border);">
                        <span style="font-size:0.75rem; color:var(--text-secondary); font-weight:700; text-transform:uppercase;">Add to Ledger:</span>
                        <select id="ledgerAggSelect" style="padding:0.35rem 0.5rem; border-radius:8px; border:1px solid var(--border); font-family:inherit; font-size:0.82rem; background:var(--bg-card); color:var(--text-primary);">
                            <option value="">Loading...</option>
                        </select>
                        <button class="pdf-btn" style="background: #10b981; color:white; padding: 0.5rem 0.8rem;" onclick="addToLedger('AB')">📒 AB</button>
                        <button class="pdf-btn" style="background: #6366f1; color:white; padding: 0.5rem 0.8rem;" onclick="addToLedger('CK')">📒 CK</button>
                    </div>` : `
                    <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(16,185,129,0.08); padding:0.6rem 1.2rem; border-radius:12px; border:1px solid rgba(16,185,129,0.2);">
                        <span style="font-weight:700; color:#10b981;">✅ In Ledger</span>
                    </div>`}
                    ${!isCancelled ? `
                    <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(239,68,68,0.05); padding:0.5rem 1rem; border-radius:12px; border:1px solid rgba(239,68,68,0.2);">
                        <button class="pdf-btn" style="background:linear-gradient(135deg,#dc2626,#ef4444); color:white; padding:0.5rem 1rem;" onclick="openCancelModal()">❌ Cancel / Split</button>
                        <button class="pdf-btn" style="background:linear-gradient(135deg,#d97706,#f59e0b); color:white; padding:0.5rem 1rem;" onclick="openChangeModal()">🔄 Change</button>
                    </div>` : `
                    <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(239,68,68,0.08); padding:0.6rem 1.2rem; border-radius:12px; border:1px dashed rgba(239,68,68,0.3);">
                        <span style="font-weight:700; color:#ef4444;">🔴 This ticket is cancelled</span>
                    </div>`}
                </div>`;
    loadLedgerAggregators();
}

async function loadLedgerAggregators() {
    try {
        const r = await fetch('/api/aggregators');
        if (!r.ok) return;
        const d = await r.json();
        const sel = document.getElementById('ledgerAggSelect');
        if (!sel) return;
        let html = '<option value="">Select aggregator</option>';
        (d.aggregators || []).forEach(a => {
            html += `<option value="${a.id}">${a.name}</option>`;
        });
        sel.innerHTML = html;
    } catch (e) { }
}

async function addToLedger(bookingBy) {
    if (document.activeElement) document.activeElement.blur();
    const sel = document.getElementById('ledgerAggSelect');
    const aggId = sel ? sel.value : '';
    if (!aggId) {
        showToast('Please select an aggregator first', 'error');
        return;
    }
    showToast('Adding to ledger...', 'info');
    try {
        await saveTicket();
        const r = await fetch(`/api/tickets/${currentTicket.id}/add-to-ledger`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ aggregator_id: aggId, booking_by: bookingBy })
        });
        const data = await r.json();
        if (!r.ok) {
            if (r.status === 402) {
                _showLowBalanceModal(data);
            } else if (r.status === 409) {
                showToast(data.error || 'Duplicate: ticket data unchanged since last ledger add', 'error');
            } else {
                showToast(data.error || 'Failed', 'error');
            }
            return;
        }
        showToast('Added to ledger!', 'success');
        await openTicket(currentTicket.id);
    } catch (e) {
        console.error(e);
        showToast('Network error', 'error');
    }
}

function _showLowBalanceModal(data) {
    const html = `
        <div style="text-align:center; padding:1.5rem;">
            <div style="font-size:3.5rem; margin-bottom:1rem; animation: bounce 2s infinite;">⚠️</div>
            <h2 style="margin-top:0; color:#ef4444; font-weight:800; letter-spacing:-0.02em;">Insufficient Ledger Balance</h2>
            <p style="color:var(--text-secondary); margin-bottom:1.5rem; font-size:1.1rem; line-height:1.5;">
                Your current balance for this aggregator is <br>
                <strong style="color:var(--text-primary); font-size:1.4rem;">${formatCurrency(data.current_balance, 'INR')}</strong><br>
                Required for this entry: <strong style="color:var(--text-primary); font-size:1.4rem;">${formatCurrency(data.required_amount, 'INR')}</strong>
            </p>
            
            <div style="background:rgba(239,68,68,0.06); border:2px dashed rgba(239,68,68,0.3); padding:1.2rem; border-radius:16px; margin-bottom:2rem;">
                <p style="margin:0; font-size:0.95rem; color:#ef4444; font-weight:700;">💰 Shortfall: ${formatCurrency(data.required_amount - data.current_balance, 'INR')}</p>
            </div>

            <div style="display:flex; flex-direction:column; gap:1rem;">
                <button class="btn-action primary" style="background:linear-gradient(135deg,#10b981,#059669); color:white; border:none; width:100%; padding:1rem; font-weight:700; font-size:1rem; box-shadow:0 4px 12px rgba(16,185,129,0.3);" onclick="window.location.href='/ledger?aggregator_id=${data.aggregator_id}&add_funds=true'">
                    🚀 Add Funds to Ledger Now
                </button>
                <button class="btn-action secondary" style="width:100%; border:1px solid var(--border); padding:0.8rem; background:transparent; font-weight:600;" onclick="_closeModal()">
                    Later
                </button>
            </div>
        </div>
    `;
    _createModalOverlay(html);
}

function recalcFareGlobal(redraw = true) {
    if (!editedData.journey) editedData.journey = {};
    if (!editedData.journey.consolidated_fare) {
        editedData.journey.consolidated_fare = { base_fare: 0, k3_gst: 0, other_taxes: 0 };
    }
    if (!editedData.journey.fare_display) {
        editedData.journey.fare_display = (editedData.passengers || []).length <= 1 ? 'per_passenger' : 'consolidated';
    }
    const isConsolidated = editedData.journey.fare_display === 'consolidated';
    const fareState = getNormalizedFareState();
    const globalMarkup = fareState.globalMarkup;
    const curr = editedData.currency || 'INR';
    let gt = 0;

    if (isConsolidated) {
        const passengersCount = (editedData.passengers || []).length;
        const base = fareState.consolidatedTotals.base;
        const k3 = fareState.consolidatedTotals.k3;
        const other = fareState.consolidatedTotals.other;
        const markupTotal = globalMarkup * passengersCount;
        const bothAddition = other + markupTotal;
        const total = base + k3 + bothAddition;
        gt = total;
        editedData.journey.consolidated_fare.base_fare = base;
        editedData.journey.consolidated_fare.k3_gst = k3;
        editedData.journey.consolidated_fare.other_taxes = other;
        const perPassengerBase = passengersCount ? (base / passengersCount) : 0;
        const perPassengerK3 = passengersCount ? (k3 / passengersCount) : 0;
        const perPassengerOther = passengersCount ? (other / passengersCount) : 0;
        const perPassengerMarkup = passengersCount ? globalMarkup : 0;
        (editedData.passengers || []).forEach((passenger) => {
            if (!passenger.fare) passenger.fare = {};
            passenger.fare.base_fare = perPassengerBase;
            passenger.fare.k3_gst = perPassengerK3;
            passenger.fare.other_taxes = perPassengerOther;
            passenger.fare.total_fare = perPassengerBase + perPassengerK3 + perPassengerOther + perPassengerMarkup;
        });

        const baseEl = document.querySelector('input[onchange*="consolidated_fare.base_fare"]');
        if (baseEl && redraw) baseEl.value = base;

        const k3El = document.querySelector('input[onchange*="consolidated_fare.k3_gst"]');
        if (k3El && redraw) k3El.value = k3;

        const otherEl = document.getElementById('cons-other');
        if (otherEl && redraw) otherEl.value = other;

        const markupEl = document.getElementById('cons-markup');
        if (markupEl && redraw) markupEl.value = markupTotal;

        const hintEl = document.getElementById('cons-markup-hint');
        if (hintEl && redraw) hintEl.textContent = `${globalMarkup} / pax`;

        const bothEl = document.getElementById('cons-both');
        if (bothEl && redraw) bothEl.textContent = formatCurrency(bothAddition, curr);

        const ct = document.getElementById('cons-total');
        if (ct && redraw) ct.textContent = formatCurrency(total, curr);
    } else {
        let totalBase = 0;
        let totalK3 = 0;
        let totalOther = 0;
        editedData.passengers.forEach((p, i) => {
            const f = fareState.passengerRows[i] || { base: 0, k3: 0, other: 0 };
            const base = parseMoneyValue(f.base);
            const k3 = parseMoneyValue(f.k3);
            const other = parseMoneyValue(f.other);
            const bothAddition = other + globalMarkup;
            const total = base + k3 + bothAddition;
            totalBase += base;
            totalK3 += k3;
            totalOther += other;
            if (!editedData.passengers[i].fare) editedData.passengers[i].fare = {};
            if (!fareState.hasExplicitPassengerFares) {
                editedData.passengers[i].fare.base_fare = base;
                editedData.passengers[i].fare.k3_gst = k3;
                editedData.passengers[i].fare.other_taxes = other;
            }
            editedData.passengers[i].fare.total_fare = total;
            gt += total;

            const otherEl = document.getElementById('pax-other-' + i);
            if (otherEl && redraw) otherEl.value = other;

            const markupEl = document.getElementById('pax-markup-' + i);
            if (markupEl && redraw) markupEl.value = globalMarkup;

            // Sync global markups dynamically
            if (redraw && i > 0 && markupEl) markupEl.value = globalMarkup;

            const bothEl = document.getElementById('pax-both-' + i);
            if (bothEl && redraw) bothEl.textContent = formatCurrency(bothAddition, curr);

            const pt = document.getElementById('pax-total-' + i);
            if (pt && redraw) pt.textContent = formatCurrency(total, curr);
        });
        editedData.journey.consolidated_fare.base_fare = totalBase;
        editedData.journey.consolidated_fare.k3_gst = totalK3;
        editedData.journey.consolidated_fare.other_taxes = totalOther;
    }

    editedData.grand_total = gt;

    if (redraw) {
        const overrideEl = document.getElementById('override-grand-total');
        if (overrideEl) overrideEl.value = gt;
        const gtEl = document.getElementById('grand-total-val');
        if (gtEl) gtEl.textContent = formatCurrency(gt, curr);
    }
}

function addPassenger() {
    if (!editedData.passengers) editedData.passengers = [];
    const segments = editedData.segments || [];
    const seatEntries = segments.map((_, idx) => ({ segment_index: idx, seat_number: '' }));
    editedData.passengers.push({
        name: '', pax_type: 'ADT', ticket_number: '',
        frequent_flyer_number: '', baggage: '', meal: '',
        ancillaries: [], seats: seatEntries,
        fare: { base_fare: 0, k3_gst: 0, other_taxes: 0, total_fare: 0 }
    });
    renderPassengersSection();
    renderFareSection();
    triggerAutoSave();
    showToast('New passenger added', 'info');
}

function updatePassengerField(index, field, value) {
    if (!editedData.passengers || !editedData.passengers[index]) return;
    editedData.passengers[index][field] = value;
    triggerAutoSave();
}

function removePassenger(idx) {
    if (!confirm('Remove this passenger?')) return;
    editedData.passengers.splice(idx, 1);
    renderPassengersSection();
    renderFareSection();
    triggerAutoSave();
    showToast('Passenger removed', 'info');
}

function updateSeatForSegment(paxIdx, segIdx, value) {
    if (!editedData.passengers[paxIdx].seats) editedData.passengers[paxIdx].seats = [];
    const seats = editedData.passengers[paxIdx].seats;
    const existing = seats.findIndex(s => s.segment_index === segIdx);
    if (existing >= 0) {
        seats[existing].seat_number = value;
    } else {
        seats.push({ segment_index: segIdx, seat_number: value });
    }
    triggerAutoSave();
}

function updateAncillaryForSegment(paxIdx, ancIdx, value) {
    if (editedData.passengers[paxIdx] && editedData.passengers[paxIdx].ancillaries) {
        editedData.passengers[paxIdx].ancillaries[ancIdx].name = value;
        editedData.passengers[paxIdx].ancillaries[ancIdx].code = value;
    }
    triggerAutoSave();
}

function updateMealForSegment(paxIdx, segIdx, value) {
    if (!editedData.passengers[paxIdx].meals) editedData.passengers[paxIdx].meals = [];
    const meals = editedData.passengers[paxIdx].meals;
    const existing = meals.findIndex(m => m.segment_index === segIdx);

    // Clear out old single-string meal to avoid confusing extraction
    if (editedData.passengers[paxIdx].meal) {
        delete editedData.passengers[paxIdx].meal;
    }

    if (existing >= 0) {
        meals[existing].name = value;
        meals[existing].code = value;
    } else {
        meals.push({ segment_index: segIdx, name: value, code: value });
    }
    triggerAutoSave();
}

function addAncillary(paxIdx, segIdx) {
    if (!editedData.passengers[paxIdx].ancillaries) editedData.passengers[paxIdx].ancillaries = [];
    editedData.passengers[paxIdx].ancillaries.push({ segment_index: segIdx, name: '', code: '' });
    renderPassengersSection();
    triggerAutoSave();
}

function removeAncillary(paxIdx, ancIdx) {
    if (editedData.passengers[paxIdx] && editedData.passengers[paxIdx].ancillaries) {
        editedData.passengers[paxIdx].ancillaries.splice(ancIdx, 1);
        renderPassengersSection();
        triggerAutoSave();
    }
}

function editSegment(idx) {
    const seg = editedData.segments[idx];
    const dep = seg.departure || {};
    const arr = seg.arrival || {};
    let selectedCabinClass = getSegmentBookingClassValue(seg);
    const cabinOptions = ['', 'Economy', 'Premium Economy', 'Business', 'First'];
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
    modal.innerHTML = `
        <div id="segment-edit-modal-content" style="background:var(--bg-card);border-radius:16px;padding:2rem;max-width:750px;width:95%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 40px rgba(0,0,0,0.3);" onclick="event.stopPropagation()">
            <h3 style="margin-top:0;">✏️ Edit Segment ${idx + 1}</h3>
            
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; background: var(--bg-main); padding: 1.25rem; border-radius: 12px; border: 1px solid var(--border);">
                <div class="field-item"><label>Airline</label><input type="text" id="seg-airline" value="${safe(seg.airline)}"></div>
                <div class="field-item"><label>Flight Number</label><input type="text" id="seg-fltnum" value="${safe(seg.flight_number)}"></div>
                <div class="field-item"><label>Cabin Class</label><select id="seg-class">${cabinOptions.map(option => `<option value="${option}" ${selectedCabinClass === option ? 'selected' : ''}>${option || 'Hidden by default'}</option>`).join('')}</select></div>
                <div class="field-item" style="grid-column: 1 / -1;"><label>Duration</label><input type="text" id="seg-duration" value="${safe(getSegmentDurationValue(seg))}"></div>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 0.5rem;">
                <!-- Departure Column -->
                <div style="background: var(--bg-main); padding: 1.25rem; border-radius: 12px; border: 1px dashed rgba(37,99,235,0.4);">
                    <h4 style="margin-top:0; color: var(--primary); display:flex; align-items:center; gap:0.5rem;">🛫 Departure</h4>
                    <div class="field-grid" style="grid-template-columns: 1fr;">
                        <div class="field-item"><label>Airport Code</label><input type="text" id="seg-dep-apt" value="${safe(dep.airport)}" style="font-family: monospace; font-size:1rem; font-weight:bold;"></div>
                        <div class="field-item"><label>City</label><input type="text" id="seg-dep-city" value="${safe(dep.city)}"></div>
                        <div class="field-item"><label>Date</label><input type="text" id="seg-dep-date" value="${safe(dep.date)}"></div>
                        <div class="field-item"><label>Time</label><input type="text" id="seg-dep-time" value="${safe(dep.time)}"></div>
                        <div class="field-item"><label>Terminal</label><input type="text" id="seg-dep-term" value="${safe(dep.terminal)}"></div>
                    </div>
                </div>

                <!-- Arrival Column -->
                <div style="background: var(--bg-main); padding: 1.25rem; border-radius: 12px; border: 1px dashed rgba(16,185,129,0.4);">
                    <h4 style="margin-top:0; color: var(--success); display:flex; align-items:center; gap:0.5rem;">🛬 Arrival</h4>
                    <div class="field-grid" style="grid-template-columns: 1fr;">
                        <div class="field-item"><label>Airport Code</label><input type="text" id="seg-arr-apt" value="${safe(arr.airport)}" style="font-family: monospace; font-size:1rem; font-weight:bold;"></div>
                        <div class="field-item"><label>City</label><input type="text" id="seg-arr-city" value="${safe(arr.city)}"></div>
                        <div class="field-item"><label>Date</label><input type="text" id="seg-arr-date" value="${safe(arr.date)}"></div>
                        <div class="field-item"><label>Time</label><input type="text" id="seg-arr-time" value="${safe(arr.time)}"></div>
                        <div class="field-item"><label>Terminal</label><input type="text" id="seg-arr-term" value="${safe(arr.terminal)}"></div>
                    </div>
                </div>
            </div>

            <div style="display:flex;gap:1rem;justify-content:flex-end;margin-top:1.5rem;">
                <button class="btn-action secondary" onclick="this.closest('div[style*=position]').remove()">Cancel</button>
                <button class="btn-action primary" onclick="saveSegmentEdit(${idx})">Save Segment</button>
            </div>
        </div>`;
    modal.onclick = () => modal.remove();
    modal.id = 'segment-edit-modal';
    document.body.appendChild(modal);
}

function saveSegmentEdit(idx) {
    const seg = editedData.segments[idx];
    seg.airline = document.getElementById('seg-airline').value;
    seg.flight_number = document.getElementById('seg-fltnum').value;
    const selectedCabinClass = document.getElementById('seg-class').value.trim();
    seg.show_booking_class = !!selectedCabinClass;
    if (selectedCabinClass) {
        seg.booking_class = selectedCabinClass;
    } else {
        delete seg.booking_class;
    }
    if (!seg.departure) seg.departure = {};
    seg.departure.airport = document.getElementById('seg-dep-apt').value;
    seg.departure.city = document.getElementById('seg-dep-city').value;
    seg.departure.date = document.getElementById('seg-dep-date').value;
    seg.departure.time = document.getElementById('seg-dep-time').value;
    seg.departure.terminal = document.getElementById('seg-dep-term').value;
    if (!seg.arrival) seg.arrival = {};
    seg.arrival.airport = document.getElementById('seg-arr-apt').value;
    seg.arrival.city = document.getElementById('seg-arr-city').value;
    seg.arrival.date = document.getElementById('seg-arr-date').value;
    seg.arrival.time = document.getElementById('seg-arr-time').value;
    seg.arrival.terminal = document.getElementById('seg-arr-term').value;
    const editedDuration = document.getElementById('seg-duration').value;
    seg.duration_calculated = editedDuration;
    seg.duration = editedDuration;
    seg.duration_extracted = editedDuration;

    const journey = editedData.journey || {};
    const segments = editedData.segments || [];
    if (journey.legs && journey.legs.length > 0) {
        journey.legs.forEach((leg, legIdx) => {
            const legSegments = Array.isArray(leg?.segments) ? leg.segments : [];
            journey.legs[legIdx].total_duration = getLegDurationValue(legSegments, segments, journey, legIdx);
        });
    }
    journey.total_journey_duration = getJourneyDurationValue(
        journey.legs && journey.legs.length > 0
            ? journey.legs.map((leg) => Array.isArray(leg?.segments) ? leg.segments : [])
            : groupSegmentsIntoLegs(segments),
        segments,
        journey
    );

    const modal = document.getElementById('segment-edit-modal');
    if (modal) modal.remove();

    renderSegmentsSection();
    triggerAutoSave();
    showToast('Segment updated', 'success');
}

// ==================== SAVE & PDF ====================
async function saveTicket(silent = false) {
    if (!currentTicket || !editedData) return;
    isSaveInFlight = true;
    try {
        const payload = {
            is_merged_view: !!editedData.is_merged_view,
            pnr: editedData.pnr,
            booking_date: editedData.booking_date,
            phone: editedData.phone,
            currency: editedData.currency,
            grand_total: editedData.grand_total,
            class_of_travel: editedData.class_of_travel,
            trip_type: editedData.trip_type,
            passengers: editedData.passengers,
            segments: getPersistableSegments(editedData.segments),
            journey: editedData.journey,
            raw_data: editedData.raw_data,
            status: editedData.status || 'unmatched',
            _edit_base_snapshot: ticketEditBaseSnapshot
        };
        let r = null;
        let responsePayload = {};
        let requestError = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                r = await fetch('/api/tickets/' + currentTicket.id, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                try {
                    responsePayload = await r.json();
                } catch (e) {
                    responsePayload = {};
                }
                if (r.ok) break;
                if (![502, 503, 504].includes(r.status) || attempt === 1) {
                    break;
                }
            } catch (e) {
                requestError = e;
                if (attempt === 1) throw e;
            }
            await new Promise(resolve => setTimeout(resolve, 900));
        }
        if (requestError && !r) throw requestError;
        if (!r.ok) {
            const hadPendingLocalDraft = hasPendingLocalDraft;
            persistTicketDraft();
            const isTransientSaveFailure = [502, 503, 504].includes(r.status);
            const errMsg = responsePayload.error || (r.status === 503 ? 'Autosave failed because the server was busy. It will retry on the next change.' : 'Save failed');
            if (!silent && !isTransientSaveFailure) {
                showToast(errMsg, 'error');
            }
            if (isTransientSaveFailure && isDetailDirty) {
                if (!hadPendingLocalDraft || !silent) {
                    showToast('Server busy. Your edits are kept locally and will sync automatically.', 'warning');
                }
                scheduleDraftRetry(1500);
            }
            return;
        }
        isDetailDirty = false;
        suppressRealtimeUntil = Date.now() + 1500;
        clearTimeout(draftRetryHandle);
        draftRetryHandle = null;
        if (!silent) showToast('Ticket saved successfully!', 'success');
        currentTicket = normalizeTicketFareData(
            responsePayload.ticket
                ? JSON.parse(JSON.stringify(responsePayload.ticket))
                : JSON.parse(JSON.stringify(editedData))
        );
        editedData = JSON.parse(JSON.stringify(currentTicket));
        fareFieldsTouched = false;
        setTicketEditBaseline(currentTicket);
        cacheTicketDetail(currentTicket);
        clearTicketDraft(currentTicket.id);

        const idx = allTickets.findIndex(t => t.id === currentTicket.id);
        if (idx > -1) {
            allTickets[idx] = JSON.parse(JSON.stringify(currentTicket));
            renderTicketCards();
        }
    } catch (e) {
        console.error(e);
        const hadPendingLocalDraft = hasPendingLocalDraft;
        persistTicketDraft();
        scheduleDraftRetry(2000);
        if (!hadPendingLocalDraft || !silent) {
            showToast('Server unavailable. Your edits are stored locally and will retry automatically.', 'warning');
        }
    } finally {
        isSaveInFlight = false;
    }
}

function queueSave(silent = true) {
    if (!isDetailDirty && silent) return pendingSavePromise || Promise.resolve();
    const runSave = async () => {
        await saveTicket(silent);
    };
    const nextSavePromise = (pendingSavePromise || Promise.resolve())
        .catch(() => {})
        .then(runSave)
        .finally(() => {
            if (pendingSavePromise === nextSavePromise) {
                pendingSavePromise = null;
            }
        });
    pendingSavePromise = nextSavePromise;
    return pendingSavePromise;
}

function shouldIgnoreDetailAutoSaveTarget(target) {
    if (!target) return true;
    const tag = (target.tagName || '').toUpperCase();
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return true;
    const inputType = (target.type || '').toLowerCase();
    if (inputType === 'checkbox' || inputType === 'radio') return true;
    if (target.id === 'ledgerAggSelect' || target.id === 'paxSelectAll') return true;
    if ((target.id || '').startsWith('paxCheck-')) return true;
    if (target.classList && target.classList.contains('pax-checkbox')) return true;
    const inlineHandler = `${target.getAttribute?.('onchange') || ''} ${target.getAttribute?.('oninput') || ''}`;
    if (inlineHandler.includes('setPassengerSortMode')) return true;
    return false;
}

function isEditingFieldActive() {
    const active = document.activeElement;
    if (!active) return false;
    const tag = (active.tagName || '').toUpperCase();
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return false;
    const detailView = document.getElementById('detailView');
    if (!detailView || !detailView.contains(active)) return false;
    return !shouldIgnoreDetailAutoSaveTarget(active);
}

function shouldDeferAutosaveForActiveField() {
    if (!isEditingFieldActive()) return false;
    const active = document.activeElement;
    const tag = (active?.tagName || '').toUpperCase();
    if (tag === 'SELECT') return false;
    const inputType = (active?.type || '').toLowerCase();
    if (inputType === 'checkbox' || inputType === 'radio') return false;
    return (Date.now() - lastDetailInputAt) < ACTIVE_FIELD_AUTOSAVE_IDLE_MS;
}

function triggerAutoSave() {
    isDetailDirty = true;
    persistTicketDraft();
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => {
        if (shouldDeferAutosaveForActiveField()) {
            triggerAutoSave();
            return;
        }
        queueSave(true);
    }, 250);
}

function handleDetailFieldFocusOut(event) {
    if (shouldIgnoreDetailAutoSaveTarget(event?.target)) return;
    setTimeout(() => {
        if (!currentTicket || !editedData || !isDetailDirty || isSaveInFlight) return;
        const detailView = document.getElementById('detailView');
        const active = document.activeElement;
        const isAnotherEditableFieldActive = (
            detailView
            && active
            && detailView.contains(active)
            && !shouldIgnoreDetailAutoSaveTarget(active)
        );
        if (!isAnotherEditableFieldActive) {
            clearTimeout(autoSaveTimeout);
            void queueSave(true);
        }
    }, 0);
}

function getPassengerSortQueryParam() {
    return passengerSortMode ? `&passenger_sort=${encodeURIComponent(passengerSortMode)}` : '';
}

function _getDownloadFilenameFromResponse(response, fallbackName) {
    const disposition = response.headers.get('Content-Disposition') || '';
    const utfMatch = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (utfMatch && utfMatch[1]) {
        try {
            return decodeURIComponent(utfMatch[1]);
        } catch (e) {
            return utfMatch[1];
        }
    }
    const simpleMatch = disposition.match(/filename\s*=\s*"?([^";]+)"?/i);
    return simpleMatch && simpleMatch[1] ? simpleMatch[1] : fallbackName;
}

function _downloadBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename || 'ticket.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
}

async function ensureTicketPersistedForDownload() {
    if (document.activeElement) document.activeElement.blur();
    if (!currentTicket || !editedData) return false;
    try {
        await saveTicket(true);
    } catch (e) {
        console.error('Pre-download save failed', e);
    }
    return !isDetailDirty;
}

function getPersistableSegments(segments = []) {
    return (segments || []).map((segment) => {
        const clean = JSON.parse(JSON.stringify(segment || {}));
        delete clean.barcode_data;
        delete clean.barcode_image;
        return clean;
    });
}

function buildTicketPdfSnapshot(extra = {}) {
    return {
        is_merged_view: !!editedData?.is_merged_view,
        pnr: editedData?.pnr,
        booking_date: editedData?.booking_date,
        phone: editedData?.phone,
        currency: editedData?.currency,
        grand_total: editedData?.grand_total,
        class_of_travel: editedData?.class_of_travel,
        trip_type: editedData?.trip_type,
        passengers: JSON.parse(JSON.stringify(editedData?.passengers || [])),
        segments: getPersistableSegments(editedData?.segments || []),
        journey: JSON.parse(JSON.stringify(editedData?.journey || {})),
        raw_data: JSON.parse(JSON.stringify(editedData?.raw_data || {})),
        passenger_sort: passengerSortMode || '',
        ...extra
    };
}

async function downloadPdfFromSnapshot(path, payload, fallbackFilename) {
    const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!r.ok) {
        let errorPayload = {};
        try {
            errorPayload = await r.json();
        } catch (e) {
            errorPayload = {};
        }
        throw new Error(errorPayload.error || 'PDF generation failed');
    }
    const blob = await r.blob();
    const filename = _getDownloadFilenameFromResponse(r, fallbackFilename);
    _downloadBlob(blob, filename);
}

async function downloadPDF(includeFare) {
    try {
        await ensureTicketPersistedForDownload();
        await downloadPdfFromSnapshot(
            `/api/tickets/${currentTicket.id}/pdf`,
            buildTicketPdfSnapshot({ include_fare: includeFare }),
            'ticket.pdf'
        );
        showToast(`PDF download started (${includeFare ? 'with fare' : 'without fare'})`, 'success');
    } catch (e) { showToast(e.message || 'PDF generation failed', 'error'); }
}

// ==================== PASSENGER SELECTION ====================
function togglePaxSelection(idx, checked) {
    if (checked) {
        selectedPaxIndices.add(idx);
    } else {
        selectedPaxIndices.delete(idx);
    }
    _updatePaxSelectionUI();
}

function toggleSelectAllPax(checked) {
    const passengers = editedData.passengers || [];
    selectedPaxIndices.clear();
    if (checked) {
        passengers.forEach((_, i) => selectedPaxIndices.add(i));
    }
    _updatePaxSelectionUI();
}

function _updatePaxSelectionUI() {
    const passengers = editedData.passengers || [];
    const totalPax = passengers.length;
    const selectedCount = selectedPaxIndices.size;

    // Update individual checkboxes & card highlight
    for (let i = 0; i < totalPax; i++) {
        const cb = document.getElementById('paxCheck-' + i);
        const card = document.getElementById('pax-card-' + i);
        const isSelected = selectedPaxIndices.has(i);
        if (cb) cb.checked = isSelected;
        if (card) {
            if (isSelected) card.classList.add('pax-selected');
            else card.classList.remove('pax-selected');
        }
    }

    // Update select-all checkbox
    const selectAll = document.getElementById('paxSelectAll');
    if (selectAll) {
        selectAll.checked = totalPax > 0 && selectedCount === totalPax;
    }

    // Update count text
    const countEl = document.getElementById('paxSelectCount');
    if (countEl) {
        countEl.textContent = selectedCount > 0
            ? selectedCount + ' of ' + totalPax + ' selected'
            : 'Select passengers to download tickets';
    }

    // Show/hide floating action bar
    if (selectedCount > 0) {
        _showPaxActionBar(selectedCount);
    } else {
        _removePaxActionBar();
    }
}

function _showPaxActionBar(count) {
    let bar = document.getElementById('paxActionBar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'paxActionBar';
        bar.className = 'pax-action-bar';
        document.body.appendChild(bar);
    }
    const plural = count > 1 ? 's' : '';
    bar.innerHTML = `
        <div class="bar-info">
            <span class="count-badge">${count}</span>
            passenger${plural} selected
        </div>
        <div class="bar-actions">
            <div class="fare-type-tabs" id="paxDlFareToggle">
                <button class="active" onclick="_setPaxDlFare(true, this)">With Fare</button>
                <button onclick="_setPaxDlFare(false, this)">Without Fare</button>
            </div>
            <button class="pax-dl-btn dl-individual" id="paxDlIndividual" onclick="downloadSelectedPaxIndividually()">
                📥 Download Individually
            </button>
            <button class="pax-dl-btn dl-together" id="paxDlTogether" onclick="downloadSelectedPaxTogether()">
                📦 Download Together
            </button>
        </div>
        <button class="bar-close" onclick="clearPaxSelection()">✕ Clear</button>
    `;
}

let _paxDlIncludeFare = true;

function _setPaxDlFare(includeFare, btn) {
    _paxDlIncludeFare = includeFare;
    const tabs = document.querySelectorAll('#paxDlFareToggle button');
    tabs.forEach(t => t.classList.remove('active'));
    if (btn) btn.classList.add('active');
}

function clearPaxSelection() {
    selectedPaxIndices.clear();
    _updatePaxSelectionUI();
}

function _removePaxActionBar() {
    const bar = document.getElementById('paxActionBar');
    if (bar) bar.remove();
}

function _getSelectedIndices() {
    return Array.from(selectedPaxIndices).sort((a, b) => a - b);
}

async function downloadSelectedPaxIndividually() {
    const indices = _getSelectedIndices();
    if (indices.length === 0) { showToast('No passengers selected', 'error'); return; }
    try {
        await ensureTicketPersistedForDownload();
        showToast(`Downloading ${indices.length} individual PDF${indices.length > 1 ? 's' : ''}...`, 'info');
        for (const idx of indices) {
            await downloadPdfFromSnapshot(
                `/api/tickets/${currentTicket.id}/pdf/selected`,
                buildTicketPdfSnapshot({
                    include_fare: _paxDlIncludeFare,
                    mode: 'individual',
                    passenger_indices: [idx]
                }),
                `ticket-${idx + 1}.pdf`
            );
            // Small delay between downloads to avoid browser blocking
            if (indices.length > 1) {
                await new Promise(r => setTimeout(r, 500));
            }
        }
        showToast('Individual PDFs downloaded', 'success');
    } catch (e) { console.error(e); showToast(e.message || 'PDF generation failed', 'error'); }
}

async function downloadSelectedPaxTogether() {
    const indices = _getSelectedIndices();
    if (indices.length === 0) { showToast('No passengers selected', 'error'); return; }
    try {
        await ensureTicketPersistedForDownload();
        showToast(`Downloading combined PDF for ${indices.length} passenger${indices.length > 1 ? 's' : ''}...`, 'info');
        await downloadPdfFromSnapshot(
            `/api/tickets/${currentTicket.id}/pdf/selected`,
            buildTicketPdfSnapshot({
                include_fare: _paxDlIncludeFare,
                mode: 'together',
                passenger_indices: indices
            }),
            'ticket-selected.pdf'
        );
        showToast('Combined PDF downloaded', 'success');
    } catch (e) { console.error(e); showToast(e.message || 'PDF generation failed', 'error'); }
}

async function deleteTicket() {
    if (!confirm('Are you sure you want to delete this ticket?')) return;
    try {
        const r = await fetch('/api/tickets/' + currentTicket.id, { method: 'DELETE' });
        if (!r.ok) { showToast('Delete failed', 'error'); return; }
        ticketDetailCache.delete(currentTicket.id);
        allTickets = allTickets.filter((ticket) => ticket.id !== currentTicket.id);
        knownTicketIds = new Set(allTickets.map((ticket) => ticket.id).filter(Boolean));
        showToast('Ticket deleted', 'success');
        await showListView();
        renderTicketCards();
    } catch (e) { showToast('Delete failed', 'error'); }
}

async function exportToSheet(bookingBy) {
    if (document.activeElement) document.activeElement.blur();

    showToast('Exporting to Google Sheet...', 'info');
    try {
        await saveTicket(); // Ensure data is saved first
        const r = await fetch(`/api/tickets/${currentTicket.id}/export-sheet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ booking_by: bookingBy, type: 'New' })
        });
        const data = await r.json();
        if (!r.ok) {
            showToast(data.error || 'Export failed', 'error');
            return;
        }
        showToast('Successfully exported to Google Sheet!', 'success');
        await openTicket(currentTicket.id);
    } catch (e) {
        console.error(e);
        showToast('Export failed', 'error');
    }
}

// ==================== CANCEL / SPLIT / CHANGE MODALS ====================

function _createModalOverlay(innerHTML) {
    const overlay = document.createElement('div');
    overlay.id = 'cancel-change-modal';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);animation:fadeIn 0.2s ease;';
    overlay.innerHTML = `<div style="background:var(--bg-card);border-radius:20px;padding:2rem;max-width:680px;width:95%;max-height:88vh;overflow-y:auto;box-shadow:0 24px 48px rgba(0,0,0,0.35);border:1px solid var(--border);" onclick="event.stopPropagation()">${innerHTML}</div>`;
    overlay.onclick = () => overlay.remove();
    document.body.appendChild(overlay);
    return overlay;
}

function _closeModal() {
    const m = document.getElementById('cancel-change-modal');
    if (m) m.remove();
}

// ========== CANCEL MODAL ==========
function openCancelModal() {
    if (!editedData || !editedData.passengers || editedData.passengers.length === 0) {
        showToast('No passengers to cancel', 'error');
        return;
    }
    
    // Requirement: Check if added to ledger
    if (!editedData.ledger_hash) {
        showToast('Please add this booking to the ledger first before cancelling.', 'warning');
        return;
    }

    _openWorkflowModal('cancel');
}

// ========== CHANGE MODAL ==========
function openChangeModal() {
    if (!editedData || !editedData.passengers || editedData.passengers.length === 0) {
        showToast('No passengers to change', 'error');
        return;
    }
    
    // Requirement: Check if added to ledger
    if (!editedData.ledger_hash) {
        showToast('Please add this booking to the ledger first before changing.', 'warning');
        return;
    }

    changeAttachmentState = { token: '', filename: '' };
    _openWorkflowModal('change');
}

function _openWorkflowModal(mode) {
    const segments = editedData.segments || [];
    const journey = editedData.journey || {};
    let legs;
    if (journey.legs && journey.legs.length > 0) {
        legs = journey.legs.map(leg => leg.segments || []);
    } else {
        legs = groupSegmentsIntoLegs(segments);
    }

    // If multi-sector, first pick sector(s)
    if (legs.length > 1) {
        _workflowStep_SectorSelect(legs, segments, mode);
    } else {
        _workflowStep_PassengerSelect(null, mode);
    }
}

function _workflowStep_SectorSelect(legs, segments, mode) {
    let modeLabel = mode === 'cancel' ? 'Cancel' : 'Change';
    let html = `<h3 style="margin-top:0;display:flex;align-items:center;gap:0.5rem;">\u2708\ufe0f Select Sector to ${modeLabel}</h3>
    <p style="color:var(--text-secondary);font-size:0.88rem;margin-bottom:1rem;">Select which sector(s) to ${mode.toLowerCase()}.</p>
    <div style="display:flex;flex-direction:column;gap:0.75rem;" id="sectorChoices">`;

    legs.forEach((legIndices, legIdx) => {
        const firstSeg = segments[legIndices[0]] || {};
        const lastSeg = segments[legIndices[legIndices.length - 1]] || {};
        const dep = (firstSeg.departure || {}).airport || '???';
        const arr = (lastSeg.arrival || {}).airport || '???';
        const depDate = (firstSeg.departure || {}).date || '';

        const isCancelled = legIndices.every(idx => (segments[idx] || {}).status === 'cancelled');
        const isPartial = !isCancelled && legIndices.some(idx => (segments[idx] || {}).status === 'cancelled');

        html += `<label style="display:flex;align-items:center;gap:0.75rem;padding:1rem;border-radius:12px;border:2px solid var(--border);${isCancelled ? 'opacity:0.6; cursor:not-allowed;' : 'cursor:pointer; transition:all 0.2s;'}" 
            ${!isCancelled ? `onmouseover="this.style.borderColor='var(--primary)'" onmouseout="if(!this.querySelector('input').checked)this.style.borderColor='var(--border)'" onclick="this.querySelector('input').checked=!this.querySelector('input').checked; this.style.borderColor=this.querySelector('input').checked?'var(--primary)':'var(--border)'; this.style.background=this.querySelector('input').checked?'rgba(37,99,235,0.06)':'transparent'"` : ''}>
            <input type="checkbox" value="${legIdx}" style="display:none;" class="sector-cb" ${isCancelled ? 'disabled' : ''}>
            <div style="width:42px;height:42px;background:linear-gradient(135deg,${isCancelled ? '#94a3b8,#cbd5e1' : '#1e40af,#3b82f6'});color:white;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.85rem;">L${legIdx + 1}</div>
            <div style="flex:1;">
                <div style="font-weight:700;font-size:1rem;display:flex;align-items:center;gap:0.5rem;">
                    ${dep} \u2192 ${arr}
                    ${isCancelled ? '<span style="background:#ef4444;color:white;font-size:0.6rem;padding:1px 4px;border-radius:4px;">CANCELLED</span>' : ''}
                    ${isPartial ? '<span style="background:#f59e0b;color:white;font-size:0.6rem;padding:1px 4px;border-radius:4px;">PARTIAL</span>' : ''}
                </div>
                <div style="font-size:0.78rem;color:var(--text-secondary);">${depDate}</div>
            </div>
        </label>`;
    });

    html += `</div>
    <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:1.5rem;">
        <button class="btn-action secondary" onclick="_closeModal()">Cancel</button>
        <button class="btn-action primary" onclick="_onSectorNext('${mode}')">Next \u2192</button>
    </div>`;

    _createModalOverlay(html);
}

function _onSectorNext(mode) {
    const cbs = document.querySelectorAll('.sector-cb');
    const selectedSectors = [];
    cbs.forEach(cb => { if (cb.checked) selectedSectors.push(parseInt(cb.value)); });
    if (selectedSectors.length === 0) {
        showToast('Please select at least one sector', 'error');
        return;
    }
    _closeModal();
    _workflowStep_PassengerSelect(selectedSectors, mode);
}

function _workflowStep_PassengerSelect(sectorIndices, mode) {
    const passengers = editedData.passengers || [];
    const n = passengers.length;
    let modeLabel = mode === 'cancel' ? 'Cancel' : 'Change';

    let html = `<h3 style="margin-top:0;display:flex;align-items:center;gap:0.5rem;">\ud83d\udc65 Select Passengers to ${modeLabel}</h3>
    <p style="color:var(--text-secondary);font-size:0.88rem;margin-bottom:0.5rem;">Click to select. <strong>All selected = full ${mode.toLowerCase()}.</strong> Fewer = PNR split.</p>
    
    <label style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem;font-size:0.9rem;cursor:pointer;font-weight:600;color:var(--primary);">
        <input type="checkbox" id="selectAllPax" onchange="const cbs=document.querySelectorAll('.pax-cb'); cbs.forEach(cb=>cb.checked=this.checked); cbs.forEach(cb=>cb.parentElement.style.borderColor=this.checked?'var(--primary)':'var(--border)'); cbs.forEach(cb=>cb.parentElement.style.background=this.checked?'rgba(37,99,235,0.06)':'transparent')"> Select All Passengers
    </label>

    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:0.75rem;" id="paxChoices">`;

    passengers.forEach((p, i) => {
        const paxType = getPaxLabel(p.pax_type || p.type);
        html += `<label style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem;border-radius:12px;border:2px solid var(--border);cursor:pointer;transition:all 0.2s;" onclick="this.querySelector('input').checked=!this.querySelector('input').checked; this.style.borderColor=this.querySelector('input').checked?'var(--primary)':'var(--border)'; this.style.background=this.querySelector('input').checked?'rgba(37,99,235,0.06)':'transparent'">
            <input type="checkbox" value="${i}" style="display:none;" class="pax-cb">
            <div style="width:36px;height:36px;background:var(--bg-tertiary);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.1rem;border:1px solid var(--border);">👤</div>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:700;font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name}</div>
                <div style="font-size:0.72rem;color:var(--text-secondary);">${paxType} • ${p.ticket_number || 'No Ticket'}</div>
            </div>
        </label>`;
    });

    html += `</div>
    <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:1.5rem;">
        <button class="btn-action secondary" onclick="_closeModal()">Cancel</button>
        <button class="btn-action primary" onclick="_onPaxNext('${mode}', ${JSON.stringify(sectorIndices).replace(/"/g, '&quot;')})">Next \u2192</button>
    </div>`;

    _createModalOverlay(html);
}

function _onPaxNext(mode, sectorIndices) {
    const passengers = editedData.passengers || [];
    const cbs = document.querySelectorAll('.pax-cb');
    const selectedPax = [];
    cbs.forEach(cb => { if (cb.checked) selectedPax.push(parseInt(cb.value)); });
    if (selectedPax.length === 0) {
        showToast('Please select at least one passenger', 'error');
        return;
    }
    _closeModal();

    if (mode === 'cancel') {
        const hasSpecial = passengers.some(p => {
            const t = (p.pax_type || p.type || '').toUpperCase();
            return ['CHD', 'CNN', 'CHILD', 'INF', 'INFANT'].includes(t);
        });

        // Requirement: If sectors are selected, we MUST ask for those sector fares
        if (sectorIndices && sectorIndices.length > 0) {
            _workflowStep_SectorFareSplit(sectorIndices, selectedPax, mode);
        } else if (selectedPax.length < passengers.length && hasSpecial) {
             _workflowStep_FareSplit(sectorIndices, selectedPax, mode);
        } else if (selectedPax.length < passengers.length) {
             _cancelStep_ConfirmPartial(sectorIndices, selectedPax, null);
        } else {
             _cancelStep_ConfirmFull(sectorIndices, selectedPax);
        }
    } else {
        // MODE CHANGE
        _changeStep_ExtraFares(sectorIndices, selectedPax);
    }
}

function _workflowStep_FareSplit(sectorIndices, selectedPax, mode, sectorFares) {
    const passengers = editedData.passengers || [];
    const fareState = getNormalizedFareState();
    const totalBase = fareState.consolidatedTotals.base;
    const totalK3 = fareState.consolidatedTotals.k3;
    const totalOther = fareState.consolidatedTotals.other;

    let html = `<h3 style="margin-top:0;">\ud83d\udcb0 Fare Split (Unequal)</h3>
    <p style="color:var(--text-secondary);font-size:0.88rem;margin-bottom:1rem;">
        Enter individual share of ORIGINAL fare for each passenger.<br>
        <strong>Total:</strong> Base \u20b9${totalBase.toLocaleString('en-IN')} | K3 \u20b9${totalK3.toLocaleString('en-IN')} | Other \u20b9${totalOther.toLocaleString('en-IN')}
    </p>
    <div style="display:flex;flex-direction:column;gap:0.75rem;">`;

    passengers.forEach((p, i) => {
        const paxType = getPaxLabel(p.pax_type || p.type);
        const isSelected = selectedPax.includes(i);
        const f = p.fare || {};
        const defBase = parseFloat(f.base_fare) || (totalBase / passengers.length);
        const defK3 = parseFloat(f.k3_gst) || (totalK3 / passengers.length);
        const defOther = parseFloat(f.other_taxes) || (totalOther / passengers.length);

        html += `<div style="padding:0.75rem;border-radius:10px;border:1px solid ${isSelected ? 'rgba(37,99,235,0.4)' : 'var(--border)'};background:${isSelected ? 'rgba(37,99,235,0.04)' : 'var(--bg-main)'};">
            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
                <strong>${safe(p.name, 'Passenger ' + (i + 1))}</strong>
                <span style="font-size:0.75rem;color:var(--text-secondary);">(${paxType})</span>
                ${isSelected ? '<span style="color:var(--primary);font-size:0.75rem;font-weight:700;">PROCESSED</span>' : '<span style="color:#10b981;font-size:0.75rem;font-weight:700;">REMAINING</span>'}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;">
                <div class="field-item"><label>Base Fare</label><input type="number" id="split-base-${i}" value="${Math.round(defBase)}" style="font-size:0.85rem;"></div>
                <div class="field-item"><label>K3 GST</label><input type="number" id="split-k3-${i}" value="${Math.round(defK3)}" style="font-size:0.85rem;"></div>
                <div class="field-item"><label>Other Taxes</label><input type="number" id="split-other-${i}" value="${Math.round(defOther)}" style="font-size:0.85rem;"></div>
            </div>
        </div>`;
    });

    html += `</div>
    <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:1.5rem;">
        <button class="btn-action secondary" onclick="_closeModal()">Back</button>
        <button class="btn-action primary" onclick="_onFareSplitNext('${mode}', ${JSON.stringify(sectorIndices).replace(/"/g, '&quot;')}, ${JSON.stringify(selectedPax).replace(/"/g, '&quot;')}, ${sectorFares ? JSON.stringify(sectorFares).replace(/"/g, '&quot;') : 'null'})">Next \u2192</button>
    </div>`;

    _createModalOverlay(html);
}

function _onFareSplitNext(mode, sectorIndices, selectedPax, sectorFares) {
    const passengers = editedData.passengers || [];
    const perPersonFares = [];
    for (let i = 0; i < passengers.length; i++) {
        perPersonFares.push({
            base_fare: parseFloat(document.getElementById('split-base-' + i)?.value) || 0,
            k3_gst: parseFloat(document.getElementById('split-k3-' + i)?.value) || 0,
            other_taxes: parseFloat(document.getElementById('split-other-' + i)?.value) || 0,
        });
    }
    _closeModal();
    if (mode === 'cancel') {
        _cancelStep_ConfirmPartial(sectorIndices, selectedPax, perPersonFares, sectorFares);
    } else {
        _changeStep_ExtraFares(sectorIndices, selectedPax, perPersonFares);
    }
}

function _cancelStep_ConfirmFull(sectorIndices, selectedPax, sectorFares) {
    const hasPersistent = !!editedData.last_aggregator;
    let html = `<h3 style="margin-top:0;color:#ef4444;">\u274c Full Cancellation</h3>
    <p style="color:var(--text-secondary);font-size:0.88rem;">All passengers selected. This will cancel the entire booking.</p>
    <div style="margin:1.5rem 0;display:flex;flex-direction:column;gap:1rem;">
        <div class="field-item">
            <label>Cancellation Charge (XXD)</label>
            <input type="number" id="cancel-charge" value="0" placeholder="Enter cancellation charge" style="font-size:1rem;font-weight:600;">
        </div>
        ${!hasPersistent ? `
        <div class="field-item">
            <label>Add to Ledger (Aggregator)</label>
            <select id="cancel-agg-select" style="padding:0.5rem;border-radius:8px;border:1px solid var(--border);font-family:inherit;font-size:0.88rem;background:var(--bg-main);color:var(--text-primary);">
                <option value="">No ledger entry</option>
            </select>
        </div>
        <div class="field-item">
            <label>Booked By</label>
            <select id="cancel-booking-by" style="padding:0.5rem;border-radius:8px;border:1px solid var(--border);font-family:inherit;font-size:0.88rem;background:var(--bg-main);color:var(--text-primary);">
                <option value="AB">AB</option>
                <option value="CK">CK</option>
            </select>
        </div>` : `<p style="font-size:0.8rem;color:var(--text-secondary);">Reusing existing aggregator and booked-by details.</p>`}
    </div>
    <div style="display:flex;justify-content:flex-end;gap:0.75rem;">
        <button class="btn-action secondary" onclick="_closeModal()">Back</button>
        <button class="btn-action primary" style="background:linear-gradient(135deg,#dc2626,#ef4444);color:white;" onclick="_executeCancel(${JSON.stringify(selectedPax).replace(/"/g, '&quot;')}, true, null, ${JSON.stringify(sectorIndices).replace(/"/g, '&quot;')}, ${sectorFares ? JSON.stringify(sectorFares).replace(/"/g, '&quot;') : 'null'})">Confirm Cancellation</button>
    </div>`;

    const overlay = _createModalOverlay(html);
    if (!hasPersistent) _loadAggregatorsIntoSelect('cancel-agg-select');
}

function _cancelStep_ConfirmPartial(sectorIndices, selectedPax, perPersonFares, sectorFares) {
    const passengers = editedData.passengers || [];
    const cancelledNames = selectedPax.map(i => safe(passengers[i]?.name, 'Passenger ' + (i + 1))).join(', ');
    const remainingCount = passengers.length - selectedPax.length;
    const hasPersistent = !!editedData.last_aggregator;

    let html = `<h3 style="margin-top:0;color:#d97706;">\u2702\ufe0f PNR Split & Partial Cancellation</h3>
    <p style="color:var(--text-secondary);font-size:0.88rem;">
        <strong>${selectedPax.length}</strong> passenger(s) will be split out and cancelled: <strong>${cancelledNames}</strong><br>
        <strong>${remainingCount}</strong> passenger(s) remain on original PNR.
    </p>
    <div style="margin:1.5rem 0;display:flex;flex-direction:column;gap:1rem;">
        <div class="field-item">
            <label>New PNR for Cancelled Passengers</label>
            <input type="text" id="split-new-pnr" placeholder="Enter new PNR (e.g. ABC123)" style="font-size:1rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;">
        </div>
        <div class="field-item">
            <label>Cancellation Charge (XXD)</label>
            <input type="number" id="cancel-charge" value="0" placeholder="Enter cancellation charge" style="font-size:1rem;font-weight:600;">
        </div>
        ${!hasPersistent ? `
        <div class="field-item">
            <label>Add to Ledger (Aggregator)</label>
            <select id="cancel-agg-select" style="padding:0.5rem;border-radius:8px;border:1px solid var(--border);font-family:inherit;font-size:0.88rem;background:var(--bg-main);color:var(--text-primary);">
                <option value="">No ledger entry</option>
            </select>
        </div>
        <div class="field-item">
            <label>Booked By</label>
            <select id="cancel-booking-by" style="padding:0.5rem;border-radius:8px;border:1px solid var(--border);font-family:inherit;font-size:0.88rem;background:var(--bg-main);color:var(--text-primary);">
                <option value="AB">AB</option>
                <option value="CK">CK</option>
            </select>
        </div>` : `<p style="font-size:0.8rem;color:var(--text-secondary);">Reusing existing aggregator and booked-by details.</p>`}
    </div>
    <div style="display:flex;justify-content:flex-end;gap:0.75rem;">
        <button class="btn-action secondary" onclick="_closeModal()">Back</button>
        <button class="btn-action primary" style="background:linear-gradient(135deg,#d97706,#f59e0b);color:white;" onclick="_executeCancel(${JSON.stringify(selectedPax).replace(/"/g, '&quot;')}, false, ${perPersonFares ? JSON.stringify(perPersonFares).replace(/"/g, '&quot;') : 'null'}, ${JSON.stringify(sectorIndices).replace(/"/g, '&quot;')}, ${sectorFares ? JSON.stringify(sectorFares).replace(/"/g, '&quot;') : 'null'})">Confirm Split & Cancel</button>
    </div>`;

    const overlay = _createModalOverlay(html);
    if (!hasPersistent) _loadAggregatorsIntoSelect('cancel-agg-select');
}

// ========== SECTOR-WISE FARE INPUT ==========
function _workflowStep_SectorFareSplit(sectorIndices, selectedPax, mode) {
    const segments = editedData.segments || [];
    const journey = editedData.journey || {};
    const fareState = getNormalizedFareState();
    const totalBase = fareState.consolidatedTotals.base;
    const totalK3 = fareState.consolidatedTotals.k3;
    const totalOther = fareState.consolidatedTotals.other;

    let html = `<h3 style="margin-top:0;">🛑 Sector-wise Refund Details</h3>
    <p style="color:var(--text-secondary);font-size:0.88rem;margin-bottom:1rem;">
        Select fares for the <strong>selected sectors (${sectorIndices.length})</strong> that you want to refund.<br>
        <strong>Total Original PNR Fare:</strong> ₹${(totalBase+totalK3+totalOther).toLocaleString('en-IN')}
    </p>
    <div style="display:flex;flex-direction:column;gap:1rem;">`;

    sectorIndices.forEach(legIdx => {
        let legs;
        if (journey.legs && journey.legs.length > 0) {
            legs = journey.legs.map(leg => leg.segments || []);
        } else {
            legs = groupSegmentsIntoLegs(segments);
        }
        const segIndices = legs[legIdx] || [];
        const firstSeg = segments[segIndices[0]] || {};
        const lastSeg = segments[segIndices[segIndices.length-1]] || {};
        const routeStr = `${(firstSeg.departure||{}).airport} \u2192 ${(lastSeg.arrival||{}).airport}`;

        html += `<div style="padding:1rem; border-radius:12px; background:rgba(37,99,235,0.03); border:1px solid var(--border);">
            <div style="font-weight:700; margin-bottom:0.75rem; color:var(--primary); font-size:1rem;">Sector: ${routeStr}</div>
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:0.75rem;">
                <div class="field-item"><label>Sector Base</label><input type="number" id="sector-base-${legIdx}" value="0"></div>
                <div class="field-item"><label>Sector K3</label><input type="number" id="sector-k3-${legIdx}" value="0"></div>
                <div class="field-item"><label>Sector Other</label><input type="number" id="sector-other-${legIdx}" value="0"></div>
            </div>
        </div>`;
    });

    html += `</div>
    <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:1.5rem;">
        <button class="btn-action secondary" onclick="_closeModal()">Cancel</button>
        <button class="btn-action primary" onclick="_onSectorFareNext('${mode}', ${JSON.stringify(sectorIndices).replace(/"/g, '&quot;')}, ${JSON.stringify(selectedPax).replace(/"/g, '&quot;')})">Next \u2192</button>
    </div>`;

    _createModalOverlay(html);
}

function _onSectorFareNext(mode, sectorIndices, selectedPax) {
    const sectorFares = [];
    sectorIndices.forEach(idx => {
        sectorFares.push({
            leg_idx: idx,
            base_fare: parseFloat(document.getElementById('sector-base-'+idx)?.value) || 0,
            k3_gst: parseFloat(document.getElementById('sector-k3-'+idx)?.value) || 0,
            other_taxes: parseFloat(document.getElementById('sector-other-'+idx)?.value) || 0
        });
    });
    _closeModal();
    
    const passengers = editedData.passengers || [];
    const hasSpecial = passengers.some(p => {
        const t = (p.pax_type || p.type || '').toUpperCase();
        return ['CHD', 'CNN', 'CHILD', 'INF', 'INFANT'].includes(t);
    });

    if (selectedPax.length < passengers.length && hasSpecial) {
         _workflowStep_FareSplit(sectorIndices, selectedPax, mode, sectorFares);
    } else if (selectedPax.length < passengers.length) {
         _cancelStep_ConfirmPartial(sectorIndices, selectedPax, null, sectorFares);
    } else {
         _cancelStep_ConfirmFull(sectorIndices, selectedPax, sectorFares);
    }
}

// ========== CHANGE WORKFLOW STEPS ==========

function _changeStep_ExtraFares(sectorIndices, selectedPax, perPersonFares) {
    const passengers = editedData.passengers || [];
    const isSplit = selectedPax.length < passengers.length;
    const changingNames = selectedPax.map(i => safe(passengers[i]?.name, 'Passenger ' + (i + 1))).join(', ');
    const hasPersistent = !!editedData.last_aggregator;

    let html = `<h3 style="margin-top:0;color:var(--primary);">\ud83d\udd04 Step 3: Change Details</h3>
    <p style="color:var(--text-secondary);font-size:0.88rem;">
        Entering extra amounts for: <strong>${isSplit ? changingNames : 'Whole Booking'}</strong>
    </p>
    <div style="margin:1.5rem 0;display:flex;flex-direction:column;gap:1rem;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.75rem;">
            <div class="field-item"><label>EXTRA Base</label><input type="number" id="change-extra-base" value="0"></div>
            <div class="field-item"><label>EXTRA K3</label><input type="number" id="change-extra-k3" value="0"></div>
            <div class="field-item"><label>EXTRA Other</label><input type="number" id="change-extra-other" value="0"></div>
        </div>
        <div class="field-item">
            <label>Change/Cancellation Charge (XXD)</label>
            <input type="number" id="change-xxd" value="0" placeholder="Enter change charge">
        </div>
        <div class="field-item">
            <label>Upload New Ticket</label>
            <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;">
                <input type="file" id="change-ticket-file" accept=".pdf,.png,.jpg,.jpeg,.webp" style="flex:1;min-width:220px;">
                <button type="button" class="btn-action secondary" onclick="_uploadChangeAttachment()">Upload</button>
            </div>
            <div id="change-upload-status" style="margin-top:0.5rem;font-size:0.8rem;color:var(--text-secondary);">
                ${changeAttachmentState.filename ? `Uploaded: <strong>${changeAttachmentState.filename}</strong>` : 'Upload the revised ticket before confirmation.'}
            </div>
        </div>
        ${isSplit ? `
        <div class="field-item">
            <label>New PNR (optional)</label>
            <input type="text" id="change-new-pnr" placeholder="Leave empty to keep current PNR" style="text-transform:uppercase;letter-spacing:1px;">
        </div>` : ''}
        <div class="field-item">
            <label>Remarks</label>
            <input type="text" id="change-remarks" value="Ticket changed" placeholder="Reason for change">
        </div>
        ${!hasPersistent ? `
        <div class="field-item">
            <label>Add to Ledger (Aggregator)</label>
            <select id="change-agg-select" style="padding:0.5rem;border-radius:8px;border:1px solid var(--border);font-family:inherit;font-size:0.88rem;background:var(--bg-main);color:var(--text-primary);">
                <option value="">No ledger entry</option>
            </select>
        </div>
        <div class="field-item">
            <label>Booked By</label>
            <select id="change-booking-by" style="padding:0.5rem;border-radius:8px;border:1px solid var(--border);font-family:inherit;font-size:0.88rem;background:var(--bg-main);color:var(--text-primary);">
                <option value="AB">AB</option>
                <option value="CK">CK</option>
            </select>
        </div>` : `<p style="font-size:0.8rem;color:var(--text-secondary);">Reusing existing aggregator and booked-by details.</p>`}
    </div>
    <div style="display:flex;justify-content:flex-end;gap:0.75rem;">
        <button class="btn-action secondary" onclick="_closeModal()">Back</button>
        <button class="btn-action primary" onclick="_executeChange(${JSON.stringify(selectedPax).replace(/"/g, '&quot;')}, ${perPersonFares ? JSON.stringify(perPersonFares).replace(/"/g, '&quot;') : 'null'})">Confirm Change</button>
    </div>`;

    const overlay = _createModalOverlay(html);
    if (!hasPersistent) _loadAggregatorsIntoSelect('change-agg-select');
}

async function _uploadChangeAttachment() {
    const input = document.getElementById('change-ticket-file');
    const file = input?.files?.[0];
    if (!file) {
        showToast('Choose the revised ticket file first', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
        const r = await fetch(`/api/tickets/${currentTicket.id}/change-attachment`, {
            method: 'POST',
            body: formData
        });
        const result = await r.json();
        if (!r.ok) {
            showToast(result.error || 'Upload failed', 'error');
            return;
        }
        changeAttachmentState = {
            token: result.attachment_token,
            filename: result.filename
        };
        const status = document.getElementById('change-upload-status');
        if (status) status.innerHTML = `Uploaded: <strong>${result.filename}</strong>`;
        showToast('New ticket uploaded', 'success');
    } catch (e) {
        console.error(e);
        showToast('Upload failed', 'error');
    }
}

function _buildPreviewHtml(summary, actionType) {
    const money = (value) => formatCurrency(parseMoneyValue(value), editedData.currency || 'INR');
    const paxHtml = (summary.affected_passengers || []).map(p => `<div style="padding:0.55rem 0.7rem;border:1px solid var(--border);border-radius:10px;background:var(--bg-main);">
        <div style="font-weight:700;">${p.name}</div>
        <div style="font-size:0.75rem;color:var(--text-secondary);">${p.system_ticket_number || 'No system ID'}</div>
    </div>`).join('');
    const sectorHtml = (summary.affected_sectors || []).map(s => `<div style="padding:0.55rem 0.7rem;border:1px solid var(--border);border-radius:10px;background:var(--bg-main);font-weight:600;">${s}</div>`).join('');
    const bookingsHtml = (summary.resulting_bookings || []).map(b => `<div style="padding:0.75rem;border:1px solid var(--border);border-radius:12px;background:var(--bg-main);">
        <div style="display:flex;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;">
            <strong>${b.label}</strong>
            <span>${b.ticket_status.toUpperCase()}</span>
        </div>
        <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:0.35rem;">PNR: ${b.pnr || 'No PNR'} | Pax: ${b.passenger_count} | Sectors: ${b.sector_count}</div>
        <div style="margin-top:0.35rem;font-weight:700;">${money(b.grand_total)}</div>
    </div>`).join('');

    return `
        <h3 style="margin-top:0;">Preview ${actionType === 'cancel' ? 'Cancellation' : 'Change'}</h3>
        <div style="display:grid;gap:1rem;">
            <div>
                <div style="font-size:0.78rem;color:var(--text-secondary);text-transform:uppercase;font-weight:700;">Scenario</div>
                <div style="font-size:1rem;font-weight:700;margin-top:0.2rem;">${(summary.scenario || '').replace(/_/g, ' + ').toUpperCase()}</div>
            </div>
            <div>
                <div style="font-size:0.78rem;color:var(--text-secondary);text-transform:uppercase;font-weight:700;margin-bottom:0.45rem;">Affected Passengers</div>
                <div style="display:grid;gap:0.5rem;">${paxHtml}</div>
            </div>
            <div>
                <div style="font-size:0.78rem;color:var(--text-secondary);text-transform:uppercase;font-weight:700;margin-bottom:0.45rem;">Affected Sectors</div>
                <div style="display:grid;gap:0.5rem;">${sectorHtml}</div>
            </div>
            <div style="padding:0.9rem;border-radius:14px;background:rgba(37,99,235,0.05);border:1px solid var(--border);">
                <div style="font-weight:700;margin-bottom:0.5rem;">Fare Summary</div>
                <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0.45rem;font-size:0.88rem;">
                    <div>Affected Fare: ${money(summary.affected_fare?.total)}</div>
                    <div>Operation Fee: ${money(summary.fees?.operation_fee)}</div>
                    ${actionType === 'change' ? `<div>Extra Fare: ${money(summary.fees?.extra_fare?.total)}</div>` : ''}
                    <div>${actionType === 'cancel' ? 'Net Refund' : 'Total Collection'}: <strong>${money(actionType === 'cancel' ? summary.financial_impact?.refund_amount : summary.financial_impact?.additional_collection)}</strong></div>
                </div>
            </div>
            <div>
                <div style="font-size:0.78rem;color:var(--text-secondary);text-transform:uppercase;font-weight:700;margin-bottom:0.45rem;">Resulting Bookings</div>
                <div style="display:grid;gap:0.65rem;">${bookingsHtml}</div>
            </div>
        </div>`;
}

function _showOperationPreview(summary, actionType, payload) {
    const confirmLabel = actionType === 'cancel' ? 'Confirm Cancellation' : 'Confirm Change';
    const html = `${_buildPreviewHtml(summary, actionType)}
        <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:1.5rem;">
            <button class="btn-action secondary" onclick="_closeModal()">Back</button>
            <button class="btn-action primary" onclick='_confirmOperation("${actionType}", ${JSON.stringify(payload).replace(/"/g, '&quot;')})'>${confirmLabel}</button>
        </div>`;
    _createModalOverlay(html);
}

async function _confirmOperation(actionType, payload) {
    _closeModal();
    showToast(`Processing ${actionType}...`, 'info');

    try {
        await saveTicket(true);
        const endpoint = actionType === 'cancel' ? 'cancel' : 'change';
        const r = await fetch(`/api/tickets/${currentTicket.id}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await r.json();
        if (!r.ok) {
            showToast(result.error || `${actionType} failed`, 'error');
            return;
        }
        showToast(result.message || `${actionType} completed`, 'success');
        await openTicket(currentTicket.id);
    } catch (e) {
        console.error(e);
        showToast(`${actionType} failed`, 'error');
    }
}

async function _executeChange(selectedPax, perPersonFares) {
    const extraBase = parseFloat(document.getElementById('change-extra-base')?.value) || 0;
    const extraK3 = parseFloat(document.getElementById('change-extra-k3')?.value) || 0;
    const extraOther = parseFloat(document.getElementById('change-extra-other')?.value) || 0;
    const xxdCharge = parseFloat(document.getElementById('change-xxd')?.value) || 0;
    const newPnr = document.getElementById('change-new-pnr')?.value?.toUpperCase() || '';
    const remarks = document.getElementById('change-remarks')?.value || 'Ticket changed';
    const aggId = document.getElementById('change-agg-select')?.value || '';
    const bookingBy = document.getElementById('change-booking-by')?.value || 'AB';

    if (!changeAttachmentState.token) {
        showToast('Upload the new ticket before confirmation', 'error');
        return;
    }

    _closeModal();

    try {
        await saveTicket(true);
        const body = {
            action_type: 'change',
            passenger_indices: selectedPax,
            extra_fare: { base_fare: extraBase, k3_gst: extraK3, other_taxes: extraOther },
            xxd_charge: xxdCharge,
            remarks: remarks,
            per_person_fares: perPersonFares,
            attachment_token: changeAttachmentState.token
        };
        if (aggId) body.aggregator_id = aggId;
        if (bookingBy) body.booking_by = bookingBy;
        if (newPnr) body.new_pnr = newPnr;

        const r = await fetch(`/api/tickets/${currentTicket.id}/operations/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const summary = await r.json();
        if (!r.ok) {
            showToast(summary.error || 'Preview failed', 'error');
            return;
        }
        _showOperationPreview(summary, 'change', body);
    } catch (e) {
        console.error(e);
        showToast('Change preview failed', 'error');
    }
}


async function _loadAggregatorsIntoSelect(selectId) {
    try {
        const r = await fetch('/api/aggregators');
        if (!r.ok) return;
        const d = await r.json();
        const sel = document.getElementById(selectId);
        if (!sel) return;
        let html = '<option value="">No ledger entry</option>';
        (d.aggregators || []).forEach(a => {
            html += `<option value="${a.id}">${a.name}</option>`;
        });
        sel.innerHTML = html;
    } catch (e) { }
}

async function _executeCancel(selectedPax, isFullCancel, perPersonFares, sectorIndices, sectorFares) {
    const charge = parseFloat(document.getElementById('cancel-charge')?.value) || 0;
    const aggId = document.getElementById('cancel-agg-select')?.value || '';
    const bookingBy = document.getElementById('cancel-booking-by')?.value || 'AB';
    const newPnr = document.getElementById('split-new-pnr')?.value?.toUpperCase() || '';

    if (!isFullCancel && !newPnr) {
        showToast('Please enter a new PNR for the split passengers', 'error');
        return;
    }
    try {
        await saveTicket(true);
        const body = {
            action_type: 'cancel',
            passenger_indices: selectedPax,
            cancellation_charge: charge,
            booking_by: bookingBy,
            sector_indices: sectorIndices || [],
            sector_fares: sectorFares || null
        };
        if (aggId) body.aggregator_id = aggId;
        if (newPnr) body.new_pnr = newPnr;
        if (perPersonFares) body.per_person_fares = perPersonFares;

        _closeModal();
        const r = await fetch(`/api/tickets/${currentTicket.id}/operations/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const summary = await r.json();
        if (!r.ok) {
            showToast(summary.error || 'Preview failed', 'error');
            return;
        }
        _showOperationPreview(summary, 'cancel', body);
    } catch (e) {
        console.error(e);
        showToast('Cancellation preview failed', 'error');
    }
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', async () => {
    const initialTicketCards = document.getElementById('ticketCards');
    if (initialTicketCards && !initialTicketCards.querySelector('[data-ticket-id]')) {
        initialTicketCards.innerHTML = '';
    }
    initializeSidebar();
    hydrateUserFromCache();
    hydrateTicketsFromCache();
    void checkAuth();
    await loadNotifications();
    await loadTickets({ limit: INITIAL_TICKETS_BATCH_SIZE, showLoading: allTickets.length === 0 });
    if (!startTicketsRealtime()) {
        startTicketsPolling();
    }
    void syncAllTicketsInBackground();

    const detailView = document.getElementById('detailView');
    if (detailView) {
        detailView.addEventListener('input', (e) => {
            if (!shouldIgnoreDetailAutoSaveTarget(e.target)) {
                lastDetailInputAt = Date.now();
            }
        });
        detailView.addEventListener('change', (e) => {
            if (!shouldIgnoreDetailAutoSaveTarget(e.target)) {
                lastDetailInputAt = Date.now();
                isDetailDirty = true;
                triggerAutoSave();
            }
        });
        detailView.addEventListener('focusout', handleDetailFieldFocusOut);
    }
});

window.addEventListener('beforeunload', () => {
    if (ticketsEventSource) {
        ticketsEventSource.close();
        ticketsEventSource = null;
    }
});

window.addEventListener('online', () => {
    if (currentTicket && isDetailDirty) {
        scheduleDraftRetry(400);
    }
});

function renderActionsSection() {
    const tStatus = editedData.ticket_status || 'live';
    const isCancelled = tStatus === 'cancelled';
    const isMergedView = !!editedData.is_merged_view;

    document.getElementById('actionsSection').innerHTML = `
        <div class="section-header-row"><h2>⚡ Actions</h2></div>
        <div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:center;">
            <div class="pdf-btn-group">
                <button class="pdf-btn with-fare" onclick="downloadPDF(true)">📄 PDF (With Fare)</button>
                <button class="pdf-btn without-fare" onclick="downloadPDF(false)">📄 PDF (Without Fare)</button>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem; background:var(--bg-main); padding:0.5rem 1rem; border-radius:12px; border:1px solid var(--border);">
                <span style="font-size:0.75rem; color:var(--text-secondary); font-weight:700; text-transform:uppercase;">Sheet Export:</span>
                <button class="pdf-btn" style="background: #10b981; color:white; padding: 0.5rem 0.8rem;" onclick="exportToSheet('AB')">📊 AB</button>
                <button class="pdf-btn" style="background: #6366f1; color:white; padding: 0.5rem 0.8rem;" onclick="exportToSheet('CK')">📊 CK</button>
            </div>
            ${!editedData.ledger_hash ? `
            <div id="ledgerBtnGroup" style="display:flex; align-items:center; gap:0.5rem; background:var(--bg-main); padding:0.5rem 1rem; border-radius:12px; border:1px solid var(--border);">
                <span style="font-size:0.75rem; color:var(--text-secondary); font-weight:700; text-transform:uppercase;">Add to Ledger:</span>
                <select id="ledgerAggSelect" style="padding:0.35rem 0.5rem; border-radius:8px; border:1px solid var(--border); font-family:inherit; font-size:0.82rem; background:var(--bg-card); color:var(--text-primary);">
                    <option value="">Loading...</option>
                </select>
                <button class="pdf-btn" style="background: #10b981; color:white; padding: 0.5rem 0.8rem;" onclick="addToLedger('AB')">📒 AB</button>
                <button class="pdf-btn" style="background: #6366f1; color:white; padding: 0.5rem 0.8rem;" onclick="addToLedger('CK')">📒 CK</button>
            </div>` : `
            <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(16,185,129,0.08); padding:0.6rem 1.2rem; border-radius:12px; border:1px solid rgba(16,185,129,0.2);">
                <span style="font-weight:700; color:#10b981;">✅ In Ledger</span>
            </div>`}
            ${!isCancelled ? `
            <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(239,68,68,0.05); padding:0.5rem 1rem; border-radius:12px; border:1px solid rgba(239,68,68,0.2);">
                <button class="pdf-btn" style="background:linear-gradient(135deg,#dc2626,#ef4444); color:white; padding:0.5rem 1rem;" onclick="openCancelModal()">❌ Cancel / Split</button>
                <button class="pdf-btn" style="background:linear-gradient(135deg,#d97706,#f59e0b); color:white; padding:0.5rem 1rem;" onclick="openChangeModal()">🔄 Change</button>
            </div>` : `
            <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(239,68,68,0.08); padding:0.6rem 1.2rem; border-radius:12px; border:1px dashed rgba(239,68,68,0.3);">
                <span style="font-weight:700; color:#ef4444;">🔴 This ticket is cancelled</span>
            </div>`}
            ${isMergedView ? `
            <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(5,150,105,0.08); padding:0.6rem 1.2rem; border-radius:12px; border:1px solid rgba(5,150,105,0.2);">
                <span style="font-weight:700; color:#059669;">Merged booking view. These actions apply to the grouped booking shown here.</span>
            </div>` : ''}
        </div>`;
    loadLedgerAggregators();
}
