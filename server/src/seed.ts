import { db, run, get, worldSet } from "./db.ts";

// Pilot area: Cubbon Park, Bengaluru. Targets are public, open-air spots inside the park.
// Coordinates are approximate and must be site-checked before any real play.
const AREAS = [
  { id: "blr-cubbon", name: "Cubbon Park", city: "Bengaluru", lat: 12.9763, lng: 77.5929, radius_m: 1400, merge_group: "blr-central" },
];

const TARGETS = [
  { id: "t-bandstand", area: "blr-cubbon", name: "The Bandstand", kind: "landmark", lat: 12.9757, lng: 77.5952, obs: "How many sides does the bandstand roof have?", ans: "8" },
  { id: "t-library", area: "blr-cubbon", name: "Seshadri Iyer Library steps", kind: "landmark", lat: 12.9768, lng: 77.5934, obs: "What colour is the library building?", ans: "RED" },
  { id: "t-statue", area: "blr-cubbon", name: "Queen Victoria statue", kind: "landmark", lat: 12.9786, lng: 77.5967, obs: "Which way does the statue face: towards the road or the park?", ans: "ROAD" },
  { id: "t-bamboo", area: "blr-cubbon", name: "Bamboo grove", kind: "park", lat: 12.9741, lng: 77.5921, obs: "Enter the code painted on the nearest lamppost (dev: 7421).", ans: "7421" },
  { id: "t-lotus", area: "blr-cubbon", name: "Lotus pond", kind: "park", lat: 12.9735, lng: 77.5944, obs: "How many benches face the pond on the north side?", ans: "4" },
  { id: "t-gate", area: "blr-cubbon", name: "Hudson Circle gate", kind: "entrance", lat: 12.9724, lng: 77.5905, obs: "What is the gate number on the sign?", ans: "3" },
  { id: "t-aquarium", area: "blr-cubbon", name: "Aquarium forecourt", kind: "landmark", lat: 12.9777, lng: 77.5898, obs: "Enter the dev code 2206.", ans: "2206" },
  { id: "t-tennis", area: "blr-cubbon", name: "Tennis pavilion", kind: "park", lat: 12.9799, lng: 77.5930, obs: "How many courts are visible?", ans: "6" },
  { id: "t-rose", area: "blr-cubbon", name: "Rose garden", kind: "park", lat: 12.9751, lng: 77.5971, obs: "Enter the dev code 5150.", ans: "5150" },
  { id: "t-chamarajendra", area: "blr-cubbon", name: "Chamarajendra statue", kind: "landmark", lat: 12.9772, lng: 77.5915, obs: "Is the figure on horseback? (YES/NO)", ans: "YES" },
];

export function seed({ reset = false } = {}) {
  if (reset) {
    db.exec(`DELETE FROM missions; DELETE FROM offers; DELETE FROM desk_links; DELETE FROM presence;
      DELETE FROM area_plans; DELETE FROM events; DELETE FROM scans; DELETE FROM chat;
      DELETE FROM players; DELETE FROM sessions; DELETE FROM assessments; DELETE FROM targets; DELETE FROM areas;`);
  }
  for (const a of AREAS) {
    run("INSERT OR REPLACE INTO areas(id,name,city,lat,lng,radius_m,merge_group) VALUES(?,?,?,?,?,?,?)",
      a.id, a.name, a.city, a.lat, a.lng, a.radius_m, a.merge_group);
  }
  for (const t of TARGETS) {
    run(`INSERT OR REPLACE INTO targets(id,area_id,name,kind,lat,lng,approach_radius_m,safe_start,safe_end,capacity,state,observation,observation_answer)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      t.id, t.area, t.name, t.kind, t.lat, t.lng, 45, 6, 21, 4, "ACTIVE", t.obs, t.ans);
  }
  if (!get("SELECT 1 FROM world WHERE key='paused'")) worldSet("paused", "0");
}

if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
  seed({ reset: process.argv.includes("--reset") });
  console.log("seeded", AREAS.length, "area(s),", TARGETS.length, "targets");
}
