import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPlan, buildMultiPlan, calculateCosts, valueAt } from "./web/model.mjs";
import { normalizeProgress, toggleRequirement, setCompletedLevel, resetCalculation, parseBoostInput } from "./web/progress.mjs";

const data = JSON.parse(readFileSync(new URL("./web/data/research.json", import.meta.url), "utf8"));
assert.equal(data.research.length, 83);
assert.equal(data.research.filter(item => item.tree === "Military III").length, 54);
assert.equal(data.research.filter(item => item.tree === "Dragon Combat").length, 29);

for (const item of data.research) {
  assert.equal(item.maester.length, 15);
  assert.ok(item.maester.every(level => level >= 1 && level <= 40));
  for (const entries of Object.values(item.costs)) assert.equal(entries.length, 15);
  for (const property of item.properties) assert.equal(property.values.length, 15);
  const plan = buildPlan(data.research, item.id, 15, {});
  assert.equal(new Set(plan.map(step => step.item.id)).size, plan.length);
  assert.ok(plan.find(step => step.item.id === item.id));
  const costs = calculateCosts(plan, data.resources);
  for (const cost of costs) assert.ok(cost.original >= 0 && cost.reduced >= 0);
}

const first = data.research.find(item => item.tree === "Military III" && item.requires.length === 0);
const firstPlan = buildPlan(data.research, first.id, 1, {});
assert.equal(firstPlan.length, 1);
assert.equal(calculateCosts(firstPlan, ["Food"])[0].original, first.costs.Food[0]);
assert.equal(valueAt(first.properties[0].values, 0), 0);
assert.equal(valueAt(first.properties[0].values, 15), first.properties[0].values[14]);
assert.equal(buildPlan(data.research, first.id, 1, { [first.id]: 1 })[0].missing.length, 0);

const discounted = calculateCosts(firstPlan, ["Food", "Pale Steel"], { Food: 50, "Pale Steel": 100 }, { Food: 20, "Pale Steel": 20 }, 50);
assert.equal(discounted[0].efficiency, 100);
assert.equal(discounted[0].reduced, first.costs.Food[0] * 0.8 / 2);
assert.equal(discounted[1].efficiency, 100);

const defense = data.research.find(item => item.tree === "Military III" && item.name === "Troop Defense I");
const health = data.research.find(item => item.tree === "Military III" && item.name === "Troop Health I");
const combined = buildMultiPlan(data.research, [{ id: defense.id, level: 5 }, { id: health.id, level: 7 }], {});
assert.equal(combined.length, 3, "shared prerequisite should appear once");
assert.equal(combined.find(step => step.item.id === first.id).desired, 1);
assert.equal(calculateCosts(combined, ["Food"])[0].original,
  first.costs.Food[0] + defense.costs.Food.slice(0, 5).reduce((a, b) => a + b, 0) + health.costs.Food.slice(0, 7).reduce((a, b) => a + b, 0));
const bothTrees = buildMultiPlan(data.research, [{ id: defense.id, level: 1 }, { id: data.research.find(item => item.tree === "Dragon Combat").id, level: 1 }], {});
assert.ok(bothTrees.some(step => step.item.tree === "Military III"));
assert.ok(bothTrees.some(step => step.item.tree === "Dragon Combat"));
assert.equal(buildMultiPlan(data.research, [], {}).length, 0);

// A completed rank proves that research was unlocked; don't charge its ancestors.
const unlocked = buildPlan(data.research, defense.id, 5, { [defense.id]: 2 });
assert.deepEqual(unlocked.map(step => step.item.id), [defense.id]);
assert.equal(calculateCosts(unlocked, ["Food"])[0].original,
  defense.costs.Food.slice(2, 5).reduce((a, b) => a + b, 0));
const completed = buildPlan(data.research, defense.id, 5, { [defense.id]: 7 });
assert.equal(calculateCosts(completed, ["Food"])[0].original, 0);
assert.equal(completed[0].gains[0].amount, 0);
assert.equal(completed[0].maesterNeeded, 0);

// Use a multi-rank synthetic requirement to test partial completion and branch pruning.
const sample = (id, requires = []) => ({ id, name: id, requires, tree: "Military III", row: 1, column: 2, maxLevel: 15,
  maester: Array.from({ length: 15 }, (_, i) => i + 10), costs: { Food: Array(15).fill(10) },
  properties: [{ raw: "attack", name: "Attack", unit: "percent", values: Array.from({ length: 15 }, (_, i) => (i + 1) / 100) }] });
