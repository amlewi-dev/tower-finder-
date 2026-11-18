import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import type { Fix } from "./types";

export type GpsState = { fix: Fix | null; denied: boolean };

function toFix(p: Location.LocationObject): Fix {
  const { latitude, longitude, accuracy, speed, heading } = p.coords;
  return {
    lat: latitude,
    lon: longitude,
    accuracy: accuracy ?? null,
    speed: speed != null && speed >= 0 ? speed : null,
    course: heading != null && heading >= 0 ? heading : null,
    timestamp: p.timestamp,
  };
}

export function useGps(): GpsState {
  const [fix, setFix] = useState<Fix | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let sub: Location.LocationSubscription | undefined;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setDenied(true);
        return;
      }
      // a recent cached fix gets the radar on screen instantly; the live watch replaces it
      const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 });
      if (last && !cancelled) setFix(toFix(last));
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 },
        (p) => {
          const next = toFix(p);
          // ignore an update that is both older and much worse than what we already have
          setFix((prev) =>
            prev && prev.accuracy != null && next.accuracy != null && next.accuracy > prev.accuracy * 3 && next.timestamp - prev.timestamp < 5000
              ? prev
              : next,
          );
        },
      );
      if (cancelled) sub.remove();
    })().catch(() => setDenied(true));
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  return { fix, denied };
}

export type HeadingState = {
  /** degrees clockwise from true north (magnetic if true north is unavailable) */
  heading: number;
  available: boolean;
  /** compass needs a figure-8 calibration */
  needsCalibration: boolean;
};

export function useHeading(): HeadingState {
  const [state, setState] = useState<HeadingState>({ heading: 0, available: false, needsCalibration: false });
  useEffect(() => {
    let sub: Location.LocationSubscription | undefined;
    let cancelled = false;
    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      const granted = status === "granted" || (await Location.requestForegroundPermissionsAsync()).status === "granted";
      if (!granted) return;
      sub = await Location.watchHeadingAsync((h) => {
        const heading = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
        // Android reports accuracy as 0..3 (3 = high), iOS as degrees of error (negative = invalid)
        const needsCalibration = Platform.OS === "android" ? h.accuracy < 2 : h.accuracy < 0 || h.accuracy > 25;
        setState({ heading, available: true, needsCalibration });
      });
      if (cancelled) sub.remove();
    })().catch(() => {});
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);
  return state;
}
