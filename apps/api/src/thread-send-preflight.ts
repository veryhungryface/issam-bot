export interface ThreadSendPreflight<TDuplicateRun> {
  assertTeachingAllowed: () => Promise<void>;
  findDuplicateRun?: () => Promise<TDuplicateRun | null>;
}

/**
 * Runs the independent send guards concurrently, while requiring the teaching guard to pass
 * before the caller can use a duplicate nonce result.
 */
export async function checkThreadSendPreflight<TDuplicateRun>({
  assertTeachingAllowed,
  findDuplicateRun,
}: ThreadSendPreflight<TDuplicateRun>): Promise<TDuplicateRun | null> {
  const teachingCheck = assertTeachingAllowed();
  const duplicateLookup = findDuplicateRun?.() ?? Promise.resolve(null);
  const [, duplicateRun] = await Promise.all([teachingCheck, duplicateLookup]);
  return duplicateRun;
}
