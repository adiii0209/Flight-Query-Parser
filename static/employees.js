// ============================================================================
// Employee Workspace Logic
// ============================================================================

// State
let currentView = 'picker'; // 'picker' | 'workspace'
let activeEmployee = null;
let currentTab = 'subtasks';
let empSearchQuery = '';
let selectedTripId = null;
let doneSubtasksExpanded = false;
let addSubtaskModalMode = 'tripSpecific';
let selectedGenericLabel = null;
let showCustomLabelInput = false;
let employeeWorkspaceBooting = false;
let employeeWorkspaceReady = false;
const EMPLOYEE_TRIPS_CACHE_KEY = 'ownership_trips_cache_v1';
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

function formatDate(d) {
  if (!d) return '-';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getAbsoluteReminderDate(subtask, trip) {
  const reminder = subtask?.metadata?.reminder;
  if (!reminder) return null;
  if (reminder.date) {
    const parts = reminder.date.split('-');
    if (parts.length === 3) {
      return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    }
    return new Date(reminder.date);
  }
  if (reminder.days !== undefined && reminder.days !== null) {
    const baseDateStr = trip?.startDate || subtask?.tripDate;
    if (!baseDateStr) return null;
    const parts = baseDateStr.split('-');
    let d;
    if (parts.length === 3) {
      d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    } else {
      d = new Date(baseDateStr);
    }
    if (isNaN(d.getTime())) return null;
    const days = parseInt(reminder.days, 10);
    d.setDate(d.getDate() - days);
    return d;
  }
  return null;
}

function getCalculatedRelativeDate(baseDateStr, days, dir) {
  if (!baseDateStr) return null;
  const parts = baseDateStr.split('-');
  let d;
  if (parts.length === 3) {
    d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  } else {
    d = new Date(baseDateStr);
  }
  if (isNaN(d.getTime())) return null;
  
  const daysNum = parseInt(days, 10);
  if (isNaN(daysNum)) return null;
  
  if (dir === 'before') {
    d.setDate(d.getDate() - daysNum);
  } else {
    d.setDate(d.getDate() + daysNum);
  }
  return d;
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

function ewFormatReminderDateLabel(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  if (isNaN(d.getTime())) return dateStr;
  if (d.getTime() === today.getTime()) return 'Due today';
  if (d.getTime() === tomorrow.getTime()) return 'Due tomorrow';
  return 'Due ' + new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
}

function ewReminderLabel(reminder) {
  if (!reminder) return '';
  if (reminder.date) {
    const label = ewFormatReminderDateLabel(reminder.date);
    return reminder.recurring ? `${label} · Recurring` : label;
  }
  const days = parseInt(reminder.days, 10);
  if (!days) return '';
  const dir = days < 0 ? 'after' : 'before';
  return Math.abs(days) + ' days ' + dir;
}

function isRecurringSubtask(subtask) {
  return !!(subtask && subtask.metadata && subtask.metadata.reminder && subtask.metadata.reminder.recurring);
}

function buildReminderBadgeHtml(subtask) {
  const reminder = subtask && subtask.metadata && subtask.metadata.reminder;
  if (!reminder) return '';
  const trip = trips.find(t => t.id === subtask.tripId);
  const d = getAbsoluteReminderDate(subtask, trip);
  if (!d) return '';

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const compDate = new Date(d); compDate.setHours(0, 0, 0, 0);
  
  // Icon color: red for today or gone, blue for upcoming
  const isRed = compDate.getTime() <= today.getTime();
  const iconColor = isRed ? '#ef4444' : '#3b82f6';
  
  // Calendar icon SVG
  const calendarIconHtml = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="' + iconColor + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 0.35rem; vertical-align: middle; flex-shrink: 0;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';
  
  // Simple, neutral badge styling
  const color = 'var(--crm-text-3)';
  const bg = 'transparent';
  
  const label = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
  
  return '<span class="ew-reminder-badge' + (reminder.recurring ? ' is-recurring' : '') + '" style="color:' + color + ';background:' + bg + '; font-size:0.66rem; font-weight:700; padding:0.14rem 0; border-radius:999px; white-space:nowrap; display:inline-flex; align-items:center;">' + escHtml(label) + calendarIconHtml + '</span>';
}

function openEwSubtaskReminderModal(tripId, subtaskId, isNewAdd = false) {
  let trip = null;
  let sub = null;
  
  if (tripId) {
    trip = trips.find(function(t) { return t.id === tripId; });
    if (!trip) return;
    Object.values(trip.subtasks || {}).forEach(function(arr) {
      if (Array.isArray(arr)) { const s = arr.find(function(x) { return x.id === subtaskId; }); if (s) sub = s; }
    });
  } else {
    // Generic task
    if (!activeEmployee || !activeEmployee.subtasks) return;
    Object.values(activeEmployee.subtasks).forEach(function(arr) {
      if (Array.isArray(arr)) { const s = arr.find(function(x) { return x.id === subtaskId; }); if (s) sub = s; }
    });
  }
  
  if (!sub && !isNewAdd) return;

  const BELL = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path><path d="M18 8A6 6 0 0 0 6 8c0 7-3 7-3 9h18c0-2-3-2-3-9"></path></svg>';
  let modal = document.getElementById('ewSubtaskReminderModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'crm-mini-modal-overlay';
    modal.id = 'ewSubtaskReminderModal';
    modal.innerHTML =
      '<div class="crm-mini-modal" role="dialog" aria-modal="true">' +
        '<div class="crm-mini-modal-title">' + BELL + '<span>Subtask Reminder</span></div>' +
        '<div class="crm-reminder-row" style="gap:0.4rem;">' +
          '<span style="font-size:0.75rem;color:var(--crm-text-3);">Type</span>' +
          '<select id="ewSubtaskReminderType" class="crm-form-input" style="padding:0.2rem 0.4rem;height:auto;width:auto;font-size:0.75rem;">' +
            '<option value="date">On specific date</option>' +
            '<option value="recurring">Recurring</option>' +
            '<option value="relative">Days before/after trip</option>' +
          '</select>' +
        '</div>' +
        '<div id="ewSubtaskReminderFreqRow" class="crm-reminder-row" style="display:none;gap:0.4rem;">' +
          '<span style="font-size:0.75rem;color:var(--crm-text-3);">Freq</span>' +
          '<input type="number" id="ewSubtaskReminderFreqDays" class="crm-form-input" min="1" max="1000" value="30" style="padding:0.2rem 0.4rem;height:auto;width:3rem;font-size:0.75rem;">' +
          '<span style="font-size:0.75rem;color:var(--crm-text-3);">days</span>' +
          '<span id="ewSubtaskReminderFreqLabel" style="font-size:0.75rem;font-weight:600;color:var(--crm-primary);">Monthly</span>' +
          '<span style="font-size:0.75rem;color:var(--crm-text-3);margin-left:0.5rem;">Show in pending</span>' +
          '<input type="number" id="ewSubtaskReminderTrigger" min="0" max="365" value="0" style="font-size:0.75rem;height:auto;padding:0.2rem 0.4rem;width:3rem;">' +
          '<span style="font-size:0.75rem;color:var(--crm-text-3);">days before</span>' +
        '</div>' +
        '<div id="ewSubtaskReminderDateRow" class="crm-reminder-row">' +
          '<span id="ewSubtaskReminderDateLabel" style="font-size:0.75rem;color:var(--crm-text-3);">Date</span>' +
          '<input type="date" id="ewSubtaskReminderDate" class="crm-form-input" style="font-size:0.75rem;height:auto;padding:0.2rem 0.4rem;">' +
        '</div>' +
        '<div id="ewSubtaskReminderRelativeRow" class="crm-reminder-row" style="display:none;">' +
          '<span style="font-size:0.75rem;color:var(--crm-text-3);">Alert</span>' +
          '<input type="number" id="ewSubtaskReminderDays" min="1" max="180" value="7" style="font-size:0.75rem;height:auto;padding:0.2rem 0.4rem;width:4rem;">' +
          '<select id="ewSubtaskReminderDir" class="crm-form-input" style="padding:0.2rem 0.4rem;height:auto;width:auto;font-size:0.75rem;">' +
            '<option value="before">days before trip</option>' +
            '<option value="after">days after trip</option>' +
          '</select>' +
        '</div>' +
        '<div id="ewSubtaskReminderCalcDateRow" style="font-size:0.7rem;color:var(--crm-primary);margin-top:0.35rem;text-align:right;display:none;">' +
          'Target Date: <span id="ewSubtaskReminderCalcDateVal" style="font-weight:700;">—</span>' +
        '</div>' +
        '<div class="crm-mini-modal-actions">' +
          '<button class="crm-btn crm-btn-ghost" id="clearEwSubtaskReminder">Clear</button>' +
          '<button class="crm-btn crm-btn-ghost" id="cancelEwSubtaskReminder">Cancel</button>' +
          '<button class="crm-btn crm-btn-primary" id="saveEwSubtaskReminder">Save</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
  }

  const currentReminder = isNewAdd ? pendingEwAddSubtaskReminder : (sub.metadata && sub.metadata.reminder);
  const typeSelect = document.getElementById('ewSubtaskReminderType');
  const dateRow = document.getElementById('ewSubtaskReminderDateRow');
  const relRow = document.getElementById('ewSubtaskReminderRelativeRow');
  const todayStr = new Date().toISOString().slice(0, 10);

  function _updateCalcDate() {
    let days = parseInt(document.getElementById('ewSubtaskReminderDays').value, 10);
    if (isNaN(days) || days < 1) {
      document.getElementById('ewSubtaskReminderCalcDateVal').textContent = '—';
      return;
    }
    const dir = document.getElementById('ewSubtaskReminderDir').value;
    const calculatedDate = getCalculatedRelativeDate(trip.startDate, days, dir);
    if (calculatedDate) {
      document.getElementById('ewSubtaskReminderCalcDateVal').textContent = formatDate(calculatedDate);
    } else {
      document.getElementById('ewSubtaskReminderCalcDateVal').textContent = '—';
    }
  }

  function _syncView() {
    const isDate = typeSelect.value === 'date' || typeSelect.value === 'recurring';
    const isRecurring = typeSelect.value === 'recurring';
    document.getElementById('ewSubtaskReminderDateRow').style.display = isDate ? '' : 'none';
    document.getElementById('ewSubtaskReminderRelativeRow').style.display = typeSelect.value === 'relative' ? '' : 'none';
    document.getElementById('ewSubtaskReminderFreqRow').style.display = isRecurring ? '' : 'none';

    if (isDate) {
      document.getElementById('ewSubtaskReminderDateLabel').textContent = isRecurring ? 'Next Date' : 'Date';
    }
    const calcRow = document.getElementById('ewSubtaskReminderCalcDateRow');
    if (typeSelect.value === 'relative') {
      calcRow.style.display = '';
      _updateCalcDate();
    } else {
      calcRow.style.display = 'none';
    }
  }
  
  typeSelect.onchange = _syncView;
  document.getElementById('ewSubtaskReminderDays').oninput = _updateCalcDate;
  document.getElementById('ewSubtaskReminderDir').onchange = _updateCalcDate;

  // Auto-update trigger default when frequency changes
  const updateFreqLabelAndTrigger = function(days) {
    let lbl = 'Custom'; let trig = 2;
    if (days === 1) { lbl = 'Daily'; trig = 0; }
    else if (days === 7) { lbl = 'Weekly'; trig = 2; }
    else if (days >= 28 && days <= 31) { lbl = 'Monthly'; trig = 7; }
    else if (days >= 365) { lbl = 'Yearly'; trig = 7; }
    return { lbl, trig };
  };

  document.getElementById('ewSubtaskReminderFreqDays').oninput = function() {
    const d = parseInt(this.value, 10);
    if (isNaN(d) || d < 1) return;
    const { lbl, trig } = updateFreqLabelAndTrigger(d);
    document.getElementById('ewSubtaskReminderFreqLabel').textContent = lbl;
    document.getElementById('ewSubtaskReminderTrigger').value = trig;
  };

  if (currentReminder) {
    if (currentReminder.recurring) {
      typeSelect.value = 'recurring';
      const fDays = currentReminder.frequencyDays || 30;
      document.getElementById('ewSubtaskReminderFreqDays').value = fDays;
      const { lbl } = updateFreqLabelAndTrigger(fDays);
      document.getElementById('ewSubtaskReminderFreqLabel').textContent = lbl;
      document.getElementById('ewSubtaskReminderTrigger').value = currentReminder.triggerDaysBefore ?? updateFreqLabelAndTrigger(fDays).trig;
    } else if (currentReminder.days !== undefined) {
      typeSelect.value = 'relative';
      document.getElementById('ewSubtaskReminderDays').value = Math.abs(currentReminder.days);
      document.getElementById('ewSubtaskReminderDir').value = currentReminder.days < 0 ? 'after' : 'before';
    } else {
      typeSelect.value = 'date';
    }
    document.getElementById('ewSubtaskReminderDate').value = currentReminder.date || todayStr;
  } else {
    typeSelect.value = 'date';
    document.getElementById('ewSubtaskReminderDate').value = todayStr;
  }
  _syncView();
  modal.dataset.tripId = tripId;
  modal.dataset.subtaskId = subtaskId;
  modal.classList.add('open');
  modal.onclick = function(e) { if (e.target === modal) modal.classList.remove('open'); };

  document.getElementById('cancelEwSubtaskReminder').onclick = function() { modal.classList.remove('open'); };
  document.getElementById('clearEwSubtaskReminder').onclick = function() {
    modal.classList.remove('open');
    if (isNewAdd) {
      pendingEwAddSubtaskReminder = null;
      document.getElementById('ewAddSubtaskReminderBtn')?.classList.remove('active');
      return;
    }
    if (!sub.metadata) sub.metadata = {};
    delete sub.metadata.reminder;
    if (tripId) {
      updateTripField(tripId, 'subtasks', trip.subtasks).catch(function() {});
    } else if (activeEmployee) {
      apiJson(`/api/ownership/employees/${activeEmployee.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ subtasks: activeEmployee.subtasks })
      }).catch(err => console.error(err));
    }
    if (currentView === "workspace") {
      renderWorkspace();
    } else {
      replaceSubtaskCardDom(tripId, subtaskId);
    }
    if (currentDetailContext && currentDetailContext.tripId === tripId) refreshDetailSubtaskList(trip, currentDetailContext.taskKey);
  };
  document.getElementById('saveEwSubtaskReminder').onclick = function() {
    let newRem = null;
    if (!isNewAdd && !sub.metadata) sub.metadata = {};
    const type = document.getElementById('ewSubtaskReminderType').value;
    if (type === 'date') {
      const dateVal = document.getElementById('ewSubtaskReminderDate').value;
      if (!dateVal) return;
      newRem = { date: dateVal, label: dateVal };
    } else if (type === 'recurring') {
      const dateVal = document.getElementById('ewSubtaskReminderDate').value;
      if (!dateVal) return;
      const fDays = parseInt(document.getElementById('ewSubtaskReminderFreqDays').value, 10) || 30;
      const trig = parseInt(document.getElementById('ewSubtaskReminderTrigger').value, 10) || 0;
      newRem = { date: dateVal, label: dateVal, recurring: true, frequencyDays: fDays, triggerDaysBefore: trig };
    } else {
      let days = parseInt(document.getElementById('ewSubtaskReminderDays').value, 10);
      if (isNaN(days) || days < 1) return;
      const dir = document.getElementById('ewSubtaskReminderDir').value;
      
      const targetDate = trip ? getCalculatedRelativeDate(trip.startDate, days, dir) : null;
      let dateVal = '';
      if (targetDate) {
        const year = targetDate.getFullYear();
        const month = String(targetDate.getMonth() + 1).padStart(2, '0');
        const dateDay = String(targetDate.getDate()).padStart(2, '0');
        dateVal = `${year}-${month}-${dateDay}`;
      }
      
      if (dir === 'after') days = -days;
      newRem = { days: days, date: dateVal, label: dateVal || `${Math.abs(days)} days ${dir}` };
    }
    modal.classList.remove('open');
    if (isNewAdd) {
      pendingEwAddSubtaskReminder = newRem;
      document.getElementById('ewAddSubtaskReminderBtn')?.classList.add('active');
      return;
    }
    sub.metadata.reminder = newRem;
    if (tripId) {
      updateTripField(tripId, 'subtasks', trip.subtasks).catch(function() {});
    } else if (activeEmployee) {
      apiJson(`/api/ownership/employees/${activeEmployee.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ subtasks: activeEmployee.subtasks })
      }).catch(err => console.error(err));
    }
    if (currentView === "workspace") {
      renderWorkspace();
    } else {
      replaceSubtaskCardDom(tripId, subtaskId);
    }
    if (currentDetailContext && currentDetailContext.tripId === tripId) refreshDetailSubtaskList(trip, currentDetailContext.taskKey);
  };
}

