import {evaluatePackSchedule, solveEventPacks} from './web/pack-schedule.mjs';
import {readFileSync} from 'node:fs';
import {solveOptimization} from './web/optimizer.mjs';
import assert from 'node:assert/strict';
import loadHighs from './web/vendor/highs/highs.mjs';
import {PACKS,solvePacks,packCosts} from './web/pack-planner.mjs';
import {normalizeProgress} from './web/progress.mjs';
const highs=await loadHighs();
const resources=Object.keys(PACKS[0].contents);
function fixture(costs,tree='Military III') {
  const item={id:'target',name:'target',tree,maxLevel:1,row:0,column:0,requires:[],maester:[1],properties:[],costs:Object.fromEntries(Object.entries(costs).map(([k,v])=>[k,[v]]))};
  const data={resources,research:[item]};
  return {data,state:normalizeProgress({goals:[{id:'target',level:1}]},data.research,resources)};
}
let {data,state}=fixture({'Scholarly Fragments':110000,'Red Gold':10000});
let result=solvePacks(data,state,highs);
assert.equal(result.total,1);assert.equal(result.boosted,true);assert.equal(result.quantities[2],1);
assert.equal(Math.round(result.coverage.find(row=>row.resource==='Scholarly Fragments').missing),99000);
assert.equal(state.boosts['Military III'].reductions['Scholarly Fragments'],undefined);
state.boosts['Military III'].reductions['Scholarly Fragments']=95;
assert.equal(packCosts(data,state,true).find(row=>row.resource==='Scholarly Fragments').reduced,0);
({data,state}=fixture({'Glass Candle Shards':2500000}));
result=solvePacks(data,state,highs);assert.equal(result.total,100);
assert.equal(result.quantities[0]+result.quantities[7],100);
assert.equal(result.quantities[0],50);
assert.equal(result.quantities[7],50);
assert.equal(result.boosted,false);
assert.equal(result.schedule.length,20);
assert.equal(result.startingEvent,'Dragon');
assert.equal(result.schedule.at(-1).type,'Research');
assert.equal(result.eventsOptimal,true);
state.packExcluded=['Glass Candle Shards'];
result=solvePacks(data,state,highs);assert.equal(result.total,0);
assert.equal(result.coverage.find(row=>row.resource==='Glass Candle Shards').missing,2500000);
state.inventory['Glass Candle Shards']=2500000;state.packExcluded=[];
assert.equal(solvePacks(data,state,highs).total,0);
({data,state}=fixture({'Dragon Lore':7250000},'Dragon Combat'));
result=solvePacks(data,state,highs);assert.equal(result.total,1);assert.equal(result.quantities[4],1);assert.equal(result.hasMilitary,false);
// Independent exhaustive search of all <=3-pack combinations, including each
// boost scenario, verifies the integer solver's objective on a mixed shortfall.
({data,state}=fixture({'Dragon Tomes':3800000,'Scholarly Fragments':180000,'Glass Candle Shards':27000}));
result=solvePacks(data,state,highs);
let minimum=Infinity;
function visit(quantities,left,index=0){
 if(index===PACKS.length){
  for(const boost of [false,true]){
   if(boost && !quantities[2])continue;
   const costs=packCosts(data,state,boost);
   if(costs.every(row=>PACKS.reduce((sum,pack,i)=>sum+quantities[i]*pack.contents[row.resource],0)+1e-7>=row.missing))minimum=Math.min(minimum,quantities.reduce((a,b)=>a+b,0));
  }return;
 }
 for(let n=0;n<=left;n++){quantities[index]=n;visit(quantities,left-n,index+1);}
}
visit([],3);assert.equal(result.total,minimum);
const restored=normalizeProgress({...state,packExcluded:['Food','Food','invalid']},data.research,resources);
assert.deepEqual(restored.packExcluded,['Food']);
console.log('Pack planner passed: independent minimum count, 100-pack multi-event coverage, both trees, temporary boost and cap, inventory, exclusions, persistence, and no state mutation.');

const military=fixture({'Scholarly Fragments':100000,'Pale Steel':10000}).data.research[0];
const dragon={...military,id:'dragon',tree:'Dragon Combat',requires:[{id:'target',level:1}]};
data={research:[military,dragon],resources};
state=normalizeProgress({schemaVersion:10,goals:[{id:'target',level:1},{id:'dragon',level:1}],boosts:{'Military III':{reductions:{'Scholarly Fragments':20}},'Dragon Combat':{reductions:{'Scholarly Fragments':40}}}},data.research,resources);
assert.equal(Math.round(packCosts(data,state,false).find(row=>row.resource==='Scholarly Fragments').reduced),140000);
assert.equal(Math.round(packCosts(data,state,true).find(row=>row.resource==='Scholarly Fragments').reduced),120000);
assert.equal(Math.round(packCosts(data,state,true).find(row=>row.resource==='Pale Steel').reduced),18000);
console.log('Mixed-tree pack costs passed: independent profiles, temporary boost in both trees, and shared prerequisites counted once.');

