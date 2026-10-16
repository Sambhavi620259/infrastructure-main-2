/** OpenStreetMap links for an office location pin (no API key needed). */

export function mapLink(latitude: number, longitude: number): string {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
}

/** A small embeddable map centred on the pin, with a marker. */
export function mapEmbedUrl(latitude: number, longitude: number): string {
  const d = 0.005;
  const bbox = [longitude - d, latitude - d, longitude + d, latitude + d].map((n) => n.toFixed(5)).join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude},${longitude}`;
}

/** Search for an address on the map, to find its coordinates. */
export function mapSearchLink(address: string): string {
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`;
}
