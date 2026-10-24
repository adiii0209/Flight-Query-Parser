/* Trips: agent page controller - tabs (Trips / Leads), trip cards, the "new" dialogs and the trip detail view. */
(function (TT) {
  const views = { trips: TT.$('#viewTrips'), leads: TT.$('#viewLeads'), detail: TT.$('#viewDetail') };
  let current = 'trips', trips = [];

  const HERO = {
    trips: ['Trips', 'Hotel quotations for each client, ready to share.', 'New trip'],
    leads: ['Leads', 'Clients who tapped Book now on a live offer. Convert any of them into a trip.', ''],
  };

  function show(name) {
    current = name;
    Object.keys(views).forEach(k => { views[k].hidden = k !== name; });
    TT.$('#listChrome').hidden = name === 'detail';
    if (name !== 'detail') {
      TT.$$('.t-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === name));
      const h = HERO[name];
      TT.$('#heroTitle').textContent = h[0]; TT.$('#heroSub').textContent = h[1]; TT.$('#btnNewLabel').textContent = h[2]; TT.$('#btnNew').hidden = !h[2];
      TT.$('#findBox').hidden = name !== 'trips';
    }
    window.scrollTo({ top: 0 });
  }

  const detail = TT.detail.mount(views.detail, { onBack: () => { location.hash = ''; route(); } });
  const leads = TT.leads.mount(views.leads, { onConvert: trip => { location.hash = 'trip/' + trip.id; } });

  // ---- trip cards
  const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const range = t => t.start_date ? TT.date(t.start_date) + (t.end_date ? ' – ' + TT.date(t.end_date) : '') : '';

  function card(t) {
    const h = hue(t.title + t.id);
    const cover = t.cover
      ? '<img src="' + TT.esc(TT.photoUrl(t.cover, 600)) + '" alt="" loading="lazy">'
      : '<div class="tcard-ph" style="background:linear-gradient(135deg,hsl(' + h + ' 45% 38%),hsl(' + ((h + 40) % 360) + ' 50% 55%))"><span>' + TT.esc((t.destination || t.title || '?').trim().slice(0, 1).toUpperCase()) + '</span></div>';
    const who = [t.client_name, t.destination].filter(Boolean).map(TT.esc).join(' · ');
    return '<a class="tcard" href="#trip/' + t.id + '"><div class="tcard-cover">' + cover +
      (t.is_shared ? '<span class="badge on-img">Shared</span>' : '') + '</div><div class="tcard-body"><h3>' + TT.esc(t.title) + '</h3>' +
      '<p class="tcard-who">' + (who || 'No client yet') + '</p>' + (range(t) ? '<p class="tcard-dates">' + range(t) + '</p>' : '') +
      ((t.cities || []).length ? '<div class="tcard-cities">' + t.cities.map(c => '<span>' + TT.esc(c) + '</span>').join('') + '</div>' : '') +
      '<div class="tcard-foot"><span>' + t.quote_count + ' hotel' + (t.quote_count === 1 ? '' : 's') + '</span><b>' + (t.total ? TT.money(t.total, t.currency) : '—') + '</b></div></div></a>';
  }

  function renderTrips() {
    const q = TT.$('#findBox').value.trim().toLowerCase();
    const list = trips.filter(t => !q || [t.title, t.client_name, t.destination, (t.cities || []).join(' ')].join(' ').toLowerCase().includes(q));
    TT.$('#tripList').innerHTML = list.length ? list.map(card).join('') :
      '<div class="t-empty"><b>' + (trips.length ? 'No trips match your search' : 'No trips yet') + '</b><p>' + (trips.length ? 'Try a different name or city.' : 'Create a trip, or convert a lead, to start adding hotel quotes.') + '</p></div>';
  }

  async function showTrips() {
    show('trips');
    TT.$('#tripList').innerHTML = '<div class="tcard sk"></div><div class="tcard sk"></div><div class="tcard sk"></div>';
    try { trips = (await TT.api('/api/hotel-offers/trips')).trips; renderTrips(); } catch (e) { TT.$('#tripList').innerHTML = '<p class="ho-hint err">' + TT.esc(e.message) + '</p>'; }
  }

  function route() {
    const m = location.hash.match(/^#trip\/(\d+)/);
    if (m) { show('detail'); detail.open(+m[1]); } else if (location.hash === '#leads') { show('leads'); leads.load(); } else showTrips();
  }

  // ---- dialogs
  const dlg = id => TT.$(id);
  document.addEventListener('click', e => { const c = e.target.closest('[data-close]'); if (c) c.closest('dialog').close(); });
  TT.$$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));  // click on the backdrop closes it

  TT.$('#btnNew').addEventListener('click', () => {
    TT.$('#newTripForm').reset(); TT.$('#tripErr').textContent = '';
    dlg('#tripDialog').showModal(); TT.$('#newTripForm [name=client_name]').focus();
  });
  TT.$('#newTripForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter, body = Object.fromEntries(new FormData(e.target).entries());
    btn.disabled = true;
    try {
      const { trip } = await TT.api('/api/hotel-offers/trips', { method: 'POST', json: body });
      dlg('#tripDialog').close(); location.hash = 'trip/' + trip.id;
    } catch (err) { TT.$('#tripErr').textContent = err.message; }
    btn.disabled = false;
  });

  TT.$('#tabs').addEventListener('click', e => {
    const t = e.target.closest('.t-tab');
    if (!t) return;
    const target = t.dataset.tab === 'leads' ? '#leads' : '';
    if (location.hash === target || (!location.hash && !target)) route(); else location.hash = target;
  });
  TT.$('#findBox').addEventListener('input', renderTrips);
  window.addEventListener('hashchange', route);
  route();
})(window.TT);
