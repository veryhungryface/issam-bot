import { AVATAR_BODIES, avatarCharacter, avatarIdentitySeed } from "@rakazo/core";
import { BotAvatar } from "@rakazo/ui-web";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BotFace, BotLooksProvider, GroupFace } from "./bot-face";

/** A body index this bot would never be drawn with by chance. */
function otherBody(botId: string): number {
  const derived = avatarCharacter(avatarIdentitySeed(botId)).body;
  return (derived + 1) % AVATAR_BODIES.length;
}

/** What the avatar draws when it is told the character outright. */
function drawn(character?: { body?: number; face?: number; accessory?: number }) {
  return renderToString(
    <BotAvatar color="#D9508A" identity="maya" size={38} character={character} />,
  );
}

describe("BotFace", () => {
  it("draws a bot in what its owner chose, not in what its id suggests", () => {
    const character = { body: otherBody("maya"), face: 3, accessory: 2 };
    const html = renderToString(
      <BotLooksProvider
        bots={[
          {
            id: "maya",
            avatarBody: character.body,
            avatarFace: character.face,
            avatarAccessory: character.accessory,
          },
        ]}
      >
        <BotFace botId="maya" color="#D9508A" size={38} />
      </BotLooksProvider>,
    );

    expect(html).toBe(drawn(character));
    expect(html).not.toBe(drawn());
  });

  it("leaves a bot nobody has dressed to the character its id derives", () => {
    const html = renderToString(
      <BotLooksProvider
        bots={[{ id: "maya", avatarBody: null, avatarFace: null, avatarAccessory: null }]}
      >
        <BotFace botId="maya" color="#D9508A" size={38} />
      </BotLooksProvider>,
    );

    expect(html).toBe(drawn());
  });

  it("falls back to the derived character for a bot this screen has never seen", () => {
    const html = renderToString(
      <BotLooksProvider bots={[]}>
        <BotFace botId="maya" color="#D9508A" size={38} />
      </BotLooksProvider>,
    );

    expect(html).toBe(drawn());
  });

  it("dresses a lone group member from the same list", () => {
    const body = otherBody("maya");
    const html = renderToString(
      <BotLooksProvider bots={[{ id: "maya", avatarBody: body }]}>
        <GroupFace members={[{ botId: "maya", color: "#D9508A" }]} size={38} />
      </BotLooksProvider>,
    );
    const undressed = renderToString(
      <GroupFace members={[{ botId: "maya", color: "#D9508A" }]} size={38} />,
    );

    expect(html).toContain("rakazo-group-avatar");
    expect(html).not.toBe(undressed);
    // The member's own look, with the group class the badge adds on top.
    expect(html.replace(" rakazo-group-avatar", "")).toBe(drawn({ body }));
  });
});
