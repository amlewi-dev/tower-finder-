import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  interpolate,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { COURSE_MIN_SPEED, OP_COLOR } from "../config";
import { ageLabel, formatMonth, nearest, trustLabel, withDistance } from "../data";
import { Filters } from "../Filters";
import { aimTolerance, angleDiff, cardinal, formatDistance } from "../geo";
import { useHeading } from "../hooks";
import { openDirections } from "../nav";
import { useApp } from "../state";
import type { Fix, NearTower } from "../types";
import { Attribution, Badge, Button, Card } from "../ui";

function useSmoothAngle(target: number) {
  const sv = useSharedValue(target);
  const cur = useRef(target);
  useEffect(() => {
    // unwrap so the arrow always takes the short way round (359 -> 0)
    cur.current += angleDiff(target, cur.current);
    sv.value = withTiming(cur.current, { duration: 180 });
  }, [target, sv]);
  return sv;
}

function PulseRing({ delay, color }: { delay: number; color: string }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1, false));
  }, [delay, p]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 1], [0.45, 0]),
    transform: [{ scale: interpolate(p.value, [0, 1], [0.7, 1.5]) }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: "absolute", width: 190, height: 190, borderRadius: 95, borderWidth: 2, borderColor: color }, style]}
    />
  );
}

function Compass({ bearing, heading, color, facing }: { bearing: number; heading: number; color: string; facing: boolean }) {
  const needle = useSmoothAngle(bearing - heading);
  const north = useSmoothAngle(-heading);
  const needleStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${needle.value}deg` }] }));
  const ringStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${north.value}deg` }] }));
  const c = facing ? "#22c55e" : color;
  return (
    <View style={{ width: 240, height: 240, alignItems: "center", justifyContent: "center" }}>
      <PulseRing delay={0} color={c} />
      <PulseRing delay={1200} color={c} />
      <Animated.View
        style={[
          { position: "absolute", width: 230, height: 230, borderRadius: 115, borderWidth: 1, borderColor: "#3f3f46", alignItems: "center" },
          ringStyle,
        ]}
      >
        <Text style={{ color: "#f87171", fontWeight: "700", marginTop: 4 }}>N</Text>
      </Animated.View>
      <Animated.View style={[{ width: 160, height: 160, alignItems: "center", justifyContent: "center" }, needleStyle]}>
        <View
          style={{
            width: 0, height: 0, borderLeftWidth: 24, borderRightWidth: 24, borderBottomWidth: 72,
            borderLeftColor: "transparent", borderRightColor: "transparent", borderBottomColor: c,
          }}
        />
        <View style={{ width: 12, height: 56, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, backgroundColor: c, opacity: 0.45 }} />
      </Animated.View>
    </View>
  );
}

/** Owns the compass subscription so 10+ heading updates/s only re-render this card, not the whole screen. */
function TargetCard({ target, fix, pinned, onUnpin, onShowMap }: {
  target: NearTower; fix: Fix; pinned: boolean; onUnpin: () => void; onShowMap: () => void;
}) {
  const compass = useHeading();
  // magnetometers are unreliable in vehicles; while moving, the GPS course is the better heading
  const moving = fix.speed != null && fix.speed >= COURSE_MIN_SPEED && fix.course != null;
  const heading = moving ? fix.course! : compass.heading;
  const hasHeading = moving || compass.available;

  const towerAcc = target.acc_m ?? 300;
  const gpsAcc = fix.accuracy ?? 0;
  const tolerance = aimTolerance(target.dist, towerAcc, gpsAcc);
  const offBy = angleDiff(target.bearing, heading);
  const facing = hasHeading && Math.abs(offBy) <= tolerance;
  const inside = target.dist <= Math.max(towerAcc, gpsAcc, 25);

  const wasFacing = useRef(false);
  useEffect(() => {
    if (facing && !wasFacing.current) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    wasFacing.current = facing;
  }, [facing]);

  const trust = trustLabel(target);
  const age = ageLabel(target);
  const first = formatMonth(target.first);
  const last = formatMonth(target.last);

  const hint = !hasHeading
    ? "No compass on this device — use the bearing or the map"
    : inside
      ? "You are within the estimated area — look up and around"
      : facing
        ? "You are facing it"
        : `Turn ${offBy > 0 ? "right" : "left"} ${Math.round(Math.abs(offBy))}°`;

  return (
    <Card className="overflow-hidden">
      <LinearGradient colors={["#18181b", "#09090b"]} style={{ alignItems: "center", paddingVertical: 20, paddingHorizontal: 16, gap: 8 }}>
        <View className="w-full flex-row items-center justify-between">
          <Text className="text-sm font-semibold text-zinc-400">{pinned ? "Selected tower" : "Nearest tower"}</Text>
          {pinned ? (
            <Pressable onPress={onUnpin} hitSlop={10} accessibilityRole="button">
              <Text className="text-sm font-semibold text-green-400">Back to nearest</Text>
            </Pressable>
          ) : null}
        </View>
        <Compass bearing={target.bearing} heading={heading} color={OP_COLOR[target.op] ?? "#a1a1aa"} facing={facing} />
        <Text className="text-5xl font-bold text-zinc-50">{formatDistance(target.dist)}</Text>
        <Text className="text-center text-zinc-300">
          {Math.round(target.bearing)}° {cardinal(target.bearing)} · {hint}
        </Text>
        {compass.needsCalibration && !moving ? (
          <Badge tone="amber">Compass inaccurate — move phone in a figure 8</Badge>
        ) : moving ? (
          <Badge tone="blue">Using GPS direction while moving</Badge>
        ) : null}
        <View className="flex-row flex-wrap justify-center gap-2 pt-1">
          <Badge tone={trust.tone}>{trust.text}</Badge>
          {age ? <Badge tone={age.tone}>{age.text}</Badge> : null}
          <Badge>{target.op}</Badge>
          {target.radios.map((r) => (
            <Badge key={r}>{r}</Badge>
          ))}
        </View>
        <Text className="text-center text-xs leading-5 text-zinc-500">
          {target.osm || target.source === "osm"
            ? `Mapped mast position${target.name ? ` · ${target.name}` : ""}, accurate to a few metres.`
            : target.source === "community"
              ? `Photographed on site (GPS ±${towerAcc} m).${target.note ? ` ${target.note}` : ""}`
              : `Estimated position, about ±${formatDistance(towerAcc)} · ${target.cells ?? 0} cells, ${target.samples ?? 0} samples.`}
          {first || last ? `\nFirst seen ${first ?? "?"} · last seen ${last ?? "?"}` : ""}
        </Text>
        <View className="w-full flex-row gap-2 pt-2">
          <View className="flex-1">
            <Button title="Directions" onPress={() => openDirections(target.lat, target.lon, `${target.op} tower`, target.dist)} />
          </View>
          <View className="flex-1">
            <Button title="Show on map" variant="secondary" onPress={onShowMap} />
          </View>
        </View>
      </LinearGradient>
    </Card>
  );
}

