import { type AvatarChoice, type AvatarColumns, avatarChoiceOf } from "@rakazo/core";
import {
  BotAvatar,
  type BotAvatarProps,
  GroupAvatar,
  type GroupAvatarMember,
  type GroupAvatarProps,
} from "@rakazo/ui-web";
import { createContext, type ReactNode, useContext, useMemo } from "react";

/**
 * Who is wearing what, by bot id.
 *
 * A bot is drawn in a dozen places — the list, the header, a mention chip, a group badge,
 * the boot screen — and most of them only ever had the id and the colour to hand. So each
 * one quietly drew the character derived from the id, and dressing a bot appeared to work
 * only in the panel where you had just chosen it. The looks live here once, and `BotFace`
 * is the only way the app draws a stored bot, so no call site is left that can forget.
 */
const BotLooksContext = createContext<ReadonlyMap<string, AvatarChoice>>(new Map());

export interface DressedBot extends AvatarColumns {
  id: string;
}

export function BotLooksProvider({
  bots,
  children,
}: {
  bots: readonly DressedBot[];
  children: ReactNode;
}) {
  // Rebuilt when a look actually changes rather than on every render of the shell, which
  // re-renders on every streamed token.
  const signature = bots
    .map((bot) => `${bot.id}:${bot.avatarBody}/${bot.avatarFace}/${bot.avatarAccessory}`)
    .join("|");
  const looks = useMemo(() => {
    const map = new Map<string, AvatarChoice>();
    for (const bot of bots) map.set(bot.id, avatarChoiceOf(bot));
    return map;
  }, [signature]);

  return <BotLooksContext.Provider value={looks}>{children}</BotLooksContext.Provider>;
}

/** What a bot is wearing, or nothing if this screen has never heard of it. */
export function useBotLook(botId: string | undefined): AvatarChoice | undefined {
  const looks = useContext(BotLooksContext);
  return botId ? looks.get(botId) : undefined;
}

/**
 * A bot's face, dressed as its owner chose.
 *
 * Takes the id rather than the character so no screen has to carry the look around. Use
 * this wherever a stored bot is drawn; `BotAvatar` direct is for a character that is not a
 * stored bot's yet — a swatch in the picker, a bot still being made.
 */
export function BotFace({
  botId,
  ...rest
}: Omit<BotAvatarProps, "identity" | "character"> & { botId: string | undefined }) {
  const character = useBotLook(botId);
  return <BotAvatar {...rest} identity={botId} character={character} />;
}

/** A group's badge, with each member dressed as its owner chose. */
export function GroupFace({ members, ...rest }: GroupAvatarProps) {
  const looks = useContext(BotLooksContext);
  const dressed: GroupAvatarMember[] = members.map((member) =>
    member.botId ? { ...member, character: looks.get(member.botId) } : member,
  );
  return <GroupAvatar {...rest} members={dressed} />;
}
