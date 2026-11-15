'use strict';

const { renumber } = require('./graph');
const { getQuality } = require('./quality');
const { makeRng, permutation } = require('./rng');

/**
 * Mutable partition of one level graph. Community ids live in 0..n-1 so a
 * node can always be moved into a fresh, empty community.
 */
class Partition {
  constructor(graph, nodeWeight, membership) {
    const n = graph.n;
    this.graph = graph;
    this.nodeWeight = nodeWeight;
    this.membership = membership;
    this.commWeight = new Float64Array(n);
    this.commCount = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      this.commWeight[membership[i]] += nodeWeight[i];
      this.commCount[membership[i]]++;
    }
    this.empty = [];
    for (let c = n - 1; c >= 0; c--) if (this.commCount[c] === 0) this.empty.push(c);
    // scratch space for neighbour community weights
    this.neighWeight = new Float64Array(n);
    this.neighComms = new Int32Array(n);
    this.neighLen = 0;
  }

  /** Fill neighComms/neighWeight with the edge weight from v into each community. */
  collectNeighbours(v) {
    for (let k = 0; k < this.neighLen; k++) this.neighWeight[this.neighComms[k]] = 0;
    this.neighLen = 0;
    const own = this.membership[v];
    // own community always comes first so it is a candidate even without edges
    this.neighComms[this.neighLen++] = own;
    this.neighWeight[own] = 0;
    const nb = this.graph.nbr[v];
    const w = this.graph.wts[v];
    for (let k = 0; k < nb.length; k++) {
      const c = this.membership[nb[k]];
      // edge weights are strictly positive, so 0 means "not seen yet"
      if (this.neighWeight[c] === 0 && c !== own) this.neighComms[this.neighLen++] = c;
      this.neighWeight[c] += w[k];
    }
  }

  move(v, to) {
    const from = this.membership[v];
    if (from === to) return;
    const wv = this.nodeWeight[v];
    this.commWeight[from] -= wv;
    this.commCount[from]--;
    if (this.commCount[from] === 0) {
      this.commWeight[from] = 0;
      this.empty.push(from);
    }
    if (this.commCount[to] === 0) {
      const idx = this.empty.lastIndexOf(to);
      if (idx >= 0) this.empty.splice(idx, 1);
    }
    this.commWeight[to] += wv;
    this.commCount[to]++;
    this.membership[v] = to;
  }

  /**
   * Best community for v. Returns the id; may be an empty community when
   * allowEmpty is set and isolating v is strictly better.
   */
  bestCommunity(v, lambda, allowEmpty, eps) {
    this.collectNeighbours(v);
    const own = this.membership[v];
    const wv = this.nodeWeight[v];
    let best = own;
    let bestGain = this.neighWeight[own] - lambda * wv * (this.commWeight[own] - wv);
    for (let k = 1; k < this.neighLen; k++) {
      const c = this.neighComms[k];
      const gain = this.neighWeight[c] - lambda * wv * this.commWeight[c];
      if (gain > bestGain + eps) {
        bestGain = gain;
        best = c;
      }
    }
    if (allowEmpty && this.commCount[own] > 1 && 0 > bestGain + eps) {
      best = this.empty[this.empty.length - 1];
    }
    return best;
  }
}

/** Passes stop once a pass improves quality by less than this. */
function improvementTolerance(q) {
  return 1e-10 * Math.max(1, Math.abs(q));
}

function tolerance(graph) {
  return 1e-12 * Math.max(1, graph.totalStrength);
}

/** Louvain local moving: full sweeps in random order until nothing moves. */
function louvainMoveNodes(part, lambda, rng) {
  const n = part.graph.n;
  const eps = tolerance(part.graph);
  let moved = false;
  for (;;) {
    let movesThisSweep = 0;
    const order = permutation(n, rng);
    for (let idx = 0; idx < n; idx++) {
      const v = order[idx];
      const best = part.bestCommunity(v, lambda, false, eps);
      if (best !== part.membership[v]) {
        part.move(v, best);
        movesThisSweep++;
      }
    }
    if (movesThisSweep === 0) break;
    moved = true;
  }
  return moved;
}