export function Radar() {
  const { fix, denied, towers, byId, pass, operator, targetId, setTargetId, setTab, refreshCommunity } = useApp();
  const [refreshing, setRefreshing] = useState(false);

  const list = useMemo(() => nearest(towers, fix, pass, 15), [towers, fix, pass]);
  const pinned = targetId ? byId.get(targetId) : undefined;
  const target: NearTower | null = fix && pinned ? withDistance(pinned, fix) : (list[0] ?? null);

  return (
    <ScrollView
      contentContainerClassName="gap-4 p-4 pb-40"
      refreshControl={
        <RefreshControl
          tintColor="#a1a1aa"
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await refreshCommunity();
            setRefreshing(false);
          }}
        />
      }
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-3xl font-bold text-zinc-50">Tower Finder</Text>
        <Badge tone={fix?.accuracy != null && fix.accuracy <= 20 ? "green" : "amber"}>
          {fix ? `GPS ±${Math.round(fix.accuracy ?? 0)} m` : "No GPS"}
        </Badge>
      </View>

      <Filters />

      {denied ? (
        <Card className="gap-3 p-5">
          <Text className="text-lg font-semibold text-zinc-50">Location permission needed</Text>
          <Text className="text-zinc-400">Tower Finder needs your location to find the nearest towers. Allow it in settings.</Text>
          <Button title="Open settings" onPress={() => Linking.openSettings()} />
        </Card>
      ) : towers.length === 0 ? (
        <Card className="gap-2 p-5">
          <Text className="text-lg font-semibold text-zinc-50">No tower data bundled</Text>
          <Text className="text-zinc-400">Run scripts/build_data.sh in the project root, then restart Metro with: npx expo start -c</Text>
        </Card>
      ) : !fix ? (
        <Card className="items-center gap-3 p-8">
          <ActivityIndicator color="#22c55e" />
          <Text className="text-zinc-400">Getting a GPS fix...</Text>
        </Card>
      ) : !target ? (
        <Card className="p-5">
          <Text className="text-zinc-400">No {operator ?? ""} towers match these filters.</Text>
        </Card>
      ) : (
        <>
          <Animated.View entering={FadeInDown.duration(400)}>
            <TargetCard
              target={target}
              fix={fix}
              pinned={!!pinned}
              onUnpin={() => setTargetId(null)}
              onShowMap={() => {
                setTargetId(target.id);
                setTab("map");
              }}
            />
          </Animated.View>

          <Text className="px-1 pt-2 text-sm font-semibold uppercase tracking-wider text-zinc-500">Nearest towers</Text>
          {list.map((t, i) => {
            const age = ageLabel(t);
            return (
              <Animated.View key={t.id} entering={FadeInDown.delay(40 * Math.min(i, 8)).duration(350)} layout={LinearTransition.springify()}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t.op} tower ${formatDistance(t.dist)} ${cardinal(t.bearing)}`}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setTargetId(t.id === list[0]?.id ? null : t.id);
                  }}
                >
                  <Card className={`flex-row items-center gap-3 p-4 ${t.id === target.id ? "border-green-500" : ""}`}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: OP_COLOR[t.op] ?? "#a1a1aa" }} />
                    <View className="flex-1">
                      <Text className="text-base font-semibold text-zinc-50">
                        {formatDistance(t.dist)} · {cardinal(t.bearing)}
                        {age?.text === "New" ? "  · New" : ""}
                      </Text>
                      <Text className="text-xs text-zinc-400">
                        {t.op}{t.radios.length ? ` · ${t.radios.join(", ")}` : ""} · {trustLabel(t).text} · ±{t.acc_m ?? "?"} m
                      </Text>
                    </View>
                    <Text className="text-zinc-500">{Math.round(t.bearing)}°</Text>
                  </Card>
                </Pressable>
              </Animated.View>
            );
          })}
        </>
      )}
      <Attribution />
    </ScrollView>
  );
}
