import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Alert, Image, ScrollView, Text, TextInput, View } from "react-native";
import Animated, { FadeInDown, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { API_URL, MAX_ACCURACY_M, OP_COLOR, SUBMIT_OPERATORS } from "../config";
import { getDeviceId } from "../data";
import { useApp } from "../state";
import { Badge, Button, Card, Chip } from "../ui";

export function Add() {
  const { fix, refreshCommunity } = useApp();
  const [operator, setOperator] = useState<string>("Safaricom");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const acc = fix?.accuracy ?? null;
  const gpsOk = acc != null && acc <= MAX_ACCURACY_M;
  const canSend = gpsOk && !!photo && !busy;

  const barStyle = useAnimatedStyle(() => {
    const pct = acc == null ? 0.05 : Math.max(0.05, Math.min(1, 1 - acc / 100));
    return { width: withTiming(`${pct * 100}%`, { duration: 300 }), backgroundColor: gpsOk ? "#22c55e" : "#f59e0b" };
  }, [acc, gpsOk]);

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera permission needed", "Allow camera access to photograph the tower.");
      return;
    }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.6 });
    if (!r.canceled && r.assets[0]) setPhoto(r.assets[0]);
  };

  const submit = async () => {
    if (!fix || !photo || acc == null) return;
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("lat", String(fix.lat));
      fd.append("lon", String(fix.lon));
      fd.append("accuracy", String(acc));
      fd.append("operator", operator);
      fd.append("note", note);
      fd.append("device_id", await getDeviceId());
      fd.append("photo", { uri: photo.uri, name: "tower.jpg", type: photo.mimeType ?? "image/jpeg" } as unknown as Blob);
      const res = await fetch(`${API_URL}/api/submissions`, { method: "POST", body: fd });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setResult("Submitted. It is pending review and appears on the map once approved.");
      setPhoto(null);
      setNote("");
      refreshCommunity();
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      const msg = e instanceof Error ? e.message : "Unknown error";
      setResult(`Could not submit: ${msg}${msg.includes("Network") ? `\n(API: ${API_URL})` : ""}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerClassName="gap-4 p-4 pb-40" keyboardShouldPersistTaps="handled">
      <Text className="text-3xl font-bold text-zinc-50">Add a tower</Text>
      <Text className="text-zinc-400">
        Stand right next to the tower, photograph it, and submit. Every submission is reviewed before it shows up for anyone.
      </Text>

      <Animated.View entering={FadeInDown.duration(350)}>
        <Card className="gap-3 p-4">
          <View className="flex-row items-center justify-between">
            <Text className="font-semibold text-zinc-50">1. GPS fix</Text>
            <Badge tone={gpsOk ? "green" : "amber"}>{acc == null ? "Searching..." : `±${Math.round(acc)} m`}</Badge>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: "#27272a", overflow: "hidden" }}>
            <Animated.View style={[{ height: 8, borderRadius: 4 }, barStyle]} />
          </View>
          <Text className="text-xs text-zinc-500">
            {gpsOk ? "Good enough to submit." : `Needs ${MAX_ACCURACY_M} m or better. Move to open sky and wait a few seconds.`}
          </Text>
          {fix ? <Text className="text-xs text-zinc-500">{fix.lat.toFixed(5)}, {fix.lon.toFixed(5)}</Text> : null}
        </Card>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(80).duration(350)}>
        <Card className="gap-3 p-4">
          <Text className="font-semibold text-zinc-50">2. Photo of the tower</Text>
          {photo ? <Image source={{ uri: photo.uri }} style={{ height: 220, width: "100%", borderRadius: 12 }} resizeMode="cover" /> : null}
          <Button title={photo ? "Retake photo" : "Open camera"} variant="secondary" onPress={takePhoto} />
        </Card>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(160).duration(350)}>
        <Card className="gap-3 p-4">
          <Text className="font-semibold text-zinc-50">3. Operator</Text>
          <View className="flex-row flex-wrap gap-2">
            {SUBMIT_OPERATORS.map((o) => (
              <Chip key={o} label={o} color={OP_COLOR[o]} active={operator === o} onPress={() => setOperator(o)} />
            ))}
          </View>
          <Text className="pt-1 font-semibold text-zinc-50">Note (optional)</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            maxLength={300}
            multiline
            placeholder="Rooftop mast, shared with Airtel, behind the school..."
            placeholderTextColor="#52525b"
            className="min-h-20 rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-zinc-50"
            textAlignVertical="top"
          />
        </Card>
      </Animated.View>

      <Button title="Submit for review" onPress={submit} disabled={!canSend} loading={busy} />
      {!photo || !gpsOk ? (
        <Text className="text-center text-xs text-zinc-500">
          {!gpsOk ? "Waiting for a better GPS fix. " : ""}{!photo ? "A photo is required." : ""}
        </Text>
      ) : null}
      {result ? (
        <Animated.View entering={FadeInDown.duration(300)}>
          <Card className="p-4"><Text className="text-zinc-200">{result}</Text></Card>
        </Animated.View>
      ) : null}
    </ScrollView>
  );
}
