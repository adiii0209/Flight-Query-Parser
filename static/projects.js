// ============================================================================
// Developer Projects  (Ownership -> Employees -> Projects tab)
//
//  * Project cards with a checklist of tasks (add / tick / untick / edit / delete)
//  * Floating windows: draggable, resizable, minimise to a dock pill, remembered
//    per employee across reloads
//  * Pop-out: Chrome Document Picture-in-Picture window that stays on top of
//    every other app (editor, terminal, ...)
//
// Public API (used by employees.js):
//   EWProjects.activate(employee)            - load projects + restore floating windows
//   EWProjects.render(container, employee, searchQuery)
//   EWProjects.reset()                       - close everything (back to picker)
//   EWProjects.openNewProject()
// ============================================================================
(function () {
  'use strict';

  const COLORS = ['#5b6aff', '#7c3aed', '#ec4899', '#14b8a6', '#f59e0b', '#10b981', '#ef4444', '#06b6d4'];
  const STATUS_LABEL = { active: 'Active', paused: 'Paused', done: 'Done' };
  const LAYOUT_KEY = id => 'ew_pj_layout_v1_' + id;

  const pj = {
    employee: null,
    employeeId: '',
    projects: [],
    loaded: false,
    loading: false,
    loadError: '',
    layout: {},          // projectId -> { x, y, w, h, open, min }
    doneOpen: {},        // projectId -> bool (Completed list expanded)
    expanded: {},        // projectId -> bool (card task list expanded)
    container: null,
    query: '',
    pip: { win: null, pid: '' },
    zTop: 9000,
    boundMain: false,
  };

  // ── helpers ───────────────────────────────────────────────────────────────
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function isTech(emp) {
    return !!emp && String(emp.domain || '') === 'Tech';
  }

  function onProjectsTab() {
    try { return currentTab === 'projects'; } catch (e) { return false; }
  }

  function notify(msg, isError) {
    const el = document.createElement('div');
    el.className = 'pj-toast' + (isError ? ' is-error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, 2600);
  }

  async function api(url, method, body) {
    const res = await fetch(url, {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-json */ }
    if (!res.ok) throw new Error((data && data.error) || res.statusText || 'Request failed');
    return data;
  }

  function getProject(pid) { return pj.projects.find(p => p.id === pid) || null; }

  function findTask(pid, tid) {
    const p = getProject(pid);
    return p ? (p.tasks || []).find(t => t.id === tid) || null : null;
  }

  function progress(p) {
    const total = (p.tasks || []).length;
    const done = (p.tasks || []).filter(t => t.done).length;
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  }

  function docs() {
    const list = [document];
    if (pj.pip.win && !pj.pip.win.closed) list.push(pj.pip.win.document);
    return list;
  }

  // ── layout persistence (floating windows) ────────────────────────────────
  function loadLayout(empId) {
    try { return JSON.parse(localStorage.getItem(LAYOUT_KEY(empId)) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveLayout() {
    if (!pj.employeeId) return;
    try { localStorage.setItem(LAYOUT_KEY(pj.employeeId), JSON.stringify(pj.layout)); } catch (e) { /* ignore */ }
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────
  function activate(emp) {
    if (!isTech(emp)) {
      if (pj.employeeId) reset();
      return;
    }
    if (pj.employeeId === emp.id) { pj.employee = emp; return; }
    reset();
    pj.employee = emp;
    pj.employeeId = emp.id;
    pj.layout = loadLayout(emp.id);
    bindMain();
    load();
  }

  function reset() {
    closePip();
    const layer = document.getElementById('pjFloatLayer');
    if (layer) layer.remove();
    const dock = document.getElementById('pjDock');
    if (dock) dock.remove();
    pj.employee = null;
    pj.employeeId = '';
    pj.projects = [];
    pj.loaded = false;
    pj.loading = false;
    pj.loadError = '';
    pj.layout = {};
    pj.doneOpen = {};
    pj.expanded = {};
  }

  async function load() {
    if (pj.loading || !pj.employeeId) return;
    pj.loading = true;
    pj.loadError = '';
    const empId = pj.employeeId;
    try {
      const data = await api('/api/ownership/employees/' + encodeURIComponent(empId) + '/projects');
      if (empId !== pj.employeeId) return;
      pj.projects = data.projects || [];
      pj.loaded = true;
    } catch (e) {
      if (empId === pj.employeeId) pj.loadError = e.message || 'Could not load projects';
    } finally {
      pj.loading = false;
    }
    if (empId !== pj.employeeId) return;
    restorePanels();
    renderGrid();
  }

  function render(container, emp, query) {
    pj.container = container;
    pj.query = String(query || '').trim().toLowerCase();
    activate(emp);
    renderGrid();
  }

  // ── card grid ─────────────────────────────────────────────────────────────
  function matchesQuery(p) {
    if (!pj.query) return true;
    if ((p.name || '').toLowerCase().includes(pj.query)) return true;
    if ((p.description || '').toLowerCase().includes(pj.query)) return true;
    return (p.tasks || []).some(t => (t.text || '').toLowerCase().includes(pj.query));
  }

  function taskRowHtml(t) {
    return '<li class="pj-task' + (t.done ? ' is-done' : '') + '" data-task-id="' + esc(t.id) + '">' +
      '<span class="pj-grip" title="Drag to reorder">⋮⋮</span>' +
      '<input type="checkbox" class="pj-check" data-pj-act="toggle" aria-label="Mark done"' + (t.done ? ' checked' : '') + '>' +
      '<span class="pj-task-text">' + esc(t.text) + '</span>' +
      '<button type="button" class="pj-task-btn" data-pj-act="edit-task" title="Edit">✎</button>' +
      '<button type="button" class="pj-task-btn pj-task-del" data-pj-act="delete-task" title="Delete">✕</button>' +
      '</li>';
  }

  function tasklistInnerHtml(p) {
    const tasks = p.tasks || [];
    const open = tasks.filter(t => !t.done);
    const done = tasks.filter(t => t.done);
    let h = '';
    if (!tasks.length) h += '<div class="pj-empty-tasks">No tasks yet. Add the first one below.</div>';
    else if (!open.length) h += '<div class="pj-empty-tasks">All tasks done 🎉</div>';
    h += '<ul class="pj-open-list">' + open.map(taskRowHtml).join('') + '</ul>';
    if (done.length) {
      const isOpen = !!pj.doneOpen[p.id];
      h += '<button type="button" class="pj-done-toggle" data-pj-act="toggle-done-list">' +
        (isOpen ? '▾' : '▸') + ' Completed (' + done.length + ')</button>';
      if (isOpen) h += '<ul class="pj-done-list">' + done.map(taskRowHtml).join('') + '</ul>';
    }
    return h;
  }

  function addFormHtml(pid) {
    return '<form class="pj-add" data-pj-add="' + esc(pid) + '" autocomplete="off">' +
      '<input type="text" class="pj-add-input" maxlength="1000" placeholder="Add a task and press Enter...">' +
      '<button type="submit" class="pj-btn pj-btn-primary">Add</button></form>';
  }

  function cardHtml(p) {
    const pr = progress(p);
    const color = p.color || COLORS[0];
    const isOpen = !!pj.expanded[p.id];
    return '<article class="pj-card' + (isOpen ? ' pj-open' : '') + '" data-pj-project="' + esc(p.id) + '" style="--pj-color:' + esc(color) + '">' +
      '<div class="pj-card-top">' +
        '<div class="pj-card-title pj-title">' + esc(p.name) + '</div>' +
        '<span class="pj-status pj-status-' + esc(p.status) + '">' + esc(STATUS_LABEL[p.status] || p.status) + '</span>' +
      '</div>' +
      (p.description ? '<div class="pj-card-desc">' + esc(p.description) + '</div>' : '') +
      '<div class="pj-progress"><div class="pj-progress-fill" style="width:' + pr.pct + '%"></div></div>' +
      '<div class="pj-progress-text">' + pr.done + ' of ' + pr.total + ' done</div>' +
      '<div class="pj-card-actions">' +
        '<button type="button" class="pj-btn pj-btn-primary" data-pj-act="float" title="Open in a floating window">⧉ Float</button>' +
        '<button type="button" class="pj-btn" data-pj-act="expand">Tasks ' + (isOpen ? '▴' : '▾') + '</button>' +
        '<button type="button" class="pj-icon-btn" data-pj-act="edit-project" title="Edit project">✎</button>' +
      '</div>' +
      '<div class="pj-card-tasks">' +
        '<div class="pj-tasklist">' + tasklistInnerHtml(p) + '</div>' +
        addFormHtml(p.id) +
      '</div>' +
    '</article>';
  }

  function renderGrid() {
    const c = pj.container;
    if (!c || !c.isConnected || !onProjectsTab()) return;
    if (!pj.loaded) {
      c.innerHTML = '<div class="pj-wrap"><div class="pj-empty">' +
        (pj.loadError
          ? 'Could not load projects: ' + esc(pj.loadError) + '<br><button type="button" class="pj-btn" data-pj-act="retry">Retry</button>'
          : 'Loading projects...') +
        '</div></div>';
      return;
    }
    const visible = pj.projects.filter(matchesQuery);
    let h = '<div class="pj-wrap">';
    if (!pj.projects.length) {
      h += '<div class="pj-empty"><div class="pj-empty-icon">🗂️</div>' +
        '<div class="pj-empty-title">No projects yet</div>' +
        '<div class="pj-empty-sub">Create a project, add tasks to it, and keep it floating next to your editor while you work.</div>' +
        '<button type="button" class="pj-btn pj-btn-primary" data-pj-act="new-project">+ New Project</button></div>';
    } else if (!visible.length) {
      h += '<div class="pj-empty"><div class="pj-empty-sub">No projects match your search.</div></div>';
    } else {
      h += '<div class="pj-grid">' + visible.map(cardHtml).join('') + '</div>';
    }
    h += '</div>';
    c.innerHTML = h;
    c.querySelectorAll('.pj-card').forEach(card => initSortable(card, card.dataset.pjProject));
  }

  // ── partial DOM updates (keeps typed text / focus intact) ────────────────
  function updateProjectDom(pid, force) {
    const p = getProject(pid);
    if (!p) return;
    const pr = progress(p);
    docs().forEach(doc => {
      doc.querySelectorAll('[data-pj-project="' + pid + '"]').forEach(host => {
        host.style.setProperty('--pj-color', p.color || COLORS[0]);
        host.querySelectorAll('.pj-progress-fill').forEach(el => { el.style.width = pr.pct + '%'; });
        host.querySelectorAll('.pj-progress-text').forEach(el => { el.textContent = pr.done + ' of ' + pr.total + ' done'; });
        host.querySelectorAll('.pj-count').forEach(el => { el.textContent = pr.done + '/' + pr.total; });
        host.querySelectorAll('.pj-title').forEach(el => { el.textContent = p.name; });
        const list = host.querySelector('.pj-tasklist');
        // Don't wipe a task that is being edited, unless the edit just finished.
        if (list && (force || !list.querySelector('.pj-edit-input'))) {
          list.innerHTML = tasklistInnerHtml(p);
          initSortable(host, pid);
        }
      });
    });
  }

  function refreshAll() {
    renderGrid();
    syncPanels();
    renderDock();
    if (pj.pip.win && !pj.pip.win.closed) renderPip();
  }

  function initSortable(host, pid) {
    if (!window.Sortable || !host || host.ownerDocument !== document) return;
    const ul = host.querySelector('.pj-open-list');
    if (!ul) return;
    Sortable.create(ul, {
      animation: 150,
      handle: '.pj-grip',
      ghostClass: 'pj-task-ghost',
      onEnd: function () {
        const p = getProject(pid);
        if (!p) return;
        const openIds = [...ul.querySelectorAll('[data-task-id]')].map(li => li.dataset.taskId);
        const doneIds = p.tasks.filter(t => t.done).map(t => t.id);
        const ids = openIds.concat(doneIds);
        p.tasks = ids.map(id => p.tasks.find(t => t.id === id)).filter(Boolean);
        p.tasks.forEach((t, i) => { t.order = i; });
        api('/api/ownership/projects/' + encodeURIComponent(pid) + '/tasks/reorder', 'POST', { order: ids })
          .catch(() => notify('Could not save the new order', true));
      },
    });
  }

  // ── task actions ──────────────────────────────────────────────────────────
  async function addTask(pid, text) {
    const p = getProject(pid);
    text = String(text || '').trim();
    if (!p || !text) return true;
    try {
      const data = await api('/api/ownership/projects/' + encodeURIComponent(pid) + '/tasks', 'POST', { text });
      p.tasks.push(data.task);
      updateProjectDom(pid);
      updatePills();
      return true;
    } catch (e) {
      notify(e.message || 'Could not add task', true);
      return false;
    }
  }

  async function setTaskDone(pid, tid, done) {
    const t = findTask(pid, tid);
    if (!t) return;
    const prev = { done: t.done, doneAt: t.doneAt };
    t.done = done;
    t.doneAt = done ? new Date().toISOString() : '';
    updateProjectDom(pid);
    updatePills();
    try {
      const data = await api('/api/ownership/project-tasks/' + encodeURIComponent(tid), 'PATCH', { done });
      Object.assign(t, data.task);
    } catch (e) {
      Object.assign(t, prev);
      updateProjectDom(pid);
      updatePills();
      notify(e.message || 'Could not update task', true);
    }
  }

  async function deleteTask(pid, tid) {
    const p = getProject(pid);
    if (!p) return;
    const idx = p.tasks.findIndex(t => t.id === tid);
    if (idx === -1) return;
    const [removed] = p.tasks.splice(idx, 1);
    updateProjectDom(pid);
    updatePills();
    try {
      await api('/api/ownership/project-tasks/' + encodeURIComponent(tid), 'DELETE');
    } catch (e) {
      p.tasks.splice(idx, 0, removed);
      updateProjectDom(pid);
      updatePills();
      notify(e.message || 'Could not delete task', true);
    }
  }

  function startEditTask(pid, li) {
    const span = li.querySelector('.pj-task-text');
    const t = findTask(pid, li.dataset.taskId);
    if (!span || !t) return;
    const doc = li.ownerDocument;
    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'pj-edit-input';
    input.maxLength = 1000;
    input.value = t.text;
    span.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = async (save) => {
      if (finished) return;
      finished = true;
      const next = input.value.trim();
      if (save && next && next !== t.text) {
        const prevText = t.text;
        t.text = next;
        try {
          await api('/api/ownership/project-tasks/' + encodeURIComponent(t.id), 'PATCH', { text: next });
        } catch (e) {
          t.text = prevText;
          notify(e.message || 'Could not save task', true);
        }
      }
      updateProjectDom(pid, true);
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  // ── event delegation ──────────────────────────────────────────────────────
  function bind(doc) {
    doc.addEventListener('click', onClick);
    doc.addEventListener('change', onChange);
    doc.addEventListener('submit', onSubmit);
    doc.addEventListener('dblclick', e => {
      const text = e.target.closest && e.target.closest('.pj-task-text');
      if (!text) return;
      const li = text.closest('[data-task-id]');
      const host = text.closest('[data-pj-project]');
      if (li && host) startEditTask(host.dataset.pjProject, li);
    });
  }

  function bindMain() {
    if (pj.boundMain) return;
    pj.boundMain = true;
    bind(document);
  }

  function onChange(e) {
    const el = e.target;
    if (!el.dataset) return;
    if (el.dataset.pjAct === 'toggle') {
      const li = el.closest('[data-task-id]');
      const host = el.closest('[data-pj-project]');
      if (li && host) setTaskDone(host.dataset.pjProject, li.dataset.taskId, el.checked);
    } else if (el.dataset.pjAct === 'pip-switch') {
      pj.pip.pid = el.value;
      renderPip();
    }
  }

  function onSubmit(e) {
    const form = e.target.closest && e.target.closest('[data-pj-add]');
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector('.pj-add-input');
    const value = input.value;
    if (!value.trim()) return;
    input.value = '';
    addTask(form.dataset.pjAdd, value).then(ok => {
      if (!ok && !input.value) input.value = value;
    });
    input.focus();
  }

  function onClick(e) {
    const el = e.target.closest && e.target.closest('[data-pj-act]');
    if (!el || el.dataset.pjAct === 'toggle' || el.dataset.pjAct === 'pip-switch') return;
    const act = el.dataset.pjAct;
    const host = el.closest('[data-pj-project]');
    const pid = host ? host.dataset.pjProject : '';
    const li = el.closest('[data-task-id]');

    switch (act) {
      case 'float': openPanel(pid); break;
      case 'expand':
        pj.expanded[pid] = !pj.expanded[pid];
        host.classList.toggle('pj-open', !!pj.expanded[pid]);
        el.textContent = 'Tasks ' + (pj.expanded[pid] ? '▴' : '▾');
        break;
      case 'edit-project': openProjectModal(getProject(pid)); break;
      case 'new-project': openProjectModal(null); break;
      case 'retry': load(); break;
      case 'edit-task': if (li) startEditTask(pid, li); break;
      case 'delete-task': if (li) deleteTask(pid, li.dataset.taskId); break;
      case 'toggle-done-list':
        pj.doneOpen[pid] = !pj.doneOpen[pid];
        updateProjectDom(pid);
        break;
      case 'minimize': minimizePanel(pid); break;
      case 'restore': restorePanel(pid); break;
      case 'close': closePanel(pid); break;
      case 'popout': popOut(pid); break;
      case 'pip-float': openPanel(pid); closePip(); break;
      default: break;
    }
  }

  // ── floating windows ──────────────────────────────────────────────────────
  function ensureLayer() {
    let layer = document.getElementById('pjFloatLayer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'pjFloatLayer';
      document.body.appendChild(layer);
    }
    return layer;
  }

  function ensureDock() {
    let dock = document.getElementById('pjDock');
    if (!dock) {
      dock = document.createElement('div');
      dock.id = 'pjDock';
      document.body.appendChild(dock);
    }
    return dock;
  }

  function defaultLayout() {
    const n = Object.values(pj.layout).filter(l => l.open).length;
    const w = 340, h = 440;
    // Bottom-right corner, staggered up/left for each extra window, so the
    // toolbar buttons stay uncovered.
    return {
      x: Math.max(12, window.innerWidth - w - 28 - n * 30),
      y: Math.max(80, window.innerHeight - h - 28 - n * 30),
      w, h, open: false, min: false,
    };
  }

  function clampLayout(l) {
    const maxX = Math.max(0, window.innerWidth - 120);
    const maxY = Math.max(0, window.innerHeight - 48);
    l.x = Math.min(Math.max(0, l.x), maxX);
    l.y = Math.min(Math.max(0, l.y), maxY);
    l.w = Math.min(Math.max(260, l.w || 340), Math.max(260, window.innerWidth - 8));
    l.h = Math.min(Math.max(220, l.h || 440), Math.max(220, window.innerHeight - 8));
  }

  function panelHtml(p) {
    const pr = progress(p);
    return '<div class="pj-float-head" data-pj-drag>' +
        '<span class="pj-dot"></span>' +
        '<span class="pj-float-title pj-title">' + esc(p.name) + '</span>' +
        '<span class="pj-count">' + pr.done + '/' + pr.total + '</span>' +
        '<button type="button" class="pj-win-btn" data-pj-act="popout" title="Pop out - stays on top of other apps (Chrome)">⇱</button>' +
        '<button type="button" class="pj-win-btn" data-pj-act="minimize" title="Minimise">—</button>' +
        '<button type="button" class="pj-win-btn" data-pj-act="close" title="Close">✕</button>' +
      '</div>' +
      '<div class="pj-float-body">' +
        '<div class="pj-progress"><div class="pj-progress-fill" style="width:' + pr.pct + '%"></div></div>' +
        '<div class="pj-tasklist">' + tasklistInnerHtml(p) + '</div>' +
      '</div>' +
      addFormHtml(p.id);
  }

  function mountPanel(pid) {
    const p = getProject(pid);
    const lay = pj.layout[pid];
    if (!p || !lay) return;
    const layer = ensureLayer();
    let el = layer.querySelector('[data-pj-panel="' + pid + '"]');
    if (!el) {
      clampLayout(lay);
      el = document.createElement('section');
      el.className = 'pj-float';
      el.dataset.pjPanel = pid;
      el.dataset.pjProject = pid;
      el.style.setProperty('--pj-color', p.color || COLORS[0]);
      el.style.left = lay.x + 'px';
      el.style.top = lay.y + 'px';
      el.style.width = lay.w + 'px';
      el.style.height = lay.h + 'px';
      el.innerHTML = panelHtml(p);
      layer.appendChild(el);
      initSortable(el, pid);
      wireDrag(el, pid);
      wireResize(el, pid);
      el.addEventListener('pointerdown', () => bringToFront(el));
    }
    el.style.display = lay.min ? 'none' : '';
    bringToFront(el);
  }

  function bringToFront(el) {
    pj.zTop += 1;
    el.style.zIndex = String(pj.zTop);
  }

  function wireDrag(el, pid) {
    const head = el.querySelector('.pj-float-head');
    head.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      head.setPointerCapture(e.pointerId);
      el.classList.add('is-dragging');
      const move = ev => {
        el.style.left = Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - 120) + 'px';
        el.style.top = Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - 48) + 'px';
      };
      const up = () => {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
        head.removeEventListener('pointercancel', up);
        el.classList.remove('is-dragging');
        const lay = pj.layout[pid];
        if (lay) { lay.x = parseInt(el.style.left, 10) || 0; lay.y = parseInt(el.style.top, 10) || 0; saveLayout(); }
      };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
      head.addEventListener('pointercancel', up);
    });
    head.addEventListener('dblclick', e => {
      if (!e.target.closest('button')) minimizePanel(pid);
    });
  }

  function wireResize(el, pid) {
    if (typeof ResizeObserver === 'undefined') return;
    let timer = null;
    new ResizeObserver(() => {
      if (!el.offsetWidth || !el.offsetHeight) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const lay = pj.layout[pid];
        if (!lay || lay.min) return;
        lay.w = el.offsetWidth;
        lay.h = el.offsetHeight;
        saveLayout();
      }, 250);
    }).observe(el);
  }

  function openPanel(pid) {
    const p = getProject(pid);
    if (!p) return;
    if (!pj.layout[pid]) pj.layout[pid] = defaultLayout();
    const lay = pj.layout[pid];
    lay.open = true;
    lay.min = false;
    saveLayout();
    mountPanel(pid);
    renderDock();
  }

  function minimizePanel(pid) {
    const lay = pj.layout[pid];
    if (!lay) return;
    lay.min = true;
    saveLayout();
    const el = document.querySelector('[data-pj-panel="' + pid + '"]');
    if (el) el.style.display = 'none';
    renderDock();
  }

  function restorePanel(pid) {
    const lay = pj.layout[pid];
    if (!lay) return;
    lay.open = true;
    lay.min = false;
    saveLayout();
    mountPanel(pid);
    renderDock();
  }

  function closePanel(pid) {
    const lay = pj.layout[pid];
    if (lay) { lay.open = false; lay.min = false; saveLayout(); }
    const el = document.querySelector('[data-pj-panel="' + pid + '"]');
    if (el) el.remove();
    renderDock();
  }

  function restorePanels() {
    Object.keys(pj.layout).forEach(pid => {
      const lay = pj.layout[pid];
      if (!getProject(pid)) { delete pj.layout[pid]; return; }
      if (lay.open) mountPanel(pid);
    });
    renderDock();
  }

  // Re-sync panel titles/colours/lists with the data (after edits or deletes).
  function syncPanels() {
    Object.keys(pj.layout).forEach(pid => {
      if (!getProject(pid)) {
        const el = document.querySelector('[data-pj-panel="' + pid + '"]');
        if (el) el.remove();
        delete pj.layout[pid];
        return;
      }
      updateProjectDom(pid);
    });
    saveLayout();
  }

  function renderDock() {
    const minimized = Object.keys(pj.layout).filter(pid => pj.layout[pid].open && pj.layout[pid].min && getProject(pid));
    let dock = document.getElementById('pjDock');
    if (!minimized.length) { if (dock) dock.innerHTML = ''; return; }
    dock = ensureDock();
    dock.innerHTML = minimized.map(pid => {
      const p = getProject(pid);
      const pr = progress(p);
      return '<div class="pj-pill" data-pj-project="' + esc(pid) + '" style="--pj-color:' + esc(p.color || COLORS[0]) + '">' +
        '<button type="button" class="pj-pill-main" data-pj-act="restore" title="Restore">' +
          '<span class="pj-dot"></span><span class="pj-pill-name pj-title">' + esc(p.name) + '</span>' +
          '<span class="pj-count">' + pr.done + '/' + pr.total + '</span></button>' +
        '<button type="button" class="pj-pill-x" data-pj-act="close" title="Close">✕</button></div>';
    }).join('');
  }

  function updatePills() { /* counts are kept in sync by updateProjectDom (.pj-count) */ }

  // ── pop-out (Chrome Document Picture-in-Picture) ─────────────────────────
  function copyStylesTo(win) {
    [...document.styleSheets].forEach(sheet => {
      try {
        const css = [...sheet.cssRules].map(r => r.cssText).join('\n');
        const style = win.document.createElement('style');
        style.textContent = css;
        win.document.head.appendChild(style);
      } catch (e) {
        if (sheet.href) {
          const link = win.document.createElement('link');
          link.rel = 'stylesheet';
          link.href = sheet.href;
          win.document.head.appendChild(link);
        }
      }
    });
    const theme = document.documentElement.getAttribute('data-crm-theme');
    if (theme) win.document.documentElement.setAttribute('data-crm-theme', theme);
  }

  async function popOut(pid) {
    if (!getProject(pid)) return;
    if (!('documentPictureInPicture' in window)) {
      notify('Pop-out needs Chrome or Edge. The floating window still works.', true);
      return;
    }
    pj.pip.pid = pid;
    if (pj.pip.win && !pj.pip.win.closed) {
      renderPip();
    } else {
      let win;
      try {
        win = await window.documentPictureInPicture.requestWindow({ width: 360, height: 520 });
      } catch (e) {
        notify('Could not open the pop-out window', true);
        return;
      }
      pj.pip.win = win;
      copyStylesTo(win);
      win.document.body.className = 'pj-pip-body';
      bind(win.document);
      win.addEventListener('pagehide', () => { if (pj.pip.win === win) pj.pip.win = null; });
      renderPip();
    }
    closePanel(pid);
  }

  function closePip() {
    if (pj.pip.win && !pj.pip.win.closed) {
      try { pj.pip.win.close(); } catch (e) { /* ignore */ }
    }
    pj.pip.win = null;
  }

  function renderPip() {
    const win = pj.pip.win;
    if (!win || win.closed) return;
    let p = getProject(pj.pip.pid) || pj.projects[0];
    if (!p) { closePip(); return; }
    pj.pip.pid = p.id;
    const pr = progress(p);
    const options = pj.projects.map(x =>
      '<option value="' + esc(x.id) + '"' + (x.id === p.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('');
    win.document.body.innerHTML =
      '<div class="pj-pip" data-pj-project="' + esc(p.id) + '" style="--pj-color:' + esc(p.color || COLORS[0]) + '">' +
        '<div class="pj-pip-head">' +
          '<span class="pj-dot"></span>' +
          '<select class="pj-pip-select" data-pj-act="pip-switch" title="Switch project">' + options + '</select>' +
          '<span class="pj-count">' + pr.done + '/' + pr.total + '</span>' +
          '<button type="button" class="pj-win-btn" data-pj-act="pip-float" title="Back to the page">⇲</button>' +
        '</div>' +
        '<div class="pj-pip-body-inner">' +
          '<div class="pj-progress"><div class="pj-progress-fill" style="width:' + pr.pct + '%"></div></div>' +
          '<div class="pj-tasklist">' + tasklistInnerHtml(p) + '</div>' +
        '</div>' +
        addFormHtml(p.id) +
      '</div>';
  }

  // ── project create / edit modal ───────────────────────────────────────────
  function openProjectModal(project) {
    closeProjectModal();
    const isEdit = !!project;
    const color = (project && project.color) || COLORS[Math.floor(Math.random() * COLORS.length)];
    const overlay = document.createElement('div');
    overlay.className = 'pj-modal-overlay';
    overlay.id = 'pjModal';
    overlay.innerHTML =
      '<div class="pj-modal" role="dialog" aria-modal="true">' +
        '<div class="pj-modal-title">' + (isEdit ? 'Edit project' : 'New project') + '</div>' +
        '<label class="pj-label">Name</label>' +
        '<input type="text" class="pj-input" id="pjModalName" maxlength="160" placeholder="e.g. Hotel voucher parser" value="' + esc(project ? project.name : '') + '">' +
        '<label class="pj-label">Description <span class="pj-optional">(optional)</span></label>' +
        '<textarea class="pj-input" id="pjModalDesc" rows="2" maxlength="2000" placeholder="What is this project about?">' + esc(project ? project.description : '') + '</textarea>' +
        '<label class="pj-label">Colour</label>' +
        '<div class="pj-swatches" id="pjModalColors">' +
          COLORS.map(c => '<button type="button" class="pj-swatch' + (c === color ? ' is-active' : '') + '" data-color="' + c + '" style="background:' + c + '" aria-label="' + c + '"></button>').join('') +
        '</div>' +
        (isEdit
          ? '<label class="pj-label">Status</label><select class="pj-input" id="pjModalStatus">' +
            Object.keys(STATUS_LABEL).map(s => '<option value="' + s + '"' + (project.status === s ? ' selected' : '') + '>' + STATUS_LABEL[s] + '</option>').join('') +
            '</select>'
          : '') +
        '<div class="pj-modal-actions">' +
          (isEdit ? '<button type="button" class="pj-btn pj-btn-danger" id="pjModalDelete">Delete</button>' : '') +
          '<span style="flex:1"></span>' +
          '<button type="button" class="pj-btn" id="pjModalCancel">Cancel</button>' +
          '<button type="button" class="pj-btn pj-btn-primary" id="pjModalSave">' + (isEdit ? 'Save' : 'Create') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    let chosen = color;
    overlay.querySelectorAll('.pj-swatch').forEach(btn => btn.addEventListener('click', () => {
      chosen = btn.dataset.color;
      overlay.querySelectorAll('.pj-swatch').forEach(b => b.classList.toggle('is-active', b === btn));
    }));
    const nameInput = overlay.querySelector('#pjModalName');
    nameInput.focus();
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) closeProjectModal(); });
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeProjectModal();
      else if (e.key === 'Enter' && e.target.tagName === 'INPUT') overlay.querySelector('#pjModalSave').click();
    });
    overlay.querySelector('#pjModalCancel').addEventListener('click', closeProjectModal);
    overlay.querySelector('#pjModalSave').addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); nameInput.classList.add('is-invalid'); return; }
      const body = { name, description: overlay.querySelector('#pjModalDesc').value.trim(), color: chosen };
      const statusEl = overlay.querySelector('#pjModalStatus');
      if (statusEl) body.status = statusEl.value;
      try {
        if (isEdit) {
          const data = await api('/api/ownership/projects/' + encodeURIComponent(project.id), 'PATCH', body);
          Object.assign(project, data.project, { tasks: project.tasks });
        } else {
          const data = await api('/api/ownership/employees/' + encodeURIComponent(pj.employeeId) + '/projects', 'POST', body);
          pj.projects.push(data.project);
        }
        closeProjectModal();
        refreshAll();
      } catch (e) {
        notify(e.message || 'Could not save project', true);
      }
    });
    const delBtn = overlay.querySelector('#pjModalDelete');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (!confirm('Delete "' + project.name + '" and all of its tasks? This cannot be undone.')) return;
      try {
        await api('/api/ownership/projects/' + encodeURIComponent(project.id), 'DELETE');
        pj.projects = pj.projects.filter(p => p.id !== project.id);
        delete pj.layout[project.id];
        closeProjectModal();
        refreshAll();
      } catch (e) {
        notify(e.message || 'Could not delete project', true);
      }
    });
  }

  function closeProjectModal() {
    const m = document.getElementById('pjModal');
    if (m) m.remove();
  }

  window.addEventListener('resize', () => {
    Object.keys(pj.layout).forEach(pid => {
      const lay = pj.layout[pid];
      const el = document.querySelector('[data-pj-panel="' + pid + '"]');
      if (!lay || !el) return;
      clampLayout(lay);
      el.style.left = lay.x + 'px';
      el.style.top = lay.y + 'px';
    });
  });

  window.EWProjects = {
    activate,
    render,
    reset,
    openNewProject: () => openProjectModal(null),
    isTech,
  };
})();
