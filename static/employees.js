// ============================================================================
// Employee Workspace Logic
// ============================================================================

// State
let trips = [];
let employees = [];
let currentView = 'picker'; // 'picker' | 'workspace'
let activeEmployee = null;
let currentTab = 'subtasks';
let searchQuery = '';
let selectedTripId = null;
let doneSubtasksExpanded = false;
const EMPLOYEE_TRIPS_CACHE_KEY = 'employee_workspace_trips_cache_v1';
const EMPLOYEE_EMPLOYEES_CACHE_KEY = 'employee_workspace_employees_cache_v1';
const EMPLOYEE_ACTIVE_ID_CACHE_KEY = 'employee_workspace_active_employee_id_v1';
const EMPLOYEE_BASE_PATH = window.__EMPLOYEE_BASE_PATH__ || '/ownership/employees';
const INITIAL_EMPLOYEE_ID = window.__INITIAL_EMPLOYEE_ID__ || '';

function getEmployeeIdFromPath() {
  const match = window.location.pathname.match(/^\/ownership\/employees\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : '';
}

function syncEmployeeRoute(employeeId, { replace = false } = {}) {
  const nextPath = employeeId ? `${EMPLOYEE_BASE_PATH}/${encodeURIComponent(employeeId)}` : EMPLOYEE_BASE_PATH;
  if (window.location.pathname === nextPath) return;
  const method = replace ? 'replaceState' : 'pushState';
  history[method]({}, '', nextPath);
}

function getRequestedEmployeeId() {
  return getEmployeeIdFromPath() || INITIAL_EMPLOYEE_ID || restoreActiveEmployeeId() || '';
}

function cacheActiveEmployeeId(employeeId) {
  try {
    if (employeeId) localStorage.setItem(EMPLOYEE_ACTIVE_ID_CACHE_KEY, String(employeeId));
    else localStorage.removeItem(EMPLOYEE_ACTIVE_ID_CACHE_KEY);
  } catch (err) {}
}

function restoreActiveEmployeeId() {
  try {
    return localStorage.getItem(EMPLOYEE_ACTIVE_ID_CACHE_KEY) || '';
  } catch (err) {
    return '';
  }
}

function isSameEmployeeId(a, b) {
  return String(a ?? '') === String(b ?? '');
}

function setDoneSubtasksExpanded(isOpen) {
  doneSubtasksExpanded = !!isOpen;
}

window.selectTripViewTab = function(tripId) {
  selectedTripId = tripId;
  renderWorkspace();
};

// Helpers
async function apiJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'API Error');
  return data;
}

function toast(msg, icon = '✓') {
  const container = document.getElementById('crmToastContainer');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'crm-toast';
  t.innerHTML = `<span>${icon}</span> <span>${msg}</span>`;
  container.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 3000);
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr || !dateStr.includes('-')) return dateStr;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const year = parts[0].slice(-2);
  const month = months[parseInt(parts[1], 10) - 1];
  const day = parts[2];
  return `${day} ${month} ${year}`;
}

function formatCompactDateTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function getSubtaskCreatedAt(subtask) {
  return subtask?.createdAt || subtask?.metadata?.createdAt || subtask?.metadata?.addedAt || '';
}

function normalizeRemarkEntries(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map(entry => {
        if (!entry) return null;
        if (typeof entry === 'string') {
          const text = entry.trim();
          return text ? { text, ts: '' } : null;
        }
        const text = String(entry.text || entry.message || '').trim();
        if (!text) return null;
        return {
          text,
          ts: entry.ts || entry.timestamp || entry.createdAt || '',
        };
      })
      .filter(Boolean);
  }
  if (typeof raw === 'string') {
    const text = raw.trim();
    return text ? [{ text, ts: '' }] : [];
  }
  return [];
}

function isSubtaskHighPriority(subtask) {
  return !!subtask?.metadata?.isHighPriority;
}

function buildPriorityBadgeHtml(subtask) {
  if (subtask?.done) return '';
  return isSubtaskHighPriority(subtask) ? '<span class="ew-priority-badge">Priority</span>' : '';
}

function buildPriorityToggleHtml(subtask, tripId) {
  if (subtask?.done) return '';
  const isPriority = isSubtaskHighPriority(subtask);
  const resolvedTripId = tripId || subtask.tripId || '';
  return `
    <button
      type="button"
      class="ew-priority-toggle ${isPriority ? 'is-priority' : ''}"
      aria-pressed="${isPriority ? 'true' : 'false'}"
      aria-label="Toggle priority for this subtask"
      title="Toggle Priority"
      onclick="toggleSubtaskPriority('${resolvedTripId}', '${subtask.id}')"
    >
      <span class="ew-priority-toggle-track" aria-hidden="true">
        <span class="ew-priority-toggle-thumb"></span>
      </span>
    </button>
  `;
}

function buildDeleteSubtaskButtonHtml(tripId, subtaskId) {
  return `
    <button
      type="button"
      class="ew-delete-subtask-btn"
      title="Delete Subtask"
      aria-label="Delete Subtask"
      onclick="deleteSubtask('${tripId}', '${subtaskId}')"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 6h18"></path>
        <path d="M8 6V4h8v2"></path>
        <path d="M19 6l-1 14H6L5 6"></path>
        <path d="M10 11v5"></path>
        <path d="M14 11v5"></path>
      </svg>
    </button>
  `;
}

function getSubtaskPrioritySortStamp(subtask) {
  return subtask?.metadata?.priorityUpdatedAt
    || subtask?.metadata?.updatedAt
    || subtask?.updatedAt
    || subtask?.createdAt
    || subtask?.metadata?.createdAt
    || subtask?.metadata?.addedAt
    || '';
}

function compareSubtasksForDisplay(a, b) {
  const aPriority = isSubtaskHighPriority(a) ? 0 : 1;
  const bPriority = isSubtaskHighPriority(b) ? 0 : 1;
  if (aPriority !== bPriority) return aPriority - bPriority;
  const aTime = Date.parse(getSubtaskPrioritySortStamp(a)) || 0;
  const bTime = Date.parse(getSubtaskPrioritySortStamp(b)) || 0;
  if (aTime !== bTime) return bTime - aTime;
  return String(a.text || '').localeCompare(String(b.text || ''));
}

function buildSubtaskCardHtml(s) {
  const catLabel = s.taskCategory ? s.taskCategory.charAt(0).toUpperCase() + s.taskCategory.slice(1) : '';
  const dest = s.trip.destination ? s.trip.destination : '';
  const tripDate = s.tripDate ? formatDate(s.tripDate) : '';
  const createdAt = formatCompactDateTime(getSubtaskCreatedAt(s));
  const remarkCount = normalizeRemarkEntries(s.metadata?.remarks).length;
  return `
    <details class="ew-subtask-card" data-subtask-id="${escHtml(s.id)}">
      <summary class="ew-subtask-card-summary">
        <label class="ew-subtask-card-checkwrap" onclick="event.stopPropagation();">
          <input type="checkbox" ${s.done ? 'checked' : ''} onchange="toggleSubtaskDone('${s.tripId}', '${s.id}', this.checked)">
        </label>
        <div class="ew-subtask-card-copy">
          <div class="ew-subtask-card-title ${s.done ? 'ew-subtask-done' : ''}">${escHtml(s.text)}</div>
          <div class="ew-subtask-card-meta">
            <span>${escHtml(s.trip.guestName || 'Unnamed Trip')}</span>
            ${dest ? `<span>${escHtml(dest)}</span>` : ''}
            ${tripDate ? `<span>${escHtml(tripDate)}</span>` : ''}
            ${catLabel ? `<span>[${escHtml(catLabel)}]</span>` : ''}
          </div>
        </div>
        <div class="ew-subtask-card-badges">
          ${buildPriorityToggleHtml(s)}
          <span class="ew-subtask-card-count">${remarkCount} remark${remarkCount === 1 ? '' : 's'}</span>
          <span class="ew-subtask-card-created">${escHtml(createdAt || '—')}</span>
        </div>
      </summary>
      <div class="ew-subtask-card-body">
        <div class="ew-remark-thread">${remarkThreadHtml(s)}</div>
        <div class="ew-remark-compose">
          <textarea class="ew-remark-input ew-remark-textarea" rows="2" placeholder="Add remark..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();appendSubtaskRemark('${s.tripId}', '${s.id}', this.value); this.value='';}"></textarea>
            <button type="button" class="ew-remark-send" title="Send remark" aria-label="Send remark" onclick="appendSubtaskRemark('${s.tripId}', '${s.id}', this.parentElement.querySelector('textarea').value); this.parentElement.querySelector('textarea').value='';">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M22 2L11 13"></path>
                <path d="M22 2L15 22 11 13 2 9 22 2Z"></path>
              </svg>
            </button>
            ${buildDeleteSubtaskButtonHtml(s.tripId, s.id)}
          </div>
        </div>
      </details>
    `;
}

function buildDetailSubtaskHtml(trip, s) {
  return `
    <div class="ew-detail-subtask" data-subtask-id="${escHtml(s.id)}" style="display:flex;flex-direction:column;gap:0.5rem;align-items:stretch;">
      <div style="display:flex;gap:0.5rem;align-items:center;">
        <input type="checkbox" ${s.done ? 'checked' : ''} onchange="toggleSubtaskDone('${trip.id}', '${s.id}', this.checked)">
        <input type="text" class="ew-detail-subtask-text ${s.done ? 'done' : ''}" value="${escHtml(s.text)}" readonly style="flex:1;">
        ${buildDeleteSubtaskButtonHtml(trip.id, s.id)}
      </div>
      <div class="ew-remark-thread">${remarkThreadHtml(s)}</div>
      <div class="ew-remark-compose">
        <textarea class="ew-remark-input ew-remark-textarea" rows="2" placeholder="Add remark..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();appendSubtaskRemark('${trip.id}', '${s.id}', this.value); this.value='';}"></textarea>
        <button type="button" class="ew-remark-send" title="Send remark" aria-label="Send remark" onclick="appendSubtaskRemark('${trip.id}', '${s.id}', this.parentElement.querySelector('textarea').value); this.parentElement.querySelector('textarea').value='';">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M22 2L11 13"></path>
            <path d="M22 2L15 22 11 13 2 9 22 2Z"></path>
          </svg>
        </button>
        ${buildDeleteSubtaskButtonHtml(trip.id, s.id)}
      </div>
    </div>
  `;
}

