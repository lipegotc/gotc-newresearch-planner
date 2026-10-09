import { valueAt, calculateCosts, calculateTreeCosts, buildMultiPlan } from './model.mjs';

export const OPTIMIZER_GROUPS = ['General', 'Infantry', 'Cavalry', 'Ranged'];
export const TROOP_GOALS = ['Attack', 'Defense', 'Health', 'March Size'];
export const DRAGON_GOALS = ['Dragon Defense', 'Dragon Attack vs. Dragon'];
const GENERAL = {
  Attack: ['troop-attack', 'troop-attack-vs-player', 'marcher-troop-attack-vs-player'],
  Defense: ['troop-defense', 'troop-defense-vs-player'],
  Health: ['troop-health', 'troop-health-vs-player'],
  'March Size': ['max-march-size'],
};
const numberText = number => Number(number.toPrecision(14)).toString();

export function goalsForGroup(group) {
  return group === 'Dragon Specific' ? DRAGON_GOALS : TROOP_GOALS;
}

// Explicit property IDs keep conditional troop stats separate from dragon stats.
export function objectiveProperties(tree, group, goal) {
  if (tree === 'Dragon Combat' && group === 'Dragon Specific') {
    return goal === 'Dragon Defense' ? ['dragon-defense']
      : goal === 'Dragon Attack vs. Dragon' ? ['dragon-attack-vs-dragon'] : [];
  }
  if (!OPTIMIZER_GROUPS.includes(group) || !TROOP_GOALS.includes(goal)) return [];
  const prefix = tree === 'Dragon Combat' ? 'dragon-' : '';
  const ids = GENERAL[goal].map(id => prefix + id);
  if (group === 'General' || goal === 'March Size') return ids;
  const troop = group.toLowerCase();
  if (tree === 'Dragon Combat') {
    if (goal === 'Attack') ids.push(`dragon-${troop}-attack-vs-player`);
  } else if (goal === 'Attack') {
    ids.push(`${troop}-attack`, `${troop}-attack-vs-player`, `${troop}-attack-vs-seat-of-power`);
  } else if (goal === 'Defense') {
    ids.push(`${troop}-defense`, `${troop}-defense-vs-seat-of-power`);
  } else if (goal === 'Health') {
    ids.push(`${troop}-health-vs-seat-of-power`);
  }
  return ids;
}

export function optimizerBudgets(resources, inventory, kept) {
  return resources.map(resource => {
    const available = Math.max(0, Number(inventory[resource]) || 0);
    const percent = Math.min(100, Math.max(0, Number(kept[resource]) || 0));
    const budget = Math.floor(available * (1 - percent / 100));
    return {resource, available, percent, budget, kept:available - budget};
  });
}

export function optimizerResearch(research, tree, group) {
  const ids = new Set(goalsForGroup(group).flatMap(goal => objectiveProperties(tree, group, goal)));
  return research.filter(item => item.tree === tree && item.properties.some(prop => ids.has(prop.raw)));
}

// Percentage properties are stored as fractions: use displayed bonus points
// for plain gain. March size keeps its native troop-count unit.
function combinedScore(targets, gains, comparison) {
  return targets.reduce((sum, target) => {
    const gain = gains[target.goal] || 0;
    const contribution = comparison === 'plain'
      ? gain * (target.goal === 'March Size' ? 1 : 100)
      : target.remaining > 0 ? gain / target.remaining : 0;
    return sum + target.weight * contribution;
  }, 0);
}

