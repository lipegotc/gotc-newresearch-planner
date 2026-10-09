import {statIconNames, statLabel, marchSizeNotice} from './web/stat-icons.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import loadHighs from './web/vendor/highs/highs.mjs';
import {normalizeProgress, resetCalculation} from './web/progress.mjs';
import {solveOptimization, evaluateOptimization, objectiveProperties, optimizerBudgets, compileOptimization} from './web/optimizer.mjs';

const highs = await loadHighs();
const resources = ['Food','Wood','Pale Steel'];
function sample(id, raw, costs, requires = [], tree = 'Military III') {
  return {id, name:id, tree, maxLevel:3, row:0, column:0, maester:[1,2,3], requires,
    costs:{Food:costs, Wood:costs.map(value => value * 2), 'Pale Steel':[0,1,2]},
    properties:[{raw, name:raw, scope:'General', unit:'percent', values:[0.01,0.03,0.08]}]};
}
const research = [
  sample('attack-I','troop-attack',[4,8,15]),
  sample('gate','troop-defense',[2,3,5],[{id:'attack-I',level:1}]),
  sample('attack-II','troop-attack',[9,3,12],[{id:'gate',level:2}]),
  sample('infantry','infantry-attack',[6,7,14],[{id:'attack-I',level:2}]),
];
const data = {research, resources};
function input(overrides = {}) {
  return normalizeProgress({schemaVersion:5, maester:3, optimizer:{tree:'Military III', group:'Infantry', goal:'Attack'},
    inventory:{Food:60,Wood:120,'Pale Steel':20}, ...overrides}, research, resources);
}

// Enumerate every final level combination independently of the MILP model.
function bruteForce(state) {
  let best = 0;
  for (let a = 0; a <= 3; a++) for (let b = 0; b <= 3; b++) for (let c = 0; c <= 3; c++) for (let d = 0; d <= 3; d++) {
    const ranks = [a,b,c,d];
    if (ranks.some((level,index) => level < (state.levels[research[index].id] || 0))) continue;
    const goals = ranks.map((level,index) => ({id:research[index].id,level})).filter(goal => goal.level > (state.levels[goal.id] || 0));
    try {
      const result = evaluateOptimization(data, state, goals);
      best = Math.max(best, result.objective);
    } catch { /* Reject combinations outside the independently checked budgets/building. */ }
  }
  return best;
}

for (const food of [0,6,12,25,45,70]) {
  const state = input({inventory:{Food:food,Wood:food * 2,'Pale Steel':8}});
  const solved = solveOptimization(data,state,highs,5);
  assert.equal(solved.status,'Optimal');
  assert.ok(Math.abs(solved.objective - bruteForce(state)) < 1e-10, `Wrong gain at Food budget ${food}`);
  assert.ok(solved.costs.every(cost => cost.reduced <= cost.budget + 1e-5));
  assert.equal(new Set(solved.steps.map(step=>step.item.id)).size,solved.steps.length);
  for (const [index, step] of solved.steps.entries()) {
    if (step.current > 0) continue;
    for (const req of step.item.requires) {
      if ((state.levels[req.id] || 0) >= req.level) continue;
      assert.ok(solved.steps.slice(0,index).some(parent=>parent.item.id===req.id&&parent.desired>=req.level));
    }
  }
}
for (const state of [
  input({maester:1}),
  input({levels:{'attack-II':1},inventory:{Food:20,Wood:40,'Pale Steel':10}}),
  input({inventory:{Food:50,Wood:10,'Pale Steel':20}}),
  input({inventory:{Food:50,Wood:100,'Pale Steel':0}}),
  input({optimizer:{tree:'Military III',group:'Infantry',goal:'Attack',kept:{Food:40,Wood:10}}}),
  input({boosts:{'Military III':{sharedEfficiency:33.3,sharedReduction:12.7,efficiencies:{'Pale Steel':50}}}}),
]) {
  const result = solveOptimization(data,state,highs,5);
  assert.ok(Math.abs(result.objective - bruteForce(state)) < 1e-10);
}
const allFree = input({boosts:{'Military III':{sharedReduction:100,reductions:{'Pale Steel':100}}},inventory:{}});
assert.ok(solveOptimization(data,allFree,highs,5).objective > 0);
assert.deepEqual(optimizerBudgets(['Food','Wood'],{Food:101,Wood:100},{Food:2,Wood:100}).map(item=>item.budget),[98,0]);
assert.deepEqual(objectiveProperties('Dragon Combat','Dragon Specific','Dragon Defense'),['dragon-defense']);
assert.deepEqual(objectiveProperties('Dragon Combat','Dragon Specific','Dragon Attack vs. Dragon'),['dragon-attack-vs-dragon']);
assert.ok(!objectiveProperties('Dragon Combat','Infantry','Defense').includes('dragon-defense'));
assert.ok(objectiveProperties('Military III','Infantry','Attack').includes('infantry-attack-vs-seat-of-power'));
assert.ok(!objectiveProperties('Military III','General','Attack').includes('infantry-attack'));

