import {
  CRON_FREQS,
  type CronFreq,
  type CronPreset,
  type CronUnit,
  cronFromPreset,
  presetFromCron,
} from "@rakazo/core";

const UNITS: CronUnit[] = ["minutes", "hours", "days"];
const NUMBERS = [1, 2, 3, 5, 10, 15, 30, 45];
const TIME_LABELS: Record<string, string> = {
  "6:00 AM": "오전 6:00",
  "7:00 AM": "오전 7:00",
  "8:00 AM": "오전 8:00",
  "9:00 AM": "오전 9:00",
  "12:00 PM": "오후 12:00",
  "3:00 PM": "오후 3:00",
  "6:00 PM": "오후 6:00",
  "9:00 PM": "오후 9:00",
};
const TIMES = Object.keys(TIME_LABELS);

const TIMED: CronFreq[] = ["Every day", "Weekdays", "Every week", "Every month"];

const FREQ_LABELS: Record<CronFreq, string> = {
  Interval: "간격 반복",
  "Every hour": "매시간",
  "Every day": "매일",
  Weekdays: "평일",
  "Every week": "매주",
  "Every month": "매월",
  Advanced: "고급 설정",
};

const UNIT_LABELS: Record<CronUnit, string> = {
  minutes: "분",
  hours: "시간",
  days: "일",
};

function koreanTimeLabel(time: string): string {
  return TIME_LABELS[time] ?? time;
}

export function describeKoreanSchedule(preset: CronPreset): { lead: string; detail: string } {
  if (preset.freq === "Interval") {
    return { lead: "반복", detail: `${preset.n}${UNIT_LABELS[preset.unit]}마다` };
  }
  if (preset.freq === "Every hour") return { lead: "매시간", detail: "" };
  if (preset.freq === "Advanced") {
    return { lead: "고급 일정", detail: preset.cron || "*/3 * * * *" };
  }
  const time = `${koreanTimeLabel(preset.time)}에`;
  if (preset.freq === "Weekdays") return { lead: "평일", detail: time };
  if (preset.freq === "Every week") return { lead: "매주 월요일", detail: time };
  if (preset.freq === "Every month") return { lead: "매월 1일", detail: time };
  return { lead: "매일", detail: time };
}

export function formatKoreanCron(cron: string): string {
  const { lead, detail } = describeKoreanSchedule(presetFromCron(cron));
  return detail ? `${lead} ${detail}` : lead;
}

export function RoutineSchedule({
  value,
  onChange,
}: {
  value: CronPreset;
  onChange: (next: CronPreset) => void;
}) {
  const { lead, detail } = describeKoreanSchedule(value);
  const times = TIMES.includes(value.time) ? TIMES : [...TIMES, value.time];
  const numbers = NUMBERS.includes(value.n) ? NUMBERS : [...NUMBERS, value.n].sort((a, b) => a - b);

  function patch(partial: Partial<CronPreset>) {
    onChange({ ...value, ...partial });
  }

  return (
    <div className="mt-2 rounded-[13px] border border-[#26262A] p-3">
      <div className="flex items-center gap-2.5 px-0.5">
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#C9C9CE"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        <span className="text-[14.5px] text-[#ECECEE]">{lead}</span>
        {detail ? <span className="flex-1 text-[14.5px] text-[#85858A]">{detail}</span> : null}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-[11px] bg-[#16161A] px-2.5 py-2.5 text-[14px] text-[#7A7A80]">
        <select
          className="rk-schedule-select"
          value={value.freq}
          aria-label="실행 주기"
          onChange={(event) => {
            const freq = event.target.value as CronFreq;
            if (freq === "Advanced") {
              patch({ freq, cron: cronFromPreset(value) });
              return;
            }
            patch({ freq });
          }}
        >
          {CRON_FREQS.map((freq) => (
            <option key={freq} value={freq}>
              {FREQ_LABELS[freq]}
            </option>
          ))}
        </select>
        {value.freq === "Interval" ? (
          <>
            <span>매</span>
            <select
              className="rk-schedule-select"
              value={String(value.n)}
              aria-label="반복 간격"
              onChange={(event) => patch({ n: Number(event.target.value) })}
            >
              {numbers.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <select
              className="rk-schedule-select"
              value={value.unit}
              aria-label="반복 단위"
              onChange={(event) => patch({ unit: event.target.value as CronUnit })}
            >
              {UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {UNIT_LABELS[unit]}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {TIMED.includes(value.freq) ? (
          <>
            <span>오전/오후</span>
            <select
              className="rk-schedule-select"
              value={value.time}
              aria-label="실행 시간"
              onChange={(event) => patch({ time: event.target.value })}
            >
              {times.map((time) => (
                <option key={time} value={time}>
                  {koreanTimeLabel(time)}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {value.freq === "Advanced" ? (
          <input
            value={value.cron}
            placeholder="*/3 * * * *"
            aria-label="고급 일정 표현식"
            onChange={(event) => patch({ cron: event.target.value })}
            className="min-w-[120px] flex-1 rounded-lg border-0 bg-[#24242A] px-2.5 py-1.5 font-mono text-[13.5px] text-[#ECECEE] outline-none"
          />
        ) : null}
      </div>
    </div>
  );
}
