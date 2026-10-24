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

  const PIN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.2A7 7 0 0 1 19 9.8C19 14.8 12 21 12 21z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  const CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  const EXPAND = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';

  function mapSection(qs) {
    const pinned = qs.filter(q => q.lat != null);
    if (!pinned.length) return '';
    return '<section class="tc-mapsec" id="tcMapSec"><div class="tc-maphead"><h2>Hotels on the map</h2></div><div class="tc-mapbox">' +
      '<div class="tc-map" id="tcMap"></div>' +
      '<div class="tc-chips" id="tcChips">' + pinned.map(q => '<button type="button" class="tc-chip" data-id="' + q.id + '"><i>' + (qs.indexOf(q) + 1) + '</i>' + TT.esc(q.hotel_name) + '</button>').join('') + '</div>' +
      '<button type="button" class="tc-fs" id="tcFs" aria-label="Full screen">' + EXPAND + '</button></div></section>';
  }

  function selectChip(id) {
    TT.$$('.tc-chip').forEach(c => c.classList.toggle('on', +c.dataset.id === id));
    const on = TT.$('.tc-chip.on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }

  function setFull(full) {
    const sec = TT.$('#tcMapSec'), fab = TT.$('#tcFab');
    if (full) { sec.classList.add('full'); document.documentElement.classList.add('lock'); } else { sec.classList.remove('full'); document.documentElement.classList.remove('lock'); }
    fab.innerHTML = (full ? CLOSE + '<span>Close map</span>' : PIN + '<span>Map</span>');
    fab.setAttribute('aria-label', full ? 'Close map' : 'Open map');
    fab.classList.toggle('over', full);
    TT.$('#tcFs').innerHTML = full ? CLOSE : EXPAND;
    TT.$('#tcFs').setAttribute('aria-label', full ? 'Exit full screen' : 'Full screen');
    setTimeout(() => map.resize(), 60);
    if (!full) sec.scrollIntoView({ block: 'center' });
  }

  function render() {
    const t = data.trip, qs = data.quotes, dates = t.start_date ? TT.date(t.start_date) + (t.end_date ? ' – ' + TT.date(t.end_date) : '') : '';
    root.innerHTML = '<section class="tc-hero"><p class="eyebrow">Your trip</p><h1>' + TT.esc(t.title) + '</h1><p class="tc-meta">' +
      [t.client_name && 'Prepared for ' + t.client_name, t.destination, dates].filter(Boolean).map(TT.esc).join(' · ') + '</p></section>' +
      '<div class="tc-list">' + qs.map((q, i) => card(q, i, t.currency)).join('') + '</div>' +
      '<section class="tc-sum"><span>Total for ' + qs.length + ' hotel' + (qs.length === 1 ? '' : 's') + '</span><b>' + TT.money(t.total, t.currency) + '</b></section>' +
      mapSection(qs) +
      '<p class="tc-note">Prices are indicative and subject to availability until confirmed.</p>';
    if (TT.$('#tcMap')) {
      map = TT.createMap(TT.$('#tcMap'), { onSelect: id => selectChip(id) });
      map.render(qs);
      document.body.insertAdjacentHTML('beforeend', '<button class="tc-fab" id="tcFab" type="button" aria-label="Open map">' + PIN + '<span>Map</span></button>');
      const toggle = () => setFull(!TT.$('#tcMapSec').classList.contains('full'));
      TT.$('#tcFab').addEventListener('click', toggle);
      TT.$('#tcFs').addEventListener('click', toggle);
    }
    const a = TT.$('#navWa');
    if (wa) a.href = 'https://wa.me/' + wa + '?text=' + encodeURIComponent('Hi, about my trip: ' + t.title); else a.hidden = true;
  }

  root.addEventListener('click', e => {
    const b = e.target.closest('.tc-pin, .tc-chip');
    if (!b || !map) return;
    const id = +b.dataset.id;
    if (b.classList.contains('tc-pin')) TT.$('#tcMapSec').scrollIntoView({ behavior: 'smooth', block: 'center' });
    selectChip(id); map.focus(id);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && TT.$('#tcMapSec.full')) setFull(false); });

  TT.api('/api/public/trips/' + encodeURIComponent(slug)).then(d => { data = d; render(); })
    .catch(() => { root.innerHTML = '<p class="tc-load">This trip link is no longer available.</p>'; });
})(window.TT);
