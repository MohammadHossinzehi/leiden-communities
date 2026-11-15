'use strict';

/** Contingency table between two labelings, as a Map of "a,b" -> count. */
function contingency(a, b) {
  if (a.length !== b.length) throw new RangeError('labelings must have the same length');
  const table = new Map();
  const ra = new Map();
  const rb = new Map();
  for (let i = 0; i < a.length; i++) {
    const key = a[i] + ',' + b[i];
    table.set(key, (table.get(key) || 0) + 1);
    ra.set(a[i], (ra.get(a[i]) || 0) + 1);
    rb.set(b[i], (rb.get(b[i]) || 0) + 1);
  }
  return { table, ra, rb, n: a.length };
}

function entropy(counts, n) {
  let h = 0;
  for (const c of counts.values()) {
    const p = c / n;
    h -= p * Math.log(p);
  }
  return h;
}

/**
 * Normalised mutual information with arithmetic mean normalisation
 * (the default in scikit-learn): NMI = 2 I(A;B) / (H(A) + H(B)).
 */
function nmi(a, b) {
  const { table, ra, rb, n } = contingency(a, b);
  const ha = entropy(ra, n);
  const hb = entropy(rb, n);
  if (ha === 0 && hb === 0) return 1;
  let mi = 0;
  for (const [key, nij] of table) {
    const [x, y] = key.split(',');
    mi += (nij / n) * Math.log((n * nij) / (ra.get(+x) * rb.get(+y)));
  }
  return (2 * mi) / (ha + hb);
}

const choose2 = (x) => (x * (x - 1)) / 2;

/** Adjusted Rand index (Hubert and Arabie, 1985). */
function ari(a, b) {
  const { table, ra, rb, n } = contingency(a, b);
  let sumIJ = 0;
  for (const v of table.values()) sumIJ += choose2(v);
  let sumA = 0;
  for (const v of ra.values()) sumA += choose2(v);
  let sumB = 0;
  for (const v of rb.values()) sumB += choose2(v);
  const expected = (sumA * sumB) / choose2(n);
  const max = (sumA + sumB) / 2;
  if (max === expected) return 1;
  return (sumIJ - expected) / (max - expected);
}

module.exports = { nmi, ari };
