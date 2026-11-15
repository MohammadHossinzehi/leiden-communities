'use strict';

// Leiden vs Louvain on sparse planted partition graphs of increasing noise.
// For each mixing level we report mean modularity, NMI against the planted
// groups, the number of internally disconnected communities summed over all
// runs, and mean wall time. Usage: node examples/benchmark.js [runs]

const L = require('../src');

function sparseSbm({ groups, size, degIn, degOut, seed }) {
  const rng = L.makeRng(seed);
  const n = groups * size;
  const truth = Int32Array.from({ length: n }, (_, i) => Math.floor(i / size));
  const edges = [];
  for (let k = 0; k < (n * degIn) / 2; k++) {
    const g = Math.floor(rng() * groups);
    const u = g * size + Math.floor(rng() * size);
    const v = g * size + Math.floor(rng() * size);
    if (u !== v) edges.push([u, v]);
  }
  for (let k = 0; k < (n * degOut) / 2; k++) {
    const u = Math.floor(rng() * n);
    const v = Math.floor(rng() * n);
    if (u !== v) edges.push([u, v]);
  }
  return { graph: L.Graph.fromEdges(n, edges), truth };
}

function time(fn) {
  const t0 = process.hrtime.bigint();
  const r = fn();
  return { r, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

const runs = Number(process.argv[2]) || 8;
const rows = [];
for (const mu of [0.2, 0.35, 0.5, 0.6]) {
  const deg = 8;
  const acc = { leiden: { q: 0, nmi: 0, bad: 0, ms: 0 }, louvain: { q: 0, nmi: 0, bad: 0, ms: 0 } };
  for (let s = 0; s < runs; s++) {
    const { graph, truth } = sparseSbm({ groups: 50, size: 100, degIn: deg * (1 - mu), degOut: deg * mu, seed: s });
    for (const name of ['leiden', 'louvain']) {
      const { r, ms } = time(() => L[name](graph, { seed: s }));
      const a = acc[name];
      a.q += r.quality / runs;
      a.nmi += L.nmi(r.membership, truth) / runs;
      a.bad += L.countDisconnected(graph, r.membership);
      a.ms += ms / runs;
    }
  }
  for (const name of ['leiden', 'louvain']) {
    const a = acc[name];
    rows.push({ mu, algorithm: name, modularity: a.q.toFixed(4), nmi: a.nmi.toFixed(4), disconnected: a.bad, ms: a.ms.toFixed(0) });
  }
}
console.log(`5000 nodes, 50 planted groups, mean degree 8, ${runs} graphs per row\n`);
console.table(rows);
