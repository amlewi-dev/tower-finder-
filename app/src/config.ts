export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080").replace(/\/$/, "");
export const MAX_ACCURACY_M = 50; // must match the server
export const OPERATORS = ["Safaricom", "Airtel", "Telkom"] as const;
export const SUBMIT_OPERATORS = ["Safaricom", "Airtel", "Telkom", "Other"] as const;
export const OP_COLOR: Record<string, string> = {
  Safaricom: "#22c55e",
  Airtel: "#ef4444",
  Telkom: "#3b82f6",
  Other: "#a1a1aa",
  Unknown: "#a1a1aa",
};

const DAY_S = 86_400;
/** first observed within this window -> "New" */
export const NEW_WITHIN_S = 540 * DAY_S;
/** observed within this window -> "Active" */
export const ACTIVE_WITHIN_S = 120 * DAY_S;
/** not observed for longer than this -> "Old" (possibly upgraded, renamed or removed) */
export const OLD_AFTER_S = 365 * DAY_S;

export const AGES = [
  { key: "all", label: "All ages" },
  { key: "new", label: "New" },
  { key: "active", label: "Active" },
  { key: "old", label: "Old" },
] as const;

/** Map shows at most this many markers for the visible area. */
export const MAP_MAX_MARKERS = 2500;
/** Below this zoom the map is too wide to list every tower. */
export const MAP_MIN_ZOOM = 9;
/** Switch to GPS course instead of the magnetometer above this speed (m/s, ~9 km/h). */
export const COURSE_MIN_SPEED = 2.5;
