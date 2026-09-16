// Capture the two payloads the crop bake enumerates from.
//
//   node tests/fixtures/bake/capture.mjs
//
// Both are what the fork's own extractor reads out of the game's bundle — the mutation
// table (with the `group` field that says which mutations can be worn together) and the
// plant records (with the art each crop type wears its mutations on). Running the
// extractor rather than hand-copying a JSON keeps the fixture on the same code path the
// server uses, so a fixture that no longer matches what the extractor produces shows up
// as a diff in the capture, not as a test that passes against a stale shape.
//
// Needs the live game (magicgarden.gg): the bundle and its chunks.
import fs from "node:fs/promises";
import { gameDataService } from "../../../src/services/gameData.js";
import { fetchGameVersion } from "../../../src/core/game/version.js";

const OUT = new URL("./", import.meta.url);

const gameVersion = await fetchGameVersion();
const mutations = await gameDataService.getMutations();
const plants = await gameDataService.getPlants();

await fs.writeFile(new URL("mutations.json", OUT), JSON.stringify(mutations, null, 1) + "\n");
await fs.writeFile(new URL("plants.json", OUT), JSON.stringify(plants, null, 1) + "\n");

// The mutation space: one choice per category including "none".
const groups = new Map();
for (const [id, rec] of Object.entries(mutations)) {
  const g = rec?.group;
  if (!g) continue;
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(id);
}
let sets = 1;
for (const [g, list] of groups) {
  console.log(`group ${g}: ${list.length} [${list.join(", ")}]`);
  sets *= list.length + 1;
}

// The crop types: the art each species wears its mutations on — the patch art when the
// plant is single-harvest, its crop art otherwise. Same rule as
// tests/fixtures/sprites/capture.mjs, which is where the frozen dimensions come from.
const types = [];
for (const [species, rec] of Object.entries(plants)) {
  const artKey = rec.plant?.harvestType === "Single" ? rec.plant?.sprite : rec.crop?.sprite;
  if (!artKey) continue;
  types.push([species, artKey, rec.plant?.harvestType ?? null]);
}

console.log(`\ngame version ${gameVersion}`);
console.log(`mutations ${Object.keys(mutations).length} in ${groups.size} groups -> ${sets} sets`);
console.log(`crop types ${types.length} -> ${types.length * sets} pictures`);
console.log("\n// species, art, harvestType:\n" + types.map((t) => `//   ${t.join("  ")}`).join("\n"));
