// ==================== ITINERARIES PAGE JS ====================
let allItineraries = [];
let currentItinerary = null;
let currentFilter = 'all';
let holdInterval = null;
let countdownInterval = null;
let dbPassengers = [];
let dbBillingAccounts = [];
let dbSupplierAccounts = [];
let unifiedSupplierResults = [];
let dbCorporates = [];
let airlines = [];
let currentPassenger = null;
let unifiedBillingResults = [];

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

  const valBtn = document.getElementById('sidebarValentineToggle');
  if (valBtn) {
    valBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'valentine' ? 'light' : 'valentine';
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
    if (!r.ok) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = '/login?next=' + next;
      return;
    }
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
      authBtn.onclick = async () => {
        if (confirm('Are you sure you want to logout?')) {
          await fetch('/api/logout', { method: 'POST' });
          window.location.href = '/login';
        }
      };
    }
  } catch (e) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = '/login?next=' + next;
  }
}

function handleAuthClick() {
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = '/login?next=' + next;
}

// ==================== HELPERS ====================
function formatCurrency(n) { if (!n && n !== 0) return '₹0'; return '₹' + Number(n).toLocaleString('en-IN'); }
function formatDate(d) { if (!d) return '-'; return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
function formatDateTime(d) {
  if (!d) return '-';
  let ds = d;
  if (typeof d === 'string' && !d.endsWith('Z') && !d.includes('+')) ds += 'Z';
  const date = new Date(ds);
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}
function showToast(msg, type = 'info') {
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3500);
}
function getTripTypeLabel(t) {
  switch (t) { case 'round_trip': return 'Round Trip'; case 'multi_city': return 'Multi-City'; default: return 'One Way'; }
}

function getItineraryPassengerNames(it = currentItinerary) {
  let passengers = [];
  if (!it) return passengers;

  if (Array.isArray(it.passengers_data)) {
    passengers = it.passengers_data;
  } else if (typeof it.passengers_data === 'string') {
    try {
      const parsed = JSON.parse(it.passengers_data);
      if (Array.isArray(parsed)) passengers = parsed;
    } catch (_) {
      passengers = [];
    }
  } else if (Array.isArray(it.passengers)) {
    passengers = it.passengers;
  }

  return passengers
    .map(p => (p && (p.name || p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim())) || '')
    .map(name => name.trim())
    .filter(Boolean);
}

function getItineraryPassengerLabel(it = currentItinerary) {
  const names = getItineraryPassengerNames(it);
  if (!names.length) return '';
  const preview = names.slice(0, 3).join(' • ');
  const suffix = names.length > 3 ? ` +${names.length - 3}` : '';
  return { names, preview, suffix, count: names.length };
}

function getActionIcon(name) {
  const icons = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 1 0-7l1.5-1.5a5 5 0 0 1 7.1 7.1L17.5 13"></path><path d="M14 11a5 5 0 0 1 0 7L12.5 19.5a5 5 0 0 1-7.1-7.1L6.5 11"></path></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m3 15 5-5 4 4 3-3 6 6"></path><circle cx="9" cy="10" r="1.2"></circle></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>',
    approve: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>',
    delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path><path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>',
    hold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8"></path><path d="M8 20h8"></path><path d="M8 4v4a4 4 0 0 0 1.2 2.8L12 13l2.8-2.2A4 4 0 0 0 16 8V4"></path><path d="M16 20v-4a4 4 0 0 0-1.2-2.8L12 11l-2.8 2.2A4 4 0 0 0 8 16v4"></path></svg>',
    issue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a2 2 0 0 0 2-2 2 2 0 0 0-2-2"></path><path d="M3 19a2 2 0 0 0 2-2 2 2 0 0 0-2-2"></path><path d="M21 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1 0-4h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H5a2 2 0 0 1 0-4h14a2 2 0 0 1 2 2Z"></path></svg>',
    revert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"></path><path d="M4 9h11a5 5 0 0 1 0 10H10"></path></svg>',
    ticket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7a2 2 0 0 0 2-2h12a2 2 0 0 0 2 2v2a2 2 0 0 1 0 4v2a2 2 0 0 0-2 2H6a2 2 0 0 0-2-2v-2a2 2 0 0 1 0-4V7Z"></path><path d="M9 8h6"></path><path d="M9 16h6"></path></svg>'
  };
  return `<span class="action-icon" aria-hidden="true">${icons[name] || ''}</span>`;
}

async function copyTextToClipboard(text) {
  const value = String(text || '');
  if (!value) return false;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (err) {
      console.warn('Async clipboard copy failed, using fallback', err);
    }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (err) {
    console.error('Fallback clipboard copy failed', err);
    return false;
  }
}

function getStatusIcon(s) {
  switch (s) {
    case 'draft': return '📝';
    case 'approved': return '✅';
    case 'on_hold': return '⏸️';
    case 'confirmed': case 'issued': return '🎫';
    case 'reverted': return '🔄';
    default: return '';
  }
}

// Helper to safely display values
const safe = (val, fallback = '') => {
  if (val === undefined || val === null || val === 'N/A' || val === 'Not Specified' || val === 'undefined' || val === 'null') {
    return fallback;
  }
  return val;
};

// ==================== LOAD DATA ====================
let notifiedHoldIds = new Set();

async function loadItineraries() {
  try {
    const r = await fetch('/api/v2/itineraries'); if (!r.ok) return;
    const d = await r.json(); allItineraries = d.itineraries || [];
    renderItineraryCards();

    // Start hold checker if not running
    if (!holdInterval) {
      checkHoldNotifications(); // Run immediately
      holdInterval = setInterval(checkHoldNotifications, 60000); // Check every minute
    }

    if (!countdownInterval) {
      updateHoldTimers();
      countdownInterval = setInterval(updateHoldTimers, 1000);
    }

    if (window.location.hash) {
      const id = window.location.hash.substring(1);
      const it = allItineraries.find(i => i.id === id);
      if (it) openItinerary(id, true); // Don't scroll on background refresh
    }
  } catch (e) { console.error('Load error:', e); }
}

function checkHoldNotifications() {
  const now = new Date();
  allItineraries.forEach(it => {
    if (it.status === 'on_hold' && it.hold_deadline) {
      let ds = it.hold_deadline;
      if (!ds.endsWith('Z') && !ds.includes('+')) ds += 'Z';
      const deadline = new Date(ds);
      const diffMs = deadline - now;
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMs > 0 && diffMins <= 30 && !notifiedHoldIds.has(it.id)) {
        showToast(`⚠️ Hold for "${it.title || it.reference_number || 'Itinerary'}" expires in ${diffMins} mins!`, 'warning');
        notifiedHoldIds.add(it.id);
        // Consider a real notification API or modal if needed, but toast is "POPUP NOTIFICATION" enough for web context usually
      }
    }
  });
}

async function loadDBPassengers() {
  try {
    const r = await fetch('/api/v2/passengers'); if (!r.ok) return;
    const d = await r.json(); dbPassengers = d.passengers || [];
  } catch (e) { console.error('Load passengers error:', e); }
}


async function loadDBSuppliers() {
  try {
    const r = await fetch('/api/v2/supplier-accounts');
    if (r.ok) { const d = await r.json(); dbSupplierAccounts = d.supplier_accounts || []; }
  } catch (e) { }
}

async function loadDBBillingAccounts() {
  try {
    const r = await fetch('/api/v2/billing-accounts'); if (!r.ok) return;
    const d = await r.json(); dbBillingAccounts = d.billing_accounts || [];
  } catch (e) { console.error('Load billing accounts error:', e); }
}

async function loadDBCorporates() {
  try {
    const r = await fetch('/api/v2/corporates'); if (!r.ok) return;
    const d = await r.json(); dbCorporates = d.corporates || [];
  } catch (e) { console.error('Load corporates error:', e); }
}

// ==================== FILTER & CARDS ====================
function filterByStatus(status, btn) {
  currentFilter = status;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderItineraryCards();
}

function getFlightUnitId(flight) {
  if (!flight || typeof flight !== 'object') return '1';
  return String(flight.unit_id || flight.unitId || '1');
}

function getRawUnitFlights(rawInputData) {
  if (!rawInputData || typeof rawInputData !== 'object') return null;
  const unitFlights = rawInputData.unit_flights;
  return unitFlights && typeof unitFlights === 'object' ? unitFlights : null;
}

function buildMultiCityOptionsFromRawMap(flights, rawInputData) {
  const unitFlights = getRawUnitFlights(rawInputData);
  if (!unitFlights || !Array.isArray(flights) || flights.length === 0) return [];

  const options = [];
  Object.keys(unitFlights).forEach((unitId, idx) => {
    const indices = Array.isArray(unitFlights[unitId]) ? unitFlights[unitId] : [];
    const optionFlights = indices.map(i => flights[i]).filter(Boolean);
    if (optionFlights.length > 0) {
      options.push({ flights: optionFlights, label: 'Option ' + (idx + 1), index: idx });
    }
  });
  return options;
}

function getCardRoute(flights, tripType, rawInputData) {
  if (!flights || flights.length === 0) return null;

  // For multi-city, we want the sequence of all unique segments in the first option
  if (tripType === 'multi_city') {
    const rawOptions = buildMultiCityOptionsFromRawMap(flights, rawInputData);
    const firstOptionFlights = rawOptions.length > 0
      ? rawOptions[0].flights
      : flights.filter(f => getFlightUnitId(f) === getFlightUnitId(flights[0]));

    if (firstOptionFlights.length === 0) return null;

    const routeParts = [];
    firstOptionFlights.forEach((f, idx) => {
      const from = f.departure_code || f.departure_airport || f.from || '';
      const to = f.arrival_code || f.arrival_airport || f.to || '';

      if (idx === 0) {
        if (from) routeParts.push(from.toUpperCase());
      }
      if (to) routeParts.push(to.toUpperCase());
    });

    if (routeParts.length < 2) return null;
    return routeParts.join(' → ');
  }

  // For round trip and one way, we just need origin and destination
  const first = flights[0];
  const last = tripType === 'round_trip' ? flights[0] : flights[flights.length - 1];

  // Wait, if it's round trip, flights[0] is outbound. flights[1] is return.
  // We want the origin and destination of the outbound.
  const from = (first.departure_code || first.departure_airport || first.from || '').toUpperCase();
  const to = (first.arrival_code || first.arrival_airport || first.to || '').toUpperCase();

  if (!from && !to) return null;

  const arrow = tripType === 'round_trip' ? ' ↔ ' : ' → ';
  return from + arrow + to;
}

