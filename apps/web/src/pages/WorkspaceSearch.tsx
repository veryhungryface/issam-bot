import type { SearchHit } from "@rakazo/contracts";
import { koreanSearchKindLabel } from "../lib/korean-labels";

export function WorkspaceSearchResults({
  hits,
  loading,
  onSelect,
}: {
  hits: SearchHit[];
  loading: boolean;
  onSelect: (hit: SearchHit) => void;
}) {
  if (loading) {
    return <div className="px-3 py-4 text-[14px] text-[#85858A]">검색 중…</div>;
  }
  if (!hits.length) {
    return <div className="px-3 py-4 text-[14px] text-[#85858A]">검색 결과 없음</div>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {hits.map((hit) => (
        <button
          key={`${hit.kind}-${hit.botId}-${hit.messageId ?? hit.artifactId ?? hit.routineId ?? hit.url}`}
          type="button"
          onClick={() => onSelect(hit)}
          className="rounded-xl px-2.5 py-[11px] text-left hover:bg-[#131315]"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[15px] font-medium text-[#ECECEE]">{hit.title}</span>
            <span className="shrink-0 text-[12px] uppercase tracking-wide text-[#6C6C70]">
              {koreanSearchKindLabel(hit.kind)}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[13px] text-[#85858A]">
            {hit.botName} · {hit.snippet}
          </div>
        </button>
      ))}
    </div>
  );
}
