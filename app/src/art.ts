// Painted art for the chiefs, factions and splash. Portraits and emblems are keyed by faction id.
export const ART = {
  icon: require("../assets/art/icon.png"),
  splash: require("../assets/art/splash.jpg"),
  portrait: {
    raven: require("../assets/art/oracle.jpg"),
    phantom: require("../assets/art/ghost.jpg"),
    cipher: require("../assets/art/nexus.jpg"),
  } as Record<string, number>,
  emblem: {
    raven: require("../assets/art/emblem-raven.jpg"),
    phantom: require("../assets/art/emblem-phantom.jpg"),
    cipher: require("../assets/art/emblem-cipher.jpg"),
  } as Record<string, number>,
};
