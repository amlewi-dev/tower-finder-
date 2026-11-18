import "./global.css";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { useAnimatedStyle, withSpring } from "react-native-reanimated";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Add } from "./src/screens/Add";
import { MapScreen } from "./src/screens/MapScreen";
import { Radar } from "./src/screens/Radar";
import { AppProvider, useApp } from "./src/state";

const TABS = [
  { key: "radar", label: "Radar", icon: "navigate" },
  { key: "map", label: "Map", icon: "map" },
  { key: "add", label: "Add", icon: "add-circle" },
] as const;

function Shell() {
  const insets = useSafeAreaInsets();
  const { tab: tabKey, setTab: setTabKey } = useApp();
  const tab = TABS.findIndex((t) => t.key === tabKey);
  const setTab = (i: number) => setTabKey(TABS[i].key);
  const [barW, setBarW] = useState(0);
  const tabW = barW / TABS.length;
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: withSpring(tab * tabW, { damping: 18, stiffness: 180 }) }] }), [tab, tabW]);

  return (
    <View className="flex-1 bg-zinc-950" style={{ paddingTop: insets.top }}>
      <StatusBar style="light" />
      <View style={{ flex: 1, display: tab === 0 ? "flex" : "none" }}><Radar /></View>
      <View style={{ flex: 1, display: tab === 1 ? "flex" : "none" }}><MapScreen active={tab === 1} /></View>
      <View style={{ flex: 1, display: tab === 2 ? "flex" : "none" }}><Add /></View>

      <View
        pointerEvents="box-none"
        style={{ position: "absolute", left: 16, right: 16, bottom: Math.max(insets.bottom, 12) + 4 }}
      >
        <View
          onLayout={(e) => setBarW(e.nativeEvent.layout.width - 8)}
          className="flex-row rounded-full border border-zinc-800 bg-zinc-900/95 p-1"
        >
          {barW > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[{ position: "absolute", left: 4, top: 4, bottom: 4, width: tabW, borderRadius: 999, backgroundColor: "#22c55e" }, pill]}
            />
          ) : null}
          {TABS.map((t, i) => (
            <Pressable
              key={t.key}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setTab(i);
              }}
              className="h-12 flex-1 flex-row items-center justify-center gap-2"
            >
              <Ionicons name={t.icon} size={20} color={tab === i ? "#09090b" : "#a1a1aa"} />
              <Text className={`text-sm font-semibold ${tab === i ? "text-zinc-950" : "text-zinc-400"}`}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Shell />
      </AppProvider>
    </SafeAreaProvider>
  );
}