function refreshWorkspaceStats() {
  renderStatsRow(getEmployeeData().stats);
}

function replaceSubtaskCardDom(tripId, subtaskId) {
  const data = getEmployeeData();
  const subtask = data.subtasks.find(s => s.tripId === tripId && s.id === subtaskId);
  const card = document.querySelector(`details.ew-subtask-card[data-subtask-id="${CSS.escape(String(subtaskId))}"]`);
  if (!card) return false;
  if (!subtask) {
    card.remove();
    return true;
  }
  const wasOpen = card.open;
  card.outerHTML = buildSubtaskCardHtml(subtask);
  const next = document.querySelector(`details.ew-subtask-card[data-subtask-id="${CSS.escape(String(subtaskId))}"]`);
  if (wasOpen && next) next.open = true;
  return true;
}

function removeSubtaskCardDom(subtaskId) {
  const card = document.querySelector(`details.ew-subtask-card[data-subtask-id="${CSS.escape(String(subtaskId))}"]`);
  if (!card) return false;
  card.remove();
  return true;
}

function refreshDetailSubtaskList(trip, taskKey) {
  if (!currentDetailContext || currentDetailContext.tripId !== trip.id) return;
  renderDetailSubtasks(trip, taskKey);
}

function remarkThreadHtml(subtask) {
  const remarks = normalizeRemarkEntries(subtask?.metadata?.remarks);
  if (!remarks.length) {
    return '<div class="ew-remark-empty">No remarks yet</div>';
  }
  const lastRemark = remarks[remarks.length - 1];
  const summary = lastRemark ? lastRemark.text : 'Remarks';
  return `
    <details class="ew-remark-details">
      <summary class="ew-remark-summary">
        <span class="ew-remark-summary-label">Remarks</span>
        <span class="ew-remark-summary-preview">${escHtml(summary)}</span>
        <span class="ew-remark-summary-count">${remarks.length}</span>
      </summary>
      <div class="ew-remark-thread-body">
        ${remarks.map((r, idx) => `
          <div class="ew-remark-bubble">
            <div class="ew-remark-bubble-head">
              <div class="ew-remark-text">${escHtml(r.text)}</div>
              <div class="ew-remark-actions">
                <button type="button" class="ew-remark-action" title="Edit remark" aria-label="Edit remark" onclick="editSubtaskRemark('${subtask?.tripId}', '${subtask?.id}', ${idx})">Edit</button>
                <button type="button" class="ew-remark-action danger" title="Delete remark" aria-label="Delete remark" onclick="deleteSubtaskRemark('${subtask?.tripId}', '${subtask?.id}', ${idx})">Delete</button>
              </div>
            </div>
            ${r.ts ? `<div class="ew-remark-meta">${escHtml(formatCompactDateTime(r.ts))}</div>` : ''}
          </div>
        `).join('')}
      </div>
    </details>
  `;
}

function appendSubtaskRemark(tripId, subtaskId, rawText) {
  const text = String(rawText || '').trim();
  if (!text) return;
  const trip = trips.find(t => t.id === tripId);
  if (!trip) return;
  const ts = new Date().toISOString();
  let found = false;
  Object.values(trip.subtasks || {}).forEach(arr => {
    if (!Array.isArray(arr)) return;
    const sub = arr.find(x => x.id === subtaskId);
    if (!sub) return;
    if (!sub.metadata) sub.metadata = {};
    const next = normalizeRemarkEntries(sub.metadata.remarks);
    next.push({ text, ts });
    sub.metadata.remarks = next;
    if (!sub.createdAt) sub.createdAt = ts;
    found = true;
  });
  if (!found) return;
  replaceSubtaskCardDom(tripId, subtaskId);
  if (currentDetailContext && currentDetailContext.tripId === tripId) {
    refreshDetailSubtaskList(trip, currentDetailContext.taskKey);
  }
  updateTripField(tripId, 'subtasks', trip.subtasks).catch(() => {});
}

async function editSubtaskRemark(tripId, subtaskId, remarkIndex) {
  const trip = trips.find(t => t.id === tripId);
  if (!trip) return;
  const remarks = normalizeRemarkEntries(
    Object.values(trip.subtasks || {})
      .flat()
      .find(sub => sub?.id === subtaskId)?.metadata?.remarks
  );
  const current = remarks[remarkIndex];
  if (!current) return;
  const nextText = window.prompt('Edit remark', current.text || '');
  if (nextText === null) return;
  const trimmed = String(nextText || '').trim();
  if (!trimmed) {
    toast('Remark cannot be empty', '⚠️');
    return;
  }
  let found = false;
  Object.values(trip.subtasks || {}).forEach(arr => {
    if (!Array.isArray(arr)) return;
    const sub = arr.find(x => x.id === subtaskId);
    if (!sub) return;
    if (!sub.metadata) sub.metadata = {};
    const next = normalizeRemarkEntries(sub.metadata.remarks);
    if (!next[remarkIndex]) return;
    next[remarkIndex] = { ...next[remarkIndex], text: trimmed };
    sub.metadata.remarks = next;
    found = true;
  });
  if (!found) return;
  updateTripField(tripId, 'subtasks', trip.subtasks).catch(() => {});
  replaceSubtaskCardDom(tripId, subtaskId);
  if (currentDetailContext && currentDetailContext.tripId === tripId) {
    refreshDetailSubtaskList(trip, currentDetailContext.taskKey);
  }
}

async function deleteSubtaskRemark(tripId, subtaskId, remarkIndex) {
  const trip = trips.find(t => t.id === tripId);
  if (!trip) return;
  if (!confirm('Delete this remark?')) return;
  let found = false;
  Object.values(trip.subtasks || {}).forEach(arr => {
    if (!Array.isArray(arr)) return;
    const sub = arr.find(x => x.id === subtaskId);
    if (!sub) return;
    if (!sub.metadata) sub.metadata = {};
    const next = normalizeRemarkEntries(sub.metadata.remarks);
    if (!next[remarkIndex]) return;
    next.splice(remarkIndex, 1);
    sub.metadata.remarks = next;
    found = true;
  });
  if (!found) return;
  updateTripField(tripId, 'subtasks', trip.subtasks).catch(() => {});
  replaceSubtaskCardDom(tripId, subtaskId);
  if (currentDetailContext && currentDetailContext.tripId === tripId) {
    refreshDetailSubtaskList(trip, currentDetailContext.taskKey);
  }
}

function getSubtaskCategory(taskKey) {
  if (taskKey === 'travelingStatus') return 'travefy';
  return taskKey.replace('Status', '');
}

const statusColors = {
  notstarted: '#9ca3af',
  pending: '#f59e0b',
  ongoing: '#3b82f6',
  review: '#8b5cf6',
  complete: '#10b981',
  cancelled: '#ef4444',
  na: '#d1d5db'
};

const statusLabels = {
  notstarted: 'Not Started',
  pending: 'Pending',
  ongoing: 'In Progress',
  review: 'Under Review',
  complete: 'Completed',
  cancelled: 'Cancelled',
  na: 'N/A'
};

function employeeColor(name) {
  const e = employees.find(x => x.name === name);
  if (e && e.color) return e.color;
  if ((name || '').trim().toLowerCase() === 'c k') return '#E50914';
  const palette = ["#8b5cf6", "#3b82f6", "#ec4899", "#14b8a6", "#f59e0b", "#10b981", "#ef4444", "#06b6d4"];
  let total = 0;
  for (let i = 0; i < (name || '').length; i++) total += name.charCodeAt(i);
  return palette[total % palette.length];
}

// Data Loading
function cacheEmployeeWorkspaceState() {
  try {
    localStorage.setItem(EMPLOYEE_TRIPS_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), trips }));
    localStorage.setItem(EMPLOYEE_EMPLOYEES_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), employees }));
  } catch (err) {
    // Ignore storage failures and keep going with live data.
  }
}

function restoreEmployeeWorkspaceState() {
  try {
    const tripsCached = JSON.parse(localStorage.getItem(EMPLOYEE_TRIPS_CACHE_KEY) || 'null');
    const employeesCached = JSON.parse(localStorage.getItem(EMPLOYEE_EMPLOYEES_CACHE_KEY) || 'null');
    if (Array.isArray(tripsCached?.trips)) trips = tripsCached.trips;
    if (Array.isArray(employeesCached?.employees)) employees = employeesCached.employees;
    if (employees.length) employees.sort((a, b) => a.name.localeCompare(b.name));
    return trips.length > 0 || employees.length > 0;
  } catch (err) {
    localStorage.removeItem(EMPLOYEE_TRIPS_CACHE_KEY);
    localStorage.removeItem(EMPLOYEE_EMPLOYEES_CACHE_KEY);
    return false;
  }
}

