/* Trips: the local guide of a city, in the agent's trip page. After a paste the best 3 lively places of each city are ticked and 5 are listed;
   tick or untick, or load more. Only ticked places reach the client.
   TT.guide.html(group, guideMap) -> panel markup;  TT.guide.bind(root, { tripId(), guide(), setGuide(map) }) wires it up once. */
(function (TT) {
  const MAX_ON = 8;
  const ckey = city => String(city || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 60);

  function inner(city, entry) {
    if (!entry) return '<summary>Local guide <em>Not built yet</em></summary><div class="gd-body"><p class="ho-hint">Lively places of ' + TT.esc(city) + ' for your client: sights, food and nightlife.</p>' +
      '<button type="button" class="ib" data-gd="build">Build local guide</button></div>';
    const spots = entry.spots || [], shown = Math.min(entry.shown || 5, spots.length), on = spots.filter(s => s.on).length;
    return '<summary>Local guide <em>' + on + ' picked</em></summary><div class="gd-body"><p class="ho-hint">Ticked places appear on your client\'s city page and map. Up to ' + MAX_ON + '.</p><ul class="gd-list">' +
      spots.slice(0, shown).map(s => '<li><label><input type="checkbox" data-gd="tick" value="' + TT.esc(s.place_id) + '"' + (s.on ? ' checked' : '') + '><span class="gd-t"><b>' + TT.esc(s.name) + '</b><small>' +
        TT.esc([s.kind, s.rating ? '★ ' + s.rating.toFixed(1) + (s.rating_count ? ' (' + s.rating_count.toLocaleString('en-IN') + ')' : '') : ''].filter(Boolean).join(' · ')) + '</small></span></label></li>').join('') + '</ul>' +
      '<div class="gd-btns">' + (shown < spots.length ? '<button type="button" class="ib" data-gd="more">Load more</button>' : '') + '<button type="button" class="ib" data-gd="refresh">Look up again</button></div></div>';
  }

  const html = (g, guide) => '<details class="gd" data-ck="' + TT.esc(ckey(g.city)) + '" data-city="' + TT.esc(g.city) + '">' + inner(g.city, guide[ckey(g.city)]) + '</details>';

  function bind(root, api) {
    const panelOf = el => el.closest('.gd');
    const redraw = (p, map) => { api.setGuide(map); p.innerHTML = inner(p.dataset.city, map[p.dataset.ck]); };
    const put = async (p, entry, extra) => {
      const ids = Array.from(p.querySelectorAll('[data-gd="tick"]')).filter(c => c.checked).map(c => c.value);
      const hidden = entry.spots.filter(s => s.on && !p.querySelector('[value="' + CSS.escape(s.place_id) + '"]')).map(s => s.place_id);  // ticked places beyond the listed ones stay ticked
      return (await TT.api('/api/hotel-offers/trips/' + api.tripId() + '/guide/' + p.dataset.ck, { method: 'PUT', json: Object.assign({ on: ids.concat(hidden), shown: entry.shown }, extra) })).guide;
    };

    root.addEventListener('change', async e => {
      const t = e.target, p = t.dataset.gd === 'tick' ? panelOf(t) : null;
      if (!p) return;
      const entry = api.guide()[p.dataset.ck];
      if (t.checked && p.querySelectorAll('[data-gd="tick"]:checked').length > MAX_ON) { t.checked = false; return TT.toast('Pick up to ' + MAX_ON + ' places.', 'err'); }
      try { const map = await put(p, entry); api.setGuide(map); p.querySelector('summary em').textContent = map[p.dataset.ck].spots.filter(s => s.on).length + ' picked'; } catch (err) { t.checked = !t.checked; TT.toast(err.message, 'err'); }
    });

    root.addEventListener('click', async e => {
      const b = e.target.closest('[data-gd]');
      if (!b || b.dataset.gd === 'tick') return;
      e.stopPropagation();
      const p = panelOf(b), act = b.dataset.gd, entry = api.guide()[p.dataset.ck];
      b.disabled = true;
      try {
        if (act === 'more') { entry.shown = Math.min((entry.shown || 5) + 5, entry.spots.length); redraw(p, await put(p, entry)); }
        else if (act === 'build' || act === 'refresh') {
          if (act === 'refresh' && !confirm('Look this city up again? Your ticks will be reset.')) { b.disabled = false; return; }
          b.textContent = 'Looking up…';
          redraw(p, (await TT.api('/api/hotel-offers/trips/' + api.tripId() + '/guide/' + p.dataset.ck + '/refresh', { method: 'POST', json: { city: p.dataset.city } })).guide);
        }
      } catch (err) { TT.toast(err.message, 'err'); b.disabled = false; }
    });
  }

  TT.guide = { html, bind };
})(window.TT);
