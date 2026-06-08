// ==================== STATE ====================
let allTickets = [];
let currentTicket = null;
let currentFilter = 'all';
let selectedTicketIds = new Set();
let ticketSelectionMode = false;
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
let ticketDetailCache = new Map();
let _lastProcessingCount = 0;
let _processingIndicatorMode = 'idle';
let _processingDoneTimeout = null;
let _processingRefreshTimeout = null;
let _processingJustCompleted = false;
let _pendingArrivalToastMessage = '';
let _duplicateAlertTimeout = null;
let _hasLoadedNotificationsOnce = false;
let _lastNotificationFetchAt = 0;           // throttle: ms timestamp of last fetch
const NOTIF_THROTTLE_MS = 30 * 1000;        // don't re-fetch notifications within 30s
let totalAvailableTickets = 0;
let lastFullTicketsSyncAt = 0;
let fullTicketsSyncPromise = null;
let deferredFullSyncHandle = null;
let ticketsEventSource = null;
let realtimeRefreshHandle = null;
let ticketsRealtimeRetryHandle = null;
let isSaveInFlight = false;
let suppressRealtimeUntil = 0;
let ticketEditBaseSnapshot = null;
let dashboardLiveUpdatesPaused = false;
let draftRetryHandle = null;
let hasPendingLocalDraft = false;
let activeSegmentEditIdx = null;
let expandedLegIds = new Set();
let duplicatePanelTickets = [];
let duplicatePanelTotalCount = 0;
let duplicatePanelIsLoadingMore = false;
let dismissedWarningKeys = new Set();
const INITIAL_TICKETS_BATCH_SIZE = 6;
const DUPLICATES_BATCH_SIZE = 6;
const TICKETS_CACHE_KEY = 'ticketsDashboard.topCache.v1';
const DUPLICATES_CACHE_KEY = 'ticketsDashboard.duplicatesCache.v1';
const TICKETS_NOTIFICATIONS_CACHE_KEY = 'ticketsDashboard.notificationsCache.v1';
const TICKETS_AGGREGATORS_CACHE_KEY = 'ticketsDashboard.aggregatorsCache.v1';
const TICKET_DRAFT_CACHE_PREFIX = 'ticketsDashboard.ticketDraft.';
const UNREAD_TICKETS_CACHE_KEY = 'ticketsDashboard.unreadTickets.v1';
const TICKETS_LAST_SEEN_AT_KEY = 'ticketsDashboard.lastSeenAt.v1';
const TICKETS_READ_OVERRIDES_KEY = 'ticketsDashboard.readOverrides.v1';
const TICKETS_BOOT_CACHE_TTL_MS = 60 * 1000;
const TICKETS_AGGREGATORS_CACHE_TTL_MS = 5 * 60 * 1000;
let aggregatorsCache = [];
let aggregatorsCacheFetchedAt = 0;
let aggregatorsCachePromise = null;
const ACTIVE_FIELD_AUTOSAVE_IDLE_MS = 1200;
const TICKETS_REALTIME_RETRY_MS = 5000;
const TICKETS_REALTIME_RETRY_MAX_MS = 30000;
const TICKETS_REALTIME_CHANNEL_NAME = 'tickets_realtime_sync_v1';
const TICKETS_REALTIME_LEADER_KEY = 'tickets_realtime_leader_v1';
const TICKETS_REALTIME_HEARTBEAT_MS = 4000;
const TICKETS_REALTIME_STALE_MS = 12000;
const TICKETS_REALTIME_TAB_ID = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let lastDetailInputAt = 0;
let unreadTicketIds = new Set();
let readOverrideTicketIds = new Set();
let ticketsLastSeenAtMs = 0;
let fareQuickFillDraft = '';
const fareQuickFillDraftByTicket = new Map();
const AIRLINE_CODE_MAP = window.AIRLINE_CODE_MAP || {};
const AIRPORT_CODE_MAP = window.AIRPORT_CODE_MAP || {};
const AIRPORT_GEO_MAP = window.AIRPORT_GEO_MAP || {};
const AIRPORT_TZ_MAP = window.AIRPORT_TZ_MAP || {};
const AIRPORT_GEO_ROUTE_FACTOR = 1.08;
const AIRPORT_GEO_OVERHEAD_MINUTES = 28;
const WEB_CHECKIN_DONE_CACHE_KEY = 'ticketsDashboard.webCheckinDone.v1';
let webCheckinPanelOpen = false;
let webCheckinWindowDays = 7;
let webCheckinExpandedIds = new Set();
let webCheckinDoneByTicket = {};
let webCheckinStatusFilter = 'pending';
let webCheckinFocusedTicketId = null;
let ticketsBroadcastChannel = null;
let ticketsRealtimeIsLeader = false;
let ticketsRealtimeLeaderTimer = null;
let ticketsRealtimeCoordinatorTimer = null;
let ticketsRealtimeClaimTimer = null;
let ticketsRealtimeConfirmTimer = null;
let ticketsRealtimeReconnectTimer = null;
let ticketsRealtimeReconnectBackoffMs = TICKETS_REALTIME_RETRY_MS;
const INDIA_AIRPORT_CODES = new Set([
    'DEL', 'BOM', 'NMI', 'BLR', 'MAA', 'CCU', 'HYD', 'AMD', 'PNQ', 'COK', 'CCJ', 'GOI', 'VTZ',
    'JAI', 'TRV', 'GAU', 'LKO', 'NAG', 'IXC', 'VNS', 'PAT', 'BBI', 'IXB', 'IXR', 'IDR', 'RPR',
    'VGA', 'IXE', 'IXM', 'IXU', 'SXR', 'IXZ', 'IMF', 'DIB', 'JRH', 'IXJ', 'ATQ', 'IXL', 'UDR',
    'BDQ', 'RAJ', 'STV', 'PBD', 'BHJ', 'BHO', 'JLR', 'GWL', 'AGR', 'IXD', 'VDY', 'RJA', 'TIR',
    'BEP', 'HBX', 'IXG', 'GOP', 'DED', 'PGH', 'TNI', 'KUU', 'SHL', 'IXS', 'AJL', 'IXA', 'DMU',
    'CBD', 'IXV', 'CNN', 'TRZ', 'JDH', 'JSA', 'JGA', 'BKB', 'GAY', 'DBG', 'JRG', 'GBI', 'CDP',
    'KJB', 'SDW', 'KBK', 'NDC', 'DPA', 'TEI', 'HDO'
]);

function getInlineSvgIcon(name, className = '') {
    const cssClass = className ? ` class="${className}"` : '';
    const icons = {
        booking: `<svg${cssClass} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3"/><path d="M16 3v3"/><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 14h3"/><path d="M8 17h5"/></svg>`,
        building: `<svg${cssClass} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v14"/><path d="M16 11h2a2 2 0 0 1 2 2v8"/><path d="M8 9h.01"/><path d="M8 13h.01"/><path d="M8 17h.01"/><path d="M12 9h.01"/><path d="M12 13h.01"/><path d="M12 17h.01"/><path d="M10 21v-3h2v3"/></svg>`,
        passengers: `<svg${cssClass} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="3.25"/><path d="M21 21v-2a3.5 3.5 0 0 0-2.6-3.38"/><path d="M15.5 3.8a3.2 3.2 0 0 1 0 6.4"/></svg>`,
        passenger: `<svg${cssClass} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20v-1a5 5 0 0 0-5-5H8a5 5 0 0 0-5 5v1"/><circle cx="10.5" cy="8" r="3.5"/></svg>`,
        fare: `<svg${cssClass} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="M17 6.5c0-1.9-2.2-3.5-5-3.5S7 4.6 7 6.5 9.2 10 12 10s5 1.6 5 3.5-2.2 3.5-5 3.5-5-1.6-5-3.5"/></svg>`,
        actions: `<svg${cssClass} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></svg>`,
        pdf: `<svg${cssClass} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/><path d="M8 13h3"/><path d="M8 17h5"/></svg>`,
        trash: `<svg${cssClass} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`,
        change: `<svg${cssClass} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h13"/><path d="m12 3 4 4-4 4"/><path d="M21 17H8"/><path d="m12 13-4 4 4 4"/></svg>`,
        cancel: `<svg${cssClass} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/></svg>`,
        success: `<svg${cssClass} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg>`,
        warning: `<svg${cssClass} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.8 19a1 1 0 0 0 .87 1.5h16.66A1 1 0 0 0 21.2 19L12 3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
        statusLive: `<svg${cssClass} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>`,
        statusChanged: `<svg${cssClass} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>`,
        statusCancelled: `<svg${cssClass} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>`
    };
    return icons[name] || '';
}

function renderTitleWithIcon(label, iconName) {
    return `<h2 class="title-with-icon">${getInlineSvgIcon(iconName, 'inline-icon')}<span>${label}</span></h2>`;
}

function renderActionLabel(label, iconName) {
    return `<span class="action-label">${getInlineSvgIcon(iconName, 'btn-inline-icon')}<span>${label}</span></span>`;
}

function renderStatusBadge(label, tone) {
    const iconMap = {
        cancelled: 'statusCancelled',
        changed: 'statusChanged',
        live: 'statusLive'
    };
    return `<span class="detail-status-chip ${tone}">${getInlineSvgIcon(iconMap[tone], 'status-inline-icon')}<span>${label}</span></span>`;
}

function hydrateWebCheckinState() {
    try {
        const raw = localStorage.getItem(WEB_CHECKIN_DONE_CACHE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        webCheckinDoneByTicket = parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
        webCheckinDoneByTicket = {};
    }
}

function persistWebCheckinState() {
    try {
        localStorage.setItem(WEB_CHECKIN_DONE_CACHE_KEY, JSON.stringify(webCheckinDoneByTicket || {}));
    } catch (e) {
        console.warn('Failed to persist web check-in state', e);
    }
}

function getPrimaryPassenger(ticket) {
    return (ticket?.passengers || [])[0] || {};
}

function getPassengerLastName(ticket) {
    const name = String(getPrimaryPassenger(ticket)?.name || '').trim();
    if (!name) return 'N/A';
    const parts = name.split(/\s+/).filter(Boolean);
    return parts.length ? parts[parts.length - 1].toUpperCase() : 'N/A';
}

const AIRLINE_WEB_CHECKIN_LINKS = {
  "6E": "https://www.goindigo.in/web-check-in.html",
  "AI": "https://www.airindia.com/in/en/manage/web-checkin.html",
  "IX": "https://www.airindiaexpress.com/checkin-home",
  "SG": "https://book.spicejet.com/CheckIn.aspx",
  "QP": "https://www.akasaair.com/check-in/web-check-in",
  "EK": "https://www.emirates.com/manage-booking/online-check-in/",
  "QR": "https://www.qatarairways.com/en/check-in.html",
  "SQ": "https://www.singaporeair.com/en_UK/us/travel-info/check-in/",
  "EY": "https://www.etihad.com/en/manage/check-in",
  "BA": "https://www.britishairways.com/travel/olcilandingpageauthreq/public/en_gb",
  "LH": "https://www.lufthansa.com/in/en/online-check-in",
  "TG": "https://www.thaiairways.com/en-th/content/check-in/"
};

function isValidWebCheckinTicket(ticket) {
    if (!ticket || !ticket.id) return false;
    if ((ticket.ticket_status || 'live') === 'cancelled') return false;
    return Number.isFinite(getTicketDepartureTimestamp(ticket)) && getHoursUntilDeparture(ticket) >= 0;
}

function getTicketSegmentCodes(ticket) {
    return (ticket?.segments || [])
        .flatMap((segment) => {
            const dep = safe((segment?.departure || {}).airport, '').toString().trim().toUpperCase();
            const arr = safe((segment?.arrival || {}).airport, '').toString().trim().toUpperCase();
            return [dep, arr].filter(Boolean);
        })
        .filter(Boolean);
}

function isDomesticFlight(ticket) {
    const codes = getTicketSegmentCodes(ticket);
    return codes.length > 0 && codes.every((code) => INDIA_AIRPORT_CODES.has(code));
}

function collectUniqueTicketValues(values) {
    const seen = new Set();
    const result = [];
    (values || []).forEach((value) => {
        const text = normalizeAncillaryValue(value);
        if (!text) return;
        const key = text.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        result.push(text);
    });
    return result.length ? result.join(', ') : 'N/A';
}

function getTicketPassengerValues(ticket, fieldName) {
    return (ticket?.passengers || []).map((passenger) => passenger?.[fieldName]);
}

function getTicketFrequentFlyerText(ticket) {
    return collectUniqueTicketValues([
        ...getTicketPassengerValues(ticket, 'frequent_flyer_number'),
        ...(ticket?.frequent_flyer_numbers || []),
        ticket?.frequent_flyer_number
    ]);
}

function getTicketSeatText(ticket) {
    const seatValues = [];
    (ticket?.passengers || []).forEach((passenger) => {
        seatValues.push(passenger?.seat);
        (passenger?.seats || []).forEach((seat) => {
            seatValues.push(typeof seat === 'string' ? seat : seat?.seat_number);
        });
    });
    return collectUniqueTicketValues(seatValues);
}

function getTicketMealText(ticket) {
    const mealValues = [];
    (ticket?.passengers || []).forEach((passenger) => {
        mealValues.push(passenger?.meal);
        (passenger?.meals || []).forEach((meal) => {
            mealValues.push(meal?.name || meal?.code || meal);
        });
    });
    return collectUniqueTicketValues(mealValues);
}

function getTicketFastForwardText(ticket) {
    const directValue = ticket?.fast_forward_express || ticket?.fast_forward || ticket?.express || ticket?.fastForward || ticket?.express_service;
    if (normalizeAncillaryValue(directValue)) return normalizeAncillaryValue(directValue);
    const ancillaryValues = [];
    (ticket?.passengers || []).forEach((passenger) => {
        (passenger?.ancillaries || []).forEach((ancillary) => {
            const name = ancillary?.name || ancillary?.code || ancillary;
            if (!name) return;
            const normalized = String(name).trim();
            if (!normalized) return;
            if (/fast\s*forward|express/i.test(normalized)) ancillaryValues.push(normalized);
        });
    });
    return collectUniqueTicketValues(ancillaryValues);
}

function getTicketTravelDateText(ticket) {
    const firstSeg = (ticket?.segments || [])[0] || {};
    return safe((firstSeg.departure || {}).date, 'N/A');
}

function getTicketLegGroupIndices(ticket) {
    const segments = ticket?.segments || [];
    const journey = ticket?.journey || {};
    if (Array.isArray(journey.legs) && journey.legs.length) {
        const legIndices = journey.legs
            .map((leg) => Array.isArray(leg?.segments) ? leg.segments.filter((idx) => Number.isInteger(idx)) : [])
            .filter((leg) => leg.length > 0);
        if (legIndices.length) return legIndices;
    }
    return groupSegmentsIntoLegs(segments);
}

function formatTicketLegSector(ticket, legIndices, fallbackSegments = [], tripType = '') {
    const segments = ticket?.segments || fallbackSegments;
    if (!segments.length) return '';
    const indices = Array.isArray(legIndices) && legIndices.length ? legIndices : [0];
    const firstSeg = segments[indices[0]] || segments[0] || {};
    const lastSeg = segments[indices[indices.length - 1]] || segments[segments.length - 1] || {};
    const dep = safe((firstSeg.departure || {}).airport, '').trim().toUpperCase();
    const arr = safe((lastSeg.arrival || {}).airport, '').trim().toUpperCase();
    if (!dep && !arr) return '';
    if (!dep) return arr || '';
    if (!arr) return dep || '';
    if (dep === arr) return dep;
    const arrow = tripType === 'round_trip' ? ' ↔ ' : ' -> ';
    return `${dep}${arrow}${arr}`;
}

function getTicketSectorText(ticket) {
    const segments = ticket?.segments || [];
    if (!segments.length) return 'N/A';
    const tripType = ticket?.trip_type || ticket?.journey?.trip_type || '';
    const legTexts = getTicketLegGroupIndices(ticket)
        .map((legIndices) => formatTicketLegSector(ticket, legIndices, segments, tripType))
        .filter(Boolean);
    if (!legTexts.length) {
        const routeLabel = safe(ticket?.route, '').trim();
        return routeLabel || 'N/A';
    }
    if (tripType === 'round_trip') {
        return legTexts[0];
    }
    return legTexts.join(' / ');
}

function buildWebCheckinCopyMessage(ticket) {
    const pnr = safe(ticket?.pnr, 'N/A') || 'N/A';
    const dateOfTravel = getTicketTravelDateText(ticket);
    const sector = getTicketSectorText(ticket);
    const frequentFlyer = getTicketFrequentFlyerText(ticket);
    const seatNo = getTicketSeatText(ticket);
    const meal = getTicketMealText(ticket);
    const fastForward = getTicketFastForwardText(ticket);
    const domesticNote = '*Note: Please carefully check the ticket copy and inform us within an hour if there is any discrepancy in flight timing / date / other particulars*';
    const internationalNote = '*As additional document checks are required, digital boarding passes are currently unavailable. Please collect your boarding pass at the airport.*';

    if (isDomesticFlight(ticket)) {
        return [
            '*Domestic*',
            '',
            `PNR - ${pnr}`,
            '',
            `Date of Travel - ${dateOfTravel}`,
            '',
            `Sector - ${sector}`,
            '',
            `Frequent flyer - ${frequentFlyer}`,
            '',
            `Seat No - ${seatNo}`,
            '',
            `Meal - ${meal}`,
            '',
            `Fast forward / express - ${fastForward}`,
            '',
            domesticNote
        ].join('\n');
    }

    return [
        '*International*',
        '',
        `PNR - ${pnr}`,
        '',
        `Date of Travel - ${dateOfTravel}`,
        '',
        `Sector - ${sector}`,
        '',
        `Frequent flyer - ${frequentFlyer}`,
        '',
        `Seat No - ${seatNo}`,
        '',
        `Meal - ${meal}`,
        '',
        `Fast forward / express - ${fastForward}`,
        '',
        'Web check in - Done',
        '',
        'Boarding pass - Collect at Airport',
        '',
        internationalNote
    ].join('\n');
}

function getTicketDepartureTimestamp(ticket) {
    const firstSeg = (ticket?.segments || [])[0] || {};
    return parseFlightDateTime(firstSeg.departure || {});
}

function getTicketArrivalCode(ticket) {
    const segments = ticket?.segments || [];
    const lastSeg = segments[segments.length - 1] || {};
    return safe((lastSeg.arrival || {}).airport, '---');
}

function getTicketRouteLabel(ticket) {
    const segments = ticket?.segments || [];
    const journey = ticket?.journey || {};
    let legs;
    if (journey.legs && journey.legs.length > 0) {
        legs = journey.legs.map((leg) => leg.segments || []);
    } else {
        legs = groupSegmentsIntoLegs(segments);
    }
    const firstSeg = segments[0] || {};
    const origin = safe((firstSeg.departure || {}).airport, '---');

    if (ticket?.trip_type === 'round_trip' && legs.length >= 2) {
        const outboundLeg = legs[0] || [];
        const outboundLastSeg = segments[outboundLeg[outboundLeg.length - 1]] || segments[0] || {};
        const outboundDestination = safe((outboundLastSeg.arrival || {}).airport, '---');
        return `${origin} ↔ ${outboundDestination}`;
    }

    const lastSeg = segments[segments.length - 1] || {};
    const destination = safe((lastSeg.arrival || {}).airport, '---');
    return `${origin} → ${destination}`;
}

function getTicketFlightMeta(ticket) {
    const firstSeg = (ticket?.segments || [])[0] || {};
    const airline = safe(firstSeg.airline, '').trim();
    const flight = safe(firstSeg.flight_number, '').trim();
    return [airline, flight].filter(Boolean).join(' ');
}

function formatWebCheckinDateTime(ticket) {
    const firstSeg = (ticket?.segments || [])[0] || {};
    const dateText = safe((firstSeg.departure || {}).date, '').trim();
    const timeText = safe((firstSeg.departure || {}).time, '').trim();
    return [dateText, timeText].filter(Boolean).join(' • ') || 'Date unavailable';
}

function getHoursUntilDeparture(ticket) {
    const departureTs = getTicketDepartureTimestamp(ticket);
    if (!Number.isFinite(departureTs)) return Number.POSITIVE_INFINITY;
    return (departureTs - Date.now()) / 3600000;
}

function normalizeAncillaryValue(value) {
    const text = String(safe(value, '')).trim();
    if (!text) return '';
    const upper = text.toUpperCase();
    if (['N/A', 'NA', 'NONE', 'NULL', '-', '--'].includes(upper)) return '';
    return text;
}

function getTicketAncillarySummary(ticket) {
    const passengers = ticket?.passengers || [];
    const seats = new Set();
    const meals = new Set();
    const baggages = new Set();

    passengers.forEach((passenger) => {
        normalizeAncillaryValue(passenger?.baggage) && baggages.add(normalizeAncillaryValue(passenger.baggage));
        normalizeAncillaryValue(passenger?.meal) && meals.add(normalizeAncillaryValue(passenger.meal));
        normalizeAncillaryValue(passenger?.seat) && seats.add(normalizeAncillaryValue(passenger.seat));

        (passenger?.seats || []).forEach((seat) => {
            const value = normalizeAncillaryValue(typeof seat === 'string' ? seat : seat?.seat_number);
            if (value) seats.add(value);
        });
        (passenger?.meals || []).forEach((meal) => {
            const value = normalizeAncillaryValue(meal?.name || meal?.code || meal);
            if (value) meals.add(value);
        });
    });

    const compact = (values) => {
        const list = Array.from(values);
        if (!list.length) return 'Not added';
        if (list.length <= 2) return list.join(', ');
        return `${list.slice(0, 2).join(', ')} +${list.length - 2}`;
    };

    return {
        seat: compact(seats),
        meal: compact(meals),
        baggage: compact(baggages),
        hasSeat: seats.size > 0,
        hasMeal: meals.size > 0,
        hasBaggage: baggages.size > 0
    };
}

function getWebCheckinFlights() {
    const now = Date.now();
    return (allTickets || [])
        .filter((ticket) => ticket && ticket.id)
        .filter((ticket) => (ticket.ticket_status || 'live') !== 'cancelled')
        .map((ticket) => ({ ...ticket, _departureTs: getTicketDepartureTimestamp(ticket) }))
        .filter((ticket) => Number.isFinite(ticket._departureTs) && ticket._departureTs >= now)
        .sort((a, b) => a._departureTs - b._departureTs);
}

function getFlightsWithinHours(hours) {
    return getWebCheckinFlights().filter((ticket) => getHoursUntilDeparture(ticket) <= hours);
}

function getUpcomingFlights(days) {
    const hours = Number(days || webCheckinWindowDays || 7) * 24;
    return getWebCheckinFlights().filter((ticket) => {
        const diff = getHoursUntilDeparture(ticket);
        return diff > 48 && diff <= hours;
    });
}

function filterWebCheckinTicketsByStatus(tickets) {
    return (tickets || []).filter((ticket) => {
        const done = !!webCheckinDoneByTicket[ticket?.id];
        if (webCheckinStatusFilter === 'done') return done;
        if (webCheckinStatusFilter === 'all') return true;
        return !done;
    });
}

function renderWebCheckinEmptyState(message) {
    return `<div class="web-checkin-card-empty">${message}</div>`;
}

function renderWebCheckinCard(ticket, { showOpenButton = false } = {}) {
    const ticketId = safe(ticket?.id, '');
    const expanded = webCheckinExpandedIds.has(ticketId);
    const done = !!webCheckinDoneByTicket[ticketId];
    const lastName = getPassengerLastName(ticket);
    const pnr = safe(ticket?.pnr, 'N/A');
    const pnrCopyValue = JSON.stringify(String(pnr || ''));
    const lastNameCopyValue = JSON.stringify(String(lastName || ''));
    const summary = getTicketAncillarySummary(ticket);
    const hoursUntil = getHoursUntilDeparture(ticket);
    const urgencyText = Number.isFinite(hoursUntil)
        ? (hoursUntil < 1 ? 'Departing soon' : `In ${Math.round(hoursUntil)}h`)
        : 'Upcoming';
    const statusChip = done
        ? '<span class="web-checkin-chip done">Check-in done</span>'
        : '<span class="web-checkin-chip pending">Pending</span>';
    const openButton = showOpenButton
        ? `<button class="mini-btn ghost" onclick="event.stopPropagation(); openWebCheckinTicket('${ticketId}')">Open Ticket</button>`
        : '';
    const expandButton = `
        <button class="web-checkin-expand-btn ${expanded ? 'expanded' : ''}" onclick="event.stopPropagation(); toggleWebCheckinExpanded('${ticketId}')" aria-label="${expanded ? 'Collapse details' : 'Expand details'}">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                <path d="m6 9 6 6 6-6" />
            </svg>
        </button>
    `;
    const openIcon = `
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 5h5v5" />
            <path d="M10 14 19 5" />
            <path d="M19 14v5H5V5h5" />
        </svg>
    `;
    const copyIcon = `
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
    `;

    return `
        <div class="web-checkin-card ${hoursUntil <= 48 ? 'urgent' : ''}" onclick="toggleWebCheckinExpanded('${ticketId}')">
            <div class="web-checkin-card-top">
                <div class="web-checkin-route">
                    <div class="web-checkin-route-row">
                        <strong>${safe(getTicketRouteLabel(ticket))}</strong>
                        <button class="web-checkin-icon-btn" onclick="event.stopPropagation(); openWebCheckinTicket('${ticketId}')" aria-label="Open ticket">${openIcon}</button>
                    </div>
                    <div class="web-checkin-meta">
                        <span class="web-checkin-chip subtle">${safe(formatWebCheckinDateTime(ticket))}</span>
                        ${getTicketFlightMeta(ticket) ? `<span class="web-checkin-chip">${safe(getTicketFlightMeta(ticket))}</span>` : ''}
                        <span class="web-checkin-chip">${safe(urgencyText)}</span>
                    </div>
                </div>
                <div class="web-checkin-top-actions">
                    ${statusChip}
                    ${expandButton}
                </div>
            </div>
            <div class="web-checkin-copy-grid">
                <div class="web-checkin-copy-item">
                    <label>PNR</label>
                    <div class="web-checkin-copy-row">
                        <span>${safe(pnr)}</span>
                        <button class="web-checkin-icon-btn" onclick='event.stopPropagation(); copyWebCheckinValue(${pnrCopyValue}, "PNR copied")' aria-label="Copy PNR">${copyIcon}</button>
                    </div>
                </div>
                <div class="web-checkin-copy-item">
                    <label>Last Name</label>
                    <div class="web-checkin-copy-row">
                        <span>${safe(lastName)}</span>
                        <button class="web-checkin-icon-btn" onclick='event.stopPropagation(); copyWebCheckinValue(${lastNameCopyValue}, "Last name copied")' aria-label="Copy last name">${copyIcon}</button>
                    </div>
                </div>
            </div>
            <div class="web-checkin-actions">
                <button class="mini-btn ${done ? 'done' : 'primary'}" onclick="event.stopPropagation(); handleWebCheckinDone('${ticketId}')">${done ? 'Undo Done' : 'Web Check-in Done'}</button>
                <button class="mini-btn primary" style="padding: 0 0.5rem;" onclick="event.stopPropagation(); openAirlineWebCheckin('${ticketId}')" title="Go to Airline Web Check-in">
                    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;">
                        <line x1="22" y1="2" x2="11" y2="13"></line>
                        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                </button>
                ${openButton}
            </div>
            <div class="web-checkin-expandable ${expanded ? 'open' : ''}">
                <div class="web-checkin-expandable-inner">
                    <div class="web-checkin-summary-grid">
                        <div class="web-checkin-summary-item">
                            <label>Seat</label>
                            <div>${safe(summary.seat)}</div>
                        </div>
                        <div class="web-checkin-summary-item">
                            <label>Meal</label>
                            <div>${safe(summary.meal)}</div>
                        </div>
                        <div class="web-checkin-summary-item">
                            <label>Baggage</label>
                            <div>${safe(summary.baggage)}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderWebCheckinPanel() {
    const body = document.getElementById('webCheckinPanelBody');
    const badge = document.getElementById('webCheckinCountBadge');
    const panel = document.getElementById('webCheckinPanel');
    const overlay = document.getElementById('webCheckinOverlay');
    if (!body || !badge || !panel || !overlay) return;

    const focusedTicket = webCheckinFocusedTicketId ? findTicketById(webCheckinFocusedTicketId) : null;
    const urgentFlights = filterWebCheckinTicketsByStatus(getFlightsWithinHours(48));
    const upcomingFlights = filterWebCheckinTicketsByStatus(getUpcomingFlights(webCheckinWindowDays));
    const badgeCount = getFlightsWithinHours(48).filter((ticket) => !webCheckinDoneByTicket[ticket?.id]).length;

    badge.textContent = String(badgeCount);
    badge.style.display = badgeCount ? 'inline-flex' : 'none';

    body.innerHTML = focusedTicket
        ? `
        <section class="web-checkin-section">
            <div class="web-checkin-section-header">
                <h4>Selected ticket</h4>
                <div class="web-checkin-filter-group">
                    <button class="web-checkin-filter-chip active">Focused</button>
                    <button class="web-checkin-filter-chip" onclick="clearWebCheckinFocus()">Show all</button>
                </div>
            </div>
            <div class="web-checkin-focus-banner">
                This panel is focused on one ticket. Use the card below to mark it done and copy the prepared message.
            </div>
            <div class="web-checkin-list">
                ${renderWebCheckinCard(focusedTicket, { showOpenButton: true })}
            </div>
        </section>`
        : `
        <section class="web-checkin-section">
            <div class="web-checkin-section-header">
                <h4>Flights within 48 hrs</h4>
                <div class="web-checkin-filter-group">
                    <button class="web-checkin-filter-chip ${webCheckinStatusFilter === 'pending' ? 'active' : ''}" onclick="setWebCheckinStatusFilter('pending')">Pending</button>
                    <button class="web-checkin-filter-chip ${webCheckinStatusFilter === 'done' ? 'active' : ''}" onclick="setWebCheckinStatusFilter('done')">Done</button>
                    <button class="web-checkin-filter-chip ${webCheckinStatusFilter === 'all' ? 'active' : ''}" onclick="setWebCheckinStatusFilter('all')">All</button>
                    <span>${urgentFlights.length} found</span>
                </div>
            </div>
            <div class="web-checkin-list">
                ${urgentFlights.length
                    ? urgentFlights.map((ticket) => renderWebCheckinCard(ticket)).join('')
                    : renderWebCheckinEmptyState(`No ${webCheckinStatusFilter} flights in the next 48 hours.`)}
            </div>
        </section>
        <section class="web-checkin-section">
            <div class="web-checkin-section-header">
                <h4>Upcoming flights</h4>
                <div style="display:flex;align-items:center;gap:0.55rem;">
                    <span>${upcomingFlights.length} shown</span>
                    <select class="web-checkin-filter" onchange="setWebCheckinWindow(this.value)">
                        <option value="7" ${Number(webCheckinWindowDays) === 7 ? 'selected' : ''}>7 days</option>
                        <option value="10" ${Number(webCheckinWindowDays) === 10 ? 'selected' : ''}>10 days</option>
                        <option value="15" ${Number(webCheckinWindowDays) === 15 ? 'selected' : ''}>15 days</option>
                        <option value="30" ${Number(webCheckinWindowDays) === 30 ? 'selected' : ''}>30 days</option>
                    </select>
                </div>
            </div>
            <div class="web-checkin-list">
                ${upcomingFlights.length
                    ? upcomingFlights.map((ticket) => renderWebCheckinCard(ticket, { showOpenButton: true })).join('')
                    : renderWebCheckinEmptyState(`No ${webCheckinStatusFilter} upcoming flights in the selected window.`)}
            </div>
        </section>
    `;

    panel.classList.toggle('active', webCheckinPanelOpen);
    overlay.classList.toggle('active', webCheckinPanelOpen);
    panel.setAttribute('aria-hidden', webCheckinPanelOpen ? 'false' : 'true');
    document.body.style.overflow = webCheckinPanelOpen ? 'hidden' : '';
}

function openWebCheckinPanel() {
    webCheckinFocusedTicketId = null;
    webCheckinPanelOpen = true;
    renderWebCheckinPanel();
}

function closeWebCheckinPanel() {
    webCheckinPanelOpen = false;
    renderWebCheckinPanel();
    if (currentTicket && currentTicket.id === webCheckinFocusedTicketId) {
        renderDetailView();
    }
}

function toggleWebCheckinPanel() {
    if (!webCheckinPanelOpen) {
        webCheckinFocusedTicketId = null;
    }
    webCheckinPanelOpen = !webCheckinPanelOpen;
    renderWebCheckinPanel();
}

function clearWebCheckinFocus() {
    webCheckinFocusedTicketId = null;
    renderWebCheckinPanel();
    if (currentTicket) {
        renderDetailView();
    }
}

function toggleWebCheckinExpanded(ticketId) {
    if (!ticketId) return;
    if (webCheckinExpandedIds.has(ticketId)) webCheckinExpandedIds.delete(ticketId);
    else webCheckinExpandedIds.add(ticketId);
    renderWebCheckinPanel();
}

function setWebCheckinWindow(value) {
    const next = Number.parseInt(value, 10);
    webCheckinWindowDays = [7, 10, 15, 30].includes(next) ? next : 7;
    renderWebCheckinPanel();
}

function setWebCheckinStatusFilter(value) {
    webCheckinStatusFilter = ['pending', 'done', 'all'].includes(value) ? value : 'pending';
    renderWebCheckinPanel();
}

async function copyWebCheckinValue(value, successMessage = 'Copied') {
    const text = String(value || '');
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
        } else {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.setAttribute('readonly', '');
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            textArea.style.pointerEvents = 'none';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            const copied = document.execCommand('copy');
            document.body.removeChild(textArea);
            if (!copied) throw new Error('execCommand copy failed');
        }
        showToast(successMessage, 'success');
    } catch (e) {
        showToast('Copy failed', 'error');
    }
}