function activateEmployeeById(employeeId, { replaceRoute = false, animate = false } = {}) {
  const emp = employees.find(x => isSameEmployeeId(x.id, employeeId));
  if (!emp) return false;

  activeEmployee = emp;
  currentTab = 'subtasks';
  selectedTripId = null;
  cacheActiveEmployeeId(emp.id);
  syncEmployeeRoute(emp.id, { replace: replaceRoute });

  const targetAvatar = document.getElementById('ewUserAvatar');
  const targetName = document.getElementById('ewUserName');
  if (targetAvatar) {
    targetAvatar.textContent = activeEmployee.name.charAt(0).toUpperCase();
    targetAvatar.style.background = activeEmployee.name.trim().toLowerCase() === 'c k' ? '#2563eb' : (activeEmployee.color || employeeColor(activeEmployee.name));
  }
  if (targetName) targetName.textContent = activeEmployee.name;

  if (!animate) {
    showView('workspace');
    return true;
  }

  showView('workspace');
  return true;
}

async function loadData() {
  const hadCache = restoreEmployeeWorkspaceState();
  const initialRequestedId = getRequestedEmployeeId();
  
  if (hadCache) {
    if (initialRequestedId) {
      const matched = employees.find(emp => isSameEmployeeId(emp.id, initialRequestedId));
      if (matched) {
        activateEmployeeById(matched.id, { replaceRoute: true, animate: false });
      } else {
        renderPicker();
      }
    } else {
      if (currentView === 'picker') renderPicker();
      else if (activeEmployee) renderWorkspace();
    }
  }

  const [tRes, eRes] = await Promise.allSettled([
    apiJson('/api/ownership/trips'),
    apiJson('/api/ownership/employees')
  ]);

  let tripsOk = false;
  let employeesOk = false;

  if (tRes.status === 'fulfilled' && Array.isArray(tRes.value?.trips)) {
    trips = tRes.value.trips;
    tripsOk = true;
  }
  if (eRes.status === 'fulfilled' && Array.isArray(eRes.value?.employees)) {
    employees = eRes.value.employees;
    employees.sort((a, b) => a.name.localeCompare(b.name));
    employeesOk = true;
  }

  if (tripsOk || employeesOk) cacheEmployeeWorkspaceState();
  if (!tripsOk) console.error('Employees dashboard trips failed to load', tRes.status === 'rejected' ? tRes.reason : 'unknown');
  if (!employeesOk) console.error('Employees dashboard employees failed to load', eRes.status === 'rejected' ? eRes.reason : 'unknown');

  const requestedEmployeeId = getRequestedEmployeeId();
  if (requestedEmployeeId) {
    const matched = employees.find(emp => isSameEmployeeId(emp.id, requestedEmployeeId));
    if (matched) {
      activateEmployeeById(matched.id, { replaceRoute: true, animate: false });
      return;
    }
    cacheActiveEmployeeId('');
    syncEmployeeRoute('', { replace: true });
  }

  if (currentView === 'picker') {
    showView('picker');
  } else if (activeEmployee) {
    showView('workspace');
  }

  if (!tripsOk || !employeesOk) {
    toast('Loaded with partial data. Refresh if something looks off.', '⚠️');
  }
}

// ============================================================================
// PICKER VIEW
// ============================================================================

function showView(view) {
  document.getElementById('employeePickerScreen').style.display = view === 'picker' ? 'flex' : 'none';
  document.getElementById('employeeWorkspace').style.display = view === 'workspace' ? 'flex' : 'none';
  currentView = view;
  
  if (view === 'picker') {
    renderPicker();
  } else if (view === 'workspace') {
    renderWorkspace();
  }
  syncWorkspaceTopStrip();
}

function syncActiveTabButtons() {
  document.querySelectorAll('.ew-tab').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-view') === currentTab);
  });
}

function renderPicker() {
  const grid = document.getElementById('empPickerGrid');
  let html = '';
  
  // Existing Employees
  employees.forEach((emp, i) => {
    const delay = i * 0.03 + 0.05;
    html += `
      <div class="emp-card" style="animation-delay: ${delay}s" onclick="selectEmployee('${emp.id}', this)">
        <div class="emp-avatar" style="background: ${emp.name.trim().toLowerCase() === 'c k' ? '#2563eb' : (emp.color || employeeColor(emp.name))}">
          ${emp.name.charAt(0).toUpperCase()}
          <div class="emp-delete-badge" onclick="event.stopPropagation(); deleteEmployee('${emp.id}')">✕</div>
        </div>
        <div class="emp-name">${escHtml(emp.name)}</div>
      </div>
    `;
  });
  
  // Add Profile Card
  html += `
    <div class="emp-card" style="animation-delay: ${(employees.length * 0.03) + 0.05}s">
      <div class="emp-avatar emp-add-btn" id="empAddBtnClick">
        +
      </div>
      <div class="emp-name" id="empAddNameArea">Add Profile</div>
    </div>
  `;
  
  grid.innerHTML = html;
  
  // Add Event Listener for Add Profile
  document.getElementById('empAddBtnClick').addEventListener('click', (e) => {
    e.stopPropagation();
    const area = document.getElementById('empAddNameArea');
    area.innerHTML = `
      <div class="emp-add-input-wrapper" onclick="event.stopPropagation()">
        <input type="text" class="emp-add-input" id="empNewNameInput" placeholder="Name" autofocus>
        <button class="crm-btn crm-btn-primary" style="padding:0.3rem 0.6rem;" onclick="addEmployee()">✓</button>
      </div>
    `;
    document.getElementById('empNewNameInput').focus();
    document.getElementById('empNewNameInput').addEventListener('keydown', ev => {
      if (ev.key === 'Enter') addEmployee();
    });
  });
}

let isEditMode = false;
document.getElementById('empManageBtn')?.addEventListener('click', () => {
  isEditMode = !isEditMode;
  document.querySelectorAll('.emp-card').forEach(c => c.classList.toggle('edit-mode', isEditMode));
  document.getElementById('empManageBtn').textContent = isEditMode ? 'Done' : 'Manage Profiles';
});

