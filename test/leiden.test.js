'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src');
const { refinePartition } = require('../src/optimise');

// ---------------------------------------------------------------- helpers

function randomGraph(n, p, seed, maxWeight = 1) {
  const rng = L.makeRng(seed);
  const edges = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (rng() < p) edges.push([i, j, 1 + Math.floor(rng() * maxWeight)]);
    }
  }
  return L.Graph.fromEdges(n, edges);
}

/** Every set partition of 0..n-1 as a restricted growth string. */
function* setPartitions(n) {
  const a = new Int32Array(n);
  function* rec(i, max) {
    if (i === n) {
      yield a;
      return;
    }
    for (let c = 0; c <= max + 1; c++) {
      a[i] = c;
      yield* rec(i + 1, Math.max(max, c));
    }
  }
  yield* rec(0, -1);
}

function exhaustiveOptimum(graph, quality, gamma) {
  let best = -Infinity;
  for (const p of setPartitions(graph.n)) best = Math.max(best, quality.value(graph, p, gamma));
  return best;
}

/** True when no single node can move to another (or a new) community and improve. */
function isNodeOptimal(graph, membership, quality, gamma) {
  const base = quality.value(graph, membership, gamma);
  for (let v = 0; v < graph.n; v++) {
    for (let c = 0; c <= graph.n; c++) {
      const m = Int32Array.from(membership);
      m[v] = c;
      if (quality.value(graph, m, gamma) > base + 1e-9) return false;
    }
  }
  return true;
}

/** Two modules joined through a bridge node that is pulled towards a third. */
function bridgeGraph() {
  const edges = [];
  const clique = (b) => {
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) edges.push([b + i, b + j]);
  };
  clique(0);
  clique(5);
  clique(11);
  edges.push([10, 0], [10, 5], [10, 11], [10, 12], [10, 13]);
  const initial = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1];
  return { graph: L.Graph.fromEdges(16, edges), initial };
}

// ---------------------------------------------------------------- graph

test('fromEdges merges parallel edges and tracks self loops', () => {
  const g = L.Graph.fromEdges(3, [
    [0, 1, 2],
    [1, 0, 3],
    [2, 2, 4],
    [1, 2],
  ]);
  assert.equal(g.edgeCount(), 3);
  assert.deepEqual([...g.strength], [5, 6, 9]);
  assert.equal(g.totalStrength, 20);
  assert.equal(g.totalWeight(), 10);
});

test('fromEdges rejects bad input', () => {
  assert.throws(() => L.Graph.fromEdges(2, [[0, 2]]), RangeError);
  assert.throws(() => L.Graph.fromEdges(2, [[0, 1, -1]]), RangeError);
  assert.throws(() => L.Graph.fromEdges(2, [[0, 1, NaN]]), RangeError);
});

test('aggregation preserves strength, total weight, sizes and quality', () => {
  const g = randomGraph(30, 0.2, 7, 4);
  const rng = L.makeRng(3);
  const membership = Int32Array.from({ length: g.n }, () => Math.floor(rng() * 6));
  const c = L.renumber(membership);
  const agg = g.aggregate(membership, c);
  assert.equal(agg.totalStrength, g.totalStrength);
  const sizes = new Float64Array(c);
  const strength = new Float64Array(c);
  for (let i = 0; i < g.n; i++) {
    sizes[membership[i]] += 1;
    strength[membership[i]] += g.strength[i];
  }
  assert.deepEqual([...agg.nodeSize], [...sizes]);
  for (let k = 0; k < c; k++) assert.ok(Math.abs(agg.strength[k] - strength[k]) < 1e-9);
  // any coarser partition has the same quality on both levels
  const coarse = Int32Array.from({ length: c }, (_, i) => i % 3);
  const lifted = Int32Array.from(membership, (m) => coarse[m]);
  for (const q of [L.modularity, L.cpm]) {
    assert.ok(Math.abs(q.value(agg, coarse, 0.7) - q.value(g, lifted, 0.7)) < 1e-9, q.name);
  }
});

// ---------------------------------------------------------------- quality

test('modularity matches the textbook formula on a small graph', () => {
  // two triangles joined by one edge, split into the two triangles
  const g = L.Graph.fromEdges(6, [
    [0, 1],
    [1, 2],
    [0, 2],
    [3, 4],
    [4, 5],
    [3, 5],
    [2, 3],
  ]);
  const m = 7;
  // each side: 3 internal edges, degree sum 7
  const expected = 2 * (3 / m - (7 / (2 * m)) ** 2);
  assert.ok(Math.abs(L.modularity.value(g, [0, 0, 0, 1, 1, 1]) - expected) < 1e-12);
  assert.equal(L.modularity.value(g, [0, 0, 0, 0, 0, 0]), 0);
});

