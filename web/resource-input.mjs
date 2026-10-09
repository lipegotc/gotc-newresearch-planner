import { formatNumber } from './model.mjs';

// Inventory is a whole-number amount. Accept grouping from either common
// locale so copied resource totals remain usable on another device.
export function editResourceAmount(input, final = false) {
  const text = input.value;
  if (!/^[\d.,\s]*$/.test(text)) {
    input.setCustomValidity('Enter a whole resource amount using digits and thousands separators.');
    return null;
  }
  input.setCustomValidity('');
  const digits = text.replace(/\D/g, '');
  const amount = Math.min(Number.MAX_SAFE_INTEGER, Number(digits || 0));
  if (!digits && !final) return 0;
  const before = text.slice(0, input.selectionStart ?? text.length).replace(/\D/g, '').length;
  const formatted = formatNumber(amount);
  input.value = formatted;
  let caret = 0;
  let seen = 0;
  while (caret < formatted.length && seen < before) {
    if (/\d/.test(formatted[caret])) seen++;
    caret++;
  }
  input.setSelectionRange(caret, caret);
  return amount;
}
