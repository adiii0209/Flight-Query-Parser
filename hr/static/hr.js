/* HR and payroll screen (Workspace settings -> HR & Payroll): people, documents, and settings, plus the document editor.
   HR.mount(rootEl) is called once, the first time the tab is opened. */
(function (HR) {
  const { esc, clone } = HR;
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  let root, state = { cfg: null, defaults: null, emps: [], docs: [] }, view = 'people', filter = { q: '', title: '' }, ed = null;

  async function api(url, opts) {
    opts = opts || {};
    const r = await fetch(url, { method: opts.method || 'GET', headers: opts.json ? { 'Content-Type': 'application/json' } : {}, body: opts.json ? JSON.stringify(opts.json) : undefined });
    let d = {}; try { d = await r.json(); } catch (e) { /* not JSON */ }
    if (!r.ok) throw new Error(d.error || 'Something went wrong (' + r.status + ')');
    return d;
  }
  function toast(msg, bad) {
    let t = $('#hrToast'); if (!t) { t = document.createElement('div'); t.id = 'hrToast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'show' + (bad ? ' bad' : ''); clearTimeout(t._t); t._t = setTimeout(() => { t.className = ''; }, 3200);
  }
  const fmtDate = iso => (iso ? HR.slashDate(iso) : '');
  const byId = id => state.emps.find(e => e.id === id);
  const titles = () => state.cfg.titles.map(t => t.name);
  const tplKeyFor = title => ((state.cfg.titles.find(t => t.name === title) || {}).template) || 'employee';
  const chipCls = t => 'chip t-' + (t === 'Intern' ? 'intern' : t === 'Employee' ? 'emp' : 'other');

  // ---------------------------------------------------------------- shell
  const IC = {
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
    slip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    cog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
    type: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7V5h16v2M9 19h6M12 5v14"/></svg>',
    build: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4"/></svg>',
  };
  const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const hue = n => { let h = 0; for (const c of String(n)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const avatar = n => '<div class="av" style="background:hsl(' + hue(n) + ' 55% 46%)">' + esc(initials(n)) + '</div>';
  const ago = iso => {
    const d = iso ? new Date(iso) : null; if (!d) return '';
    const days = Math.floor((Date.now() - d) / 864e5);
    return days < 1 ? 'Today' : days === 1 ? 'Yesterday' : days < 30 ? days + ' days ago' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  function shell() {
    root.innerHTML = '<div class="hero"><div class="tabs" id="hrTabs"></div></div><div id="hrBody"></div><dialog id="hrPerson"></dialog><dialog id="hrBulk"></dialog><div id="hrEd" hidden></div>';
    root.addEventListener('click', onClick);
    draw();
  }
  function draw() {
    $('#hrTabs').innerHTML = [['people', 'People', state.emps.length], ['documents', 'Documents', state.docs.length], ['settings', 'Letterhead & templates', '']]
      .map(t => '<button data-view="' + t[0] + '" class="' + (t[0] === view ? 'on' : '') + '">' + t[1] + (t[2] !== '' ? ' <i>' + t[2] + '</i>' : '') + '</button>').join('');
    $('#hrBody').innerHTML = view === 'people' ? peopleHtml() : view === 'documents' ? docsHtml() : settingsHtml();
  }

  // ---------------------------------------------------------------- people
  function peopleHtml() {
    const q = filter.q.toLowerCase(), active = state.emps.filter(e => e.status !== 'exited');
    const list = state.emps.filter(e => (!filter.title || e.title === filter.title) && (!q || (e.full_name + ' ' + e.designation + ' ' + e.emp_code + ' ' + e.email).toLowerCase().includes(q)));
    const pills = ['All'].concat(titles()).map(t => '<button class="pill' + ((t === 'All' && !filter.title) || t === filter.title ? ' on' : '') + '" data-filter="' + esc(t === 'All' ? '' : t) + '">' + esc(t) +
      (t === 'All' ? '' : '<i>' + state.emps.filter(e => e.title === t).length + '</i>') + '</button>').join('');
    const stats = '<div class="stats"><div class="stat"><b>' + active.length + '</b><span>Active people</span></div>' +
      titles().slice(0, 2).map(t => '<div class="stat"><b>' + active.filter(e => e.title === t).length + '</b><span>' + esc(t) + 's</span></div>').join('') +
      '<div class="stat"><b>' + state.docs.length + '</b><span>Documents made</span></div></div>';
    const bar = '<div class="bar"><div class="search">' + IC.search + '<input id="hrQ" placeholder="Search by name, role or ID" value="' + esc(filter.q) + '"></div><div class="pills">' + pills + '</div><span class="sp"></span>' +
      '<button class="hb hb-g" data-act="bulk">' + IC.slip + 'Bulk payslips</button><button class="hb hb-p" data-act="add-person">' + IC.plus + 'Onboard person</button></div>';
    if (!state.emps.length) {
      return '<div class="empty"><div class="ico">' + IC.users + '</div><b>Onboard your first person</b><p>Add them with a title like Employee or Intern, then create their offer letter and payslips in a click.</p>' +
        '<button class="hb hb-p" data-act="add-person">' + IC.plus + 'Onboard person</button></div>';
    }
    return stats + bar + (list.length ? '<div class="list">' + list.map(e => {
      const tail = e.title === 'Intern' && e.end_date ? 'Until ' + fmtDate(e.end_date) : '';
      return '<div class="card' + (e.status === 'exited' ? ' off' : '') + '">' + avatar(e.full_name) + '<div class="nm"><b>' + esc(e.full_name) + '</b><small>' + esc([e.designation, e.emp_code && 'ID ' + e.emp_code].filter(Boolean).join(' · ') || e.email || 'No designation yet') + '</small></div>' +
        '<div class="ct"><span class="' + chipCls(e.title) + '">' + esc(e.title) + (e.status === 'exited' ? ' · Exited' : '') + '</span></div>' +
        '<div class="meta"><b>' + (e.amount ? HR.inr(e.amount) : 'No amount set') + '</b>' + (e.join_date ? 'Joined ' + esc(fmtDate(e.join_date)) : 'No joining date') + (tail ? ' · ' + esc(tail) : '') + '</div>' +
        '<div class="acts"><button class="hb hb-g sm" data-act="offer" data-id="' + e.id + '">' + IC.doc + 'Offer letter</button><button class="hb hb-g sm" data-act="payslip" data-id="' + e.id + '">' + IC.slip + 'Payslip</button>' +
        '<button class="hb hb-t sm" data-act="edit-person" data-id="' + e.id + '" aria-label="Edit ' + esc(e.full_name) + '">' + IC.edit + 'Edit</button></div></div>';
    }).join('') + '</div>' : '<div class="empty"><b>No one matches</b><p>Try another name or clear the filter.</p></div>');
  }

  function personForm(e) {
    const f = (k, label, type, extra) => '<label class="fld' + (extra && extra.wide ? ' wide' : '') + '"><span>' + label + '</span>' + (type === 'textarea' ? '<textarea name="' + k + '" rows="3"' + (extra && extra.ph ? ' placeholder="' + esc(extra.ph) + '"' : '') + '>' + esc(e[k] || '') + '</textarea>' :
      '<input name="' + k + '" type="' + (type || 'text') + '" value="' + esc(e[k] == null ? '' : e[k]) + '"' + (type === 'number' ? ' min="0" step="any"' : '') + (extra && extra.ph ? ' placeholder="' + esc(extra.ph) + '"' : '') + (extra && extra.req ? ' required' : '') + '></label>');
    const seg = titles().map(t => '<label><input type="radio" name="title" value="' + esc(t) + '"' + (t === e.title ? ' checked' : '') + '><span>' + esc(t) + '</span></label>').join('');
    return '<form id="hrPersonForm" style="display:contents"><div class="dh"><div><h3>' + (e.id ? 'Edit ' + esc(e.full_name) : 'Onboard a person') + '</h3><p>' + (e.id ? 'Changes apply to new documents. Saved documents keep what they had.' : 'Add the basics now. You can fill in the rest later.') + '</p></div></div>' +
      '<div class="db"><div class="grp"><h4>Who are they?</h4><div class="seg" role="radiogroup" aria-label="Title">' + seg + '</div></div>' +
      '<div class="grp"><h4>Basics</h4><div class="grid">' + f('full_name', 'Full name', 'text', { wide: true, req: true, ph: 'e.g. Priya Sen' }) + f('designation', 'Job title <em>(printed in the letter)</em>', 'text', { wide: true, ph: 'e.g. Travel Consultant' }) +
      f('department', 'Department', 'text') + f('emp_code', 'Employee ID <em>(auto if empty)</em>', 'text') + '</div></div>' +
      '<div class="grp"><h4>Contact</h4><div class="grid">' + f('email', 'Email', 'email') + f('phone', 'Phone', 'text') + f('institute', 'College / institute <em>(interns)</em>', 'text', { wide: true }) + f('address', 'Address <em>(printed on the letter)</em>', 'textarea', { wide: true, ph: 'Street, city, PIN' }) + '</div></div>' +
      '<div class="grp"><h4>Employment</h4><div class="grid">' + f('join_date', 'Joining date', 'date') + f('end_date', 'End date <em>(interns)</em>', 'date') + f('amount', 'Monthly salary or stipend (₹)', 'number', { ph: '0' }) +
      '<label class="fld"><span>Status</span><select name="status"><option value="active"' + (e.status !== 'exited' ? ' selected' : '') + '>Active</option><option value="exited"' + (e.status === 'exited' ? ' selected' : '') + '>Exited</option></select></label></div></div>' +
      '<div class="grp"><h4>Payroll details</h4><div class="grid">' + f('pan', 'PAN', 'text') + f('bank_account', 'Bank account', 'text') + f('notes', 'Internal notes <em>(never printed)</em>', 'textarea', { wide: true }) + '</div></div></div>' +
      '<div class="df">' + (e.id ? '<button type="button" class="hb hb-d" data-act="del-person" data-id="' + e.id + '">Delete</button>' : '') + '<span class="sp"></span><button type="button" class="hb hb-g" data-act="close-person">Cancel</button><button type="submit" class="hb hb-p">' + (e.id ? 'Save changes' : 'Onboard') + '</button></div></form>';
  }
  function personDone(emp) {
    $('#hrPerson').innerHTML = '<div class="db"><div class="done"><div class="ok">' + IC.check + '</div><h3>' + esc(emp.full_name) + ' is onboarded</h3><p>' + esc(emp.title) + (emp.designation ? ' · ' + esc(emp.designation) : '') + '. What would you like to do next?</p>' +
      '<div class="next"><button class="hb hb-p" data-act="offer" data-id="' + emp.id + '">' + IC.doc + 'Create offer letter</button><button class="hb hb-g" data-act="payslip" data-id="' + emp.id + '">' + IC.slip + 'Create a payslip</button>' +
      '<button class="hb hb-t" data-act="close-person">Not now</button></div></div></div>';
  }
  function openPerson(e) {
    const d = $('#hrPerson'); d.innerHTML = personForm(e);
    d.showModal();
    $('#hrPersonForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(ev.target).entries());
      try {
        const r = await api('/api/hr/employees' + (e.id ? '/' + e.id : ''), { method: e.id ? 'PUT' : 'POST', json: body });
        if (e.id) { state.emps = state.emps.map(x => (x.id === e.id ? r.employee : x)); d.close(); toast('Saved'); } else { state.emps.push(r.employee); personDone(r.employee); }
        draw();
      } catch (err) { toast(err.message, true); }
    });
  }

  // ---------------------------------------------------------------- bulk payslips
  let bulk = null;  // { y, m, lop: {employee id: days}, on: Set of employee ids }
  const hasSlip = (eid, period) => state.docs.some(d => d.kind === 'payslip' && d.employee_id === eid && (d.summary || '').startsWith('Payslip ' + period + ' ·'));

  function bulkHtml() {
    const period = HR.monthLabel(bulk.y, bulk.m), days = HR.daysIn(bulk.y, bulk.m);
    const people = state.emps.filter(e => e.status !== 'exited');
    const months = HR.FULL_MONTHS.map((n, i) => '<option value="' + i + '"' + (i === bulk.m ? ' selected' : '') + '>' + n + '</option>').join('');
    const rows = people.map(e => {
      const done = hasSlip(e.id, period), lop = bulk.lop[e.id] || 0;
      return '<tr class="' + (done ? 'done' : '') + '"><td><input type="checkbox" data-bk="on" data-id="' + e.id + '"' + (bulk.on.has(e.id) ? ' checked' : '') + '></td><td><b>' + esc(e.full_name) + '</b><small>' + esc(e.title) + (e.designation ? ' · ' + esc(e.designation) : '') + '</small></td>' +
        '<td class="r">' + (e.amount ? HR.inr(e.amount) : '<em class="warn">No amount</em>') + '</td><td><input type="number" min="0" max="' + days + '" step="0.5" data-bk="lop" data-id="' + e.id + '" value="' + lop + '"></td><td class="r">' +
        (e.amount ? HR.inr(Math.round(e.amount * (days - lop) / days)) : '–') + '</td><td>' + (done ? '<span class="chip t-other">Already made</span>' : '') + '</td></tr>';
    }).join('');
    return '<div class="dh"><div><h3>Bulk payslips</h3><p>One payslip per person for the month. Review loss-of-pay days, then generate.</p></div></div><div class="db"><div class="bk"><label class="fld"><span>Month</span><select data-bk="m">' + months + '</select></label><label class="fld"><span>Year</span><input type="number" data-bk="y" value="' + bulk.y + '"></label>' +
      '<p class="hint">' + days + ' days in ' + esc(period) + '. Basic is reduced for loss-of-pay days. People who already have this month\u2019s payslip start unticked.</p></div>' +
      (people.length ? '<div class="tbl"><table><thead><tr><th></th><th>Person</th><th class="r">Monthly</th><th>LOP days</th><th class="r">Basic to pay</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty"><b>No active people</b></div>') + '</div>' +
      '<div class="df"><span id="hrBulkMsg" class="hint" style="margin:0"></span><span class="sp"></span><button type="button" class="hb hb-g" data-act="bulk-close">Close</button><button type="button" class="hb hb-g" data-act="bulk-print">' + IC.print + 'Generate &amp; print all</button><button type="button" class="hb hb-p" data-act="bulk-go">Generate payslips</button></div>';
  }
  function bulkPick() {  // everyone active with a salary, except who already has this month's payslip
    const period = HR.monthLabel(bulk.y, bulk.m);
    bulk.on = new Set(state.emps.filter(e => e.status !== 'exited' && e.amount > 0 && !hasSlip(e.id, period)).map(e => e.id));
  }
  function openBulk() {
    const n = new Date(), last = new Date(n.getFullYear(), n.getMonth() - 1, 1);
    bulk = { y: last.getFullYear(), m: last.getMonth(), lop: {}, on: new Set() };
    bulkPick(); $('#hrBulk').innerHTML = bulkHtml(); $('#hrBulk').showModal();
  }
  async function bulkGenerate(printAll) {
    const picked = state.emps.filter(e => bulk.on.has(e.id));
    if (!picked.length) return toast('Tick at least one person.', true);
    const msg = $('#hrBulkMsg'), made = [];
    $$('#hrBulk .hb').forEach(b => { b.disabled = true; });
    try {
      for (const e of picked) {
        msg.textContent = 'Making ' + (made.length + 1) + ' of ' + picked.length + '…';
        const doc = HR.newPayslip(state.cfg, e, bulk.y, bulk.m, bulk.lop[e.id] || 0);
        const r = await api('/api/hr/documents', { method: 'POST', json: { kind: 'payslip', employee_id: e.id, title: doc.summary, data: doc } });
        state.docs.unshift(r.document); made.push(doc);
      }
      toast(made.length + ' payslip' + (made.length === 1 ? '' : 's') + ' made for ' + HR.monthLabel(bulk.y, bulk.m));
      $('#hrBulk').close(); view = 'documents'; filter.kind = 'payslip'; draw();
      if (printAll && !HR.print(made)) toast('Allow pop-ups to print.', true);
    } catch (err) {
      toast((made.length ? made.length + ' made, then: ' : '') + err.message, true);
      $$('#hrBulk .hb').forEach(b => { b.disabled = false; }); msg.textContent = '';
    }
  }

  // ---------------------------------------------------------------- documents list
  function docsHtml() {
    const k = filter.kind || '', n = x => state.docs.filter(d => !x || d.kind === x).length;
    const list = state.docs.filter(d => !k || d.kind === k);
    return '<div class="bar"><div class="pills">' + [['', 'All'], ['offer', 'Offer letters'], ['payslip', 'Payslips']].map(t => '<button class="pill' + (k === t[0] ? ' on' : '') + '" data-kind="' + t[0] + '">' + t[1] + '<i>' + n(t[0]) + '</i></button>').join('') + '</div></div>' +
      (list.length ? '<div class="list">' + list.map(d => {
        const e = byId(d.employee_id), offer = d.kind === 'offer';
        return '<div class="card doc"><div class="dk ' + d.kind + '">' + (offer ? IC.doc : IC.slip) + '</div><div class="nm"><b>' + esc(d.summary || d.title) + '</b><small>' + (offer ? 'Offer letter' : 'Payslip') + (e ? ' · ' + esc(e.full_name) : '') + '</small></div>' +
          '<div class="meta">Edited<b>' + esc(ago(d.updated_at)) + '</b></div><div class="acts"><button class="hb hb-g sm" data-act="open-doc" data-id="' + d.id + '">' + IC.edit + 'Open &amp; edit</button><button class="hb hb-g sm" data-act="print-doc" data-id="' + d.id + '">' + IC.print + 'PDF</button>' +
          '<button class="hb hb-t sm" data-act="del-doc" data-id="' + d.id + '">Delete</button></div></div>';
      }).join('') + '</div>' : '<div class="empty"><div class="ico">' + IC.doc + '</div><b>No documents yet</b><p>Create an offer letter or a payslip from the People tab, or generate payslips for everyone at once.</p><button class="hb hb-p" data-act="bulk">' + IC.slip + 'Bulk payslips</button></div>');
  }

  // ---------------------------------------------------------------- settings
  function settingsHtml() {
    const c = state.cfg, co = c.company, tpls = Object.keys(c.offers);
    const f = (path, label, val, wide, type) => '<label class="fld' + (wide ? ' wide' : '') + '"><span>' + label + '</span>' + (type === 'textarea' ? '<textarea data-s="' + path + '" rows="3">' + esc(val) + '</textarea>' : '<input data-s="' + path + '" value="' + esc(val) + '">') + '</label>';
    return '<div class="sec"><h3>Letterhead</h3><div class="grid">' + f('company.name', 'Company name (top of letters and payslips)', co.name, true) + f('company.short_name', 'Short name (used in the text)', co.short_name) + f('company.legal_name', 'Legal name (used in the text)', co.legal_name) +
      f('company.address', 'Address (one line per row)', co.address, true, 'textarea') + f('company.phone', 'Phone', co.phone) + f('company.email', 'Email', co.email) +
      '<div class="fld wide"><span>Logo</span><div class="logo">' + (co.logo ? '<img src="' + esc(co.logo) + '" alt="">' : '<em>No logo</em>') + '<label class="hb hb-g sm">Upload<input type="file" accept="image/*" hidden id="hrLogo"></label>' +
      (co.logo ? '<button class="hb hb-g sm" data-act="logo-clear">Remove</button>' : '') + '</div></div>' + f('signatory.name', 'Signatory name', c.signatory.name) + f('signatory.title', 'Signatory title', c.signatory.title) + '</div></div>' +
      '<div class="sec"><h3>Titles</h3><p class="hint">A title decides which offer letter a person gets. Assign it when onboarding. Add Consultant, Trainee, or anything else you use.</p><div class="trows">' +
      c.titles.map((t, i) => '<div class="trow"><input data-s="titles.' + i + '.name" value="' + esc(t.name) + '"><select data-s="titles.' + i + '.template">' + tpls.map(k => '<option value="' + esc(k) + '"' + (k === t.template ? ' selected' : '') + '>' + esc(c.offers[k].label || k) + '</option>').join('') +
        '</select>' + (c.titles.length > 1 ? '<button class="hb hb-g sm" data-act="rm-title" data-i="' + i + '">Remove</button>' : '') + '</div>').join('') + '</div><button class="hb hb-g sm" data-act="add-title">+ Add title</button></div>' +
      '<div class="sec"><h3>Offer letter templates</h3><p class="hint">Edit the wording once; every new letter starts from it. Letters already generated are not changed.</p>' +
      tpls.map(k => '<div class="trow"><b>' + esc(c.offers[k].label || k) + '</b><span class="sp"></span><button class="hb hb-g sm" data-act="edit-tpl" data-k="' + esc(k) + '">Edit wording</button><button class="hb hb-g sm" data-act="dup-tpl" data-k="' + esc(k) + '">Duplicate</button>' +
        (state.defaults.offers[k] ? '<button class="hb hb-g sm" data-act="reset-tpl" data-k="' + esc(k) + '">Reset</button>' : '<button class="hb hb-g sm" data-act="del-tpl" data-k="' + esc(k) + '">Delete</button>') + '</div>').join('') + '</div>' +
      '<div class="sec"><h3>Payslip defaults</h3><div class="grid"><label class="fld"><span>Earnings (one per line)</span><textarea data-s="payslip.earnings" data-lines rows="5">' + esc(c.payslip.earnings.join('\n')) + '</textarea></label>' +
      '<label class="fld"><span>Deductions (one per line)</span><textarea data-s="payslip.deductions" data-lines rows="5">' + esc(c.payslip.deductions.join('\n')) + '</textarea></label>' + f('payslip.footer', 'Footer note', c.payslip.footer, true) +
      '<label class="fld"><span>Accent colour</span><input type="color" data-s="payslip.accent" value="' + esc(c.payslip.accent) + '"></label></div></div>' +
      '<div class="savebar"><button class="hb hb-p" data-act="save-config">Save settings</button></div>';
  }
  function setPath(obj, path, val) {
    const p = path.split('.'); let o = obj;
    for (let i = 0; i < p.length - 1; i++) o = o[p[i]];
    o[p[p.length - 1]] = val;
  }
  async function saveConfig(quiet) {
    try { state.cfg = (await api('/api/hr/config', { method: 'PUT', json: state.cfg })).config; if (!quiet) toast('Settings saved'); return true; } catch (e) { toast(e.message, true); return false; }
  }

  // ---------------------------------------------------------------- editor
  const BLOCKS = [['p', 'Paragraph'], ['h', 'Heading'], ['num', 'Numbered clause'], ['sign', 'Signature'], ['accept', 'Acceptance lines'], ['sp', 'Space'], ['pb', 'New page']];
  const FONTS = [['Times New Roman, serif', 'Times (serif)'], ['Georgia, serif', 'Georgia'], ['Arial, Helvetica, sans-serif', 'Arial'], ['Calibri, Carlito, sans-serif', 'Calibri']];

  function openEditor(doc, meta) {
    ed = Object.assign({ doc, id: null, employee_id: null, mode: 'doc', dirty: false }, meta);
    const el = $('#hrEd'); el.hidden = false; document.body.classList.add('hr-lock');
    el.innerHTML = '<div class="eb"><button class="hb hb-g sm" data-act="ed-close">← Back</button><div><h2 id="hrEdTitle"></h2><small id="hrEdSub"></small></div><span class="sp"></span><span class="st" id="hrEdState">' + (ed.id ? 'Saved' : 'Not saved yet') + '</span>' +
      (ed.mode === 'doc' ? '<button class="hb hb-g" data-act="ed-print">' + IC.print + 'Print / PDF</button>' : '') + '<button class="hb hb-p" data-act="ed-save">' + (ed.mode === 'template' ? 'Save template' : 'Save') + '</button></div>' +
      '<div class="em"><aside id="hrEdForm"></aside><div class="hr-prevwrap" id="hrPrevWrap"><div class="pvh"><span id="hrPvInfo"></span></div><div id="hrPrev"></div></div></div>';
    drawEdForm(); drawPreview();
    window.addEventListener('resize', fitPreview);
  }
  function closeEditor() {
    if (ed && ed.dirty && !confirm('Close without saving your changes?')) return;
    $('#hrEd').hidden = true; $('#hrEd').innerHTML = ''; document.body.classList.remove('hr-lock'); window.removeEventListener('resize', fitPreview); ed = null;
  }
  const mark = () => { ed.dirty = true; const st = $('#hrEdState'); st.textContent = 'Unsaved changes'; st.classList.add('dirty'); };

  function previewDoc() {
    const d = clone(ed.doc);
    if (ed.mode === 'template') {  // no person yet: show the variables nobody has filled in as placeholders
      const demo = { name: 'Full Name', title: 'Job Title', join_date: 'DD Month YYYY', salary: '0', salary_words: 'Zero' };
      d.vars = Object.assign(demo, d.vars); d.date = d.date || HR.today(); d.recipient = d.recipient || 'Full Name\nAddress';
    }
    if (d.kind === 'offer' && d.vars && d.vars.salary && !d.vars.salary_words) d.vars.salary_words = HR.words(HR.num(d.vars.salary));
    return d;
  }
  function drawPreview() {
    $('#hrPrev').innerHTML = '<div id="hrPrevIn"><style>' + HR.CSS.replace(/@page\{[^}]*\}/, '').replace(/@media print\{.*\}\s*$/s, '') + '</style><div class="hr-sheet">' + HR.html(previewDoc()) + '</div></div>';
    const e = byId(ed.employee_id);
    $('#hrEdTitle').textContent = ed.mode === 'template' ? ed.doc.label || 'Template' : (ed.doc.kind === 'payslip' ? 'Payslip · ' + (ed.doc.period || '') : ed.doc.summary || 'Offer letter');
    $('#hrEdSub').textContent = ed.mode === 'template' ? 'Template wording. New letters start from this.' : (e ? e.full_name + ' · ' + e.title : '');
    const pages = $$('#hrPrevIn .pg').length;
    $('#hrPvInfo').textContent = 'A4 · ' + pages + (pages === 1 ? ' page' : ' pages') + ' · changes show instantly';
    fitPreview();
  }
  function fitPreview() {
    const w = $('#hrPrevWrap'), p = $('#hrPrev'), inner = $('#hrPrevIn'); if (!w || !p || !inner) return;
    const s = Math.min(1, (w.clientWidth - 32) / 794);  // the paper is 794px wide (A4); shrink it to fit the screen
    inner.style.cssText = 'width:794px;transform-origin:top left;transform:scale(' + s + ')';
    p.style.width = 794 * s + 'px'; p.style.height = inner.offsetHeight * s + 'px';
  }

  const inp = (path, label, val, type, wide, extra) => '<label class="fld' + (wide ? ' wide' : '') + '"><span>' + label + '</span>' +
    (type === 'textarea' ? '<textarea data-p="' + path + '" rows="' + ((extra && extra.rows) || 3) + '">' + esc(val) + '</textarea>' : '<input data-p="' + path + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '"' + (type === 'number' ? ' step="any"' : '') + '>') + '</label>';
  const sec = (title, body, open, icon) => '<details class="es"' + (open ? ' open' : '') + '><summary><span class="si">' + (IC[icon] || IC[/^Details/.test(title) ? 'type' : /^Company/.test(title) ? 'build' : /^Payslip/.test(title) ? 'slip' : /^Employee/.test(title) ? 'users' : /^(Earn|Deduc)/.test(title) ? 'plus' : 'doc']) + '</span>' + title + '</summary><div class="grid">' + body + '</div></details>';
  const pretty = k => k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

  function companyFields(d) {
    const c = d.company || {};
    return inp('company.name', 'Company name', c.name, 'text', true) + inp('company.short_name', 'Short name', c.short_name) + inp('company.legal_name', 'Legal name', c.legal_name) + inp('company.address', 'Address', c.address, 'textarea', true) + inp('company.phone', 'Phone', c.phone) + inp('company.email', 'Email', c.email) +
      (d.kind === 'offer' ? inp('signatory.name', 'Signatory name', d.signatory.name) + inp('signatory.title', 'Signatory title', d.signatory.title) : '');
  }

  function drawEdForm() {
    const d = ed.doc, f = $('#hrEdForm'), keep = $$('details', f).map(x => x.open);
    let h = '';
    if (d.kind === 'offer') {
      const used = new Set(); (d.blocks || []).forEach(b => HR.varsIn(b.text).forEach(k => used.add(k))); HR.varsIn(d.header_title).forEach(k => used.add(k));
      const builtin = ['company_short', 'company_legal', 'company_name', 'signatory_name', 'signatory_title', 'date'];
      const keys = Array.from(new Set(Object.keys(d.vars || {}).concat(Array.from(used).filter(k => !builtin.includes(k)))));
      h += sec('Letter', (ed.mode === 'doc' ? inp('date', 'Date', d.date, 'date') + inp('recipient', 'Addressed to', d.recipient, 'textarea', true, { rows: 4 }) : inp('label', 'Template name', d.label, 'text', true)) +
        '<label class="fld"><span>Letterhead</span><select data-p="letterhead">' + [['company', 'Company block + logo'], ['logo', 'Title + logo'], ['none', 'None']].map(o => '<option value="' + o[0] + '"' + (d.letterhead === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>' +
        inp('header_title', 'Header title (each page)', d.header_title) +
        '<label class="fld"><span>Font</span><select data-p="style.font">' + FONTS.map(o => '<option value="' + esc(o[0]) + '"' + (d.style.font === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>' +
        inp('style.size', 'Font size (pt)', d.style.size, 'number') + '<label class="fld"><span>Alignment</span><select data-p="style.align"><option value="justify"' + (d.style.align !== 'left' ? ' selected' : '') + '>Justified</option><option value="left"' + (d.style.align === 'left' ? ' selected' : '') + '>Left</option></select></label>', true);
      h += sec('Details in the text <small>' + keys.length + '</small>', keys.map(k => inp('vars.' + k, pretty(k), d.vars[k] == null ? '' : d.vars[k], 'text', k === 'salary_words')).join('') +
        '<div class="addvar wide"><input id="hrNewVar" placeholder="New detail, e.g. reporting_manager"><button class="hb hb-g sm" data-act="add-var">Add</button></div><p class="hint wide">Use a detail in the text as {{name}}. Salary words fill themselves from the salary.</p>', true);
      h += sec('Company & signatory', companyFields(d) + '<div class="fld wide"><span>Logo</span><div class="logo">' + (d.company.logo ? '<img src="' + esc(d.company.logo) + '" alt="">' : '<em>No logo</em>') +
        '<label class="hb hb-g sm">Upload<input type="file" accept="image/*" hidden data-logo></label>' + (d.company.logo ? '<button class="hb hb-g sm" data-act="ed-logo-clear">Remove</button>' : '') + '</div></div>');
      h += '<details class="es" open><summary><span class="si">' + IC.type + '</span>Text <small>' + d.blocks.length + ' blocks</small></summary><div class="blocks">' + d.blocks.map((b, i) => blockEd(b, i, d.blocks.length)).join('') +
        '<div class="addblk"><select id="hrBlkType">' + BLOCKS.map(o => '<option value="' + o[0] + '">' + o[1] + '</option>').join('') + '</select><button class="hb hb-g sm" data-act="add-block">+ Add</button></div></div></details>';
    } else {
      h += sec('Payslip', inp('period', 'Month', d.period) + inp('pay_date', 'Pay date', d.pay_date, 'date') + inp('paid_days', 'Paid days', d.paid_days, 'number') + inp('lop_days', 'LOP days', d.lop_days, 'number') +
        '<label class="fld"><span>Accent colour</span><input type="color" data-p="accent" value="' + esc(d.accent) + '"></label><label class="fld chk"><input type="checkbox" data-p="show_words"' + (d.show_words ? ' checked' : '') + '> Show amount in words</label>' + inp('footer', 'Footer note', d.footer, 'text', true), true);
      h += sec('Employee summary', d.rows.map((r, i) => '<div class="rowin wide"><input data-p="rows.' + i + '.label" value="' + esc(r.label) + '"><input data-p="rows.' + i + '.value" value="' + esc(r.value) + '"><button class="xb" data-act="rm-row" data-l="rows" data-i="' + i + '">×</button></div>').join('') + '<button class="hb hb-g sm wide" data-act="add-row" data-l="rows">+ Add row</button>', true);
      ['earnings', 'deductions'].forEach(l => {
        h += sec(pretty(l), d[l].map((r, i) => '<div class="rowin wide"><input data-p="' + l + '.' + i + '.label" value="' + esc(r.label) + '"><input type="number" step="any" data-p="' + l + '.' + i + '.amount" value="' + esc(r.amount) + '"><button class="xb" data-act="rm-row" data-l="' + l + '" data-i="' + i + '">×</button></div>').join('') +
          '<button class="hb hb-g sm wide" data-act="add-row" data-l="' + l + '">+ Add ' + (l === 'earnings' ? 'earning' : 'deduction') + '</button>', true);
      });
      h += sec('Company', companyFields(d));
    }
    f.innerHTML = h;
    $$('details', f).forEach((x, i) => { if (keep[i] !== undefined) x.open = keep[i]; });
  }
  function blockEd(b, i, n) {
    const text = b.t === 'pb' || b.t === 'sp' ? '<em class="hint">' + (b.t === 'pb' ? 'Starts a new page' : 'Blank space') + '</em>' : '<textarea data-p="blocks.' + i + '.text" rows="' + Math.min(10, Math.max(2, Math.ceil(String(b.text || '').length / 55))) + '">' + esc(b.text) + '</textarea>';
    return '<div class="blk"><div class="blkh"><select data-p="blocks.' + i + '.t">' + BLOCKS.map(o => '<option value="' + o[0] + '"' + (b.t === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select><span class="sp"></span>' +
      '<button data-act="blk-up" data-i="' + i + '"' + (i ? '' : ' disabled') + '>↑</button><button data-act="blk-dn" data-i="' + i + '"' + (i < n - 1 ? '' : ' disabled') + '>↓</button><button class="xb" data-act="blk-rm" data-i="' + i + '">×</button></div>' + text + '</div>';
  }

  function onEdInput(e) {
    const t = e.target, p = t.dataset.p;
    if (!p || !ed) return;
    const val = t.type === 'checkbox' ? t.checked : t.type === 'number' ? (t.value === '' ? '' : Number(t.value)) : t.value;
    setPath(ed.doc, p, val);
    mark();
    if (ed.doc.kind === 'payslip' && (p === 'period' || p === 'pay_date')) {  // the summary rows follow the month and the pay date until someone types over them
      const row = ed.doc.rows.find(r => r.label === (p === 'period' ? 'Pay Period' : 'Pay Date'));
      if (row) { row.value = p === 'period' ? val : HR.slashDate(val); if (e.type === 'change') drawEdForm(); }
    }
    if (e.type === 'change' && (p.endsWith('.t') || p === 'letterhead')) drawEdForm();
    drawPreview();
  }

  async function saveEditor() {
    const d = ed.doc;
    try {
      if (ed.mode === 'template') {
        state.cfg.offers[ed.key] = { label: d.label, letterhead: d.letterhead, header_title: d.header_title, vars: d.vars, blocks: d.blocks };
        if (await saveConfig(true)) { ed.dirty = false; toast('Template saved'); closeEditor(); draw(); }
        return;
      }
      const e = byId(ed.employee_id);
      if (d.kind === 'offer') d.summary = (state.cfg.offers[d.template] ? state.cfg.offers[d.template].label : 'Offer letter') + ' · ' + (d.vars.name || (e && e.full_name) || '');
      else d.summary = 'Payslip ' + d.period + ' · ' + ((d.rows[0] && d.rows[0].value) || (e && e.full_name) || '');
      if (d.kind === 'payslip') d.summary_net = HR.totals(d).net;
      const r = await api('/api/hr/documents' + (ed.id ? '/' + ed.id : ''), { method: ed.id ? 'PUT' : 'POST', json: { kind: d.kind, employee_id: ed.employee_id, title: d.summary, data: d } });
      ed.id = r.document.id; ed.dirty = false;
      state.docs = [r.document].concat(state.docs.filter(x => x.id !== r.document.id));
      const st = $('#hrEdState'); st.textContent = 'Saved'; st.classList.remove('dirty'); drawPreview(); toast('Saved');
    } catch (err) { toast(err.message, true); }
  }

  function readLogo(file, done) {
    if (!file) return;
    if (file.size > 250000) return toast('Use a logo under 250 KB.', true);
    const fr = new FileReader(); fr.onload = () => done(String(fr.result)); fr.readAsDataURL(file);
  }

  // ---------------------------------------------------------------- clicks
  async function onClick(e) {
    const v = e.target.closest('[data-view]'); if (v) { view = v.dataset.view; draw(); return; }
    const fl = e.target.closest('[data-filter]'); if (fl) { filter.title = fl.dataset.filter; draw(); return; }
    const kd = e.target.closest('[data-kind]'); if (kd) { filter.kind = kd.dataset.kind; draw(); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, id = +b.dataset.id, i = +b.dataset.i;
    const emp = byId(id);
    if (act === 'bulk') return openBulk();
    if (act === 'bulk-close') return $('#hrBulk').close();
    if (act === 'bulk-go') return bulkGenerate(false);
    if (act === 'bulk-print') return bulkGenerate(true);
    if (act === 'add-person') return openPerson({ title: titles()[0], status: 'active' });
    if (act === 'edit-person') return openPerson(emp);
    if (act === 'close-person') return $('#hrPerson').close();
    if (act === 'del-person') { if (!confirm('Delete this person and every document made for them?')) return; try { await api('/api/hr/employees/' + id, { method: 'DELETE' }); state.emps = state.emps.filter(x => x.id !== id); state.docs = state.docs.filter(x => x.employee_id !== id); $('#hrPerson').close(); draw(); } catch (err) { toast(err.message, true); } return; }
    if (act === 'offer') return openEditor(HR.newOffer(state.cfg, emp, tplKeyFor(emp.title)), { employee_id: id });
    if (act === 'payslip') {  // starts on last month, the one being paid
      const n = new Date(), last = new Date(n.getFullYear(), n.getMonth() - 1, 1);
      return openEditor(HR.newPayslip(state.cfg, emp, last.getFullYear(), last.getMonth()), { employee_id: id });
    }
    if (act === 'open-doc' || act === 'print-doc') {
      try { const d = (await api('/api/hr/documents/' + id)).document; if (act === 'print-doc') { if (!HR.print(d.data)) toast('Allow pop-ups to print.', true); return; } openEditor(d.data, { id, employee_id: d.employee_id }); } catch (err) { toast(err.message, true); } return;
    }
    if (act === 'del-doc') { if (!confirm('Delete this document?')) return; try { await api('/api/hr/documents/' + id, { method: 'DELETE' }); state.docs = state.docs.filter(x => x.id !== id); draw(); } catch (err) { toast(err.message, true); } return; }
    // settings
    if (act === 'save-config') return saveConfig();
    if (act === 'add-title') { state.cfg.titles.push({ name: 'New title', template: 'employee' }); return draw(); }
    if (act === 'rm-title') { state.cfg.titles.splice(i, 1); return draw(); }
    if (act === 'logo-clear') { state.cfg.company.logo = ''; return draw(); }
    if (act === 'edit-tpl') { const t = clone(state.cfg.offers[b.dataset.k]); return openEditor(Object.assign(t, { kind: 'offer', company: clone(state.cfg.company), signatory: clone(state.cfg.signatory), style: { font: FONTS[0][0], size: 11, align: 'justify', rule: true } }), { mode: 'template', key: b.dataset.k }); }
    if (act === 'dup-tpl') { const k = 'tpl' + Date.now().toString(36), t = clone(state.cfg.offers[b.dataset.k]); t.label = (t.label || 'Template') + ' copy'; state.cfg.offers[k] = t; return draw(); }
    if (act === 'reset-tpl') { if (confirm('Put the original wording back?')) { state.cfg.offers[b.dataset.k] = clone(state.defaults.offers[b.dataset.k]); await saveConfig(true); draw(); } return; }
    if (act === 'del-tpl') { if (state.cfg.titles.some(t => t.template === b.dataset.k)) return toast('A title still uses this template.', true); delete state.cfg.offers[b.dataset.k]; return draw(); }
    // editor
    if (!ed) return;
    if (act === 'ed-close') return closeEditor();
    if (act === 'ed-save') return saveEditor();
    if (act === 'ed-print') { if (!HR.print(previewDoc())) toast('Allow pop-ups to print.', true); return; }
    if (act === 'ed-logo-clear') { ed.doc.company.logo = ''; mark(); drawEdForm(); return drawPreview(); }
    const d = ed.doc;
    if (act === 'add-var') { const k = ($('#hrNewVar').value || '').trim().replace(/[^A-Za-z0-9_]+/g, '_').toLowerCase(); if (k) { d.vars[k] = ''; mark(); drawEdForm(); } return; }
    if (act === 'add-block') { d.blocks.push({ t: $('#hrBlkType').value, text: '' }); mark(); drawEdForm(); drawPreview(); return; }
    if (act === 'blk-rm') { d.blocks.splice(i, 1); }
    else if (act === 'blk-up' && i > 0) { d.blocks.splice(i - 1, 0, d.blocks.splice(i, 1)[0]); }
    else if (act === 'blk-dn') { d.blocks.splice(i + 1, 0, d.blocks.splice(i, 1)[0]); }
    else if (act === 'add-row') { d[b.dataset.l].push(b.dataset.l === 'rows' ? { label: '', value: '' } : { label: '', amount: 0 }); }
    else if (act === 'rm-row') { d[b.dataset.l].splice(i, 1); }
    else return;
    mark(); drawEdForm(); drawPreview();
  }

  // ---------------------------------------------------------------- boot
  async function mount(el) {
    root = el;
    root.innerHTML = '<p class="hint">Loading…</p>';
    try {
      const d = await api('/api/hr/bootstrap');
      state = { cfg: d.config, defaults: d.defaults, emps: d.employees, docs: d.documents };
    } catch (err) { root.innerHTML = '<p class="hint">' + esc(err.message) + '</p>'; return; }
    shell();
    root.addEventListener('input', e => {
      if (e.target.id === 'hrQ') { filter.q = e.target.value; const pos = e.target.selectionStart; draw(); const q = $('#hrQ'); q.focus(); q.setSelectionRange(pos, pos); return; }
      const s = e.target.dataset.s;
      if (s) { const val = e.target.hasAttribute('data-lines') ? e.target.value.split('\n').map(x => x.trim()).filter(Boolean) : e.target.value; setPath(state.cfg, s, val); }
    });
    root.addEventListener('change', e => {  // the bulk payslip dialog
      const k = e.target.dataset.bk; if (!k || !bulk) return;
      const id = +e.target.dataset.id;
      if (k === 'on') { if (e.target.checked) bulk.on.add(id); else bulk.on.delete(id); return; }
      if (k === 'lop') bulk.lop[id] = Math.max(0, Math.min(Number(e.target.value) || 0, HR.daysIn(bulk.y, bulk.m)));
      else if (k === 'm') bulk.m = +e.target.value;
      else if (k === 'y') bulk.y = Math.max(2000, Math.min(+e.target.value || bulk.y, 2100));
      if (k !== 'lop') bulkPick();
      $('#hrBulk').innerHTML = bulkHtml();
    });
    root.addEventListener('change', e => { if (e.target.id === 'hrLogo') readLogo(e.target.files[0], url => { state.cfg.company.logo = url; draw(); }); });
    $('#hrEd').addEventListener('input', onEdInput);
    $('#hrEd').addEventListener('change', e => {
      if (e.target.matches('[data-logo]')) return readLogo(e.target.files[0], url => { ed.doc.company.logo = url; mark(); drawEdForm(); drawPreview(); });
      onEdInput(e);
    });
  }
  HR.mount = mount;
})(window.HR);
