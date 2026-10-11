import { describe, expect, it } from "vitest";
import { buildApprovalAskBlock } from "./approval-ask.js";

describe("buildApprovalAskBlock", () => {
  it("binds the approval to its effect and redacts secrets", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "gmail_send_email",
      { to: "person@example.test", body: "token-secret" },
      ["token-secret"],
    );

    expect(block).toMatchObject({
      kind: "ask",
      approvalEffectId: "effect-1",
      actions: [
        { id: "allow", label: "Allow once" },
        { id: "always", label: "Always allow this tool" },
        { id: "deny", label: "Deny" },
      ],
    });
    expect(JSON.stringify(block)).not.toContain("token-secret");
  });

  it("bounds model-controlled summaries and details", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "destination.write",
      { title: "t".repeat(1_000), body: "b".repeat(10_000) },
      [],
    );

    expect(block.kind).toBe("ask");
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.text.length).toBeLessThanOrEqual(501);
    expect(block.detail?.length).toBeLessThanOrEqual(4_001);
    // A title long enough to run past the limit must not take the verb with it.
    expect(block.text.endsWith("저장하기 전에 확인해 주세요")).toBe(true);
  });

  it("asks in Korean, naming the action rather than the tool when it knows it", () => {
    const write = buildApprovalAskBlock(
      "effect-1",
      "destination.write",
      { collection: "성적", title: "2학기 중간" },
      [],
    );
    const send = buildApprovalAskBlock("effect-2", "gmail_send_email", { to: "a@b.test" }, []);
    const remove = buildApprovalAskBlock("effect-3", "delete_bot", { confirm_name: "이삼봇" }, []);

    if (write.kind !== "ask" || send.kind !== "ask" || remove.kind !== "ask") {
      throw new Error("expected ask blocks");
    }
    expect(write.text).toBe("성적에 “2학기 중간” 저장하기 전에 확인해 주세요");
    expect(send.text).toBe("gmail_send_email → a@b.test 실행 전에 확인해 주세요");
    expect(remove.text).toBe("이삼봇 삭제하기 전에 확인해 주세요");
  });

  it("includes an optional review reason as the first detail line", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "gmail_send_email",
      { to: "person@example.test", subject: "Hi" },
      [],
      { reviewReason: "Sends email outside the draft-only task." },
    );

    expect(block.kind).toBe("ask");
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.detail?.startsWith("Sends email outside the draft-only task.")).toBe(true);
    expect(block.detail).toContain("받는 사람: person@example.test");
  });

  it("uses a one-time create or cancel choice for a new security boundary", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "create_space",
      { name: "Customer support" },
      [],
    );

    expect(block).toMatchObject({
      kind: "ask",
      text: "“Customer support” 스페이스를 만들까요?",
      actions: [
        { id: "allow", label: "Create space", outcome: "created" },
        { id: "deny", label: "Cancel", outcome: "cancelled" },
      ],
    });
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.detail).toContain("다른 스페이스와 분리됩니다");
  });
});
