# leiden-communities

Community detection for graphs with the **Leiden algorithm** (Traag, Waltman and van Eck, 2019), written from scratch in plain JavaScript with zero dependencies. The classic **Louvain algorithm** is included as a baseline, both run on the same graph structure and the same quality functions, so you can compare them honestly.

```
$ node examples/bridge.js
start    Q=0.3555
louvain  Q=0.4229  disconnected=1  {0,1,2,3,4,5,6,7,8,9} {10,11,12,13,14,15}
leiden   Q=0.6029  disconnected=0  {0,1,2,3,4} {5,6,7,8,9} {10,11,12,13,14,15}
```

## Why this exists

Louvain is the algorithm most people reach for when they want to split a network into communities, and it has a well documented flaw: it can return communities that are not even connected. When a node that holds a community together moves elsewhere, the two halves it was bridging stay labelled as one community, and because Louvain only ever moves single nodes or whole aggregated communities, nothing can split them again. The Leiden paper showed this happens a lot on real networks.

Leiden fixes it by adding a **refinement phase** between local moving and aggregation. Each community is repartitioned from singletons into well connected sub communities, and the graph is aggregated on those, so the next level can still separate parts that do not belong together. The result is a guarantee that every community is connected (in fact γ connected), and in practice better quality in the same time.

This repo implements all of that in about 500 lines of readable code, with tests that check the algorithm against exhaustive search, known optima and the guarantees from the paper.

## What is in it

| Piece | File | Notes |
| --- | --- | --- |
| Weighted graph, aggregation | `src/graph.js` | adjacency arrays, self loops, node sizes carried through aggregation |
| Quality functions | `src/quality.js` | modularity with resolution γ (Reichardt and Bornholdt) and the Constant Potts Model (CPM) |
| Leiden and Louvain | `src/optimise.js` | queue based fast local moving, randomised refinement with temperature θ, multi pass iteration |
| Metrics | `src/metrics.js` | NMI (arithmetic normalisation) and adjusted Rand index |
| Generators and data | `src/generators.js`, `src/datasets.js` | planted partition, ring of cliques, Zachary karate club |
| CLI | `bin/leiden.js` | edge list in, assignment or JSON out |

## Quick start

Needs Node 18 or newer. Nothing to install.

```bash
git clone https://github.com/MohammadHossinzehi/leiden-communities
cd leiden-communities
npm test                       # 25 tests, about one second
node bin/leiden.js examples/karate.txt --stats
```

As a library:

```js
const { Graph, leiden, louvain, nmi } = require('./src');

const g = Graph.fromEdges(6, [[0, 1], [1, 2], [0, 2], [3, 4], [4, 5], [3, 5], [2, 3]]);
const r = leiden(g, { quality: 'modularity', resolution: 1, seed: 42 });
r.membership;   // Int32Array [0, 0, 0, 1, 1, 1]
r.quality;      // 0.357...
r.communities;  // 2
```

Options for `leiden` and `louvain`:

| Option | Default | Meaning |
| --- | --- | --- |
| `quality` | `'modularity'` | `'modularity'` or `'cpm'` |
| `resolution` | `1` | γ. Higher means more, smaller communities |
| `theta` | `0.01` | refinement temperature (Leiden only), in edge weight units |
| `iterations` | `2` | passes over the whole algorithm; a negative value keeps going until a pass stops improving quality |
| `seed` | `1` | everything is deterministic for a fixed seed |
| `initial` | none | starting membership, useful to continue from an earlier result |

### Command line

```bash
node bin/leiden.js graph.txt                         # node<TAB>community, largest community = 0
node bin/leiden.js graph.txt --json --stats          # JSON with quality, counts, timing
node bin/leiden.js graph.txt --quality cpm --resolution 0.05
cat graph.txt | node bin/leiden.js - --algorithm louvain
```

The input is one edge per line, `u v` or `u v weight`, separated by spaces, tabs or commas. Node labels can be any token and lines starting with `#` or `%` are comments.

## The experiments

**Karate club.** Leiden finds the proven modularity optimum of Zachary's karate club, Q = 0.4197896 with four communities, on every seed tested when run to convergence (`iterations: -1`).

**Bridge graph** (`npm run bridge`). Sixteen nodes that reproduce the Louvain failure from the paper deterministically: two cliques held together by one node, which is pulled towards a third clique. Louvain moves it and is stuck with a disconnected community at Q = 0.4229. Leiden refines, splits the halves and reaches Q = 0.6029.

**Planted partitions** (`npm run bench`). 5000 node sparse block models with 50 groups, mean degree 8 and a growing share μ of edges that ignore the groups. Means over 8 graphs, default settings for both:

