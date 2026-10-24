/* Trips: one trip - details, paste-to-add quotes, quote cards, map and sharing. TT.detail.mount(root, { onBack() }) */
(function (TT) {
  function mount(root, opts) {
    let trip = null, qm = null, map = null;

    function shell() {
      root.innerHTML =
        '<div class="d-bar"><button class="pill ghost sm" data-act="back">← Trips</button><span class="d-total" id="dTotal"></span>' +
        '<button class="pill ghost sm" data-act="delete">Delete trip</button></div>' +
        '<section class="d-head t-form"><input id="fTitle" placeholder="Trip name"><input id="fClient" placeholder="Client name"><input id="fPhone" placeholder="Client phone">' +
        '<input id="fDest" placeholder="Destination"><input id="fStart" type="date" title="Start"><input id="fEnd" type="date" title="End">' +
        '<select id="fCur"><option>INR</option><option>USD</option><option>EUR</option><option>GBP</option><option>THB</option><option>AED</option></select></section>' +
        '<section class="d-share"><div><b>Share with client</b><div class="ho-hint" id="shareHint"></div></div>' +
        '<div class="d-share-btns"><label class="sw"><input type="checkbox" id="fShared"><i></i><span>Shared</span></label>' +
        '<button class="pill ghost sm" data-act="copy" id="btnCopy" hidden>Copy link</button><a class="pill ghost sm" id="btnView" target="_blank" rel="noopener" hidden>Preview</a></div></section>' +
        '<div class="d-cols"><div class="d-left"><section class="d-paste"><textarea id="pasteBox" rows="4" placeholder="Paste the quotation (rows copied from the Google Sheet, or any hotel quote text)…" spellcheck="false"></textarea>' +
        '<div class="d-paste-bar"><span class="ho-hint" id="pasteStatus"></span><button class="pill ghost sm" data-act="blank">Add blank quote</button><button class="pill primary" data-act="parse">Add quotes</button></div></section>' +
        '<div id="qList"></div></div><aside class="d-right"><div id="tripMap" class="tt-map"></div></aside></div>';
      qm = TT.quotes.mount(TT.$('#qList', root), { currency: () => trip.currency, onChange: onQuotes, onFocus: id => { map.focus(id); TT.$('#tripMap', root).scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } });
      map = TT.createMap(TT.$('#tripMap', root), { onSelect: id => { const c = TT.$('.q-card[data-id="' + id + '"]', root); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); } });
    }

    function onQuotes(list) {
      TT.$('#dTotal', root).textContent = list.length + ' quote' + (list.length === 1 ? '' : 's') + ' · ' + TT.money(list.reduce((s, q) => s + (q.total || 0), 0), trip.currency);
      map.render(list);
    }

    function fillShare() {
      TT.$('#fShared', root).checked = trip.is_shared;
      TT.$('#btnCopy', root).hidden = TT.$('#btnView', root).hidden = !trip.is_shared;
      if (trip.share_url) TT.$('#btnView', root).href = trip.share_url;
      TT.$('#shareHint', root).textContent = trip.is_shared ? 'Anyone with the link can view this trip and its hotel quotes.' : 'Off. Only your team can see this trip.';
    }

    function fill() {
      const set = (id, v) => { TT.$(id, root).value = v || ''; };
      set('#fTitle', trip.title); set('#fClient', trip.client_name); set('#fPhone', trip.client_phone); set('#fDest', trip.destination);
      set('#fStart', trip.start_date); set('#fEnd', trip.end_date); set('#fCur', trip.currency);
      fillShare();
      qm.set(trip.quotes); onQuotes(trip.quotes);
    }

    const patch = async body => {
      try { Object.assign(trip, (await TT.api('/api/hotel-offers/trips/' + trip.id, { method: 'PATCH', json: body })).trip, { quotes: trip.quotes }); return true; } catch (e) { TT.toast(e.message, 'err'); return false; }
    };
    const saveHead = TT.debounce(() => patch({
      title: TT.$('#fTitle', root).value, client_name: TT.$('#fClient', root).value, client_phone: TT.$('#fPhone', root).value, destination: TT.$('#fDest', root).value,
      start_date: TT.$('#fStart', root).value, end_date: TT.$('#fEnd', root).value, currency: TT.$('#fCur', root).value }), 500);

    root.addEventListener('input', e => { if (e.target.closest('.d-head')) { if (e.target.id === 'fCur') trip.currency = e.target.value; saveHead(); onQuotes(qm.all()); } });
    root.addEventListener('change', async e => {
      if (e.target.id !== 'fShared') return;
      if (await patch({ is_shared: e.target.checked })) fillShare(); else e.target.checked = !e.target.checked;
    });
    root.addEventListener('click', async e => {
      const btn = e.target.closest('[data-act]');
      if (!btn || btn.closest('.q-card')) return;
      const act = btn.dataset.act;
      if (act === 'back') opts.onBack();
      else if (act === 'copy') { try { await navigator.clipboard.writeText(trip.share_url); TT.toast('Link copied'); } catch (err) { prompt('Copy this link', trip.share_url); } }
      else if (act === 'delete') {
        if (!confirm('Delete this trip and all its quotes?')) return;
        try { await TT.api('/api/hotel-offers/trips/' + trip.id, { method: 'DELETE' }); opts.onBack(); } catch (err) { TT.toast(err.message, 'err'); }
      } else if (act === 'blank') {
        try { qm.add([(await TT.api('/api/hotel-offers/trips/' + trip.id + '/quotes', { method: 'POST', json: { hotel_name: 'New hotel', items: 1, date: trip.start_date } })).quote]); } catch (err) { TT.toast(err.message, 'err'); }
      } else if (act === 'parse') {
        const box = TT.$('#pasteBox', root), st = TT.$('#pasteStatus', root);
        btn.disabled = true; st.className = 'ho-hint'; st.textContent = 'Reading the quotation and placing hotels on the map…';
        try {
          const r = await TT.api('/api/hotel-offers/trips/' + trip.id + '/parse', { method: 'POST', json: { text: box.value } });
          qm.add(r.quotes); box.value = '';
          st.className = 'ho-hint ' + (r.warning ? '' : 'ok'); st.textContent = 'Added ' + r.quotes.length + ' quote' + (r.quotes.length === 1 ? '' : 's') + '. ' + (r.warning || '');
        } catch (err) { st.className = 'ho-hint err'; st.textContent = err.message; }
        btn.disabled = false;
      }
    });

    return {
      async open(id) {
        shell();
        try { trip = (await TT.api('/api/hotel-offers/trips/' + id)).trip; fill(); } catch (e) { TT.toast(e.message, 'err'); opts.onBack(); }
      },
    };
  }

  TT.detail = { mount };
})(window.TT);
