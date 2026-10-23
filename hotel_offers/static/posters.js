/* Poster templates. Each renders an HTML string at its native pixel size from the same data object.
   Fixed brand parts come from d.brand; only the offer-specific parts move. */
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nl = s => esc(s).replace(/\n/g, '<br>');

  const ICONS = {
    credit: '<rect x="2.5" y="5" width="19" height="14" rx="2.2"/><path d="M2.5 10h19"/><path d="M6 15h3.5M16 15h2"/>',
    breakfast: '<path d="M5 11h12v4a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z"/><path d="M17 12h1.4a2.4 2.4 0 0 1 0 4.8H16.5"/><path d="M4 21.5h14"/><path d="M8 2.5c0 1.6 1 1.6 1 3.2M11 2.5c0 1.6 1 1.6 1 3.2M14 2.5c0 1.6 1 1.6 1 3.2"/>',
    upgrade: '<path d="M12 2.5l2.9 6.2 6.6.8-4.9 4.6 1.3 6.7L12 17.5l-5.9 3.3 1.3-6.7L2.5 9.5l6.6-.8z"/>',
    checkin: '<circle cx="12" cy="12" r="9.2"/><path d="M12 6.8V12l3.4 2.2"/>',
    welcome: '<path d="M7.5 3h9l-1 7.2a3.5 3.5 0 0 1-7 0z"/><path d="M12 13.7V21"/><path d="M8 21h8"/>',
    spa: '<path d="M12 21c-5 0-8-3-8-8 5 0 8 3 8 8z"/><path d="M12 21c5 0 8-3 8-8-5 0-8 3-8 8z"/><path d="M12 21C9 18 9 12 12 7c3 5 3 11 0 14z"/>',
    transfer: '<path d="M5 15.5l1.6-5A2 2 0 0 1 8.5 9h7a2 2 0 0 1 1.9 1.5l1.6 5"/><rect x="3" y="15.5" width="18" height="4.5" rx="1.6"/><circle cx="7.5" cy="17.7" r=".6"/><circle cx="16.5" cy="17.7" r=".6"/>',
    dining: '<path d="M7 3v8M4.5 3v5.5a2.5 2.5 0 0 0 5 0V3M7 11v10"/><path d="M17.5 3C15 5 14 8 14 11h3.5v10"/>',
    gift: '<rect x="3" y="8" width="18" height="4"/><path d="M12 8v13"/><path d="M19.5 12v9h-15v-9"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
    wifi: '<path d="M2 9a15 15 0 0 1 20 0"/><path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r=".8"/>',
  };
  const svg = (name, extra) => `<svg viewBox="0 0 24 24">${ICONS[name] || ICONS.gift}${extra || ''}</svg>`;
  const ARROW = '<svg viewBox="0 0 46 20"><path d="M1 10h42M35 2l8 8-8 8"/></svg>';

  const money = (d, n) => n ? `${esc(d.currency || 'INR')} ${Number(n).toLocaleString('en-US')}/-` : '';
  const fs = (text, base, maxChars) => Math.round(base * Math.min(1, maxChars / Math.max(String(text || '').length, 1)));
  const A = (style, cls, inner) => `<div class="a ${cls || ''}" style="${style}">${inner || ''}</div>`;
  const photoStyle = (d, k) => d.photos && d.photos[k] ? `background-image:url(&quot;${esc(d.photos[k])}&quot;)` : '';
  const PH = (d, k, style, cls) => `<div class="a ph ${cls || ''}" style="${style};${photoStyle(d, k)}"></div>`;

  const logo = (d, style, extra, one) => A(style, 'logo', `<div class="logo-name" ${extra || ''}>${esc(d.brand.name)}</div><i class="gr"></i><div class="logo-tag"${one ? ' style="white-space:nowrap;font-size:18px;letter-spacing:.2em"' : ''}>${one ? esc(d.brand.tagline.replace(/\n/g, ' ')) : nl(d.brand.tagline)}</div>`);
  const hdrNote = (d, style, line) => A(style, 'hdr-note', nl(d.brand.header_note)) + (line || '');
  const tagline = (d, style) => A(style, 't-tag', nl((d.tagline || '').toUpperCase().replace(/\s+(ON|IN|AT|OVER|BY)\s+/, '\n$1 ')));
  const perk = (d, p, o) => {
    o = o || {};
    const icon = o.swap && p.icon === 'breakfast' ? 'dining' : p.icon;
    const ic = o.plain
      ? `<span style="width:${o.ico}px;height:${o.ico}px;color:#b98f45;display:block">${svg(icon).replace('<svg', '<svg style="width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round"')}</span>`
      : `<span class="ico" style="width:${o.ico}px;height:${o.ico}px">${svg(icon)}</span>`;
    return ic;
  };
  const perkLabel = (p, style) => `<div class="pl" style="${style || ''}">${nl(p.label)}</div>`;
  const pricebar = (d, style, o) => {
    o = o || {};
    const old = d.online_rate ? `<div class="pb-col"><div class="pb-l">ONLINE RATE</div><div class="pb-old" style="${o.old || ''}">${money(d, d.online_rate)}</div></div><i class="pb-sep"></i>` : '';
    return A(style, 'pricebar', `${old}<div class="pb-col"><div class="pb-l">OUR DEAL</div><div class="pb-new" style="${o.nw || ''}">${money(d, d.our_deal)}</div></div>`)
      .replace('class="a pricebar"', `class="a pricebar" ${o.attr || ''}`);
  };
  const cta = (d, style) => A(style, 'cta', `${esc(d.brand.enquire)} ${ARROW}`);
  const avail = (d, style) => A(style, 'avail', esc(d.brand.availability));
  const curated = (d, style) => A(style, 'curated', `<i></i><div><div class="cur-t">${esc(d.brand.footer)}</div><div class="cur-e">${esc(d.brand.est)}</div></div>`);
  const curInline = (d, style) => A(style, 'cur-inline', `${esc(d.brand.footer)} <i></i>`);
  const note = (d, style) => A(style, 'note', esc(d.brand.loyalty));
  const headlineHtml = d => /^stay\s+\d+\s+pay\s+\d+$/i.test(d.offer_headline.trim()) ? esc(d.offer_headline).replace(/\s+(Pay\b)/i, '<br>$1') : esc(d.offer_headline);
  // Largest size (<= base) at which the text wraps into the given width in at most 3 lines; the user's scale applies on top.
  function headlineFs(text, base, width, scale) {
    const words = String(text).trim().split(/\s+/);
    for (let fs = base; fs >= 28; fs -= 2) {
      const cap = Math.floor(width / (fs * 0.5));
      let lines = 1, cur = 0, ok = true;
      for (const w of words) {
        if (w.length > cap) { ok = false; break; }
        if (cur && cur + 1 + w.length > cap) { lines++; cur = w.length; } else { cur += (cur ? 1 : 0) + w.length; }
      }
      if (ok && lines <= 3 && lines * fs * 0.92 <= base * 2.3) return Math.round(fs * (scale || 100) / 100);
    }
    return Math.round(28 * (scale || 100) / 100);
  }
  const headlineBlock = (d, left, top, width, base) => A(`left:${left}px;top:${top}px;width:${width}px;font-size:${headlineFs(d.offer_headline, base, width, d.headline_scale)}px`, 'headline', headlineHtml(d));
  const root = (cls, w, h, inner, style) => `<div class="po ${cls}" style="width:${w}px;height:${h}px;${style || ''}">${inner}</div>`;
  const brandBig = (d, left, top, base, max, color) => A(`left:${left}px;top:${top}px;font-size:${fs(d.brand_line, base, max)}px;color:${color || '#0f2420'}`, 't-brand', esc(d.brand_line));
  const placeSmall = (d, left, top, size, max, color) => A(`left:${left}px;top:${top}px;font-size:${fs(d.place_line, size, max)}px;${color ? 'color:' + color : ''}`, 't-place', esc(d.place_line));
  const placeBig = (d, left, top, base, max, color) => A(`left:${left}px;top:${top}px;font-size:${fs(d.place_line, base, max)}px;${color ? 'color:' + color : ''}`, 't-brand', esc(d.place_line));
  const brandSmall = (d, left, top, size, max, color) => A(`left:${left}px;top:${top}px;font-size:${fs(d.brand_line, size, max)}px;letter-spacing:.3em;text-transform:uppercase;color:${color || '#a67c37'};font-weight:400`, '', esc(d.brand_line));
  const rule = (left, top, w, color) => A(`left:${left}px;top:${top}px;width:${w}px;height:3px;background:${color || '#a67c37'}`);

  /* ---------- perk rows (vertical list) ---------- */
  function perkList(d, o) {
    return d.perks.slice(0, 4).map((p, i) => {
      const y = o.top + i * o.step;
      return A(`left:${o.left}px;top:${y}px;width:${o.w}px;height:${o.ico}px`, 'perk',
        `${perk(d, p, { ico: o.ico })}<i class="vr" style="height:${o.ico * .72}px;margin-left:${o.gap}px;${o.vr || ''}"></i>${perkLabel(p, `margin-left:${o.gap2 || o.gap}px;font-size:${o.fs || 21}px;${o.color ? 'color:' + o.color : ''}`)}`);
    }).join('');
  }

  const T = [];

  /* 1 ─ Arch window, offer headline (Stay 3 Pay 2) */
  T.push({
    id: 'arch-offer', name: 'Arch · Offer headline', w: 902, h: 1743, slots: [{ key: 'hero', label: 'Arch photo', orient: 'portrait' }],
    render(d) {
      const head = d.offer_headline ? A('left:76px;top:567px;width:310px', 'po-badge', 'Special offer') + headlineBlock(d, 76, 652, 400, 128) : '';
      return root('t1', 902, 1743,
        A('left:490px;top:118px;width:412px;height:1366px;border-radius:206px 206px 0 0;background:linear-gradient(90deg,#eadfcb,#f6efe2);box-shadow:inset 0 0 40px rgba(120,90,40,.18)') +
        PH(d, 'hero', 'left:524px;top:150px;width:378px;height:1334px;border-radius:174px 174px 0 0') +
        logo(d, 'left:72px;top:60px') +
        brandBig(d, 70, 250, 126, 7) + placeSmall(d, 78, 388, 46, 9) + rule(78, 452, 56) + tagline(d, 'left:78px;top:482px;font-size:21px') + head +
        perkList(d, { left: 76, top: head ? 925 : 640, step: 102, w: 400, ico: 78, gap: 38, gap2: 36, fs: 21 }) +
        rule(78, 1346, 90, '#c9b79a') + note(d, 'left:78px;top:1370px;width:330px;font-size:25px') +
        pricebar(d, 'left:56px;top:1482px;width:792px;height:142px', { old: 'font-size:40px', nw: 'font-size:48px' }) +
        avail(d, 'left:58px;top:1660px') + curInline(d, 'right:58px;top:1664px'), 'background:#f2ebe0');
    },
  });

  /* 2 ─ Full-bleed photo, no headline */
  T.push({
    id: 'full-bleed', name: 'Full-bleed photo', w: 902, h: 1743, slots: [{ key: 'hero', label: 'Background photo', orient: 'portrait' }],
    render(d) {
      return root('t2', 902, 1743,
        PH(d, 'hero', 'left:0;top:0;width:902px;height:1743px') +
        A('left:0;top:0;width:902px;height:1743px;background:linear-gradient(100deg,rgba(244,238,228,.94) 0%,rgba(244,238,228,.82) 38%,rgba(244,238,228,0) 62%)') +
        logo(d, 'left:80px;top:94px', 'style="font-size:56px"') +
        brandBig(d, 78, 296, 152, 7) + placeSmall(d, 86, 448, 48, 9) + rule(86, 520, 66) + tagline(d, 'left:86px;top:552px;font-size:21px') +
        perkList(d, { left: 80, top: 650, step: 102, w: 420, ico: 78, gap: 38, gap2: 36, fs: 21 }) +
        rule(86, 1100, 90, '#7a6a52') + note(d, 'left:86px;top:1130px;width:360px;font-size:25px') +
        pricebar(d, 'left:58px;top:1432px;width:786px;height:136px', { old: 'font-size:40px', nw: 'font-size:48px' }) +
        avail(d, 'left:58px;top:1655px;color:#f4eee4') + curInline(d, 'right:58px;top:1658px;color:#f4eee4'), 'background:#2c3b3a');
    },
  });

  /* 3 ─ Arch poster with sage shapes */
  T.push({
    id: 'arch-poster', name: 'Arch poster · sage', w: 1024, h: 1536, slots: [{ key: 'hero', label: 'Arch photo', orient: 'portrait' }],
    render(d) {
      const lotus = `<svg class="a" style="left:12px;top:1085px;width:250px;height:180px;fill:none;stroke:#b8944f;stroke-width:1.2" viewBox="0 0 250 180"><path d="M30 20C70 40 110 70 120 120 70 110 40 70 30 20z"/><path d="M95 5C110 45 130 90 120 150 100 120 85 60 95 5z"/><path d="M200 45C170 70 150 110 130 150 160 130 195 95 200 45z"/><path d="M5 100c40 0 80 20 110 60"/><path d="M60 75c20 15 40 45 52 85"/></svg>`;
      return root('t3', 1024, 1536,
        A('left:0;top:150px;width:190px;height:760px;background:#8b9d86;border-radius:0 190px 0 0;opacity:.95') +
        A('left:0;top:840px;width:430px;height:430px;background:#d7dbd0;border-radius:0 430px 0 0') +
        A('left:50px;top:240px;width:2px;height:520px;background:#b8944f;opacity:.6') +
        A('left:100px;top:232px;width:490px;height:1032px;border-radius:245px 245px 0 0;background:#ebe3d3') +
        PH(d, 'hero', 'left:122px;top:240px;width:466px;height:1022px;border-radius:233px 233px 0 0;border:2px solid #c9a56a') +
        lotus +
        logo(d, 'left:125px;top:52px') +
        hdrNote(d, 'right:50px;top:46px;text-align:right;font-size:15px', rule(920, 124, 54)) +
        brandSmall(d, 648, 252, 34, 9) + A(`left:640px;top:296px;font-size:${fs(d.place_line || d.brand_line, 112, 5.8)}px`, 't-brand', esc(d.place_line || d.brand_line)) +
        rule(648, 450, 64) + tagline(d, 'left:648px;top:480px;font-size:22px') +
        d.perks.slice(0, 4).map((p, i) => A(`left:648px;top:${586 + i * 114}px;width:360px;height:88px`, 'perk', `${perk(d, p, { ico: 88 })}${perkLabel(p, 'margin-left:34px;font-size:20px')}`) +
          (i < 3 ? rule(768, 586 + i * 114 + 102, 80, '#c9b79a').replace('height:3px', 'height:2px') : '')).join('') +
        rule(648, 1092, 88) + note(d, 'left:648px;top:1128px;width:340px;font-size:24px') +
        pricebar(d, 'left:52px;top:1264px;width:922px;height:108px;background:#dcddd0;border-radius:0', { old: 'font-size:36px', nw: 'font-size:44px' }) +
        cta(d, 'left:273px;top:1405px;width:308px;height:74px;font-size:21px') +
        A('left:662px;top:1404px;width:2px;height:76px;background:#c9a56a') +
        A('left:712px;top:1412px', 'cur-t', esc(d.brand.footer)) + A('left:712px;top:1452px;font-size:14px;letter-spacing:.3em', '', esc(d.brand.est)) +
        avail(d, 'left:56px;top:1490px;font-size:17px;color:#6b6a5e'), 'background:#f4efe6');
    },
  });

  /* 4 ─ Magazine spread */
  T.push({
    id: 'magazine', name: 'Magazine spread', w: 1122, h: 1402, slots: [{ key: 'hero', label: 'Right-page photo', orient: 'portrait' }],
    render(d) {
      return root('t4', 1122, 1402,
        A('left:12px;top:100px;width:540px;height:1236px;background:linear-gradient(90deg,#f7f1e7,#f3ecdf);box-shadow:0 14px 40px rgba(60,40,10,.25)') +
        A('left:548px;top:92px;width:552px;height:1244px;background:#f6f0e6;box-shadow:0 14px 40px rgba(60,40,10,.25)') +
        PH(d, 'hero', 'left:548px;top:92px;width:552px;height:1118px') +
        A('left:548px;top:92px;width:34px;height:1244px;background:linear-gradient(90deg,rgba(60,40,10,.28),transparent)') +
        A('left:830px;top:130px;width:2px;height:80px;background:#c9a56a') +
        A('left:862px;top:138px;font-size:14px;line-height:1.6;letter-spacing:.2em;color:#fff;text-transform:uppercase', '', nl(d.brand.header_note)) +
        logo(d, 'left:140px;top:140px', 'style="font-size:46px"') +
        brandSmall(d, 144, 330, 30, 9) + A(`left:140px;top:362px;font-size:${fs(d.place_line || d.brand_line, 108, 6.6)}px`, 't-brand', esc(d.place_line || d.brand_line)) +
        rule(144, 482, 62) + tagline(d, 'left:144px;top:508px;font-size:20px') +
        perkList(d, { left: 142, top: 585, step: 96, w: 400, ico: 76, gap: 26, gap2: 26, fs: 19 }) +
        rule(144, 983, 62) + note(d, 'left:146px;top:1006px;width:380px;font-size:21px') +
        pricebar(d, 'left:88px;top:1093px;width:478px;height:112px;border-radius:0 0 0 0', { old: 'font-size:26px', nw: 'font-size:32px' }) +
        cta(d, 'left:128px;top:1220px;width:300px;height:58px;font-size:19px') +
        A('left:138px;top:1292px;font-family:Newsreader,serif;font-size:15px', '', esc(d.brand.availability)) +
        A('left:705px;top:1236px;width:2px;height:68px;background:#c9a56a') +
        A('left:757px;top:1240px;font-size:23px', 'cur-t', esc(d.brand.footer)) + A('left:757px;top:1278px;font-size:13px;letter-spacing:.3em', '', esc(d.brand.est)), 'background:#e8dfd1');
    },
  });

  /* 5 ─ Hero photo on top, details below */
  T.push({
    id: 'hero-top', name: 'Hero top · 2×2 perks', w: 1122, h: 1402, slots: [{ key: 'hero', label: 'Top photo', orient: 'landscape' }],
    render(d) {
      const cells = d.perks.slice(0, 4).map((p, i) => {
        const x = i % 2 ? 802 : 496, y = i < 2 ? 760 : 890;
        return A(`left:${x}px;top:${y}px;width:320px;height:88px`, 'perk', `${perk(d, p, { ico: 88 })}${perkLabel(p, 'margin-left:24px;font-size:15px;letter-spacing:.14em')}`) + rule(x + 114, y + 92, 48, '#c9a56a').replace('height:3px', 'height:2px');
      }).join('');
      return root('t5', 1122, 1402,
        PH(d, 'hero', 'left:0;top:0;width:1122px;height:696px') +
        A('left:0;top:0;width:1122px;height:240px;background:linear-gradient(180deg,rgba(255,236,214,.55),transparent)') +
        logo(d, 'left:55px;top:52px', 'style="font-size:62px"') +
        A('left:810px;top:48px;width:2px;height:98px;background:#c9a56a') +
        A('left:852px;top:62px;font-size:15px;line-height:1.7;letter-spacing:.2em;text-transform:uppercase', '', nl(d.brand.header_note)) +
        brandSmall(d, 76, 738, 33, 9) + A(`left:68px;top:784px;font-size:${fs(d.place_line || d.brand_line, 112, 6.2)}px`, 't-brand', esc(d.place_line || d.brand_line)) +
        rule(76, 900, 64) + tagline(d, 'left:76px;top:928px;font-size:21px') +
        A('left:458px;top:748px;width:2px;height:258px;background:#c9a56a') + cells +
        A('left:65px;top:1043px;width:992px;height:2px;background:#d3b98a') +
        pricebar(d, 'left:65px;top:1070px;width:992px;height:140px;border-radius:30px;background:linear-gradient(90deg,#ece4d6 50%,#dfe0d2 50%)', { old: 'font-size:40px', nw: 'font-size:56px' }) +
        cta(d, 'left:71px;top:1240px;width:428px;height:78px;font-size:21px') + avail(d, 'left:74px;top:1334px') +
        A('left:592px;top:1248px;width:2px;height:74px;background:#c9a56a') +
        A('left:680px;top:1252px', 'cur-t', esc(d.brand.footer)) + A('left:682px;top:1292px;font-size:15px;letter-spacing:.3em', '', esc(d.brand.est)), 'background:#f6f0e6');
    },
  });

  /* 6 ─ Hero + "your stay includes" + 3-photo gallery */
  T.push({
    id: 'gallery', name: 'Hero + gallery', w: 1024, h: 1536,
    slots: [{ key: 'hero', label: 'Hero photo', orient: 'landscape' },
      { key: 'g1', label: 'Gallery 1 · room', orient: 'landscape', hint: 'luxury hotel suite bedroom' },
      { key: 'g2', label: 'Gallery 2 · dining', orient: 'landscape', hint: 'fine dining terrace dinner' },
      { key: 'g3', label: 'Gallery 3 · pool', orient: 'landscape', hint: 'resort infinity pool' }],
    render(d) {
      const cols = [170, 405, 640, 872];
      const per = d.perks.slice(0, 4).map((p, i) => A(`left:${cols[i] - 150}px;top:828px;width:300px;display:flex;flex-direction:column;align-items:center;text-align:center`, '',
        `${perk(d, p, { ico: 80 })}${perkLabel(p, 'margin-top:14px;font-size:18px')}`)).join('');
      const divs = [296, 526, 752].map(x => A(`left:${x}px;top:840px;width:2px;height:116px;background:#c9a56a;opacity:.7`)).join('');
      return root('t6', 1024, 1536,
        PH(d, 'hero', 'left:0;top:0;width:1024px;height:762px') +
        A('left:0;top:0;width:1024px;height:470px;background:linear-gradient(180deg,rgba(246,239,227,.94) 0%,rgba(246,239,227,.82) 50%,rgba(246,239,227,0) 100%)') +
        logo(d, 'left:80px;top:46px', 'style="font-size:56px"', true) +
        hdrNote(d, 'right:52px;top:48px;text-align:right;font-size:14px', rule(920, 124, 52)) +
        A(`left:84px;top:196px;font-size:${fs(d.brand_line, 30, 10)}px;letter-spacing:.3em;text-transform:uppercase;color:#10241f`, '', esc(d.brand_line)) +
        A(`left:80px;top:240px;font-size:${fs(d.place_line || d.brand_line, 128, 7.5)}px;color:#8c6a27`, 't-brand', esc(d.place_line || d.brand_line)) +
        tagline(d, 'left:86px;top:384px;font-size:19px;color:#10241f') +
        A('left:84px;top:790px;font-size:18px;letter-spacing:.3em;text-transform:uppercase', '', 'Your stay includes') + A('left:358px;top:800px;width:582px;height:2px;background:#8f8776') +
        divs + per + note(d, 'left:0;top:1000px;width:1024px;text-align:center;font-size:24px') +
        PH(d, 'g1', 'left:0;top:1052px;width:355px;height:232px') + PH(d, 'g2', 'left:363px;top:1052px;width:312px;height:232px') + PH(d, 'g3', 'left:683px;top:1052px;width:341px;height:232px') +
        pricebar(d, 'left:83px;top:1297px;width:857px;height:140px', { old: 'font-size:38px', nw: 'font-size:46px' }) +
        avail(d, 'left:80px;top:1452px;font-size:18px') + cta(d, 'left:387px;top:1425px;width:278px;height:66px;font-size:19px;background:#14231f') +
        A('left:718px;top:1425px;width:2px;height:72px;background:#c9a56a') +
        A('left:756px;top:1432px;font-size:22px', 'cur-t', esc(d.brand.footer)) + A('left:757px;top:1468px;font-size:12px;letter-spacing:.3em', '', esc(d.brand.est)), 'background:#f6efe3');
    },
  });

  /* 7 ─ Dark-green base with offer headline */
  T.push({
    id: 'green-offer', name: 'Green base · Offer', w: 1024, h: 1536, slots: [{ key: 'hero', label: 'Hero photo', orient: 'portrait' }],
    render(d) {
      const cols = [150, 390, 631, 868];
      const per = d.perks.slice(0, 4).map((p, i) => A(`left:${cols[i] - 120}px;top:1268px;width:240px;display:flex;flex-direction:column;align-items:center;text-align:center`, '',
        `${perk(d, p, { plain: true, ico: 54, swap: true })}${perkLabel(p, 'margin-top:14px;font-size:17px;color:#f1e9da;letter-spacing:.16em')}`)).join('');
      const divs = [268, 515, 748].map(x => A(`left:${x}px;top:1290px;width:2px;height:86px;background:#b98f45;opacity:.55`)).join('');
      const head = d.offer_headline ? A('left:66px;top:474px;width:236px', 'po-badge', 'Special offer') + headlineBlock(d, 66, 556, 560, 112) : '';
      return root('t7', 1024, 1536,
        PH(d, 'hero', 'left:0;top:0;width:1024px;height:1160px') +
        A('left:0;top:0;width:1024px;height:900px;background:linear-gradient(90deg,rgba(244,238,228,.93) 0%,rgba(244,238,228,.8) 38%,rgba(244,238,228,0) 72%)') +
        A('left:0;top:1138px;width:1024px;height:398px;background:#14281f') +
        logo(d, 'left:62px;top:44px', 'style="font-size:50px"', true) +
        A('right:58px;top:50px;font-size:15px;line-height:1.7;letter-spacing:.2em;text-transform:uppercase;text-align:right;width:130px', '', 'Curated by<br>Time Tours') + rule(906, 100, 52) +
        brandBig(d, 64, 172, 160, 7) + placeSmall(d, 68, 338, 40, 9) + tagline(d, 'left:68px;top:392px;font-size:18px') + head +
        pricebar(d, 'left:67px;top:1066px;width:890px;height:136px;background:rgba(244,240,230,.97)', { old: 'font-size:38px', nw: 'font-size:52px' }) +
        A('left:67px;top:1226px;font-size:17px;letter-spacing:.32em;text-transform:uppercase;color:#f1e9da', '', 'Your stay includes') + A('left:366px;top:1236px;width:591px;height:1px;background:#6f8a78') +
        divs + per + A('left:67px;top:1448px;width:112px;height:1px;background:#8aa190') +
        A('left:67px;top:1462px;font-family:Newsreader,serif;font-size:17px;color:#e5dccb', '', esc(d.brand.availability)) +
        cta(d, 'right:66px;top:1414px;width:338px;height:68px;font-size:19px;background:#b98f45;color:#14231f').replace('<svg', '<svg style="stroke:#14231f"'), 'background:#14281f');
    },
  });

  /* 8 ─ Black & gold */
  T.push({
    id: 'black-gold', name: 'Black & gold', w: 1122, h: 1402, slots: [{ key: 'hero', label: 'Right photo', orient: 'portrait' }],
    render(d) {
      return root('t8 dark', 1122, 1402,
        PH(d, 'hero', 'left:523px;top:0;width:599px;height:1102px') +
        A('left:523px;top:0;width:12px;height:1102px;background:linear-gradient(90deg,rgba(0,0,0,.5),transparent)') +
        logo(d, 'left:65px;top:52px', 'style="font-size:58px"') +
        A('left:848px;top:52px;width:2px;height:76px;background:#b98f45') +
        A('left:882px;top:58px;font-size:14px;line-height:1.7;letter-spacing:.2em;text-transform:uppercase;color:#f4eee4', '', nl(d.brand.header_note)) +
        brandSmall(d, 74, 270, 38, 9, '#d3a95f') + A(`left:70px;top:316px;font-size:${fs(d.place_line || d.brand_line, 120, 6.7)}px;color:#f6efe2`, 't-brand', esc(d.place_line || d.brand_line)) +
        rule(76, 444, 72, '#b98f45') + tagline(d, 'left:80px;top:470px;font-size:23px;color:#f4eee4') +
        perkList(d, { left: 76, top: 575, step: 102, w: 440, ico: 86, gap: 40, gap2: 42, fs: 20, color: '#f4eee4' }) +
        rule(76, 996, 86, '#b98f45') + note(d, 'left:76px;top:1018px;width:420px;font-size:25px;color:#f4eee4') +
        pricebar(d, 'left:68px;top:1103px;width:987px;height:120px;background:rgba(14,14,14,.94);border:1.5px solid #b98f45;border-radius:22px', { old: 'font-size:38px', nw: 'font-size:48px' }) +
        cta(d, 'left:68px;top:1242px;width:428px;height:72px;font-size:21px') + avail(d, 'left:74px;top:1332px;color:#f4eee4') +
        A('left:719px;top:1250px;width:2px;height:80px;background:#b98f45') +
        A('left:787px;top:1260px;font-size:25px;color:#f4eee4', 'cur-t', esc(d.brand.footer)) + A('left:790px;top:1300px;font-size:14px;letter-spacing:.3em', '', esc(d.brand.est)), '');
    },
  });

  window.HO_POSTERS = T;
})();