/**
 * Leiden fast local moving: a work queue instead of full sweeps. After a
 * node moves, only its neighbours outside the new community are revisited.
 */
function fastLocalMove(part, lambda, rng) {
  const n = part.graph.n;
  const eps = tolerance(part.graph);
  const queue = Array.from(permutation(n, rng));
  const inQueue = new Uint8Array(n).fill(1);
  let head = 0;
  let moves = 0;
  while (head < queue.length) {
    const v = queue[head++];
    inQueue[v] = 0;
    const best = part.bestCommunity(v, lambda, true, eps);
    if (best === part.membership[v]) continue;
    part.move(v, best);
    moves++;
    const nb = part.graph.nbr[v];
    for (let k = 0; k < nb.length; k++) {
      const u = nb[k];
      if (!inQueue[u] && part.membership[u] !== best) {
        inQueue[u] = 1;
        queue.push(u);
      }
    }
    if (head > 4096 && head * 2 > queue.length) {
      queue.splice(0, head);
      head = 0;
    }
  }
  return moves;
}

/**
 * Leiden refinement. Inside every community S of `membership`, start from
 * singletons and merge nodes into well connected sub communities, picking
 * the target at random with probability proportional to exp(gain / theta).
 * Returns the refined membership (ids renumbered) and its community count.
 *
 * A node v is only merged if it is well connected to S:
 *   E(v, S - v) >= lambda * w_v * (W_S - w_v)
 * and only into a sub community T that is well connected to S:
 *   E(T, S - T) >= lambda * W_T * (W_S - W_T)
 * which is what gives Leiden its connectivity guarantee.
 */
function refinePartition(graph, nodeWeight, membership, lambda, theta, rng) {
  const n = graph.n;
  const eps = tolerance(graph);
  const refined = new Int32Array(n);
  const rWeight = new Float64Array(n);
  const rCount = new Int32Array(n);
  const ext = new Float64Array(n); // E(T, S - T) for refined community T
  const commTotal = new Float64Array(n); // W_S per coarse community
  for (let i = 0; i < n; i++) {
    refined[i] = i;
    rWeight[i] = nodeWeight[i];
    rCount[i] = 1;
    commTotal[membership[i]] += nodeWeight[i];
  }
  // E(v, S - v): weight from v to the rest of its own community
  for (let v = 0; v < n; v++) {
    const nb = graph.nbr[v];
    const w = graph.wts[v];
    let s = 0;
    for (let k = 0; k < nb.length; k++) if (membership[nb[k]] === membership[v]) s += w[k];
    ext[v] = s;
  }

  const toT = new Float64Array(n);
  const cand = new Int32Array(n);
  const probs = new Float64Array(n);
  const order = permutation(n, rng);
  for (let idx = 0; idx < n; idx++) {
    const v = order[idx];
    if (rCount[refined[v]] !== 1) continue; // v was already merged into
    const S = membership[v];
    const wv = nodeWeight[v];
    const WS = commTotal[S];
    if (ext[v] < lambda * wv * (WS - wv) - eps) continue; // v not well connected

    // weights from v to the refined communities inside S
    let len = 0;
    const nb = graph.nbr[v];
    const w = graph.wts[v];
    for (let k = 0; k < nb.length; k++) {
      const u = nb[k];
      if (membership[u] !== S) continue;
      const T = refined[u];
      if (toT[T] === 0) cand[len++] = T;
      toT[T] += w[k];
    }
    // candidate set: every well connected T with non negative gain, plus
    // staying alone (gain 0, always admissible)
    const own = refined[v];
    let kept = 0;
    let maxGain = 0;
    for (let k = 0; k < len; k++) {
      const T = cand[k];
      const WT = rWeight[T];
      const wellConnected = ext[T] >= lambda * WT * (WS - WT) - eps;
      const gain = toT[T] - lambda * wv * WT;
      if (wellConnected && gain >= -eps) {
        cand[kept] = T;
        probs[kept] = gain;
        if (gain > maxGain) maxGain = gain;
        kept++;
      } else {
        toT[T] = 0;
      }
    }
    let chosen = own;
    if (kept > 0) {
      // softmax over {stay (gain 0)} U candidates, numerically stabilised
      let total = Math.exp((0 - maxGain) / theta);
      for (let k = 0; k < kept; k++) {
        probs[k] = Math.exp((probs[k] - maxGain) / theta);
        total += probs[k];
      }
      // the largest term is exp(0) = 1, so total >= 1 and never overflows
      let r = rng() * total;
      r -= Math.exp((0 - maxGain) / theta);
      if (r >= 0) {
        chosen = cand[kept - 1];
        for (let k = 0; k < kept; k++) {
          r -= probs[k];
          if (r < 0) {
            chosen = cand[k];
            break;
          }
        }
      }
    }
    if (chosen !== own) {
      const kvT = toT[chosen];
      ext[chosen] = ext[chosen] + ext[v] - 2 * kvT;
      rWeight[chosen] += wv;
      rCount[chosen]++;
      rWeight[own] = 0;
      rCount[own] = 0;
      refined[v] = chosen;
    }
    for (let k = 0; k < kept; k++) toT[cand[k]] = 0;
  }
  const count = renumber(refined);
  return { refined, count };
}

