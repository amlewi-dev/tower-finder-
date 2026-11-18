const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial great-circle bearing, degrees clockwise from true north. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function formatDistance(m: number) {
  if (m < 1000) return `${Math.round(m / 5) * 5} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export function cardinal(deg: number) {
  return DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** Smallest signed angle (-180..180) between two bearings. */
export function angleDiff(a: number, b: number) {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

/**
 * How many degrees either side of the bearing still point at the tower,
 * given the tower position uncertainty and your GPS accuracy.
 */
export function aimTolerance(distM: number, towerAccM = 0, gpsAccM = 0) {
  const spread = Math.hypot(towerAccM, gpsAccM);
  if (distM <= 1) return 45;
  return Math.min(45, Math.max(6, toDeg(Math.atan2(spread, distM))));
}