const fixture = [sample("a"), sample("b", [{ id: "a", level: 1 }]), sample("c", [{ id: "b", level: 4 }]), sample("d", [{ id: "b", level: 7 }])];
const fixtureGoals = [{ id: "c", level: 3 }, { id: "d", level: 2 }];
const partialPlan = buildMultiPlan(fixture, fixtureGoals, { b: 2 });
assert.ok(!partialPlan.some(step => step.item.id === "a"));
assert.equal(partialPlan.find(step => step.item.id === "b").desired, 7);
assert.equal(calculateCosts(partialPlan, ["Food"])[0].original, 100);

// Completion toggles undo exactly, including after serialization and a reload.
let profile = normalizeProgress({ goals: fixtureGoals, levels: { b: 2 }, maester: 15 }, fixture, ["Food"]);
profile = toggleRequirement(profile, "b", 7, true);
assert.equal(profile.levels.b, 7);
assert.equal(calculateCosts(buildMultiPlan(fixture, profile.goals, profile.levels), ["Food"])[0].original, 50);
profile = normalizeProgress(JSON.parse(JSON.stringify(profile)), fixture, ["Food"]);
profile = toggleRequirement(profile, "b", 7, false);
assert.equal(profile.levels.b, 2);
assert.equal(calculateCosts(buildMultiPlan(fixture, profile.goals, profile.levels), ["Food"])[0].original, 100);
profile = toggleRequirement(profile, "b", 7, true);
profile = setCompletedLevel(profile, "b", 3);
assert.equal(profile.markHistory.b, undefined);
assert.equal(toggleRequirement(profile, "b", 7, false).levels.b, 0);

const migrated = normalizeProgress({ tab: "tree", target: defense.id, desired: 5, levels: { [defense.id]: 2 }, sharedEfficiency: 149, efficiencies: { Food: 72 }, reductions: { Food: 20 } }, data.research, data.resources);
assert.equal(migrated.tab, "calculator");
assert.deepEqual(migrated.goals, [{ id: defense.id, level: 5 }]);
assert.equal(migrated.levels[defense.id], 2);
assert.equal(migrated.efficiencies.Food, 72);
assert.equal(migrated.sharedEfficiency, 149);
const legacyBackup = JSON.parse(readFileSync(new URL("./test-fixtures/legacy-progress.json", import.meta.url), "utf8"));
const imported = normalizeProgress(legacyBackup.progress, data.research, data.resources);
assert.equal(imported.goals[0].level, 5);
assert.equal(imported.levels[imported.goals[0].id], 2);
assert.equal(imported.reductions.Food, 24.22);
assert.equal(imported.efficiencies.Food, 12.5);
const reset = normalizeProgress(JSON.parse(JSON.stringify(resetCalculation(imported))), data.research, data.resources);
assert.deepEqual(reset.goals, []);
assert.deepEqual(reset.efficiencies, {});
assert.deepEqual(reset.reductions, {});
assert.equal(reset.sharedEfficiency, 0);
assert.deepEqual(reset.levels, imported.levels);
assert.equal(reset.maester, imported.maester);
assert.equal(imported.goals.length, 1, "reset must not mutate the existing profile");
const invalid = normalizeProgress({ goals: [{ id: defense.id, level: 99 }, { id: "unknown", level: 2 }], levels: { [defense.id]: -2, bad: 15 }, reductions: { Food: 200 }, efficiencies: { Food: Infinity }, maester: 45 }, data.research, data.resources);
assert.equal(invalid.goals.length, 1);
assert.equal(invalid.goals[0].level, 15);
assert.equal(invalid.levels[defense.id], 0);
assert.equal(invalid.levels.bad, undefined);
assert.equal(invalid.reductions.Food, 100);
assert.equal(invalid.efficiencies.Food, 0);
assert.equal(invalid.maester, 40);

for (const [text, expected] of [["24.22",24.22],["24,22",24.22],[".5",0.5],[",5",0.5],["72.",72],["72,",72],["0.005",0.005],[" 12,5 ",12.5]]) {
  assert.equal(parseBoostInput(text), expected);
}
for (const text of ["", ".", ",", "12,3.4", "12..5", "abc", "Infinity", "1e3", "-5"]) assert.equal(parseBoostInput(text), null);
const decimalCosts = calculateCosts(firstPlan, ["Food"], {Food:parseBoostInput("12,5")}, {Food:parseBoostInput("24.22")}, parseBoostInput("60,5"));
assert.equal(decimalCosts[0].reduced, first.costs.Food[0] * (1 - 24.22 / 100) / (1 + (12.5 + 60.5) / 100));

console.log("Data integrity, calculator, requirement, and saved-progress checks passed for all 83 researches.");
