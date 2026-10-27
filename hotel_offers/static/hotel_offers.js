(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const TEMPLATES = window.HO_POSTERS;
  const CAN_CONFIGURE = window.HO_CAN_CONFIGURE;
  const NUMERIC = new Set(['online_rate', 'our_deal', 'nights', 'adults', 'rooms', 'net_total', 'free_nights']);
  const ICON_OPTIONS = [['credit', 'Credit'], ['breakfast', 'Breakfast'], ['upgrade', 'Upgrade'], ['checkin', 'Check-in/out'],
    ['welcome', 'Welcome'], ['spa', 'Spa'], ['transfer', 'Transfer'], ['dining', 'Dining'], ['gift', 'Gift'], ['wifi', 'Wi-Fi']];
  const MODELS = {
    openrouter: ['google/gemini-2.0-flash-001', 'anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini', 'meta-llama/llama-3.3-70b-instruct'],
    anthropic: ['claude-sonnet-5-5', 'claude-haiku-5-5'],
    openai: ['gpt-4o-mini', 'gpt-4.1-mini'],
    gemini: ['gemini-2.0-flash', 'gemini-2.5-flash'],
  };

  const state = { data: blank(), photos: {}, selected: new Set(), offerId: null, name: '', dirty: false, live: null, liveStale: false, layout: {}, editing: null, settings: null, picker: null };

  function blank() {
    return { brand_line: '', place_line: '', tagline: '', offer_headline: '', headline_scale: 100, currency: 'INR', online_rate: 0, our_deal: 0, perks: [],
      hotel_name: '', room: '', check_in: '', check_out: '', extra_samples: [], booking_from: '', travel_from: '', travel_to: '', nights: 0, adults: 0, rooms: 0, net_total: 0, free_nights: 0, cancellation: '', photo_query: '', city: '' };
  }

  // ---------- helpers
  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts,
      opts.body && typeof opts.body !== 'string' ? { body: JSON.stringify(opts.body) } : {}));
    let body = {};
    try { body = await res.json(); } catch (e) { /* non-JSON (e.g. login redirect) */ }
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }
  const say = (el, msg, kind) => { el.textContent = msg || ''; el.className = 'ho-hint' + (kind ? ' ' + kind : ''); };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const fmtMoney = n => Number(n || 0).toLocaleString('en-US');
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  function brand() {
    const s = state.settings || {}, pick = (v, d) => (v == null ? d : v);  // "" stays "", only a missing value uses the default
    return { name: pick(s.brand_name, 'Time Elevate'), tagline: pick(s.brand_tagline, 'Luxury stays.\nMore to enjoy.'), header_note: pick(s.brand_header_note, ''),
      footer: pick(s.brand_footer, 'Curated by Time Tours'), est: pick(s.brand_est, 'EST. 1978'), enquire: pick(s.enquire_label, 'Enquire now'),
      loyalty: pick(s.loyalty_note, ''), availability: pick(s.availability_note, '') };
  }
  const posterData = () => Object.assign({}, state.data, { photos: state.photos, brand: brand(), layout: state.layout });

  // ---------- sidebar
  (function () {
    const toggle = $('#menuToggle'), sidebar = $('#sidebar'), overlay = $('#sidebarOverlay');
    if (toggle && sidebar) {
      toggle.addEventListener('click', () => { sidebar.classList.add('active'); if (overlay) overlay.classList.add('active'); });
      if (overlay) overlay.addEventListener('click', () => { sidebar.classList.remove('active'); overlay.classList.remove('active'); });
    }
  })();

  // ---------- modals
  const openModal = id => { $('#' + id).hidden = false; };
  const closeModal = el => {
    if (el.id === 'settingsModal' && !el.hidden && settingsDirty() && !confirm('You have unsaved changes. Discard them?')) return;
    el.hidden = true;
  };
  $$('.ho-modal').forEach(m => {
    m.addEventListener('mousedown', e => { if (e.target === m) closeModal(m); });
    $$('[data-close]', m).forEach(b => b.addEventListener('click', () => closeModal(m)));
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.ho-modal').forEach(closeModal); });

  // ---------- form <-> state
  function fillForm() {
    $$('[data-f]').forEach(inp => { const v = state.data[inp.dataset.f]; inp.value = v == null || v === 0 && NUMERIC.has(inp.dataset.f) && inp.dataset.f !== 'free_nights' ? (v || '') : v; });
    renderPerks();
    renderSamples();
    renderSlots();
    updatePriceHint();
    updateHlVal();
  }
  // ---------- sample dates: the first sample is the check-in / check-out above; more can be added, each with its own price
  const samplesOf = d => [{ check_in: d.check_in, check_out: d.check_out }].concat(d.extra_samples || []).filter(s => s.check_in && s.check_out);
  // samples that start before the travel window opens or end after it closes
  const outsideTravel = d => (!d.travel_from && !d.travel_to) ? [] : samplesOf(d).filter(s => (d.travel_from && s.check_in < d.travel_from) || (d.travel_to && s.check_out > d.travel_to));
  const travelWarning = d => {
    const bad = outsideTravel(d);
    return bad.length ? `Outside the travel window: ${bad.map(s => dayLabel(s.check_in) + ' to ' + dayLabel(s.check_out)).join(', ')}. Check these dates or the window.` : '';
  };
  // an extra sample is published only with check-in, check-out (after check-in) and a price; say which ones are skipped
  const sampleReady = s => s.check_in && s.check_out && s.check_out > s.check_in && Number(s.our_deal) > 0;
  const publishableSamples = d => (d.check_in && d.check_out ? 1 : 0) + (d.extra_samples || []).filter(sampleReady).length;
  function incompleteSamples(d) {
    return (d.extra_samples || []).map((s, i) => [s, i + 2]).filter(([s]) => !sampleReady(s))
      .map(([s, n]) => `Sample ${n} ${s.check_in || s.check_out || Number(s.our_deal) ? 'needs check-in, check-out and a price' : 'is empty'}, so clients will not see it.`);
  }
  function updateSampleWarn() {
    const el = $('#sampleWarn'), msgs = incompleteSamples(state.data), w = travelWarning(state.data);
    if (w) msgs.push(w);
    el.hidden = !msgs.length; el.innerHTML = msgs.map(m => `<span>${m.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>`).join('<br>');
  }
  function renderSamples() {
    if (!Array.isArray(state.data.extra_samples)) state.data.extra_samples = [];
    const host = $('#sampleRows');
    host.innerHTML = '';
    state.data.extra_samples.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'sample-row';
      row.innerHTML = `<div class="sample-head"><b>Sample ${i + 2}</b><button type="button" class="sample-x" aria-label="Remove these dates" title="Remove">&times;</button></div>` +
        '<div class="sample-grid"><label>Check-in<input type="date" data-k="check_in"></label><label>Check-out<input type="date" data-k="check_out"></label>' +
        '<label>Our deal<input type="number" min="0" step="any" inputmode="decimal" data-k="our_deal"></label><label>Online rate<input type="number" min="0" step="any" inputmode="decimal" data-k="online_rate"></label></div>';
      $$('input', row).forEach(inp => {
        inp.value = s[inp.dataset.k] || '';
        inp.addEventListener('input', () => { s[inp.dataset.k] = inp.type === 'number' ? Number(inp.value || 0) : inp.value; updateSampleWarn(); refresh(); });
      });
      $('button', row).addEventListener('click', () => { state.data.extra_samples.splice(i, 1); renderSamples(); refresh(); });
      host.appendChild(row);
    });
    $('#btnAddSample').hidden = state.data.extra_samples.length >= 7;
    updateSampleWarn();
  }
  $('#btnAddSample').addEventListener('click', () => {
    state.data.extra_samples.push({ check_in: '', check_out: '', our_deal: 0, online_rate: 0 });
    renderSamples(); refresh();
    const rows = $$('#sampleRows .sample-row'); $('input', rows[rows.length - 1]).focus();
  });

  function updateHlVal() { $('#hlVal').textContent = (state.data.headline_scale || 100) + '%'; }
  function bumpHl(delta) {
    const v = delta === 0 ? 100 : Math.min(160, Math.max(40, (state.data.headline_scale || 100) + delta));
    state.data.headline_scale = v; updateHlVal(); refresh();
  }
  $('#hlMinus').addEventListener('click', () => bumpHl(-10));
  $('#hlPlus').addEventListener('click', () => bumpHl(10));
  $('#hlReset').addEventListener('click', () => bumpHl(0));
  function updatePriceHint() {
    const d = state.data, el = $('#priceHint');
    if (d.net_total) {
      const save = d.online_rate && d.our_deal ? Math.round((1 - d.our_deal / d.online_rate) * 100) : 0;
      el.textContent = `Net total from paste: ${d.currency || ''} ${fmtMoney(d.net_total)}` + (save > 0 ? ` · Deal is ${save}% below online rate` : '');
    } else { el.textContent = ''; }
  }
  $$('[data-f]').forEach(inp => inp.addEventListener('input', () => {
    const k = inp.dataset.f;
    state.data[k] = NUMERIC.has(k) ? Number(inp.value || 0) : inp.value;
    updatePriceHint();
    if (k === 'check_in' || k === 'check_out') updateSampleWarn();
    refresh();
  }));

  // Suggested text for each perk category, offered when the category is changed
  const PERK_TEXT = { credit: 'RESORT\nCREDITS', breakfast: 'DAILY\nBREAKFAST', upgrade: 'ROOM\nUPGRADES*', checkin: 'EARLY CHECK-IN /\nLATE CHECK-OUT*',
    welcome: 'VIP\nWELCOME', spa: 'SPA\nTREATMENT', transfer: 'AIRPORT\nTRANSFERS', dining: 'DINING\nCREDIT', gift: 'WELCOME\nGIFT', wifi: 'COMPLIMENTARY\nWI-FI' };
  function suggestPerkText(row, p) {
    const old = $('.perk-suggest', row);
    if (old) old.remove();
    const def = PERK_TEXT[p.icon], ta = $('textarea', row);
    if (!def) return;
    if (!p.label.trim()) { p.label = def; ta.value = def; autosize(ta); refresh(); return; }  // nothing typed yet: just fill it in
    if (p.label.trim() === def) return;
    const box = document.createElement('div');
    box.className = 'perk-suggest';
    box.innerHTML = '<span>Change the text to <b></b> too?</span><span class="ps-btns"><button type="button" data-a="yes">Update text</button><button type="button" data-a="no">Keep mine</button></span>';
    $('b', box).textContent = def.replace(/\n/g, ' ');
    box.addEventListener('click', e => {
      const a = e.target.dataset && e.target.dataset.a;
      if (!a) return;
      if (a === 'yes') { p.label = def; ta.value = def; autosize(ta); refresh(); }
      box.remove();
    });
    row.appendChild(box);
  }

  // Perk label boxes grow to fit their text (no manual resize handle, no inner scrolling that fights page scrolling)
  function autosize(el) {
    if (!el.offsetParent) { el.style.height = ''; return; }  // hidden: measure later
    el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px';
  }
  const autosizePerks = () => $$('#perkRows textarea').forEach(autosize);
  function renderPerks() {
    const box = $('#perkRows');
    box.innerHTML = '';
    state.data.perks.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'perk-row';
      row.innerHTML = `<select>${ICON_OPTIONS.map(([v, l]) => `<option value="${v}" ${v === p.icon ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <textarea rows="2" placeholder="TWO LINE\nLABEL"></textarea><button type="button" title="Remove" aria-label="Remove perk">&times;</button>`;
      $('textarea', row).value = p.label;
      $('select', row).addEventListener('change', e => { p.icon = e.target.value; refresh(); suggestPerkText(row, p); });
      $('textarea', row).addEventListener('input', e => { p.label = e.target.value; autosize(e.target); const sg = $('.perk-suggest', row); if (sg) sg.remove(); refresh(); });
      $('button', row).addEventListener('click', () => { state.data.perks.splice(i, 1); renderPerks(); refresh(); });
      box.appendChild(row);
      autosize($('textarea', row));
    });
    const full = state.data.perks.length >= 5, addBtn = $('#btnAddPerk');
    addBtn.disabled = full;
    addBtn.textContent = full ? 'Maximum of 5 perks reached' : `Add perk (${state.data.perks.length}/5)`;
    addBtn.title = full ? 'The posters have room for 5 perks. Remove one to add another.' : '';
  }
  $('#btnAddPerk').addEventListener('click', () => {
    if (state.data.perks.length < 5) {
      state.data.perks.push({ icon: 'gift', label: '' }); renderPerks();
      const rows = $$('#perkRows .perk-row'), ta = $('textarea', rows[rows.length - 1]);
      ta.scrollIntoView({ block: 'center', behavior: 'smooth' }); ta.focus({ preventScroll: true });  // so the new row is visible and ready to type in
    }
  });

  // ---------- stages
  const app = $('#app');
  const setStage = name => { app.dataset.stage = name; window.scrollTo({ top: 0 }); syncBarFab(); $('#btnLeads').classList.toggle('is-active', name === 'leads'); if (name === 'studio') requestAnimationFrame(() => { layoutScale(); autosizePerks(); }); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function stepper() {
    const items = $$('.steps li'), title = $('#procTitle');
    const names = ['Reading your offer', 'Extracting the details', 'Finding photos', 'Designing templates'];
    return n => {
      items.forEach((li, i) => { li.classList.toggle('done', i < n); li.classList.toggle('active', i === n); });
      if (names[n]) title.textContent = names[n];
    };
  }
  $('#btnNew').addEventListener('click', () => setStage('paste'));

  // ---------- parse
  $('#btnParse').addEventListener('click', async () => {
    const btn = $('#btnParse'), status = $('#parseStatus');
    const text = $('#rawText').value.trim();
    if (text.length < 20) { say(status, 'Paste the offer text first.', 'err'); return; }
    btn.disabled = true; say(status, '');
    const step = stepper();
    setStage('process'); step(0);
    const started = Date.now();
    try {
      const [res] = await Promise.all([api('/api/hotel-offers/parse', { method: 'POST', body: { text } }), sleep(900)]);
      step(1);
      state.data = Object.assign(blank(), res.data);
      state.photos = {}; state.layout = {}; state.offerId = null; state.live = null; state.liveStale = false; renderLiveBtn(); state.name = defaultName(); $('#offerName').value = state.name;
      fillForm();
      await sleep(800);
      step(2);
      await Promise.race([autoPhotos(), sleep(9000)]);
      step(3);
      refresh();
      await sleep(Math.max(700, 3600 - (Date.now() - started)));
      step(4);
      await sleep(350);
      setStage('studio');
      if (res.warning) say($('#parseStatus'), res.warning, 'err');
    } catch (e) {
      setStage('paste');
      say(status, e.message, 'err');
    }
    btn.disabled = false;
  });

  // ---------- photos
  const slotDefs = () => {
    const seen = new Map();
    TEMPLATES.forEach(t => t.slots.forEach(s => { if (!seen.has(s.key)) seen.set(s.key, s); }));
    return Array.from(seen.values());
  };
  function renderSlots() {
    const box = $('#photoSlots');
    box.innerHTML = '';
    slotDefs().forEach(s => {
      const url = state.photos[s.key];
      const row = document.createElement('div');
      row.className = 'slot';
      row.innerHTML = `<div class="slot-thumb"></div><div class="slot-info">${s.key === 'hero' ? 'Main photo' : s.label}<small>${s.key === 'hero' ? 'Used by every template' : 'Gallery template only'}</small></div>
        <button class="pill ghost sm" type="button">${url ? 'Change' : 'Choose'}</button>${url ? '<button class="pill ghost sm" type="button" data-clear>Clear</button>' : ''}`;
      if (url) $('.slot-thumb', row).style.backgroundImage = `url("${url}")`;
      $('button', row).addEventListener('click', () => openPicker(s));
      const clear = $('[data-clear]', row);
      if (clear) clear.addEventListener('click', () => { delete state.photos[s.key]; renderSlots(); refresh(); });
      box.appendChild(row);
    });
  }
  function photoQuery(slot) {
    const base = state.data.photo_query || state.data.hotel_name || state.data.city || '';
    return slot && slot.hint ? `${state.data.city || base} ${slot.hint}`.trim() : base;
  }
  async function autoPhotos() {
    const s = state.settings || {};
    const src = s.photo_default_source;
    if (!(src === 'google' ? s.google_places_key_set : s.unsplash_access_key_set)) return;
    await Promise.all(slotDefs().map(async slot => {
      try {
        const orient = slot.orient === 'portrait' ? 'portrait' : 'landscape';
        const r = await api(`/api/hotel-offers/photos?q=${encodeURIComponent(photoQuery(slot))}&source=${src}&orientation=${orient}`);
        if (r.results[0] && !state.photos[slot.key]) state.photos[slot.key] = r.results[0].full;
      } catch (e) { /* no photo for this slot; user can pick one */ }
    }));
    // Gallery slots shouldn't repeat the same picture
    const used = new Set();
    for (const k of Object.keys(state.photos)) { if (used.has(state.photos[k]) && k !== 'hero') delete state.photos[k]; used.add(state.photos[k]); }
    renderSlots();
  }
  let pickerPage = 1;
  function openPicker(slot) {
    state.picker = slot;
    $('#photoTitle').textContent = 'Choose photo · ' + (slot.key === 'hero' ? 'main' : slot.label);
    $('#photoQuery').value = photoQuery(slot);
    $('#photoSource').value = (state.settings && state.settings.photo_default_source) || 'unsplash';
    $('#photoOrient').value = slot.orient === 'portrait' ? 'portrait' : 'landscape';
    $('#photoGrid').innerHTML = ''; say($('#photoMsg'), ''); $('#photoMore').hidden = true;
    openModal('photoModal');
    searchPhotos(1);
  }
  async function searchPhotos(page) {
    pickerPage = page;
    const q = $('#photoQuery').value.trim(), msg = $('#photoMsg'), grid = $('#photoGrid');
    if (!q) return;
    if (page === 1) grid.innerHTML = '';
    say(msg, 'Searching…');
    try {
      const r = await api(`/api/hotel-offers/photos?q=${encodeURIComponent(q)}&source=${$('#photoSource').value}&orientation=${$('#photoOrient').value}&page=${page}`);
      say(msg, r.results.length ? 'Click a photo to use it.' : 'No photos found. Try a broader search.');
      r.results.forEach(p => {
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = `<img loading="lazy" alt=""><span>${p.credit || ''}</span>`;
        $('img', b).src = p.thumb;
        b.addEventListener('click', () => { state.photos[state.picker.key] = p.full; closeModal($('#photoModal')); renderSlots(); refresh(); });
        grid.appendChild(b);
      });
      $('#photoMore').hidden = !(r.results.length && $('#photoSource').value === 'unsplash');
    } catch (e) { say(msg, e.message, 'err'); }
  }
  $('#photoGo').addEventListener('click', () => searchPhotos(1));
  $('#photoQuery').addEventListener('keydown', e => { if (e.key === 'Enter') searchPhotos(1); });
  $('#photoMore').addEventListener('click', () => searchPhotos(pickerPage + 1));
  $('#photoUpload').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const max = 2200, k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      state.photos[state.picker.key] = c.toDataURL('image/jpeg', 0.9);
      closeModal($('#photoModal')); renderSlots(); refresh();
    };
    img.src = URL.createObjectURL(file);
  });

  // ---------- gallery
  const cards = new Map();
  function buildGallery() {
    const gal = $('#gallery');
    TEMPLATES.forEach((t, idx) => {
      const card = document.createElement('article');
      card.className = 'ho-tpl';
      card.style.setProperty('--i', idx);
      card.innerHTML = `<div class="ho-tpl-head"><label class="ho-check"><input type="checkbox"> ${t.name}</label><span class="ho-dim">${t.w}&times;${t.h}</span></div>
        <div class="ho-tpl-view"><div class="ho-tpl-scale"></div></div>
        <div class="ho-tpl-actions"><button class="pill ghost sm" data-act="dl">Download</button><button class="pill ghost sm" data-act="copy">Copy image</button><button class="pill ghost sm" data-act="edit"><span class="lbl-d">Enlarge</span><span class="lbl-m">Edit layout</span></button></div>
        <div class="ho-tpl-tools" hidden><span class="tt-name"></span><button type="button" data-t="minus" aria-label="Smaller">&minus;</button><button type="button" data-t="plus" aria-label="Larger">+</button><button type="button" data-t="reset">Reset part</button></div>`;
      $('input', card).addEventListener('change', e => {
        e.target.checked ? state.selected.add(t.id) : state.selected.delete(t.id);
        card.classList.toggle('sel', e.target.checked);
        $('#selAll').checked = state.selected.size === TEMPLATES.length;
      });
      $('[data-act=dl]', card).addEventListener('click', e => run(e.currentTarget, () => download(t)));
      $('[data-act=copy]', card).addEventListener('click', e => run(e.currentTarget, () => copyImage(t)));
      $('[data-act=edit]', card).addEventListener('click', () => openLayout(t));
      const box = $('.ho-tpl-scale', card), tools = $('.ho-tpl-tools', card);
      const editor = makeEditable(box, {
        tpl: () => t, k: () => box.getBoundingClientRect().width / t.w, enabled: () => !touchLike(),
        onSelect: (name, scale) => { tools.hidden = !name; $('.tt-name', tools).textContent = name ? `${name} · ${Math.round(scale * 100)}%` : ''; },
      });
      $('[data-t=minus]', tools).addEventListener('click', () => editor.resize(-0.05));
      $('[data-t=plus]', tools).addEventListener('click', () => editor.resize(0.05));
      $('[data-t=reset]', tools).addEventListener('click', () => editor.resetSel());
      card.editor = editor;
      box.classList.toggle('edit-off', touchLike());
      touchLikeMQ.addEventListener('change', () => { box.classList.toggle('edit-off', touchLike()); if (touchLike()) editor.deselect(); });
      gal.appendChild(card);
      cards.set(t.id, card);
    });
    const ro = new ResizeObserver(layoutScale);
    ro.observe(gal);
  }
  function layoutScale() {
    TEMPLATES.forEach(t => {
      const card = cards.get(t.id), view = $('.ho-tpl-view', card), box = $('.ho-tpl-scale', card);
      const cs = getComputedStyle(view);
      const avail = view.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (avail <= 0) return;
      const k = avail / t.w;
      box.style.width = t.w * k + 'px'; box.style.height = t.h * k + 'px';
      const po = box.firstElementChild;
      if (po) po.style.transform = `scale(${k})`;
    });
  }
  function refresh() {
    if (app.dataset.stage === 'studio') { state.dirty = true; if (state.live && state.live.is_live && !state.liveStale) { state.liveStale = true; renderLiveBtn(); } }
    const has = !!(state.data.brand_line || state.data.place_line || state.data.hotel_name);
    $('#galleryEmpty').hidden = has;
    $('#gallery').hidden = !has;
    if (!has) return;
    const d = posterData();
    TEMPLATES.forEach(t => { const c = cards.get(t.id); $('.ho-tpl-scale', c).innerHTML = t.render(d); });
    layoutScale();
    TEMPLATES.forEach(t => cards.get(t.id).editor.reselect());
  }
  $('#selAll').addEventListener('change', e => {
    state.selected.clear();
    $$('.ho-tpl').forEach((c, i) => {
      $('input', c).checked = e.target.checked; c.classList.toggle('sel', e.target.checked);
      if (e.target.checked) state.selected.add(TEMPLATES[i].id);
    });
  });

  // ---------- direct editing: click a part of any poster to select it, drag to move, corner dot to resize
  const PART_NAMES = { logo: 'Time Elevate logo', 't-brand': 'Hotel name', 't-place': 'Place', 't-tag': 'Hotel tagline', 'po-badge': 'Offer badge',
    headline: 'Offer text', perk: 'Perk', note: 'Loyalty note', pricebar: 'Price bar', cta: 'Enquire button', avail: 'Availability note',
    curated: 'Curated by', 'cur-inline': 'Curated by', 'hdr-note': 'Header note', 'cur-t': 'Curated by', 'cur-e': 'Established', ph: 'Photo' };
  let activeEditor = null;
  const touchLikeMQ = window.matchMedia('(max-width: 700px), (pointer: coarse)');
  const touchLike = () => touchLikeMQ.matches;

  function makeEditable(host, o) {
    // o: { tpl(): template, k(): screen px per poster px, onSelect(name|null, scale) }
    let sel = null, selKey = null, drag = null, handle = null, guideV = null, guideH = null;
    const root = () => host.firstElementChild;
    const layout = () => (state.layout[o.tpl().id] = state.layout[o.tpl().id] || {});
    const getOff = key => Object.assign({ dx: 0, dy: 0, s: 1 }, layout()[key]);
    function setOff(key, v) {
      const L = layout();
      if (!v.dx && !v.dy && (!v.s || v.s === 1)) delete L[key];
      else L[key] = { dx: Math.round(v.dx * 10) / 10, dy: Math.round(v.dy * 10) / 10, s: Math.round(v.s * 100) / 100 };
      state.dirty = true;
    }
    const find = key => key && $$('[data-k]', host).find(e => e.dataset.k === key);
    function applyEl(el) {
      const v = getOff(el.dataset.k);
      el.style.transform = v.dx || v.dy || v.s !== 1 ? `translate(${v.dx}px,${v.dy}px) scale(${v.s})` : '';
      el.style.transformOrigin = '0 0';
    }
    function partName(el) {
      const cls = Array.from(el.classList).find(c => PART_NAMES[c]);
      let n = cls ? PART_NAMES[cls] : 'Shape / line';
      if (cls === 'perk') n += ' ' + ($$('[data-k^="perk@"]', host).indexOf(el) + 1);
      return n;
    }
    const mkDiv = css => { const d = document.createElement('div'); d.style.cssText = css; root().appendChild(d); return d; };
    function clearHandle() { if (handle) { handle.remove(); handle = null; } }
    function hideGuides() { [guideV, guideH].forEach(g => g && g.remove()); guideV = guideH = null; }
    function placeHandle() {
      clearHandle();
      if (!sel || !root()) return;
      const k = o.k(), rr = root().getBoundingClientRect(), er = sel.getBoundingClientRect(), r = 7 / k;
      handle = mkDiv(`position:absolute;z-index:9999;width:${2 * r}px;height:${2 * r}px;left:${(er.right - rr.left) / k - r}px;top:${(er.bottom - rr.top) / k - r}px;` +
        `background:#0071e3;border:${2 / k}px solid #fff;border-radius:50%;cursor:nwse-resize;touch-action:none;box-shadow:0 0 ${3 / k}px rgba(0,0,0,.4)`);
      handle.dataset.handle = '1';
    }
    function select(el) {
      if (activeEditor && activeEditor !== api) activeEditor.deselect();
      if (sel) sel.classList.remove('le-sel');
      sel = el || null; selKey = el ? el.dataset.k : null;
      if (el) { el.classList.add('le-sel'); activeEditor = api; } else if (activeEditor === api) activeEditor = null;
      host.style.setProperty('--k', o.k());
      placeHandle();
      if (o.onSelect) o.onSelect(el ? partName(el) : null, el ? getOff(selKey).s : 1);
    }
    function snap(el) {
      // magnetic centre guides, like a design tool
      const k = o.k(), rr = root().getBoundingClientRect(), er = el.getBoundingClientRect(), v = getOff(el.dataset.k);
      const ex = (er.left + er.right) / 2 - (rr.left + rr.right) / 2, ey = (er.top + er.bottom) / 2 - (rr.top + rr.bottom) / 2;
      const T = 7;
      let hitX = false, hitY = false;
      if (Math.abs(ex) < T) { v.dx -= ex / k; hitX = true; }
      if (Math.abs(ey) < T) { v.dy -= ey / k; hitY = true; }
      if (hitX || hitY) { setOff(el.dataset.k, v); applyEl(el); }
      const w = o.tpl().w, h = o.tpl().h;
      if (hitX && !guideV) guideV = mkDiv(`position:absolute;left:${w / 2 - 1 / k}px;top:0;width:${2 / k}px;height:${h}px;background:#ff2d9b;z-index:9998;pointer-events:none`);
      if (!hitX && guideV) { guideV.remove(); guideV = null; }
      if (hitY && !guideH) guideH = mkDiv(`position:absolute;top:${h / 2 - 1 / k}px;left:0;height:${2 / k}px;width:${w}px;background:#ff2d9b;z-index:9998;pointer-events:none`);
      if (!hitY && guideH) { guideH.remove(); guideH = null; }
    }

    host.addEventListener('pointerover', () => host.style.setProperty('--k', o.k()));
    host.addEventListener('pointerdown', e => {
      if (o.enabled && !o.enabled()) return; // editing is switched off here (phones use the full-screen editor)
      if (e.target.dataset && e.target.dataset.handle && sel) {
        const er = sel.getBoundingClientRect(), v = getOff(selKey);
        drag = { type: 'resize', el: sel, ox: er.left, oy: er.top, d0: Math.hypot(e.clientX - er.left, e.clientY - er.top) || 1, s0: v.s, v };
        host.setPointerCapture(e.pointerId); e.preventDefault(); return;
      }
      const el = e.target.closest('[data-k]');
      const was = el && el === sel;
      select(el);
      if (!el) return;
      if (e.pointerType === 'touch' && !was && !o.touchDrag) return; // first tap only selects, so the page can still scroll
      drag = { type: 'move', el, x0: e.clientX, y0: e.clientY, v: getOff(el.dataset.k) };
      host.setPointerCapture(e.pointerId); e.preventDefault();
    });
    host.addEventListener('pointermove', e => {
      if (!drag) return;
      const k = o.k();
      if (drag.type === 'move') {
        setOff(drag.el.dataset.k, { dx: drag.v.dx + (e.clientX - drag.x0) / k, dy: drag.v.dy + (e.clientY - drag.y0) / k, s: drag.v.s });
        applyEl(drag.el); snap(drag.el);
      } else {
        const f = Math.hypot(e.clientX - drag.ox, e.clientY - drag.oy) / drag.d0;
        setOff(drag.el.dataset.k, { dx: drag.v.dx, dy: drag.v.dy, s: Math.min(4, Math.max(0.3, drag.s0 * f)) });
        applyEl(drag.el);
      }
      placeHandle();
    });
    const end = () => { if (drag) { drag = null; hideGuides(); placeHandle(); if (o.onSelect && sel) o.onSelect(partName(sel), getOff(selKey).s); } };
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);

    const api = {
      deselect() { select(null); },
      reselect() { sel = find(selKey); if (sel) { sel.classList.add('le-sel'); host.style.setProperty('--k', o.k()); placeHandle(); } else { selKey = null; if (activeEditor === api) activeEditor = null; if (o.onSelect) o.onSelect(null, 1); } },
      relayout() { placeHandle(); },
      nudge(dx, dy) { if (!sel) return; const v = getOff(selKey); setOff(selKey, { dx: v.dx + dx, dy: v.dy + dy, s: v.s }); applyEl(sel); placeHandle(); },
      resize(f) { if (!sel) return; const v = getOff(selKey); setOff(selKey, { dx: v.dx, dy: v.dy, s: Math.min(4, Math.max(0.3, v.s + f)) }); applyEl(sel); placeHandle(); if (o.onSelect) o.onSelect(partName(sel), getOff(selKey).s); },
      resetSel() { if (!sel) return; setOff(selKey, { dx: 0, dy: 0, s: 1 }); applyEl(sel); placeHandle(); if (o.onSelect) o.onSelect(partName(sel), 1); },
      hasSel: () => !!sel,
    };
    return api;
  }

  // keyboard works on whichever poster is being edited
  document.addEventListener('keydown', e => {
    if (!activeEditor || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    const step = e.shiftKey ? 10 : 1;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[e.key]) { e.preventDefault(); activeEditor.nudge(...arrows[e.key]); }
    else if (e.key === '+' || e.key === '=') activeEditor.resize(0.05);
    else if (e.key === '-') activeEditor.resize(-0.05);
    else if (e.key === 'Escape') { if (state.editing) closeLayout(); else activeEditor.deselect(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); activeEditor.resetSel(); }
  });
  // clicking anywhere outside a poster or its toolbar deselects
  document.addEventListener('pointerdown', e => {
    if (activeEditor && !e.target.closest('.ho-tpl-scale, .le-stage, .ho-tpl-tools, .le-panel')) activeEditor.deselect();
  });

  // ---------- enlarged editor (same behaviour on a bigger canvas)
  const le = { k: 1 };
  const modalEditor = makeEditable($('#leStage'), {
    tpl: () => state.editing, k: () => le.k, touchDrag: true,
    onSelect: (name, scale) => { $('#leSel').textContent = name || 'Click a part of the poster'; $('#leSizeVal').textContent = Math.round(scale * 100) + '%'; },
  });
  function fitStage() {
    const t = state.editing, wrap = $('.le-stagewrap');
    le.k = Math.max(Math.min((wrap.clientWidth - 40) / t.w, (wrap.clientHeight - 40) / t.h, 1.1), 0.1);
    const stage = $('#leStage');
    stage.style.width = t.w * le.k + 'px'; stage.style.height = t.h * le.k + 'px';
    const po = stage.firstElementChild;
    if (po) { po.style.transform = `scale(${le.k})`; po.style.transformOrigin = '0 0'; }
    modalEditor.relayout();
  }
  function openLayout(t) {
    state.editing = t;
    $('#leTitle').textContent = t.name;
    $('#leStage').innerHTML = t.render(posterData());
    $('#layoutModal').hidden = false;
    modalEditor.deselect();
    requestAnimationFrame(fitStage);
  }
  function closeLayout() {
    modalEditor.deselect();
    $('#layoutModal').hidden = true;
    state.editing = null;
    refresh();
  }
  $$('[data-nudge]').forEach(b => b.addEventListener('click', () => { const [x, y] = b.dataset.nudge.split(',').map(Number); modalEditor.nudge(x * 2, y * 2); }));
  $('#leMinus').addEventListener('click', () => modalEditor.resize(-0.05));
  $('#lePlus').addEventListener('click', () => modalEditor.resize(0.05));
  $('#leResetEl').addEventListener('click', () => modalEditor.resetSel());
  $('#leResetAll').addEventListener('click', () => {
    if (!confirm('Put every part of this template back in its original place?')) return;
    delete state.layout[state.editing.id];
    $('#leStage').innerHTML = state.editing.render(posterData());
    modalEditor.deselect(); fitStage();
  });
  $('#leDone').addEventListener('click', closeLayout);
  window.addEventListener('resize', () => { if (state.editing) fitStage(); });

  // ---------- export
  async function run(btn, fn) {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Working…';
    try { await fn(); } catch (e) { alert(e.message || 'Export failed'); }
    btn.disabled = false; btn.textContent = label;
  }
  // Text that ends up outside the poster (a moved element, long text, a scaled font) would be cut off in the picture.
  // Before the picture is taken, pull any such text box back inside, leaving a small margin.
  function keepTextInside(po, w, h) {
    const r0 = po.getBoundingClientRect(), edge = Math.round(w * 0.012);
    $$('.a', po).forEach(el => {
      if (!el.textContent.trim() || el.querySelector('img') || getComputedStyle(el).writingMode !== 'horizontal-tb') return;
      const r = el.getBoundingClientRect();
      if (r.width > r0.width * 0.9 || /rotate/.test(el.style.transform)) return;  // full-width bars and rotated text are meant to touch the edges
      let dx = 0, dy = 0;
      if (r.right > r0.right + 2) dx = -(r.right - r0.right + edge);
      else if (r.left < r0.left - 2) dx = r0.left - r.left + edge;
      if (r.bottom > r0.bottom + 2) dy = -(r.bottom - r0.bottom + edge);
      if (dx || dy) el.style.transform = `translate(${Math.round(dx)}px,${Math.round(dy)}px) ${el.style.transform || ''}`.trim();
    });
  }
  async function renderCanvas(t, d = posterData(), opts = {}) {
    const host = document.createElement('div');
    // Attach outside <body> (apps may zoom body on phones) and behind the page; layout is sized by the poster itself.
    host.style.cssText = `position:fixed;left:0;top:0;width:${t.w}px;height:${t.h}px;z-index:-1;pointer-events:none`;
    host.innerHTML = t.render(d);
    document.documentElement.appendChild(host);
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const el = host.firstElementChild;
      keepTextInside(el, t.w, t.h);
      const size = opts.size || $('#outSize').value, sc = opts.scale || 2;
      let W = Math.round(t.w * sc), H = Math.round(t.h * sc), k = sc;
      if (size !== 'native') {
        [W, H] = size.split('x').map(Number);
        k = Math.min(W / t.w, H / t.h);
      }
      const shot = await html2canvas(el, { scale: k, useCORS: true, backgroundColor: null, logging: false, width: t.w, height: t.h, windowWidth: t.w, windowHeight: t.h, x: 0, y: 0, scrollX: 0, scrollY: 0 });
      const out = document.createElement('canvas');
      out.width = W; out.height = H;
      const ctx = out.getContext('2d');
      ctx.fillStyle = getComputedStyle(el).backgroundColor || '#f4eee4';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(shot, (W - shot.width) / 2, (H - shot.height) / 2);
      return out;
    } finally { host.remove(); }
  }
  const toBlob = (canvas, fmt) => new Promise(res => canvas.toBlob(res, fmt === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92));
  const slug = s => String(s || 'offer').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  function save(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  async function download(t) {
    const fmt = $('#outFmt').value;
    const blob = await toBlob(await renderCanvas(t), fmt);
    save(blob, `${slug(state.data.hotel_name || state.data.brand_line)}-${t.id}.${fmt === 'jpeg' ? 'jpg' : 'png'}`);
  }
  async function copyImage(t) {
    if (!navigator.clipboard || !window.ClipboardItem) throw new Error('Your browser cannot copy images. Use Download instead.');
    const blob = await toBlob(await renderCanvas(t), 'png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }
  $('#btnDownloadSel').addEventListener('click', e => run(e.currentTarget, async () => {
    const list = TEMPLATES.filter(t => state.selected.has(t.id));
    if (!list.length) throw new Error('Tick the templates you want first.');
    for (const t of list) { await download(t); await new Promise(r => setTimeout(r, 350)); }
  }));

  function caption(d = state.data, b = brand()) {
    const dt = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const lines = [`*${[d.brand_line, d.place_line].filter(Boolean).join(' ') || d.hotel_name}*`];
    if (d.offer_headline) lines.push(`*${d.offer_headline}*`);
    if (d.tagline) lines.push(d.tagline);
    lines.push('');
    if (d.room) lines.push(d.room);
    if (d.check_in && d.check_out) lines.push(`${dt(d.check_in)} - ${dt(d.check_out)}${d.nights ? ' · ' + d.nights + ' nights' : ''}${d.adults ? ' · ' + d.adults + ' adults' : ''}`);
    if (d.perks.length) { lines.push('', 'Your stay includes:'); d.perks.forEach(p => lines.push('- ' + p.label.replace(/\n/g, ' ').replace(/\*/g, ''))); }
    if (d.our_deal) {
      lines.push('');
      if (d.online_rate) lines.push(`Online rate: ~${d.currency} ${fmtMoney(d.online_rate)}/-~`);
      lines.push(`*Our deal: ${d.currency} ${fmtMoney(d.our_deal)}/-*`);
    }
    const tail = [b.availability, b.footer].filter(x => x && x.trim());
    lines.push('', ...tail, ...(tail.length ? [''] : []), '🙌 Know someone heading there? Forward this to them');
    return lines.join('\n');
  }
  // Same text as Share: caption first, the live link at the very end (no link until the offer is live)
  $('#btnCopyCaption').addEventListener('click', async e => {
    const btn = e.currentTarget;
    try {
      if (liveOn()) await copyShare(state.live.url, Promise.resolve(state.data));
      else { await navigator.clipboard.writeText(caption()); toast('Caption copied'); }
      btn.textContent = 'Copied';
    } catch (err) { alert('Could not copy. ' + err.message); }
    setTimeout(() => { btn.textContent = 'Copy caption'; }, 1500);
  });

  // The sticky toolbar takes a lot of a phone screen: it can be hidden, and a floating button brings it back
  let barCollapsed = false;
  function syncBarFab() { const f = $('#barExpand'); if (f) f.hidden = !(barCollapsed && app.dataset.stage === 'studio'); }
  function setBarCollapsed(c) {
    barCollapsed = c;
    $('.studio-bar').classList.toggle('collapsed', c);
    if (c && typeof closeLiveMenu === 'function') closeLiveMenu();
    syncBarFab();
  }
  $('#barCollapse').addEventListener('click', () => setBarCollapsed(true));
  $('#barExpand').addEventListener('click', () => setBarCollapsed(false));

  // On phones the editable fields sit below the posters; this jumps straight to them
  $('#btnDetails').addEventListener('click', () => {
    const ed = $('.editor'), bar = $('.studio-bar');
    const y = ed.getBoundingClientRect().top + window.scrollY - bar.getBoundingClientRect().bottom - 12;
    window.scrollTo({ top: Math.max(0, y), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });

  // ---------- naming + saving
  const defaultName = () => [state.data.brand_line, state.data.place_line].filter(Boolean).join(' ') || state.data.hotel_name || 'Untitled offer';
  $('#offerName').addEventListener('input', e => { state.name = e.target.value; state.dirty = true; });
  async function saveCurrent() {
    const name = ($('#offerName').value || '').trim() || defaultName();
    $('#offerName').value = state.name = name;
    const r = await api('/api/hotel-offers/offers', { method: 'POST', body: { id: state.offerId, title: name, data: { data: state.data, photos: state.photos, layout: state.layout } } });
    state.offerId = r.offer.id; state.dirty = false;
    return r.offer.id;
  }
  $('#btnSave').addEventListener('click', async e => {
    const btn = e.currentTarget, label = btn.textContent;
    btn.disabled = true;
    try { await saveCurrent(); btn.textContent = 'Saved'; } catch (err) { btn.textContent = 'Not saved'; alert(err.message); }
    btn.disabled = false;
    setTimeout(() => { btn.textContent = label; }, 1600);
  });
  window.addEventListener('beforeunload', e => { if (state.dirty && app.dataset.stage === 'studio') { e.preventDefault(); e.returnValue = ''; } });

  // ---------- saved offers drawer
  const dayLabel = iso => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const copyText = async text => { try { await navigator.clipboard.writeText(text); return true; } catch (e) { window.prompt('Copy this link', text); return false; } };
  // Share = copy the caption with the link at the very end, ready to paste into WhatsApp
  async function copyShare(url, dataPromise) {
    const build = async () => caption(await dataPromise, brand()) + '\n\n' + url;
    try {
      if (navigator.clipboard && window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ 'text/plain': build().then(t => new Blob([t], { type: 'text/plain' })) })]);
      else await navigator.clipboard.writeText(await build());
      toast('Link and caption copied');
    } catch (e) { window.prompt('Copy this text', await build()); }
  }
  const offerData = id => api('/api/hotel-offers/offers/' + id).then(r => Object.assign(blank(), r.offer.data.data));
  let toastT;
  function toast(msg) {
    let t = $('#hoToast');
    if (!t) { t = document.createElement('div'); t.id = 'hoToast'; t.className = 'ho-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2000);
  }
  $$('.js-open-saved').forEach(b => b.addEventListener('click', () => { openModal('savedModal'); loadSaved(); }));
  async function openOffer(o) {
    const r = await api('/api/hotel-offers/offers/' + o.id);
    state.data = Object.assign(blank(), r.offer.data.data); state.photos = r.offer.data.photos || {}; state.layout = r.offer.data.layout || {};
    state.offerId = o.id; state.name = o.title; $('#offerName').value = o.title;
    state.live = o.live || null; state.liveStale = false;
    fillForm(); refresh(); state.dirty = false; state.liveStale = false; renderLiveBtn();
    closeModal($('#savedModal')); setStage('studio');
  }
  async function loadSaved() {
    const list = $('#savedList');
    list.textContent = 'Loading…';
    try {
      const { offers } = await api('/api/hotel-offers/offers');
      list.innerHTML = offers.length ? '' : '<div class="ho-hint">Nothing saved yet. Generate an offer, name it and press Save.</div>';
      offers.forEach(o => {
        const lv = o.live, on = !!(lv && lv.is_live && !lv.expired);
        const row = document.createElement('div');
        row.className = 'ho-saved-item' + (on ? ' is-live' : '');
        const status = on ? `Live${lv.valid_till ? ' · till ' + dayLabel(lv.valid_till) : ''} · ${lv.views} view${lv.views === 1 ? '' : 's'}`
          : lv && lv.is_live && lv.expired ? 'Expired · switch on to renew' : 'Saved · ' + dayLabel(o.updated_at);
        row.innerHTML = `<div class="si-top"><input class="si-name" maxlength="120" aria-label="Offer name">
            <label class="switch" title="Show on the client page"><input type="checkbox" data-live ${on ? 'checked' : ''} aria-label="Live on client page"><i></i></label></div>
          <div class="si-meta"><span class="dot"></span>${status}</div>
          <div class="si-actions"><button class="pill ghost sm" data-o>Open</button>${on ? '<button class="pill ghost sm" data-edit>Live settings</button><button class="pill ghost sm" data-share>Share</button>' : ''}<button class="pill ghost sm danger" data-d>Delete</button></div>`;
        const nameEl = $('.si-name', row);
        nameEl.value = o.title;
        const rename = async () => {
          const v = nameEl.value.trim();
          if (!v || v === o.title) { nameEl.value = o.title; return; }
          try {
            await api('/api/hotel-offers/offers/' + o.id, { method: 'PATCH', body: { title: v } });
            o.title = v;
            if (state.offerId === o.id) { state.name = v; $('#offerName').value = v; }
          } catch (err) { alert(err.message); nameEl.value = o.title; }
        };
        nameEl.addEventListener('blur', rename);
        nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') nameEl.blur(); });
        $('[data-o]', row).addEventListener('click', () => openOffer(o));
        const ed = $('[data-edit]', row);
        if (ed) ed.addEventListener('click', () => openGoLive({ id: o.id, title: o.title, live: lv }));
        const sh = $('[data-share]', row);
        if (sh) sh.addEventListener('click', () => copyShare(lv.url, offerData(o.id)));
        $('[data-live]', row).addEventListener('change', async e => {
          const box = e.target;
          if (box.checked) { box.checked = false; openGoLive({ id: o.id, title: o.title, live: lv }); return; }
          try { await api(`/api/hotel-offers/offers/${o.id}/live/off`, { method: 'POST' }); toast('Taken off the client page'); loadSaved(); }
          catch (err) { box.checked = true; alert(err.message); }
        });
        $('[data-d]', row).addEventListener('click', async () => {
          if (!confirm('Delete "' + o.title + '"?' + (on ? ' It will also disappear from the client page.' : ''))) return;
          await api('/api/hotel-offers/offers/' + o.id, { method: 'DELETE' });
          if (state.offerId === o.id) state.offerId = null;
          loadSaved();
        });
        list.appendChild(row);
      });
    } catch (e) { say(list, e.message, 'err'); }
  }

  // ---------- go live: pick the template clients will see, then publish its picture
  const gl = { offer: null, data: null, pick: null, busy: false };
  async function openGoLive(o) {
    gl.offer = o; gl.pick = null;
    // an offer that was published before opens as "Live settings" with its previous choices
    gl.editing = !!(o.live && o.live.slug);
    gl.running = !!(gl.editing && o.live.is_live && !o.live.expired);
    $('#glTitle').textContent = gl.editing ? 'Live settings' : 'Go live';
    $('#glGo').textContent = gl.running ? 'Update live page' : 'Go live';
    $('#glOff').hidden = !gl.running;
    $('#glPick').hidden = false; $('#glDone').hidden = true; say($('#glMsg'), '');
    $('#glSub').textContent = o.title;
    $('#glGrid').innerHTML = '<div class="ho-hint">Preparing previews…</div>';
    openModal('liveModal');
    try {
      const r = await api('/api/hotel-offers/offers/' + o.id);
      const sv = r.offer.data;
      gl.data = Object.assign({}, Object.assign(blank(), sv.data), { photos: sv.photos || {}, brand: brand(), layout: sv.layout || {} });
      $('#glValid').value = gl.editing ? (o.live.valid_till || '') : (gl.data.check_in || '');  // editing keeps a cleared date cleared
      $('#glCity').value = gl.data.city || '';
      $('#glBookFrom').value = gl.data.booking_from || ''; $('#glTravelFrom').value = gl.data.travel_from || ''; $('#glTravelTo').value = gl.data.travel_to || '';
      glTravelUi(); glSampleHint();
      $('#glChipCheckin').hidden = !gl.data.check_in;
      glValidUi();
      gl.pick = (o.live && o.live.template_id) || TEMPLATES[0].id;
      const grid = $('#glGrid'); grid.innerHTML = '';
      TEMPLATES.forEach((t, i) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'gl-opt'; b.dataset.id = t.id; b.style.setProperty('--i', i);
        b.innerHTML = `<span class="gl-thumb"><span class="gl-scale"></span></span><span class="gl-name">${t.name}</span><i class="gl-check"></i>`;
        const box = $('.gl-scale', b), k = 150 / t.w;
        box.style.cssText = `width:150px;height:${t.h * k}px`;
        box.innerHTML = t.render(gl.data);
        box.firstElementChild.style.transform = `scale(${k})`;
        b.addEventListener('click', () => { gl.pick = t.id; markPick(); });
        grid.appendChild(b);
      });
      markPick();
    } catch (e) { say($('#glMsg'), e.message, 'err'); }
  }
  const markPick = () => $$('.gl-opt').forEach(b => { b.classList.toggle('on', b.dataset.id === gl.pick); b.setAttribute('aria-pressed', b.dataset.id === gl.pick); });
  async function toJpegDataUrl(canvas) {
    for (const q of [0.9, 0.82, 0.72]) {
      const url = canvas.toDataURL('image/jpeg', q);
      if (url.length < 3.6e6) return url;
    }
    throw new Error('The poster picture is too large to publish.');
  }
  $('#glGo').addEventListener('click', async e => {
    if (gl.busy || !gl.pick) return;
    const btn = e.currentTarget, msg = $('#glMsg'), label = btn.textContent;
    const t = TEMPLATES.find(x => x.id === gl.pick);
    gl.busy = true; btn.disabled = true; btn.textContent = 'Publishing…'; say(msg, 'Preparing the poster…');
    try {
      const canvas = await renderCanvas(t, gl.data, { size: 'native', scale: 1.5 });
      const image = await toJpegDataUrl(canvas);
      say(msg, 'Publishing…');
      const r = await api(`/api/hotel-offers/offers/${gl.offer.id}/live`, { method: 'POST', body: { template_id: t.id, image, width: canvas.width, height: canvas.height, valid_till: $('#glValid').value || null,
        city: $('#glCity').value.trim() || null, booking_from: $('#glBookFrom').value || null, travel_from: $('#glTravelFrom').value || null, travel_to: $('#glTravelTo').value || null } });
      $('#glLink').value = r.live.url;
      api('/api/hotel-offers/dashboard-link').then(d => { $('#glOpen').href = d.url; });
      $('#glPick').hidden = true; $('#glDone').hidden = false;
      $('#glDone h4').textContent = gl.running ? 'Live page updated' : "It's live";
      gl.live = r.live;
      if (state.offerId === gl.offer.id) { const c = $('#glCity').value.trim(); if (c) { state.data.city = c; const f = $('[data-f=city]'); if (f) f.value = c; } }
      if (state.offerId === gl.offer.id) Object.assign(state.data, { booking_from: $('#glBookFrom').value, travel_from: $('#glTravelFrom').value, travel_to: $('#glTravelTo').value }), updateSampleWarn();
      if (state.offerId === gl.offer.id) { state.live = r.live; state.liveStale = false; renderLiveBtn(); }
      if (!$('#savedModal').hidden) loadSaved();
    } catch (err) { say(msg, err.message, 'err'); }
    gl.busy = false; btn.disabled = false; btn.textContent = label;
  });
  const pad2 = n => String(n).padStart(2, '0');
  const isoDay = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  function glValidUi() {
    const v = $('#glValid').value;
    $('#glClear').hidden = !v;
    $('#glValidHint').textContent = v
      ? 'Hides itself after ' + new Date(v + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + '.'
      : 'No end date. It stays live until you switch it off.';
  }
  $('#glValid').addEventListener('input', glValidUi);
  // the travel window and the sample dates it should contain: warn when a sample falls outside it
  function glSampleHint() {
    const n = publishableSamples(gl.data), skipped = incompleteSamples(gl.data).length, el = $('#glSampleHint');
    el.textContent = n > 1 ? `Clients will be able to look through ${n} sample dates.${skipped ? ` ${skipped} incomplete ${skipped === 1 ? 'row is' : 'rows are'} left out.` : ''}`
      : skipped ? 'The extra sample dates are incomplete (each needs check-in, check-out and a price), so only the first is shown.' : 'Only the first sample dates are shown. Add more in the studio to let clients compare.';
  }
  function glTravelUi() {
    const d = Object.assign({}, gl.data, { travel_from: $('#glTravelFrom').value, travel_to: $('#glTravelTo').value }), w = travelWarning(d), el = $('#glTravelWarn');
    el.hidden = !w; el.textContent = w;
  }
  $('#glTravelFrom').addEventListener('input', glTravelUi); $('#glTravelTo').addEventListener('input', glTravelUi);
  $('#glClear').addEventListener('click', () => { $('#glValid').value = ''; $('#glBookFrom').value = ''; glValidUi(); });
  $('#glChipCheckin').addEventListener('click', () => { $('#glValid').value = (gl.data && gl.data.check_in) || ''; glValidUi(); });
  $$('.gl-chips [data-days]').forEach(b => b.addEventListener('click', () => {
    const d = new Date(); d.setDate(d.getDate() + Number(b.dataset.days));
    $('#glValid').value = isoDay(d); glValidUi();
  }));
  $('#glOff').addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await api(`/api/hotel-offers/offers/${gl.offer.id}/live/off`, { method: 'POST' });
      closeModal($('#liveModal'));
      if (state.offerId === gl.offer.id) { state.live = Object.assign({}, state.live, { is_live: false }); state.liveStale = false; renderLiveBtn(); }
      if (!$('#savedModal').hidden) loadSaved();
      toast('Taken off the client page');
    } catch (err) { say($('#glMsg'), err.message, 'err'); }
    btn.disabled = false;
  });
  $('#glCopy').addEventListener('click', async e => { if (await copyText($('#glLink').value)) { e.currentTarget.textContent = 'Copied'; setTimeout(() => { e.currentTarget.textContent = 'Copy'; }, 1500); } });
  $('#glShare').addEventListener('click', () => copyShare($('#glLink').value, Promise.resolve(gl.data)));
  // The studio button mirrors the real state: "Go live" when not published, "Live" with a menu when it is.
  const liveOn = () => !!(state.live && state.live.is_live && !state.live.expired);
  function renderLiveBtn() {
    const b = $('#btnLive');
    if (!b) return;
    const on = liveOn();
    b.classList.toggle('is-on', on); b.classList.toggle('stale', on && state.liveStale);
    b.innerHTML = on
      ? `<i class="live-dot"></i>${state.liveStale ? 'Live · update' : 'Live'}<svg class="caret" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>`
      : '<i class="live-dot off"></i>Go live';
    closeLiveMenu();
  }
  function closeLiveMenu() { const m = $('#liveMenu'); if (m) m.remove(); }
  async function publishFlow() {
    const id = await saveCurrent();
    openGoLive({ id, title: state.name, live: state.live });
  }
  function openLiveMenu() {
    closeLiveMenu();
    const lv = state.live, btn = $('#btnLive'), r = btn.getBoundingClientRect();
    const m = document.createElement('div');
    m.id = 'liveMenu'; m.className = 'live-menu';
    m.style.cssText = `top:${r.bottom + 8}px;left:${Math.max(8, Math.min(r.left, innerWidth - 268))}px`;
    m.innerHTML = `<div class="lm-head"><b>Live on the client page</b><span>${lv.valid_till ? 'Until ' + dayLabel(lv.valid_till) + ' · ' : ''}${lv.views} view${lv.views === 1 ? '' : 's'}</span>${state.liveStale ? '<em>You have changes that are not on the live page yet.</em>' : ''}</div>
      <button data-a="update">${state.liveStale ? 'Update live page' : 'Edit live page'}</button>
      <button data-a="copy">Copy link + caption</button>
      <a href="${lv.url}" target="_blank" rel="noopener" data-a="view">View live page</a>
      <button data-a="off" class="danger">Switch off</button>`;
    document.body.appendChild(m);
    m.addEventListener('click', async e => {
      const t = e.target.closest('[data-a]');
      if (!t) return;
      const act = t.dataset.a;
      if (act !== 'view') closeLiveMenu();
      try {
        if (act === 'update') await publishFlow();
        else if (act === 'copy') copyShare(lv.url, Promise.resolve(state.data));
        else if (act === 'off') {
          await api(`/api/hotel-offers/offers/${state.offerId}/live/off`, { method: 'POST' });
          state.live = Object.assign({}, state.live, { is_live: false }); state.liveStale = false; renderLiveBtn(); toast('Taken off the client page');
        }
      } catch (err) { alert(err.message); }
    });
  }
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#liveMenu, #btnLive')) closeLiveMenu(); });
  $('#btnLive').addEventListener('click', async e => {
    const btn = e.currentTarget;
    if (!state.data.brand_line && !state.data.hotel_name) return;
    if (liveOn()) { if ($('#liveMenu')) closeLiveMenu(); else openLiveMenu(); return; }
    btn.disabled = true;
    try { await publishFlow(); } catch (err) { alert(err.message); }
    btn.disabled = false;
  });

  // ---------- leads
  const LEAD_LABEL = { new: 'New', contacted: 'Contacted', won: 'Won', lost: 'Lost' };
  const ls = { st: 'all', q: '' };
  const initials = n => n.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  const hue = n => Array.from(n).reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  function ago(iso) {
    const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
    if (m < 1) return 'just now'; if (m < 60) return m + 'm ago';
    if (m < 1440) return Math.round(m / 60) + 'h ago';
    if (m < 10080) return Math.round(m / 1440) + 'd ago';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function setBadge(n) { const b = $('#leadBadge'); b.hidden = !n; b.textContent = n > 99 ? '99+' : n; }
  async function pollLeads() { try { setBadge((await api('/api/hotel-offers/leads/summary')).new); } catch (e) { /* not signed in or offline */ } }
  async function loadLeads() {
    const list = $('#leadList');
    const qs = `status=${ls.st === 'all' ? '' : ls.st}&q=${encodeURIComponent(ls.q)}`;
    $('#btnCsv').href = '/api/hotel-offers/leads.csv?' + qs;
    try {
      const r = await api('/api/hotel-offers/leads?' + qs);
      const total = r.total;
      $$('#leadTabs button').forEach(b => { $('b', b).textContent = b.dataset.st === 'all' ? total : r.counts[b.dataset.st] || 0; });
      setBadge(r.counts.new || 0);
      list.innerHTML = '';
      if (!r.leads.length) {
        list.innerHTML = `<div class="lead-empty"><b>${total ? 'No leads match' : 'No leads yet'}</b><span>${total ? 'Try another filter or search.' : 'When a client taps Book now on the client page, they appear here.'}</span></div>`;
        return;
      }
      r.leads.forEach((l, i) => {
        const wa = 'https://wa.me/' + l.phone.replace(/\D/g, '');
        const el = document.createElement('article');
        el.className = 'lead' + (l.status === 'new' ? ' is-new' : '');
        el.style.setProperty('--i', Math.min(i, 8));
        el.innerHTML = `<div class="av" style="background:hsl(${hue(l.name)} 45% 90%);color:hsl(${hue(l.name)} 40% 28%)">${initials(l.name)}</div>
          <div class="lead-main">
            <div class="lead-top"><b></b><span class="ago">${ago(l.created_at)}</span></div>
            <div class="lead-offer"></div>
            ${l.stay_from ? `<div class="lead-stay">Stay ${dayLabel(l.stay_from)} – ${dayLabel(l.stay_to)} · ${Math.round((new Date(l.stay_to) - new Date(l.stay_from)) / 864e5)} nights</div>` : ''}
            <div class="lead-contact"><a href="tel:${l.phone}">${l.phone}</a><a href="${wa}" target="_blank" rel="noopener">WhatsApp</a></div>
            <textarea class="lead-note" rows="1" placeholder="Add a note…" maxlength="2000"></textarea>
          </div>
          <div class="lead-side"><select class="st st-${l.status}" aria-label="Status">${Object.keys(LEAD_LABEL).map(k => `<option value="${k}" ${k === l.status ? 'selected' : ''}>${LEAD_LABEL[k]}</option>`).join('')}</select>
            <button class="lead-trip pill ghost sm">${l.trip_id ? 'Open trip' : 'Convert to trip'}</button>
            <button class="lead-del" aria-label="Delete lead" title="Delete">&times;</button></div>`;
        $('b', el).textContent = l.name; $('.lead-offer', el).textContent = l.offer_title;
        const note = $('.lead-note', el); note.value = l.note;
        const grow = () => { note.style.height = 'auto'; note.style.height = Math.min(note.scrollHeight, 140) + 'px'; };
        note.addEventListener('input', grow); requestAnimationFrame(grow);
        note.addEventListener('blur', async () => { if (note.value !== l.note) { try { await api('/api/hotel-offers/leads/' + l.id, { method: 'PATCH', body: { note: note.value } }); l.note = note.value; } catch (e) { alert(e.message); } } });
        $('select', el).addEventListener('change', async e => {
          const sel = e.target;
          try { await api('/api/hotel-offers/leads/' + l.id, { method: 'PATCH', body: { status: sel.value } }); l.status = sel.value; loadLeads(); } catch (err) { alert(err.message); sel.value = l.status; }
        });
        $('.lead-trip', el).addEventListener('click', async e => {
          const btn = e.currentTarget; btn.disabled = true;
          try {
            const id = l.trip_id || (await api('/api/hotel-offers/leads/' + l.id + '/to-trip', { method: 'POST' })).trip.id;
            location.href = '/hotel-offers/trips#trip/' + id;
          } catch (err) { alert(err.message); btn.disabled = false; }
        });
        $('.lead-del', el).addEventListener('click', async () => {
          if (!confirm('Delete the lead from ' + l.name + '?')) return;
          await api('/api/hotel-offers/leads/' + l.id, { method: 'DELETE' }); loadLeads();
        });
        list.appendChild(el);
      });
    } catch (e) { list.innerHTML = ''; say(list, e.message, 'err'); }
  }
  // The Leads icon toggles: tap again (or "Offers") to return to exactly where you were, scroll position included
  let leadsReturn = { stage: 'paste', y: 0 };
  function leaveLeads() {
    setStage(leadsReturn.stage);
    requestAnimationFrame(() => window.scrollTo({ top: leadsReturn.y, behavior: 'instant' }));
  }
  $('#btnLeads').addEventListener('click', () => {
    const stage = app.dataset.stage;
    if (stage === 'leads') { leaveLeads(); return; }
    if (stage === 'process') return;  // an offer is being generated
    leadsReturn = { stage, y: window.scrollY };
    setStage('leads'); loadLeads();
  });
  $('#btnLeadsBack').addEventListener('click', leaveLeads);
  $('#leadTabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    ls.st = b.dataset.st; $$('#leadTabs button').forEach(x => x.classList.toggle('on', x === b)); loadLeads();
  });
  $('#leadSearch').addEventListener('input', debounce(e => { ls.q = e.target.value.trim(); loadLeads(); }, 250));
  setTimeout(pollLeads, 1500); setInterval(() => { if (!document.hidden) pollLeads(); }, 60000);

  // ---------- settings
  async function loadSettings() {
    const r = await api('/api/hotel-offers/settings');
    state.settings = r.settings; state.smtpReady = r.smtp_ready;
    return r.settings;
  }
  function fillSettings() {
    const s = state.settings;
    $$('[data-s]').forEach(el => {
      const k = el.dataset.s;
      if (el.type === 'checkbox') el.checked = !!s[k]; else el.value = s[k] == null ? '' : s[k];
      el.disabled = !CAN_CONFIGURE;
    });
    $$('[data-keystate]').forEach(el => {
      const k = el.dataset.keystate;
      el.textContent = s[k + '_set'] ? `(saved ${s[k + '_hint']})` : '(not set)';
    });
    $('#smtpNote').textContent = state.smtpReady ? '' : '(email is not set up on the server yet)';
    setTimeout(markSettingsClean, 0);
    $('#settingsRO').hidden = CAN_CONFIGURE;
    $('#btnSaveSettings').hidden = !CAN_CONFIGURE;
    $$('[data-test]').forEach(b => { b.disabled = !CAN_CONFIGURE; });
    syncMapTemplate();
    modelList();
  }
  function syncMapTemplate() {
    const sel = $('#mapTemplate'), url = $('#mapTileUrl').value;
    sel.value = [...sel.options].some(o => o.value === url) ? url : '';
    sel.disabled = !CAN_CONFIGURE;
  }
  $('#mapTemplate').addEventListener('change', e => {
    if (!e.target.value) { $('#mapTileUrl').focus(); return; }
    $('#mapTileUrl').value = e.target.value;
    $('#mapTileUrl').dispatchEvent(new Event('input', { bubbles: true }));
  });
  function modelList() {
    const p = $('[data-s=ai_provider]').value;
    $('#modelList').innerHTML = (MODELS[p] || []).map(m => `<option value="${m}">`).join('');
  }
  $('[data-s=ai_provider]').addEventListener('change', () => {
    modelList();
    const model = $('[data-s=ai_model]'), all = [].concat(...Object.values(MODELS));
    if (!model.value || all.includes(model.value)) model.value = MODELS[$('[data-s=ai_provider]').value][0];
  });
  $$('.ho-tabs button').forEach(b => b.addEventListener('click', () => {
    $$('.ho-tabs button').forEach(x => x.classList.toggle('on', x === b));
    $$('.ho-tabpane').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.tab; });
  }));
  $('#btnSettings').addEventListener('click', async () => {
    try {
      await loadSettings(); fillSettings(); openModal('settingsModal');
      api('/api/hotel-offers/dashboard-link').then(d => { $('#clientLink').value = d.url; $('#clientLinkOpen').href = d.url; }).catch(() => {});
    } catch (e) { alert(e.message); }
  });
  $('#clientLinkCopy').addEventListener('click', async e => { if (await copyText($('#clientLink').value)) { e.currentTarget.textContent = 'Copied'; setTimeout(() => { e.currentTarget.textContent = 'Copy'; }, 1500); } });
  function collectSettings() {
    const out = {};
    $$('[data-s]').forEach(el => { out[el.dataset.s] = el.type === 'checkbox' ? el.checked : el.value; });
    return out;
  }
  // Save settings: disabled until something changes, shows Saving, then a clear confirmation
  let settingsSnap = '', savingSettings = false;
  const settingsDirty = () => $$('[data-s]').length > 0 && JSON.stringify(collectSettings()) !== settingsSnap;
  function syncSaveBtn() {
    const btn = $('#btnSaveSettings'), msg = $('#settingsMsg');
    if (!btn || btn.dataset.busy) return;
    const dirty = settingsDirty();
    btn.disabled = !dirty || savingSettings; btn.textContent = 'Save settings';
    if (!msg.classList.contains('err')) say(msg, dirty ? 'You have unsaved changes' : '', dirty ? 'warn' : '');
  }
  function markSettingsClean() { settingsSnap = JSON.stringify(collectSettings()); $('#settingsMsg').className = 'ho-hint'; syncSaveBtn(); }
  $$('[data-s]').forEach(el => { el.addEventListener('input', () => { $('#settingsMsg').classList.remove('err'); syncSaveBtn(); }); el.addEventListener('change', syncSaveBtn); });
  $('#btnSaveSettings').addEventListener('click', async () => {
    const btn = $('#btnSaveSettings'), msg = $('#settingsMsg');
    if (btn.disabled || savingSettings) return;
    savingSettings = true; btn.dataset.busy = '1'; btn.disabled = true; btn.classList.add('busy'); btn.textContent = 'Saving…'; say(msg, '');
    try {
      const r = await api('/api/hotel-offers/settings', { method: 'PUT', body: collectSettings() });
      state.settings = r.settings; fillSettings(); refresh();
      btn.classList.remove('busy'); btn.classList.add('ok'); btn.textContent = 'Saved';
      say(msg, 'All changes saved', 'ok'); toast('Settings saved');
      setTimeout(() => { delete btn.dataset.busy; btn.classList.remove('ok'); savingSettings = false; markSettingsClean(); }, 1500);
    } catch (e) {
      btn.classList.remove('busy'); delete btn.dataset.busy; savingSettings = false;
      say(msg, e.message, 'err'); btn.disabled = false; btn.textContent = 'Save settings';
    }
  });
  $$('[data-test]').forEach(b => b.addEventListener('click', async () => {
    const kind = b.dataset.test, msg = $(`[data-testmsg=${kind}]`);
    say(msg, 'Testing…');
    try {
      // test what is on screen: save first so typed keys are used
      await api('/api/hotel-offers/settings', { method: 'PUT', body: collectSettings() });
      state.settings = (await api('/api/hotel-offers/settings')).settings; fillSettings(); toast('Settings saved');
      const r = await api('/api/hotel-offers/settings/test', { method: 'POST', body: { kind } });
      say(msg, r.message, 'ok');
    } catch (e) { say(msg, e.message, 'err'); }
  }));

  // ---------- init
  buildGallery();
  (async function init() {
    try { await loadSettings(); } catch (e) { state.settings = {}; }
    try { localStorage.removeItem('ho_draft'); } catch (e) { /* old drafts are no longer used */ }
    fillForm(); refresh();
  })();
})();
