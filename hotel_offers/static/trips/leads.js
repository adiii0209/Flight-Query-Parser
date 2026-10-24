/* Trips: the leads that arrive from live offers (Book now), with an optional "Convert to trip".
   TT.leads.mount(root, { onConvert(trip) }) -> { load() } */
(function (TT) {
  const LABEL = { new: 'New', contacted: 'Contacted', won: 'Won', lost: 'Lost' };

  function mount(root, opts) {
    let leads = [];

    function ago(iso) {
      const m = Math.round((Date.now() - new Date(iso)) / 60000);
      if (m < 1) return 'just now';
      if (m < 60) return m + ' min ago';
      if (m < 1440) return Math.round(m / 60) + ' h ago';
      return Math.round(m / 1440) + ' d ago';
    }

    function card(l) {
      const stay = l.stay_from ? TT.date(l.stay_from) + (l.stay_to ? ' – ' + TT.date(l.stay_to) : '') : '';
      const wa = 'https://wa.me/' + String(l.phone || '').replace(/\D/g, '');
      return '<article class="lcard" data-id="' + l.id + '"><header><div class="lcard-av">' + TT.esc((l.name || '?').trim().slice(0, 1).toUpperCase()) + '</div>' +
        '<div class="lcard-id"><b>' + TT.esc(l.name) + '</b><span class="ho-hint">' + ago(l.created_at) + '</span></div>' +
        '<span class="st st-' + l.status + '">' + (LABEL[l.status] || l.status) + '</span></header>' +
        '<p class="lcard-meta"><b>' + TT.esc(l.offer_title || 'Offer') + '</b>' + (stay ? '<br>Stay ' + TT.esc(stay) : '') + '</p>' +
        '<p class="lcard-contact"><a href="tel:' + TT.esc(l.phone) + '">' + TT.esc(l.phone) + '</a><a href="' + TT.esc(wa) + '" target="_blank" rel="noopener">WhatsApp</a></p>' +
        (l.note ? '<p class="lcard-notes">' + TT.esc(l.note) + '</p>' : '') +
        '<footer>' + (l.trip_id ? '<button class="pill ghost sm" data-act="open">Open trip</button>' : '<button class="pill primary sm" data-act="convert">Convert to trip</button>') + '</footer></article>';
    }

    function render() {
      root.innerHTML = leads.length ? '<div class="t-grid">' + leads.map(card).join('') + '</div>' :
        '<div class="t-empty"><b>No leads yet</b><p>When a client taps Book now on a live offer, they appear here. You can convert any lead into a trip.</p></div>';
    }

    async function load() {
      root.innerHTML = '<div class="t-grid"><div class="tcard sk"></div><div class="tcard sk"></div></div>';
      try { leads = (await TT.api('/api/hotel-offers/leads')).leads; render(); } catch (e) { root.innerHTML = '<p class="ho-hint err">' + TT.esc(e.message) + '</p>'; }
    }

    root.addEventListener('click', async e => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const l = leads.find(x => x.id === +btn.closest('.lcard').dataset.id);
      if (btn.dataset.act === 'open') return opts.onConvert({ id: l.trip_id });
      btn.disabled = true;
      try {
        const { trip } = await TT.api('/api/hotel-offers/leads/' + l.id + '/to-trip', { method: 'POST' });
        l.trip_id = trip.id; opts.onConvert(trip);
      } catch (err) { TT.toast(err.message, 'err'); btn.disabled = false; }
    });

    return { load };
  }

  TT.leads = { mount };
})(window.TT);
