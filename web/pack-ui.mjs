import { statLabel } from './stat-icons.mjs';
import { PACKS, packCosts } from './pack-planner.mjs';
import { formatNumber } from './model.mjs';
const byId = id=>document.getElementById(id);
export function createPackUI({data,getState,commit,resourceLabel}) {
  let worker, timer, debounce, previous;
  const stop = () => { worker?.terminate(); worker=null; clearTimeout(timer); clearTimeout(debounce); };
  function render() {
    const state=getState();
    const stamp=JSON.stringify({goals:state.goals,levels:state.levels,inventory:state.inventory,boosts:state.boosts,excluded:state.packExcluded});
    if (previous === stamp) return;
    stop(); previous=stamp;
    const costs=packCosts(data,state,false);
    if (!costs.some(row=>row.missing>0 && !state.packExcluded.includes(row.resource))) {
      showResult({total:0,quantities:PACKS.map(()=>0),boosted:false,boostedPacks:0,events:{Research:0,Dragon:0},coverage:costs.map(row=>({...row,excluded:state.packExcluded.includes(row.resource),supplied:0}))});
      return;
    }
    byId('pack-results').innerHTML='<p role="status">Updating pack recommendation…</p>';
    // Wait briefly for typing to settle; superseded workers cannot publish stale results.
    debounce=setTimeout(calculate,300);
  }
  byId('cost-body').addEventListener('change',event=>{
    const resource=event.target.dataset.packResource;
    if (!data.resources.includes(resource)) return;
    const excluded=new Set(getState().packExcluded);
    event.target.checked ? excluded.add(resource) : excluded.delete(resource);
    commit({...getState(),packExcluded:[...excluded]});
  });
  function calculate() {
    stop();
    byId('pack-results').innerHTML='<p role="status">Finding packs and a valid event plan…</p>';
    const requested=previous;
    worker=new Worker(new URL('./pack-worker.mjs',import.meta.url),{type:'module'});
    const fail=message=>{if(requested!==previous)return;stop();byId('pack-results').textContent=message;};
    worker.onerror=()=>fail('Pack planner unavailable. Your saved inputs are safe. Please reload and try again.');
    timer=setTimeout(()=>fail('Pack calculation timed out. Please try again.'),45000);
    worker.onmessage=({data:response})=>{
      if(requested!==previous)return;
      stop();
      if(response.error){fail(response.error);return;}
      showResult(response.result);
    };
    worker.postMessage({data,state:getState()});
  }
  function showResult(result) {
      const rows=PACKS.map((pack,i)=>result.quantities[i] ? `<tr><th scope="row">${pack.name}<small>${pack.event} Event${pack.id==='advanced' ? ` · ${formatNumber(result.boostedPacks)} boosted + ${formatNumber(result.quantities[i]-result.boostedPacks)} standard` : ''}</small></th><td class="number">${formatNumber(result.quantities[i])}</td></tr>`:'').join('');
      const coverage=result.coverage.filter(row=>row.original || row.supplied).map(row=>`<tr><th scope="row">${resourceLabel(row.resource)}${row.excluded?'<small>Get this elsewhere</small>':''}</th><td class="number">${formatNumber(Math.ceil(row.missing))}</td><td class="number">${formatNumber(row.supplied)}</td><td class="number">${formatNumber(Math.ceil(row.external ?? Math.max(0,row.missing-row.supplied)))}</td><td class="number">${formatNumber(Math.floor(row.remaining ?? Math.max(0,row.supplied-row.missing)))}</td></tr>`).join('');
      const external=result.coverage.filter(row=>row.excluded && (row.external ?? row.missing-row.supplied)>0).map(row=>`<li>${resourceLabel(row.resource)}: ${formatNumber(Math.ceil(row.external ?? row.missing-row.supplied))}</li>`).join('');
      const eventPlan=result.schedule?.map(window=>{
        const packs=PACKS.map((pack,i)=>window.quantities[i] ? `<li>${pack.name}: <strong>${formatNumber(window.quantities[i])}</strong>${pack.id==='advanced' ? ` (${window.boostedPacks} boosted + ${window.quantities[i]-window.boostedPacks} standard)` : ''}</li>` : '').join('');
        const research=window.research.map(item=>`<li>${statLabel(item.name,{tree:item.tree})}: ${item.from} → ${item.to}<small>${item.tree==='Military III' ? 'Military 3' : 'Dragon Combat'}</small></li>`).join('');
        return `<li class="pack-event"><h4>Event ${window.index} · ${window.type} Event</h4>${packs ? `<p class="formula-note">Buy these packs before starting research:</p><ul>${packs}</ul>` : '<p class="formula-note">No packs purchased in this event.</p>'}${window.boostedPacks ? '<p class="pack-event-boost">Activate +10% Scholarly Fragments and +10% Pale Steel reduction. This boost applies only to research below in this 48-hour Research Event.</p>' : '<p class="formula-note">Uses your entered boosts; no extra Advanced Research reduction.</p>'}${research ? `<p class="formula-note">Research in this order:</p><ol>${research}</ol>` : '<p class="formula-note">Save materials for later; no planned research in this event.</p>'}<details class="disclosure"><summary>Resources carried forward</summary><div class="details-content pack-carry">${data.resources.filter(resource=>window.remaining[resource]>0).map(resource=>`<div>${resourceLabel(resource)}<strong>${formatNumber(Math.floor(window.remaining[resource]))}</strong></div>`).join('') || '<p>No resources remaining.</p>'}</div></details></li>`;
      }).join('') || '';
      if (!result.total) {
        byId('pack-results').innerHTML=`<h3>0 packs needed</h3><p class="muted">${external ? 'Your current resources cover all shortages assigned to packs.' : 'Your current resources cover the planned research.'}</p>${external ? `<h3>Still needed from other sources</h3><ul>${external}</ul>` : ''}`;
        return;
      }
      byId('pack-results').innerHTML=`<h3>${formatNumber(result.total)} packs needed</h3><p class="muted">Minimum total packs for the entered values. Equal-count combinations may exist.</p>${result.total?`<div class="table-scroll"><table class="cost-table pack-summary-table"><thead><tr><th>Pack category</th><th class="number">Packs</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p>No packs are needed for the resources being covered.</p>'}<p class="formula-note">Starts with a <strong>${result.startingEvent} Event</strong> · ${formatNumber(result.events.Research)} Research + ${formatNumber(result.events.Dragon)} Dragon windows, including any waiting windows. Both starting orders were considered. ${result.eventsOptimal ? 'Fewest event windows at this minimum pack count.' : 'Pack count is minimal; a shorter event sequence may exist because the scheduling search reached its limit.'}</p><p class="formula-note">Military 3 is scheduled only in Research Events. Dragon Combat may be scheduled in either event. Extra Advanced Research reductions apply only within their own 48-hour Research Event; boosts from earlier events do not carry forward. Unspent resources do carry forward. Event order assumes alternating types and unchanged future pack availability, without predicting calendar dates.</p><details class="disclosure"><summary>Event plan</summary><div class="details-content"><p class="formula-note">Packs are purchased before that event's research. Obtain resources marked “Get this elsewhere” before the research that needs them. Research time and building upgrade costs are excluded; the plan assumes the listed levels can be started within each event window.</p><ol class="pack-events">${eventPlan}</ol></div></details>${external?`<h3>Still needed from other sources</h3><ul>${external}</ul>`:''}<details class="disclosure"><summary>Resource coverage</summary><div class="details-content"><p class="formula-note">Needed is after event-specific boosts and current inventory. Other sources includes any excluded resource required before later packs arrive. Packs contribute to every resource, including those marked for another source.</p><div class="table-scroll"><table class="cost-table"><thead><tr><th>Resource</th><th>Needed</th><th>From packs</th><th>Other sources</th><th>Remaining</th></tr></thead><tbody>${coverage}</tbody></table></div></div></details><p class="cost-caution">Use with caution: game boost precision and rounding can change costs. Check in-game costs and pack contents before buying. This recommendation does not change your saved boosts, inventory, or research levels.</p>`;
  }
  return {render};
}
