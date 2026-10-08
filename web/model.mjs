export const BASE_RESOURCES = ["Food", "Wood", "Stone", "Iron"];

export function valueAt(values, level) {
  return level > 0 ? Number(values[Math.min(level, values.length) - 1] || 0) : 0;
}

export function buildPlan(research, targetId, targetLevel, levels = {}) {
  return buildMultiPlan(research, [{ id: targetId, level: targetLevel }], levels);
}

export function buildMultiPlan(research, goals, levels = {}) {
  const byId = new Map(research.map(item => [item.id, item]));
  const requested = new Map();
  const visiting = new Set();
  function visit(id, level) {
    const item = byId.get(id);
    if (!item) throw new Error(`Unknown prerequisite ${id}`);
    const desired = Math.max(1, Math.min(item.maxLevel, Math.trunc(Number(level) || 1)));
    requested.set(id, Math.max(requested.get(id) || 0, desired));
    // Any completed rank proves this research's initial unlock requirements were met.
    // Keep the research itself visible, but do not charge its ancestors again.
    if (Math.trunc(Number(levels[id])) > 0) return;
    if (visiting.has(id)) throw new Error(`Circular prerequisite at ${item.name}`);
    visiting.add(id);
    for (const requirement of item.requires) visit(requirement.id, requirement.level);
    visiting.delete(id);
  }
  for (const goal of goals) visit(goal.id, goal.level);
  return [...requested].map(([id, desired]) => {
    const item = byId.get(id);
    const current = Math.max(0, Math.min(item.maxLevel, Math.trunc(Number(levels[id]) || 0)));
    const missing = [];
    for (let level = current + 1; level <= desired; level++) missing.push(level);
    return {
      item, current, desired, missing,
      maesterNeeded: Math.max(0, ...missing.map(level => item.maester[level - 1])),
      gains: item.properties.map(prop => ({
        property: prop,
        amount: desired > current ? valueAt(prop.values, desired) - valueAt(prop.values, current) : 0,
      })),
    };
  }).sort((a, b) => a.item.tree.localeCompare(b.item.tree) || a.item.row - b.item.row || a.item.column - b.item.column);
}

export function calculateCosts(plan, resources, efficiencies = {}, reductions = {}, sharedEfficiency = 0, sharedReduction = 0) {
  return resources.map(resource => {
    let original = 0;
    for (const step of plan) {
      const entries = step.item.costs[resource] || [];
      for (const level of step.missing) original += Number(entries[level - 1] || 0);
    }
    const reduction = Math.min(100, Math.max(0, Number(reductions[resource]) || 0)
      + (BASE_RESOURCES.includes(resource) ? Math.max(0, Number(sharedReduction) || 0) : 0));
    const specific = Math.max(0, Number(efficiencies[resource]) || 0);
    const efficiency = specific + (BASE_RESOURCES.includes(resource) ? Math.max(0, Number(sharedEfficiency) || 0) : 0);
    const reduced = original * (1 - reduction / 100) / (1 + efficiency / 100);
    return { resource, original, reduction, efficiency, reduced, saved: original - reduced };
  });
}

// Discount each tree before summing: a combined plan can have different boosts.
export function calculateTreeCosts(plan, resources, boosts = {}) {
  const groups = new Map();
  for (const step of plan) {
    if (!groups.has(step.item.tree)) groups.set(step.item.tree, []);
    groups.get(step.item.tree).push(step);
  }
  const totals = resources.map(resource => ({ resource, original: 0, reduced: 0, saved: 0 }));
  for (const [tree, steps] of groups) {
    const profile = boosts[tree] || {};
    const costs = calculateCosts(steps, resources, profile.efficiencies, profile.reductions, profile.sharedEfficiency, profile.sharedReduction);
    costs.forEach((cost, index) => {
      totals[index].original += cost.original;
      totals[index].reduced += cost.reduced;
      totals[index].saved += cost.saved;
    });
  }
  return totals;
}

export function formatNumber(number, digits = 0) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(number);
}

export function formatStat(value, unit) {
  return unit === "count" ? formatNumber(value) : `${(value * 100).toFixed(2)}%`;
}

// The reference uses source level costs directly, never a prerequisite plan or discounts.
export function researchReference(research, resources, tree, scope = 'all', query = '') {
  const search = query.trim().toLowerCase();
  const items = research.filter(item => item.tree === tree);
  const materials = resources.filter(resource => items.some(item => item.costs[resource]?.some(cost => cost > 0)));
  const rows = [];
  for (const item of items) {
    for (const property of item.properties) {
      if (scope !== 'all' && property.scope !== scope && property.scope !== 'General') continue;
      if (!`${item.name} ${property.name}`.toLowerCase().includes(search)) continue;
      for (let level = 1; level <= item.maxLevel; level++) rows.push({
        item, property, level,
        cumulative: valueAt(property.values, level),
        gain: valueAt(property.values, level) - valueAt(property.values, level - 1),
        costs: materials.map(resource => level ? Number(item.costs[resource]?.[level - 1] || 0) : 0),
      });
    }
  }
  return { materials, rows };
}

// Max the selected troop scope and General research, then add only the minimum
// ranks of other research needed to unlock them. This reference starts at zero.
export function referenceTotals(research, resources, tree, scope = 'all') {
  const goals = research.filter(item => item.tree === tree && item.properties.some(property =>
    scope === 'all' || property.scope === scope || property.scope === 'General'))
    .map(item => ({id:item.id, level:item.maxLevel}));
  const plan = buildMultiPlan(research, goals);
  const selected = new Set(goals.map(goal => goal.id));
  return {
    goals, plan,
    prerequisites: plan.filter(step => !selected.has(step.item.id)),
    costs: calculateCosts(plan, resources),
    maester: Math.max(0, ...plan.map(step => step.maesterNeeded)),
  };
}

// Subtract a shared inventory once from the whole plan, after tree-specific boosts.
export function resourceShortfalls(costs, inventory = {}) {
  return costs.map(cost => {
    const amount = Number(inventory[cost.resource] ?? 0);
    const available = Number.isFinite(amount) ? Math.max(0, amount) : 0;
    return {...cost, available, missing: Math.max(0, cost.reduced - available)};
  });
}
