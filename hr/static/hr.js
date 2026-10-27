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
  const chipCls = t => 'hr-chip t-' + (t === 'Intern' ? 'intern' : t === 'Employee' ? 'emp' : 'other');

  // ---------------------------------------------------------------- shell
  function shell() {
    root.innerHTML = '<div class="hr"><div class="hr-top"><div class="hr-tabs">' +
      [['people', 'People'], ['documents', 'Documents'], ['settings', 'Letterhead & templates']].map(t => '<button data-view="' + t[0] + '">' + t[1] + '</button>').join('') +
      '</div></div><div id="hrBody"></div></div><dialog id="hrPerson"></dialog><div id="hrEd" hidden></div>';
    root.addEventListener('click', onClick);
    $$('.hr-tabs button', root).forEach(b => b.classList.toggle('on', b.dataset.view === view));
    draw();
  }
  function draw() {
    $$('.hr-tabs button', root).forEach(b => b.classList.toggle('on', b.dataset.view === view));
    $('#hrBody').innerHTML = view === 'people' ? peopleHtml() : view === 'documents' ? docsHtml() : settingsHtml();
  }

  // ---------------------------------------------------------------- people
  function peopleHtml() {
    const q = filter.q.toLowerCase();
    const list = state.emps.filter(e => (!filter.title || e.title === filter.title) && (!q || (e.full_name + ' ' + e.designation + ' ' + e.emp_code + ' ' + e.email).toLowerCase().includes(q)));
    const chips = ['All'].concat(titles()).map(t => '<button class="hr-f' + ((t === 'All' && !filter.title) || t === filter.title ? ' on' : '') + '" data-filter="' + esc(t === 'All' ? '' : t) + '">' + esc(t) +
      (t === 'All' ? '' : ' <i>' + state.emps.filter(e => e.title === t).length + '</i>') + '</button>').join('');
    return '<div class="hr-bar"><input class="hr-search" id="hrQ" placeholder="Search people" value="' + esc(filter.q) + '"><div class="hr-fs">' + chips + '</div><button class="btn primary" data-act="add-person">+ Onboard person</button></div>' +
      (list.length ? '<div class="hr-tw"><table class="hr-t"><thead><tr><th>ID</th><th>Name</th><th>Title</th><th>Designation</th><th>Joined</th><th class="r">Monthly</th><th></th></tr></thead><tbody>' +
        list.map(e => '<tr class="' + (e.status === 'exited' ? 'off' : '') + '"><td>' + esc(e.emp_code) + '</td><td><b>' + esc(e.full_name) + '</b><small>' + esc(e.email || e.phone) + '</small></td><td><span class="' + chipCls(e.title) + '">' + esc(e.title) + '</span></td><td>' + esc(e.designation) +
          '</td><td>' + esc(fmtDate(e.join_date)) + '</td><td class="r">' + (e.amount ? HR.inr(e.amount) : '–') + '</td><td class="act"><button class="btn secondary sm" data-act="offer" data-id="' + e.id + '">Offer letter</button><button class="btn secondary sm" data-act="payslip" data-id="' + e.id +
          '">Payslip</button><button class="btn secondary sm" data-act="edit-person" data-id="' + e.id + '">Edit</button></td></tr>').join('') + '</tbody></table></div>' :
        '<div class="hr-empty"><b>' + (state.emps.length ? 'No one matches' : 'No one onboarded yet') + '</b><p>Onboard a person, give them a title, and generate their offer letter and payslips.</p></div>');
  }

  function personForm(e) {
    const f = (k, label, type, extra) => '<label class="hr-f2' + (extra && extra.wide ? ' wide' : '') + '"><span>' + label + '</span>' + (type === 'textarea' ? '<textarea name="' + k + '" rows="3">' + esc(e[k] || '') + '</textarea>' :
      '<input name="' + k + '" type="' + (type || 'text') + '" value="' + esc(e[k] == null ? '' : e[k]) + '"' + (type === 'number' ? ' min="0" step="any"' : '') + '></label>');
    return '<form method="dialog" id="hrPersonForm"><h3>' + (e.id ? 'Edit person' : 'Onboard a person') + '</h3><div class="hr-g">' +
      '<label class="hr-f2"><span>Title</span><select name="title">' + titles().map(t => '<option' + (t === e.title ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select></label>' +
      f('full_name', 'Full name', 'text') + f('designation', 'Designation / job title (shown in the letter)', 'text', { wide: true }) + f('emp_code', 'Employee ID', 'text') + f('department', 'Department', 'text') +
      f('email', 'Email', 'email') + f('phone', 'Phone', 'text') + f('institute', 'College / institute (for interns)', 'text', { wide: true }) + f('address', 'Address', 'textarea', { wide: true }) +
      f('join_date', 'Joining date', 'date') + f('end_date', 'End date (interns)', 'date') + f('amount', 'Monthly salary / stipend (₹)', 'number') + f('pan', 'PAN', 'text') + f('bank_account', 'Bank account', 'text') +
      '<label class="hr-f2"><span>Status</span><select name="status"><option value="active"' + (e.status !== 'exited' ? ' selected' : '') + '>Active</option><option value="exited"' + (e.status === 'exited' ? ' selected' : '') + '>Exited</option></select></label>' +
      f('notes', 'Internal notes', 'textarea', { wide: true }) + '</div><div class="hr-dact">' + (e.id ? '<button type="button" class="btn danger" data-act="del-person" data-id="' + e.id + '">Delete</button>' : '') +
      '<span class="sp"></span><button type="button" class="btn secondary" data-act="close-person">Cancel</button><button type="submit" class="btn primary">Save</button></div></form>';
  }
  function openPerson(e) {
    const d = $('#hrPerson'); d.innerHTML = personForm(e);
    d.showModal();
    $('#hrPersonForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(ev.target).entries());
      try {
        const r = await api('/api/hr/employees' + (e.id ? '/' + e.id : ''), { method: e.id ? 'PUT' : 'POST', json: body });
        if (e.id) state.emps = state.emps.map(x => (x.id === e.id ? r.employee : x)); else state.emps.push(r.employee);
        d.close(); draw(); toast('Saved');
      } catch (err) { toast(err.message, true); }
    });
  }

  // ---------------------------------------------------------------- documents list
  function docsHtml() {
    const k = filter.kind || '';
    const list = state.docs.filter(d => !k || d.kind === k);
    return '<div class="hr-bar"><div class="hr-fs">' + [['', 'All'], ['offer', 'Offer letters'], ['payslip', 'Payslips']].map(t => '<button class="hr-f' + (k === t[0] ? ' on' : '') + '" data-kind="' + t[0] + '">' + t[1] + '</button>').join('') + '</div></div>' +
      (list.length ? '<div class="hr-tw"><table class="hr-t"><thead><tr><th>Document</th><th>Person</th><th>Updated</th><th></th></tr></thead><tbody>' + list.map(d => {
        const e = byId(d.employee_id);
        return '<tr><td><b>' + esc(d.summary || d.title) + '</b><small>' + (d.kind === 'offer' ? 'Offer letter' : 'Payslip') + '</small></td><td>' + (e ? esc(e.full_name) : '–') + '</td><td>' + esc((d.updated_at || '').slice(0, 10)) +
          '</td><td class="act"><button class="btn secondary sm" data-act="open-doc" data-id="' + d.id + '">Open &amp; edit</button><button class="btn secondary sm" data-act="print-doc" data-id="' + d.id + '">PDF</button><button class="btn secondary sm" data-act="del-doc" data-id="' + d.id + '">Delete</button></td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="hr-empty"><b>No documents yet</b><p>Generate an offer letter or payslip from the People tab.</p></div>');
  }

  // ---------------------------------------------------------------- settings
  function settingsHtml() {
    const c = state.cfg, co = c.company, tpls = Object.keys(c.offers);
    const f = (path, label, val, wide, type) => '<label class="hr-f2' + (wide ? ' wide' : '') + '"><span>' + label + '</span>' + (type === 'textarea' ? '<textarea data-s="' + path + '" rows="3">' + esc(val) + '</textarea>' : '<input data-s="' + path + '" value="' + esc(val) + '">') + '</label>';
    return '<div class="hr-card"><h3>Letterhead</h3><div class="hr-g">' + f('company.name', 'Company name (top of letters and payslips)', co.name, true) + f('company.short_name', 'Short name (used in the text)', co.short_name) + f('company.legal_name', 'Legal name (used in the text)', co.legal_name) +
      f('company.address', 'Address (one line per row)', co.address, true, 'textarea') + f('company.phone', 'Phone', co.phone) + f('company.email', 'Email', co.email) +
      '<div class="hr-f2 wide"><span>Logo</span><div class="hr-logo">' + (co.logo ? '<img src="' + esc(co.logo) + '" alt="">' : '<em>No logo</em>') + '<label class="btn secondary sm">Upload<input type="file" accept="image/*" hidden id="hrLogo"></label>' +
      (co.logo ? '<button class="btn secondary sm" data-act="logo-clear">Remove</button>' : '') + '</div></div>' + f('signatory.name', 'Signatory name', c.signatory.name) + f('signatory.title', 'Signatory title', c.signatory.title) + '</div></div>' +
      '<div class="hr-card"><h3>Titles</h3><p class="hr-hint">A title decides which offer letter a person gets. Assign it when onboarding. Add Consultant, Trainee, or anything else you use.</p><div class="hr-titles">' +
      c.titles.map((t, i) => '<div class="hr-trow"><input data-s="titles.' + i + '.name" value="' + esc(t.name) + '"><select data-s="titles.' + i + '.template">' + tpls.map(k => '<option value="' + esc(k) + '"' + (k === t.template ? ' selected' : '') + '>' + esc(c.offers[k].label || k) + '</option>').join('') +
        '</select>' + (c.titles.length > 1 ? '<button class="btn secondary sm" data-act="rm-title" data-i="' + i + '">Remove</button>' : '') + '</div>').join('') + '</div><button class="btn secondary sm" data-act="add-title">+ Add title</button></div>' +
      '<div class="hr-card"><h3>Offer letter templates</h3><p class="hr-hint">Edit the wording once; every new letter starts from it. Letters already generated are not changed.</p>' +
      tpls.map(k => '<div class="hr-trow"><b>' + esc(c.offers[k].label || k) + '</b><span class="sp"></span><button class="btn secondary sm" data-act="edit-tpl" data-k="' + esc(k) + '">Edit wording</button><button class="btn secondary sm" data-act="dup-tpl" data-k="' + esc(k) + '">Duplicate</button>' +
        (state.defaults.offers[k] ? '<button class="btn secondary sm" data-act="reset-tpl" data-k="' + esc(k) + '">Reset</button>' : '<button class="btn secondary sm" data-act="del-tpl" data-k="' + esc(k) + '">Delete</button>') + '</div>').join('') + '</div>' +
      '<div class="hr-card"><h3>Payslip defaults</h3><div class="hr-g"><label class="hr-f2"><span>Earnings (one per line)</span><textarea data-s="payslip.earnings" data-lines rows="5">' + esc(c.payslip.earnings.join('\n')) + '</textarea></label>' +
      '<label class="hr-f2"><span>Deductions (one per line)</span><textarea data-s="payslip.deductions" data-lines rows="5">' + esc(c.payslip.deductions.join('\n')) + '</textarea></label>' + f('payslip.footer', 'Footer note', c.payslip.footer, true) +
      '<label class="hr-f2"><span>Accent colour</span><input type="color" data-s="payslip.accent" value="' + esc(c.payslip.accent) + '"></label></div></div>' +
      '<div class="hr-dact"><span class="sp"></span><button class="btn primary" data-act="save-config">Save settings</button></div>';
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
    el.innerHTML = '<div class="hr-edbar"><button class="btn secondary sm" data-act="ed-close">← Back</button><b id="hrEdTitle"></b><span class="sp"></span><span id="hrEdState"></span>' +
      (ed.mode === 'doc' ? '<button class="btn secondary" data-act="ed-print">Print / Save as PDF</button>' : '') + '<button class="btn primary" data-act="ed-save">' + (ed.mode === 'template' ? 'Save template' : 'Save') + '</button></div>' +
      '<div class="hr-edmain"><aside id="hrEdForm"></aside><div class="hr-prevwrap" id="hrPrevWrap"><div id="hrPrev"></div></div></div>';
    drawEdForm(); drawPreview();
    window.addEventListener('resize', fitPreview);
  }
  function closeEditor() {
    if (ed && ed.dirty && !confirm('Close without saving your changes?')) return;
    $('#hrEd').hidden = true; $('#hrEd').innerHTML = ''; document.body.classList.remove('hr-lock'); window.removeEventListener('resize', fitPreview); ed = null;
  }
  const mark = () => { ed.dirty = true; $('#hrEdState').textContent = 'Unsaved changes'; };

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
    $('#hrEdTitle').textContent = ed.mode === 'template' ? 'Template · ' + (ed.doc.label || '') : (ed.doc.summary || 'Document');
    fitPreview();
  }
  function fitPreview() {
    const w = $('#hrPrevWrap'), p = $('#hrPrev'), inner = $('#hrPrevIn'); if (!w || !p || !inner) return;
    const s = Math.min(1, (w.clientWidth - 32) / 794);  // the paper is 794px wide (A4); shrink it to fit the screen
    inner.style.cssText = 'width:794px;transform-origin:top left;transform:scale(' + s + ')';
    p.style.width = 794 * s + 'px'; p.style.height = inner.offsetHeight * s + 'px';
  }

  const inp = (path, label, val, type, wide, extra) => '<label class="hr-f2' + (wide ? ' wide' : '') + '"><span>' + label + '</span>' +
    (type === 'textarea' ? '<textarea data-p="' + path + '" rows="' + ((extra && extra.rows) || 3) + '">' + esc(val) + '</textarea>' : '<input data-p="' + path + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '"' + (type === 'number' ? ' step="any"' : '') + '>') + '</label>';
  const sec = (title, body, open) => '<details class="hr-sec"' + (open ? ' open' : '') + '><summary>' + title + '</summary><div class="hr-g">' + body + '</div></details>';
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
        '<label class="hr-f2"><span>Letterhead</span><select data-p="letterhead">' + [['company', 'Company block + logo'], ['logo', 'Title + logo'], ['none', 'None']].map(o => '<option value="' + o[0] + '"' + (d.letterhead === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>' +
        inp('header_title', 'Header title (each page)', d.header_title) +
        '<label class="hr-f2"><span>Font</span><select data-p="style.font">' + FONTS.map(o => '<option value="' + esc(o[0]) + '"' + (d.style.font === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>' +
        inp('style.size', 'Font size (pt)', d.style.size, 'number') + '<label class="hr-f2"><span>Alignment</span><select data-p="style.align"><option value="justify"' + (d.style.align !== 'left' ? ' selected' : '') + '>Justified</option><option value="left"' + (d.style.align === 'left' ? ' selected' : '') + '>Left</option></select></label>', true);
      h += sec('Details in the text <small>' + keys.length + '</small>', keys.map(k => inp('vars.' + k, pretty(k), d.vars[k] == null ? '' : d.vars[k], 'text', k === 'salary_words')).join('') +
        '<div class="hr-addvar wide"><input id="hrNewVar" placeholder="New detail, e.g. reporting_manager"><button class="btn secondary sm" data-act="add-var">Add</button></div><p class="hr-hint wide">Use a detail in the text as {{name}}. Salary words fill themselves from the salary.</p>', true);
      h += sec('Company & signatory', companyFields(d) + '<div class="hr-f2 wide"><span>Logo</span><div class="hr-logo">' + (d.company.logo ? '<img src="' + esc(d.company.logo) + '" alt="">' : '<em>No logo</em>') +
        '<label class="btn secondary sm">Upload<input type="file" accept="image/*" hidden data-logo></label>' + (d.company.logo ? '<button class="btn secondary sm" data-act="ed-logo-clear">Remove</button>' : '') + '</div></div>');
      h += '<details class="hr-sec" open><summary>Text <small>' + d.blocks.length + ' blocks</small></summary><div class="hr-blocks">' + d.blocks.map((b, i) => blockEd(b, i, d.blocks.length)).join('') +
        '<div class="hr-addblk"><select id="hrBlkType">' + BLOCKS.map(o => '<option value="' + o[0] + '">' + o[1] + '</option>').join('') + '</select><button class="btn secondary sm" data-act="add-block">+ Add</button></div></div></details>';
    } else {
      h += sec('Payslip', inp('period', 'Month', d.period) + inp('pay_date', 'Pay date', d.pay_date, 'date') + inp('paid_days', 'Paid days', d.paid_days, 'number') + inp('lop_days', 'LOP days', d.lop_days, 'number') +
        '<label class="hr-f2"><span>Accent colour</span><input type="color" data-p="accent" value="' + esc(d.accent) + '"></label><label class="hr-f2 hr-chk"><input type="checkbox" data-p="show_words"' + (d.show_words ? ' checked' : '') + '> Show amount in words</label>' + inp('footer', 'Footer note', d.footer, 'text', true), true);
      h += sec('Employee summary', d.rows.map((r, i) => '<div class="hr-row wide"><input data-p="rows.' + i + '.label" value="' + esc(r.label) + '"><input data-p="rows.' + i + '.value" value="' + esc(r.value) + '"><button class="x" data-act="rm-row" data-l="rows" data-i="' + i + '">×</button></div>').join('') + '<button class="btn secondary sm wide" data-act="add-row" data-l="rows">+ Add row</button>', true);
      ['earnings', 'deductions'].forEach(l => {
        h += sec(pretty(l), d[l].map((r, i) => '<div class="hr-row wide"><input data-p="' + l + '.' + i + '.label" value="' + esc(r.label) + '"><input type="number" step="any" data-p="' + l + '.' + i + '.amount" value="' + esc(r.amount) + '"><button class="x" data-act="rm-row" data-l="' + l + '" data-i="' + i + '">×</button></div>').join('') +
          '<button class="btn secondary sm wide" data-act="add-row" data-l="' + l + '">+ Add ' + (l === 'earnings' ? 'earning' : 'deduction') + '</button>', true);
      });
      h += sec('Company', companyFields(d));
    }
    f.innerHTML = h;
    $$('details', f).forEach((x, i) => { if (keep[i] !== undefined) x.open = keep[i]; });
  }
  function blockEd(b, i, n) {
    const text = b.t === 'pb' || b.t === 'sp' ? '<em class="hr-hint">' + (b.t === 'pb' ? 'Starts a new page' : 'Blank space') + '</em>' : '<textarea data-p="blocks.' + i + '.text" rows="' + Math.min(10, Math.max(2, Math.ceil(String(b.text || '').length / 55))) + '">' + esc(b.text) + '</textarea>';
    return '<div class="hr-blk"><div class="hr-blkh"><select data-p="blocks.' + i + '.t">' + BLOCKS.map(o => '<option value="' + o[0] + '"' + (b.t === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select><span class="sp"></span>' +
      '<button data-act="blk-up" data-i="' + i + '"' + (i ? '' : ' disabled') + '>↑</button><button data-act="blk-dn" data-i="' + i + '"' + (i < n - 1 ? '' : ' disabled') + '>↓</button><button class="x" data-act="blk-rm" data-i="' + i + '">×</button></div>' + text + '</div>';
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
      $('#hrEdState').textContent = 'Saved'; drawPreview(); toast('Saved');
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
    root.innerHTML = '<p class="hr-hint">Loading…</p>';
    try {
      const d = await api('/api/hr/bootstrap');
      state = { cfg: d.config, defaults: d.defaults, emps: d.employees, docs: d.documents };
    } catch (err) { root.innerHTML = '<p class="hr-hint">' + esc(err.message) + '</p>'; return; }
    shell();
    root.addEventListener('input', e => {
      if (e.target.id === 'hrQ') { filter.q = e.target.value; const pos = e.target.selectionStart; draw(); const q = $('#hrQ'); q.focus(); q.setSelectionRange(pos, pos); return; }
      const s = e.target.dataset.s;
      if (s) { const val = e.target.hasAttribute('data-lines') ? e.target.value.split('\n').map(x => x.trim()).filter(Boolean) : e.target.value; setPath(state.cfg, s, val); }
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
