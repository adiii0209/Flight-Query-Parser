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
  review:     'In Review',
  notstarted: 'Not Started',
  notrequired: 'Not Required',
};

const ACTIVITY_LOG = [];
const OWNERSHIP_TRIPS_STORAGE_KEY = 'ownership_trips_cache_v1';

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
let filterPriority = '';
let filterMonth = '';
let currentPage = 1;
const PAGE_SIZE = 99999;
let expandedRows = new Set();
let selectedTrips = new Set();
let subtaskContext = null; // { tripId, statusKey }
let pendingNewSubtaskReminder = null;
let editingTripId = null;
let calMonth = new Date().getMonth();
let calYear = new Date().getFullYear();
let newTplTasks = [];
let isDark = false;

// ═══════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Request failed: ${response.status}`);
  }
  return response.json();
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

async function saveTripPatch(trip, patch) {
  if (!trip || !trip.id) return null;
  const { trip: saved } = await apiJson(`/api/ownership/trips/${trip.id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (saved) {
    const idx = trips.findIndex(t => t.id === saved.id);
    if (idx !== -1) trips[idx] = saved;
    cacheTripsForFastPaint(trips);
  }
  return saved;
}

function refreshOwnershipViews() {
  cacheTripsForFastPaint(trips);
  renderTable();
  renderActivityFeed();
  renderCalendar();
  renderUpcomingTrips();
  populateOwnerFilter();
  populateMonthFilter();
}

function saveTemplates(template = null) {
  if (!template) return;
  apiJson('/api/ownership/templates', {
    method: 'POST',
    body: JSON.stringify(template),
  }).then(({ template: saved }) => {
    if (saved) {
      const idx = taskTemplates.findIndex(t => t.id === template.id);
      if (idx !== -1) taskTemplates[idx] = saved;
      else taskTemplates.push(saved);
      renderSavedTemplates();
    }
  }).catch(err => {
    console.error('Template save failed', err);
    toast('Could not save template', '⚠️');
  });
}

function uid() {
  return 'id' + Math.random().toString(36).slice(2, 9);
}

function guestColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return GUEST_COLORS[Math.abs(hash) % GUEST_COLORS.length];
}

function statusBadge(status, field) {
  const label = STATUS_LABELS[status] || 'Not Started';
  const cls = status || 'notstarted';
  return `<span class="crm-badge ${cls}" data-tooltip="${label}" data-field="${field}" onclick="openBadgeMenu(this, event)">${label}</span>`;
}

function employeeColor(name) {
  const employee = employees.find(e => e.name === name);
  if (employee?.color) return employee.color;
  return guestColor(name || 'Employee');
}

function employeeNames() {
  return [...new Set([...employees.map(e => e.name).filter(Boolean), ...trips.map(t => t.owner).filter(Boolean)])].sort();
}

function ownerOptions(selectedOwner = '') {
  const owners = employeeNames();
  return owners.map(owner => `<option value="${escHtml(owner)}" ${owner===selectedOwner?'selected':''}>${escHtml(owner)}</option>`).join('');
}

function calcProgress(trip) {
  const fields = [
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
  let score = 0;
  let maxScore = 0;
  for (const f of fields) {
    const s = trip[f];
    maxScore += 2;
    if (s === 'complete' || s === 'notrequired') score += 2;
    else if (s === 'ongoing' || s === 'review') score += 1;
  }
  return Math.round((score / maxScore) * 100);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
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
  if (!tbody) return;
  tbody.innerHTML = Array.from({ length: 8 }).map(() => `
    <tr class="crm-skeleton-row">
      ${Array.from({ length: 18 }).map(() => '<td><div class="crm-skeleton-pill"></div></td>').join('')}
    </tr>
  `).join('');
  document.getElementById('tableFooterInfo').textContent = 'Loading ownership data...';
}

function refreshOwnerControls() {
  populateOwnerFilter();
  populateAssigneeSelect();
  const ownerSelect = document.getElementById('tf-owner');
  if (ownerSelect) ownerSelect.innerHTML = ownerOptions(ownerSelect.value);
}

// ═══════════════════════════════════════════════════════════
// FILTER + SORT + PAGINATE
// ═══════════════════════════════════════════════════════════

function getFiltered() {
  let data = [...trips];
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    data = data.filter(t =>
      t.guestName.toLowerCase().includes(q) ||
      t.destination.toLowerCase().includes(q) ||
      (t.currentTask || '').toLowerCase().includes(q) ||
      (t.owner || '').toLowerCase().includes(q)
    );
  }
  if (filterStatus) {
    const fields = ['proposalStatus','flightsStatus','visaStatus','hotelsStatus','sightseeingStatus','insuranceStatus','travelingStatus'];
    data = data.filter(t => fields.some(f => t[f] === filterStatus));
  }
  if (filterOwner) data = data.filter(t => t.owner === filterOwner);
  if (filterPriority) data = data.filter(t => t.priority === filterPriority);
  if (filterMonth) {
    data = data.filter(t => {
      if (!t.startDate) return false;
      const d = new Date(t.startDate + 'T00:00:00');
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` === filterMonth;
    });
  }

  data.sort((a, b) => {
    let av = a[sortCol] ?? '', bv = b[sortCol] ?? '';
    if (sortCol === 'startDate') { av = av || '9999'; bv = bv || '9999'; }
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
  document.getElementById('kpiFlights').textContent = trips.filter(t => t.flightsStatus === 'pending' || t.flightsStatus === 'notstarted').length;
  document.getElementById('kpiVisa').textContent = trips.filter(t => t.visaStatus === 'pending' || t.visaStatus === 'notstarted').length;
  document.getElementById('kpiHotels').textContent = trips.filter(t => t.hotelsStatus === 'pending' || t.hotelsStatus === 'notstarted').length;

  let tasksOpen = 0;
  for (const t of trips) {
    if (t.subtasks) {
      for (const subs of Object.values(t.subtasks)) {
        tasksOpen += subs.filter(s => !s.done).length;
      }
    }
    if (t.taskStatus !== 'complete') tasksOpen++;
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
  const filtered = getFiltered();
  const { page, total, pages } = paginate(filtered);

  const tbody = document.getElementById('crmTbody');
  tbody.innerHTML = '';

  if (page.length === 0) {
    tbody.innerHTML = `<tr><td colspan="18"><div class="crm-empty"><div class="crm-empty-icon">🔍</div><div class="crm-empty-title">No trips found</div><div class="crm-empty-sub">Try adjusting your filters or search query</div></div></td></tr>`;
  } else {
    for (const trip of page) {
      const prog = calcProgress(trip);
      const avatar = guestColor(trip.guestName);
      const initials = trip.guestName.split(' ').map(w => w[0]).slice(0,2).join('');
      const ownerColor = employeeColor(trip.owner);
      const ownerInitials = trip.owner.split(' ').map(w => w[0]).slice(0,2).join('');
      const dateClass = dateSoonClass(trip.startDate);
      const isExpanded = expandedRows.has(trip.id);

      const row = document.createElement('tr');
      row.dataset.id = trip.id;
      if (isExpanded) row.classList.add('row-expanded');

      row.innerHTML = `
        <td><input type="checkbox" class="crm-checkbox row-check" data-id="${trip.id}" ${selectedTrips.has(trip.id) ? 'checked' : ''}></td>
        <td>
          <button class="crm-expand-btn ${isExpanded ? 'expanded' : ''}" data-id="${trip.id}" title="Expand row">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </td>
        <td>
          <div class="crm-guest-cell">
            <div class="crm-guest-avatar" style="background:${avatar}">${initials}</div>
            <input class="crm-inline-edit crm-guest-name" style="background:transparent;width:140px;display:block;margin-left:-0.3rem;" value="${escHtml(trip.guestName)}" data-id="${trip.id}" data-field="guestName" title="Edit Guest Name">
          </div>
        </td>
        <td>
          <input type="number" class="crm-inline-edit crm-edit-flush no-spin" style="background:transparent;font-size:inherit;color:inherit;width:4ch;text-align:center;" value="${trip.pax || 1}" data-id="${trip.id}" data-field="pax" title="Edit Pax" min="1">
        </td>
        <td style="font-weight:500;white-space:nowrap;">
          <input class="crm-inline-edit" style="background:transparent;width:110px;font-weight:inherit;" value="${escHtml(trip.destination || '')}" data-id="${trip.id}" data-field="destination" title="Edit Country" placeholder="Country">
        </td>
        <td>
          <input type="date" class="crm-inline-edit crm-date-cell ${dateClass}" style="background:transparent;font-size:.75rem;width:110px;" value="${trip.startDate}" data-id="${trip.id}" data-field="startDate" title="Edit Start Date">
        </td>
        <td>${statusBadge(trip.proposalStatus, 'proposalStatus')}</td>
        <td><span class="crm-badge ${trip.flightsStatus||'notstarted'}" data-tooltip="Double-click for subtasks" data-field="flightsStatus" onclick="openBadgeMenu(this, event)" ondblclick="openSubtaskModal(event, '${trip.id}', 'flights')">${STATUS_LABELS[trip.flightsStatus]||'Not Started'}</span></td>
        <td><span class="crm-badge ${trip.visaStatus||'notstarted'}" data-tooltip="Double-click for subtasks" data-field="visaStatus" onclick="openBadgeMenu(this, event)" ondblclick="openSubtaskModal(event, '${trip.id}', 'visa')">${STATUS_LABELS[trip.visaStatus]||'Not Started'}</span></td>
        <td><span class="crm-badge ${trip.hotelsStatus||'notstarted'}" data-tooltip="Double-click for subtasks" data-field="hotelsStatus" onclick="openBadgeMenu(this, event)" ondblclick="openSubtaskModal(event, '${trip.id}', 'hotels')">${STATUS_LABELS[trip.hotelsStatus]||'Not Started'}</span></td>
        <td><span class="crm-badge ${trip.sectorTicketsStatus||'notstarted'}" data-tooltip="Double-click for subtasks" data-field="sectorTicketsStatus" onclick="openBadgeMenu(this, event)" ondblclick="openSubtaskModal(event, '${trip.id}', 'sectorTickets')">${STATUS_LABELS[trip.sectorTicketsStatus]||'Not Started'}</span></td>
        <td><span class="crm-badge ${trip.sightseeingStatus||'notstarted'}" data-tooltip="Double-click for subtasks" data-field="sightseeingStatus" onclick="openBadgeMenu(this, event)" ondblclick="openSubtaskModal(event, '${trip.id}', 'sightseeing')">${STATUS_LABELS[trip.sightseeingStatus]||'Not Started'}</span></td>
        <td><span class="crm-badge ${trip.insuranceStatus||'notstarted'}" data-tooltip="Double-click for subtasks" data-field="insuranceStatus" onclick="openBadgeMenu(this, event)" ondblclick="openSubtaskModal(event, '${trip.id}', 'insurance')">${STATUS_LABELS[trip.insuranceStatus]||'Not Started'}</span></td>
        <td><span class="crm-badge ${trip.travelingStatus||'notstarted'}" data-tooltip="Double-click for subtasks" data-field="travelingStatus" onclick="openBadgeMenu(this, event)" ondblclick="openSubtaskModal(event, '${trip.id}', 'travefy')">${STATUS_LABELS[trip.travelingStatus]||'Not Started'}</span></td>
        <td><span class="crm-badge ${trip.travefyTaskListStatus||'notstarted'}" data-tooltip="Double-click for subtasks" data-field="travefyTaskListStatus" onclick="openBadgeMenu(this, event)" ondblclick="openSubtaskModal(event, '${trip.id}', 'travefyTaskList')">${STATUS_LABELS[trip.travefyTaskListStatus]||'Not Started'}</span></td>
        <td><span class="crm-badge ${trip.tripFeedbackFormStatus||'notstarted'}" data-tooltip="Double-click for subtasks" data-field="tripFeedbackFormStatus" onclick="openBadgeMenu(this, event)" ondblclick="openSubtaskModal(event, '${trip.id}', 'tripFeedbackForm')">${STATUS_LABELS[trip.tripFeedbackFormStatus]||'Not Started'}</span></td>
        <td>
          <div class="crm-owner-cell">
            <div class="crm-owner-avatar" style="background:${ownerColor}" data-tooltip="${escHtml(trip.owner)}">${ownerInitials}</div>
            <select class="crm-inline-edit crm-owner-name" style="background:transparent;font-size:inherit;width:80px;cursor:pointer;" data-id="${trip.id}" data-field="owner" title="Edit Owner">
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
      tbody.appendChild(row);

      // Expanded row
      if (isExpanded) {
        const expRow = document.createElement('tr');
        expRow.className = 'crm-expanded-row';
        expRow.dataset.expandFor = trip.id;
        expRow.innerHTML = `<td colspan="18">${renderExpandedContent(trip)}</td>`;
        tbody.appendChild(expRow);
      }
    }
  }

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
  updateKPIs();
}

function renderExpandedContent(trip) {
  const subKeys = { visa: 'Visa', flights: 'Flights', hotels: 'Hotels', sectorTickets: 'Sector Tickets', sightseeing: 'Sightseeing', insurance: 'Insurance', travefy: 'Travefy', travefyTaskList: 'Travefy Task List', tripFeedbackForm: 'Trip Feedback Form' };
  let subtaskHtml = '';
  for (const [key, label] of Object.entries(subKeys)) {
    const subs = (trip.subtasks || {})[key] || [];
    const done = subs.filter(s => s.done).length;
    subtaskHtml += `<div class="crm-exp-row"><span class="crm-exp-key">${label}</span><span class="crm-exp-val ${subs.length ? '' : 'style="color:var(--crm-text-3)"'}">${subs.length ? `${done}/${subs.length}` : '—'} <button onclick="openSubtaskModal(event,'${trip.id}','${key}')" style="background:none;border:none;cursor:pointer;font-size:.65rem;color:var(--crm-primary);font-weight:600;padding:0 .25rem;">Edit</button></span></div>`;
  }

  const remindersHtml = (trip.reminders || []).map(r => `<span class="crm-reminder-tag">⏰ ${r.label}</span>`).join(' ') || '<span style="color:var(--crm-text-3);font-size:.75rem;">No reminders</span>';

  return `
    <div class="crm-expanded-content">
      <div class="crm-exp-section">
        <div class="crm-exp-title">Trip Details</div>
        <div class="crm-exp-row"><span class="crm-exp-key">Destination</span><span class="crm-exp-val">${escHtml(trip.destination||'—')}</span></div>
        <div class="crm-exp-row"><span class="crm-exp-key">Start Date</span><span class="crm-exp-val">${formatDate(trip.startDate)}</span></div>
        <div class="crm-exp-row"><span class="crm-exp-key">End Date</span><span class="crm-exp-val">${formatDate(trip.endDate)}</span></div>
        <div class="crm-exp-row"><span class="crm-exp-key">Pax</span><span class="crm-exp-val">${trip.pax || 1}</span></div>
        <div class="crm-exp-row"><span class="crm-exp-key">Owner</span><span class="crm-exp-val">${escHtml(trip.owner)}</span></div>
        <div style="margin-top:.5rem;display:flex;gap:.4rem;flex-wrap:wrap;">
          <button class="crm-btn crm-btn-danger" onclick="deleteTrip('${trip.id}')" style="font-size:.72rem;padding:.3rem .7rem;">🗑️ Delete</button>
        </div>
      </div>
      <div class="crm-exp-section">
        <div class="crm-exp-title">Subtask Summary</div>
        ${subtaskHtml}
      </div>
      <div class="crm-exp-section">
        <div class="crm-exp-title">Reminders & Notes</div>
        <div style="margin-bottom:.5rem;">${remindersHtml}</div>
        <div style="font-size:.75rem;color:var(--crm-text-2);line-height:1.5;">${escHtml(trip.latestUpdate || 'No notes yet.')}</div>
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
      if (expandedRows.has(id)) expandedRows.delete(id);
      else expandedRows.add(id);
      renderTable();
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
        saveTripPatch(trip, { [field]: val }).catch(err => {
          console.error('Ownership field save failed', err);
          toast('Could not save to database', '⚠️');
        });
        logActivity(`${trip.guestName} — ${field} updated`, '#6366f1');
        toast('Saved!');
        renderTable();
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
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${val==='complete'?'#10b981':val==='ongoing'?'#f59e0b':val==='pending'?'#ef4444':val==='review'?'#3b82f6':'#94a3b8'};display:inline-block;`;
    opt.appendChild(dot);
    opt.appendChild(document.createTextNode(label));
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const trip = trips.find(t => t.id === tripId);
      if (trip) {
        trip[field] = val;
        saveTripPatch(trip, { [field]: val }).catch(err => {
          console.error('Ownership status save failed', err);
          toast('Could not save status', '⚠️');
        });
        logActivity(`${trip.guestName} — ${field} → ${label}`, '#6366f1');
        renderTable();
        toast(`Status updated to ${label}`);
      }
      statusMenu.style.display = 'none';
    });
    statusMenu.appendChild(opt);
  }

  // Separator + double-click hint for status cells
  const isStatusCell = ['flightsStatus','visaStatus','hotelsStatus','sightseeingStatus','insuranceStatus','travelingStatus'].includes(field);
  if (isStatusCell) {
    const hr = document.createElement('hr');
    hr.style.cssText = 'border:none;border-top:1px solid var(--crm-border);margin:.3rem 0;';
    statusMenu.appendChild(hr);
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:.65rem;color:var(--crm-text-3);padding:.3rem .7rem;';
    hint.textContent = '⌨️ Double-click for subtasks';
    statusMenu.appendChild(hint);
  }

  const r = badge.getBoundingClientRect();
  statusMenu.style.display = 'flex';
  statusMenu.style.top = (r.bottom + 6) + 'px';
  statusMenu.style.left = r.left + 'px';
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

function reminderLabel(reminder) {
  const days = parseInt(reminder?.days, 10);
  return days > 0 ? `${days} days before` : '';
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
        <div class="crm-reminder-row">
          <span>Alert</span>
          <input type="number" id="subtaskReminderDays" min="1" max="180" value="7">
          <span>days before departure</span>
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
  document.getElementById('subtaskReminderDays').value = subtaskReminder(sub)?.days || 7;
  modal.classList.add('open');

  document.getElementById('cancelSubtaskReminder').onclick = () => modal.classList.remove('open');
  modal.onclick = e => { if (e.target === modal) modal.classList.remove('open'); };
  document.getElementById('clearSubtaskReminder').onclick = () => {
    sub.metadata = { ...(sub.metadata || {}) };
    delete sub.metadata.reminder;
    modal.classList.remove('open');
    renderSubtaskBody(trip.subtasks[subtaskContext.key]);
  };
  document.getElementById('saveSubtaskReminder').onclick = () => {
    const days = parseInt(document.getElementById('subtaskReminderDays').value, 10);
    if (isNaN(days) || days < 1) return;
    sub.metadata = { ...(sub.metadata || {}), reminder: { days, label: `${days} days before` } };
    modal.classList.remove('open');
    renderSubtaskBody(trip.subtasks[subtaskContext.key]);
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
        <div class="crm-reminder-row">
          <span>Alert</span>
          <input type="number" id="newSubtaskReminderDays" min="1" max="180" value="7">
          <span>days before departure</span>
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

  document.getElementById('newSubtaskReminderDays').value = pendingNewSubtaskReminder?.days || 7;
  modal.classList.add('open');
  modal.onclick = e => { if (e.target === modal) modal.classList.remove('open'); };
  document.getElementById('cancelNewSubtaskReminder').onclick = () => modal.classList.remove('open');
  document.getElementById('clearNewSubtaskReminder').onclick = () => {
    pendingNewSubtaskReminder = null;
    modal.classList.remove('open');
    document.getElementById('newSubtaskReminderBtn')?.classList.remove('active');
  };
  document.getElementById('saveNewSubtaskReminder').onclick = () => {
    const days = parseInt(document.getElementById('newSubtaskReminderDays').value, 10);
    if (isNaN(days) || days < 1) return;
    pendingNewSubtaskReminder = { days, label: `${days} days before` };
    modal.classList.remove('open');
    document.getElementById('newSubtaskReminderBtn')?.classList.add('active');
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
  renderSubtaskBody(trip.subtasks[key]);
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
      renderSubtaskBody(trip.subtasks[subtaskContext.key]);
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
  addBtn.className = 'crm-btn crm-btn-ghost';
  addBtn.style.cssText = 'padding:.3rem .65rem;font-size:.75rem;';
  addBtn.textContent = 'Add';
  addRow.appendChild(addBtn);
  body.appendChild(addRow);

  const doAdd = () => {
    const val = addInput.value.trim();
    if (!val) return;
    const trip = trips.find(t => t.id === subtaskContext.tripId);
    const assignee = addAssignee.value || '';
    const newSub = { id: uid(), text: val, done: false, assignee };
    if (pendingNewSubtaskReminder) {
      newSub.metadata = { reminder: pendingNewSubtaskReminder };
      pendingNewSubtaskReminder = null;
    }
    trip.subtasks[subtaskContext.key].push(newSub);
    renderSubtaskBody(trip.subtasks[subtaskContext.key]);
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
      <span style="font-size:.78rem;color:var(--crm-text-3);">days before departure</span>
      <button class="crm-btn crm-btn-ghost crm-icon-btn" id="addReminderBtn" title="Add reminder">${BELL_ICON}</button>
    </div>
    <div id="reminderTagsWrap" style="display:flex;gap:.4rem;flex-wrap:wrap;">
      ${(trip.reminders||[]).map(r => `<span class="crm-reminder-tag"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-right:2px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> ${escHtml(r.label)} <button onclick="removeReminder(${r.days})" style="background:none;border:none;cursor:pointer;font-size:.75rem;margin-left:.2rem;">✕</button></span>`).join('')}
    </div>
  `;
  body.appendChild(remDiv);

  document.getElementById('addReminderBtn').addEventListener('click', () => {
    const days = parseInt(document.getElementById('reminderDaysInput').value, 10);
    if (isNaN(days) || days < 1) return;
    const trip = trips.find(t => t.id === subtaskContext.tripId);
    if (!trip.reminders) trip.reminders = [];
    if (!trip.reminders.find(r => r.days === days)) {
      trip.reminders.push({ days, label: `${days} days before` });
      renderSubtaskBody(trip.subtasks[subtaskContext.key]);
    }
  });
}

window.removeReminder = function(days) {
  const trip = trips.find(t => t.id === subtaskContext.tripId);
  if (trip) trip.reminders = (trip.reminders||[]).filter(r => r.days !== days);
  renderSubtaskBody(trip.subtasks[subtaskContext.key]);
};

document.getElementById('btnSaveSubtasks').addEventListener('click', () => {
  const trip = trips.find(t => t.id === subtaskContext?.tripId);
  if (trip) {
    document.querySelectorAll('#subtaskModalBody .crm-subtask-item').forEach(item => {
      const id = item.querySelector('.crm-subtask-text')?.dataset.sid;
      const sub = (trip.subtasks?.[subtaskContext.key] || []).find(s => s.id === id);
      if (!sub) return;
      sub.text = item.querySelector('.crm-subtask-text')?.value.trim() || sub.text;
      sub.done = !!item.querySelector('.crm-subtask-check')?.checked;
      sub.assignee = item.querySelector('.crm-subtask-assignee')?.value || '';
      sub.metadata = sub.metadata || {};
    });
    refreshOwnershipViews();
    saveTripPatch(trip, { subtasks: trip.subtasks, reminders: trip.reminders || [] }).then(() => {
      toast('Subtasks saved!');
    }).catch(err => {
    console.error('Subtask save failed', err);
    toast('Could not save subtasks', '⚠️');
    });
  }
  closeModal('subtaskModal');
});

document.getElementById('btnApplyTemplate').addEventListener('click', () => {
  if (!taskTemplates.length) { toast('No templates saved yet!', '⚠️'); return; }
  // Show quick pick
  const trip = trips.find(t => t.id === subtaskContext.tripId);
  const key = subtaskContext.key;
  const names = taskTemplates.map(t => t.name);
  const chosen = prompt(`Apply template to ${key}:\n${names.map((n,i) => `${i+1}. ${n}`).join('\n')}\n\nEnter number:`);
  if (!chosen) return;
  const idx = parseInt(chosen, 10) - 1;
  if (isNaN(idx) || !taskTemplates[idx]) { toast('Invalid choice', '⚠️'); return; }
  const tpl = taskTemplates[idx];
  if (!trip.subtasks[key]) trip.subtasks[key] = [];
  for (const task of tpl.tasks) {
    trip.subtasks[key].push({ id: uid(), text: task, done: false, assignee: trip.owner });
  }
  // Add reminder
  if (tpl.reminderDays) {
    if (!trip.reminders) trip.reminders = [];
    if (!trip.reminders.find(r => r.days === tpl.reminderDays)) {
      trip.reminders.push({ days: tpl.reminderDays, label: `${tpl.reminderDays} days before` });
    }
  }
  renderSubtaskBody(trip.subtasks[key]);
  toast(`Template "${tpl.name}" applied!`);
});

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
  renderTplTasksList();
  renderSavedTemplates();
  document.getElementById('tplNameInput').value = '';
  document.getElementById('tplReminderDays').value = '7';
  openModal('templateModal');
});

document.getElementById('btnEmployees').addEventListener('click', () => {
  renderEmployees();
  document.getElementById('employeeNameInput').value = '';
  openModal('employeeModal');
});

function renderEmployees() {
  const el = document.getElementById('employeeList');
  if (!el) return;
  if (!employees.length) {
    el.innerHTML = '<div style="font-size:.78rem;color:var(--crm-text-3);">No employees yet. Add one above.</div>';
    return;
  }
  el.innerHTML = employees.map(employee => `
    <div class="crm-tpl-item">
      <div style="display:flex;align-items:center;gap:.5rem;">
        <span class="crm-owner-avatar" style="background:${employee.color || employeeColor(employee.name)}">${escHtml(employee.name).charAt(0).toUpperCase()}</span>
        <div class="crm-tpl-name">${escHtml(employee.name)}</div>
      </div>
      <button onclick="deleteEmployee('${employee.id}')" style="background:none;border:none;cursor:pointer;color:var(--crm-text-3);font-size:.85rem;" title="Remove">🗑</button>
    </div>
  `).join('');
}

document.getElementById('btnAddEmployee').addEventListener('click', async () => {
  const input = document.getElementById('employeeNameInput');
  const name = input.value.trim();
  if (!name) { toast('Enter an employee name', '⚠️'); return; }
  try {
    const { employee } = await apiJson('/api/ownership/employees', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    employees = [...employees.filter(e => e.id !== employee.id && e.name !== employee.name), employee].sort((a,b) => a.name.localeCompare(b.name));
    input.value = '';
    renderEmployees();
    refreshOwnerControls();
    renderTable();
    toast('Employee added');
  } catch (err) {
    console.error('Employee save failed', err);
    toast('Could not save employee', '⚠️');
  }
});

document.getElementById('employeeNameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btnAddEmployee').click();
});

window.deleteEmployee = async function(id) {
  const employee = employees.find(e => e.id === id);
  if (!employee || !confirm(`Remove ${employee.name}? Existing assigned work will keep the name.`)) return;
  employees = employees.filter(e => e.id !== id);
  renderEmployees();
  refreshOwnerControls();
  renderTable();
  try {
    await apiJson(`/api/ownership/employees/${id}`, { method: 'DELETE' });
    toast('Employee removed', '🗑');
  } catch (err) {
    console.error('Employee delete failed', err);
    toast('Could not remove employee', '⚠️');
  }
};

function renderTplTasksList() {
  const el = document.getElementById('tplTasksList');
  el.innerHTML = newTplTasks.map((t, i) => `
    <div style="display:flex;align-items:center;gap:.5rem;padding:.4rem .65rem;background:var(--crm-surface-2);border:1px solid var(--crm-border);border-radius:7px;">
      <span style="color:var(--crm-text-3);font-size:.75rem;">${i+1}.</span>
      <span style="flex:1;font-size:.82rem;">${escHtml(t)}</span>
      <button onclick="removeTplTask(${i})" style="background:none;border:none;cursor:pointer;color:var(--crm-text-3);font-size:.8rem;">✕</button>
    </div>
  `).join('');
}

window.removeTplTask = function(i) {
  newTplTasks.splice(i, 1);
  renderTplTasksList();
};

document.getElementById('btnAddTplTask').addEventListener('click', () => {
  const inp = document.getElementById('tplNewTask');
  const val = inp.value.trim();
  if (!val) return;
  newTplTasks.push(val);
  inp.value = '';
  renderTplTasksList();
});
document.getElementById('tplNewTask').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btnAddTplTask').click();
});

