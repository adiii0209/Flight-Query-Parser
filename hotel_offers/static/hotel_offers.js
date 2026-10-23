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

  const state = { data: blank(), photos: {}, selected: new Set(), offerId: null, settings: null, picker: null };

  function blank() {
    return { brand_line: '', place_line: '', tagline: '', offer_headline: '', currency: 'INR', online_rate: 0, our_deal: 0, perks: [],
      hotel_name: '', room: '', check_in: '', check_out: '', nights: 0, adults: 0, rooms: 0, net_total: 0, free_nights: 0, cancellation: '', photo_query: '', city: '' };
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
    const s = state.settings || {};
    return { name: s.brand_name || 'Time Elevate', tagline: s.brand_tagline || 'Luxury stays.\nMore to enjoy.', header_note: s.brand_header_note || '',
      footer: s.brand_footer || 'Curated by Time Tours', est: s.brand_est || 'EST. 1978', enquire: s.enquire_label || 'Enquire now',
      loyalty: s.loyalty_note || '', availability: s.availability_note || '' };
  }
  const posterData = () => Object.assign({}, state.data, { photos: state.photos, brand: brand() });

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
  const closeModal = el => { el.hidden = true; };
  $$('.ho-modal').forEach(m => {
    m.addEventListener('mousedown', e => { if (e.target === m) closeModal(m); });
    $$('[data-close]', m).forEach(b => b.addEventListener('click', () => closeModal(m)));
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.ho-modal').forEach(closeModal); });

  // ---------- form <-> state
  function fillForm() {
    $$('[data-f]').forEach(inp => { const v = state.data[inp.dataset.f]; inp.value = v == null || v === 0 && NUMERIC.has(inp.dataset.f) && inp.dataset.f !== 'free_nights' ? (v || '') : v; });
    renderPerks();
    renderSlots();
    updatePriceHint();
  }
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
    refresh();
  }));

  function renderPerks() {
    const box = $('#perkRows');
    box.innerHTML = '';
    state.data.perks.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'perk-row';
      row.innerHTML = `<select>${ICON_OPTIONS.map(([v, l]) => `<option value="${v}" ${v === p.icon ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <textarea rows="2" placeholder="TWO LINE\nLABEL"></textarea><button type="button" title="Remove" aria-label="Remove perk">&times;</button>`;
      $('textarea', row).value = p.label;
      $('select', row).addEventListener('change', e => { p.icon = e.target.value; refresh(); });
      $('textarea', row).addEventListener('input', e => { p.label = e.target.value; refresh(); });
      $('button', row).addEventListener('click', () => { state.data.perks.splice(i, 1); renderPerks(); refresh(); });
      box.appendChild(row);
    });
    $('#btnAddPerk').disabled = state.data.perks.length >= 4;
  }
  $('#btnAddPerk').addEventListener('click', () => {
    if (state.data.perks.length < 4) { state.data.perks.push({ icon: 'gift', label: '' }); renderPerks(); }
  });

  // ---------- stages
  const app = $('#app');
  const setStage = name => { app.dataset.stage = name; window.scrollTo({ top: 0 }); if (name === 'studio') requestAnimationFrame(() => { layoutScale(); }); };
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
      state.photos = {}; state.offerId = null;
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
        <div class="ho-tpl-actions"><button class="pill ghost sm" data-act="dl">Download</button><button class="pill ghost sm" data-act="copy">Copy image</button></div>`;
      $('input', card).addEventListener('change', e => {
        e.target.checked ? state.selected.add(t.id) : state.selected.delete(t.id);
        card.classList.toggle('sel', e.target.checked);
        $('#selAll').checked = state.selected.size === TEMPLATES.length;
      });
      $('[data-act=dl]', card).addEventListener('click', e => run(e.currentTarget, () => download(t)));
      $('[data-act=copy]', card).addEventListener('click', e => run(e.currentTarget, () => copyImage(t)));
      gal.appendChild(card);
      cards.set(t.id, card);
    });
    const ro = new ResizeObserver(layoutScale);
    ro.observe(gal);
  }
  function layoutScale() {
    TEMPLATES.forEach(t => {
      const card = cards.get(t.id), view = $('.ho-tpl-view', card), box = $('.ho-tpl-scale', card);
      const avail = view.clientWidth - 20;
      if (avail <= 0) return;
      const k = avail / t.w;
      box.style.width = t.w * k + 'px'; box.style.height = t.h * k + 'px';
      const po = box.firstElementChild;
      if (po) po.style.transform = `scale(${k})`;
    });
  }
  function refresh() {
    const has = !!(state.data.brand_line || state.data.place_line || state.data.hotel_name);
    $('#studioTitle').textContent = [state.data.brand_line, state.data.place_line].filter(Boolean).join(' ') || state.data.hotel_name || '';
    $('#galleryEmpty').hidden = has;
    $('#gallery').hidden = !has;
    if (!has) return;
    const d = posterData();
    TEMPLATES.forEach(t => { $('.ho-tpl-scale', cards.get(t.id)).innerHTML = t.render(d); });
    layoutScale();
    saveDraft();
  }
  const saveDraft = debounce(() => {
    const photos = {};
    Object.keys(state.photos).forEach(k => { if (!state.photos[k].startsWith('data:')) photos[k] = state.photos[k]; });
    store.set('ho_draft', { data: state.data, photos, raw: $('#rawText').value });
  }, 400);
  $('#rawText').addEventListener('input', saveDraft);

  $('#selAll').addEventListener('change', e => {
    state.selected.clear();
    $$('.ho-tpl').forEach((c, i) => {
      $('input', c).checked = e.target.checked; c.classList.toggle('sel', e.target.checked);
      if (e.target.checked) state.selected.add(TEMPLATES[i].id);
    });
  });

  // ---------- export
  async function run(btn, fn) {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Working…';
    try { await fn(); } catch (e) { alert(e.message || 'Export failed'); }
    btn.disabled = false; btn.textContent = label;
  }
  async function renderCanvas(t) {
    const d = posterData();
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-30000px;top:0';
    host.innerHTML = t.render(d);
    document.body.appendChild(host);
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const el = host.firstElementChild;
      const size = $('#outSize').value;
      let W = t.w * 2, H = t.h * 2, k = 2;
      if (size !== 'native') {
        [W, H] = size.split('x').map(Number);
        k = Math.min(W / t.w, H / t.h);
      }
      const shot = await html2canvas(el, { scale: k, useCORS: true, backgroundColor: null, logging: false });
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

  function caption() {
    const d = state.data, b = brand();
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
    lines.push('', b.availability, b.footer);
    return lines.join('\n');
  }
  $('#btnCopyCaption').addEventListener('click', async e => {
    const btn = e.currentTarget;
    try { await navigator.clipboard.writeText(caption()); btn.textContent = 'Copied'; } catch (err) { alert('Could not copy. ' + err.message); }
    setTimeout(() => { btn.textContent = 'Copy caption'; }, 1500);
  });

  // ---------- saved offers
  $('#btnSaved').addEventListener('click', () => { openModal('savedModal'); loadSaved(); });
  async function loadSaved() {
    const list = $('#savedList');
    list.textContent = 'Loading…';
    try {
      const { offers } = await api('/api/hotel-offers/offers');
      list.innerHTML = offers.length ? '' : '<div class="ho-hint">Nothing saved yet.</div>';
      offers.forEach(o => {
        const row = document.createElement('div');
        row.className = 'ho-saved-item';
        row.innerHTML = `<b></b><small>${new Date(o.updated_at).toLocaleDateString('en-GB')}</small><button class="pill ghost sm" data-o>Open</button><button class="pill ghost sm" data-d>Delete</button>`;
        $('b', row).textContent = o.title;
        $('[data-o]', row).addEventListener('click', async () => {
          const r = await api('/api/hotel-offers/offers/' + o.id);
          state.data = Object.assign(blank(), r.offer.data.data); state.photos = r.offer.data.photos || {}; state.offerId = o.id;
          fillForm(); refresh(); closeModal($('#savedModal'));
        });
        $('[data-d]', row).addEventListener('click', async () => {
          if (!confirm('Delete this saved offer?')) return;
          await api('/api/hotel-offers/offers/' + o.id, { method: 'DELETE' });
          if (state.offerId === o.id) state.offerId = null;
          loadSaved();
        });
        list.appendChild(row);
      });
    } catch (e) { say(list, e.message, 'err'); }
  }
  $('#btnSaveCurrent').addEventListener('click', async () => {
    const msg = $('#saveMsg');
    if (!state.data.hotel_name && !state.data.brand_line) { say(msg, 'Nothing to save yet.', 'err'); return; }
    try {
      const r = await api('/api/hotel-offers/offers', { method: 'POST', body: { id: state.offerId, data: { data: state.data, photos: state.photos } } });
      state.offerId = r.offer.id; say(msg, 'Saved.', 'ok'); loadSaved();
    } catch (e) { say(msg, e.message, 'err'); }
  });

  // ---------- settings
  async function loadSettings() {
    const r = await api('/api/hotel-offers/settings');
    state.settings = r.settings;
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
    $('#settingsRO').hidden = CAN_CONFIGURE;
    $('#btnSaveSettings').hidden = !CAN_CONFIGURE;
    $$('[data-test]').forEach(b => { b.disabled = !CAN_CONFIGURE; });
    modelList();
  }
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
    try { await loadSettings(); fillSettings(); openModal('settingsModal'); } catch (e) { alert(e.message); }
  });
  function collectSettings() {
    const out = {};
    $$('[data-s]').forEach(el => { out[el.dataset.s] = el.type === 'checkbox' ? el.checked : el.value; });
    return out;
  }
  $('#btnSaveSettings').addEventListener('click', async () => {
    const msg = $('#settingsMsg');
    try {
      const r = await api('/api/hotel-offers/settings', { method: 'PUT', body: collectSettings() });
      state.settings = r.settings; fillSettings(); say(msg, 'Saved.', 'ok'); refresh();
    } catch (e) { say(msg, e.message, 'err'); }
  });
  $$('[data-test]').forEach(b => b.addEventListener('click', async () => {
    const kind = b.dataset.test, msg = $(`[data-testmsg=${kind}]`);
    say(msg, 'Testing…');
    try {
      // test what is on screen: save first so typed keys are used
      await api('/api/hotel-offers/settings', { method: 'PUT', body: collectSettings() });
      state.settings = (await api('/api/hotel-offers/settings')).settings; fillSettings();
      const r = await api('/api/hotel-offers/settings/test', { method: 'POST', body: { kind } });
      say(msg, r.message, 'ok');
    } catch (e) { say(msg, e.message, 'err'); }
  }));

  // ---------- init
  buildGallery();
  (async function init() {
    try { await loadSettings(); } catch (e) { state.settings = {}; }
    const draft = store.get('ho_draft');
    if (draft && draft.data) {
      state.data = Object.assign(blank(), draft.data); state.photos = draft.photos || {};
      $('#rawText').value = draft.raw || '';
    }
    fillForm(); refresh();
    if (draft && draft.data && (draft.data.brand_line || draft.data.hotel_name)) setStage('studio');
  })();
})();
