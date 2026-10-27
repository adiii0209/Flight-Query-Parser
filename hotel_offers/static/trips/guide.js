/* Trips: the local guide of a city (lively places for the client's city page and map).
   After a paste, a picker opens for each new city: the best 3 are ticked, 5 are listed, tick others, load more, or search for a place and add it.
   The same list lives on the trip page under each city, so it can be edited any time. Only ticked places reach the client.
   TT.guide.html(group, guideMap) -> panel markup;  TT.guide.bind(root, { tripId(), guide(), setGuide(map) });  TT.guide.pickNew(cities, api) -> Promise */
(function (TT) {
  const MAX_ON = 8;
  const ckey = city => String(city || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 60);
  const ratingText = s => (s.rating ? '★ ' + s.rating.toFixed(1) + (s.rating_count ? ' (' + s.rating_count.toLocaleString('en-IN') + ')' : '') : '');

  // a ticked box: the saved choice, or, before the agent has chosen, the suggested best three
  const isOn = (entry, s, i) => (entry.confirmed !== false || entry.draft ? !!s.on : i < 3);

  function list(entry) {
    const spots = entry.spots || [], shown = Math.min(entry.shown || 5, spots.length);
    return '<ul class="gd-list">' + spots.slice(0, shown).map((s, i) => '<li><label><input type="checkbox" data-gd="tick" value="' + TT.esc(s.place_id) + '"' + (isOn(entry, s, i) ? ' checked' : '') + '><span class="gd-t"><b>' + TT.esc(s.name) + '</b>' + (s.blurb ? '<small class="gd-bl">' + TT.esc(s.blurb) + '</small>' : '') + '<small>' +
      TT.esc([s.blurb ? '' : s.kind, ratingText(s), s.custom ? 'added by you' : ''].filter(Boolean).join(' · ')) + '</small></span></label></li>').join('') + '</ul>';
  }
  const tools = (entry, modal) => '<div class="gd-add"><input data-gd-q placeholder="Search another area or place to add…" autocomplete="off"><div class="gd-res" hidden></div></div><div class="gd-btns">' +
    ((entry.shown || 5) < (entry.spots || []).length ? '<button type="button" class="ib" data-gd="more">Load more</button>' : '') + (modal ? '' : '<button type="button" class="ib" data-gd="pick">Open picker</button><button type="button" class="ib" data-gd="refresh">Look up again</button>') + '</div>';

  function inner(city, entry, modal) {
    if (!entry) return '<summary>Local guide <em>Not built yet</em></summary><div class="gd-body"><p class="ho-hint">Lively places of ' + TT.esc(city) + ' for your client: sights, food and nightlife.</p><button type="button" class="ib" data-gd="build">Choose lively places</button></div>';
    const on = (entry.spots || []).filter(s => s.on).length;
    const body = '<p class="ho-hint">Tick the lively areas your client will see on the ' + TT.esc(city) + ' page and map (up to ' + MAX_ON + '). They also show as "Nearby" on each hotel, with the distance.</p>' + list(entry) + tools(entry, modal);
    if (modal) return body;
    return '<summary>Local guide <em' + (entry.confirmed !== false ? '' : ' class="need"') + '>' + (entry.confirmed !== false ? on + ' picked' : 'Choose places') + '</em></summary><div class="gd-body">' + body + '</div>';
  }

  const html = (g, guide) => { const e = guide[ckey(g.city)]; return '<details class="gd" data-ck="' + TT.esc(ckey(g.city)) + '" data-city="' + TT.esc(g.city) + '"' + (e && e.confirmed === false ? ' open' : '') + '>' + inner(g.city, e) + '</details>'; };

  function bind(root, api) {
    const panelOf = el => el.closest('.gd');
    const modalOf = p => p.classList.contains('gd-modal');
    const redraw = (p, map) => {
      const entry = map[p.dataset.ck];
      if (modalOf(p) && entry && entry.confirmed === false) {  // keep what is ticked in the picker while it is redrawn (it is only saved with "Save places")
        const keep = new Set(Array.from(p.querySelectorAll('[data-gd="tick"]:checked')).map(c => c.value));
        entry.spots.forEach(s => { s.on = keep.has(s.place_id) || !!s.on; }); entry.draft = true;
      }
      api.setGuide(map); p.innerHTML = modalOf(p) ? modalBody(p, map) : inner(p.dataset.city, entry);
    };
    const modalBody = (p, map) => '<h3>Choose lively places in ' + TT.esc(p.dataset.city) + '</h3>' + inner(p.dataset.city, map[p.dataset.ck], true) + modalFoot();
    const modalFoot = () => '<div class="gd-foot"><button type="button" class="ib" data-gd="skip">Skip for now</button><button type="button" class="ib primary" data-gd="done">Save places</button></div>';
    root._gdModalBody = modalBody;

    const put = async (p, entry, extra) => {
      const ids = Array.from(p.querySelectorAll('[data-gd="tick"]')).filter(c => c.checked).map(c => c.value);
      const hidden = entry.spots.filter(s => s.on && !p.querySelector('[value="' + CSS.escape(s.place_id) + '"]')).map(s => s.place_id);  // ticked places beyond the listed ones stay ticked
      return (await TT.api('/api/hotel-offers/trips/' + api.tripId() + '/guide/' + p.dataset.ck, { method: 'PUT', json: Object.assign({ on: ids.concat(hidden), shown: entry.shown }, extra) })).guide;
    };

    root.addEventListener('change', async e => {
      const t = e.target, p = t.dataset.gd === 'tick' ? panelOf(t) : null;
      if (!p) return;
      if (t.checked && p.querySelectorAll('[data-gd="tick"]:checked').length > MAX_ON) { t.checked = false; return TT.toast('Pick up to ' + MAX_ON + ' places.', 'err'); }
      if (modalOf(p)) return;  // the picker saves when "Save places" is pressed
      const entry = api.guide()[p.dataset.ck];
      try { const map = await put(p, entry); api.setGuide(map); const em = p.querySelector('summary em'); em.textContent = map[p.dataset.ck].spots.filter(s => s.on).length + ' picked'; em.className = ''; } catch (err) { t.checked = !t.checked; TT.toast(err.message, 'err'); }
    });

    // search for any place and add it to the list, ticked
    const timers = new WeakMap();
    root.addEventListener('input', e => {
      const q = e.target.closest && e.target.closest('[data-gd-q]');
      if (!q) return;
      const p = panelOf(q), box = p.querySelector('.gd-res'), term = q.value.trim();
      clearTimeout(timers.get(q));
      if (term.length < 3) { box.hidden = true; return; }
      timers.set(q, setTimeout(async () => {
        const first = (api.guide()[p.dataset.ck] || { spots: [] }).spots[0];
        const near = first ? '&lat=' + first.lat + '&lng=' + first.lng : '';
        try {
          const { results } = await TT.api('/api/hotel-offers/places?q=' + encodeURIComponent(term + ' ' + p.dataset.city) + near);
          box.hidden = false;
          box.innerHTML = results.length ? results.map(r => '<button type="button" data-gd="add" data-place="' + TT.esc(JSON.stringify({ place_id: r.place_id, name: r.name, address: r.address, rating: r.rating, rating_count: r.rating_count, lat: r.lat, lng: r.lng })) + '"><b>' + TT.esc(r.name) + '</b><small>' + TT.esc(r.address) + '</small></button>').join('') : '<span class="ho-hint">No results.</span>';
        } catch (err) { box.hidden = true; TT.toast(err.message, 'err'); }
      }, 350));
    });

    root.addEventListener('click', async e => {
      const b = e.target.closest('[data-gd]');
      if (!b || b.dataset.gd === 'tick') return;
      e.stopPropagation();
      const p = panelOf(b), act = b.dataset.gd, entry = api.guide()[p.dataset.ck];
      b.disabled = true;
      try {
        if (act === 'pick') { b.disabled = false; openPicker(p.dataset.ck, p.dataset.city, api); return; }
        if (act === 'skip') { p.closest('dialog').close(); return; }
        if (act === 'done') { const map = await put(p, entry); api.setGuide(map); api.refresh && api.refresh(); p.closest('dialog').close(); return; }
        if (act === 'more') { entry.shown = Math.min((entry.shown || 5) + 5, entry.spots.length); redraw(p, modalOf(p) ? api.guide() : await put(p, entry)); }
        else if (act === 'add') {
          const map = (await TT.api('/api/hotel-offers/trips/' + api.tripId() + '/guide/' + p.dataset.ck + '/add', { method: 'POST', json: { place: JSON.parse(b.dataset.place) } })).guide;
          redraw(p, map);
        } else if (act === 'build' || act === 'refresh') {
          if (act === 'refresh' && !confirm('Look this city up again? Your choices will be reset.')) { b.disabled = false; return; }
          b.textContent = 'Looking up…';
          const map = (await TT.api('/api/hotel-offers/trips/' + api.tripId() + '/guide/' + p.dataset.ck + '/refresh', { method: 'POST', json: { city: p.dataset.city } })).guide;
          redraw(p, map);
          openPicker(p.dataset.ck, p.dataset.city, api);
        }
      } catch (err) { TT.toast(err.message, 'err'); b.disabled = false; }
    });
  }

  // ---- the picker that opens after a paste: one dialog per new city, one after the other
  function openPicker(ck, city, api) {
    return new Promise(resolve => {
      let dlg = document.getElementById('gdPicker');
      if (dlg) dlg.remove();
      dlg = document.createElement('dialog'); dlg.id = 'gdPicker'; dlg.className = 'gd-dialog';
      const panel = document.createElement('div'); panel.className = 'gd gd-modal'; panel.dataset.ck = ck; panel.dataset.city = city;
      dlg.appendChild(panel); document.body.appendChild(dlg);
      bind(dlg, api);
      panel.innerHTML = dlg._gdModalBody(panel, api.guide());
      dlg.addEventListener('close', () => { dlg.remove(); resolve(); });
      dlg.showModal();
    });
  }
  async function pickNew(cities, api) {
    for (const city of cities) {
      const ck = ckey(city), e = api.guide()[ck];
      if (e && e.confirmed === false) await openPicker(ck, city, api);
    }
  }

  TT.guide = { html, bind, pickNew };
})(window.TT);
