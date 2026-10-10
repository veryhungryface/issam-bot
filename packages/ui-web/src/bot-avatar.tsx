import {
  ACTIVE_RUN_STATUSES,
  AVATAR_ACCESSORIES,
  AVATAR_BODIES,
  AVATAR_FACES,
  type AvatarMark,
  avatarCharacter,
  avatarIdentitySeed,
} from "@rakazo/core";
import { type CSSProperties, memo } from "react";
import { cn } from "./lib/utils.js";
import "./styles.css";

export interface BotAvatarProps {
  color: string;
  size?: number;
  status?: string;
  identity?: string;
  className?: string;
}

/** One mark of a character, as the shared description says to draw it. */
function Mark({ mark }: { mark: AvatarMark }) {
  if (mark.kind === "circle") {
    return <circle cx={mark.cx} cy={mark.cy} r={mark.r} fill={mark.fill} />;
  }
  if (mark.kind === "ellipse") {
    return <ellipse cx={mark.cx} cy={mark.cy} rx={mark.rx} ry={mark.ry} fill={mark.fill} />;
  }
  return (
    <path
      d={mark.d}
      fill={mark.fill ?? "none"}
      stroke={mark.stroke}
      strokeWidth={mark.width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function Marks({ marks }: { marks: readonly AvatarMark[] }) {
  return (
    <>
      {marks.map((mark, index) => (
        // The lists are fixed data that never reorders, so the position is the identity.
        <Mark key={index} mark={mark} />
      ))}
    </>
  );
}

export const BotAvatar = memo(function BotAvatar({
  color,
  size = 38,
  status,
  identity,
  className,
}: BotAvatarProps) {
  const isWorking = ACTIVE_RUN_STATUSES.some((activeStatus) => activeStatus === status);
  const seed = avatarIdentitySeed(identity || color || "#8B5CF6");
  const character = avatarCharacter(seed);
  const body = AVATAR_BODIES[character.body] as (typeof AVATAR_BODIES)[number];
  const face = AVATAR_FACES[character.face] as (typeof AVATAR_FACES)[number];
  const accessory = AVATAR_ACCESSORIES[character.accessory] as (typeof AVATAR_ACCESSORIES)[number];

  // Each bot keeps its own rhythm. In unison a row of these reads as machinery rather
  // than as faces, which is the whole reason they have faces.
  const rhythm = {
    "--rakazo-avatar-delay": `${(seed % 47) / 10}s`,
    "--rakazo-avatar-blink": `${4.8 + (seed % 23) / 10}s`,
    "--rakazo-avatar-roll": `${7 + (seed % 31) / 10}s`,
  } as CSSProperties;

  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      className={cn("rakazo-avatar select-none", className)}
      data-working={isWorking}
      data-body={body.name}
      data-face={face.name}
      style={{ width: size, height: size, flex: "none", ...rhythm }}
    >
      {/* Kept mounted so its timeline does not restart every time a run does, and it is
          what says "working" at the size these are mostly seen, where a moving mouth is
          too small to read. */}
      <circle
        className="rakazo-avatar-ring"
        cx={50}
        cy={50}
        r={48}
        fill="none"
        stroke={color}
        strokeWidth={3.5}
        strokeDasharray="38 200"
        strokeLinecap="round"
      />
      <Marks marks={accessory.back} />
      <path d={body.d} fill={color} />
      <g transform={`translate(0 ${body.faceY})`}>
        <g className="rakazo-avatar-eyes">
          <Marks marks={face.eyes} />
          <g className="rakazo-avatar-pupils">
            <Marks marks={face.pupils} />
          </g>
        </g>
        <g className="rakazo-avatar-mouth">
          <Marks marks={face.mouth} />
        </g>
        <Marks marks={face.extra} />
      </g>
      <g transform={`translate(0 ${body.faceY})`}>
        <Marks marks={accessory.front} />
      </g>
    </svg>
  );
});

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex h-11 w-11 items-center justify-center gap-1.5 rounded-full bg-card">
        <span className="h-4 w-[7px] rounded-full bg-primary" />
        <span className="h-4 w-[7px] rounded-full bg-primary" />
      </div>
      <span className="font-[Aeonik,ui-sans-serif] text-[28px] tracking-tight text-foreground">
        Rakazo
      </span>
    </div>
  );
}
