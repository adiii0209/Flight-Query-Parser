/* Trips: editable hotel quote cards. TT.quotes.mount(listEl, { currency, onChange(quotes), onFocus(id) }) */
(function (TT) {
  const FIELDS = [
    ['hotel_name', 'Hotel', 'wide'], ['city', 'City'], ['date', 'Check-in', '', 'date'], ['nights', 'Nights', '', 'number'],
    ['guests', 'Guests'], ['guest_name', 'Guest name'], ['meal_plan', 'Meal plan'], ['room', 'Room', 'wide'],
    ['room_size', 'Room size'], ['items', 'Rooms', '', 'number'], ['cost_per_item', 'Cost per room', '', 'number'], ['total', 'Total', '', 'number'],
    ['cancellation', 'Cancellation', 'wide'],
  ];
  const AREAS = [['nutshell', 'In a nutshell (shown to the client)'], ['notes', 'Internal notes (never shown to the client)']];

  function mount(root, opts) {
    let quotes = [];
    const saveTimers = {};

    const photoStrip = q => (q.photos || []).map((ref, i) =>
      '<span class="q-ph"><img loading="lazy" src="' + TT.esc(TT.photoUrl(ref, 300)) + '" alt=""><button type="button" data-act="rm-photo" data-i="' + i + '" aria-label="Remove photo">×</button></span>').join('')
      || '<span class="ho-hint">No photos. Search the hotel on the map to pull its photos.</span>';

    const landList = q => (q.landmarks || []).map((l, i) =>
      '<span class="q-chip">' + TT.esc(l.name) + '<button type="button" data-act="rm-land" data-i="' + i + '" aria-label="Remove landmark">×</button></span>').join('');

    function card(q, n) {
      const f = FIELDS.map(([k, label, cls, type]) =>
        '<label class="q-f ' + (cls || '') + '"><span>' + label + '</span><input data-k="' + k + '" type="' + (type || 'text') + '" ' + (type === 'number' ? 'min="0" step="any" inputmode="decimal"' : '') +
        ' value="' + TT.esc(q[k] == null ? '' : q[k]) + '"></label>').join('');
      const a = AREAS.map(([k, label]) => '<label class="q-f wide"><span>' + label + '</span><textarea data-k="' + k + '" rows="2">' + TT.esc(q[k] || '') + '</textarea></label>').join('');
      return '<article class="q-card" data-id="' + q.id + '"><header><span class="q-n">' + n + '</span><b class="q-title">' + TT.esc(q.hotel_name || 'New hotel') + '</b>' +
        '<span class="q-total">' + TT.money(q.total, opts.currency()) + '</span>' +
        '<button type="button" class="q-x" data-act="focus" title="Show on map">Map</button><button type="button" class="q-x" data-act="delete" title="Delete quote">Delete</button></header>' +
        '<div class="q-photos">' + photoStrip(q) + '</div><div class="q-grid">' + f + a + '</div>' +
        '<div class="q-place"><div class="q-sub">Hotel on map' + (q.lat != null ? ' <span class="ho-hint ok">pinned</span>' : ' <span class="ho-hint err">not pinned</span>') + '</div>' +
        '<div class="q-search"><input data-search="hotel" placeholder="Search the hotel (name, city)…"><div class="q-res" hidden></div></div>' +
        '<div class="q-sub">Nearby landmarks <span class="ho-hint">(up to 2, shown on the map)</span></div><div class="q-chips">' + landList(q) + '</div>' +
        ((q.landmarks || []).length < 2 ? '<div class="q-search"><input data-search="landmark" placeholder="Add a landmark (e.g. Eiffel Tower)…"><div class="q-res" hidden></div></div>' : '') +
        '</div></article>';
    }

    function render() {
      root.innerHTML = quotes.length ? quotes.map((q, i) => card(q, i + 1)).join('') : '<p class="ho-hint q-empty">No hotel quotes yet. Paste a quotation above or add one by hand.</p>';
    }

    const byId = id => quotes.find(q => q.id === +id);
    const idOf = el => +el.closest('.q-card').dataset.id;

    function save(q) {
      clearTimeout(saveTimers[q.id]);
      saveTimers[q.id] = setTimeout(async () => {
        try { await TT.api('/api/hotel-offers/quotes/' + q.id, { method: 'PUT', json: q }); } catch (e) { TT.toast(e.message, 'err'); }
      }, 500);
      opts.onChange(quotes);
    }

    root.addEventListener('input', e => {
      const k = e.target.dataset.k;
      if (!k) return;
      const q = byId(idOf(e.target));
      q[k] = e.target.type === 'number' ? TT.num(e.target.value) : e.target.value;
      const card_ = e.target.closest('.q-card');
      if (k === 'items' || k === 'cost_per_item') {
        q.total = Math.round((q.items || 0) * (q.cost_per_item || 0));
        card_.querySelector('[data-k="total"]').value = q.total;
      }
      if (k === 'date' && q.date) { q.day = new Date(q.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }); }
      card_.querySelector('.q-total').textContent = TT.money(q.total, opts.currency());
      card_.querySelector('.q-title').textContent = q.hotel_name || 'New hotel';
      save(q);
    });

    root.addEventListener('click', async e => {
      const btn = e.target.closest('[data-act]');
      if (btn) {
        const q = byId(idOf(btn)), act = btn.dataset.act;
        if (act === 'delete') {
          if (!confirm('Delete this quote?')) return;
          try { await TT.api('/api/hotel-offers/quotes/' + q.id, { method: 'DELETE' }); } catch (err) { return TT.toast(err.message, 'err'); }
          quotes = quotes.filter(x => x.id !== q.id); render(); opts.onChange(quotes);
        } else if (act === 'focus') opts.onFocus(q.id);
        else if (act === 'rm-photo') { q.photos.splice(+btn.dataset.i, 1); render(); save(q); }
        else if (act === 'rm-land') { q.landmarks.splice(+btn.dataset.i, 1); render(); save(q); }
        return;
      }
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        const q = byId(idOf(pick)), r = JSON.parse(pick.dataset.pick), kind = pick.dataset.kind;
        if (kind === 'hotel') Object.assign(q, { place_id: r.place_id, address: r.address, lat: r.lat, lng: r.lng, photos: r.photos || q.photos });
        else if ((q.landmarks || []).length < 2) q.landmarks = (q.landmarks || []).concat([{ name: r.name, address: r.address, place_id: r.place_id, lat: r.lat, lng: r.lng }]);
        render(); save(q); opts.onFocus(q.id);
      }
    });

    // place search (hotel + landmarks) with a debounce
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
      add(list) { quotes = quotes.concat(list); render(); opts.onChange(quotes); },
      all: () => quotes,
    };
  }

  TT.quotes = { mount };
})(window.TT);
