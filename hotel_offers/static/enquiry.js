/* Client page: "Plan a trip" enquiry for a destination that is not listed. Destination (searchable), dates (specific or flexible),
   guests, optional shortlisted hotels for that destination, then "Send query" opens WhatsApp with the details already written.
   Builds on client.js, which shares its data through window.HO_CLIENT. */
(function () {
  'use strict';
  const C = window.HO_CLIENT;
  if (!C) return;
  const CITIES = window.HO_CITIES || [];
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = v => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayD = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); };
  const nightsBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
  const fmt = v => parseISO(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const shortDay = v => parseISO(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const monthLabel = k => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }); };
  const LENGTHS = [['2-3', '2–3 nights'], ['4-5', '4–5 nights'], ['6-7', '6–7 nights'], ['8-10', '8–10 nights'], ['10+', '10+ nights']];
  // budget per room per night in US dollars (optional). The lowest band is for Asia only; elsewhere the choices start at USD 250.
  const BUDGETS = [{ label: 'USD 150 – 250', asiaOnly: true }, { label: 'USD 250 – 400' }, { label: 'USD 400 – 700' }, { label: 'USD 700 – 1,000' }, { label: 'USD 1,000+' }];
  const ASIA = new Set(['India', 'Indonesia', 'Thailand', 'Malaysia', 'Singapore', 'Vietnam', 'Cambodia', 'Laos', 'Myanmar', 'Philippines', 'Maldives', 'Sri Lanka', 'Nepal', 'Bhutan', 'Bangladesh', 'Brunei',
    'Japan', 'South Korea', 'China', 'Taiwan', 'Mongolia']);
  const CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  let root = null, sheet = null, lastFocus = null;
  const picked = new Set();
  const dt = { mode: 'specific', from: null, to: null, hover: null, view: null, open: false, months: new Set(), len: null };
  const pax = { adults: 2, children: 0 };
  let sugItems = [], sugActive = -1;

  // ---------- markup
  function build() {
    root = document.createElement('div');
    root.className = 'sheet-root eq-root'; root.hidden = true;
    root.innerHTML = `
      <div class="scrim" data-eq="close"></div>
      <section class="sheet eq-sheet" role="dialog" aria-modal="true" aria-labelledby="eqTitle" tabindex="-1">
        <button class="icon-btn close" data-eq="close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        <form class="eq-body" id="eqForm" novalidate>
          <h2 class="b-title" id="eqTitle">Plan your trip</h2>
          <p class="b-sub">Going somewhere else? Tell us where and when. We will reply on WhatsApp.</p>

          <label class="field eq-dest" id="eqDest"><input id="eqDestIn" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="eqSug" placeholder=" " maxlength="80" autocomplete="off" required><span>Destination</span><small></small>
            <ul class="eq-sug" id="eqSug" role="listbox" hidden></ul></label>

          <div class="field-dates" id="eqDates">
            <button type="button" class="dates-btn" id="eqDatesBtn" aria-expanded="false" aria-controls="eqCal">
              <span class="dtxt"><span class="dl">Dates</span><span class="dv empty" id="eqDatesVal">Add your dates</span></span>${CHEV}
            </button>
            <div class="cal eq-cal" id="eqCal" aria-hidden="true">
              <div class="cal-in">
                <div class="eq-seg" role="tablist">
                  <button type="button" role="tab" data-mode="specific" aria-selected="true">Specific dates</button>
                  <button type="button" role="tab" data-mode="flex" aria-selected="false">Flexible dates</button>
                </div>
                <div id="eqSpecific">
                  <div class="cal-head">
                    <button type="button" class="cal-nav" id="eqPrev" aria-label="Previous month"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
                    <b id="eqCalTitle"></b>
                    <button type="button" class="cal-nav" id="eqNext" aria-label="Next month"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
                  </div>
                  <div class="cal-dow" aria-hidden="true"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
                  <div class="cal-grid" id="eqGrid"></div>
                </div>
                <div id="eqFlex" hidden>
                  <p class="eq-h">Which months?</p>
                  <div class="eq-months" id="eqMonths"></div>
                  <p class="eq-h">How long? <em>optional</em></p>
                  <div class="eq-lens" id="eqLens"></div>
                </div>
                <div class="cal-foot"><span id="eqHint">Choose your check-in date</span><span class="cal-acts"><button type="button" class="linkish" id="eqClear">Clear</button></span></div>
              </div>
            </div>
            <small></small>
          </div>

          <div class="eq-pax" id="eqPax">
            <div class="eq-step"><span>Adults</span><div><button type="button" data-p="adults" data-d="-1" aria-label="Fewer adults">&minus;</button><b id="eqAdults">2</b><button type="button" data-p="adults" data-d="1" aria-label="More adults">+</button></div></div>
            <div class="eq-step"><span>Children</span><div><button type="button" data-p="children" data-d="-1" aria-label="Fewer children">&minus;</button><b id="eqChildren">0</b><button type="button" data-p="children" data-d="1" aria-label="More children">+</button></div></div>
          </div>

          <label class="eq-sel" id="eqBudgetBox"><span>Budget per room per night <em>optional</em></span>
            <select id="eqBudget"></select></label>

          <div class="eq-hotels-wrap" id="eqHotelsWrap" hidden>
            <p class="eq-h">Shortlisted hotels <em>optional</em></p>
            <div class="eq-hotels" id="eqHotels"></div>
          </div>
          <label class="field" id="eqOther"><input id="eqOtherIn" type="text" placeholder=" " maxlength="200" autocomplete="off"><span>Any hotels you have shortlisted already</span></label>

          <button class="btn btn-primary btn-lg eq-send" type="submit">Send query</button>
        </form>
      </section>`;
    document.body.appendChild(root);
    sheet = $('.eq-sheet', root);
    wire();
  }

  // ---------- destination: type to search every destination; cities with live offers come first
  const cityName = label => label.split(',')[0].trim();
  function offerCities() {
    const seen = new Map();
    C.offers().forEach(o => { const c = C.cityOf(o); if (c && !seen.has(norm(c))) seen.set(norm(c), c); });
    return Array.from(seen.values());
  }
  function suggestions(q) {
    const nq = norm(q), live = offerCities();
    const entryFor = c => CITIES.find(x => norm(cityName(x)) === norm(c)) || c;
    const rank = (label) => {
      const n = norm(label), city = norm(cityName(label));
      if (city.startsWith(nq)) return 0;
      if (city.split(' ').some(w => w.startsWith(nq))) return 1;
      if (city.includes(nq)) return 2;
      return n.includes(nq) ? 3 : -1;
    };
    const out = [], seen = new Set();
    const add = (label, isLive) => { const k = norm(label); if (!seen.has(k)) { seen.add(k); out.push({ label, live: isLive }); } };
    if (!nq) { live.forEach(c => add(entryFor(c), true)); return out.slice(0, 8); }
    live.map(entryFor).map(l => [l, rank(l)]).filter(x => x[1] >= 0).sort((a, b) => a[1] - b[1]).forEach(x => add(x[0], true));
    CITIES.map(l => [l, rank(l)]).filter(x => x[1] >= 0).sort((a, b) => a[1] - b[1] || a[0].length - b[0].length).forEach(x => add(x[0], live.some(c => norm(c) === norm(cityName(x[0])))));
    return out.slice(0, 8);
  }
  function showSug() {
    const inp = $('#eqDestIn', root), box = $('#eqSug', root);
    sugItems = suggestions(inp.value); sugActive = -1;
    if (!sugItems.length) { hideSug(); return; }
    box.innerHTML = sugItems.map((s, i) => `<li role="option" id="eqOpt${i}" data-i="${i}"><b>${esc(s.label)}</b>${s.live ? '<em>Live offers</em>' : ''}</li>`).join('');
    box.hidden = false; inp.setAttribute('aria-expanded', 'true');
  }
  function hideSug() { const box = $('#eqSug', root); box.hidden = true; $('#eqDestIn', root).setAttribute('aria-expanded', 'false'); sugActive = -1; }
  function pickSug(i) {
    const s = sugItems[i];
    if (!s) return;
    $('#eqDestIn', root).value = s.label;
    $('#eqDest', root).classList.remove('bad');
    hideSug(); renderHotels(); renderBudget();
  }
  function moveSug(d) {
    if ($('#eqSug', root).hidden) { showSug(); return; }
    sugActive = (sugActive + d + sugItems.length) % sugItems.length;
    $$('#eqSug li', root).forEach((li, i) => li.classList.toggle('on', i === sugActive));
    const li = $$('#eqSug li', root)[sugActive]; if (li) { li.scrollIntoView({ block: 'nearest' }); $('#eqDestIn', root).setAttribute('aria-activedescendant', li.id); }
  }

  // ---------- budget: the choices depend on where the guest is going
  function regionOf(dest) {
    const t = dest.trim();
    if (!t) return '';
    let country = t.includes(',') ? t.split(',').pop().trim() : '';
    if (!country) { const hit = CITIES.find(x => norm(cityName(x)) === norm(t)); country = hit ? hit.split(',').pop().trim() : ''; }
    return !country ? '' : ASIA.has(country) ? 'asia' : 'world';
  }
  function renderBudget() {
    const sel = $('#eqBudget', root), keep = sel.value, region = regionOf($('#eqDestIn', root).value);
    const list = BUDGETS.filter(b => !b.asiaOnly || region !== 'world');  // not Asia: the USD 150 – 250 band is left out
    sel.innerHTML = '<option value="">Choose a budget</option>' + list.map(b => `<option>${esc(b.label)}</option>`).join('');
    if (list.some(b => b.label === keep)) sel.value = keep;
  }

  // ---------- shortlisted hotels: only the live offers for the chosen destination
  function hotelsFor(dest) {
    const q = norm(cityName(dest));
    return C.offers().filter(o => {
      if (!q) return true;
      return [C.cityOf(o), o.place_line, o.brand_line].some(p => { const n = norm(p); return n && (n.includes(q) || q.includes(n)); });
    });
  }
  function renderHotels() {
    const hotels = Array.from(new Set(hotelsFor($('#eqDestIn', root).value).map(o => o.title || o.hotel_name).filter(Boolean)));
    Array.from(picked).forEach(n => { if (!hotels.includes(n)) picked.delete(n); });  // a hotel from another destination cannot stay shortlisted
    $('#eqHotels', root).innerHTML = hotels.map(h => `<button type="button" class="chip" data-n="${esc(h)}" aria-selected="${picked.has(h)}">${esc(h)}</button>`).join('');
    $('#eqHotelsWrap', root).hidden = !hotels.length;
  }

  // ---------- dates: specific (a calendar) or flexible (months and trip length)
  function datesText() {
    if (dt.mode === 'flex') {
      const m = Array.from(dt.months).sort();
      if (!m.length) return '';
      const len = dt.len ? LENGTHS.find(l => l[0] === dt.len)[1] : '';
      return 'Flexible · ' + m.map(monthLabel).join(', ') + (len ? ' · ' + len : '');
    }
    if (!dt.from) return '';
    if (!dt.to) return shortDay(dt.from) + ' · choose check-out';
    const n = nightsBetween(dt.from, dt.to);
    return `${shortDay(dt.from)} – ${shortDay(dt.to)} · ${n} night${n > 1 ? 's' : ''}`;
  }
  function updateDates() {
    const v = $('#eqDatesVal', root), t = datesText();
    v.textContent = t || 'Add your dates'; v.classList.toggle('empty', !t);
    $('#eqHint', root).textContent = dt.mode === 'flex' ? (dt.months.size ? 'Pick as many months as you like' : 'Choose the months you could travel')
      : !dt.from ? 'Choose your check-in date' : !dt.to ? 'Now choose your check-out date' : datesText();
    $('#eqDates', root).classList.remove('bad');
  }
  function setOpen(open) {
    dt.open = open;
    $('#eqCal', root).classList.toggle('open', open);
    $('#eqCal', root).setAttribute('aria-hidden', String(!open));
    $('#eqDatesBtn', root).setAttribute('aria-expanded', String(open));
    $('#eqDates', root).classList.toggle('is-open', open);
  }
  function renderCal() {
    const v = dt.view, first = new Date(v.getFullYear(), v.getMonth(), 1), total = new Date(v.getFullYear(), v.getMonth() + 1, 0).getDate();
    $('#eqCalTitle', root).textContent = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const t = iso(todayD()), end = dt.to || dt.hover, lo = dt.from, hi = end && lo && end > lo ? end : null;
    let html = '<span></span>'.repeat(first.getDay());
    for (let d = 1; d <= total; d++) {
      const k = iso(new Date(v.getFullYear(), v.getMonth(), d)), past = k < t, cls = ['day'];
      if (past) cls.push('past');
      if (k === t) cls.push('today');
      if (lo === k) cls.push('start', hi ? 'has-range' : 'solo');
      if (hi && k === hi) cls.push('end', 'has-range', dt.to ? '' : 'preview');
      if (hi && k > lo && k < hi) cls.push('mid');
      const label = parseISO(k).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      html += `<button type="button" class="${cls.join(' ')}" data-d="${k}" ${past ? 'disabled' : ''} aria-label="${label}" aria-pressed="${k === lo || k === dt.to}"><span>${d}</span></button>`;
    }
    $('#eqGrid', root).innerHTML = html;
    const cur = todayD();
    $('#eqPrev', root).disabled = v.getFullYear() === cur.getFullYear() && v.getMonth() <= cur.getMonth();
    $('#eqNext', root).disabled = (v.getFullYear() - cur.getFullYear()) * 12 + v.getMonth() - cur.getMonth() >= 18;
  }
  function renderFlex() {
    const cur = todayD(), months = [];
    for (let i = 0; i < 12; i++) { const d = new Date(cur.getFullYear(), cur.getMonth() + i, 1); months.push([`${d.getFullYear()}-${pad(d.getMonth() + 1)}`, d]); }
    $('#eqMonths', root).innerHTML = months.map(([k, d]) => `<button type="button" class="eq-month" data-m="${k}" aria-pressed="${dt.months.has(k)}"><small>${d.getFullYear()}</small><b>${d.toLocaleDateString('en-GB', { month: 'long' })}</b></button>`).join('');
    $('#eqLens', root).innerHTML = LENGTHS.map(([k, l]) => `<button type="button" class="chip" data-l="${k}" aria-selected="${dt.len === k}">${l}</button>`).join('');
  }
  function setMode(mode) {
    dt.mode = mode;
    $$('.eq-seg button', root).forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    $('#eqSpecific', root).hidden = mode !== 'specific'; $('#eqFlex', root).hidden = mode !== 'flex';
    mode === 'flex' ? renderFlex() : renderCal();
    updateDates();
  }
  function pickDay(k) {
    if (!dt.from || dt.to) { dt.from = k; dt.to = null; }
    else if (k <= dt.from) { dt.from = k; }
    else if (nightsBetween(dt.from, k) > 60) return;
    else dt.to = k;
    dt.hover = null; renderCal(); updateDates();
    if (dt.to) setTimeout(() => setOpen(false), 600);
  }

  // ---------- guests
  function paxUi() {
    $('#eqAdults', root).textContent = pax.adults; $('#eqChildren', root).textContent = pax.children;
    $$('#eqPax button', root).forEach(b => { const k = b.dataset.p, d = Number(b.dataset.d); b.disabled = (d < 0 && pax[k] <= (k === 'adults' ? 1 : 0)) || (d > 0 && pax[k] >= (k === 'adults' ? 20 : 10)); });
  }

  // ---------- events
  function wire() {
    root.addEventListener('click', e => { if (e.target.closest('[data-eq="close"]')) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !root.hidden) { if (!$('#eqSug', root).hidden) hideSug(); else close(); } });

    const dest = $('#eqDestIn', root);
    dest.addEventListener('input', () => { $('#eqDest', root).classList.remove('bad'); showSug(); renderHotels(); renderBudget(); });
    dest.addEventListener('focus', showSug);
    dest.addEventListener('blur', () => setTimeout(hideSug, 120));
    dest.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSug(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSug(-1); }
      else if (e.key === 'Enter' && !$('#eqSug', root).hidden && sugActive >= 0) { e.preventDefault(); pickSug(sugActive); }
    });
    $('#eqSug', root).addEventListener('mousedown', e => { const li = e.target.closest('li'); if (li) { e.preventDefault(); pickSug(Number(li.dataset.i)); } });

    $('#eqDatesBtn', root).addEventListener('click', () => setOpen(!dt.open));
    $('#eqPrev', root).addEventListener('click', () => { dt.view = new Date(dt.view.getFullYear(), dt.view.getMonth() - 1, 1); renderCal(); });
    $('#eqNext', root).addEventListener('click', () => { dt.view = new Date(dt.view.getFullYear(), dt.view.getMonth() + 1, 1); renderCal(); });
    $('#eqGrid', root).addEventListener('click', e => { const b = e.target.closest('.day'); if (b && !b.disabled) pickDay(b.dataset.d); });
    $('#eqGrid', root).addEventListener('pointerover', e => {
      const b = e.target.closest('.day');
      if (e.pointerType !== 'mouse' || !b || b.disabled || !dt.from || dt.to || dt.hover === b.dataset.d) return;
      dt.hover = b.dataset.d; renderCal();
    });
    $('#eqGrid', root).addEventListener('pointerleave', () => { if (dt.hover) { dt.hover = null; renderCal(); } });
    $('.eq-seg', root).addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
    $('#eqMonths', root).addEventListener('click', e => {
      const b = e.target.closest('.eq-month');
      if (!b) return;
      const k = b.dataset.m;
      dt.months.has(k) ? dt.months.delete(k) : dt.months.add(k);
      b.setAttribute('aria-pressed', String(dt.months.has(k))); updateDates();
    });
    $('#eqLens', root).addEventListener('click', e => {
      const b = e.target.closest('.chip');
      if (!b) return;
      dt.len = dt.len === b.dataset.l ? null : b.dataset.l;
      $$('#eqLens .chip', root).forEach(c => c.setAttribute('aria-selected', String(c.dataset.l === dt.len))); updateDates();
    });
    $('#eqClear', root).addEventListener('click', () => {
      dt.from = dt.to = dt.hover = null; dt.months.clear(); dt.len = null;
      dt.mode === 'flex' ? renderFlex() : renderCal(); updateDates();
    });

    $('#eqPax', root).addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      pax[b.dataset.p] += Number(b.dataset.d); paxUi();
    });
    $('#eqHotels', root).addEventListener('click', e => {
      const b = e.target.closest('.chip');
      if (!b) return;
      const name = b.dataset.n;
      picked.has(name) ? picked.delete(name) : picked.add(name);
      b.setAttribute('aria-selected', picked.has(name));
    });
    $('#eqForm', root).addEventListener('submit', send);
    $$('input', root).forEach(i => i.addEventListener('input', () => { const f = i.closest('.field'); if (f) f.classList.remove('bad'); }));
  }

  // ---------- open / close / send
  function open(from) {
    if (!root) build();
    lastFocus = from || document.activeElement;
    dt.view = new Date(todayD().getFullYear(), todayD().getMonth(), 1);
    setOpen(false); setMode(dt.mode); paxUi(); renderHotels(); renderBudget();
    $$('.bad', root).forEach(f => f.classList.remove('bad'));
    root.hidden = false;
    document.documentElement.classList.add('lock');
    requestAnimationFrame(() => requestAnimationFrame(() => { root.classList.add('open'); $('#eqDestIn', root).focus({ preventScroll: true }); }));
  }
  function close() {
    if (!root || root.hidden) return;
    hideSug(); root.classList.remove('open');
    document.documentElement.classList.remove('lock');
    setTimeout(() => { root.hidden = true; }, 560);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  function flag(sel, msg) {
    const f = $(sel, root);
    f.classList.remove('bad'); void f.offsetWidth;
    if (msg) { f.classList.add('bad'); $('small', f).textContent = msg; }
  }
  function send(e) {
    e.preventDefault();
    const dest = $('#eqDestIn', root).value.trim().replace(/\s+/g, ' '), other = $('#eqOtherIn', root).value.trim().replace(/\s+/g, ' ');
    flag('#eqDest'); flag('#eqDates');
    let bad = false;
    if (dest.length < 2) { flag('#eqDest', 'Where would you like to go?'); bad = true; }
    if (dt.mode === 'specific' && dt.from && !dt.to) { flag('#eqDates', 'Please choose your check-out date'); setOpen(true); bad = true; }
    if (bad) { const f = $('.field.bad input', root); if (f) f.focus(); return; }

    const hotels = Array.from(picked).concat(other ? [other] : []);
    // each detail is its own paragraph with a bold label, so it reads cleanly in WhatsApp
    const item = (label, value) => `*${label}:* ${value}`;
    const lines = ['Hello Time Tours,', 'I would like to plan a luxury stay.', item('Destination', dest)];
    if (dt.mode === 'specific' && dt.from && dt.to) {
      const n = nightsBetween(dt.from, dt.to);
      lines.push(item('Dates', `${fmt(dt.from)} to ${fmt(dt.to)} (${n} night${n === 1 ? '' : 's'})`));
    } else if (dt.mode === 'flex' && dt.months.size) {
      const len = dt.len ? ` (${LENGTHS.find(l => l[0] === dt.len)[1]})` : '';
      lines.push(item('Dates', `Flexible, ${Array.from(dt.months).sort().map(monthLabel).join(' or ')}${len}`));
    }
    const guests = [`${pax.adults} adult${pax.adults === 1 ? '' : 's'}`];
    if (pax.children) guests.push(`${pax.children} child${pax.children === 1 ? '' : 'ren'}`);
    lines.push(item('Guests', guests.join(', ')));
    const budget = $('#eqBudget', root).value;
    if (budget) lines.push(item('Budget', `${budget} per room per night`));
    if (hotels.length) lines.push(item('Shortlisted hotels', hotels.join(', ')));
    lines.push('Please share the best options and rates. Thank you.');
    const url = C.waBase() + '?text=' + encodeURIComponent(lines.join('\n\n'));
    const win = window.open(url, '_blank', 'noopener');
    if (!win) location.href = url;  // pop-up blocked: go there in this tab instead
    picked.clear();
    close();
  }

  // the buttons for "somewhere else" open the enquiry instead of going straight to a blank chat
  [$('#navWa'), $('#emptyWa')].forEach(a => {
    if (a) a.addEventListener('click', e => { e.preventDefault(); open(a); });
  });
})();
