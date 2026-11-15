'use strict';

// Ring of 30 five node cliques joined by single edges. Every clique is
// obviously a community, but modularity at gamma = 1 prefers to merge
// neighbours (Fortunato and Barthelemy, 2007). CPM has no such limit: any
// gamma between the inter clique density and 1 recovers all 30 cliques.

const L = require('../src');

const { graph, truth } = L.ringOfCliques(30, 5);
const rows = [];
for (const [quality, resolution] of [
  ['modularity', 1],
  ['modularity', 2],
  ['cpm', 0.05],
  ['cpm', 0.5],
  ['cpm', 1.1],
]) {
  const r = L.leiden(graph, { quality, resolution, seed: 1 });
  rows.push({ quality, resolution, communities: r.communities, ari: L.ari(r.membership, truth).toFixed(3) });
}
console.table(rows);