| μ | Leiden Q | Louvain Q | Leiden NMI | Louvain NMI | disconnected (Leiden / Louvain) |
| --- | --- | --- | --- | --- | --- |
| 0.20 | 0.7825 | 0.7823 | 0.989 | 0.986 | 0 / 0 |
| 0.35 | 0.6352 | 0.6336 | 0.938 | 0.919 | 0 / 0 |
| 0.50 | 0.4799 | 0.4749 | 0.691 | 0.657 | 0 / 5 |
| 0.60 | 0.3804 | 0.3791 | 0.223 | 0.222 | 0 / 2 |

Leiden is never worse, and as the structure gets noisier Louvain starts emitting disconnected communities while Leiden never does. Runtime is in the same range, a few tens of milliseconds per graph. On a 200,000 node, 1.1 million edge graph both finish in about four seconds in a single Node process.

**Resolution limit** (`npm run resolution`). Thirty 5 cliques in a ring. Modularity at γ = 1 merges neighbouring cliques into 17 communities, which is the resolution limit of Fortunato and Barthelemy. CPM recovers all 30 cliques for any γ between the inter clique density and 1, and so does modularity once γ is raised to 2.

## Design notes

**One gain formula for two quality functions.** Modularity and CPM both have the form Σ_c [e_c − λ W_c² / 2], where e_c is the edge weight inside community c and W_c is a summed node weight. For modularity the node weight is the degree and λ = γ / 2m; for CPM it is the node size and λ = γ. So moving node v into community c always changes quality by k_{v,c} − λ w_v W_c, and the optimiser never needs to know which function it is maximising. Aggregation keeps both node weights consistent (self loops count twice in the strength, sizes are summed), and a test checks that quality is identical on every level.

**Refinement in raw units.** The refinement picks a target sub community with probability proportional to exp(gain / θ). My first version measured the gain in modularity units (divided by 2m), which makes every gain tiny, the distribution nearly uniform, and refinement little better than random merging. The benchmark caught it: single pass Leiden came out *worse* than Louvain. Using raw edge weight units, as igraph does, fixed that, and Leiden then beat Louvain at every noise level.

**Well connectedness is checked incrementally.** A node is merged only if E(v, S − v) ≥ λ w_v (W_S − w_v), and only into a sub community T with E(T, S − T) ≥ λ W_T (W_S − W_T). E(T, S − T) is updated in O(1) per merge as E(T) + E(v) − 2 k_{v,T}, so refinement costs one pass over the edges.

**Fast local moving.** Leiden's local moving uses a work queue: after a node moves, only its neighbours outside the new community are queued again, instead of sweeping every node until nothing changes. Nodes can also move into an empty community, which keeps the partition free to split.

**Louvain is a fair baseline.** It uses the same graph, gains and RNG. Repeated passes restart local moving on the original nodes from the previous partition, which is how Louvain is iterated in practice and exactly where disconnected communities come from.

## How it is tested

The suite (`npm test`, built on `node:test`) covers:

* **Exhaustive oracle.** For 25 random weighted graphs on 8 nodes, every set partition (4140 of them) is enumerated. Leiden never reports a value above the true optimum, and its best of 10 seeds hits the optimum in at least 95% of cases for both modularity and CPM.
* **Guarantees from the paper.** Run to convergence, Leiden is node optimal: no single node move improves quality. Its communities are always connected, checked on 20 random graphs under both quality functions. The refined partition is always a sub partition of the coarse one with connected parts.
* **Known answers.** Karate club optimum, exact recovery of a clear planted partition (NMI = ARI = 1), the bridge graph, CPM on the ring of cliques.
* **Plumbing.** Aggregation invariants, hand computed modularity, CPM, NMI and ARI values, weighted edges, reproducibility per seed, monotone quality across passes, empty and tiny graphs, option validation, and the CLI end to end including stdin.

## References

V. A. Traag, L. Waltman, N. J. van Eck. *From Louvain to Leiden: guaranteeing well connected communities.* Scientific Reports 9, 5233 (2019).

V. D. Blondel, J. L. Guillaume, R. Lambiotte, E. Lefebvre. *Fast unfolding of communities in large networks.* J. Stat. Mech. (2008).

V. A. Traag, P. Van Dooren, Y. Nesterov. *Narrow scope for resolution limit free community detection.* Phys. Rev. E 84, 016114 (2011).

S. Fortunato, M. Barthelemy. *Resolution limit in community detection.* PNAS 104, 36 (2007).

## License

MIT
