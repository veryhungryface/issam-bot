import { describe, expect, it } from "vitest";
import {
  type BrowserLoginBlock,
  browserLoginHost,
  browserLoginPresentation,
} from "./browser-login.js";

describe("browserLoginPresentation", () => {
  const block: BrowserLoginBlock = {
    kind: "browser_login",
    title: "코레일 로그인",
    origin: "https://www.letskorail.com",
    fields: [
      { id: "username", label: "아이디", masked: false },
      { id: "password", label: "비밀번호", masked: true },
    ],
    status: "pending",
  };

  it("asks for action and shows the host while the sheet is open", () => {
    const view = browserLoginPresentation(block);
    expect(view.statusLabel).toBe("Action needed");
    expect(view.resolved).toBe(false);
    expect(view.host).toBe("www.letskorail.com");
  });

  it("refuses to submit until every field is filled", () => {
    expect(browserLoginPresentation(block, { username: "teacher" }).canSubmit).toBe(false);
    expect(browserLoginPresentation(block, { username: "teacher", password: "" }).canSubmit).toBe(
      false,
    );
    expect(browserLoginPresentation(block, { username: "teacher", password: "pw" }).canSubmit).toBe(
      true,
    );
  });

  it("reports how a resolved sheet ended", () => {
    expect(browserLoginPresentation({ ...block, status: "filled" }).statusLabel).toBe("Signed in");
    expect(browserLoginPresentation({ ...block, status: "cancelled" }).statusLabel).toBe("Skipped");
    expect(browserLoginPresentation({ ...block, status: "filled" }).resolved).toBe(true);
  });

  it("falls back to the raw origin when it cannot be parsed", () => {
    expect(browserLoginHost("not a url")).toBe("not a url");
  });
});