window.openEwSubtaskReminderModal = openEwSubtaskReminderModal;

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

  const getReminderDate = (s) => {
    const trip = trips.find(t => t.id === s.tripId);
    const d = getAbsoluteReminderDate(s, trip);
    return d ? d.getTime() : 9999999999999;
  };

  const aDue = getReminderDate(a);
  const bDue = getReminderDate(b);
  if (aDue !== bDue) return aDue - bDue;

  const aTime = Date.parse(getSubtaskPrioritySortStamp(a)) || 0;
  const bTime = Date.parse(getSubtaskPrioritySortStamp(b)) || 0;
  if (aTime !== bTime) return bTime - aTime;
  return String(a.text || '').localeCompare(String(b.text || ''));
}

function buildSubtaskCardHtml(s) {
  const catLabel = s.taskCategory ? s.taskCategory.charAt(0).toUpperCase() + s.taskCategory.slice(1) : '';
  const dest = s.trip && s.trip.destination ? s.trip.destination : '';
  const tripDate = s.tripDate ? formatDate(s.tripDate) : '';
  const createdAt = formatCompactDateTime(getSubtaskCreatedAt(s));
  const remarkCount = normalizeRemarkEntries(s.metadata?.remarks).length;
  const reminderBadge = buildReminderBadgeHtml(s);
  let recurringBadge = '';
  if (isRecurringSubtask(s) || (s.metadata && s.metadata.wasRecurring)) {
    const rem = (s.metadata && s.metadata.reminder) || {};
    const fDays = rem.frequencyDays || 30;
    const freqText = fDays === 1 ? 'Daily' : fDays === 7 ? 'Weekly' : fDays === 30 ? 'Monthly' : fDays === 365 ? 'Yearly' : `Every ${fDays} days`;
    recurringBadge = `<span class="ew-recurring-badge" style="display:inline-flex; align-items:center; gap:0.25rem; background:var(--crm-surface-1); padding:0.1rem 0.4rem; border-radius:999px; color:var(--crm-text-2); font-weight:600;"><span style="display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; background:#10b981; color:#fff; border-radius:50%; font-size:0.6rem;">R</span> <span style="font-size:0.65rem;">${freqText}</span></span>`;
  }
  const hasReminder = !!(s.metadata && s.metadata.reminder);
  const reminderTitle = hasReminder ? escHtml(ewReminderLabel(s.metadata.reminder)) : 'Set reminder';
  return `
    <details class="ew-subtask-card" data-subtask-id="${escHtml(s.id)}">
      <summary class="ew-subtask-card-summary">
        <label class="ew-subtask-card-checkwrap" onclick="event.stopPropagation();">
          <input type="checkbox" ${s.done ? 'checked' : ''} onchange="toggleSubtaskDone('${s.tripId || ''}', '${s.id}', this.checked)">
        </label>
        <div class="ew-subtask-card-copy">
          <div class="ew-subtask-card-title ${s.done ? 'ew-subtask-done' : ''}">${escHtml(s.text)}</div>
          <div class="ew-subtask-card-meta">
            ${s.trip && s.trip.masterSheetUrl ? `<a href="${escHtml(s.trip.masterSheetUrl)}" target="_blank" onclick="event.stopPropagation();" title="Open Mastersheet" style="color:var(--crm-primary); text-decoration:none; display:inline-flex; align-items:center; gap:0.2rem;"><span style="text-decoration:underline;">${escHtml(s.trip.guestName || 'Unnamed Trip')}</span> <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a>` : `<span>${escHtml(s.trip ? s.trip.guestName || 'Unnamed Trip' : s.tripName || 'Generic Task')}</span>`}
            ${dest ? `<span>${escHtml(dest)}</span>` : ''}
            ${tripDate ? `<span>${escHtml(tripDate)}</span>` : ''}
            ${catLabel ? `<span>[${escHtml(catLabel)}]</span>` : ''}
          </div>
        </div>
          <div class="ew-subtask-card-badges-wrap" style="display:flex; flex-direction:column; align-items:flex-end; gap:0.4rem; flex-shrink:0;">
            <div class="ew-subtask-card-badges" style="display:flex; align-items:center; gap:0.35rem; flex-shrink:0; flex-wrap:wrap; justify-content:flex-end;">
              ${recurringBadge}
              ${buildPriorityToggleHtml(s)}
              <button type="button" class="ew-subtask-reminder-btn ${hasReminder ? 'active' : ''}" style="border:none; background:none; padding:0; cursor:pointer; display:flex; align-items:center; flex-shrink:0; width:auto; height:auto;" title="${reminderTitle}" aria-label="Set subtask reminder" onclick="event.stopPropagation(); openEwSubtaskReminderModal('${s.tripId}', '${s.id}')">
                ${reminderBadge || '<span class="ew-reminder-badge" style="color:var(--crm-text-3);background:transparent; font-size:0.66rem; font-weight:700; padding:0.14rem 0; border-radius:999px; white-space:nowrap;">Set Reminder</span>'}
              </button>
            </div>
            <div style="display:flex; align-items:center; justify-content:flex-end; gap:0.35rem; flex-shrink:0;">
              <span class="ew-subtask-card-count" style="flex-shrink:0;">${remarkCount} remark${remarkCount === 1 ? '' : 's'}</span>
            </div>
          </div>
      </summary>
      <div class="ew-subtask-card-body">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.5rem; gap:1rem;">
          <div class="ew-remark-thread" style="flex:1;">${remarkThreadHtml(s)}</div>
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:0.25rem; flex-shrink:0; margin-top:0.15rem;">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <div style="font-size:0.7rem; color:var(--crm-text-3);">Created: ${escHtml(createdAt || '\u2014')}</div>
              ${buildDeleteSubtaskButtonHtml(s.tripId, s.id)}
            </div>
            ${s.doneAt ? `<div style="font-size:0.7rem; color:#10b981; font-weight:600;">Completed: ${escHtml(formatCompactDateTime(s.doneAt))}</div>` : ''}
          </div>
        </div>
        <div class="ew-remark-compose">
          <textarea class="ew-remark-input ew-remark-textarea" rows="2" placeholder="Add remark..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();appendSubtaskRemark('${s.tripId}', '${s.id}', this.value); this.value='';}"></textarea>
            <button type="button" class="ew-remark-send" title="Send remark" aria-label="Send remark" onclick="appendSubtaskRemark('${s.tripId}', '${s.id}', this.parentElement.querySelector('textarea').value); this.parentElement.querySelector('textarea').value='';">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M22 2L11 13"></path>
                <path d="M22 2L15 22 11 13 2 9 22 2Z"></path>
              </svg>
            </button>

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
          <div class="ew-remark-bubble" style="flex-direction:row; align-items:flex-start; justify-content:space-between; margin-bottom: 0.25rem;">
            <div style="display:flex; align-items:baseline; gap:0.5rem; flex:1; flex-wrap:wrap;">
              <div class="ew-remark-text" style="flex:1 1 auto; margin-bottom:0;">${escHtml(r.text)}</div>
              ${r.ts ? `<div class="ew-remark-meta" style="flex-shrink:0;">${escHtml(formatCompactDateTime(r.ts))}</div>` : ''}
            </div>
            <div style="position:relative; margin-left:0.5rem; flex-shrink:0;">
              <button type="button" style="background:none; border:none; cursor:pointer; color:var(--crm-text-3); font-size:1.1rem; line-height:1; padding:0 0.2rem;" onclick="event.stopPropagation(); const m = this.nextElementSibling; const isVis = m.style.display==='block'; document.querySelectorAll('.ew-remark-menu').forEach(x=>x.style.display='none'); if(!isVis){ m.style.display='block'; const rect = m.getBoundingClientRect(); if(rect.bottom > window.innerHeight){ m.style.top='auto'; m.style.bottom='100%'; } else { m.style.top='100%'; m.style.bottom='auto'; } }">⋮</button>
              <div class="ew-remark-menu" style="display:none; position:absolute; right:0; top:100%; background:var(--crm-bg); border:1px solid var(--crm-border); border-radius:4px; padding:0.25rem; z-index:1000; box-shadow:0 2px 5px rgba(0,0,0,0.1); min-width:80px;" onclick="event.stopPropagation();">
                <button type="button" style="display:block; width:100%; text-align:left; background:none; border:none; padding:0.25rem 0.5rem; font-size:0.75rem; cursor:pointer; color:var(--crm-text-1);" onmouseover="this.style.background='var(--crm-surface-2)'" onmouseout="this.style.background='none'" onclick="editSubtaskRemark('${subtask?.tripId}', '${subtask?.id}', ${idx})">Edit</button>
                <button type="button" style="display:block; width:100%; text-align:left; background:none; border:none; padding:0.25rem 0.5rem; font-size:0.75rem; cursor:pointer; color:var(--crm-danger);" onmouseover="this.style.background='var(--crm-surface-2)'" onmouseout="this.style.background='none'" onclick="deleteSubtaskRemark('${subtask?.tripId}', '${subtask?.id}', ${idx})">Delete</button>
              </div>
            </div>
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
  if (!tripId) return _handleGenericSubtaskUpdate(subtaskId, (s) => {
    const current = normalizeRemarkEntries(s.metadata?.remarks)[remarkIndex];
    if (!current) return;
    const nextText = window.prompt('Edit remark', current.text || '');
    if (nextText === null) return;
    const trimmed = String(nextText).trim();
    if (!trimmed) { toast('Remark cannot be empty', '??'); return; }
    if (!s.metadata) s.metadata = {};
    const next = normalizeRemarkEntries(s.metadata.remarks);
    if (next[remarkIndex]) next[remarkIndex] = { ...next[remarkIndex], text: trimmed };
    s.metadata.remarks = next;
  });
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
  if (!tripId) {
    if (!confirm('Delete this remark?')) return;
    return _handleGenericSubtaskUpdate(subtaskId, (s) => {
      if (!s.metadata) s.metadata = {};
      const next = normalizeRemarkEntries(s.metadata.remarks);
      if (next[remarkIndex]) next.splice(remarkIndex, 1);
      s.metadata.remarks = next;
    });
  }
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
  pending: '#f59e0b',
  ongoing: '#3b82f6',
  complete: '#10b981',
  notrequired: '#94a3b8'
};

const statusLabels = {
  pending: 'Pending',
  ongoing: 'In Progress',
  complete: 'Completed',
  notrequired: 'Not Required'
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
    return trips.length > 0 && employees.length > 0;
  } catch (err) {
    localStorage.removeItem(EMPLOYEE_TRIPS_CACHE_KEY);
    localStorage.removeItem(EMPLOYEE_EMPLOYEES_CACHE_KEY);
    return false;
  }
}

function setEmployeeWorkspaceLoading(isLoading) {
  const screen = document.getElementById('employeePickerScreen');
  if (!screen) return;
  const onEmployeeRoute = window.location.pathname.startsWith('/ownership/employees');
  screen.classList.toggle('is-loading', !!isLoading && onEmployeeRoute);
  screen.style.display = isLoading && onEmployeeRoute ? 'flex' : 'none';
  const boot = document.getElementById('empPickerBoot');
  if (boot) boot.style.display = isLoading && onEmployeeRoute ? 'flex' : 'none';
  const content = screen.querySelector('.emp-picker-content');
  if (content) {
    content.setAttribute('aria-hidden', isLoading && onEmployeeRoute ? 'true' : 'false');
  }
}

function resolveEmployeeWorkspaceRoute({ replace = true } = {}) {
  const initialRequestedId = getRequestedEmployeeId();
  if (initialRequestedId) {
    const matched = employees.find(emp => isSameEmployeeId(emp.id, initialRequestedId));
    if (matched) {
      employeeWorkspaceBooting = false;
      employeeWorkspaceReady = true;
      setEmployeeWorkspaceLoading(false);
      activateEmployeeById(matched.id, { replaceRoute: replace, animate: false });
      return true;
    }
    cacheActiveEmployeeId('');
    syncEmployeeRoute('', { replace });
    employeeWorkspaceBooting = false;
    employeeWorkspaceReady = true;
    setEmployeeWorkspaceLoading(false);
    showView('picker');
    return true;
  }

  employeeWorkspaceBooting = false;
  employeeWorkspaceReady = true;
  setEmployeeWorkspaceLoading(false);
  if (currentView === 'picker') showView('picker');
  else if (activeEmployee) showView('workspace');
  else showView('picker');
  return true;
}

function activateEmployeeById(employeeId, { replaceRoute = false, animate = false } = {}) {
  const emp = employees.find(x => isSameEmployeeId(x.id, employeeId));
  if (!emp) return false;

  activeEmployee = emp;
  employeeWorkspaceBooting = false;
  employeeWorkspaceReady = true;
  currentTab = 'subtasks';
  selectedTripId = null;
  cacheActiveEmployeeId(emp.id);
  syncEmployeeRoute(emp.id, { replace: replaceRoute });
  setEmployeeWorkspaceLoading(false);

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

function initEmployeeWorkspace() {
  const hasEmployeeData = Array.isArray(employees) && employees.length > 0;
  if (!hasEmployeeData) {
    employeeWorkspaceBooting = true;
    employeeWorkspaceReady = false;
    setEmployeeWorkspaceLoading(true);
    return false;
  }
  return resolveEmployeeWorkspaceRoute({ replace: true });
}

function refreshEmployeeWorkspaceFromOwnership() {
  if (!window.location.pathname.startsWith('/ownership/employees')) return false;
  if (!Array.isArray(employees) || employees.length === 0) {
    employeeWorkspaceBooting = true;
    employeeWorkspaceReady = false;
    setEmployeeWorkspaceLoading(true);
    return false;
  }
  if (employeeWorkspaceBooting || !employeeWorkspaceReady) {
    return resolveEmployeeWorkspaceRoute({ replace: true });
  }
  const initialRequestedId = getRequestedEmployeeId();
  if (initialRequestedId) return resolveEmployeeWorkspaceRoute({ replace: true });
  if (currentView === 'workspace' && activeEmployee) {
    showView('workspace');
    return true;
  }
  showView('picker');
  return true;
}

window.syncEmployeeWorkspaceData = refreshEmployeeWorkspaceFromOwnership;

// ============================================================================
// PICKER VIEW
// ============================================================================

function showView(view) {
  const crmPage = document.getElementById('crmPage');
  if (crmPage) crmPage.style.display = 'none';

  document.getElementById('employeePickerScreen').style.display = view === 'picker' ? 'flex' : 'none';
  document.getElementById('employeeWorkspace').style.display = view === 'workspace' ? 'flex' : 'none';
  currentView = view;
  
  if (view === 'picker') {
    setTimeout(renderPicker, 0);
  } else if (view === 'workspace') {
    setTimeout(renderWorkspace, 0);
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
          <div class="emp-edit-badge" onclick="event.stopPropagation(); openEditEmployeeModal('${emp.id}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </div>
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

window.openEditEmployeeModal = function(id) {
  const emp = employees.find(e => e.id === id);
  if (!emp) return;

  let modal = document.getElementById('ewEditEmployeeModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'crm-modal-overlay';
    modal.id = 'ewEditEmployeeModal';
    modal.style.zIndex = '10000';
    modal.innerHTML = `
      <div class="crm-modal" role="dialog" aria-modal="true" style="max-width:400px;">
        <div class="crm-modal-header">
          <div><div class="crm-modal-title">Edit Profile</div></div>
          <button class="crm-modal-close" onclick="document.getElementById('ewEditEmployeeModal').classList.remove('open')">✕</button>
        </div>
        <div class="crm-modal-body" style="display:flex; flex-direction:column; gap:1rem;">
          <div class="crm-form-group">
            <label class="crm-form-label">Name</label>
            <input type="text" class="crm-form-input" id="ewEditEmpName">
          </div>
          <div class="crm-form-group">
            <label class="crm-form-label">Color Hex</label>
            <div style="display:flex; gap:0.5rem; align-items:center;">
              <input type="color" id="ewEditEmpColorPicker" style="width: 36px; height: 36px; padding: 0; border: none; cursor: pointer; border-radius: var(--crm-radius);">
              <input type="text" class="crm-form-input" id="ewEditEmpColor" placeholder="#000000" style="flex:1;">
            </div>
          </div>
          <div class="crm-form-group">
            <label class="crm-form-label">Domain</label>
            <select class="crm-form-select" id="ewEditEmpDomain">
              <option value="">None</option>
              <option value="Travel">Travel</option>
              <option value="Accounts">Accounts</option>
              <option value="Tech">Tech</option>
              <option value="Sales & Marketing">Sales & Marketing</option>
              <option value="HR">HR</option>
            </select>
          </div>
        </div>
        <div class="crm-modal-footer">
          <button class="crm-btn crm-btn-ghost" onclick="document.getElementById('ewEditEmployeeModal').classList.remove('open')">Cancel</button>
          <button class="crm-btn crm-btn-primary" id="ewEditEmpSaveBtn">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  document.getElementById('ewEditEmpName').value = emp.name;
  
  const colorPicker = document.getElementById('ewEditEmpColorPicker');
  const colorInput = document.getElementById('ewEditEmpColor');
  colorInput.value = emp.color || '';
  if (/^#[0-9A-Fa-f]{6}$/.test(emp.color)) {
    colorPicker.value = emp.color;
  } else {
    colorPicker.value = '#000000';
  }

  colorPicker.oninput = () => { colorInput.value = colorPicker.value; };
  colorInput.oninput = () => {
    if (/^#[0-9A-Fa-f]{6}$/.test(colorInput.value)) {
      colorPicker.value = colorInput.value;
    }
  };

  document.getElementById('ewEditEmpDomain').value = emp.domain || '';
  
  const saveBtn = document.getElementById('ewEditEmpSaveBtn');
  saveBtn.onclick = async () => {
    const newName = document.getElementById('ewEditEmpName').value.trim();
    const newColor = document.getElementById('ewEditEmpColor').value.trim();
    const newDomain = document.getElementById('ewEditEmpDomain').value;
    if (!newName) return toast('Name required', '⚠️');
    
    try {
      const res = await apiJson('/api/ownership/employees/' + emp.id, {
        method: 'PATCH',
        body: JSON.stringify({ name: newName, color: newColor, domain: newDomain })
      });
      if (res.employee) {
        Object.assign(emp, res.employee);
        renderPicker();
        if (activeEmployee && isSameEmployeeId(activeEmployee.id, emp.id)) {
          activeEmployee = emp; // update active reference if needed
        }
        modal.classList.remove('open');
        isEditMode = false;
        document.querySelectorAll('.emp-card').forEach(c => c.classList.remove('edit-mode'));
        const manageBtn = document.getElementById('empManageBtn');
        if (manageBtn) manageBtn.textContent = 'Manage Profiles';
        toast('Profile updated');
      }
    } catch (e) {
      toast('Failed to update profile', '⚠️');
    }
  };

  modal.classList.add('open');
};

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
  const targetDomain = document.getElementById('ewUserDomain');
  
  // Pre-fill target header
  targetAvatar.textContent = activeEmployee.name.charAt(0).toUpperCase();
  targetAvatar.style.background = activeEmployee.name.trim().toLowerCase() === 'c k' ? '#2563eb' : (activeEmployee.color || employeeColor(activeEmployee.name));
  targetName.textContent = activeEmployee.name;
  if (targetDomain) {
    targetDomain.textContent = activeEmployee.domain || '';
    targetDomain.style.display = activeEmployee.domain ? '' : 'none';
  }
  
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

function normalizeEmployeeTaskStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'pending';
  const normalized = raw.replace(/\s+/g, '');
  if (normalized === 'completed') return 'complete';
  if (normalized === 'inprogress') return 'ongoing';
  if (normalized === 'notrequired') return 'notrequired';
  return ['pending', 'ongoing', 'complete', 'notrequired'].includes(normalized) ? normalized : 'pending';
}

function getEmployeeData() {
  if (!activeEmployee) return { tasks: [], subtasks: [], recurringSubtasks: [], stats: {} };
  
  const empName = activeEmployee.name;
  let allTasks = [];
  let allSubtasks = [];
  let allRecurringSubtasks = [];
  let tripCount = 0;
  
  // Tasks are extracted from trips owned by this employee
  const myTrips = trips.filter(t => t.owner === empName);
  tripCount = myTrips.length;
  
  myTrips.forEach(trip => {
    taskFields.forEach(tf => {
      const status = normalizeEmployeeTaskStatus(trip[tf.key]);
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
    });
  });
  
  // Subtasks: assigned to this employee (from any trip)
  trips.forEach(trip => {
    try {
      const subsObj = trip.subtasks || {};
      Object.entries(subsObj).forEach(([catName, catArray]) => {
        if (!Array.isArray(catArray)) return;
        catArray.forEach(s => {
          if (s.assignee === empName) {
            const subtask = {
              ...s,
              tripId: trip.id,
              tripName: trip.guestName || trip.destination || 'Unnamed Trip',
              tripDate: formatDate(trip.startDate),
              taskCategory: catName,
              trip: trip
            };
            allSubtasks.push(subtask);
            if (isRecurringSubtask(subtask)) {
              allRecurringSubtasks.push(subtask);
            }
          }
        });
      });
    } catch(e){}
  });

  // Generic subtasks: assigned to this employee directly (no trip)
  try {
    const empSubs = activeEmployee.subtasks || {};
    Object.entries(empSubs).forEach(([catName, catArray]) => {
      if (!Array.isArray(catArray)) return;
      catArray.forEach(s => {
        const subtask = {
          ...s,
          tripId: '', // No trip
          tripName: s.tripName || 'Generic Task',
          tripDate: '',
          taskCategory: catName,
          trip: null
        };
        allSubtasks.push(subtask);
        if (isRecurringSubtask(subtask)) {
          allRecurringSubtasks.push(subtask);
        }
      });
    });
  } catch(e){}

  // Filter tasks and subtasks by search query
  if (empSearchQuery) {
    const q = empSearchQuery.toLowerCase();
    allTasks = allTasks.filter(t => 
      t.tripName.toLowerCase().includes(q) || 
      t.taskLabel.toLowerCase().includes(q) ||
      (t.trip.destination || '').toLowerCase().includes(q)
    );
    allSubtasks = allSubtasks.filter(s => 
      s.text.toLowerCase().includes(q) || 
      s.tripName.toLowerCase().includes(q) ||
      (s.trip.destination || '').toLowerCase().includes(q)
    );
    allRecurringSubtasks = allRecurringSubtasks.filter(s =>
      s.text.toLowerCase().includes(q) ||
      s.tripName.toLowerCase().includes(q) ||
      (s.trip.destination || '').toLowerCase().includes(q)
    );
  }

  // Sort subtasks so priorities stay above normal items.
  allSubtasks.sort(compareSubtasksForDisplay);
  allRecurringSubtasks.sort(compareSubtasksForDisplay);
  
  // Calculate Stats
  const stats = {
    activeTrips: tripCount,
    pendingTasks: allTasks.filter(t => ['pending', 'ongoing'].includes(t.status)).length,
    completedTasks: allTasks.filter(t => t.status === 'complete').length,
    overdueTasks: allTasks.filter(t => {
      if (!t.tripDate || t.status === 'complete' || t.status === 'notrequired') return false;
      return new Date(t.tripDate) < new Date();
    }).length,
    completionRate: 0
  };
  const totalRelevant = stats.pendingTasks + stats.completedTasks;
  if (totalRelevant > 0) {
    stats.completionRate = Math.round((stats.completedTasks / totalRelevant) * 100);
  }
  
  return { tasks: allTasks, subtasks: allSubtasks, recurringSubtasks: allRecurringSubtasks, stats };
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
  else if (currentTab === 'subtasks') container.innerHTML = renderSubtasks(data.subtasks, data.recurringSubtasks);
  else if (currentTab === 'timeline') container.innerHTML = renderTimeline(data.tasks);
  else if (currentTab === 'calendar') container.innerHTML = renderEmployeeCalendar(data.tasks);

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

document.addEventListener('click', () => {
  document.querySelectorAll('.ew-remark-menu').forEach(m => m.style.display = 'none');
});

document.getElementById('ewAddSubtaskReminderBtn')?.addEventListener('click', () => {
  openEwSubtaskReminderModal(selectedTripId, null, true);
});

document.getElementById('ewAddSubtaskBtn')?.addEventListener('click', () => {
  openAddSubtaskModal();
});

document.getElementById('ewAddSubtaskClose')?.addEventListener('click', closeAddSubtaskModal);
document.getElementById('ewAddSubtaskCancel')?.addEventListener('click', closeAddSubtaskModal);
document.getElementById('ewAddSubtaskModal')?.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'ewAddSubtaskModal') closeAddSubtaskModal();
});

