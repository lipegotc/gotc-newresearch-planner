export const STORAGE_KEY = "conquest-research-atlas-v1";
export const APP_TITLE = "GoT: Conquest - Military 3 | Dragon Combat Research Planner";
export const SCHEMA_VERSION = 2;

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
  const adjustments = (values, max) => Object.fromEntries(Object.entries(record(values))
    .filter(([resource]) => resources.includes(resource))
    .map(([resource, value]) => [resource, boundedNumber(value, 0, max)]));
  return {
    schemaVersion: SCHEMA_VERSION,
    tab: input.schemaVersion === SCHEMA_VERSION && ["calculator", "help", "stats"].includes(input.tab) ? input.tab : "calculator",
    goals: [...goals].map(([id, level]) => ({ id, level })), levels, markHistory,
    maester: boundedNumber(input.maester ?? 1, 1, 40, true),
    efficiencies: adjustments(input.efficiencies, Number.MAX_SAFE_INTEGER),
    reductions: adjustments(input.reductions, 100),
    sharedEfficiency: boundedNumber(input.sharedEfficiency),
  };
}

export function setCompletedLevel(state, id, level) {
  const levels = { ...state.levels, [id]: level };
  const markHistory = { ...state.markHistory };
  delete markHistory[id];
  return { ...state, levels, markHistory };
}

export function resetCalculation(state) {
  return { ...state, goals: [], efficiencies: {}, reductions: {}, sharedEfficiency: 0 };
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
