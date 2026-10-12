import {buildMultiPlan, calculateTreeCosts} from './model.mjs';
import {PACKS, solvePackLowerBound} from './pack-model.mjs';

const eventAt=(first,t)=>t%2===0 ? first : first==='Research' ? 'Dragon' : 'Research';
const tolerance=amount=>Math.max(1e-6,Math.abs(amount)*1e-10);
function profiles(state, boosted) {
  const boosts=structuredClone(state.boosts);
  if(boosted)for(const tree of ['Military III','Dragon Combat']) {
    const profile=boosts[tree] ||= {};
    profile.reductions={...profile.reductions};
    for(const resource of ['Scholarly Fragments','Pale Steel'])profile.reductions[resource]=Math.min(100,(profile.reductions[resource] || 0)+10);
  }
  return boosts;
}
function researchUnits(data,state) {
  const units=[];
  for(const step of buildMultiPlan(data.research,state.goals,state.levels))for(const level of step.missing) {
    const single=[{...step,missing:[level]}];
    units.push({item:step.item,level,base:calculateTreeCosts(single,data.resources,state.boosts).map(row=>row.reduced),boost:calculateTreeCosts(single,data.resources,profiles(state,true)).map(row=>row.reduced)});
  }
  return units;
}
function ordered(units) {
  const result=[],done=new Set(),pending=[...units];
  while(pending.length) {
    const index=pending.findIndex(unit=>!pending.some(other=>other.item.id===unit.item.id && other.level<unit.level || unit.level===1 && unit.item.requires.some(req=>other.item.id===req.id && other.level<=req.level)));
    if(index<0)throw new Error('Research prerequisites could not be ordered.');
    const unit=pending.splice(index,1)[0];
    const key=`${unit.item.id}:${unit.level}`;
    if(!done.has(key)){result.push(unit);done.add(key);}
  }
  return result;
}

// An explicit feasible schedule attains the pooled lower bound: save materials,
// then research in a final eligible window. It also supplies a verified fallback.
function collectFirst(data,state,bound,units,first) {
  const remaining=[...bound.quantities],schedule=[];
  const reserve=bound.boosted ? 1 : 0;
  remaining[2]-=reserve;
  const hasMilitary=units.some(unit=>unit.item.tree==='Military III');
  const count=Math.max(0,...PACKS.map((pack,i)=>Math.ceil(remaining[i]/(pack.id==='advanced' && !bound.boosted ? 5 : pack.limit))));
  for(let t=0;t<=2*count+2;t++) {
    const type=eventAt(first,t);
    const quantities=PACKS.map((pack,i)=>{
      if(pack.event!==type)return 0;
      const amount=Math.min(remaining[i],pack.id==='advanced' && !bound.boosted ? 5 : pack.limit);
      remaining[i]-=amount;return amount;
    });
    const finished=remaining.every(amount=>amount===0);
    const eligible=type==='Research' || !hasMilitary && !bound.boosted;
    const reallyComplete=finished && eligible && quantities[2]+reserve<=6;
    if(reallyComplete)quantities[2]+=reserve;
    schedule.push({type,quantities,boostedPacks:type==='Research' && quantities[2]>0 && (bound.boosted || quantities[2]>5) ? 1 : 0,research:reallyComplete ? ordered(units).map(unit=>({id:unit.item.id,level:unit.level})) : []});
    if(reallyComplete)return schedule;
  }
  throw new Error('Could not construct an event schedule.');
}