const dragonFixture = {resources, research:[
  sample('unlock','dragon-troop-attack',[4,8,15],[],'Dragon Combat'),
  sample('defense','dragon-defense',[4,8,15],[{id:'unlock',level:1}],'Dragon Combat'),
  sample('dragon-attack','dragon-attack-vs-dragon',[4,8,15],[{id:'unlock',level:1}],'Dragon Combat'),
]};
const dragonInput = normalizeProgress({schemaVersion:5,maester:3,optimizer:{tree:'Dragon Combat',group:'Dragon Specific',goal:'Dragon Defense'},inventory:{Food:31,Wood:62,'Pale Steel':10}},dragonFixture.research,resources);
const dragonResult=solveOptimization(dragonFixture,dragonInput,highs,5);
assert.ok(dragonResult.metrics['Dragon Defense']>0);
assert.equal(dragonResult.metrics['Dragon Attack vs. Dragon'],0);
assert.ok(dragonResult.metrics.Attack>0);

// Existing profiles/backups migrate, while optimizer settings persist independently.
const normalized = input({optimizer:{tree:'Dragon Combat',group:'Dragon Specific',goal:'Dragon Defense',kept:{Food:120,Wood:-1,unknown:5}}});
assert.equal(normalized.optimizer.kept.Food,100);
assert.equal(normalized.optimizer.kept.Wood,0);
assert.equal(normalized.optimizer.kept.unknown,undefined);
assert.deepEqual(normalizeProgress(JSON.parse(JSON.stringify(normalized)),research,resources),normalized);
assert.deepEqual(resetCalculation(normalized).optimizer,normalized.optimizer);
assert.equal(input({optimizer:{tree:'Military III',group:'Dragon Specific',goal:'Dragon Defense'}}).optimizer.group,'Infantry');

