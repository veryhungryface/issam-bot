import type { Me } from "@rakazo/contracts";
import { useEffect, useState } from "react";
import { desktopBridge } from "../lib/desktop";
import { rpc } from "../lib/rpc";

export function HostComputerPrompt({ initialMe }: { initialMe?: Me }) {
  const desktop = desktopBridge();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mac = desktop?.platform === "darwin";
  const hostLabel = mac ? "이 Mac" : "이 컴퓨터";

  useEffect(() => {
    if (!desktop) return;
    if (initialMe) {
      if (initialMe.canChooseHostComputer && initialMe.computerHost == null) setOpen(true);
      return;
    }
    void rpc
      .me()
      .then((me) => {
        if (me.canChooseHostComputer && me.computerHost == null) setOpen(true);
      })
      .catch(() => undefined);
  }, [desktop, initialMe]);

  if (!open) return null;

  async function choose(computerHost: "docker" | "this-mac") {
    setPending(true);
    setError(null);
    try {
      await rpc.deployment.update({ computerHost });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "선택을 저장하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-[#050506]/80 px-6">
      <div className="w-[440px] rounded-[20px] border border-[#26262A] bg-[#121214] p-6">
        <h2 className="text-[22px] font-medium text-[#F1F1F2]">봇을 어디에서 실행할까요?</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-[#85858A]">
          기본값은 Docker이며 봇들이 공유 브라우저를 사용합니다.
          {mac
            ? " 봇을 이 Mac에서 실행하면 별도의 macOS 권한 확인 없이 사용자 권한으로 동작합니다."
            : ` 봇을 ${hostLabel}에서 실행하면 별도 권한 확인 없이 사용자 권한으로 동작합니다.`}
        </p>
        {error ? <p className="mt-3 text-sm text-[#E65707]">{error}</p> : null}
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => void choose("docker")}
            className="rounded-[11px] bg-[#F1F1EF] px-5 py-2.5 text-[#17171A] disabled:opacity-40"
          >
            Docker(권장)
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => void choose("this-mac")}
            className="rounded-[11px] border border-[#26262A] px-5 py-2.5 text-[#ECECEE] disabled:opacity-40"
          >
            {hostLabel} 사용
          </button>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-[#6C6C70]">
          {hostLabel} 옵션은 홈 폴더를 포함해 사용자 계정 권한으로 셸 명령을 실행합니다. 공유 또는
          공개 서버에서는 사용하지 마세요.
        </p>
      </div>
    </div>
  );
}
