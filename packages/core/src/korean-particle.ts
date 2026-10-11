/**
 * Korean picks a particle by the sound a word ends on: 이 after a final consonant, 가 after a
 * vowel. A bot's name goes straight into its notification titles, so the particle has to be
 * chosen when the title is written — "연구원이 답을 기다리고 있어요" but "비서가 답을 기다리고 있어요".
 *
 * Hangul answers for itself: every syllable block stores its final consonant, so the last
 * block is all it takes. A name written in Latin letters or digits is read aloud before it is
 * followed by a particle, so what matters is the Korean reading of the last character — "ERP"
 * ends in 피, "Model 3" in 삼. Only those endings are listed; anything else (a symbol, an
 * emoji, a CJK character we cannot pronounce) takes 가, which is what a Korean writer defaults
 * to when a name has no obvious reading.
 */

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
const JONGSEONG_COUNT = 28;

/** Latin letters whose Korean reading ends on a consonant: 엘, 엠, 엔, 알. */
const CONSONANT_FINAL_LETTERS = new Set(["l", "m", "n", "r"]);
/** Digits whose Korean reading ends on a consonant: 영, 일, 삼, 육, 칠, 팔. */
const CONSONANT_FINAL_DIGITS = new Set(["0", "1", "3", "6", "7", "8"]);

/** The subject particle for a name: 이 after a consonant, 가 after a vowel. */
export function subjectParticle(name: string): "이" | "가" {
  return endsInConsonant(name) ? "이" : "가";
}

/** A name with its subject particle attached, e.g. `연구원이`. */
export function withSubjectParticle(name: string): string {
  return `${name}${subjectParticle(name)}`;
}

function endsInConsonant(name: string): boolean {
  const last = [...name.trim()].at(-1);
  if (!last) return false;
  const code = last.codePointAt(0) ?? 0;
  if (code >= HANGUL_START && code <= HANGUL_END) {
    return (code - HANGUL_START) % JONGSEONG_COUNT !== 0;
  }
  if (CONSONANT_FINAL_DIGITS.has(last)) return true;
  return CONSONANT_FINAL_LETTERS.has(last.toLowerCase());
}
