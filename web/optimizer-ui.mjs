import { editResourceAmount } from './resource-input.mjs';
import { statLabel, marchSizeNotice } from './stat-icons.mjs';
import { calculateTreeCosts, formatNumber, formatStat } from './model.mjs';
import { resourcesForTree, boundedNumber, parseBoostInput, setCompletedLevel, optimizerWeightConflict } from './progress.mjs';
import { OPTIMIZER_GROUPS, goalsForGroup, optimizerResearch, objectiveProperties } from './optimizer.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const byId = id => document.getElementById(id);
const snapshot = state => ({levels:state.levels, maester:state.maester, inventory:state.inventory, boosts:state.boosts, optimizer:state.optimizer});

export function createOptimizerUI({data, getState, commit, switchTab, resourceLabel, renderHTML}) {
  let worker = null;
  let result = null;
  let resultStamp = null;
  let busyStamp = null;
  let runId = 0;
  let timeout = null;
  const stamp = () => JSON.stringify(snapshot(getState()));

  function stop(message) {
    runId++;
    worker?.terminate(); worker = null;
    clearTimeout(timeout); timeout = null;
    busyStamp = null;
    byId('optimize-button').disabled = false;
    byId('optimizer-cancel').hidden = true;
    byId('optimizer-results-heading').parentElement.parentElement.removeAttribute('aria-busy');
    if (message) byId('optimizer-message').textContent = message;
  }

  function levelTable(items) {
    const rows = new Map();
    for (const item of items) {
      const name = item.name.replace(/\s+(III|II|I)$/, '');
      const tier = item.name.match(/\s+(III|II|I)$/)?.[1] || 'I';
      if (!rows.has(name)) rows.set(name, {});
      rows.get(name)[tier] = item;
    }
    const levels = getState().levels;
    return `<table class="optimizer-level-table"><thead><tr><th scope="col">Research</th><th scope="col">I</th><th scope="col">II</th><th scope="col">III</th></tr></thead><tbody>${[...rows].map(([name, tiers]) => `<tr><th scope="row">${statLabel(name)}</th>${['I','II','III'].map(tier => tiers[tier] ? `<td><input type="number" min="0" max="${tiers[tier].maxLevel}" step="1" inputmode="numeric" value="${levels[tiers[tier].id] || 0}" data-opt-level="${tiers[tier].id}" data-focus="opt-level-${tiers[tier].id}" aria-label="Optimizer current level for ${escape(tiers[tier].name)}"></td>` : '<td class="muted">—</td>').join('')}</tr>`).join('')}</tbody></table>`;
  }

  function render(preserveEditing = false) {
    const active = document.activeElement;
    const focusKey = preserveEditing ? active?.dataset.focus : null;
    const selection = preserveEditing && active?.type === 'text'
      ? {start:active.selectionStart, end:active.selectionEnd, direction:active.selectionDirection} : null;
    const state = getState();
    const {tree, group, goals, weights, kept} = state.optimizer;
    const currentStamp = stamp();
    if (!preserveEditing) byId('optimizer-weight-error').textContent = '';
    if (busyStamp && busyStamp !== currentStamp) stop('Inputs changed. Run the optimizer again.');
    if (resultStamp && resultStamp !== currentStamp) {
      result = null; resultStamp = null;
      byId('optimizer-message').textContent = 'Inputs changed. Run the optimizer again.';
      byId('optimizer-result-status').hidden = true;
      byId('optimizer-result-content').innerHTML = '<p class="muted">The previous recommendation is out of date. Optimize again with your updated inputs.</p>';
    }
    byId('optimizer-tree').value = tree;
    byId('optimizer-tree-icons').innerHTML = statLabel(tree);
    byId('optimizer-group-icons').innerHTML = group === 'General' ? '' : statLabel(group);
    const groups = [...(tree === 'Dragon Combat' ? ['Dragon Specific'] : []), ...OPTIMIZER_GROUPS];
    byId('optimizer-group').innerHTML = groups.map(value => `<option ${group === value ? 'selected' : ''}>${value}</option>`).join('');
    renderHTML(byId('optimizer-goal-fields'), goalsForGroup(group).map(value => `<div class="optimizer-goal-row"><label class="optimizer-goal-check"><input type="checkbox" data-opt-goal="${escape(value)}" ${goals.includes(value) ? 'checked' : ''} ${goals.length === 1 && goals.includes(value) ? 'disabled' : ''}>${statLabel(value)}</label><label class="optimizer-weight"><span>Importance</span><input type="number" min="1" max="100" step="1" inputmode="numeric" value="${weights[value]}" data-opt-weight="${escape(value)}" data-focus="opt-weight-${escape(value)}" aria-label="${escape(value)} importance" aria-describedby="optimizer-weight-error" ${goals.includes(value) ? '' : 'disabled'}></label></div>`).join(''), preserveEditing);
    for (const radio of byId('optimizer-view').querySelectorAll('[name="optimizer-comparison"]')) radio.checked = radio.value === state.optimizer.comparison;
    byId('optimizer-comparison-note').textContent = state.optimizer.comparison === 'plain'
      ? goals.includes('March Size') && goals.length > 1
        ? 'Plain gain adds weighted percentage bonus points and march troop counts directly. Large march counts can dominate this mix. Choose Remaining progress to compare their relative progress instead.'
        : 'Each added percentage bonus point is multiplied by its importance. Completed levels do not count toward new gains. With only March Size selected, the search maximizes added troops.'
      : 'Each gain is divided by its remaining research bonus reachable at your Maester level, before resource limits, then multiplied by importance. March counts and percentage bonuses are compared as relative progress.';
    if (!preserveEditing || document.activeElement !== byId('optimizer-maester')) byId('optimizer-maester').value = state.maester;
    byId('optimizer-scope-note').textContent = group === 'Dragon Specific'
      ? 'Dragon Defense and Dragon Attack vs. Dragon are separate goals. General and troop research can be included as prerequisites.'
      : group === 'General'
        ? 'General troop bonuses and march size only. Troop-specific and Dragon Specific bonuses are excluded from the goal.'
        : `${group} bonuses + General troop bonuses and march size. Other branches can be included as prerequisites.`;
    const resources = resourcesForTree(data.resources, tree);
    renderHTML(byId('optimizer-inventory-fields'), `<div class="optimizer-resource-columns" aria-hidden="true"><span>Resource / material</span><span>Available</span><span>RSS kept (%)</span></div>${resources.map(resource => `<div class="optimizer-resource-row">${resourceLabel(resource)}<label><span class="field-label">Available</span><input type="text" inputmode="numeric" autocomplete="off" value="${formatNumber(state.inventory[resource] || 0)}" data-opt-inventory="${escape(resource)}" data-focus="opt-inventory-${escape(resource)}" aria-label="Optimizer available ${escape(resource)}" aria-describedby="optimizer-resource-help"></label><label><span class="field-label">RSS kept (%)</span><input type="text" inputmode="decimal" autocomplete="off" value="${kept[resource] || 0}" data-opt-kept="${escape(resource)}" data-focus="opt-kept-${escape(resource)}" aria-label="RSS kept percent for ${escape(resource)}" aria-describedby="optimizer-resource-help"></label></div>`).join('')}`, preserveEditing);
    const profile = state.boosts[tree];
    const boostRow = resource => `<tr><th scope="row">${resourceLabel(resource)}</th>${[['efficiencies','efficiency'],['reductions','reduction']].map(([field, label]) => `<td><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${profile[field][resource] || 0}" data-opt-boost="${field}" data-opt-resource="${escape(resource)}" data-focus="opt-boost-${escape(tree)}-${field}-${escape(resource)}" aria-label="Optimizer ${escape(resource)} ${label} percent"></td>`).join('')}</tr>`;
    renderHTML(byId('optimizer-boost-fields'), `<p class="muted">${tree === 'Military III' ? 'Military 3' : tree} boosts sync both ways with Calculator. Decimals accept a dot or comma.</p>${[['sharedEfficiency','Research Resource Efficiency %'],['sharedReduction','Research Resource Reduction %']].map(([field, label]) => `<label class="shared-input">${label}<input type="text" inputmode="decimal" autocomplete="off" value="${profile[field]}" data-opt-shared="${field}" data-focus="opt-shared-${escape(tree)}-${field}" aria-label="Optimizer ${label}"></label>`).join('')}<table class="adjustment-table"><thead><tr><th scope="col">Resource / material</th><th scope="col">Efficiency %</th><th scope="col">Reduction %</th></tr></thead><tbody>${resources.map(boostRow).join('')}</tbody></table><p class="formula-note">Research Resource Efficiency and Reduction add to Food, Wood, Stone, and Iron only. Materials use their own boosts.</p>`, preserveEditing);
    const relevant = optimizerResearch(data.research, tree, group);
    const selectedIds = new Set(relevant.map(item => item.id));
    renderHTML(byId('optimizer-level-fields'), levelTable(relevant), preserveEditing);
    renderHTML(byId('optimizer-other-level-fields'), levelTable(data.research.filter(item => item.tree === tree && !selectedIds.has(item.id))), preserveEditing);
    if (!byId('optimizer-goal-fields').querySelector('[aria-invalid="true"]')) byId('optimizer-weight-error').textContent = '';
    // Moving a retained input into refreshed markup can blur it; restore the
    // same node and caret so mobile keyboards and partial decimal edits survive.
    if (focusKey) {
      const replacement = [...byId('optimizer-view').querySelectorAll('[data-focus]')]
        .find(input => input.dataset.focus === focusKey);
      replacement?.focus({preventScroll:true});
      if (selection && replacement) replacement.setSelectionRange(selection.start, selection.end, selection.direction);
    }
  }

  function renderResult() {
    const {tree, group, goals, weights} = getState().optimizer;
    const status = byId('optimizer-result-status');
    status.textContent = result.status === 'Optimal' ? 'Optimal for entered values' : 'Best found · search limit';
    status.hidden = false;
    const metricGoals = group === 'Dragon Specific' ? goalsForGroup(group) : ['Attack','Defense','Health','March Size'];
    const metricCards = values => values.map(metric => `<div class="optimizer-metric ${goals.includes(metric) ? 'selected' : ''}"><span>${statLabel(metric, {tree, group:metric === 'March Size' ? 'General' : group})}</span><strong>+${formatStat(result.metrics[metric], metric === 'March Size' ? 'count' : 'percent')}</strong></div>`).join('');
    const objectiveIds = Object.fromEntries(goals.map(goal => [goal, new Set(objectiveProperties(tree, group, goal))]));
    const rows = result.steps.map((step, index) => {
      const gains = goals.map(goal => ({goal, gain:step.gains.filter(entry => objectiveIds[goal].has(entry.property.raw)).reduce((sum, entry) => sum + entry.amount, 0)})).filter(entry => entry.gain > 0);
      const costs = calculateTreeCosts([step], data.resources, getState().boosts).filter(cost => cost.original > 0);
      return `<li class="optimizer-step"><div class="optimizer-step-heading"><span class="optimizer-step-number" aria-hidden="true">${index + 1}</span><div><strong>${statLabel(step.item.name)}</strong><small>Level ${step.current} → ${step.desired}</small></div><span class="optimizer-step-gain">${gains.length ? gains.map(({goal,gain}) => `<span>+${formatStat(gain, goal === 'March Size' ? 'count' : 'percent')} ${statLabel(goal)}</span>`).join('') : 'Requirement'}</span></div><details class="disclosure"><summary>Costs &amp; stat gains</summary><div class="details-content"><div class="optimizer-step-costs">${costs.map(cost => `<div>${resourceLabel(cost.resource)}<strong>${formatNumber(cost.reduced)}</strong></div>`).join('')}</div>${step.gains.filter(entry => entry.amount).map(entry => `<p class="formula-note">${statLabel(entry.property.name)}: +${formatStat(entry.amount, entry.property.unit)}</p>`).join('')}</div></details></li>`;
    }).join('');
    const notice = marchSizeNotice(result.metrics, getState().optimizer);
    const marchWarning = notice ? `<p class="march-priority-warning" role="note"><strong>March Size is the larger displayed gain.</strong> Your ${notice.priorities.map(goal => escape(goal)).join(' / ')} priority still uses its importance weight. March Size counts troops; the other stats use percentages, so these numbers are not directly comparable.${notice.comparison === 'plain' ? ' In Plain gain, large march counts can dominate the score. Try Remaining progress to compare relative gains.' : ' Remaining progress compares the share of each stat’s remaining bonuses, rather than these raw numbers.'} <strong>(March Size is king anyway)</strong></p>` : '';
    const comparison = getState().optimizer.comparison;
    const modeNote = `<p class="formula-note"><strong>${comparison === 'plain' ? 'Plain gain' : 'Remaining progress'}</strong> · ${comparison === 'plain' ? 'Weights apply to actual added bonuses.' : 'Weights apply to the share of remaining research bonuses gained.'}</p>`;
    const costs = result.costs.filter(cost => cost.original || cost.available).map(cost => `<tr><th scope="row">${resourceLabel(cost.resource)}</th><td class="number" data-label="Spend">${formatNumber(Math.ceil(cost.reduced))}</td><td class="number" data-label="Left">${formatNumber(Math.floor(Math.max(0, cost.left)))}</td><td class="number" data-label="RSS kept">${formatNumber(cost.kept)}</td></tr>`).join('');
    byId('optimizer-result-content').innerHTML = `<p class="muted">${statLabel(tree === 'Military III' ? 'Military 3' : tree)} · ${statLabel(group)} · ${goals.map(goal => `${statLabel(goal)}${goals.length > 1 ? ` (importance ${weights[goal]})` : ''}`).join(' + ')}</p>${modeNote}${marchWarning}${goals.length > 1 ? `<details class="disclosure"><summary>How goals are compared</summary><div class="details-content"><p class="formula-note">${comparison === 'plain' ? 'The score adds each selected stat gain multiplied by its importance. Percentage bonuses use their displayed bonus points; March Size uses troop counts. These units differ. Reference totals below are informational and do not affect this mode.' : 'The score divides each selected stat gain by its remaining research bonus reachable at your Maester level, then multiplies by importance. These reference totals exclude completed levels and ignore resource budgets; they are not gains from this plan.'}</p>${result.targets.map(target => `<p class="formula-note">${statLabel(target.goal)}: ${formatStat(target.remaining, target.goal === 'March Size' ? 'count' : 'percent')} remaining in research · importance ${target.weight}${target.remaining ? '' : ' · no reachable gain'}.</p>`).join('')}<p class="formula-note">Higher importance increases a goal’s score contribution. It does not guarantee a larger displayed stat gain. Neither comparison mode sets a minimum gain for a selected goal.</p></div></details>` : ''}<div class="optimizer-metrics">${metricCards(metricGoals)}</div>${group === 'Dragon Specific' ? `<details class="disclosure"><summary>General troop gains from prerequisites</summary><div class="details-content"><div class="optimizer-metrics">${metricCards(['Attack','Defense','Health','March Size'])}</div></div></details>` : '<p class="formula-note">Percentage gains are added research bonuses, including applicable player, marcher, and SOP bonuses.</p>'}<details class="disclosure optimizer-order"><summary>Research Order <span class="summary-hint">${result.steps.length} research items</span></summary><div class="details-content">${result.steps.length ? `<ol class="optimizer-steps">${rows}</ol>` : '<p class="muted">No additional stat gain is reachable within these inputs. Try more resources, lower RSS kept percentages, a higher Maester level, or another goal.</p>'}</div></details><h3 class="optimizer-section-title">Costs &amp; remaining resources</h3><div class="table-scroll optimizer-cost-scroll"><table class="cost-table totals-table"><thead><tr><th scope="col">Resource / material</th><th scope="col" class="number">Spend</th><th scope="col" class="number">Left</th><th scope="col" class="number">RSS kept</th></tr></thead><tbody>${costs || '<tr><td colspan="4">No resources entered or spent.</td></tr>'}</tbody></table></div><p class="formula-note">Left includes the amounts kept unspent. Shared requirements are counted once. Spend is rounded up and leftover amounts down for display. The search optimizes stat gain; equal-gain plans may spend differently.</p><p class="cost-caution"><strong>Use with caution:</strong> These costs are estimates. The game displays boosts to three decimal places but may use more precision internally. Large costs can differ more. Keep a buffer and check the in-game cost.</p><button id="optimizer-use-plan" class="button primary" ${result.steps.length ? '' : 'disabled'}>Use plan in Calculator</button><p class="formula-note">This does not spend inventory or mark any research completed.</p>`;
    byId('optimizer-use-plan').addEventListener('click', () => {
      if (!result || resultStamp !== stamp()) return;
      byId('optimizer-apply-dialog').returnValue = '';
      byId('optimizer-apply-dialog').showModal();
    });
  }

  function optimize() {
    const invalidWeight = byId('optimizer-goal-fields').querySelector('[data-opt-weight][aria-invalid="true"]');
    if (invalidWeight) { invalidWeight.reportValidity(); return; }
    stop();
    result = null; resultStamp = null;
    const input = structuredClone(snapshot(getState()));
    busyStamp = stamp();
    const id = ++runId;
    byId('optimize-button').disabled = true;
    byId('optimizer-cancel').hidden = false;
    byId('optimizer-result-status').hidden = true;
    byId('optimizer-message').textContent = 'Searching research combinations… You can cancel. The search runs on this device.';
    byId('optimizer-result-content').innerHTML = '<p class="muted">Searching within all resource budgets and prerequisite requirements…</p>';
    byId('optimizer-results-heading').parentElement.parentElement.setAttribute('aria-busy', 'true');
    try {
      worker = new Worker(new URL('./optimizer-worker.mjs', import.meta.url), {type:'module'});
      worker.addEventListener('message', event => {
        if (event.data.id !== id || id !== runId) return;
        if (event.data.error) {
          stop(event.data.error);
          byId('optimizer-result-content').innerHTML = '<p class="muted">No recommendation is available. Check the inputs and try again.</p>';
          return;
        }
        if (busyStamp !== stamp()) { stop('Inputs changed. Optimize again.'); return; }
        result = event.data.result;
        resultStamp = busyStamp;
        stop(result.status === 'Optimal' ? 'Search complete. Best score proved for the entered settings, within solver numerical tolerances.' : 'Search limit reached. Showing the best validated plan found; a better plan may exist.');
        renderResult();
        if (window.matchMedia('(max-width:950px)').matches && !byId('optimizer-view').hidden) {
          byId('optimizer-results-heading').scrollIntoView({behavior:'instant', block:'start'});
        }
      });
      worker.addEventListener('error', () => {
        stop('The optimizer could not start. Refresh the page or try a browser with WebAssembly support.');
        byId('optimizer-result-content').innerHTML = '<p class="muted">Optimizer unavailable. Your saved inputs are safe.</p>';
      });
      worker.postMessage({id, data, input});
      timeout = setTimeout(() => {
        stop('The search took too long to respond. Your inputs are saved; try again.');
        byId('optimizer-result-content').innerHTML = '<p class="muted">Search stopped. No recommendation was applied.</p>';
      }, 45000);
    } catch (error) { stop(`Unable to start the optimizer: ${error.message}`); }
  }

  function updateInput(event) {
    const input = event.target;
    const state = getState();
    if (input.dataset.optGoal) {
      if (event.type !== 'change') return;
      const goal = input.dataset.optGoal;
      const goals = input.checked ? [...state.optimizer.goals, goal] : state.optimizer.goals.filter(value => value !== goal);
      if (goals.length) commit({...state, optimizer:{...state.optimizer, goals}});
      return;
    }
    if (event.type === 'input' && input.type === 'number' && input.value === '' && !input.dataset.optWeight) return;
    if (input.name === 'optimizer-comparison') {
      if (event.type === 'change') commit({...state, optimizer:{...state.optimizer, comparison:input.value}});
      return;
    }
    if (input.dataset.optWeight) {
      const value = boundedNumber(input.value, 1, 100, true);
      const conflict = optimizerWeightConflict(state.optimizer.goals, state.optimizer.weights, input.dataset.optWeight, value);
      const message = input.value === '' ? 'Enter an importance from 1 to 100.' : conflict ? `${conflict} already uses importance ${value}. Choose a different weight for ${input.dataset.optWeight}.` : '';
      const wasInvalid = input.hasAttribute('aria-invalid');
      input.setCustomValidity(message);
      if (message) {
        input.setAttribute('aria-invalid', 'true');
        byId('optimizer-weight-error').textContent = message;
        stop('Correct the importance weights before optimizing.');
        result = null; resultStamp = null;
        byId('optimizer-result-status').hidden = true;
        byId('optimizer-result-content').innerHTML = '<p class="muted">Correct the importance weights, then optimize again.</p>';
        return;
      }
      input.removeAttribute('aria-invalid');
      byId('optimizer-weight-error').textContent = '';
      if (wasInvalid) byId('optimizer-message').textContent = 'Importance corrected. Optimize again with your updated inputs.';
      if (event.type === 'change' || Number(input.value) !== value) input.value = String(value);
      if (value !== state.optimizer.weights[input.dataset.optWeight]) commit({...state, optimizer:{...state.optimizer, weights:{...state.optimizer.weights, [input.dataset.optWeight]:value}}}, event.type === 'input');
      return;
    }
    if (input.dataset.optInventory) {
      const amount = editResourceAmount(input, event.type === 'change');
      if (amount !== null) commit({...state, inventory:{...state.inventory, [input.dataset.optInventory]:amount}}, event.type === 'input');
      return;
    }
    if (input.dataset.optLevel || input.id === 'optimizer-maester') {
      const max = input.dataset.optLevel ? data.research.find(item => item.id === input.dataset.optLevel).maxLevel : input.id === 'optimizer-maester' ? 40 : Number.MAX_SAFE_INTEGER;
      const amount = boundedNumber(input.value, input.id === 'optimizer-maester' ? 1 : 0, max, true);
      if (event.type === 'change' || Number(input.value) !== amount) input.value = String(amount);
      if (input.dataset.optLevel) commit(setCompletedLevel(state, input.dataset.optLevel, amount), event.type === 'input');
      else commit({...state, maester:amount}, event.type === 'input');
      return;
    }
    const kept = input.dataset.optKept;
    const field = input.dataset.optBoost;
    const shared = input.dataset.optShared;
    if (!kept && !field && !shared) return;
    const profile = state.boosts[state.optimizer.tree];
    const resource = input.dataset.optResource;
    const saved = kept ? state.optimizer.kept[kept] || 0 : shared ? profile[shared] : profile[field][resource] || 0;
    const parsed = parseBoostInput(input.value);
    if (parsed === null && event.type === 'input') {
      if (/^[.,]?$/.test(input.value.trim())) input.removeAttribute('aria-invalid');
      else input.setAttribute('aria-invalid', 'true');
      return;
    }
    const value = boundedNumber(parsed ?? (input.value.trim() === '' ? 0 : saved), 0,
      kept || field === 'reductions' || shared === 'sharedReduction' ? 100 : Number.MAX_SAFE_INTEGER);
    input.removeAttribute('aria-invalid');
    if (event.type === 'change' || value !== parsed) input.value = String(value);
    if (value === saved) return;
    if (kept) commit({...state, optimizer:{...state.optimizer, kept:{...state.optimizer.kept, [kept]:value}}}, true);
    else {
      const updated = shared ? {...profile, [shared]:value} : {...profile, [field]:{...profile[field], [resource]:value}};
      commit({...state, boosts:{...state.boosts, [state.optimizer.tree]:updated}}, true);
    }
  }

  for (const [id, field] of [['optimizer-tree','tree'], ['optimizer-group','group']]) {
    byId(id).addEventListener('change', event => commit({...getState(), optimizer:{...getState().optimizer, [field]:event.target.value}}));
  }
  for (const type of ['input','change']) byId('optimizer-view').addEventListener(type, updateInput);
  byId('optimize-button').addEventListener('click', optimize);
  byId('optimizer-cancel').addEventListener('click', () => {
    stop('Search canceled. Your Calculator plan is unchanged.');
    byId('optimizer-result-content').innerHTML = '<p class="muted">Search canceled. Optimize again when ready.</p>';
  });
  byId('optimizer-apply-dialog').addEventListener('close', () => {
    if (byId('optimizer-apply-dialog').returnValue !== 'confirm' || !result || resultStamp !== stamp()) return;
    commit({...getState(), goals:result.goals});
    switchTab('calculator');
    byId('app-message').textContent = 'Calculator manual plan replaced with the optimized research plan.';
  });
  return {render};
}
