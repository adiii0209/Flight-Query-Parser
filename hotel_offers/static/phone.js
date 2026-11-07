/* Client page: the phone field of the Book now form, with a country-code picker.
   A flag + code button sits inside the field; it opens a searchable list. Typing or pasting "+44 7700 900123" picks the country by itself.
   client.js reads the result through window.HO_PHONE.read() and fills the field with HO_PHONE.set(). */
(function () {
  'use strict';
  const wrap = document.getElementById('phoneWrap');
  if (!wrap) return;
  const $ = s => wrap.querySelector(s);
  const input = $('#inPhone'), btn = $('#ccBtn'), pop = $('#ccPop'), list = $('#ccList'), q = $('#ccQ');

  // iso | name | dial code. The first block is shown on top; the rest follow A to Z.
  const POPULAR = 'IN|India|91;AE|United Arab Emirates|971;US|United States|1;GB|United Kingdom|44;SG|Singapore|65;TH|Thailand|66;AU|Australia|61;CA|Canada|1;MY|Malaysia|60;SA|Saudi Arabia|966;QA|Qatar|974;KW|Kuwait|965;OM|Oman|968;BH|Bahrain|973';
  const OTHERS = 'AF|Afghanistan|93;AL|Albania|355;DZ|Algeria|213;AR|Argentina|54;AM|Armenia|374;AT|Austria|43;AZ|Azerbaijan|994;BD|Bangladesh|880;BY|Belarus|375;BE|Belgium|32;BT|Bhutan|975;BO|Bolivia|591;BA|Bosnia & Herzegovina|387;BR|Brazil|55;BN|Brunei|673;BG|Bulgaria|359;KH|Cambodia|855;CL|Chile|56;CN|China|86;CO|Colombia|57;CR|Costa Rica|506;HR|Croatia|385;CU|Cuba|53;CY|Cyprus|357;CZ|Czechia|420;DK|Denmark|45;EC|Ecuador|593;EG|Egypt|20;EE|Estonia|372;ET|Ethiopia|251;FJ|Fiji|679;FI|Finland|358;FR|France|33;GE|Georgia|995;DE|Germany|49;GH|Ghana|233;GR|Greece|30;HK|Hong Kong|852;HU|Hungary|36;IS|Iceland|354;ID|Indonesia|62;IR|Iran|98;IQ|Iraq|964;IE|Ireland|353;IL|Israel|972;IT|Italy|39;JP|Japan|81;JO|Jordan|962;KZ|Kazakhstan|7;KE|Kenya|254;KG|Kyrgyzstan|996;LA|Laos|856;LV|Latvia|371;LB|Lebanon|961;LT|Lithuania|370;LU|Luxembourg|352;MO|Macau|853;MV|Maldives|960;MT|Malta|356;MU|Mauritius|230;MX|Mexico|52;MD|Moldova|373;MN|Mongolia|976;ME|Montenegro|382;MA|Morocco|212;MM|Myanmar|95;NP|Nepal|977;NL|Netherlands|31;NZ|New Zealand|64;NG|Nigeria|234;NO|Norway|47;PK|Pakistan|92;PA|Panama|507;PE|Peru|51;PH|Philippines|63;PL|Poland|48;PT|Portugal|351;RO|Romania|40;RU|Russia|7;RW|Rwanda|250;RS|Serbia|381;SC|Seychelles|248;SK|Slovakia|421;SI|Slovenia|386;ZA|South Africa|27;KR|South Korea|82;ES|Spain|34;LK|Sri Lanka|94;SE|Sweden|46;CH|Switzerland|41;TW|Taiwan|886;TZ|Tanzania|255;TR|Türkiye|90;UG|Uganda|256;UA|Ukraine|380;UY|Uruguay|598;UZ|Uzbekistan|998;VE|Venezuela|58;VN|Vietnam|84;ZM|Zambia|260;ZW|Zimbabwe|263';
  const parse = s => s.split(';').map(r => { const p = r.split('|'); return { iso: p[0], name: p[1], dial: p[2] }; });
  const top = parse(POPULAR), all = top.concat(parse(OTHERS).sort((a, b) => a.name.localeCompare(b.name)));
  const byIso = {}, byDial = {};
  all.forEach(c => { byIso[c.iso] = c; if (!byDial[c.dial]) byDial[c.dial] = c; });
  byDial['7'] = byIso.RU;  // Russia and Kazakhstan share +7: Russia is the usual one
  const flagOf = iso => String.fromCodePoint(...Array.from(iso, ch => 127397 + ch.charCodeAt(0)));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // the country to start with: India for this business, unless the browser says otherwise
  function guess() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (/^Asia\/(Calcutta|Kolkata)$/.test(tz)) return byIso.IN;
      const region = ((navigator.language || '').split('-')[1] || '').toUpperCase();
      if (byIso[region]) return byIso[region];
    } catch (e) { /* default below */ }
    return byIso.IN;
  }
  let cur = guess(), active = -1, shown = [];

  function paint() {
    $('#ccFlag').textContent = flagOf(cur.iso);
    $('#ccDial').textContent = '+' + cur.dial;
    btn.setAttribute('aria-label', `Country code: ${cur.name} +${cur.dial}. Change`);
    input.placeholder = ' ';
  }

  // ---- the list
  function row(c, i) {
    return `<li role="option" id="cc-${c.iso}" data-i="${i}" aria-selected="${c.iso === cur.iso}"><i class="f">${flagOf(c.iso)}</i><b>${esc(c.name)}</b><em>+${c.dial}</em></li>`;
  }
  function fill() {
    const term = q.value.trim().toLowerCase().replace(/^\+/, '');
    shown = term ? all.filter(c => c.name.toLowerCase().includes(term) || c.iso.toLowerCase() === term || c.dial.startsWith(term)) : all;
    if (!shown.length) { list.innerHTML = '<li class="none" role="presentation">No country found</li>'; active = -1; return; }
    let html = '';
    shown.forEach((c, i) => {
      if (!term && i === 0) html += '<li class="grp" role="presentation">Popular</li>';
      if (!term && i === top.length) html += '<li class="grp" role="presentation">All countries</li>';
      html += row(c, i);
    });
    list.innerHTML = html;
    mark(Math.max(0, shown.findIndex(c => c.iso === cur.iso)), !term);
  }
  function mark(i, scroll) {
    const prev = list.querySelector('.on'); if (prev) prev.classList.remove('on');
    active = i;
    const el = list.querySelector(`[data-i="${i}"]`);
    if (!el) return;
    el.classList.add('on'); q.setAttribute('aria-activedescendant', el.id);
    if (scroll) list.scrollTop = el.offsetTop + el.offsetHeight < list.clientHeight ? 0 : el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2;  // near the top the "Popular" heading stays in view
    else { const t = el.offsetTop, b = t + el.offsetHeight; if (t < list.scrollTop) list.scrollTop = t; else if (b > list.scrollTop + list.clientHeight) list.scrollTop = b - list.clientHeight; }
  }
  const isOpen = () => !pop.hidden;
  function open() {
    pop.hidden = false; q.value = ''; fill();
    btn.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => pop.classList.add('in'));
    if (!window.matchMedia('(pointer:coarse)').matches) q.focus({ preventScroll: true });  // a phone keeps its keyboard down until the search is tapped
  }
  function close(refocus) {
    if (!isOpen()) return;
    pop.classList.remove('in'); btn.setAttribute('aria-expanded', 'false');
    setTimeout(() => { if (!pop.classList.contains('in')) pop.hidden = true; }, 180);
    if (refocus) input.focus({ preventScroll: true });
  }
  function pick(c, refocus) { cur = c; paint(); close(refocus); }

  btn.addEventListener('click', () => (isOpen() ? close(true) : open()));
  list.addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) pick(shown[+li.dataset.i], true); });
  list.addEventListener('mousemove', e => { const li = e.target.closest('[data-i]'); if (li && +li.dataset.i !== active) mark(+li.dataset.i); });
  q.addEventListener('input', fill);
  document.addEventListener('pointerdown', e => { if (isOpen() && !wrap.contains(e.target)) close(false); });
  wrap.addEventListener('keydown', e => {
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(true); return; }  // only the list closes, not the whole sheet
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length) mark(Math.max(0, Math.min(shown.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && document.activeElement !== input) {
      e.preventDefault();
      if (shown[active]) pick(shown[active], true);
    } else if (e.key === 'Tab') close(false);
  });

  // ---- the number
  // "+44 7700 900123", "0044 7700 900123" or a number copied from WhatsApp: the code picks the country, the rest is the number.
  function split(raw) {
    const t = String(raw || '').trim();
    let d = t.replace(/\D/g, '');
    if (t[0] === '+' || t.slice(0, 2) === '00') {
      if (t[0] !== '+') d = d.replace(/^00/, '');
      for (let n = 3; n >= 1; n--) {
        const c = byDial[d.slice(0, n)];
        if (c) return { c: cur.dial === d.slice(0, n) ? cur : c, national: d.slice(n) };  // stay on Canada when +1 is typed with Canada chosen
      }
      return null;  // "+" or "+9" so far: wait for more digits
    }
    if (cur.iso === 'IN' && d.length === 12 && d.slice(0, 2) === '91') return { c: cur, national: d.slice(2) };  // 91 98765 43210 pasted without the +
    return null;
  }
  function normalise() {
    const s = split(input.value);
    if (s) { cur = s.c; paint(); input.value = s.national; }
    else input.value = input.value.replace(/[^\d\s()\-+]/g, '').replace(/(?!^)\+/g, '');
  }
  input.addEventListener('input', normalise);
  input.addEventListener('paste', () => setTimeout(normalise, 0));

  function national() { return input.value.replace(/\D/g, '').replace(/^0+/, ''); }
  window.HO_PHONE = {
    set(value, iso) {
      if (iso && byIso[iso]) cur = byIso[iso];
      input.value = value || '';
      paint(); normalise();
    },
    read() {
      const n = national(), total = cur.dial.length + n.length;
      const ok = cur.iso === 'IN' ? /^[6-9]\d{9}$/.test(n) : n.length >= 5 && total <= 15;
      return {
        ok, national: n, iso: cur.iso, e164: '+' + cur.dial + n, display: `+${cur.dial} ${cur.iso === 'IN' ? n.replace(/^(\d{5})(\d+)$/, '$1 $2') : n}`,
        error: cur.iso === 'IN' ? 'Please enter a 10-digit mobile number' : 'Please enter a valid phone number',
      };
    },
  };
  paint();
})();
