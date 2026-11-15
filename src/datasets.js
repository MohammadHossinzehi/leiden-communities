'use strict';

const { Graph } = require('./graph');

/**
 * Zachary's karate club (1977), 34 members, 78 friendships, 1 indexed as in
 * the original paper. The known modularity optimum is 0.4197896 with four
 * communities (Brandes et al., 2008).
 */
const KARATE_ADJ = {
  1: [2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 18, 20, 22, 32],
  2: [3, 4, 8, 14, 18, 20, 22, 31],
  3: [4, 8, 9, 10, 14, 28, 29, 33],
  4: [8, 13, 14],
  5: [7, 11],
  6: [7, 11, 17],
  7: [17],
  9: [31, 33, 34],
  10: [34],
  14: [34],
  15: [33, 34],
  16: [33, 34],
  19: [33, 34],
  20: [34],
  21: [33, 34],
  23: [33, 34],
  24: [26, 28, 30, 33, 34],
  25: [26, 28, 32],
  26: [32],
  27: [30, 34],
  28: [34],
  29: [32, 34],
  30: [33, 34],
  31: [33, 34],
  32: [33, 34],
  33: [34],
};

/** The club split after the dispute: 0 = Mr. Hi's faction, 1 = the officer's. */
const KARATE_FACTIONS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
];

function karateClub() {
  const edges = [];
  for (const [u, vs] of Object.entries(KARATE_ADJ)) {
    for (const v of vs) edges.push([Number(u) - 1, v - 1]);
  }
  return { graph: Graph.fromEdges(34, edges), truth: Int32Array.from(KARATE_FACTIONS), edges };
}

module.exports = { karateClub };
