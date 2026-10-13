/**
 * Temporary deployment switch: hide every model picker so all runs use the
 * server-configured deployment model. Set VITE_HIDE_MODEL_PICKER=1 at build
 * time (Vercel env) to enable; CI and local builds keep the pickers.
 */
export const HIDE_MODEL_PICKER = import.meta.env.VITE_HIDE_MODEL_PICKER === "1";

/**
 * Whether a bot can speak and be called.
 *
 * Spoken replies and calling are hidden in this deployment: nobody here uses them, and both
 * menu entries led to the same page asking for a voice provider key of your own. Talking
 * *to* a bot is a different feature and is untouched — dictation runs on the deployment's
 * own transcription key and needs none of this.
 *
 * Hidden is the default rather than a switch a build has to remember to throw, so the app
 * that ships and the app the tests drive are the same app. Either `VITE_VOICE_OUTPUT=1` at
 * build time or `localStorage["rakazo.voice-output"] = "1"` in a browser brings the feature
 * back whole — the e2e suite turns it on the second way, so what it covers is the real
 * thing, and that is also how to try it again without a deploy.
 */
export const VOICE_OUTPUT = import.meta.env.VITE_VOICE_OUTPUT === "1" || storedVoiceOutput();

/**
 * Whether the memory screens are on the menu.
 *
 * The bots remember either way — this hides the screens for reading and editing what they
 * wrote, not the remembering. Production holds 47 bot memories and 21 user ones, written
 * without anyone opening these screens.
 *
 * They are hidden because what they showed was not the memories. The Memory entry opened
 * on a sign-up form for Supermemory, a paid service this deployment has never connected,
 * which made the whole feature read as broken; the memories sat below it. A screen that
 * teaches people the product does not work is worse than no screen, and the context memory
 * this deployment actually wants is a different thing, not yet built.
 *
 * Hidden by default rather than a switch a build has to remember to throw, so the app that
 * ships and the app the tests drive are the same app. `VITE_MEMORY_UI=1` at build time or
 * `localStorage["rakazo.memory-ui"] = "1"` in a browser brings both screens back whole —
 * the e2e suite uses the second, so its coverage stays on the real thing.
 */
export const MEMORY_UI = import.meta.env.VITE_MEMORY_UI === "1" || storedMemoryUi();

function storedMemoryUi(): boolean {
  try {
    return localStorage.getItem("rakazo.memory-ui") === "1";
  } catch {
    // A private window, blocked site data, or anywhere that is not a browser.
    return false;
  }
}

function storedVoiceOutput(): boolean {
  try {
    return localStorage.getItem("rakazo.voice-output") === "1";
  } catch {
    // A private window, blocked site data, or anywhere that is not a browser.
    return false;
  }
}
