
module.exports = {
  getEmbedHint() {
    return {
      integrationNeeded: false,
      provider: process.env.MAPS_PROVIDER || 'osm',
      message: 'Free OpenStreetMap + Leaflet mode is enabled for the tracking board. You can swap in Google Maps, Mapbox, or Here later.'
    };
  }
};
