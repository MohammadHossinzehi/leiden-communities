'use strict';

// The failure mode that motivated Leiden, in sixteen nodes.
//
//   clique A (0-4) --- bridge 10 --- clique B (5-9)
//                         |||
//                    clique C (11-15)
//
// Start from the partition {A, B, bridge} {C}. The bridge has three edges
// into C and only one into each of A and B, so Louvain moves it to C. That
// leaves A and B in one community with no edge between them, and Louvain can
// never repair this: no single node wants to leave, and once aggregated the
// community is a single node. Leiden's refinement phase splits A and B into
// separate sub communities before aggregating, so the next level separates
// them.

const L = require('../src');

const edges = [];
const clique = (b) => {
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) edges.push([b + i, b + j]);
};
clique(0);
clique(5);
clique(11);
edges.push([10, 0], [10, 5], [10, 11], [10, 12], [10, 13]);
const graph = L.Graph.fromEdges(16, edges);
const initial = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1];

const show = (name, r) => {
  const groups = new Map();
  r.membership.forEach((c, v) => groups.set(c, [...(groups.get(c) || []), v]));
  const parts = [...groups.values()].map((g) => `{${g.join(',')}}`).join(' ');
  console.log(`${name.padEnd(8)} Q=${r.quality.toFixed(4)}  disconnected=${L.countDisconnected(graph, r.membership)}  ${parts}`);
};

console.log(`start    Q=${L.modularity.value(graph, initial).toFixed(4)}`);
show('louvain', L.louvain(graph, { initial, iterations: 1 }));
show('leiden', L.leiden(graph, { initial, iterations: 1 }));
