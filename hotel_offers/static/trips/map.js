/* Trips: map factory. Maps are Leaflet with the raster tile template chosen in Hotel Offers settings.
   TT.createMap(element, { onSelect(quoteId) }) -> { render(quotes), focus(quoteId), resize() } */
(function (TT) {
  const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

  TT.tileLayerOptions = function () {
    const url = (document.body.dataset.tiles || '').trim() || OSM;
    let attribution = '© OpenStreetMap';
    if (/google\./.test(url)) attribution = 'Map data © Google';
    else if (/cartocdn/.test(url)) attribution = '© OpenStreetMap © CARTO';
    else if (/arcgisonline/.test(url)) attribution = 'Imagery © Esri';
    return { url, options: { maxZoom: 20, attribution } };
  };

  TT.createMap = (el, opts) => TT.maps.leaflet(el, opts);
})(window.TT);
