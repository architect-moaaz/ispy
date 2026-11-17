import type { Provider, ProviderToken } from "./auth";

export type { Provider, ProviderToken } from "./auth";
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";
export const FACEBOOK_APP_ID = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID ?? "";
export function available(): Record<Provider, boolean> { return { google: !!GOOGLE_WEB_CLIENT_ID, facebook: !!FACEBOOK_APP_ID }; }

/** Loads a provider script once. */
const scripts = new Map<string, Promise<void>>();
function load(src: string): Promise<void> {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise<void>((res, rej) => { const s = document.createElement("script"); s.src = src; s.async = true; s.onload = () => res(); s.onerror = () => rej(new Error(`could not load ${src}`)); document.head.appendChild(s); });
    scripts.set(src, p);
  }
  return p;
}

declare const google: any;
declare const FB: any;

export async function signInWith(provider: Provider): Promise<ProviderToken | null> {
  if (provider === "google") {
    if (!GOOGLE_WEB_CLIENT_ID) throw new Error("Google sign-in is not configured in this build");
    await load("https://accounts.google.com/gsi/client");
    // Sign In with Google: the One Tap prompt, falling back to the rendered button when the browser
    // suppresses prompts (third-party-cookie settings, a recent dismissal).
    return new Promise<ProviderToken | null>((res, rej) => {
      let done = false;
      const finish = (v: ProviderToken | null) => { if (done) return; done = true; host.remove(); res(v); };
      const host = document.createElement("div");
      Object.assign(host.style, { position: "fixed", inset: "0", background: "rgba(7,11,16,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: "9999", flexDirection: "column", gap: "12px", fontFamily: "sans-serif", color: "#8AA3AC" });
      host.innerHTML = '<div style="font-size:13px;letter-spacing:2px">SIGN IN WITH GOOGLE</div>';
      const btn = document.createElement("div"); host.appendChild(btn);
      const cancel = document.createElement("button"); cancel.textContent = "Cancel"; Object.assign(cancel.style, { marginTop: "8px", background: "transparent", color: "#00F0FF", border: "1px solid #00F0FF", padding: "6px 14px", borderRadius: "6px", cursor: "pointer" }); cancel.onclick = () => finish(null); host.appendChild(cancel);
      document.body.appendChild(host);
      try {
        google.accounts.id.initialize({ client_id: GOOGLE_WEB_CLIENT_ID, callback: (r: { credential?: string }) => (r.credential ? finish({ provider, token: r.credential }) : finish(null)), auto_select: false, cancel_on_tap_outside: false });
        google.accounts.id.renderButton(btn, { theme: "filled_black", size: "large", text: "continue_with", shape: "pill" });
        google.accounts.id.prompt();
      } catch (e) { finish(null); rej(e); }
    });
  }
  if (!FACEBOOK_APP_ID) throw new Error("Meta sign-in is not configured in this build");
  if (!(window as any).fbAsyncInit) {
    await new Promise<void>((res) => { (window as any).fbAsyncInit = () => { FB.init({ appId: FACEBOOK_APP_ID, version: "v19.0", cookie: false, xfbml: false }); res(); }; void load("https://connect.facebook.net/en_US/sdk.js"); });
  }
  return new Promise<ProviderToken | null>((res) => {
    FB.login((r: { authResponse?: { accessToken?: string } }) => res(r?.authResponse?.accessToken ? { provider, token: r.authResponse.accessToken } : null), { scope: "public_profile,email" });
  });
}

export async function signOutProviders(): Promise<void> {
  try { if ((window as any).google?.accounts?.id) google.accounts.id.disableAutoSelect(); } catch { /* not loaded */ }
}
