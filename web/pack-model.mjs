import { buildMultiPlan, calculateTreeCosts, resourceShortfalls } from './model.mjs';

// Contents supplied by the user. Limits are per 48-hour event, not lifetime caps.
const materials = ['Dragon Tomes','Dragon Lore','Dragon Secrets','Red Gold','Glass Candle Shards','Pale Steel','Scholarly Fragments','Food','Wood','Stone','Iron'];
export const PACKS = [
  ['research-glass','Glass Candle Specific','Research',5,[0,0,0,0,25000,0,0,33000000,33000000,4500000,1425000]],
  ['research-tomes','Dragon Tome Specific','Research',5,[3750000,0,0,4000,4000,10000,20000,84000000,84000000,10750000,3765000]],
  ['advanced','Advanced Research','Research',6,[1500000,1150000,300000,14500,10000,40000,100000,84000000,84000000,10750000,3765000]],
  ['essential','Research Essential','Research',5,[0,0,0,0,0,90000,250000,27500000,27500000,7500000,2205000]],
  ['lore','Dragon Lore Super Pack','Dragon',5,[0,7250000,250000,0,0,0,0,50000000,50000000,7100000,2105000]],
  ['secrets','Dragon Secrets Super Pack','Dragon',5,[0,0,1200000,0,0,0,0,50000000,50000000,7100000,2105000]],
  ['fury','Dragon Fury','Dragon',5,[2275000,4025000,762000,2500,5000,8000,20000,50000000,50000000,7100000,2105000]],
  ['dragon-glass','Glass Candle Specific','Dragon',5,[0,0,0,0,25000,0,0,33000000,33000000,4500000,1425000]],
].map(([id,name,event,limit,values]) => ({id,name,event,limit,contents:Object.fromEntries(materials.map((resource,i)=>[resource,values[i]]))}));

export function packCosts(data, state, boosted) {
  const plan = buildMultiPlan(data.research, state.goals, state.levels);
  const boosts = structuredClone(state.boosts);
  if (boosted) for (const tree of ['Military III','Dragon Combat']) {
    const profile = boosts[tree] ||= {};
    profile.reductions = {...profile.reductions};
    for (const resource of ['Scholarly Fragments','Pale Steel']) profile.reductions[resource] = Math.min(100, (profile.reductions[resource] || 0) + 10);
  }
  return resourceShortfalls(calculateTreeCosts(plan, data.resources, boosts), state.inventory);
}

export function solvePackLowerBound(data, state, highs) {
  const excluded = new Set(state.packExcluded || []);
  const candidates = [];
  for (const boosted of [false,true]) {
    const costs = packCosts(data,state,boosted);
    const needed = costs.filter(row => row.missing > 0 && !excluded.has(row.resource));
    if (!needed.length && !boosted) {
      candidates.push({boosted, costs, quantities:PACKS.map(()=>0),total:0});
      continue;
    }
    // Scale each constraint independently to keep billions and small materials
    // numerically comparable. Pack quantities are integers; never round a deficit down.
    const rows = needed.map((row,index) => {
      const scale = Math.max(1,row.missing,...PACKS.map(pack=>pack.contents[row.resource] || 0));
      return ` c${index}: ${PACKS.map((pack,i)=>`${(pack.contents[row.resource] || 0)/scale} p${i}`).join(' + ')} >= ${row.missing/scale}`;
    });
    if (boosted) rows.push(' boost: p2 >= 1');
    const lp = `Minimize\n packs: ${PACKS.map((_,i)=>`p${i}`).join(' + ')}\nSubject To\n${rows.join('\n')}\nBounds\n${PACKS.map((_,i)=>` p${i} >= 0`).join('\n')}\nGeneral\n${PACKS.map((_,i)=>`p${i}`).join(' ')}\nEnd`;
    const solution = highs.solve(lp,{output_flag:false,time_limit:10,mip_rel_gap:0,mip_abs_gap:0,mip_feasibility_tolerance:1e-9});
    if (solution.Status !== 'Optimal') throw new Error('A minimum pack count could not be verified. Please try again.');
    const quantities = PACKS.map((_,i)=>Math.round(solution.Columns?.[`p${i}`]?.Primal || 0));
    for (const row of needed) {
      const supplied = PACKS.reduce((sum,pack,i)=>sum+quantities[i]*(pack.contents[row.resource] || 0),0);
      if (supplied + 1e-5 < row.missing) throw new Error('Pack coverage could not be verified. Please check your inputs.');
    }
    candidates.push({boosted,costs,quantities,total:quantities.reduce((a,b)=>a+b,0)});
  }
  candidates.sort((a,b)=>a.total-b.total || Number(b.boosted)-Number(a.boosted));
  const best = candidates[0];
  const events = Object.fromEntries(['Research','Dragon'].map(event=>[event,Math.max(0,...PACKS.map((pack,i)=>pack.event===event ? Math.ceil(best.quantities[i]/(pack.id==='advanced' && !best.boosted ? 5 : pack.limit)) : 0))]));
  if (best.boosted) events.Research = Math.max(1,events.Research);
  const boostedPacks = best.boosted ? Math.min(best.quantities[2],events.Research) : 0;
  const coverage = best.costs.map(row=>({...row,excluded:excluded.has(row.resource), supplied:PACKS.reduce((sum,pack,i)=>sum+best.quantities[i]*(pack.contents[row.resource] || 0),0)}));
  return {...best,events,boostedPacks,coverage,hasMilitary:state.goals.some(goal=>data.research.find(item=>item.id===goal.id)?.tree==='Military III')};
}
