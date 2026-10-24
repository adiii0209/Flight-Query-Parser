/* Trips: trip leads (enquiries) that can be converted into trips. TT.leads.mount(root, { onConvert(trip) }) */
(function (TT) {
  const STATUS = ['new', 'contacted', 'converted', 'lost'];

  function mount(root, opts) {
    let leads = [];

    function row(l) {
      const dates = l.travel_from ? TT.date(l.travel_from) + (l.travel_to ? ' – ' + TT.date(l.travel_to) : '') : '';
      return '<div class="lead-row" data-id="' + l.id + '"><div class="lead-main"><b>' + TT.esc(l.name) + '</b>' +
        (l.phone ? ' <a href="tel:' + TT.esc(l.phone) + '">' + TT.esc(l.phone) + '</a>' : '') +
        '<div class="ho-hint">' + [l.destination, dates, l.pax].filter(Boolean).map(TT.esc).join(' · ') + '</div>' +
        (l.notes ? '<div class="ho-hint">' + TT.esc(l.notes) + '</div>' : '') + '</div>' +
        '<select data-act="status"' + (l.status === 'converted' ? ' disabled' : '') + '>' + STATUS.map(s => '<option' + (s === l.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>' +
        (l.trip_id ? '<button class="pill ghost sm" data-act="open">Open trip</button>' : '<button class="pill primary sm" data-act="convert">Convert to trip</button>') +
        '<button class="pill ghost sm" data-act="delete" aria-label="Delete lead">Delete</button></div>';
    }

    function render() {
      root.innerHTML = '<form class="t-form" id="leadForm"><input name="name" placeholder="Client name *" required><input name="phone" placeholder="Phone">' +
        '<input name="destination" placeholder="Destination"><input name="travel_from" type="date" title="Travel from"><input name="travel_to" type="date" title="Travel to">' +
        '<input name="pax" placeholder="Travellers (e.g. 2 adults + 1 child)"><input name="notes" class="wide" placeholder="Notes">' +
        '<button class="pill primary" type="submit">Add lead</button></form>' +
        '<div class="lead-list">' + (leads.length ? leads.map(row).join('') : '<p class="ho-hint">No leads yet.</p>') + '</div>';
    }

    async function load() {
      try { leads = (await TT.api('/api/hotel-offers/trip-leads')).leads; } catch (e) { TT.toast(e.message, 'err'); }
      render();
    }

    root.addEventListener('submit', async e => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      try { leads.unshift((await TT.api('/api/hotel-offers/trip-leads', { method: 'POST', json: body })).lead); render(); } catch (err) { TT.toast(err.message, 'err'); }
    });
    root.addEventListener('change', async e => {
      if (e.target.dataset.act !== 'status') return;
      const id = +e.target.closest('.lead-row').dataset.id;
      try { await TT.api('/api/hotel-offers/trip-leads/' + id, { method: 'PATCH', json: { status: e.target.value } }); } catch (err) { TT.toast(err.message, 'err'); }
    });
    root.addEventListener('click', async e => {
      const btn = e.target.closest('[data-act]');
      if (!btn || btn.tagName === 'SELECT') return;
      const l = leads.find(x => x.id === +btn.closest('.lead-row').dataset.id);
      try {
        if (btn.dataset.act === 'convert') {
          const r = await TT.api('/api/hotel-offers/trip-leads/' + l.id + '/convert', { method: 'POST' });
          Object.assign(l, r.lead); opts.onConvert(r.trip);
        } else if (btn.dataset.act === 'open') opts.onConvert({ id: l.trip_id });
        else if (btn.dataset.act === 'delete' && confirm('Delete this lead?')) {
          await TT.api('/api/hotel-offers/trip-leads/' + l.id, { method: 'DELETE' });
          leads = leads.filter(x => x !== l); render();
        }
      } catch (err) { TT.toast(err.message, 'err'); }
    });

    return { load };
  }

  TT.leads = { mount };
})(window.TT);
