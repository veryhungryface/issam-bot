import { BrowserbaseApiError } from "./browserbase-client.js";

export interface RunSetupErrorPlan {
  retry: boolean;
  retryDelayMs: number;
  userMessage: string;
}

const MAX_TRANSIENT_SETUP_ATTEMPTS = 3;

export function classifyRunSetupError(
  error: unknown,
  previousSetupFailures: number,
): RunSetupErrorPlan {
  if (error instanceof BrowserbaseApiError) {
    if (error.status === 402) {
      return terminal(
        "Browserbase 이용 한도 또는 결제 상태로 인해 브라우저를 시작할 수 없습니다. Browserbase 요금제와 사용 가능 시간을 확인해 주세요.",
      );
    }
    if (error.status === 401 || error.status === 403) {
      return terminal("Browserbase 인증에 실패했습니다. API 키와 프로젝트 설정을 확인해 주세요.");
    }
    if ([400, 404, 422].includes(error.status)) {
      return terminal(
        "Browserbase 브라우저 설정이 올바르지 않아 작업을 시작할 수 없습니다. 관리자에게 설정 확인을 요청해 주세요.",
      );
    }
    if (error.status === 429) {
      return transient(
        previousSetupFailures,
        "Browserbase 요청 한도를 초과해 브라우저를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    }
    if (error.status === 408 || error.status >= 500) {
      return transient(
        previousSetupFailures,
        "Browserbase 일시 장애로 브라우저를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    }
  }

  return transient(
    previousSetupFailures,
    "브라우저 실행 준비 중 오류가 반복되었습니다. 잠시 후 다시 시도해 주세요.",
  );
}

function transient(previousSetupFailures: number, exhaustedMessage: string): RunSetupErrorPlan {
  if (previousSetupFailures >= MAX_TRANSIENT_SETUP_ATTEMPTS - 1) {
    return terminal(exhaustedMessage);
  }
  return {
    retry: true,
    retryDelayMs: Math.min(15_000 * 2 ** previousSetupFailures, 60_000),
    userMessage: "브라우저 연결을 다시 시도하고 있습니다.",
  };
}

function terminal(userMessage: string): RunSetupErrorPlan {
  return { retry: false, retryDelayMs: 0, userMessage };
}