test('CPM counts internal edges minus gamma times pairs', () => {
  const g = L.Graph.fromEdges(4, [
    [0, 1],
    [1, 2],
    [2, 3],
  ]);
  // {0,1,2} has 2 edges and 3 pairs, {3} has nothing
  assert.ok(Math.abs(L.cpm.value(g, [0, 0, 0, 1], 0.5) - (2 - 0.5 * 3)) < 1e-12);
});

// ---------------------------------------------------------------- metrics

test('NMI and ARI are 1 for identical partitions up to relabelling', () => {
  const a = [0, 0, 1, 1, 2, 2];
  const b = [5, 5, 3, 3, 9, 9];
  assert.ok(Math.abs(L.nmi(a, b) - 1) < 1e-12);
  assert.ok(Math.abs(L.ari(a, b) - 1) < 1e-12);
});

test('ARI matches a hand computed value', () => {
  // classic example: contingency [[1,1,0],[1,2,1],[0,0,1]] style labelings
  const a = [0, 0, 0, 1, 1, 1];
  const b = [0, 0, 1, 1, 2, 2];
  // sum nij choose 2 = 1+0+1 = 2, a side = 3+3 = 6, b side = 1+1+1 = 3, n choose 2 = 15
  const expected = (2 - (6 * 3) / 15) / ((6 + 3) / 2 - (6 * 3) / 15);
  assert.ok(Math.abs(L.ari(a, b) - expected) < 1e-12);
});

// ---------------------------------------------------------------- algorithms

test('Leiden reaches the known karate club optimum Q = 0.4197896', () => {
  const { graph } = L.karateClub();
  assert.equal(graph.edgeCount(), 78);
  for (let seed = 1; seed <= 10; seed++) {
    const r = L.leiden(graph, { seed, iterations: -1 });
    assert.equal(r.communities, 4);
    assert.ok(Math.abs(r.quality - 0.4197896) < 1e-6, `seed ${seed}: ${r.quality}`);
  }
});

test('Leiden recovers a clear planted partition exactly', () => {
  const { graph, truth } = L.plantedPartition({ groups: 6, size: 30, pIn: 0.35, pOut: 0.01, seed: 4 });
  const r = L.leiden(graph, { seed: 2 });
  assert.equal(r.communities, 6);
  assert.equal(L.nmi(r.membership, truth), 1);
  assert.equal(L.ari(r.membership, truth), 1);
});

test('Leiden matches the exhaustive optimum on small graphs (best of 10 seeds)', () => {
  let hits = 0;
  let total = 0;
  for (let t = 0; t < 25; t++) {
    const g = randomGraph(8, 0.4, 100 + t, 3);
    for (const [q, gamma] of [
      [L.modularity, 1],
      [L.cpm, 0.6],
    ]) {
      const opt = exhaustiveOptimum(g, q, gamma);
      let best = -Infinity;
      for (let seed = 0; seed < 10; seed++) {
        const r = L.leiden(g, { quality: q.name, resolution: gamma, iterations: -1, seed });
        assert.ok(r.quality <= opt + 1e-9, 'never beats the true optimum');
        best = Math.max(best, r.quality);
      }
      total++;
      if (best >= opt - 1e-9) hits++;
    }
  }
  assert.ok(hits / total >= 0.95, `hit rate ${hits}/${total}`);
});

test('Leiden run to convergence is node optimal', () => {
  for (let t = 0; t < 15; t++) {
    const g = randomGraph(12, 0.3, 500 + t, 2);
    for (const [name, gamma] of [
      ['modularity', 1],
      ['cpm', 0.4],
    ]) {
      const r = L.leiden(g, { quality: name, resolution: gamma, iterations: -1, seed: t });
      assert.ok(isNodeOptimal(g, r.membership, L.getQuality(name), gamma), `${name} t=${t}`);
    }
  }
});

test('Leiden communities are always connected; Louvain ones need not be', () => {
  let leidenBad = 0;
  for (let s = 0; s < 20; s++) {
    const g = randomGraph(120, 0.03, 900 + s);
    for (const name of ['modularity', 'cpm']) {
      const r = L.leiden(g, { quality: name, resolution: name === 'cpm' ? 0.05 : 1, iterations: 3, seed: s });
      leidenBad += L.countDisconnected(g, r.membership);
    }
  }
  assert.equal(leidenBad, 0);
});