function renderItineraryCards() {
  const container = document.getElementById('itineraryCards');
  let items = allItineraries;

  // Search filter
  const searchInput = document.getElementById('itinerarySearch');
  const hasSearch = searchInput && searchInput.value.trim().length > 0;

  if (hasSearch) {
    const q = searchInput.value.toLowerCase().trim();
    items = items.filter(i => {
      const title = (i.title || '').toLowerCase();
      const ref = (i.reference_number || '').toLowerCase();
      const psgName = i.passenger ? (i.passenger.name || '').toLowerCase() : '';
      const psgEmail = i.passenger ? (i.passenger.email || '').toLowerCase() : '';
      const billName = (i.bill_to_name || '').toLowerCase();
      const billAcct = i.billing_account ? (i.billing_account.display_name || '').toLowerCase() : '';

      const hasMatchingPassenger = (i.passengers_data || []).some(p => {
        const pName = (p.name || p.full_name || ((p.first_name || '') + ' ' + (p.last_name || ''))).toLowerCase();
        const pEmail = (p.email || '').toLowerCase();
        return pName.includes(q) || pEmail.includes(q);
      });

      return title.includes(q) || ref.includes(q) || psgName.includes(q) || psgEmail.includes(q) || billName.includes(q) || billAcct.includes(q) || hasMatchingPassenger;
    });
  }

  // Status filter
  if (currentFilter !== 'all') {
    if (currentFilter === 'issued' || currentFilter === 'confirmed') {
      items = items.filter(i => i.status === 'confirmed' || i.status === 'issued');
    } else {
      items = items.filter(i => i.status === currentFilter);
    }
  }

  if (items.length === 0) {
    if (hasSearch) {
      container.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><p>No itineraries found matching your search.</p></div>';
    } else {
      container.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="icon">📋</div><p>No itineraries found</p><a href="/" class="btn-action primary" style="margin-top:1rem;text-decoration:none;">✈️ Create New Itinerary</a></div>`;
    }
    return;
  }

  container.innerHTML = items.map(it => {
    const flights = it.flights || [];
    const routeText = getCardRoute(flights, it.trip_type, it.raw_input_data);

    // Count options based on trip type
    let numOpts = 0;
    if (it.trip_type === 'round_trip') {
      numOpts = Math.ceil(flights.length / 2);
    } else if (it.trip_type === 'multi_city') {
      numOpts = getFlightOptionCount(flights, it.trip_type, it.raw_input_data);
    } else {
      numOpts = flights.length;
    }

    // Detect layovers
    const hasLayover = flights.some(f => f.has_layover === true || (f.segments && f.segments.length > 1));

    // Billing info
    let billingInfo = '';
    if (it.billing_account) {
      billingInfo = `<span class="meta-item"><b>Bill To:</b> ${it.billing_account.display_name}</span>`;
    } else if (it.bill_to_name) {
      billingInfo = `<span class="meta-item"><b>Bill To:</b> ${it.bill_to_name}${it.bill_to_company ? ' (' + it.bill_to_company + ')' : ''}</span>`;
    }

    return `<div class="itin-card" onclick="openItinerary('${it.id}')">
      <div class="itin-card-top ${it.status}"></div>
      <div class="itin-card-body">
        <div class="itin-card-header">
          <h3>${it.title || it.reference_number || 'Untitled Itinerary'}</h3>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.3rem;">
            <span class="status-badge ${it.status}">${(it.status === 'confirmed' || it.status === 'issued') ? 'Issued' : (it.status || '').replace('_', ' ')}</span>
            ${(it.status === 'on_hold' && it.hold_deadline) ? `<span class="hold-timer-badge" data-deadline="${it.hold_deadline}" style="font-size:0.75rem;color:var(--warning);font-weight:700;display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
              <div style="display:flex;align-items:center;gap:0.3rem;">⏱ <span class="timer-text">--:--:--</span></div>
              <div class="deadline-text" style="font-size:0.65rem;font-weight:500;opacity:0.9;"></div>
            </span>` : ''}
          </div>
        </div>
        <div class="itin-card-meta">
          ${routeText ? `<span class="meta-item"><b>Route:</b> ${routeText}${hasLayover ? ' (Layover)' : ''}</span>` : ''}
          <span class="meta-item"><b>Type:</b> ${getTripTypeLabel(it.trip_type)} ${numOpts > 1 ? '• ' + numOpts + ' option' + (numOpts > 1 ? 's' : '') : ''}</span>
          ${billingInfo}
          <span class="meta-item"><b>Passengers:</b> ${(it.passengers_data && it.passengers_data.length > 0) ? it.passengers_data.length : 'Not Added'}</span>
        </div>
        <div class="itin-card-footer">
          ${shouldShowFinancials(it) ? `<span class="itin-amount">${formatCurrency(getEffectiveTotal(it))}</span>` : ''}
          <span class="itin-date">${formatDate(it.created_at)}</span>
        </div>
      </div>
    </div>`;
  }).join('');
  updateHoldTimers();
}

// ==================== OPEN ITINERARY DETAIL ====================
async function openItinerary(id, preventScroll = false) {
  try {
    const r = await fetch('/api/v2/itineraries/' + id);
    if (!r.ok) { showToast('Failed to load itinerary', 'error'); return; }
    currentItinerary = await r.json();
    window.location.hash = id;
    renderDetailView();
    document.getElementById('listView').style.display = 'none';
    document.getElementById('detailView').style.display = 'block';
    if (!preventScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) { console.error(e); showToast('Error loading itinerary', 'error'); }
}

function showListView() {
  document.getElementById('detailView').style.display = 'none';
  document.getElementById('listView').style.display = 'block';
  window.location.hash = '';
  currentItinerary = null;
  loadItineraries();
}

// ==================== RENDER DETAIL VIEW ====================
function renderDetailView() {
  const it = currentItinerary; if (!it) return;

  document.getElementById('detailTitle').textContent = it.title || it.reference_number || 'Itinerary Details';
  document.getElementById('detailSubtitle').innerHTML = `
    ${it.reference_number ? 'Ref: ' + it.reference_number : ''} ${it.reference_number ? '&nbsp;•&nbsp;' : ''} ${getTripTypeLabel(it.trip_type)}
  `;

  renderActions();
  renderProgressBar();
  renderInfoCards();
  renderFlightSection();
  renderPassengers();
  renderBilling();
  renderSupplier();
  renderOutputBoxes();
  updateHoldTimers();
}

function getItineraryFinalOutputText(it = currentItinerary) {
  if (!it) return '';
  const savedText = [it.parser_output_text, it.final_text]
    .find(value => typeof value === 'string' && value.trim()) || '';
  const selectedFlightGroup = getSelectedFlightForOutput(it);
  const flightLegs = flattenFlightLegsForOutput(selectedFlightGroup, it);
  const passengerNames = getItineraryPassengerNames(it);
  const flightLines = savedText.trim() || (flightLegs.length > 0
    ? flightLegs.map(leg => formatReadableFinalLine(leg)).filter(Boolean).join('\n')
    : 'No selected flight option available');

  const passengerLines = passengerNames.length > 0
    ? '\n\nPassengers:\n' + passengerNames.map((name, index) => `${index + 1}. ${name}`).join('\n')
    : '';

  return [
    'Kindly check and confirm to issue',
    '',
    flightLines || 'No selected flight option available',
    passengerLines
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function formatAmadeusPassengerName(name) {
  const cleanName = (name || '').trim();
  if (!cleanName) return 'NM1UNKNOWN/UNKNOWN';

  const parts = cleanName.split(/\s+/).filter(Boolean);
  const firstName = parts.shift() || 'UNKNOWN';
  const surname = parts.length > 0 ? parts.pop() : 'UNKNOWN';
  const givenNames = [firstName, ...parts].filter(Boolean).join(' ');
  return `NM1${surname.toUpperCase()}/${givenNames.toUpperCase()}`;
}

function formatAmadeusDate(dateValue) {
  if (!dateValue) return 'DDMMM';
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return 'DDMMM';

  const day = String(parsed.getDate()).padStart(2, '0');
  const month = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][parsed.getMonth()];
  return `${day}${month}`;
}

function formatPassengerReadyFlightLine(leg) {
  const airlineCode = (leg.airline_code || leg.carrier_code || leg.airline || 'XX').toString().trim().replace(/\s+/g, '').slice(0, 3).toUpperCase();
  const flightNumber = (leg.flight_number || '').toString().trim();
  const dateCode = formatAmadeusDate(leg.departure_date);
  const from = (leg.departure_airport || 'DEP').toString().toUpperCase();
  const to = (leg.arrival_airport || 'ARR').toString().toUpperCase();
  const depTime = formatAmadeusTime(leg.departure_time);
  const arrTime = `${formatAmadeusTime(leg.arrival_time)}${Number(leg.days_offset) > 0 ? `+${Number(leg.days_offset)}` : ''}`;

  return `${airlineCode}${flightNumber} ${dateCode} ${from}${to} ${depTime} ${arrTime}`.trim();
}

function formatReadableFinalLine(leg) {
  const airline = (leg.airline || 'Airline').toString().trim();
  const flightNumber = (leg.flight_number || '').toString().trim();
  const dateValue = leg.departure_date ? formatDate(leg.departure_date) : '';
  const from = (leg.departure_airport || 'DEP').toString().toUpperCase();
  const to = (leg.arrival_airport || 'ARR').toString().toUpperCase();
  const depTime = (leg.departure_time || '').toString().trim();
  const arrTime = `${(leg.arrival_time || '').toString().trim()}${Number(leg.days_offset) > 0 ? `+${Number(leg.days_offset)}` : ''}`.trim();

  return [
    airline + (flightNumber ? ` ${flightNumber}` : ''),
    dateValue,
    `${from} to ${to}`,
    depTime && arrTime ? `${depTime} - ${arrTime}` : ''
  ].filter(Boolean).join(' • ');
}

function formatAmadeusTime(timeValue) {
  if (!timeValue) return '0000';
  const text = timeValue.toString().trim();
  const match = text.match(/(\d{1,2}):(\d{2})\s*([AP]M)?/i);
  if (match) {
    let hours = parseInt(match[1], 10);
    const minutes = match[2];
    const period = match[3] ? match[3].toUpperCase() : '';
    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    return `${String(hours).padStart(2, '0')}${minutes}`;
  }

  const digits = text.replace(/\D/g, '');
  if (digits.length >= 4) return digits.slice(-4);
  return digits.padStart(4, '0').slice(-4);
}

function flattenFlightLegsForOutput(selectedFlightGroup, itinerary = currentItinerary) {
  const groupFlights = selectedFlightGroup?.flights || itinerary?.flights || [];
  const legs = [];

  groupFlights.forEach(flight => {
    const segments = Array.isArray(flight.segments) && flight.segments.length > 0 ? flight.segments : [flight];
    segments.forEach(segment => {
      legs.push({
        airline: segment.airline || flight.airline || 'Airline',
        flight_number: segment.flight_number || flight.flight_number || '',
        departure_date: segment.departure_date || flight.departure_date || itinerary?.departure_date || '',
        departure_airport: segment.departure_airport || segment.departure_code || flight.departure_airport || flight.departure_code || 'DEP',
        arrival_airport: segment.arrival_airport || segment.arrival_code || flight.arrival_airport || flight.arrival_code || 'ARR',
        departure_time: segment.departure_time || flight.departure_time || '--:--',
        arrival_time: segment.arrival_time || flight.arrival_time || '--:--',
        days_offset: segment.days_offset || segment.accumulated_arr_days || flight.days_offset || flight.arrival_days_offset || 0,
        booking_class: segment.booking_class || flight.booking_class || flight.cabin_class || 'Y'
      });
    });
  });

  return legs;
}

function formatAmadeusFlightLine(leg) {
  const airlineCode = (leg.airline_code || leg.carrier_code || leg.airline || 'XX').toString().trim().replace(/\s+/g, '').slice(0, 3).toUpperCase();
  const flightNumber = (leg.flight_number || '').toString().trim();
  const dateCode = formatAmadeusDate(leg.departure_date);
  const route = `${(leg.departure_airport || 'DEP').toString().toUpperCase()}${(leg.arrival_airport || 'ARR').toString().toUpperCase()}`;
  const depTime = formatAmadeusTime(leg.departure_time);
  const arrTime = `${formatAmadeusTime(leg.arrival_time)}${Number(leg.days_offset) > 0 ? `+${Number(leg.days_offset)}` : ''}`;
  return `${airlineCode}${flightNumber} ${dateCode} ${route} ${depTime} ${arrTime}`.trim();
}

function getSelectedFlightForOutput(it = currentItinerary) {
  if (!it) return null;

  const flights = it.flights || [];
  if (flights.length === 0) return null;

  const options = groupFlightsIntoOptions(flights, it.trip_type, it.raw_input_data);
  const selectedIndex = Number.isInteger(it.selected_flight_option)
    ? it.selected_flight_option
    : (it.selected_flight_option !== null && it.selected_flight_option !== undefined ? Number(it.selected_flight_option) : null);

  const safeIndex = selectedIndex !== null && !Number.isNaN(selectedIndex) ? selectedIndex : 0;
  return options[safeIndex] || options[0] || null;
}

function getItinerarySupplierOutputText(it = currentItinerary) {
  if (!it) return '';

  const selectedFlightGroup = getSelectedFlightForOutput(it);
  const flightLegs = flattenFlightLegsForOutput(selectedFlightGroup, it);
  const passengerNames = getItineraryPassengerNames(it);

  const passengerLines = passengerNames.length > 0
    ? passengerNames.map(formatAmadeusPassengerName)
    : ['NM1UNKNOWN/UNKNOWN'];

  return [
    flightLegs.map(formatAmadeusFlightLine).filter(Boolean).join('\n'),
    '',
    passengerLines.join('\n')
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function renderOutputBoxes() {
  const finalBox = document.getElementById('finalOutputBox');
  const supplierBox = document.getElementById('supplierOutputBox');

  if (finalBox) {
    finalBox.value = getItineraryFinalOutputText();
  }

  if (supplierBox) {
    supplierBox.value = getItinerarySupplierOutputText();
  }
}

function copyOutputText(kind) {
  const box = kind === 'supplier' ? document.getElementById('supplierOutputBox') : document.getElementById('finalOutputBox');
  if (!box || !box.value.trim()) {
    showToast('No text available to copy', 'error');
    return;
  }

  copyTextToClipboard(box.value)
    .then(ok => showToast(ok ? 'Copied to clipboard!' : 'Copy failed', ok ? 'success' : 'error'))
    .catch(() => showToast('Copy failed', 'error'));
}

async function renameItineraryTitle() {
  const it = currentItinerary;
  if (!it) return;

  const currentTitle = it.title || '';
  const fallbackTitle = it.reference_number ? `Itinerary - ${it.reference_number}` : 'Itinerary Details';
  const nextTitle = prompt('Rename itinerary title', currentTitle || fallbackTitle);

  if (nextTitle === null) return;

  const trimmedTitle = nextTitle.trim();
  if (!trimmedTitle) {
    showToast('Title cannot be empty', 'error');
    return;
  }

  try {
    const r = await fetch('/api/v2/itineraries/' + it.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmedTitle })
    });

    if (r.ok) {
      const d = await r.json();
      currentItinerary = d.itinerary;
      renderDetailView();
      renderItineraryCards();
      showToast('Itinerary title updated', 'success');
    } else {
      const err = await r.json().catch(() => ({}));
      showToast(err.error || 'Failed to update title', 'error');
    }
  } catch (e) {
    showToast('Error updating title', 'error');
  }
}

function renderActions() {
  const it = currentItinerary; const el = document.getElementById('detailActions');
  let html = '';
  html += `<button class="btn-action small secondary" onclick="copyItinerary()">${getActionIcon('copy')}<span>Copy</span></button>`;

  if (navigator.share) {
    html += `<button class="btn-action small secondary" onclick="shareItinerary()">${getActionIcon('link')}<span>Link</span></button>`;
  }
  html += `<button class="btn-action small secondary" onclick="copyItineraryImage()" title="Copy the itinerary card as an image to your clipboard">${getActionIcon('image')}<span>Copy Card Image</span></button>`;

  if (it.status === 'draft') {
    html += `<button class="btn-action small primary" onclick="editInParser()">${getActionIcon('edit')}<span>Edit</span></button>`;
    const flights = it.flights || [];
    // Show approve only if a flight option is selected (or only 1 option exists)
  const numOpts = getFlightOptionCount(flights, it.trip_type, it.raw_input_data);
    if (numOpts === 1 || it.selected_flight_option !== null) {
      html += `<button class="btn-action small success" onclick="approveItinerary()">${getActionIcon('approve')}<span>Approve</span></button>`;
    }
    html += `<button class="btn-action small danger" onclick="deleteItinerary()">${getActionIcon('delete')}<span>Delete</span></button>`;
  } else if (it.status === 'approved') {
    html += `<button class="btn-action small primary" onclick="editInParser()">${getActionIcon('edit')}<span>Edit</span></button>`;
    html += `<button class="btn-action small warning" onclick="holdItinerary()">${getActionIcon('hold')}<span>Hold</span></button>`;
    html += `<button class="btn-action small success" onclick="confirmItinerary()">${getActionIcon('issue')}<span>Issue</span></button>`;
  } else if (it.status === 'on_hold') {
    html += `<button class="btn-action small success" onclick="confirmItinerary()">${getActionIcon('issue')}<span>Issue</span></button>`;
    html += `<button class="btn-action small secondary" onclick="revertItinerary()">${getActionIcon('revert')}<span>Revert</span></button>`;
  } else if (it.status === 'confirmed' || it.status === 'issued') {
    html += `<button class="btn-action small secondary" onclick="revertItinerary()">${getActionIcon('revert')}<span>Revert</span></button>`;
    html += `<button class="btn-action small primary" onclick="generateTicket()">${getActionIcon('ticket')}<span>Generate Ticket</span></button>`;
  }
  el.innerHTML = html;
}

function renderProgressBar() {
  const it = currentItinerary;
  const statusOrder = { 'draft': 0, 'approved': 1, 'on_hold': 2, 'confirmed': 2, 'issued': 2, 'reverted': 1 };
  const current = statusOrder[it.status] || 0;
  const lastLabel = (it.status === 'on_hold') ? 'On Hold' : 'Issued';
  const labels = [
    { name: 'Draft' },
    { name: 'Approved' },
    { name: lastLabel }
  ];
  let html = '<div class="progress-steps" aria-label="Itinerary status timeline"><span class="progress-caption">Status</span>';
  labels.forEach((s, i) => {
    const done = i < current;
    const active = i === current;
    html += `<span class="progress-step ${done ? 'done' : active ? 'active' : 'pending'}"><span class="step-label ${done ? 'done' : active ? 'active' : ''}">${s.name}</span></span>`;
  });
  html += '</div>';
  document.getElementById('progressBar').innerHTML = html;
}

function renderInfoCards() {
  const it = currentItinerary;
  let billedToHtml = '';
  if (it.billing_account) {
    billedToHtml = `<div class="info-mini-card"><div class="label">Billing Account</div><div class="value">${it.billing_account.display_name}</div></div>`;
  } else if (it.bill_to_name) {
    billedToHtml = `<div class="info-mini-card"><div class="label">Billed To</div><div class="value">${it.bill_to_name}</div></div>`;
  }

  document.getElementById('infoCards').innerHTML = `
    <div class="info-mini-card"><div class="label">Trip Type</div><div class="value">${getTripTypeLabel(it.trip_type)}</div></div>
    <div class="info-mini-card"><div class="label">Passengers</div><div class="value">${(it.passengers_data && it.passengers_data.length > 0) ? it.passengers_data.length : 'Not Added'}</div></div>
    ${shouldShowFinancials(it) ? `<div class="info-mini-card"><div class="label">Total Amount</div><div class="value" style="color:var(--primary)">${formatCurrency(getEffectiveTotal(it))}</div></div>` : ''}
    <div class="info-mini-card"><div class="label">Created</div><div class="value">${formatDate(it.created_at)}</div></div>
    ${it.reference_number ? '<div class="info-mini-card"><div class="label">Reference</div><div class="value">' + it.reference_number + '</div></div>' : ''}
    ${(it.status === 'on_hold' && it.hold_deadline) ? `<div class="info-mini-card">
      <div class="label">Time Limit</div>
      <div class="value hold-timer-badge" data-deadline="${it.hold_deadline}" style="color:var(--warning);font-weight:700;display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;align-items:center;gap:0.5rem;font-size:1.1rem;">⏱ <span class="timer-text">--:--:--</span></div>
        <div class="deadline-text" style="font-size:0.85rem;font-weight:500;opacity:0.9;"></div>
      </div>
    </div>` : ''}
    ${billedToHtml}
  `;
}

function updateHoldTimers() {
  const now = new Date();
  document.querySelectorAll('.hold-timer-badge').forEach(el => {
    let deadlineStr = el.dataset.deadline;
    if (!deadlineStr) return;
    if (!deadlineStr.endsWith('Z') && !deadlineStr.includes('+')) deadlineStr += 'Z'; // Treat as UTC if no offset
    const deadline = new Date(deadlineStr);
    const diff = deadline - now;

    // Find the text span inside, or use the element itself if text span missing
    const textEl = el.querySelector('.timer-text') || el;
    const deadlineEl = el.querySelector('.deadline-text');

    if (deadlineEl && !deadlineEl.textContent) {
      deadlineEl.textContent = 'Until ' + formatDateTime(deadlineStr);
    }

    if (diff <= 0) {
      textEl.textContent = 'Expired';
      el.style.color = 'var(--danger)';
      if (deadlineEl) deadlineEl.style.opacity = '0.7';
    } else {
      const totalSeconds = Math.floor(diff / 1000);
      const h = Math.floor(totalSeconds / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      const s = totalSeconds % 60;

      const parts = [];
      if (h > 0) parts.push(h + 'h');
      parts.push(m + 'm');
      parts.push(s + 's');

      textEl.textContent = parts.join(' ');
      el.style.color = 'var(--warning)';
      // Critical time warning (e.g. less than 30 mins)
      if (totalSeconds < 1800) el.style.color = '#f97316'; // Orange-Red
      if (totalSeconds < 300) el.style.color = 'var(--danger)'; // Red
    }
  });
}

// ==================== FLIGHT OPTION HELPERS ====================
function getFinancialTotals(it) {
  if (!it.flights || it.flights.length === 0) {
    const mu = parseFloat(it.markup) || 0;
    const svc = parseFloat(it.service_charge) || 0;
    const gst = svc > 0 ? Math.round(svc * 0.18) : 0;
    return { total: it.total_amount || 0, markup: mu, svc: svc, gst: gst };
  }

  const options = groupFlightsIntoOptions(it.flights, it.trip_type, it.raw_input_data);
  const selIdx = it.selected_flight_option !== null ? it.selected_flight_option : 0;
  const opt = options[selIdx];

  let total = 0;
  let markup = 0;
  let svc = 0;
  let gst = 0;

  if (opt) {
    opt.flights.forEach(f => {
      const fareEntries = Object.entries(f.fares || {});
      if (fareEntries.length > 0) {
        const [type, base] = fareEntries[0];
        const f_mu = (f.fare_mu && f.fare_mu[type] !== undefined) ? parseFloat(f.fare_mu[type]) : (f.markup !== undefined ? parseFloat(f.markup) : (parseFloat(it.markup) || 0));
        const f_svc = (f.fare_svc && f.fare_svc[type] !== undefined) ? parseFloat(f.fare_svc[type]) : (f.service_charge !== undefined ? parseFloat(f.service_charge) : (parseFloat(it.service_charge) || 0));
        const f_gst = f_svc > 0 ? Math.round(f_svc * 0.18) : 0;

        total += (parseFloat(base) || 0) + f_mu + f_svc + f_gst;
        markup += f_mu;
        svc += f_svc;
        gst += f_gst;
      }
    });
  } else {
    markup = parseFloat(it.markup) || 0;
    svc = parseFloat(it.service_charge) || 0;
    gst = svc > 0 ? Math.round(svc * 0.18) : 0;
    total = it.total_amount || 0;
  }
  return { total, markup, svc, gst };
}

function getEffectiveTotal(it) {
  return getFinancialTotals(it).total;
}
function shouldShowFinancials(it) {
  const numOpts = getFlightOptionCount(it.flights, it.trip_type, it.raw_input_data);
  return numOpts === 1 || it.selected_flight_option !== null;
}
function getFlightOptionCount(flights, tripType, rawInputData) {
  if (!flights || flights.length === 0) return 0;
  if (tripType === 'round_trip') return Math.ceil(flights.length / 2);
  if (tripType === 'multi_city') {
    const rawOptions = buildMultiCityOptionsFromRawMap(flights, rawInputData);
    if (rawOptions.length > 0) return rawOptions.length;
    const units = new Set(flights.map(f => getFlightUnitId(f)));
    return units.size;
  }
  return flights.length;
}

const areFaresInitiallySame = (f1, f2) => {
  if (!f1.fares || !f2.fares) return false;
  const k1 = Object.keys(f1.fares).sort();
  const k2 = Object.keys(f2.fares).sort();
  if (k1.length !== k2.length) return false;
  if (!k1.every((key, i) => key === k2[i])) return false;
  return k1.every(key => f1.fares[key] === f2.fares[key]);
};

// Group flights into options based on trip type
function groupFlightsIntoOptions(flights, tripType, rawInputData) {
  if (!flights || flights.length === 0) return [];
  const options = [];

  if (tripType === 'round_trip') {
    // Round trip: pair flights (outbound + return)
    for (let i = 0; i < flights.length; i += 2) {
      const opt = { flights: [flights[i]], label: 'Option ' + (Math.floor(i / 2) + 1), index: Math.floor(i / 2) };
      if (i + 1 < flights.length) opt.flights.push(flights[i + 1]);
      options.push(opt);
    }
  } else if (tripType === 'multi_city') {
    const rawOptions = buildMultiCityOptionsFromRawMap(flights, rawInputData);
    if (rawOptions.length > 0) return rawOptions;
    // Multi-city: group by unit_id
    const unitMap = {};
    flights.forEach((f, i) => {
      const uid = getFlightUnitId(f);
      if (!unitMap[uid]) unitMap[uid] = { flights: [], label: 'Option ' + Object.keys(unitMap).length + 1, indices: [] };
      unitMap[uid].flights.push(f);
      unitMap[uid].indices.push(i);
    });
    let idx = 0;
    Object.values(unitMap).forEach(group => {
      group.label = 'Option ' + (idx + 1);
      group.index = idx++;
      options.push(group);
    });
  } else {
    // One way: each flight is an option
    flights.forEach((f, i) => {
      options.push({ flights: [f], label: 'Option ' + (i + 1), index: i });
    });
  }
  return options;
}

// ==================== FLIGHT SECTION RENDERING ====================
function renderFlightSection() {
  const it = currentItinerary;
  const flights = it.flights || [];
  const selectedIndex = Number.isInteger(it.selected_flight_option)
    ? it.selected_flight_option
    : (it.selected_flight_option !== null && it.selected_flight_option !== undefined ? Number(it.selected_flight_option) : null);
  const isFinalized = ['approved', 'on_hold', 'confirmed', 'issued'].includes(it.status);

  const section = document.getElementById('flightOptionsSection');
  const container = document.getElementById('flightOptionsContainer');

  if (flights.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';

  // Always Group Options Correctly
  const options = groupFlightsIntoOptions(flights, it.trip_type, it.raw_input_data);

  // After approval: show ONLY the selected flight, with finalized details
  if (isFinalized && options.length > 0) {
    const finalizedIndex = selectedIndex !== null && !Number.isNaN(selectedIndex) ? selectedIndex : 0;
    const selectedOpt = options[finalizedIndex] || options[0];
    document.querySelector('#flightOptionsSection .section-header-row h2').textContent = '✈️ Selected Flight';
    document.getElementById('flightOptionsBadge').textContent = '';

    container.innerHTML = renderFlightOptionCard(selectedOpt, finalizedIndex, true, false, it.trip_type);
    return;
  }

  // Draft: show all options with selection
  const showSelectionBtns = it.status === 'draft' && options.length > 1;
  document.querySelector('#flightOptionsSection .section-header-row h2').textContent = '✈️ Flight Options';
  document.getElementById('flightOptionsBadge').textContent = options.length;

  container.innerHTML = options.map((opt, idx) => {
    const isSelected = selectedIndex === idx;
    return renderFlightOptionCard(opt, idx, isSelected, showSelectionBtns, it.trip_type);
  }).join('');
}



function renderFlightOptionCard(option, idx, isSelected, showSelectBtn, tripType) {
  // Use advanced rendering logic similar to index.html
  const uniqueId = `opt-${idx}`;
  const passengerLabel = getItineraryPassengerLabel(currentItinerary);
  const optionLabel = showSelectBtn ? (isSelected ? 'Selected' : option.label) : '';

  // Decide layout based on trip type
  let contentHtml = '';
  let footerHtml = '';

  if (tripType === 'round_trip' && option.flights.length === 2) {
    const outbound = option.flights[0];
    const returnFlight = option.flights[1];

    const outSummary = generateFlightSummaryHTML(outbound, idx, `${uniqueId}-out`);
    const outTimeline = generateFlightTimelineHTML(outbound, idx, `${uniqueId}-out`);

    const retSummary = generateFlightSummaryHTML(returnFlight, idx, `${uniqueId}-ret`);
    const retTimeline = generateFlightTimelineHTML(returnFlight, idx, `${uniqueId}-ret`);

    const areFaresDifferent = (outbound.is_split === true) || !areFaresInitiallySame(outbound, returnFlight);

    if (areFaresDifferent) {
      const outFares = generateFaresFooterHTML(outbound, 'outbound');
      const retFares = generateFaresFooterHTML(returnFlight, 'return');
      contentHtml += `
          <div class="combined-label">Outbound</div>
          ${outSummary}
          ${outTimeline}
          <div class="flight-divider"></div>
          <div class="combined-label" style="background:var(--secondary);">Return</div>
          ${retSummary}
          ${retTimeline}
      `;
      footerHtml += `${outFares}${retFares}`;
    } else {
      const combinedFares = generateFaresFooterHTML(outbound); // Share outbound fares
      contentHtml += `
          <div class="combined-label">Outbound</div>
          ${outSummary}
          ${outTimeline}
          <div class="flight-divider"></div>
          <div class="combined-label" style="background:var(--secondary);">Return</div>
          ${retSummary}
          ${retTimeline}
      `;
      footerHtml += combinedFares;
    }
  } else if (tripType === 'multi_city') {
    option.flights.forEach((f, fi) => {
      const subId = `${uniqueId}-${fi}`;
      if (fi > 0) contentHtml += `<div class="flight-divider"></div>`;
      contentHtml += `<div class="combined-label">Flight ${fi + 1}</div>`;
      contentHtml += generateFlightSummaryHTML(f, idx, subId);
      contentHtml += generateFlightTimelineHTML(f, idx, subId);
    });
    // Multi-city uses fares from first flight of the option by default
    footerHtml += generateFaresFooterHTML(option.flights[0]);
  } else {
    // One way
    option.flights.forEach((f, fi) => {
      const subId = `${uniqueId}-${fi}`;
      contentHtml += generateFlightSummaryHTML(f, idx, subId);
      contentHtml += generateFlightTimelineHTML(f, idx, subId);
      footerHtml += generateFaresFooterHTML(f);
    });
  }

  const selectBtnHtml = showSelectBtn ?
    `<button class="option-select-btn ${isSelected ? 'selected' : ''}" onclick="event.stopPropagation();selectFlightOption(${idx})">${isSelected ? '✓ Selected' : 'Select'}</button>` : '';

  const passengerFooterHtml = passengerLabel && passengerLabel.count ? `
    <div class="itinerary-passengers itinerary-passengers-footer">
      <div class="itinerary-passengers-label">Passengers</div>
      <div class="itinerary-passengers-names">
        ${passengerLabel.names.map(name => `<span class="passenger-chip">${name}</span>`).join('')}
      </div>
      ${passengerLabel.suffix ? `<div class="itinerary-passengers-more">+${passengerLabel.count - 3} more</div>` : ''}
    </div>
  ` : '';

  return `
    <div class="flight-card itinerary-flight-card ${isSelected ? 'selected' : ''}">
         <div class="itinerary-flight-card-head">
           <div>${optionLabel ? `<div class="option-label">${optionLabel}</div>` : ''}</div>
           <div class="itinerary-flight-card-actions">
             ${selectBtnHtml}
           </div>
         </div>
         <div class="itinerary-card-body">
           ${contentHtml}
         </div>
         <div class="itinerary-card-footer-row">
           ${footerHtml}
           ${passengerFooterHtml}
         </div>
    </div>
  `;
}

// ==================== RENDERING HELPERS (Ported from index.html) ====================

function generateFlightSummaryHTML(flight, index, uniqueId) {
  // Helper to safely display values - never show undefined, null, N/A
  const safe = (val, fallback = '') => {
    if (val === undefined || val === null || val === 'N/A' || val === 'Not Specified' || val === 'undefined' || val === 'null') {
      return fallback;
    }
    return val;
  };

  const airlineName = safe(flight.airline, 'Airline');
  const flightNumber = safe(flight.flight_number, '');
  const depTime = safe(flight.departure_time, '--:--');
  const arrTime = safe(flight.arrival_time, '--:--');
  const depCity = safe(flight.departure_city, '');
  const arrCity = safe(flight.arrival_city, '');
  const depAirport = safe(flight.departure_airport, '');
  const arrAirport = safe(flight.arrival_airport, '');
  const duration = safe(flight.duration, '--');
  const daysOffset = flight.days_offset || 0;
  const hasSegments = flight.segments && flight.segments.length > 0;
  const displayStops = safe(flight.stops, hasSegments ? `${flight.segments.length - 1} Stop(s)` : 'Direct');
  const isDirect = displayStops.toLowerCase().includes('non-stop') || displayStops.toLowerCase().includes('direct') || (flight.segments && flight.segments.length <= 1);
  const isMissingDate = !flight.departure_date || flight.departure_date === 'N/A';

  // Helper for city display
  const formatCity = (city, airport) => {
    if (!city) return airport || '';
    if (airport && city.includes(airport)) return city;
    if (airport && city.trim() === airport.trim()) return city;
    return `${city} <span class="airport-code-small">(${airport || ''})</span>`;
  };

  return `
    <div class="flight-summary" onclick="toggleDetails('${uniqueId}')">
        <div class="summary-main">
            <div class="summary-airline">
                <div class="airline-stack">
                    ${(hasSegments && !isDirect)
      ? flight.segments.map(s => `
                          <div class="airline-row">
                            <span class="airline-name-small">${safe(s.airline, 'Airline')}</span>
                            <span class="flight-code-small">${safe(s.flight_number, '')}</span>
                          </div>
                        `).join('')
      : `
                          <div class="airline-name">${airlineName}</div>
                          <div class="flight-code">${flightNumber}</div>
                        `
    }
                </div>
                <div id="date-display-${index}" class="summary-date" style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem;">${isMissingDate ? '' : flight.departure_date}</div>
            </div>
            
            <div class="flight-route-visual">
                <div class="time-group">
                    <div class="time-big">${depTime}</div>
                    <div class="city-code">${formatCity(depCity, depAirport)}</div>
                </div>
                
                <div class="duration-line-container">
                    <div class="duration-text">${duration}</div>
                    <div class="summary-route-line"></div>
                    <div class="stops-text ${isDirect ? 'direct' : ''}">${displayStops}</div>
                </div>
                
                <div class="time-group">
                    <div class="time-big">${arrTime}${daysOffset > 0 ? `<sup style="color: #f59e0b; font-size: 0.7rem; font-weight: 600; margin-left: 2px;">+${daysOffset}</sup>` : ''}</div>
                    <div class="city-code">${formatCity(arrCity, arrAirport)}</div>
                </div>
            </div>
        </div>
        <div class="expand-icon" id="arrow-${uniqueId}"></div>
    </div>
  `;
}

function generateFareSpecificDetailsHTML(details) {
  const { baggage_cabin, baggage_checkin, baggage_pcs, meal, seat, cancellation_charges, penalty_charges } = details;

  const hasBaggage = baggage_cabin || baggage_checkin || baggage_pcs;
  const hasExtras = meal || seat;
  const hasCharges = cancellation_charges || penalty_charges;

  if (!hasBaggage && !hasExtras && !hasCharges) return '';

  let html = '<div style="display: flex; flex-direction: column; gap: 0.85rem;">';

  // Baggage Grid
  if (hasBaggage) {
    html += `
          <div>
            <div style="font-size: 0.65rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.05em;">Baggage</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.5rem; font-size: 0.85rem;">
                ${baggage_cabin ? `<div><small style="color:var(--text-secondary); display:block; font-size: 0.6rem;">Cabin</small><span>${baggage_cabin}</span></div>` : ''}
                ${baggage_checkin ? `<div><small style="color:var(--text-secondary); display:block; font-size: 0.6rem;">Check-in</small><span>${baggage_checkin}</span></div>` : ''}
                ${baggage_pcs ? `<div><small style="color:var(--text-secondary); display:block; font-size: 0.6rem;">Pieces</small><span>${baggage_pcs}</span></div>` : ''}
            </div>
          </div>
        `;
  }

  // Extras Grid
  if (hasExtras) {
    html += `
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
             ${meal ? `<div><small style="color:var(--text-secondary); display:block; font-size: 0.6rem;">Meal</small><span style="font-size: 0.85rem;">${meal}</span></div>` : ''}
             ${seat ? `<div><small style="color:var(--text-secondary); display:block; font-size: 0.6rem;">Seat</small><span style="font-size: 0.85rem;">${seat}</span></div>` : ''}
          </div>
        `;
  }

  // Charges Grid
  if (hasCharges) {
    html += `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
         ${details.cancellation_charges ? `<div><small style="color:var(--text-secondary); display:block; font-size: 0.6rem;">Cancellation</small><span style="font-weight:600; font-size:0.85rem; color:var(--danger);">${details.cancellation_charges} <small style="font-weight:400; color:var(--text-secondary);">+GST</small></span></div>` : ''}
         ${details.penalty_charges ? `<div><small style="color:var(--text-secondary); display:block; font-size: 0.6rem;">Change Penalty</small><span style="font-weight:600; font-size:0.85rem; color:var(--warning);">${details.penalty_charges} <small style="font-weight:400; color:var(--text-secondary);">+GST</small></span></div>` : ''}
      </div>
    `;
  }

  html += '</div>';
  return html;
}

function generateFlightTimelineHTML(flight, index, uniqueId) {
  const numFares = Object.keys(flight.fares || {}).length;

  // Helper to safely display values - never show undefined, null, N/A
  const safe = (val, fallback = '') => {
    if (val === undefined || val === null || val === 'N/A' || val === 'Not Specified' || val === 'undefined' || val === 'null') {
      return fallback;
    }
    return val;
  };

  const depTime = safe(flight.departure_time, '--:--');
  const arrTime = safe(flight.arrival_time, '--:--');
  const depCity = safe(flight.departure_city, '');
  const arrCity = safe(flight.arrival_city, '');
  const depAirport = safe(flight.departure_airport, '');
  const arrAirport = safe(flight.arrival_airport, '');
  const airlineName = safe(flight.airline, 'Airline');
  const flightNumber = safe(flight.flight_number, '');
  const duration = safe(flight.duration, '--');
  const baggage = safe(flight.baggage, '');

  const hasSegments = flight.segments && flight.segments.length > 0;
  const displayStops = safe(flight.stops, 'Direct');
  const isDirect = displayStops.toLowerCase().includes('non-stop') || displayStops.toLowerCase().includes('direct') || (flight.segments && flight.segments.length <= 1);

  const formatCity = (city, airport) => {
    if (!city) return airport || '';
    if (airport && city.includes(airport)) return city;
    if (airport && city.trim() === airport.trim()) return city;
    return `${city} <span class="airport-code-small">(${airport || ''})</span>`;
  };

  const calculateTimeDiff = (startTime, endTime) => {
    if (!startTime || !endTime) return null;
    try {
      const parseTime = (t) => {
        const parts = t.match(/(\d+):(\d+)\s*(AM|PM)?/i);
        if (!parts) return null;
        let h = parseInt(parts[1], 10);
        const m = parseInt(parts[2], 10);
        const p = parts[3] ? parts[3].toUpperCase() : null;
        if (p === 'PM' && h < 12) h += 12;
        if (p === 'AM' && h === 12) h = 0;
        return h * 60 + m;
      };
      const startMins = parseTime(startTime);
      const endMins = parseTime(endTime);
      if (startMins === null || endMins === null) return null;
      let diff = endMins - startMins;
      if (diff < 0) diff += 24 * 60;
      const hours = Math.floor(diff / 60);
      const minutes = diff % 60;
      let text = '';
      if (hours > 0) text += `${hours}h `;
      if (minutes > 0) text += `${minutes}m`;
      return { text: text.trim(), minutes: diff };
    } catch (e) { return null; }
  };

  const getLayoverLabel = (minutes) => {
    if (minutes < 60) return { label: 'Short Layover', alertClass: 'short' };
    if (minutes > 300) return { label: 'Long Wait', alertClass: 'long' };
    return { label: 'Layover', alertClass: '' };
  };

  const AIRPORT_TIMEZONES = {
    'CCU': 5.5, 'DEL': 5.5, 'BOM': 5.5, 'BLR': 5.5, 'MAA': 5.5, 'HYD': 5.5, 'AMD': 5.5, 'PNQ': 5.5, 'GOI': 5.5, 'COK': 5.5, 'GAU': 5.5, 'PAT': 5.5,
    'SIN': 8, 'BKK': 7, 'HKG': 8, 'KUL': 8, 'NRT': 9, 'HND': 9, 'ICN': 9, 'PEK': 8, 'PVG': 8, 'CMB': 5.5, 'DAC': 6, 'KTM': 5.75,
    'DXB': 4, 'DOH': 3, 'AUH': 4, 'BAH': 3, 'KWI': 3, 'MCT': 4,
    'LHR': 0, 'CDG': 1, 'FRA': 1, 'AMS': 1, 'FCO': 1, 'IST': 3,
    'JFK': -5, 'LAX': -8, 'SFO': -8, 'ORD': -6, 'YYZ': -5,
    'SYD': 10, 'MEL': 10, 'AKL': 12
  };

  const calculateSegmentDurationWithTimezone = (depT, arrT, depA, arrA) => {
    if (!depT || !arrT) return 'N/A';
    try {
      const parseTime = (t) => {
        const parts = t.match(/(\d+):(\d+)\s*(AM|PM)?/i);
        if (!parts) return null;
        let h = parseInt(parts[1], 10);
        const m = parseInt(parts[2], 10);
        const p = parts[3] ? parts[3].toUpperCase() : null;
        if (p === 'PM' && h < 12) h += 12;
        if (p === 'AM' && h === 12) h = 0;
        return h * 60 + m;
      };
      const dm = parseTime(depT);
      const am = parseTime(arrT);
      if (dm === null || am === null) return 'N/A';
      const dtz = AIRPORT_TIMEZONES[depA?.toUpperCase()] || 5.5;
      const atz = AIRPORT_TIMEZONES[arrA?.toUpperCase()] || 5.5;
      const td = Math.round((atz - dtz) * 60);
      let ad = am - dm;
      if (ad < 0) ad += 24 * 60;
      let actual = ad - td;
      if (actual < 0) actual += 24 * 60;
      if (actual > 24 * 60) actual -= 24 * 60;
      const hrs = Math.floor(actual / 60);
      const mins = actual % 60;
      return `${hrs}h ${mins}m`;
    } catch (e) { return 'N/A'; }
  };

  let html = `<div id="timeline-${uniqueId}" class="flight-timeline-container" style="display: none;">`;
  html += '<div class="flight-timeline">';

  if (hasSegments && !isDirect) {
    flight.segments.forEach((seg, i) => {
      const nextSeg = flight.segments[i + 1];
      let segmentDuration = seg.duration;
      if (!segmentDuration || segmentDuration === 'Duration n/a' || segmentDuration === 'N/A') {
        segmentDuration = calculateSegmentDurationWithTimezone(seg.departure_time, seg.arrival_time, seg.departure_airport, seg.arrival_airport);
      }
      const sAir = safe(seg.airline, safe(flight.airline, 'Airline'));
      const sNum = safe(seg.flight_number, '');
      const sDT = safe(seg.departure_time, '--:--');
      const sAT = safe(seg.arrival_time, '--:--');
      const sDC = safe(seg.departure_city, safe(seg.departure_airport, 'Departure'));
      const sAC = safe(seg.arrival_city, safe(seg.arrival_airport, 'Arrival'));
      const sDA = safe(seg.departure_airport, '');
      const sAA = safe(seg.arrival_airport, '');
      const sDur = safe(segmentDuration, '--');
      const sBag = safe(flight.baggage, '');

      html += `
                    <div class="timeline-segment">
                    <div class="t-dot departure"></div>
                    ${(i === flight.segments.length - 1) ? '<div class="t-dot arrival"></div>' : ''}
                    <div class="t-time-row">
                        <div class="t-time">${sDT}${seg.accumulated_dep_days > 0 ? `<sup style="color: #f59e0b; font-size: 0.65rem; font-weight: 600; margin-left: 2px;">+${seg.accumulated_dep_days}</sup>` : ''}</div>
                        <div class="t-city">${formatCity(sDC, sDA)}</div>
                    </div>
                    <div class="flight-info-block">
                        <div class="info-row">
                             <div class="info-icon">✈</div>
                             <span style="font-weight: 600; color: var(--text-primary);">${sAir} ${sNum}</span>
                        </div>
                        <div class="info-row" style="flex-wrap: wrap; gap: 0.5rem 1.25rem;">
                             <div class="info-icon">⏱</div>
                             <span>${sDur}</span>
                        </div>
                    </div>
                    <div class="t-time-row">
                        <div class="t-time" style="color: var(--text-secondary); font-size: 1rem;">${sAT}${(seg.accumulated_arr_days || seg.days_offset) > 0 ? `<sup style="color: #f59e0b; font-size: 0.65rem; font-weight: 600; margin-left: 2px;">+${seg.accumulated_arr_days || seg.days_offset}</sup>` : ''}</div>
                        <div class="t-city" style="font-weight: 500; color: var(--text-secondary); font-size: 0.95rem;">${formatCity(sAC, sAA)}</div>
                    </div>
                </div>
             `;

      if (nextSeg) {
        let dText = safe(nextSeg.layover_duration, '');
        let lText = 'Layover';
        if (!dText) {
          const lDiff = calculateTimeDiff(seg.arrival_time, nextSeg.departure_time);
          if (lDiff) { dText = lDiff.text; lText = getLayoverLabel(lDiff.minutes).label; }
        } else {
          const dM = dText.match(/(\d+)h\s*(\d+)?m?/);
          if (dM) lText = getLayoverLabel(parseInt(dM[1]) * 60 + (parseInt(dM[2]) || 0)).label;
        }
        const lDA = safe(nextSeg.departure_airport, '');
        const lDC = safe(nextSeg.departure_city, lDA);
        html += `
                    <div class="layover-container">
                        <div class="layover-icon-box" title="Layover">
                            <img src="/static/travel.png" alt="Airport">
                        </div>
                        <div class="layover-pill"><span>⏱</span><span>${lText} in ${lDC} • ${dText}</span></div>
                    </div>
                `;
      }
    });
  } else {
    html += `
            <div class="timeline-segment">
                <div class="t-dot departure"></div>
                <div class="t-time-row">
                    <div class="t-time">${depTime}</div>
                    <div class="t-city">${formatCity(depCity, depAirport)}</div>
                </div>
                <div class="flight-info-block">
                    <div class="info-row">
                         <div class="info-icon">✈</div>
                         <span style="font-weight: 600; color: var(--text-primary);">${airlineName} ${flightNumber}</span>
                    </div>
                    ${duration && duration !== '--' ? `<div class="info-row"><div class="info-icon">⏱</div><span>${duration}</span></div>` : ''}
                </div>

                <div class="t-dot arrival"></div>
                <div class="t-time-row">
                    <div class="t-time">${arrTime}</div>
                    <div class="t-city">${formatCity(arrCity, arrAirport)}</div>
                </div>
            </div>
        `;
  }

  html += '</div></div>';
  return html;
}

function generateFaresFooterHTML(flight, variant = '') {
  let extraClass = '';
  if (variant === 'outbound') extraClass = ' fare-footer-outbound';
  else if (variant === 'return') extraClass = ' fare-footer-return';

  const numFares = Object.keys(flight.fares || {}).length;

  let faresHTML = `<div class="card-footer-fares${extraClass}">`;
  if (flight.fares) {
    Object.entries(flight.fares).forEach(([type, base]) => {
      const perFareMU = flight.fare_mu && flight.fare_mu[type] !== undefined ? flight.fare_mu[type] : (flight.markup || 0);
      const finalFare = base + perFareMU;
      const perFareSVC = flight.fare_svc && flight.fare_svc[type] !== undefined ? flight.fare_svc[type] : (flight.service_charge || 0);
      const perFareGST = perFareSVC > 0 ? Math.round(perFareSVC * 0.18) : 0;
      let extraText = '';
      if (perFareSVC > 0) {
        extraText = ` <span style="font-size: 0.75rem; color: var(--text-secondary); font-weight: normal;">(+ ₹${perFareSVC} SVC + ₹${perFareGST} GST)</span>`;
      }

      const fareUniqueId = `fare-${type}-${Math.random().toString(36).substr(2, 5)}`;

      // Decide which details to show in the collapsible
      let detailsToRender = (flight.fare_extra_details && flight.fare_extra_details[type]) || {};

      // If single fare, ensure we have the main baggage/extra info if not already there
      if (numFares === 1) {
        detailsToRender = { ...detailsToRender };
        if (!detailsToRender.baggage_cabin && flight.baggage_cabin) detailsToRender.baggage_cabin = flight.baggage_cabin;
        if (!detailsToRender.baggage_checkin && flight.baggage_checkin) detailsToRender.baggage_checkin = flight.baggage_checkin;
        if (!detailsToRender.baggage_pcs && flight.baggage_pcs) detailsToRender.baggage_pcs = flight.baggage_pcs;
        if (!detailsToRender.meal && flight.meal) detailsToRender.meal = flight.meal;
        if (!detailsToRender.seat && flight.seat) detailsToRender.seat = flight.seat;
        if (!detailsToRender.cancellation_charges && flight.cancellation_charges) detailsToRender.cancellation_charges = flight.cancellation_charges;
        if (!detailsToRender.penalty_charges && flight.penalty_charges) detailsToRender.penalty_charges = flight.penalty_charges;
      }

      const fareDetailsHTML = generateFareSpecificDetailsHTML(detailsToRender);
      const hasClickableDetails = fareDetailsHTML.trim().length > 0;

      faresHTML += `
              <div class="footer-fare-item" ${hasClickableDetails ? `onclick="toggleFareDetails('${fareUniqueId}')" style="cursor:pointer;"` : ''}>
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                    <span class="footer-fare-label">${type}</span>
                    ${hasClickableDetails ? `<span id="fare-toggle-icon-${fareUniqueId}" style="font-size:0.7rem; color:var(--text-secondary); transition: transform 0.3s ease;">▼</span>` : ''}
                </div>
                <span class="footer-fare-price">₹ ${finalFare.toLocaleString('en-IN')}${extraText}</span>
                
                ${hasClickableDetails ? `
                <div id="${fareUniqueId}" class="fare-details-collapsible" style="display:none; width:100%; margin-top:0.5rem; border-top:1px solid var(--border); padding-top:0.5rem; text-align: left;">
                    ${fareDetailsHTML}
                </div>
                ` : ''}
              </div>
            `;
    });
  }
  faresHTML += '</div>';
  return faresHTML;
}

function toggleDetails(uniqueId) {
  const summary = document.getElementById(`timeline-${uniqueId}`);
  const arrow = document.getElementById(`arrow-${uniqueId}`);
  if (summary.style.display === 'none') {
    summary.style.display = 'block';
    if (arrow) arrow.classList.add('expanded');
  } else {
    summary.style.display = 'none';
    if (arrow) arrow.classList.remove('expanded');
  }
}

function toggleFareDetails(fareUniqueId) {
  const details = document.getElementById(fareUniqueId);
  const icon = document.getElementById(`fare-toggle-icon-${fareUniqueId}`);
  if (!details) return;

  if (details.style.display === 'none') {
    details.style.display = 'block';
    if (icon) icon.style.transform = 'rotate(180deg)';
  } else {
    details.style.display = 'none';
    if (icon) icon.style.transform = 'rotate(0deg)';
  }
}

// ==================== PASSENGERS ====================
function renderPassengers() {
  const it = currentItinerary; const pax = it.passengers_data || [];
  const isFinal = it.status === 'confirmed' || it.status === 'on_hold';

  if (document.getElementById('addPassengerBtn')) {
    document.getElementById('addPassengerBtn').style.display = isFinal ? 'none' : '';
  }

  const container = document.getElementById('passengersContainer');
  if (pax.length === 0) {
    container.innerHTML = '<div style="padding:0.75rem 0.25rem;color:var(--text-secondary);font-size:0.9rem;line-height:1.4;">Not added yet.</div>';
    return;
  }

  container.innerHTML = pax.map((p, i) => {
    const name = p.name || p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || 'Unknown';
    const isTemp = (p.id && String(p.id).indexOf('temp_') === 0) || p.is_db === false;
    const isLinked = (p.passenger_id || p.id) && !isTemp;
    // Ensure we show contact info if available
    const email = p.email || '';
    const phone = p.phone || '';

    // Calculate age from DOB if missing
    let age = p.age;
    if (!age && p.date_of_birth) {
      const dob = new Date(p.date_of_birth);
      const diff = Date.now() - dob.getTime();
      age = Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
    }
    const ageGender = [age ? age + 'y' : '', p.gender].filter(Boolean).join(' • ');
    const detailParts = [];
    if (email) detailParts.push(email);
    if (phone) detailParts.push(phone);
    if (ageGender) detailParts.push(ageGender);

    const detail = detailParts.join(' • ');

    return `<div class="pax-item">
      <div class="pax-info">
        <div class="pax-avatar">${name.charAt(0).toUpperCase()}</div>
        <div>
          <div class="pax-name" style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
            <span>${name}</span>
            ${isLinked ? `<button class="btn-manage-pax" onclick="handlePassengerClick(${i})" title="Manage Passenger Settings">⚙️</button>` : ''}
            ${isLinked ? '<span class="fare-tag" style="font-size:0.7rem;background:rgba(16,185,129,0.1);color:var(--success);">📎 DB Linked</span>' : '<span class="fare-tag" style="font-size:0.7rem;">📝 Manual</span>'}
          </div>
          <div class="pax-detail">${detail || 'No contact info'}</div>
        </div>
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center;">
        ${!isFinal ? `<button class="pax-remove" onclick="event.stopPropagation(); removePassenger(${i})" title="Remove">✕</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ==================== PASSENGER MANAGEMENT (MODAL) ====================
async function loadAirlines() {
  try {
    const response = await fetch('/api/v2/airlines');
    if (response.ok) {
      const data = await response.json();
      airlines = data.airlines;
      populateAirlineDropdowns();
    }
  } catch (e) {
    console.error('Failed to load airlines:', e);
  }
}

function populateAirlineDropdowns() {
  const searchInput = document.getElementById('ffAirlineSearch');
  const list = document.getElementById('ffAirlineList');
  const hiddenInput = document.getElementById('ffAirline');

  if (!searchInput || !list) return;

  const filterAirlines = () => {
    const val = searchInput.value.toLowerCase();
    list.innerHTML = '';

    if (!val && document.activeElement !== searchInput) {
      list.style.display = 'none';
      return;
    }

    const matches = airlines.filter(a =>
      a.name.toLowerCase().includes(val) ||
      a.iata_code.toLowerCase().includes(val)
    );

    if (matches.length > 0) {
      list.style.display = 'block';
      matches.forEach(a => {
        const div = document.createElement('div');
        div.className = 'dropdown-item';
        div.innerHTML = `<div>${a.name}</div><span class="sub-text">${a.iata_code}</span>`;
        div.onclick = () => {
          searchInput.value = `${a.name} (${a.iata_code})`;
          hiddenInput.value = a.id;
          list.style.display = 'none';
        };
        list.appendChild(div);
      });
    } else {
      list.style.display = 'none';
    }
  };

  searchInput.oninput = filterAirlines;
  searchInput.onclick = filterAirlines;

  // Close list when clicking outside
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !list.contains(e.target)) {
      list.style.display = 'none';
    }
  });
}

async function handlePassengerClick(idx) {
  const p = currentItinerary.passengers_data[idx];
  const pId = p.id || p.passenger_id;

  if (!pId || (typeof pId === 'string' && pId.startsWith('temp_'))) {
    showToast('Only database-linked passengers can be managed here.', 'info');
    return;
  }

  try {
    const response = await fetch(`/api/v2/passengers/${pId}`);
    if (!response.ok) throw new Error('Failed to load passenger');

    currentPassenger = await response.json();
    openPaxDetailModal();
  } catch (e) {
    console.error(e);
    showToast('Failed to load passenger details', 'error');
  }
}

function openPaxDetailModal() {
  const p = currentPassenger;
  if (!p) return;

  // Reset forms to clear any unsaved scan data or manual edits
  const forms = ['editPaxForm', 'paxDocForm', 'paxFfForm', 'editPrefsForm'];
  forms.forEach(id => {
    const f = document.getElementById(id);
    if (f) f.reset();
  });

  document.getElementById('paxDetailTitle').textContent = `Manage: ${p.first_name} ${p.last_name}`;

  // Populate Profile Tab
  document.getElementById('editPaxId').value = p.id;
  document.getElementById('editPaxTitle').value = p.title || '';
  document.getElementById('editPaxFirstName').value = p.first_name || '';
  document.getElementById('editPaxMiddleName').value = p.middle_name || '';
  document.getElementById('editPaxLastName').value = p.last_name || '';
  document.getElementById('editPaxDOB').value = p.date_of_birth || '';
  document.getElementById('editPaxGender').value = p.gender || '';
  document.getElementById('editPaxNationality').value = p.nationality || '';
  document.getElementById('editPaxEmail').value = p.email || '';
  document.getElementById('editPaxPhone').value = p.phone || '';

  // Explicitly clear Passport/Document fields if they exist in state (or clear them)
  const passNum = document.getElementById('editPaxPassportNumber');
  const passIssue = document.getElementById('editPaxIssueDate');
  const passExpiry = document.getElementById('editPaxExpiryDate');
  if (passNum) passNum.value = p.passport_number || '';
  if (passIssue) passIssue.value = p.passport_issue_date || '';
  if (passExpiry) passExpiry.value = p.passport_expiry_date || '';

  // Populate Prefs Tab
  const prefs = p.preferences || {};
  const meal = document.getElementById('editPrefsMeal');
  const mealReq = document.getElementById('editPrefsMealReq');
  const seat = document.getElementById('editPrefsSeat');
  const assist = document.getElementById('editPrefsAssistance');
  const wheel = document.getElementById('editPrefsWheelchair');
  const airPref = document.getElementById('editPrefsPrefAir');
  const airAvoid = document.getElementById('editPrefsAvoidAir');

  if (meal) meal.value = prefs.meal_preference || '';
  if (mealReq) mealReq.value = prefs.meal_special_request || '';
  if (seat) seat.value = prefs.seat_preference || '';
  if (assist) assist.value = prefs.special_assistance_type || '';
  if (wheel) wheel.checked = prefs.wheelchair_required || false;
  if (airPref) airPref.value = prefs.preferred_airlines || '';
  if (airAvoid) airAvoid.value = prefs.avoid_airlines || '';

  // Render Lists
  renderPaxDocs();
  renderPaxFF();

  // Clear OCR State
  const previewCont = document.getElementById('paxDetailPassportPreviewContainer');
  const previewThumb = document.getElementById('paxDetailPassportPreviewThumbnail');
  const scanStatus = document.getElementById('paxDetailScanStatus');
  const uploadInput = document.getElementById('paxDetailPassportUpload');

  if (previewCont) previewCont.style.display = 'none';
  if (previewThumb) previewThumb.src = '';
  if (scanStatus) scanStatus.innerHTML = '';
  if (uploadInput) uploadInput.value = '';

  // Ensure side viewer is closed when opening a new passenger
  const viewer = document.getElementById('passportSideViewer');
  const modal = document.getElementById('paxDetailModal');
  if (viewer) viewer.classList.remove('active');
  if (modal) modal.classList.remove('modal-shifted');

  // Reset Airline Search
  const airSearch = document.getElementById('ffAirlineSearch');
  const airHidden = document.getElementById('ffAirline');
  if (airSearch) airSearch.value = '';
  if (airHidden) airHidden.value = '';

  showPaxTab('profile');
  showModal('paxDetailModal');
}

function closePaxDetailModal() {
  const viewer = document.getElementById('passportSideViewer');
  const modal = document.getElementById('paxDetailModal');
  if (viewer) viewer.classList.remove('active');
  if (modal) modal.classList.remove('modal-shifted');
  closeModal();
}

function showPaxTab(tabName) {
  document.querySelectorAll('.pax-tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.detail-tabs .tab-btn').forEach(b => b.classList.remove('active'));

  document.getElementById(`pax-tab-${tabName}`).classList.add('active');
  document.getElementById(`btn-tab-${tabName}`).classList.add('active');
}

function renderPaxDocs() {
  const list = document.getElementById('paxDocList');
  const docs = currentPassenger.travel_documents || [];

  if (docs.length === 0) {
    list.innerHTML = '<p style="color:var(--text-secondary); padding: 1rem; text-align: center;">No documents added.</p>';
    return;
  }

  list.innerHTML = docs.map(d => `
    <div class="doc-badge">
      <div>
        <div style="font-weight:600; color: var(--text-primary);">${d.document_type}</div>
        <div style="color:var(--text-secondary); font-size: 0.85rem;">${d.document_number}</div>
        <div style="font-size:0.75rem; color:var(--danger); margin-top: 2px;">Exp: ${d.expiry_date || 'N/A'}</div>
      </div>
      <button class="btn-delete-small" onclick="deletePaxDoc('${d.id}')" title="Delete">🗑️</button>
    </div>
  `).join('');
}

function renderPaxFF() {
  const list = document.getElementById('paxFfList');
  const accounts = currentPassenger.frequent_flyer_accounts || [];

  if (accounts.length === 0) {
    list.innerHTML = '<p style="color:var(--text-secondary); padding: 1rem; text-align: center;">No frequent flyer accounts.</p>';
    return;
  }

  list.innerHTML = accounts.map(a => `
    <div class="ff-badge">
      <div>
        <div style="font-weight:600; color: var(--text-primary);">${a.airline_code}</div>
        <div style="color:var(--text-secondary); font-size: 0.85rem;">${a.frequent_flyer_number}</div>
        ${a.tier_status ? `<span class="badge badge-tier">${a.tier_status}</span>` : ''}
      </div>
      <button class="btn-delete-small" onclick="deletePaxFF('${a.id}')" title="Delete">🗑️</button>
    </div>
  `).join('');
}

async function savePaxProfile(event) {
  event.preventDefault();
  const id = document.getElementById('editPaxId').value;
  const data = {
    title: document.getElementById('editPaxTitle').value,
    first_name: document.getElementById('editPaxFirstName').value,
    middle_name: document.getElementById('editPaxMiddleName').value,
    last_name: document.getElementById('editPaxLastName').value,
    date_of_birth: document.getElementById('editPaxDOB').value || null,
    gender: document.getElementById('editPaxGender').value,
    nationality: document.getElementById('editPaxNationality').value,
    email: document.getElementById('editPaxEmail').value,
    phone: document.getElementById('editPaxPhone').value
  };

  try {
    const response = await fetch(`/api/v2/passengers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (response.ok) {
      showToast('Profile updated successfully', 'success');
      currentPassenger = await response.json();
      closePaxDetailModal();
      if (currentItinerary) openItinerary(currentItinerary.id, true);
    } else {
      const errorData = await response.json();
      showToast(errorData.error || 'Failed to update profile', 'error');
    }
  } catch (e) {
    showToast('Update failed', 'error');
  }
}

async function savePaxPrefs(event) {
  event.preventDefault();
  const id = currentPassenger.id;
  const data = {
    meal_preference: document.getElementById('editPrefsMeal').value,
    meal_special_request: document.getElementById('editPrefsMealReq').value,
    seat_preference: document.getElementById('editPrefsSeat').value,
    special_assistance_type: document.getElementById('editPrefsAssistance').value,
    wheelchair_required: document.getElementById('editPrefsWheelchair').checked,
    preferred_airlines: document.getElementById('editPrefsPrefAir').value,
    avoid_airlines: document.getElementById('editPrefsAvoidAir').value
  };

  try {
    const response = await fetch(`/api/v2/passengers/${id}/preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (response.ok) {
      showToast('Preferences updated', 'success');
      closePaxDetailModal();
      if (currentItinerary) openItinerary(currentItinerary.id, true);
    } else {
      showToast('Failed to save preferences', 'error');
    }
  } catch (e) {
    showToast('Save failed', 'error');
  }
}

async function savePaxDoc(event) {
  event.preventDefault();
  const id = currentPassenger.id;
  const data = {
    document_type: document.getElementById('docType').value,
    document_number: document.getElementById('docNumber').value,
    expiry_date: document.getElementById('docExpiry').value
  };

  try {
    const response = await fetch(`/api/v2/passengers/${id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (response.ok) {
      showToast('Document added', 'success');
      const p = await (await fetch(`/api/v2/passengers/${id}`)).json();
      currentPassenger = p;
      renderPaxDocs();
      document.getElementById('paxDocForm').reset();
      if (currentItinerary) openItinerary(currentItinerary.id, true);
    }
  } catch (e) {
    showToast('Add failed', 'error');
  }
}

async function savePaxFf(event) {
  event.preventDefault();
  const id = currentPassenger.id;
  const data = {
    airline_id: document.getElementById('ffAirline').value,
    frequent_flyer_number: document.getElementById('ffNumber').value,
    tier_status: document.getElementById('ffTier').value
  };

  try {
    const response = await fetch(`/api/v2/passengers/${id}/frequent-flyer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (response.ok) {
      showToast('FF account added', 'success');
      const p = await (await fetch(`/api/v2/passengers/${id}`)).json();
      currentPassenger = p;
      renderPaxFF();
      document.getElementById('paxFfForm').reset();
      document.getElementById('ffAirlineSearch').value = '';
      document.getElementById('ffAirline').value = '';
      if (currentItinerary) openItinerary(currentItinerary.id, true);
    }
  } catch (e) {
    showToast('Add failed', 'error');
  }
}

async function deletePaxDoc(docId) {
  if (!confirm('Are you sure you want to delete this document?')) return;
  try {
    const response = await fetch(`/api/v2/passengers/${currentPassenger.id}/documents/${docId}`, { method: 'DELETE' });
    if (response.ok) {
      showToast('Document deleted', 'success');
      currentPassenger.travel_documents = currentPassenger.travel_documents.filter(d => d.id !== docId);
      renderPaxDocs();
    }
  } catch (e) { }
}

async function deletePaxFF(ffId) {
  if (!confirm('Are you sure you want to delete this FF account?')) return;
  try {
    const response = await fetch(`/api/v2/passengers/${currentPassenger.id}/frequent-flyer/${ffId}`, { method: 'DELETE' });
    if (response.ok) {
      showToast('FF account deleted', 'success');
      currentPassenger.frequent_flyer_accounts = currentPassenger.frequent_flyer_accounts.filter(a => a.id !== ffId);
      renderPaxFF();
    }
  } catch (e) { }
}



// ==================== BILLING ====================
function renderBilling() {
  const it = currentItinerary;
  const isFinal = it.status === 'confirmed';
  if (document.getElementById('editBillingBtn')) {
    document.getElementById('editBillingBtn').style.display = isFinal ? 'none' : '';
  }

  const hasBillingData = !!(it.billing_account || it.bill_to_name || it.bill_to_company || it.bill_to_email || it.bill_to_phone || it.bill_to_address || it.bill_to_gst);
  if (!hasBillingData) {
    document.getElementById('billingContainer').innerHTML = '<div style="padding:0.75rem 0.25rem;color:var(--text-secondary);font-size:0.9rem;line-height:1.4;">Not added yet.</div>';
    return;
  }

  let accountInfo = '';
  if (it.billing_account) {
    accountInfo = `<div class="billing-item" style="grid-column:1/-1;"><div class="label">Billing Account</div><div class="value" style="color:var(--primary);font-weight:600;">📎 ${it.billing_account.display_name} (${it.billing_account.account_type})</div></div>`;
  }

  const fin = getFinancialTotals(it);

  const isCorporate = (it.billing_account && it.billing_account.account_type === 'corporate') || (!it.billing_account && (it.bill_to_company || it.bill_to_gst));
  const nameLabel = isCorporate ? 'Contact Name' : 'Name';

  document.getElementById('billingContainer').innerHTML = `<div class="billing-grid">
    ${accountInfo}
    <div class="billing-item"><div class="label">${nameLabel}</div><div class="value">${it.bill_to_name || '-'}</div></div>
    ${isCorporate ? `<div class="billing-item"><div class="label">Company</div><div class="value">${it.bill_to_company || '-'}</div></div>` : ''}
    <div class="billing-item"><div class="label">Email</div><div class="value">${it.bill_to_email || '-'}</div></div>
    <div class="billing-item"><div class="label">Phone</div><div class="value">${it.bill_to_phone || '-'}</div></div>
    <div class="billing-item"><div class="label">Address</div><div class="value">${it.bill_to_address || '-'}</div></div>
    ${isCorporate ? `<div class="billing-item"><div class="label">GST</div><div class="value">${it.bill_to_gst || '-'}</div></div>` : ''}
    ${shouldShowFinancials(it) ? `
    <div class="billing-item"><div class="label">Total Amount</div><div class="value" style="color:var(--primary);font-weight:700;font-size:1.1rem">${formatCurrency(fin.total)}</div></div>
    <div class="billing-item"><div class="label">Markup</div><div class="value">${formatCurrency(fin.markup)}</div></div>
    <div class="billing-item"><div class="label">Service Charge</div><div class="value">${formatCurrency(fin.svc)}</div></div>
    <div class="billing-item"><div class="label">Svc GST (18%)</div><div class="value">${formatCurrency(fin.gst)}</div></div>
    ` : ''}
  </div>`;
}

// ==================== ACTIONS ====================
async function selectFlightOption(idx) {
  try {
    const r = await fetch('/api/v2/itineraries/' + currentItinerary.id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selected_flight_option: idx })
    });
    if (r.ok) { const d = await r.json(); currentItinerary = d.itinerary; renderDetailView(); showToast('Option selected', 'success'); }
    else showToast('Failed to select option', 'error');
  } catch (e) { showToast('Error', 'error'); }
}

async function approveItinerary() {
  const it = currentItinerary; const flights = it.flights || [];
  const numOpts = getFlightOptionCount(flights, it.trip_type, it.raw_input_data);
  if (numOpts > 1 && it.selected_flight_option === null) {
    showToast('Please select a flight option first', 'error'); return;
  }
  let selIdx = it.selected_flight_option;
  if (numOpts === 1 && selIdx === null) selIdx = 0;

  try {
    if (selIdx !== it.selected_flight_option) {
      await fetch('/api/v2/itineraries/' + it.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selected_flight_option: selIdx }) });
    }
    const r = await fetch('/api/v2/itineraries/' + it.id + '/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    if (r.ok) { const d = await r.json(); currentItinerary = d.itinerary; renderDetailView(); showToast('Itinerary approved!', 'success'); }
    else { const e = await r.json(); showToast(e.error || 'Failed', 'error'); }
  } catch (e) { showToast('Error', 'error'); }
}

async function holdItinerary() {
  showModal('holdItineraryModal');
  // Set default to 24 hours from now
  const now = new Date();
  now.setHours(now.getHours() + 24);
  const iso = now.toISOString().slice(0, 16);
  document.getElementById('holdDeadline').value = iso;
}

async function submitHoldItinerary() {
  const val = document.getElementById('holdDeadline').value;
  if (!val) { showToast('Please select a date and time', 'error'); return; }

  const deadline = new Date(val);
  if (deadline <= new Date()) { showToast('Deadline must be in the future', 'error'); return; }

  try {
    const r = await fetch('/api/v2/itineraries/' + currentItinerary.id + '/hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deadline: deadline.toISOString() })
    });
    if (r.ok) {
      const d = await r.json();
      currentItinerary = d.itinerary;
      renderDetailView();
      closeModal();
      showToast('Itinerary on hold until ' + deadline.toLocaleString(), 'success');
    }
    else showToast('Failed', 'error');
  } catch (e) { showToast('Error', 'error'); }
}

async function confirmItinerary() {
  if (!confirm("Are you sure you want to issue this itinerary?")) return;
  try {
    const r = await fetch('/api/v2/itineraries/' + currentItinerary.id + '/confirm', { method: 'POST' });
    if (r.ok) { const d = await r.json(); currentItinerary = d.itinerary; renderDetailView(); showToast('Itinerary issued!', 'success'); }
    else showToast('Failed', 'error');
  } catch (e) { showToast('Error', 'error'); }
}

async function revertItinerary() {
  try {
    const r = await fetch('/api/v2/itineraries/' + currentItinerary.id + '/revert', { method: 'POST' });
    if (r.ok) { const d = await r.json(); currentItinerary = d.itinerary; renderDetailView(); showToast('Itinerary reverted', 'success'); }
    else showToast('Failed', 'error');
  } catch (e) { showToast('Error', 'error'); }
}

async function deleteItinerary() {
  if (!confirm('Delete this itinerary?')) return;
  try {
    const r = await fetch('/api/v2/itineraries/' + currentItinerary.id, { method: 'DELETE' });
    if (r.ok) { showToast('Deleted', 'success'); showListView(); }
    else showToast('Failed to delete', 'error');
  } catch (e) { showToast('Error', 'error'); }
}

function editInParser() { window.location.href = '/?edit=' + currentItinerary.id; }
function generateTicket() { showToast('🎟️ Ticket generation coming soon!', 'info'); }

// ==================== COPY & SHARE ====================
function copyItinerary() {
  const it = currentItinerary || {};
  let text = getItineraryFinalOutputText(it);

  if (!text.trim()) {
    showToast('No saved itinerary text found for this itinerary', 'error');
    return;
  }

  copyTextToClipboard(text)
    .then(ok => showToast(ok ? 'Copied to clipboard!' : 'Copy failed', ok ? 'success' : 'error'))
    .catch(() => showToast('Copy failed', 'error'));
}

async function copyItineraryImage() {
  if (typeof html2canvas === 'undefined') {
    await loadHtml2Canvas();
  }

  const flightCard = document.querySelector('#flightOptionsContainer .itinerary-flight-card.selected') ||
    document.querySelector('#flightOptionsContainer .itinerary-flight-card');

  if (!flightCard) {
    showToast('No flight card found to copy', 'error');
    return;
  }

  try {
    showToast('Preparing image...', 'info');
    const canvas = await html2canvas(flightCard, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: document.documentElement.getAttribute('data-theme') === 'dark' ? '#0f172a' : '#f8fafc',
      windowWidth: flightCard.scrollWidth,
      windowHeight: flightCard.scrollHeight,
      scrollX: 0,
      scrollY: 0
    });

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      showToast('Failed to create image', 'error');
      return;
    }

    if (navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showToast('Image copied to clipboard', 'success');
        return;
      } catch (err) {
        console.warn('Clipboard image copy failed, falling back to download', err);
      }
    }

    const fileName = buildItineraryImageName();
    downloadImageFromCanvas(canvas, fileName);
  } catch (err) {
    console.error(err);
    showToast('Failed to copy image', 'error');
  }
}

function buildItineraryImageName() {
  const it = currentItinerary || {};
  const flights = it.flights || [];
  if (!flights.length) return 'Itinerary.png';

  const firstFlight = flights[0];
  const dep = firstFlight.departure_airport || firstFlight.departure_code || 'DEP';
  const arr = firstFlight.arrival_airport || firstFlight.arrival_code || 'ARR';
  const routeStr = `${dep} - ${arr}`;
  const typeStr = (it.trip_type || 'one_way').replace('_', ' ').toUpperCase();
  const dateStr = (firstFlight.departure_date || '').replace(/[\/\\]/g, '-').trim() || 'DATE';
  return `${routeStr} (${typeStr}) ${dateStr}.png`.replace(/[<>:"/\\|?*]/g, '_');
}

function shareItinerary() {
  const it = currentItinerary;
  const url = window.location.origin + '/itineraries#' + it.id;
  const text = `Flight Itinerary: ${it.title || it.reference_number || 'Untitled'}`;
  if (navigator.share) { navigator.share({ title: 'Flight Itinerary', text, url }).catch(() => { }); }
  else { navigator.clipboard.writeText(url).then(() => showToast('Link copied!', 'success')); }
}

// ==================== MODALS ====================
function showModal(id) {
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById(id);
  if (overlay) { overlay.classList.add('show', 'active'); }
  if (modal) { modal.classList.add('show', 'active'); }
}
function closeModal() {
  const overlay = document.getElementById('modalOverlay');
  if (overlay) { overlay.classList.remove('show', 'active'); }

  // Close all modal types on this page
  document.querySelectorAll('.modal, .modal-content').forEach(m => {
    m.classList.remove('show', 'active', 'modal-shifted');
  });

  // Close passport viewer as well
  const viewer = document.getElementById('passportSideViewer');
  if (viewer) viewer.classList.remove('active');
}

// ---- Unified Passenger Search & Add ----
function openUnifiedPassengerModal() {
  const searchInput = document.getElementById('itinPassengerSearch');
  searchInput.value = '';
  document.getElementById('itinPassengerResults').style.display = 'none';
  toggleItinNewPaxForm(false);
  showModal('unifiedPassengerModal');

  // Add click/focus listener to show results if not already there
  if (!searchInput.dataset.listenerAdded) {
    ['click', 'focus'].forEach(evt => {
      searchInput.addEventListener(evt, searchPassengerUnifiedItin);
    });
    searchInput.dataset.listenerAdded = 'true';
  }
}

function toggleItinNewPaxForm(show) {
  const form = document.getElementById('itinNewPassengerForm');
  form.style.display = show ? 'block' : 'none';
  if (show) {
    document.getElementById('itinPassengerResults').style.display = 'none';
  }
}

function searchPassengerUnifiedItin() {
  const q = document.getElementById('itinPassengerSearch').value.toLowerCase().trim();
  const resultsDiv = document.getElementById('itinPassengerResults');

  // No early return for empty q, we want to show all accounts at first
  /* 
  if (q.length === 0) {
    resultsDiv.style.display = 'none';
    return;
  }
  */

  const matches = dbPassengers.filter(p => {
    const name = (p.full_name || (p.first_name + ' ' + p.last_name)).toLowerCase();
    const email = (p.email || '').toLowerCase();
    const phone = (p.phone || '').toLowerCase();
    return name.includes(q) || email.includes(q) || phone.includes(q);
  });

  let html = matches.slice(0, 5).map(p => `
    <div class="dropdown-item" onclick="selectPassengerFromSearch('${p.id}')">
      <div style="font-weight:600;">${p.full_name || (p.first_name + ' ' + p.last_name)}</div>
      <div style="font-size:0.75rem; color:var(--text-secondary);">${p.email || 'No email'} ${p.phone ? '• ' + p.phone : ''}</div>
    </div>
  `).join('');

  // Add "Create New" option
  html += `
    <div class="dropdown-item" style="background:rgba(37,99,235,0.05); color:var(--primary); font-weight:600;" onclick="prepareNewPassengerItin('${q}')">
      + Create New: "${q}"
    </div>
  `;

  resultsDiv.innerHTML = html;
  resultsDiv.style.display = 'block';
}

async function selectPassengerFromSearch(pId) {
  const passenger = dbPassengers.find(p => p.id === pId);
  if (!passenger) return;

  const pax = currentItinerary.passengers_data || [];
  if (pax.find(p => (p.passenger_id || p.id) === pId)) {
    showToast('Passenger already added', 'warning');
    return;
  }

  const newPax = {
    passenger_id: pId,
    name: passenger.full_name || ((passenger.first_name || '') + ' ' + (passenger.last_name || '')).trim(),
    first_name: passenger.first_name,
    last_name: passenger.last_name,
    email: passenger.email,
    phone: passenger.phone,
    gender: passenger.gender,
    date_of_birth: passenger.date_of_birth,
    is_db: true
  };

  pax.push(newPax);
  await updateItineraryPassengers(pax);
  closeModal();
}

function prepareNewPassengerItin(input) {
  toggleItinNewPaxForm(true);
  const parts = input.trim().split(' ');
  document.getElementById('itinPaxFirst').value = parts[0] || '';
  document.getElementById('itinPaxLast').value = parts.slice(1).join(' ') || '';
  document.getElementById('itinPaxEmail').value = input.includes('@') ? input : '';
  document.getElementById('itinPaxPhone').value = /^\d+$/.test(input) ? input : '';
}

async function addNewPassengerItin() {
  const first = document.getElementById('itinPaxFirst').value.trim();
  const last = document.getElementById('itinPaxLast').value.trim();
  if (!first) { showToast('First name is required', 'error'); return; }

  const newPax = {
    name: `${first} ${last}`.trim(),
    first_name: first,
    last_name: last,
    email: document.getElementById('itinPaxEmail').value.trim(),
    phone: document.getElementById('itinPaxPhone').value.trim(),
    is_db: false
  };

  const shouldSave = document.getElementById('itinPaxSaveDB').checked;
  if (shouldSave) {
    try {
      const resp = await fetch('/api/v2/passengers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPax)
      });
      if (resp.ok) {
        const d = await resp.json();
        newPax.id = d.passenger.id;
        newPax.is_db = true;
        await loadDBPassengers(); // Refresh cache
      }
    } catch (e) { console.error('Error saving pax to DB:', e); }
  } else {
    newPax.id = 'temp_' + Date.now();
  }

  const pax = currentItinerary.passengers_data || [];
  pax.push(newPax);
  await updateItineraryPassengers(pax);
  closeModal();
}

async function updateItineraryPassengers(pax) {
  try {
    const r = await fetch('/api/v2/itineraries/' + currentItinerary.id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passengers_data: pax, num_passengers: pax.length })
    });
    if (r.ok) {
      const d = await r.json();
      currentItinerary = d.itinerary;
      renderPassengers();
      renderFlightSection();
      renderInfoCards();
      renderOutputBoxes();
      showToast('Passengers updated', 'success');
    } else {
      showToast('Failed to update itinerary', 'error');
    }
  } catch (e) {
    showToast('Error', 'error');
  }
}

async function removePassenger(idx) {
  if (!confirm('Remove this passenger?')) return;
  const pax = currentItinerary.passengers_data || [];
  pax.splice(idx, 1);
  try {
    const r = await fetch('/api/v2/itineraries/' + currentItinerary.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passengers_data: pax, num_passengers: Math.max(pax.length, 1) }) });
    if (r.ok) { const d = await r.json(); currentItinerary = d.itinerary; renderPassengers(); renderFlightSection(); renderInfoCards(); renderOutputBoxes(); showToast('Passenger removed', 'success'); }
  } catch (e) { showToast('Error', 'error'); }
}

// ---- Unified Billing Search & Add ----
function openUnifiedBillingModal() {
  const searchInput = document.getElementById('itinBillingSearch');
  searchInput.value = '';
  document.getElementById('itinBillingResults').style.display = 'none';
  toggleItinNewBillForm(false);
  showModal('unifiedBillingModal');

  if (!searchInput.dataset.listenerAdded) {
    ['click', 'focus'].forEach(evt => {
      searchInput.addEventListener(evt, searchBillingUnifiedItin);
    });
    searchInput.dataset.listenerAdded = 'true';
  }
}

function toggleItinNewBillForm(show) {
  const form = document.getElementById('itinNewBillingForm');
  form.style.display = show ? 'block' : 'none';
  if (show) {
    document.getElementById('itinBillingResults').style.display = 'none';
    // Clear form
    document.getElementById('itinBillDisplay').value = '';
    document.getElementById('itinBillCompany').value = '';
    document.getElementById('itinBillGst').value = '';
    document.getElementById('itinBillEmail').value = '';
    document.getElementById('itinBillPhone').value = '';
    document.getElementById('itinBillAddress').value = '';
  }
}

function handleItinBillTypeChange() {
  const type = document.getElementById('itinBillType').value;
  document.getElementById('itinCorpFields').style.display = type === 'corporate' ? 'block' : 'none';
}

function searchBillingUnifiedItin() {
  const q = document.getElementById('itinBillingSearch').value.toLowerCase().trim();
  const resultsDiv = document.getElementById('itinBillingResults');

  if (q.length === 0) {
    // Show top 10 recent/all accounts if empty
    // but the user specifically mentioned supplier. Let's keep billing consistent.
  }

  unifiedBillingResults = [];

  dbBillingAccounts.forEach(acc => {
    const displayName = (acc.display_name || '').toLowerCase();
    const companyName = (acc.company_name || '').toLowerCase();
    const gst = (acc.gst_number || '').toLowerCase();
    const emailRaw = acc.email || '';
    const phoneRaw = acc.phone || '';
    const email = emailRaw.toLowerCase();
    const phone = phoneRaw.toLowerCase();
    if (!q || displayName.includes(q) || companyName.includes(q) || gst.includes(q) || email.includes(q) || phone.includes(q)) {
      const contactParts = [];
      if (emailRaw) contactParts.push(emailRaw);
      if (phoneRaw) contactParts.push(phoneRaw);
      const contact = contactParts.join(' • ');
      unifiedBillingResults.push({
        type: 'billing',
        id: acc.id,
        display: acc.display_name || 'Unnamed Account',
        sub: acc.company_name ? 'B2B Customer' : 'B2C Customer',
        contact: contact,
        raw: acc
      });
    }
  });

  const allCustomersList = [
    ...dbPassengers.map(p => ({ ...p, customer_type: 'passenger' })),
    ...dbCorporates.map(c => ({ ...c, customer_type: 'corporate' }))
  ];

  allCustomersList.forEach(c => {
    const name = (c.first_name ? c.first_name + ' ' + (c.last_name || '') : (c.contact_person_name || '')).toLowerCase();
    const company = (c.company_name || '').toLowerCase();
    const emailRaw = c.email || c.contact_email || '';
    const phoneRaw = c.phone || c.contact_phone || '';
    const email = emailRaw.toLowerCase();
    const phone = phoneRaw.toLowerCase();
    if (!q || name.includes(q) || company.includes(q) || email.includes(q) || phone.includes(q)) {
      const contactParts = [];
      if (emailRaw) contactParts.push(emailRaw);
      if (phoneRaw) contactParts.push(phoneRaw);
      const contact = contactParts.join(' • ');
      unifiedBillingResults.push({
        type: c.customer_type,
        id: c.id,
        display: c.customer_type === 'corporate'
          ? ((c.company_name || '') + (name ? ' (' + (c.first_name ? c.first_name + ' ' + (c.last_name || '') : c.contact_person_name || '') + ')' : ''))
          : (c.first_name + ' ' + (c.last_name || '')),
        sub: c.customer_type === 'corporate' ? (c.company_name ? 'B2B Customer' : 'B2C Customer') : 'B2C Customer',
        contact: contact,
        raw: c
      });
    }
  });

  let html = unifiedBillingResults.slice(0, 10).map((r, idx) => {
    const isB2B = r.sub.includes('B2B');
    const dotColor = isB2B ? '#4caf50' : '#2196f3';
    return `
    <div class="dropdown-item" onclick="selectUnifiedBillingByIndex(${idx})">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <div style="font-weight:600;">${r.display}</div>
        <div style="font-size:0.75rem; color:var(--text-secondary); display:flex; align-items:center; gap:5px;">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${dotColor};"></span>
          ${r.sub}
        </div>
      </div>
      ${r.contact ? `<div style="font-size:0.75rem; color:var(--text-secondary); margin-top:2px;">${r.contact}</div>` : ''}
    </div>
  `;
  }).join('');

  html += `
    <div class="dropdown-item" style="background:rgba(37,99,235,0.05); color:var(--primary); font-weight:600;" onclick="prepareNewBillingItin('${q}')">
      + Create New Account: "${q}"
    </div>
  `;

  resultsDiv.innerHTML = html;
  resultsDiv.style.display = 'block';
}

async function selectUnifiedBillingByIndex(idx) {
  const res = unifiedBillingResults[idx];
  if (!res) return;

  if (res.type === 'billing') {
    await selectBillingAccountFromSearch(res.id);
    return;
  }

  const raw = res.raw;
  const email = raw.email || raw.contact_email || '';
  const phone = raw.phone || raw.contact_phone || '';
  const gst = raw.gst_number || raw.gst || '';
  const company = raw.company_name || '';

  const payload = {
    billing_account_id: null,
    bill_to_name: res.display,
    bill_to_email: email,
    bill_to_phone: phone,
    bill_to_company: company,
    bill_to_gst: gst,
    billing_type: res.type
  };

  await updateItineraryBilling(payload);
  closeModal();
}

async function selectBillingAccountFromSearch(accId) {
  const acc = dbBillingAccounts.find(a => a.id === accId);
  if (!acc) return;

  const data = {
    billing_account_id: accId,
    bill_to_name: acc.display_name,
    bill_to_company: acc.company_name || '',
    bill_to_email: acc.email || '',
    bill_to_phone: acc.phone || '',
    bill_to_address: acc.address || '',
    bill_to_gst: acc.gst_number || ''
  };

  await updateItineraryBilling(data);
  closeModal();
}

function prepareNewBillingItin(input) {
  toggleItinNewBillForm(true);
  document.getElementById('itinBillDisplay').value = input;
  // Simple heuristic for type
  if (input.toLowerCase().includes('co') || input.toLowerCase().includes('inc') || input.toLowerCase().includes('ltd')) {
    document.getElementById('itinBillType').value = 'corporate';
  } else {
    document.getElementById('itinBillType').value = 'individual';
  }
  handleItinBillTypeChange();
}

async function addNewBillingItin() {
  const display = document.getElementById('itinBillDisplay').value.trim();
  if (!display) { showToast('Display Name is required', 'error'); return; }

  const type = document.getElementById('itinBillType').value;
  const payload = {
    account_type: type,
    display_name: display,
    company_name: document.getElementById('itinBillCompany').value.trim(),
    email: document.getElementById('itinBillEmail').value.trim(),
    phone: document.getElementById('itinBillPhone').value.trim(),
    gst_number: document.getElementById('itinBillGst').value.trim(),
    address: document.getElementById('itinBillAddress').value.trim()
  };

  const shouldSave = document.getElementById('itinBillSaveDB').checked;
  let finalBillingData = {
    bill_to_name: payload.display_name,
    bill_to_company: payload.company_name,
    bill_to_email: payload.email,
    bill_to_phone: payload.phone,
    bill_to_address: payload.address,
    bill_to_gst: payload.gst_number
  };

  if (shouldSave) {
    try {
      const resp = await fetch('/api/v2/billing-accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (resp.ok) {
        const d = await resp.json();
        finalBillingData.billing_account_id = d.billing_account.id;
        await loadDBBillingAccounts(); // Refresh cache
      }
    } catch (e) { console.error('Error saving billing to DB:', e); }
  }

  await updateItineraryBilling(finalBillingData);
  closeModal();
}

async function updateItineraryBilling(data) {
  try {
    const r = await fetch('/api/v2/itineraries/' + currentItinerary.id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (r.ok) {
      const d = await r.json();
      currentItinerary = d.itinerary;
      renderBilling();
      renderSupplier();
      renderInfoCards();
      renderOutputBoxes();
      showToast('Billing updated', 'success');
    } else {
      showToast('Failed to update billing', 'error');
    }
  } catch (e) {
    showToast('Error', 'error');
  }
}


// ==================== SUPPLIER ====================
function renderSupplier() {
  const it = currentItinerary;
  if (!it) return;

  const hasSupplierData = !!(it.supplier_account || it.supplier_name || it.supplier_company || it.supplier_email || it.supplier_phone || it.supplier_address || it.supplier_gst);
  if (!hasSupplierData) {
    document.getElementById('supplierContainer').innerHTML = '<div style="padding:0.75rem 0.25rem;color:var(--text-secondary);font-size:0.9rem;line-height:1.4;">Not added yet.</div>';
    return;
  }

  let accountInfo = '';
  if (it.supplier_account) {
    accountInfo = `
    <div style="grid-column: 1 / -1; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px dashed var(--border);">
      <div style="font-weight:600; color:var(--primary); font-size:1.05rem;">
        Supplier Account: ${it.supplier_account.display_name}
      </div>
    </div>`;
  }

  const nameLabel = (it.supplier_account && it.supplier_account.account_type === 'corporate') || (!it.supplier_account && (it.supplier_company || it.supplier_gst)) ? 'Contact Name' : 'Name';

  document.getElementById('supplierContainer').innerHTML = `<div class="billing-grid">
    ${accountInfo}
    <div class="billing-item"><div class="label">${nameLabel}</div><div class="value">${it.supplier_name || '-'}</div></div>
    ${it.supplier_company ? `<div class="billing-item"><div class="label">Company</div><div class="value">${it.supplier_company || '-'}</div></div>` : ''}
    <div class="billing-item"><div class="label">Email</div><div class="value">${it.supplier_email || '-'}</div></div>
    <div class="billing-item"><div class="label">Phone</div><div class="value">${it.supplier_phone || '-'}</div></div>
    <div class="billing-item"><div class="label">Address</div><div class="value">${it.supplier_address || '-'}</div></div>
    ${it.supplier_gst ? `<div class="billing-item"><div class="label">GST</div><div class="value">${it.supplier_gst || '-'}</div></div>` : ''}
  </div>`;
}

function openUnifiedSupplierModal() {
  const searchInput = document.getElementById('itinSupplierSearch');
  searchInput.value = '';
  document.getElementById('itinSupplierResults').style.display = 'none';
  toggleItinNewSupForm(false);
  showModal('unifiedSupplierModal');

  if (!searchInput.dataset.listenerAdded) {
    ['click', 'focus'].forEach(evt => {
      searchInput.addEventListener(evt, searchSupplierUnifiedItin);
    });
    searchInput.dataset.listenerAdded = 'true';
  }
}

function toggleItinNewSupForm(show) {
  const form = document.getElementById('itinNewSupplierForm');
  form.style.display = show ? 'block' : 'none';
  if (show) {
    document.getElementById('itinSupplierResults').style.display = 'none';
    document.getElementById('itinSupDisplay').value = '';
    document.getElementById('itinSupCompany').value = '';
    document.getElementById('itinSupGst').value = '';
    document.getElementById('itinSupEmail').value = '';
    document.getElementById('itinSupPhone').value = '';
    document.getElementById('itinSupAddress').value = '';
  }
}

function handleItinSupTypeChange() {
  const type = document.getElementById('itinSupType').value;
  document.getElementById('itinSupCorpFields').style.display = type === 'corporate' ? 'block' : 'none';
}

function searchSupplierUnifiedItin() {
  const q = document.getElementById('itinSupplierSearch').value.toLowerCase().trim();
  const resultsDiv = document.getElementById('itinSupplierResults');
  // Results will show even if q is empty
  /*
  if (q.length === 0) { resultsDiv.style.display = 'none'; return; }
  */

  unifiedSupplierResults = [];
  dbSupplierAccounts.forEach(acc => {
    const displayName = (acc.display_name || '').toLowerCase();
    const companyName = (acc.company_name || '').toLowerCase();
    const gst = (acc.gst_number || '').toLowerCase();
    const emailRaw = acc.email || '';
    const phoneRaw = acc.phone || '';
    const email = emailRaw.toLowerCase();
    const phone = phoneRaw.toLowerCase();
    if (!q || displayName.includes(q) || companyName.includes(q) || gst.includes(q) || email.includes(q) || phone.includes(q)) {
      const contactParts = [];
      if (emailRaw) contactParts.push(emailRaw);
      if (phoneRaw) contactParts.push(phoneRaw);
      unifiedSupplierResults.push({ id: acc.id, display: acc.display_name || 'Unnamed Account', sub: acc.account_type === 'corporate' ? 'Corporate' : 'Individual', contact: contactParts.join(' • '), raw: acc });
    }
  });

  let html = unifiedSupplierResults.slice(0, 10).map((r, idx) => {
    const isB2B = r.sub.includes('Corporate');
    const dotColor = isB2B ? '#4caf50' : '#2196f3';
    return `
    <div class="dropdown-item" onclick="selectUnifiedSupplierByIndex(${idx})">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <div style="font-weight:600;">${r.display}</div>
        <div style="font-size:0.75rem; color:var(--text-secondary); display:flex; align-items:center; gap:5px;">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${dotColor};"></span>${r.sub}
        </div>
      </div>
      ${r.contact ? `<div style="font-size:0.75rem; color:var(--text-secondary); margin-top:2px;">${r.contact}</div>` : ''}
    </div>`;
  }).join('');

  html += `
    <div class="dropdown-item" style="background:rgba(37,99,235,0.05); color:var(--primary); font-weight:600;" onclick="prepareNewSupplierItin('${q}')">
      + Create New Supplier Account: "${q}"
    </div>`;

  resultsDiv.innerHTML = html;
  resultsDiv.style.display = 'block';
}

async function selectUnifiedSupplierByIndex(idx) {
  const res = unifiedSupplierResults[idx];
  if (!res) return;
  const raw = res.raw;
  const data = {
    supplier_account_id: raw.id,
    supplier_name: raw.contact_name || raw.display_name,
    supplier_company: raw.company_name || '',
    supplier_email: raw.email || '',
    supplier_phone: raw.phone || '',
    supplier_address: raw.address || '',
    supplier_gst: raw.gst_number || ''
  };
  await updateItinerarySupplier(data);
  closeModal();
}

function prepareNewSupplierItin(input) {
  toggleItinNewSupForm(true);
  document.getElementById('itinSupDisplay').value = input;
  document.getElementById('itinSupType').value = 'corporate';
  handleItinSupTypeChange();
}

async function addNewSupplierItin() {
  const display = document.getElementById('itinSupDisplay').value.trim();
  if (!display) { showToast('Display Name is required', 'error'); return; }

  const payload = {
    account_type: document.getElementById('itinSupType').value,
    display_name: display,
    company_name: document.getElementById('itinSupCompany').value.trim(),
    email: document.getElementById('itinSupEmail').value.trim(),
    phone: document.getElementById('itinSupPhone').value.trim(),
    gst_number: document.getElementById('itinSupGst').value.trim(),
    address: document.getElementById('itinSupAddress').value.trim()
  };

  const shouldSave = document.getElementById('itinSupSaveDB').checked;
  let finalData = {
    supplier_name: payload.display_name,
    supplier_company: payload.company_name,
    supplier_email: payload.email,
    supplier_phone: payload.phone,
    supplier_address: payload.address,
    supplier_gst: payload.gst_number
  };

  if (shouldSave) {
    try {
      const resp = await fetch('/api/v2/supplier-accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (resp.ok) {
        const d = await resp.json();
        finalData.supplier_account_id = d.supplier_account.id;
        await loadDBSuppliers();
      }
    } catch (e) { console.error('Error saving supplier to DB:', e); }
  }

  await updateItinerarySupplier(finalData);
  closeModal();
}

async function updateItinerarySupplier(data) {
  try {
    const r = await fetch('/api/v2/itineraries/' + currentItinerary.id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (r.ok) {
      const d = await r.json();
      currentItinerary = d.itinerary;
      renderSupplier();
      renderInfoCards(); // maybe not needed but safe
      renderOutputBoxes();
      showToast('Supplier updated', 'success');
    } else {
      showToast('Failed to update supplier', 'error');
    }
  } catch (e) { showToast('Error', 'error'); }
}

// ---- Billing ----
// Obsolete billing functions removed as they are replaced by unified versions.

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', async () => {
  initializeSidebar();
  await checkAuth();
  await Promise.all([loadItineraries(), loadDBPassengers(), loadDBBillingAccounts(), loadDBSuppliers(), loadDBCorporates(), loadAirlines()]);
});

// ==================== IMAGE SHARING ====================
async function shareItineraryImage() {
  if (typeof html2canvas === 'undefined') {
    // Dynamically load html2canvas if missing
    await loadHtml2Canvas();
  }

  const element = document.getElementById('detailView');
  const originalDisplay = element.style.display;
  element.style.display = 'block'; // Ensure visible

  // Temporarily hide actions for cleaner image
  const actions = document.getElementById('detailActions');
  const backBtn = document.querySelector('#detailView .btn-action.secondary');
  const oldActionsDisplay = actions.style.display;
  const oldBackDisplay = backBtn ? backBtn.style.display : 'block';
  actions.style.display = 'none';
  if (backBtn) backBtn.style.display = 'none';

  try {
    showToast('Generating image...', 'info');

    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: document.documentElement.getAttribute('data-theme') === 'dark' ? '#0f172a' : '#f8fafc',
      windowWidth: 1200 // Force desktop width for better layout
    });

    canvas.toBlob(async (blob) => {
      if (!blob) { showToast('Failed to generate blob', 'error'); return; }

      let fileName = 'Flight_Itinerary.png';
      if (currentItinerary && currentItinerary.flights && currentItinerary.flights.length > 0) {
        const flights = currentItinerary.flights;
        const firstFlight = flights[0];
        const dep = firstFlight.departure_airport || 'DEP';

        let typeStr = 'ONE WAY';
        let routeStr = `${dep} - ${firstFlight.arrival_airport || 'ARR'}`;

        if (currentItinerary.trip_type === 'round_trip') {
          typeStr = 'ROUND TRIP';
          routeStr = `${dep} - ${firstFlight.arrival_airport || 'ARR'}`;
        } else if (currentItinerary.trip_type === 'multi_city') {
          typeStr = 'MULTI CITY';
          const dests = [dep];
          flights.forEach(f => {
            if (f.arrival_airport && f.arrival_airport !== dests[dests.length - 1]) {
              dests.push(f.arrival_airport);
            }
          });
          routeStr = dests.join(' - ');
        }

        const dateStr = (firstFlight.departure_date || '').replace(/[\/\\]/g, '-').trim() || 'DATE';
        fileName = `${routeStr} (${typeStr}) ${dateStr}.png`.replace(/[<>:"/\\|?*]/g, '_');

        if (fileName.length > 150) {
          fileName = `${dep} (${typeStr}) ${dateStr}.png`;
        }
      }
      const file = new File([blob], fileName, { type: 'image/png' });

      // Try Web Share API Level 2 (File Sharing)
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: 'Flight Itinerary',
            text: `Itinerary for ${currentItinerary.reference_number || 'Trip'}`
          });
          showToast('Shared successfully', 'success');
        } catch (err) {
          if (err.name !== 'AbortError') {
            console.error(err);
            downloadImageFromCanvas(canvas, fileName);
          }
        }
      } else {
        downloadImageFromCanvas(canvas, fileName);
      }
    }, 'image/png');
  } catch (err) {
    console.error(err);
    showToast('Failed to generate image', 'error');
  } finally {
    // Restore UI
    actions.style.display = oldActionsDisplay;
    if (backBtn) backBtn.style.display = oldBackDisplay;
  }
}

function downloadImageFromCanvas(canvas, fileName) {
  const link = document.createElement('a');
  link.download = fileName;
  link.href = canvas.toDataURL('image/png');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Image downloaded', 'success');
}

function loadHtml2Canvas() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://html2canvas.hertzen.com/dist/html2canvas.min.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// ==================== PASSPORT OCR ====================
async function scanPaxDetailPassport() {
  const input = document.getElementById('paxDetailPassportUpload');
  const status = document.getElementById('paxDetailScanStatus');
  // btn removed

  if (!input.files || input.files.length === 0) {
    if (status) status.innerHTML = '<span style="color:var(--danger)">Please select a file first</span>';
    return;
  }

  // Preview Logic
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = function (e) {
    const t = document.getElementById('paxDetailPassportPreviewThumbnail');
    const c = document.getElementById('paxDetailPassportPreviewContainer');
    if (t && c) { t.src = e.target.result; c.style.display = 'flex'; }
  };
  reader.readAsDataURL(file);

  if (status) status.innerHTML = '<span style="color:var(--primary)">Scanning... Please wait ⏳</span>';

  const formData = new FormData();
  formData.append('passport', file);

  try {
    const response = await fetch('/extract-passport?debug=1', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    console.log('OCR Response:', data);

    if (!response.ok) {
      throw new Error(data.error || 'Scan failed');
    }

    // Fill fields
    if (data.surname) {
      document.getElementById('editPaxLastName').value = data.surname;
    }

    if (data.first_name) {
      document.getElementById('editPaxFirstName').value = data.first_name;
      if (data.middle_name) {
        document.getElementById('editPaxMiddleName').value = data.middle_name;
      }
    } else if (data.given_names) {
      const parts = data.given_names.split(' ');
      document.getElementById('editPaxFirstName').value = parts[0];
      if (parts.length > 1) {
        document.getElementById('editPaxMiddleName').value = parts.slice(1).join(' ');
      }
    }

    if (data.date_of_birth) document.getElementById('editPaxDOB').value = data.date_of_birth;

    if (data.sex) {
      const genderSelect = document.getElementById('editPaxGender');
      const titleSelect = document.getElementById('editPaxTitle');

      if (data.sex === 'M' || data.sex === 'm') {
        genderSelect.value = 'Male';
        if (titleSelect) titleSelect.value = 'Mr';
      } else if (data.sex === 'F' || data.sex === 'f') {
        genderSelect.value = 'Female';
        if (titleSelect) titleSelect.value = 'Mrs';
      } else {
        genderSelect.value = 'Other';
      }
    }

    if (data.nationality) {
      document.getElementById('editPaxNationality').value = data.nationality;
    }

    if (data.passport_number) {
      document.getElementById('editPaxPassportNumber').value = data.passport_number;
    }

    if (data.expiration_date) {
      document.getElementById('editPaxExpiryDate').value = data.expiration_date;
    }

    if (data.date_of_issue) {
      document.getElementById('editPaxIssueDate').value = data.date_of_issue;
    }

    if (status) status.innerHTML = '<span style="color:var(--success)">✅ Scanned successfully! Please review details.</span>';

  } catch (e) {
    if (status) status.innerHTML = `<span style="color:var(--danger)">❌ Error: ${e.message}</span>`;
  }
}

function togglePassportSideView(src) {
  if (!src && document.getElementById('paxDetailPassportPreviewThumbnail')) {
    src = document.getElementById('paxDetailPassportPreviewThumbnail').src;
  }
  const viewer = document.getElementById('passportSideViewer');
  const img = document.getElementById('passportSideImage');
  const pdf = document.getElementById('passportSidePdf');

  if (!viewer) return;

  if (!viewer.classList.contains('active')) {
    if (src) {
      const isPdf = src.startsWith('data:application/pdf') || src.toLowerCase().endsWith('.pdf');

      if (isPdf) {
        if (img) img.style.display = 'none';
        if (pdf) {
          pdf.src = src;
          pdf.style.display = 'block';
        }
      } else {
        if (pdf) {
          pdf.style.display = 'none';
          pdf.src = '';
        }
        if (img) {
          img.src = src;
          img.style.display = 'block';
        }
      }

      viewer.classList.add('active');
    }
  } else {
    viewer.classList.remove('active');
    // Clear sources on close
    if (img) img.src = '';
    if (pdf) pdf.src = '';
  }
}
