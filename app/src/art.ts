// Painted art for the chiefs, factions and splash. Portraits and emblems are keyed by faction id.
export const ART = {
  icon: require("../assets/art/icon.png"),
  splash: require("../assets/art/splash.jpg"),
  // The opening story, in order: Earth 686, chaos, everyone targeted, secrets, the entity, the heroes.
  story: {
    earth: require("../assets/art/story-1.jpg"),
    chaos: require("../assets/art/story-2.jpg"),
    targeted: require("../assets/art/story-3.jpg"),
    secrets: require("../assets/art/story-4.jpg"),
    entity: require("../assets/art/story-5.jpg"),
    heroes: require("../assets/art/story-6.jpg"),
  },
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
  // Tool icons for the dial and the toolkit; black backgrounds so they sit on the HUD as objects.
  tool: {
    cipher_kit: require("../assets/art/tool-cipher_kit.jpg"),
    fragment: require("../assets/art/tool-fragment.jpg"),
    key: require("../assets/art/tool-key.jpg"),
    lens: require("../assets/art/tool-lens.jpg"),
    jammer: require("../assets/art/tool-jammer.jpg"),
    tracker: require("../assets/art/tool-tracker.jpg"),
    decoy: require("../assets/art/tool-decoy.jpg"),
    burner: require("../assets/art/tool-burner.jpg"),
  } as Record<string, number>,
  // What you find: painted objects for AR scan (by mission template, crisis sites get the canister)...
  pkg: {
    DEAD_DROP: require("../assets/art/pkg-drop.jpg"),
    RECON: require("../assets/art/pkg-recon.jpg"),
    EXTRACTION: require("../assets/art/pkg-extraction.jpg"),
    CRISIS: require("../assets/art/pkg-crisis.jpg"),
  } as Record<string, number>,
  // ...and the signal objects for captures, the tracker and the collection.
  signal: {
    courier: require("../assets/art/sig-courier.jpg"),
    leak: require("../assets/art/sig-leak.jpg"),
    bug: require("../assets/art/sig-bug.jpg"),
    broker: require("../assets/art/sig-broker.jpg"),
    asset: require("../assets/art/sig-asset.jpg"),
    jammer: require("../assets/art/sig-jammer.jpg"),
  } as Record<string, number>,
  // Archive artifacts: what the agency keeps.
  artifact: {
    page: require("../assets/art/art-page.jpg"),
    strip: require("../assets/art/art-strip.jpg"),
    map: require("../assets/art/art-map.jpg"),
    card: require("../assets/art/art-card.jpg"),
    key: require("../assets/art/art-key.jpg"),
    identity: require("../assets/art/art-identity.jpg"),
    device: require("../assets/art/art-device.jpg"),
    forgery: require("../assets/art/art-forgery.jpg"),
  } as Record<string, number>,
  emblem: {
    raven: require("../assets/art/emblem-raven.jpg"),
    phantom: require("../assets/art/emblem-phantom.jpg"),
    cipher: require("../assets/art/emblem-cipher.jpg"),
  } as Record<string, number>,
};
