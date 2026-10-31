// Painted art for the chiefs, factions and splash. Portraits and emblems are keyed by faction id.
export const ART = {
  icon: require("../assets/art/icon.png"),
  splash: require("../assets/art/splash.jpg"),
  portrait: {
    raven: require("../assets/art/oracle.jpg"),
    phantom: require("../assets/art/ghost.jpg"),
    cipher: require("../assets/art/nexus.jpg"),
  } as Record<string, number>,
  // Mission-card art by template; the package art also fronts dead drops in the inventory.
  mission: {
    RECON: require("../assets/art/mission-recon.jpg"),
    DEAD_DROP: require("../assets/art/mission-drop.jpg"),
    EXTRACTION: require("../assets/art/mission-extraction.jpg"),
    ANALYSIS: require("../assets/art/mission-intercept.jpg"),
    CIPHER: require("../assets/art/mission-intercept.jpg"),
  } as Record<string, number>,
  emblem: {
    raven: require("../assets/art/emblem-raven.jpg"),
    phantom: require("../assets/art/emblem-phantom.jpg"),
    cipher: require("../assets/art/emblem-cipher.jpg"),
  } as Record<string, number>,
};
