export type BranchLocation = {
  addressLine1: string | null; addressLine2: string | null;
  municipality: string | null; region: string | null; country: string | null;
  latitude: number | null; longitude: number | null;
};

// Additive fields from older responses are treated as absent, never fabricated.
export function parseBranchLocation(value: Record<string, unknown>): BranchLocation {
  const text = (key: string): string | null => {
    const field = value[key];
    if (field === undefined || field === null) return null;
    if (typeof field !== 'string') throw new Error('Respuesta de ubicación inválida.');
    return field;
  };
  const coordinate = (key: string): number | null => {
    const field = value[key];
    if (field === undefined || field === null) return null;
    return typeof field === 'number' && Number.isFinite(field) ? field : null;
  };
  return { addressLine1: text('addressLine1'), addressLine2: text('addressLine2'), municipality: text('municipality'),
    region: text('region'), country: text('country'), latitude: coordinate('latitude'), longitude: coordinate('longitude') };
}

export function coordinates(location: BranchLocation): { latitude: number; longitude: number } | null {
  const { latitude, longitude } = location;
  return typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
    typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}

const clean = (value: string | null): string => value?.trim() ?? '';
export function addressLabel(location: BranchLocation): string {
  return [location.addressLine1, location.addressLine2, location.municipality, location.region, location.country].map(clean).filter(Boolean).join(', ');
}

export function directionsUrl(location: BranchLocation): string | null {
  const pair = coordinates(location);
  const street = clean(location.addressLine1), city = clean(location.municipality), country = clean(location.country);
  // Conservative fallback; no geocoding or claim that free-text addresses are exact.
  const usableAddress = /\p{L}/u.test(street) && /\d/.test(street) && street.length >= 5 && city.length >= 2 && country.length >= 2;
  const destination = pair ? `${pair.latitude},${pair.longitude}` : usableAddress ? addressLabel(location) : null;
  if (!destination) return null;
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1'); url.searchParams.set('destination', destination);
  return url.href.length <= 2048 ? url.href : null;
}

export function osmEmbedUrl(location: BranchLocation): string | null {
  const pair = coordinates(location);
  if (!pair) return null;
  const { latitude, longitude } = pair;
  const url = new URL('https://www.openstreetmap.org/export/embed.html');
  url.searchParams.set('bbox', [Math.max(-180, longitude - 0.006), Math.max(-90, latitude - 0.004),
    Math.min(180, longitude + 0.006), Math.min(90, latitude + 0.004)].join(','));
  url.searchParams.set('layer', 'mapnik'); url.searchParams.set('marker', `${latitude},${longitude}`);
  return url.href;
}