function toggleWebCheckinDone(ticketId) {
    if (!ticketId) return;
    if (webCheckinDoneByTicket[ticketId]) delete webCheckinDoneByTicket[ticketId];
    else webCheckinDoneByTicket[ticketId] = { done_at: new Date().toISOString() };
    persistWebCheckinState();
    renderWebCheckinPanel();
}

async function handleWebCheckinDone(ticketId) {
    const ticket = findTicketById(ticketId);
    if (!ticket) {
        showToast('Ticket not found', 'error');
        return;
    }
    toggleWebCheckinDone(ticketId);
    await copyWebCheckinValue(buildWebCheckinCopyMessage(ticket), 'Web check-in message copied');
}

function openWebCheckinTicket(ticketId) {
    closeWebCheckinPanel();
    void openTicket(ticketId);
}

async function openFocusedWebCheckinTicket(ticketId) {
    const ticket = findTicketById(ticketId);
    if (!isValidWebCheckinTicket(ticket)) {
        showToast('This ticket is not eligible for web check-in', 'error');
        return;
    }
    webCheckinFocusedTicketId = ticketId;
    webCheckinPanelOpen = true;
    renderWebCheckinPanel();
    if (currentTicket && currentTicket.id === ticketId) {
        renderDetailView();
    }
}

async function openAirlineWebCheckin(ticketId) {
    const ticket = findTicketById(ticketId);
    if (!ticket) return;
    
    const pnr = safe(ticket?.pnr, '').trim();
    if (pnr) {
        // Copy PNR to clipboard automatically first
        try {
            await copyWebCheckinValue(pnr, `PNR ${pnr} copied for check-in!`);
        } catch(e) {
            console.warn('Auto-copy failed', e);
        }
    }

    const firstSeg = (ticket.segments || [])[0] || {};
    
    let airlineCode = '';
    if (firstSeg.flight_number) {
        airlineCode = getFlightNumberAirlineCode(firstSeg.flight_number);
    }
    
    if (!airlineCode && firstSeg.airline) {
        airlineCode = getAirlineCodeForName(firstSeg.airline);
    }
    
    if (!airlineCode) {
        airlineCode = String(firstSeg.airline || '').trim().toUpperCase();
    }
    
    if (airlineCode && AIRLINE_WEB_CHECKIN_LINKS[airlineCode]) {
        window.open(AIRLINE_WEB_CHECKIN_LINKS[airlineCode], '_blank');
    } else {
        const queryName = firstSeg.airline ? String(firstSeg.airline).trim() : (airlineCode || 'airline');
        const query = encodeURIComponent(`${queryName} flight web check in`);
        window.open(`https://www.google.com/search?q=${query}`, '_blank');
    }
}

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
    if (typeof updateParticleVisibility === 'function') {
        updateParticleVisibility(theme);
    }
}

async function updateParticleVisibility(theme) {
    const particles = document.getElementById('tsparticles');
    if (!particles || typeof tsParticles === 'undefined') return;

    if (theme === 'dark') {
        particles.style.display = 'block';
        await tsParticles.load("tsparticles", {
            background: { color: { value: "#020617" } },
            particles: {
                color: { value: ["#38bdf8", "#818cf8", "#c084fc"] },
                links: { color: "#64748b", distance: 150, enable: true, opacity: 0.2, width: 1 },
                move: { enable: true, speed: 0.8 },
                number: { value: 60 },
                opacity: { value: 0.5 },
                size: { value: { min: 1, max: 3 } }
            }
        });
    } else {
        particles.style.display = 'none';
    }
}

// ==================== AUTH ====================
async function checkAuth() {
    try {
        const r = await fetch('/api/user');
        if (!r.ok) { return false; }
        const u = await r.json();
        const nameEl = document.getElementById('sidebarUserName');
        if (nameEl) nameEl.textContent = u.full_name || u.username || 'Guest User';
        const handleEl = document.getElementById('sidebarUserHandle');
        if (handleEl) handleEl.textContent = u.username ? '@' + u.username : '';
        const avatarEl = document.getElementById('sidebarAvatar');
        if (avatarEl) avatarEl.textContent = (u.full_name || u.username || 'U').charAt(0).toUpperCase();
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

    // Server always wins: if server data is newer than the draft, discard the stale draft.
    // This prevents a saved-and-synced or externally-updated ticket from being overwritten
    // by old localStorage data.
    if (currentTicket && currentTicket.updated_at && draft.saved_at) {
        const serverUpdatedMs = new Date(currentTicket.updated_at).getTime();
        if (!isNaN(serverUpdatedMs) && draft.saved_at < serverUpdatedMs) {
            // Draft is from before the server's last save — it's already reflected server-side
            console.info('[draft] Discarding stale draft (saved_at < server updated_at), server data is authoritative.');
            clearTicketDraft(ticketId);
            return false;
        }
    }

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
    if (nameEl) nameEl.textContent = cachedUser.full_name || cachedUser.username || 'Guest User';
    const handleEl = document.getElementById('sidebarUserHandle');
    if (handleEl) handleEl.textContent = cachedUser.username ? '@' + cachedUser.username : '';
    const avatarEl = document.getElementById('sidebarAvatar');
    const avatarSource = cachedUser.full_name || cachedUser.username || '';
    if (avatarEl && avatarSource) avatarEl.textContent = avatarSource.charAt(0).toUpperCase();
}

function getCachedTicketsMeta() {
    return readCachedJson(TICKETS_CACHE_KEY) || {};
}

function hasFreshTicketsCache(maxAgeMs = TICKETS_BOOT_CACHE_TTL_MS) {
    const cachedAt = Number(getCachedTicketsMeta()?.cached_at || 0);
    return cachedAt > 0 && (Date.now() - cachedAt) <= maxAgeMs;
}

function hydrateNotificationsFromCache() {
    const cached = readCachedJson(TICKETS_NOTIFICATIONS_CACHE_KEY);
    if (!cached || typeof cached !== 'object') return false;
    _notifData = {
        merge_count: parseMoneyValue(cached.merge_count),
        merge_groups: Array.isArray(cached.merge_groups) ? cached.merge_groups : [],
        duplicate_count: parseMoneyValue(cached.duplicate_count),
        processing_count: parseMoneyValue(cached.processing_count),
        processing_batches: Array.isArray(cached.processing_batches) ? cached.processing_batches : []
    };
    _updateNotifBadges();
    return true;
}

function hydrateAggregatorsFromCache() {
    const cached = readCachedJson(TICKETS_AGGREGATORS_CACHE_KEY);
    const fetchedAt = Number(cached?.cached_at || 0);
    const items = Array.isArray(cached?.aggregators) ? cached.aggregators : [];
    if (!fetchedAt || !items.length) return false;
    if ((Date.now() - fetchedAt) > TICKETS_AGGREGATORS_CACHE_TTL_MS) return false;
    aggregatorsCache = items;
    aggregatorsCacheFetchedAt = fetchedAt;
    return true;
}

function hasFreshAggregatorsCache() {
    return Array.isArray(aggregatorsCache)
        && aggregatorsCache.length > 0
        && aggregatorsCacheFetchedAt > 0
        && (Date.now() - aggregatorsCacheFetchedAt) <= TICKETS_AGGREGATORS_CACHE_TTL_MS;
}

async function getAggregatorsCached({ force = false } = {}) {
    if (!force && hasFreshAggregatorsCache()) {
        return aggregatorsCache;
    }
    if (!force && aggregatorsCachePromise) {
        return aggregatorsCachePromise;
    }
    aggregatorsCachePromise = (async () => {
        try {
            const r = await fetch('/api/aggregators');
            if (!r.ok) return aggregatorsCache;
            const d = await r.json();
            aggregatorsCache = Array.isArray(d.aggregators) ? d.aggregators : [];
            aggregatorsCacheFetchedAt = Date.now();
            writeCachedJson(TICKETS_AGGREGATORS_CACHE_KEY, {
                cached_at: aggregatorsCacheFetchedAt,
                aggregators: aggregatorsCache
            });
            return aggregatorsCache;
        } catch (e) {
            console.error('Failed to load aggregators', e);
            return aggregatorsCache;
        } finally {
            aggregatorsCachePromise = null;
        }
    })();
    return aggregatorsCachePromise;
}

async function populateAggregatorSelect(selectId, emptyLabel = 'Select aggregator') {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const items = await getAggregatorsCached();
    if (!document.getElementById(selectId)) return;
    let html = `<option value="">${emptyLabel}</option>`;
    (items || []).forEach(a => {
        html += `<option value="${a.id}">${a.name}</option>`;
    });
    sel.innerHTML = html;
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
    const passengerCount = rows.length;
    return {
        base_fare: first.base_fare * passengerCount,
        k3_gst: first.k3_gst * passengerCount,
        other_taxes: first.other_taxes * passengerCount
    };
}

function normalizeTicketFareData(ticket) {
    if (!ticket || typeof ticket !== 'object') return ticket;
    const normalized = JSON.parse(JSON.stringify(ticket));
    normalized.currency = normalizeCurrencyCode(normalized.currency);
    normalized.grand_total = parseMoneyValue(normalized.grand_total);
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

const KNOWN_CURRENCY_CODES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'THB'];

function normalizeCurrencyCode(value) {
    return safe(value, 'INR').toString().trim().toUpperCase() || 'INR';
}

function isKnownCurrencyCode(value) {
    return KNOWN_CURRENCY_CODES.includes(normalizeCurrencyCode(value));
}

function getTicketCurrencyOptionState(value) {
    const normalized = normalizeCurrencyCode(value);
    if (isKnownCurrencyCode(normalized)) {
        return { value: normalized, isCustom: false, customCode: '' };
    }
    return { value: normalized, isCustom: true, customCode: normalized };
}

function formatCurrency(n, curr) {
    let currencyCode = normalizeCurrencyCode(curr);
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

function parseFlexibleFlightDate(value) {
    if (value instanceof Date) {
        return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
    }
    const raw = String(safe(value)).trim();
    if (!raw) return null;

    const monthMap = {
        jan: 0, january: 0,
        feb: 1, february: 1,
        mar: 2, march: 2,
        apr: 3, april: 3,
        may: 4,
        jun: 5, june: 5,
        jul: 6, july: 6,
        aug: 7, august: 7,
        sep: 8, sept: 8, september: 8,
        oct: 9, october: 9,
        nov: 10, november: 10,
        dec: 11, december: 11
    };

    const buildDate = (year, monthIndex, day) => {
        const parsed = new Date(year, monthIndex, day);
        if (
            !Number.isFinite(parsed.getTime()) ||
            parsed.getFullYear() !== year ||
            parsed.getMonth() !== monthIndex ||
            parsed.getDate() !== day
        ) {
            return null;
        }
        return parsed;
    };

    const normalizeYear = (yearText) => {
        const year = Number.parseInt(yearText, 10);
        if (!Number.isFinite(year)) return null;
        if (yearText.length <= 2) return year >= 70 ? 1900 + year : 2000 + year;
        return year;
    };

    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
        return buildDate(Number.parseInt(isoMatch[1], 10), Number.parseInt(isoMatch[2], 10) - 1, Number.parseInt(isoMatch[3], 10));
    }

    const numericMatch = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (numericMatch) {
        return buildDate(
            normalizeYear(numericMatch[3]),
            Number.parseInt(numericMatch[2], 10) - 1,
            Number.parseInt(numericMatch[1], 10)
        );
    }

    const dayMonthTextMatch = raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{2,4})$/);
    if (dayMonthTextMatch) {
        const monthIndex = monthMap[dayMonthTextMatch[2].toLowerCase()];
        if (monthIndex !== undefined) {
            return buildDate(
                normalizeYear(dayMonthTextMatch[3]),
                monthIndex,
                Number.parseInt(dayMonthTextMatch[1], 10)
            );
        }
    }

    const monthDayTextMatch = raw.match(/^([A-Za-z]+)\s+(\d{1,2})\s+(\d{2,4})$/);
    if (monthDayTextMatch) {
        const monthIndex = monthMap[monthDayTextMatch[1].toLowerCase()];
        if (monthIndex !== undefined) {
            return buildDate(
                normalizeYear(monthDayTextMatch[3]),
                monthIndex,
                Number.parseInt(monthDayTextMatch[2], 10)
            );
        }
    }

    const fallback = new Date(raw);
    return Number.isFinite(fallback.getTime()) ? fallback : null;
}

function parseFlexibleFlightTime(value) {
    const raw = String(safe(value)).trim();
    if (!raw) return null;
    const match = raw.match(/^(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?$/);
    if (!match) return null;
    let hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    const meridiem = (match[3] || '').toLowerCase();
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes < 0 || minutes > 59) return null;
    if (meridiem) {
        if (hours < 1 || hours > 12) return null;
        if (meridiem === 'pm' && hours < 12) hours += 12;
        if (meridiem === 'am' && hours === 12) hours = 0;
    }
    if (hours < 0 || hours > 23) return null;
    return { hours, minutes };
}

function formatFlightDateForInput(value) {
    const parsed = parseFlexibleFlightDate(value);
    if (!parsed) return '';
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatFlightDateForStorage(value) {
    const parsed = parseFlexibleFlightDate(value);
    if (!parsed) return String(safe(value)).trim();
    const day = String(parsed.getDate()).padStart(2, '0');
    const month = parsed.toLocaleString('en-US', { month: 'short' });
    const year = String(parsed.getFullYear()).slice(-2);
    return `${day} ${month} ${year}`;
}

function formatTerminalDisplay(value) {
    const terminal = String(safe(value)).trim();
    if (!terminal || terminal === 'N/A') return '';
    if (/^terminal\b/i.test(terminal)) return terminal;
    if (/^t[\s-]?\w+/i.test(terminal)) return terminal;
    return `Terminal ${terminal}`;
}

function doesTerminalNeedConfirmation(value) {
    return !!formatTerminalDisplay(value);
}

function parseFlightDateTime(point) {
    if (!point || typeof point !== 'object') return null;
    const datePart = parseFlexibleFlightDate(point.date);
    const timePart = parseFlexibleFlightTime(point.time);
    if (!datePart || !timePart) return null;
    const combined = new Date(
        datePart.getFullYear(),
        datePart.getMonth(),
        datePart.getDate(),
        timePart.hours,
        timePart.minutes,
        0,
        0
    );
    return Number.isFinite(combined.getTime()) ? combined.getTime() : null;
}

function getAirportTimezoneName(airportCode) {
    const code = safe(airportCode, '').toString().trim().toUpperCase();
    return code ? AIRPORT_TZ_MAP[code] : '';
}

function getTimezoneOffsetMinutes(timeZone, datePart, timePart) {
    if (!timeZone || !datePart || !timePart || typeof Intl === 'undefined' || !Intl.DateTimeFormat) return null;
    try {
        const utcGuess = new Date(Date.UTC(
            datePart.getFullYear(),
            datePart.getMonth(),
            datePart.getDate(),
            timePart.hours,
            timePart.minutes,
            0,
            0
        ));
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        });
        const parts = formatter.formatToParts(utcGuess).reduce((acc, part) => {
            if (part.type !== 'literal') acc[part.type] = part.value;
            return acc;
        }, {});
        const zonedAsUtc = Date.UTC(
            Number.parseInt(parts.year, 10),
            Number.parseInt(parts.month, 10) - 1,
            Number.parseInt(parts.day, 10),
            Number.parseInt(parts.hour, 10),
            Number.parseInt(parts.minute, 10),
            0,
            0
        );
        const offset = Math.round((zonedAsUtc - utcGuess.getTime()) / 60000);
        return Number.isFinite(offset) ? offset : null;
    } catch (e) {
        return null;
    }
}

function parseFlightDateTimeUtcMinutes(point) {
    if (!point || typeof point !== 'object') return null;
    const datePart = parseFlexibleFlightDate(point.date);
    const timePart = parseFlexibleFlightTime(point.time);
    const timeZone = getAirportTimezoneName(point.airport);
    const offsetMinutes = getTimezoneOffsetMinutes(timeZone, datePart, timePart);
    if (!datePart || !timePart || !Number.isFinite(offsetMinutes)) return null;
    const localAsUtcMinutes = Date.UTC(
        datePart.getFullYear(),
        datePart.getMonth(),
        datePart.getDate(),
        timePart.hours,
        timePart.minutes,
        0,
        0
    ) / 60000;
    return localAsUtcMinutes - offsetMinutes;
}

function getElapsedMinutes(startPoint, endPoint) {
    const startUtc = parseFlightDateTimeUtcMinutes(startPoint);
    const endUtc = parseFlightDateTimeUtcMinutes(endPoint);
    let diffMinutes = 0;
    if (Number.isFinite(startUtc) && Number.isFinite(endUtc)) {
        diffMinutes = Math.round(endUtc - startUtc);
    } else {
        const start = parseFlightDateTime(startPoint);
        const end = parseFlightDateTime(endPoint);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
        diffMinutes = Math.round((end - start) / 60000);
    }
    if (diffMinutes <= 0) diffMinutes += 1440;
    return diffMinutes > 0 ? diffMinutes : 0;
}

function areSameFlightCalendarDate(leftValue, rightValue) {
    const left = parseFlexibleFlightDate(leftValue);
    const right = parseFlexibleFlightDate(rightValue);
    return !!left && !!right &&
        left.getFullYear() === right.getFullYear() &&
        left.getMonth() === right.getMonth() &&
        left.getDate() === right.getDate();
}

function getDirectTimezoneElapsedMinutes(startPoint, endPoint) {
    const startUtc = parseFlightDateTimeUtcMinutes(startPoint);
    const endUtc = parseFlightDateTimeUtcMinutes(endPoint);
    if (Number.isFinite(startUtc) && Number.isFinite(endUtc)) return Math.round(endUtc - startUtc);
    const start = parseFlightDateTime(startPoint);
    const end = parseFlightDateTime(endPoint);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
    return Math.round((end - start) / 60000);
}

function formatSignedDurationFromMinutes(totalMinutes) {
    if (!Number.isFinite(totalMinutes)) return '';
    if (totalMinutes === 0) return '0m';
    const prefix = totalMinutes < 0 ? '-' : '';
    return `${prefix}${formatDurationFromMinutes(Math.abs(totalMinutes))}`;
}

function getSegmentDurationMinutes(segment) {
    const explicitMinutes = parseDurationToMinutes(getSegmentDurationValue(segment));
    if (explicitMinutes > 0) return explicitMinutes;
    return getElapsedMinutes(segment?.departure, segment?.arrival);
}

function getSegmentRawDurationMinutes(segment) {
    const departure = segment?.departure || {};
    const arrival = segment?.arrival || {};
    const rawMinutes = getDirectTimezoneElapsedMinutes(departure, arrival);
    return Number.isFinite(rawMinutes) ? rawMinutes : null;
}

function getSegmentTemporalValidation(segment) {
    const rawMinutes = getSegmentRawDurationMinutes(segment);
    if (!Number.isFinite(rawMinutes) || rawMinutes >= 0) return null;
    const departure = segment?.departure || {};
    const arrival = segment?.arrival || {};
    const origin = safe(departure.airport, '').toString().trim().toUpperCase() || '???';
    const destination = safe(arrival.airport, '').toString().trim().toUpperCase() || '???';
    return {
        rawMinutes,
        display: formatSignedDurationFromMinutes(rawMinutes),
        warningMessage: [
            `Arrival is earlier than departure for ${origin} -> ${destination}`,
            `Raw flight duration is ${formatSignedDurationFromMinutes(rawMinutes)}.`,
            'This segment looks invalid unless the arrival date needs to be moved forward.'
        ].join('\n')
    };
}

function doesSegmentDurationNeedWarning(segment) {
    const durationMinutes = getSegmentDurationMinutes(segment);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return false;
    return durationMinutes < 30 || durationMinutes > (20 * 60);
}

