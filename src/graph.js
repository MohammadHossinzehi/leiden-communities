'use strict';

/**
 * Weighted undirected graph stored as per-node adjacency arrays.
 *
 * Self loops are kept separately in `selfLoop[i]` (weight counted once).
 * The strength of a node follows the usual modularity convention:
 *   k_i = sum of incident edge weights + 2 * selfLoop[i]
 * so that sum_i k_i = 2m.
 *
 * `nodeSize[i]` is the number of original vertices a node stands for. It is
 * 1 for an input graph and grows as the graph is aggregated; CPM uses it.
 */
class Graph {
  constructor(n, nbr, wts, selfLoop, nodeSize) {
    this.n = n;
    this.nbr = nbr;
    this.wts = wts;
    this.selfLoop = selfLoop;
    this.nodeSize = nodeSize;
    this.strength = new Float64Array(n);
    let total = 0;
    for (let i = 0; i < n; i++) {
      let s = 2 * selfLoop[i];
      const w = wts[i];
      for (let j = 0; j < w.length; j++) s += w[j];
      this.strength[i] = s;
      total += s;
    }
    /** 2m: total strength, i.e. twice the total edge weight. */
    this.totalStrength = total;
  }

  /**
   * Build a graph from an edge list. Parallel edges are merged by summing
   * their weights, edges with u === v become self loops.
   * @param {number} n number of nodes, labelled 0..n-1
   * @param {Array<[number, number, number?]>} edges
   */
  static fromEdges(n, edges) {
    const maps = Array.from({ length: n }, () => new Map());
    const selfLoop = new Float64Array(n);
    for (const e of edges) {
      const u = e[0];
      const v = e[1];
      const w = e.length > 2 && e[2] !== undefined ? Number(e[2]) : 1;
      if (!Number.isInteger(u) || !Number.isInteger(v) || u < 0 || v < 0 || u >= n || v >= n) {
        throw new RangeError(`edge (${u}, ${v}) references a node outside 0..${n - 1}`);
      }
      if (!(w >= 0) || !Number.isFinite(w)) {
        throw new RangeError(`edge (${u}, ${v}) has invalid weight ${e[2]}`);
      }
      if (w === 0) continue;
      if (u === v) {
        selfLoop[u] += w;
      } else {
        maps[u].set(v, (maps[u].get(v) || 0) + w);
        maps[v].set(u, (maps[v].get(u) || 0) + w);
      }
    }
    return Graph._fromMaps(n, maps, selfLoop, new Float64Array(n).fill(1));
  }

  static _fromMaps(n, maps, selfLoop, nodeSize) {
    const nbr = new Array(n);
    const wts = new Array(n);
    for (let i = 0; i < n; i++) {
      const m = maps[i];
      const a = new Int32Array(m.size);
      const b = new Float64Array(m.size);
      let k = 0;
      for (const [j, w] of m) {
        a[k] = j;
        b[k] = w;
        k++;
      }
      nbr[i] = a;
      wts[i] = b;
    }
    return new Graph(n, nbr, wts, selfLoop, nodeSize);
  }

  /** Number of undirected edges, self loops included. */
  edgeCount() {
    let c = 0;
    for (let i = 0; i < this.n; i++) {
      c += this.nbr[i].length;
      if (this.selfLoop[i] > 0) c += 2;
    }
    return c / 2;
  }

  /** Total edge weight m. */
  totalWeight() {
    return this.totalStrength / 2;
  }

  /**
   * Collapse every community into one node. Edge weights between
   * communities are summed, edges inside a community become a self loop,
   * node sizes are summed.
   * @param {Int32Array} membership community id per node, ids 0..c-1
   * @param {number} c number of communities
   */
  aggregate(membership, c) {
    const maps = Array.from({ length: c }, () => new Map());
    const selfLoop = new Float64Array(c);
    const nodeSize = new Float64Array(c);
    for (let i = 0; i < this.n; i++) {
      const ci = membership[i];
      nodeSize[ci] += this.nodeSize[i];
      selfLoop[ci] += this.selfLoop[i];
      const nb = this.nbr[i];
      const w = this.wts[i];
      for (let k = 0; k < nb.length; k++) {
        const j = nb[k];
        if (j < i) continue; // visit every undirected edge once
        const cj = membership[j];
        if (ci === cj) {
          selfLoop[ci] += w[k];
        } else {
          maps[ci].set(cj, (maps[ci].get(cj) || 0) + w[k]);
          maps[cj].set(ci, (maps[cj].get(ci) || 0) + w[k]);
        }
      }
    }
    return Graph._fromMaps(c, maps, selfLoop, nodeSize);
  }
}

/**
 * Relabel a membership vector so ids are 0..c-1 in order of first
 * appearance. Returns the number of distinct communities.
 */
function renumber(membership) {
  const map = new Map();
  for (let i = 0; i < membership.length; i++) {
    let id = map.get(membership[i]);
    if (id === undefined) {
      id = map.size;
      map.set(membership[i], id);
    }
    membership[i] = id;
  }
  return map.size;
}

/** Connected components of the subgraph induced by each community. */
function communityComponents(graph, membership) {
  const n = graph.n;
  const seen = new Uint8Array(n);
  const counts = new Map();
  const stack = [];
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    const c = membership[s];
    counts.set(c, (counts.get(c) || 0) + 1);
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const u = stack.pop();
      const nb = graph.nbr[u];
      for (let k = 0; k < nb.length; k++) {
        const v = nb[k];
        if (!seen[v] && membership[v] === c) {
          seen[v] = 1;
          stack.push(v);
        }
      }
    }
  }
  return counts; // community id -> number of connected pieces
}

/** Number of communities whose induced subgraph is disconnected. */
function countDisconnected(graph, membership) {
  let bad = 0;
  for (const pieces of communityComponents(graph, membership).values()) {
    if (pieces > 1) bad++;
  }
  return bad;
}

module.exports = { Graph, renumber, communityComponents, countDisconnected };
