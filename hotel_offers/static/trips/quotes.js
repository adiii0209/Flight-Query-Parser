/* Trips: hotel quote cards - a compact summary row that expands into an editor.
   TT.quotes.mount(listEl, { currency(), onChange(quotes), onFocus(id) }) -> { set(list), add(list), all() } */
(function (TT) {
  const SECTIONS = [
    ['Stay', [['hotel_name', 'Hotel', 'wide'], ['city', 'City'], ['date', 'Check-in', '', 'date'], ['nights', 'Nights', '', 'number'], ['rooms', 'Rooms', '', 'number'],
      ['guests', 'Guests'], ['guest_name', 'Guest name'], ['meal_plan', 'Meal plan'], ['website', 'Hotel website', 'wide', 'url']]],
    ['Room & price', [['room', 'Room', 'wide'], ['room_desc', 'Room description', 'wide', 'textarea'], ['room_size', 'Room size'], ['items', 'Room nights', '', 'number'],
      ['cost_per_item', 'Rate per room night', '', 'number'], ['total', 'Total', '', 'number'], ['cancellation', 'Cancellation policy', 'wide']]],
    ['Online deal & currency', [['online_total', 'Online deal total (the stay, as the client would find it online)', 'wide', 'number'], ['local_currency', 'Local currency (e.g. GBP)'],
      ['local_rate', '1 local unit is worth (in trip currency)', '', 'number']]],
  ];
  const AREAS = [['nutshell', 'In a nutshell', 'Shown to the client'], ['notes', 'Internal notes', 'Never shown to the client']];
  const ICON = {
    edit: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.2A7 7 0 0 1 19 9.8C19 14.8 12 21 12 21z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  };

  function mount(root, opts) {
    let quotes = [];
    const open = new Set();
    const timers = {};

    // ---- summary row (re-rendered on every keystroke; the editor below it is left alone so focus is kept)
    function summary(q, n) {  // n: the number of the city card this quote belongs to
      const cur = opts.currency();
      const out = q.date && q.nights ? TT.addDays(q.date, q.nights) : '';
      const media = q.photos && q.photos.length
        ? '<img src="' + TT.esc(TT.photoUrl(q.photos[0], 400)) + '" alt="" loading="lazy">' + (q.photos.length > 1 ? '<span class="qc-count">' + q.photos.length + ' photos</span>' : '')
        : '<div class="qc-noimg">' + TT.esc((q.hotel_name || '?').slice(0, 1).toUpperCase()) + '</div>';
      const tags = [q.meal_plan, [q.room, q.room_size].filter(Boolean).join(' · '), q.guests].filter(Boolean).map(t => '<span>' + TT.esc(t) + '</span>').join('');
      return '<div class="qc-media">' + media + '<span class="qc-n">' + n + '</span>' + (q.lat == null ? '<span class="qc-warn" title="Not pinned on the map">No map pin</span>' : '') + '</div>' +
        '<div class="qc-main"><h3>' + TT.esc(q.hotel_name || 'New hotel') + '</h3><p class="qc-city">' + TT.esc(q.city || 'No city') + '</p>' +
        '<p class="qc-dates">' + (q.date ? TT.esc((q.day ? q.day + ', ' : '') + TT.date(q.date)) + (out ? ' → ' + TT.esc(TT.date(out)) : '') : 'No dates') +
        (q.nights ? ' <i>' + q.nights + ' night' + (q.nights === 1 ? '' : 's') + '</i>' : '') + '</p>' +
        '<div class="qc-tags">' + tags + '</div>' + (q.cancellation ? '<p class="qc-cx">' + TT.esc(q.cancellation) + '</p>' : '') + '</div>' +
        '<div class="qc-side"><b>' + TT.money(q.total, cur) + '</b><small>' + (q.items > 1 ? TT.rateLine(q, cur) : 'Stay total') + '</small>' +
        '<div class="qc-btns"><button type="button" class="ib" data-act="edit" title="Edit">' + ICON.edit + '<span>' + (open.has(q.id) ? 'Close' : 'Edit') + '</span></button>' +
        '<button type="button" class="ib" data-act="focus" title="Show on map">' + ICON.pin + '</button>' +
        '<button type="button" class="ib danger" data-act="delete" title="Delete">' + ICON.trash + '</button></div></div>';
    }

    // ---- editor
    const photoStrip = q => (q.photos || []).map((ref, i) =>
      '<span class="q-ph" draggable="true" data-i="' + i + '" title="Drag to reorder"><img draggable="false" loading="lazy" src="' + TT.esc(TT.photoUrl(ref, 300)) + '" alt=""><button type="button" data-act="rm-photo" data-i="' + i + '" aria-label="Remove photo">×</button></span>').join('')
      || '<span class="ho-hint">No photos yet. Search the hotel under Location to pull its photos from Google, or add your own.</span>';
    const landList = q => (q.landmarks || []).map((l, i) =>
      '<span class="q-chip">' + TT.esc(l.name) + '<button type="button" data-act="rm-land" data-i="' + i + '" aria-label="Remove landmark">×</button></span>').join('');
    const field = ([k, label, cls, type], q) => type === 'textarea' ?
      '<label class="q-f ' + (cls || '') + '"><span>' + label + '</span><textarea data-k="' + k + '" rows="2" maxlength="600" placeholder="e.g. King bed, balcony with sea view, walk-in shower">' + TT.esc(q[k] || '') + '</textarea></label>' :
      '<label class="q-f ' + (cls || '') + '"><span>' + label + '</span><input data-k="' + k + '" type="' + (type || 'text') + '" ' +
      (type === 'number' ? 'min="0" step="any" inputmode="decimal"' : '') + ' value="' + TT.esc(q[k] == null ? '' : q[k]) + '"></label>';

    // Google rating line with a Refresh button (needs the hotel to be pinned)
    function googleRow(q) {
      if (!q.place_id) return '';
      const when = q.google_at ? ' · fetched ' + TT.esc(TT.date(q.google_at)) : '';
      const stars = q.rating ? '<b>★ ' + q.rating + '</b> ' + (q.rating_count ? '(' + q.rating_count.toLocaleString('en-IN') + ' Google reviews)' : '') : 'No Google rating saved';
      return '<div class="q-google"><span>' + stars + when + '</span><button type="button" class="ib" data-act="refresh-google">Refresh rating, website &amp; photos</button></div>';
    }

    function editor(q) {
      if (!q.rooms) q.rooms = TT.roomsOf(q);
      return SECTIONS.map(([title, fields]) => '<div class="q-sec"><h4>' + title + '</h4><div class="q-grid">' + fields.map(f => field(f, q)).join('') + '</div></div>').join('') +
        TT.hotelInfo.html(q) +
        '<div class="q-sec"><h4>Notes</h4><div class="q-grid">' + AREAS.map(([k, label, hint]) =>
          '<label class="q-f wide"><span>' + label + ' <em>' + hint + '</em></span><textarea data-k="' + k + '" rows="2">' + TT.esc(q[k] || '') + '</textarea></label>').join('') + '</div></div>' +
        '<div class="q-sec q-drop"><h4>Photos <em>Up to 10. Drag to reorder. Drop pictures here, or press Ctrl+V to paste a copied image</em></h4><div class="q-photos">' + photoStrip(q) + '</div>' +
        '<div class="q-addph"><label class="ib"><input type="file" accept="image/*" multiple hidden data-upload>Upload from device</label>' +
        '<input data-photourl type="url" placeholder="…or paste an image link"><button type="button" class="ib" data-act="add-url">Add link</button></div>' +
        '<span class="ho-hint" data-phstatus></span></div>' +
        '<div class="q-sec"><h4>Location <span class="' + (q.lat != null ? 'ok' : 'warn') + '">' + (q.lat != null ? 'Pinned on the map' : 'Not pinned') + '</span></h4>' +
        (q.address ? '<p class="ho-hint">' + TT.esc(q.address) + '</p>' : '') +
        '<div class="q-search"><input data-search="hotel" placeholder="Search the hotel to pin it and pull its photos…"><div class="q-res" hidden></div></div>' + googleRow(q) +
        '<h4 class="sub">Nearby landmarks <em>Up to 2, shown on the map</em></h4><div class="q-chips">' + landList(q) + '</div>' +
        ((q.landmarks || []).length < 2 ? '<div class="q-search"><input data-search="landmark" placeholder="Add a landmark (e.g. Eiffel Tower)…"><div class="q-res" hidden></div></div>' : '') + '</div>';
    }

    function card(q, n) {
      return '<article class="qc' + (open.has(q.id) ? ' open' : '') + '" data-id="' + q.id + '"><div class="qc-view">' + summary(q, n) + '</div>' +
        '<div class="qc-edit"' + (open.has(q.id) ? '' : ' hidden') + '>' + (open.has(q.id) ? editor(q) : '') + '</div></article>';
    }

    const numById = {};
    const sel = () => (opts.selection ? opts.selection() : {});
    const nightsLabel = n => n + ' night' + (n === 1 ? '' : 's');

    function render() {
      const groups = TT.groupQuotes(quotes, sel());
      Object.keys(numById).forEach(k => delete numById[k]);
      groups.forEach((g, gi) => g.options.forEach(o => o.lines.forEach(l => { numById[l.id] = gi + 1; })));
      const guided = new Set();  // a city's guide is shown once, on its first stay
      root.innerHTML = groups.length ? groups.map((g, gi) => groupHtml(g, gi, guided)).join('') :
        '<div class="t-empty"><b>No hotel quotes yet</b><p>Use <em>Add quotes</em> to paste a quotation, or add a blank one and fill it in.</p></div>';
    }

    function groupHtml(g, gi, guided) {
      const ck = (g.city || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      const guide = ck && !guided.has(ck) && opts.guide ? (guided.add(ck), TT.guide.html(g, opts.guide())) : '';
      const dates = g.date ? TT.date(g.date) + (g.checkout ? ' → ' + TT.date(g.checkout) : '') : 'No dates';
      const multi = g.options.length > 1;
      return '<section class="qg" data-g="' + TT.esc(g.key) + '"><header class="qg-head"><span class="qg-n">' + (gi + 1) + '</span>' +
        '<div><h2>' + TT.esc(g.city || 'No city') + '</h2><p>' + TT.esc(dates) + (g.nights ? ' · ' + nightsLabel(g.nights) : '') + ' · ' + g.options.length + (multi ? ' options' : ' option') + '</p></div>' +
        '<div class="qg-total"><small>' + (!multi ? 'Total' : g.selectedOption ? 'Selected' : 'Not chosen yet') + '</small><b>' + (!multi ? TT.money(g.options[0].total, opts.currency()) : g.selectedOption ? TT.money(g.selectedOption.total, opts.currency()) : '—') + '</b></div></header>' +
        guide + g.options.map((o, oi) => optionHtml(g, o, oi, multi)).join('') + '</section>';
    }

    function optionHtml(g, o, oi, multi) {
      const isSel = o.key === g.selected;
      const badge = !multi ? '' : isSel ? '<span class="badge">' + 'Guest picked' + (TT.qtyText(g.selectedOption) ? ' · ' + TT.esc(TT.qtyText(g.selectedOption)) : '') + '</span>' : '';
      const head = multi ? '<div class="qo-head"><span class="qo-tag">Option ' + (oi + 1) + '</span><b>' + TT.esc(o.hotel_name || 'Hotel') + '</b>' + badge +
        (o.lines.length > 1 ? '<span class="qo-rooms">' + o.lines.length + ' rooms</span>' : '') + '<span class="spacer"></span>' +
        '<span class="qo-total">' + TT.money(o.total, opts.currency()) + '</span>' +
        (oi > 0 ? '<button type="button" class="ib" data-act="make-default" data-opt="' + TT.esc(o.key) + '">Make first</button>' : '') + '</div>' : '';
      return '<div class="qo' + (multi ? ' multi' : '') + (isSel && multi ? ' is-sel' : '') + '">' + head + o.lines.map(l => card(l, numById[l.id])).join('') + '</div>';
    }

    const byId = id => quotes.find(q => q.id === +id);
    const cardOf = el => el.closest('.qc');
    const idOf = el => +cardOf(el).dataset.id;
    const refreshSummary = q => { const c = root.querySelector('.qc[data-id="' + q.id + '"] .qc-view'); if (c) c.innerHTML = summary(q, numById[q.id]); };

    function save(q) {
      clearTimeout(timers[q.id]);
      timers[q.id] = setTimeout(async () => {
        try { await TT.api('/api/hotel-offers/quotes/' + q.id, { method: 'PUT', json: q }); } catch (e) { TT.toast(e.message, 'err'); }
      }, 500);
      opts.onChange(quotes);
    }

    if (opts.guide) TT.guide.bind(root, { tripId: opts.tripId, guide: opts.guide, setGuide: opts.setGuide, refresh: opts.refresh });

    root.addEventListener('input', e => {
      const k = e.target.dataset.k;
      if (!k) return;
      const q = byId(idOf(e.target));
      q[k] = e.target.type === 'number' || k === 'stars' ? TT.num(e.target.value) : e.target.value;
      const set = (key, v) => { q[key] = v; const f = cardOf(e.target).querySelector('[data-k="' + key + '"]'); if (f) f.value = v; };
      if (k === 'nights' || k === 'rooms') set('items', (q.rooms || 1) * (q.nights || 0));  // room nights = rooms x nights
      if (k === 'nights' || k === 'rooms' || k === 'items' || k === 'cost_per_item') set('total', Math.round((q.items || 0) * (q.cost_per_item || 0)));
      if (k === 'date' && q.date) q.day = new Date(q.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
      refreshSummary(q); save(q);
      if (['city', 'date', 'nights', 'hotel_name'].includes(k)) regroup = true;
    });
    let regroup = false;
    root.addEventListener('change', e => { if (regroup && e.target.dataset.k) { regroup = false; render(); } });

    root.addEventListener('click', async e => {
      const btn = e.target.closest('[data-act]');
      if (btn) {
        e.stopPropagation();  // the page-level handler also listens for data-act clicks
        if (btn.dataset.act === 'make-default') { await makeFirst(btn.closest('.qg').dataset.g, btn.dataset.opt); return; }  // lives in the option header, outside any quote card
        const q = byId(idOf(btn)), act = btn.dataset.act;
        if (act === 'edit') {
          open.has(q.id) ? open.delete(q.id) : open.add(q.id);
          const c = cardOf(btn), ed = c.querySelector('.qc-edit');
          c.classList.toggle('open', open.has(q.id)); ed.hidden = !open.has(q.id);
          ed.innerHTML = open.has(q.id) ? editor(q) : '';
          refreshSummary(q);
        } else if (act === 'delete') {
          if (!confirm('Delete this hotel quote?')) return;
          try { await TT.api('/api/hotel-offers/quotes/' + q.id, { method: 'DELETE' }); } catch (err) { return TT.toast(err.message, 'err'); }
          quotes = quotes.filter(x => x.id !== q.id); open.delete(q.id); render(); opts.onChange(quotes);
        } else if (act === 'focus') opts.onFocus(q.id);
        else if (act === 'add-url') {
          const inp = cardOf(btn).querySelector('[data-photourl]');
          if (inp.value.trim()) { await addPhoto(q, { url: inp.value.trim() }); }
        } else if (act === 'refresh-google') {
          btn.disabled = true;
          try {
            const { place } = await TT.api('/api/hotel-offers/places/details?place_id=' + encodeURIComponent(q.place_id));
            Object.assign(q, { rating: place.rating, rating_count: place.rating_count, maps_url: place.maps_url, google_at: place.google_at,
              website: place.website || q.website, photos: (q.photos || []).length ? q.photos : place.photos });
            rerenderEditor(q); save(q); TT.toast('Updated from Google');
          } catch (err) { TT.toast(err.message, 'err'); btn.disabled = false; }
        } else if (act === 'rm-photo') { q.photos.splice(+btn.dataset.i, 1); rerenderEditor(q); save(q); }
        else if (act === 'rm-land') { q.landmarks.splice(+btn.dataset.i, 1); rerenderEditor(q); save(q); }
        return;
      }
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        const q = byId(idOf(pick)), r = JSON.parse(pick.dataset.pick);
        if (pick.dataset.kind === 'hotel') Object.assign(q, { place_id: r.place_id, address: r.address, lat: r.lat, lng: r.lng, photos: r.photos && r.photos.length ? r.photos : q.photos,
          rating: r.rating || 0, rating_count: r.rating_count || 0, maps_url: r.maps_url || '', website: r.website || q.website || '', google_at: new Date().toISOString().slice(0, 10) });
        else if ((q.landmarks || []).length < 2) q.landmarks = (q.landmarks || []).concat([{ name: r.name, address: r.address, place_id: r.place_id, lat: r.lat, lng: r.lng }]);
        rerenderEditor(q); save(q); opts.onFocus(q.id);
      }
    });

    // put an option (all its room lines) first in its city: the first option is the one guests see selected
    async function makeFirst(groupKey, optKey) {
      const g = TT.groupQuotes(quotes, sel()).find(x => x.key === groupKey);
      if (!g) return;
      const lines = g.options.find(o => o.key === optKey).lines, inGroup = new Set(g.options.flatMap(o => o.lines));
      const at = quotes.findIndex(q => inGroup.has(q));
      const rest = quotes.filter(q => !lines.includes(q));
      rest.splice(rest.findIndex(q => inGroup.has(q)) < 0 ? at : rest.findIndex(q => inGroup.has(q)), 0, ...lines);
      quotes = rest; quotes.forEach((q, i) => { q.position = i; });
      render(); opts.onChange(quotes);
      try { await TT.api('/api/hotel-offers/trips/' + opts.tripId() + '/order', { method: 'POST', json: { ids: quotes.map(q => q.id) } }); } catch (err) { TT.toast(err.message, 'err'); }
    }

    TT.hotelInfo.bind(root, { quoteOf: el => byId(idOf(el)), save, rerender: q => rerenderEditor(q) });

    // ---- hand-added photos: device upload, clipboard paste, drag-and-drop, or an image link
    async function addPhoto(q, source) {
      const c = root.querySelector('.qc[data-id="' + q.id + '"]');
      const say = (msg, cls) => { const el = c && c.querySelector('[data-phstatus]'); if (el) { el.textContent = msg; el.className = 'ho-hint ' + (cls || ''); } };
      if ((q.photos || []).length >= 10) { say('A quote can have up to 10 photos.', 'err'); return; }
      say('Adding picture…');
      try {
        let r;
        if (source.file) { const fd = new FormData(); fd.append('file', source.file, source.file.name || 'pasted.png'); r = await TT.api('/api/hotel-offers/trips/photos', { method: 'POST', body: fd }); }
        else r = await TT.api('/api/hotel-offers/trips/photos', { method: 'POST', json: { url: source.url } });
        q.photos = (q.photos || []).concat([r.ref]);
        rerenderEditor(q); save(q);
      } catch (err) { say(err.message, 'err'); }
    }
    const addFiles = async (q, files) => { for (const f of files) { if (/^image\//.test(f.type)) await addPhoto(q, { file: f }); } };

    root.addEventListener('change', e => {
      if (!e.target.matches('[data-upload]')) return;
      const q = byId(idOf(e.target)); addFiles(q, Array.from(e.target.files)); e.target.value = '';
    });
    root.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.matches('[data-photourl]')) { e.preventDefault(); e.target.closest('.q-addph').querySelector('[data-act="add-url"]').click(); }
    });
    root.addEventListener('paste', e => {
      if (!e.target.closest || !e.target.closest('.qc-edit')) return;
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(f => /^image\//.test(f.type));
      if (!files.length) return;  // plain text pastes behave normally
      e.preventDefault(); addFiles(byId(idOf(e.target)), files);
    });
    // drag: thumbnails reorder; files / pictures from other pages are added
    let dragIdx = null, overDepth = 0;
    const clearMarks = () => root.querySelectorAll('.q-ph.before,.q-ph.after,.q-ph.dragging,.q-drop.over').forEach(el => el.classList.remove('before', 'after', 'dragging', 'over'));
    const hasFiles = e => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
    root.addEventListener('dragstart', e => {
      const th = e.target.closest && e.target.closest('.q-ph');
      if (!th) return;
      dragIdx = +th.dataset.i; th.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-photo-index', String(dragIdx));
    });
    root.addEventListener('dragend', () => { dragIdx = null; overDepth = 0; clearMarks(); });
    root.addEventListener('dragenter', e => { const z = e.target.closest && e.target.closest('.q-drop'); if (z) { overDepth++; if (dragIdx === null) z.classList.add('over'); } });
    root.addEventListener('dragleave', e => {
      const z = e.target.closest && e.target.closest('.q-drop');
      if (z && --overDepth <= 0) { overDepth = 0; z.classList.remove('over'); }
    });
    root.addEventListener('dragover', e => {
      const z = e.target.closest && e.target.closest('.q-drop');
      if (!z) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = dragIdx !== null ? 'move' : 'copy';
      if (dragIdx === null) return;
      root.querySelectorAll('.q-ph.before,.q-ph.after').forEach(el => el.classList.remove('before', 'after'));
      const th = e.target.closest('.q-ph');
      if (th && +th.dataset.i !== dragIdx) th.classList.add(e.clientX < th.getBoundingClientRect().left + th.offsetWidth / 2 ? 'before' : 'after');
    });
    root.addEventListener('drop', async e => {
      const z = e.target.closest && e.target.closest('.q-drop');
      if (!z) return;
      e.preventDefault(); overDepth = 0;
      const q = byId(idOf(z));
      if (dragIdx !== null) {  // reorder
        const th = e.target.closest('.q-ph');
        let to = q.photos.length - 1;
        if (th) { to = +th.dataset.i; if (e.clientX >= th.getBoundingClientRect().left + th.offsetWidth / 2) to += 1; if (dragIdx < to) to -= 1; }
        const from = dragIdx; dragIdx = null; clearMarks();
        if (to !== from) { q.photos.splice(to, 0, q.photos.splice(from, 1)[0]); rerenderEditor(q); save(q); }
        return;
      }
      clearMarks();
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length) { await addFiles(q, files); return; }
      const link = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').split('\n')[0].trim();
      if (/^https:\/\//.test(link)) await addPhoto(q, { url: link });
    });
    // a picture dropped just outside the zone must not make the browser leave the page
    window.addEventListener('dragover', e => { if (hasFiles(e) && !(e.target.closest && e.target.closest('.q-drop'))) e.preventDefault(); });
    window.addEventListener('drop', e => { if (hasFiles(e) && !(e.target.closest && e.target.closest('.q-drop'))) e.preventDefault(); });

    function rerenderEditor(q) {
      const c = root.querySelector('.qc[data-id="' + q.id + '"]');
      if (!c) return;
      c.querySelector('.qc-edit').innerHTML = editor(q);
      refreshSummary(q);
    }

    // place search (hotel + landmarks), debounced
    const search = TT.debounce(async input => {
      const q = byId(idOf(input)), box = input.nextElementSibling, kind = input.dataset.search, text = input.value.trim();
      if (text.length < 3) { box.hidden = true; return; }
      const query = kind === 'hotel' ? text : text + ' ' + (q.city || '');
      const near = kind === 'landmark' && q.lat != null ? '&lat=' + q.lat + '&lng=' + q.lng : '';
      try {
        const { results } = await TT.api('/api/hotel-offers/places?q=' + encodeURIComponent(query) + near);
        box.innerHTML = results.length ? results.map(r => '<button type="button" data-kind="' + kind + '" data-pick="' + TT.esc(JSON.stringify(r)) + '"><b>' + TT.esc(r.name) + '</b><small>' + TT.esc(r.address) + '</small></button>').join('') : '<span class="ho-hint">No results.</span>';
      } catch (err) { box.innerHTML = '<span class="ho-hint err">' + TT.esc(err.message) + '</span>'; }
      box.hidden = false;
    }, 400);
    root.addEventListener('input', e => { if (e.target.dataset.search) search(e.target); });

    return {
      set(list) { quotes = list; render(); },
      add(list, openNew) { quotes = quotes.concat(list); if (openNew) list.forEach(q => open.add(q.id)); render(); opts.onChange(quotes); },
      all: () => quotes,
    };
  }

  TT.quotes = { mount };
})(window.TT);
