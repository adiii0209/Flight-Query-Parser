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
    $('#bSub').textContent = `Share your details and our team will contact you about ${o.title || o.hotel_name}.`;
    const mem = store.get('ho_client') || {};
    $('#inName').value = mem.name || ''; $('#inPhone').value = mem.phone || '';
    $$('.field,.field-dates').forEach(f => f.classList.remove('bad'));
    calInit(o);
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

  // ---------- share: copies the link with the same caption the team uses
  function captionFor(o) {
    const fmt = v => parseISO(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const lines = [`*${[o.brand_line, o.place_line].filter(Boolean).join(' ') || o.hotel_name || o.title}*`];
    if (o.offer_headline) lines.push(`*${o.offer_headline}*`);
    if (o.tagline) lines.push(o.tagline);
    lines.push('');
    if (o.room) lines.push(o.room);
    if (o.check_in && o.check_out) lines.push(`${fmt(o.check_in)} - ${fmt(o.check_out)}${nights(o) ? ' · ' + nights(o) + ' nights' : ''}${o.adults ? ' · ' + o.adults + ' adults' : ''}`);
    if ((o.perks || []).length) { lines.push('', 'Your stay includes:'); o.perks.forEach(p => lines.push('- ' + p.replace(/\*/g, '').trim())); }
    if (o.our_deal) {
      lines.push('');
      if (o.online_rate > o.our_deal) lines.push(`Online rate: ~${money(o, o.online_rate)}/-~`);
      lines.push(`*Our deal: ${money(o, o.our_deal)}/-*`);
    }
    lines.push('', boot.availability_note || '*Subject to availability.', boot.brand_footer || 'Curated by Time Tours', '', '\u{1F64C} Know someone heading there? Forward this to them');
    return lines.join('\n');
  }
  $('#sShare').addEventListener('click', async () => {
    if (!current) return;
    const text = location.origin + '/o/' + current.slug + '\n\n' + captionFor(current);
    try { await navigator.clipboard.writeText(text); toast('Link and caption copied'); }
    catch (e) { window.prompt('Copy this text', text); }
  });

  // ---------- stay-date calendar
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = v => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayD = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); };
  const nightsBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
  const cal = { from: null, to: null, hover: null, view: null, open: false };
  const shortDay = v => parseISO(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const stayText = () => !cal.from ? '' : cal.to ? `${shortDay(cal.from)} – ${shortDay(cal.to)} · ${nightsBetween(cal.from, cal.to)} night${nightsBetween(cal.from, cal.to) > 1 ? 's' : ''}` : `${shortDay(cal.from)} · choose check-out`;

  function setOpen(open) {
    cal.open = open;
    $('#cal').classList.toggle('open', open);
    $('#cal').setAttribute('aria-hidden', String(!open));
    $('#datesBtn').setAttribute('aria-expanded', String(open));
    $('#fDates').classList.toggle('is-open', open);
  }
  function updateDatesBtn() {
    const v = $('#datesVal');
    v.textContent = stayText() || 'Add your dates';
    v.classList.toggle('empty', !cal.from);
    $('#calHint').textContent = !cal.from ? 'Choose your check-in date' : !cal.to ? 'Now choose your check-out date' : stayText();
    $('#fDates').classList.remove('bad');
  }
  function renderCal() {
    const v = cal.view, first = new Date(v.getFullYear(), v.getMonth(), 1), total = new Date(v.getFullYear(), v.getMonth() + 1, 0).getDate();
    $('#calTitle').textContent = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const t = iso(todayD()), end = cal.to || cal.hover, lo = cal.from, hi = end && lo && end > lo ? end : null;
    let html = '<span></span>'.repeat(first.getDay());
    for (let d = 1; d <= total; d++) {
      const k = iso(new Date(v.getFullYear(), v.getMonth(), d)), past = k < t;
      const cls = ['day'];
      if (past) cls.push('past');
      if (k === t) cls.push('today');
      if (lo === k) cls.push('start', hi ? 'has-range' : 'solo');
      if (hi && k === hi) cls.push('end', 'has-range', cal.to ? '' : 'preview');
      if (hi && k > lo && k < hi) cls.push('mid');
      const label = parseISO(k).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      html += `<button type="button" class="${cls.join(' ')}" data-d="${k}" ${past ? 'disabled' : ''} aria-label="${label}" aria-pressed="${k === lo || k === cal.to}"><span>${d}</span></button>`;
    }
    $('#calGrid').innerHTML = html;
    const cur = todayD();
    $('#calPrev').disabled = v.getFullYear() === cur.getFullYear() && v.getMonth() <= cur.getMonth();
    $('#calNext').disabled = (v.getFullYear() - cur.getFullYear()) * 12 + v.getMonth() - cur.getMonth() >= 18;
  }
  function calInit(o) {
    const t = iso(todayD());
    cal.from = cal.to = cal.hover = null;
    if (o.check_in && o.check_out && o.check_in >= t) { cal.from = o.check_in; cal.to = o.check_out; }
    const anchor = cal.from ? parseISO(cal.from) : todayD();
    cal.view = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    setOpen(false); renderCal(); updateDatesBtn();
    $('#calOffer').hidden = !cal.from;
  }
  function pickDay(k) {
    if (!cal.from || cal.to) { cal.from = k; cal.to = null; }
    else if (k <= cal.from) { cal.from = k; }
    else if (nightsBetween(cal.from, k) > 60) { toast('Stays are limited to 60 nights'); return; }
    else cal.to = k;
    cal.hover = null; renderCal(); updateDatesBtn();
    if (cal.to) setTimeout(() => setOpen(false), reduced ? 0 : 650);
  }
  const monthShift = n => { cal.view = new Date(cal.view.getFullYear(), cal.view.getMonth() + n, 1); renderCal(); };
  $('#datesBtn').addEventListener('click', () => setOpen(!cal.open));
  $('#calPrev').addEventListener('click', () => monthShift(-1));
  $('#calNext').addEventListener('click', () => monthShift(1));
  $('#calGrid').addEventListener('click', e => { const b = e.target.closest('.day'); if (b && !b.disabled) pickDay(b.dataset.d); });
  $('#calGrid').addEventListener('pointerover', e => {
    const b = e.target.closest('.day');
    if (e.pointerType !== 'mouse' || !b || b.disabled || !cal.from || cal.to || cal.hover === b.dataset.d) return;
    cal.hover = b.dataset.d; renderCal();
  });
  $('#calGrid').addEventListener('pointerleave', () => { if (cal.hover) { cal.hover = null; renderCal(); } });
  $('#calClear').addEventListener('click', () => { cal.from = cal.to = cal.hover = null; renderCal(); updateDatesBtn(); });
  $('#calOffer').addEventListener('click', () => {
    if (!current || !current.check_in) return;
    cal.from = current.check_in; cal.to = current.check_out; cal.view = new Date(parseISO(cal.from).getFullYear(), parseISO(cal.from).getMonth(), 1);
    renderCal(); updateDatesBtn(); setOpen(false);
  });

  // ---------- booking: the lead goes straight to the team (no WhatsApp hand-off)
  $('#pBook').addEventListener('submit', async e => {
    e.preventDefault();
    if (!current) return;
    const name = $('#inName').value.trim().replace(/\s+/g, ' '), phone = $('#inPhone').value.trim();
    const digits = phone.replace(/\D/g, '');
    flag('#fName'); flag('#fPhone'); flag('#fDates');
    let bad = false;
    if (name.length < 2) { flag('#fName', 'Please enter your name'); bad = true; }
    if (digits.length < 8 || digits.length > 15) { flag('#fPhone', 'Please enter a valid phone number'); bad = true; }
    if (cal.from && !cal.to) { flag('#fDates', 'Please choose your check-out date'); setOpen(true); bad = true; }
    if (bad) { const f = $('.field.bad input'); if (f) f.focus(); return; }
    const btn = $('#bSubmit');
    btn.classList.add('busy'); btn.disabled = true;
    try {
      const res = await fetch(`/api/public/offers/${encodeURIComponent(current.slug)}/lead`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, stay_from: cal.from, stay_to: cal.to, website: $('#inHp').value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.field === 'name') flag('#fName', body.error); else if (body.field === 'phone') flag('#fPhone', body.error);
        else if (body.field === 'dates') { flag('#fDates', body.error); setOpen(true); } else toast(body.error || 'Something went wrong. Please try again.');
        btn.classList.remove('busy'); btn.disabled = false; return;
      }
      store.set('ho_client', { name, phone });
      $('#dMsg').textContent = `Thank you, ${name.split(' ')[0]}. Our team will contact you shortly on ${phone}.`;
      const st = $('#dStay'); st.textContent = cal.to ? 'Stay: ' + stayText() : ''; st.hidden = !cal.to;
      btn.classList.remove('busy'); btn.disabled = false;
      setStep('done');
    } catch (err) {
      toast('No connection. Please try again.');
      btn.classList.remove('busy'); btn.disabled = false;
    }
  });
  $('#dDone').addEventListener('click', () => {
    closeSheet();
    setTimeout(() => window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }), 120); // back to the top of the offers
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
