import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadCalc, inlineScript } from './load.mjs';

const { RULES, ULT, JOINT, uniform, divisor, autoRmdAge, project, combine } = loadCalc();
const schwab = JSON.parse(readFileSync(new URL('./fixtures/schwab.json', import.meta.url), 'utf8'));

// One person, $500,000 at 6%, RMD only, withdrawals at year end: the settings that match Schwab.
const BASE = {
  birthYear: 1953, startYear: 2026, endAge: 100, balance: 500000, rate: 6,
  draw: 0, drawStartAge: 0, drawGrowth: 0, afterRmd: 'rmd', timing: 'end',
  spouseBirthYear: null, rmdAge: 73, oneOff: 0, oneOffYear: null,
};
const at = (rows, year) => rows.find(r => r.year === year);
// Objects made inside the loaded page code have that context's prototypes; compare them as plain data.
const plain = x => JSON.parse(JSON.stringify(x));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('the page script parses', () => {
  new vm.Script(inlineScript(), { filename: 'index.html' });
});

for (const c of schwab.cases) {
  // Schwab rounds each RMD to the cent and carries that into the balance; we don't round.
  test(`matches Schwab: ${c.name}`, () => {
    const rows = project(c.inputs);
    for (const [age, endBalance, rmd] of c.rows) {
      const r = rows.find(x => x.age === age);
      assert.ok(r, `no row for age ${age}`);
      near(r.rmd, rmd, 0.011, `RMD at age ${age}`);
      near(r.end, endBalance, 0.021, `ending balance at age ${age}`);
    }
  });
}

test('RMD start age by birth year (SECURE 2.0; 1959 per the proposed regulation)', () => {
  const cases = [[1945, 72], [1950, 72], [1951, 73], [1958, 73], [1959, 73], [1960, 75], [1970, 75]];
  for (const [born, age] of cases) assert.equal(autoRmdAge(born), age, `born ${born}`);
});

test('Uniform Lifetime Table spot values (Pub. 590-B Table III)', () => {
  const spots = { 72: 27.4, 73: 26.5, 75: 24.6, 80: 20.2, 90: 12.2, 100: 6.4, 110: 3.5, 120: 2.0 };
  for (const [age, f] of Object.entries(spots)) assert.equal(uniform(Number(age)), f, `age ${age}`);
  assert.equal(uniform(125), 2.0, 'ages over 120 use 2.0');
  for (let age = 72; age <= 120; age++) assert.ok(ULT[age] > 0, `age ${age} present`);
  for (let age = 73; age <= 120; age++) assert.ok(ULT[age] < ULT[age - 1], `factor falls at age ${age}`);
});

test('Joint and Last Survivor Table shape and spot values (Treas. Reg. §1.401(a)(9)-9(d))', () => {
  for (let age = 72; age <= 120; age++) {
    // Each row covers spouse ages 0 through owner age − 11.
    assert.equal(JOINT[age].length, age - 10, `row ${age} length`);
    assert.ok(JOINT[age].every(f => f > 0), `row ${age} all positive`);
  }
  assert.equal(JOINT[73][58], 30.1, 'owner 73, spouse 58: Schwab first RMD $16,611.30 = $500,000 ÷ 30.1');
  assert.equal(JOINT[72][0], 84.7);
  assert.equal(JOINT[120][109], 2.0);
});

test('Joint table only when the spouse is more than 10 years younger', () => {
  assert.deepEqual(plain(divisor(80, null)), { f: 20.2, joint: false });
  assert.deepEqual(plain(divisor(80, 70)), { f: 20.2, joint: false }, 'exactly 10 years uses Uniform');
  assert.deepEqual(plain(divisor(80, 69)), { f: JOINT[80][69], joint: true }, '11 years uses Joint');
  assert.ok(JOINT[80][69] > uniform(80), 'Joint factor is larger, so the RMD is smaller');
});

test('no RMD before the start age; first RMD is prior year-end balance ÷ factor', () => {
  const rows = project({ ...BASE, birthYear: 1960, rmdAge: 75 });
  assert.ok(rows.filter(r => r.age < 75).every(r => !r.isRmd && r.rmd === 0 && r.w === 0));
  const first = rows.find(r => r.age === 75);
  assert.ok(first.isRmd);
  near(first.rmd, first.start / 24.6, 1e-9, 'age 75 RMD');
});

test('start-of-year timing takes the withdrawal before growth', () => {
  const r = at(project({ ...BASE, timing: 'start' }), 2026);
  near(r.w, 500000 / 26.5, 1e-9, 'withdrawal');
  near(r.end, (500000 - 500000 / 26.5) * 1.06, 1e-6, 'ending balance');
});

test('withdrawals before RMD age follow the plan and its growth rate', () => {
  const rows = project({ ...BASE, birthYear: 1964, rmdAge: 75, draw: 30000, drawStartAge: 62, drawGrowth: 2.5 });
  near(at(rows, 2026).w, 30000, 1e-9, 'first planned year');
  near(at(rows, 2028).w, 30000 * 1.025 ** 2, 1e-9, 'two years of growth');
  assert.ok(rows.filter(r => !r.isRmd).every(r => r.forced === 0));
});

test('"larger of RMD or plan" takes the plan when it is bigger, and only the shortfall is forced', () => {
  const rows = project({ ...BASE, afterRmd: 'greater', draw: 25000, drawStartAge: 60 });
  const r = at(rows, 2026);
  near(r.w, 25000, 1e-9, 'plan above the RMD');
  assert.equal(r.forced, 0);
  const late = rows.find(x => x.rmd > x.planned);
  near(late.w, late.rmd, 1e-9, 'RMD above the plan');
  near(late.forced, late.rmd - late.planned, 1e-9, 'forced = shortfall');
});

