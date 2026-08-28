/**
 * Temporary deployment switch: hide every model picker so all runs use the
 * server-configured deployment model. Set VITE_HIDE_MODEL_PICKER=1 at build
 * time (Vercel env) to enable; CI and local builds keep the pickers.
 */
export const HIDE_MODEL_PICKER = import.meta.env.VITE_HIDE_MODEL_PICKER === "1";