const real=JSON.parse(readFileSync('web/data/research.json','utf8'));
for (const [tree,group,goal] of [['Military III','Infantry','Attack'],['Dragon Combat','General','Health'],['Dragon Combat','Dragon Specific','Dragon Attack vs. Dragon']]) {
  const state=normalizeProgress({schemaVersion:5,maester:40,inventory:Object.fromEntries(real.resources.map(resource=>[resource,1e13])),optimizer:{tree,group,goal}},real.research,real.resources);
  const result=solveOptimization(real,state,highs,8);
  const ids=new Set(objectiveProperties(tree,group,goal));
  const expected=real.research.filter(item=>item.tree===tree).reduce((sum,item)=>sum+item.properties.filter(prop=>ids.has(prop.raw)).reduce((total,prop)=>total+prop.values.at(-1),0),0);
  assert.equal(result.status,'Optimal');
  assert.ok(Math.abs(result.objective-expected)<1e-9);
  assert.ok(result.steps.every(step=>step.item.tree===tree));
}
// Compare custom-weight optima with independently scored exhaustive plans.
const mixed = {resources, research:[
  sample('damage','troop-attack',[5,5,5]),
  sample('march','max-march-size',[5,5,5]),
  sample('armor','troop-defense',[5,5,5],[{id:'damage',level:1}]),
]};
mixed.research[1].properties[0].unit = 'count';
mixed.research[1].properties[0].values = [1000,3000,8000];
for (const weights of [{Attack:10,'March Size':1,Defense:2},{Attack:1,'March Size':10,Defense:2},{Attack:2,'March Size':3,Defense:7}]) {
  const state = normalizeProgress({schemaVersion:6,maester:3,inventory:{Food:15,Wood:30,'Pale Steel':20},optimizer:{tree:'Military III',group:'General',comparison:'remaining',goals:['Attack','March Size','Defense'],weights}},mixed.research,resources);
  let expected = 0;
  for(let a=0;a<=3;a++) for(let m=0;m<=3;m++) for(let d=0;d<=3;d++) {
    const ranks=[a,m,d];
    if(d && !a || ranks.reduce((sum,n)=>sum+n,0)>3) continue;
    const values = n => n ? [0.01,0.03,0.08][n-1] : 0;
    const score=weights.Attack*values(a)/0.08+weights['March Size']*values(m)/0.08+weights.Defense*values(d)/0.08;
    expected=Math.max(expected,score);
  }
  const result=solveOptimization(mixed,state,highs,5);
  assert.ok(Math.abs(result.objective-expected)<1e-9);
  if(weights.Attack===10) assert.equal(result.metrics.Attack,0.08);
  if(weights['March Size']===10) assert.equal(result.metrics['March Size'],8000);
}
const limited = normalizeProgress({schemaVersion:6,maester:1,inventory:{Food:15,Wood:30,'Pale Steel':20},optimizer:{tree:'Military III',group:'General',goals:['Attack','March Size']}},mixed.research,resources);
assert.deepEqual(solveOptimization(mixed,limited,highs,5).targets.map(target=>target.remaining),[0.01,1000]);
const weightedDragon=normalizeProgress({...dragonInput,optimizer:{...dragonInput.optimizer,comparison:'remaining',goals:['Dragon Defense','Dragon Attack vs. Dragon'],weights:{'Dragon Defense':2,'Dragon Attack vs. Dragon':1}}},dragonFixture.research,resources);
const combinedDragon=solveOptimization(dragonFixture,weightedDragon,highs,5);
let dragonBest=0;
for(let unlock=0;unlock<=3;unlock++) for(let defense=0;defense<=3;defense++) for(let attack=0;attack<=3;attack++) {
  if((defense||attack)&&!unlock) continue;
  const totalCost = n=>[0,4,12,27][n];
  if(totalCost(unlock)+totalCost(defense)+totalCost(attack)>31) continue;
  const value=n=>[0,0.01,0.03,0.08][n];
  dragonBest=Math.max(dragonBest,2*value(defense)/0.08+value(attack)/0.08);
}
assert.ok(Math.abs(combinedDragon.objective-dragonBest)<1e-9);
assert.deepEqual(dragonInput.optimizer.goals,['Dragon Defense']);
const imported = input({optimizer:{tree:'Military III',group:'General',goals:['Attack','Attack','Health','invalid'],weights:{Attack:999,Health:0}}});
assert.deepEqual(imported.optimizer.goals,['Attack','Health']);
assert.equal(imported.optimizer.weights.Attack,100);
assert.equal(imported.optimizer.weights.Health,1);
assert.deepEqual(normalizeProgress(JSON.parse(JSON.stringify(imported)),research,resources),imported);
for(const tree of ['Military III','Dragon Combat']) {
 const state=normalizeProgress({schemaVersion:6,maester:40,inventory:Object.fromEntries(real.resources.map(resource=>[resource,1e13])),optimizer:{tree,group:'Infantry',comparison:'remaining',goals:['Attack','Defense','Health','March Size'],weights:{Attack:2,Defense:3,Health:4,'March Size':5}}},real.research,real.resources);
 const result=solveOptimization(real,state,highs,8);
 assert.equal(result.status,'Optimal');
 assert.ok(Math.abs(result.objective-14)<1e-8);
 assert.ok(result.targets.every(target=>Math.abs(result.metrics[target.goal]-target.remaining)<1e-9));
}
// Different remaining totals must produce different choices for the same weights.
const choices={resources,research:[sample('attack','troop-attack',[5,5,5]),sample('defense','troop-defense',[5,5,5])]};
choices.research[0].properties[0].values=[0.04,0.1,0.2];
choices.research[1].properties[0].values=[0.01,0.015,0.02];
const choiceState=normalizeProgress({schemaVersion:8,maester:3,inventory:{Food:5,Wood:10,'Pale Steel':20},optimizer:{tree:'Military III',group:'General',goals:['Attack','Defense'],weights:{Attack:1,Defense:3}}},choices.research,resources);
const plain=solveOptimization(choices,choiceState,highs,5);
const relative=solveOptimization(choices,{...choiceState,optimizer:{...choiceState.optimizer,comparison:'remaining'}},highs,5);
assert.equal(plain.metrics.Attack,0.04);
assert.equal(plain.metrics.Defense,0);
assert.equal(plain.objective,4);
assert.equal(relative.metrics.Attack,0);
assert.equal(relative.metrics.Defense,0.01);
assert.equal(relative.objective,1.5);
assert.equal(choiceState.optimizer.comparison,'plain');
assert.equal(choiceState.optimizer.protection,undefined);
assert.equal(input({optimizer:{comparison:'invalid',protection:90}}).optimizer.comparison,'plain');
assert.equal(input({optimizer:{comparison:'remaining'}}).optimizer.comparison,'remaining');
for(const comparison of ['plain','remaining']) for(const food of [5,10,15,20]) {
 const state=normalizeProgress({schemaVersion:8,maester:3,inventory:{Food:food,Wood:food*2,'Pale Steel':20},optimizer:{tree:'Military III',group:'General',goals:['Attack','Defense','March Size'],weights:{Attack:2,Defense:3,'March Size':1},comparison}},mixed.research,resources);
 let expected=0;
 for(let a=0;a<=3;a++) for(let m=0;m<=3;m++) for(let d=0;d<=3;d++) {
  if(d&&!a || (a+m+d)*5>food) continue;
  const value=n=>[0,0.01,0.03,0.08][n];
  const score=comparison==='plain' ? 2*value(a)*100+3*value(d)*100+value(m)*100000
    : 2*value(a)/0.08+3*value(d)/0.08+value(m)/0.08;
  expected=Math.max(expected,score);
 }
 assert.ok(Math.abs(solveOptimization(mixed,state,highs,5).objective-expected)<1e-8);
 assert.deepEqual(normalizeProgress(JSON.parse(JSON.stringify(state)),mixed.research,resources),state);
}
for(const tree of ['Military III','Dragon Combat']) {
 const state=normalizeProgress({schemaVersion:8,maester:40,inventory:Object.fromEntries(real.resources.map(resource=>[resource,1e13])),optimizer:{tree,group:'Infantry',goals:['Attack','Defense','Health','March Size'],comparison:'plain'}},real.research,real.resources);
 const result=solveOptimization(real,state,highs,8);
 const expected=state.optimizer.goals.reduce((sum,goal)=>sum+state.optimizer.weights[goal]*result.metrics[goal]*(goal==='March Size'?1:100),0);
 assert.equal(result.status,'Optimal');
 assert.ok(Math.abs(result.objective-expected)<1e-8);
}
const dragonPlain=solveOptimization(dragonFixture,{...weightedDragon,optimizer:{...weightedDragon.optimizer,comparison:'plain'}},highs,5);
assert.ok(Math.abs(dragonPlain.objective-(2*dragonPlain.metrics['Dragon Defense']+dragonPlain.metrics['Dragon Attack vs. Dragon'])*100)<1e-8);
// Existing duplicate priorities migrate deterministically, preserving distinct
// values already held by other selected goals and ignoring unselected goals.
const duplicateState=input({optimizer:{tree:'Military III',group:'General',goals:['Attack','Defense','Health','March Size'],weights:{Attack:1,Defense:1,Health:2,'March Size':2}}});
assert.deepEqual(duplicateState.optimizer.weights,{Attack:1,Defense:3,Health:2,'March Size':4});
assert.deepEqual(normalizeProgress(JSON.parse(JSON.stringify(duplicateState)),research,resources),duplicateState);
const highWeights=input({optimizer:{tree:'Military III',group:'General',goals:['Attack','Defense'],weights:{Attack:100,Defense:100,Health:1}}});
assert.equal(highWeights.optimizer.weights.Attack,100);
assert.equal(highWeights.optimizer.weights.Defense,1);
const invalid={...choiceState,optimizer:{...choiceState.optimizer,weights:{Attack:3,Defense:3}}};
assert.throws(()=>compileOptimization(choices,invalid),/different importance/);
const selectedAgain=normalizeProgress({...highWeights,optimizer:{...highWeights.optimizer,goals:['Attack','Defense','Health']}},research,resources);
assert.equal(new Set(selectedAgain.optimizer.goals.map(goal=>selectedAgain.optimizer.weights[goal])).size,3);
const dragonDuplicate=normalizeProgress({...dragonInput,optimizer:{...dragonInput.optimizer,goals:['Dragon Defense','Dragon Attack vs. Dragon'],weights:{'Dragon Defense':1,'Dragon Attack vs. Dragon':1}}},dragonFixture.research,resources);
assert.deepEqual(dragonDuplicate.optimizer.weights,{'Dragon Defense':1,'Dragon Attack vs. Dragon':2});
console.log('Distinct priorities passed: duplicate migration, preserving existing distinct weights, range boundary, adding/reselecting goals, Dragon Specific and solver rejection.');
console.log('Comparison modes passed: distinct choices for identical priorities, exhaustive plain/remaining scores, mixed march units, both full trees and Dragon Specific, saved settings and obsolete protection migration.');
console.log('Multi-goal optimizer passed: custom weights, independent exhaustive scores, march/percentage normalization, both Dragon Specific goals, building-limited normalization, all four goals in both real trees, and saved-setting migration.');
console.log('Optimizer passed: exhaustive comparisons, multi-resource budgets, tiers, prerequisites, building caps, zero-cost research, conditional stat groups, dragon exclusions, per-resource RSS kept, persistence, and full-source-data optima.');

