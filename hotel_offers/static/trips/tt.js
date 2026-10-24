/* Trips: shared helpers (namespace TT). Loaded first by both the agent page and the client page. */
window.TT = window.TT || {};
(function (TT) {
  TT.$ = (s, r) => (r || document).querySelector(s);
  TT.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  TT.esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  TT.num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^\d.]/g, '')); return isFinite(n) ? n : 0; };
  TT.money = (n, cur) => {
    const sym = { INR: '₹', USD: '$', EUR: '€', GBP: '£', THB: '฿', AED: 'AED ' }[cur || 'INR'];
    return (sym === undefined ? (cur || '') + ' ' : sym) + Math.round(n || 0).toLocaleString('en-IN');
  };
  TT.date = iso => {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  TT.addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  TT.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  TT.api = async (url, opts) => {
    const o = Object.assign({ headers: {} }, opts || {});
    if (o.json !== undefined) { o.body = JSON.stringify(o.json); o.headers['Content-Type'] = 'application/json'; delete o.json; }
    const r = await fetch(url, o);
    let data = {};
    try { data = await r.json(); } catch (e) { /* empty body */ }
    if (!r.ok) throw new Error(data.error || ('Request failed (' + r.status + ')'));
    return data;
  };
  TT.toast = (msg, kind) => {
    let el = TT.$('#ttToast');
    if (!el) { el = document.createElement('div'); el.id = 'ttToast'; document.body.appendChild(el); }
    el.textContent = msg; el.className = 'show ' + (kind || '');
    clearTimeout(TT._tt); TT._tt = setTimeout(() => { el.className = ''; }, 2600);
  };
  TT.photoUrl = (ref, w) => ref.indexOf('u:') === 0 ? '/api/hotel-offers/trips/photos/' + ref.slice(2) :
    '/api/hotel-offers/photo?src=google&w=' + (w || 400) + '&ref=' + encodeURIComponent(ref);
})(window.TT);
