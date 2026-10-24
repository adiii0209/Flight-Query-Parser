/* Trips: trip leads (enquiries) that can be converted into trips.
   TT.leads.mount(root, { onConvert(trip) }) -> { load(), openForm() }. Uses the #leadDialog form from the page. */
(function (TT) {
  const STATUS = ['new', 'contacted', 'converted', 'lost'];

  function mount(root, opts) {
    let leads = [];

    function card(l) {
      const dates = l.travel_from ? TT.date(l.travel_from) + (l.travel_to ? ' – ' + TT.date(l.travel_to) : '') : '';
      const meta = [l.destination, dates, l.pax].filter(Boolean).map(TT.esc).join(' · ');
      return '<article class="lcard" data-id="' + l.id + '"><header><div class="lcard-av">' + TT.esc((l.name || '?').trim().slice(0, 1).toUpperCase()) + '</div>' +
        '<div class="lcard-id"><b>' + TT.esc(l.name) + '</b>' + (l.phone ? '<a href="tel:' + TT.esc(l.phone) + '">' + TT.esc(l.phone) + '</a>' : '') + '</div>' +
        '<span class="st st-' + l.status + '">' + l.status + '</span></header>' +
        (meta ? '<p class="lcard-meta">' + meta + '</p>' : '') + (l.notes ? '<p class="lcard-notes">' + TT.esc(l.notes) + '</p>' : '') +
        '<footer>' + (l.trip_id ? '<button class="pill primary sm" data-act="open">Open trip</button>' : '<button class="pill primary sm" data-act="convert">Convert to trip</button>') +
        '<select data-act="status" aria-label="Status"' + (l.status === 'converted' ? ' disabled' : '') + '>' + STATUS.map(s => '<option' + (s === l.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>' +
        '<button class="pill ghost sm" data-act="delete">Delete</button></footer></article>';
    }

    function render() {
      root.innerHTML = leads.length ? '<div class="t-grid">' + leads.map(card).join('') + '</div>' :
        '<div class="t-empty"><b>No trip leads yet</b><p>Add an enquiry here, then convert it into a trip when the client is ready for quotes.</p></div>';
    }

    async function load() {
      try { leads = (await TT.api('/api/hotel-offers/trip-leads')).leads; } catch (e) { TT.toast(e.message, 'err'); }
      render();
    }

    function openForm() {
      const form = TT.$('#leadForm');
      form.reset(); TT.$('#leadErr').textContent = '';
      TT.$('#leadDialog').showModal(); form.elements.name.focus();
    }

    TT.$('#leadForm').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = e.submitter;
      btn.disabled = true;
      try {
        leads.unshift((await TT.api('/api/hotel-offers/trip-leads', { method: 'POST', json: Object.fromEntries(new FormData(e.target).entries()) })).lead);
        TT.$('#leadDialog').close(); render();
      } catch (err) { TT.$('#leadErr').textContent = err.message; }
      btn.disabled = false;
    });

    root.addEventListener('change', async e => {
      if (e.target.dataset.act !== 'status') return;
      const l = leads.find(x => x.id === +e.target.closest('.lcard').dataset.id);
      try { Object.assign(l, (await TT.api('/api/hotel-offers/trip-leads/' + l.id, { method: 'PATCH', json: { status: e.target.value } })).lead); render(); } catch (err) { TT.toast(err.message, 'err'); }
    });
    root.addEventListener('click', async e => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const l = leads.find(x => x.id === +btn.closest('.lcard').dataset.id);
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

    return { load, openForm };
  }

  TT.leads = { mount };
})(window.TT);