async function addEmployee() {
  const input = document.getElementById('empNewNameInput');
  const name = input ? input.value.trim() : '';
  if (!name) return;
  try {
    const { employee } = await apiJson('/api/ownership/employees', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    employees.push(employee);
    employees.sort((a, b) => a.name.localeCompare(b.name));
    renderPicker();
    toast('Profile added');
  } catch (e) {
    toast('Failed to add profile', '⚠️');
  }
}

async function deleteEmployee(id) {
  if (!confirm('Remove this employee?')) return;
  try {
    await apiJson(`/api/ownership/employees/${id}`, { method: 'DELETE' });
    employees = employees.filter(e => e.id !== id);
    if (activeEmployee && isSameEmployeeId(activeEmployee.id, id)) {
      activeEmployee = null;
      selectedTripId = null;
      cacheActiveEmployeeId('');
      syncEmployeeRoute('', { replace: true });
      showView('picker');
    }
    renderPicker();
    toast('Profile removed');
  } catch (e) {
    toast('Failed to remove profile', '⚠️');
  }
}

window.selectEmployee = function(id, el) {
  if (isEditMode) return;
  const emp = employees.find(x => isSameEmployeeId(x.id, id));
  if (!emp) return;
  
  activeEmployee = emp;
  currentTab = 'subtasks';
  selectedTripId = null;
  cacheActiveEmployeeId(emp.id);
  syncEmployeeRoute(emp.id);
  
  const screen = document.getElementById('employeePickerScreen');
  const workspace = document.getElementById('employeeWorkspace');
  const targetAvatar = document.getElementById('ewUserAvatar');
  const targetName = document.getElementById('ewUserName');
  
  // Pre-fill target header
  targetAvatar.textContent = activeEmployee.name.charAt(0).toUpperCase();
  targetAvatar.style.background = activeEmployee.name.trim().toLowerCase() === 'c k' ? '#2563eb' : (activeEmployee.color || employeeColor(activeEmployee.name));
  targetName.textContent = activeEmployee.name;
  
  if (el) {
    const sourceAvatar = el.querySelector('.emp-avatar');
    const sourceRect = sourceAvatar.getBoundingClientRect();
    
    // Create cloned avatar
    const flyingAvatar = sourceAvatar.cloneNode(true);
    flyingAvatar.style.position = 'fixed';
    flyingAvatar.style.top = sourceRect.top + 'px';
    flyingAvatar.style.left = sourceRect.left + 'px';
    flyingAvatar.style.width = sourceRect.width + 'px';
    flyingAvatar.style.height = sourceRect.height + 'px';
    flyingAvatar.style.margin = '0';
    flyingAvatar.style.zIndex = '10000';
    flyingAvatar.style.transform = 'none'; // Clear hover scale
    flyingAvatar.style.border = 'none';
    flyingAvatar.style.transition = 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
    
    // Remove delete badge from clone
    const badge = flyingAvatar.querySelector('.emp-delete-badge');
    if (badge) badge.remove();
    
    document.body.appendChild(flyingAvatar);
    
    // Fade out picker UI
    screen.style.transition = 'opacity 0.4s ease';
    screen.style.opacity = '0';
    
    // Prepare workspace
    targetAvatar.style.opacity = '0';
    currentView = 'workspace';
    renderWorkspace();
    workspace.style.display = 'flex';
    workspace.style.opacity = '0';
    workspace.style.transition = 'opacity 0.6s ease';
    syncWorkspaceTopStrip(); // ensure banner is visible during animation
    
    // Animate
    requestAnimationFrame(() => {
      workspace.style.opacity = '1';
      
      const targetRect = targetAvatar.getBoundingClientRect();
      flyingAvatar.style.top = targetRect.top + 'px';
      flyingAvatar.style.left = targetRect.left + 'px';
      flyingAvatar.style.width = targetRect.width + 'px';
      flyingAvatar.style.height = targetRect.height + 'px';
      flyingAvatar.style.borderRadius = '50%'; // Target is a circle
      flyingAvatar.style.fontSize = '1.5rem'; // Target font size
      
      setTimeout(() => {
        screen.style.display = 'none';
        screen.style.opacity = '1'; // Reset
        targetAvatar.style.opacity = '1';
        flyingAvatar.remove();
      }, 600);
    });
  } else {
    showView('workspace');
  }
};

document.getElementById('ewBackBtn')?.addEventListener('click', () => {
  activeEmployee = null;
  selectedTripId = null;
  cacheActiveEmployeeId('');
  syncEmployeeRoute('', { replace: true });
  showView('picker');
});

// ============================================================================
// WORKSPACE DATA PROCESSING
// ============================================================================

const taskFields = [
  { key: 'proposalStatus', label: 'Initial Proposal' },
  { key: 'flightsStatus', label: 'Flights' },
  { key: 'visaStatus', label: 'Visa' },
  { key: 'hotelsStatus', label: 'Hotels' },
  { key: 'sectorTicketsStatus', label: 'Sector Tickets' },
  { key: 'sightseeingStatus', label: 'Sightseeing' },
  { key: 'insuranceStatus', label: 'Insurance' },
  { key: 'travelingStatus', label: 'Traveling (Travefy)' },
  { key: 'travefyTaskListStatus', label: 'Travefy Task List' },
  { key: 'tripFeedbackFormStatus', label: 'Trip Feedback Form' }
];

function getEmployeeData() {
  if (!activeEmployee) return { tasks: [], subtasks: [], stats: {} };
  
  const empName = activeEmployee.name;
  let allTasks = [];
  let allSubtasks = [];
  let tripCount = 0;
  
  // Tasks are extracted from trips owned by this employee
  const myTrips = trips.filter(t => t.owner === empName);
  tripCount = myTrips.length;
  
  myTrips.forEach(trip => {
    taskFields.forEach(tf => {
      const status = trip[tf.key] || 'notstarted';
      if (status !== 'na') {
        allTasks.push({
          id: `${trip.id}_${tf.key}`,
          tripId: trip.id,
          tripName: trip.guestName || trip.destination || 'Unnamed Trip',
          tripDate: formatDate(trip.startDate),
          taskKey: tf.key,
          taskLabel: tf.label,
          status: status,
          trip: trip
        });
      }
    });
  });
  
  // Subtasks: assigned to this employee (can be from ANY trip, not just owned trips)
  trips.forEach(trip => {
    try {
      const subsObj = trip.subtasks || {};
      Object.entries(subsObj).forEach(([catName, catArray]) => {
        if (!Array.isArray(catArray)) return;
        catArray.forEach(s => {
          if (s.assignee === empName) {
            allSubtasks.push({
              ...s,
              tripId: trip.id,
              tripName: trip.guestName || trip.destination || 'Unnamed Trip',
              tripDate: formatDate(trip.startDate),
              taskCategory: catName,
              trip: trip
            });
          }
        });
      });
    } catch(e){}
  });

  // Filter tasks and subtasks by search query
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    allTasks = allTasks.filter(t => 
      t.tripName.toLowerCase().includes(q) || 
      t.taskLabel.toLowerCase().includes(q) ||
      (t.trip.destination || '').toLowerCase().includes(q)
    );
    allSubtasks = allSubtasks.filter(s => 
      s.text.toLowerCase().includes(q) || 
      s.tripName.toLowerCase().includes(q)
    );
  }

  // Sort subtasks so priorities stay above normal items.
  allSubtasks.sort(compareSubtasksForDisplay);
  
  // Calculate Stats
  const stats = {
    activeTrips: tripCount,
    pendingTasks: allTasks.filter(t => ['notstarted', 'pending', 'ongoing', 'review'].includes(t.status)).length,
    completedTasks: allTasks.filter(t => t.status === 'complete').length,
    overdueTasks: allTasks.filter(t => {
      if (!t.tripDate || t.status === 'complete' || t.status === 'cancelled') return false;
      return new Date(t.tripDate) < new Date();
    }).length,
    completionRate: 0
  };
  const totalRelevant = stats.pendingTasks + stats.completedTasks;
  if (totalRelevant > 0) {
    stats.completionRate = Math.round((stats.completedTasks / totalRelevant) * 100);
  }
  
  return { tasks: allTasks, subtasks: allSubtasks, stats };
}

// ============================================================================
// WORKSPACE RENDERERS
// ============================================================================

function renderWorkspace() {
  const data = getEmployeeData();
  renderStatsRow(data.stats);
  syncWorkspaceTopStrip();
  syncActiveTabButtons();
  
  const container = document.getElementById('ewViewContainer');
  const openSubtaskCards = currentTab === 'subtasks'
    ? [...container.querySelectorAll('details.ew-subtask-card[open]')].map(card => card.dataset.subtaskId).filter(Boolean)
    : [];
  if (currentTab === 'kanban') container.innerHTML = renderKanban(data.tasks);
  else if (currentTab === 'trip') container.innerHTML = renderTripView(data.tasks, data.subtasks);
  else if (currentTab === 'subtasks') container.innerHTML = renderSubtasks(data.subtasks);
  else if (currentTab === 'timeline') container.innerHTML = renderTimeline(data.tasks);
  else if (currentTab === 'calendar') container.innerHTML = renderCalendar(data.tasks);

  if (currentTab === 'subtasks' && openSubtaskCards.length) {
    openSubtaskCards.forEach(id => {
      const card = container.querySelector(`details.ew-subtask-card[data-subtask-id="${CSS.escape(id)}"]`);
      if (card) card.open = true;
    });
  }

  if (currentTab === 'subtasks') {
    const pendingList = container.querySelector('#ewPendingSubtasksList');
    if (pendingList && window.Sortable) {
      Sortable.create(pendingList, {
        animation: 250,
        ghostClass: 'ew-subtask-ghost',
        onEnd: function () {
          const cards = pendingList.querySelectorAll('details.ew-subtask-card');
          const affectedTripIds = new Set();
          
          cards.forEach((card, index) => {
            const subtaskId = card.getAttribute('data-subtask-id');
            trips.forEach(t => {
              if (t.subtasks) {
                Object.values(t.subtasks).forEach(arr => {
                  if (Array.isArray(arr)) {
                    const s = arr.find(x => x.id === subtaskId);
                    if (s && s.priority !== index) {
                      s.priority = index;
                      affectedTripIds.add(t.id);
                    }
                  }
                });
              }
            });
          });

          if (affectedTripIds.size > 0) {
            affectedTripIds.forEach(tripId => {
              const trip = trips.find(t => t.id === tripId);
              if (trip) {
                updateTripField(tripId, 'subtasks', trip.subtasks).catch(() => {});
              }
            });
          }
        }
      });
    }
  }
}

function syncWorkspaceTopStrip() {
  const statsRow = document.getElementById('ewStatsRow');
  const banner = document.getElementById('ewSubtasksBanner');
  const showBanner = currentView === 'workspace' && currentTab === 'subtasks' && !!activeEmployee;
  if (statsRow) statsRow.style.display = showBanner ? 'none' : 'grid';
  if (banner) banner.style.display = showBanner ? 'flex' : 'none';
}

window.openAddSubtaskModal = openAddSubtaskModal;

document.getElementById('ewAddSubtaskBtn')?.addEventListener('click', () => {
  openAddSubtaskModal();
});

document.getElementById('ewAddSubtaskClose')?.addEventListener('click', closeAddSubtaskModal);
document.getElementById('ewAddSubtaskCancel')?.addEventListener('click', closeAddSubtaskModal);
document.getElementById('ewAddSubtaskModal')?.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'ewAddSubtaskModal') closeAddSubtaskModal();
});

