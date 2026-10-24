/* Trips: Google Maps provider. Same interface as map_leaflet.js: { render(quotes), focus(quoteId) }. */
(function (TT) {
  TT.maps = TT.maps || {};

  const hotelIcon = n => ({
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><circle cx="18" cy="18" r="15" fill="#1d1d1f" stroke="#fff" stroke-width="3"/>' +
      '<text x="18" y="23" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">' + n + '</text></svg>'),
    scaledSize: new google.maps.Size(36, 36), anchor: new google.maps.Point(18, 18),
  });
  const landIcon = () => ({ path: 'M0,-7 L7,0 L0,7 L-7,0 Z', fillColor: '#a67c37', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 1 });

  TT.maps.google = function (el, opts) {
    opts = opts || {};
    el.innerHTML = '';
    const map = new google.maps.Map(el, {
      center: { lat: 20, lng: 0 }, zoom: 2, gestureHandling: 'cooperative', mapTypeControl: true, streetViewControl: false, fullscreenControl: true,
    });
    const info = new google.maps.InfoWindow();
    let overlays = [];
    const pins = {};
    let lastBounds = null;

    const open = (marker, html) => { info.setContent(html); info.open({ map, anchor: marker }); };

    function render(quotes) {
      overlays.forEach(o => o.setMap(null));
      overlays = [];
      Object.keys(pins).forEach(k => delete pins[k]);
      const bounds = new google.maps.LatLngBounds();
      let count = 0;
      quotes.forEach((q, i) => {
        if (q.lat == null || q.lng == null) return;
        const pos = { lat: q.lat, lng: q.lng };
        const html = '<div style="font:14px Inter,Arial,sans-serif;max-width:220px"><b>' + TT.esc(q.hotel_name) + '</b><br>' + TT.esc(q.city || '') + '</div>';
        const m = new google.maps.Marker({ position: pos, map, icon: hotelIcon(i + 1), title: q.hotel_name, zIndex: 10 });
        m.addListener('click', () => { open(m, html); opts.onSelect && opts.onSelect(q.id); });
        overlays.push(m); pins[q.id] = { marker: m, html };
        bounds.extend(pos); count++;
        (q.landmarks || []).forEach(l => {
          if (l.lat == null || l.lng == null) return;
          const lp = { lat: l.lat, lng: l.lng };
          const lm = new google.maps.Marker({ position: lp, map, icon: landIcon(), title: l.name });
          lm.addListener('click', () => open(lm, '<div style="font:14px Inter,Arial,sans-serif"><b>' + TT.esc(l.name) + '</b><br><small>Near ' + TT.esc(q.hotel_name) + '</small></div>'));
          const line = new google.maps.Polyline({
            path: [pos, lp], map, strokeOpacity: 0, geodesic: false,
            icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: .85, strokeColor: '#a67c37', scale: 3 }, offset: '0', repeat: '12px' }],
          });
          overlays.push(lm, line); bounds.extend(lp);
        });
      });
      if (count) {
        lastBounds = bounds;
        map.fitBounds(bounds, 60);
        google.maps.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > 15) map.setZoom(15); });
      }
    }
    function focus(id) {
      const p = pins[id];
      if (!p) return;
      map.panTo(p.marker.getPosition());
      if (map.getZoom() < 14) map.setZoom(14);
      open(p.marker, p.html);
    }
    return { render, focus, resize() { google.maps.event.trigger(map, 'resize'); if (lastBounds) map.fitBounds(lastBounds, 60); } };
  };
})(window.TT);
