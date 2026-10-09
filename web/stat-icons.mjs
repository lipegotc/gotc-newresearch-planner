const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function statIconNames(text, context = {}) {
  const words = `${context.tree || ''} ${context.group || ''} ${text}`.toLowerCase();
  const icons = [];
  if (/\bmilitary\s+(?:iii|3)\b/i.test(String(text))) icons.push('military-3');
  if (/\bdragon\b/.test(words)) icons.push('dragon');
  for (const troop of ['infantry','cavalry','ranged']) if (new RegExp(`\\b${troop}\\b`).test(words)) icons.push(troop);
  if (/\bmarch\s+size\b/.test(words)) icons.push('march-size');
  else for (const stat of ['attack','defense','health']) if (new RegExp(`\\b${stat}\\b`).test(String(text).toLowerCase())) icons.push(stat);
  return icons;
}

export function statLabel(text, context = {}) {
  const icons = statIconNames(text, context);
  if (!icons.length) return escape(text);
  return `<span class="stat-label"><span class="stat-icons" aria-hidden="true">${icons.map(icon => `<img class="stat-icon" src="./assets/stats/${icon}.png" alt="" width="22" height="22" decoding="async">`).join('')}</span><span class="stat-label-text">${escape(text)}</span></span>`;
}

// Compare displayed amounts only to explain the apparent mismatch, never to
// claim that a troop count is more valuable than a percentage combat bonus.
export function marchSizeNotice(metrics, optimizer) {
  const others = optimizer.goals.filter(goal => goal !== 'March Size');
  if (!others.length || !(metrics['March Size'] > 0)) return null;
  const highest = Math.max(...others.map(goal => optimizer.weights[goal]));
  const priorities = others.filter(goal => optimizer.weights[goal] === highest);
  if (priorities.some(goal => metrics['March Size'] <= (metrics[goal] || 0) * 100)) return null;
  return {priorities, march:metrics['March Size'], comparison:optimizer.comparison};
}

// Static Help text gets small icons on explicit labels, without altering
// paragraphs, form values, accessible names, or the contents of native selects.
export function decorateStaticStatLabels(root) {
  for (const element of root.querySelectorAll('strong, h3')) {
    if (element.children.length) continue;
    const text = element.textContent;
    if (statIconNames(text).length) element.innerHTML = statLabel(text);
  }
}
