/* Trips: map factory. Google Maps when its script loaded; otherwise (or if the key is rejected) OpenStreetMap via Leaflet.
   TT.createMap(element, { onSelect(quoteId) }) -> { render(quotes), focus(quoteId) } */
(function (TT) {
  const live = [];  // maps created with Google, so they can be swapped if the key turns out to be rejected

  window.gm_authFailure = function () {  // Google calls this when the key is invalid / the Maps JavaScript API is not enabled
    TT.googleFailed = true;
    live.splice(0).forEach(w => w.swap());
  };

  TT.createMap = function (el, opts) {
    const wrapper = { impl: null, quotes: [], render(q) { this.quotes = q; this.impl.render(q); }, focus(id) { this.impl.focus(id); }, resize() { this.impl.resize(); } };
    if (window.google && google.maps && !TT.googleFailed) {
      wrapper.impl = TT.maps.google(el, opts);
      wrapper.swap = () => {
        wrapper.impl = TT.maps.leaflet(el, opts);
        wrapper.impl.render(wrapper.quotes);
      };
      live.push(wrapper);
    } else {
      wrapper.impl = TT.maps.leaflet(el, opts);
    }
    return wrapper;
  };
})(window.TT);
