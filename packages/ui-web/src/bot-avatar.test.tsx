import { readFileSync } from "node:fs";
import { AVATAR_BODIES, AVATAR_FACES } from "@rakazo/core";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BotAvatar } from "./bot-avatar.js";

const styles = () => readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("BotAvatar", () => {
  it.each(["running", "queued", "leased", "waiting_input", "waiting_takeover"])(
    "shows the working ring for %s",
    (status) => {
      const html = renderToString(<BotAvatar color="#3B82F6" status={status} />);
      expect(html).toContain('data-working="true"');
      expect(html).toContain("rakazo-avatar-ring");
    },
  );

  it("keeps the ring mounted when idle so its timeline does not restart with every run", () => {
    const html = renderToString(<BotAvatar color="#F59E0B" status="idle" />);
    expect(html).toContain('data-working="false"');
    expect(html).toContain("rakazo-avatar-ring");
    // Mounted, and hidden by the stylesheet rather than by unmounting.
    expect(styles()).toMatch(/\.rakazo-avatar \.rakazo-avatar-ring \{[^}]*opacity: 0;/s);
  });

  it("draws a whole character: a body, a face that can blink, and a mouth", () => {
    const html = renderToString(<BotAvatar color="#D9508A" identity="maya" size={28} />);
    expect(html).toContain("rakazo-avatar-eyes");
    expect(html).toContain("rakazo-avatar-pupils");
    expect(html).toContain("rakazo-avatar-mouth");
    expect(html).toMatch(/data-body="[a-z]+"/);
    expect(html).toMatch(/data-face="[a-z]+"/);
    // The body is one of the shared shapes, not something drawn here.
    expect(AVATAR_BODIES.some((body) => html.includes(body.d))).toBe(true);
  });

  it("gives different bots different characters", () => {
    const names = ["maya", "github", "scout", "chief", "atlas", "nova"];
    const bodies = new Set<string>();
    const faces = new Set<string>();
    for (const identity of names) {
      const html = renderToString(<BotAvatar color="#D9508A" identity={identity} />);
      bodies.add(html.match(/data-body="([a-z]+)"/)?.[1] ?? "");
      faces.add(html.match(/data-face="([a-z]+)"/)?.[1] ?? "");
    }
    expect(bodies.size).toBeGreaterThan(1);
    expect(faces.size).toBeGreaterThan(1);
  });

  it("keeps the same bot's character across renders and statuses", () => {
    const idle = renderToString(<BotAvatar color="#D9508A" identity="maya" status="idle" />);
    const working = renderToString(<BotAvatar color="#D9508A" identity="maya" status="running" />);
    expect(working.match(/data-body="([a-z]+)"/)?.[1]).toBe(
      idle.match(/data-body="([a-z]+)"/)?.[1],
    );
    expect(working.match(/data-face="([a-z]+)"/)?.[1]).toBe(
      idle.match(/data-face="([a-z]+)"/)?.[1],
    );
  });

  it("gives each bot its own rhythm, and keeps it when a run starts", () => {
    // A row of faces blinking in unison reads as machinery, which is the one thing a face
    // must not do; and a run starting must not reset the blink everyone is mid-way through.
    const blink = (html: string) => html.match(/--rakazo-avatar-blink:\s*([0-9.]+s)/)?.[1];
    const maya = renderToString(<BotAvatar color="#D9508A" identity="maya" />);
    const github = renderToString(<BotAvatar color="#D9508A" identity="github" />);
    const mayaWorking = renderToString(
      <BotAvatar color="#D9508A" identity="maya" status="running" />,
    );

    expect(blink(maya)).toBeTruthy();
    expect(blink(maya)).not.toBe(blink(github));
    expect(blink(mayaWorking)).toBe(blink(maya));
  });

  it("talks only while it is working", () => {
    expect(styles()).toMatch(
      /\.rakazo-avatar\[data-working="true"\] \.rakazo-avatar-mouth \{[^}]*animation: rakazo-avatar-talk/s,
    );
    // The mouth is in the markup either way; the stylesheet decides whether it moves.
    expect(renderToString(<BotAvatar color="#D9508A" identity="maya" />)).toContain(
      "rakazo-avatar-mouth",
    );
  });

  it("stops every bit of motion when the viewer asks for less", () => {
    const reduced = styles().slice(styles().indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const part of ["rakazo-avatar-eyes", "rakazo-avatar-pupils", "rakazo-avatar-ring"]) {
      expect(reduced).toContain(part);
    }
  });

  it("falls back to the colour when a bot has no identity to be drawn from", () => {
    const html = renderToString(<BotAvatar color="#10B981" />);
    expect(html).toMatch(/data-face="([a-z]+)"/);
    expect(AVATAR_FACES.some((face) => html.includes(face.name))).toBe(true);
  });
});