/** True when two membership vectors describe the same partition. */
function samePartition(a, b) {
  const x = Int32Array.from(a);
  const y = Int32Array.from(b);
  renumber(x);
  renumber(y);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

function normaliseOptions(graph, opts = {}) {
  const quality = getQuality(opts.quality || 'modularity');
  const resolution = opts.resolution === undefined ? 1 : Number(opts.resolution);
  if (!(resolution >= 0)) throw new RangeError('resolution must be a non negative number');
  const theta = opts.theta === undefined ? 0.01 : Number(opts.theta);
  if (!(theta > 0)) throw new RangeError('theta must be positive');
  const seed = opts.seed === undefined ? 1 : opts.seed;
  let initial = null;
  if (opts.initial) {
    if (opts.initial.length !== graph.n) throw new RangeError('initial membership has the wrong length');
    initial = Int32Array.from(opts.initial);
    renumber(initial);
  }
  return {
    quality,
    resolution,
    theta,
    rng: opts.rng || makeRng(seed),
    initial,
    iterations: opts.iterations === undefined ? 2 : opts.iterations,
    maxLevels: opts.maxLevels || Infinity,
  };
}

function summarise(graph, membership, o, extra) {
  const count = renumber(membership);
  return Object.assign(
    {
      membership,
      communities: count,
      quality: o.quality.value(graph, membership, o.resolution),
      qualityName: o.quality.name,
      resolution: o.resolution,
    },
    extra,
  );
}

/** One Leiden pass from a given starting membership on the original graph. */
function leidenPass(graph, start, o) {
  const lambda = o.quality.lambda(graph, o.resolution);
  let level = graph;
  let membership = Int32Array.from(start);
  const nodeMap = new Int32Array(graph.n);
  for (let i = 0; i < graph.n; i++) nodeMap[i] = i;
  let levels = 0;
  for (;;) {
    const nodeWeight = o.quality.nodeWeight(level);
    const part = new Partition(level, nodeWeight, membership);
    fastLocalMove(part, lambda, o.rng);
    levels++;
    const c = renumber(membership);
    if (c === level.n || levels >= o.maxLevels) break;
    const { refined, count } = refinePartition(level, nodeWeight, membership, lambda, o.theta, o.rng);
    // the aggregate's starting partition is the unrefined one
    const next = new Int32Array(count);
    for (let i = 0; i < level.n; i++) next[refined[i]] = membership[i];
    for (let i = 0; i < graph.n; i++) nodeMap[i] = refined[nodeMap[i]];
    level = level.aggregate(refined, count);
    membership = next;
  }
  const out = new Int32Array(graph.n);
  for (let i = 0; i < graph.n; i++) out[i] = membership[nodeMap[i]];
  renumber(out);
  return { membership: out, levels, changed: !samePartition(start, out) };
}

/**
 * Leiden algorithm (Traag, Waltman and van Eck, 2019).
 * @param {Graph} graph
 * @param {object} [opts]
 * @param {'modularity'|'cpm'} [opts.quality='modularity']
 * @param {number} [opts.resolution=1]
 * @param {number} [opts.theta=0.01] refinement randomness
 * @param {number} [opts.iterations=2] passes; negative = until a pass no longer improves quality
 * @param {number} [opts.seed=1]
 * @param {ArrayLike<number>} [opts.initial] starting membership
 */
function leiden(graph, opts) {
  const o = normaliseOptions(graph, opts);
  let membership = o.initial || Int32Array.from({ length: graph.n }, (_, i) => i);
  let passes = 0;
  let levels = 0;
  const limit = o.iterations < 0 ? Infinity : Math.max(1, o.iterations);
  let q = o.quality.value(graph, membership, o.resolution);
  while (passes < limit) {
    const r = leidenPass(graph, membership, o);
    passes++;
    levels += r.levels;
    membership = r.membership;
    const q2 = o.quality.value(graph, membership, o.resolution);
    const improved = q2 > q + improvementTolerance(q);
    q = q2;
    if (!r.changed || !improved) break;
  }
  return summarise(graph, membership, o, { algorithm: 'leiden', passes, levels });
}

/**
 * Louvain algorithm (Blondel et al., 2008), included as the baseline the
 * Leiden paper improves on. Supports the same quality functions. A pass
 * starts local moving from `current` on the original graph, so repeated
 * passes (iterations > 1) can move single nodes again, exactly the
 * situation in which Louvain may leave a community internally disconnected.
 */
function louvain(graph, opts) {
  const o = normaliseOptions(graph, opts);
  const lambda = o.quality.lambda(graph, o.resolution);
  const limit = o.iterations < 0 ? Infinity : Math.max(1, o.iterations);
  let current = o.initial || Int32Array.from({ length: graph.n }, (_, i) => i);
  let passes = 0;
  let levelsTotal = 0;
  while (passes < limit) {
    passes++;
    let level = graph;
    let membership = Int32Array.from(current);
    const nodeMap = Int32Array.from({ length: graph.n }, (_, i) => i);
    let levels = 0;
    for (;;) {
      const part = new Partition(level, o.quality.nodeWeight(level), membership);
      louvainMoveNodes(part, lambda, o.rng);
      levels++;
      const c = renumber(membership);
      if (c === level.n || levels >= o.maxLevels) break;
      for (let i = 0; i < graph.n; i++) nodeMap[i] = membership[nodeMap[i]];
      level = level.aggregate(membership, c);
      membership = Int32Array.from({ length: c }, (_, i) => i);
    }
    levelsTotal += levels;
    const next = new Int32Array(graph.n);
    for (let i = 0; i < graph.n; i++) next[i] = membership[nodeMap[i]];
    renumber(next);
    const before = o.quality.value(graph, current, o.resolution);
    const after = o.quality.value(graph, next, o.resolution);
    const changed = !samePartition(current, next);
    current = next;
    if (!changed || !(after > before + improvementTolerance(before))) break;
  }
  return summarise(graph, current, o, { algorithm: 'louvain', passes, levels: levelsTotal });
}

module.exports = { leiden, louvain, samePartition, refinePartition, Partition, fastLocalMove, louvainMoveNodes };
