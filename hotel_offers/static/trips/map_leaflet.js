/* Trips: Leaflet map provider. Tiles come from TT.tileLayerOptions() (map.js). */
(function (TT) {
  const hotelIcon = n => L.divIcon({ className: 'tt-pin', html: '<span>' + n + '</span>', iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] });
  const landIcon = () => L.divIcon({ className: 'tt-pin tt-land', html: '<span></span>', iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -8] });

  const spotIcon = n => L.divIcon({ className: 'tt-pin tt-spot', html: '<span>' + String.fromCharCode(65 + n) + '</span>', iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12] });

  TT.maps = TT.maps || {};
  TT.maps.leaflet = function (el, opts) {
    opts = opts || {};
    el.innerHTML = '';
    if (!window.L) { el.innerHTML = '<p class="tt-nomap">The map could not be loaded.</p>'; return { render() {}, focus() {} }; }
    const map = L.map(el, { scrollWheelZoom: false, zoomControl: false, dragging: !(opts.mini && L.Browser.mobile) }).setView([20, 0], 2);  // a small map on a phone must not trap the page scroll
    L.control.zoom({ position: 'bottomright' }).addTo(map);  // top of the map is used by the hotel chips
    const tiles = TT.tileLayerOptions();
    L.tileLayer(tiles.url, tiles.options).addTo(map);
    const layer = L.layerGroup().addTo(map);
    const pins = {}, spotPins = [];
    let fitted = false, pinsBounds = null, inset = 0;  // inset: the bottom sheet of a phone covers this many pixels of the map
    const fit = () => (inset ? { maxZoom: 15, paddingTopLeft: [0, 56], paddingBottomRight: [0, inset] } : { maxZoom: 15 });
    const shifted = (ll, z) => (inset ? map.unproject(map.project(ll, z).add([0, (inset - 56) / 2]), z) : ll);  // put the pin in the middle of what is still visible

    function render(quotes, spots) {
      layer.clearLayers();
      Object.keys(pins).forEach(k => delete pins[k]);
      spotPins.length = 0;
      const pts = [];
      (spots || []).forEach((s, i) => {  // the local guide: lettered pins A, B, C
        if (s.lat == null || s.lng == null) return;
        pts.push([s.lat, s.lng]);
        spotPins[i] = L.marker([s.lat, s.lng], { icon: spotIcon(i), title: s.name }).addTo(layer)
          .bindPopup('<b>' + TT.esc(s.name) + '</b>' + (s.blurb ? '<br><small>' + TT.esc(s.blurb) + '</small>' : s.kind ? '<br><small>' + TT.esc(s.kind) + '</small>' : ''));
      });
      quotes.forEach((q, i) => {
        if (q.lat == null || q.lng == null) return;
        const p = [q.lat, q.lng];
        pts.push(p);
        const m = L.marker(p, { icon: hotelIcon(q.num || i + 1), title: q.hotel_name }).addTo(layer);
        m.bindPopup('<b>' + TT.esc(q.hotel_name) + '</b><br>' + TT.esc(q.city || ''));
        m.on('click', () => opts.onSelect && opts.onSelect(q.id));
        pins[q.id] = m;
        (q.near_spots || []).forEach(s => L.polyline([p, [s.lat, s.lng]], { color: '#a67c37', weight: 1.5, dashArray: '4 5', opacity: .8 }).addTo(layer));
        (q.landmarks || []).forEach(l => {
          if (l.lat == null) return;
          pts.push([l.lat, l.lng]);
          L.polyline([p, [l.lat, l.lng]], { color: '#a67c37', weight: 1.5, dashArray: '4 5', opacity: .8 }).addTo(layer);
          L.marker([l.lat, l.lng], { icon: landIcon(), title: l.name }).addTo(layer).bindPopup('<b>' + TT.esc(l.name) + '</b><br><small>Near ' + TT.esc(q.hotel_name) + '</small>');
        });
      });
      if (pts.length) {
        pinsBounds = L.latLngBounds(pts).pad(0.25);
        map.fitBounds(pinsBounds, fit());
        fitted = true;
      } else if (!fitted) map.setView([20, 0], 2);
      setTimeout(() => map.invalidateSize(), 50);
    }
    function focus(id) {
      const m = pins[id];
      if (!m) return;
      const z = Math.min(Math.max(map.getZoom(), 14), 16);
      map.flyTo(shifted(m.getLatLng(), z), z, { duration: .6 });
      m.openPopup();
    }
    function focusSpot(i) {
      const m = spotPins[i];
      if (!m) return;
      const z = Math.min(Math.max(map.getZoom(), 14), 16);
      map.flyTo(shifted(m.getLatLng(), z), z, { duration: .6 });
      m.openPopup();
    }
    function showAll() {
      map.closePopup();
      if (pinsBounds) map.flyToBounds(pinsBounds, Object.assign(fit(), { duration: .6 }));
    }
    return { render, focus, focusSpot, showAll, drag(on) { if (on) map.dragging.enable(); else if (opts.mini && L.Browser.mobile) map.dragging.disable(); }, destroy() { map.remove(); }, resize() { map.invalidateSize(); if (pinsBounds) map.fitBounds(pinsBounds, fit()); },
      setInset(px, refit) { inset = px; if (refit && pinsBounds) { map.invalidateSize(); map.flyToBounds(pinsBounds, Object.assign(fit(), { duration: .35 })); } } };
  };
})(window.TT);