assert.deepEqual(statIconNames('Infantry Defense II'),['infantry','defense']);
assert.deepEqual(statIconNames('Dragon Infantry Attack vs. Player'),['dragon','infantry','attack']);
assert.deepEqual(statIconNames('Dragon Attack vs. Dragon'),['dragon','attack']);
assert.deepEqual(statIconNames('March Size'),['march-size']);
assert.deepEqual(statIconNames('Health',{tree:'Dragon Combat',group:'Cavalry'}),['dragon','cavalry','health']);
assert.deepEqual(statIconNames('General'),[]);
assert.ok(statLabel('Infantry Defense <script>').includes('&lt;script&gt;'));
assert.equal((statLabel('Infantry Defense').match(/<img /g)||[]).length,2);
const warningInput={goals:['Defense','Health','March Size'],weights:{Defense:3,Health:2,'March Size':1},comparison:'plain'};
assert.equal(marchSizeNotice({'March Size':10000,Defense:0.2,Health:0.1},warningInput).priorities[0],'Defense');
assert.equal(marchSizeNotice({'March Size':10000},{...warningInput,goals:['March Size']}),null);
assert.equal(marchSizeNotice({'March Size':0,Defense:0.2},warningInput),null);
assert.equal(marchSizeNotice({'March Size':10,Defense:0.2},warningInput),null);
assert.equal(marchSizeNotice({'March Size':10000,Defense:0.2},{...warningInput,comparison:'remaining'}).comparison,'remaining');
assert.ok(marchSizeNotice({'March Size':1000,Defense:0},{...warningInput,goals:['Defense']}));
console.log('Stat icons and march disclaimer passed: paired labels, dragon context, accessible escaped text, priority selection, both comparison modes, incidental march gains, and March Size-only exclusion.');

assert.deepEqual(statIconNames('Military 3'),['military-3']);
assert.deepEqual(statIconNames('Military III'),['military-3']);
assert.deepEqual(statIconNames('Infantry Defense',{tree:'Military III'}),['infantry','defense']);
assert.ok(statLabel('Military 3').includes('assets/stats/military-3.png'));
console.log('Military 3 emblem labels passed; troop/stat pairs remain unchanged.');
