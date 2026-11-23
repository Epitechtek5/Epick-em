import type { StatOption } from './types';

export function optionKey(label: string, reserved: string[]) {
  const base =
    label
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 54)
      .replace(/_+$/g, '') || 'option';
  let key = base;
  let suffix = 2;
  while (reserved.includes(key)) key = `${base}_${suffix++}`;
  return key;
}

export function validOptions(options: StatOption[]) {
  return (
    options.length <= 500 &&
    new Set(options.map((option) => option.key)).size === options.length &&
    options.every(
      ({ key, label }) =>
        key.length <= 64 &&
        /^[a-z0-9]+(_[a-z0-9]+)*$/.test(key) &&
        Array.from(label.trim()).length > 0 &&
        Array.from(label.trim()).length <= 64,
    )
  );
}
