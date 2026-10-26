/**
 * The 아이쌤봇 연결 screen.
 *
 * Two jobs, one page: connect this Chrome to a deployment, and show the teacher a task that
 * arrived so they can look at it before it runs. The second is why this page opens itself —
 * a request waiting behind a badge nobody notices is a request that quietly times out.
 *
 * It holds no state of its own. Everything lives in the service worker, because the worker is
 * what keeps running after this window is closed.
 */

const $ = (id) => document.getElementById(id);
const APPROVAL_TIMEOUT_MS = 10 * 60_000;

function say(text) {
  $("status").textContent = text;
}

async function send(type, extra = {}) {
  const reply = await chrome.runtime.sendMessage({ type, ...extra });
  if (!reply?.ok) throw new Error(reply?.error || "확장 프로그램이 응답하지 않습니다.");
  return reply;
}

async function act(fn) {
  try {
    await fn();
  } catch (error) {
    say(error?.message || "처리하지 못했습니다.");
  }
}

let shownJobId = null;

async function fillTabs() {
  const { tabs } = await send("issamBridgeTabs");
  const select = $("request-tab");
  select.replaceChildren();
  for (const tab of tabs) {
    const option = document.createElement("option");
    option.value = String(tab.id);
    let origin = tab.url;
    try {
      origin = new URL(tab.url).host;
    } catch {
      // Keep the raw URL; a tab we cannot parse is still a tab the teacher may recognise.
    }
    option.textContent = `${tab.title || "웹 탭"} — ${origin}`;
    option.selected = tab.active;
    select.append(option);
  }
  if (!tabs.length) {
    const option = document.createElement("option");
    option.textContent = "열려 있는 웹 페이지가 없습니다";
    option.value = "";
    select.append(option);
  }
  $("approve").disabled = !tabs.length;
}

async function refresh() {
  const status = await send("issamBridgeStatus");
  $("state").textContent = status.running ? "작업 중" : status.connected ? "연결됨" : "연결 안 됨";
  $("device").textContent = status.connected
    ? `🤖 ${status.deviceName}`
    : "연결된 아이쌤봇이 없습니다";
  $("detail").textContent = status.connected
    ? `${status.apiBase} · 아이쌤봇이 맡긴 일을 이 크롬에서 처리합니다.`
    : "아이쌤봇 설정에서 ‘크롬 연결’을 누르고 받은 연결 코드를 붙여넣으세요.";
  $("disconnect").hidden = !status.connected;
  $("connect-form").hidden = status.connected;
  $("auto").checked = status.auto === true;
  $("auto").disabled = !status.connected;
  if (status.error) say(status.error);

  const pending = status.pending;
  $("request-section").hidden = !pending;
  if (!pending) {
    shownJobId = null;
    return;
  }
  $("request-text").textContent = pending.prompt;
  const left = Math.max(0, APPROVAL_TIMEOUT_MS - (Date.now() - pending.at));
  $("request-deadline").textContent = left
    ? `${Math.ceil(left / 60_000)}분 안에 답하지 않으면 실행하지 않았다고 알립니다.`
    : "응답 시간이 지났습니다.";
  if (shownJobId !== pending.id) {
    shownJobId = pending.id;
    await fillTabs();
    $("request-section").scrollIntoView({ behavior: "smooth" });
  }
}

$("connect").onclick = () =>
  act(async () => {
    const code = $("code").value.trim();
    if (!code) throw new Error("아이쌤봇에서 복사한 연결 코드를 붙여넣어 주세요.");
    await send("issamBridgeConnect", { code, deviceName: $("name").value.trim() });
    $("code").value = "";
    await refresh();
    say("연결했습니다. 아이쌤봇 설정에서 ‘켜져 있음’으로 보이면 정상입니다.");
  });

$("disconnect").onclick = () =>
  act(async () => {
    if (!confirm("아이쌤봇 연결을 해제할까요? 이 크롬은 더 이상 작업을 받지 않습니다.")) return;
    await send("issamBridgeDisconnect");
    await refresh();
    say("연결을 해제했습니다. 토큰은 지웠습니다.");
  });

$("auto").onchange = () =>
  act(async () => {
    const auto = $("auto").checked;
    await send("issamBridgeAuto", { auto });
    say(
      auto
        ? "이제 요청이 오면 묻지 않고 실행합니다. 열려 있는 웹 탭 중 하나가 사용됩니다."
        : "이제 요청이 올 때마다 이 화면에서 실행을 눌러야 합니다.",
    );
  });

$("approve").onclick = () =>
  act(async () => {
    const tabId = Number($("request-tab").value);
    if (!Number.isInteger(tabId)) throw new Error("실행할 웹 탭을 먼저 열어 주세요.");
    $("approve").disabled = true;
    say("실행 중입니다. 작업 탭을 보고 계셔도 되고, 이 창을 닫아도 계속 진행됩니다.");
    try {
      const result = await send("issamBridgeApprove", { id: shownJobId, tabId });
      say(
        result.status === "done"
          ? `끝났습니다. 아이쌤봇 대화로 결과를 보냈습니다.\n\n${result.text ?? ""}`
          : `끝내지 못했습니다. 아이쌤봇 대화에도 그대로 알렸습니다.\n\n${result.text ?? ""}`,
      );
    } finally {
      $("approve").disabled = false;
      await refresh();
    }
  });

$("reject").onclick = () =>
  act(async () => {
    await send("issamBridgeReject", { id: shownJobId });
    await refresh();
    say("거절했습니다. 아이쌤봇에 그대로 알렸습니다.");
  });

await act(refresh);
setInterval(() => void act(refresh), 2_000);
