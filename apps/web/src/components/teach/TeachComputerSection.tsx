import type { ComputerStatus, TaughtSkill } from "@rakazo/contracts";
import { useMemo, useState } from "react";
import { rpc } from "../../lib/rpc";
import { TeachRecordingChrome } from "./TeachRecordingChrome";

export function TeachComputerSection({
  botId,
  computer,
  skills,
  busy: busyProp,
  onRefresh,
  onOpenComputer,
  onStopTeaching,
  onAddRoutine,
}: {
  botId: string;
  computer: ComputerStatus | null;
  skills: TaughtSkill[];
  busy?: boolean;
  onRefresh: () => Promise<void>;
  onOpenComputer: () => Promise<void>;
  onStopTeaching?: () => Promise<void>;
  onAddRoutine: (skill: TaughtSkill) => void;
}) {
  const [goalOpen, setGoalOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [localBusy, setLocalBusy] = useState(false);
  const busy = Boolean(busyProp) || localBusy;
  const recording = useMemo(
    () => skills.find((skill) => skill.status === "recording") ?? null,
    [skills],
  );
  const saved = useMemo(
    () => skills.filter((skill) => skill.status === "saved" || skill.status === "draft"),
    [skills],
  );
  const teachAvailable = Boolean(computer && computer.kind !== "desktop");

  async function startTeaching() {
    if (!goal.trim() || busy) return;
    setLocalBusy(true);
    try {
      await rpc.computer.boot({ botId });
      await rpc.skills.start({ botId, goal: goal.trim() });
      setGoalOpen(false);
      setGoal("");
      await onOpenComputer();
      await onRefresh();
    } finally {
      setLocalBusy(false);
    }
  }

  async function stopTeaching() {
    if (!recording || busy) return;
    if (onStopTeaching) {
      await onStopTeaching();
      return;
    }
    setLocalBusy(true);
    try {
      await rpc.skills.stop({ skillId: recording.id });
      await onRefresh();
    } finally {
      setLocalBusy(false);
    }
  }

  return (
    <div className="mt-[30px]">
      <div className="mb-3 text-[14px] text-[#85858A]">작업 가르치기</div>
      {!teachAvailable ? (
        <div className="rounded-[11px] border border-[#232326] px-3 py-3 text-[13.5px] leading-[1.5] text-[#6C6C70]">
          {computer?.kind === "desktop"
            ? "작업 학습에는 화면이 있는 샌드박스 브라우저가 필요합니다. 데스크톱 호스트 봇은 셸 작업만 실행할 수 있습니다."
            : "작업을 가르치려면 브라우저 화면을 여세요."}
        </div>
      ) : recording ? (
        <TeachRecordingChrome
          recording={recording}
          busy={busy}
          onStop={stopTeaching}
          variant="panel"
        />
      ) : goalOpen ? (
        <div className="rounded-[11px] border border-[#232326] bg-[#121214] px-3 py-3">
          <label htmlFor="teach-goal-input" className="text-[13px] text-[#85858A]">
            어떤 작업을 시연할까요?
          </label>
          <textarea
            id="teach-goal-input"
            data-testid="teach-goal-input"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            rows={3}
            className="mt-2 w-full rounded-[10px] border border-[#26262A] bg-[#0E0E10] px-3 py-2 text-[14px] text-[#ECECEE] outline-none"
            placeholder="CRM에서 이번 주 목록을 내려받아 공유 폴더에 저장하기"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || !goal.trim()}
              onClick={() => void startTeaching()}
              className="rounded-[11px] bg-[#F1F1EF] px-4 py-2 text-[14px] text-[#17171A] disabled:opacity-40"
            >
              {busy ? "시작 중…" : "기록 시작"}
            </button>
            <button
              type="button"
              onClick={() => setGoalOpen(false)}
              className="rounded-[11px] border border-[#26262A] px-4 py-2 text-[14px] text-[#ECECEE]"
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          data-testid="teach-start-button"
          onClick={() => setGoalOpen(true)}
          className="flex items-center gap-2.5 px-2.5 py-2.5 text-[14.5px] text-[#7A7A80]"
        >
          + 작업 가르치기
        </button>
      )}

      {saved.length > 0 ? (
        <>
          <div className="mt-[22px] mb-3 text-[14px] text-[#85858A]">저장된 작업</div>
          {saved.map((skill) => (
            <div key={skill.id} className="mb-2 rounded-[11px] border border-[#232326] px-3 py-3">
              <div className="text-[14px] text-[#ECECEE]">{skill.name || skill.goal}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setLocalBusy(true);
                    try {
                      await rpc.skills.testRun({ skillId: skill.id });
                      await onRefresh();
                    } finally {
                      setLocalBusy(false);
                    }
                  }}
                  className="rounded-[11px] border border-[#26262A] px-3 py-1.5 text-[13px] text-[#ECECEE]"
                >
                  테스트
                </button>
                <button
                  type="button"
                  onClick={() => onAddRoutine(skill)}
                  className="rounded-[11px] border border-[#26262A] px-3 py-1.5 text-[13px] text-[#ECECEE]"
                >
                  자동 작업에 추가
                </button>
                <button
                  type="button"
                  disabled={busy || skill.status !== "draft"}
                  onClick={async () => {
                    setLocalBusy(true);
                    try {
                      await rpc.skills.save({ skillId: skill.id });
                      await onRefresh();
                    } finally {
                      setLocalBusy(false);
                    }
                  }}
                  className="rounded-[11px] bg-[#F1F1EF] px-3 py-1.5 text-[13px] text-[#17171A] disabled:opacity-40"
                >
                  저장
                </button>
              </div>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}
