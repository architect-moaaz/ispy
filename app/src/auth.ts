/**
 * Sign in with Google or Meta: the part that talks to the provider and hands back a token for the
 * server to verify. Metro picks `auth.native.ts` on the phone (the providers' native SDKs) and
 * `auth.web.ts` in the browser (Sign In with Google and the Facebook JS SDK). This file is the shape
 * both share; it is what TypeScript sees and what runs nowhere.
 */
export type Provider = "google" | "facebook";
export interface ProviderToken { provider: Provider; token: string }

export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";
export const FACEBOOK_APP_ID = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID ?? "";

/** Which buttons this build can show: a provider needs its client id compiled in. */
export function available(): Record<Provider, boolean> { return { google: !!GOOGLE_WEB_CLIENT_ID, facebook: !!FACEBOOK_APP_ID }; }

/** Opens the provider's sign-in and resolves with its token, or null if the person backed out. */
export async function signInWith(_provider: Provider): Promise<ProviderToken | null> { throw new Error("sign-in is not available on this platform"); }

/** Forgets the provider's cached session so the next tap asks again. */
export async function signOutProviders(): Promise<void> { /* nothing to forget */ }