export function compileOptimization(data, input) {
  const { tree, group } = input.optimizer;
  const selected = input.optimizer.goals || [input.optimizer.goal];
  const weights = selected.map(goal => input.optimizer.weights?.[goal] || 1);
  if (new Set(weights).size !== weights.length) throw new Error('Each selected goal must have a different importance weight.');
  const properties = Object.fromEntries(selected.map(goal => [goal, new Set(objectiveProperties(tree, group, goal))]));
  const objectiveIds = new Set(Object.values(properties).flatMap(ids => [...ids]));
  if (!objectiveIds.size) throw new Error('Choose a valid research group and goal.');
  const byId = new Map(data.research.map(item => [item.id, item]));
  const candidates = data.research.filter(item => item.tree === tree && item.properties.some(prop => objectiveIds.has(prop.raw)));
  const wanted = new Map();
  const visiting = new Set();
  function include(id, level) {
    const item = byId.get(id);
    if (!item || item.tree !== tree) throw new Error('Invalid optimizer prerequisite.');
    if (visiting.has(id)) throw new Error('Circular research prerequisite.');
    if ((wanted.get(id) || 0) >= level) return;
    wanted.set(id, level);
    if ((input.levels[id] || 0) > 0) return;
    visiting.add(id);
    for (const requirement of item.requires) include(requirement.id, requirement.level);
    visiting.delete(id);
  }
  for (const item of candidates) include(item.id, item.maxLevel);
  const budgets = optimizerBudgets(data.resources, input.inventory, input.optimizer.kept);
  const variables = [];
  const ranks = new Map();
  for (const [id, wantedLevel] of wanted) {
    const item = byId.get(id);
    const current = input.levels[id] || 0;
    for (let level = current + 1; level <= wantedLevel; level++) {
      // A research cannot skip a rank whose building requirement is unmet.
      if (item.maester[level - 1] > input.maester) break;
      const name = `x${variables.length}`;
      const gains = Object.fromEntries(selected.map(goal => [goal, item.properties.filter(prop => properties[goal].has(prop.raw))
        .reduce((sum, prop) => sum + valueAt(prop.values, level) - valueAt(prop.values, level - 1), 0)]));
      const costs = calculateCosts([{item, missing:[level]}], data.resources,
        input.boosts[tree].efficiencies, input.boosts[tree].reductions,
        input.boosts[tree].sharedEfficiency, input.boosts[tree].sharedReduction);
      const variable = {name, id, level, gains, costs:costs.map(cost => cost.reduced)};
      variables.push(variable);
      ranks.set(`${id}:${level}`, variable);
    }
  }
  // Normalize unlike units against remaining gains reachable at this building
  // level, ignoring resource budgets. Unreachable prerequisite chains contribute
  // neither to denominators nor to the objective.
  const reachable = new Map();
  function canReach(variable) {
    if (!variable) return false;
    if (reachable.has(variable.name)) return reachable.get(variable.name);
    const item = byId.get(variable.id);
    const current = input.levels[item.id] || 0;
    const valid = variable.level > current + 1
      ? canReach(ranks.get(`${item.id}:${variable.level - 1}`))
      : current > 0 || item.requires.every(req => (input.levels[req.id] || 0) >= req.level || canReach(ranks.get(`${req.id}:${req.level}`)));
    reachable.set(variable.name, valid);
    return valid;
  }
  const targets = selected.map(goal => ({
    goal, weight:input.optimizer.weights?.[goal] || 1,
    remaining:variables.filter(canReach).reduce((sum, variable) => sum + variable.gains[goal], 0),
  }));
  for (const variable of variables) {
    variable.gain = !canReach(variable) ? 0 : selected.length === 1 ? variable.gains[selected[0]]
      : combinedScore(targets, variable.gains, input.optimizer.comparison || 'plain');
  }
  const constraints = [];
  const forcedZero = new Set();
  for (const variable of variables) {
    const item = byId.get(variable.id);
    const current = input.levels[item.id] || 0;
    if (variable.level > current + 1) {
      const previous = ranks.get(`${item.id}:${variable.level - 1}`);
      constraints.push(`${variable.name} - ${previous.name} <= 0`);
    } else if (current === 0) {
      for (const req of item.requires) {
        if ((input.levels[req.id] || 0) >= req.level) continue;
        const prerequisite = ranks.get(`${req.id}:${req.level}`);
        if (prerequisite) constraints.push(`${variable.name} - ${prerequisite.name} <= 0`);
        else forcedZero.add(variable.name);
      }
    }
  }
  budgets.forEach(({budget}, index) => {
    const entries = variables.filter(variable => variable.costs[index] > 0);
    if (!budget) {
      entries.forEach(variable => forcedZero.add(variable.name));
    } else if (entries.length) {
      // Scale rows to resource budgets, keeping billion-unit resources well conditioned.
      constraints.push(entries.map(variable => `${numberText(variable.costs[index] / budget)} ${variable.name}`).join(' + ') + ' <= 1');
    }
  });
  for (const name of forcedZero) constraints.push(`${name} = 0`);
  // Scaling converts small percentage increments to useful objective coefficients.
  const objective = variables.filter(variable => variable.gain > 0)
    .map(variable => `${numberText(variable.gain * 1000000)} ${variable.name}`).join(' + ');
  const lp = objective ? `Maximize\n gain: ${objective}\nSubject To\n${constraints.map((row, index) => ` c${index}: ${row}`).join('\n')}\nBinary\n ${variables.map(variable => variable.name).join(' ')}\nEnd` : null;
  return {variables, budgets, lp, objectiveIds:[...objectiveIds], targets};
}

