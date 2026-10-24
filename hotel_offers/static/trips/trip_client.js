/* Trips: public client page. Shows a shared trip: each hotel with its photos, and the map. */
(function (TT) {
  const slug = document.body.dataset.slug, wa = (document.body.dataset.wa || '').replace(/\D/g, '');
  const root = TT.$('#trip');
  let data = null, map = null;

  const nightsLabel = n => n + ' night' + (n === 1 ? '' : 's');

  function gallery(q) {
    if (!q.photos.length) return '<div class="tc-ph tc-ph-none"><span>' + TT.esc((q.hotel_name || '').slice(0, 1)) + '</span></div>';
    return '<div class="tc-ph"><div class="tc-strip">' + q.photos.map((u, i) => '<img src="' + u + '" alt="' + TT.esc(q.hotel_name) + ' photo ' + (i + 1) + '" loading="' + (i ? 'lazy' : 'eager') + '">').join('') + '</div>' +
      (q.photos.length > 1 ? '<span class="tc-count">' + q.photos.length + ' photos · swipe</span>' : '') + '</div>';
  }

  function card(q, i, cur) {
    const out = q.date && q.nights ? TT.date(TT.addDays(q.date, q.nights)) : '';
    const facts = [['Check-in', q.date ? (q.day ? q.day + ', ' : '') + TT.date(q.date) : ''], ['Check-out', out], ['Guests', q.guests], ['Meal plan', q.meal_plan],
      ['Room', [q.room, q.room_size].filter(Boolean).join(' · ')], ['Cancellation', q.cancellation]].filter(f => f[1]);
    return '<article class="tc-card" id="q' + q.id + '">' + gallery(q) + '<div class="tc-body"><div class="tc-top"><span class="tc-n">' + (i + 1) + '</span><div><h2>' + TT.esc(q.hotel_name) + '</h2>' +
      '<p class="tc-sub">' + [q.city, q.nights ? nightsLabel(q.nights) : ''].filter(Boolean).map(TT.esc).join(' · ') + '</p></div></div>' +
      (q.nutshell ? '<p class="tc-nut">' + TT.esc(q.nutshell).replace(/\n/g, '<br>') + '</p>' : '') +
      '<dl class="tc-facts">' + facts.map(f => '<div><dt>' + f[0] + '</dt><dd>' + TT.esc(f[1]) + '</dd></div>').join('') + '</dl>' +
      ((q.landmarks || []).length ? '<p class="tc-near"><b>Nearby:</b> ' + q.landmarks.map(l => TT.esc(l.name)).join(' · ') + '</p>' : '') +
      '<div class="tc-foot"><div class="tc-price"><small>' + (q.items > 1 ? q.items + ' rooms × ' + TT.money(q.cost_per_item, cur) : 'Stay total') + '</small><b>' + TT.money(q.total, cur) + '</b></div>' +
      (q.lat != null ? '<button class="tc-pin" data-id="' + q.id + '">View on map</button>' : '') + '</div></div></article>';
  }

  function render() {
    const t = data.trip, qs = data.quotes, dates = t.start_date ? TT.date(t.start_date) + (t.end_date ? ' – ' + TT.date(t.end_date) : '') : '';
    root.innerHTML = '<section class="tc-hero"><p class="eyebrow">Your trip</p><h1>' + TT.esc(t.title) + '</h1><p class="tc-meta">' +
      [t.client_name && 'Prepared for ' + t.client_name, t.destination, dates].filter(Boolean).map(TT.esc).join(' · ') + '</p></section>' +
      (qs.some(q => q.lat != null) ? '<div class="tc-map" id="tcMap"></div>' : '') +
      '<div class="tc-list">' + qs.map((q, i) => card(q, i, t.currency)).join('') + '</div>' +
      '<section class="tc-sum"><span>Total for ' + qs.length + ' hotel' + (qs.length === 1 ? '' : 's') + '</span><b>' + TT.money(t.total, t.currency) + '</b></section>' +
      '<p class="tc-note">Prices are indicative and subject to availability until confirmed.</p>';
    if (TT.$('#tcMap')) {
      map = TT.createMap(TT.$('#tcMap'), { onSelect: id => { const c = TT.$('#q' + id); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); } });
      map.render(qs);
    }
    const a = TT.$('#navWa');
    if (wa) a.href = 'https://wa.me/' + wa + '?text=' + encodeURIComponent('Hi, about my trip: ' + t.title); else a.hidden = true;
  }

  root.addEventListener('click', e => {
    const b = e.target.closest('.tc-pin');
    if (!b || !map) return;
    TT.$('#tcMap').scrollIntoView({ behavior: 'smooth', block: 'center' });
    map.focus(+b.dataset.id);
  });

  TT.api('/api/public/trips/' + encodeURIComponent(slug)).then(d => { data = d; render(); })
    .catch(() => { root.innerHTML = '<p class="tc-load">This trip link is no longer available.</p>'; });
})(window.TT);