document.getElementById('btnSaveTemplate').addEventListener('click', () => {
  const name = document.getElementById('tplNameInput').value.trim();
  if (!name) { toast('Enter a template name', '⚠️'); return; }
  if (!newTplTasks.length) { toast('Add at least one task', '⚠️'); return; }
  const days = parseInt(document.getElementById('tplReminderDays').value, 10) || 0;
  const template = { id: uid(), name, tasks: [...newTplTasks], reminderDays: days };
  taskTemplates.push(template);
  saveTemplates(template);
  newTplTasks = [];
  document.getElementById('tplNameInput').value = '';
  renderTplTasksList();
  renderSavedTemplates();
  toast(`Template "${name}" saved!`);
});

function renderSavedTemplates() {
  const el = document.getElementById('savedTemplatesList');
  if (!taskTemplates.length) {
    el.innerHTML = '<div style="font-size:.78rem;color:var(--crm-text-3);padding:.5rem 0;">No templates yet. Create one above.</div>';
    return;
  }
  el.innerHTML = taskTemplates.map(tpl => `
    <div class="crm-tpl-item" id="tpl-${tpl.id}">
      <div>
        <div class="crm-tpl-name">${escHtml(tpl.name)}</div>
        <div class="crm-tpl-meta">${tpl.tasks.length} tasks · ⏰ ${tpl.reminderDays || 0}d reminder</div>
      </div>
      <div style="display:flex;gap:.4rem;">
        <button onclick="applyTemplateToAll('${tpl.id}')" class="crm-btn crm-btn-ghost" style="font-size:.7rem;padding:.25rem .6rem;">Apply to All</button>
        <button onclick="deleteTemplate('${tpl.id}')" style="background:none;border:none;cursor:pointer;color:var(--crm-text-3);font-size:.85rem;" title="Delete">🗑</button>
      </div>
    </div>
  `).join('');
}

