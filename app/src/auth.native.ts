import { GoogleSignin, statusCodes } from "@react-native-google-signin/google-signin";
import { AccessToken, LoginManager, Settings } from "react-native-fbsdk-next";
import type { Provider, ProviderToken } from "./auth";

export type { Provider, ProviderToken } from "./auth";
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";
export const FACEBOOK_APP_ID = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID ?? "";
export function available(): Record<Provider, boolean> { return { google: !!GOOGLE_WEB_CLIENT_ID, facebook: !!FACEBOOK_APP_ID }; }

let googleReady = false, fbReady = false;

export async function signInWith(provider: Provider): Promise<ProviderToken | null> {
  if (provider === "google") {
    if (!GOOGLE_WEB_CLIENT_ID) throw new Error("Google sign-in is not configured in this build");
    if (!googleReady) { GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID, offlineAccess: false }); googleReady = true; }
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const r = await GoogleSignin.signIn();
      if (r.type !== "success") return null;
      const idToken = r.data.idToken ?? (await GoogleSignin.getTokens()).idToken;
      if (!idToken) throw new Error("Google returned no ID token; check the web client id");
      return { provider, token: idToken };
    } catch (e: any) {
      if (e?.code === statusCodes.SIGN_IN_CANCELLED) return null;
      if (e?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) throw new Error("Google Play services are not available on this phone");
      throw e;
    }
  }
  if (!FACEBOOK_APP_ID) throw new Error("Meta sign-in is not configured in this build");
  if (!fbReady) { Settings.initializeSDK(); fbReady = true; }
  const r = await LoginManager.logInWithPermissions(["public_profile", "email"]);
  if (r.isCancelled) return null;
  const t = await AccessToken.getCurrentAccessToken();
  if (!t) throw new Error("Meta returned no access token");
  return { provider, token: t.accessToken.toString() };
}

export async function signOutProviders(): Promise<void> {
  try { if (googleReady) await GoogleSignin.signOut(); } catch { /* nothing cached */ }
  try { if (fbReady) LoginManager.logOut(); } catch { /* nothing cached */ }
}
