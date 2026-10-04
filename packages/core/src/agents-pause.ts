/**
 * The deployment owner's emergency stop.
 *
 * One switch for the moment something is burning money or doing harm: whatever is running is
 * cancelled, nothing new starts, and scheduled work skips its slot rather than piling up for
 * later. Turning it off replays nothing — anyone whose work was stopped is told so in their
 * thread and can ask again.
 */

/** Left in a thread whose work the stop cancelled. */
export const AGENTS_PAUSED_STOPPED_MESSAGE =
  "관리자가 모든 봇 작업을 긴급 정지해서 이 작업을 멈췄어요. 다시 시작되면 다시 말씀해 주세요.";

/** Left in a thread when a request arrives while the stop is still on. */
export const AGENTS_PAUSED_REFUSED_MESSAGE =
  "지금은 관리자가 모든 봇 작업을 멈춰 두었어요. 다시 시작되면 다시 말씀해 주세요.";

export function agentsPausedNonce(runId: string): string {
  return `agents-paused:${runId}`;
}
