/* Client page: the WhatsApp button opens a short enquiry (destination, dates, optional shortlisted hotels) and "Send query"
   opens WhatsApp with those details already written. Builds on client.js, which shares its data through window.HO_CLIENT. */
(function () {
  'use strict';
  const C = window.HO_CLIENT;
  if (!C) return;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = v => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmt = v => parseISO(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  let root = null, sheet = null, lastFocus = null;
  const picked = new Set();

  function build() {
    root = document.createElement('div');
    root.className = 'sheet-root eq-root'; root.hidden = true;
    root.innerHTML = `
      <div class="scrim" data-eq="close"></div>
      <section class="sheet eq-sheet" role="dialog" aria-modal="true" aria-labelledby="eqTitle" tabindex="-1">
        <button class="icon-btn close" data-eq="close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        <form class="eq-body" id="eqForm" novalidate>
          <h2 class="b-title" id="eqTitle">Plan your trip</h2>
          <p class="b-sub">Tell us where and when. We will reply on WhatsApp.</p>

          <label class="field" id="eqDest"><input id="eqDestIn" list="eqPlaces" type="text" placeholder=" " maxlength="80" autocomplete="off" required><span>Destination</span><small></small></label>
          <datalist id="eqPlaces"></datalist>

          <div class="eq-dates" id="eqDates">
            <label><span>Check-in</span><input id="eqIn" type="date"></label>
            <label><span>Check-out</span><input id="eqOut" type="date"></label>
            <small></small>
          </div>

          <div class="eq-hotels-wrap" id="eqHotelsWrap">
            <p class="eq-h">Shortlisted hotels <em>optional</em></p>
            <div class="eq-hotels" id="eqHotels"></div>
          </div>
          <label class="field" id="eqOther"><input id="eqOtherIn" type="text" placeholder=" " maxlength="200" autocomplete="off"><span>Other hotels you are considering</span></label>

          <button class="btn btn-primary btn-lg eq-send" type="submit">Send query</button>
        </form>
      </section>`;
    document.body.appendChild(root);
    sheet = $('.eq-sheet', root);

    root.addEventListener('click', e => { if (e.target.closest('[data-eq="close"]')) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !root.hidden) close(); });
    $('#eqIn', root).addEventListener('change', onCheckIn);
    $('#eqHotels', root).addEventListener('click', e => {
      const b = e.target.closest('.chip');
      if (!b) return;
      const name = b.dataset.n;
      picked.has(name) ? picked.delete(name) : picked.add(name);
      b.setAttribute('aria-selected', picked.has(name));
    });
    $('#eqForm', root).addEventListener('submit', send);
    $$('input', root).forEach(i => i.addEventListener('input', () => { const f = i.closest('.field,.eq-dates'); if (f) f.classList.remove('bad'); }));
  }

  function fillOptions() {
    const offers = C.offers();
    const places = Array.from(new Set(offers.map(o => o.place_line || o.city).filter(Boolean)));
    $('#eqPlaces', root).innerHTML = places.map(p => `<option value="${esc(p)}">`).join('');
    const hotels = Array.from(new Set(offers.map(o => o.title || o.hotel_name).filter(Boolean)));
    $('#eqHotels', root).innerHTML = hotels.map(h => `<button type="button" class="chip" data-n="${esc(h)}" aria-selected="${picked.has(h)}">${esc(h)}</button>`).join('');
    $('#eqHotelsWrap', root).hidden = !hotels.length;
  }

  function onCheckIn() {
    const a = $('#eqIn', root), b = $('#eqOut', root);
    if (!a.value) return;
    const next = new Date(parseISO(a.value)); next.setDate(next.getDate() + 1);
    b.min = isoOf(next);
    if (!b.value || b.value <= a.value) b.value = isoOf(next);
  }

  function open(from) {
    if (!root) build();
    lastFocus = from || document.activeElement;
    const today = isoOf(new Date());
    $('#eqIn', root).min = today; $('#eqOut', root).min = today;
    fillOptions();
    $$('.bad', root).forEach(f => f.classList.remove('bad'));
    root.hidden = false;
    document.documentElement.classList.add('lock');
    requestAnimationFrame(() => requestAnimationFrame(() => { root.classList.add('open'); $('#eqDestIn', root).focus({ preventScroll: true }); }));
  }

  function close() {
    if (!root || root.hidden) return;
    root.classList.remove('open');
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
    const dest = $('#eqDestIn', root).value.trim().replace(/\s+/g, ' '), a = $('#eqIn', root).value, b = $('#eqOut', root).value;
    const other = $('#eqOtherIn', root).value.trim().replace(/\s+/g, ' ');
    flag('#eqDest'); flag('#eqDates');
    let bad = false;
    if (dest.length < 2) { flag('#eqDest', 'Where would you like to go?'); bad = true; }
    if ((a && !b) || (!a && b)) { flag('#eqDates', 'Please choose both your check-in and check-out dates'); bad = true; }
    else if (a && b && b <= a) { flag('#eqDates', 'Check-out must be after check-in'); bad = true; }
    if (bad) { const f = $('.bad input', root); if (f) f.focus(); return; }

    const hotels = Array.from(picked).concat(other ? [other] : []);
    const lines = ["Hi Time Tours, I'd like to plan a trip.", '', `Destination: ${dest}`];
    if (a && b) {
      const n = Math.round((parseISO(b) - parseISO(a)) / 864e5);
      lines.push(`Dates: ${fmt(a)} to ${fmt(b)} (${n} night${n === 1 ? '' : 's'})`);
    }
    if (hotels.length) lines.push(`Hotels I'm considering: ${hotels.join(', ')}`);
    const url = C.waBase() + '?text=' + encodeURIComponent(lines.join('\n'));
    const win = window.open(url, '_blank', 'noopener');
    if (!win) location.href = url;  // pop-up blocked: go there in this tab instead
    picked.clear();
    close();
  }

  // the two WhatsApp buttons open the enquiry instead of going straight to a blank chat
  [$('#navWa'), $('#emptyWa')].forEach(a => {
    if (a) a.addEventListener('click', e => { e.preventDefault(); open(a); });
  });
})();
