/* HR: document content and rendering. Builds the data of an offer letter or payslip from a person and the workspace templates,
   and turns that data into the paper (HTML) used by both the live preview and printing. Nothing here talks to the server. */
(function (HR) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // ---- numbers and dates
  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = n => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''));
  const three = n => (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n));
  /** 22870 -> "Twenty-Two Thousand Eight Hundred Seventy" (Indian grouping: crore, lakh, thousand) */
  function words(n) {
    n = Math.floor(Math.abs(Number(n) || 0));
    if (!n) return 'Zero';
    const parts = [[Math.floor(n / 1e7), 'Crore'], [Math.floor(n / 1e5) % 100, 'Lakh'], [Math.floor(n / 1e3) % 100, 'Thousand'], [n % 1000, '']];
    return parts.filter(p => p[0]).map(p => (p[1] ? two(p[0]) + ' ' + p[1] : three(p[0]))).join(' ');
  }
  const inr = n => '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = v => { const x = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isFinite(x) ? x : 0; };
  const parseISO = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const ordinal = d => d + (d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th');
  const longDate = iso => { const d = parseISO(iso); return d ? ordinal(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() : ''; };  // 19th Jan 2026
  const slashDate = iso => { const d = parseISO(iso); return d ? String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear() : ''; };  // 03/10/2026
  const letterDate = iso => { const d = parseISO(iso); return d ? MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() : ''; };  // Jan 17, 2026
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const monthLabel = (y, m) => FULL_MONTHS[m] + ' ' + y;
  const money0 = n => (Number(n) || 0).toLocaleString('en-IN');

  // ---- text: variables, **bold**, *italic*
  function fill(text, vars) {
    return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (all, k) => (vars[k] != null && vars[k] !== '' ? vars[k] : all));
  }
  function rich(text, vars) {
    let s = esc(fill(text, vars));
    s = s.replace(/\{\{\s*(\w+)\s*\}\}/g, '<mark class="hd-miss">{{$1}}</mark>');  // a variable nobody filled in stays visible
    s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
    return s.replace(/\n/g, '<br>');
  }
  const varsIn = text => Array.from(String(text || '').matchAll(/\{\{\s*(\w+)\s*\}\}/g), m => m[1]);

  // ---- the text editor of a letter block: details show as chips, **bold** and *italic* as real bold and italic
  const LABELS = { name: 'Name', title: 'Job title', join_date: 'Joining date', salary: 'Salary', salary_words: 'Salary in words', stipend: 'Stipend', duration: 'Duration', probation: 'Probation', office_hours: 'Office hours', join_time: 'Joining time',
    notice: 'Notice period', min_days: 'Minimum days', company_short: 'Company', company_legal: 'Company legal name', company_name: 'Company full name', signatory_name: 'Signatory', signatory_title: 'Signatory title', date: 'Letter date' };
  const labelOf = k => LABELS[k] || String(k).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
  const chip = (k, value) => '<span class="var" contenteditable="false" data-k="' + esc(k) + '" title="' + esc(value || 'Not filled in yet') + '">' + esc(labelOf(k)) + '</span>';
  function markupToHtml(text, valueOf) {
    let t = esc(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (all, k) => chip(k, valueOf ? valueOf(k) : ''));
    t = t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
    return t.replace(/\n/g, '<br>');
  }
  function htmlToMarkup(el) {
    const walk = node => Array.from(node.childNodes).map(n => {
      if (n.nodeType === 3) return n.nodeValue.replace(/[\u00a0\u200b]/g, ' ');
      if (n.nodeType !== 1) return '';
      const tag = n.tagName;
      if (tag === 'SPAN' && n.classList.contains('var')) return '{{' + n.dataset.k + '}}';
      if (tag === 'BR') return '\n';
      const inner = walk(n);
      if (tag === 'B' || tag === 'STRONG') return inner.trim() ? '**' + inner + '**' : inner;
      if (tag === 'I' || tag === 'EM') return inner.trim() ? '*' + inner + '*' : inner;
      if (tag === 'DIV' || tag === 'P') return '\n' + inner;
      return inner;
    }).join('');
    return walk(el).replace(/^\n/, '').replace(/\n+$/, '').replace(/\*\*\s*\*\*/g, '').replace(/ {2,}/g, ' ').replace(/ \n/g, '\n');
  }
  /** "12 Owner's Court, Mayfair Road, Ballygunge, Kolkata - 700019" -> three lines for the letter */
  function splitAddress(a) {
    a = String(a || '').trim();
    if (!a) return [];
    const lines = a.split(/\n+/).map(x => x.trim()).filter(Boolean);
    if (lines.length > 1) return lines;
    const parts = a.split(/\s*,\s*/).filter(Boolean);
    if (parts.length <= 3) return parts;
    const rest = parts.slice(0, -1), cut = Math.ceil(rest.length / 2);
    return [rest.slice(0, cut).join(', '), rest.slice(cut).join(', '), parts[parts.length - 1]];
  }

  // ---- offer letter
  /** the variables a letter can use, with the person's details in them */
  function offerVars(cfg, emp, tpl) {
    const amount = Number(emp.amount) || 0;
    const v = Object.assign({}, tpl.vars || {});
    v.name = emp.full_name || '';
    v.title = emp.designation || emp.title || '';
    v.join_date = longDate(emp.join_date) || '';
    if (emp.title !== 'Intern' && !/intern/i.test(emp.title || '')) { v.salary = money0(amount); v.salary_words = amount ? words(amount) : ''; }
    else v.stipend = amount ? money0(amount) : (v.stipend || '');
    return v;
  }

  function newOffer(cfg, emp, templateKey) {
    const tpl = clone(cfg.offers[templateKey] || cfg.offers.employee);
    const lines = [emp.full_name, emp.institute].concat(splitAddress(emp.address)).filter(Boolean).join('\n');
    return {
      kind: 'offer', template: templateKey, summary: (tpl.label || 'Offer letter') + ' · ' + (emp.full_name || ''),
      date: today(), recipient: lines, letterhead: tpl.letterhead || 'company', header_title: tpl.header_title || '',
      company: clone(cfg.company), signatory: clone(cfg.signatory), vars: offerVars(cfg, emp, tpl), blocks: tpl.blocks,
      style: { font: 'Times New Roman, serif', size: 11, align: 'justify', rule: true },
    };
  }

  /** built-in variables come from the letter's own company and signatory, so editing those changes the text */
  function allVars(doc) {
    const c = doc.company || {}, s = doc.signatory || {};
    return Object.assign({ company_short: c.short_name || c.name || '', company_legal: c.legal_name || c.name || '', company_name: c.name || '', signatory_name: s.name || '', signatory_title: s.title || '', date: letterDate(doc.date) }, doc.vars || {});
  }

  function letterhead(doc) {
    const c = doc.company || {}, v = allVars(doc);
    const logo = c.logo ? '<img class="hd-logo" src="' + esc(c.logo) + '" alt="">' : '';
    if (doc.letterhead === 'none') return '';
    if (doc.letterhead === 'logo') {
      return '<div class="hd-top hd-top-logo"><div class="hd-ttl">' + esc(fill(doc.header_title, v)) + '</div>' + logo + '</div><div class="hd-rule heavy"></div>';
    }
    const info = ['<b>' + esc(c.name) + '</b>'].concat(String(c.address || '').split('\n').filter(Boolean).map(l => '⚲ ' + esc(l)), c.phone ? ['☎ ' + esc(c.phone)] : [], c.email ? ['✉ ' + esc(c.email)] : []);
    return '<div class="hd-top"><div class="hd-co">' + logo + '</div><div class="hd-info">' + info.join('<br>') + '</div></div><div class="hd-rule"></div>';
  }

  function blockHtml(b, v, counter) {
    if (b.t === 'h') return '<h3>' + rich(b.text, v) + '</h3>';
    if (b.t === 'num') return '<div class="hd-num"><span>' + (++counter.n) + '.</span><div>' + rich(b.text, v) + '</div></div>';
    if (b.t === 'sign') return '<div class="hd-sign">' + rich(b.text, v) + '</div>';
    if (b.t === 'accept') return '<div class="hd-accept">' + String(b.text || '').split('\n').filter(Boolean).map(l => '<div><span>' + esc(l) + '</span><i></i></div>').join('') + '</div>';
    if (b.t === 'sp') return '<div class="hd-sp"></div>';
    return '<p>' + rich(b.text, v) + '</p>';
  }

  function offerHtml(doc) {
    const v = allVars(doc), st = doc.style || {};
    const pages = [[]];
    (doc.blocks || []).forEach(b => { if (b.t === 'pb') pages.push([]); else pages[pages.length - 1].push(b); });
    const counter = { n: 0 };
    return pages.map((blocks, i) => {
      const head = i === 0 || doc.letterhead === 'logo' ? letterhead(doc) : '';
      const intro = i === 0 ? '<div class="hd-date">Date: ' + esc(letterDate(doc.date)) + '</div><div class="hd-to">' + esc(doc.recipient || '').replace(/\n/g, '<br>') + '</div>' : '';
      return '<section class="pg hd-offer" style="font-family:' + esc(st.font || 'serif') + ';font-size:' + (+st.size || 11) + 'pt;text-align:' + (st.align === 'left' ? 'left' : 'justify') + '">' + head + intro +
        '<div class="hd-body">' + blocks.map(b => blockHtml(b, v, counter)).join('') + '</div></section>';
    }).join('');
  }

  // ---- payslip
  function newPayslip(cfg, emp, year, month, lop) {
    const amount = Number(emp.amount) || 0, ps = cfg.payslip || {};
    const days = new Date(year, month + 1, 0).getDate(), period = monthLabel(year, month);
    const payDate = new Date(year, month + 1, 3), pd = payDate.getFullYear() + '-' + String(payDate.getMonth() + 1).padStart(2, '0') + '-03';
    return {
      kind: 'payslip', summary: 'Payslip ' + period + ' · ' + (emp.full_name || ''),
      company: clone(cfg.company), period, pay_date: pd, accent: ps.accent || '#16a34a',
      rows: [{ label: 'Employee Name', value: emp.full_name || '' }, { label: 'Employee ID', value: emp.emp_code || '' }, { label: 'Pay Period', value: period }, { label: 'Pay Date', value: slashDate(pd) }].concat(
        emp.designation ? [{ label: 'Designation', value: emp.designation }] : [], emp.pan ? [{ label: 'PAN', value: emp.pan }] : []),
      paid_days: days - (lop || 0), lop_days: lop || 0,
      earnings: (ps.earnings || ['Basic']).map((l, i) => ({ label: l, amount: i === 0 ? Math.round(amount * (days - (lop || 0)) / days) : 0 })),  // loss-of-pay days reduce the first earning
      deductions: (ps.deductions || []).map(l => ({ label: l, amount: 0 })),
      footer: ps.footer || '', show_words: true, show_logo: false,
    };
  }

  function totals(doc) {
    const gross = (doc.earnings || []).reduce((s, r) => s + num(r.amount), 0), ded = (doc.deductions || []).reduce((s, r) => s + num(r.amount), 0);
    return { gross, ded, net: gross - ded };
  }

  function payslipHtml(doc) {
    const t = totals(doc), c = doc.company || {}, acc = doc.accent || '#16a34a';
    const rows = (doc.rows || []).map(r => '<div class="ps-r"><span>' + esc(r.label) + '</span><i>:</i><b>' + esc(r.value) + '</b></div>').join('');
    const line = r => '<div class="ps-l"><span>' + esc(r.label) + '</span><b>' + inr(num(r.amount)) + '</b></div>';
    return '<section class="pg hd-pay" style="--acc:' + esc(acc) + '"><div class="ps-head"><div><div class="ps-co">' + esc(c.name) + '</div><div class="ps-ad">' + esc(String(c.address || '').replace(/\n/g, ', ')) + '</div></div>' +
      '<div class="ps-per"><span>Payslip For the Month</span><b>' + esc(doc.period) + '</b></div></div><div class="hd-rule thin"></div>' +
      '<div class="ps-sum"><div><h4>EMPLOYEE SUMMARY</h4>' + rows + '</div><div class="ps-net"><div class="ps-net-top"><b>' + inr(t.net) + '</b><span>Total Net Pay</span></div>' +
      '<div class="ps-r"><span>Paid Days</span><i>:</i><b>' + esc(doc.paid_days) + '</b></div><div class="ps-r"><span>LOP Days</span><i>:</i><b>' + esc(doc.lop_days) + '</b></div></div></div>' +
      '<div class="ps-tab"><div><h4><span>EARNINGS</span><span>AMOUNT</span></h4>' + (doc.earnings || []).map(line).join('') + '</div><div><h4><span>DEDUCTIONS</span><span>AMOUNT</span></h4>' + (doc.deductions || []).map(line).join('') + '</div>' +
      '<div class="ps-tot"><span>Gross Earnings</span><b>' + inr(t.gross) + '</b></div><div class="ps-tot"><span>Total Deductions</span><b>' + inr(t.ded) + '</b></div></div>' +
      '<div class="ps-pay"><div><b>TOTAL NET PAYABLE</b><small>Gross Earnings - Total Deductions</small></div><b class="ps-amt">' + inr(t.net) + '</b></div>' +
      (doc.show_words ? '<div class="ps-words">Amount In Words : <b>Indian Rupee ' + esc(words(t.net)) + ' Only</b></div>' : '') +
      '<div class="hd-rule thin"></div><div class="ps-foot">' + esc(doc.footer) + '</div></section>';
  }

  const html = doc => (doc.kind === 'payslip' ? payslipHtml(doc) : offerHtml(doc));

  /** the stylesheet of the paper; used inside the preview and in the print window */
  const CSS = `
.pg{box-sizing:border-box;width:210mm;min-height:297mm;padding:16mm 20mm 18mm;background:#fff;color:#111;margin:0 auto;position:relative;line-height:1.45}
.pg *{box-sizing:border-box}
.hd-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.hd-logo{height:44px;max-width:210px;object-fit:contain}
.hd-info{text-align:right;font-size:9.5pt;line-height:1.5}
.hd-ttl{font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:11pt;text-decoration:underline;padding:8px 0 0 12px}
.hd-top-logo{min-height:60px}
.hd-rule{border-top:1.2px solid #111;margin:10px 0 18px}.hd-rule.heavy{border-top:3px solid #111;margin:22px 0 22px}.hd-rule.thin{border-top:1px solid #d9d9de;margin:12px 0}
.hd-date{margin:6px 0 22px}.hd-to{margin-bottom:26px}
.hd-body p{margin:0 0 .85em}.hd-body h3{font-size:1em;margin:1em 0 .4em;text-decoration:underline}
.hd-num{display:flex;gap:8px;margin:0 0 .65em}.hd-num>span{flex:0 0 1.6em}.hd-num>div{flex:1}
.hd-sign{margin-top:1.6em;white-space:normal}
.hd-accept div{display:flex;gap:8px;align-items:flex-end;margin:20px 0}.hd-accept span{flex:0 0 auto}.hd-accept i{flex:1;border-bottom:1px solid #111;height:1px;max-width:320px}
.hd-sp{height:1.4em}
mark.hd-miss{background:#fde68a;color:#92400e;padding:0 2px;border-radius:3px}
.hd-pay{font-family:Inter,Arial,Helvetica,sans-serif;font-size:9.5pt;color:#1f2330;line-height:1.35}
.ps-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.ps-co{font-weight:700;font-size:13pt}.ps-ad{color:#6b7280;font-size:8.5pt;margin-top:2px}
.ps-per{text-align:right;color:#6b7280;font-size:8.5pt}.ps-per b{display:block;color:#111;font-size:11pt;margin-top:2px}
.ps-sum{display:grid;grid-template-columns:1fr 1fr;gap:26px;margin:14px 0 22px}
.hd-pay h4{margin:0 0 8px;font-size:8.5pt;letter-spacing:.02em;color:#4b5563;font-weight:600}
.ps-r{display:grid;grid-template-columns:110px 14px 1fr;font-size:9pt;margin:5px 0}.ps-r span{color:#6b7280}.ps-r b{font-weight:500}
.ps-net{border:1px solid #e1e3ea;border-radius:10px;overflow:hidden;padding-bottom:6px}
.ps-net-top{background:color-mix(in srgb,var(--acc) 9%,#fff);border-left:3px solid var(--acc);padding:12px 16px;border-bottom:1px dotted #9ca3af;margin-bottom:8px}
.ps-net-top b{display:block;font-size:19pt;font-weight:400}.ps-net-top span{color:#4b5563;font-size:8.5pt}
.ps-net .ps-r{padding:0 16px}
.ps-tab{display:grid;grid-template-columns:1fr 1fr;gap:0 24px;border:1px solid #e1e3ea;border-radius:10px;padding:14px 14px 0;margin-bottom:14px}
.ps-tab h4{display:flex;justify-content:space-between;border-bottom:1px dotted #9ca3af;padding-bottom:8px;color:#111;font-weight:700}
.ps-l{display:flex;justify-content:space-between;padding:7px 0;font-size:8.8pt}.ps-l b{font-weight:600}
.ps-tot{display:flex;justify-content:space-between;background:#f6f6fa;margin:0 -14px;padding:9px 14px;font-weight:700;font-size:8.8pt;margin-top:12px}
.ps-tot:nth-of-type(1){grid-column:1}.ps-tot:nth-of-type(2){grid-column:2}
.ps-pay{display:flex;justify-content:space-between;align-items:stretch;border:1px solid #e1e3ea;border-radius:10px;overflow:hidden}
.ps-pay>div{padding:12px 14px}.ps-pay b{font-size:9pt}.ps-pay small{display:block;color:#6b7280;font-size:8pt;margin-top:2px}
.ps-pay .ps-amt{display:flex;align-items:center;background:color-mix(in srgb,var(--acc) 9%,#fff);padding:0 22px;font-size:10.5pt}
.ps-words{text-align:right;color:#6b7280;font-size:8.8pt;margin:14px 0}.ps-words b{color:#111;font-weight:500}
.ps-foot{text-align:center;color:#6b7280;font-size:7.5pt;margin-top:20px}
@page{size:A4;margin:0}
@media print{.pg{margin:0;page-break-after:always;break-after:page}.pg:last-child{page-break-after:auto;break-after:auto}mark.hd-miss{background:none;color:inherit}}
`;

  /** opens a print window with the paper only: use "Save as PDF" in the print dialog */
  function print(input) {  // one document, or a list of them (one page each)
    const docs = Array.isArray(input) ? input : [input], doc = docs[0];
    const w = window.open('', '_blank');
    if (!w) return false;
    const font = '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">';
    w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(doc.summary || 'Document') + '</title>' + font + '<style>body{margin:0;background:#fff}' + CSS + '</style></head><body>' + docs.map(html).join('') + '</body></html>');
    w.document.close();
    const go = () => { w.focus(); w.print(); };
    setTimeout(go, 700);  // after the logo and the font have loaded
    return true;
  }

  Object.assign(HR, { markupToHtml, htmlToMarkup, splitAddress, labelOf, daysIn: (y, m) => new Date(y, m + 1, 0).getDate(), esc, clone, words, inr, num, longDate, slashDate, letterDate, today, parseISO, FULL_MONTHS, monthLabel, money0, rich, fill, varsIn, allVars, offerVars, newOffer, newPayslip, totals, html, CSS, print });
})(window.HR = window.HR || {});
