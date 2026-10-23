(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const boot = JSON.parse($('#boot').textContent || '{}');
  const ORG = document.body.dataset.org, FOCUS = document.body.dataset.focus;
  const HOME = '/offers/' + ORG;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const desktop = () => window.matchMedia('(min-width: 900px)').matches;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  let offers = [], filter = 'All', current = null, lastFocus = null, io = null, pushed = false;

  // ---------- formatting
  const place = o => o.place_line || o.city || '';
  const money = (o, n) => n ? `${o.currency || 'INR'} ${Math.round(n).toLocaleString('en-US')}` : '';
  const day = s => (s ? new Date(s + 'T00:00:00') : null);
  function range(o) {
    const a = day(o.check_in), b = day(o.check_out);
    if (!a || !b) return '';
    const m = d => d.toLocaleDateString('en-GB', { month: 'short' });
    return a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} ${m(b)} ${b.getFullYear()}` : `${a.getDate()} ${m(a)} – ${b.getDate()} ${m(b)} ${b.getFullYear()}`;
  }
  const nights = o => o.nights || (day(o.check_in) && day(o.check_out) ? Math.round((day(o.check_out) - day(o.check_in)) / 864e5) : 0);
  const saving = o => (o.online_rate > o.our_deal && o.our_deal > 0 ? Math.round((1 - o.our_deal / o.online_rate) * 100) : 0);
  const validTill = o => (o.valid_till ? 'Valid till ' + day(o.valid_till).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
  // Sentence-case a perk label ("USD 100 RESORT CREDITS*" becomes "USD 100 resort credits"), keeping codes like USD and VIP upper-case
  const KEEP = new Set(['USD', 'INR', 'EUR', 'GBP', 'AED', 'SGD', 'VIP', 'WIFI', 'SPA']);
  const sentence = p => p.replace(/\*/g, '').replace(/\s+/g, ' ').trim().split(' ').map(w => (KEEP.has(w.toUpperCase()) ? w.toUpperCase() : w.toLowerCase())).join(' ').replace(/^./, c => c.toUpperCase());
  const waBase = () => 'https://wa.me/' + String(boot.whatsapp_number || '').replace(/\D/g, '');

  // ---------- toast
  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- nav
  const nav = $('#nav');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  $('#navWa').href = waBase() + '?text=' + encodeURIComponent('Hi Time Tours, I would like to know more about your current offers.');
  $('#emptyWa').href = $('#navWa').href;

  // ---------- list
  function chipsFor(list) {
    const places = Array.from(new Set(list.map(place).filter(Boolean)));
    const wrap = $('#chipsWrap'), chips = $('#chips');
    wrap.hidden = places.length < 2;
    if (wrap.hidden) { filter = 'All'; return; }
    chips.innerHTML = ['All'].concat(places).map(p => `<button class="chip" role="tab" aria-selected="${p === filter}" data-p="${esc(p)}">${esc(p)}</button>`).join('');
  }
  $('#chips').addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    filter = b.dataset.p;
    $$('.chip').forEach(c => c.setAttribute('aria-selected', c === b));
    b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    renderGrid();
  });

  function renderGrid() {
    const grid = $('#grid'), list = offers.filter(o => filter === 'All' || place(o) === filter);
    $('#empty').hidden = offers.length > 0;
    grid.hidden = offers.length === 0;
    grid.innerHTML = list.map((o, i) => {
      const sv = saving(o);
      return `<article class="card" tabindex="0" role="button" data-slug="${esc(o.slug)}" aria-label="${esc(o.title || o.hotel_name)}, view offer" style="transition-delay:${Math.min(i, 5) * 70}ms">
        <div class="card-media"><img src="${esc(o.image)}" alt="" loading="${i < 3 ? 'eager' : 'lazy'}" decoding="async"></div>
        <div class="card-body">
          ${place(o) || o.offer_headline ? `<div class="card-place">${esc(place(o))}${place(o) && o.offer_headline ? '<i></i>' : ''}${o.offer_headline ? `<span>${esc(o.offer_headline)}</span>` : ''}</div>` : ''}
          <h3>${esc(o.title || o.hotel_name)}</h3>
          <div class="card-meta">${esc([range(o), nights(o) ? nights(o) + ' nights' : ''].filter(Boolean).join(' · ') || validTill(o))}</div>
          ${o.our_deal ? `<div class="card-price"><b>${esc(money(o, o.our_deal))}</b>${o.online_rate > o.our_deal ? `<s>${esc(money(o, o.online_rate))}</s>` : ''}${sv ? `<em>Save ${sv}%</em>` : ''}</div>` : ''}
        </div></article>`;
    }).join('');
    $$('.card img', grid).forEach(img => { const done = () => img.classList.add('ready'); img.complete ? done() : (img.onload = done, img.onerror = done); });
    if (io) io.disconnect();
    if (reduced || !('IntersectionObserver' in window)) { $$('.card', grid).forEach(c => c.classList.add('in')); return; }
    io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px' });
    $$('.card', grid).forEach(c => io.observe(c));
  }
  const openFromEvent = e => {
    const c = e.target.closest('.card');
    if (c && (e.type === 'click' || e.key === 'Enter' || e.key === ' ')) { if (e.type === 'keydown') e.preventDefault(); openSheet(c.dataset.slug, true, c); }
  };
  $('#grid').addEventListener('click', openFromEvent);
  $('#grid').addEventListener('keydown', openFromEvent);

  // ---------- sheet
  const root = $('#sheetRoot'), sheet = $('#sheet'), panels = $('#panels');
  function setStep(step) {
    panels.dataset.step = step;
    sheet.classList.toggle('step-book', step === 'book');
    sheet.classList.toggle('step-done', step === 'done');
    $('#sScroll').scrollTop = 0;
    if (step === 'book') setTimeout(() => { if (!$('#inName').value) $('#inName').focus({ preventScroll: true }); else $('#inPhone').focus({ preventScroll: true }); }, 420);
  }
  function fillSheet(o) {
    const img = $('#sImg');
    img.classList.remove('ready'); img.alt = (o.title || o.hotel_name) + ' offer poster';
    img.onload = () => img.classList.add('ready'); img.src = o.image;
    if (img.complete) img.classList.add('ready');
    $('.s-poster').classList.remove('full');
    $('#sPlace').textContent = place(o);
    $('#sTitle').textContent = o.title || o.hotel_name;
    $('#sTag').textContent = o.tagline || ''; $('#sTag').hidden = !o.tagline;
    const chip = $('#sOffer'); chip.textContent = o.offer_headline || ''; chip.hidden = !o.offer_headline;
    const facts = [];
    if (range(o)) facts.push(['Stay', range(o) + (nights(o) ? ` · ${nights(o)} nights` : '')]);
    if (o.adults || o.rooms) facts.push(['Guests', [o.adults && `${o.adults} adults`, o.rooms && `${o.rooms} room${o.rooms > 1 ? 's' : ''}`].filter(Boolean).join(' · ')]);
    if (o.room) facts.push(['Room', o.room]);
    $('#sFacts').innerHTML = facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    $('#sFacts').hidden = !facts.length;
    const check = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    $('#sIncl').innerHTML = (o.perks || []).map((p, i) => `<li style="--i:${i}">${check}<span>${esc(sentence(p))}</span></li>`).join('');
    $('#sIncl').previousElementSibling.hidden = !(o.perks || []).length;
    $('#pcNew').textContent = money(o, o.our_deal) || 'On request';
    $('#pcOld').textContent = o.online_rate > o.our_deal ? money(o, o.online_rate) : '';
    $('#pcSave').textContent = saving(o) ? `Save ${saving(o)}%` : '';
    $('#sValid').textContent = validTill(o);
    $('#bSub').textContent = `Share your details and we'll continue on WhatsApp about ${o.title || o.hotel_name}.`;
    const mem = store.get('ho_client') || {};
    $('#inName').value = mem.name || ''; $('#inPhone').value = mem.phone || '';
    $$('.field').forEach(f => f.classList.remove('bad'));
    $('#bSubmit').classList.remove('busy'); $('#bSubmit').disabled = false;
    setStep('details');
  }
  function openSheet(slug, push, from) {
    const o = offers.find(x => x.slug === slug);
    if (!o) return;
    current = o; lastFocus = from || document.activeElement;
    fillSheet(o);
    root.hidden = false;
    document.documentElement.classList.add('lock');
    sheet.style.transform = '';
    requestAnimationFrame(() => requestAnimationFrame(() => { root.classList.add('open'); sheet.focus({ preventScroll: true }); }));
    if (push) { history.pushState({ o: slug }, '', '/o/' + slug); pushed = true; }
    try { if (!sessionStorage.getItem('ho_v_' + slug)) { sessionStorage.setItem('ho_v_' + slug, '1'); fetch(`/api/public/offers/${encodeURIComponent(slug)}/view`, { method: 'POST', keepalive: true }); } } catch (e) { /* analytics only */ }
  }
  function hideSheet() {
    root.classList.remove('open');
    document.documentElement.classList.remove('lock');
    setTimeout(() => { root.hidden = true; sheet.style.transform = ''; }, reduced ? 0 : 560);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    current = null;
  }
  function closeSheet() {
    if (root.hidden) return;
    if (pushed) { pushed = false; history.back(); } else { history.replaceState(null, '', HOME); hideSheet(); }
  }
  window.addEventListener('popstate', e => {
    if (e.state && e.state.o) { if (root.hidden) openSheet(e.state.o, false); } else if (!root.hidden) { pushed = false; hideSheet(); }
  });
  $('#sClose').addEventListener('click', closeSheet);
  $('#scrim').addEventListener('click', closeSheet);
  document.addEventListener('keydown', e => {
    if (root.hidden) return;
    if (e.key === 'Escape') { if (panels.dataset.step === 'book') setStep('details'); else closeSheet(); }
    if (e.key === 'Tab') { // keep focus inside the dialog
      const f = $$('button:not([disabled]),input:not(.hp),a[href]', sheet).filter(x => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  $('.s-poster').addEventListener('click', e => { if (!desktop()) e.currentTarget.classList.toggle('full'); });

  // swipe down to dismiss (phones)
  (function () {
    const grab = $('#grab');
    let y0 = null, dy = 0, t0 = 0;
    grab.addEventListener('pointerdown', e => { y0 = e.clientY; dy = 0; t0 = e.timeStamp; sheet.classList.add('dragging'); grab.setPointerCapture(e.pointerId); });
    grab.addEventListener('pointermove', e => { if (y0 === null) return; dy = Math.max(0, e.clientY - y0); sheet.style.transform = `translateY(${dy}px)`; });
    const end = e => {
      if (y0 === null) return;
      const v = dy / Math.max(e.timeStamp - t0, 1);
      sheet.classList.remove('dragging'); y0 = null;
      if (dy > 120 || v > 0.6) { sheet.style.transform = ''; closeSheet(); } else sheet.style.transform = '';
    };
    grab.addEventListener('pointerup', end); grab.addEventListener('pointercancel', end);
  })();

  // ---------- share
  $('#sShare').addEventListener('click', async () => {
    if (!current) return;
    const url = location.origin + '/o/' + current.slug, title = current.title || current.hotel_name;
    if (navigator.share) { try { await navigator.share({ title, text: [current.offer_headline, money(current, current.our_deal)].filter(Boolean).join(' · '), url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (e) { window.prompt('Copy this link', url); }
  });

  // ---------- booking
  $('#sBook').addEventListener('click', () => setStep('book'));
  $('#bBack').addEventListener('click', () => setStep('details'));
  function flag(id, msg) {
    const f = $(id); f.classList.remove('bad'); void f.offsetWidth;
    if (msg) { f.classList.add('bad'); $('small', f).textContent = msg; }
  }
  $$('#pBook input').forEach(i => i.addEventListener('input', () => i.closest('.field') && i.closest('.field').classList.remove('bad')));
  $('#pBook').addEventListener('submit', async e => {
    e.preventDefault();
    if (!current) return;
    const name = $('#inName').value.trim().replace(/\s+/g, ' '), phone = $('#inPhone').value.trim();
    const digits = phone.replace(/\D/g, '');
    flag('#fName'); flag('#fPhone');
    let bad = false;
    if (name.length < 2) { flag('#fName', 'Please enter your name'); bad = true; }
    if (digits.length < 8 || digits.length > 15) { flag('#fPhone', 'Please enter a valid phone number'); bad = true; }
    if (bad) { ($('.bad input') || {}).focus && $('.bad input').focus(); return; }
    const btn = $('#bSubmit');
    btn.classList.add('busy'); btn.disabled = true;
    try {
      const res = await fetch(`/api/public/offers/${encodeURIComponent(current.slug)}/lead`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, phone, website: $('#inHp').value }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.field === 'name') flag('#fName', body.error); else if (body.field === 'phone') flag('#fPhone', body.error); else toast(body.error || 'Something went wrong. Please try again.');
        btn.classList.remove('busy'); btn.disabled = false; return;
      }
      store.set('ho_client', { name, phone });
      const url = body.wa_url || waBase();
      $('#dLink').href = url;
      setStep('done');
      setTimeout(() => { window.location.href = url; }, reduced ? 200 : 1300);
    } catch (err) {
      toast('No connection. Please try again.');
      btn.classList.remove('busy'); btn.disabled = false;
    }
  });

  // ---------- load
  async function load() {
    try {
      const res = await fetch('/api/public/offers/' + encodeURIComponent(ORG), { cache: 'no-store' });
      if (!res.ok) throw new Error('load');
      const data = await res.json();
      offers = data.offers || [];
      Object.assign(boot, data.cfg || {});
    } catch (e) {
      offers = [];
      toast('Could not load offers. Pull to refresh.');
    }
    chipsFor(offers);
    renderGrid();
    if (FOCUS) {
      const o = offers.find(x => x.slug === FOCUS);
      if (o) { history.replaceState({ o: FOCUS }, '', '/o/' + FOCUS); setTimeout(() => openSheet(FOCUS, false), 250); }
      else { const n = $('#notice'); n.textContent = 'This offer has ended. Here is what is available now.'; n.hidden = false; history.replaceState(null, '', HOME); }
    }
  }
  load();
})();