document.getElementById('ewAddSubtaskSave')?.addEventListener('click', async () => {
  const tripId = document.getElementById('ewAddSubtaskTripSelect')?.value;
  const taskKey = document.getElementById('ewAddSubtaskTaskSelect')?.value;
  const text = document.getElementById('ewAddSubtaskText')?.value.trim();
  if (!tripId || !taskKey || !text) {
    toast('Choose a trip, task, and subtask text', '⚠️');
    return;
  }

  const trip = trips.find(t => t.id === tripId);
  if (!trip) {
    toast('Trip not found', '⚠️');
    return;
  }

  const cat = getSubtaskCategory(taskKey);
  const subsObj = trip.subtasks || {};
  if (!subsObj[cat]) subsObj[cat] = [];

  const newSubtask = {
    id: 's_' + Date.now(),
    text,
    done: false,
    assignee: activeEmployee?.name || trip.owner || '',
    createdAt: new Date().toISOString(),
  };

  subsObj[cat].push(newSubtask);
  trip.subtasks = subsObj;
  closeAddSubtaskModal();
  renderWorkspace();

  try {
    await apiJson(`/api/ownership/trips/${trip.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ subtasks: subsObj }),
    });
    toast('Subtask added');
  } catch (err) {
    console.error('Add subtask failed', err);
    toast('Failed to add subtask', '⚠️');
  }
});

function renderStatsRow(stats) {
  const html = `
    <div class="ew-stat-card">
      <div class="ew-stat-title">Active Trips</div>
      <div class="ew-stat-value">${stats.activeTrips}</div>
    </div>
    <div class="ew-stat-card">
      <div class="ew-stat-title">Pending Tasks</div>
      <div class="ew-stat-value">${stats.pendingTasks}</div>
    </div>
    <div class="ew-stat-card">
      <div class="ew-stat-title">Completed Tasks</div>
      <div class="ew-stat-value" style="color:var(--crm-primary)">${stats.completedTasks}</div>
    </div>
    <div class="ew-stat-card">
      <div class="ew-stat-title">Overdue Tasks</div>
      <div class="ew-stat-value" style="color:#ef4444">${stats.overdueTasks}</div>
    </div>
    <div class="ew-stat-card">
      <div class="ew-stat-title">Completion Rate</div>
      <div class="ew-stat-value">${stats.completionRate}%</div>
    </div>
  `;
  document.getElementById('ewStatsRow').innerHTML = html;
}

function tripLabel(trip) {
  if (!trip) return 'Unknown Trip';
  const name = trip.guestName || trip.destination || 'Unnamed Trip';
  const dest = trip.destination ? ` - ${trip.destination}` : '';
  const date = trip.startDate ? ` (${formatDate(trip.startDate)})` : '';
  return `${name}${dest}${date}`;
}

function buildAddSubtaskTripOptions(selectedTripId = '') {
  const sortedTrips = [...trips].sort((a, b) => tripLabel(a).localeCompare(tripLabel(b)));
  if (!sortedTrips.length) return '<option value="">No trips available</option>';
  return sortedTrips.map(trip => `<option value="${trip.id}" ${trip.id === selectedTripId ? 'selected' : ''}>${escHtml(tripLabel(trip))}</option>`).join('');
}

function buildAddSubtaskTaskOptions(selectedKey = '') {
  return taskFields.map(tf => `<option value="${tf.key}" ${tf.key === selectedKey ? 'selected' : ''}>${escHtml(tf.label)}</option>`).join('');
}

function openAddSubtaskModal(prefill = {}) {
  const modal = document.getElementById('ewAddSubtaskModal');
  if (!modal) return;
  const tripSelect = document.getElementById('ewAddSubtaskTripSelect');
  const taskSelect = document.getElementById('ewAddSubtaskTaskSelect');
  const textInput = document.getElementById('ewAddSubtaskText');

  tripSelect.innerHTML = buildAddSubtaskTripOptions(prefill.tripId || selectedTripId || trips[0]?.id || '');
  taskSelect.innerHTML = buildAddSubtaskTaskOptions(prefill.taskKey || currentDetailContext?.taskKey || taskFields[0]?.key || '');
  textInput.value = prefill.text || '';

  modal.classList.add('open');
  setTimeout(() => textInput.focus(), 0);
}

function closeAddSubtaskModal() {
  document.getElementById('ewAddSubtaskModal')?.classList.remove('open');
}

// Kanban View
function renderKanban(tasks) {
  const cols = {
    pending: tasks.filter(t => ['notstarted', 'pending'].includes(t.status)),
    progress: tasks.filter(t => ['ongoing', 'review'].includes(t.status)),
    completed: tasks.filter(t => t.status === 'complete')
  };
  
  const renderCol = (title, list) => `
    <div class="ew-kanban-col">
      <div class="ew-kanban-header">
        ${title} <span class="ew-kanban-count">${list.length}</span>
      </div>
      <div class="ew-kanban-cards">
        ${list.map(t => renderTaskCard(t)).join('')}
      </div>
    </div>
  `;
  
  return `
    <div class="ew-kanban">
      ${renderCol('Pending', cols.pending)}
      ${renderCol('In Progress', cols.progress)}
      ${renderCol('Completed', cols.completed)}
    </div>
  `;
}

function renderTaskCard(t) {
  return `
    <div class="ew-task-card" onclick="openTaskDetail('${t.tripId}', '${t.taskKey}')">
      <div class="ew-task-card-header">
        <span class="ew-task-badge" style="background:${statusColors[t.status]}20; color:${statusColors[t.status]}">${statusLabels[t.status]}</span>
        ${t.tripDate ? `<span style="font-size:0.7rem;color:var(--crm-text-3)">${t.tripDate}</span>` : ''}
      </div>
      <div class="ew-task-trip">${escHtml(t.tripName)}</div>
      <div class="ew-task-type">${t.taskLabel}</div>
    </div>
  `;
}

// Trip View
function renderTripView(tasks, subtasks = []) {
  const byTrip = {};
  tasks.forEach(t => {
    if (!byTrip[t.tripId]) byTrip[t.tripId] = { tripName: t.tripName, dest: t.trip.destination, tripDate: t.tripDate, tasks: [] };
    byTrip[t.tripId].tasks.push(t);
  });
  
  const tripIds = Object.keys(byTrip);
  if (tripIds.length === 0) return '<div style="color:var(--crm-text-3);text-align:center;margin-top:2rem;">No trips assigned.</div>';
  
  if (!selectedTripId || !byTrip[selectedTripId]) {
    selectedTripId = tripIds[0];
  }
  
  let sidebarHtml = '<div class="ew-trip-sidebar">';
  tripIds.forEach(tid => {
    const group = byTrip[tid];
    const total = group.tasks.length;
    const completed = group.tasks.filter(t => t.status === 'complete').length;
    const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
    const activeClass = tid === selectedTripId ? 'active' : '';
    
    sidebarHtml += `
      <div class="ew-trip-tab ${activeClass}" onclick="selectTripViewTab('${tid}')">
        <div class="ew-trip-tab-title">${escHtml(group.tripName)} ${group.dest ? `- ${escHtml(group.dest)}` : ''}</div>
        <div class="ew-trip-tab-meta">${group.tripDate || 'No Date'}</div>
        <div class="ew-trip-tab-progress">
          <div class="ew-trip-progress-text">
            <span>${completed}/${total} Tasks</span>
            <span>${pct}%</span>
          </div>
          <div class="ew-trip-progress-bar">
            <div class="ew-trip-progress-fill" style="width:${pct}%"></div>
          </div>
        </div>
      </div>
    `;
  });
  sidebarHtml += '</div>';
  
  const activeGroup = byTrip[selectedTripId];
  const activeSubtasks = (subtasks || [])
    .filter(s => s.tripId === selectedTripId)
    .sort(compareSubtasksForDisplay);
  let subtasksHtml = '';
  if (activeSubtasks.length > 0) {
    subtasksHtml = `
      <div class="ew-trip-content-header" style="margin-top:2rem;">
        <div class="ew-trip-content-title">Subtasks</div>
      </div>
      <div class="ew-detail-subtasks">
        ${activeSubtasks.map(s => {
          const catLabel = s.taskCategory ? s.taskCategory.charAt(0).toUpperCase() + s.taskCategory.slice(1) : '';
          return `
          <div class="ew-detail-subtask" style="display:flex; gap:1rem; align-items:center; background:var(--crm-surface); padding:0.75rem; border-radius:8px; border:1px solid var(--crm-border);">
            <input type="checkbox" ${s.done ? 'checked' : ''} onchange="toggleSubtaskDone('${s.tripId}', '${s.id}', this.checked)">
            <div style="flex:1;">
              <div class="ew-detail-subtask-text ${s.done ? 'done' : ''}" style="border:none;background:transparent;width:100%;color:var(--crm-text);font-size:0.85rem;" readonly>${escHtml(s.text)}</div>
              ${catLabel ? `<div style="font-size:0.7rem;color:var(--crm-text-3);">[${catLabel}]</div>` : ''}
            </div>
            <div style="display:flex; gap:0.5rem; align-items:center;">
              <input type="text" style="background:transparent;border:1px solid var(--crm-border);border-radius:4px;padding:0.3rem 0.5rem;color:var(--crm-text);font-size:0.8rem;width:200px;" placeholder="Add remark..." value="${escHtml(s.metadata?.remarks || '')}" onchange="updateSubtaskRemarks('${s.tripId}', '${s.id}', this.value)">
              ${buildDeleteSubtaskButtonHtml(s.tripId, s.id)}
            </div>
          </div>
          `;
        }).join('')}
      </div>
    `;
  }
  
  let contentHtml = `
    <div class="ew-trip-content">
      <div class="ew-trip-content-header">
        <div class="ew-trip-content-title">${escHtml(activeGroup.tripName)} Tasks</div>
      </div>
      <div class="ew-trip-content-grid">
        ${activeGroup.tasks.map(t => renderTaskCard(t)).join('')}
      </div>
      ${subtasksHtml}
    </div>
  `;
  
  return `<div class="ew-trip-layout">${sidebarHtml}${contentHtml}</div>`;
}

// Subtasks View
function renderSubtasks(subtasks) {
  if (subtasks.length === 0) return '<div style="color:var(--crm-text-3);text-align:center;margin-top:2rem;">No subtasks assigned.</div>';
  const ordered = [...subtasks].sort(compareSubtasksForDisplay);
  const pending = ordered.filter(s => !s.done);
  const done = ordered.filter(s => s.done);

  const renderSection = (title, items, emptyText, collapsible = false, isOpen = false) => {
    if (!items.length) {
      if (collapsible) {
        return `
          <details class="ew-subtask-section ew-subtask-section-collapsible" ${isOpen ? 'open' : ''} ontoggle="setDoneSubtasksExpanded(this.open)">
            <summary class="ew-subtask-section-summary">
              <div class="ew-subtask-section-title">${title} <span class="ew-subtask-section-count">0</span></div>
            </summary>
            <div style="color:var(--crm-text-3);text-align:center;padding:0.9rem 0;font-size:0.82rem;">${emptyText}</div>
          </details>
        `;
      }
      return `
        <div class="ew-subtask-section">
          <div class="ew-subtask-section-title">${title}</div>
          <div style="color:var(--crm-text-3);text-align:center;padding:0.9rem 0;font-size:0.82rem;">${emptyText}</div>
        </div>
      `;
    }

    if (collapsible) {
      return `
        <details class="ew-subtask-section ew-subtask-section-collapsible" ${isOpen ? 'open' : ''} ontoggle="setDoneSubtasksExpanded(this.open)">
          <summary class="ew-subtask-section-summary">
            <div class="ew-subtask-section-title">${title} <span class="ew-subtask-section-count">${items.length}</span></div>
          </summary>
          <table class="ew-subtasks-table">
            <thead>
              <tr>
                <th style="width:40px">Done</th>
                <th>Subtask</th>
                <th>Trip & Country</th>
                <th>Created</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(s => {
                const catLabel = s.taskCategory ? s.taskCategory.charAt(0).toUpperCase() + s.taskCategory.slice(1) : '';
                const dest = s.trip.destination ? s.trip.destination : '';
                const tripDate = s.tripDate ? formatDate(s.tripDate) : '';
                const createdAt = formatCompactDateTime(getSubtaskCreatedAt(s));
                return `
                  <tr class="ew-subtask-row">
                    <td><input type="checkbox" ${s.done ? 'checked' : ''} onchange="toggleSubtaskDone('${s.tripId}', '${s.id}', this.checked)"></td>
                    <td class="${s.done ? 'ew-subtask-done' : ''}">${escHtml(s.text)} ${buildPriorityBadgeHtml(s)}</td>
                    <td>
                      <div style="font-weight:500;">${escHtml(s.trip.guestName || 'Unnamed Trip')}</div>
                      ${dest ? `<div style="font-size:0.75rem;color:var(--crm-text-2);">${escHtml(dest)}</div>` : ''}
                      ${tripDate ? `<div style="font-size:0.7rem;color:var(--crm-text-3);margin-top:0.18rem;">${escHtml(tripDate)}</div>` : ''}
                      ${catLabel ? `<div style="font-size:0.7rem;color:var(--crm-text-3);margin-top:0.2rem">[${catLabel}]</div>` : ''}
                    </td>
                    <td style="color:var(--crm-text-3)">${escHtml(createdAt || 'â€”')}</td>
                    <td>
                      <div class="ew-remark-thread">${remarkThreadHtml(s)}</div>
                      <div class="ew-remark-compose">
                        <textarea class="ew-remark-input ew-remark-textarea" rows="2" placeholder="Add remark..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();appendSubtaskRemark('${s.tripId}', '${s.id}', this.value); this.value='';}"></textarea>
                        <button type="button" class="ew-remark-send" title="Send remark" aria-label="Send remark" onclick="appendSubtaskRemark('${s.tripId}', '${s.id}', this.parentElement.querySelector('textarea').value); this.parentElement.querySelector('textarea').value='';">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M22 2L11 13"></path>
                            <path d="M22 2L15 22 11 13 2 9 22 2Z"></path>
                          </svg>
                        </button>
                        ${buildDeleteSubtaskButtonHtml(s.tripId, s.id)}
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </details>
      `;
    }

    let html = `
      <div class="ew-subtask-section">
        <div class="ew-subtask-section-title">${title} <span class="ew-subtask-section-count">${items.length}</span></div>
        <table class="ew-subtasks-table">
          <thead>
            <tr>
              <th style="width:40px">Done</th>
              <th>Subtask</th>
              <th>Trip & Country</th>
              <th>Created</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
    `;

    items.forEach(s => {
      const catLabel = s.taskCategory ? s.taskCategory.charAt(0).toUpperCase() + s.taskCategory.slice(1) : '';
      const dest = s.trip.destination ? s.trip.destination : '';
      const tripDate = s.tripDate ? formatDate(s.tripDate) : '';
      const createdAt = formatCompactDateTime(getSubtaskCreatedAt(s));
      html += `
        <tr class="ew-subtask-row">
          <td><input type="checkbox" ${s.done ? 'checked' : ''} onchange="toggleSubtaskDone('${s.tripId}', '${s.id}', this.checked)"></td>
          <td class="${s.done ? 'ew-subtask-done' : ''}">${escHtml(s.text)} ${buildPriorityBadgeHtml(s)}</td>
          <td>
            <div style="font-weight:500;">${escHtml(s.trip.guestName || 'Unnamed Trip')}</div>
            ${dest ? `<div style="font-size:0.75rem;color:var(--crm-text-2);">${escHtml(dest)}</div>` : ''}
            ${tripDate ? `<div style="font-size:0.7rem;color:var(--crm-text-3);margin-top:0.18rem;">${escHtml(tripDate)}</div>` : ''}
            ${catLabel ? `<div style="font-size:0.7rem;color:var(--crm-text-3);margin-top:0.2rem">[${catLabel}]</div>` : ''}
          </td>
          <td style="color:var(--crm-text-3)">${escHtml(createdAt || '—')}</td>
          <td>
            <div class="ew-remark-thread">${remarkThreadHtml(s)}</div>
            <div class="ew-remark-compose">
              <textarea class="ew-remark-input ew-remark-textarea" rows="2" placeholder="Add remark..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();appendSubtaskRemark('${s.tripId}', '${s.id}', this.value); this.value='';}"></textarea>
              <button type="button" class="ew-remark-send" title="Send remark" aria-label="Send remark" onclick="appendSubtaskRemark('${s.tripId}', '${s.id}', this.parentElement.querySelector('textarea').value); this.parentElement.querySelector('textarea').value='';">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M22 2L11 13"></path>
                  <path d="M22 2L15 22 11 13 2 9 22 2Z"></path>
                </svg>
              </button>
              ${buildDeleteSubtaskButtonHtml(s.tripId, s.id)}
            </div>
          </td>
        </tr>
      `;
    });

    html += `</tbody></table></div>`;
    return html;
  };

  return `
    <div style="display:flex;flex-direction:column;gap:1rem;">
      ${renderSection('Pending', pending, 'No pending subtasks.')}
      ${renderSection('Done', done, 'No completed subtasks yet.', true, doneSubtasksExpanded)}
    </div>
  `;
}

// Timeline View
function renderTimeline(tasks) {
  // Only tasks with dates
  let datedTasks = tasks.filter(t => t.tripDate).sort((a,b) => a.tripDate.localeCompare(b.tripDate));
  if (datedTasks.length === 0) return '<div style="color:var(--crm-text-3);text-align:center;margin-top:2rem;">No dated tasks available for timeline.</div>';
  
  return `
    <div class="ew-timeline">
      ${datedTasks.map(t => `
        <div class="ew-timeline-item">
          <div class="ew-timeline-date">${t.tripDate}</div>
          <div class="ew-timeline-marker"></div>
          <div class="ew-timeline-content">
            ${renderTaskCard(t)}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// Calendar View
function renderCalendar(tasks) {
  // very simple pseudo-calendar for current month of earliest task or today
  return '<div style="color:var(--crm-text-3);text-align:center;margin-top:2rem;padding:2rem;">Calendar visualization not fully implemented yet in this snippet. Please use Timeline.</div>';
}

// ============================================================================
// TASK DETAIL PANEL
// ============================================================================

let currentDetailContext = null;

function openTaskDetail(tripId, taskKey) {
  const trip = trips.find(t => t.id === tripId);
  if (!trip) return;
  
  const tf = taskFields.find(f => f.key === taskKey);
  const status = trip[taskKey] || 'notstarted';
  
  currentDetailContext = { tripId, taskKey };
  
  document.getElementById('ewDetailTripName').textContent = trip.guestName || trip.destination || 'Unnamed Trip';
  document.getElementById('ewDetailTaskType').textContent = tf ? tf.label : taskKey;
  document.getElementById('ewDetailStatusSelect').value = status;
  
  renderDetailSubtasks(trip, taskKey);
  
  document.getElementById('ewDetailOverlay').classList.add('active');
  document.getElementById('ewDetailPanel').classList.add('active');
}

function closeTaskDetail() {
  currentDetailContext = null;
  document.getElementById('ewDetailOverlay').classList.remove('active');
  document.getElementById('ewDetailPanel').classList.remove('active');
}

document.getElementById('ewDetailClose')?.addEventListener('click', closeTaskDetail);
document.getElementById('ewDetailOverlay')?.addEventListener('click', closeTaskDetail);

function renderDetailSubtasks(trip, taskKey) {
  let subsObj = trip.subtasks || {};
  
  const cat = getSubtaskCategory(taskKey);
  const mySubs = (subsObj[cat] || []).filter(s => s.assignee === activeEmployee.name);

// Timeline View
function renderTimeline(tasks) {
  // Only tasks with dates
  let datedTasks = tasks.filter(t => t.tripDate).sort((a,b) => a.tripDate.localeCompare(b.tripDate));
  if (datedTasks.length === 0) return '<div style="color:var(--crm-text-3);text-align:center;margin-top:2rem;">No dated tasks available for timeline.</div>';
  
  return `
    <div class="ew-timeline">
      ${datedTasks.map(t => `
        <div class="ew-timeline-item">
          <div class="ew-timeline-date">${t.tripDate}</div>
          <div class="ew-timeline-marker"></div>
          <div class="ew-timeline-content">
            ${renderTaskCard(t)}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// Calendar View
function renderCalendar(tasks) {
  // very simple pseudo-calendar for current month of earliest task or today
  return '<div style="color:var(--crm-text-3);text-align:center;margin-top:2rem;padding:2rem;">Calendar visualization not fully implemented yet in this snippet. Please use Timeline.</div>';
}

// ============================================================================
// TASK DETAIL PANEL
// ============================================================================

let currentDetailContext = null;

function openTaskDetail(tripId, taskKey) {
  const trip = trips.find(t => t.id === tripId);
  if (!trip) return;
  
  const tf = taskFields.find(f => f.key === taskKey);
  const status = trip[taskKey] || 'notstarted';
  
  currentDetailContext = { tripId, taskKey };
  
  document.getElementById('ewDetailTripName').textContent = trip.guestName || trip.destination || 'Unnamed Trip';
  document.getElementById('ewDetailTaskType').textContent = tf ? tf.label : taskKey;
  document.getElementById('ewDetailStatusSelect').value = status;
  
  renderDetailSubtasks(trip, taskKey);
  
  document.getElementById('ewDetailOverlay').classList.add('active');
  document.getElementById('ewDetailPanel').classList.add('active');
}

function closeTaskDetail() {
  currentDetailContext = null;
  document.getElementById('ewDetailOverlay').classList.remove('active');
  document.getElementById('ewDetailPanel').classList.remove('active');
}

document.getElementById('ewDetailClose')?.addEventListener('click', closeTaskDetail);
document.getElementById('ewDetailOverlay')?.addEventListener('click', closeTaskDetail);

function renderDetailSubtasks(trip, taskKey) {
  let subsObj = trip.subtasks || {};
  
  const cat = getSubtaskCategory(taskKey);
  const mySubs = (subsObj[cat] || []).filter(s => s.assignee === activeEmployee.name);
  
  const el = document.getElementById('ewDetailSubtaskList');
  if (mySubs.length === 0) {
    el.innerHTML = '<div style="font-size:0.8rem;color:var(--crm-text-3)">No subtasks for you on this trip.</div>';
  } else {
    el.innerHTML = mySubs.map(s => buildDetailSubtaskHtml(trip, s)).join('');
  }
}

// API Updates
const updateQueue = {};

async function updateTripField(tripId, field, value) {
  const trip = trips.find(x => x.id === tripId);
  if (!trip) return;

  const key = `${tripId}_${field}`;
  if (!updateQueue[key]) {
    updateQueue[key] = { snapshot: JSON.parse(JSON.stringify(trip)), resolvers: [] };
  }

  if (field === 'subtasks') trip.subtasks = value;
  else trip[field] = value;
  
  refreshWorkspaceStats();
  if (field === currentDetailContext?.taskKey && currentDetailContext.tripId === tripId) {
    const detailStatus = document.getElementById('ewDetailStatusSelect');
    if (detailStatus) detailStatus.value = value;
  }

  return new Promise((resolve, reject) => {
    updateQueue[key].resolvers.push({ resolve, reject });
    updateQueue[key].value = value;

    clearTimeout(updateQueue[key].timer);
    updateQueue[key].timer = setTimeout(async () => {
      const q = updateQueue[key];
      delete updateQueue[key];
      try {
        await apiJson(`/api/ownership/trips/${tripId}`, {
          method: 'PATCH',
          body: JSON.stringify({ [field]: q.value })
        });
        toast('Saved');
        q.resolvers.forEach(r => r.resolve());
      } catch (e) {
        const idx = trips.findIndex(x => x.id === tripId);
        if (idx !== -1) trips[idx] = q.snapshot;
        refreshWorkspaceStats();
        if (currentDetailContext && currentDetailContext.tripId === tripId) {
          const matched = trips.find(x => x.id === tripId);
          if (matched) {
            document.getElementById('ewDetailStatusSelect').value = matched[currentDetailContext.taskKey] || 'notstarted';
            refreshDetailSubtaskList(matched, currentDetailContext.taskKey);
          }
        }
        renderWorkspace();
        toast('Failed to save', '⚠️');
        q.resolvers.forEach(r => r.reject(e));
      }
    }, 600);
  });
}

async function toggleSubtaskPriority(tripId, subtaskId) {
  const trip = trips.find(t => t.id === tripId);
  if (!trip) return;
  let subsObj = trip.subtasks || {};
  let found = false;
  const now = new Date().toISOString();
  Object.values(subsObj).forEach(arr => {
    if (Array.isArray(arr)) {
      const s = arr.find(x => x.id === subtaskId);
      if (s) {
        if (!s.metadata) s.metadata = {};
        s.metadata.isHighPriority = !s.metadata.isHighPriority;
        s.metadata.priorityUpdatedAt = now;
        found = true;
      }
    }
  });
  if (found) {
    trip.subtasks = subsObj;
    if (currentView === "workspace") {
      renderWorkspace();
    } else {
      replaceSubtaskCardDom(tripId, subtaskId);
    }
    if (currentDetailContext && currentDetailContext.tripId === tripId) {
      refreshDetailSubtaskList(trip, currentDetailContext.taskKey);
    }
    updateTripField(tripId, 'subtasks', subsObj).catch(() => {});
  }
}

async function toggleSubtaskDone(tripId, subtaskId, isDone) {
  const trip = trips.find(t => t.id === tripId);
  if (!trip) return;
  let subsObj = trip.subtasks || {};
  let found = false;
  Object.values(subsObj).forEach(arr => {
    if (Array.isArray(arr)) {
      const s = arr.find(x => x.id === subtaskId);
      if (s) {
        s.done = isDone;
        found = true;
      }
    }
  });
  if (found) {
    trip.subtasks = subsObj;
    if (currentView === "workspace") {
      renderWorkspace();
    } else {
      replaceSubtaskCardDom(tripId, subtaskId);
    }
    if (currentDetailContext && currentDetailContext.tripId === tripId) {
      refreshDetailSubtaskList(trip, currentDetailContext.taskKey);
    }
    updateTripField(tripId, 'subtasks', subsObj).catch(() => {});
  }
}

async function updateSubtaskRemarks(tripId, subtaskId, remarks) {
  return appendSubtaskRemark(tripId, subtaskId, remarks);
}

async function appendSubtaskRemark(tripId, subtaskId, remarks) {
  const trip = trips.find(t => t.id === tripId);
  if (!trip) return;
  let subsObj = trip.subtasks || {};
  let found = false;
  Object.values(subsObj).forEach(arr => {
    if (Array.isArray(arr)) {
      const s = arr.find(x => x.id === subtaskId);
      if (s) {
        if (!s.metadata) s.metadata = {};
        const nextRemarks = normalizeRemarkEntries(s.metadata.remarks);
        const text = String(remarks || '').trim();
        if (text) {
          nextRemarks.push({ text, ts: new Date().toISOString() });
        }
        s.metadata.remarks = nextRemarks;
        found = true;
      }
    }
  });
  if (found) {
    trip.subtasks = subsObj;
    if (currentView === "workspace") {
      renderWorkspace();
    } else {
      replaceSubtaskCardDom(tripId, subtaskId);
    }
    if (currentDetailContext && currentDetailContext.tripId === tripId) {
      refreshDetailSubtaskList(trip, currentDetailContext.taskKey);
    }
    updateTripField(tripId, 'subtasks', subsObj).catch(() => {});
  }
}

async function deleteSubtask(tripId, subtaskId) {
  if (!confirm('Are you sure you want to delete this subtask?')) return;
  const trip = trips.find(t => t.id === tripId);
  if (!trip) return;
  
  let subsObj = trip.subtasks || {};
  let found = false;
  
  Object.keys(subsObj).forEach(cat => {
    if (Array.isArray(subsObj[cat])) {
      const idx = subsObj[cat].findIndex(x => x.id === subtaskId);
      if (idx !== -1) {
        subsObj[cat].splice(idx, 1);
        found = true;
      }
    }
  });
  
  if (found) {
    trip.subtasks = subsObj;
    refreshWorkspaceStats();
    removeSubtaskCardDom(subtaskId);
    if (currentDetailContext && currentDetailContext.tripId === tripId) {
      refreshDetailSubtaskList(trip, currentDetailContext.taskKey);
    }
    updateTripField(tripId, 'subtasks', subsObj).catch(() => {});
  }
}

document.getElementById('ewDetailStatusSelect')?.addEventListener('change', (e) => {
  if (!currentDetailContext) return;
  updateTripField(currentDetailContext.tripId, currentDetailContext.taskKey, e.target.value);
});

document.getElementById('ewDetailCompleteBtn')?.addEventListener('click', () => {
  if (!currentDetailContext) return;
  document.getElementById('ewDetailStatusSelect').value = 'complete';
  updateTripField(currentDetailContext.tripId, currentDetailContext.taskKey, 'complete');
  closeTaskDetail();
});

document.getElementById('ewDetailAddSubtaskBtn')?.addEventListener('click', () => {
  if (!currentDetailContext) return;
  const input = document.getElementById('ewDetailNewSubtaskInput');
  const text = input.value.trim();
  if (!text) return;
  
  const trip = trips.find(t => t.id === currentDetailContext.tripId);
  if (!trip) return;
  
  let subsObj = trip.subtasks || {};
  const cat = getSubtaskCategory(currentDetailContext.taskKey);
  if (!subsObj[cat]) subsObj[cat] = [];
  
  subsObj[cat].push({
    id: 's_' + Date.now(),
    text: text,
    done: false,
    assignee: activeEmployee.name,
    createdAt: new Date().toISOString()
  });

  trip.subtasks = subsObj;
  input.value = '';
  refreshWorkspaceStats();
  refreshDetailSubtaskList(trip, currentDetailContext.taskKey);
  updateTripField(trip.id, 'subtasks', subsObj).catch(() => {});
});

renderSubtasks = function(subtasks) {
  if (subtasks.length === 0) return '<div style="color:var(--crm-text-3);text-align:center;margin-top:2rem;">No subtasks assigned.</div>';

  let html = `<table class="ew-subtasks-table">
    <thead>
      <tr>
        <th style="width:40px">Done</th>
        <th>Subtask</th>
        <th>Trip & Country</th>
        <th>Created</th>
        <th>Remarks</th>
      </tr>
    </thead>
    <tbody>`;

  [...subtasks].sort(compareSubtasksForDisplay).forEach(s => {
    const catLabel = s.taskCategory ? s.taskCategory.charAt(0).toUpperCase() + s.taskCategory.slice(1) : '';
    const dest = s.trip.destination ? s.trip.destination : '';
    const tripDate = s.tripDate ? formatDate(s.tripDate) : '';
    const createdAt = formatCompactDateTime(getSubtaskCreatedAt(s));
    html += `
      <tr class="ew-subtask-row">
        <td><input type="checkbox" ${s.done ? 'checked' : ''} onchange="toggleSubtaskDone('${s.tripId}', '${s.id}', this.checked)"></td>
        <td class="${s.done ? 'ew-subtask-done' : ''}">${escHtml(s.text)} ${buildPriorityBadgeHtml(s)}</td>
        <td>
          <div style="font-weight:500;">${escHtml(s.trip.guestName || 'Unnamed Trip')}</div>
          ${dest ? `<div style="font-size:0.75rem;color:var(--crm-text-2);">${escHtml(dest)}</div>` : ''}
          ${tripDate ? `<div style="font-size:0.7rem;color:var(--crm-text-3);margin-top:0.18rem;">${escHtml(tripDate)}</div>` : ''}
          ${catLabel ? `<div style="font-size:0.7rem;color:var(--crm-text-3);margin-top:0.15rem">[${catLabel}]</div>` : ''}
        </td>
        <td style="color:var(--crm-text-3)">${escHtml(createdAt || '—')}</td>
        <td>
          <div class="ew-remark-thread">${remarkThreadHtml(s)}</div>
          <div class="ew-remark-compose">
            <textarea class="ew-remark-input ew-remark-textarea" rows="2" placeholder="Add remark..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();appendSubtaskRemark('${s.tripId}', '${s.id}', this.value); this.value='';}"></textarea>
            <button type="button" class="ew-remark-send" title="Send remark" aria-label="Send remark" onclick="appendSubtaskRemark('${s.tripId}', '${s.id}', this.parentElement.querySelector('textarea').value); this.parentElement.querySelector('textarea').value='';">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M22 2L11 13"></path>
                <path d="M22 2L15 22 11 13 2 9 22 2Z"></path>
              </svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  return html;
};

renderDetailSubtasks = function(trip, taskKey) {
  const subsObj = trip.subtasks || {};
  const cat = getSubtaskCategory(taskKey);
  const mySubs = (subsObj[cat] || [])
    .filter(s => s.assignee === activeEmployee.name)
    .sort(compareSubtasksForDisplay);
  const el = document.getElementById('ewDetailSubtaskList');
  if (!el) return;

  if (!mySubs.length) {
    el.innerHTML = '<div style="font-size:0.8rem;color:var(--crm-text-3)">No subtasks for you on this trip.</div>';
    return;
  }

  el.innerHTML = mySubs.map(s => `
    <div class="ew-detail-subtask" style="display:flex;flex-direction:column;gap:0.5rem;align-items:stretch;">
      <div style="display:flex;gap:0.5rem;align-items:center;">
        <input type="checkbox" ${s.done ? 'checked' : ''} onchange="toggleSubtaskDone('${trip.id}', '${s.id}', this.checked)">
        <input type="text" class="ew-detail-subtask-text ${s.done ? 'done' : ''}" value="${escHtml(s.text)}" readonly style="flex:1;">
        ${buildDeleteSubtaskButtonHtml(trip.id, s.id)}
      </div>
      <div class="ew-remark-thread">${remarkThreadHtml(s)}</div>
      <div class="ew-remark-compose">
        <textarea class="ew-remark-input ew-remark-textarea" rows="2" placeholder="Add remark..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();appendSubtaskRemark('${trip.id}', '${s.id}', this.value); this.value='';}"></textarea>
        <button type="button" class="ew-remark-send" title="Send remark" aria-label="Send remark" onclick="appendSubtaskRemark('${trip.id}', '${s.id}', this.parentElement.querySelector('textarea').value); this.parentElement.querySelector('textarea').value='';">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M22 2L11 13"></path>
            <path d="M22 2L15 22 11 13 2 9 22 2Z"></path>
          </svg>
        </button>
      </div>
    </div>
  `).join('');
};

// ============================================================================
// EVENT LISTENERS
// ============================================================================

document.querySelectorAll('.ew-tab').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.ew-tab').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    currentTab = e.target.getAttribute('data-view');
    renderWorkspace();
  });
});

document.getElementById('ewSearchInput')?.addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderWorkspace();
});

window.addEventListener('popstate', () => {
  const routeEmployeeId = getRequestedEmployeeId();
  if (!routeEmployeeId) {
    activeEmployee = null;
    selectedTripId = null;
    showView('picker');
    return;
  }

  const matched = employees.find(emp => isSameEmployeeId(emp.id, routeEmployeeId));
  if (matched) {
    activeEmployee = matched;
    currentTab = 'subtasks';
    selectedTripId = null;
    showView('workspace');
    return;
  }

  activeEmployee = null;
  selectedTripId = null;
  cacheActiveEmployeeId('');
  syncEmployeeRoute('', { replace: true });
  showView('picker');
});

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  loadData();
});

renderSubtasks = function(subtasks) {
  if (subtasks.length === 0) return '<div style="color:var(--crm-text-3);text-align:center;margin-top:2rem;">No subtasks assigned.</div>';
  const ordered = [...subtasks].sort(compareSubtasksForDisplay);
  const pending = ordered.filter(s => !s.done);
  const done = ordered.filter(s => s.done);

  const renderCard = (s) => {
    const catLabel = s.taskCategory ? s.taskCategory.charAt(0).toUpperCase() + s.taskCategory.slice(1) : '';
    const dest = s.trip.destination ? s.trip.destination : '';
    const tripDate = s.tripDate ? formatDate(s.tripDate) : '';
    const createdAt = formatCompactDateTime(getSubtaskCreatedAt(s));
    const remarkCount = normalizeRemarkEntries(s.metadata?.remarks).length;
    return `
      <details class="ew-subtask-card" data-subtask-id="${s.id}">
        <summary class="ew-subtask-card-summary">
          <label class="ew-subtask-card-checkwrap" onclick="event.stopPropagation();">
            <input type="checkbox" ${s.done ? 'checked' : ''} onchange="toggleSubtaskDone('${s.tripId}', '${s.id}', this.checked)">
          </label>
          <div class="ew-subtask-card-copy">
            <div class="ew-subtask-card-title ${s.done ? 'ew-subtask-done' : ''}">${escHtml(s.text)}</div>
            <div class="ew-subtask-card-meta">
              <span>${escHtml(s.trip.guestName || 'Unnamed Trip')}</span>
              ${dest ? `<span>${escHtml(dest)}</span>` : ''}
              ${tripDate ? `<span>${escHtml(tripDate)}</span>` : ''}
              ${catLabel ? `<span>[${escHtml(catLabel)}]</span>` : ''}
            </div>
          </div>
          <div class="ew-subtask-card-badges">
            <span class="ew-subtask-card-count">${remarkCount} remark${remarkCount === 1 ? '' : 's'}</span>
            ${buildPriorityToggleHtml(s)}
            <span class="ew-subtask-card-created">${escHtml(createdAt || '—')}</span>
          </div>
        </summary>
        <div class="ew-subtask-card-body">
          <div class="ew-remark-thread">${remarkThreadHtml(s)}</div>
          <div class="ew-remark-compose">
            <textarea class="ew-remark-input ew-remark-textarea" rows="2" placeholder="Add remark..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();appendSubtaskRemark('${s.tripId}', '${s.id}', this.value); this.value='';}"></textarea>
            <button type="button" class="ew-remark-send" title="Send remark" aria-label="Send remark" onclick="appendSubtaskRemark('${s.tripId}', '${s.id}', this.parentElement.querySelector('textarea').value); this.parentElement.querySelector('textarea').value='';">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M22 2L11 13"></path>
                <path d="M22 2L15 22 11 13 2 9 22 2Z"></path>
              </svg>
            </button>
            ${buildDeleteSubtaskButtonHtml(s.tripId, s.id)}
          </div>
        </div>
      </details>
    `;
  };

  const renderSection = (title, items, emptyText) => {
    const isDoneSection = title === 'Done';
    const isOpen = isDoneSection ? doneSubtasksExpanded : true;
    const listIdAttr = title === 'Pending' ? ' id="ewPendingSubtasksList"' : '';
    const sectionInner = `
      <div class="ew-subtask-card-list"${listIdAttr}>
        ${items.map(renderCard).join('')}
      </div>
    `;

    if (!items.length) {
      if (isDoneSection) {
        return `
          <details class="ew-subtask-section ew-subtask-section-collapsible" ${isOpen ? 'open' : ''} ontoggle="setDoneSubtasksExpanded(this.open)">
            <summary class="ew-subtask-section-summary">
              <div class="ew-subtask-section-title">${title} <span class="ew-subtask-section-count">0</span></div>
            </summary>
            <div style="color:var(--crm-text-3);text-align:center;padding:0.9rem 0;font-size:0.82rem;">${emptyText}</div>
          </details>
        `;
      }
      return `
        <div class="ew-subtask-section">
          <div class="ew-subtask-section-title">${title}</div>
          <div style="color:var(--crm-text-3);text-align:center;padding:0.9rem 0;font-size:0.82rem;">${emptyText}</div>
        </div>
      `;
    }

    if (!isDoneSection) {
      return `
        <div class="ew-subtask-section">
          <div class="ew-subtask-section-title">${title} <span class="ew-subtask-section-count">${items.length}</span></div>
          ${sectionInner}
        </div>
      `;
    }

    return `
      <details class="ew-subtask-section ew-subtask-section-collapsible" ${isOpen ? 'open' : ''} ontoggle="setDoneSubtasksExpanded(this.open)">
        <summary class="ew-subtask-section-summary">
          <div class="ew-subtask-section-title">${title} <span class="ew-subtask-section-count">${items.length}</span></div>
        </summary>
        ${sectionInner}
      </details>
    `;
  };

  return `
    <div style="display:flex;flex-direction:column;gap:1rem;">
      ${renderSection('Pending', pending, 'No pending subtasks.')}
      ${renderSection('Done', done, 'No completed subtasks yet.')}
    </div>
  `;
};




