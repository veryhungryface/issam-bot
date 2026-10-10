import type { ReactNode } from "react";

export function MessageHoverMetadata({
  side,
  pinned = false,
  children,
}: {
  side: "start" | "end";
  pinned?: boolean;
  children: ReactNode;
}) {
  // Hover-capable pointers reveal the rail on demand. A finger never sees it: holding the
  // message opens the same actions where the thumb already is, instead of parking a row of
  // dots halfway down the bubble for it to go and find.
  const reveal = pinned
    ? "pointer-events-auto opacity-100"
    : "pointer-events-none opacity-0 group-hover/message:pointer-events-auto group-hover/message:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100";

  return (
    <div
      data-testid="message-hover-rail"
      className={`absolute top-1/2 z-10 hidden -translate-y-1/2 items-center transition-opacity [@media(hover:hover)_and_(pointer:fine)]:flex ${reveal} ${
        side === "end" ? "start-full ms-1" : "end-full me-1"
      }`}
    >
      {children}
    </div>
  );
}
