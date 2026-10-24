/* Trips: public client page. One card per city and dates; open it to compare the hotel options and pick one.
   The pick is saved on the trip (the agent sees it). The trip total adds up the selected option of every city. */
(function (TT) {
  const slug = document.body.dataset.slug, wa = (document.body.dataset.wa || '').replace(/\D/g, '');
  const root = TT.$('#trip');
  let data = null, groups = [], selection = {}, map = null, chipSel = null, savedY = 0;
  const openGroups = new Set();

  const PIN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.2A7 7 0 0 1 19 9.8C19 14.8 12 21 12 21z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  const CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const EXPAND = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
  const CHEV = '<svg class="cg-chev" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  const cur = () => data.trip.currency;
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const dayDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
  const groupDates = g => g.date ? dayDate(g.date) + (g.checkout ? ' → ' + dayDate(g.checkout) : '') + (g.nights ? ' · ' + plural(g.nights, 'night') : '') : '';

  // ---- one hotel option: photos, details, and its room lines
  function gallery(o) {
    const line = o.lines.find(l => l.photos.length) || o.lines[0];
    if (!line.photos.length) return '<div class="tc-ph tc-ph-none"><span>' + TT.esc((o.hotel_name || '?').slice(0, 1)) + '</span></div>';
    return '<div class="tc-ph"><div class="tc-strip">' + line.photos.map((u, i) => '<img src="' + u + '" alt="' + TT.esc(o.hotel_name) + ' photo ' + (i + 1) + '" loading="lazy">').join('') + '</div>' +
      (line.photos.length > 1 ? '<span class="tc-count">' + line.photos.length + ' photos · swipe</span>' : '') + '</div>';
  }

  function lineHtml(l) {
    const meta = [l.meal_plan, l.guests, l.guest_name].filter(Boolean).map(TT.esc).join(' · ');
    const rooms = TT.roomsOf(l);
    return '<div class="co-line"><div class="co-lmain"><b>' + TT.esc([l.room, l.room_size].filter(Boolean).join(' · ') || 'Room') + '</b>' + (meta ? '<span>' + meta + '</span>' : '') +
      (l.cancellation ? '<em>' + TT.esc(l.cancellation) + '</em>' : '') + '</div>' +
      '<div class="co-lprice"><b>' + TT.money(l.total, cur()) + '</b><small>' + plural(rooms, 'room') + ' × ' + plural(l.nights || 0, 'night') + ' × ' + TT.money(l.cost_per_item, cur()) + '</small></div></div>';
  }

  function optionHtml(g, o, multi) {
    const isSel = o.key === g.selected;
    const first = o.lines[0], located = o.lines.find(l => l.lat != null);
    const nut = (o.lines.find(l => l.nutshell) || {}).nutshell;
    const near = (o.lines.find(l => (l.landmarks || []).length) || { landmarks: [] }).landmarks;
    const pick = multi ? '<button type="button" class="co-pick' + (isSel ? ' on' : '') + '" data-g="' + TT.esc(g.key) + '" data-o="' + TT.esc(o.key) + '" aria-pressed="' + isSel + '">' + (isSel ? CHECK + 'Selected' : 'Select') + '</button>' : '';
    return '<div class="co' + (isSel && multi ? ' is-sel' : '') + '">' + gallery(o) + '<div class="co-body"><div class="co-top"><div><h3>' + TT.esc(o.hotel_name || first.hotel_name) + '</h3>' +
      '<p class="tc-sub">' + TT.esc([first.city, first.address].filter(Boolean).join(' · ')) + '</p></div>' + pick + '</div>' +
      (nut ? '<p class="tc-nut">' + TT.esc(nut).replace(/\n/g, '<br>') + '</p>' : '') +
      (near.length ? '<p class="tc-near"><b>Nearby:</b> ' + near.map(l => TT.esc(l.name)).join(' · ') + '</p>' : '') +
      '<div class="co-lines">' + o.lines.map(lineHtml).join('') + '</div>' +
      '<div class="tc-foot"><div class="tc-price"><small>' + (o.lines.length > 1 ? 'Total for ' + plural(o.lines.length, 'room') : 'Stay total') + '</small><b>' + TT.money(o.total, cur()) + '</b></div>' +
      (located ? '<button class="tc-pin" data-id="' + located.id + '">View on map</button>' : '') + '</div></div></div>';
  }

  // ---- one city card
  function groupHtml(g, gi) {
    const multi = g.options.length > 1, sel = g.selectedOption;
    return '<article class="cg' + (openGroups.has(g.key) ? ' open' : '') + '" data-g="' + TT.esc(g.key) + '" data-i="' + gi + '">' +
      '<button type="button" class="cg-head" aria-expanded="' + openGroups.has(g.key) + '"><span class="cg-n">' + (gi + 1) + '</span>' +
      '<span class="cg-title"><h2>' + TT.esc(g.city || 'Your stay') + '</h2><span class="cg-sub">' + TT.esc(groupDates(g)) + '</span>' +
      '<span class="cg-pick">' + (multi ? '<i>Selected</i>' : '') + TT.esc(sel.hotel_name) + '</span></span>' +
      '<span class="cg-right"><small>' + (multi ? plural(g.options.length, 'option') : 'Included') + '</small><b>' + TT.money(sel.total, cur()) + '</b></span>' + CHEV + '</button>' +
      '<div class="cg-body"><div class="cg-opts">' + g.options.map(o => optionHtml(g, o, multi)).join('') + '</div></div></article>';
  }

  function summaryHtml() {
    const rows = groups.map((g, gi) => '<li><span><i>' + (gi + 1) + '</i>' + TT.esc(g.city || 'Stay') + '<small>' + TT.esc(g.selectedOption.hotel_name) + '</small></span><b>' + TT.money(g.selectedOption.total, cur()) + '</b></li>').join('');
    return '<section class="tc-sum"><div class="tc-sum-head"><span>Trip total</span><b>' + TT.money(TT.groupsTotal(groups), cur()) + '</b></div><ul>' + rows + '</ul>' +
      '<p>Based on the options you have selected for each city.</p></section>';
  }

  // ---- map
  function mapSection(pins) {
    if (!pins.length) return '';
    return '<section class="tc-mapsec" id="tcMapSec"><div class="tc-maphead"><h2>Hotels on the map</h2></div><div class="tc-mapbox">' +
      '<div class="tc-map" id="tcMap"></div>' +
      '<div class="tc-chips" id="tcChips">' + pins.map(q => '<button type="button" class="tc-chip" data-id="' + q.id + '"><i>' + q.num + '</i>' + TT.esc(q.hotel_name) + '</button>').join('') + '</div>' +
      '<button type="button" class="tc-fs" id="tcFs" aria-label="Full screen">' + EXPAND + '</button></div></section>';
  }

  function selectChip(id) {
    chipSel = id;
    TT.$$('.tc-chip').forEach(c => c.classList.toggle('on', id !== null && +c.dataset.id === id));
    const on = TT.$('.tc-chip.on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }

  function setFull(full) {
    const sec = TT.$('#tcMapSec'), fab = TT.$('#tcFab');
    if (full && !sec.classList.contains('full')) savedY = window.scrollY;
    if (full) { sec.classList.add('full'); document.documentElement.classList.add('lock'); } else { sec.classList.remove('full'); document.documentElement.classList.remove('lock'); }
    fab.innerHTML = (full ? CLOSE + '<span>Close map</span>' : PIN + '<span>Map</span>');
    fab.setAttribute('aria-label', full ? 'Close map' : 'Open map');
    fab.classList.toggle('over', full);
    TT.$('#tcFs').innerHTML = full ? CLOSE : EXPAND;
    TT.$('#tcFs').setAttribute('aria-label', full ? 'Exit full screen' : 'Full screen');
    setTimeout(() => map.resize(), 60);
    if (!full) window.scrollTo({ top: savedY, behavior: 'instant' });  // back to exactly where you were, not down to the map
  }

  function render() {
    const t = data.trip, dates = t.start_date ? TT.date(t.start_date) + (t.end_date ? ' – ' + TT.date(t.end_date) : '') : '';
    groups = TT.groupQuotes(data.quotes, selection);
    if (!openGroups.size && groups.length) openGroups.add(groups[0].key);
    const pins = TT.groupPins(groups);
    root.innerHTML = '<section class="tc-hero"><p class="eyebrow">Your trip</p><h1>' + TT.esc(t.title) + '</h1><p class="tc-meta">' +
      [t.client_name && 'Prepared for ' + t.client_name, t.destination, dates].filter(Boolean).map(TT.esc).join(' · ') + '</p>' +
      (groups.some(g => g.options.length > 1) ? '<p class="tc-help">Some cities have more than one hotel to choose from. Open a city to compare, then tap <b>Select</b> on the one you prefer.</p>' : '') + '</section>' +
      '<div class="cg-list" id="cgList">' + groups.map(groupHtml).join('') + '</div><div id="sumHost">' + summaryHtml() + '</div>' + mapSection(pins) +
      '<p class="tc-note">Prices are indicative and subject to availability until confirmed.</p>';
    if (TT.$('#tcMap')) {
      map = TT.createMap(TT.$('#tcMap'), { onSelect: id => selectChip(id) });
      map.render(pins);
      document.body.insertAdjacentHTML('beforeend', '<button class="tc-fab" id="tcFab" type="button" aria-label="Open map">' + PIN + '<span>Map</span></button>');
      const toggle = () => setFull(!TT.$('#tcMapSec').classList.contains('full'));
      TT.$('#tcFab').addEventListener('click', toggle);
      TT.$('#tcFs').addEventListener('click', toggle);
    }
    const a = TT.$('#navWa');
    if (wa) a.href = 'https://wa.me/' + wa + '?text=' + encodeURIComponent('Hi, about my trip: ' + t.title); else a.hidden = true;
  }

  // re-draw one city card and the total after a selection (the rest of the page, and the map, stay as they are)
  function refreshAfterSelect(groupKey) {
    groups = TT.groupQuotes(data.quotes, selection);
    const gi = groups.findIndex(g => g.key === groupKey), old = TT.$('.cg[data-g="' + CSS.escape(groupKey) + '"]');
    if (gi >= 0 && old) { const tmp = document.createElement('div'); tmp.innerHTML = groupHtml(groups[gi], gi); old.replaceWith(tmp.firstChild); }
    TT.$('#sumHost').innerHTML = summaryHtml();
  }

  async function choose(groupKey, optionKey) {
    const before = Object.assign({}, selection);
    selection[groupKey] = optionKey; refreshAfterSelect(groupKey);
    try {
      const r = await TT.api('/api/public/trips/' + encodeURIComponent(slug) + '/select', { method: 'POST', json: { group: groupKey, option: optionKey } });
      selection = r.selection;
    } catch (err) {
      selection = before; refreshAfterSelect(groupKey); TT.toast(err.message || 'Could not save your choice', 'err');
    }
  }

  root.addEventListener('click', e => {
    const pick = e.target.closest('.co-pick');
    if (pick) { if (!pick.classList.contains('on')) choose(pick.dataset.g, pick.dataset.o); return; }
    const head = e.target.closest('.cg-head');
    if (head) {
      const card = head.closest('.cg'), key = card.dataset.g, open = !card.classList.contains('open');
      card.classList.toggle('open', open); head.setAttribute('aria-expanded', open);
      open ? openGroups.add(key) : openGroups.delete(key);
      return;
    }
    const b = e.target.closest('.tc-pin, .tc-chip');
    if (!b || !map) return;
    const id = +b.dataset.id;
    if (b.classList.contains('tc-pin')) {  // "View on map" on a hotel: open the map full screen on that hotel
      if (!TT.$('#tcMapSec').classList.contains('full')) setFull(true);
      selectChip(id); setTimeout(() => map.focus(id), 120);
      return;
    }
    if (chipSel === id) { selectChip(null); map.showAll(); return; }  // tapping the selected chip again shows every hotel
    selectChip(id); map.focus(id);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && TT.$('#tcMapSec.full')) setFull(false); });

  TT.api('/api/public/trips/' + encodeURIComponent(slug)).then(d => { data = d; selection = d.selection || {}; render(); })
    .catch(() => { root.innerHTML = '<p class="tc-load">This trip link is no longer available.</p>'; });
})(window.TT);
