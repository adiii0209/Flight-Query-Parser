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

  const state = { data: blank(), photos: {}, selected: new Set(), offerId: null, name: '', dirty: false, layout: {}, editing: null, settings: null, picker: null };

  function blank() {
    return { brand_line: '', place_line: '', tagline: '', offer_headline: '', headline_scale: 100, currency: 'INR', online_rate: 0, our_deal: 0, perks: [],
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
    updateHlVal();
  }
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
      state.photos = {}; state.layout = {}; state.offerId = null; state.name = defaultName(); $('#offerName').value = state.name;
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
        <div class="ho-tpl-actions"><button class="pill ghost sm" data-act="dl">Download</button><button class="pill ghost sm" data-act="copy">Copy image</button><button class="pill ghost sm" data-act="edit">Enlarge</button></div>
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
        tpl: () => t, k: () => box.getBoundingClientRect().width / t.w,
        onSelect: (name, scale) => { tools.hidden = !name; $('.tt-name', tools).textContent = name ? `${name} · ${Math.round(scale * 100)}%` : ''; },
      });
      $('[data-t=minus]', tools).addEventListener('click', () => editor.resize(-0.05));
      $('[data-t=plus]', tools).addEventListener('click', () => editor.resize(0.05));
      $('[data-t=reset]', tools).addEventListener('click', () => editor.resetSel());
      card.editor = editor;
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
    if (app.dataset.stage === 'studio') state.dirty = true;
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
      if (e.target.dataset && e.target.dataset.handle && sel) {
        const er = sel.getBoundingClientRect(), v = getOff(selKey);
        drag = { type: 'resize', el: sel, ox: er.left, oy: er.top, d0: Math.hypot(e.clientX - er.left, e.clientY - er.top) || 1, s0: v.s, v };
        host.setPointerCapture(e.pointerId); e.preventDefault(); return;
      }
      const el = e.target.closest('[data-k]');
      const was = el && el === sel;
      select(el);
      if (!el) return;
      if (e.pointerType === 'touch' && !was) return; // first tap only selects, so the page can still scroll
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
    tpl: () => state.editing, k: () => le.k,
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
  async function renderCanvas(t) {
    const d = posterData();
    const host = document.createElement('div');
    // Attach outside <body> (apps may zoom body on phones) and behind the page; layout is sized by the poster itself.
    host.style.cssText = `position:fixed;left:0;top:0;width:${t.w}px;height:${t.h}px;z-index:-1;pointer-events:none`;
    host.innerHTML = t.render(d);
    document.documentElement.appendChild(host);
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const el = host.firstElementChild;
      const size = $('#outSize').value;
      let W = t.w * 2, H = t.h * 2, k = 2;
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

  // ---------- naming + saving
  const defaultName = () => [state.data.brand_line, state.data.place_line].filter(Boolean).join(' ') || state.data.hotel_name || 'Untitled offer';
  $('#offerName').addEventListener('input', e => { state.name = e.target.value; state.dirty = true; });
  $('#btnSave').addEventListener('click', async e => {
    const btn = e.currentTarget, label = btn.textContent;
    const name = ($('#offerName').value || '').trim() || defaultName();
    $('#offerName').value = state.name = name;
    btn.disabled = true;
    try {
      const r = await api('/api/hotel-offers/offers', { method: 'POST', body: { id: state.offerId, title: name, data: { data: state.data, photos: state.photos, layout: state.layout } } });
      state.offerId = r.offer.id; state.dirty = false;
      btn.textContent = 'Saved';
    } catch (err) { btn.textContent = 'Not saved'; alert(err.message); }
    btn.disabled = false;
    setTimeout(() => { btn.textContent = label; }, 1600);
  });
  window.addEventListener('beforeunload', e => { if (state.dirty && app.dataset.stage === 'studio') { e.preventDefault(); e.returnValue = ''; } });

  // ---------- saved offers drawer
  $$('.js-open-saved').forEach(b => b.addEventListener('click', () => { openModal('savedModal'); loadSaved(); }));
  async function loadSaved() {
    const list = $('#savedList');
    list.textContent = 'Loading…';
    try {
      const { offers } = await api('/api/hotel-offers/offers');
      list.innerHTML = offers.length ? '' : '<div class="ho-hint">Nothing saved yet. Generate an offer, name it and press Save.</div>';
      offers.forEach(o => {
        const row = document.createElement('div');
        row.className = 'ho-saved-item';
        row.innerHTML = `<div class="si-main"><input class="si-name" maxlength="120" aria-label="Offer name"><small>${new Date(o.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</small></div>
          <button class="pill primary sm" data-o>Open</button><button class="pill ghost sm" data-d>Delete</button>`;
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
        $('[data-o]', row).addEventListener('click', async () => {
          const r = await api('/api/hotel-offers/offers/' + o.id);
          state.data = Object.assign(blank(), r.offer.data.data); state.photos = r.offer.data.photos || {}; state.layout = r.offer.data.layout || {};
          state.offerId = o.id; state.name = o.title; $('#offerName').value = o.title;
          fillForm(); refresh(); state.dirty = false;
          closeModal($('#savedModal')); setStage('studio');
        });
        $('[data-d]', row).addEventListener('click', async () => {
          if (!confirm('Delete "' + o.title + '"?')) return;
          await api('/api/hotel-offers/offers/' + o.id, { method: 'DELETE' });
          if (state.offerId === o.id) state.offerId = null;
          loadSaved();
        });
        list.appendChild(row);
      });
    } catch (e) { say(list, e.message, 'err'); }
  }

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
    try { localStorage.removeItem('ho_draft'); } catch (e) { /* old drafts are no longer used */ }
    fillForm(); refresh();
  })();
})();
