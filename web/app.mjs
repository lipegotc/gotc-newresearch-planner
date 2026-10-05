import { BASE_RESOURCES, buildPlan, buildMultiPlan, calculateCosts, formatNumber, formatStat, valueAt } from './model.mjs';
import { APP_TITLE, STORAGE_KEY, SCHEMA_VERSION, boundedNumber, normalizeProgress, setCompletedLevel, toggleRequirement, resetCalculation } from './progress.mjs';

const byId = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
let data;
let byResearch = new Map();
let state;
let statsLimit = 60;

function readProgress() {
  try { return normalizeProgress(JSON.parse(localStorage.getItem(STORAGE_KEY)), data.research, data.resources); }
  catch { return normalizeProgress(null, data.research, data.resources); }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); byId('save-status').textContent = 'Saved on this device'; }
  catch { byId('save-status').textContent = 'Browser saving unavailable'; }
}
function commit(next, preserveEditing = false) {
  state = normalizeProgress(next, data.research, data.resources);
  save();
  renderCalculator(preserveEditing);
}
function announce(message) { byId('app-message').textContent = message; }
// Keep the exact input node while typing, so decimals, focus, and mobile keyboards survive updates.
function renderHTML(element, html, preserveEditing) {
  const active = document.activeElement;
  if (!preserveEditing || !active?.dataset.focus || !element.contains(active)) {
    element.innerHTML = html;
    return;
  }
  const template = document.createElement('template');
  template.innerHTML = html;
  const replacement = [...template.content.querySelectorAll('[data-focus]')]
    .find(input => input.dataset.focus === active.dataset.focus);
  if (replacement) replacement.replaceWith(active);
  element.replaceChildren(template.content);
}
function switchTab(tab) {
  if (!['calculator','help','stats'].includes(tab)) return;
  state.tab = tab;
  save();
  renderTabs();
  if (tab === 'stats') renderStats();
  // Remove obsolete tutorial anchors from the previous interface.
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  window.scrollTo({top:0, behavior:'instant'});
}
function renderTabs() {
  for (const button of document.querySelectorAll('[data-tab]')) {
    const active = button.dataset.tab === state.tab;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  }
  for (const view of document.querySelectorAll('.view')) view.hidden = view.id !== `${state.tab}-view`;
}
function addGoal(id) {
  const item = byResearch.get(id);
  if (!item || state.goals.some(goal => goal.id === id)) return;
  const current = state.levels[id] || 0;
  commit({...state, goals:[...state.goals, {id, level:Math.min(item.maxLevel, current + 1)}]});
  byId('picker-dialog').close();
  switchTab('calculator');
  document.querySelector(`[data-focus="current-${id}"]`)?.focus();
  announce(`${item.name} added to the calculator.`);
}
function costTable(plan, resources) {
  const costs = calculateCosts(plan, resources, state.efficiencies, state.reductions, state.sharedEfficiency);
  const rows = costs.filter(cost => cost.original).map(cost => `<tr><th scope="row">${escapeHTML(cost.resource)}</th><td class="number">${formatNumber(cost.original)}</td><td class="number">${formatNumber(cost.reduced)}</td></tr>`).join('');
  return `<table class="cost-table"><thead><tr><th scope="col">Resource / material</th><th scope="col" class="number">Original</th><th scope="col" class="number">Reduced</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="empty">No remaining costs.</td></tr>'}</tbody></table>`;
}
function requiredList(goal, combinedById) {
  const current = state.levels[goal.id] || 0;
  if (current > 0) return '<p class="requirement-note">This research is already unlocked. Its initial research prerequisites have been satisfied.</p>';
  const prerequisites = buildPlan(data.research, goal.id, goal.level, state.levels).filter(step => step.item.id !== goal.id);
  const remaining = prerequisites.filter(step => (combinedById.get(step.item.id) || step).missing.length).length;
  const rows = prerequisites.map(step => {
    const shared = combinedById.get(step.item.id) || step;
    const { item, desired, current: completed } = shared;
    const achieved = completed >= desired;
    const isGoal = state.goals.some(selected => selected.id === item.id);
    return `<div class="req-row"><label class="req-check"><input type="checkbox" data-achieved="${item.id}" data-required="${desired}" data-focus="achieved-${goal.id}-${item.id}" aria-label="Achieved ${escapeHTML(item.name)} level ${desired}" ${achieved ? 'checked' : ''}><span><strong>${escapeHTML(item.name)}</strong><small>Required level ${desired} · ${achieved ? 'Achieved' : 'Not achieved'}${isGoal ? ' · Also selected' : ''}</small></span></label><label class="req-level">Current level<input type="number" min="0" max="${item.maxLevel}" step="1" inputmode="numeric" value="${completed}" data-current="${item.id}" data-focus="requirement-${goal.id}-${item.id}" aria-label="Current level for required ${escapeHTML(item.name)}"></label></div>`;
  }).join('');
  return `<details class="disclosure" data-disclosure="requirements-${goal.id}"><summary>Requirements · ${remaining} remaining</summary><div class="details-content">${rows || '<p class="muted">No research prerequisites.</p>'}<p class="requirement-note">Unmet requirements are included in totals. Check Achieved to record the required level; uncheck to undo. Shared requirements are counted once.</p></div></details>`;
}
function goalCard(goal, combinedById, resources) {
  const item = byResearch.get(goal.id);
  const current = state.levels[item.id] || 0;
  const ownPlan = buildPlan(data.research, goal.id, goal.level, state.levels);
  const ownStep = ownPlan.find(step => step.item.id === goal.id);
  const gains = ownStep.gains.map(gain => `<div>+${formatStat(gain.amount, gain.property.unit)}<small>${escapeHTML(gain.property.name)}</small></div>`).join('');
  const shared = combinedById.get(item.id);
  const extra = shared.desired > goal.level ? `<p class="requirement-note">Another selection requires this research at level ${shared.desired}. Combined totals include that level.</p>` : '';
  return `<article class="goal" aria-label="${escapeHTML(item.name)}"><div class="goal-row"><div class="goal-name"><small>${escapeHTML(item.tree)}</small><strong>${escapeHTML(item.name)}</strong></div><label><span class="field-label">Current level</span><input type="number" min="0" max="${item.maxLevel}" step="1" inputmode="numeric" value="${current}" data-current="${item.id}" data-focus="current-${item.id}" aria-label="Current level for ${escapeHTML(item.name)}"></label><label><span class="field-label">Desired level</span><input type="number" min="1" max="${item.maxLevel}" step="1" inputmode="numeric" value="${goal.level}" data-desired="${item.id}" data-focus="desired-${item.id}" aria-label="Desired level for ${escapeHTML(item.name)}"></label><div class="goal-stat"><span class="field-label">Stat gain</span>${gains}</div><div class="goal-maester"><span class="field-label">Maester</span>${item.maester[goal.level-1]}</div><button class="button remove" data-remove="${item.id}" aria-label="Remove ${escapeHTML(item.name)}">Remove</button></div>${current >= goal.level ? '<p class="requirement-note good">Desired level already achieved.</p>' : ''}${extra}${requiredList(goal, combinedById)}<details class="disclosure" data-disclosure="costs-${goal.id}"><summary>Research cost breakdown</summary><div class="details-content"><p class="muted">Selected research and its unmet prerequisites. Shared costs also shown here are counted only once in combined totals.</p>${costTable(ownPlan, resources)}</div></details></article>`;
}
function renderAdjustments(preserveEditing) {
  const row = resource => `<tr><th scope="row">${escapeHTML(resource)}</th><td><input type="number" min="0" step="0.01" inputmode="decimal" value="${state.efficiencies[resource] || 0}" data-efficiency="${escapeHTML(resource)}" data-focus="efficiency-${escapeHTML(resource)}" aria-label="${escapeHTML(resource)} efficiency percent"></td><td><input type="number" min="0" max="100" step="0.01" inputmode="decimal" value="${state.reductions[resource] || 0}" data-reduction="${escapeHTML(resource)}" data-focus="reduction-${escapeHTML(resource)}" aria-label="${escapeHTML(resource)} reduction percent"></td></tr>`;
  renderHTML(byId('resource-adjustments'), BASE_RESOURCES.map(row).join(''), preserveEditing);
  // Keep every material editable even when a selection changes trees.
  renderHTML(byId('material-adjustments-body'), data.resources.filter(resource => !BASE_RESOURCES.includes(resource)).map(row).join(''), preserveEditing);
  byId('shared-efficiency').value = state.sharedEfficiency;
}
function renderCalculator(preserveEditing = false) {
  const activeInput = document.activeElement;
  const editingValue = preserveEditing && activeInput?.type === 'number' ? activeInput.value : null;
  const focusKey = document.activeElement?.dataset.focus;
  const openDetails = new Map([...byId('goal-list').querySelectorAll('[data-disclosure]')].map(element => [element.dataset.disclosure, element.open]));
  const plan = buildMultiPlan(data.research, state.goals, state.levels);
  const combinedById = new Map(plan.map(step => [step.item.id, step]));
  const resources = data.resources.filter(resource => BASE_RESOURCES.includes(resource) || plan.some(step => step.item.costs[resource]));
  renderHTML(byId('goal-list'), state.goals.map(goal => goalCard(goal, combinedById, resources)).join('') || '<div class="empty"><p>No research selected.</p><p>Choose Add research to start a calculation.</p></div>', preserveEditing);
  for (const element of byId('goal-list').querySelectorAll('[data-disclosure]')) element.open = openDetails.get(element.dataset.disclosure) || false;
  const unfinished = plan.filter(step => step.missing.length);
  const needed = Math.max(0, ...unfinished.map(step => step.maesterNeeded));
  byId('maester-level').value = state.maester;
  byId('maester-output').innerHTML = state.goals.length ? `<strong>Required level ${needed || '—'}</strong><span class="building-status ${needed > state.maester ? 'warning' : 'good'}">${needed ? needed > state.maester ? 'Upgrade needed' : 'Building requirement met' : 'No research levels remaining'}</span>` : '<span class="muted">Add research to see the requirement.</span>';
  byId('plan-summary').textContent = `${state.goals.length} selected · ${unfinished.length} research remaining · ${unfinished.reduce((sum,step)=>sum+step.missing.length,0)} levels remaining`;
  const costs = calculateCosts(plan, resources, state.efficiencies, state.reductions, state.sharedEfficiency);
  byId('cost-body').innerHTML = costs.map(cost => `<tr><th scope="row">${escapeHTML(cost.resource)}</th><td class="number">${formatNumber(cost.original)}</td><td class="number">${formatNumber(cost.reduced)}</td></tr>`).join('');
  const selected = new Set(state.goals.map(goal => goal.id));
  byId('combined-costs').innerHTML = unfinished.map(step => `<section class="breakdown-item"><h3>${escapeHTML(step.item.name)} <small>${step.current} → ${step.desired} · ${selected.has(step.item.id) ? 'Selected research' : 'Requirement'}</small></h3>${costTable([step], resources)}</section>`).join('') || '<p class="muted">No remaining costs.</p>';
  const gains = new Map();
  for (const step of plan) for (const gain of step.gains) {
    if (!gain.amount) continue;
    const previous = gains.get(gain.property.raw) || {...gain.property, amount:0};
    previous.amount += gain.amount;
    gains.set(gain.property.raw, previous);
  }
  byId('gain-list').innerHTML = [...gains.values()].sort((a,b)=>a.name.localeCompare(b.name)).map(gain => `<div class="gain-row"><span>${escapeHTML(gain.name)}<small>${escapeHTML(gain.scope)}</small></span><strong>+${formatStat(gain.amount,gain.unit)}</strong></div>`).join('') || '<p class="muted">No remaining stat gains.</p>';
  renderAdjustments(preserveEditing);
  const replacement = focusKey ? [...document.querySelectorAll('[data-focus]')].find(element => element.dataset.focus === focusKey) : activeInput;
  if (editingValue !== null && replacement?.isConnected) replacement.value = editingValue;
  if (focusKey) replacement?.focus({preventScroll:true});
}
function renderPicker() {
  const tree = byId('picker-tree').value;
  const query = byId('picker-search').value.trim().toLowerCase();
  const matches = data.research.filter(item => item.tree === tree && `${item.name} ${item.properties.map(prop=>prop.name).join(' ')}`.toLowerCase().includes(query)).sort((a,b)=>a.name.localeCompare(b.name));
  byId('picker-count').textContent = `${matches.length} result${matches.length===1 ? '' : 's'} found`;
  byId('picker-results').innerHTML = matches.map(item => {
    const added = state.goals.some(goal=>goal.id===item.id);
    return `<div class="picker-item"><div><strong>${escapeHTML(item.name)}</strong><p>${escapeHTML(item.properties.map(prop=>prop.name).join(' · '))} · Current level ${state.levels[item.id] || 0}</p></div><button class="button primary" data-add="${item.id}" ${added ? 'disabled' : ''} aria-label="${added ? 'Already selected' : 'Add'} ${escapeHTML(item.name)}">${added ? 'Selected' : 'Add'}</button></div>`;
  }).join('') || '<p class="empty">No matching research.</p>';
}
function renderStats() {
  const tree = byId('stats-tree').value;
  const scope = byId('stats-scope').value;
  const query = byId('stats-search').value.trim().toLowerCase();
  const records=[];
  for (const item of data.research) {
    if (tree !== 'all' && item.tree !== tree) continue;
    for (const property of item.properties) {
      if (scope !== 'all' && property.scope !== scope && property.scope !== 'Shared') continue;
      if (!`${item.name} ${property.name}`.toLowerCase().includes(query)) continue;
      for (let level=0;level<=item.maxLevel;level++) records.push({item,property,level});
    }
  }
  byId('stats-body').innerHTML = records.slice(0,statsLimit).map(({item,property,level})=>`<tr><td>${escapeHTML(item.tree)}</td><th scope="row">${escapeHTML(item.name)}</th><td>${escapeHTML(property.name)}</td><td>${escapeHTML(property.scope)}</td><td>${level}</td><td class="number">${formatStat(valueAt(property.values,level),property.unit)}</td><td class="number">+${formatStat(valueAt(property.values,level)-valueAt(property.values,level-1),property.unit)}</td><td>${level ? item.maester[level-1] : '—'}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No matching stat levels.</td></tr>';
  byId('stats-count').textContent = `Showing ${Math.min(statsLimit,records.length)} of ${formatNumber(records.length)} levels`;
  byId('stats-more').hidden = statsLimit >= records.length;
}
function bind() {
  const resetDialog = byId('reset-dialog');
  byId('reset-button').addEventListener('click', () => {
    resetDialog.returnValue = '';
    resetDialog.showModal();
  });
  resetDialog.addEventListener('close', () => {
    if (resetDialog.returnValue !== 'confirm') return;
    commit(resetCalculation(state));
    announce('Calculator reset. Selected research cleared and all efficiency and reduction boosts set to zero.');
  });
  document.addEventListener('click', event=>{
    const tab=event.target.closest('[data-tab]');
    if(tab){switchTab(tab.dataset.tab);return;}
    const add=event.target.closest('[data-add]');
    if(add){addGoal(add.dataset.add);return;}
    const remove=event.target.closest('[data-remove]');
    if(remove){const name=byResearch.get(remove.dataset.remove).name;commit({...state,goals:state.goals.filter(goal=>goal.id!==remove.dataset.remove)});byId('open-picker').focus({preventScroll:true});announce(`${name} removed. Its progress is still saved.`);}
  });
  const editGoal = event=>{
    const input=event.target;
    if(input.type==='checkbox' && event.type==='input')return;
    if(event.type==='input' && input.type==='number' && input.value==='')return;
    if(input.dataset.current){const id=input.dataset.current;commit(setCompletedLevel(state,id,boundedNumber(input.value,0,byResearch.get(id).maxLevel,true)),event.type==='input');}
    else if(input.dataset.desired){const id=input.dataset.desired;commit({...state,goals:state.goals.map(goal=>goal.id===id ? {...goal,level:boundedNumber(input.value,1,byResearch.get(id).maxLevel,true)} : goal)},event.type==='input');}
    else if(input.dataset.achieved){commit(toggleRequirement(state,input.dataset.achieved,Number(input.dataset.required),input.checked));}
  };
  byId('goal-list').addEventListener('input',editGoal);
  byId('goal-list').addEventListener('change',editGoal);
  const editMaester=event=>{if(event.type==='input' && event.target.value==='')return;commit({...state,maester:boundedNumber(event.target.value,1,40,true)},event.type==='input');};
  const editShared=event=>{if(event.type==='input' && event.target.value==='')return;commit({...state,sharedEfficiency:boundedNumber(event.target.value)},event.type==='input');};
  for(const type of ['input','change']){
    byId('maester-level').addEventListener(type,editMaester);
    byId('shared-efficiency').addEventListener(type,editShared);
  }
  const editAdjustment=event=>{
    const input=event.target;
    if(event.type==='input' && input.value==='')return;
    if(input.dataset.efficiency)commit({...state,efficiencies:{...state.efficiencies,[input.dataset.efficiency]:boundedNumber(input.value)}},event.type==='input');
    if(input.dataset.reduction)commit({...state,reductions:{...state.reductions,[input.dataset.reduction]:boundedNumber(input.value,0,100)}},event.type==='input');
  };
  byId('adjustments').addEventListener('input',editAdjustment);
  byId('adjustments').addEventListener('change',editAdjustment);
  byId('open-picker').addEventListener('click',()=>{byId('picker-search').value='';renderPicker();byId('picker-dialog').showModal();byId('picker-search').focus();});
  byId('picker-tree').addEventListener('change',renderPicker);
  byId('picker-search').addEventListener('input',renderPicker);
  for(const id of ['stats-tree','stats-scope','stats-search'])byId(id).addEventListener('input',()=>{statsLimit=60;renderStats();});
  byId('stats-more').addEventListener('click',()=>{statsLimit+=60;renderStats();});
  byId('backup-button').addEventListener('click',()=>{byId('backup-message').textContent='';byId('backup-dialog').showModal();});
  byId('import-button').addEventListener('click',()=>byId('import-file').click());
  byId('export-button').addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify({app:APP_TITLE,version:SCHEMA_VERSION,exportedAt:new Date().toISOString(),progress:state},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=url;link.download='conquest-research-progress.json';document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    byId('backup-message').textContent='Progress exported.';
  });
  byId('import-file').addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;
    try{
      if(file.size>2_000_000)throw new Error('File too large.');
      const backup=JSON.parse(await file.text());
      if(![APP_TITLE,'Conquest Research Atlas'].includes(backup?.app) || !backup.progress || typeof backup.progress.levels!=='object' || backup.progress.levels===null || Array.isArray(backup.progress.levels))throw new Error('Invalid progress file.');
      commit(backup.progress);renderTabs();renderStats();
      byId('backup-message').textContent='Progress restored.';
    }catch(error){console.warn('Progress import failed:',error.message);byId('backup-message').textContent='This file could not be imported. Choose an exported planner progress file.';}
    event.target.value='';
  });
  window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY || event.key===null){state=readProgress();renderTabs();renderCalculator();renderStats();if(byId('picker-dialog').open)renderPicker();}});
}
async function start(){
  try{
    const response=await fetch('./data/research.json');if(!response.ok)throw new Error('Research data could not be loaded.');
    data=await response.json();byResearch=new Map(data.research.map(item=>[item.id,item]));
    state=readProgress();bind();renderTabs();renderCalculator();renderStats();save();
    if(location.hash.startsWith('#tutorial'))history.replaceState(null,'',location.pathname+location.search);
  }catch(error){byId('main').innerHTML=`<section class="panel"><h1>Could not load research data</h1><p>${escapeHTML(error.message)}</p><p>Start the local server using Start App.cmd, then reopen the app.</p></section>`;}
}
start();