test('bridge graph: Louvain leaves a disconnected community, Leiden splits it', () => {
  const { graph, initial } = bridgeGraph();
  const lv = L.louvain(graph, { initial, iterations: 1 });
  const ld = L.leiden(graph, { initial, iterations: 1 });
  assert.equal(L.countDisconnected(graph, lv.membership), 1);
  assert.equal(L.countDisconnected(graph, ld.membership), 0);
  assert.equal(ld.communities, 3);
  assert.ok(ld.quality > lv.quality + 0.1);
});

test('refinement output is a sub partition with connected parts', () => {
  for (let t = 0; t < 10; t++) {
    const g = randomGraph(60, 0.08, 300 + t);
    const coarse = L.louvain(g, { seed: t }).membership;
    const nw = L.modularity.nodeWeight(g);
    const lambda = L.modularity.lambda(g, 1);
    const { refined, count } = refinePartition(g, nw, Int32Array.from(coarse), lambda, 0.01, L.makeRng(t));
    assert.ok(count >= new Set(coarse).size);
    const parent = new Map();
    for (let i = 0; i < g.n; i++) {
      if (parent.has(refined[i])) assert.equal(parent.get(refined[i]), coarse[i]);
      else parent.set(refined[i], coarse[i]);
    }
    assert.equal(L.countDisconnected(g, refined), 0);
  }
});

test('CPM avoids the resolution limit on a ring of cliques', () => {
  const { graph, truth } = L.ringOfCliques(30, 5);
  const mod = L.leiden(graph, { seed: 1 });
  const cpm = L.leiden(graph, { quality: 'cpm', resolution: 0.5, seed: 1 });
  assert.ok(mod.communities < 30, 'modularity merges neighbouring cliques');
  assert.equal(cpm.communities, 30);
  assert.equal(L.ari(cpm.membership, truth), 1);
});

test('higher CPM resolution never yields fewer communities on average', () => {
  const { graph } = L.plantedPartition({ groups: 4, size: 25, pIn: 0.3, pOut: 0.05, seed: 9 });
  const counts = [0.01, 0.1, 0.3, 0.6].map((gamma) => L.leiden(graph, { quality: 'cpm', resolution: gamma, seed: 3 }).communities);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] >= counts[i - 1], counts.join(','));
});

test('results are reproducible for a fixed seed', () => {
  const g = randomGraph(200, 0.03, 42);
  const a = L.leiden(g, { seed: 11 });
  const b = L.leiden(g, { seed: 11 });
  assert.deepEqual([...a.membership], [...b.membership]);
});

test('more iterations never decrease Leiden quality from the same start', () => {
  const g = randomGraph(300, 0.02, 77);
  const one = L.leiden(g, { iterations: 1, seed: 5 });
  const more = L.leiden(g, { iterations: 1, seed: 6, initial: one.membership });
  assert.ok(more.quality >= one.quality - 1e-12);
});

test('edge cases: empty graph, isolated nodes, single edge', () => {
  const empty = L.Graph.fromEdges(4, []);
  const r = L.leiden(empty);
  assert.equal(r.communities, 4);
  assert.equal(r.quality, 0);
  const one = L.leiden(L.Graph.fromEdges(3, [[0, 1]]));
  assert.equal(one.membership[0], one.membership[1]);
  assert.notEqual(one.membership[0], one.membership[2]);
  assert.equal(L.louvain(empty).communities, 4);
});

test('weighted edges steer the partition', () => {
  // a 4 cycle where weights decide the pairing
  const g = L.Graph.fromEdges(4, [
    [0, 1, 10],
    [1, 2, 1],
    [2, 3, 10],
    [3, 0, 1],
  ]);
  const r = L.leiden(g);
  assert.equal(r.membership[0], r.membership[1]);
  assert.equal(r.membership[2], r.membership[3]);
  assert.notEqual(r.membership[0], r.membership[2]);
});

test('option validation', () => {
  const g = L.Graph.fromEdges(2, [[0, 1]]);
  assert.throws(() => L.leiden(g, { quality: 'nope' }));
  assert.throws(() => L.leiden(g, { theta: 0 }), RangeError);
  assert.throws(() => L.leiden(g, { resolution: -1 }), RangeError);
  assert.throws(() => L.leiden(g, { initial: [0] }), RangeError);
});
