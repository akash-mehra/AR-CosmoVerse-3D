/*
 * The slot for Google Photorealistic 3D Tiles, below the GIBS imagery's
 * region level. It stays empty until the Map Tiles API's pricing has been
 * checked: nothing is requested from Google and no key is read, so none can
 * end up in the bundle.
 *
 * Filling it means, and these are conditions of using the tiles at all:
 * - the key comes from VITE_GOOGLE_TILES_KEY, a Map Tiles API key restricted
 *   to the site's domains: it runs in the browser, where anyone can read it;
 * - Google's attribution (the copyright strings the tiles carry) shows
 *   whenever its tiles are drawn;
 * - its tiles never go through the HD download's cache (solar/hdMaps.js):
 *   Google's terms forbid storing them.
 *
 * Returns what the Earth layer should draw, or null while the slot is empty.
 */
export function googleTiles() {
  return null;
}
