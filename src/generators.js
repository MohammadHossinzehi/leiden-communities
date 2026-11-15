'use strict';

const { Graph } = require('./graph');
const { makeRng } = require('./rng');

/**
 * Planted partition / stochastic block model with equal sized groups.
 * Returns the graph and the ground truth membership.
 */
function plantedPartition({ groups, size, pIn, pOut, seed = 1 }) {
  const rng = makeRng(seed);
  const n = groups * size;
  const truth = new Int32Array(n);
  for (let i = 0; i < n; i++) truth[i] = Math.floor(i / size);
  const edges = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const p = truth[i] === truth[j] ? pIn : pOut;
      if (rng() < p) edges.push([i, j]);
    }
  }
  return { graph: Graph.fromEdges(n, edges), truth, edges };
}

/**
 * k cliques of the given size joined in a ring by single edges. The classic
 * resolution limit example (Fortunato and Barthelemy, 2007): for enough
 * small cliques, maximising modularity at gamma = 1 merges neighbouring
 * cliques even though every clique is obviously its own community.
 */
function ringOfCliques(k, size) {
  const n = k * size;
  const truth = new Int32Array(n);
  const edges = [];
  for (let c = 0; c < k; c++) {
    const base = c * size;
    for (let i = 0; i < size; i++) {
      truth[base + i] = c;
      for (let j = i + 1; j < size; j++) edges.push([base + i, base + j]);
    }
    edges.push([base, ((c + 1) % k) * size + 1]);
  }
  return { graph: Graph.fromEdges(n, edges), truth, edges };
}

module.exports = { plantedPartition, ringOfCliques };
