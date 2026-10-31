import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";

type SavedLogin = { name: string; origin: string; updatedAt: string };

function hostLabel(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/**
 * Sites this bot can sign in to on its own, and the way to take that back.
 *
 * A password the teacher can save on the phone but only delete from a desktop is a password
 * they cannot delete. Values are never readable here or anywhere else — only the host.
 */
export function SavedLoginsSection({ botId }: { botId: string }) {
  const tokens = useMobileTokens();
  const { t } = useI18n();
  const [logins, setLogins] = useState<SavedLogin[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLogins(await rpc<SavedLogin[]>("computer/savedLogins", { botId }));
    } catch {
      setLogins([]);
    }
  }, [botId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function forget(name: string) {
    setPending(name);
    setError(null);
    try {
      await rpc("computer/forgetLogin", { botId, name });
      await refresh();
    } catch {
      setError(t("Could not remove this sign-in."));
    } finally {
      setPending(null);
    }
  }

  if (!logins || logins.length === 0) return null;

  return (
    <View style={{ marginTop: 16, gap: 8 }}>
      <Text style={{ color: tokens.mutedForeground, fontSize: 14 }}>{t("Saved sign-ins")}</Text>
      <Text style={{ color: tokens.mutedForeground, fontSize: 12.5, lineHeight: 18 }}>
        {t(
          "Used only to fill the sign-in form on these sites. Passwords stay encrypted and are never shown to the bot or to you.",
        )}
      </Text>
      {logins.map((login) => (
        <View
          key={login.name}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            borderRadius: 11,
            borderWidth: 1,
            borderColor: tokens.border,
            paddingHorizontal: 12,
            paddingVertical: 10,
          }}
        >
          <Text numberOfLines={1} style={{ flex: 1, color: tokens.foreground, fontSize: 14 }}>
            {hostLabel(login.origin)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Remove")}
            disabled={pending === login.name}
            onPress={() => void forget(login.name)}
            style={{
              borderRadius: 999,
              borderWidth: 1,
              borderColor: tokens.border,
              opacity: pending === login.name ? 0.5 : 1,
              paddingHorizontal: 14,
              paddingVertical: 7,
            }}
          >
            <Text style={{ color: tokens.foreground, fontSize: 13.5, fontWeight: "600" }}>
              {pending === login.name ? t("Removing…") : t("Remove")}
            </Text>
          </Pressable>
        </View>
      ))}
      {error ? <Text style={{ color: tokens.destructive, fontSize: 13 }}>{error}</Text> : null}
    </View>
  );
}