window.deleteTemplate = function(id) {
  taskTemplates = taskTemplates.filter(t => t.id !== id);
  apiJson(`/api/ownership/templates/${id}`, { method: 'DELETE' }).catch(err => {
    console.error('Template delete failed', err);
    toast('Could not delete template', '⚠️');
  });
  renderSavedTemplates();
  toast('Template deleted', '🗑️');
};

window.applyTemplateToAll = function(tplId) {
  const tpl = taskTemplates.find(t => t.id === tplId);
  if (!tpl) return;
  const key = prompt(`Apply "${tpl.name}" to which category?\nOptions: visa, flights, hotels, sightseeing, insurance, travefy`);
  if (!key || !['visa','flights','hotels','sightseeing','insurance','travefy'].includes(key.toLowerCase())) {
    toast('Invalid category', '⚠️'); return;
  }
  let count = 0;
  for (const trip of trips) {
    if (!trip.subtasks) trip.subtasks = {};
    if (!trip.subtasks[key]) trip.subtasks[key] = [];
    for (const task of tpl.tasks) {
      trip.subtasks[key].push({ id: uid(), text: task, done: false, assignee: trip.owner });
    }
    if (tpl.reminderDays) {
      if (!trip.reminders) trip.reminders = [];
      if (!trip.reminders.find(r => r.days === tpl.reminderDays)) {
        trip.reminders.push({ days: tpl.reminderDays, label: `${tpl.reminderDays} days before` });
      }
    }
    count++;
  }
  save();
  renderTable();
  toast(`Applied to ${count} trips!`);
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
  setVal('tf-proposalStatus', trip.proposalStatus || 'notstarted');
  setVal('tf-flightsStatus', trip.flightsStatus || 'notstarted');
  setVal('tf-visaStatus', trip.visaStatus || 'notstarted');
  setVal('tf-hotelsStatus', trip.hotelsStatus || 'notstarted');
  setVal('tf-sectorTicketsStatus', trip.sectorTicketsStatus || 'notstarted');
  setVal('tf-sightseeingStatus', trip.sightseeingStatus || 'notstarted');
  setVal('tf-insuranceStatus', trip.insuranceStatus || 'notstarted');
  setVal('tf-travelingStatus', trip.travelingStatus || 'notstarted');
  setVal('tf-travefyTaskListStatus', trip.travefyTaskListStatus || 'notstarted');
  setVal('tf-tripFeedbackFormStatus', trip.tripFeedbackFormStatus || 'notstarted');
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
      trips[idx] = { ...trips[idx], ...data };
      saveTripPatch(trips[idx], data).catch(err => {
        console.error('Trip update failed', err);
        toast('Could not update trip', '⚠️');
      });
      logActivity(`${name} — trip updated`, '#3b82f6');
      toast('Trip updated!');
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
    refreshOwnershipViews();
    closeModal('tripModal');
    apiJson('/api/ownership/trips', {
      method: 'POST',
      body: JSON.stringify({ ...data, subtasks: optimisticTrip.subtasks, reminders: [] }),
    }).then(({ trip: newTrip }) => {
      const idx = trips.findIndex(t => t.id === tempId);
      if (idx !== -1 && newTrip) {
        trips[idx] = newTrip;
        refreshOwnershipViews();
      }
    }).catch(err => {
      console.error('Trip create failed', err);
      trips = trips.filter(t => t.id !== tempId);
      refreshOwnershipViews();
      toast('Could not create trip', '⚠️');
    });
    return;
  }
  refreshOwnershipViews();
  closeModal('tripModal');
});

