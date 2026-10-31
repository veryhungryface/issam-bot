import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  CRON_FREQS,
  type CronFreq,
  type CronPreset,
  type CronUnit,
  cronFromPreset,
} from "@rakazo/core";
import { Input, NativeSelect, NativeSelectOption } from "@rakazo/ui-web";
import { Clock } from "lucide-react";

/**
 * Only the units and amounts that can stay inside MAX_ROUTINE_RUNS_PER_DAY.
 *
 * The picker used to offer minutes beside hours and days, and "every hour" above them, so
 * the two cheapest-looking clicks in the panel were the two most expensive schedules it
 * could produce — 1,440 and 24 wakes a day. Nothing on screen said what a wake cost. An
 * option the server will refuse is not a choice, so it is not offered; a routine already
 * holding one still shows its own value, below.
 */
const UNITS: CronUnit[] = ["hours", "days"];
const NUMBERS_BY_UNIT: Record<CronUnit, number[]> = {
  minutes: [],
  hours: [12],
  days: [1, 2, 3, 5, 10, 15, 30],
};
const OFFERED_FREQS: CronFreq[] = CRON_FREQS.filter((freq) => freq !== "Every hour");
const TIMES = [
  "6:00 AM",
  "7:00 AM",
  "8:00 AM",
  "9:00 AM",
  "12:00 PM",
  "3:00 PM",
  "6:00 PM",
  "9:00 PM",
];

const TIMED: CronFreq[] = ["Every day", "Weekdays", "Every week", "Every month"];

function cronFreqLabel(freq: CronFreq): string {
  switch (freq) {
    case "Every hour":
      return t`Every hour`;
    case "Every day":
      return t`Every day`;
    case "Weekdays":
      return t`Weekdays`;
    case "Every week":
      return t`Every week`;
    case "Every month":
      return t`Every month`;
    case "Interval":
      return t`Interval`;
    case "Advanced":
      return t`Advanced`;
    default:
      return freq;
  }
}

function cronUnitLabel(unit: CronUnit): string {
  switch (unit) {
    case "minutes":
      return t`minutes`;
    case "hours":
      return t`hours`;
    case "days":
      return t`days`;
    default:
      return unit;
  }
}

function cronUnitLabelSingular(unit: CronUnit): string {
  switch (unit) {
    case "minutes":
      return t`minute`;
    case "hours":
      return t`hour`;
    case "days":
      return t`day`;
    default:
      return unit;
  }
}

function describeCronPresetLocalized(preset: CronPreset): { lead: string; detail: string } {
  if (preset.freq === "Interval") {
    const unitLabel =
      preset.n === 1 ? cronUnitLabelSingular(preset.unit) : cronUnitLabel(preset.unit);
    return {
      lead: t`Every`,
      detail: t`${preset.n} ${unitLabel}`,
    };
  }
  if (preset.freq === "Every hour") {
    return { lead: t`Every hour`, detail: "" };
  }
  if (preset.freq === "Advanced") {
    return { lead: t`Cron`, detail: preset.cron || "*/3 * * * *" };
  }
  if (preset.freq === "Weekdays") {
    return { lead: t`Weekdays`, detail: t`at ${preset.time}` };
  }
  if (preset.freq === "Every week") {
    return { lead: t`Every Monday`, detail: t`at ${preset.time}` };
  }
  if (preset.freq === "Every month") {
    return { lead: t`Monthly`, detail: t`on the 1st at ${preset.time}` };
  }
  return { lead: t`Every day`, detail: t`at ${preset.time}` };
}

export function RoutineSchedule({
  value,
  onChange,
}: {
  value: CronPreset;
  onChange: (next: CronPreset) => void;
}) {
  const { t } = useLingui();
  const { lead, detail } = describeCronPresetLocalized(value);
  const times = TIMES.includes(value.time) ? TIMES : [...TIMES, value.time];
  // A saved routine keeps whatever it already holds in every list it appears in, so opening
  // an older schedule shows what it actually does instead of silently snapping to a legal
  // value the moment the panel renders.
  const allowedNumbers = NUMBERS_BY_UNIT[value.unit] ?? [];
  const numbers = allowedNumbers.includes(value.n)
    ? allowedNumbers
    : [...allowedNumbers, value.n].sort((a, b) => a - b);
  const units = UNITS.includes(value.unit) ? UNITS : [...UNITS, value.unit];
  const freqs = OFFERED_FREQS.includes(value.freq) ? OFFERED_FREQS : [...OFFERED_FREQS, value.freq];

  function patch(partial: Partial<CronPreset>) {
    onChange({ ...value, ...partial });
  }

  const intervalAmountSelect = (
    <NativeSelect
      size="sm"
      value={String(value.n)}
      aria-label={t`Interval amount`}
      onChange={(event) => patch({ n: Number(event.target.value) })}
    >
      {numbers.map((n) => (
        <NativeSelectOption key={n} value={n}>
          {n}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );

  const intervalUnitSelect = (
    <NativeSelect
      size="sm"
      value={value.unit}
      aria-label={t`Interval unit`}
      onChange={(event) => patch({ unit: event.target.value as CronUnit })}
    >
      {units.map((unit) => (
        <NativeSelectOption key={unit} value={unit}>
          {cronUnitLabel(unit)}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );

  const timeSelect = (
    <NativeSelect
      size="sm"
      value={value.time}
      aria-label={t`Time of day`}
      onChange={(event) => patch({ time: event.target.value })}
    >
      {times.map((time) => (
        <NativeSelectOption key={time} value={time}>
          {time}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );

  return (
    <div className="mt-2 rounded-xl border border-border p-3">
      <div className="flex items-center gap-2.5 px-0.5">
        <Clock size={17} strokeWidth={1.6} className="shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-[14.5px] text-foreground">{lead}</span>
        {detail ? (
          <span className="flex-1 text-[14.5px] text-muted-foreground">{detail}</span>
        ) : null}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <NativeSelect
          size="sm"
          value={value.freq}
          aria-label={t`How often`}
          onChange={(event) => {
            const freq = event.target.value as CronFreq;
            if (freq === "Advanced") {
              patch({ freq, cron: cronFromPreset(value) });
              return;
            }
            patch({ freq });
          }}
        >
          {freqs.map((freq) => (
            <NativeSelectOption key={freq} value={freq}>
              {cronFreqLabel(freq)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {value.freq === "Interval" ? (
          <Trans>
            every {intervalAmountSelect} {intervalUnitSelect}
          </Trans>
        ) : null}
        {TIMED.includes(value.freq) ? <Trans>at {timeSelect}</Trans> : null}
        {value.freq === "Advanced" ? (
          <Input
            value={value.cron}
            placeholder="0 9,21 * * *"
            aria-label={t`Cron expression`}
            onChange={(event) => patch({ cron: event.target.value })}
            className="h-7 min-w-[120px] flex-1 font-mono text-[13px] md:text-[13px]"
          />
        ) : null}
      </div>
    </div>
  );
}
