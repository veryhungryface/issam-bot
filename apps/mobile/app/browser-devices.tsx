import {
  BROWSER_DEVICE_NAME_MAX,
  browserPairSessionFromScan,
  isBrowserDeviceOnline,
} from "@rakazo/core";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { currentApiBase, rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { native, useThemedStyles } from "../lib/native";

/**
 * Connecting the teacher's own Chrome, from the phone.
 *
 * The extension on the computer draws a QR; this is the other half of it. The camera is here
 * rather than in the phone's own camera app because the teacher is already signed in here, and
 * sending them out to a browser to sign in again is the step that gets abandoned.
 *
 * Scanning does not connect anything. It mints the device and leaves the token where only the
 * computer that drew the QR can collect it; that computer then asks the person sitting at it.
 * Which is the point — a QR on a screen can be photographed by anyone who can see the screen.
 */

type Device = {
  id: string;
  name: string;
  online: boolean;
  lastSeenAt: string | null;
  createdAt: string;
};

type Stage =
  | { kind: "list" }
  | { kind: "scanning" }
  | { kind: "naming"; sessionId: string; label: string }
  | { kind: "sent"; name: string };

function describeLastSeen(lastSeenAt: string | null): string {
  if (!lastSeenAt) return "아직 연결되지 않았습니다";
  const seconds = Math.round((Date.now() - new Date(lastSeenAt).getTime()) / 1000);
  if (!Number.isFinite(seconds) || seconds < 60) return "마지막 응답 방금";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `마지막 응답 ${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `마지막 응답 ${hours}시간 전`;
  return `마지막 응답 ${Math.round(hours / 24)}일 전`;
}

export default function BrowserDevices() {
  const styles = useThemedStyles(createStyles);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "list" });
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  // A camera fires the same code many times a second; the first one wins and the rest are noise.
  const took = useRef(false);

  const load = useCallback(async () => {
    setDevices(await rpc<Device[]>("browserDevices/list"));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load().catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "연결된 크롬을 불러오지 못했습니다."),
      );
      // The extension answers every few seconds, so "켜져 있음" is only ever as fresh as the
      // last answer. Re-ask while this screen is open rather than showing a stale badge.
      const timer = setInterval(() => void load().catch(() => undefined), 15_000);
      return () => clearInterval(timer);
    }, [load]),
  );

  async function startScan() {
    setError(null);
    const granted = permission?.granted ? permission : await requestPermission();
    if (!granted?.granted) {
      setError("카메라를 허용해야 QR을 찍을 수 있습니다. 설정에서 아이쌤봇의 카메라를 켜 주세요.");
      return;
    }
    took.current = false;
    setStage({ kind: "scanning" });
  }

  async function onScan(raw: string) {
    if (took.current) return;
    const sessionId = browserPairSessionFromScan(raw, currentApiBase());
    // Not our QR. Keep the camera running — the teacher is probably still lining it up.
    if (!sessionId) return;
    took.current = true;
    setPending(true);
    try {
      const session = await rpc<{ status: string; label: string | null }>(
        "browserDevices/describePairSession",
        { sessionId },
      );
      if (session.status !== "pending") {
        setError(
          session.status === "expired"
            ? "QR이 만료됐습니다. 컴퓨터에서 새 QR을 띄우고 다시 찍어 주세요."
            : "이 QR은 이미 처리됐습니다. 컴퓨터 화면을 확인해 주세요.",
        );
        setStage({ kind: "list" });
        return;
      }
      setName(session.label ?? "");
      setStage({ kind: "naming", sessionId, label: session.label ?? "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "QR을 확인하지 못했습니다.");
      setStage({ kind: "list" });
    } finally {
      setPending(false);
    }
  }

  async function claim(sessionId: string) {
    const label = name.trim();
    if (!label || pending) return;
    setPending(true);
    setError(null);
    try {
      await rpc("browserDevices/claimPairSession", { sessionId, name: label });
      setStage({ kind: "sent", name: label });
      await load().catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "연결하지 못했습니다.");
      setStage({ kind: "list" });
    } finally {
      setPending(false);
    }
  }

  function revoke(device: Device) {
    Alert.alert(
      "연결 해제",
      `‘${device.name}’ 연결을 해제할까요? 토큰을 지우기 때문에 그 크롬은 더 이상 작업을 받지 못합니다.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "해제",
          style: "destructive",
          onPress: () => {
            setPending(true);
            void rpc("browserDevices/revoke", { deviceId: device.id })
              .then(load)
              .catch((err: unknown) =>
                setError(err instanceof Error ? err.message : "연결을 해제하지 못했습니다."),
              )
              .finally(() => setPending(false));
          },
        },
      ],
    );
  }

  if (stage.kind === "scanning") {
    return (
      <SafeAreaView style={styles.screen} edges={["bottom"]}>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => void onScan(data)}
        />
        <View style={styles.cameraFoot}>
          <Text style={styles.cameraHint}>
            컴퓨터 화면의 연결 QR을 비춰 주세요. 확장 프로그램의 ‘아이쌤봇 연결 → QR 만들기’에
            있습니다.
          </Text>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            onPress={() => setStage({ kind: "list" })}
          >
            <Text style={styles.secondaryLabel}>취소</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {stage.kind === "naming" ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>이 컴퓨터를 연결할까요?</Text>
            <Text style={styles.cardMeta}>
              연결하면 아이쌤봇이 이 컴퓨터의 크롬에 일을 맡길 수 있습니다. 학교 업무 사이트에 이미
              로그인된 창을 그대로 쓰기 때문에, 연결한 본인에게만 보이고 본인만 쓸 수 있습니다.
            </Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="예: 교무실 노트북"
              placeholderTextColor={native.tertiaryLabel}
              maxLength={BROWSER_DEVICE_NAME_MAX}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              accessibilityRole="button"
              disabled={pending || !name.trim()}
              style={({ pressed }) => [
                styles.button,
                (pending || !name.trim()) && styles.disabled,
                pressed && styles.pressed,
              ]}
              onPress={() => void claim(stage.sessionId)}
            >
              <Text style={styles.buttonLabel}>{pending ? "연결 중…" : "연결"}</Text>
            </Pressable>
            <Text style={styles.cardMeta}>
              누른 뒤 컴퓨터 화면에서 한 번 더 확인합니다. 내가 띄운 QR이 아니면 연결하지 마세요.
            </Text>
          </View>
        ) : null}

        {stage.kind === "sent" ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>‘{stage.name}’ 에 보냈습니다</Text>
            <Text style={styles.cardMeta}>
              컴퓨터 화면에서 ‘연결’을 눌러 마무리해 주세요. 거기서 누르기 전까지는 연결되지
              않습니다. 다른 사람의 이름이 보이면 거절하면 됩니다.
            </Text>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          disabled={pending}
          style={({ pressed }) => [
            styles.button,
            pending && styles.disabled,
            pressed && styles.pressed,
          ]}
          onPress={() => void startScan()}
        >
          <Text style={styles.buttonLabel}>QR 찍어서 연결</Text>
        </Pressable>
        <Text style={styles.hint}>
          컴퓨터의 확장 프로그램에서 ‘아이쌤봇 연결 → QR 만들기’를 누르고, 그 QR을 찍으세요.
        </Text>

        {devices === null ? (
          <ActivityIndicator style={styles.loading} />
        ) : devices.length === 0 ? (
          <Text style={styles.hint}>연결된 크롬이 없습니다.</Text>
        ) : (
          devices.map((device) => (
            <View key={device.id} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.cardTitle}>{device.name}</Text>
                <Text style={styles.cardMeta}>
                  {isBrowserDeviceOnline(device.lastSeenAt ? new Date(device.lastSeenAt) : null)
                    ? "켜져 있음"
                    : "꺼져 있음"}{" "}
                  · {describeLastSeen(device.lastSeenAt)}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={pending}
                hitSlop={8}
                onPress={() => revoke(device)}
              >
                <Text style={styles.secondaryLabel}>해제</Text>
              </Pressable>
            </View>
          ))
        )}

        <Text style={styles.hint}>
          봇은 켜져 있는 크롬에만 작업을 보냅니다. 기본값은 승인 후 실행이라, 컴퓨터 앞에 앉아
          실행을 눌러야 시작합니다.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: native.page },
    content: { padding: 20, gap: 10 },
    camera: { flex: 1 },
    cameraFoot: { padding: 20, gap: 12, backgroundColor: native.page },
    cameraHint: { color: native.secondaryLabel, fontSize: 13, lineHeight: 19 },
    error: { color: tokens.destructive },
    loading: { marginTop: 12 },
    card: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: tokens.border,
      padding: 14,
      backgroundColor: tokens.card,
      gap: 8,
    },
    cardTitle: { color: native.label, fontSize: 16 },
    cardMeta: { color: native.tertiaryLabel, fontSize: 12, lineHeight: 18 },
    hint: { color: native.tertiaryLabel, fontSize: 12, lineHeight: 18 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: tokens.border,
      backgroundColor: tokens.card,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    rowText: { flex: 1, gap: 2 },
    input: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: tokens.border,
      color: native.label,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    button: {
      backgroundColor: tokens.primary,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: "center",
    },
    secondaryButton: { paddingVertical: 12, alignItems: "center" },
    secondaryLabel: { color: native.secondaryLabel, fontSize: 15 },
    buttonLabel: { color: tokens.primaryForeground, fontWeight: "600" },
    disabled: { opacity: 0.4 },
    pressed: { opacity: 0.7 },
  });
}
