// Loads the calculation block straight out of index.html, so the tests run the code the page runs.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const BEGIN = '// ---- calculation: begin ----';
const END = '// ---- calculation: end ----';

export function inlineScript() {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no inline <script> in index.html');
  return m[1];
}

export function loadCalc() {
  const src = inlineScript();
  const a = src.indexOf(BEGIN), b = src.indexOf(END);
  if (a < 0 || b < a) throw new Error('calculation markers missing from index.html');
  const exported = 'RULES, ULT, JOINT, uniform, divisor, autoRmdAge, project, combine';
  // No document or window in this context: page access inside the block fails loudly.
  return vm.runInNewContext(`${src.slice(a, b)}\n;({ ${exported} })`, {}, { filename: 'index.html#calculation' });
}
