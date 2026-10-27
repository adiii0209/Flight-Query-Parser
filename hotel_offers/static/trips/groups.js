/* Trips: grouping of hotel quotes (city + dates -> options -> room lines). Mirrors trip_groups.py; used by the agent and client pages.
   Same city and dates = one group. Rows for the same hotel in a group = ONE option (several rooms, all needed, totals added);
   different hotels = alternatives. Nothing is selected until the guest picks (selectedOption is null). */
(function (TT) {
  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const groupKey = q => norm(q.city) + '|' + (q.date || '') + '|' + (parseInt(q.nights, 10) || 0);
  const optionKey = q => norm(q.hotel_name) || 'q' + q.id;

  /** quotes: in the agent's order. selection: { groupKey: optionKey }. */
  TT.groupQuotes = function (quotes, selection) {
    selection = selection || {};
    const map = new Map();
    quotes.forEach(q => {
      const gk = groupKey(q);
      if (!map.has(gk)) map.set(gk, { key: gk, city: q.city || '', date: q.date || null, nights: parseInt(q.nights, 10) || 0, options: new Map(), first: map.size });
      const g = map.get(gk), ok = optionKey(q);
      if (!g.options.has(ok)) g.options.set(ok, { key: ok, hotel_name: q.hotel_name || '', lines: [], total: 0 });
      const o = g.options.get(ok);
      o.lines.push(q); o.total += Math.round(q.total || 0);
    });
    return Array.from(map.values()).sort((a, b) => ((a.date || '9999-99-99') < (b.date || '9999-99-99') ? -1 : (a.date || '9999-99-99') > (b.date || '9999-99-99') ? 1 : a.first - b.first)).map(g => {
      const options = Array.from(g.options.values());
      const chosen = options.find(o => o.key === selection[g.key]) || null;
      return Object.assign(g, {
        options, selected: chosen ? chosen.key : null, explicit: !!chosen, selectedOption: chosen,
        checkout: g.date && g.nights ? TT.addDays(g.date, g.nights) : '',
      });
    });
  };

  TT.groupsTotal = groups => groups.reduce((s, g) => s + (g.selectedOption ? g.selectedOption.total : 0), 0);

  /** One map pin per option (its first line that has a location), numbered by city card. selectedOnly: just the chosen hotel of each city. */
  TT.groupPins = function (groups, selectedOnly) {
    const pins = [];
    groups.forEach((g, gi) => g.options.forEach(o => {
      if (selectedOnly && o.key !== g.selected) return;
      const line = o.lines.find(l => l.lat != null && l.lng != null);
      if (!line) return;
      pins.push(Object.assign({}, line, { num: gi + 1, hotel_name: o.hotel_name || line.hotel_name, landmarks: o.lines.reduce((a, l) => a.length ? a : (l.landmarks || []), []) }));
    }));
    return pins;
  };
})(window.TT);