test('one-time withdrawal counts toward that year\'s RMD', () => {
  const plain = project(BASE);
  const noYear = project({ ...BASE, oneOff: 50000, oneOffYear: NaN });
  assert.deepEqual(noYear, plain, 'no year set: no effect');

  const small = at(project({ ...BASE, oneOff: 10000, oneOffYear: 2027 }), 2027);
  near(small.w, small.rmd, 1e-9, 'one-time below the RMD: total is the RMD');
  assert.equal(small.barOne, 10000);
  near(small.barRmd, small.rmd - 10000, 1e-9, 'rest of the RMD');

  const bigRows = project({ ...BASE, oneOff: 100000, oneOffYear: 2027 });
  const big = at(bigRows, 2027);
  assert.equal(big.w, 100000, 'one-time above the RMD: total is the one-time amount');
  assert.equal(big.forced, 0);
  assert.ok(at(bigRows, 2028).rmd < at(project({ ...BASE, oneOff: 10000, oneOffYear: 2027 }), 2028).rmd,
    'next year\'s RMD uses the lower balance');

  const g = { ...BASE, afterRmd: 'greater', draw: 5000, drawStartAge: 60 };
  const below = at(project({ ...g, oneOff: 5000, oneOffYear: 2027 }), 2027);
  near(below.w, below.rmd, 1e-9, 'plan + one-time below the RMD');
  near(below.forced, below.rmd - 10000, 1e-9, 'forced = RMD − plan − one-time');
  const above = at(project({ ...g, oneOff: 40000, oneOffYear: 2027 }), 2027);
  assert.equal(above.w, 45000, 'plan + one-time above the RMD');
  assert.equal(above.forced, 0);

  const pre = at(project({ ...BASE, birthYear: 1964, rmdAge: 75, draw: 30000, drawStartAge: 62, afterRmd: 'greater', oneOff: 70000, oneOffYear: 2028 }), 2028);
  assert.equal(pre.w, 100000, 'before RMD age the one-time amount adds to the plan');
});

test('withdrawals never exceed the balance and the account never goes negative', () => {
  const r = at(project({ ...BASE, balance: 50000, oneOff: 1e6, oneOffYear: 2027 }), 2027);
  assert.equal(r.end, 0);
  for (const timing of ['start', 'end']) {
    const rows = project({ ...BASE, timing, balance: 100000, draw: 60000, drawStartAge: 60, afterRmd: 'greater' });
    assert.ok(rows.every(x => x.end >= 0 && x.start >= 0 && x.w >= 0), timing);
  }
});

test('chart segments always add up to the withdrawal', () => {
  const variants = [];
  for (const afterRmd of ['rmd', 'greater']) for (const timing of ['start', 'end'])
    for (const spouseBirthYear of [null, 1968]) for (const draw of [0, 30000]) for (const oneOff of [0, 25000])
      variants.push({ ...BASE, afterRmd, timing, spouseBirthYear, draw, drawStartAge: 62, drawGrowth: 2.5, oneOff, oneOffYear: 2030, endAge: 120 });
  for (const p of variants) for (const r of project(p)) {
    near(r.base + r.barOne + r.barRmd, r.w, 1e-6, `segments, ${JSON.stringify(p)} ${r.year}`);
    assert.ok(r.base > -1e-6 && r.barOne >= 0 && r.barRmd > -1e-6, `non-negative segments ${r.year}`);
  }
});

test('the projection ends at the end age', () => {
  const rows = project({ ...BASE, endAge: 95 });
  assert.equal(rows[0].age, 73);
  assert.equal(rows.at(-1).age, 95);
});

test('household totals are per-year sums of each spouse\'s own projection', () => {
  const a = project({ ...BASE, endAge: 95 });
  // Spouse 2 is younger and has a shorter projection here, so later years have only spouse 1.
  const b = project({ ...BASE, birthYear: 1962, rmdAge: 75, balance: 300000, draw: 20000, drawStartAge: 62, endAge: 80 });
  const h = combine([a, b]);
  assert.deepEqual(h.map(x => x.year), a.map(x => x.year), 'every year either spouse has');
  for (const x of h) {
    const pa = at(a, x.year), pb = at(b, x.year) || null;
    assert.equal(x.parts[0], pa);
    assert.equal(x.parts[1], pb);
    for (const k of ['start', 'rmd', 'planned', 'w', 'growth', 'end'])
      near(x[k], pa[k] + (pb ? pb[k] : 0), 1e-6, `${k} in ${x.year}`);
    assert.equal(x.isRmd, pa.isRmd || !!(pb && pb.isRmd));
  }
  // Each RMD is figured on its own account: spouse 2 has none until 75 even though spouse 1 does.
  assert.equal(at(h, 2026).parts[1].rmd, 0);
  assert.ok(at(h, 2026).rmd > 0);
});

test('rules version matches the newest changelog date', () => {
  assert.match(RULES.version, /^\d{4}\.\d{2}\.\d{2}\.\d+$/);
  const dates = plain(RULES.changelog.map(([d]) => d));
  assert.deepEqual([...dates].sort().reverse(), dates, 'changelog newest first');
  assert.equal(RULES.version.split('.').slice(0, 3).join('-'), dates[0], 'bump the version when adding a changelog entry');
});