function compileSchedule(data,state,units,first,horizon,total) {
  const rows=[],bounds=[],integers=[],binaries=[],objective=[],packTerms=[];
  const assignments=units.map(()=>[]),packs=Array.from({length:horizon},()=>[]),boosts=[];
  const term=(coefficient,name)=>`${coefficient} ${name}`;
  const sum=terms=>terms.length ? terms.join(' + ').replaceAll('+ -','- ') : '0';
  for(let t=0;t<horizon;t++) {
    const type=eventAt(first,t);
    const b=`b${t}`;boosts[t]=type==='Research' ? b : null;
    if(boosts[t])binaries.push(b);
    for(let i=0;i<PACKS.length;i++)if(PACKS[i].event===type) {
      const name=`p${t}_${i}`;packs[t][i]=name;packTerms.push(name);integers.push(name);
      bounds.push(`0 <= ${name} <= ${PACKS[i].limit}`);
      if(i===2){rows.push(`${name} - ${b} <= 5`);rows.push(`${name} - ${b} >= 0`);}
    }
    for(let j=0;j<units.length;j++) {
      const unit=units[j];if(type==='Dragon' && unit.item.tree==='Military III')continue;
      const x=`x${j}_${t}`;binaries.push(x);objective.push(term(t+1,x));
      const discount=unit.base.map((amount,r)=>amount-unit.boost[r]);
      let z=null;
      if(boosts[t] && discount.some(amount=>amount>0)) {
        z=`z${j}_${t}`;binaries.push(z);
        rows.push(`${z} - ${x} <= 0`,`${z} - ${b} <= 0`,`${z} - ${x} - ${b} >= -1`);
      }
      assignments[j].push({t,x,z,discount});
    }
  }
  rows.push(`${sum(packTerms)} = ${total}`);
  for(let j=0;j<units.length;j++) {
    rows.push(`${sum(assignments[j].map(({x})=>x))} = 1`);
    const unit=units[j];
    const required=units.map((other,k)=>({other,k})).filter(({other})=>other.item.id===unit.item.id && other.level===unit.level-1 || unit.level===1 && unit.item.requires.some(req=>other.item.id===req.id && other.level===req.level));
    for(const {k} of required)for(let t=0;t<horizon;t++)rows.push(`${sum([...assignments[j].filter(a=>a.t<=t).map(a=>term(1,a.x)),...assignments[k].filter(a=>a.t<=t).map(a=>term(-1,a.x))])} <= 0`);
  }
  for(let r=0;r<data.resources.length;r++) {
    const resource=data.resources[r];if(state.packExcluded.includes(resource))continue;
    const scale=Math.max(1,state.inventory[resource] || 0,units.reduce((amount,unit)=>amount+unit.base[r],0),...PACKS.map(pack=>pack.contents[resource] || 0));
    for(let t=0;t<horizon;t++) {
      const terms=[];
      for(let e=0;e<=t;e++)for(let i=0;i<PACKS.length;i++)if(packs[e][i] && PACKS[i].contents[resource])terms.push(term(PACKS[i].contents[resource]/scale,packs[e][i]));
      for(let j=0;j<units.length;j++)for(const a of assignments[j])if(a.t<=t) {
        if(units[j].base[r])terms.push(term(-units[j].base[r]/scale,a.x));
        if(a.z && a.discount[r])terms.push(term(a.discount[r]/scale,a.z));
      }
      if(terms.length)rows.push(`${sum(terms)} >= ${-(state.inventory[resource] || 0)/scale}`);
    }
  }
  return {assignments,packs,boosts,lp:`Minimize\n early: ${sum(objective)}\nSubject To\n${rows.map((row,i)=>` c${i}: ${row}`).join('\n')}\nBounds\n${bounds.join('\n')}\nGeneral\n${integers.join(' ')}\nBinary\n${binaries.join(' ')}\nEnd`};
}

