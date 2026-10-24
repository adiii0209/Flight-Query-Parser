/* Trips: one trip - header, stats, hotel quotes and the map. Dialogs (details, paste, share) live in trips.html.
   TT.detail.mount(root, { onBack() }) -> { open(tripId) } */
(function (TT) {
  const ICON = {
    share: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    cog: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/></svg>',
  };

  function mount(root, opts) {
    let trip = null, qm = null, map = null;
    const $ = TT.$;

    function shell() {
      root.innerHTML =
        '<button class="d-back" data-act="back"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>All trips</button>' +
        '<header class="d-hero"><div class="d-hero-main"><h1 id="dTitle"></h1><div class="d-meta" id="dMeta"></div></div>' +
        '<div class="d-actions"><button class="pill ghost" data-act="edit">' + ICON.cog + 'Details</button>' +
        '<button class="pill ghost" data-act="share">' + ICON.share + 'Share<i class="dot" id="shareDot" hidden></i></button>' +
        '<button class="pill primary" data-act="paste">' + ICON.plus + 'Add quotes</button></div></header>' +
        '<section class="d-stats" id="dStats"></section>' +
        '<div class="d-cols"><div class="d-left" id="qList"></div><aside class="d-right"><div class="d-mapcard"><div id="tripMap" class="tt-map"></div><div class="d-chips" id="dChips"></div></div></aside></div>';
      qm = TT.quotes.mount($('#qList', root), {
        currency: () => trip.currency, onChange: onQuotes, selection: () => trip.selection || {}, tripId: () => trip.id,
        onFocus: id => { map.focus(id); selectChip(id); if (matchMedia('(max-width:960px)').matches) $('#tripMap', root).scrollIntoView({ block: 'center', behavior: 'smooth' }); },
      });
      map = TT.createMap($('#tripMap', root), { onSelect: id => { selectChip(id); const c = $('.qc[data-id="' + id + '"]', root); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); } });
    }

    function selectChip(id) { TT.$$('.d-chip', root).forEach(c => c.classList.toggle('on', +c.dataset.id === id)); }

    function onQuotes(list) {
      const groups = TT.groupQuotes(list, trip.selection), total = TT.groupsTotal(groups), nights = groups.reduce((s, g) => s + g.nights, 0);
      const cities = new Set(groups.map(g => (g.city || '').trim().toLowerCase()).filter(Boolean));
      const stat = (v, l) => '<div class="stat"><b>' + v + '</b><span>' + l + '</span></div>';
      $('#dStats', root).innerHTML = stat(groups.length, groups.length === 1 ? 'Stay' : 'Stays') + stat(cities.size, cities.size === 1 ? 'City' : 'Cities') +
        stat(nights, nights === 1 ? 'Night' : 'Nights') + stat(TT.money(total, trip.currency), 'Total (selected)');
      const pins = TT.groupPins(groups);
      $('#dChips', root).innerHTML = pins.map(q =>
        '<button type="button" class="d-chip" data-id="' + q.id + '"><i>' + q.num + '</i>' + TT.esc(q.hotel_name || 'Hotel') + '</button>').join('');
      map.render(pins);
    }

    function fillHead() {
      $('#dTitle', root).textContent = trip.title || 'Untitled trip';
      const dates = trip.start_date ? TT.date(trip.start_date) + (trip.end_date ? ' – ' + TT.date(trip.end_date) : '') : '';
      const bits = [trip.client_name, trip.client_phone, trip.destination, dates].filter(Boolean);
      $('#dMeta', root).innerHTML = bits.length ? bits.map(b => '<span>' + TT.esc(b) + '</span>').join('') : '<span class="muted">Add the client and dates in Details</span>';
      $('#shareDot', root).hidden = !trip.is_shared;
    }

    const patch = async body => {
      try { Object.assign(trip, (await TT.api('/api/hotel-offers/trips/' + trip.id, { method: 'PATCH', json: body })).trip, { quotes: trip.quotes }); return true; } catch (e) { TT.toast(e.message, 'err'); return false; }
    };

    // ---- dialogs
    function fillShare() {
      $('#fShared').checked = trip.is_shared;
      $('#shareLinkRow').hidden = !trip.is_shared;
      $('#shareUrl').value = trip.share_url || '';
      if (trip.share_url) $('#btnView').href = trip.share_url;
      $('#shareHint').textContent = trip.is_shared ? 'The link is live.' : 'Sharing is off. Only your team can see this trip.';
    }

    $('#detailForm').addEventListener('submit', async e => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      if (await patch(body)) { $('#detailDialog').close(); fillHead(); onQuotes(qm.all()); }
    });
    $('#btnDeleteTrip').addEventListener('click', async () => {
      if (!confirm('Delete this trip and all its hotel quotes?')) return;
      try { await TT.api('/api/hotel-offers/trips/' + trip.id, { method: 'DELETE' }); $('#detailDialog').close(); opts.onBack(); } catch (err) { TT.toast(err.message, 'err'); }
    });
    $('#fShared').addEventListener('change', async e => {
      if (!trip) return;
      if (await patch({ is_shared: e.target.checked })) { fillShare(); fillHead(); } else e.target.checked = !e.target.checked;
    });
    $('#btnCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(trip.share_url); TT.toast('Link copied'); } catch (err) { $('#shareUrl').select(); }
    });

    const status = (cls, msg) => { const st = $('#pasteStatus'); st.className = 'ho-hint ' + cls; st.textContent = msg; };
    $('#pasteForm').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = $('#btnParse'), box = $('#pasteBox');
      btn.disabled = true; status('', 'Reading the quotation and placing hotels on the map…');
      try {
        const r = await TT.api('/api/hotel-offers/trips/' + trip.id + '/parse', { method: 'POST', json: { text: box.value } });
        qm.add(r.quotes); box.value = ''; $('#pasteDialog').close();
        TT.toast('Added ' + r.quotes.length + ' quote' + (r.quotes.length === 1 ? '' : 's') + (r.warning ? '. ' + r.warning : ''));
      } catch (err) { status('err', err.message); }
      btn.disabled = false;
    });
    $('#btnBlank').addEventListener('click', async () => {
      try {
        const r = await TT.api('/api/hotel-offers/trips/' + trip.id + '/quotes', { method: 'POST', json: { hotel_name: 'New hotel', rooms: 1, items: 1, date: trip.start_date } });
        qm.add([r.quote], true); $('#pasteDialog').close();
      } catch (err) { status('err', err.message); }
    });

    root.addEventListener('click', e => {
      const chip = e.target.closest('.d-chip');
      if (chip) { selectChip(+chip.dataset.id); map.focus(+chip.dataset.id); return; }
      const btn = e.target.closest('[data-act]');
      if (!btn || btn.closest('.qc')) return;
      const act = btn.dataset.act;
      if (act === 'back') opts.onBack();
      else if (act === 'edit') {
        const f = $('#detailForm');
        ['title', 'client_name', 'client_phone', 'destination', 'currency', 'start_date', 'end_date'].forEach(k => { f.elements[k].value = trip[k] || (k === 'currency' ? 'INR' : ''); });
        $('#detailDialog').showModal();
      } else if (act === 'share') { fillShare(); $('#shareDialog').showModal(); }
      else if (act === 'paste') { status('', ''); $('#pasteDialog').showModal(); $('#pasteBox').focus(); }
    });

    return {
      async open(id) {
        shell();
        try { trip = (await TT.api('/api/hotel-offers/trips/' + id)).trip; fillHead(); qm.set(trip.quotes); onQuotes(trip.quotes); } catch (e) { TT.toast(e.message, 'err'); opts.onBack(); }
      },
    };
  }

  TT.detail = { mount };
})(window.TT);
