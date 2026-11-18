import * as Haptics from "expo-haptics";
import { ActivityIndicator, Linking, Pressable, Text, View, ViewProps } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

type WithClass = { className?: string };

export function Card({ className = "", ...rest }: ViewProps & WithClass) {
  return <View className={`rounded-2xl border border-zinc-800 bg-zinc-900 ${className}`} {...rest} />;
}

const BADGE_BOX = {
  zinc: "border-zinc-700 bg-zinc-800",
  green: "border-green-500/40 bg-green-500/10",
  amber: "border-amber-500/40 bg-amber-500/10",
  red: "border-red-500/40 bg-red-500/10",
  blue: "border-blue-500/40 bg-blue-500/10",
} as const;
const BADGE_TEXT = {
  zinc: "text-zinc-300",
  green: "text-green-400",
  amber: "text-amber-400",
  red: "text-red-400",
  blue: "text-blue-400",
} as const;

export function Badge({ children, tone = "zinc" }: { children: string; tone?: keyof typeof BADGE_BOX }) {
  return (
    <View className={`self-start rounded-full border px-2.5 py-1 ${BADGE_BOX[tone]}`}>
      <Text className={`text-xs font-medium ${BADGE_TEXT[tone]}`}>{children}</Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  loading?: boolean;
}) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const box =
    variant === "primary"
      ? "bg-green-500"
      : variant === "secondary"
        ? "border border-zinc-700 bg-zinc-800"
        : "bg-transparent";
  const text = variant === "primary" ? "text-zinc-950" : "text-zinc-50";
  return (
    <Animated.View style={[style, { opacity: disabled ? 0.45 : 1 }]}>
      <Pressable
        disabled={disabled || loading}
        onPressIn={() => (scale.value = withSpring(0.96, { damping: 15 }))}
        onPressOut={() => (scale.value = withSpring(1, { damping: 12 }))}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          onPress();
        }}
        className={`h-12 flex-row items-center justify-center gap-2 rounded-xl px-5 ${box}`}
      >
        {loading ? <ActivityIndicator color={variant === "primary" ? "#09090b" : "#fafafa"} /> : null}
        <Text className={`text-base font-semibold ${text}`}>{title}</Text>
      </Pressable>
    </Animated.View>
  );
}

export function Chip({ label, active, onPress, color }: { label: string; active: boolean; onPress: () => void; color?: string }) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      className={`flex-row items-center gap-2 rounded-full border px-4 py-2 ${
        active ? "border-zinc-50 bg-zinc-50" : "border-zinc-700 bg-zinc-900"
      }`}
    >
      {color ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} /> : null}
      <Text className={`text-sm font-medium ${active ? "text-zinc-950" : "text-zinc-300"}`}>{label}</Text>
    </Pressable>
  );
}

export function Attribution() {
  const open = (u: string) => Linking.openURL(u).catch(() => {});
  return (
    <View className="gap-1 px-2 pt-2">
      <Text className="text-center text-xs leading-5 text-zinc-500">
        Cell tower data from{" "}
        <Text className="text-zinc-300 underline" onPress={() => open("https://opencellid.org")}>OpenCelliD</Text>
        {" · "}
        <Text className="text-zinc-300 underline" onPress={() => open("https://creativecommons.org/licenses/by-sa/4.0/")}>CC BY-SA 4.0</Text>
        . Changes: cells merged per site and clustered into estimated tower locations.
      </Text>
      <Text className="text-center text-xs leading-5 text-zinc-500">
        Mapped masts from{" "}
        <Text className="text-zinc-300 underline" onPress={() => open("https://www.openstreetmap.org/copyright")}>© OpenStreetMap contributors</Text>{" "}
        (ODbL). Estimated positions are shown with their uncertainty; only mapped masts and community photos are exact.
      </Text>
    </View>
  );
}
