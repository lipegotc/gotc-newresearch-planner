export const STORAGE_KEY = "conquest-research-atlas-v1";
export const APP_TITLE = "GoT: Conquest - Military 3 | Dragon Combat Research Planner";
export const SCHEMA_VERSION = 9;
export const RESEARCH_TREES = ["Military III", "Dragon Combat"];
const DRAGON_MATERIALS = ["Dragon Lore", "Dragon Secrets", "Dragon Tomes"];
export function resourcesForTree(resources, tree) {
  return resources.filter(resource => tree !== "Military III" || !DRAGON_MATERIALS.includes(resource));
}

export function boundedNumber(value, min = 0, max = Number.MAX_SAFE_INTEGER, integer = false) {
  const parsed = Number(value);
  const finite = Number.isFinite(parsed) ? parsed : min;
  return Math.max(min, Math.min(max, integer ? Math.trunc(finite) : finite));
}

// Accept either decimal separator, while rejecting mixed separators and non-numbers.
export function parseBoostInput(value) {
  const text = String(value).trim();
  if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text)) return null;
  const number = Number(text.replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

const record = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};

// Normalize storage and imported backups at the boundary; never trust imported IDs or values.
export function normalizeProgress(raw, research, resources) {
  const input = record(raw);
  const byId = new Map(research.map(item => [item.id, item]));
  const levels = Object.fromEntries(Object.entries(record(input.levels))
    .filter(([id]) => byId.has(id))
    .map(([id, level]) => [id, boundedNumber(level, 0, byId.get(id).maxLevel, true)]));
  const goals = new Map();
  const candidates = Array.isArray(input.goals) ? input.goals : input.target ? [{ id: input.target, level: input.desired }] : [];
  for (const goal of candidates) {
    if (!byId.has(goal?.id)) continue;
    goals.set(goal.id, Math.max(goals.get(goal.id) || 1, boundedNumber(goal.level, 1, byId.get(goal.id).maxLevel, true)));
  }
  const markHistory = Object.fromEntries(Object.entries(record(input.markHistory)).filter(([id, entry]) =>
    byId.has(id) && entry && Number.isInteger(entry.before) && Number.isInteger(entry.after)
    && entry.before >= 0 && entry.before < entry.after && entry.after <= byId.get(id).maxLevel && levels[id] === entry.after));
  const adjustments = (values, max, allowed) => Object.fromEntries(Object.entries(record(values))
    .filter(([resource]) => allowed.includes(resource))
    .map(([resource, value]) => [resource, boundedNumber(value, 0, max)]));
  // Copy legacy common boosts to both trees once; new profiles stay independent.
  const boosts = Object.fromEntries(RESEARCH_TREES.map(tree => {
    const source = input.schemaVersion >= 3 ? record(record(input.boosts)[tree]) : input;
    const allowed = resourcesForTree(resources, tree);
    return [tree, {
      efficiencies: adjustments(source.efficiencies, Number.MAX_SAFE_INTEGER, allowed),
      reductions: adjustments(source.reductions, 100, allowed),
      sharedEfficiency: boundedNumber(source.sharedEfficiency),
      sharedReduction: boundedNumber(source.sharedReduction, 0, 100),
    }];
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    tab: input.schemaVersion >= 2 && ["calculator", "optimizer", "help", "stats"].includes(input.tab) ? input.tab : "calculator",
    goals: [...goals].map(([id, level]) => ({ id, level })), levels, markHistory,
    maester: boundedNumber(input.maester ?? 1, 1, 40, true),
    boosts,
    inventory: Object.fromEntries(Object.entries(adjustments(input.inventory, Number.MAX_SAFE_INTEGER, resources))
      .map(([resource, amount]) => [resource, Math.trunc(amount)])),
    referenceTree: RESEARCH_TREES.includes(input.referenceTree) ? input.referenceTree : "Military III",
    boostTree: RESEARCH_TREES.includes(input.boostTree) ? input.boostTree : "Military III",
    optimizer: normalizeOptimizer(input.optimizer, resources),
  };
}

// Preserve distinct saved weights; give duplicate/new selections an unused value.
export function uniqueOptimizerWeights(goals, selected, raw) {
  const weights = Object.fromEntries(goals.map(goal => [goal, boundedNumber(record(raw)[goal] ?? 1, 1, 100, true)]));
  const reserved = new Set(selected.map(goal => weights[goal]));
  const used = new Set();
  for (const goal of selected) {
    if (used.has(weights[goal])) {
      let next = 1;
      while (reserved.has(next) || used.has(next)) next++;
      weights[goal] = next;
      reserved.add(next);
    }
    used.add(weights[goal]);
  }
  return weights;
}

export function optimizerWeightConflict(goals, weights, goal, value) {
  return goals.find(other => other !== goal && weights[other] === value) || null;
}

function normalizeOptimizer(raw, resources) {
  const input = record(raw);
  const tree = RESEARCH_TREES.includes(input.tree) ? input.tree : 'Military III';
  const groups = ['General', 'Infantry', 'Cavalry', 'Ranged', ...(tree === 'Dragon Combat' ? ['Dragon Specific'] : [])];
  const group = groups.includes(input.group) ? input.group : 'Infantry';
  const goals = group === 'Dragon Specific' ? ['Dragon Defense', 'Dragon Attack vs. Dragon'] : ['Attack', 'Defense', 'Health', 'March Size'];
  const selected = [...new Set((Array.isArray(input.goals) ? input.goals : [input.goal]).filter(goal => goals.includes(goal)))];
  return {
    tree, group, goals:selected.length ? selected : [goals[0]],
    comparison:input.comparison === 'remaining' ? 'remaining' : 'plain',
    weights:uniqueOptimizerWeights(goals, selected.length ? selected : [goals[0]], input.weights),
    kept:Object.fromEntries(Object.entries(record(input.kept)).filter(([resource]) => resources.includes(resource))
      .map(([resource, value]) => [resource, boundedNumber(value, 0, 100)])),
  };
}

export function setCompletedLevel(state, id, level) {
  const levels = { ...state.levels, [id]: level };
  const markHistory = { ...state.markHistory };
  delete markHistory[id];
  return { ...state, levels, markHistory };
}

export function resetCalculation(state) {
  return { ...state, goals: [], boosts: Object.fromEntries(RESEARCH_TREES.map(tree =>
    [tree, { efficiencies: {}, reductions: {}, sharedEfficiency: 0, sharedReduction: 0 }])) };
}

export function toggleRequirement(state, id, required, checked) {
  const current = state.levels[id] || 0;
  if (checked) {
    if (current >= required) return state;
    return { ...state, levels: { ...state.levels, [id]: required },
      markHistory: { ...state.markHistory, [id]: { before: current, after: required } } };
  }
  const previous = state.markHistory[id];
  return setCompletedLevel(state, id, previous?.after === current ? previous.before : 0);
}
