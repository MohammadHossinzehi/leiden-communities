'use strict';

/**
 * Both supported quality functions can be written in the same shape:
 *
 *   H(P) = sum over communities c of [ e_c - lambda * W_c^2 / 2 ] + const
 *
 * where e_c is the total edge weight inside c (self loops once), W_c is the
 * summed node weight of c, and lambda is a resolution constant. Only the
 * node weight and lambda differ:
 *
 *   modularity : node weight = strength k_i,  lambda = gamma / 2m
 *   CPM        : node weight = node size n_i, lambda = gamma
 *
 * That gives one move gain for both. Inserting a node v (weight w_v) into
 * community c changes H by
 *
 *   gain(v, c) = k_{v,c} - lambda * w_v * W_c
 *
 * with k_{v,c} the edge weight from v into c. The optimisers only ever see
 * this expression, so adding a third quality function of the same family
 * is a matter of adding an entry here.
 *
 * Gains are kept in raw edge weight units (not divided by 2m), which is
 * also the scale the refinement temperature theta is applied to. This
 * matches the igraph implementation; dividing by 2m first would make
 * exp(gain / theta) almost flat and turn refinement into a coin toss.
 */

function internalAndWeights(graph, membership, nodeWeight) {
  const e = new Map();
  const W = new Map();
  for (let i = 0; i < graph.n; i++) {
    const c = membership[i];
    W.set(c, (W.get(c) || 0) + nodeWeight[i]);
    let inside = graph.selfLoop[i];
    const nb = graph.nbr[i];
    const w = graph.wts[i];
    for (let k = 0; k < nb.length; k++) {
      if (nb[k] > i && membership[nb[k]] === c) inside += w[k];
    }
    e.set(c, (e.get(c) || 0) + inside);
  }
  return { e, W };
}

const modularity = {
  name: 'modularity',
  nodeWeight(graph) {
    return Float64Array.from(graph.strength);
  },
  lambda(graph, gamma) {
    return graph.totalStrength > 0 ? gamma / graph.totalStrength : 0;
  },
  /** Newman-Girvan modularity with resolution gamma (Reichardt-Bornholdt). */
  value(graph, membership, gamma = 1) {
    const M2 = graph.totalStrength;
    if (M2 === 0) return 0;
    const { e, W } = internalAndWeights(graph, membership, graph.strength);
    let q = 0;
    for (const [c, ec] of e) {
      const wc = W.get(c);
      q += (2 * ec) / M2 - gamma * (wc / M2) * (wc / M2);
    }
    return q;
  },
};

const cpm = {
  name: 'cpm',
  nodeWeight(graph) {
    return Float64Array.from(graph.nodeSize);
  },
  lambda(_graph, gamma) {
    return gamma;
  },
  /** Constant Potts Model: sum_c [ e_c - gamma * binom(n_c, 2) ]. */
  value(graph, membership, gamma = 1) {
    const { e, W } = internalAndWeights(graph, membership, graph.nodeSize);
    let h = 0;
    for (const [c, ec] of e) {
      const nc = W.get(c);
      h += ec - (gamma * nc * (nc - 1)) / 2;
    }
    return h;
  },
};

const QUALITIES = { modularity, cpm };

function getQuality(name) {
  const q = QUALITIES[String(name).toLowerCase()];
  if (!q) throw new Error(`unknown quality function "${name}" (use modularity or cpm)`);
  return q;
}

module.exports = { modularity, cpm, getQuality };
