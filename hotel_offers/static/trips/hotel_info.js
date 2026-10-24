/* Trips: the "Hotel details" part of a quote editor - star rating, style, age / renovation, location, perks, and the switches
   for the Google rating and reviews. Anything left empty is simply not shown to the client.
   TT.hotelInfo.html(q) -> section markup;  TT.hotelInfo.bind(root, { quoteOf(el), save(q), rerender(q) }) wires it up once. */
(function (TT) {
  const STYLES = ['Boutique hotel', 'Standalone building', 'Resort', 'Beachfront resort', 'Business hotel', 'Heritage property', 'Serviced apartments', 'Villa', 'Budget stay'];
  const MAX_PERKS = 6;

  function perkRow(p, i) {
    return '<div class="q-perk" data-i="' + i + '"><select data-pk="icon" aria-label="Perk icon">' +
      TT.perkNames.map(([k, l]) => '<option value="' + k + '"' + (k === p.icon ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
      '<input data-pk="label" value="' + TT.esc(p.label || '') + '" placeholder="e.g. Daily breakfast" maxlength="60">' +
      '<button type="button" class="q-x" data-hi="rm-perk" aria-label="Remove perk">×</button></div>';
  }

  function html(q) {
    const perks = q.perks || [];
    const stars = '<option value="0">Not set</option>' + [1, 2, 3, 4, 5].map(n => '<option value="' + n + '"' + (q.stars === n ? ' selected' : '') + '>' + n + ' star' + (n === 1 ? '' : 's') + '</option>').join('');
    const check = (key, label) => '<label class="q-check"><input type="checkbox" data-toggle="' + key + '"' + (q[key] ? '' : ' checked') + '>' + label + '</label>';
    return '<div class="q-sec"><h4>Hotel details <em>Empty fields are not shown to the client</em></h4><div class="q-grid">' +
      '<label class="q-f"><span>Star rating</span><select data-k="stars">' + stars + '</select></label>' +
      '<label class="q-f"><span>Style</span><input data-k="style" list="hiStyles' + q.id + '" value="' + TT.esc(q.style || '') + '" placeholder="Boutique hotel, standalone building…" maxlength="60">' +
      '<datalist id="hiStyles' + q.id + '">' + STYLES.map(s => '<option value="' + s + '">').join('') + '</datalist></label>' +
      '<label class="q-f wide"><span>Age or renovation</span><input data-k="age_info" value="' + TT.esc(q.age_info || '') + '" placeholder="e.g. Built 1998, renovated 2022" maxlength="120"></label>' +
      '<label class="q-f wide"><span>Where it is</span><input data-k="location_info" value="' + TT.esc(q.location_info || '') + '" placeholder="e.g. 2 km from the city centre, a short walk to Walking Street" maxlength="300"></label>' +
      '</div><div class="q-dist"><input data-ref placeholder="Measure from: the city centre, or a lively spot (e.g. Walking Street)"><button type="button" class="ib" data-hi="distance">Calculate distance</button></div>' +
      '<h4 class="sub">Perks <em>Up to ' + MAX_PERKS + '</em></h4><div class="q-perks">' + perks.map(perkRow).join('') + '</div>' +
      (perks.length < MAX_PERKS ? '<button type="button" class="ib" data-hi="add-perk">+ Add perk</button>' : '') +
      '<h4 class="sub">Google <em>Switch off what you do not want the client to see</em></h4><div class="q-checks">' +
      check('hide_rating', 'Show Google rating') + check('hide_reviews', 'Show review count and link') + '</div></div>';
  }

  function bind(root, api) {
    const q = el => api.quoteOf(el);

    root.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.pk === 'label') { const i = +t.closest('.q-perk').dataset.i, x = q(t); x.perks[i].label = t.value; api.save(x); }
    });

    root.addEventListener('change', e => {
      const t = e.target, x = t.closest && t.closest('.qc') ? q(t) : null;
      if (!x) return;
      if (t.dataset.toggle) { x[t.dataset.toggle] = !t.checked; api.save(x); return; }  // checked = shown, so the stored flag is "hide"
      if (t.dataset.pk === 'icon') {
        const p = x.perks[+t.closest('.q-perk').dataset.i];
        const wasDefault = !p.label || p.label === TT.perkText[p.icon];
        p.icon = t.value;
        if (wasDefault) p.label = TT.perkText[p.icon] || p.label;  // an untouched label follows the icon, a typed one stays
        api.save(x); api.rerender(x);
      }
    });

    root.addEventListener('click', async e => {
      const b = e.target.closest('[data-hi]');
      if (!b) return;
      e.stopPropagation();
      const x = q(b), act = b.dataset.hi;
      if (act === 'add-perk') {
        x.perks = (x.perks || []).concat([{ icon: 'breakfast', label: TT.perkText.breakfast }]);
        api.save(x); api.rerender(x);
      } else if (act === 'rm-perk') {
        x.perks.splice(+b.closest('.q-perk').dataset.i, 1); api.save(x); api.rerender(x);
      } else if (act === 'distance') {
        if (x.lat == null) return TT.toast('Pin the hotel on the map first (search it under Location).', 'err');
        const ref = b.closest('.q-sec').querySelector('[data-ref]').value.trim();
        if (x.location_info && !confirm('Replace the current location text?')) return;
        b.disabled = true;
        try {
          const r = await TT.api('/api/hotel-offers/places/distance?lat=' + x.lat + '&lng=' + x.lng + '&city=' + encodeURIComponent(x.city || '') + '&ref=' + encodeURIComponent(ref));
          x.location_info = r.text; api.save(x); api.rerender(x);
        } catch (err) { TT.toast(err.message, 'err'); b.disabled = false; }
      }
    }, true);  // capture: this must run before the quote list's own click handler
  }

  TT.hotelInfo = { html, bind };
})(window.TT);
