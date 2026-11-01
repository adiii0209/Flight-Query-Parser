/* Trips: date-range picker (replaces the browser's native date input).
   TT.dates.toggle(anchorEl, { start, end, words, clearable, onChange(start, end), onClose() }) opens a calendar under the anchor:
   click a check-in date, then a check-out date (or a night count). TT.dates.label() draws the text of the field that opens it.
   TT.dates.bind(form) wires "[data-range=start_name,end_name]" buttons to a pair of hidden inputs of a form. */
(function (TT) {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const CHIPS = [1, 2, 3, 4, 5, 7];
  const ICON = {
    cal: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  };
  const z = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  const dt = s => new Date(s + 'T00:00:00');
  const valid = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(dt(s));
  const nights = (a, b) => Math.round((dt(b) - dt(a)) / 864e5);
  const monthOf = s => { const d = dt(s); d.setDate(1); return d; };
  const plusMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
  const short = s => dt(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const long = s => dt(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const nightsText = n => n + ' night' + (n === 1 ? '' : 's');

  TT.dates = { nights };

  /** Inner HTML of the button that opens the picker. */
  TT.dates.label = (start, end, empty, words) => {
    const w = words || ['Check-in', 'Check-out'];
    if (!valid(start)) return ICON.cal + '<span class="ph">' + TT.esc(empty || 'Choose dates') + '</span>';
    if (!valid(end) || end <= start) return ICON.cal + '<span>' + long(start) + ' → <em class="ph">' + w[1].toLowerCase() + '</em></span>';
    const sameYear = start.slice(0, 4) === end.slice(0, 4);  // "Wed, 2 Dec → Sun, 6 Dec 2026" fits the narrow field
    return ICON.cal + '<span>' + (sameYear ? short(start) : long(start)) + ' → ' + long(end) + '</span><i>' + nightsText(nights(start, end)) + '</i>';
  };

  let cur = null;

  function close() {
    if (!cur) return;
    const c = cur;
    cur = null;
    document.removeEventListener('pointerdown', c.down, true);
    document.removeEventListener('keydown', c.key, true);
    document.removeEventListener('focusin', c.focusin, true);
    window.removeEventListener('resize', c.place);
    window.removeEventListener('scroll', c.place, true);
    c.host.removeEventListener('cancel', c.cancel);
    c.el.remove();
    c.anchor.setAttribute('aria-expanded', 'false');
    if (c.anchor.isConnected) c.anchor.focus({ preventScroll: true });
    if (c.o.onClose) c.o.onClose();
  }

  function open(anchor, o) {
    close();
    const host = anchor.closest('dialog') || document.body;  // inside a modal dialog the picker must be a child of it to be visible
    const words = o.words || ['Check-in', 'Check-out'];
    const months = window.innerWidth >= 700 ? 2 : 1;
    const s = { start: valid(o.start) ? o.start : '', end: '', pending: '', hover: '' };
    if (s.start && valid(o.end) && o.end > s.start) s.end = o.end;
    const kept = s.end ? nights(s.start, s.end) : 0;  // the stay length when it was opened, offered again when the check-in changes
    s.view = monthOf(s.start || iso(new Date()));
    s.focus = s.start || iso(new Date());

    const el = document.createElement('div');
    el.className = 'dp';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Choose dates');

    const monthHtml = (m, i) => {
      const y = m.getFullYear(), mo = m.getMonth(), count = new Date(y, mo + 1, 0).getDate();
      let cells = '<span></span>'.repeat(m.getDay());
      for (let d = 1; d <= count; d++) {
        const id = y + '-' + z(mo + 1) + '-' + z(d);
        cells += '<div class="dp-c" data-d="' + id + '"><button type="button" tabindex="-1" data-d="' + id + '" aria-label="' + long(id) + '">' + d + '</button></div>';
      }
      return '<div class="dp-m"><div class="dp-h">' +
        (i === 0 ? '<button type="button" class="dp-nav prev" data-nav="-1" aria-label="Previous month">' + ICON.prev + '</button>' : '') +
        '<b>' + MONTHS[mo] + ' ' + y + '</b>' +
        (i === months - 1 ? '<button type="button" class="dp-nav next" data-nav="1" aria-label="Next month">' + ICON.next + '</button>' : '') + '</div>' +
        '<div class="dp-g">' + DOW.map(w => '<span class="dp-w">' + w + '</span>').join('') + cells + '</div></div>';
    };

    function build() {
      el.innerHTML = '<div class="dp-months">' + Array.from({ length: months }, (_, i) => monthHtml(plusMonths(s.view, i), i)).join('') + '</div><div class="dp-f"></div>';
      paint();
      foot();
    }

    // classes only, so hovering does not rebuild the calendar
    function paint() {
      const a = s.pending || s.start, b = s.pending ? (s.hover > s.pending ? s.hover : '') : s.end, today = iso(new Date());
      el.querySelectorAll('.dp-c').forEach(c => {
        const d = c.dataset.d, t = c.classList;
        t.toggle('in', !!(a && b && d > a && d < b));
        t.toggle('s', d === a);
        t.toggle('e', !!b && d === b);
        t.toggle('rng', !!(a && b));
        t.toggle('today', d === today);
        c.firstChild.tabIndex = d === s.focus ? 0 : -1;
        c.firstChild.setAttribute('aria-pressed', d === a || (!!b && d === b) ? 'true' : 'false');
      });
      if (!el.querySelector('.dp-c button[tabindex="0"]')) el.querySelector('.dp-c button').tabIndex = 0;  // the focused day is in another month
    }

    function foot() {
      const f = el.querySelector('.dp-f');
      const clear = o.clearable && (s.start || s.pending) ? '<button type="button" class="dp-link" data-clear>Clear</button>' : '';
      if (s.pending) {
        const list = CHIPS.concat(kept && !CHIPS.includes(kept) ? [kept] : []).sort((x, y) => x - y);
        f.innerHTML = '<span class="dp-sum">' + words[0] + ' <b>' + short(s.pending) + '</b>. Pick the ' + words[1].toLowerCase() + ' date, or choose the nights:</span>' +
          '<span class="dp-chips">' + list.map(n => '<button type="button" data-n="' + n + '" aria-label="' + nightsText(n) + '">' + n + '</button>').join('') + '</span>' + clear;
      } else if (s.start && s.end) {
        const n = nights(s.start, s.end);
        f.innerHTML = '<span class="dp-sum"><b>' + short(s.start) + '</b> → <b>' + short(s.end) + '</b></span>' +
          '<span class="dp-step"><button type="button" data-step="-1" aria-label="One night less"' + (n <= 1 ? ' disabled' : '') + '>−</button><b>' + nightsText(n) + '</b>' +
          '<button type="button" data-step="1" aria-label="One night more">+</button></span>' + clear + '<button type="button" class="dp-done" data-done>Done</button>';
      } else {
        f.innerHTML = '<span class="dp-sum">' + (s.start ? words[0] + ' <b>' + short(s.start) + '</b>. Pick the ' + words[1].toLowerCase() + ' date' : 'Pick the ' + words[0].toLowerCase() + ' date') + '</span>' + clear;
      }
    }

    function finish(a, b) {
      s.start = a; s.end = b; s.pending = ''; s.hover = '';
      o.onChange(a, b);
      close();
    }

    function pick(id) {
      if (s.pending && id > s.pending) return finish(s.pending, id);
      s.pending = id; s.start = id; s.end = ''; s.hover = ''; s.focus = id;  // first click, or a click on/before the check-in: start again from here
      paint(); foot();
    }

    function move(id) {
      const last = plusMonths(s.view, months - 1), m = monthOf(id);
      s.focus = id;
      if (m < s.view) { s.view = m; build(); }
      else if (m > last) { s.view = plusMonths(m, -(months - 1)); build(); }
      else paint();
      const b = el.querySelector('.dp-c[data-d="' + id + '"] button');
      if (b) b.focus();
    }

    el.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || !el.contains(b)) return;
      if (b.dataset.nav) { s.view = plusMonths(s.view, +b.dataset.nav); build(); }
      else if (b.dataset.d) pick(b.dataset.d);
      else if (b.dataset.n) finish(s.pending, TT.addDays(s.pending, +b.dataset.n));
      else if (b.dataset.step) {
        const n = nights(s.start, s.end) + +b.dataset.step;
        if (n < 1) return;
        s.end = TT.addDays(s.start, n);
        o.onChange(s.start, s.end);
        paint(); foot();
      } else if ('clear' in b.dataset) { o.onChange('', ''); close(); }
      else if ('done' in b.dataset) close();
    });
    el.addEventListener('mouseover', e => {
      const c = e.target.closest('.dp-c');
      if (s.pending && c && s.hover !== c.dataset.d) { s.hover = c.dataset.d; paint(); }
    });
    el.addEventListener('mouseleave', () => { if (s.hover) { s.hover = ''; paint(); } });
    el.addEventListener('keydown', e => {
      if (!e.target.dataset || !e.target.dataset.d) return;
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (step) { e.preventDefault(); move(TT.addDays(s.focus, step)); }
      else if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        const f = dt(s.focus), t = plusMonths(f, (e.key === 'PageUp' ? -1 : 1) * (e.shiftKey ? 12 : 1));
        t.setDate(Math.min(f.getDate(), new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()));
        move(iso(t));
      }
    });

    function place() {
      if (window.innerWidth < 640) return;  // narrow screens: the stylesheet docks it to the bottom
      const r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8 && r.top - h - 6 >= 8) top = r.top - h - 6;
      el.style.left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - w - 8)) + 'px';
      el.style.top = Math.max(8, Math.min(top, window.innerHeight - h - 8)) + 'px';
    }

    cur = {
      el, anchor, host, o, place,
      down: e => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); },
      key: e => { if (e.key === 'Escape' && host === document.body) { e.stopPropagation(); close(); } },
      focusin: e => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); },
      cancel: e => { e.preventDefault(); close(); },  // Esc inside a dialog closes just the picker
    };
    document.addEventListener('pointerdown', cur.down, true);
    document.addEventListener('keydown', cur.key, true);
    document.addEventListener('focusin', cur.focusin, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    host.addEventListener('cancel', cur.cancel);
    anchor.setAttribute('aria-expanded', 'true');
    build();
    host.appendChild(el);
    place();
    const b = el.querySelector('.dp-c button[tabindex="0"]');
    if (b) b.focus({ preventScroll: true });
  }

  TT.dates.toggle = (anchor, o) => (cur && cur.anchor === anchor ? close() : open(anchor, o));
  TT.dates.close = close;

  /** Forms with buttons like <button data-range="start_date,end_date" data-words="Start,End"> and two hidden inputs of those names. */
  TT.dates.bind = form => {
    const fields = () => Array.from(form.querySelectorAll('[data-range]'));
    const words = b => (b.dataset.words || '').split(',').filter(Boolean);
    const sync = () => fields().forEach(b => {
      const [a, z2] = b.dataset.range.split(',');
      b.innerHTML = TT.dates.label(form.elements[a].value, form.elements[z2].value, b.dataset.empty, words(b).length === 2 ? words(b) : null);
    });
    form.addEventListener('click', e => {
      const b = e.target.closest('[data-range]');
      if (!b) return;
      const [a, z2] = b.dataset.range.split(',');
      TT.dates.toggle(b, {
        start: form.elements[a].value, end: form.elements[z2].value, clearable: true, words: words(b).length === 2 ? words(b) : null,
        onChange: (s, en) => { form.elements[a].value = s; form.elements[z2].value = en; sync(); },
      });
    });
    form.addEventListener('reset', () => setTimeout(sync));
    form._syncDates = sync;
    sync();
  };
  TT.dates.sync = form => { if (form._syncDates) form._syncDates(); };
})(window.TT);
