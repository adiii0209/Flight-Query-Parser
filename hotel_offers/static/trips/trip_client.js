/* Trips: public client page. A card per city and dates; a card opens that city's page with the hotel options to pick from.
   The pick is saved on the trip (the agent sees it). The trip total adds up the selected option of every city. */
(function (TT) {
  const slug = document.body.dataset.slug, wa = (document.body.dataset.wa || '').replace(/\D/g, '');
  const root = TT.$('#trip');
  const openCards = new Set();
  let data = null, groups = [], selection = {}, map = null, chipSel = null, savedY = 0, listY = 0, current = null;

  const PIN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.2A7 7 0 0 1 19 9.8C19 14.8 12 21 12 21z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  const CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const EXPAND = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
  const BACK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>';
  const CHEV = '<svg class="cc-chev" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  const cur = () => data.trip.currency;
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const dayDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
  const groupDates = g => g.date ? dayDate(g.date) + (g.checkout ? ' → ' + dayDate(g.checkout) : '') + (g.nights ? ' · ' + plural(g.nights, 'night') : '') : '';

  // ---- one hotel option: photos, details, and its room lines
  function gallery(o, badges) {
    const line = o.lines.find(l => l.photos.length) || o.lines[0];
    if (!line.photos.length) return '<div class="tc-ph tc-ph-none"><span class="tc-ph-l">' + TT.esc((o.hotel_name || '?').slice(0, 1)) + '</span>' + badges + '</div>';
    return '<div class="tc-ph"><div class="tc-strip">' + line.photos.map((u, i) => '<img src="' + u + '" alt="' + TT.esc(o.hotel_name) + ' photo ' + (i + 1) + '" loading="lazy">').join('') + '</div>' + badges +
      (line.photos.length > 1 ? '<span class="tc-count">' + line.photos.length + ' photos</span>' : '') + '</div>';
  }

  const factsHtml = list => '<dl class="tc-facts">' + list.filter(f => f[1]).map(f => '<div><dt>' + f[0] + '</dt><dd>' + TT.esc(f[1]) + '</dd></div>').join('') + '</dl>';
  const lineFacts = l => [['Guests', [l.guests, l.guest_name].filter(Boolean).join(' · ')], ['Meal plan', l.meal_plan], ['Room', [l.room, l.room_size].filter(Boolean).join(' · ')], ['Cancellation', l.cancellation]];
  const rateText = l => plural(TT.roomsOf(l), 'room') + ' × ' + plural(l.nights || 0, 'night') + ' × ' + TT.money(l.cost_per_item, cur());

  const PINICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.2A7 7 0 0 1 19 9.8C19 14.8 12 21 12 21z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  const roomDesc = l => (l.room_desc ? '<p class="tc-roomdesc">' + TT.esc(l.room_desc) + '</p>' : '');

  // star class, style and age: small chips under the hotel name; nothing is drawn for what is empty
  function factsRow(stars, style, age) {
    const parts = [];
    if (stars) parts.push('<span class="tc-chipx tc-starsrow"><span aria-hidden="true">★</span>' + stars + ' star property</span>');
    if (style) parts.push('<span class="tc-chipx">' + TT.esc(style) + '</span>');
    if (age) parts.push('<span class="tc-chipx">' + TT.esc(age) + '</span>');
    return parts.length ? '<div class="tc-chiprow">' + parts.join('') + '</div>' : '';
  }

  // perks look like the ones on the offer posters: a line icon and a short upper-case label
  function perksHtml(perks) {
    if (!perks.length) return '';
    return '<ul class="tc-perks">' + perks.map(p => '<li><span class="pk-ic">' + TT.perkIcon(p.icon) + '</span><span class="pk-tx">' + TT.esc(p.label) + '</span></li>').join('') + '</ul>';
  }

  // Google rating (opens the reviews on Google Maps) and the hotel's own website
  const safeUrl = u => (/^https?:\/\/[^\s<>"']+$/.test(u || '') ? u : '');
  function linksHtml(i) {
    const maps = safeUrl(i.maps_url), site = safeUrl(i.website);
    const rate = (i.rating ? '<b>' + i.rating.toFixed(1) + '</b><span class="tc-stars" aria-hidden="true">★</span>' : '') + (i.rating_count ? '<small>' + i.rating_count.toLocaleString('en-IN') + ' reviews</small>' : '');
    const parts = [];
    if (rate) parts.push(maps ? '<a class="tc-link" href="' + TT.esc(maps) + '" target="_blank" rel="noopener noreferrer" aria-label="Google reviews">' + rate + '<em>Google</em></a>' : '<span class="tc-link">' + rate + '<em>Google</em></span>');
    if (site) parts.push('<a class="tc-link" href="' + TT.esc(site) + '" target="_blank" rel="noopener noreferrer">Hotel website<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg></a>');
    return parts.length ? '<div class="tc-links">' + parts.join('') + '</div>' : '';
  }

  // what the client would pay online for the whole option; 0 unless every room has an online price
  const onlineOf = o => (o.lines.every(l => l.online_total > 0) ? o.lines.reduce((s, l) => s + l.online_total, 0) : 0);
  // "Online deal ₹1,60,000" struck through, then our price under it
  function onlineHtml(o) {
    const on = onlineOf(o);
    if (!(on > o.total)) return '';
    return '<span class="tc-online"><span>Online deal</span><s>' + TT.money(on, cur()) + '</s></span>';
  }
  const saveHtml = o => { const on = onlineOf(o); return on > o.total ? '<em class="tc-save">You save ' + TT.money(on - o.total, cur()) + '</em>' : ''; };

  // all prices are in the trip currency; where the agent gave a local currency rate it is quoted here
  function disclaimerHtml() {
    const rates = new Map();
    data.quotes.forEach(q => { if (q.local_currency && q.local_rate > 0 && q.local_currency !== cur() && !rates.has(q.local_currency)) rates.set(q.local_currency, q.local_rate); });
    const fx = Array.from(rates, ([code, r]) => '1 ' + code + ' = ' + cur() + ' ' + (+r.toFixed(r < 10 ? 4 : 2)).toLocaleString('en-IN')).join(' · ');
    return '<p class="tc-note">All rates are in ' + TT.esc(cur()) + ' and indicative' + (fx ? '. Local currency: ' + TT.esc(fx) : '') + '. Prices are subject to availability and the exchange rate on the day of payment.</p>';
  }

  // side by side: one column per hotel of the city, only the rows that have something to say
  function compareHtml(g) {
    const opts = g.options;
    if (opts.length < 2) return '';
    const first = o => o.lines[0];
    const any = key => o => (o.lines.find(l => l[key]) || {})[key] || '';
    const lowest = Math.min.apply(null, opts.map(o => o.total));
    const rows = [
      ['Class', o => (any('stars')(o) ? any('stars')(o) + ' star' : '')],
      ['Style', any('style')],
      ['Location', any('location_info')],
      ['Room', o => Array.from(new Set(o.lines.map(l => l.room).filter(Boolean))).join(' + ')],
      ['Meal plan', o => first(o).meal_plan || ''],
      ['Cancellation', o => first(o).cancellation || ''],
      ['Google rating', o => { const l = o.lines.find(x => x.rating); return l ? '★ ' + l.rating.toFixed(1) + (l.rating_count ? ' (' + l.rating_count.toLocaleString('en-IN') + ')' : '') : ''; }],
      ['Includes', o => ((o.lines.find(l => (l.perks || []).length) || { perks: [] }).perks.map(p => p.label).join(' · '))],
    ].map(([label, fn]) => [label, opts.map(fn)]).filter(r => r[1].some(Boolean));
    const head = '<tr><th></th>' + opts.map(o => '<th' + (o.key === g.selected ? ' class="sel"' : '') + '><b>' + TT.esc(o.hotel_name) + '</b>' + (o.key === g.selected ? '<i>Selected</i>' : '') + '</th>').join('') + '</tr>';
    const body = rows.map(([label, vals]) => '<tr><th scope="row">' + label + '</th>' + vals.map(v => '<td>' + (v ? TT.esc(v) : '–') + '</td>').join('') + '</tr>').join('');
    const price = '<tr class="cmp-price"><th scope="row">Price</th>' + opts.map(o => '<td>' + (onlineOf(o) > o.total ? '<s>' + TT.money(onlineOf(o), cur()) + '</s>' : '') + '<b>' + TT.money(o.total, cur()) + '</b>' +
      (o.total === lowest ? '<em>Lowest</em>' : '') + saveHtml(o) + '</td>').join('') + '</tr>';
    const pick = '<tr><th></th>' + opts.map(o => '<td>' + (o.key === g.selected ? '<span class="cmp-on">Selected</span>' : '<button type="button" class="co-pick" data-g="' + TT.esc(g.key) + '" data-o="' + TT.esc(o.key) + '">Select</button>') + '</td>').join('') + '</tr>';
    return '<section class="cmp"><h2>Compare hotels</h2><div class="cmp-scroll"><table>' + '<thead>' + head + '</thead><tbody>' + body + price + pick + '</tbody></table></div></section>';
  }

  // the hotel's own landmarks and the lively places picked for its city, nearest first, with the distance when both are on the map
  const kmBetween = (a, b) => { const r = x => x * Math.PI / 180, h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
  function nearbyOf(g, o, hotel) {
    const own = (o.lines.find(l => (l.landmarks || []).length) || { landmarks: [] }).landmarks;
    const all = own.concat(spotsOf(g)), seen = new Set(), out = [];
    all.forEach(p => {
      const k = String(p.name || '').toLowerCase();
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push({ name: p.name, lat: p.lat, lng: p.lng, km: hotel && hotel.lat != null && p.lat != null ? kmBetween(hotel, p) : null });
    });
    out.sort((a, b) => (a.km == null) - (b.km == null) || a.km - b.km);
    return out.slice(0, 4);
  }

  // the hotel card: the same card as before, now shown inside its city card
  function optionHtml(g, o, multi) {
    const isSel = o.key === g.selected;
    const first = o.lines[0], located = o.lines.find(l => l.lat != null), many = o.lines.length > 1;
    const nut = (o.lines.find(l => l.nutshell) || {}).nutshell;
    const near = nearbyOf(g, o, located);
    const info = o.lines.find(l => l.rating || l.rating_count || l.website) || {};
    const hv = key => (o.lines.find(l => l[key]) || {})[key] || '';  // hotel-level details come from the first room that has them
    const perks = (o.lines.find(l => (l.perks || []).length) || { perks: [] }).perks;
    const stay = [['Check-in', g.date ? (first.day ? first.day + ', ' : '') + TT.date(g.date) : ''], ['Check-out', g.checkout ? TT.date(g.checkout) : '']];
    const pick = multi && !isSel ? '<button type="button" class="co-pick" data-g="' + TT.esc(g.key) + '" data-o="' + TT.esc(o.key) + '">Select</button>' : '';
    const badges = multi ? (g.options[0] === o ? '<span class="co-rec">Recommended</span>' : '') + (isSel ? '<span class="co-sel" title="Selected" role="img" aria-label="Selected">' + CHECK + '</span>' : '') : '';
    const details = many
      ? factsHtml(stay) + o.lines.map((l, i) => '<div class="co-room"><div class="co-room-h"><b>Room ' + (i + 1) + '</b><span>' + TT.money(l.total, cur()) + '</span></div>' + factsHtml(lineFacts(l)) + roomDesc(l) + '<small>' + rateText(l) + '</small></div>').join('')
      : factsHtml(stay.concat(lineFacts(first))) + roomDesc(first);
    const ck = g.key + '|' + o.key, open = openCards.has(ck);
    const brief = hv('brief');
    const more = (brief ? '<p class="tc-brief">' + TT.esc(brief) + '</p>' : '') + (nut ? '<p class="tc-nut">' + TT.esc(nut).replace(/\n/g, '<br>') + '</p>' : '') + perksHtml(perks) + details + linksHtml(info) +
      (near.length ? '<p class="tc-near"><b>Nearby:</b> ' + near.map(l => TT.esc(l.name) + (l.km != null ? ' <i>' + (l.km < 1 ? Math.round(l.km * 10) * 100 + ' m' : l.km.toFixed(1) + ' km') + '</i>' : '')).join(' · ') + '</p>' : '') +
      (located ? '<button class="tc-pin" data-id="' + located.id + '">View on map</button>' : '');
    return '<article class="tc-card co' + (isSel && multi ? ' is-sel' : '') + (open ? ' open' : '') + '">' + gallery(o, badges) + '<div class="tc-body"><div class="tc-top"><div><h2>' + TT.esc(o.hotel_name || first.hotel_name) + '</h2>' +
      (first.address ? '<p class="tc-sub">' + TT.esc(first.address) + '</p>' : '') + '</div>' + pick + '</div>' + factsRow(hv('stars'), hv('style'), hv('age_info')) +
      (hv('location_info') ? '<p class="tc-loc">' + PINICON + '<span>' + TT.esc(hv('location_info')) + '</span></p>' : '') +
      '<div class="tc-more" id="more-' + TT.esc(ck.replace(/[^\w-]/g, '_')) + '">' + more + '</div>' +
      '<div class="tc-foot"><div class="tc-price">' + onlineHtml(o) + '<small>' + (many ? 'Our price for ' + plural(o.lines.length, 'room') : first.items > 1 ? rateText(first) : 'Our price') + '</small><b>' + TT.money(o.total, cur()) + '</b>' + saveHtml(o) + '</div>' +
      '<button type="button" class="tc-tog" data-ck="' + TT.esc(ck) + '" aria-expanded="' + open + '"><span>' + (open ? 'Hide details' : 'View details') + '</span>' + CHEV + '</button></div></div></article>';
  }

  // "27–30 Dec · 3 nights": short enough for the city page bar
  function shortDates(g) {
    if (!g.date) return '';
    const a = new Date(g.date + 'T00:00:00'), b = g.checkout ? new Date(g.checkout + 'T00:00:00') : null, m = d => d.toLocaleDateString('en-GB', { month: 'short' });
    const range = !b ? a.getDate() + ' ' + m(a) : a.getMonth() === b.getMonth() ? a.getDate() + '–' + b.getDate() + ' ' + m(b) : a.getDate() + ' ' + m(a) + ' – ' + b.getDate() + ' ' + m(b);
    return range + (g.nights ? ' · ' + plural(g.nights, 'night') : '');
  }

  // ---- city card (list page): taps through to that city's page
  const cityHref = g => '#city/' + encodeURIComponent(g.key);

  function cityCard(g, gi) {
    const multi = g.options.length > 1, sel = g.selectedOption;
    const photo = (sel.lines.find(l => l.photos.length) || { photos: [] }).photos[0];
    const media = photo ? '<img src="' + photo + '" alt="" loading="lazy">' : '<div class="cc-ph"><span>' + TT.esc((g.city || '?').slice(0, 1)) + '</span></div>';
    return '<a class="cc" href="' + cityHref(g) + '" data-g="' + TT.esc(g.key) + '"><div class="cc-media">' + media + '<span class="cg-n">' + (gi + 1) + '</span>' +
      (multi ? '<span class="cc-tag">' + g.options.length + ' options</span>' : '') + '</div>' +
      '<div class="cc-body"><h2>' + TT.esc(g.city || 'Your stay') + '</h2><p class="cc-dates">' + TT.esc(groupDates(g)) + '</p><p class="cc-hotel">' + TT.esc(sel.hotel_name) + '</p></div>' +
      '<div class="cc-price"><b>' + TT.money(sel.total, cur()) + '</b>' + CHEV + '</div></a>';
  }

  // ---- city page: the hotel options for one city and dates
  function cityPage(g, gi) {
    const multi = g.options.length > 1;
    return '<div class="cp-bar"><a class="cp-back" href="#" aria-label="Back to all cities">' + BACK + '</a><div class="cp-mid"><h1>' + TT.esc(g.city || 'Your stay') + '</h1><p>' + TT.esc(shortDates(g)) + '</p></div>' +
      '<b class="cp-amt">' + TT.money(g.selectedOption.total, cur()) + '</b></div>' +
      guideHtml(g, cityPins(g)) + '<div class="cp-opts">' + g.options.map(o => optionHtml(g, o, multi)).join('') + '</div><div id="cmpHost">' + compareHtml(g) + '</div>' + disclaimerHtml();
  }

  // the places the agent picked for this city (the local guide)
  const spotsOf = g => { const e = (data.guide || {})[String(g.city || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 60)]; return e ? e.spots : []; };

  // the one map of the city page: the hotels (chips on the map), the lively areas and a full screen button
  function guideHtml(g, pins) {
    const spots = spotsOf(g);
    if (!spots.length && !pins.length) return '';
    return '<section class="lg tc-mapsec" id="tcMapSec"><div class="lg-h"><h2>' + (spots.length ? 'Location guide' : 'On the map') + '</h2><p>' + (spots.length ? 'The liveliest areas of ' + TT.esc(g.city) + ', picked for you' : 'Your hotels in ' + TT.esc(g.city)) + '</p></div>' +
      '<div class="tc-mapbox"><div class="tc-map" id="tcMap"></div>' +
      '<div class="tc-chips" id="tcChips">' + pins.map(q => '<button type="button" class="tc-chip" data-id="' + q.id + '"><i>' + q.num + '</i>' + TT.esc(q.hotel_name) + '</button>').join('') + '</div>' +
      '<button type="button" class="tc-fs" id="tcFs" aria-label="Full screen">' + EXPAND + '</button></div>' +
      (spots.length ? '<ul class="lg-list">' + spots.map((s, i) => '<li><button type="button" data-spot="' + i + '"><i>' + String.fromCharCode(65 + i) + '</i><span><b>' + TT.esc(s.name) + '</b><small' + (s.blurb ? ' class="lg-bl"' : '') + '>' +
        TT.esc(s.blurb || [s.kind, s.rating ? '★ ' + s.rating.toFixed(1) : ''].filter(Boolean).join(' · ')) + '</small></span></button></li>').join('') + '</ul>' : '') + '</section>';
  }

  // one pin per hotel option of this city, numbered 1, 2, 3 in the order of the cards
  function cityPins(g) {
    const pins = [];
    g.options.forEach((o, oi) => {
      const line = o.lines.find(l => l.lat != null && l.lng != null);
      if (line) pins.push(Object.assign({}, line, { num: oi + 1, hotel_name: o.hotel_name || line.hotel_name, landmarks: o.lines.reduce((a, l) => a.length ? a : (l.landmarks || []), []),
        near_spots: nearbyOf(g, o, line).filter(p => p.lat != null && spotsOf(g).some(s => s.name === p.name)).slice(0, 2) }));
    });
    return pins;
  }

  function summaryHtml() {
    const rows = groups.map((g, gi) => '<li><span><i>' + (gi + 1) + '</i><em>' + TT.esc(g.city || 'Stay') + '</em><small>' + TT.esc(g.selectedOption.hotel_name) + '</small></span><b>' + TT.money(g.selectedOption.total, cur()) + '</b></li>').join('');
    return '<section class="tc-sum"><div class="tc-sum-head"><span>Trip total</span><b>' + TT.money(TT.groupsTotal(groups), cur()) + '</b></div><ul>' + rows + '</ul></section>';
  }

  // ---- map
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
    root.innerHTML = '<div id="viewList"><section class="tc-hero"><p class="eyebrow">Your trip</p><h1>' + TT.esc(t.title) + '</h1><p class="tc-meta">' +
      [t.client_name && 'Prepared for ' + t.client_name, t.destination, dates].filter(Boolean).map(TT.esc).join(' · ') + '</p>' +
      '</section>' +
      '<div class="cc-list" id="ccList"></div><div id="sumHost"></div></div><div id="viewCity" hidden></div>' +
      disclaimerHtml().replace('<p class="tc-note"', '<p class="tc-note" id="tcNote"');
    drawList();
    const a = TT.$('#navWa');
    if (wa) a.href = 'https://wa.me/' + wa + '?text=' + encodeURIComponent('Hi, about my trip: ' + t.title); else a.hidden = true;
    route();
  }

  // the map of the city page you are on (created when the page opens, dropped when you leave it)
  function mountMap(g) {
    const pins = cityPins(g), spots = spotsOf(g);
    chipSel = null;
    if (!(pins.length || spots.length) || !TT.$('#tcMap')) return;
    map = TT.createMap(TT.$('#tcMap'), { onSelect: id => selectChip(id) });
    map.render(pins, spots);
    document.body.insertAdjacentHTML('beforeend', '<button class="tc-fab" id="tcFab" type="button" aria-label="Open map">' + PIN + '<span>Map</span></button>');
    const toggle = () => setFull(!TT.$('#tcMapSec').classList.contains('full'));
    TT.$('#tcFab').addEventListener('click', toggle);
    TT.$('#tcFs').addEventListener('click', toggle);
  }

  function unmountMap() {
    document.documentElement.classList.remove('lock');
    const fab = TT.$('#tcFab');
    if (fab) fab.remove();
    if (map) { map.destroy(); map = null; }
    chipSel = null;
  }

  const drawList = () => { TT.$('#ccList').innerHTML = groups.map(cityCard).join(''); TT.$('#sumHost').innerHTML = summaryHtml(); };

  // ---- routing: "#" is the list of cities, "#city/<key>" a city's page (the browser's back button works)
  function route() {
    const m = location.hash.match(/^#city\/(.+)$/), key = m ? decodeURIComponent(m[1]) : null;
    const gi = key ? groups.findIndex(g => g.key === key) : -1;
    const list = TT.$('#viewList'), city = TT.$('#viewCity');
    document.body.classList.toggle('in-city', gi >= 0);
    if (gi < 0) {
      current = null; unmountMap(); city.hidden = true; city.innerHTML = ''; list.hidden = false;
      window.scrollTo({ top: listY, behavior: 'instant' });
      return;
    }
    if (current === null) listY = window.scrollY || listY;
    else unmountMap();
    current = key; list.hidden = true; city.hidden = false;
    city.innerHTML = cityPage(groups[gi], gi);
    mountMap(groups[gi]);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  window.addEventListener('hashchange', route);

  // re-draw what depends on the selection (the city page you are on, the city cards and the trip total)
  function refresh() {
    groups = TT.groupQuotes(data.quotes, selection);
    drawList();
    if (current !== null) {
      const g = groups.find(x => x.key === current), y = window.scrollY;
      if (g) {
        TT.$('.cp-amt').textContent = TT.money(g.selectedOption.total, cur());
        TT.$('.cp-opts').innerHTML = g.options.map(o => optionHtml(g, o, g.options.length > 1)).join('');
        TT.$('#cmpHost').innerHTML = compareHtml(g);
        window.scrollTo({ top: y, behavior: 'instant' });
      }
    }
  }

  async function choose(groupKey, optionKey) {
    const before = Object.assign({}, selection);
    selection[groupKey] = optionKey; refresh();
    try {
      const r = await TT.api('/api/public/trips/' + encodeURIComponent(slug) + '/select', { method: 'POST', json: { group: groupKey, option: optionKey } });
      selection = r.selection;
    } catch (err) {
      selection = before; refresh(); TT.toast(err.message || 'Could not save your choice', 'err');
    }
  }

  root.addEventListener('click', e => {
    const spot = e.target.closest('[data-spot]');
    if (spot) { if (map) { selectChip(null); map.focusSpot(+spot.dataset.spot); TT.$('#tcMap').scrollIntoView({ block: 'center', behavior: 'smooth' }); } return; }
    const tog = e.target.closest('.tc-tog');
    if (tog) {
      const card = tog.closest('.co'), on = !card.classList.contains('open');
      card.classList.toggle('open', on); tog.setAttribute('aria-expanded', on); tog.firstChild.textContent = on ? 'Hide details' : 'View details';
      if (on) openCards.add(tog.dataset.ck); else openCards.delete(tog.dataset.ck);
      return;
    }
    const pick = e.target.closest('.co-pick');
    if (pick) { if (!pick.classList.contains('on')) choose(pick.dataset.g, pick.dataset.o); return; }
    if (e.target.closest('.cc')) { listY = window.scrollY; return; }  // remember where the list was; the link itself changes the page
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
