// Dynamic config on top of app.json. The sign-in SDKs' config plugins refuse to run without their
// credentials, so each is added only when its env is present at build time (EAS environment
// variables or a local .env):
//
//   GOOGLE_IOS_URL_SCHEME   the reversed iOS client id (com.googleusercontent.apps.…); iOS builds only.
//                           Android needs no plugin: autolinking plus EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.
//   FACEBOOK_APP_ID         the Meta app id;  FACEBOOK_CLIENT_TOKEN  from Meta > App settings > Advanced.
//
// Without them the app builds and runs; the Google and Meta buttons stay hidden.
module.exports = ({ config }) => {
  const plugins = (config.plugins ?? []).filter((p) => {
    const name = Array.isArray(p) ? p[0] : p;
    return name !== "@react-native-google-signin/google-signin" && name !== "react-native-fbsdk-next";
  });
  if (process.env.GOOGLE_IOS_URL_SCHEME) plugins.push(["@react-native-google-signin/google-signin", { iosUrlScheme: process.env.GOOGLE_IOS_URL_SCHEME }]);
  if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_CLIENT_TOKEN) {
    plugins.push(["react-native-fbsdk-next", {
      appID: process.env.FACEBOOK_APP_ID,
      clientToken: process.env.FACEBOOK_CLIENT_TOKEN,
      displayName: config.name ?? "iSpy a Spy",
      scheme: `fb${process.env.FACEBOOK_APP_ID}`,
      advertiserIDCollectionEnabled: false,
      autoLogAppEventsEnabled: false,
      isAutoInitEnabled: true,
    }]);
  }
  return {
    ...config,
    plugins,
    extra: { ...(config.extra ?? {}), auth: { facebookAppId: process.env.FACEBOOK_APP_ID ?? null, googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? null } },
  };
};
