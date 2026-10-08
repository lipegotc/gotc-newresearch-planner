import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPlan, buildMultiPlan, calculateCosts, calculateTreeCosts, resourceShortfalls, valueAt, researchReference, referenceTotals } from "./web/model.mjs";
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
assert.equal(migrated.boosts["Military III"].efficiencies.Food, 72);
assert.equal(migrated.boosts["Military III"].sharedEfficiency, 149);
const legacyBackup = JSON.parse(readFileSync(new URL("./test-fixtures/legacy-progress.json", import.meta.url), "utf8"));
const imported = normalizeProgress(legacyBackup.progress, data.research, data.resources);
assert.equal(imported.goals[0].level, 5);
assert.equal(imported.levels[imported.goals[0].id], 2);
assert.equal(imported.boosts["Military III"].reductions.Food, 24.22);
assert.equal(imported.boosts["Military III"].efficiencies.Food, 12.5);
const reset = normalizeProgress(JSON.parse(JSON.stringify(resetCalculation(imported))), data.research, data.resources);
assert.deepEqual(reset.goals, []);
assert.deepEqual(reset.boosts["Military III"].efficiencies, {});
assert.deepEqual(reset.boosts["Military III"].reductions, {});
assert.equal(reset.boosts["Military III"].sharedEfficiency, 0);
assert.deepEqual(reset.levels, imported.levels);
assert.equal(reset.maester, imported.maester);
assert.equal(imported.goals.length, 1, "reset must not mutate the existing profile");
const invalid = normalizeProgress({ goals: [{ id: defense.id, level: 99 }, { id: "unknown", level: 2 }], levels: { [defense.id]: -2, bad: 15 }, reductions: { Food: 200 }, efficiencies: { Food: Infinity }, maester: 45 }, data.research, data.resources);
assert.equal(invalid.goals.length, 1);
assert.equal(invalid.goals[0].level, 15);
assert.equal(invalid.levels[defense.id], 0);
assert.equal(invalid.levels.bad, undefined);
assert.equal(invalid.boosts["Military III"].reductions.Food, 100);
assert.equal(invalid.boosts["Military III"].efficiencies.Food, 0);
assert.equal(invalid.maester, 40);

for (const [text, expected] of [["24.22",24.22],["24,22",24.22],[".5",0.5],[",5",0.5],["72.",72],["72,",72],["0.005",0.005],[" 12,5 ",12.5]]) {
  assert.equal(parseBoostInput(text), expected);
}
for (const text of ["", ".", ",", "12,3.4", "12..5", "abc", "Infinity", "1e3", "-5"]) assert.equal(parseBoostInput(text), null);
const decimalCosts = calculateCosts(firstPlan, ["Food"], {Food:parseBoostInput("12,5")}, {Food:parseBoostInput("24.22")}, parseBoostInput("60,5"));
assert.equal(decimalCosts[0].reduced, first.costs.Food[0] * (1 - 24.22 / 100) / (1 + (12.5 + 60.5) / 100));

console.log("Data integrity, calculator, requirement, and saved-progress checks passed for all 83 researches.");

