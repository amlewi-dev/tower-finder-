import { Linking, Platform } from "react-native";

/**
 * Turn-by-turn directions in the phone's native maps app, falling back to Google Maps on the web.
 * Walks under 2 km, drives beyond.
 */
export async function openDirections(lat: number, lon: number, label: string, distM: number) {
  const walk = distM < 2000;
  const dest = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  const name = encodeURIComponent(label);
  const candidates =
    Platform.OS === "ios"
      ? [`maps://?daddr=${dest}&dirflg=${walk ? "w" : "d"}&q=${name}`]
      : Platform.OS === "android"
        ? [`google.navigation:q=${dest}&mode=${walk ? "w" : "d"}`, `geo:${dest}?q=${dest}(${name})`]
        : [];
  for (const url of candidates) {
    try {
      await Linking.openURL(url);
      return;
    } catch {
      // app not installed, try the next option
    }
  }
  await Linking.openURL(
    `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=${walk ? "walking" : "driving"}`,
  ).catch(() => {});
}
