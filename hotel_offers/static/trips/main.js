/* Trips: agent page controller - tabs (Trips / Leads) and the trip detail view. */
(function (TT) {
  const views = { trips: TT.$('#viewTrips'), leads: TT.$('#viewLeads'), detail: TT.$('#viewDetail') };
  const show = name => {
    Object.keys(views).forEach(k => { views[k].hidden = k !== name; });
    TT.$$('.t-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === name));
    TT.$('#tabs').hidden = name === 'detail';
    window.scrollTo({ top: 0 });
  };

  const detail = TT.detail.mount(views.detail, { onBack: () => { location.hash = ''; showTrips(); } });
  const leads = TT.leads.mount(views.leads, { onConvert: trip => { location.hash = 'trip/' + trip.id; } });

  async function showTrips() {
    show('trips');
    const list = TT.$('#tripList');
    try {
      const { trips } = await TT.api('/api/hotel-offers/trips');
      list.innerHTML = trips.length ? trips.map(t =>
        '<a class="trip-row" href="#trip/' + t.id + '"><div><b>' + TT.esc(t.title) + '</b><div class="ho-hint">' +
        [t.client_name, t.destination, t.start_date ? TT.date(t.start_date) : ''].filter(Boolean).map(TT.esc).join(' · ') + '</div></div>' +
        '<div class="trip-meta">' + (t.is_shared ? '<span class="badge">Shared</span>' : '') + '<span>' + t.quote_count + ' hotel' + (t.quote_count === 1 ? '' : 's') + '</span><b>' + TT.money(t.total, t.currency) + '</b></div></a>').join('')
        : '<p class="ho-hint">No trips yet. Add one above, or convert a lead.</p>';
    } catch (e) { list.innerHTML = '<p class="ho-hint err">' + TT.esc(e.message) + '</p>'; }
  }

  function route() {
    const m = location.hash.match(/^#trip\/(\d+)/);
    if (m) { show('detail'); detail.open(+m[1]); } else if (location.hash === '#leads') { show('leads'); leads.load(); } else showTrips();
  }

  TT.$('#tabs').addEventListener('click', e => {
    const t = e.target.closest('.t-tab');
    if (t) location.hash = t.dataset.tab === 'leads' ? 'leads' : '';
    if (t && t.dataset.tab === 'trips' && !location.hash) showTrips();
  });
  TT.$('#newTripForm').addEventListener('submit', async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try { const { trip } = await TT.api('/api/hotel-offers/trips', { method: 'POST', json: body }); e.target.reset(); location.hash = 'trip/' + trip.id; } catch (err) { TT.toast(err.message, 'err'); }
  });
  window.addEventListener('hashchange', route);
  route();
})(window.TT);
