import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { type ComponentType, type Ref } from "react";
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewProps } from "react-native-webview";

// react-native-webview's class typings don't resolve against React 19.3's JSX types; the runtime component is fine
type WebView = RNWebView;
const WebView = RNWebView as unknown as ComponentType<WebViewProps & { ref?: Ref<RNWebView> }>;
import { MAP_MAX_MARKERS, MAP_MIN_ZOOM } from "../config";
import { distanceM } from "../geo";
import { Filters } from "../Filters";
import { MAP_HTML } from "../leaflet";
import { openDirections } from "../nav";
import { useApp } from "../state";

type Bounds = { s: number; w: number; n: number; e: number; zoom: number };

export function MapScreen({ active }: { active: boolean }) {
  const { fix, towers, byId, pass, targetId, setTargetId, setTab } = useApp();
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [bounds, setBounds] = useState<Bounds | null>(null);

  const visible = useMemo(() => {
    if (!bounds || bounds.zoom < MAP_MIN_ZOOM) return { list: [], total: 0 };
    // pad so small pans don't leave empty edges before the next update
    const padLat = (bounds.n - bounds.s) * 0.2;
    const padLon = (bounds.e - bounds.w) * 0.2;
    const inView = towers.filter(
      (t) => t.lat >= bounds.s - padLat && t.lat <= bounds.n + padLat && t.lon >= bounds.w - padLon && t.lon <= bounds.e + padLon && pass(t),
    );
    const cLat = (bounds.n + bounds.s) / 2;
    const cLon = (bounds.e + bounds.w) / 2;
    const list =
      inView.length > MAP_MAX_MARKERS
        ? inView
            .map((t) => ({ t, d: (t.lat - cLat) ** 2 + (t.lon - cLon) ** 2 }))
            .sort((a, b) => a.d - b.d)
            .slice(0, MAP_MAX_MARKERS)
            .map((x) => x.t)
        : inView;
    const target = targetId ? byId.get(targetId) : undefined;
    if (target && !list.includes(target)) list.push(target);
    return { list, total: inView.length };
  }, [bounds, towers, pass, targetId, byId]);

  const run = (js: string) => web.current?.injectJavaScript(`${js};true;`);

  useEffect(() => {
    if (ready && active) run(`window.setTowers(${JSON.stringify(visible.list)}, ${JSON.stringify(targetId)})`);
  }, [ready, active, visible, targetId]);

  useEffect(() => {
    if (ready && fix) run(`window.setUser(${JSON.stringify({ lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy })})`);
  }, [ready, fix?.lat, fix?.lon, fix?.accuracy]);

  useEffect(() => {
    if (!ready) return;
    const t = targetId ? byId.get(targetId) : undefined;
    run(`window.setTarget(${t ? JSON.stringify({ lat: t.lat, lon: t.lon, op: t.op, acc_m: t.acc_m }) : "null"})`);
  }, [ready, targetId, byId]);

  // opening the map with a chosen target centres on it
  useEffect(() => {
    const t = active && ready && targetId ? byId.get(targetId) : undefined;
    if (t) run(`window.flyTo(${t.lat}, ${t.lon})`);
  }, [active, ready, targetId]);

  const onMessage = (e: WebViewMessageEvent) => {
    let m: { type: string; id?: string } & Partial<Bounds>;
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m.type === "ready") setReady(true);
    else if (m.type === "bounds") setBounds({ s: m.s!, w: m.w!, n: m.n!, e: m.e!, zoom: m.zoom! });
    else if (m.type === "target" && m.id) {
      setTargetId(m.id);
      setTab("radar");
    } else if (m.type === "nav" && m.id) {
      const t = byId.get(m.id);
      if (t) openDirections(t.lat, t.lon, `${t.op} tower`, fix ? distanceM(fix.lat, fix.lon, t.lat, t.lon) : 5000);
    }
  };

  const zoomedOut = bounds != null && bounds.zoom < MAP_MIN_ZOOM;

  return (
    <View className="flex-1">
      <WebView
        ref={web}
        source={{ html: MAP_HTML, baseUrl: "https://towerfinder.local" }}
        onMessage={onMessage}
        originWhitelist={["*"]}
        javaScriptEnabled
        style={{ flex: 1, backgroundColor: "#09090b" }}
      />
      <View pointerEvents="box-none" className="absolute left-3 right-3 top-3 gap-2">
        <Filters />
        <View className="self-start rounded-full border border-zinc-800 bg-zinc-900/95 px-3 py-1.5">
          <Text className="text-xs text-zinc-300">
            {zoomedOut
              ? "Zoom in to see towers"
              : visible.total > visible.list.length
                ? `Showing ${visible.list.length} of ${visible.total} towers here — zoom in for all`
                : `${visible.total} towers in view`}
          </Text>
        </View>
      </View>
    </View>
  );
}
