#!/usr/bin/env node
/**
 * Drop the 아이쌤봇 bridge into an unpacked 한밭 도우미 folder.
 *
 *   node extensions/issam-bridge/apply.mjs /path/to/hanbat-agent
 *
 * The extension ships as a build. Its `enhancements/` folder is already a hand-written overlay
 * next to that build, and this adds one more file to it plus three small edits. Every edit is
 * anchored on an exact string and refuses to run unless that string appears exactly once, so a
 * future build that moved the anchor fails loudly here instead of silently installing nothing.
 *
 * Running it twice is safe: anything already applied is reported and skipped.
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "src");

const RUNTIME_APPENDIX = `
/* ── 아이쌤봇 연결 (issam-bridge) ────────────────────────────────────────── */
import {installMobileController as issamMobileController} from './mobile-worker.mjs';
import {installIssamBridge, issamBridgeLog} from './issam-bridge.mjs';
import {loadRoot as issamLoadRoot, writeNewText as issamWriteNewText} from './workspace.mjs';
export {installIssamBridge, issamBridgeLog};

/** Both remote paths get the same agent handle; background.js calls this one. */
export function installIssamAndMobile(agent) {
  issamMobileController(agent);
  installIssamBridge(agent, chrome, {
    loadRoot: issamLoadRoot,
    ensureFolder: (root, name) => root.getDirectoryHandle(name, {create: true}),
    writeNewText: issamWriteNewText,
  });
}
`;

const ISSAM_BUTTON =
  "jsx('button',{type:'button',onClick:()=>chrome.tabs.create({url:chrome.runtime.getURL('issam.html')})," +
  "style:{marginLeft:'8px',padding:'7px 12px',borderRadius:'8px',border:'1px solid #bbb',cursor:'pointer'}," +
  "children:'🤖 아이쌤봇 연결'},'issam'),";

const steps = [];

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

/** One anchored edit. Refuses on anything but exactly one match. */
function patch(path, label, { find, replace, done }) {
  const text = readFileSync(path, "utf8");
  if (done(text)) {
    steps.push(`· ${label} — 이미 적용돼 있어 건너뜀`);
    return;
  }
  // A non-global regex `match` returns capture groups, not occurrences, so count with a
  // global copy — otherwise one match with one group reads as two and the patch refuses.
  const matches =
    typeof find === "string"
      ? text.split(find).length - 1
      : (text.match(new RegExp(find.source, `${find.flags.replace("g", "")}g`)) ?? []).length;
  if (matches !== 1) {
    fail(
      `${label}: 기준 문자열을 ${matches ?? 0}번 찾았습니다 (1번이어야 합니다).\n` +
        `  ${path}\n` +
        "  확장 빌드가 바뀐 것 같습니다. 이 스크립트의 기준 문자열을 새 빌드에 맞게 고쳐야 합니다.",
    );
  }
  writeFileSync(path, text.replace(find, replace));
  steps.push(`✓ ${label}`);
}

const target = resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  fail("압축을 푼 확장 폴더 경로를 주세요.  예) node apply.mjs ~/Downloads/hanbat-agent");
}
for (const required of [
  "manifest.json",
  "background.js",
  "enhancements/runtime.mjs",
  "enhancements/workspace.mjs",
]) {
  if (!existsSync(join(target, required))) {
    fail(`${target} 안에 ${required} 가 없습니다. 압축을 푼 hanbat-agent 폴더를 지정하세요.`);
  }
}

// 1. The new files. Plain ESM, dropped beside the overlay that is already there.
copyFileSync(join(SRC, "issam-bridge.mjs"), join(target, "enhancements/issam-bridge.mjs"));
copyFileSync(join(SRC, "issam-bridge-ui.mjs"), join(target, "enhancements/issam-bridge-ui.mjs"));
copyFileSync(join(SRC, "issam.html"), join(target, "issam.html"));
steps.push("✓ issam-bridge.mjs · issam-bridge-ui.mjs · issam.html 복사");

// 2. runtime.mjs is the extension's own hub; the bridge joins it there.
const runtimePath = join(target, "enhancements/runtime.mjs");
if (readFileSync(runtimePath, "utf8").includes("installIssamAndMobile")) {
  steps.push("· runtime.mjs — 이미 적용돼 있어 건너뜀");
} else {
  writeFileSync(runtimePath, readFileSync(runtimePath, "utf8") + RUNTIME_APPENDIX);
  steps.push("✓ runtime.mjs 에 아이쌤봇 설치 경로 추가");
}

// 3. background.js hands the agent to the mobile controller. Hand it to both.
const backgroundPath = join(target, "background.js");
patch(backgroundPath, "background.js — 에이전트를 아이쌤봇에도 연결", {
  find: "IssamEnhancements.installMobileController(",
  replace: "IssamEnhancements.installIssamAndMobile(",
  done: (text) => text.includes("IssamEnhancements.installIssamAndMobile("),
});

// 4. The run log is the only place the agent's own closing message appears, so tee it.
patch(backgroundPath, "background.js — 실행 기록을 아이쌤봇에도 전달", {
  find: /IssamEnhancements\.mobileLog\((\w+)\);/,
  replace: "IssamEnhancements.mobileLog($1),IssamEnhancements.issamBridgeLog($1);",
  done: (text) => text.includes("IssamEnhancements.issamBridgeLog("),
});

// 5. A way in from the side panel, next to 내 작업 폴더 and 휴대폰 연결.
patch(
  join(target, "enhancements/workspace.mjs"),
  "workspace.mjs — 사이드패널에 ‘아이쌤봇 연결’ 버튼",
  {
    find: "},'mobile'),",
    replace: `},'mobile'),${ISSAM_BUTTON}`,
    done: (text) => text.includes("'issam')"),
  },
);

console.log(`\n아이쌤봇 연결을 적용했습니다 — ${target}\n`);
for (const step of steps) console.log(`  ${step}`);
console.log(
  [
    "",
    "다음 순서로 확인하세요.",
    "  1. chrome://extensions 에서 이 폴더를 다시 로드합니다.",
    "  2. 아이쌤봇 설정 → ‘내 크롬에 일 맡기기’ 에서 연결 코드를 만듭니다.",
    "  3. 사이드패널의 ‘🤖 아이쌤봇 연결’ 에서 코드를 붙여넣습니다.",
    "  4. 아이쌤봇 설정에 ‘켜져 있음’ 으로 보이면 연결된 것입니다.",
    "",
  ].join("\n"),
);
