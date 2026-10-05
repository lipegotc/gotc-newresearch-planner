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

export function calculateCosts(plan, resources, efficiencies = {}, reductions = {}, sharedEfficiency = 0) {
  return resources.map(resource => {
    let original = 0;
    for (const step of plan) {
      const entries = step.item.costs[resource] || [];
      for (const level of step.missing) original += Number(entries[level - 1] || 0);
    }
    const reduction = Math.max(0, Math.min(100, Number(reductions[resource]) || 0));
    const specific = Math.max(0, Number(efficiencies[resource]) || 0);
    const efficiency = specific + (BASE_RESOURCES.includes(resource) ? Math.max(0, Number(sharedEfficiency) || 0) : 0);
    const reduced = original * (1 - reduction / 100) / (1 + efficiency / 100);
    return { resource, original, reduction, efficiency, reduced, saved: original - reduced };
  });
}

export function formatNumber(number, digits = 0) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(number);
}

export function formatStat(value, unit) {
  return unit === "count" ? formatNumber(value) : `${(value * 100).toFixed(2)}%`;
}
