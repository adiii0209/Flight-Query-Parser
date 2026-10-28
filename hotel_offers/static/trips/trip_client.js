/* Trips: public client page. A card per city and dates; a card opens that city's page with the hotel options to pick from.
   The pick is saved on the trip (the agent sees it). The trip total adds up the selected option of every city. */
(function (TT) {
  const slug = document.body.dataset.slug, wa = (document.body.dataset.wa || '').replace(/\D/g, '');
  const root = TT.$('#trip');
  const openCards = new Set();
  let inCart = false, cartNote = '', guideOpen = false, data = null, groups = [], selection = {}, map = null, chipSel = null, savedY = 0, listY = 0, current = null, sheetOn = false, snap = 'half', sheetTop = 0, noTap = false;

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
    const fromOf = o => (o.lines.length > 1 ? Math.min.apply(null, o.lines.map(unitOf)) : o.total), lowest = Math.min.apply(null, opts.map(fromOf));
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
    const price = '<tr class="cmp-price"><th scope="row">Price</th>' + opts.map(o => o.lines.length > 1 ? '<td><b>From ' + TT.money(fromOf(o), cur()) + '</b>' + (fromOf(o) === lowest ? '<em>Lowest</em>' : '') + '<small class="cmp-sm">per room</small></td>' : '<td>' + (onlineOf(o) > o.total ? '<s>' + TT.money(onlineOf(o), cur()) + '</s>' : '') + '<b>' + TT.money(o.total, cur()) + '</b>' +
      (o.total === lowest ? '<em>Lowest</em>' : '') + saveHtml(o) + '</td>').join('') + '</tr>';
    const pick = '<tr><th></th>' + opts.map(o => '<td>' + (o.key === g.selected ? '<button type="button" class="cmp-tick co-un" data-g="' + TT.esc(g.key) + '" title="Selected. Tap to unselect" aria-label="Selected. Tap to unselect">' + CHECK + '</button>' : '<button type="button" class="co-pick" data-g="' + TT.esc(g.key) + '" data-o="' + TT.esc(o.key) + '">Select</button>') + '</td>').join('') + '</tr>';
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
  // several room categories: "From" the cheapest room until the guest has picked rooms, then what was picked
  function priceHtml(g, o, isSel, many, first) {
    const so = isSel ? g.selectedOption : o;
    if (isSel && so.qty) {
      return '<small>' + TT.esc(TT.qtyText(so) || 'Rooms') + '</small><b>' + TT.money(so.total, cur()) + '</b>';
    }
    if (many) return '<small>' + o.lines.length + ' room categories' + ' · pick your rooms</small><b>From ' + TT.money(Math.min.apply(null, o.lines.map(unitOf)), cur()) + '</b>';
    return onlineHtml(o) + '<small>' + (first.items > 1 ? rateText(first) : 'Our price') + '</small><b>' + TT.money(o.total, cur()) + '</b>' + saveHtml(o);
  }
  function optionHtml(g, o, multi) {
    const isSel = o.key === g.selected;
    const first = o.lines[0], located = o.lines.find(l => l.lat != null), many = o.lines.length > 1;
    const nut = (o.lines.find(l => l.nutshell) || {}).nutshell;
    const near = nearbyOf(g, o, located);
    const info = o.lines.find(l => l.rating || l.rating_count || l.website) || {};
    const hv = key => (o.lines.find(l => l[key]) || {})[key] || '';  // hotel-level details come from the first room that has them
    const perks = (o.lines.find(l => (l.perks || []).length) || { perks: [] }).perks;
    const stay = [['Check-in', g.date ? (first.day ? first.day + ', ' : '') + TT.date(g.date) : ''], ['Check-out', g.checkout ? TT.date(g.checkout) : '']];
    const pick = '<button type="button" class="co-pick' + (isSel ? ' co-chg' : '') + '" data-g="' + TT.esc(g.key) + '" data-o="' + TT.esc(o.key) + '">' + (isSel ? 'Change rooms' : 'Select') + '</button>';
    const badges = (multi && g.options[0] === o ? '<span class="co-rec">Recommended</span>' : '') + (isSel ? '<button type="button" class="co-sel co-un" data-g="' + TT.esc(g.key) + '" title="Selected. Tap to unselect" aria-label="Selected. Tap to unselect">' + CHECK + '</button>' : '');
    const details = many
      ? factsHtml(stay) + o.lines.map((l, i) => '<div class="co-room"><div class="co-room-h"><b>' + TT.esc(l.room || 'Room ' + (i + 1)) + '</b><span>' + TT.money(l.total, cur()) + '</span></div>' + factsHtml(lineFacts(l)) + roomDesc(l) + '<small>' + rateText(l) + '</small></div>').join('')
      : factsHtml(stay.concat(lineFacts(first))) + roomDesc(first);
    const roomBtn = '<button type="button" class="rs-change rs-in" data-g="' + TT.esc(g.key) + '" data-o="' + TT.esc(o.key) + '">' + (isSel ? 'Change rooms' : many ? 'Choose rooms' : 'Add rooms') + '</button>';
    const ck = g.key + '|' + o.key, open = openCards.has(ck);
    const brief = hv('brief');
    const more = (first.address ? '<p class="tc-sub">' + TT.esc(first.address) + '</p>' : '') + (brief ? '<p class="tc-brief">' + TT.esc(brief) + '</p>' : '') + (nut ? '<p class="tc-nut">' + TT.esc(nut).replace(/\n/g, '<br>') + '</p>' : '') + perksHtml(perks) + details + roomBtn + linksHtml(info) +
      (located ? '<button class="tc-pin" data-id="' + located.id + '">View on map</button>' : '');
    return '<article class="tc-card co' + (isSel ? ' is-sel' : '') + (open ? ' open' : '') + '">' + gallery(o, badges) + '<div class="tc-body"><div class="tc-top"><div><h2>' + TT.esc(o.hotel_name || first.hotel_name) + '</h2>' +
      '</div>' + pick + '</div>' + factsRow(hv('stars'), hv('style'), hv('age_info')) +
      (near.length ? '<p class="tc-loc">' + PINICON + '<span>' + near.slice(0, 2).map(l => '<b>' + TT.esc(l.name) + '</b>' + (l.km != null ? ' <i>' + (l.km < 1 ? Math.round(l.km * 10) * 100 + ' m' : l.km.toFixed(1) + ' km') + '</i>' : '')).join(' · ') + '</span></p>' : '') +
      '<div class="tc-foot"><div class="tc-price">' + priceHtml(g, o, isSel, many, first) + '</div>' +
      '<button type="button" class="tc-tog" data-ck="' + TT.esc(ck) + '" aria-expanded="' + open + '"><span>' + (open ? 'Hide details' : 'View details') + '</span>' + CHEV + '</button></div>' +
      '<div class="tc-more" id="more-' + TT.esc(ck.replace(/[^\w-]/g, '_')) + '">' + more + '</div></div></article>';
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
    const multi = g.options.length > 1, sel = g.selectedOption, shown = sel || g.options[0];
    const photo = (shown.lines.find(l => l.photos.length) || { photos: [] }).photos[0];
    const media = photo ? '<img src="' + photo + '" alt="" loading="lazy">' : '<div class="cc-ph"><span>' + TT.esc((g.city || '?').slice(0, 1)) + '</span></div>';
    return '<a class="cc" href="' + cityHref(g) + '" data-g="' + TT.esc(g.key) + '"><div class="cc-media">' + media + '<span class="cg-n">' + (gi + 1) + '</span>' +
      (multi ? '<span class="cc-tag">' + g.options.length + ' options</span>' : '') + '</div>' +
      '<div class="cc-body"><h2>' + TT.esc(g.city || 'Your stay') + '</h2><p class="cc-dates">' + TT.esc(groupDates(g)) + '</p><p class="cc-hotel">' + TT.esc(sel ? sel.hotel_name : multi ? g.options.length + ' hotels to choose from' : 'Choose your hotel') + '</p></div>' +
      '<div class="cc-price">' + (sel ? '<b>' + TT.money(sel.total, cur()) + '</b>' : '<span class="cc-choose">Choose</span>') + CHEV + '</div></a>';
  }

  // ---- city page: the hotel options for one city and dates
  const amtOf = g => (g.selectedOption ? TT.money(g.selectedOption.total, cur()) : '');
  function cityPage(g, gi) {
    const multi = g.options.length > 1, pins = cityPins(g), spots = spotsOf(g);
    sheetOn = window.matchMedia('(max-width:640px)').matches && !!(pins.length || spots.length);  // a phone gets the map with a bottom sheet
    const bar = '<div class="cp-bar"><a class="cp-back" href="#" aria-label="Back to all cities">' + BACK + '</a><div class="cp-mid"><h1>' + TT.esc(g.city || 'Your stay') + '</h1><p>' + TT.esc(shortDates(g)) + '</p></div>' +
      '<b class="cp-amt">' + amtOf(g) + '</b>' + cartBtn('in-bar') + '</div>';
    const rest = '<div class="cp-opts">' + g.options.map(o => optionHtml(g, o, multi)).join('') + '</div><div id="cmpHost">' + compareHtml(g) + '</div>' + disclaimerHtml();
    if (!sheetOn) return bar + guideHtml(g, pins) + rest;
    const title = pins.length + (pins.length === 1 ? ' hotel' : ' hotels') + (spots.length ? ' · ' + spots.length + (spots.length === 1 ? ' area' : ' areas') + ' to explore' : '');
    return bar + '<section class="tc-mapsec" id="tcMapSec">' + mapBox(pins) + '</section>' +
      '<div class="cp-sheet" id="cpSheet"><div class="sh-head" id="shHead"><i class="sh-bar"></i><p class="sh-t">' + title + '</p></div><div class="sh-in" id="shIn">' +
      (spots.length ? '<section class="lg' + (guideOpen ? ' open' : '') + '">' + guideHead(g, spots) + guideList(spots) + '</section>' : '') + rest + '</div></div>';
  }

  // the places the agent picked for this city (the local guide)
  const spotsOf = g => { const e = (data.guide || {})[String(g.city || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 60)]; return e ? e.spots : []; };

  // the one map of the city page: the hotels (chips on the map), the lively areas and a full screen button
  const guideHead = (g, spots) => '<div class="lg-h"><div><h2>' + (spots.length ? 'Location guide' : 'On the map') + '</h2><p>' + (spots.length ? 'The liveliest areas of ' + TT.esc(g.city) + ', picked for you' : 'Your hotels in ' + TT.esc(g.city)) + '</p></div>' +
    (spots.length ? '<button type="button" class="lg-tg" aria-expanded="' + guideOpen + '"><span>' + (guideOpen ? 'Hide places' : spots.length + (spots.length === 1 ? ' place' : ' places')) + '</span>' + CHEV + '</button>' : '') + '</div>';
  const mapBox = pins => '<div class="tc-mapbox"><div class="tc-map" id="tcMap"></div>' +
    '<div class="tc-chips" id="tcChips">' + pins.map(q => '<button type="button" class="tc-chip" data-id="' + q.id + '"><i>' + q.num + '</i>' + TT.esc(q.hotel_name) + '</button>').join('') + '</div>' +
    '<button type="button" class="tc-fs" id="tcFs" aria-label="Full screen">' + EXPAND + '</button></div>';
  const guideList = spots => '<ul class="lg-list">' + spots.map((s, i) => '<li><button type="button" data-spot="' + i + '"><i>' + String.fromCharCode(65 + i) + '</i><span><b>' + TT.esc(s.name) + '</b><small' + (s.blurb ? ' class="lg-bl"' : '') + '>' +
    TT.esc(s.blurb || [s.kind, s.rating ? '★ ' + s.rating.toFixed(1) : ''].filter(Boolean).join(' · ')) + '</small></span></button></li>').join('') + '</ul>';
  function guideHtml(g, pins) {
    const spots = spotsOf(g);
    if (!spots.length && !pins.length) return '';
    return '<section class="lg tc-mapsec' + (guideOpen ? ' open' : '') + '" id="tcMapSec">' + guideHead(g, spots) + mapBox(pins) + (spots.length ? guideList(spots) : '') + '</section>';
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
    const rows = groups.map((g, gi) => '<li><span><i>' + (gi + 1) + '</i><em>' + TT.esc(g.city || 'Stay') + '</em><small>' + TT.esc(g.selectedOption ? g.selectedOption.hotel_name : 'Not chosen yet') + '</small></span>' + (g.selectedOption ? '<b>' + TT.money(g.selectedOption.total, cur()) + '</b>' : '') + '</li>').join('');
    const done = groups.filter(g => g.selectedOption).length;
    return '<section class="tc-sum"><div class="tc-sum-head"><span>' + (done === groups.length ? 'Trip total' : 'Cart total · ' + done + ' of ' + groups.length + ' cities') + '</span>' + (done ? '<b>' + TT.money(TT.groupsTotal(groups), cur()) + '</b>' : '<small>Choose a hotel in each city to see your total · ' + done + ' of ' + groups.length + ' chosen</small>') + '</div><ul>' + rows + '</ul>' +
      '<button type="button" class="tc-checkout" id="tcCheckout"' + (done ? '' : ' disabled') + '>' + (done ? 'View cart & checkout' : 'Choose a hotel to start your cart') + '</button></section>';
  }

  // ---- map
  function selectChip(id) {
    chipSel = id;
    TT.$$('.tc-chip').forEach(c => c.classList.toggle('on', id !== null && +c.dataset.id === id));
    const on = TT.$('.tc-chip.on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }

  function setFull(full) {
    if (sheetOn) return setSnap(full ? 'peek' : 'half', { fit: false });
    const sec = TT.$('#tcMapSec'), fab = TT.$('#tcFab');
    if (full && !sec.classList.contains('full')) savedY = window.scrollY;
    if (full) { sec.classList.add('full'); document.documentElement.classList.add('lock'); } else { sec.classList.remove('full'); document.documentElement.classList.remove('lock'); }
    fab.innerHTML = (full ? CLOSE + '<span>Close map</span>' : PIN + '<span>Map</span>');
    fab.setAttribute('aria-label', full ? 'Close map' : 'Open map');
    fab.classList.toggle('over', full);
    TT.$('#tcFs').innerHTML = full ? CLOSE : EXPAND;
    TT.$('#tcFs').setAttribute('aria-label', full ? 'Exit full screen' : 'Full screen');
    map.drag(full);  // on a phone the small map lets the page scroll; full screen can be dragged
    setTimeout(() => map.resize(), 60);
    if (!full) window.scrollTo({ top: savedY, behavior: 'instant' });  // back to exactly where you were, not down to the map
  }

  // ---- phone: the map fills the screen and the hotels sit in a bottom sheet that is dragged between three heights
  function snapTops() {
    const H = window.innerHeight, bar = TT.$('.cp-bar').offsetHeight;
    return { H, bar, full: bar + 8, half: Math.round(Math.max(bar + 140, H * 0.5)), peek: H - TT.$('#shHead').offsetHeight };
  }
  function setSnap(name, o) {
    o = o || {};
    const sh = TT.$('#cpSheet'), t = snapTops();
    if (!sh) return;
    snap = name; sheetTop = t[name];
    sh.classList.toggle('drag', !!o.instant); sh.classList.toggle('is-full', name === 'full');
    sh.style.top = sheetTop + 'px';
    const fab = TT.$('#tcFab');
    if (fab) fab.classList.toggle('hide', name === 'peek');
    if (map) map.setInset(t.H - (name === 'full' ? t.half : sheetTop), o.fit !== false);
    if (name !== 'full') TT.$('#shIn').scrollTop = 0;
  }
  function bindSheet() {
    const sh = TT.$('#cpSheet'), inn = TT.$('#shIn');
    let g = null;
    sh.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) { g = null; return; }
      const y = e.touches[0].clientY;
      g = { y, top: sheetTop, ly: y, lt: e.timeStamp, v: 0, drag: false, head: !!e.target.closest('#shHead'), t: snapTops() };
    }, { passive: true });
    sh.addEventListener('touchmove', e => {
      if (!g) return;
      const y = e.touches[0].clientY;
      if (!g.drag) {
        const dy = y - g.y;
        if (Math.abs(dy) < 6) return;
        if (!(g.head || snap !== 'full' || (inn.scrollTop <= 0 && dy > 0))) { g = null; return; }  // the list scrolls by itself when the sheet is all the way up
        g.drag = true; g.y = y; g.top = sheetTop; sh.classList.add('drag');
      }
      e.preventDefault();
      const dt = e.timeStamp - g.lt;
      if (dt > 0) { g.v = 0.8 * g.v + 0.2 * ((y - g.ly) / dt); g.ly = y; g.lt = e.timeStamp; }
      sheetTop = Math.min(Math.max(g.top + (y - g.y), g.t.full), g.t.peek);
      sh.style.top = sheetTop + 'px';
    }, { passive: false });
    const end = () => {
      if (!g || !g.drag) { g = null; return; }
      const t = g.t, v = g.v, names = ['full', 'half', 'peek'];
      let pick;
      if (Math.abs(v) > 0.5) {  // a flick moves to the next height in its direction
        const cand = names.filter(n => (v < 0 ? t[n] < sheetTop - 24 : t[n] > sheetTop + 24)).sort((a, b) => Math.abs(t[a] - sheetTop) - Math.abs(t[b] - sheetTop));
        pick = cand[0] || (v < 0 ? 'full' : 'peek');
      } else {
        const to = sheetTop + v * 160;
        pick = names.sort((a, b) => Math.abs(t[a] - to) - Math.abs(t[b] - to))[0];
      }
      g = null; noTap = true; setTimeout(() => { noTap = false; }, 350);
      sh.classList.remove('drag');
      setSnap(pick);
    };
    sh.addEventListener('touchend', end); sh.addEventListener('touchcancel', end);
    TT.$('#shHead').addEventListener('click', () => { if (!noTap) setSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'half'); });
  }
  window.addEventListener('resize', () => { if (sheetOn && TT.$('#cpSheet') && !TT.$('#cpSheet').classList.contains('drag')) { document.documentElement.style.setProperty('--bar', TT.$('.cp-bar').offsetHeight + 'px'); setSnap(snap, { instant: true, fit: false }); } });

  function render() {
    const t = data.trip, dates = t.start_date ? TT.date(t.start_date) + (t.end_date ? ' – ' + TT.date(t.end_date) : '') : '';
    groups = TT.groupQuotes(data.quotes, selection);
    root.innerHTML = '<div id="viewList"><section class="tc-hero"><p class="eyebrow">Your trip</p><h1>' + TT.esc(t.title) + '</h1><p class="tc-meta">' +
      [t.client_name && 'Prepared for ' + t.client_name, t.destination, dates].filter(Boolean).map(TT.esc).join(' · ') + '</p>' +
      '</section>' +
      '<div class="cc-list" id="ccList"></div><div id="sumHost"></div></div><div id="viewCity" hidden></div>' +
      disclaimerHtml().replace('<p class="tc-note"', '<p class="tc-note" id="tcNote"');
    drawList();
    const navIn = TT.$('.nav-in');
    if (navIn && !TT.$('#navCart')) { navIn.insertAdjacentHTML('beforeend', cartBtn('in-nav').replace('<a ', '<a id="navCart" ')); }
    const a = TT.$('#navWa');
    if (wa) a.href = 'https://wa.me/' + wa + '?text=' + encodeURIComponent('Hi, about my trip: ' + t.title); else a.hidden = true;
    route();
  }

  // the map of the city page you are on (created when the page opens, dropped when you leave it)
  function mountMap(g) {
    const pins = cityPins(g), spots = spotsOf(g);
    chipSel = null;
    if (!(pins.length || spots.length) || !TT.$('#tcMap')) return;
    if (sheetOn) {
      document.body.classList.add('has-sheet'); document.documentElement.classList.add('lock');
      document.documentElement.style.setProperty('--bar', TT.$('.cp-bar').offsetHeight + 'px');
    }
    map = TT.createMap(TT.$('#tcMap'), { mini: !sheetOn, onSelect: id => { if (sheetOn && snap === 'full') setSnap('half', { fit: false }); selectChip(id); } });
    if (sheetOn) { const t = snapTops(); map.setInset(t.H - t.half, false); }
    map.render(pins, spots);
    document.body.insertAdjacentHTML('beforeend', '<button class="tc-fab" id="tcFab" type="button" aria-label="Open map">' + PIN + '<span>Map</span></button>');
    if (sheetOn) { bindSheet(); setSnap('half', { instant: true, fit: false }); }
    const toggle = () => (sheetOn ? setSnap(snap === 'peek' ? 'half' : 'peek') : setFull(!TT.$('#tcMapSec').classList.contains('full')));
    TT.$('#tcFab').addEventListener('click', toggle);
    TT.$('#tcFs').addEventListener('click', toggle);
  }

  function unmountMap() {
    document.documentElement.classList.remove('lock'); document.body.classList.remove('has-sheet'); sheetOn = false;
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
    const wasCart = inCart;
    inCart = location.hash === '#cart';
    document.body.classList.toggle('in-city', gi >= 0 || inCart);
    document.body.classList.toggle('in-cart', inCart);
    if (inCart) {
      if (current === null && !wasCart) listY = window.scrollY || listY;
      else if (current !== null) unmountMap();
      current = null; list.hidden = true; city.hidden = false; city.innerHTML = cartPage();
      const tt = TT.$('#tcCartToast'); if (tt) tt.classList.remove('show');
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    if (gi < 0) {
      current = null; unmountMap(); city.hidden = true; city.innerHTML = ''; list.hidden = false;
      window.scrollTo({ top: listY, behavior: 'instant' });
      return;
    }
    if (current === null && !wasCart) listY = window.scrollY || listY;
    else if (current !== null) unmountMap();
    current = key; list.hidden = true; city.hidden = false;
    city.innerHTML = cityPage(groups[gi], gi);
    mountMap(groups[gi]);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  window.addEventListener('hashchange', route);

  // re-draw what depends on the selection (the city page you are on, the city cards and the trip total)
  // an opened card closes by itself once it has scrolled completely out of view; when it is above the screen the page is moved back by the height it gave up, so nothing shifts
  let cardIO = null;
  function setCard(card, on) {
    const tog = card.querySelector('.tc-tog');
    card.classList.toggle('open', on); tog.setAttribute('aria-expanded', on); tog.firstChild.textContent = on ? 'Hide details' : 'View details';
    if (on) openCards.add(tog.dataset.ck); else openCards.delete(tog.dataset.ck);
  }
  function autoClose(card, above) {
    const anchor = TT.$('#cmpHost'), box = sheetOn ? TT.$('#shIn') : null, before = anchor ? anchor.getBoundingClientRect().top : 0;
    setCard(card, false);
    if (above && anchor) { const shift = before - anchor.getBoundingClientRect().top; if (box) box.scrollTop -= shift; else window.scrollBy({ top: -shift, behavior: 'instant' }); }
  }
  // iOS Safari stops its scroll momentum when the page is moved from script, so the closing waits until the scrolling has settled
  const pendingClose = new Set();
  let idleT = 0;
  const viewTop = () => (sheetOn ? TT.$('#shIn').getBoundingClientRect().top : 0);
  function flushClose() {
    pendingClose.forEach(card => {
      pendingClose.delete(card);
      if (!card.isConnected || !card.classList.contains('open')) return;
      const r = card.getBoundingClientRect(), top = viewTop();
      if (r.bottom > top && r.top < window.innerHeight) return;  // it came back into view meanwhile
      autoClose(card, r.bottom <= top);
    });
  }
  const settle = () => { clearTimeout(idleT); if (pendingClose.size) idleT = setTimeout(flushClose, 200); };
  window.addEventListener('scroll', settle, { passive: true, capture: true });
  window.addEventListener('touchend', settle, { passive: true });
  function watchCard(card) {
    if (!cardIO) cardIO = new IntersectionObserver(list => list.forEach(en => {
      const c = en.target;
      if (en.isIntersecting) { pendingClose.delete(c); return; }
      if (!c.isConnected || !c.classList.contains('open')) { cardIO.unobserve(c); pendingClose.delete(c); return; }
      if (sheetOn && snap === 'peek') return;  // the sheet is only pulled down to look at the map
      pendingClose.add(c); settle();
    }));
    cardIO.observe(card);
  }
  function refresh() {
    groups = TT.groupQuotes(data.quotes, selection);
    drawList(); cartBadges(); drawCart();
    if (current !== null) {
      const g = groups.find(x => x.key === current), y = window.scrollY;
      if (g) {
        TT.$('.cp-amt').textContent = amtOf(g);
        TT.$('.cp-opts').innerHTML = g.options.map(o => optionHtml(g, o, g.options.length > 1)).join('');
        TT.$('#cmpHost').innerHTML = compareHtml(g);
        window.scrollTo({ top: y, behavior: 'instant' });
        TT.$$('.cp-opts .co.open').forEach(watchCard);
      }
    }
  }

  // ---- room categories: Select on a hotel with several of them opens this sheet (+ / − per category, then Confirm)
  let rs = null;
  const priceOf = (l, k) => Math.round((l.total || 0) / TT.roomsOf(l) * k);
  const unitOf = l => priceOf(l, 1);
  function roomSheetHtml() {
    const { g, o, qty } = rs;
    let total = 0, n = 0;
    const rows = o.lines.map((l, i) => {
      const r = TT.roomsOf(l), k = qty[l.id] || 0, meta = [l.room_size, l.meal_plan, l.cancellation].filter(Boolean).join(' · ');
      total += priceOf(l, k); n += k;
      return '<li class="rs-row' + (k ? ' on' : '') + '"><div class="rs-i"><b>' + TT.esc(l.room || 'Room ' + (i + 1)) + '</b>' + (meta ? '<small>' + TT.esc(meta) + '</small>' : '') +
        '<em>' + TT.money(unitOf(l), cur()) + ' per room' + (l.nights ? ' for ' + plural(l.nights, 'night') : '') + '</em></div>' +
        '<div class="rs-step"><button type="button" data-rs="-" data-id="' + l.id + '" aria-label="Fewer ' + TT.esc(l.room || 'rooms') + '"' + (k <= 0 ? ' disabled' : '') + '>−</button><span aria-live="polite">' + k +
        '</span><button type="button" data-rs="+" data-id="' + l.id + '" aria-label="More ' + TT.esc(l.room || 'rooms') + '"' + (k >= TT.roomCap(l) ? ' disabled' : '') + '>+</button></div></li>';
    });
    return '<div class="rs-h"><div><b>Choose your rooms</b><small>' + TT.esc(o.hotel_name) + ' · ' + TT.esc(g.city || '') + '</small></div><button type="button" class="rs-x" aria-label="Close">' + CLOSE + '</button></div>' +
      '<ul class="rs-list">' + rows.join('') + '</ul><div class="rs-f"><div><small>' + (n ? plural(n, 'room') : 'Pick at least one room') + '</small><b>' + TT.money(total, cur()) + '</b></div>' +
      '<button type="button" class="rs-ok"' + (n ? '' : ' disabled') + '>' + (rs.had ? 'Update rooms' : 'Confirm') + '</button></div>';
  }
  function openRooms(g, o) {
    const cur0 = g.selectedOption && g.selected === o.key ? g.selectedOption : null, qty = {};
    o.lines.forEach(l => { qty[l.id] = cur0 ? (cur0.qty ? cur0.qty[l.id] || 0 : TT.roomsOf(l)) : (o.lines.length === 1 ? TT.roomsOf(l) : 0); });
    rs = { g, o, qty, had: !!cur0 };
    let dlg = TT.$('#rsDlg');
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.id = 'rsDlg'; dlg.className = 'rs';
      document.body.appendChild(dlg);
      dlg.addEventListener('close', () => { rs = null; });
      dlg.addEventListener('click', e => {
        if (e.target === dlg || e.target.closest('.rs-x')) { dlg.close(); return; }
        const st = e.target.closest('[data-rs]');
        if (st && rs) {
          const l = rs.o.lines.find(x => String(x.id) === st.dataset.id);
          rs.qty[l.id] = Math.max(0, Math.min(TT.roomCap(l), (rs.qty[l.id] || 0) + (st.dataset.rs === '+' ? 1 : -1)));
          dlg.innerHTML = roomSheetHtml();
          return;
        }
        if (e.target.closest('.rs-ok') && rs) { const { g: gg, o: oo, qty: q } = rs; dlg.close(); choose(gg.key, oo.key, q); }
      });
    }
    dlg.innerHTML = roomSheetHtml();
    dlg.showModal();
  }
  function startSelect(gk, ok) {
    const g = groups.find(x => x.key === gk), o = g && g.options.find(x => x.key === ok);
    if (!o) return;
    openRooms(g, o);
  }

  // ---- cart: choosing a hotel adds it to the cart (a toast at the top right); Checkout sends the whole selection to the agent
  const CART = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.2a1 1 0 0 0 1-.8L19 8H6"/><circle cx="9.5" cy="19" r="1.3"/><circle cx="16.5" cy="19" r="1.3"/></svg>';
  let cartT = 0;
  function cartToast(title, sub, view) {
    let el = TT.$('#tcCartToast');
    if (!el) { el = document.createElement('div'); el.id = 'tcCartToast'; el.setAttribute('role', 'status'); document.body.appendChild(el); el.addEventListener('click', e => { if (e.target.closest('.ct-go')) viewCart(); }); }
    el.innerHTML = '<span class="ct-ic">' + CART + '</span><div><b>' + TT.esc(title) + '</b>' + (sub ? '<small>' + TT.esc(sub) + '</small>' : '') + '</div>' + (view ? '<button type="button" class="ct-go">View cart</button>' : '');
    el.classList.add('show');
    clearTimeout(cartT); cartT = setTimeout(() => el.classList.remove('show'), 4200);
  }
  function viewCart() {
    const el = TT.$('#tcCartToast'); if (el) el.classList.remove('show');
    location.hash = '#cart';
  }
  function checkout() {
    const lines = groups.filter(g => g.selectedOption).map((g, i) => (i + 1) + '. ' + (g.city || 'Stay') + ' (' + groupDates(g) + '): ' + g.selectedOption.hotel_name + (TT.qtyText(g.selectedOption) ? ' - ' + TT.qtyText(g.selectedOption) : '') + ' - ' + TT.money(g.selectedOption.total, cur()));
    const msg = 'Hi, I would like to book this trip: ' + data.trip.title + '\n' + lines.join('\n') + '\nTotal: ' + TT.money(TT.groupsTotal(groups), cur()) + (cartNote.trim() ? '\nNote: ' + cartNote.trim() : '');
    if (wa) { window.open('https://wa.me/' + wa + '?text=' + encodeURIComponent(msg), '_blank', 'noopener'); return; }
    cartToast('Your choices are saved', 'Your travel agent can see them on this trip.', false);
  }

  // ---- the cart page: everything chosen, with room steppers, remove and a bill
  const TRASH = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3"/></svg>';
  const chosenGroups = () => groups.filter(g => g.selectedOption);
  // rooms taken in a chosen hotel: { line, k }; a hotel chosen before room counts existed takes every quoted room
  const takenOf = g => g.selectedOption.lines.map(l => ({ l, k: g.selectedOption.qty ? g.selectedOption.qty[l.id] || 0 : TT.roomsOf(l) })).filter(x => x.k > 0);
  const roomCount = () => chosenGroups().reduce((n, g) => n + takenOf(g).reduce((a, x) => a + x.k, 0), 0);
  const onlineLine = (l, k) => Math.round(l.online_total / TT.roomsOf(l) * k);
  function cartBadges() {
    const n = chosenGroups().length;
    TT.$$('.cart-n').forEach(b => { b.textContent = n; b.hidden = !n; });
  }
  const cartBtn = cls => '<a class="cart-btn ' + cls + '" href="#cart" aria-label="Cart">' + CART + '<i class="cart-n"' + (chosenGroups().length ? '' : ' hidden') + '>' + chosenGroups().length + '</i></a>';

  function cartPage() {
    const items = chosenGroups(), cu = cur();
    const bar = '<div class="cp-bar ca-bar"><a class="cp-back" href="#" aria-label="Back">' + BACK + '</a><div class="cp-mid"><h1>Your cart</h1><p>' + (items.length ? plural(items.length, 'hotel') + ' · ' + plural(roomCount(), 'room') : 'Nothing added yet') + '</p></div></div>';
    if (!items.length) {
      return bar + '<div class="ca-empty"><span class="ca-empty-ic">' + CART + '</span><h2>Your cart is empty</h2><p>Pick a hotel for any city and it will show up here.</p><a class="tc-checkout ca-browse" href="#">Browse hotels</a></div>';
    }
    let total = 0, online = 0, save = 0;
    const cards = items.map(g => {
      const so = g.selectedOption, taken = takenOf(g), photo = (so.lines.find(l => l.photos.length) || { photos: [] }).photos[0];
      const sub = taken.reduce((a, x) => a + priceOf(x.l, x.k), 0), allOn = taken.every(x => x.l.online_total > 0), on = allOn ? taken.reduce((a, x) => a + onlineLine(x.l, x.k), 0) : 0;
      total += sub; if (on > sub) { online += on; save += on - sub; } else online += sub;
      const rows = taken.map(x => '<div class="ca-line"><div class="ca-li"><b>' + TT.esc(x.l.room || 'Room') + '</b><small>' + TT.esc([x.l.meal_plan, x.l.cancellation].filter(Boolean).join(' · ')) + '</small><em>' + TT.money(unitOf(x.l), cu) + ' per room · ' + plural(x.l.nights || g.nights || 0, 'night') + '</em></div>' +
        '<div class="ca-r"><div class="ca-step"><button type="button" data-cs="-" data-g="' + TT.esc(g.key) + '" data-id="' + x.l.id + '" aria-label="Remove one room">' + (x.k === 1 ? TRASH : '−') + '</button><span>' + x.k + '</span><button type="button" data-cs="+" data-g="' + TT.esc(g.key) + '" data-id="' + x.l.id + '" aria-label="Add one room"' + (x.k >= TT.roomCap(x.l) ? ' disabled' : '') + '>+</button></div><b class="ca-p">' + TT.money(priceOf(x.l, x.k), cu) + '</b></div></div>').join('');
      return '<section class="ca-card"><div class="ca-head"><div><h2>' + TT.esc(g.city || 'Your stay') + '</h2><p>' + TT.esc(groupDates(g)) + '</p></div><button type="button" class="ca-rm" data-rm="' + TT.esc(g.key) + '" aria-label="Remove ' + TT.esc(so.hotel_name) + '">' + TRASH + '<span>Remove</span></button></div>' +
        '<div class="ca-hotel">' + (photo ? '<img src="' + photo + '" alt="" loading="lazy">' : '<span class="ca-ph">' + TT.esc((so.hotel_name || '?').slice(0, 1)) + '</span>') + '<div><b>' + TT.esc(so.hotel_name) + '</b><small>' + TT.esc([(so.lines.find(l => l.stars) || {}).stars ? (so.lines.find(l => l.stars) || {}).stars + ' star' : '', (so.lines.find(l => l.style) || {}).style].filter(Boolean).join(' · ')) + '</small></div></div>' +
        rows + '<div class="ca-acts"><button type="button" class="ca-link" data-add="' + TT.esc(g.key) + '">+ Add another room</button><a class="ca-link" href="' + cityHref(g) + '">Change hotel</a></div>' +
        '<div class="ca-sub"><span>Subtotal</span><b>' + TT.money(sub, cu) + '</b></div></section>';
    }).join('');
    const bill = items.map(g => { const taken = takenOf(g), n = taken.reduce((a, x) => a + x.k, 0), amt = taken.reduce((a, x) => a + priceOf(x.l, x.k), 0);
      return '<div class="ca-row"><span>' + TT.esc(g.city || 'Stay') + ' · ' + TT.esc(g.selectedOption.hotel_name) + '<small>' + plural(n, 'room') + ' × ' + plural(g.nights || 0, 'night') + '</small></span><b>' + TT.money(amt, cu) + '</b></div>'; }).join('');
    const policy = items.map(g => { const c = (g.selectedOption.lines.find(l => l.cancellation) || {}).cancellation; return c ? '<li><b>' + TT.esc(g.selectedOption.hotel_name) + '</b> ' + TT.esc(c) + '</li>' : ''; }).join('');
    return bar + '<div class="ca-wrap">' + cards +
      '<section class="ca-card ca-note"><label for="caNote">Anything we should know? <em>(optional)</em></label><textarea id="caNote" rows="2" placeholder="Early check-in, extra bed, anniversary, dietary needs…">' + TT.esc(cartNote) + '</textarea></section>' +
      '<section class="ca-card ca-bill"><h3>Bill details</h3>' + bill +
      (save > 0 ? '<div class="ca-row ca-mute"><span>Online price for the same rooms</span><s>' + TT.money(online, cu) + '</s></div>' : '') +
      '<div class="ca-row ca-grand"><span>Grand total</span><b>' + TT.money(total, cu) + '</b></div>' +
      (save > 0 ? '<div class="ca-save">You are saving ' + TT.money(save, cu) + ' with us</div>' : '') + '</section>' +
      (policy ? '<section class="ca-card ca-pol"><h3>Cancellation policy</h3><ul>' + policy + '</ul></section>' : '') +
      '<div class="ca-fine">' + disclaimerHtml() + '</div></div>' +
      '<div class="ca-checkout"><div><b>' + TT.money(total, cu) + '</b><small>' + plural(items.length, 'hotel') + ' · ' + plural(roomCount(), 'room') + '</small></div><button type="button" class="ca-go" id="caGo">Checkout</button></div>';
  }
  function drawCart() { const v = TT.$('#viewCity'); if (v && inCart) { const y = window.scrollY, f = document.activeElement && document.activeElement.id === 'caNote'; v.innerHTML = cartPage(); window.scrollTo({ top: y, behavior: 'instant' }); if (f) TT.$('#caNote').focus(); } }
  function cartStep(gk, id, d) {
    const g = groups.find(x => x.key === gk); if (!g || !g.selectedOption) return;
    const taken = {}; takenOf(g).forEach(x => { taken[x.l.id] = x.k; });
    const l = g.selectedOption.lines.find(x => String(x.id) === String(id)); if (!l) return;
    taken[l.id] = Math.max(0, Math.min(TT.roomCap(l), (taken[l.id] || 0) + d));
    const qty = {}; let n = 0;
    g.selectedOption.lines.forEach(x => { qty[x.id] = taken[x.id] || 0; n += qty[x.id]; });
    if (!n) choose(gk, null); else choose(gk, g.selectedOption.key, qty, true);
  }

  async function choose(groupKey, optionKey, qty, quiet) {
    const before = Object.assign({}, selection);
    if (optionKey) selection[groupKey] = qty ? { o: optionKey, q: qty } : optionKey; else delete selection[groupKey];
    refresh();
    const gsel = groups.find(x => x.key === groupKey);
    if (quiet) { /* stepping rooms inside the cart */ }
    else if (optionKey && gsel && gsel.selectedOption) cartToast('Added to cart', gsel.selectedOption.hotel_name + ' · ' + TT.money(gsel.selectedOption.total, cur()), true);
    else if (!optionKey) cartToast('Removed from cart', '', false);
    if (quiet && !optionKey) cartToast('Removed from cart', '', false);
    try {
      const r = await TT.api('/api/public/trips/' + encodeURIComponent(slug) + '/select', { method: 'POST', json: qty ? { group: groupKey, option: optionKey, qty } : { group: groupKey, option: optionKey } });
      selection = r.selection;
    } catch (err) {
      selection = before; refresh(); TT.toast(err.message || 'Could not save your choice', 'err');
    }
  }

  root.addEventListener('input', e => { if (e.target.id === 'caNote') cartNote = e.target.value; });

  root.addEventListener('click', e => {
    const spot = e.target.closest('[data-spot]');
    if (spot) { if (map) { selectChip(null); if (sheetOn) { if (snap === 'full') setSnap('half', { fit: false }); } else TT.$('#tcMap').scrollIntoView({ block: 'center', behavior: 'smooth' }); map.focusSpot(+spot.dataset.spot); } return; }
    const lgt = e.target.closest('.lg-tg');
    if (lgt) {
      const sec = lgt.closest('.lg'), n = sec.querySelectorAll('.lg-list li').length;
      guideOpen = !sec.classList.contains('open');
      sec.classList.toggle('open', guideOpen); lgt.setAttribute('aria-expanded', guideOpen);
      lgt.firstChild.textContent = guideOpen ? 'Hide places' : n + (n === 1 ? ' place' : ' places');
      return;
    }
    const tog = e.target.closest('.tc-tog');
    if (tog) {
      const card = tog.closest('.co'), on = !card.classList.contains('open');
      setCard(card, on);
      if (on) watchCard(card); else if (cardIO) cardIO.unobserve(card);
      return;
    }
    const pick = e.target.closest('.co-pick');
    if (pick) { startSelect(pick.dataset.g, pick.dataset.o); return; }
    const chg = e.target.closest('.rs-change');
    if (chg) { startSelect(chg.dataset.g, chg.dataset.o); return; }
    if (e.target.closest('#tcCheckout')) { location.hash = '#cart'; return; }
    if (e.target.closest('#caGo')) { checkout(); return; }
    const cs = e.target.closest('[data-cs]');
    if (cs) { cartStep(cs.dataset.g, cs.dataset.id, cs.dataset.cs === '+' ? 1 : -1); return; }
    const crm = e.target.closest('[data-rm]');
    if (crm) { choose(crm.dataset.rm, null); return; }
    const cadd = e.target.closest('[data-add]');
    if (cadd) { const g = groups.find(x => x.key === cadd.dataset.add); if (g && g.selectedOption) startSelect(g.key, g.selectedOption.key); return; }
    const un = e.target.closest('.co-un');
    if (un) { choose(un.dataset.g, null); return; }
    if (e.target.closest('.cc')) { listY = window.scrollY; return; }  // remember where the list was; the link itself changes the page
    const b = e.target.closest('.tc-pin, .tc-chip');
    if (!b || !map) return;
    const id = +b.dataset.id;
    if (b.classList.contains('tc-pin')) {  // "View on map" on a hotel: open the map full screen on that hotel
      if (!TT.$('#tcMapSec').classList.contains('full')) setFull(true);
      selectChip(id); setTimeout(() => map.focus(id), 120);
      return;
    }
    if (sheetOn && snap === 'full' && !b.classList.contains('tc-pin')) setSnap('half', { fit: false });
    if (chipSel === id) { selectChip(null); map.showAll(); return; }  // tapping the selected chip again shows every hotel
    selectChip(id); map.focus(id);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && TT.$('#tcMapSec.full')) setFull(false); });

  TT.api('/api/public/trips/' + encodeURIComponent(slug)).then(d => { data = d; selection = d.selection || {}; render(); })
    .catch(() => { root.innerHTML = '<p class="tc-load">This trip link is no longer available.</p>'; });
})(window.TT);