document.querySelectorAll('.ew-add-subtask-type-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    addSubtaskModalMode = btn.dataset.mode === 'generic' ? 'generic' : 'tripSpecific';
    syncAddSubtaskFieldVisibility();
    refreshAddSubtaskSelects();
  });
});

document.getElementById('ewAddSubtaskTripSearch')?.addEventListener('input', () => refreshAddSubtaskSelects());
document.getElementById('ewAddSubtaskTaskSearch')?.addEventListener('input', () => refreshAddSubtaskSelects());
document.getElementById('ewAddSubtaskTripSelect')?.addEventListener('change', () => refreshAddSubtaskSelects());
document.getElementById('ewAddSubtaskTaskSelect')?.addEventListener('change', () => refreshAddSubtaskSelects());

document.getElementById('ewAddSubtaskSave')?.addEventListener('click', async () => {
  const tripInput = document.getElementById('ewAddSubtaskTripInput');
  const tripList = document.getElementById('ewAddSubtaskTripList');
  let tripId = document.getElementById('ewAddSubtaskTripSelect')?.value;
  
  if (tripInput && tripList && tripInput.value) {
    const option = Array.from(tripList.options).find(opt => opt.value === tripInput.value);
    if (option) {
      tripId = option.dataset.id;
    }
  }

  const taskKey = document.getElementById('ewAddSubtaskTaskSelect')?.value;
  const text = document.getElementById('ewAddSubtaskText')?.value.trim();
  const mode = addSubtaskModalMode;
  
  if (!text) {
    toast('Subtask text is required', '⚠️');
    return;
  }

  if (mode === 'tripSpecific') {
    if (!tripId || !taskKey) {
      toast('Choose a trip and a task stage', '⚠️');
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
      metadata: { reminder: pendingEwAddSubtaskReminder || { date: new Date().toISOString().slice(0, 10), label: 'Due today' } }
    };

    subsObj[cat].push(newSubtask);
    trip.subtasks = subsObj;
    closeAddSubtaskModal();
    renderWorkspace();
    updateTripField(trip.id, 'subtasks', subsObj)
      .then(() => toast('Subtask added'))
      .catch(err => {
        console.error('Add subtask failed', err);
        toast('Failed to add subtask', '⚠️');
      });
  } else {
    // Generic subtask
    if (!activeEmployee) {
      toast('No active employee selected', '⚠️');
      return;
    }
    const newSubtask = {
      id: 's_' + Date.now(),
      text,
      done: false,
      assignee: activeEmployee.name,
      tripName: selectedGenericLabel || 'Generic Task',
      createdAt: new Date().toISOString(),
      metadata: { reminder: pendingEwAddSubtaskReminder || { date: new Date().toISOString().slice(0, 10), label: 'Due today' } }
    };
    
    const empSubs = activeEmployee.subtasks || {};
    if (!empSubs['generic']) empSubs['generic'] = [];
    empSubs['generic'].push(newSubtask);
    activeEmployee.subtasks = empSubs;
    
    closeAddSubtaskModal();
    renderWorkspace();
    
    apiJson(`/api/ownership/employees/${activeEmployee.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ subtasks: empSubs })
    }).then(() => toast('Generic subtask added'))
      .catch(err => {
        console.error('Add generic subtask failed', err);
        toast('Failed to add generic subtask', '⚠️');
      });
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

function getAddSubtaskTripOptions() {
  return [...trips]
    .sort((a, b) => tripLabel(a).localeCompare(tripLabel(b)))
    .map(trip => ({
      value: trip.id,
      label: tripLabel(trip),
      searchText: `${trip.guestName || ''} ${trip.destination || ''} ${trip.owner || ''} ${trip.id || ''}`.trim()
    }));
}

function getAddSubtaskTaskOptions() {
  return taskFields.map(tf => ({ value: tf.key, label: tf.label }));
}

function buildFilteredOptions(items, query, selectedValue, emptyLabel, searchFn = item => item.label) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const filtered = normalizedQuery
    ? items.filter(item => String(searchFn(item) || '').toLowerCase().includes(normalizedQuery))
    : items;
  if (!filtered.length) return `<option value="">${escHtml(emptyLabel)}</option>`;
  return filtered
    .map(item => `<option value="${escHtml(item.value)}" ${item.value === selectedValue ? 'selected' : ''}>${escHtml(item.label)}</option>`)
    .join('');
}

function syncAddSubtaskFieldVisibility() {
  const modal = document.getElementById('ewAddSubtaskModal');
  if (!modal) return;
  modal.dataset.mode = addSubtaskModalMode;
  modal.querySelectorAll('.ew-add-subtask-type-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === addSubtaskModalMode);
  });
  modal.querySelectorAll('.ew-add-subtask-mode-panel').forEach(panel => {
    panel.style.display = panel.dataset.mode === addSubtaskModalMode ? '' : 'none';
    if (panel.dataset.mode === 'generic' && addSubtaskModalMode === 'generic') {
      renderGenericLabels(panel);
    }
  });
}

function renderGenericLabels(panel) {
  const emp = activeEmployee;
  if (!emp) return;
  
  const domain = emp.domain || '';
  const custom = emp.customLabels || [];
  
  const defaultLabels = {
    'Tech': ['bug', 'feature', 'refactor', 'support'],
    'Accounts': ['payment', 'filing', 'invoice', 'audit'],
    'Travel': ['booking', 'visa', 'flight', 'hotel'],
    'Sales & Marketing': ['lead', 'follow-up', 'campaign', 'meeting'],
    'HR': ['interview', 'onboarding', 'payroll', 'training']
  };
  
  const predefined = defaultLabels[domain] || [];
  const allLabels = [...new Set([...predefined, ...custom])];
  
  let html = '<div class="crm-form-group"><label class="crm-form-label">Labels (' + (domain || 'No Domain') + ')</label>';
  html += '<div style="display:flex; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.5rem;">';
  allLabels.forEach(lbl => {
    const isActive = lbl === selectedGenericLabel;
    const style = isActive 
      ? 'padding:0.2rem 0.6rem; font-size:0.75rem; border-radius:999px; border:1px solid var(--crm-primary); background:var(--crm-primary); color:#fff;'
      : 'padding:0.2rem 0.6rem; font-size:0.75rem; border-radius:999px; border:1px solid var(--crm-border);';
    html += `<button type="button" class="crm-btn crm-btn-ghost" style="${style}" onclick="addGenericLabel('${escHtml(lbl)}')">${escHtml(lbl)}</button>`;
  });
  
  if (!showCustomLabelInput) {
    html += `<button type="button" class="crm-btn crm-btn-ghost" style="padding:0.2rem 0.6rem; font-size:0.75rem; border-radius:999px; border:1px dashed var(--crm-text-3);" onclick="toggleCustomLabelInput(true)">+ Add</button>`;
  }
  html += '</div>';

  if (showCustomLabelInput) {
    html += '<div style="display:flex; gap:0.5rem;">';
    html += '<input type="text" id="ewAddCustomLabelInput" class="crm-form-input" placeholder="New custom label..." style="flex:1;">';
    html += '<button type="button" class="crm-btn crm-btn-ghost" onclick="saveCustomLabel()">Save</button>';
    html += '<button type="button" class="crm-btn crm-btn-ghost" onclick="toggleCustomLabelInput(false)">✕</button>';
    html += '</div>';
  }
  html += '</div>';
  
  panel.innerHTML = html;

  if (showCustomLabelInput) {
    const inp = document.getElementById('ewAddCustomLabelInput');
    if (inp) inp.focus();
  }
}

window.addGenericLabel = function(lbl) {
  selectedGenericLabel = selectedGenericLabel === lbl ? null : lbl;
  syncAddSubtaskFieldVisibility();
};

window.toggleCustomLabelInput = function(show) {
  showCustomLabelInput = show;
  syncAddSubtaskFieldVisibility();
};

window.saveCustomLabel = async function() {
  const emp = activeEmployee;
  if (!emp) return;
  const input = document.getElementById('ewAddCustomLabelInput');
  const lbl = input ? input.value.trim() : '';
  if (!lbl) return;
  
  const custom = emp.customLabels || [];
  if (custom.includes(lbl)) {
    showCustomLabelInput = false;
    syncAddSubtaskFieldVisibility();
    return;
  }
  
  custom.push(lbl);
  try {
    const res = await apiJson('/api/ownership/employees/' + emp.id, {
      method: 'PATCH',
      body: JSON.stringify({ customLabels: custom })
    });
    if (res.employee) {
      Object.assign(emp, res.employee);
      showCustomLabelInput = false;
      selectedGenericLabel = lbl; // Automatically select the new label
      syncAddSubtaskFieldVisibility(); // Re-render labels
      toast('Custom label added');
    }
  } catch (e) {
    toast('Failed to save label', '⚠️');
  }
}

function refreshAddSubtaskSelects() {
  const modal = document.getElementById('ewAddSubtaskModal');
  if (!modal) return;
  const tripInput = document.getElementById('ewAddSubtaskTripInput');
  const tripList = document.getElementById('ewAddSubtaskTripList');
  const tripSelect = document.getElementById('ewAddSubtaskTripSelect'); // Hidden input
  const taskSelect = document.getElementById('ewAddSubtaskTaskSelect');

  if (tripList) {
    const options = getAddSubtaskTripOptions();
    tripList.innerHTML = options.map(opt => `<option data-id="${opt.value}" value="${escHtml(opt.label)}"></option>`).join('');
    
    if (tripInput && tripSelect && tripSelect.value) {
      const selectedOpt = options.find(o => o.value === tripSelect.value);
      if (selectedOpt) {
        tripInput.value = selectedOpt.label;
      }
    }
  }

  if (taskSelect) {
    const selectedTaskKey = taskSelect.value || currentDetailContext?.taskKey || taskFields[0]?.key || '';
    taskSelect.innerHTML = buildFilteredOptions(getAddSubtaskTaskOptions(), '', selectedTaskKey, 'No tasks available');
    if (selectedTaskKey) taskSelect.value = selectedTaskKey;
  }
}

function openAddSubtaskModal(prefill = {}) {
  const modal = document.getElementById('ewAddSubtaskModal');
  if (!modal) return;
  addSubtaskModalMode = prefill.mode === 'generic' ? 'generic' : 'tripSpecific';
  const tripInput = document.getElementById('ewAddSubtaskTripInput');
  const tripSelect = document.getElementById('ewAddSubtaskTripSelect');
  const taskSelect = document.getElementById('ewAddSubtaskTaskSelect');
  const textInput = document.getElementById('ewAddSubtaskText');

  if (tripInput) tripInput.value = '';
  if (tripSelect) tripSelect.value = prefill.tripId || '';
  if (taskSelect) taskSelect.value = prefill.taskKey || currentDetailContext?.taskKey || taskFields[0]?.key || '';
  if (textInput) textInput.value = prefill.text || '';

  syncAddSubtaskFieldVisibility();
  refreshAddSubtaskSelects();
  modal.classList.add('open');
  setTimeout(() => {
    if (addSubtaskModalMode === 'tripSpecific' && tripInput) {
      tripInput.focus();
    } else if (textInput) {
      textInput.focus();
    }
  }, 0);
}

function closeAddSubtaskModal() {
  selectedGenericLabel = null;
  showCustomLabelInput = false;
  pendingEwAddSubtaskReminder = null;
  const btn = document.getElementById('ewAddSubtaskReminderBtn');
  if (btn) btn.classList.remove('active');
  document.getElementById('ewAddSubtaskModal')?.classList.remove('open');
}

// Kanban View
function renderKanban(tasks) {
  const cols = {
    pending: tasks.filter(t => ['pending'].includes(t.status)),
    progress: tasks.filter(t => ['ongoing'].includes(t.status)),
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
          const recurringBadge = isRecurringSubtask(s) ? '<span class="ew-recurring-badge" style="margin-left:0.35rem;">Recurring</span>' : '';
          return `
          <div class="ew-detail-subtask" style="display:flex; gap:1rem; align-items:center; background:var(--crm-surface); padding:0.75rem; border-radius:8px; border:1px solid var(--crm-border);">
            <input type="checkbox" ${s.done ? 'checked' : ''} onchange="toggleSubtaskDone('${s.tripId}', '${s.id}', this.checked)">
            <div style="flex:1;">
              <div class="ew-detail-subtask-text ${s.done ? 'done' : ''}" style="border:none;background:transparent;width:100%;color:var(--crm-text);font-size:0.85rem;" readonly>${escHtml(s.text)}</div>
              ${catLabel || recurringBadge ? `<div style="font-size:0.7rem;color:var(--crm-text-3);">${catLabel ? `[${catLabel}]` : ''}${recurringBadge}</div>` : ''}
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
function renderSubtasks(subtasks, recurringSubtasks = []) {
  if (subtasks.length === 0) return '<div style="color:var(--crm-text-3);text-align:center;margin-top:2rem;">No subtasks assigned.</div>';
  const ordered = [...subtasks].sort(compareSubtasksForDisplay);
  const todayObj = new Date();
  todayObj.setHours(0,0,0,0);
  const todayMs = todayObj.getTime();

  const isPending = (s) => {
    if (s.done) return false;
    if (isRecurringSubtask(s)) {
      const rem = s.metadata.reminder;
      if (!rem.date) return false;
      const targetDate = new Date(rem.date);
      targetDate.setHours(0,0,0,0);
      const fDays = rem.frequencyDays || 30;
      const defaultTrig = fDays === 1 ? 0 : fDays === 7 ? 2 : 7;
      const trigDays = typeof rem.triggerDaysBefore === 'number' ? rem.triggerDaysBefore : defaultTrig;
      const diffDays = Math.floor((targetDate.getTime() - todayMs) / (1000 * 60 * 60 * 24));
      return diffDays <= trigDays;
    }
    return true;
  };

  const pending = ordered.filter(isPending);
  const done = ordered.filter(s => s.done).sort((a, b) => {
    const timeA = a.doneAt ? Date.parse(a.doneAt) : (Date.parse(a.updatedAt || a.createdAt) || 0);
    const timeB = b.doneAt ? Date.parse(b.doneAt) : (Date.parse(b.updatedAt || b.createdAt) || 0);
    return timeB - timeA;
  });
  const recurring = [...recurringSubtasks].filter(s => !isPending(s)).sort(compareSubtasksForDisplay);

  const container = document.getElementById('ewSubtasksTabContainer');
  const activeSubTab = container ? (container.dataset.activeSubTab || 'pending') : 'pending';

  const buildList = (items, emptyText, listIdAttr) => {
    if (!items.length) {
      return `<div style="color:var(--crm-text-3);text-align:center;padding:0.9rem 0;font-size:0.82rem;">${emptyText}</div>`;
    }
    return `<div class="ew-subtask-card-list"${listIdAttr}>${items.map(buildSubtaskCardHtml).join('')}</div>`;
  };

  return `
    <div id="ewSubtasksTabContainer" data-active-sub-tab="${activeSubTab}" style="display:flex;flex-direction:column;gap:1rem;">
      <div class="ew-subtask-tab-bar" style="display:flex;gap:0.5rem;align-items:center;">
        <button
          type="button"
          class="ew-subtask-tab-btn ${activeSubTab === 'pending' ? 'active' : ''}"
          data-tab="pending"
          onclick="ewSwitchSubtaskTab('pending')"
        >Pending <span class="ew-subtask-tab-count">${pending.length}</span></button>
        <button
          type="button"
          class="ew-subtask-tab-btn ${activeSubTab === 'recurring' ? 'active' : ''}"
          data-tab="recurring"
          onclick="ewSwitchSubtaskTab('recurring')"
        >Recurring <span class="ew-subtask-tab-count">${recurring.length}</span></button>
        <button
          type="button"
          class="ew-subtask-tab-btn ${activeSubTab === 'done' ? 'active' : ''}"
          data-tab="done"
          onclick="ewSwitchSubtaskTab('done')"
        >Done <span class="ew-subtask-tab-count">${done.length}</span></button>
      </div>
      <div class="ew-subtask-tab-panel" id="ewSubtaskPanelPending" style="display:${activeSubTab === 'pending' ? '' : 'none'};">
        ${buildList(pending, 'No pending subtasks.', ' id="ewPendingSubtasksList"')}
      </div>
      <div class="ew-subtask-tab-panel" id="ewSubtaskPanelRecurring" style="display:${activeSubTab === 'recurring' ? '' : 'none'};">
        ${buildList(recurring, 'No recurring subtasks yet.', ' id="ewRecurringSubtasksList"')}
      </div>
      <div class="ew-subtask-tab-panel" id="ewSubtaskPanelDone" style="display:${activeSubTab === 'done' ? '' : 'none'};">
        ${buildList(done, 'No completed subtasks yet.', '')}
      </div>
    </div>
  `;
}

window.ewSwitchSubtaskTab = function(tab) {
  const container = document.getElementById('ewSubtasksTabContainer');
  if (!container) return;
  container.dataset.activeSubTab = tab;
  const pendingPanel = document.getElementById('ewSubtaskPanelPending');
  const recurringPanel = document.getElementById('ewSubtaskPanelRecurring');
  const donePanel = document.getElementById('ewSubtaskPanelDone');
  if (pendingPanel) pendingPanel.style.display = tab === 'pending' ? '' : 'none';
  if (recurringPanel) recurringPanel.style.display = tab === 'recurring' ? '' : 'none';
  if (donePanel) donePanel.style.display = tab === 'done' ? '' : 'none';
  container.querySelectorAll('.ew-subtask-tab-btn').forEach(btn => {
    const btnTab = btn.dataset.tab || 'pending';
    btn.classList.toggle('active', btnTab === tab);
  });
};


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
function renderEmployeeCalendar(tasks) {
  // very simple pseudo-calendar for current month of earliest task or today
  return '<div style="color:var(--crm-text-3);text-align:center;margin-top:2rem;padding:2rem;">Calendar visualization not fully implemented yet in this snippet. Please use Timeline.</div>';
}

// ============================================================================
// TASK DETAIL PANEL
// ============================================================================

let currentDetailContext = null;
let pendingEwAddSubtaskReminder = null;

function openTaskDetail(tripId, taskKey) {
  const trip = trips.find(t => t.id === tripId);
  if (!trip) return;
  
  const tf = taskFields.find(f => f.key === taskKey);
  const status = normalizeEmployeeTaskStatus(trip[taskKey]);
  
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

// API Updates
const updateQueue = {};

function getEmployeeTripQueue(trip) {
  if (!trip || !trip.id) return null;
  const tripId = trip.id;
  if (!updateQueue[tripId]) {
    updateQueue[tripId] = {
      patch: {},
      resolvers: [],
      snapshot: JSON.parse(JSON.stringify(trip)),
      version: trip.version || 0,
      inFlight: false,
      timer: null,
    };
  }
  const queue = updateQueue[tripId];
  if ((trip.version || 0) > (queue.version || 0)) {
    queue.version = trip.version || 0;
  }
  return queue;
}

function scheduleEmployeeTripFlush(tripId, delay = 600) {
  const queue = updateQueue[tripId];
  if (!queue || queue.inFlight) return;
  if (queue.timer) clearTimeout(queue.timer);
  queue.timer = setTimeout(() => {
    queue.timer = null;
    flushEmployeeTripQueue(tripId);
  }, delay);
}

async function flushEmployeeTripQueue(tripId) {
  const queue = updateQueue[tripId];
  if (!queue || queue.inFlight) return null;
  const patch = queue.patch;
  if (!patch || Object.keys(patch).length === 0) {
    if (!queue.resolvers.length && !queue.timer) delete updateQueue[tripId];
    return null;
  }

  queue.inFlight = true;
  queue.patch = {};
  const batchResolvers = queue.resolvers.splice(0);
  const requestVersion = queue.version || 0;

  try {
    const { trip: saved, cacheVersion } = await apiJson(`/api/ownership/trips/${tripId}`, {
      method: 'PATCH',
      body: JSON.stringify({ version: requestVersion, ...patch })
    });
    if (saved) {
      const idx = trips.findIndex(x => x.id === tripId);
      const hasPendingLocalChanges = !!(queue && (queue.inFlight || Object.keys(queue.patch || {}).length > 0));
      const mergedTrip = idx !== -1 && hasPendingLocalChanges ? { ...saved, ...trips[idx] } : saved;
      if (idx !== -1) {
        trips[idx] = mergedTrip;
        if (typeof syncTripRowDom === 'function') syncTripRowDom(mergedTrip);
      }
      queue.snapshot = JSON.parse(JSON.stringify(mergedTrip));
      queue.version = mergedTrip.version || queue.version;
      if (typeof rememberOwnershipVersion === 'function') {
        rememberOwnershipVersion(cacheVersion || mergedTrip.version);
      }
      if (tripId === currentDetailContext?.tripId) {
        const detailStatus = document.getElementById('ewDetailStatusSelect');
        if (detailStatus && currentDetailContext?.taskKey) {
          detailStatus.value = normalizeEmployeeTaskStatus(mergedTrip[currentDetailContext.taskKey] || detailStatus.value);
          refreshDetailSubtaskList(mergedTrip, currentDetailContext.taskKey);
        }
      }
      cacheEmployeeWorkspaceState();
      refreshWorkspaceStats();
    }
    toast('Saved');
    batchResolvers.forEach(r => r.resolve(saved));
  } catch (e) {
    const serverTrip = e.status === 409 && e.payload?.trip ? e.payload.trip : null;
    const currentTrip = trips.find(x => x.id === tripId);
    const hasPendingLocalChanges = !!(queue && (queue.inFlight || Object.keys(queue.patch || {}).length > 0));
    const fallbackTrip = serverTrip ? (hasPendingLocalChanges ? { ...serverTrip, ...(currentTrip || {}) } : serverTrip) : queue.snapshot;
    const idx = trips.findIndex(x => x.id === tripId);
    if (idx !== -1 && fallbackTrip) {
      trips[idx] = fallbackTrip;
      if (typeof syncTripRowDom === 'function') syncTripRowDom(fallbackTrip);
    }
    if (serverTrip) {
      queue.snapshot = JSON.parse(JSON.stringify(fallbackTrip));
      queue.version = fallbackTrip.version || queue.version;
      if (typeof rememberOwnershipVersion === 'function') {
        rememberOwnershipVersion(e.payload?.cacheVersion || fallbackTrip.version);
      }
      cacheEmployeeWorkspaceState();
      refreshWorkspaceStats();
      if (tripId === currentDetailContext?.tripId) {
        const detailStatus = document.getElementById('ewDetailStatusSelect');
        if (detailStatus && currentDetailContext?.taskKey) {
          detailStatus.value = normalizeEmployeeTaskStatus(fallbackTrip[currentDetailContext.taskKey] || detailStatus.value);
          refreshDetailSubtaskList(fallbackTrip, currentDetailContext.taskKey);
        }
      }
      toast('Latest data loaded. Keep editing.', '⚠️');
      batchResolvers.forEach(r => r.resolve(fallbackTrip));
    } else {
      if (typeof queueOwnershipServerRefresh === 'function' && e.status === 409) {
        queueOwnershipServerRefresh(e.payload?.cacheVersion || 0, 'employee workspace conflict');
      }
      cacheEmployeeWorkspaceState();
      refreshWorkspaceStats();
      if (tripId === currentDetailContext?.tripId) {
        const matched = trips.find(x => x.id === tripId);
        if (matched && currentDetailContext?.taskKey) {
          document.getElementById('ewDetailStatusSelect').value = normalizeEmployeeTaskStatus(matched[currentDetailContext.taskKey]);
          refreshDetailSubtaskList(matched, currentDetailContext.taskKey);
        }
      }
      renderWorkspace();
      toast('Failed to save', '⚠️');
      batchResolvers.forEach(r => r.reject(e));
    }
  } finally {
    queue.inFlight = false;
    if (Object.keys(queue.patch).length === 0 && queue.resolvers.length === 0 && !queue.timer) {
      delete updateQueue[tripId];
    } else if (Object.keys(queue.patch).length > 0 && !queue.timer) {
      scheduleEmployeeTripFlush(tripId, 0);
    }
  }
}

async function updateTripField(tripId, field, value) {
  const trip = trips.find(x => x.id === tripId);
  if (!trip) return;

  const queue = getEmployeeTripQueue(trip);
  if (!queue) return;

  if (field === 'subtasks') trip.subtasks = value;
  else trip[field] = value;

  queue.patch[field] = value;
  
  cacheEmployeeWorkspaceState();
  refreshWorkspaceStats();
  if (field === currentDetailContext?.taskKey && currentDetailContext.tripId === tripId) {
    const detailStatus = document.getElementById('ewDetailStatusSelect');
    if (detailStatus) detailStatus.value = value;
  }

  return new Promise((resolve, reject) => {
    queue.resolvers.push({ resolve, reject });
    scheduleEmployeeTripFlush(tripId);
  });
}

async function toggleSubtaskPriority(tripId, subtaskId) {
  if (!tripId) return _handleGenericSubtaskUpdate(subtaskId, (s) => {
    if (!s.metadata) s.metadata = {};
    s.metadata.isHighPriority = !s.metadata.isHighPriority;
    s.metadata.priorityUpdatedAt = new Date().toISOString();
  });
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
  const advanceRecurring = (s, arr) => {
    if (isDone && isRecurringSubtask(s)) {
      const doneInstance = JSON.parse(JSON.stringify(s));
      doneInstance.id = 's_' + Date.now() + '_' + Math.floor(Math.random()*1000);
      doneInstance.done = true;
      doneInstance.doneAt = new Date().toISOString();
      if (doneInstance.metadata && doneInstance.metadata.reminder) {
         delete doneInstance.metadata.reminder.recurring;
      }
      if (!doneInstance.metadata) doneInstance.metadata = {};
      doneInstance.metadata.wasRecurring = true;
      if (arr) arr.push(doneInstance);

      const rem = s.metadata.reminder;
      let freqLabel = 'monthly';
      if (rem && rem.date) {
        const d = new Date(rem.date);
        const fDays = rem.frequencyDays || 30;
        d.setDate(d.getDate() + fDays);
        rem.date = d.toISOString().slice(0, 10);
        rem.label = rem.date;
        if (fDays === 1) freqLabel = 'daily';
        else if (fDays === 7) freqLabel = 'weekly';
        else if (fDays >= 365) freqLabel = 'yearly';
        else if (fDays !== 30) freqLabel = fDays + ' days';
      }
      s.done = false;
      window.toast && window.toast('Task logged & moved to next ' + freqLabel + ' date');
    } else {
      s.done = isDone;
      if (isDone) s.doneAt = new Date().toISOString();
      else delete s.doneAt;
    }
  };

  if (!tripId) return _handleGenericSubtaskUpdate(subtaskId, advanceRecurring);
  const trip = trips.find(t => t.id === tripId);
  if (!trip) return;
  let subsObj = trip.subtasks || {};
  let found = false;
  Object.values(subsObj).forEach(arr => {
    if (Array.isArray(arr)) {
      const s = arr.find(x => x.id === subtaskId);
      if (s) {
        advanceRecurring(s);
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
  if (!tripId) return _handleGenericSubtaskUpdate(subtaskId, (s) => {
    if (!s.metadata) s.metadata = {};
    const next = normalizeRemarkEntries(s.metadata.remarks);
    const text = String(remarks || '').trim();
    if (text) next.push({ text, ts: new Date().toISOString() });
    s.metadata.remarks = next;
  });
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
  if (!tripId) {
    if (!confirm('Are you sure you want to delete this subtask?')) return;
    return _handleGenericSubtaskUpdate(subtaskId, (s, arr) => {
      arr.splice(arr.indexOf(s), 1);
    });
  }
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
    if (currentView === "workspace") {
      renderWorkspace();
    } else {
      removeSubtaskCardDom(subtaskId);
    }
    if (currentDetailContext && currentDetailContext.tripId === tripId) {
      refreshDetailSubtaskList(trip, currentDetailContext.taskKey);
    }
    updateTripField(tripId, 'subtasks', subsObj).catch(() => {});
  }
}

document.getElementById('ewDetailStatusSelect')?.addEventListener('change', (e) => {
  if (!currentDetailContext) return;
  updateTripField(currentDetailContext.tripId, currentDetailContext.taskKey, normalizeEmployeeTaskStatus(e.target.value));
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
  empSearchQuery = e.target.value;
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
  if (window.location.pathname.startsWith('/ownership/employees')) {
    initEmployeeWorkspace();
  } else {
    employeeWorkspaceBooting = false;
    employeeWorkspaceReady = false;
    setEmployeeWorkspaceLoading(false);
    restoreEmployeeWorkspaceState();
  }
});

function _handleGenericSubtaskUpdate(subtaskId, updaterFn) {
  if (!activeEmployee || !activeEmployee.subtasks) return false;
  let found = false;
  Object.values(activeEmployee.subtasks).forEach(arr => {
    if (Array.isArray(arr)) {
      const s = arr.find(x => x.id === subtaskId);
      if (s) { updaterFn(s, arr); found = true; }
    }
  });
  if (found) {
    if (currentView === "workspace") renderWorkspace();
    apiJson('/api/ownership/employees/' + activeEmployee.id, {
      method: 'PATCH',
      body: JSON.stringify({ subtasks: activeEmployee.subtasks })
    }).catch(() => {});
  }
  return found;
}