// Different tree boosts must apply to prerequisites and goals before totals are added.
const treeProfile = normalizeProgress({schemaVersion:3, boostTree:"Dragon Combat", boosts:{
  "Military III":{efficiencies:{Food:25, "Dragon Lore":99}, reductions:{Food:20}, sharedEfficiency:75},
  "Dragon Combat":{efficiencies:{Food:50,"Dragon Lore":100}, reductions:{Food:10,"Dragon Lore":25}, sharedEfficiency:0}
}}, data.research, data.resources);
assert.equal(treeProfile.boosts["Military III"].efficiencies["Dragon Lore"], undefined);
assert.equal(treeProfile.boosts["Dragon Combat"].efficiencies["Dragon Lore"], 100);
const treeTotals = calculateTreeCosts(bothTrees, data.resources, treeProfile.boosts);
for (const cost of treeTotals) {
  let expected = 0;
  let original = 0;
  for (const tree of ["Military III","Dragon Combat"]) {
    const profile = treeProfile.boosts[tree];
    const separate = calculateCosts(bothTrees.filter(step=>step.item.tree===tree), [cost.resource], profile.efficiencies, profile.reductions, profile.sharedEfficiency)[0];
    expected += separate.reduced;
    original += separate.original;
  }
  assert.equal(cost.reduced, expected);
  assert.equal(cost.original, original);
}
const militaryOriginal = calculateCosts(bothTrees.filter(step=>step.item.tree==="Military III"),["Food"])[0].original;
const dragonOriginal = calculateCosts(bothTrees.filter(step=>step.item.tree==="Dragon Combat"),["Food"])[0].original;
assert.equal(treeTotals.find(cost=>cost.resource==="Food").reduced, militaryOriginal*0.8/2+dragonOriginal*0.9/1.5);
assert.deepEqual(normalizeProgress(JSON.parse(JSON.stringify(treeProfile)), data.research, data.resources), treeProfile);
const updatedDragon = {...treeProfile.boosts, "Dragon Combat":{...treeProfile.boosts["Dragon Combat"], reductions:{Food:100}}};
assert.equal(calculateTreeCosts(bothTrees,["Food"],updatedDragon)[0].reduced, militaryOriginal*0.8/2);
for (const tree of ["Military III","Dragon Combat"]) {
  assert.equal(imported.boosts[tree].reductions.Food,24.22);
  assert.deepEqual(resetCalculation(treeProfile).boosts[tree], {efficiencies:{},reductions:{},sharedEfficiency:0,sharedReduction:0});
}
assert.notEqual(imported.boosts["Military III"].efficiencies, imported.boosts["Dragon Combat"].efficiencies);
const v2 = normalizeProgress({schemaVersion:2,tab:"help", efficiencies:{"Dragon Lore":30},sharedEfficiency:50},data.research,data.resources);
assert.equal(v2.tab,"help");
assert.equal(v2.boosts["Military III"].efficiencies["Dragon Lore"],undefined);
assert.equal(v2.boosts["Dragon Combat"].efficiencies["Dragon Lore"],30);
assert.equal(normalizeProgress({schemaVersion:3, efficiencies:{Food:99}},data.research,data.resources).boosts["Military III"].efficiencies.Food,undefined);
console.log("Separate tree boosts, mixed-tree costs, migration, persistence, and reset checks passed.");

for (const tree of ['Military III','Dragon Combat']) {
  const reference = researchReference(data.research,data.resources,tree);
  assert.equal(reference.rows.length,data.research.filter(item=>item.tree===tree).length*15);
  for (const row of reference.rows) {
    assert.equal(row.cumulative, row.level ? row.property.values[row.level-1] : 0);
    assert.equal(row.gain, row.cumulative-(row.level>1 ? row.property.values[row.level-2] : 0));
    reference.materials.forEach((resource,index)=>assert.equal(row.costs[index],row.level ? row.item.costs[resource]?.[row.level-1]||0 : 0));
  }
  assert.equal(reference.materials.includes('Dragon Tomes'),tree==='Dragon Combat');
  assert.equal(reference.materials.includes('Dragon Lore'),tree==='Dragon Combat');
  assert.equal(reference.materials.includes('Dragon Secrets'),tree==='Dragon Combat');
}
const filteredReference = researchReference(data.research,data.resources,'Military III','Infantry','attack');
assert.ok(filteredReference.rows.length>0);
assert.ok(filteredReference.rows.every(row=>['Infantry','General'].includes(row.property.scope)));
assert.equal(researchReference(data.research,data.resources,'Dragon Combat','all','no such research').rows.length,0);
assert.equal(normalizeProgress({referenceTree:'Dragon Combat'},data.research,data.resources).referenceTree,'Dragon Combat');
console.log('Reference level costs, stat gains, tree materials, and filter checks passed.');

// Full-tree totals equal every original rank exactly once.
for (const tree of ['Military III','Dragon Combat']) {
  const all = referenceTotals(data.research,data.resources,tree);
  assert.equal(all.prerequisites.length,0);
  for (const cost of all.costs) assert.equal(cost.original,data.research.filter(item=>item.tree===tree)
    .reduce((sum,item)=>sum+(item.costs[cost.resource]||[]).reduce((a,b)=>a+b,0),0));
  for (const scope of ['Infantry','Cavalry','Ranged','General']) {
    const total = referenceTotals(data.research,data.resources,tree,scope);
    assert.equal(new Set(total.plan.map(step=>step.item.id)).size,total.plan.length);
    assert.ok(total.goals.every(goal=>data.research.find(item=>item.id===goal.id).properties.some(prop=>prop.scope===scope||prop.scope==='General')));
    assert.ok(total.plan.some(step=>step.item.name.includes('March Size')&&step.desired===15));
    for (const step of total.plan) for (const req of step.item.requires) assert.ok(total.plan.find(other=>other.item.id===req.id).desired>=req.level);
  }
}
const scopeFixture = [sample('unlock'),sample('infantry',[{id:'unlock',level:4}]),sample('march',[{id:'unlock',level:2}])];
scopeFixture[0].properties[0].scope='Cavalry';
scopeFixture[1].properties[0].scope='Infantry';
scopeFixture[2].properties[0].scope='General';
const scopedTotal=referenceTotals(scopeFixture,['Food'],'Military III','Infantry');
assert.deepEqual(scopedTotal.goals.map(goal=>goal.id),['infantry','march']);
assert.equal(scopedTotal.prerequisites[0].desired,4);
assert.equal(scopedTotal.costs[0].original,340);
assert.ok(researchReference(data.research,data.resources,'Military III').rows.every(row=>row.level>=1));
console.log('Reference totals include General research, march sizes, minimum prerequisites, and no duplicate costs.');

