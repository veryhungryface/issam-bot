import { useState } from "react";
import { Pressable, Switch, Text, TextInput, View, type ViewProps } from "react-native";
import { rpc } from "../lib/api";
import { type BrowserLoginBlock, browserLoginPresentation } from "../lib/browser-login";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";

/**
 * A sign-in sheet for the bot's own browser, on the phone.
 *
 * The web card's twin — same call, same promise. Without it a run that needs a password
 * simply stops on a phone: the block renders as nothing and the bot waits for an answer the
 * teacher has no way to give.
 *
 * What is typed here goes to the server, which fills it into the page at `origin`. The bot
 * never receives the values, so the shield line is a description of the flow, not comfort.
 */
export function BrowserLoginCard({
  block,
  botId,
  botName,
  runId,
  messageId,
  canAnswer,
  accessibilityActions,
  onAccessibilityAction,
}: {
  block: BrowserLoginBlock;
  botId: string;
  botName: string;
  runId?: string;
  messageId: string;
  canAnswer: boolean;
  accessibilityActions?: ViewProps["accessibilityActions"];
  onAccessibilityAction?: ViewProps["onAccessibilityAction"];
}) {
  const tokens = useMobileTokens();
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, string>>({});
  const [save, setSave] = useState(true);
  const [pending, setPending] = useState<"fill" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { host, resolved, statusLabel, canSubmit } = browserLoginPresentation(block, values);
  const busy = pending !== null;

  async function submit() {
    if (!runId || busy || !canSubmit) return;
    setPending("fill");
    setError(null);
    try {
      const result = await rpc<{ filled: string[]; missing: string[]; saved: boolean }>(
        "computer/fillLogin",
        { botId, runId, messageId, values, save },
        // Well past the 8s default: this call attaches to the remote browser and types into
        // the page. Giving up early would show a failure for a sign-in that worked, and the
        // retry is then refused because the sheet is already resolved.
        { timeoutMs: 60_000 },
      );
      setValues({});
      if (result.missing.length > 0) {
        setError(t("Signed in, but some fields were not found on the page."));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Could not sign in."));
    } finally {
      setPending(null);
    }
  }

  async function cancel() {
    if (!runId || busy) return;
    setPending("cancel");
    try {
      await rpc("computer/cancelLogin", { botId, runId, messageId });
    } catch {
      setError(t("Could not close this sign-in."));
    } finally {
      setPending(null);
    }
  }

  return (
    <View
      accessibilityLabel={t("Sign in to {host}", { host })}
      style={{
        width: "90%",
        borderRadius: 18,
        borderWidth: 1,
        borderColor: tokens.border,
        backgroundColor: tokens.card,
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text
          accessibilityActions={accessibilityActions}
          onAccessibilityAction={onAccessibilityAction}
          style={{ flex: 1, color: tokens.foreground, fontSize: 15.5, fontWeight: "600" }}
        >
          {block.title}
        </Text>
        <Text
          style={{
            color: resolved ? tokens.success : tokens.warning,
            fontSize: 13,
            fontWeight: "600",
          }}
        >
          {statusLabel}
        </Text>
      </View>

      {resolved ? (
        block.saved ? (
          <Text style={{ color: tokens.mutedForeground, fontSize: 13.5 }}>
            {t("Saved for next time on {host}.", { host })}
          </Text>
        ) : null
      ) : canAnswer ? (
        <>
          {block.fields.map((field) => (
            <View key={field.id} style={{ gap: 4 }}>
              <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>{field.label}</Text>
              <TextInput
                accessibilityLabel={field.label}
                value={values[field.id] ?? ""}
                onChangeText={(text) => setValues((current) => ({ ...current, [field.id]: text }))}
                secureTextEntry={field.masked}
                autoComplete={field.masked ? "current-password" : "username"}
                autoCorrect={false}
                autoCapitalize="none"
                editable={!busy}
                onSubmitEditing={() => void submit()}
                style={{
                  minHeight: 42,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: tokens.border,
                  color: tokens.foreground,
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                }}
              />
            </View>
          ))}

          <Text style={{ color: tokens.mutedForeground, fontSize: 12.5, lineHeight: 18 }}>
            {t(
              "Fills only the page open in the browser at {host}. Masked fields are never shown to {botName}.",
              { host, botName },
            )}
          </Text>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Switch value={save} onValueChange={setSave} disabled={busy} />
            <Text style={{ flex: 1, color: tokens.mutedForeground, fontSize: 13.5 }}>
              {t("Save so {botName} can sign in next time", { botName })}
            </Text>
          </View>

          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Skip")}
              disabled={busy}
              onPress={() => void cancel()}
              style={{
                borderRadius: 999,
                borderWidth: 1,
                borderColor: tokens.border,
                opacity: busy ? 0.5 : 1,
                paddingHorizontal: 16,
                paddingVertical: 9,
              }}
            >
              <Text style={{ color: tokens.foreground, fontWeight: "600" }}>{t("Skip")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Sign in")}
              disabled={!canSubmit || busy}
              onPress={() => void submit()}
              style={{
                borderRadius: 999,
                backgroundColor: tokens.foreground,
                opacity: !canSubmit || busy ? 0.5 : 1,
                paddingHorizontal: 16,
                paddingVertical: 9,
              }}
            >
              <Text style={{ color: tokens.primaryForeground, fontWeight: "600" }}>
                {pending === "fill" ? t("Signing in…") : t("Sign in")}
              </Text>
            </Pressable>
          </View>
        </>
      ) : (
        <Text style={{ color: tokens.mutedForeground, fontSize: 13.5 }}>
          {t("Waiting for this bot’s response.")}
        </Text>
      )}

      {error ? <Text style={{ color: tokens.destructive, fontSize: 13 }}>{error}</Text> : null}
    </View>
  );
}
