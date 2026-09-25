import { BotAvatar, GroupAvatar, type GroupAvatarMember } from "@rakazo/ui-web";
import { LoadingState } from "./primitives";

/** Lightweight peer event shown without exposing the exchanged message body. */
export function CollaborationMarker({
  ariaLabel,
  color,
  identity,
  label,
  onClick,
}: {
  ariaLabel: string;
  color: string;
  identity: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <div className="flex justify-start">
      <button
        type="button"
        data-testid="peer-receipt-chip"
        aria-label={ariaLabel}
        onClick={onClick}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground/75"
      >
        <BotAvatar color={color} identity={identity} size={16} />
        <span dir="auto" className="truncate">
          {label}
        </span>
      </button>
    </div>
  );
}

/**
 * Shown while a turn is running and nothing has been said yet. `detail` names the phase the
 * run is actually in: a bot that boots a browser and thinks for half a minute before its
 * first word looks stuck without it.
 */
export function ActiveBotGlyph({
  bots,
  label,
  detail,
}: {
  bots: GroupAvatarMember[];
  label: string;
  detail?: string;
}) {
  return (
    <div className="flex min-h-10 items-center gap-2.5 px-1">
      <LoadingState indicator={<GroupAvatar members={bots} size={28} />} label={label} />
      {detail ? (
        <span
          data-testid="working-phase"
          dir="auto"
          className="text-[14px] text-muted-foreground"
          style={{ animation: "rkPulse 1.8s ease-in-out infinite" }}
        >
          {detail}
        </span>
      ) : null}
    </div>
  );
}