const reductionPlan=[{item:{tree:'Military III',costs:{Food:[1000],Wood:[1000],Stone:[1000],Iron:[1000],'Dragon Tomes':[1000]}},missing:[1]}];
const reducedResources=calculateCosts(reductionPlan,['Food','Wood','Stone','Iron','Dragon Tomes'],{Food:20},{Food:10,'Dragon Tomes':10},30,25);
assert.equal(reducedResources[0].reduced,1000*0.65/1.5);
for (const cost of reducedResources.slice(1,4)) assert.equal(cost.reduced,1000*0.75/1.3);
assert.equal(reducedResources[4].reduced,900);
assert.equal(calculateCosts(reductionPlan,['Food'],{}, {Food:80},0,30)[0].reduced,0);
const reducedProfile=normalizeProgress({schemaVersion:3,boosts:{'Military III':{sharedReduction:12.5},'Dragon Combat':{sharedReduction:35.25}}},data.research,data.resources);
assert.deepEqual(normalizeProgress(JSON.parse(JSON.stringify(reducedProfile)),data.research,data.resources),reducedProfile);
const mixedReductionPlan=[...reductionPlan,{...reductionPlan[0],item:{...reductionPlan[0].item,tree:'Dragon Combat'}}];
assert.equal(calculateTreeCosts(mixedReductionPlan,['Food'],reducedProfile.boosts)[0].reduced,875+647.5);
for (const tree of ['Military III','Dragon Combat']) {
 assert.equal(imported.boosts[tree].sharedReduction,0);
 assert.equal(resetCalculation(reducedProfile).boosts[tree].sharedReduction,0);
}
assert.equal(normalizeProgress({schemaVersion:3,boosts:{'Military III':{sharedReduction:999},'Dragon Combat':{sharedReduction:-5}}},data.research,data.resources).boosts['Military III'].sharedReduction,100);
console.log('Research Resource Reduction: additive base resources, material exclusion, cap, tree isolation, backups, and reset passed.');

// Inventory is a single pool for the combined plan, never applied per goal or tree.
const inventoryProfile = normalizeProgress({schemaVersion:3, inventory:{Food:100, Wood:-4, Iron:'bad', 'Dragon Tomes':15, unknown:123}}, data.research, data.resources);
assert.deepEqual(inventoryProfile.inventory, {Food:100, Wood:0, Iron:0, 'Dragon Tomes':15});
assert.deepEqual(normalizeProgress(null,data.research,data.resources).inventory, {});
assert.deepEqual(normalizeProgress(JSON.parse(JSON.stringify(inventoryProfile)),data.research,data.resources),inventoryProfile);
assert.deepEqual(resetCalculation(inventoryProfile).inventory,inventoryProfile.inventory);
const shortages = resourceShortfalls([{resource:'Food',original:1000,reduced:100.25},{resource:'Wood',original:200,reduced:50},{resource:'Iron',original:100,reduced:0}],{Food:100,Wood:999,Iron:20});
assert.equal(shortages[0].missing,0.25);
assert.equal(Math.ceil(shortages[0].missing),1);
assert.equal(shortages[1].missing,0);
assert.equal(shortages[2].missing,0);
assert.equal(resourceShortfalls([{resource:'Food',reduced:55}])[0].missing,55);
const mixedShortfall=resourceShortfalls(treeTotals,{Food:1000}).find(cost=>cost.resource==='Food');
assert.equal(mixedShortfall.missing,Math.max(0,treeTotals.find(cost=>cost.resource==='Food').reduced-1000));
assert.equal(resourceShortfalls([{resource:'Food',reduced:0}],{Food:500})[0].missing,0);
console.log('Inventory: migration, validation, backup round-trip, reset retention, shared mixed-tree pool, fractional shortfalls, and zero floor passed.');
