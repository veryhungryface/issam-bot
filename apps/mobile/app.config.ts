import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  if (process.env.EAS_BUILD_PROFILE === "production") {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!apiUrl) {
      throw new Error(
        "EXPO_PUBLIC_API_URL must be set in the EAS production environment before building for the App Store.",
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(apiUrl);
    } catch {
      throw new Error("EXPO_PUBLIC_API_URL must be a valid URL.");
    }
    if (parsed.protocol !== "https:") {
      throw new Error("EXPO_PUBLIC_API_URL must use HTTPS for production builds.");
    }
  }

  // EAS writes the Firebase client config to a temp path and names it here; locally the
  // checked-out copy (gitignored) is used. Without it an Android build has no FCM project
  // and push never arrives.
  const googleServices = process.env.GOOGLE_SERVICES_JSON;
  if (googleServices) {
    return {
      ...(config as ExpoConfig),
      android: { ...config.android, googleServicesFile: googleServices },
    };
  }

  return config as ExpoConfig;
};