window.deleteTrip = function(id) {
  if (!confirm('Delete this trip?')) return;
  const trip = trips.find(t => t.id === id);
  trips = trips.filter(t => t.id !== id);
  expandedRows.delete(id);
  apiJson(`/api/ownership/trips/${id}`, { method: 'DELETE' }).catch(err => {
    console.error('Trip delete failed', err);
    if (trip) {
      trips.unshift(trip);
      refreshOwnershipViews();
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
  renderTable();
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

document.getElementById('filterPriority').addEventListener('change', e => {
  filterPriority = e.target.value;
  currentPage = 1;
  renderTable();
});

document.getElementById('filterMonth').addEventListener('change', e => {
  filterMonth = e.target.value;
  currentPage = 1;
  renderTable();
});

document.getElementById('btnClearFilters').addEventListener('click', () => {
  searchQuery = ''; filterStatus = ''; filterOwner = ''; filterPriority = ''; filterMonth = '';
  document.getElementById('crmSearch').value = '';
  document.getElementById('filterStatus').value = '';
  document.getElementById('filterOwner').value = '';
  document.getElementById('filterPriority').value = '';
  document.getElementById('filterMonth').value = '';
  currentPage = 1;
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

// ═══════════════════════════════════════════════════════════
// DARK MODE
// ═══════════════════════════════════════════════════════════

function syncTheme() {
  const btn = document.getElementById('crmThemeToggle');
  if (isDark) {
    document.getElementById('crmPage').setAttribute('data-crm-theme', 'dark');
    btn.textContent = '☀️ Light';
  } else {
    document.getElementById('crmPage').setAttribute('data-crm-theme', 'light');
    btn.textContent = '🌙 Dark';
  }
  localStorage.setItem('crm_theme', isDark ? 'dark' : 'light');
}

document.getElementById('crmThemeToggle').addEventListener('click', () => {
  isDark = !isDark;
  syncTheme();
});

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
    el.title = tripDates.has(d) ? `Trip departure on ${months[calMonth]} ${d}` : '';
    grid.appendChild(el);
  }
}

document.getElementById('calPrev').addEventListener('click', () => {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderCalendar();
});
document.getElementById('calNext').addEventListener('click', () => {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
});

// ═══════════════════════════════════════════════════════════
// UPCOMING TRIPS PANEL
// ═══════════════════════════════════════════════════════════

function renderUpcomingTrips() {
  const el = document.getElementById('upcomingTrips');
  const now = new Date();
  const upcoming = trips
    .filter(t => t.startDate && new Date(t.startDate + 'T00:00:00') >= now)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 6);

  if (!upcoming.length) {
    el.innerHTML = '<div style="color:var(--crm-text-3);font-size:.78rem;">No upcoming trips</div>';
    return;
  }

  el.innerHTML = upcoming.map(t => {
    const col = guestColor(t.guestName);
    const initials = t.guestName.split(' ').map(w => w[0]).slice(0,2).join('');
    const diff = Math.ceil((new Date(t.startDate + 'T00:00:00') - now) / 86400000);
    const diffLabel = diff === 0 ? 'Today!' : diff === 1 ? 'Tomorrow' : `${diff}d away`;
    return `
      <div style="display:flex;align-items:center;gap:.55rem;padding:.5rem .6rem;background:var(--crm-surface-2);border:1px solid var(--crm-border);border-radius:8px;">
        <div style="width:24px;height:24px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;font-size:.6rem;font-weight:700;color:white;flex-shrink:0;">${initials}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:.75rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(t.guestName)}</div>
          <div style="font-size:.65rem;color:var(--crm-text-3);">${escHtml(t.destination)}</div>
        </div>
        <span style="font-size:.65rem;font-weight:600;color:${diff <= 7 ? '#ef4444' : diff <= 14 ? '#f59e0b' : '#10b981'};white-space:nowrap;">${diffLabel}</span>
      </div>
    `;
  }).join('');
}

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
document.getElementById('employeeModalClose').addEventListener('click', () => closeModal('employeeModal'));
document.getElementById('tripModalClose').addEventListener('click', () => closeModal('tripModal'));
document.getElementById('tripModalCancel').addEventListener('click', () => closeModal('tripModal'));

// Close on overlay click
['subtaskModal','templateModal','employeeModal','tripModal'].forEach(id => {
  document.getElementById(id).addEventListener('click', e => {
    if (e.target === document.getElementById(id)) closeModal(id);
  });
});

// Esc key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['subtaskModal','templateModal','employeeModal','tripModal'].forEach(id => closeModal(id));
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
  const [tripData, templateData, employeeData] = await Promise.all([
    apiJson('/api/ownership/trips'),
    apiJson('/api/ownership/templates'),
    apiJson('/api/ownership/employees'),
  ]);
  trips = tripData.trips || [];
  cacheTripsForFastPaint(trips);
  taskTemplates = templateData.templates || [];
  employees = employeeData.employees || [];
}

function cacheTripsForFastPaint(nextTrips) {
  try {
    localStorage.setItem(OWNERSHIP_TRIPS_STORAGE_KEY, JSON.stringify({
      savedAt: Date.now(),
      trips: Array.isArray(nextTrips) ? nextTrips : [],
    }));
  } catch (err) {
    // Storage can fail in private mode or under quota pressure; the API remains authoritative.
  }
}

function restoreTripsForFastPaint() {
  try {
    const cached = JSON.parse(localStorage.getItem(OWNERSHIP_TRIPS_STORAGE_KEY) || 'null');
    if (!cached || !Array.isArray(cached.trips)) return false;
    trips = cached.trips;
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
}

document.addEventListener('DOMContentLoaded', () => {
  init();

  const btnCancelSelection = document.getElementById('btnCancelSelection');
  if (btnCancelSelection) {
    btnCancelSelection.addEventListener('click', () => {
      selectedTrips.clear();
      document.querySelectorAll('.row-check').forEach(chk => chk.checked = false);
      updateSelectAllCheckbox();
      updateSelectionStrip();
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
        idsToDelete.map(id => fetch(`/api/ownership/trips/${id}`, { method: 'DELETE' }))
      );
      const failedIds = idsToDelete.filter((id, idx) => results[idx].status !== 'fulfilled' || !results[idx].value.ok);
      if (failedIds.length) {
        trips = [...deletedTrips.filter(t => failedIds.includes(t.id)), ...trips];
        refreshOwnershipViews();
        toast(`Could not delete ${failedIds.length} trips`, '⚠️');
      }
    });
  }
});