export function orderedResearch(plan, levels) {
  const byId = new Map(plan.map(step => [step.item.id, step]));
  const ordered = [];
  const seen = new Set();
  const visiting = new Set();
  function visit(step) {
    if (seen.has(step.item.id) || !step.missing.length) return;
    if (visiting.has(step.item.id)) throw new Error('Circular plan.');
    visiting.add(step.item.id);
    if (!(levels[step.item.id] > 0)) {
      for (const requirement of step.item.requires) {
        if ((levels[requirement.id] || 0) >= requirement.level) continue;
        const requiredStep = byId.get(requirement.id);
        if (!requiredStep || requiredStep.desired < requirement.level) throw new Error('Plan has an unmet prerequisite.');
        visit(requiredStep);
      }
    }
    visiting.delete(step.item.id);
    seen.add(step.item.id);
    ordered.push(step);
  }
  for (const step of plan) visit(step);
  return ordered;
}

export function evaluateOptimization(data, input, goals, status = 'Best found') {
  const plan = buildMultiPlan(data.research, goals, input.levels);
  const steps = orderedResearch(plan, input.levels);
  if (steps.some(step => step.maesterNeeded > input.maester)) throw new Error('Plan exceeds the Maester level.');
  const budgets = optimizerBudgets(data.resources, input.inventory, input.optimizer.kept);
  const costs = calculateTreeCosts(plan, data.resources, input.boosts).map((cost, index) => {
    const budget = budgets[index];
    // An incumbent must pass the calculator's independent budget check.
    if (cost.reduced > budget.budget + 0.00001) throw new Error('Plan exceeds a resource budget.');
    return {...cost, ...budget, left:budget.available - cost.reduced};
  });
  const metrics = Object.fromEntries([...TROOP_GOALS, ...DRAGON_GOALS].map(goal => {
    const group = DRAGON_GOALS.includes(goal) ? 'Dragon Specific'
      : input.optimizer.group === 'Dragon Specific' ? 'General' : input.optimizer.group;
    const ids = new Set(objectiveProperties(input.optimizer.tree, group, goal));
    const gain = steps.reduce((sum, step) => sum + step.gains.filter(entry => ids.has(entry.property.raw))
      .reduce((total, entry) => total + entry.amount, 0), 0);
    return [goal, gain];
  }));
  const selected = input.optimizer.goals || [input.optimizer.goal];
  const {targets} = compileOptimization(data, input);
  const objective = selected.length === 1 ? metrics[selected[0]] || 0
    : combinedScore(targets, metrics, input.optimizer.comparison || 'plain');
  return {goals, steps, costs, metrics, status, objective, targets};
}

export function solveOptimization(data, input, highs, timeLimit = 12) {
  const compiled = compileOptimization(data, input);
  if (!compiled.lp) return evaluateOptimization(data, input, [], 'Optimal');
  const solution = highs.solve(compiled.lp, {
    output_flag:false, time_limit:timeLimit, mip_rel_gap:0, mip_abs_gap:0,
    random_seed:0, mip_feasibility_tolerance:1e-9,
  });
  const levels = new Map();
  for (const variable of compiled.variables) {
    if (solution.Columns?.[variable.name]?.Primal > 0.5) levels.set(variable.id, Math.max(levels.get(variable.id) || 0, variable.level));
  }
  const objectiveIds = new Set(compiled.objectiveIds);
  const goals = [...levels].filter(([id]) => data.research.find(item => item.id === id).properties.some(prop => objectiveIds.has(prop.raw)))
    .map(([id, level]) => ({id, level}));
  const result = evaluateOptimization(data, input, goals, solution.Status === 'Optimal' ? 'Optimal' : 'Best found');
  if (result.status !== 'Optimal' && !result.objective) throw new Error('No usable plan was found within the search limit. Try again or allow more resources.');
  return result;
}
