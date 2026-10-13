import type { CreditStatus } from "@rakazo/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CreditDetail, CreditPill, formatKrw } from "./CreditMeter";

function status(overrides: Partial<CreditStatus> = {}): CreditStatus {
  return {
    state: "ok",
    limitKrw: 2_000,
    spentKrw: 720,
    remainingKrw: 1_280,
    remainingPercent: 64,
    windowStart: "2026-10-11T15:00:00.000Z",
    windowEnd: "2026-10-18T15:00:00.000Z",
    limitSource: "deployment",
    spent: {
      runs: 23,
      inputTokens: 2_325_402,
      outputTokens: 20_641,
      browserSeconds: 1_117,
      browserSessions: 5,
      modelKrw: 710,
      browserKrw: 10,
    },
    ...overrides,
  };
}

describe("the pill beside the name", () => {
  it("says how much is left, not how much is gone", () => {
    const html = renderToStaticMarkup(<CreditPill status={status()} />);
    // The visible label is the whole point of the pill, so the claim is about the text
    // between the tags, not about the markup — the amounts live in the tooltip, which the
    // next test is about.
    const visible = html.replace(/<[^>]*>/g, "");
    expect(visible).toBe("64% 남음");
  });

  it("keeps the money out of it entirely", () => {
    const html = renderToStaticMarkup(<CreditPill status={status()} />);
    // Not in the label and not in the tooltip either. A teacher reading a running total of
    // what they have cost the school is a reason not to ask the next question; the share
    // that is left is the only part they can act on.
    expect(html).not.toContain("원");
    expect(html).not.toContain("720");
    expect(html).not.toContain("2,000");
    // What the tooltip says instead: when it comes back.
    expect(html).toContain("10월 19일(월)에 초기화");
  });

  it("is a readout, not a door", () => {
    const html = renderToStaticMarkup(<CreditPill status={status()} />);
    // It used to be a button, and the third one onto a single panel. Pressing a number
    // that looks pressable and landing in Settings is worse than a number that plainly
    // is not pressable.
    expect(html).not.toContain("<button");
    expect(html).toContain("<span");
  });

  it("stays quiet while the balance is healthy", () => {
    const html = renderToStaticMarkup(<CreditPill status={status()} />);
    expect(html).toContain("bg-muted");
    expect(html).not.toContain("destructive");
    expect(html).not.toContain("amber");
  });

  it("warns when the balance is nearly gone", () => {
    const html = renderToStaticMarkup(
      <CreditPill
        status={status({ state: "low", remainingPercent: 12, remainingKrw: 240, spentKrw: 1_760 })}
      />,
    );
    expect(html).toContain("12% 남음");
    expect(html).toContain("amber");
  });

  it("says plainly when there is nothing left, instead of showing zero percent", () => {
    const html = renderToStaticMarkup(
      <CreditPill
        status={status({
          state: "exhausted",
          remainingPercent: 0,
          remainingKrw: 0,
          spentKrw: 2_400,
        })}
      />,
    );
    expect(html).toContain("한도 초과");
    expect(html).not.toContain("0% 남음");
    expect(html).toContain("destructive");
  });

  it("renders nothing at all for an account with no limit", () => {
    const html = renderToStaticMarkup(
      <CreditPill
        status={status({
          state: "unlimited",
          limitKrw: null,
          remainingKrw: null,
          remainingPercent: null,
          limitSource: "owner",
          spentKrw: 3_851,
        })}
      />,
    );
    // There is no share left of no limit. This used to show the owner their week in won,
    // which was the one place money appeared without being asked for.
    expect(html).toBe("");
  });

  it("can be rendered a second time for the phone, under its own name", () => {
    // A phone keeps the sidebar in a drawer, so the header carries its own copy. Both
    // exist in the document at once, which only works if a test can tell them apart.
    const html = renderToStaticMarkup(
      <CreditPill
        status={status()}
        testId="credit-pill-compact"
        className="pointer-events-auto md:hidden"
      />,
    );
    expect(html).toContain('data-testid="credit-pill-compact"');
    expect(html).not.toContain('data-testid="credit-pill"');
    // The header bar itself takes no pointer events, so the copy in it has to say it does.
    expect(html).toContain("pointer-events-auto");
    expect(html).toContain("md:hidden");
    // Same label as the one in the sidebar: two places, one number.
    expect(html.replace(/<[^>]*>/g, "")).toBe("64% 남음");
  });

  it("names its state for anything reading the page", () => {
    const html = renderToStaticMarkup(<CreditPill status={status()} />);
    expect(html).toContain('data-testid="credit-pill"');
    expect(html).toContain('data-state="ok"');
    // No aria-label: the visible text is the label, which is what a reader should hear.
    expect(html).not.toContain("aria-label");
  });
});

describe("the detail behind it", () => {
  it("answers what the week went to, in work rather than in money", () => {
    const html = renderToStaticMarkup(<CreditDetail status={status()} />);
    expect(html).toContain("봇 실행 23회");
    expect(html).toContain("브라우저");
    expect(html).toContain("5세션");
    expect(html).toContain("64% 남음");
    // The won figures the rows used to carry, and the rate card under them, are the
    // owner's business and live in the owner's limit screen.
    expect(html).not.toContain("원");
    expect(html).not.toContain("710");
    expect(html).not.toContain("1,450");
  });

  it("names the day the allowance comes back", () => {
    const html = renderToStaticMarkup(<CreditDetail status={status()} />);
    // The window ends Sunday 15:00Z, which is Monday the 19th in Seoul.
    expect(html).toContain("10월 19일(월)");
  });

  it("draws the bar to the fraction that is left", () => {
    const html = renderToStaticMarkup(<CreditDetail status={status()} />);
    expect(html).toContain("width:64%");
    expect(html).toContain('aria-valuenow="64"');
  });

  it("drops the bar entirely when there is no limit to measure against", () => {
    const html = renderToStaticMarkup(
      <CreditDetail
        status={status({
          state: "unlimited",
          limitKrw: null,
          remainingKrw: null,
          remainingPercent: null,
          limitSource: "owner",
        })}
      />,
    );
    expect(html).not.toContain("progressbar");
    expect(html).toContain("한도 없음");
  });
});

describe("formatKrw", () => {
  it("rounds to the won and groups the thousands", () => {
    expect(formatKrw(1_280.4)).toBe("1,280원");
    expect(formatKrw(0.2)).toBe("0원");
    expect(formatKrw(3_850.6)).toBe("3,851원");
  });
});