// Recompute every event independently after solving. No future packs, expired
// boost, wrong event, or unpaid prerequisite can pass this verification.
export function evaluatePackSchedule(data,state,schedule,expectedTotal=null) {
  const units=researchUnits(data,state),byKey=new Map(units.map(unit=>[`${unit.item.id}:${unit.level}`,unit]));
  const levels={...state.levels},inventory=Object.fromEntries(data.resources.map(r=>[r,state.inventory[r] || 0]));
  const costs=data.resources.map(resource=>({resource,original:0,reduced:0}));
  const quantities=PACKS.map(()=>0),events={Research:0,Dragon:0},finished=new Set(),external=Object.fromEntries(data.resources.map(r=>[r,0]));
  let boostedPacks=0;
  const evaluated=schedule.map((window,t)=>{
    if(t && window.type===schedule[t-1].type)throw new Error('Event order must alternate.');
    events[window.type]++;
    if(!['Research','Dragon'].includes(window.type))throw new Error('Unknown event type.');
    const boost=window.boostedPacks || 0;
    if(!Number.isInteger(boost) || boost<0 || boost>1 || boost && window.type!=='Research')throw new Error('Invalid temporary boost window.');
    boostedPacks+=boost;
    PACKS.forEach((pack,i)=>{
      const amount=window.quantities[i] || 0;
      if(!Number.isInteger(amount) || amount<0 || amount>pack.limit || amount && pack.event!==window.type || i===2 && (amount<boost || amount-boost>5))throw new Error('Pack exceeds event availability.');
      quantities[i]+=amount;
      for(const resource of data.resources)inventory[resource]+=amount*(pack.contents[resource] || 0);
    });
    const research=[];
    for(const entry of window.research) {
      const key=`${entry.id}:${entry.level}`,unit=byKey.get(key);
      if(!unit || finished.has(key))throw new Error('Invalid or duplicate scheduled research.');
      if(window.type==='Dragon' && unit.item.tree!=='Dragon Combat')throw new Error('Military 3 cannot be researched in a Dragon Event.');
      if((levels[entry.id] || 0)+1!==entry.level || (levels[entry.id] || 0)===0 && unit.item.requires.some(req=>(levels[req.id] || 0)<req.level))throw new Error('Research prerequisites must be completed first.');
      const actual=boost ? unit.boost : unit.base;
      actual.forEach((amount,r)=>{
        const resource=data.resources[r];inventory[resource]-=amount;
        costs[r].reduced+=amount;costs[r].original+=unit.item.costs[resource]?.[unit.level-1] || 0;
        if(inventory[resource]<-tolerance(amount)) {
          if(!state.packExcluded.includes(resource))throw new Error(`Not enough ${resource} in event ${t+1}.`);
          external[resource]+=-inventory[resource];inventory[resource]=0;
        }
      });
      finished.add(key);levels[entry.id]=entry.level;
      const previous=research.at(-1);
      if(previous?.id===entry.id)previous.to=entry.level;
      else research.push({id:entry.id,name:unit.item.name,tree:unit.item.tree,from:entry.level-1,to:entry.level});
    }
    return {...window,index:t+1,research,external:{...external},remaining:{...inventory}};
  });
  if(finished.size!==units.length)throw new Error('Event schedule does not finish the selected research.');
  const total=quantities.reduce((a,b)=>a+b,0);
  if(expectedTotal!==null && total!==expectedTotal)throw new Error('Event schedule changed the minimum pack count.');
  const coverage=costs.map(row=>({...row,available:state.inventory[row.resource] || 0,missing:Math.max(0,row.reduced-(state.inventory[row.resource] || 0)),excluded:state.packExcluded.includes(row.resource),supplied:PACKS.reduce((amount,pack,i)=>amount+quantities[i]*(pack.contents[row.resource] || 0),0),external:external[row.resource],remaining:Math.max(0,inventory[row.resource])}));
  return {total,quantities,boosted:boostedPacks>0,boostedPacks,events,coverage,schedule:evaluated,hasMilitary:units.some(unit=>unit.item.tree==='Military III'),startingEvent:schedule[0]?.type};
}

export function solveEventPacks(data,state,highs,timeLimit=16) {
  const bound=solvePackLowerBound(data,state,highs);
  if(!bound.total)return {...bound,schedule:[],eventsOptimal:true};
  const units=researchUnits(data,state);
  const candidates=['Research','Dragon'].map(first=>evaluatePackSchedule(data,state,collectFirst(data,state,bound,units,first),bound.total));
  candidates.sort((a,b)=>a.schedule.length-b.schedule.length);
  let best=candidates[0],proven=false;
  const deadline=Date.now()+timeLimit*1000;
  // Binary feasibility search minimizes event windows at the proven minimum
  // pack count. Cap model size; keep the verified constructive plan on timeout.
  let low=Math.max(1,Math.ceil(bound.total/21)),high=best.schedule.length;
  while(low<=high && Date.now()<deadline) {
    const horizon=Math.floor((low+high)/2);
    if(horizon>40 || horizon*units.length>20000)break;
    let feasible=null,unknown=false;
    for(const first of ['Research','Dragon']) {
      const seconds=(deadline-Date.now())/1000;if(seconds<.05){unknown=true;break;}
      let compiled,solution;
      try {
        compiled=compileSchedule(data,state,units,first,horizon,bound.total);
        solution=highs.solve(compiled.lp,{output_flag:false,time_limit:Math.min(4,seconds),mip_rel_gap:0,mip_abs_gap:0,mip_feasibility_tolerance:1e-9,random_seed:0});
      } catch { unknown=true;break; }
      if(['Optimal','Time limit reached'].includes(solution.Status) && solution.Columns) {
        const selected=name=>(solution.Columns[name]?.Primal || 0)>.5;
        const windows=Array.from({length:horizon},(_,t)=>({type:eventAt(first,t),quantities:PACKS.map((_,i)=>Math.round(solution.Columns[compiled.packs[t][i]]?.Primal || 0)),boostedPacks:compiled.boosts[t] && selected(compiled.boosts[t]) ? 1 : 0,research:ordered(units.filter((_,j)=>compiled.assignments[j].some(a=>a.t===t && selected(a.x)))).map(unit=>({id:unit.item.id,level:unit.level}))}));
        try {feasible=evaluatePackSchedule(data,state,windows,bound.total);break;}catch {unknown=true;}
      }
      if(solution.Status!=='Infeasible')unknown=true;
    }
    if(feasible){best=feasible;high=horizon-1;}
    else if(!unknown)low=horizon+1;
    else break;
  }
  proven=low>high;
  return {...best,eventsOptimal:proven};
}