function getAirportGeoCoordinate(code) {
    const normalized = safe(code, '').toString().trim().toUpperCase();
    if (!normalized) return null;
    const raw = AIRPORT_GEO_MAP[normalized];
    if (!raw || raw.length !== 2) return null;
    const lat = Number(raw[0]);
    const lon = Number(raw[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
}

function getGreatCircleDistanceKm(originCode, destinationCode) {
    const origin = getAirportGeoCoordinate(originCode);
    const destination = getAirportGeoCoordinate(destinationCode);
    if (!origin || !destination) return null;

    const toRadians = (value) => (value * Math.PI) / 180;
    const deltaLat = toRadians(destination.lat - origin.lat);
    const deltaLon = toRadians(destination.lon - origin.lon);
    const lat1 = toRadians(origin.lat);
    const lat2 = toRadians(destination.lat);
    const a = (Math.sin(deltaLat / 2) ** 2)
        + (Math.cos(lat1) * Math.cos(lat2) * (Math.sin(deltaLon / 2) ** 2));
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return 6371.0088 * c;
}

function getEstimatedFlightSpeedKmh(routeDistanceKm) {
    if (routeDistanceKm < 250) return 380;
    if (routeDistanceKm < 600) return 520;
    if (routeDistanceKm < 1200) return 690;
    if (routeDistanceKm < 2500) return 800;
    return 870;
}

function getGeoDurationToleranceMinutes(greatCircleKm) {
    if (greatCircleKm < 250) return 25;
    if (greatCircleKm < 600) return 35;
    if (greatCircleKm < 1500) return 50;
    if (greatCircleKm < 3000) return 65;
    return 85;
}

function getGeoDurationInvalidToleranceMinutes(greatCircleKm) {
    const baseTolerance = getGeoDurationToleranceMinutes(greatCircleKm);
    if (greatCircleKm < 600) return Math.max(Math.round(baseTolerance * 2.2), 80);
    if (greatCircleKm < 3000) return Math.max(Math.round(baseTolerance * 2.0), 100);
    return Math.max(Math.round(baseTolerance * 1.8), 130);
}

function getGeoWindBufferMinutes(airborneMinutes) {
    if (!Number.isFinite(airborneMinutes) || airborneMinutes <= 0) return 8;
    return Math.max(8, Math.min(Math.round(airborneMinutes * 0.10), 35));
}

function getGeoParserAcceptanceBufferMinutes(estimatedDurationMinutes, greatCircleKm) {
    const baseTolerance = getGeoDurationToleranceMinutes(greatCircleKm);
    const lowerExtraMinutes = Math.max(
        8,
        Math.min(Math.round(estimatedDurationMinutes * 0.09), 22),
        Math.round(baseTolerance * 0.35)
    );
    const upperExtraMinutes = Math.max(
        20,
        Math.min(Math.round(estimatedDurationMinutes * 0.35), 90),
        Math.round(baseTolerance * 1.10)
    );
    return {
        lowerExtraMinutes: Math.max(lowerExtraMinutes, 1),
        upperExtraMinutes: Math.max(upperExtraMinutes, 1)
    };
}

function getSegmentGeoDurationValidation(segment) {
    const existingValidation = segment?.duration_validation;
    if (existingValidation && (existingValidation.status === 'SUSPICIOUS' || existingValidation.status === 'INVALID')) {
        return {
            ...existingValidation,
            warningMessage: existingValidation.warningMessage || existingValidation.warning_message || ''
        };
    }

    const departure = segment?.departure || {};
    const arrival = segment?.arrival || {};
    const origin = safe(departure.airport, '').toString().trim().toUpperCase()
        || safe(segment?.departure_airport, '').toString().trim().toUpperCase();
    const destination = safe(arrival.airport, '').toString().trim().toUpperCase()
        || safe(segment?.arrival_airport, '').toString().trim().toUpperCase();
    const parsedDurationMinutes = parseDurationToMinutes(getSegmentDurationValue(segment));
    if (!origin || !destination || parsedDurationMinutes <= 0) return null;

    const greatCircleKm = getGreatCircleDistanceKm(origin, destination);
    if (!Number.isFinite(greatCircleKm) || greatCircleKm <= 0) return null;

    const routeDistanceKm = greatCircleKm * AIRPORT_GEO_ROUTE_FACTOR;
    const estimatedSpeedKmh = getEstimatedFlightSpeedKmh(routeDistanceKm);
    const airborneMinutes = Math.max(Math.round((routeDistanceKm / estimatedSpeedKmh) * 60), 0);
    const estimatedDurationMinutes = Math.max(airborneMinutes + AIRPORT_GEO_OVERHEAD_MINUTES, 1);
    const windBufferMinutes = getGeoWindBufferMinutes(airborneMinutes);
    const windMinExpectedDurationMinutes = Math.max(estimatedDurationMinutes - windBufferMinutes, 1);
    const windMaxExpectedDurationMinutes = estimatedDurationMinutes + windBufferMinutes;
    const parserBuffer = getGeoParserAcceptanceBufferMinutes(estimatedDurationMinutes, greatCircleKm);
    const minExpectedDurationMinutes = Math.max(windMinExpectedDurationMinutes - parserBuffer.lowerExtraMinutes, 1);
    const maxExpectedDurationMinutes = windMaxExpectedDurationMinutes + parserBuffer.upperExtraMinutes;
    const invalidToleranceMinutes = getGeoDurationInvalidToleranceMinutes(greatCircleKm);
    const invalidMinExpectedDurationMinutes = Math.max(minExpectedDurationMinutes - invalidToleranceMinutes, 1);
    const invalidMaxExpectedDurationMinutes = maxExpectedDurationMinutes + invalidToleranceMinutes;
    let deltaMinutes = 0;
    let comparisonDirection = 'within';
    if (parsedDurationMinutes < minExpectedDurationMinutes) {
        deltaMinutes = minExpectedDurationMinutes - parsedDurationMinutes;
        comparisonDirection = 'lower';
    } else if (parsedDurationMinutes > maxExpectedDurationMinutes) {
        deltaMinutes = parsedDurationMinutes - maxExpectedDurationMinutes;
        comparisonDirection = 'upper';
    }
    const deltaRatio = estimatedDurationMinutes > 0 ? (deltaMinutes / estimatedDurationMinutes) : 0;

    let status = 'OK';
    if (
        parsedDurationMinutes < Math.max(20, Math.round(invalidMinExpectedDurationMinutes * 0.33))
        || parsedDurationMinutes > Math.round(invalidMaxExpectedDurationMinutes * 2.75)
        || parsedDurationMinutes < invalidMinExpectedDurationMinutes
        || parsedDurationMinutes > invalidMaxExpectedDurationMinutes
        || deltaRatio > 0.85
    ) {
        status = 'INVALID';
    } else if (comparisonDirection !== 'within' || deltaRatio > 0.35) {
        status = 'SUSPICIOUS';
    }

    const validation = {
        status,
        origin,
        destination,
        parsedDurationMinutes,
        estimatedDurationMinutes,
        wind_min_expected_duration_minutes: windMinExpectedDurationMinutes,
        wind_max_expected_duration_minutes: windMaxExpectedDurationMinutes,
        min_expected_duration_minutes: minExpectedDurationMinutes,
        max_expected_duration_minutes: maxExpectedDurationMinutes,
        greatCircleKm,
        routeDistanceKm,
        airborneMinutes,
        wind_buffer_minutes: windBufferMinutes,
        lower_parser_buffer_minutes: parserBuffer.lowerExtraMinutes,
        upper_parser_buffer_minutes: parserBuffer.upperExtraMinutes,
        deltaMinutes,
        comparison_direction: comparisonDirection,
        invalid_min_expected_duration_minutes: invalidMinExpectedDurationMinutes,
        invalid_max_expected_duration_minutes: invalidMaxExpectedDurationMinutes
    };
    if (status === 'SUSPICIOUS' || status === 'INVALID') {
        const statusLabel = status === 'INVALID' ? 'Invalid duration' : 'Unusual duration';
        validation.warningMessage = [
            `${statusLabel} for ${origin} -> ${destination}`,
            `Parsed ticket duration: ${formatDurationFromMinutes(parsedDurationMinutes)}`,
            `Estimated normal duration: about ${formatDurationFromMinutes(estimatedDurationMinutes)}`,
            `Wind-adjusted expected range: ${formatDurationFromMinutes(windMinExpectedDurationMinutes)} to ${formatDurationFromMinutes(windMaxExpectedDurationMinutes)}`,
            `Accepted parser range: ${formatDurationFromMinutes(minExpectedDurationMinutes)} to ${formatDurationFromMinutes(maxExpectedDurationMinutes)}`
        ].join('\n');
    }
    return validation;
}

function doesSegmentDateOrderNeedWarning(segment) {
    const departurePoint = segment?.departure || {};
    const arrivalPoint = segment?.arrival || {};
    const departureTs = parseFlightDateTime({ date: departurePoint.date, time: '12:00' });
    const arrivalTs = parseFlightDateTime({ date: arrivalPoint.date, time: '12:00' });
    if (!Number.isFinite(departureTs) || !Number.isFinite(arrivalTs)) return false;
    return arrivalTs < departureTs;
}

function doesSegmentOvernightDateNeedWarning(segment) {
    return !!inferOvernightArrivalAdjustment(segment);
}

function getPnrWarningKey(value) {
    return `pnr:${String(value || '').trim()}`;
}

function getBookingDateWarningKey(value) {
    return `booking-date:${String(value || '').trim()}`;
}

function getPhoneWarningKey(value) {
    return `phone:${String(value || '').trim()}`;
}

function getTicketNumberWarningKey(index, value) {
    return `ticket-number:${index}:${String(value || '').trim()}`;
}

function getSegmentWarningKey(segIdx, kind, segment) {
    const dep = segment?.departure || {};
    const arr = segment?.arrival || {};
    const duration = getSegmentDurationValue(segment);
    let detail = '';
    switch (kind) {
        case 'flight-number':
        case 'airline-code':
            detail = `${safe(segment?.airline)}:${safe(segment?.flight_number)}`;
            break;
        case 'departure-airport':
            detail = `${safe(dep.airport)}:${safe(dep.city)}`;
            break;
        case 'arrival-airport':
            detail = `${safe(arr.airport)}:${safe(arr.city)}`;
            break;
        case 'departure-city':
            detail = `${safe(dep.city)}:${safe(dep.airport)}`;
            break;
        case 'arrival-city':
            detail = `${safe(arr.city)}:${safe(arr.airport)}`;
            break;
        case 'departure-terminal':
            detail = `${safe(dep.terminal)}`;
            break;
        case 'arrival-terminal':
            detail = `${safe(arr.terminal)}`;
            break;
        case 'segment-negative':
            detail = `${safe(dep.airport)}:${safe(dep.date)}:${safe(dep.time)}:${safe(arr.airport)}:${safe(arr.date)}:${safe(arr.time)}`;
            break;
        case 'layover-negative':
            detail = `${safe(dep.airport)}:${safe(dep.date)}:${safe(dep.time)}`;
            break;
        case 'duration':
        case 'duration-geo':
            detail = `${safe(dep.airport)}:${safe(dep.date)}:${safe(dep.time)}:${safe(arr.airport)}:${safe(arr.date)}:${safe(arr.time)}:${safe(duration)}`;
            break;
        default:
            detail = `${safe(dep.date)}:${safe(dep.time)}:${safe(arr.date)}:${safe(arr.time)}:${safe(duration)}`;
            break;
    }
    return `segment:${segIdx}:${kind}:${detail}`;
}

function parseSegmentWarningKey(warningKey) {
    const raw = String(warningKey || '');
    const parts = raw.split(':');
    if (parts.length < 3 || parts[0] !== 'segment') return null;
    const segIdx = Number(parts[1]);
    if (!Number.isInteger(segIdx)) return null;
    return {
        segIdx,
        kind: parts[2]
    };
}

function normalizeAirlineName(value) {
    return safe(value, '')
        .toString()
        .toLowerCase()
        .replace(/&/g, 'and')
        .replace(/air\s+lines?/g, 'airline')
        .replace(/[^a-z0-9]/g, '');
}

function parseFlightNumber(flightNumber) {
    const normalized = safe(flightNumber, '').toString().trim().toUpperCase();
    if (!normalized) return { raw: normalized, airlineCode: '', numberPart: '', isExactMatch: false };
    const match = normalized.match(/^([0-9A-Z]{2,3})\s*-?\s*(\d{1,4}[A-Z]?)$/);
    return {
        raw: normalized,
        airlineCode: match ? match[1] : '',
        numberPart: match ? match[2] : '',
        isExactMatch: !!match
    };
}

function formatFlightNumberValue(flightNumber) {
    const parsed = parseFlightNumber(flightNumber);
    if (parsed.isExactMatch && parsed.airlineCode && parsed.numberPart) {
        return `${parsed.airlineCode} ${parsed.numberPart}`;
    }
    return safe(flightNumber, '').toString().trim().toUpperCase();
}

function getFlightNumberAirlineCode(flightNumber) {
    return parseFlightNumber(flightNumber).airlineCode;
}

function getAirlineCodeForName(airlineName) {
    const normalizedAirlineName = normalizeAirlineName(airlineName);
    if (!normalizedAirlineName) return '';
    const match = Object.entries(AIRLINE_CODE_MAP).find(([, mappedAirlineName]) =>
        normalizeAirlineName(mappedAirlineName) === normalizedAirlineName
    );
    return match ? match[0] : '';
}

function createAirlineUpdateSuggestion(mappedAirlineName) {
    if (!mappedAirlineName) return null;
    return {
        label: 'Yes',
        action: 'update-airline',
        value: mappedAirlineName
    };
}

function createFlightNumberPromptSuggestion(expectedAirlineCode) {
    if (!expectedAirlineCode) return null;
    return {
        label: 'Yes',
        action: 'prompt-flight-number',
        airlineCode: expectedAirlineCode
    };
}

function getFlightNumberWarningMessage(segment) {
    const airlineName = safe(segment?.airline, '').toString().trim();
    const parsedFlightNumber = parseFlightNumber(segment?.flight_number);
    if (!parsedFlightNumber.raw) {
        const airlineCode = getAirlineCodeForName(airlineName);
        const mappedAirlineName = airlineCode ? AIRLINE_CODE_MAP[airlineCode] : '';
        return createWarningPayload(
            'Flight number is required.',
            airlineCode ? {
                suggestionText: `Should we add/update the correct flight number ${airlineCode} for ${mappedAirlineName || airlineName}?`,
                suggestion: createFlightNumberPromptSuggestion(airlineCode)
            } : {}
        );
    }
    if (!parsedFlightNumber.isExactMatch) {
        const airlineCode = getAirlineCodeForName(airlineName);
        const mappedAirlineName = airlineCode ? AIRLINE_CODE_MAP[airlineCode] : '';
        return createWarningPayload(
            'Flight number format looks wrong.',
            airlineCode ? {
                suggestionText: `Should we add/update the correct flight number ${airlineCode} for ${mappedAirlineName || airlineName}?`,
                suggestion: createFlightNumberPromptSuggestion(airlineCode)
            } : {}
        );
    }
    const flightCode = parsedFlightNumber.airlineCode;
    if (!airlineName || !flightCode) return null;
    const mappedAirlineName = AIRLINE_CODE_MAP[flightCode];
    if (!mappedAirlineName) {
        const expectedAirlineCode = getAirlineCodeForName(airlineName);
        const expectedAirlineName = expectedAirlineCode ? AIRLINE_CODE_MAP[expectedAirlineCode] : airlineName;
        return createWarningPayload(
            `Flight number code ${flightCode} is not in our airline database.`,
            expectedAirlineCode ? {
                suggestionText: `Should we add/update the correct flight number ${expectedAirlineCode} for ${expectedAirlineName}?`,
                suggestion: createFlightNumberPromptSuggestion(expectedAirlineCode)
            } : {}
        );
    }
    if (normalizeAirlineName(mappedAirlineName) !== normalizeAirlineName(airlineName)) {
        return createWarningPayload(
            `Flight number code ${flightCode} belongs to ${mappedAirlineName}.`,
            {
                suggestionText: `Should we update airline name to "${mappedAirlineName}"?`,
                suggestion: createAirlineUpdateSuggestion(mappedAirlineName)
            }
        );
    }
    return null;
}

function doesFlightNumberAirlineNeedWarning(segment) {
    return !!getFlightNumberWarningMessage(segment);
}

function getPassengerNameWarningKey(index, value) {
    return `passenger-name:${index}:${String(value || '').trim().toLowerCase()}`;
}

function doesPassengerNameNeedWarning(value) {
    return safe(value, '').toString().trim().toLowerCase() === 'passenger';
}

function normalizeCityName(value) {
    return safe(value, '')
        .toString()
        .toLowerCase()
        .replace(/international|airport|airfield|metro|city/g, ' ')
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function cityNamesMatch(leftCityName, rightCityName) {
    const normalizedLeft = normalizeCityName(leftCityName);
    const normalizedRight = normalizeCityName(rightCityName);
    if (!normalizedLeft || !normalizedRight) return false;
    return normalizedLeft === normalizedRight;
}

function isKnownMappedCityName(cityName) {
    if (!cityName) return false;
    return Object.values(AIRPORT_CODE_MAP).some((mappedCityName) => cityNamesMatch(cityName, mappedCityName));
}

function getAirportCodeForCityName(cityName) {
    const normalizedCityName = normalizeCityName(cityName);
    if (!normalizedCityName) return '';
    const match = Object.entries(AIRPORT_CODE_MAP).find(([, mappedCityName]) =>
        normalizeCityName(mappedCityName) === normalizedCityName
    );
    return match ? match[0] : '';
}

function doesBookingDateNeedWarning(value) {
    const normalized = safe(value, '').toString().trim();
    const warningKey = getBookingDateWarningKey(normalized);
    const invalid = !normalized;
    if (!invalid) clearDismissedWarning(warningKey);
    return invalid && !isWarningDismissed(warningKey);
}

function createCityUpdateSuggestion(mappedCityName) {
    if (!mappedCityName) return null;
    return {
        label: 'Yes',
        action: 'update-city',
        value: mappedCityName
    };
}

function createAirportUpdateSuggestion(airportCode) {
    if (!airportCode) return null;
    return {
        label: 'Yes',
        action: 'update-airport',
        value: airportCode
    };
}

function createDismissWarningSuggestion() {
    return {
        label: 'Yes',
        action: 'dismiss-warning'
    };
}

function getAirportCityValidation(point) {
    const airportCode = safe(point?.airport, '').toString().trim().toUpperCase();
    const cityName = safe(point?.city, '').toString().trim();
    const mappedCityName = airportCode ? AIRPORT_CODE_MAP[airportCode] : '';
    const airportKnown = !!mappedCityName;
    const cityKnown = !!cityName && isKnownMappedCityName(cityName);
    const mappedAirportCode = cityName ? getAirportCodeForCityName(cityName) : '';
    const pairMatches = airportKnown && cityName ? cityNamesMatch(cityName, mappedCityName) : false;

    let airportMessage = null;
    let cityMessage = null;

    if (airportCode && !airportKnown) {
        airportMessage = createWarningPayload(
            cityName
                ? `${airportCode} is not in our airport database for "${cityName}".`
                : `${airportCode} is not in our airport database.`
        );

        if (cityName) {
            cityMessage = createWarningPayload(
                cityKnown
                    ? `"${cityName}" does not match airport code ${airportCode}, and ${airportCode} is not in our database.`
                    : `"${cityName}" should be reviewed because ${airportCode} is not in our airport database.`
            );
        }
    }

    if (airportCode && !airportKnown && cityKnown && mappedAirportCode) {
        airportMessage = createWarningPayload(
            `"${cityName}" does not match airport code ${airportCode}.`,
            {
                suggestionText: `Should we update to "${mappedAirportCode}"?`,
                suggestion: createAirportUpdateSuggestion(mappedAirportCode)
            }
        );
    }

    if (cityName && !cityKnown && !cityMessage) {
        cityMessage = createWarningPayload(
            airportKnown
                ? `"${cityName}" does not match ${airportCode}.`
                : airportCode
                ? `"${cityName}" is not in our city database.`
                : `"${cityName}" is not in our city database.`,
            airportKnown ? {
                suggestionText: `Should we update to "${mappedCityName}"?`,
                suggestion: createCityUpdateSuggestion(mappedCityName)
            } : {}
        );
    }

    if (airportKnown && cityKnown && cityName && !pairMatches) {
        airportMessage = createWarningPayload(
            `${airportCode} is mapped to "${mappedCityName}", not "${cityName}".`,
            {
                suggestionText: `Should we update to "${mappedCityName}"?`,
                suggestion: createCityUpdateSuggestion(mappedCityName)
            }
        );
        cityMessage = createWarningPayload(
            `"${cityName}" does not match ${airportCode}.`,
            {
                suggestionText: `Should we update to "${mappedCityName}"?`,
                suggestion: createCityUpdateSuggestion(mappedCityName)
            }
        );
    }

    return {
        airportCode,
        cityName,
        mappedCityName,
        mappedAirportCode,
        airportKnown,
        cityKnown,
        pairMatches,
        airportMessage,
        cityMessage
    };
}

function getJourneyLayoverMap(journey) {
    const layoverMap = {};
    if (journey?.layovers && journey.layovers.length > 0) {
        journey.layovers.forEach(lo => {
            if (lo && lo.after_segment !== undefined && lo.after_segment !== null) {
                layoverMap[lo.after_segment] = lo;
            }
        });
    }
    return layoverMap;
}

function getLayoverRawMinutes(prevSeg, nextSeg) {
    const prevArrival = prevSeg?.arrival || {};
    const nextDeparture = nextSeg?.departure || {};
    const rawMinutes = getDirectTimezoneElapsedMinutes(prevArrival, nextDeparture);
    return Number.isFinite(rawMinutes) ? rawMinutes : null;
}

function getLayoverValidation(prevSeg, nextSeg) {
    const rawMinutes = getLayoverRawMinutes(prevSeg, nextSeg);
    if (!Number.isFinite(rawMinutes) || rawMinutes >= 0) return null;
    return {
        rawMinutes,
        display: formatSignedDurationFromMinutes(rawMinutes),
        warningMessage: [
            'Invalid layover between connecting segments',
            `Previous arrival is ${formatSignedDurationFromMinutes(rawMinutes)} after the next departure.`,
            'The second segment looks earlier than the first segment arrival instead of a valid connection.'
        ].join('\n')
    };
}

function getLayoverDurationValue(prevSeg, nextSeg, journey, prevSegIdx) {
    const invalidLayover = getLayoverValidation(prevSeg, nextSeg);
    if (invalidLayover) return invalidLayover.display;

    const layoverMap = getJourneyLayoverMap(journey);
    const explicit = [
        layoverMap[prevSegIdx]?.duration,
        nextSeg?.layover,
        nextSeg?.layover_duration,
        prevSeg?.layover,
        prevSeg?.layover_duration
    ].find(value => value && value !== 'N/A' && value !== 'Not Specified');
    if (explicit) return explicit;

    return formatDurationFromMinutes(getElapsedMinutes(prevSeg?.arrival, nextSeg?.departure));
}

function getLayoverDurationMinutes(prevSeg, nextSeg, journey, prevSegIdx) {
    const invalidLayover = getLayoverValidation(prevSeg, nextSeg);
    if (invalidLayover) return 0;
    return parseDurationToMinutes(getLayoverDurationValue(prevSeg, nextSeg, journey, prevSegIdx));
}

function getLegDurationValue(legIndices, segments, journey, legIdx) {
    const safeSegments = segments || [];
    const indices = legIndices || [];
    if (!indices.length) return '';

    let totalMinutes = 0;
    indices.forEach((segIdx) => {
        const seg = safeSegments[segIdx] || {};
        totalMinutes += getSegmentDurationMinutes(seg);
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

function getLegLayoverDurationValue(legIndices, segments, journey) {
    const safeSegments = segments || [];
    let totalMinutes = 0;
    (legIndices || []).forEach((segIdx, pos) => {
        if (pos < legIndices.length - 1) {
            const seg = safeSegments[segIdx] || {};
            const nextSegIdx = legIndices[pos + 1];
            const nextSeg = safeSegments[nextSegIdx] || {};
            totalMinutes += getLayoverDurationMinutes(seg, nextSeg, journey, segIdx);
        }
    });
    return formatDurationFromMinutes(totalMinutes);
}

function getLegTotalDurationValue(legIndices, segments, journey, legIdx) {
    const flightMinutes = parseDurationToMinutes(getLegDurationValue(legIndices, segments, journey, legIdx));
    const layoverMinutes = parseDurationToMinutes(getLegLayoverDurationValue(legIndices, segments, journey));
    return formatDurationFromMinutes(flightMinutes + layoverMinutes);
}

function getJourneyTotalDurationValue(legs, segments, journey) {
    let totalMinutes = 0;
    (legs || []).forEach((legIndices, legIdx) => {
        totalMinutes += parseDurationToMinutes(getLegTotalDurationValue(legIndices, segments, journey, legIdx));
    });
    return formatDurationFromMinutes(totalMinutes);
}

function syncSegmentScheduleFields(segment = {}) {
    if (!segment || typeof segment !== 'object') return segment;

    if (!segment.departure || typeof segment.departure !== 'object') {
        segment.departure = {};
    }
    if (!segment.arrival || typeof segment.arrival !== 'object') {
        segment.arrival = {};
    }

    const fieldPairs = [
        ['departure', 'airport', 'departure_airport'],
        ['departure', 'city', 'departure_city'],
        ['departure', 'date', 'departure_date'],
        ['departure', 'time', 'departure_time'],
        ['departure', 'terminal', 'departure_terminal'],
        ['arrival', 'airport', 'arrival_airport'],
        ['arrival', 'city', 'arrival_city'],
        ['arrival', 'date', 'arrival_date'],
        ['arrival', 'time', 'arrival_time'],
        ['arrival', 'terminal', 'arrival_terminal']
    ];

    fieldPairs.forEach(([pointKey, nestedKey, flatKey]) => {
        const point = segment[pointKey];
        const nestedValue = safe(point?.[nestedKey]).trim();
        const flatValue = safe(segment?.[flatKey]).trim();
        const resolvedValue = nestedValue || flatValue;
        if (resolvedValue) {
            point[nestedKey] = resolvedValue;
            segment[flatKey] = resolvedValue;
        } else {
            point[nestedKey] = '';
            segment[flatKey] = '';
        }
    });

    segment.date = safe(segment.departure?.date || segment.departure_date).trim();
    return segment;
}

function cloneSegmentScheduleSnapshot(segment) {
    const normalizedSegment = syncSegmentScheduleFields(JSON.parse(JSON.stringify(segment || {})));
    const departure = normalizedSegment?.departure || {};
    const arrival = normalizedSegment?.arrival || {};
    return {
        departure_airport: safe(departure.airport).trim(),
        departure_date: safe(departure.date).trim(),
        departure_time: safe(departure.time).trim(),
        arrival_airport: safe(arrival.airport).trim(),
        arrival_date: safe(arrival.date).trim(),
        arrival_time: safe(arrival.time).trim()
    };
}

function didSegmentScheduleChange(beforeSegment, afterSegment) {
    const before = cloneSegmentScheduleSnapshot(beforeSegment);
    const after = cloneSegmentScheduleSnapshot(afterSegment);
    return Object.keys(before).some((key) => before[key] !== after[key]);
}

function addDaysToFlightDate(value, days) {
    const parsed = parseFlexibleFlightDate(value);
    if (!parsed || !Number.isFinite(days) || days === 0) return String(safe(value)).trim();
    parsed.setDate(parsed.getDate() + days);
    return formatFlightDateForStorage(parsed);
}

function inferOvernightArrivalAdjustment(segment) {
    const departure = segment?.departure || {};
    const arrival = segment?.arrival || {};
    const departureTime = parseFlexibleFlightTime(departure.time);
    const arrivalTime = parseFlexibleFlightTime(arrival.time);
    if (!areSameFlightCalendarDate(departure.date, arrival.date) || !departureTime || !arrivalTime) return null;

    const departureMinutes = departureTime.hours * 60 + departureTime.minutes;
    const arrivalMinutes = arrivalTime.hours * 60 + arrivalTime.minutes;
    if (arrivalMinutes >= departureMinutes) return null;

    const directElapsedMinutes = getDirectTimezoneElapsedMinutes(departure, arrival);
    const adjustedElapsedMinutes = getElapsedMinutes(departure, {
        ...arrival,
        date: addDaysToFlightDate(arrival.date, 1)
    });
    if (directElapsedMinutes > 0 || adjustedElapsedMinutes < 30 || adjustedElapsedMinutes > (20 * 60)) {
        return null;
    }

    return {
        fromDate: formatFlightDateForStorage(arrival.date),
        toDate: addDaysToFlightDate(arrival.date, 1),
        duration: formatDurationFromMinutes(adjustedElapsedMinutes)
    };
}

function deriveDayOffsetFromDates(segment) {
    const departurePoint = segment?.departure || {};
    const arrivalPoint = segment?.arrival || {};
    const departureTs = parseFlightDateTime({ date: departurePoint.date, time: '12:00' });
    const arrivalTs = parseFlightDateTime({ date: arrivalPoint.date, time: '12:00' });
    if (!Number.isFinite(departureTs) || !Number.isFinite(arrivalTs)) return null;
    const diffDays = Math.round((arrivalTs - departureTs) / 86400000);
    return diffDays >= 0 ? diffDays : 0;
}

function recalculateSegmentsLocally(segments = []) {
    const updatedSegments = JSON.parse(JSON.stringify(segments || []));
    const layovers = [];
    const adjustments = [];

    updatedSegments.forEach((segment, index) => {
        delete segment.duration_validation;
        syncSegmentScheduleFields(segment);
        const durationMinutes = getElapsedMinutes(segment?.departure, segment?.arrival);
        const durationText = formatDurationFromMinutes(durationMinutes) || getSegmentDurationValue(segment) || 'N/A';
        const explicitDayOffset = deriveDayOffsetFromDates(segment);
        segment.days_offset = explicitDayOffset !== null
            ? explicitDayOffset
            : ((segment?.arrival?.time || '') < (segment?.departure?.time || '') ? 1 : 0);
        segment.duration_calculated = durationText;
        segment.duration_extracted = durationText;
        segment.duration = durationText;

        if (index === 0) {
            segment.layover_duration = 'N/A';
            segment.layover = 'N/A';
            return;
        }

        const prevSegment = updatedSegments[index - 1] || {};
        syncSegmentScheduleFields(prevSegment);
        const layoverText = formatDurationFromMinutes(getElapsedMinutes(prevSegment?.arrival, segment?.departure)) || 'N/A';
        segment.layover_duration = layoverText;
        segment.layover = layoverText;
        layovers.push({
            after_segment: index - 1,
            duration: layoverText,
            at_airport: (segment?.departure?.airport || '').trim().toUpperCase()
        });
    });

    return { segments: updatedSegments, layovers, adjustments };
}

async function refreshEditedSegmentDerivedData() {
    const segmentsPayload = getPersistableSegments(editedData.segments || []);
    try {
        const response = await fetch('/api/tickets/recalculate-segments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ segments: segmentsPayload })
        });
        if (!response.ok) throw new Error('recalculate request failed');
        return await response.json();
    } catch (error) {
        console.error('Segment timing recalculation failed, using local fallback', error);
        return recalculateSegmentsLocally(segmentsPayload);
    }
}

function getSegmentTimingWarningKeys(segIdx, segment) {
    if (!Number.isInteger(segIdx) || !segment || typeof segment !== 'object') return [];
    return ['duration', 'duration-geo', 'date-order', 'day-offset', 'segment-negative', 'layover-negative']
        .map((kind) => getSegmentWarningKey(segIdx, kind, segment))
        .filter(Boolean);
}

function clearSegmentTimingWarnings(segIdx, ...segments) {
    segments.forEach((segment) => {
        getSegmentTimingWarningKeys(segIdx, segment).forEach(clearDismissedWarning);
    });
}

async function recomputeEditedSegmentsDerivedData() {
    const recalculated = await refreshEditedSegmentDerivedData();
    if (Array.isArray(recalculated?.segments)) {
        editedData.segments = recalculated.segments;
    }
    if (!editedData.journey) editedData.journey = {};
    editedData.journey.layovers = Array.isArray(recalculated?.layovers) ? recalculated.layovers : [];
    syncJourneyDerivedDurations();
    return recalculated;
}

function getEditableSegmentSnapshot(segIdx) {
    if (!Number.isInteger(segIdx) || segIdx < 0) return null;
    return JSON.parse(JSON.stringify(editedData?.segments?.[segIdx] || null));
}

function clearScheduleAffectedWarnings(segIdx, beforeSnapshots = [], afterSnapshots = []) {
    const indices = [segIdx - 1, segIdx, segIdx + 1].filter((value) => Number.isInteger(value) && value >= 0);
    indices.forEach((targetIdx) => {
        const beforeSegment = beforeSnapshots[targetIdx];
        const afterSegment = afterSnapshots[targetIdx] ?? editedData?.segments?.[targetIdx];
        clearSegmentTimingWarnings(targetIdx, beforeSegment, afterSegment);
    });
}

function hydrateUnreadTicketsFromCache() {
    const cached = readCachedJson(UNREAD_TICKETS_CACHE_KEY);
    unreadTicketIds = new Set(Array.isArray(cached?.ids) ? cached.ids.filter(Boolean) : []);
}

function hydrateUnreadSeenStateFromCache() {
    const lastSeenRaw = Number(readCachedJson(TICKETS_LAST_SEEN_AT_KEY)?.ts || 0);
    ticketsLastSeenAtMs = Number.isFinite(lastSeenRaw) ? lastSeenRaw : 0;
    const readOverrides = readCachedJson(TICKETS_READ_OVERRIDES_KEY);
    readOverrideTicketIds = new Set(Array.isArray(readOverrides?.ids) ? readOverrides.ids.filter(Boolean) : []);
}

function persistUnreadTickets() {
    writeCachedJson(UNREAD_TICKETS_CACHE_KEY, { ids: Array.from(unreadTicketIds) });
}

function persistUnreadSeenState() {
    writeCachedJson(TICKETS_LAST_SEEN_AT_KEY, { ts: ticketsLastSeenAtMs });
    writeCachedJson(TICKETS_READ_OVERRIDES_KEY, { ids: Array.from(readOverrideTicketIds) });
}

function getTicketCreatedAtMs(ticket) {
    const candidate = ticket?.created_at || ticket?.updated_at || '';
    if (!candidate) return 0;
    const parsed = new Date(candidate);
    const ms = parsed.getTime();
    return Number.isFinite(ms) ? ms : 0;
}

function getNewestTicketTimestampMs(tickets = allTickets) {
    return (tickets || []).reduce((max, ticket) => Math.max(max, getTicketCreatedAtMs(ticket)), 0);
}

function syncUnreadStateFromServer(meta = {}) {
    const serverLastSeenMs = getTicketCreatedAtMs({ created_at: meta?.last_seen_at || '' });
    if (Number.isFinite(serverLastSeenMs) && serverLastSeenMs > 0) {
        ticketsLastSeenAtMs = serverLastSeenMs;
    }
    persistUnreadSeenState();
}

function clearUnreadOverrides({ clearReadOverrides = false } = {}) {
    unreadTicketIds.clear();
    if (clearReadOverrides) {
        readOverrideTicketIds.clear();
    }
    persistUnreadTickets();
    persistUnreadSeenState();
}

function markTicketsUnread(ticketIds = []) {
    let changed = false;
    (ticketIds || []).forEach((ticketId) => {
        if (!ticketId || unreadTicketIds.has(ticketId)) return;
        unreadTicketIds.add(ticketId);
        readOverrideTicketIds.delete(ticketId);
        changed = true;
    });
    if (changed) {
        persistUnreadTickets();
        persistUnreadSeenState();
    }
}

function markTicketRead(ticketId) {
    if (!ticketId) return;
    let changed = false;
    if (unreadTicketIds.has(ticketId)) {
        unreadTicketIds.delete(ticketId);
        changed = true;
    }
    if (!readOverrideTicketIds.has(ticketId)) {
        readOverrideTicketIds.add(ticketId);
        changed = true;
    }
    if (changed) {
        persistUnreadTickets();
        persistUnreadSeenState();
        allTickets = allTickets.map((ticket) => ticket.id === ticketId ? { ...ticket, is_unread: false } : ticket);
        persistTicketsCacheSnapshot();
    }
}

function isTicketUnread(ticketOrId, createdAt = '') {
    const ticketId = typeof ticketOrId === 'object' ? ticketOrId?.id : ticketOrId;
    const createdAtMs = typeof ticketOrId === 'object'
        ? getTicketCreatedAtMs(ticketOrId)
        : getTicketCreatedAtMs({ created_at: createdAt });
    if (!ticketId) return false;
    if (unreadTicketIds.has(ticketId)) return true;
    if (readOverrideTicketIds.has(ticketId)) return false;
    if (typeof ticketOrId === 'object' && typeof ticketOrId?.is_unread === 'boolean') {
        return ticketOrId.is_unread;
    }
    return ticketsLastSeenAtMs > 0 && createdAtMs > ticketsLastSeenAtMs;
}

async function postTicketRead(ticketId) {
    if (!ticketId) return null;
    try {
        const response = await fetch(`/api/tickets/${ticketId}/read`, { method: 'POST' });
        if (!response.ok) return null;
        const payload = await response.json();
        syncUnreadStateFromServer(payload);
        (payload.ticket_ids || []).forEach((id) => {
            unreadTicketIds.delete(id);
        });
        persistUnreadTickets();
        persistUnreadSeenState();
        allTickets = allTickets.map((ticket) => {
            if ((payload.ticket_ids || []).includes(ticket.id)) {
                return { ...ticket, is_unread: false };
            }
            return ticket;
        });
        persistTicketsCacheSnapshot();
        return payload;
    } catch (e) {
        console.error('Failed to mark ticket read', e);
        return null;
    }
}

async function markAllTicketsSeen({ silent = false, render = true } = {}) {
    try {
        const response = await fetch('/api/tickets/mark-all-seen', { method: 'POST' });
        if (!response.ok) return null;
        const payload = await response.json();
        syncUnreadStateFromServer(payload);
        clearUnreadOverrides({ clearReadOverrides: true });
        allTickets = allTickets.map((ticket) => ({ ...ticket, is_unread: false }));
        persistTicketsCacheSnapshot();
        if (render) renderTicketCards();
        if (!silent) showToast('All tickets marked seen', 'success');
        return payload;
    } catch (e) {
        console.error('Failed to mark all tickets seen', e);
        if (!silent) showToast('Failed to mark all tickets seen', 'error');
        return null;
    }
}

function isWarningDismissed(warningKey) {
    return !!warningKey && dismissedWarningKeys.has(warningKey);
}

function dismissWarning(warningKey) {
    if (!warningKey) return;
    dismissedWarningKeys.add(warningKey);
}

function clearDismissedWarning(warningKey) {
    if (!warningKey) return;
    dismissedWarningKeys.delete(warningKey);
}

function clearDismissedWarnings(warningKey) {
    String(warningKey || '').split('||').filter(Boolean).forEach(clearDismissedWarning);
}

function createWarningPayload(message, options = {}) {
    return {
        text: String(message || ''),
        suggestionText: options.suggestionText ? String(options.suggestionText) : '',
        suggestion: options.suggestion || null
    };
}

function parseWarningPayload(rawMessage) {
    if (rawMessage && typeof rawMessage === 'object') {
        return {
            text: String(rawMessage.text || ''),
            suggestionText: String(rawMessage.suggestionText || ''),
            suggestion: rawMessage.suggestion || null
        };
    }
    const raw = String(rawMessage || '');
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && ('text' in parsed || 'suggestion' in parsed)) {
            return {
                text: String(parsed.text || ''),
                suggestionText: String(parsed.suggestionText || ''),
                suggestion: parsed.suggestion || null
            };
        }
    } catch (e) { }
    return { text: raw, suggestionText: '', suggestion: null };
}

function combineWarningPayloads(messages) {
    const parsedMessages = (messages || []).map(parseWarningPayload).filter((item) => item.text);
    if (parsedMessages.length === 0) return '';
    const firstSuggestion = parsedMessages.find((item) => item.suggestion);
    return createWarningPayload(
        parsedMessages.map((item) => item.text).join(' | '),
        firstSuggestion ? {
            suggestionText: firstSuggestion.suggestionText,
            suggestion: firstSuggestion.suggestion
        } : {}
    );
}

function escapeHtmlAttribute(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function renderWarningTextBlock(value) {
    return String(value || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `<div style="margin-bottom:0.35rem;">${escapeHtmlAttribute(line)}</div>`)
        .join('');
}

function buildWarningBadge(warningKey, message) {
    const safeKey = JSON.stringify(String(warningKey || ''));
    const payload = parseWarningPayload(message);
    const serializedMessage = typeof message === 'string' ? message : JSON.stringify(payload);
    const safeMessage = JSON.stringify(String(serializedMessage || ''));
    const title = escapeHtmlAttribute(String(payload.text || serializedMessage).replace(/\s*\n+\s*/g, ' | '));
    return `<button type="button" class="field-warning-badge" title="${title}" onclick='event.stopPropagation(); openWarningReviewModal(${safeKey}, ${safeMessage})'>&#9888;</button>`;
}

function syncJourneyDerivedDurations() {
    const journey = editedData.journey || {};
    const segments = editedData.segments || [];
    const legGroups = groupSegmentsIntoLegs(segments);
    const existingLegs = Array.isArray(journey.legs) ? journey.legs : [];
    const nextJourney = { ...journey };

    nextJourney.legs = legGroups.map((legSegments, legIdx) => {
        const existingLeg = existingLegs[legIdx] || {};
        const firstSeg = segments[legSegments[0]] || {};
        const lastSeg = segments[legSegments[legSegments.length - 1]] || {};
        return {
            ...existingLeg,
            segments: [...legSegments],
            from: (firstSeg.departure || {}).airport || existingLeg.from || '',
            to: (lastSeg.arrival || {}).airport || existingLeg.to || '',
            total_duration: getLegTotalDurationValue(legSegments, segments, nextJourney, legIdx)
        };
    });
    nextJourney.total_journey_duration = getJourneyTotalDurationValue(legGroups, segments, nextJourney);
    editedData.journey = nextJourney;
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

const KNOWN_CABIN_CLASSES = ['Economy', 'Premium Economy', 'Business', 'First'];
const MAX_CONNECTION_LAYOVER_MINUTES = 24 * 60;

function getCabinClassOptionState(segment) {
    const bookingClassValue = getSegmentBookingClassValue(segment);
    if (!bookingClassValue) {
        return { selectValue: '', customValue: '', isCustom: false };
    }
    const knownMatch = KNOWN_CABIN_CLASSES.find((option) => option.toLowerCase() === bookingClassValue.toLowerCase());
    if (knownMatch) {
        return { selectValue: knownMatch, customValue: '', isCustom: false };
    }
    return { selectValue: '__custom__', customValue: bookingClassValue, isCustom: true };
}

// ==================== LEG GROUPING ====================
function shouldSegmentsShareLeg(prevSegment, currentSegment) {
    const prevArrivalAirport = safe((prevSegment?.arrival || {}).airport).trim().toUpperCase();
    const currentDepartureAirport = safe((currentSegment?.departure || {}).airport).trim().toUpperCase();
    if (!prevArrivalAirport || !currentDepartureAirport || prevArrivalAirport !== currentDepartureAirport) {
        return false;
    }

    const layoverMinutes = getElapsedMinutes(prevSegment?.arrival, currentSegment?.departure);
    if (Number.isFinite(layoverMinutes) && layoverMinutes > 0) {
        return layoverMinutes <= MAX_CONNECTION_LAYOVER_MINUTES;
    }

    const layoverText = String(currentSegment?.layover_duration || currentSegment?.layover || '').trim();
    if (!layoverText || layoverText === 'N/A') return true;
    const parsedLayoverMinutes = parseDurationToMinutes(layoverText);
    return !parsedLayoverMinutes || parsedLayoverMinutes <= MAX_CONNECTION_LAYOVER_MINUTES;
}

function groupSegmentsIntoLegs(segments) {
    if (!segments || segments.length === 0) return [];
    const legs = [];
    let currentLeg = [0];
    for (let i = 1; i < segments.length; i++) {
        if (shouldSegmentsShareLeg(segments[i - 1], segments[i])) {
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
    // 1. Always update in-memory map (safe for current session)
    ticketDetailCache.set(normalized.id, normalized);
    // 2. Only persist to localStorage when NOT mid-edit.
    //    If isDetailDirty is true, editedData has unsaved changes that have NOT been
    //    merged back into `ticket` — writing now would create a partial/inconsistent snapshot.
    if (isDetailDirty || hasPendingLocalDraft) {
        return; // Skip localStorage write; in-memory cache is still useful for this session.
    }
    try {
        localStorage.setItem(
            'ticketsDashboard.detail.' + normalized.id,
            JSON.stringify({ t: Date.now(), d: normalized })
        );
    } catch (e) { /* localStorage full — in-memory cache still works */ }
}

/** Evict a ticket's detail from both caches (call on delete or stale-dirty nav). */
function evictTicketDetailCache(ticketId) {
    if (!ticketId) return;
    ticketDetailCache.delete(ticketId);
    try { localStorage.removeItem('ticketsDashboard.detail.' + ticketId); } catch (e) {}
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
    // 1. In-memory detail cache (full data — safe to serve as detail view)
    const fromMemory = ticketDetailCache.get(id);
    if (fromMemory && fromMemory.id === id) return normalizeTicketFareData(fromMemory);
    // 2. localStorage persisted detail (survives page refresh, keyed by ID — no cross-contamination)
    try {
        const raw = localStorage.getItem('ticketsDashboard.detail.' + id);
        if (raw) {
            const entry = JSON.parse(raw);
            if (entry && entry.d && entry.d.id === id) {
                const age = Date.now() - (entry.t || 0);
                if (age < 10 * 60 * 1000) { // 10-min TTL
                    const ticket = normalizeTicketFareData(entry.d);
                    ticketDetailCache.set(id, ticket); // warm in-memory cache
                    return ticket;
                } else {
                    localStorage.removeItem('ticketsDashboard.detail.' + id);
                }
            }
        }
    } catch (e) {}
    // NOTE: Do NOT fall back to allTickets — those are list-view stubs (no barcodes,
    // operations, etc.) and serving them as detail causes dangerous data hazards.
    return null;
}

function hydrateTicketsFromCache() {
    const cached = readCachedJson(TICKETS_CACHE_KEY);
    const cachedTickets = Array.isArray(cached?.tickets) ? cached.tickets.map(normalizeTicketFareData) : [];
    if (!cachedTickets.length) {
        return false;
    }
    allTickets = cachedTickets;
    totalAvailableTickets = Number.isFinite(Number(cached?.total_count)) ? Number(cached.total_count) : cachedTickets.length;
    lastFullTicketsSyncAt = Number.isFinite(Number(cached?.cached_at)) ? Number(cached.cached_at) : 0;
    knownTicketIds = new Set(cachedTickets.map((ticket) => ticket.id).filter(Boolean));
    renderTicketCards();
    return true;
}

function persistTicketsCacheSnapshot() {
    knownTicketIds = new Set((allTickets || []).map((ticket) => ticket?.id).filter(Boolean));
    writeCachedJson(TICKETS_CACHE_KEY, {
        cached_at: Date.now(),
        total_count: totalAvailableTickets,
        tickets: allTickets
    });
}

function upsertTicketInLocalState(ticket, { render = true, prepend = false } = {}) {
    if (!ticket || !ticket.id) return;
    const normalizedTicket = normalizeTicketFareData(ticket);
    const existingIndex = allTickets.findIndex((item) => item?.id === normalizedTicket.id);
    if (existingIndex > -1) {
        allTickets[existingIndex] = normalizedTicket;
    } else if (prepend) {
        allTickets = [normalizedTicket, ...allTickets];
        totalAvailableTickets += 1;
    } else {
        allTickets.push(normalizedTicket);
        totalAvailableTickets += 1;
    }
    cacheTicketDetail(normalizedTicket);
    persistTicketsCacheSnapshot();
    if (render) renderTicketCards();
}

function removeTicketFromLocalState(ticketId, { render = true } = {}) {
    if (!ticketId) return;
    const beforeLength = allTickets.length;
    allTickets = allTickets.filter((ticket) => ticket?.id !== ticketId);
    if (allTickets.length !== beforeLength) {
        totalAvailableTickets = Math.max(0, totalAvailableTickets - 1);
    }
    evictTicketDetailCache(ticketId);
    selectedTicketIds.delete(ticketId);
    unreadTicketIds.delete(ticketId);
    readOverrideTicketIds.delete(ticketId);
    persistUnreadTickets();
    persistUnreadSeenState();
    persistTicketsCacheSnapshot();
    if (render) renderTicketCards();
}

function cachedTicketsAreComplete() {
    const cached = readCachedJson(TICKETS_CACHE_KEY);
    const cachedTickets = Array.isArray(cached?.tickets) ? cached.tickets : [];
    const cachedTotal = Number.isFinite(Number(cached?.total_count)) ? Number(cached.total_count) : cachedTickets.length;
    return cachedTickets.length >= cachedTotal;
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
        const r = await fetch(`/api/tickets${query ? `?${query}` : ''}`);
        if (r.status === 401) {
            window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
            return null;
        }
        if (!r.ok) return null;
        const d = await r.json();
        syncUnreadStateFromServer(d);
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
        // NOTE: Do NOT call cacheTicketDetail on list stubs here. List-view tickets
        // are incomplete (no barcodes, ledger ops, etc.) — persisting them would cause
        // getCachedTicketDetail to serve stale/incomplete data as if it were a full detail.
        writeCachedJson(TICKETS_CACHE_KEY, {
            cached_at: Date.now(),
            total_count: totalAvailableTickets,
            tickets: allTickets
        });
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

let dashboardLoaderHideHandle = null;

function setDashboardUpdatingState(state) {
    const loader = document.getElementById('dashboardLoader');
    if (!loader) return;
    const textEl = loader.querySelector('.loader-text');
    const pulseEl = loader.querySelector('.loader-pulse');
    const doctorEl = loader.querySelector('dotlottie-player');
    
    if (dashboardLoaderHideHandle) {
        clearTimeout(dashboardLoaderHideHandle);
        dashboardLoaderHideHandle = null;
    }

    if (state === true || state === 'updating') {
        loader.style.display = 'flex';
        loader.style.opacity = '1';
        loader.style.transform = 'translateY(0)';
        if (textEl) textEl.textContent = 'Updating Dashboard';
        if (pulseEl) pulseEl.style.display = 'block';
        if (doctorEl) doctorEl.style.display = 'block';
        loader.classList.remove('is-complete');
    } else {
        // Transition to complete state
        if (textEl) textEl.textContent = 'Update Complete';
        if (pulseEl) pulseEl.style.display = 'none';
        if (doctorEl) doctorEl.style.display = 'none';
        loader.classList.add('is-complete');

        // Wait 2 seconds then vanish
        dashboardLoaderHideHandle = setTimeout(() => {
            loader.style.opacity = '0';
            loader.style.transform = 'translateY(5px)';
            dashboardLoaderHideHandle = setTimeout(() => {
                loader.style.display = 'none';
                loader.classList.remove('is-complete');
                dashboardLoaderHideHandle = null;
            }, 400);
        }, 2000);
    }
}

async function syncAllTicketsInBackground({ showLoader = false } = {}) {
    if (fullTicketsSyncPromise) return fullTicketsSyncPromise;
    if (showLoader) {
        setDashboardUpdatingState(true);
    }

    fullTicketsSyncPromise = (async () => {
        try {
            await loadTickets({ render: true, notifyNewTickets: false });
        } finally {
            if (showLoader) {
                setDashboardUpdatingState(false);
            }
        }
    })().finally(() => {
        fullTicketsSyncPromise = null;
    });
    return fullTicketsSyncPromise;
}

function scheduleDeferredFullSync(delayMs = 2500) {
    if (fullTicketsSyncPromise || deferredFullSyncHandle) return;
    deferredFullSyncHandle = setTimeout(() => {
        deferredFullSyncHandle = null;
        void syncAllTicketsInBackground({ showLoader: false });
    }, delayMs);
}

async function syncCurrentTicketFromServer() {
    if (!currentTicket || isSaveInFlight || Date.now() < suppressRealtimeUntil) return;
    const syncTicketId = currentTicket.id;
    const syncStartedAt = Date.now();
    try {
        const r = await fetch('/api/tickets/' + syncTicketId);
        if (!r.ok) return;
        const freshTicket = normalizeTicketFareData(await r.json());

        // Guard: user navigated away or started editing
        if (!currentTicket || currentTicket.id !== syncTicketId || lastDetailInputAt > syncStartedAt) return;

        // If there's a pending dirty draft, only override it if the server has definitively
        // newer data (server updated_at > draft saved_at). This means the last save succeeded
        // server-side and the draft is now stale.
        if (isDetailDirty || isSaveInFlight) {
            if (!hasPendingLocalDraft) return; // user is actively editing, respect that
            const draftKey = getTicketDraftCacheKey(syncTicketId);
            const draft = draftKey ? readCachedJson(draftKey) : null;
            if (draft && draft.saved_at && freshTicket.updated_at) {
                const serverMs = new Date(freshTicket.updated_at).getTime();
                if (!isNaN(serverMs) && draft.saved_at < serverMs) {
                    // Server has newer data than the draft — draft is stale, server wins
                    console.info('[sync] Server has newer data than draft, clearing stale draft.');
                    clearTicketDraft(syncTicketId);
                    hasPendingLocalDraft = false;
                    isDetailDirty = false;
                    // Fall through to update below
                } else {
                    return; // Draft is genuinely ahead of server, keep editing
                }
            } else {
                return; // Can't compare, be safe and keep local state
            }
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

async function reconcileSingleTicketFromServer(ticketId, { prepend = false, openDetail = false } = {}) {
    if (!ticketId) return false;
    try {
        const response = await fetch('/api/tickets/' + ticketId);
        if (!response.ok) return false;
        const freshTicket = normalizeTicketFareData(await response.json());
        upsertTicketInLocalState(freshTicket, { render: true, prepend });
        if (openDetail && currentTicket && currentTicket.id === ticketId && !isDetailDirty && !isSaveInFlight) {
            currentTicket = freshTicket;
            editedData = JSON.parse(JSON.stringify(freshTicket));
            fareFieldsTouched = false;
            setTicketEditBaseline(currentTicket);
            renderDetailView();
        }
        return true;
    } catch (e) {
        console.error('Failed to reconcile single ticket', e);
        return false;
    }
}

function parseTicketsRealtimeMessage(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }
    if (typeof raw === 'object') return raw;
    return null;
}

function ticketsRealtimeReadLeaderState() {
    try {
        return parseTicketsRealtimeMessage(localStorage.getItem(TICKETS_REALTIME_LEADER_KEY));
    } catch (e) {
        return null;
    }
}

function ticketsRealtimeWriteLeaderState(state) {
    try {
        localStorage.setItem(TICKETS_REALTIME_LEADER_KEY, JSON.stringify(state));
        return true;
    } catch (e) {
        return false;
    }
}

function ticketsRealtimeClearLeaderState() {
    try {
        localStorage.removeItem(TICKETS_REALTIME_LEADER_KEY);
    } catch (e) {
        // Ignore storage errors; stale leadership will time out.
    }
}

function ticketsRealtimeIsLeaderStateFresh(state) {
    if (!state || state.tabId === TICKETS_REALTIME_TAB_ID) return true;
    const updatedAt = Number(state.updatedAt || 0);
    return Number.isFinite(updatedAt) && (Date.now() - updatedAt) < TICKETS_REALTIME_STALE_MS;
}

function ticketsRealtimeEnsureChannel() {
    if (!ticketsBroadcastChannel && 'BroadcastChannel' in window) {
        try {
            ticketsBroadcastChannel = new BroadcastChannel(TICKETS_REALTIME_CHANNEL_NAME);
            ticketsBroadcastChannel.onmessage = (event) => ticketsRealtimeHandleBroadcast(event?.data);
        } catch (e) {
            ticketsBroadcastChannel = null;
        }
    }
}

function ticketsRealtimeCloseChannel() {
    if (!ticketsBroadcastChannel) return;
    try {
        ticketsBroadcastChannel.close();
    } catch (e) {
        // Ignore close failures.
    }
    ticketsBroadcastChannel = null;
}

function ticketsRealtimeBroadcast(message) {
    const payload = {
        ...message,
        senderId: TICKETS_REALTIME_TAB_ID,
        timestamp: Date.now(),
    };
    if (ticketsBroadcastChannel) {
        try {
            ticketsBroadcastChannel.postMessage(payload);
            return payload;
        } catch (e) {
            // Fall through to storage-based delivery.
        }
    }
    try {
        localStorage.setItem(TICKETS_REALTIME_CHANNEL_NAME, JSON.stringify(payload));
        localStorage.removeItem(TICKETS_REALTIME_CHANNEL_NAME);
    } catch (e) {
        // If storage is unavailable, the leader tab still works locally.
    }
    return payload;
}

function ticketsRealtimeHandleBroadcast(raw) {
    const message = parseTicketsRealtimeMessage(raw);
    if (!message || message.senderId === TICKETS_REALTIME_TAB_ID) return;

    if (message.type === 'leader-claim') {
        const state = message.state || {};
        if (state.tabId && state.tabId !== TICKETS_REALTIME_TAB_ID) {
            ticketsRealtimeIsLeader = false;
        }
        return;
    }

    if (message.type === 'leader-state') {
        const state = message.state || {};
        if (state.tabId && state.tabId !== TICKETS_REALTIME_TAB_ID) {
            ticketsRealtimeIsLeader = false;
            if (ticketsRealtimeRetryHandle) {
                clearTimeout(ticketsRealtimeRetryHandle);
                ticketsRealtimeRetryHandle = null;
            }
            if (ticketsEventSource) {
                stopTicketsRealtime();
            }
        }
        return;
    }

    if (message.type === 'leader-resigned') {
        ticketsRealtimeCoordinatorTick();
        return;
    }

    if (message.type === 'tickets-event' && message.payload) {
        scheduleRealtimeRefresh(message.payload);
    }
}

function ticketsRealtimeAcquireLeadership() {
  const now = Date.now();
  const current = ticketsRealtimeReadLeaderState();
  if (current && current.tabId !== TICKETS_REALTIME_TAB_ID && ticketsRealtimeIsLeaderStateFresh(current)) {
    return false;
  }
  const state = {
    tabId: TICKETS_REALTIME_TAB_ID,
    updatedAt: now,
    phase: 'claim',
  };
  if (!ticketsRealtimeWriteLeaderState(state)) return false;
  const verify = ticketsRealtimeReadLeaderState();
  if (!verify || verify.tabId !== TICKETS_REALTIME_TAB_ID) return false;
    ticketsRealtimeIsLeader = false;
    ticketsRealtimeBroadcast({ type: 'leader-claim', state });
  return true;
}

function ticketsRealtimeHeartbeat() {
    if (!ticketsRealtimeIsLeader) return false;
    const state = {
        tabId: TICKETS_REALTIME_TAB_ID,
        updatedAt: Date.now(),
    };
    if (!ticketsRealtimeWriteLeaderState(state)) return false;
    ticketsRealtimeBroadcast({ type: 'leader-state', state });
    return true;
}

function ticketsRealtimeReleaseLeadership() {
  if (!ticketsRealtimeIsLeader) return;
  const current = ticketsRealtimeReadLeaderState();
  if (current && current.tabId === TICKETS_REALTIME_TAB_ID) {
    ticketsRealtimeClearLeaderState();
        ticketsRealtimeBroadcast({ type: 'leader-resigned' });
  }
  ticketsRealtimeIsLeader = false;
}

function ticketsRealtimeScheduleClaim() {
    if (ticketsEventSource || ticketsRealtimeClaimTimer || ticketsRealtimeConfirmTimer) return false;
    const delay = Math.floor(Math.random() * 500) + 150;
    ticketsRealtimeClaimTimer = setTimeout(() => {
        ticketsRealtimeClaimTimer = null;
        if (ticketsEventSource || ticketsRealtimeConfirmTimer) return;
        if (!ticketsRealtimeAcquireLeadership()) return;
        ticketsRealtimeConfirmTimer = setTimeout(() => {
            ticketsRealtimeConfirmTimer = null;
            const state = ticketsRealtimeReadLeaderState();
            if (!state || state.tabId !== TICKETS_REALTIME_TAB_ID || state.phase !== 'claim') {
                return;
            }
            const leaderState = {
                tabId: TICKETS_REALTIME_TAB_ID,
                updatedAt: Date.now(),
                phase: 'leader',
            };
            if (!ticketsRealtimeWriteLeaderState(leaderState)) return;
            const verify = ticketsRealtimeReadLeaderState();
            if (!verify || verify.tabId !== TICKETS_REALTIME_TAB_ID) return;
            ticketsRealtimeIsLeader = true;
            ticketsRealtimeBroadcast({ type: 'leader-state', state: leaderState });
            if (!ticketsEventSource) {
                startTicketsRealtime();
            }
        }, 220);
    }, delay);
    return true;
}

function ticketsRealtimeStopCoordinator() {
    if (ticketsRealtimeCoordinatorTimer) {
        clearInterval(ticketsRealtimeCoordinatorTimer);
        ticketsRealtimeCoordinatorTimer = null;
    }
    if (ticketsRealtimeLeaderTimer) {
        clearTimeout(ticketsRealtimeLeaderTimer);
        ticketsRealtimeLeaderTimer = null;
    }
    if (ticketsRealtimeClaimTimer) {
        clearTimeout(ticketsRealtimeClaimTimer);
        ticketsRealtimeClaimTimer = null;
    }
    if (ticketsRealtimeConfirmTimer) {
        clearTimeout(ticketsRealtimeConfirmTimer);
        ticketsRealtimeConfirmTimer = null;
    }
    if (ticketsRealtimeRetryHandle) {
        clearTimeout(ticketsRealtimeRetryHandle);
        ticketsRealtimeRetryHandle = null;
    }
    ticketsRealtimeCloseChannel();
}

function ticketsRealtimeCoordinatorTick() {
    ticketsRealtimeEnsureChannel();
    const leader = ticketsRealtimeReadLeaderState();
    const isSelfLeader = leader && leader.tabId === TICKETS_REALTIME_TAB_ID;

    if (isSelfLeader) {
        if (leader.phase === 'claim') {
            ticketsRealtimeIsLeader = false;
            if (!ticketsRealtimeConfirmTimer && !ticketsEventSource) {
                ticketsRealtimeConfirmTimer = setTimeout(() => {
                    ticketsRealtimeConfirmTimer = null;
                    const latest = ticketsRealtimeReadLeaderState();
                    if (!latest || latest.tabId !== TICKETS_REALTIME_TAB_ID || latest.phase !== 'claim') return;
                    const leaderState = {
                        tabId: TICKETS_REALTIME_TAB_ID,
                        updatedAt: Date.now(),
                        phase: 'leader',
                    };
                    if (!ticketsRealtimeWriteLeaderState(leaderState)) return;
                    const verify = ticketsRealtimeReadLeaderState();
                    if (!verify || verify.tabId !== TICKETS_REALTIME_TAB_ID) return;
                    ticketsRealtimeIsLeader = true;
                    ticketsRealtimeBroadcast({ type: 'leader-state', state: leaderState });
                    startTicketsRealtime();
                }, 220);
            }
            return;
        }
        ticketsRealtimeIsLeader = true;
        if (!ticketsEventSource) {
            startTicketsRealtime();
        } else {
            ticketsRealtimeHeartbeat();
        }
        return;
    }

    ticketsRealtimeIsLeader = false;
    if (ticketsEventSource) {
      stopTicketsRealtime();
    }
    if (!leader || !ticketsRealtimeIsLeaderStateFresh(leader)) {
        ticketsRealtimeScheduleClaim();
    }
}

function ticketsRealtimeStartCoordinator() {
    ticketsRealtimeEnsureChannel();
    if (ticketsRealtimeCoordinatorTimer) return;
    ticketsRealtimeCoordinatorTimer = setInterval(ticketsRealtimeCoordinatorTick, TICKETS_REALTIME_HEARTBEAT_MS);
    ticketsRealtimeLeaderTimer = setTimeout(() => {
        ticketsRealtimeLeaderTimer = null;
        ticketsRealtimeCoordinatorTick();
    }, Math.floor(Math.random() * 500) + 100);
}

function restartTicketsRealtime() {
    if (!('EventSource' in window)) return false;
    ticketsRealtimeStartCoordinator();
    ticketsRealtimeCoordinatorTick();
    return !!ticketsEventSource || ticketsRealtimeIsLeader;
}

function scheduleRealtimeRefresh(payload = {}) {
    // Directly apply embedded notification data — no fetch needed
    if (payload.notifications) {
        _notifData = payload.notifications;
        writeCachedJson(TICKETS_NOTIFICATIONS_CACHE_KEY, _notifData);
        _updateNotifBadges();
        _lastNotificationFetchAt = Date.now(); // counts as a notification fetch
    }
    if (payload.event === 'connected') return;

    const eventType = payload.event || '';
    const payloadTicketId = payload.ticket_id || '';
    const isOwnSuppressedUpdate = eventType === 'ticket_updated' && Date.now() < suppressRealtimeUntil;

    if (isOwnSuppressedUpdate) {
        return;
    }

    if (payloadTicketId && eventType === 'ticket_deleted') {
        removeTicketFromLocalState(payloadTicketId, { render: true });
        if (currentTicket && currentTicket.id === payloadTicketId) {
            void showListView({ syncUrl: true, replaceUrl: true });
        }
        return;
    }

    if (payloadTicketId && ['ticket_updated', 'ticket_created', 'duplicate_approved'].includes(eventType)) {
        if (!isDetailDirty && !isSaveInFlight && Date.now() >= suppressRealtimeUntil) {
            void reconcileSingleTicketFromServer(payloadTicketId, {
                prepend: eventType === 'ticket_created' || eventType === 'duplicate_approved',
                openDetail: true
            });
            return;
        }
    }

    // Sync current open ticket if this event targets it
    if (payloadTicketId && currentTicket && currentTicket.id === payloadTicketId) {
        if (!isDetailDirty && !isSaveInFlight && Date.now() >= suppressRealtimeUntil) {
            void syncCurrentTicketFromServer();
        }
    }

    // Debounce the dashboard refresh — 2s window collapses rapid bursts
    clearTimeout(realtimeRefreshHandle);
    realtimeRefreshHandle = setTimeout(async () => {
        try {
            const isNewTicket = eventType === 'ticket_created';
            const shouldRefreshNotifications = ['ticket_created', 'ticket_deleted', 'duplicate_approved', 'duplicate_rejected', 'dashboard_refresh'].includes(eventType);
            const notifStale = shouldRefreshNotifications && (Date.now() - _lastNotificationFetchAt) > NOTIF_THROTTLE_MS;

            // Only fetch notifications if throttle window has expired
            if (notifStale) {
                void loadNotifications();
            }

            // Always load the first page to surface new/updated tickets
            const snapshot = await loadTickets({ limit: INITIAL_TICKETS_BATCH_SIZE, render: true, notifyNewTickets: isNewTicket });

            // Full sync only when a new ticket arrived or list is incomplete
            if (snapshot && (isNewTicket || allTickets.length < totalAvailableTickets)) {
                scheduleDeferredFullSync(1200);
            }
        } catch (e) {
            console.error('Realtime refresh failed', e);
        }
    }, 2000); // 2-second debounce
}

function startTicketsRealtime() {
    if (dashboardLiveUpdatesPaused) return false;
    if (!('EventSource' in window)) return false;
    ticketsRealtimeEnsureChannel();
    if (ticketsEventSource) {
        if (ticketsEventSource.readyState !== EventSource.CLOSED) return false;
        stopTicketsRealtime();
    }
    const leader = ticketsRealtimeReadLeaderState();
    if (!leader || leader.tabId !== TICKETS_REALTIME_TAB_ID || leader.phase !== 'leader') {
        return false;
    }
    if (ticketsRealtimeRetryHandle) {
        clearTimeout(ticketsRealtimeRetryHandle);
        ticketsRealtimeRetryHandle = null;
    }
    try {
        const stream = new EventSource('/api/tickets/stream');
        stream.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data || '{}');
                ticketsRealtimeBroadcast({ type: 'tickets-event', payload });
                scheduleRealtimeRefresh(payload);
            } catch (e) {
                console.error('Invalid realtime payload', e);
            }
        };
        stream.addEventListener('ping', () => {
            ticketsRealtimeHeartbeat();
        });
        stream.onerror = () => {
            try {
                stream.close();
            } catch (e) {
                console.error('Failed to close realtime stream', e);
            }
            ticketsEventSource = null;
            ticketsRealtimeReleaseLeadership();
            if (!dashboardLiveUpdatesPaused) {
                scheduleTicketsRealtimeRetry();
            }
        };
        ticketsEventSource = stream;
        ticketsRealtimeReconnectBackoffMs = TICKETS_REALTIME_RETRY_MS;
        return true;
    } catch (e) {
        console.error('Realtime stream unavailable', e);
        ticketsRealtimeReleaseLeadership();
        scheduleTicketsRealtimeRetry();
        return false;
    }
}

function scheduleTicketsRealtimeRetry() {
    if (dashboardLiveUpdatesPaused || !('EventSource' in window) || ticketsEventSource || ticketsRealtimeRetryHandle) return;
    const delay = ticketsRealtimeReconnectBackoffMs;
    ticketsRealtimeReconnectBackoffMs = Math.min(Math.max(delay * 2, TICKETS_REALTIME_RETRY_MS), TICKETS_REALTIME_RETRY_MAX_MS);
    ticketsRealtimeRetryHandle = setTimeout(() => {
        ticketsRealtimeRetryHandle = null;
        startTicketsRealtime();
    }, delay);
}

function stopTicketsRealtime() {
  if (!ticketsEventSource) {
    ticketsRealtimeReleaseLeadership();
    return;
  }
    try {
        ticketsEventSource.close();
    } catch (e) {
        console.error('Failed to close realtime stream', e);
    }
    ticketsEventSource = null;
    ticketsRealtimeReleaseLeadership();
}

function getTicketIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('ticket') || '';
}

function updateTicketUrl(ticketId = '', { replace = false } = {}) {
    const url = new URL(window.location.href);
    if (ticketId) url.searchParams.set('ticket', ticketId);
    else url.searchParams.delete('ticket');
    const method = replace ? 'replaceState' : 'pushState';
    window.history[method]({ ticketId: ticketId || null }, '', url);
}

function pauseDashboardLiveUpdates() {
    dashboardLiveUpdatesPaused = true;
    stopTicketsRealtime();
    if (ticketsRealtimeRetryHandle) {
        clearTimeout(ticketsRealtimeRetryHandle);
        ticketsRealtimeRetryHandle = null;
    }
    ticketsRealtimeStopCoordinator();
    ticketsRealtimeReconnectBackoffMs = TICKETS_REALTIME_RETRY_MS;
    clearTimeout(realtimeRefreshHandle);
    realtimeRefreshHandle = null;
}

function resumeDashboardLiveUpdates({ refresh = false } = {}) {
    dashboardLiveUpdatesPaused = false;
    restartTicketsRealtime();
    if (refresh) {
        // Always show a quick first-page refresh
        void loadTickets({ limit: INITIAL_TICKETS_BATCH_SIZE, render: true, notifyNewTickets: false });
        // Only reload notifications if throttle window has passed
        if ((Date.now() - _lastNotificationFetchAt) > NOTIF_THROTTLE_MS) {
            void loadNotifications();
        }
        // Full background sync only if data is actually stale or incomplete
        const STALE_MS = 30 * 1000;
        if ((Date.now() - lastFullTicketsSyncAt) > STALE_MS || allTickets.length < totalAvailableTickets) {
            scheduleDeferredFullSync(1200);
        }
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

        // Trip type display
        const tripDisplay = journey.trip_type_display || getTripLabel(t.trip_type);

        const statusClass = t.status === 'matched' ? 'confirmed' : 'draft';

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
                        </div>
                    </div>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.4rem;">
                        <span class="pnr-label">${safe(t.pnr, '---')}</span>
                        ${tStatusBadge}
                        ${splitBadge}
                        ${mergedBadge}
                    </div>
                </div>
                <div class="itin-card-meta">
                    <span class="meta-item"><b>Type:</b> ${tripDisplay}</span>
                    <span class="meta-item"><b>Date:</b> ${safe(depDate, '-')}</span>
                </div>
                <div class="ticket-card-pax">
                    ${passengers.map(p => `<span class="pax-chip">👤 ${safe(p.name, 'Passenger')}</span>`).join('')}
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

function updateTicketSelectionToolbar() {
    const count = selectedTicketIds.size;
    const summary = document.getElementById('ticketSelectionSummary');
    const toggleBtn = document.getElementById('toggleAllTicketSelectionBtn');
    const closeBtn = document.getElementById('closeTicketSelectionBtn');
    const deleteBtn = document.getElementById('deleteSelectedTicketsBtn');
    const unreadBtn = document.getElementById('markSelectedUnreadBtn');
    const seenBtn = document.getElementById('markSelectedSeenBtn');
    if (summary) {
        summary.textContent = count > 0 ? `${count} selected` : '';
        summary.style.display = count > 0 ? 'inline-flex' : 'none';
    }
    if (toggleBtn) {
        const visibleIds = getVisibleTicketItems().map((ticket) => ticket.id).filter(Boolean);
        const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((ticketId) => selectedTicketIds.has(ticketId));
        toggleBtn.textContent = !ticketSelectionMode ? 'Select' : (allVisibleSelected ? 'Clear All' : 'Select All');
        toggleBtn.classList.toggle('active', ticketSelectionMode);
    }
    const showSelectionActions = ticketSelectionMode && count > 0;
    if (closeBtn) closeBtn.style.display = ticketSelectionMode ? 'inline-flex' : 'none';
    if (deleteBtn) deleteBtn.style.display = showSelectionActions ? 'inline-flex' : 'none';
    if (unreadBtn) unreadBtn.style.display = showSelectionActions ? 'inline-flex' : 'none';
    if (seenBtn) seenBtn.style.display = showSelectionActions ? 'inline-flex' : 'none';
    if (deleteBtn) deleteBtn.disabled = count === 0;
    if (unreadBtn) unreadBtn.disabled = count === 0;
    if (seenBtn) seenBtn.disabled = count === 0;
}

function clearTicketSelection({ render = true } = {}) {
    selectedTicketIds.clear();
    updateTicketSelectionToolbar();
    if (render) renderTicketCards();
}

function setTicketSelectionMode(enabled, { clearSelection = false, render = true } = {}) {
    ticketSelectionMode = !!enabled;
    if (!ticketSelectionMode || clearSelection) {
        selectedTicketIds.clear();
    }
    document.body.classList.toggle('ticket-selection-mode', ticketSelectionMode);
    updateTicketSelectionToolbar();
    if (render) renderTicketCards();
}

function closeTicketSelectionMode() {
    setTicketSelectionMode(false, { clearSelection: true });
}

function toggleTicketSelectionMode() {
    const visibleIds = getVisibleTicketItems().map((ticket) => ticket.id).filter(Boolean);
    if (!ticketSelectionMode) {
        setTicketSelectionMode(true, { clearSelection: true });
        return;
    }
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((ticketId) => selectedTicketIds.has(ticketId));
    if (allVisibleSelected) {
        selectedTicketIds.clear();
    } else {
        visibleIds.forEach((ticketId) => selectedTicketIds.add(ticketId));
    }
    updateTicketSelectionToolbar();
    renderTicketCards();
}

function toggleTicketSelection(ticketId, shouldSelect, { render = true } = {}) {
    if (!ticketId) return;
    ticketSelectionMode = true;
    if (shouldSelect) selectedTicketIds.add(ticketId);
    else selectedTicketIds.delete(ticketId);
    updateTicketSelectionToolbar();
    if (render) renderTicketCards();
}

function handleTicketCardClick(ticketId) {
    if (!ticketId) return;
    if (ticketSelectionMode) {
        toggleTicketSelection(ticketId, !selectedTicketIds.has(ticketId));
        return;
    }
    void openTicket(ticketId);
}

function toggleAllVisibleTicketSelection() {
    const visibleIds = getVisibleTicketItems().map((ticket) => ticket.id).filter(Boolean);
    if (!visibleIds.length) return;
    const allVisibleSelected = visibleIds.every((ticketId) => selectedTicketIds.has(ticketId));
    visibleIds.forEach((ticketId) => {
        if (allVisibleSelected) selectedTicketIds.delete(ticketId);
        else selectedTicketIds.add(ticketId);
    });
    updateTicketSelectionToolbar();
    renderTicketCards();
}

async function deleteSelectedTickets() {
    const ticketIds = Array.from(selectedTicketIds);
    if (!ticketIds.length) return;
    if (!confirm(`Delete ${ticketIds.length} selected ticket${ticketIds.length === 1 ? '' : 's'}?`)) return;
    // Optimistic UI: remove instantly, then confirm with server
    ticketIds.forEach((id) => removeTicketFromLocalState(id, { render: false }));
    setTicketSelectionMode(false, { clearSelection: true, render: true });
    showToast(`Deleting ${ticketIds.length} ticket${ticketIds.length === 1 ? '' : 's'}…`, 'info');
    try {
        const response = await fetch('/api/tickets/bulk-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticket_ids: ticketIds })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            showToast(payload.error || 'Failed to delete selected tickets', 'error');
            // Re-sync to restore actual server state
            void loadTickets({ limit: INITIAL_TICKETS_BATCH_SIZE, render: true, notifyNewTickets: false });
            return;
        }
        showToast(payload.message || 'Selected tickets deleted', 'success');
        // Quiet background reconcile — no full reload
        void loadTickets({ limit: INITIAL_TICKETS_BATCH_SIZE, render: false, notifyNewTickets: false });
    } catch (e) {
        console.error('Delete selected tickets failed', e);
        showToast('Failed to delete selected tickets', 'error');
        void loadTickets({ limit: INITIAL_TICKETS_BATCH_SIZE, render: true, notifyNewTickets: false });
    }
}

async function markSelectedTicketsUnread() {
    const ticketIds = Array.from(selectedTicketIds);
    if (!ticketIds.length) return;
    try {
        const response = await fetch('/api/tickets/mark-unread', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticket_ids: ticketIds })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            showToast(payload.error || 'Failed to mark selected tickets unread', 'error');
            return;
        }
        (payload.ticket_ids || ticketIds).forEach((ticketId) => {
            unreadTicketIds.add(ticketId);
            readOverrideTicketIds.delete(ticketId);
        });
        syncUnreadStateFromServer(payload);
        persistUnreadTickets();
        persistUnreadSeenState();
        allTickets = allTickets.map((ticket) => {
            if ((payload.ticket_ids || ticketIds).includes(ticket.id)) {
                return { ...ticket, is_unread: true };
            }
            return ticket;
        });
        persistTicketsCacheSnapshot();
        setTicketSelectionMode(false, { clearSelection: true, render: false });
        renderTicketCards();
        showToast(payload.message || 'Selected tickets marked unread', 'success');
    } catch (e) {
        console.error('Mark selected tickets unread failed', e);
        showToast('Failed to mark selected tickets unread', 'error');
    }
}

async function markSelectedTicketsSeen() {
    const ticketIds = Array.from(selectedTicketIds);
    if (!ticketIds.length) return;
    try {
        await Promise.all(ticketIds.map((ticketId) => postTicketRead(ticketId)));
        allTickets = allTickets.map((ticket) => {
            if (ticketIds.includes(ticket.id)) {
                return { ...ticket, is_unread: false };
            }
            return ticket;
        });
        persistTicketsCacheSnapshot();
        setTicketSelectionMode(false, { clearSelection: true, render: false });
        renderTicketCards();
        showToast('Selected tickets marked seen', 'success');
    } catch (e) {
        console.error('Mark selected tickets seen failed', e);
        showToast('Failed to mark selected tickets seen', 'error');
    }
}

function buildEmptyTicketsStateHtml() {
    const searchInput = document.getElementById('ticketSearch');
    const emptyMsg = _mergedViewActive
        ? 'No merged bookings yet. Merge PNR groups to see combined bookings here.'
        : (searchInput && searchInput.value ? 'No tickets matched your search.' : 'No tickets found. Tickets will appear here when received from the parser.');
    return `<div class="empty-state" style="grid-column:1/-1">
        <div class="icon">${_mergedViewActive ? '📦' : '🎫'}</div>
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

    const tripDisplay = journey.trip_type_display || getTripLabel(t.trip_type);
    const statusClass = t.status === 'matched' ? 'confirmed' : 'draft';
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
    const unread = isTicketUnread(t);
    const unreadClass = unread ? ' ticket-unread' : '';
    const unreadStrip = unread ? '<div class="unread-strip">UNREAD</div>' : '';

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
    const isSelected = selectedTicketIds.has(t.id);
    const selectedClass = isSelected ? ' ticket-selected' : '';

    return `<div class="itin-card${unreadClass}${selectedClass}" data-ticket-id="${safe(t.id)}" onclick="handleTicketCardClick('${t.id}')">
        ${unreadStrip}
        <label class="ticket-select-toggle" onclick="event.stopPropagation()">
            <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleTicketSelection('${t.id}', this.checked)">
            <span></span>
        </label>
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
                    </div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.4rem;">
                    <span class="pnr-label">${safe(t.pnr, '---')}</span>
                    ${tStatusBadge}
                    ${splitBadge}
                    ${mergedBadge}
                </div>
            </div>
            <div class="itin-card-meta">
                <span class="meta-item"><b>Type:</b> ${tripDisplay}</span>
                <span class="meta-item"><b>Date:</b> ${safe(depDate, '-')}</span>
            </div>
            <div class="ticket-card-pax">
                ${passengers.map(p => `<span class="pax-chip">ðŸ‘¤ ${safe(p.name, 'Passenger')}</span>`).join('')}
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

    const tripDisplay = journey.trip_type_display || getTripLabel(t.trip_type);
    const statusClass = t.status === 'matched' ? 'confirmed' : 'draft';
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
    const unread = isTicketUnread(t);
    const unreadClass = unread ? ' ticket-unread' : '';
    const unreadStrip = unread ? '<div class="unread-strip">UNREAD</div>' : '';

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
    const isSelected = selectedTicketIds.has(t.id);
    const selectedClass = isSelected ? ' ticket-selected' : '';

    return `<div class="itin-card${unreadClass}${selectedClass}" data-ticket-id="${safe(t.id)}" onclick="handleTicketCardClick('${t.id}')">
        ${unreadStrip}
        <label class="ticket-select-toggle" onclick="event.stopPropagation()">
            <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleTicketSelection('${t.id}', this.checked)">
            <span></span>
        </label>
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
                    </div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.4rem;">
                    <span class="pnr-label">${safe(t.pnr, '---')}</span>
                    ${tStatusBadge}
                    ${splitBadge}
                    ${mergedBadge}
                </div>
            </div>
            <div class="itin-card-meta">
                <span class="meta-item"><b>Type:</b> ${tripDisplay}</span>
                <span class="meta-item"><b>Date:</b> ${safe(depDate, '-')}</span>
            </div>
            <div class="ticket-card-pax">
                ${passengers.map(p => `<span class="pax-chip">👤 ${safe(p.name, 'Passenger')}</span>`).join('')}
            </div>
            <div class="itin-card-footer">
                <span class="itin-amount">${formatCurrency(displayTotal, t.currency || 'INR')}</span>
                <span class="itin-date">${formatDate(t.created_at)}</span>
            </div>
        </div>
    </div>`;
}

function renderTicketCards() {
    updateTicketSelectionToolbar();
    patchTicketCards(getVisibleTicketItems());
    renderWebCheckinPanel();
}

function findTicketById(ticketId) {
    return (allTickets || []).find((ticket) => ticket && ticket.id === ticketId) || null;
}

// ==================== OPEN TICKET DETAIL ====================
async function openTicket(id, { syncUrl = true, replaceUrl = false } = {}) {
    const showDetailView = () => {
        document.getElementById('listView').style.display = 'none';
        document.getElementById('detailView').style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    try {
        webCheckinFocusedTicketId = null;
        ticketSelectionMode = false;
        selectedTicketIds.clear();
        const listedTicket = findTicketById(id);
        const cachedTicket = getCachedTicketDetail(id);
        const shouldMarkAsRead = isTicketUnread(cachedTicket || listedTicket || { id });
        if (shouldMarkAsRead) {
            markTicketRead(id);
            allTickets = allTickets.map((ticket) => ticket.id === id ? { ...ticket, is_unread: false } : ticket);
            void postTicketRead(id);
        }
        renderTicketCards();
        pauseDashboardLiveUpdates();

        // Tier 1: Full persisted detail — completely instant, no fetch
        if (cachedTicket) {
            currentTicket = cachedTicket;
            fareFieldsTouched = false;
            activeSegmentEditIdx = null;
            expandedLegIds = new Set();
            editedData = JSON.parse(JSON.stringify(currentTicket));
            fareQuickFillDraft = fareQuickFillDraftByTicket.get(currentTicket.id) || '';
            setTicketEditBaseline(currentTicket);
            applyTicketDraftIfPresent(currentTicket.id, { showToastMessage: true });
            renderDetailView();
            showDetailView();
            if (syncUrl) updateTicketUrl(id, { replace: replaceUrl });
            void syncCurrentTicketFromServer(); // silently refresh in background
            return;
        }

        // Tier 2: List stub preview — show immediately, upgrade silently in background
        if (listedTicket) {
            currentTicket = normalizeTicketFareData(listedTicket);
            fareFieldsTouched = false;
            activeSegmentEditIdx = null;
            expandedLegIds = new Set();
            editedData = JSON.parse(JSON.stringify(currentTicket));
            fareQuickFillDraft = fareQuickFillDraftByTicket.get(currentTicket.id) || '';
            setTicketEditBaseline(currentTicket);
            renderDetailView();
            showDetailView();
            if (syncUrl) updateTicketUrl(id, { replace: replaceUrl });
            // Small badge while full data loads
            const hdr = document.getElementById('ticketDetailHeader');
            if (hdr) {
                const badge = document.createElement('span');
                badge.id = 'ticketDetailRefreshBadge';
                badge.style.cssText = 'font-size:0.72rem;color:var(--text-secondary);font-weight:600;padding:0.2rem 0.6rem;border-radius:6px;background:var(--bg-main);border:1px solid var(--border);margin-left:0.75rem;vertical-align:middle;';
                badge.textContent = '\u21bb Refreshing...';
                const h1 = hdr.querySelector('h1');
                if (h1) h1.after(badge);
            }
        } else {
            // Tier 3: No data at all — show loading placeholder
            document.getElementById('listView').style.display = 'none';
            document.getElementById('detailView').style.display = 'block';
            document.getElementById('ticketDetailHeader').innerHTML = `<div><h1>Loading ticket...</h1></div>`;
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        // Fetch full data
        const openedId = id;
        const r = await fetch('/api/tickets/' + id);
        if (!r.ok) { showToast('Failed to load ticket', 'error'); showListView(); return; }
        const freshTicket = normalizeTicketFareData(await r.json());
        cacheTicketDetail(freshTicket);

        // Only update view if user hasn't navigated away
        if (!currentTicket || currentTicket.id === openedId) {
            currentTicket = freshTicket;
            fareFieldsTouched = false;
            activeSegmentEditIdx = null;
            expandedLegIds = new Set();
            editedData = JSON.parse(JSON.stringify(currentTicket));
            fareQuickFillDraft = fareQuickFillDraftByTicket.get(currentTicket.id) || '';
            setTicketEditBaseline(currentTicket);
            applyTicketDraftIfPresent(currentTicket.id, { showToastMessage: !listedTicket });
            renderDetailView();
            showDetailView();
            if (syncUrl) updateTicketUrl(id, { replace: replaceUrl });
        }
    } catch (e) {
        console.error(e);
        showToast('Error loading ticket', 'error');
        await showListView();
    }
}

async function showListView({ syncUrl = true, replaceUrl = false } = {}) {
    const wasEditing = isDetailDirty || hasPendingLocalDraft;
    const editedTicketId = currentTicket?.id;
    if (currentTicket && editedData) {
        clearTimeout(autoSaveTimeout);
        if (isDetailDirty) {
            await queueSave(true);
        }
    }
    // If we still have dirty state after the save attempt (save failed/offline),
    // evict the persisted detail cache for this ticket so that next open always
    // fetches clean data from the server instead of a corrupted partial snapshot.
    if (wasEditing && editedTicketId && (isDetailDirty || hasPendingLocalDraft)) {
        evictTicketDetailCache(editedTicketId);
    }
    document.getElementById('detailView').style.display = 'none';
    document.getElementById('listView').style.display = 'block';
    webCheckinFocusedTicketId = null;
    currentTicket = null;
    editedData = {};
    fareQuickFillDraft = '';
    changeAttachmentState = { token: '', filename: '' };
    selectedPaxIndices.clear();
    _removePaxActionBar();
    if (syncUrl) updateTicketUrl('', { replace: replaceUrl });
    resumeDashboardLiveUpdates({ refresh: (Date.now() - lastFullTicketsSyncAt) > 30000 });
}

// ==================== NOTIFICATION PANEL SYSTEM ====================
let _notifData = { merge_count: 0, merge_groups: [], duplicate_count: 0, processing_count: 0, processing_batches: [] };
let _activeNotifPanel = null;
let _mergedViewActive = false;

async function loadNotifications({ force = false } = {}) {
    // Throttle: skip if fetched recently and not forced
    const now = Date.now();
    if (!force && (now - _lastNotificationFetchAt) < NOTIF_THROTTLE_MS) return;
    try {
        const r = await fetch('/api/tickets/notifications');
        if (!r.ok) return;
        const previousDuplicateCount = parseMoneyValue(_notifData.duplicate_count);
        const previousActiveProcessingCount = Array.isArray(_notifData.processing_batches)
            ? _notifData.processing_batches.reduce((sum, batch) => sum + parseMoneyValue(batch.pending_count), 0)
            : parseMoneyValue(_notifData.processing_count);
        _notifData = await r.json();
        _lastNotificationFetchAt = Date.now();
        writeCachedJson(TICKETS_NOTIFICATIONS_CACHE_KEY, _notifData);
        const nextDuplicateCount = parseMoneyValue(_notifData.duplicate_count);
        const nextActiveProcessingCount = Array.isArray(_notifData.processing_batches)
            ? _notifData.processing_batches.reduce((sum, batch) => sum + parseMoneyValue(batch.pending_count), 0)
            : parseMoneyValue(_notifData.processing_count);
        if (_hasLoadedNotificationsOnce && nextDuplicateCount > previousDuplicateCount) {
            const newDuplicateCount = nextDuplicateCount - previousDuplicateCount;
            _flashDuplicateNotificationAlert();
            showToast(
                newDuplicateCount === 1
                    ? 'A new ticket was moved to Duplicate Tickets'
                    : `${newDuplicateCount} new tickets were moved to Duplicate Tickets`,
                'warning'
            );
        }
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
        _hasLoadedNotificationsOnce = true;
        _updateNotifBadges();
        if (typeof window.applyTicketNotificationBadges === 'function') {
            window.applyTicketNotificationBadges(_notifData);
        }
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

function _flashDuplicateNotificationAlert() {
    const dupBtn = document.getElementById('dupNotifBtn');
    const dupBadge = document.getElementById('dupBadge');
    if (_duplicateAlertTimeout) {
        clearTimeout(_duplicateAlertTimeout);
        _duplicateAlertTimeout = null;
    }
    if (dupBtn) dupBtn.classList.add('attention');
    if (dupBadge) dupBadge.classList.add('attention');
    _duplicateAlertTimeout = setTimeout(() => {
        if (dupBtn) dupBtn.classList.remove('attention');
        if (dupBadge) dupBadge.classList.remove('attention');
        _duplicateAlertTimeout = null;
    }, 3200);
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

function getPnrGroupDisplayNames(group) {
    const displayNames = [];
    const seen = new Set();
    (group?.tickets || []).forEach((ticket) => {
        (ticket?.passenger_names || []).forEach((name) => {
            const trimmed = safe(name, '').toString().trim();
            if (!trimmed) return;
            const key = trimmed.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            displayNames.push(trimmed);
        });
    });
    return displayNames;
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
        const paxNames = getPnrGroupDisplayNames(group).join(', ') || 'Unknown';

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
    // Show a modern loading state inside the panel
    panel.innerHTML = `<div class="notif-panel">
        <div class="notif-panel-header">
            <h3>⚠️ Duplicate Tickets</h3>
            <button class="close-btn" onclick="_closeNotifPanel()">✕</button>
        </div>
        <div class="empty-notif">
            <div class="loading" style="width:30px;height:30px;"></div>
            <div style="font-weight:600;margin-top:0.5rem;">Scanning for duplicates...</div>
        </div>
    </div>`;

    try {
        // Use the paged loading logic for consistency
        const data = await loadDuplicateTicketsPage(0);
        duplicatePanelTickets = data.duplicates || [];
        duplicatePanelTotalCount = Number(data.total_count || duplicatePanelTickets.length);
        
        // Render using the new high-end layout
        _renderDuplicatePanelLayout(panel);
    } catch (e) {
        console.error(e);
        panel.innerHTML = `<div class="notif-panel">
            <div class="notif-panel-header">
                <h3>⚠️ Duplicate Tickets</h3>
                <button class="close-btn" onclick="_closeNotifPanel()">✕</button>
            </div>
            <div class="empty-notif">
                <div style="font-size:2rem;">❌</div>
                <div style="font-weight:700;">Failed to load sync</div>
                <div style="color:var(--text-tertiary);font-size:0.8rem;">Please check your connection or try again later.</div>
            </div>
        </div>`;
    }
}

function formatLocalDateTime(isoDate) {
    if (!isoDate) return '';
    const parsed = new Date(isoDate);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
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
            const createdLabel = formatLocalDateTime(dup.created_at) || 'Recent';

            return `<div class="notif-card" id="dup-card-${dup.id}">
                <div class="notif-card-header">
                    <div style="display:flex;gap:0.8rem;align-items:flex-start;">
                        <label style="display:flex;align-items:center;margin-top:0.2rem;">
                            <input type="checkbox" class="duplicate-review-checkbox" value="${dup.id}" checked>
                        </label>
                        <div>
                            <div style="font-weight:800;font-size:0.95rem;">PNR ${dup.pnr || '—'} <span style="font-size:0.76rem;font-weight:500;color:var(--text-secondary);">· ${createdLabel}</span></div>
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


function toggleDupExpanded(event, cardId) {
    if (event) event.stopPropagation();
    const card = document.getElementById(cardId);
    if (!card) return;
    
    // Close others
    const isExpanding = !card.classList.contains('expanded');
    if (isExpanding) {
        document.querySelectorAll('.dup-review-card.expanded').forEach(c => {
            if (c.id !== cardId) c.classList.remove('expanded');
        });
    }
    card.classList.toggle('expanded');
}

function toggleDuplicateSelectionGlobal() {
    const boxes = document.querySelectorAll('.duplicate-review-checkbox');
    if (!boxes.length) return;
    
    const allChecked = Array.from(boxes).every(b => b.checked);
    boxes.forEach(b => b.checked = !allChecked);
    
    const btn = document.getElementById('duplicateSelectionToggleBtn');
    if (btn) btn.textContent = allChecked ? 'Select All' : 'Clear All';
}

function _renderDuplicateCardsHtmlV2(dups) {
    return dups.map((dup) => {
        const orig = dup.original_ticket;
        const dupNames = (dup.passenger_names || []).join(', ') || 'Unknown';
        const origNames = orig ? (orig.passenger_names || []).join(', ') || 'Unknown' : '—';
        const dupRoute = dup.route || '—';
        const origRoute = orig ? (orig.route || '—') : '—';
        const dupPnr = dup.pnr || '—';
        const origPnr = orig ? (orig.pnr || '—') : '—';
        const dupTotal = formatCurrency(dup.grand_total, dup.currency || 'INR');
        const origTotal = orig ? formatCurrency(orig.grand_total, orig.currency || 'INR') : '—';

        // Timestamps
        const dupCreated = formatLocalDateTime(dup.created_at) || 'Recent';
        const origCreated = orig ? (formatLocalDateTime(orig.created_at) || 'Existing') : '—';

        const compare = (v1, v2) => {
            if (!v1 || !v2) return '';
            const s1 = String(v1).trim().toLowerCase();
            const s2 = String(v2).trim().toLowerCase();
            return (s1 === s2 && s1 !== '—') ? 'vs-val-match' : 'vs-val-diff';
        };

        const cardId = `dup-card-${dup.id}`;

        return `<div class="dup-review-card" id="${cardId}">
            <div class="dup-summary-row" onclick="toggleDupExpanded(event, '${cardId}')">
                <div class="dup-selection-wrap" onclick="event.stopPropagation()">
                    <input type="checkbox" class="duplicate-review-checkbox" value="${dup.id}" onchange="document.getElementById('duplicateSelectionToggleBtn').textContent='Select All'">
                </div>
                <div class="dup-summary-main">
                    <div class="dup-pnr-box">${dupPnr}</div>
                    <div class="dup-route-box">${dupRoute}</div>
                    <div class="dup-pax-box">${dupNames}</div>
                    <div class="dup-total-box">${dupTotal}</div>
                </div>
                <div class="dup-actions-minimal" onclick="event.stopPropagation()" style="display:flex; gap:0.4rem; align-items:center;">
                    <button class="notif-btn-icon reject" title="Reject" onclick="rejectDuplicate('${dup.id}')" style="width:26px; height:26px; border-radius:5px; border:1px solid rgba(239,68,68,0.15); color:#ef4444; background:none; cursor:pointer;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                    <button class="notif-btn-icon approve" title="Approve" onclick="approveDuplicate('${dup.id}')" style="width:26px; height:26px; border-radius:5px; border:1px solid rgba(16,185,129,0.15); color:#10b981; background:none; cursor:pointer;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </button>
                    <span style="font-size:0.6rem; color:var(--text-tertiary); margin-left:0.2rem;">▼</span>
                </div>
            </div>

            <div class="dup-comparison-body">
                <table class="vs-table">
                    <tr class="vs-header-row">
                        <th class="vs-label">Compare</th>
                        <th class="vs-orig">Existing Document</th>
                        <th class="vs-new">New Suspect</th>
                    </tr>
                    <tr>
                        <td class="vs-label">Timestamp</td>
                        <td class="vs-orig">${origCreated}</td>
                        <td class="vs-new">${dupCreated}</td>
                    </tr>
                    <tr>
                        <td class="vs-label">PNR</td>
                        <td class="vs-orig">${origPnr}</td>
                        <td class="vs-new ${compare(dupPnr, origPnr)}">${dupPnr}</td>
                    </tr>
                    <tr>
                        <td class="vs-label">Route</td>
                        <td class="vs-orig">${origRoute}</td>
                        <td class="vs-new ${compare(dupRoute, origRoute)}">${dupRoute}</td>
                    </tr>
                    <tr>
                        <td class="vs-label">Passengers</td>
                        <td class="vs-orig">${origNames}</td>
                        <td class="vs-new ${compare(dupNames, origNames)}">${dupNames}</td>
                    </tr>
                    <tr>
                        <td class="vs-label">Total Fare</td>
                        <td class="vs-orig">${origTotal}</td>
                        <td class="vs-new ${compare(dupTotal, origTotal)}">${dupTotal}</td>
                    </tr>
                </table>
            </div>
        </div>`;
    }).join('');
}

function _renderDuplicatePanelLayout(panel) {
    if (!duplicatePanelTickets.length) {
        panel.innerHTML = `<div class="notif-panel">
            <div class="notif-panel-header">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                    <span style="font-size:1.2rem;">⚠️</span>
                    <h3 style="margin:0;">Duplicate Quarantine</h3>
                </div>
                <button class="close-btn" onclick="_closeNotifPanel()">✕</button>
            </div>
            <div class="empty-notif" style="padding:4rem 2rem; text-align:center;">
                <div style="font-size:2.5rem; margin-bottom:1rem;">✨</div>
                <div style="font-weight:700; font-size:1.1rem;">Looks Good!</div>
                <div style="color:var(--text-tertiary); font-size:0.9rem;">No suspected duplicates in the quarantine.</div>
            </div>
        </div>`;
        return;
    }

    panel.innerHTML = `<div class="notif-panel" style="padding: 0; overflow: hidden; border-radius:12px; border:1px solid var(--border); box-shadow: 0 10px 40px rgba(0,0,0,0.12); border:none;">
        <div class="notif-panel-header" style="padding: 1.1rem; margin-bottom: 0; background: white; border-bottom: 1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:0.6rem;">
                <h3 style="margin:0; font-size:1.05rem; font-weight:800;">Duplicate Quarantine</h3>
                <span id="duplicatePanelTotal" style="font-size:0.75rem; font-weight:700; color:var(--text-secondary); background:#f1f5f9; padding:0.15rem 0.5rem; border-radius:100px;">${duplicatePanelTotalCount}</span>
            </div>
            <button class="close-btn" onclick="_closeNotifPanel()">✕</button>
        </div>
        
        <div style="background: #f8fafc; padding: 0.75rem 1.1rem; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; gap: 0.75rem;">
            <div>
                <button id="duplicateSelectionToggleBtn" class="toggle-all-btn" onclick="toggleDuplicateSelectionGlobal()">Select All</button>
            </div>
            <div style="display:flex; gap:0.5rem;">
                <button class="notif-btn reject" style="background:none; color:#ef4444; border:1px solid rgba(239,68,68,0.2); padding:0.4rem 0.85rem; font-size:0.75rem; font-weight:700; border-radius:8px; cursor:pointer;" onclick="rejectSelectedDuplicates()">Reject Selected</button>
                <button class="notif-btn approve" style="background:var(--primary); color:white; border:none; padding:0.4rem 0.85rem; font-size:0.75rem; font-weight:700; border-radius:8px; cursor:pointer;" onclick="approveSelectedDuplicates()">Approve Selected</button>
            </div>
        </div>

        <div id="duplicateListBody" style="max-height:60vh; overflow-y:auto; padding: 1rem; background: #fff;">
            ${_renderDuplicateCardsHtmlV2(duplicatePanelTickets)}
        </div>
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
                <div style="display:flex;flex-wrap:nowrap;gap:0.75rem;align-items:center;overflow-x:auto;padding-bottom:10px;scrollbar-width:none;-ms-overflow-style:none;">
                    <div class="pdf-btn-group">
                        <button class="pdf-btn with-fare" data-pdf-download="with-fare" onclick="downloadPDF(true)">📄 PDF (With Fare)</button>
                        <button class="pdf-btn without-fare" data-pdf-download="without-fare" onclick="downloadPDF(false)">📄 PDF (Without Fare)</button>
                    </div>
                    ${!editedData.ledger_hash ? `
                    <div id="ledgerBtnGroup" style="display:flex; align-items:center; gap:0.4rem; background:var(--bg-main); padding:0.4rem 0.75rem; border-radius:12px; border:1px solid var(--border); flex-shrink:0;">
                        <span style="font-size:0.75rem; color:var(--text-secondary); font-weight:700; text-transform:uppercase; white-space:nowrap;">Ledger:</span>
                        <select id="ledgerAggSelect" style="padding:0.35rem 0.5rem; border-radius:8px; border:1px solid var(--border); font-family:inherit; font-size:0.82rem; background:var(--bg-card); color:var(--text-primary);">
                            <option value="">Loading...</option>
                        </select>
                        <button class="pdf-btn" style="background: #10b981; color:white; padding: 0.45rem 0.5rem; min-width:38px; justify-content:center;" onclick="addToLedger('AB')">AB</button>
                        <button class="pdf-btn" style="background: #6366f1; color:white; padding: 0.45rem 0.5rem; min-width:38px; justify-content:center;" onclick="addToLedger('CK')">CK</button>
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
                <div style="display:flex;flex-wrap:nowrap;gap:0.75rem;align-items:center;overflow-x:auto;padding-bottom:10px;scrollbar-width:none;-ms-overflow-style:none;">
                    <div class="pdf-btn-group">
                        <button class="pdf-btn with-fare" data-pdf-download="with-fare" onclick="downloadPDF(true)">📄 PDF (With Fare)</button>
                        <button class="pdf-btn without-fare" data-pdf-download="without-fare" onclick="downloadPDF(false)">📄 PDF (Without Fare)</button>
                    </div>
                    ${!editedData.ledger_hash ? `
                    <div id="ledgerBtnGroup" style="display:flex; align-items:center; gap:0.5rem; background:var(--bg-main); padding:0.5rem 1rem; border-radius:12px; border:1px solid var(--border);">
                        <span style="font-size:0.75rem; color:var(--text-secondary); font-weight:700; text-transform:uppercase;">Add to Ledger:</span>
                        <select id="ledgerAggSelect" style="padding:0.35rem 0.5rem; border-radius:8px; border:1px solid var(--border); font-family:inherit; font-size:0.82rem; background:var(--bg-card); color:var(--text-primary);">
                            <option value="">Loading...</option>
                        </select>
                        <button class="pdf-btn" style="background: #10b981; color:white; padding: 0.45rem 0.5rem; min-width:38px; justify-content:center;" onclick="addToLedger('AB')">AB</button>
                        <button class="pdf-btn" style="background: #6366f1; color:white; padding: 0.45rem 0.5rem; min-width:38px; justify-content:center;" onclick="addToLedger('CK')">CK</button>
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
    t.currency = normalizeCurrencyCode(t.currency);
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
        ? renderStatusBadge('Cancelled', 'cancelled')
        : detailTStatus === 'changed'
        ? renderStatusBadge('Changed', 'changed')
        : renderStatusBadge('Live', 'live');
    const webCheckinButtonHtml = isValidWebCheckinTicket(t) && !(webCheckinPanelOpen && webCheckinFocusedTicketId === t.id)
        ? `<button class="web-checkin-detail-fab" onclick="openFocusedWebCheckinTicket('${t.id}')" title="Open this ticket's web check-in card">Web Check In</button>`
        : '';

    // Cancellation charge display
    const charge = parseFloat(t.cancellation_charge) || 0;
    const chargeHtml = charge > 0 ? `<span class="detail-alert-chip">${getInlineSvgIcon('warning', 'inline-icon inline-icon-sm')}<span>XXD: ₹${charge.toLocaleString('en-IN')}</span></span>` : '';

    document.getElementById('ticketDetailHeader').innerHTML = `
        <div class="detail-header-main">
            <div class="detail-route-kicker">Ticket Overview</div>
            <div class="detail-title-row">
                <h1>${headerRouteHtml}</h1>
                ${detailTStatusBadge}
            </div>
            <div class="detail-subtitle">
                <span class="pnr-label" id="detailPnrLabel" style="font-size:0.9rem;">${safe(t.pnr, 'No PNR')}</span>
                ${t.status === 'matched' ? '<span class="match-badge matched">Matched</span>' : '<span class="match-badge unmatched">Unmatched</span>'}
                ${chargeHtml}
                <span class="detail-meta-chip">${tripDisplay}</span>
            </div>
        </div>
        <div class="detail-actions">
            <button class="btn-action small danger" onclick="deleteTicket()">${renderActionLabel('Delete', 'trash')}</button>
            ${webCheckinButtonHtml}
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
    const pnrNeedsWarning = doesPnrNeedWarning(t.pnr);
    const bookingDateNeedsWarning = doesBookingDateNeedWarning(t.booking_date);
    const phoneNeedsWarning = doesPhoneNeedWarning(t.phone);
    const pnrWarningKey = getPnrWarningKey(t.pnr);
    const bookingDateWarningKey = getBookingDateWarningKey(t.booking_date);
    const phoneWarningKey = getPhoneWarningKey(t.phone);
    const currencyState = getTicketCurrencyOptionState(t.currency);

    const gstHtml = `
        <div style="margin-top:1rem; padding:1rem; background:var(--bg-main); border-radius:10px; border:1px solid var(--border);">
            <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.75rem;">
                <span class="inline-icon-wrap accent-amber">${getInlineSvgIcon('building', 'inline-icon')}</span>
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
        <div class="section-header-row">${renderTitleWithIcon('Booking Information', 'booking')}</div>
        <div class="field-grid">
            <div class="field-item ${pnrNeedsWarning ? 'warning' : ''}" id="ticketPnrField">
                <div class="field-label-row">
                    <label>PNR</label>
                    ${pnrNeedsWarning ? buildWarningBadge(pnrWarningKey, 'PNR is empty, not 6 characters, or looks like a normal word') : ''}
                </div>
                <input type="text" id="ticketPnrInput" value="${safe(t.pnr)}" oninput="updateTicketPnr(this.value)" onchange="updateTicketPnr(this.value)">
            </div>
            <div class="field-item ${bookingDateNeedsWarning ? 'warning' : ''}" id="ticketBookingDateField">
                <div class="field-label-row">
                    <label>Booking Date</label>
                    ${bookingDateNeedsWarning ? buildWarningBadge(bookingDateWarningKey, 'Booking date is required') : ''}
                </div>
                <input type="text" id="ticketBookingDateInput" value="${safe(t.booking_date)}" oninput="updateTicketBookingDate(this.value)" onchange="updateTicketBookingDate(this.value)">
            </div>
            <div class="field-item ${phoneNeedsWarning ? 'warning' : ''}" id="ticketPhoneField">
                <div class="field-label-row">
                    <label>Phone</label>
                    ${phoneNeedsWarning ? buildWarningBadge(phoneWarningKey, 'Phone number is missing, too short, or too long') : ''}
                </div>
                <input type="text" id="ticketPhoneInput" value="${safe(t.phone)}" oninput="updateTicketPhone(this.value)" onchange="updateTicketPhone(this.value)">
            </div>
            <div class="field-item"><label>Currency</label>
                <select onchange="setTicketCurrency(this.value)">
                    <option value="INR" ${currencyState.value === 'INR' ? 'selected' : ''}>INR</option>
                    <option value="USD" ${currencyState.value === 'USD' ? 'selected' : ''}>USD</option>
                    <option value="EUR" ${currencyState.value === 'EUR' ? 'selected' : ''}>EUR</option>
                    <option value="GBP" ${currencyState.value === 'GBP' ? 'selected' : ''}>GBP</option>
                    <option value="AED" ${currencyState.value === 'AED' ? 'selected' : ''}>AED</option>
                    <option value="SGD" ${currencyState.value === 'SGD' ? 'selected' : ''}>SGD</option>
                    <option value="THB" ${currencyState.value === 'THB' ? 'selected' : ''}>THB</option>
                    ${currencyState.isCustom ? `<option value="${escapeHtmlAttribute(currencyState.customCode)}" selected>Custom (${escapeHtmlAttribute(currencyState.customCode)})</option>` : ''}
                </select>
            </div>
            <div class="field-item"><label>Trip Type</label>
                <select onchange="editedData.trip_type=this.value; renderDetailView(); triggerAutoSave()">
                    <option value="one_way" ${t.trip_type === 'one_way' ? 'selected' : ''}>One Way</option>
                    <option value="round_trip" ${t.trip_type === 'round_trip' ? 'selected' : ''}>Round Trip</option>
                    <option value="multi_city" ${t.trip_type === 'multi_city' ? 'selected' : ''}>Multi-City</option>
                </select></div>
        </div>
        ${gstHtml}`;
}

function updateTicketPnr(value) {
    editedData.pnr = value;
    const headerPnr = document.getElementById('detailPnrLabel');
    if (headerPnr) headerPnr.textContent = value || 'No PNR';
    syncPnrWarningUi();
    triggerAutoSave();
}

function doesPnrNeedWarning(value) {
    const normalized = String(value || '').trim();
    const invalid = /^[A-Za-z]{4,}$/.test(normalized);
    const warningKey = getPnrWarningKey(normalized);
    const shouldWarn = !normalized || normalized.length !== 6 || invalid;
    if (!shouldWarn) clearDismissedWarning(warningKey);
    return shouldWarn && !isWarningDismissed(warningKey);
}

function doesPhoneNeedWarning(value) {
    const raw = String(value || '').trim();
    const digitsOnly = raw.replace(/\D/g, '');
    const invalid = digitsOnly.length < 7 || raw.length > 15;
    const warningKey = getPhoneWarningKey(raw);
    if (!invalid) clearDismissedWarning(warningKey);
    return invalid && !isWarningDismissed(warningKey);
}

function syncPnrWarningUi() {
    const pnrField = document.getElementById('ticketPnrField');
    if (!pnrField) return;
    const needsWarning = doesPnrNeedWarning(editedData.pnr);
    const warningKey = getPnrWarningKey(editedData.pnr);
    pnrField.classList.toggle('warning', needsWarning);

    let badge = pnrField.querySelector('.field-warning-badge');
    if (needsWarning && !badge) {
        const labelRow = pnrField.querySelector('.field-label-row');
        if (!labelRow) return;
        labelRow.insertAdjacentHTML('beforeend', buildWarningBadge(warningKey, 'PNR is empty, not 6 characters, or looks like a normal word'));
    } else if (!needsWarning && badge) {
        badge.remove();
    }
}

function syncPhoneWarningUi() {
    const phoneField = document.getElementById('ticketPhoneField');
    if (!phoneField) return;
    const needsWarning = doesPhoneNeedWarning(editedData.phone);
    const warningKey = getPhoneWarningKey(editedData.phone);
    phoneField.classList.toggle('warning', needsWarning);

    let badge = phoneField.querySelector('.field-warning-badge');
    if (needsWarning && !badge) {
        const labelRow = phoneField.querySelector('.field-label-row');
        if (!labelRow) return;
        labelRow.insertAdjacentHTML('beforeend', buildWarningBadge(warningKey, 'Phone number is missing, too short, or too long'));
    } else if (!needsWarning && badge) {
        badge.remove();
    }
}

function syncBookingDateWarningUi() {
    const bookingDateField = document.getElementById('ticketBookingDateField');
    if (!bookingDateField) return;
    const needsWarning = doesBookingDateNeedWarning(editedData.booking_date);
    const warningKey = getBookingDateWarningKey(editedData.booking_date);
    bookingDateField.classList.toggle('warning', needsWarning);

    let badge = bookingDateField.querySelector('.field-warning-badge');
    if (needsWarning && !badge) {
        const labelRow = bookingDateField.querySelector('.field-label-row');
        if (!labelRow) return;
        labelRow.insertAdjacentHTML('beforeend', buildWarningBadge(warningKey, 'Booking date is required'));
    } else if (!needsWarning && badge) {
        badge.remove();
    }
}

function updateTicketBookingDate(value) {
    editedData.booking_date = value;
    syncBookingDateWarningUi();
    triggerAutoSave();
}

function updateTicketPhone(value) {
    editedData.phone = value;
    syncPhoneWarningUi();
    triggerAutoSave();
}

function renderSegmentsSection() {
    const segments = editedData.segments || [];
    const journey = editedData.journey || {};
    const tripType = editedData.trip_type || 'one_way';

    let legs;
    if (journey.legs && journey.legs.length > 0) {
        legs = journey.legs.map(leg => leg.segments || []);
    } else {
        legs = groupSegmentsIntoLegs(segments);
    }

    const layoverMap = getJourneyLayoverMap(journey);

    const tripDisplay = journey.trip_type_display || getTripLabel(tripType);

    let html = `<div class="section-header-row">
        <h2>Flight Segments</h2>
        <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
            <span class="trip-type-chip">${tripDisplay}</span>
            <span class="badge">${legs.length} leg${legs.length > 1 ? 's' : ''} - ${segments.length} segment${segments.length > 1 ? 's' : ''}</span>
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
        const totalDuration = getLegTotalDurationValue(legIndices, segments, journey, legIdx);
        const durationSummaryHtml = totalDuration
            ? `<span style="font-size:0.7rem; font-weight:700; color:var(--primary); padding:0.1rem 0.48rem; background:var(--bg-card); border:1px solid rgba(37,99,235,0.12); border-radius:999px; white-space:nowrap;">${totalDuration}</span>`
            : '';
        const layoverAirports = [];

        if (hasStops) {
            for (let k = 0; k < legIndices.length - 1; k++) {
                const segIdx = legIndices[k];
                const lo = layoverMap[segIdx];
                if (lo) layoverAirports.push(lo.at_airport);
                else layoverAirports.push(((segments[segIdx] || {}).arrival || {}).airport || '?');
            }
        }

        const legId = `leg-${legIdx}`;
        const showLegSummary = hasStops;
        const isLegExpanded = !showLegSummary || expandedLegIds.has(legId) || legIndices.includes(activeSegmentEditIdx);
        html += `<div class="leg-group-v2" style="${(() => {
            const segs = legIndices.map(i => segments[i]);
            const isFullyCancelled = segs.every(s => s.status === 'cancelled');
            return isFullyCancelled ? 'border: 2px solid #ef4444; background: rgba(239, 68, 68, 0.05);' : '';
        })()}">`;

        if (showLegSummary) {
            html += `<div class="leg-header-v2" onclick="toggleLeg('${legId}')" style="cursor:pointer;">
                <div class="leg-summary-shell">
                    <div class="leg-summary-badge-wrap">
                        <span class="leg-badge-v2">${legLabel}</span>
                    </div>
                    <div class="leg-summary-route">
                        <div class="leg-summary-endpoint">
                            <div class="leg-summary-code-row"><span class="leg-code">${legOrigin}</span>${legOriginCity ? `<span class="leg-city leg-summary-city">(${legOriginCity})</span>` : ''}</div>
                            <div class="leg-summary-time-row"><span class="leg-summary-time">${depTime || '--:--'}</span><span class="leg-summary-date">${depDate}</span></div>
                        </div>
                        <div class="leg-summary-middle">
                            <div class="leg-summary-duration">${durationSummaryHtml}</div>
                            <div class="leg-summary-line-wrap">
                                <div class="leg-summary-line"></div>
                                <div class="leg-summary-plane" aria-hidden="true">&#9992;</div>
                            </div>
                            <div class="leg-summary-stops">${stopCount} stop${stopCount > 1 ? 's' : ''} in ${layoverAirports.join(', ')}</div>
                        </div>
                        <div class="leg-summary-endpoint">
                            <div class="leg-summary-code-row"><span class="leg-code">${legDest}</span>${legDestCity ? `<span class="leg-city leg-summary-city">(${legDestCity})</span>` : ''}</div>
                            <div class="leg-summary-time-row"><span class="leg-summary-time">${arrTime || '--:--'}</span><span class="leg-summary-date">${arrDate}</span></div>
                        </div>
                    </div>
                    <div class="leg-summary-expand"><span class="leg-expand-icon" id="icon-${legId}">v</span></div>
                </div>
            </div>`;
        }

        html += `<div class="leg-segments-v2 ${isLegExpanded ? '' : 'collapsed'}" id="${legId}">`;
        if (!showLegSummary) html += `<div style="margin:0 0 0.85rem 0;"><span class="leg-badge-v2" style="padding:0.25rem 0.7rem; font-size:0.72rem;">${legLabel}</span></div>`;

        legIndices.forEach((segIdx, posInLeg) => {
            const seg = segments[segIdx];
            const dep = seg.departure || {};
            const arr = seg.arrival || {};
            const departureLocationValidation = getAirportCityValidation(dep);
            const arrivalLocationValidation = getAirportCityValidation(arr);
            const duration = getSegmentDurationValue(seg);
            const segmentTemporalValidation = getSegmentTemporalValidation(seg);
            const geoDurationValidation = getSegmentGeoDurationValidation(seg);
            const geoDurationWarningMessage = geoDurationValidation?.warningMessage || '';
            const hasGeoDurationWarning = !!geoDurationWarningMessage;
            const hasFallbackDurationWarning = !hasGeoDurationWarning && doesSegmentDurationNeedWarning(seg);
            const hasDurationWarning = hasGeoDurationWarning || hasFallbackDurationWarning;
            const hasDateOrderWarning = doesSegmentDateOrderNeedWarning(seg);
            const overnightDateAdjustment = inferOvernightArrivalAdjustment(seg);
            const hasOvernightDateWarning = !!overnightDateAdjustment;
            const flightNumberWarningMessage = getFlightNumberWarningMessage(seg);
            const hasAirlineCodeWarning = !!flightNumberWarningMessage;
            const durationWarningKey = getSegmentWarningKey(segIdx, hasGeoDurationWarning ? 'duration-geo' : 'duration', seg);
            const dateOrderWarningKey = getSegmentWarningKey(segIdx, 'date-order', seg);
            const overnightDateWarningKey = getSegmentWarningKey(segIdx, 'day-offset', seg);
            const airlineCodeWarningKey = getSegmentWarningKey(segIdx, 'flight-number', seg);
            const departureAirportWarningKey = getSegmentWarningKey(segIdx, 'departure-airport', seg);
            const arrivalAirportWarningKey = getSegmentWarningKey(segIdx, 'arrival-airport', seg);
            const departureCityWarningKey = getSegmentWarningKey(segIdx, 'departure-city', seg);
            const arrivalCityWarningKey = getSegmentWarningKey(segIdx, 'arrival-city', seg);
            const departureTerminalWarningKey = getSegmentWarningKey(segIdx, 'departure-terminal', seg);
            const arrivalTerminalWarningKey = getSegmentWarningKey(segIdx, 'arrival-terminal', seg);
            const segmentNegativeWarningKey = getSegmentWarningKey(segIdx, 'segment-negative', seg);
            const layoverNegativeWarningKey = getSegmentWarningKey(segIdx, 'layover-negative', seg);
            const showDurationWarning = hasDurationWarning && !isWarningDismissed(durationWarningKey);
            const showDateOrderWarning = hasDateOrderWarning && !isWarningDismissed(dateOrderWarningKey);
            const showOvernightDateWarning = hasOvernightDateWarning && !isWarningDismissed(overnightDateWarningKey);
            const showSegmentNegativeWarning = !!segmentTemporalValidation && !isWarningDismissed(segmentNegativeWarningKey);
            const showAirlineCodeWarning = hasAirlineCodeWarning && !isWarningDismissed(airlineCodeWarningKey);
            const showDepartureAirportWarning = !!departureLocationValidation.airportMessage && !isWarningDismissed(departureAirportWarningKey);
            const showArrivalAirportWarning = !!arrivalLocationValidation.airportMessage && !isWarningDismissed(arrivalAirportWarningKey);
            const showDepartureCityWarning = !!departureLocationValidation.cityMessage && !isWarningDismissed(departureCityWarningKey);
            const showArrivalCityWarning = !!arrivalLocationValidation.cityMessage && !isWarningDismissed(arrivalCityWarningKey);
            const showDepartureTerminalWarning = doesTerminalNeedConfirmation(dep.terminal) && !isWarningDismissed(departureTerminalWarningKey);
            const showArrivalTerminalWarning = doesTerminalNeedConfirmation(arr.terminal) && !isWarningDismissed(arrivalTerminalWarningKey);
            const hasTimingWarning = showDurationWarning || showDateOrderWarning || showOvernightDateWarning || showSegmentNegativeWarning;
            const warningMessages = [];
            const warningKeys = [];
            if (showDurationWarning) {
                warningMessages.push(createWarningPayload(
                    geoDurationWarningMessage || 'Flight duration looks unusual: less than 30 minutes or more than 20 hours'
                ));
                warningKeys.push(durationWarningKey);
            }
            if (showDateOrderWarning) {
                warningMessages.push(createWarningPayload('Arrival date is earlier than departure date'));
                warningKeys.push(dateOrderWarningKey);
            }
            if (showOvernightDateWarning) {
                warningMessages.push(createWarningPayload(
                    `Arrival date looks one day early for the timezone-aware flight duration${overnightDateAdjustment?.duration ? ` (${overnightDateAdjustment.duration})` : ''}.`,
                    {
                        suggestionText: `Should we auto-update arrival date to "${overnightDateAdjustment.toDate}"?`,
                        suggestion: {
                            label: 'Yes',
                            action: 'update-arrival-date',
                            segIdx,
                            value: overnightDateAdjustment.toDate
                        }
                    }
                ));
                warningKeys.push(overnightDateWarningKey);
            }
            if (showSegmentNegativeWarning) {
                warningMessages.push(createWarningPayload(segmentTemporalValidation.warningMessage));
                warningKeys.push(segmentNegativeWarningKey);
            }
            const durationWarningBadge = hasTimingWarning
                ? buildWarningBadge(warningKeys.join('||'), combineWarningPayloads(warningMessages))
                : '';
            const airlineCodeWarningBadge = showAirlineCodeWarning
                ? buildWarningBadge(
                    airlineCodeWarningKey,
                    flightNumberWarningMessage?.suggestion
                        ? {
                            ...flightNumberWarningMessage,
                            suggestion: {
                                ...flightNumberWarningMessage.suggestion,
                                segIdx
                            }
                        }
                        : flightNumberWarningMessage
                )
                : '';
            const departureAirportWarningBadge = showDepartureAirportWarning
                ? buildWarningBadge(
                    departureAirportWarningKey,
                    departureLocationValidation.airportMessage?.suggestion
                        ? {
                            ...departureLocationValidation.airportMessage,
                            suggestion: {
                                ...departureLocationValidation.airportMessage.suggestion,
                                segIdx,
                                field: 'departure'
                            }
                        }
                        : departureLocationValidation.airportMessage
                )
                : '';
            const arrivalAirportWarningBadge = showArrivalAirportWarning
                ? buildWarningBadge(
                    arrivalAirportWarningKey,
                    arrivalLocationValidation.airportMessage?.suggestion
                        ? {
                            ...arrivalLocationValidation.airportMessage,
                            suggestion: {
                                ...arrivalLocationValidation.airportMessage.suggestion,
                                segIdx,
                                field: 'arrival'
                            }
                        }
                        : arrivalLocationValidation.airportMessage
                )
                : '';
            const departureCityWarningBadge = showDepartureCityWarning
                ? buildWarningBadge(
                    departureCityWarningKey,
                    departureLocationValidation.cityMessage?.suggestion
                        ? {
                            ...departureLocationValidation.cityMessage,
                            suggestion: {
                                ...departureLocationValidation.cityMessage.suggestion,
                                segIdx,
                                field: 'departure'
                            }
                        }
                        : departureLocationValidation.cityMessage
                )
                : '';
            const arrivalCityWarningBadge = showArrivalCityWarning
                ? buildWarningBadge(
                    arrivalCityWarningKey,
                    arrivalLocationValidation.cityMessage?.suggestion
                        ? {
                            ...arrivalLocationValidation.cityMessage,
                            suggestion: {
                                ...arrivalLocationValidation.cityMessage.suggestion,
                                segIdx,
                                field: 'arrival'
                            }
                        }
                        : arrivalLocationValidation.cityMessage
                )
                : '';
            const departureTerminalWarningBadge = showDepartureTerminalWarning
                ? `<div style="display:flex; align-items:center; gap:0.35rem; margin-top:0.2rem;"><span style="font-size:0.7rem; color:#b45309; font-weight:700;">Is this terminal okay?</span><button type="button" class="field-warning-badge" style="padding:0 0.28rem; min-width:1.1rem;" title="Confirm terminal" onclick='event.stopPropagation(); confirmWarningOkay(${JSON.stringify(String(departureTerminalWarningKey || ""))})'>&#10003;</button></div>`
                : '';
            const arrivalTerminalWarningBadge = showArrivalTerminalWarning
                ? `<div style="display:flex; align-items:center; gap:0.35rem; margin-top:0.2rem;"><span style="font-size:0.7rem; color:#b45309; font-weight:700;">Is this terminal okay?</span><button type="button" class="field-warning-badge" style="padding:0 0.28rem; min-width:1.1rem;" title="Confirm terminal" onclick='event.stopPropagation(); confirmWarningOkay(${JSON.stringify(String(arrivalTerminalWarningKey || ""))})'>&#10003;</button></div>`
                : '';
            if (posInLeg > 0) {
                const prevSegIdx = legIndices[posInLeg - 1];
                const prevSeg = segments[prevSegIdx] || {};
                const lo = layoverMap[prevSegIdx];
                const layoverDur = getLayoverDurationValue(prevSeg, seg, journey, prevSegIdx);
                const layoverValidation = getLayoverValidation(prevSeg, seg);
                const layoverCity = lo ? lo.at_airport : (dep.city || dep.airport || '');
                const showLayoverWarning = !!layoverValidation && !isWarningDismissed(layoverNegativeWarningKey);
                const layoverWarningBadge = showLayoverWarning
                    ? buildWarningBadge(layoverNegativeWarningKey, layoverValidation.warningMessage)
                    : '';
                const layoverStyle = showLayoverWarning ? 'color:#dc2626; font-weight:800;' : '';
                html += `<div class="layover-indicator-v2"><div class="layover-line-v2"></div><div class="layover-info-v2"><span class="layover-text" style="${layoverStyle}">Layover${layoverDur && layoverDur !== 'N/A' ? ' <strong>' + layoverDur + '</strong>' : ''} at <strong>${layoverCity}</strong>${showLayoverWarning ? layoverWarningBadge : ''}</span></div><div class="layover-line-v2"></div></div>`;
            }
            const bkClassStr = getSegmentBookingClassValue(seg);
            const showCabinClass = !!bkClassStr;
            const segmentCardClass = showCabinClass ? 'segment-card-v2 has-cabin-class' : 'segment-card-v2';
            const depDateTimeClass = showCabinClass ? 'tl-datetime has-cabin-class' : 'tl-datetime';
            const arrDateTimeClass = showCabinClass ? 'tl-datetime has-cabin-class' : 'tl-datetime';
            const isEditingSegment = activeSegmentEditIdx === segIdx;
            const cabinState = getCabinClassOptionState(seg);
            const cabinOptions = [...KNOWN_CABIN_CLASSES, '__custom__'];
            const inlineInputStyle = 'background:var(--bg-card); color:var(--text-primary); border:1px solid var(--border); border-radius:8px; padding:0.25rem 0.4rem; font:inherit; min-width:0; box-sizing:border-box;';
            const timingFieldStyle = hasTimingWarning ? 'color:#dc2626; font-weight:800;' : '';
            const timingInputStyle = hasTimingWarning
                ? 'color:#dc2626; border-color:rgba(220,38,38,0.45); box-shadow:0 0 0 2px rgba(220,38,38,0.08);'
                : '';
            const departureAirportFieldStyle = showDepartureAirportWarning ? 'color:#dc2626; font-weight:800;' : '';
            const departureAirportInputStyle = showDepartureAirportWarning
                ? 'color:#dc2626; border-color:rgba(220,38,38,0.45); box-shadow:0 0 0 2px rgba(220,38,38,0.08);'
                : '';
            const arrivalAirportFieldStyle = showArrivalAirportWarning ? 'color:#dc2626; font-weight:800;' : '';
            const arrivalAirportInputStyle = showArrivalAirportWarning
                ? 'color:#dc2626; border-color:rgba(220,38,38,0.45); box-shadow:0 0 0 2px rgba(220,38,38,0.08);'
                : '';
            const departureCityHasAnyWarning = showDepartureCityWarning;
            const arrivalCityHasAnyWarning = showArrivalCityWarning;
            const departureCityFieldStyle = departureCityHasAnyWarning ? 'color:#dc2626; font-weight:800;' : '';
            const departureCityInputStyle = departureCityHasAnyWarning
                ? 'color:#dc2626; border-color:rgba(220,38,38,0.45); box-shadow:0 0 0 2px rgba(220,38,38,0.08);'
                : '';
            const arrivalCityFieldStyle = arrivalCityHasAnyWarning ? 'color:#dc2626; font-weight:800;' : '';
            const arrivalCityInputStyle = arrivalCityHasAnyWarning
                ? 'color:#dc2626; border-color:rgba(220,38,38,0.45); box-shadow:0 0 0 2px rgba(220,38,38,0.08);'
                : '';
            const segmentHeaderMainHtml = isEditingSegment
                ? `<input class="segment-airline-v2" style="${inlineInputStyle}; width:150px; font-weight:700;" id="seg-airline-${segIdx}" value="${safe(seg.airline)}"><input class="segment-fltnum-v2" style="${inlineInputStyle}; width:95px; font-weight:700; ${showAirlineCodeWarning ? 'color:#dc2626; border-color:rgba(220,38,38,0.45); box-shadow:0 0 0 2px rgba(220,38,38,0.08);' : ''}" id="seg-fltnum-${segIdx}" value="${safe(seg.flight_number)}">${airlineCodeWarningBadge}<select class="seg-class-chip" style="${inlineInputStyle}; width:150px; font-size:0.72rem;" id="seg-class-${segIdx}" onchange="toggleCustomCabinClassField(${segIdx}, this.value)"><option value="" ${!cabinState.selectValue ? 'selected' : ''}>Select cabin</option>${cabinOptions.map(option => `<option value="${option}" ${cabinState.selectValue === option ? 'selected' : ''}>${option === '__custom__' ? 'Custom' : option}</option>`).join('')}</select><input class="seg-class-custom" style="${inlineInputStyle}; width:140px; font-size:0.72rem; display:${cabinState.isCustom ? 'inline-block' : 'none'};" id="seg-class-custom-${segIdx}" value="${safe(cabinState.customValue)}" placeholder="Enter custom class">`
                : `<span class="segment-airline-v2">${safe(seg.airline, 'Airline')}</span><span class="segment-fltnum-v2" style="${showAirlineCodeWarning ? 'color:#dc2626; font-weight:800;' : ''}">${safe(seg.flight_number)}</span>${showAirlineCodeWarning ? airlineCodeWarningBadge : ''}${showCabinClass ? `<span class="seg-class-chip">${bkClassStr}</span>` : ''}`;
            const depLocationHtml = isEditingSegment
                ? `<input class="tl-code" style="${inlineInputStyle}; width:68px; font-weight:800; text-transform:uppercase; text-align:center; ${departureAirportInputStyle}" id="seg-dep-apt-${segIdx}" value="${safe(dep.airport)}">${departureAirportWarningBadge}<input class="tl-city" style="${inlineInputStyle}; width:112px; font-size:0.75rem; ${departureCityInputStyle}" id="seg-dep-city-${segIdx}" value="${safe(dep.city)}">${departureCityWarningBadge}`
                : `<span class="tl-code" style="${departureAirportFieldStyle}">${safe(dep.airport, '---')}</span>${showDepartureAirportWarning ? departureAirportWarningBadge : ''}${dep.city ? `<span class="tl-city" style="font-size:0.75rem; color:var(--text-secondary); ${departureCityFieldStyle}">(${safe(dep.city)})</span>${departureCityHasAnyWarning ? departureCityWarningBadge : ''}` : ''}`;
            const depDateTimeHtml = isEditingSegment
                ? `<input class="tl-time" style="${inlineInputStyle}; width:68px; font-weight:700; text-align:center; ${timingInputStyle}" id="seg-dep-time-${segIdx}" value="${safe(dep.time)}"><input type="date" class="tl-date" style="${inlineInputStyle}; width:138px; font-size:0.72rem; ${timingInputStyle}" id="seg-dep-date-${segIdx}" value="${formatFlightDateForInput(dep.date)}">`
                : `<span class="tl-time" style="${timingFieldStyle}">${safe(dep.time, '--:--')}</span><span class="tl-date" style="${timingFieldStyle}">${safe(dep.date)}</span>`;
            const depTerminalHtml = isEditingSegment
                ? `<div style="display:flex; flex-direction:column; align-items:flex-start; margin-top:0.35rem;"><input class="tl-terminal tl-terminal-input" style="${inlineInputStyle}; width:110px; font-size:0.72rem; font-weight:700; ${showDepartureTerminalWarning ? 'color:#dc2626; border-color:rgba(220,38,38,0.45); box-shadow:0 0 0 2px rgba(220,38,38,0.08);' : ''}" id="seg-dep-term-${segIdx}" placeholder="Terminal" value="${safe(dep.terminal)}">${departureTerminalWarningBadge}</div>`
                : `${formatTerminalDisplay(dep.terminal) ? `<div style="display:flex; flex-direction:column; align-items:flex-start; margin-top:0.35rem;"><span class="tl-terminal" style="${showDepartureTerminalWarning ? 'color:#dc2626; font-weight:800;' : ''}">${safe(formatTerminalDisplay(dep.terminal))}</span>${departureTerminalWarningBadge}</div>` : ''}`;
            const arrLocationHtml = isEditingSegment
                ? `<input class="tl-code" style="${inlineInputStyle}; width:68px; font-weight:800; text-transform:uppercase; text-align:center; ${arrivalAirportInputStyle}" id="seg-arr-apt-${segIdx}" value="${safe(arr.airport)}">${arrivalAirportWarningBadge}<input class="tl-city" style="${inlineInputStyle}; width:112px; font-size:0.75rem; ${arrivalCityInputStyle}" id="seg-arr-city-${segIdx}" value="${safe(arr.city)}">${arrivalCityWarningBadge}`
                : `<span class="tl-code" style="${arrivalAirportFieldStyle}">${safe(arr.airport, '---')}</span>${showArrivalAirportWarning ? arrivalAirportWarningBadge : ''}${arr.city ? `<span class="tl-city" style="font-size:0.75rem; color:var(--text-secondary); ${arrivalCityFieldStyle}">(${safe(arr.city)})</span>${arrivalCityHasAnyWarning ? arrivalCityWarningBadge : ''}` : ''}`;
            const arrDateTimeHtml = isEditingSegment
                ? `<input class="tl-time" style="${inlineInputStyle}; width:68px; font-weight:700; text-align:center; ${timingInputStyle}" id="seg-arr-time-${segIdx}" value="${safe(arr.time)}"><input type="date" class="tl-date" style="${inlineInputStyle}; width:138px; font-size:0.72rem; ${timingInputStyle}" id="seg-arr-date-${segIdx}" value="${formatFlightDateForInput(arr.date)}">`
                : `<span class="tl-time" style="${timingFieldStyle}">${safe(arr.time, '--:--')}</span><span class="tl-date" style="${timingFieldStyle}">${safe(arr.date)}</span>`;
            const arrTerminalHtml = isEditingSegment
                ? `<div style="display:flex; flex-direction:column; align-items:flex-start; margin-top:0.35rem;"><input class="tl-terminal tl-terminal-input" style="${inlineInputStyle}; width:110px; font-size:0.72rem; font-weight:700; ${showArrivalTerminalWarning ? 'color:#dc2626; border-color:rgba(220,38,38,0.45); box-shadow:0 0 0 2px rgba(220,38,38,0.08);' : ''}" id="seg-arr-term-${segIdx}" placeholder="Terminal" value="${safe(arr.terminal)}">${arrivalTerminalWarningBadge}</div>`
                : `${formatTerminalDisplay(arr.terminal) ? `<div style="display:flex; flex-direction:column; align-items:flex-start; margin-top:0.35rem;"><span class="tl-terminal" style="${showArrivalTerminalWarning ? 'color:#dc2626; font-weight:800;' : ''}">${safe(formatTerminalDisplay(arr.terminal))}</span>${arrivalTerminalWarningBadge}</div>` : ''}`;
            const durationDisplay = showSegmentNegativeWarning
                ? segmentTemporalValidation.display
                : (hasDurationWarning && !showDateOrderWarning && !showOvernightDateWarning
                    ? duration
                    : (hasTimingWarning ? '' : duration));
            const durationInputValue = showSegmentNegativeWarning ? segmentTemporalValidation.display : duration;
            const durationHtml = isEditingSegment
                ? `<div style="position:absolute; top:-30px; left:50%; transform:translateX(-50%); z-index:3; display:flex; align-items:center; gap:0.35rem;"><input style="${inlineInputStyle}; width:98px; text-align:center; font-size:0.72rem; background:var(--bg-card); color:${hasTimingWarning ? '#dc2626' : 'var(--text-primary)'}; border-color:${hasTimingWarning ? 'rgba(220,38,38,0.4)' : 'var(--border)'};" id="seg-duration-${segIdx}" value="${safe(durationInputValue)}">${durationWarningBadge}</div>`
                : `${hasTimingWarning || durationDisplay ? `<span class="timeline-duration" style="${hasTimingWarning ? 'color:#dc2626; font-weight:800; display:inline-flex; align-items:center; gap:0.35rem;' : 'display:inline-flex; align-items:center; gap:0.35rem;'}">${durationDisplay}${hasTimingWarning ? durationWarningBadge : ''}</span>` : ''}`;

            html += `<div class="${segmentCardClass}" style="${seg.status === 'cancelled' ? 'opacity:0.85; border-left:6px solid #ef4444; background:rgba(239,68,68,0.08); box-shadow: inset 0 0 10px rgba(239,68,68,0.1);' : ''}">
                <div class="segment-header-v2">
                    <div class="segment-airline-info"><div class="segment-airline-main">${segmentHeaderMainHtml}</div>${seg.status === 'cancelled' ? `<span class="status-badge" style="background:#ef4444; color:white; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:700; box-shadow:0 2px 4px rgba(239,68,68,0.2);">CANCELLED</span>` : ''}</div>
                    <div style="display:flex;align-items:center;gap:0.5rem;">${isEditingSegment ? `<button class="btn-action small secondary" onclick="cancelSegmentEdit()">Cancel</button><button class="btn-action small primary" onclick="saveSegmentEdit(${segIdx})">Save</button>` : `<button class="btn-action small secondary" onclick="editSegment(${segIdx})">Edit</button>`}</div>
                </div>
                <div class="segment-timeline-v2">
                    <div class="timeline-point dep"><div class="timeline-dot"></div><div class="timeline-details" style="display:flex; flex-direction:column; align-items:flex-start;"><div style="display:flex; align-items:baseline; gap:0.3rem; flex-wrap:wrap;">${depLocationHtml}</div><div class="${depDateTimeClass}" style="display:flex; gap:0.4rem; align-items:baseline; margin-top:2px; justify-content:flex-start; flex-wrap:wrap;">${depDateTimeHtml}</div>${depTerminalHtml}</div></div>
                    <div class="timeline-connector">${durationHtml}</div>
                    <div class="timeline-point arr"><div class="timeline-dot arr-dot"></div><div class="timeline-details" style="display:flex; flex-direction:column; align-items:flex-start; text-align:left;"><div style="display:flex; align-items:baseline; gap:0.3rem; flex-wrap:wrap;">${arrLocationHtml}</div><div class="${arrDateTimeClass}" style="display:flex; gap:0.4rem; align-items:baseline; margin-top:2px; justify-content:flex-start; flex-wrap:wrap;">${arrDateTimeHtml}</div>${arrTerminalHtml}</div></div>
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
    if (el.classList.contains('collapsed')) expandedLegIds.delete(legId);
    else expandedLegIds.add(legId);
    if (icon) icon.textContent = el.classList.contains('collapsed') ? 'v' : '^';
}

function setPassengerSortMode(mode) {
    passengerSortMode = mode || '';
    renderPassengersSection();
}

function setTicketCurrency(currency) {
    editedData.currency = normalizeCurrencyCode(currency);
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
        ${renderTitleWithIcon('Passengers', 'passengers')}
        <div style="display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap;">
            <label style="display:flex; align-items:center; gap:0.45rem; font-size:0.9rem; color:var(--text-secondary);">
                <span>Sort</span>
                <select class="sort-control" onchange="setPassengerSortMode(this.value)">
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

    const passengerCardAccents = [
        { border: '#1e3a8a' },
        { border: '#92400e' },
        { border: '#065f46' },
        { border: '#9d174d' },
        { border: '#5b21b6' }
    ];

    passengerRows.forEach(({ passenger: p, originalIndex: i }) => {
        const paxType = getPaxLabel(p.pax_type || p.type);
        const typeClass = paxType.toLowerCase();
        const seats = p.seats || [];
        const passengerNameWarningKey = getPassengerNameWarningKey(i, p.name);
        const showPassengerNameWarning = doesPassengerNameNeedWarning(p.name) && !isWarningDismissed(passengerNameWarningKey);

        const isChecked = selectedPaxIndices.has(i);
        const accent = passengerCardAccents[i % passengerCardAccents.length];
        html += `<div class="pax-edit-card ${isChecked ? 'pax-selected' : ''}" id="pax-card-${i}" style="--pax-accent-border:${accent.border};">
            <div class="pax-edit-header">
                <div style="display:flex;align-items:center;gap:0.6rem;">
                    <input type="checkbox" class="pax-checkbox" id="paxCheck-${i}"
                        ${isChecked ? 'checked' : ''}
                        onchange="togglePaxSelection(${i}, this.checked)">
                    <h4 class="passenger-card-title" style="margin:0;">${getInlineSvgIcon('passenger', 'inline-icon inline-icon-sm')}<span>${safe(p.name, 'Passenger ' + (i + 1))}</span></h4>
                </div>
                <div style="display:flex;align-items:center;gap:0.5rem;">
                    <span class="pax-type-badge ${typeClass}">${paxType}</span>
                    <button class="btn-action small danger" onclick="removePassenger(${i})" style="padding:0.3rem 0.5rem;">✕</button>
                </div>
            </div>
            <div class="field-grid">
                <div class="field-item ${showPassengerNameWarning ? 'warning' : ''}" id="pax-name-field-${i}">
                    <div class="field-label-row">
                        <label>Name</label>
                        ${showPassengerNameWarning ? buildWarningBadge(passengerNameWarningKey, 'Passenger name is still the placeholder "Passenger"') : ''}
                    </div>
                    <input type="text" value="${safe(p.name)}" oninput="updatePassengerField(${i}, 'name', this.value)" onchange="updatePassengerField(${i}, 'name', this.value)">
                </div>
                <div class="field-item"><label>Pax Type</label>
                    <select onchange="updatePassengerField(${i}, 'pax_type', this.value)">
                        <option value="ADT" ${(p.pax_type || '').toUpperCase() === 'ADT' ? 'selected' : ''}>Adult</option>
                        <option value="CHD" ${(p.pax_type || '').toUpperCase() === 'CHD' ? 'selected' : ''}>Child</option>
                        <option value="INF" ${(p.pax_type || '').toUpperCase() === 'INF' ? 'selected' : ''}>Infant</option>
                    </select></div>
                <div class="field-item ${doesTicketNumberNeedWarning(p.ticket_number) && !isWarningDismissed(getTicketNumberWarningKey(i, p.ticket_number)) ? 'warning' : ''}" id="pax-ticket-field-${i}">
                    <div class="field-label-row">
                        <label>Ticket Number</label>
                        ${doesTicketNumberNeedWarning(p.ticket_number) && !isWarningDismissed(getTicketNumberWarningKey(i, p.ticket_number)) ? buildWarningBadge(getTicketNumberWarningKey(i, p.ticket_number), 'Ticket number is shorter than 13 characters') : ''}
                    </div>
                    <input type="text" value="${safe(p.ticket_number)}" oninput="updatePassengerField(${i}, 'ticket_number', this.value)" onchange="updatePassengerField(${i}, 'ticket_number', this.value)">
                </div>
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
        ? (hasRawConsolidatedFare || !hasExplicitPassengerFares)
        : !hasExplicitPassengerFares;
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
        if (hasExplicitPassengerFares) {
            return explicitPassengerFareRows[index] || { base: 0, k3: 0, other: 0 };
        }
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
        hasExplicitPassengerFares
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

function updateFareQuickFillDraft(value) {
    fareQuickFillDraft = String(value || '');
    const ticketId = editedData?.id || currentTicket?.id;
    if (ticketId) {
        fareQuickFillDraftByTicket.set(ticketId, fareQuickFillDraft);
    }
}

function parseFareQuickFillValue(value) {
    const matches = String(value || '').match(/-?\d+(?:\.\d+)?/g) || [];
    if (matches.length === 0) return null;
    return {
        base: matches.length > 0 ? parseMoneyValue(matches[0]) : 0,
        k3: matches.length > 1 ? parseMoneyValue(matches[1]) : 0,
        other: matches.length > 2 ? parseMoneyValue(matches[2]) : 0,
        markup: matches.length > 3 ? parseMoneyValue(matches[3]) : 0
    };
}

function applyFareQuickFill(rawValue) {
    const parsed = parseFareQuickFillValue(rawValue);
    if (!parsed) {
        showToast('Enter fare amounts in order: base, k3, other, markup', 'error');
        return;
    }

    fareFieldsTouched = true;
    if (!editedData.journey) editedData.journey = {};
    if (!editedData.journey.consolidated_fare) {
        editedData.journey.consolidated_fare = { base_fare: 0, k3_gst: 0, other_taxes: 0 };
    }

    const passengers = editedData.passengers || [];
    const passengerCount = passengers.length || 1;
    const fareMode = editedData.journey.fare_display || (passengers.length <= 1 ? 'per_passenger' : 'consolidated');
    const isConsolidated = fareMode === 'consolidated';

    fareQuickFillDraft = String(rawValue || '').trim();
    const ticketId = editedData?.id || currentTicket?.id;
    if (ticketId) {
        fareQuickFillDraftByTicket.set(ticketId, fareQuickFillDraft);
    }

    if (isConsolidated) {
        editedData.journey.consolidated_fare.base_fare = parsed.base;
        editedData.journey.consolidated_fare.k3_gst = parsed.k3;
        editedData.journey.consolidated_fare.other_taxes = parsed.other;
        editedData.journey.global_markup = parsed.markup / passengerCount;
    } else {
        passengers.forEach((passenger) => {
            if (!passenger.fare) passenger.fare = {};
            passenger.fare.base_fare = parsed.base;
            passenger.fare.k3_gst = parsed.k3;
            passenger.fare.other_taxes = parsed.other;
        });
        editedData.journey.consolidated_fare.base_fare = parsed.base * passengerCount;
        editedData.journey.consolidated_fare.k3_gst = parsed.k3 * passengerCount;
        editedData.journey.consolidated_fare.other_taxes = parsed.other * passengerCount;
        editedData.journey.global_markup = parsed.markup;
    }

    recalcFareGlobal(false);
    renderFareSection();
    triggerAutoSave();
    showToast(
        isConsolidated
            ? 'Quick fare fill applied to consolidated fare'
            : 'Quick fare fill applied to all passenger fare rows',
        'success'
    );
}

function switchFareDisplay(nextMode) {
    if (!editedData.journey) editedData.journey = {};
    const passengers = editedData.passengers || [];
    const passengerCount = passengers.length || 1;
    const fareState = getNormalizedFareState();
    const globalMarkup = fareState.globalMarkup;

    if (nextMode === 'per_passenger') {
        if (!fareState.hasExplicitPassengerFares) {
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
            passengers.forEach((passenger, index) => {
                if (!passenger.fare) passenger.fare = {};
                const row = fareState.passengerRows[index] || { base: 0, k3: 0, other: 0 };
                passenger.fare.total_fare = row.base + row.k3 + row.other + globalMarkup;
            });
        }
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

    html += `<div style="margin:0 0 0.75rem; padding:0.6rem 0.7rem; border:1px solid rgba(37,99,235,0.12); border-radius:12px; background:rgba(37,99,235,0.04);">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:0.75rem; flex-wrap:wrap; margin-bottom:0.35rem;">
            <div style="font-size:0.7rem; font-weight:800; color:var(--primary); letter-spacing:0.05em; text-transform:uppercase;">Quick Fill</div>
        </div>
        <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
            <input type="text"
                id="fare-quick-fill"
                value="${safe(fareQuickFillDraft)}"
                placeholder="Base K3 Other Markup"
                oninput="updateFareQuickFillDraft(this.value)"
                onkeydown="if(event.key === 'Enter'){ event.preventDefault(); applyFareQuickFill(this.value); }"
                style="flex:1; min-width:220px; padding:0.62rem 0.75rem; border-radius:10px; border:1px solid rgba(37,99,235,0.14); background:rgba(255,255,255,0.96); color:var(--text-secondary); font-weight:400; font-size:0.86rem;">
            <button class="btn-action small primary" onclick="applyFareQuickFill(document.getElementById('fare-quick-fill').value)" style="padding:0.62rem 0.9rem; border-radius:10px; min-width:84px;">Apply</button>
        </div>
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
                    <button class="pdf-btn with-fare" data-pdf-download="with-fare" onclick="downloadPDF(true)">ðŸ“„ PDF (With Fare)</button>
                    <button class="pdf-btn without-fare" data-pdf-download="without-fare" onclick="downloadPDF(false)">ðŸ“„ PDF (Without Fare)</button>
                </div>
                <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(5,150,105,0.08); padding:0.6rem 1.2rem; border-radius:12px; border:1px solid rgba(5,150,105,0.2);">
                    <span style="font-weight:700; color:#059669;">Merged booking view. Passenger tickets are grouped here as one booking.</span>
                </div>
            </div>`;
        return;
    }

    document.getElementById('actionsSection').innerHTML = `
        <div class="section-header-row"><h2>⚡ Actions</h2></div>
                <div style="display:flex;flex-wrap:nowrap;gap:0.75rem;align-items:center;overflow-x:auto;padding-bottom:10px;scrollbar-width:none;-ms-overflow-style:none;">
                    <div class="pdf-btn-group">
                        <button class="pdf-btn with-fare" data-pdf-download="with-fare" onclick="downloadPDF(true)">📄 PDF (With Fare)</button>
                        <button class="pdf-btn without-fare" data-pdf-download="without-fare" onclick="downloadPDF(false)">📄 PDF (Without Fare)</button>
                    </div>
                    ${!editedData.ledger_hash ? `
                    <div id="ledgerBtnGroup" style="display:flex; align-items:center; gap:0.5rem; background:var(--bg-main); padding:0.5rem 1rem; border-radius:12px; border:1px solid var(--border);">
                        <span style="font-size:0.75rem; color:var(--text-secondary); font-weight:700; text-transform:uppercase;">Add to Ledger:</span>
                        <select id="ledgerAggSelect" style="padding:0.35rem 0.5rem; border-radius:8px; border:1px solid var(--border); font-family:inherit; font-size:0.82rem; background:var(--bg-card); color:var(--text-primary);">
                            <option value="">Loading...</option>
                        </select>
                        <button class="pdf-btn" style="background: #10b981; color:white; padding: 0.45rem 0.5rem; min-width:38px; justify-content:center;" onclick="addToLedger('AB')">AB</button>
                        <button class="pdf-btn" style="background: #6366f1; color:white; padding: 0.45rem 0.5rem; min-width:38px; justify-content:center;" onclick="addToLedger('CK')">CK</button>
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
    await populateAggregatorSelect('ledgerAggSelect', 'Select aggregator');
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
        const perPassengerMarkup = passengersCount ? globalMarkup : 0;
        (editedData.passengers || []).forEach((passenger, index) => {
            if (!passenger.fare) passenger.fare = {};
            const row = fareState.hasExplicitPassengerFares
                ? (fareState.passengerRows[index] || { base: 0, k3: 0, other: 0 })
                : {
                    base: passengersCount ? (base / passengersCount) : 0,
                    k3: passengersCount ? (k3 / passengersCount) : 0,
                    other: passengersCount ? (other / passengersCount) : 0
                };
            if (!fareState.hasExplicitPassengerFares) {
                passenger.fare.base_fare = row.base;
                passenger.fare.k3_gst = row.k3;
                passenger.fare.other_taxes = row.other;
            }
            passenger.fare.total_fare = row.base + row.k3 + row.other + perPassengerMarkup;
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

function syncPassengerNamesToVisibleUi(index) {
    const passenger = editedData?.passengers?.[index];
    if (!passenger) return;
    const passengerName = safe(passenger.name, 'Passenger ' + (index + 1));
    const passengerHeader = document.querySelector(`#pax-card-${index} .pax-edit-header h4`);
    if (passengerHeader) {
        passengerHeader.textContent = `👤 ${passengerName}`;
    }

    // NOTE: Do NOT mutate currentTicket here during an edit session.
    // currentTicket must stay as a clean copy of the last server state so that
    // the detail cache, draft comparison, and sync logic all work correctly.
    // The list-view card below is updated via allTickets which is separate.
    const ticketIndex = allTickets.findIndex(ticket => ticket.id === editedData?.id);
    if (ticketIndex !== -1) {
        allTickets[ticketIndex].passengers = JSON.parse(JSON.stringify(editedData.passengers || []));
    }

    syncPassengerNameWarningUi(index);

    if (passengerSortMode === 'name') {
        renderPassengersSection();
    }
    renderFareSection();
    renderTicketCards();
}

function syncPassengerNameWarningUi(index) {
    const field = document.getElementById(`pax-name-field-${index}`);
    if (!field) return;
    const passengerName = editedData?.passengers?.[index]?.name;
    const warningKey = getPassengerNameWarningKey(index, passengerName);
    const needsWarning = doesPassengerNameNeedWarning(passengerName) && !isWarningDismissed(warningKey);
    field.classList.toggle('warning', needsWarning);

    let badge = field.querySelector('.field-warning-badge');
    if (needsWarning && !badge) {
        const labelRow = field.querySelector('.field-label-row');
        if (!labelRow) return;
        labelRow.insertAdjacentHTML('beforeend', buildWarningBadge(warningKey, 'Passenger name is still the placeholder "Passenger"'));
    } else if (!needsWarning && badge) {
        badge.remove();
    }
}

function doesTicketNumberNeedWarning(value) {
    if (value === undefined || value === null) return false;
    const normalized = String(value).trim();
    if (!normalized || normalized === 'N/A' || normalized === 'Not Specified') return false;
    return normalized.length < 13;
}

function syncPassengerTicketNumberWarningUi(index) {
    const field = document.getElementById(`pax-ticket-field-${index}`);
    if (!field) return;
    const ticketNumber = editedData?.passengers?.[index]?.ticket_number;
    const warningKey = getTicketNumberWarningKey(index, ticketNumber);
    const needsWarning = doesTicketNumberNeedWarning(ticketNumber) && !isWarningDismissed(warningKey);
    field.classList.toggle('warning', needsWarning);

    let badge = field.querySelector('.field-warning-badge');
    if (needsWarning && !badge) {
        const labelRow = field.querySelector('.field-label-row');
        if (!labelRow) return;
        labelRow.insertAdjacentHTML('beforeend', buildWarningBadge(warningKey, 'Ticket number is shorter than 13 characters'));
    } else if (!needsWarning && badge) {
        badge.remove();
    }
}

function updatePassengerField(index, field, value) {
    if (!editedData.passengers || !editedData.passengers[index]) return;
    editedData.passengers[index][field] = value;
    if (field === 'name') {
        syncPassengerNamesToVisibleUi(index);
    } else if (field === 'pax_type' || field === 'type') {
        renderPassengersSection();
    } else if (field === 'ticket_number') {
        syncPassengerTicketNumberWarningUi(index);
    }
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
    activeSegmentEditIdx = activeSegmentEditIdx === idx ? null : idx;
    if (activeSegmentEditIdx === idx) {
        const segments = editedData.segments || [];
        const journey = editedData.journey || {};
        const legs = journey.legs && journey.legs.length > 0
            ? journey.legs.map(leg => leg.segments || [])
            : groupSegmentsIntoLegs(segments);
        const legIdx = legs.findIndex(leg => Array.isArray(leg) && leg.includes(idx));
        if (legIdx !== -1) expandedLegIds.add(`leg-${legIdx}`);
    }
    renderSegmentsSection();
    if (activeSegmentEditIdx === idx) {
        requestAnimationFrame(() => {
            const input = document.getElementById(`seg-airline-${idx}`);
            if (input) input.focus();
        });
    }
}

function cancelSegmentEdit() {
    activeSegmentEditIdx = null;
    renderSegmentsSection();
}

function toggleCustomCabinClassField(segIdx, selectedValue) {
    const customInput = document.getElementById(`seg-class-custom-${segIdx}`);
    if (!customInput) return;
    const showCustom = selectedValue === '__custom__';
    customInput.style.display = showCustom ? 'inline-block' : 'none';
    if (showCustom) {
        customInput.focus();
    } else {
        customInput.value = '';
    }
}

async function saveSegmentEdit(idx) {
    const seg = editedData.segments[idx];
    const originalSegment = JSON.parse(JSON.stringify(seg || {}));
    const beforeSnapshots = {
        [idx - 1]: getEditableSegmentSnapshot(idx - 1),
        [idx]: JSON.parse(JSON.stringify(seg || {})),
        [idx + 1]: getEditableSegmentSnapshot(idx + 1)
    };
    const getValue = (id) => document.getElementById(`${id}-${idx}`)?.value || '';

    seg.airline = getValue('seg-airline').trim();
    seg.flight_number = formatFlightNumberValue(getValue('seg-fltnum'));
    const selectedCabinClass = getValue('seg-class').trim();
    const customCabinClass = getValue('seg-class-custom').trim();
    const finalCabinClass = selectedCabinClass === '__custom__' ? customCabinClass : selectedCabinClass;
    seg.show_booking_class = !!finalCabinClass;
    if (finalCabinClass) seg.booking_class = finalCabinClass;
    else delete seg.booking_class;

    if (!seg.departure) seg.departure = {};
    seg.departure.airport = getValue('seg-dep-apt').trim().toUpperCase();
    seg.departure.city = getValue('seg-dep-city').trim();
    seg.departure.date = formatFlightDateForStorage(getValue('seg-dep-date'));
    seg.departure.time = getValue('seg-dep-time');
    seg.departure.terminal = getValue('seg-dep-term');

    if (!seg.arrival) seg.arrival = {};
    seg.arrival.airport = getValue('seg-arr-apt').trim().toUpperCase();
    seg.arrival.city = getValue('seg-arr-city').trim();
    seg.arrival.date = formatFlightDateForStorage(getValue('seg-arr-date'));
    seg.arrival.time = getValue('seg-arr-time');
    seg.arrival.terminal = getValue('seg-arr-term');
    syncSegmentScheduleFields(seg);

    const editedDuration = getValue('seg-duration');
    if (didSegmentScheduleChange(originalSegment, seg)) {
        clearScheduleAffectedWarnings(idx, beforeSnapshots, { [idx]: seg });
        await recomputeEditedSegmentsDerivedData();
        clearScheduleAffectedWarnings(idx, beforeSnapshots);
    } else {
        clearSegmentTimingWarnings(idx, originalSegment);
        seg.duration_calculated = editedDuration;
        seg.duration = editedDuration;
        seg.duration_extracted = editedDuration;
        delete seg.duration_validation;
        clearSegmentTimingWarnings(idx, seg);
    }

    syncJourneyDerivedDurations();

    activeSegmentEditIdx = null;
    renderSegmentsSection();
    isDetailDirty = true;
    persistTicketDraft();
    await queueSave(true);
    showToast('Segment updated', 'success');
}
// ==================== SAVE & PDF ====================
async function saveTicket(silent = false) {
    if (!currentTicket || !editedData) return;
    const saveStartedAt = Date.now();
    const ticketIdAtSaveStart = currentTicket.id;
    const localSnapshotBeforeSave = JSON.parse(JSON.stringify(editedData));
    isSaveInFlight = true;
    try {
        const payload = {
            is_merged_view: !!editedData.is_merged_view,
            pnr: editedData.pnr,
            booking_date: editedData.booking_date,
            phone: editedData.phone,
            currency: editedData.currency,
            grand_total: editedData.grand_total,
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
        const savedTicketSource = responsePayload.ticket
            ? JSON.parse(JSON.stringify(responsePayload.ticket))
            : JSON.parse(JSON.stringify(localSnapshotBeforeSave));
        if (responsePayload.ticket_summary && typeof responsePayload.ticket_summary === 'object') {
            Object.assign(savedTicketSource, JSON.parse(JSON.stringify(responsePayload.ticket_summary)));
        }
        const savedTicket = normalizeTicketFareData(savedTicketSource);
        const editsChangedDuringSave = (
            currentTicket?.id !== ticketIdAtSaveStart
            || lastDetailInputAt > saveStartedAt
            || JSON.stringify(editedData) !== JSON.stringify(localSnapshotBeforeSave)
        );

        currentTicket = savedTicket;
        fareFieldsTouched = false;
        setTicketEditBaseline(currentTicket);
        cacheTicketDetail(currentTicket);

        if (editsChangedDuringSave) {
            isDetailDirty = true;
            persistTicketDraft();
            triggerAutoSave();
        } else {
            editedData = JSON.parse(JSON.stringify(currentTicket));
            clearTicketDraft(currentTicket.id);
        }

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
    if ((target.id || '').startsWith('seg-')) return true;
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
        delete clean.duration_validation;
        return syncSegmentScheduleFields(clean);
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

function setPdfButtonLoading(includeFare, isLoading) {
    const buttonType = includeFare ? 'with-fare' : 'without-fare';
    const button = document.querySelector(`[data-pdf-download="${buttonType}"]`);
    if (!button) return;

    if (!button.dataset.originalLabel) {
        button.dataset.originalLabel = button.innerHTML;
    }

    if (isLoading) {
        button.classList.add('is-loading');
        button.innerHTML = includeFare ? 'Preparing Fare PDF' : 'Preparing PDF';
        return;
    }

    button.classList.remove('is-loading');
    button.innerHTML = button.dataset.originalLabel || button.innerHTML;
}

async function downloadPDF(includeFare) {
    setPdfButtonLoading(includeFare, true);
    try {
        await ensureTicketPersistedForDownload();
        await downloadPdfFromSnapshot(
            `/api/tickets/${currentTicket.id}/pdf`,
            buildTicketPdfSnapshot({ include_fare: includeFare }),
            'ticket.pdf'
        );
        showToast(`PDF download started (${includeFare ? 'with fare' : 'without fare'})`, 'success');
    } catch (e) {
        showToast(e.message || 'PDF generation failed', 'error');
    } finally {
        setPdfButtonLoading(includeFare, false);
    }
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
        const ticketId = currentTicket.id;
        const r = await fetch('/api/tickets/' + currentTicket.id, { method: 'DELETE' });
        if (!r.ok) { showToast('Delete failed', 'error'); return; }
        removeTicketFromLocalState(ticketId, { render: false });
        updateTicketSelectionToolbar();
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

async function applyWarningSuggestion(warningKey, suggestion) {
    if (typeof suggestion === 'string') {
        try {
            suggestion = JSON.parse(suggestion);
        } catch (e) {
            suggestion = null;
        }
    }
    if (!suggestion) return;
    if (suggestion.action === 'dismiss-warning') {
        confirmWarningOkay(warningKey);
        return;
    }
    if (suggestion.action === 'update-city') {
        const segIdx = Number(suggestion.segIdx);
        const field = suggestion.field;
        const nextValue = safe(suggestion.value, '').toString().trim();
        if (!Number.isInteger(segIdx) || !nextValue || !['departure', 'arrival'].includes(field)) return;
        if (!editedData.segments || !editedData.segments[segIdx]) return;
        if (!editedData.segments[segIdx][field]) editedData.segments[segIdx][field] = {};

        editedData.segments[segIdx][field].city = nextValue;
        clearDismissedWarning(warningKey);
        _closeModal();
        renderDetailView();
        triggerAutoSave();
        return;
    }
    if (suggestion.action === 'update-airport') {
        const segIdx = Number(suggestion.segIdx);
        const field = suggestion.field;
        const nextValue = safe(suggestion.value, '').toString().trim().toUpperCase();
        if (!Number.isInteger(segIdx) || !nextValue || !['departure', 'arrival'].includes(field)) return;
        if (!editedData.segments || !editedData.segments[segIdx]) return;
        if (!editedData.segments[segIdx][field]) editedData.segments[segIdx][field] = {};

        const beforeSnapshots = {
            [segIdx - 1]: getEditableSegmentSnapshot(segIdx - 1),
            [segIdx]: getEditableSegmentSnapshot(segIdx),
            [segIdx + 1]: getEditableSegmentSnapshot(segIdx + 1)
        };
        const originalSegment = JSON.parse(JSON.stringify(editedData.segments[segIdx] || {}));
        editedData.segments[segIdx][field].airport = nextValue;
        syncSegmentScheduleFields(editedData.segments[segIdx]);
        delete editedData.segments[segIdx].duration_validation;
        clearScheduleAffectedWarnings(segIdx, beforeSnapshots, { [segIdx]: editedData.segments[segIdx] });
        await recomputeEditedSegmentsDerivedData();
        clearScheduleAffectedWarnings(segIdx, beforeSnapshots);
        clearDismissedWarning(warningKey);
        _closeModal();
        renderDetailView();
        triggerAutoSave();
        return;
    }
    if (suggestion.action === 'update-arrival-date') {
        const segIdx = Number(suggestion.segIdx);
        const nextValue = safe(suggestion.value, '').toString().trim();
        if (!Number.isInteger(segIdx) || !nextValue) return;
        if (!editedData.segments || !editedData.segments[segIdx]) return;
        if (!editedData.segments[segIdx].arrival) editedData.segments[segIdx].arrival = {};

        const beforeSnapshots = {
            [segIdx - 1]: getEditableSegmentSnapshot(segIdx - 1),
            [segIdx]: getEditableSegmentSnapshot(segIdx),
            [segIdx + 1]: getEditableSegmentSnapshot(segIdx + 1)
        };
        const originalSegment = JSON.parse(JSON.stringify(editedData.segments[segIdx] || {}));
        editedData.segments[segIdx].arrival.date = nextValue;
        syncSegmentScheduleFields(editedData.segments[segIdx]);
        delete editedData.segments[segIdx].duration_validation;
        clearScheduleAffectedWarnings(segIdx, beforeSnapshots, { [segIdx]: editedData.segments[segIdx] });
        await recomputeEditedSegmentsDerivedData();
        clearScheduleAffectedWarnings(segIdx, beforeSnapshots);
        clearDismissedWarnings(warningKey);
        _closeModal();
        renderDetailView();
        triggerAutoSave();
        showToast(`Arrival date updated to ${nextValue}`, 'success');
        return;
    }
    if (suggestion.action === 'update-airline') {
        const segIdx = Number(suggestion.segIdx);
        const nextValue = safe(suggestion.value, '').toString().trim();
        if (!Number.isInteger(segIdx) || !nextValue) return;
        if (!editedData.segments || !editedData.segments[segIdx]) return;

        editedData.segments[segIdx].airline = nextValue;
        clearDismissedWarning(warningKey);
        _closeModal();
        renderDetailView();
        triggerAutoSave();
        return;
    }
    if (suggestion.action === 'prompt-flight-number') {
        openFlightNumberPrompt(warningKey, suggestion);
        return;
    }
}

function saveSuggestedFlightNumber(warningKey, suggestion) {
    if (typeof suggestion === 'string') {
        try {
            suggestion = JSON.parse(suggestion);
        } catch (e) {
            suggestion = null;
        }
    }
    if (!suggestion || suggestion.action !== 'prompt-flight-number') return;
    const segIdx = Number(suggestion.segIdx);
    const airlineCode = safe(suggestion.airlineCode, '').toString().trim().toUpperCase();
    const numberInput = document.getElementById('suggested-flight-number-input');
    const numberPart = safe(numberInput?.value, '').toString().trim().toUpperCase();
    if (!Number.isInteger(segIdx) || !airlineCode || !numberPart) return;
    if (!/^\d{1,4}[A-Z]?$/.test(numberPart)) {
        showToast('Enter only the flight number part, without the airline code.', 'warning');
        if (numberInput) numberInput.focus();
        return;
    }
    if (!editedData.segments || !editedData.segments[segIdx]) return;

    editedData.segments[segIdx].flight_number = `${airlineCode} ${numberPart}`;
    clearDismissedWarning(warningKey);
    _closeModal();
    renderDetailView();
    triggerAutoSave();
}

function openFlightNumberPrompt(warningKey, suggestion) {
    if (typeof suggestion === 'string') {
        try {
            suggestion = JSON.parse(suggestion);
        } catch (e) {
            suggestion = null;
        }
    }
    if (!suggestion || suggestion.action !== 'prompt-flight-number') return;
    const airlineCode = safe(suggestion.airlineCode, '').toString().trim().toUpperCase();
    const segIdx = Number(suggestion.segIdx);
    const currentFlightNumber = safe(editedData?.segments?.[segIdx]?.flight_number, '').toString().trim().toUpperCase();
    const parsedCurrent = parseFlightNumber(currentFlightNumber);
    const initialValue = parsedCurrent.numberPart || '';
    _closeModal();
    const html = `
        <div style="max-width:380px;">
            <div style="font-weight:800; font-size:1rem; color:var(--text-primary); margin-bottom:0.85rem;">Correct Flight Number</div>
            <div style="color:var(--text-secondary); font-size:0.92rem; line-height:1.5; margin-bottom:0.85rem;">
                Enter the correct flight number without the airline code.
            </div>
            <div style="color:var(--text-primary); font-size:0.92rem; font-weight:600; line-height:1.5; margin-bottom:0.75rem;">
                Airline code <strong>${escapeHtmlAttribute(airlineCode)}</strong> will be added automatically.
            </div>
            <input id="suggested-flight-number-input" type="text" value="${escapeHtmlAttribute(initialValue)}" placeholder="e.g. 1234" style="width:100%; padding:0.7rem 0.85rem; border:1px solid var(--border); border-radius:10px; background:var(--bg-main); color:var(--text-primary); font:inherit; margin-bottom:1rem; box-sizing:border-box;">
            <div style="display:flex; gap:0.75rem; justify-content:flex-end;">
                <button class="btn-action secondary" onclick="_closeModal()">Cancel</button>
                <button class="btn-action primary" onclick='saveSuggestedFlightNumber(${JSON.stringify(String(warningKey || ""))}, ${JSON.stringify(suggestion)})'>Save</button>
            </div>
        </div>`;
    _createModalOverlay(html);
    requestAnimationFrame(() => {
        const input = document.getElementById('suggested-flight-number-input');
        if (input) input.focus();
    });
}

function getTerminalWarningContext(warningKey) {
    const parsed = parseSegmentWarningKey(warningKey);
    if (!parsed || !['departure-terminal', 'arrival-terminal'].includes(parsed.kind)) return null;
    const segment = editedData?.segments?.[parsed.segIdx];
    if (!segment) return null;
    return {
        segIdx: parsed.segIdx,
        activeField: parsed.kind === 'departure-terminal' ? 'departure' : 'arrival',
        departure: {
            airportCode: safe(segment?.departure?.airport, '---').toString().trim().toUpperCase() || '---',
            terminalValue: safe(segment?.departure?.terminal, '').toString().trim()
        },
        arrival: {
            airportCode: safe(segment?.arrival?.airport, '---').toString().trim().toUpperCase() || '---',
            terminalValue: safe(segment?.arrival?.terminal, '').toString().trim()
        }
    };
}

let selectedTerminalSwapField = '';

function renderTerminalWarningModal(warningKey) {
    const context = getTerminalWarningContext(warningKey);
    if (!context) return '';
    const renderRow = (field, label, data) => {
        const hasTerminal = !!data.terminalValue;
        const isDropTarget = selectedTerminalSwapField && selectedTerminalSwapField !== field;
        return `
            <div ondragover="handleTerminalDragOver(event)" ondrop='handleTerminalDrop(event, "${field}", ${JSON.stringify(String(warningKey || ""))})' style="display:grid; grid-template-columns:86px 1fr auto; gap:0.7rem; align-items:center; padding:0.75rem 0.85rem; border:1px solid ${isDropTarget ? 'rgba(37,99,235,0.35)' : context.activeField === field ? 'rgba(245,158,11,0.35)' : 'var(--border)'}; border-radius:12px; background:${isDropTarget ? 'rgba(37,99,235,0.06)' : context.activeField === field ? 'rgba(245,158,11,0.08)' : 'var(--bg-main)'}; margin-bottom:0.75rem;">
                <div style="display:flex; flex-direction:column; gap:0.28rem;">
                    <div style="font-size:0.68rem; color:var(--text-secondary); font-weight:700; text-transform:uppercase;">${label}</div>
                    <div style="font-size:1rem; color:var(--text-primary); font-weight:800; letter-spacing:0.04em;">${escapeHtmlAttribute(data.airportCode)}</div>
                </div>
                <div style="min-width:0; display:flex; flex-direction:column; gap:0.32rem;">
                    <div style="font-size:0.68rem; color:var(--text-secondary); font-weight:700; text-transform:uppercase;">Terminal</div>
                    <div draggable="${hasTerminal ? 'true' : 'false'}" ondragstart='handleTerminalDragStart(event, "${field}", ${JSON.stringify(String(warningKey || ""))})' ondragend="handleTerminalDragEnd()" style="font-size:0.92rem; color:${hasTerminal ? 'var(--text-primary)' : 'var(--text-secondary)'}; font-weight:${hasTerminal ? '700' : '500'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; border:1px dashed ${hasTerminal ? 'rgba(37,99,235,0.28)' : 'var(--border)'}; border-radius:10px; padding:0.45rem 0.6rem; background:${hasTerminal ? 'rgba(37,99,235,0.05)' : 'transparent'}; cursor:${hasTerminal ? 'grab' : 'default'};">
                        ${escapeHtmlAttribute(hasTerminal ? formatTerminalDisplay(data.terminalValue) : 'No terminal')}
                    </div>
                    ${selectedTerminalSwapField === field ? `<div style="font-size:0.72rem; color:var(--primary); font-weight:700;">Dragging...</div>` : ''}
                    ${isDropTarget ? `<div style="font-size:0.72rem; color:var(--primary); font-weight:700;">Drop here to swap</div>` : ''}
                </div>
                <div style="display:flex; align-items:center; gap:0.3rem; flex-wrap:wrap; justify-content:flex-end;">
                    <button class="btn-action secondary" title="${hasTerminal ? 'Edit terminal' : 'Add terminal'}" style="padding:0.28rem 0.42rem; min-height:auto; font-size:0.82rem;" onclick='editTerminalValue(${JSON.stringify(String(warningKey || ""))}, "${field}")'>${hasTerminal ? '✎' : '+'}</button>
                    ${hasTerminal ? `<button class="btn-action secondary" title="Delete terminal" style="padding:0.28rem 0.42rem; min-height:auto; font-size:0.82rem;" onclick='deleteTerminalValue(${JSON.stringify(String(warningKey || ""))}, "${field}")'>🗑</button>` : ''}
                </div>
            </div>`;
    };
    return `
        <div style="max-width:560px;">
            <div style="font-weight:800; font-size:1rem; color:var(--text-primary); margin-bottom:0.9rem;">Terminal Check</div>
            ${renderRow('departure', 'From', context.departure)}
            ${renderRow('arrival', 'To', context.arrival)}
            <div style="display:flex; justify-content:flex-end; margin-top:0.2rem;">
                <button class="btn-action secondary" onclick="_closeModal()">Close</button>
            </div>
        </div>`;
}

function openTerminalWarningModal(warningKey) {
    const context = getTerminalWarningContext(warningKey);
    if (!context) return false;
    selectedTerminalSwapField = '';
    const html = renderTerminalWarningModal(warningKey);
    _createModalOverlay(html);
    return true;
}

function rerenderTerminalWarningModal(warningKey) {
    const modal = document.getElementById('cancel-change-modal');
    const container = modal?.querySelector('div[onclick="event.stopPropagation()"]');
    if (!container) return;
    container.innerHTML = renderTerminalWarningModal(warningKey);
}

function handleTerminalDragStart(event, field, warningKey) {
    selectedTerminalSwapField = field;
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', field);
    }
    rerenderTerminalWarningModal(warningKey);
}

function handleTerminalDragOver(event) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

function handleTerminalDragEnd() {
    selectedTerminalSwapField = '';
}

function handleTerminalDrop(event, targetField, warningKey) {
    event.preventDefault();
    const sourceField = event.dataTransfer?.getData('text/plain') || selectedTerminalSwapField;
    if (!sourceField) return;
    selectedTerminalSwapField = sourceField;
    swapPickedTerminal(targetField, warningKey);
}

function swapPickedTerminal(targetField, warningKey) {
    const context = getTerminalWarningContext(warningKey);
    if (!context || !selectedTerminalSwapField || selectedTerminalSwapField === targetField) return;
    if (!editedData?.segments?.[context.segIdx]) return;
    const segment = editedData.segments[context.segIdx];
    if (!segment.departure) segment.departure = {};
    if (!segment.arrival) segment.arrival = {};
    const sourceField = selectedTerminalSwapField;
    const sourceValue = safe(segment[sourceField]?.terminal, '').toString();
    const targetValue = safe(segment[targetField]?.terminal, '').toString();
    segment[sourceField].terminal = targetValue;
    segment[targetField].terminal = sourceValue;
    selectedTerminalSwapField = '';
    clearDismissedWarning(getSegmentWarningKey(context.segIdx, 'departure-terminal', segment));
    clearDismissedWarning(getSegmentWarningKey(context.segIdx, 'arrival-terminal', segment));
    _closeModal();
    renderDetailView();
    triggerAutoSave();
}

function deleteTerminalValue(warningKey, fieldOverride = '') {
    const context = getTerminalWarningContext(warningKey);
    const field = fieldOverride || context?.activeField;
    if (!context || !field || !editedData?.segments?.[context.segIdx]?.[field]) return;
    editedData.segments[context.segIdx][field].terminal = '';
    clearDismissedWarning(warningKey);
    _closeModal();
    renderDetailView();
    triggerAutoSave();
}

function saveTerminalValue(warningKey, fieldOverride = '') {
    const context = getTerminalWarningContext(warningKey);
    const input = document.getElementById('terminal-warning-input');
    const nextValue = safe(input?.value, '').toString().trim();
    const field = fieldOverride || context?.activeField;
    if (!context || !field || !editedData?.segments?.[context.segIdx]) return;
    if (!editedData.segments[context.segIdx][field]) editedData.segments[context.segIdx][field] = {};
    editedData.segments[context.segIdx][field].terminal = nextValue;
    clearDismissedWarning(warningKey);
    _closeModal();
    renderDetailView();
    triggerAutoSave();
}

function editTerminalValue(warningKey, fieldOverride = '') {
    const context = getTerminalWarningContext(warningKey);
    const field = fieldOverride || context?.activeField;
    const point = context?.[field];
    if (!context || !field || !point) return;
    const html = `
        <div style="max-width:340px;">
            <div style="font-weight:800; font-size:1rem; color:var(--text-primary); margin-bottom:0.85rem;">${point.terminalValue ? 'Edit Terminal' : 'Add Terminal'}</div>
            <div style="color:var(--text-primary); font-size:0.95rem; font-weight:700; margin-bottom:0.75rem;">${escapeHtmlAttribute(point.airportCode)}</div>
            <input id="terminal-warning-input" type="text" value="${escapeHtmlAttribute(point.terminalValue)}" placeholder="Enter terminal" style="width:100%; padding:0.7rem 0.85rem; border:1px solid var(--border); border-radius:10px; background:var(--bg-main); color:var(--text-primary); font:inherit; margin-bottom:1rem; box-sizing:border-box;">
            <div style="display:flex; gap:0.75rem; justify-content:flex-end;">
                <button class="btn-action secondary" onclick='openTerminalWarningModal(${JSON.stringify(String(warningKey || ""))})'>Back</button>
                <button class="btn-action primary" onclick='saveTerminalValue(${JSON.stringify(String(warningKey || ""))}, "${field}")'>Save</button>
            </div>
        </div>`;
    _closeModal();
    _createModalOverlay(html);
    requestAnimationFrame(() => {
        const input = document.getElementById('terminal-warning-input');
        if (input) input.focus();
    });
}

function openWarningReviewModal(warningKey, warningMessage) {
    if (openTerminalWarningModal(warningKey)) return;
    const payload = parseWarningPayload(warningMessage);
    const suggestion = payload.suggestion;
    const html = `
        <div style="max-width:360px;">
            <div style="display:flex; align-items:center; gap:0.65rem; margin-bottom:0.9rem;">
                <span class="field-warning-badge" style="cursor:default;">&#9888;</span>
                <div style="font-weight:800; font-size:1rem; color:var(--text-primary);">Warning Check</div>
            </div>
            <div style="color:var(--text-secondary); font-size:0.92rem; line-height:1.5; margin-bottom:1rem;">
                ${renderWarningTextBlock(payload.text)}
            </div>
            ${payload.suggestionText ? `
            <div style="color:var(--text-primary); font-size:0.92rem; font-weight:600; line-height:1.5; margin-bottom:0.75rem;">
                ${renderWarningTextBlock(payload.suggestionText)}
            </div>` : ''}
            ${suggestion?.label ? `
            <div style="display:flex; justify-content:flex-start; margin-bottom:1rem;">
                <button class="btn-action secondary" style="padding:0.35rem 0.65rem; min-height:auto;" onclick='applyWarningSuggestion(${JSON.stringify(String(warningKey || ""))}, ${JSON.stringify(suggestion)})'>${escapeHtmlAttribute(suggestion.label)}</button>
            </div>` : ''}
            <div style="display:flex; gap:0.75rem; justify-content:flex-end;">
                <button class="btn-action secondary" onclick="_closeModal()">Keep Warning</button>
                <button class="btn-action primary" onclick='confirmWarningOkay(${JSON.stringify(String(warningKey || ""))})'>Dismiss</button>
            </div>
        </div>`;
    _createModalOverlay(html);
}

function confirmWarningOkay(warningKey) {
    String(warningKey || '').split('||').filter(Boolean).forEach(dismissWarning);
    _closeModal();
    renderDetailView();
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
    await populateAggregatorSelect(selectId, 'No ledger entry');
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
    setDashboardUpdatingState(true);
    updateTicketUrl(getTicketIdFromUrl(), { replace: true });
    const initialTicketId = getTicketIdFromUrl();
    if (initialTicketId) {
        const listView = document.getElementById('listView');
        const detailView = document.getElementById('detailView');
        if (listView) listView.style.display = 'none';
        if (detailView) detailView.style.display = 'block';
        const header = document.getElementById('ticketDetailHeader');
        if (header) header.innerHTML = `<div><h1>Loading ticket...</h1></div>`;
    }
    const initialTicketCards = document.getElementById('ticketCards');
    if (initialTicketCards && !initialTicketCards.querySelector('[data-ticket-id]')) {
        initialTicketCards.innerHTML = '';
    }
    initializeSidebar();
    hydrateUserFromCache();
    hydrateUnreadTicketsFromCache();
    hydrateUnreadSeenStateFromCache();
    hydrateNotificationsFromCache();
    hydrateAggregatorsFromCache();
    hydrateWebCheckinState();

    // Step 1: Render cached tickets INSTANTLY — never block on network
    const hasCachedTickets = hydrateTicketsFromCache();
    if (!initialTicketId) renderTicketCards();
    updateTicketSelectionToolbar();
    void checkAuth();

    // Step 2: Decide what network work is needed
    const cacheIsFresh = hasFreshTicketsCache();
    const cacheHasFullTicketList = cachedTicketsAreComplete();

    if (initialTicketId) {
        // Opening a specific ticket URL — fetch both in parallel, then open detail
        await Promise.all([
            loadNotifications({ force: true }),
            loadTickets({ limit: INITIAL_TICKETS_BATCH_SIZE, showLoading: !hasCachedTickets, render: false })
        ]);
        renderTicketCards();
        await openTicket(initialTicketId, { syncUrl: false, replaceUrl: true });
        setDashboardUpdatingState(false);
    } else if (!cacheIsFresh || !hasCachedTickets) {
        // Stale/empty cache — fetch first page quietly in background while cards show from cache
        void loadNotifications({ force: true });
        void loadTickets({
            limit: INITIAL_TICKETS_BATCH_SIZE,
            showLoading: !hasCachedTickets,
            render: true
        }).then(() => {
            if (totalAvailableTickets === 0) {
                void syncAllTicketsInBackground({ showLoader: !hasCachedTickets });
            } else {
                setDashboardUpdatingState(false);
                if (allTickets.length < totalAvailableTickets || !cacheHasFullTicketList) {
                    scheduleDeferredFullSync(hasCachedTickets ? 1200 : 800);
                }
            }
        });
    } else {
        // Fresh cache — don't touch tickets at all, just lazy-sync in background
        void loadNotifications({ force: true });
        setDashboardUpdatingState(false);
        if ((Date.now() - lastFullTicketsSyncAt) > 30000 || !cacheHasFullTicketList) {
            scheduleDeferredFullSync(!cacheHasFullTicketList ? 800 : 3000);
        }
    }

    restartTicketsRealtime();
    if (!('EventSource' in window)) {
        scheduleDeferredFullSync(1500);
    }

    const detailView = document.getElementById('detailView');
    if (detailView) {
        detailView.addEventListener('input', (e) => {
            if (e.target.classList && e.target.classList.contains('tl-code')) {
                e.target.value = e.target.value.toUpperCase();
            }
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

window.addEventListener('popstate', async () => {
    const ticketId = getTicketIdFromUrl();
    if (ticketId) {
        if (!currentTicket || currentTicket.id !== ticketId) {
            await openTicket(ticketId, { syncUrl: false, replaceUrl: true });
        }
        return;
    }
    if (document.getElementById('detailView')?.style.display !== 'none') {
        await showListView({ syncUrl: false, replaceUrl: true });
    }
});

window.addEventListener('beforeunload', () => {
    persistUnreadSeenState();
    pauseDashboardLiveUpdates();
});

window.addEventListener('pagehide', () => {
    persistUnreadSeenState();
    pauseDashboardLiveUpdates();
});

window.addEventListener('pageshow', (event) => {
    const shouldHydrateFromCache = event?.persisted || allTickets.length === 0;
    if (shouldHydrateFromCache) {
        hydrateUserFromCache();
        hydrateUnreadTicketsFromCache();
        hydrateUnreadSeenStateFromCache();
        hydrateNotificationsFromCache();
        hydrateAggregatorsFromCache();
        hydrateWebCheckinState();
        hydrateTicketsFromCache();
        updateTicketSelectionToolbar();
    }
    dashboardLiveUpdatesPaused = false;
    restartTicketsRealtime();
});

window.addEventListener('storage', (event) => {
    if (!event || !event.key) return;
    if (event.key === TICKETS_REALTIME_CHANNEL_NAME && event.newValue) {
        ticketsRealtimeHandleBroadcast(event.newValue);
        return;
    }
    if (event.key === TICKETS_REALTIME_LEADER_KEY) {
        ticketsRealtimeCoordinatorTick();
        return;
    }
    if (event.key === TICKETS_CACHE_KEY) {
        if ((!currentTicket || !isDetailDirty) && readCachedJson(TICKETS_CACHE_KEY)?.tickets?.length) {
            hydrateTicketsFromCache();
            updateTicketSelectionToolbar();
            renderWebCheckinPanel();
        }
        return;
    }
    if (event.key === TICKETS_NOTIFICATIONS_CACHE_KEY) {
        hydrateNotificationsFromCache();
        return;
    }
    if (event.key === WEB_CHECKIN_DONE_CACHE_KEY) {
        hydrateWebCheckinState();
        renderWebCheckinPanel();
        return;
    }
    if (event.key === UNREAD_TICKETS_CACHE_KEY || event.key === TICKETS_LAST_SEEN_AT_KEY || event.key === TICKETS_READ_OVERRIDES_KEY) {
        hydrateUnreadTicketsFromCache();
        hydrateUnreadSeenStateFromCache();
        if (!currentTicket || !isDetailDirty) {
            renderTicketCards();
        }
    }
});

window.addEventListener('online', () => {
    if (currentTicket && isDetailDirty) {
        scheduleDraftRetry(400);
    }
    restartTicketsRealtime();
});

window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && webCheckinPanelOpen) {
        closeWebCheckinPanel();
    }
});

function renderActionsSection() {
    const tStatus = editedData.ticket_status || 'live';
    const isCancelled = tStatus === 'cancelled';
    const isMergedView = !!editedData.is_merged_view;

    document.getElementById('actionsSection').innerHTML = `
        <div class="section-header-row">${renderTitleWithIcon('Actions', 'actions')}</div>
        <div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:center;">
            <div class="pdf-btn-group">
                <button class="pdf-btn with-fare" data-pdf-download="with-fare" onclick="downloadPDF(true)">${renderActionLabel('PDF (With Fare)', 'pdf')}</button>
                <button class="pdf-btn without-fare" data-pdf-download="without-fare" onclick="downloadPDF(false)">${renderActionLabel('PDF (Without Fare)', 'pdf')}</button>
            </div>
            ${!editedData.ledger_hash ? `
            <div id="ledgerBtnGroup" style="display:flex; align-items:center; gap:0.5rem; background:var(--bg-main); padding:0.5rem 1rem; border-radius:12px; border:1px solid var(--border);">
                <span style="font-size:0.75rem; color:var(--text-secondary); font-weight:700; text-transform:uppercase;">Add to Ledger:</span>
                <select id="ledgerAggSelect" style="padding:0.35rem 0.5rem; border-radius:8px; border:1px solid var(--border); font-family:inherit; font-size:0.82rem; background:var(--bg-card); color:var(--text-primary);">
                    <option value="">Loading...</option>
                </select>
                <button class="pdf-btn" style="background: #10b981; color:white; padding: 0.45rem 0.5rem; min-width:38px; justify-content:center;" onclick="addToLedger('AB')">AB</button>
                <button class="pdf-btn" style="background: #6366f1; color:white; padding: 0.45rem 0.5rem; min-width:38px; justify-content:center;" onclick="addToLedger('CK')">CK</button>
            </div>` : `
            <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(16,185,129,0.08); padding:0.6rem 1.2rem; border-radius:12px; border:1px solid rgba(16,185,129,0.2);">
                <span class="action-label success-text">${getInlineSvgIcon('success', 'btn-inline-icon')}<span>In Ledger</span></span>
            </div>`}
            ${!isCancelled ? `
            <div class="action-danger-group" style="display:flex; align-items:center; gap:0.5rem; background:rgba(239,68,68,0.05); padding:0.5rem 1rem; border-radius:12px; border:1px solid rgba(239,68,68,0.2);">
                <button class="pdf-btn" style="background:linear-gradient(135deg,#dc2626,#ef4444); color:white; padding:0.5rem 1rem;" onclick="openCancelModal()">${renderActionLabel('Cancel / Split', 'cancel')}</button>
                <button class="pdf-btn" style="background:linear-gradient(135deg,#d97706,#f59e0b); color:white; padding:0.5rem 1rem;" onclick="openChangeModal()">${renderActionLabel('Change', 'change')}</button>
            </div>` : `
            <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(239,68,68,0.08); padding:0.6rem 1.2rem; border-radius:12px; border:1px dashed rgba(239,68,68,0.3);">
                <span class="action-label danger-text">${getInlineSvgIcon('statusCancelled', 'btn-inline-icon')}<span>This ticket is cancelled</span></span>
            </div>`}
            ${isMergedView ? `
            <div style="display:flex; align-items:center; gap:0.5rem; background:rgba(5,150,105,0.08); padding:0.6rem 1.2rem; border-radius:12px; border:1px solid rgba(5,150,105,0.2);">
                <span style="font-weight:700; color:#059669;">Merged booking view. These actions apply to the grouped booking shown here.</span>
            </div>` : ''}
        </div>`;
    loadLedgerAggregators();
}