const real=JSON.parse(readFileSync('web/data/research.json','utf8'));
for (const tree of ['Military III','Dragon Combat']) {
 const input=normalizeProgress({schemaVersion:10,maester:40,inventory:Object.fromEntries(real.resources.map(resource=>[resource,10000000000])),optimizer:{tree,group:'Infantry',goals:['Defense'],weights:{Defense:1}}},real.research,real.resources);
 const optimized=solveOptimization(real,input,highs);
 assert.ok(optimized.goals.length>0);
 const transferred={...input,goals:optimized.goals};
 assert.ok(packCosts(real,transferred,false).every(row=>row.missing===0));
 assert.equal(solvePacks(real,transferred,highs).total,0);
}
console.log('Optimizer transfers passed in both trees: affordable recommended goals and prerequisites require zero packs.');

// Verify that temporary reductions never leak into a later Dragon window.
const m=fixture({'Scholarly Fragments':110000,'Red Gold':10000}).data.research[0];
const d={...fixture({'Dragon Lore':7250000,'Scholarly Fragments':110000},'Dragon Combat').data.research[0],id:'d'};
data={research:[m,d],resources};state=normalizeProgress({goals:[{id:'target',level:1},{id:'d',level:1}]},data.research,resources);
const researchPacks=PACKS.map(()=>0);researchPacks[2]=1;researchPacks[3]=1;
const dragonPacks=PACKS.map(()=>0);dragonPacks[4]=1;
const planned=[{type:'Research',quantities:researchPacks,boostedPacks:1,research:[{id:'target',level:1}]},{type:'Dragon',quantities:dragonPacks,boostedPacks:0,research:[{id:'d',level:1}]}];
let evaluated=evaluatePackSchedule(data,state,planned,3);
assert.equal(Math.round(evaluated.coverage.find(row=>row.resource==='Scholarly Fragments').reduced),209000);
assert.throws(()=>evaluatePackSchedule(data,state,[planned[0],{...planned[1],boostedPacks:1}]),/boost/);
assert.throws(()=>evaluatePackSchedule(data,state,[{...planned[1],research:[{id:'target',level:1}]}]),/Military/);
assert.throws(()=>evaluatePackSchedule(data,state,[{...planned[0],quantities:PACKS.map(()=>0)}]),/boost|availability/);
assert.throws(()=>evaluatePackSchedule(data,state,[{...planned[0],boostedPacks:0,quantities:PACKS.map(()=>0)}]),/Not enough/);
result=solvePacks(data,state,highs);assert.equal(result.total,3);
assert.equal(result.schedule.length,2);assert.equal(result.eventsOptimal,true);
assert.equal(evaluatePackSchedule(data,state,result.schedule.flatMap(window=>[{...window,research:window.research.flatMap(item=>Array.from({length:item.to-item.from},(_,i)=>({id:item.id,level:item.from+i+1})))}]),3).total,3);
// A dragon-only research that needs the Research Event boost must wait for
// the following Research Event after collecting its Dragon-only materials.
({data,state}=fixture({'Dragon Lore':7250000,'Scholarly Fragments':110000,'Red Gold':10000},'Dragon Combat'));
result=solvePacks(data,state,highs);assert.equal(result.total,2);
assert.equal(result.startingEvent,'Dragon');assert.equal(result.schedule.length,2);
assert.equal(result.schedule[0].research.length,0);
assert.equal(result.schedule[1].boostedPacks,1);assert.equal(result.schedule[1].research[0].tree,'Dragon Combat');
assert.equal(Math.round(result.coverage.find(row=>row.resource==='Scholarly Fragments').reduced),99000);
// Collection at an Advanced Research capacity boundary must not double-buy
// the reserved final boosted pack, even when using the fallback path.
({data,state}=fixture({'Red Gold':101500,'Scholarly Fragments':770000}));
result=solvePacks(data,state,highs);assert.equal(result.total,7);assert.equal(result.quantities[2],7);
console.log('Event schedules passed: both starting orders, Research-window Dragon Combat, Dragon-window full costs, per-event capacities, boost expiry, resource timing, exact pack totals and scheduling at capacity boundaries.');

const fallback=solveEventPacks(data,state,highs,0);
assert.equal(fallback.total,7);assert.equal(fallback.eventsOptimal,false);
assert.ok(fallback.schedule.length>0);
console.log('Scheduling fallback passed: verified minimum pack count and valid event plan retained when the event-count search is unavailable.');
