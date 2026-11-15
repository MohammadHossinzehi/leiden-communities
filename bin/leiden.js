#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { leiden, louvain, parseEdgeList, countDisconnected } = require('../src');

const USAGE = `usage: leiden <edges.txt | -> [options]

Reads an edge list ("u v [weight]" per line, # comments) and prints one
"node<TAB>community" line per node, largest community first.

options
  --algorithm leiden|louvain   default leiden
  --quality modularity|cpm     default modularity
  --resolution <gamma>         default 1
  --theta <t>                  refinement randomness, default 0.01
  --iterations <k>             passes; negative runs until no improvement, default 2
  --seed <s>                   default 1
  --json                       print a JSON object instead
  --stats                      print a summary to stderr
  -h, --help`;

function parseArgs(argv) {
  const o = { algorithm: 'leiden', quality: 'modularity', resolution: 1, theta: 0.01, iterations: 2, seed: 1 };
  let file = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    switch (a) {
      case '-h':
      case '--help':
        o.help = true;
        break;
      case '--algorithm':
        o.algorithm = next();
        break;
      case '--quality':
        o.quality = next();
        break;
      case '--resolution':
        o.resolution = Number(next());
        break;
      case '--theta':
        o.theta = Number(next());
        break;
      case '--iterations':
        o.iterations = Number(next());
        break;
      case '--seed':
        o.seed = Number(next());
        break;
      case '--json':
        o.json = true;
        break;
      case '--stats':
        o.stats = true;
        break;
      default:
        if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
        file = a;
    }
  }
  return { o, file };
}

function main(argv) {
  const { o, file } = parseArgs(argv);
  if (o.help || !file) {
    console.log(USAGE);
    return o.help ? 0 : 2;
  }
  const text = fs.readFileSync(file === '-' ? 0 : file, 'utf8');
  const { graph, labels } = parseEdgeList(text);
  const run = { leiden, louvain }[o.algorithm];
  if (!run) throw new Error(`unknown algorithm ${o.algorithm}`);
  const t0 = process.hrtime.bigint();
  const res = run(graph, o);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  // order communities by size so community 0 is the largest
  const sizes = new Map();
  for (const c of res.membership) sizes.set(c, (sizes.get(c) || 0) + 1);
  const rank = new Map([...sizes.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]).map(([c], i) => [c, i]));

  const disconnected = countDisconnected(graph, res.membership);
  if (o.json) {
    const assignment = {};
    labels.forEach((l, i) => (assignment[l] = rank.get(res.membership[i])));
    console.log(
      JSON.stringify(
        {
          algorithm: res.algorithm,
          quality: res.qualityName,
          resolution: res.resolution,
          value: res.quality,
          communities: res.communities,
          disconnected,
          milliseconds: ms,
          assignment,
        },
        null,
        2,
      ),
    );
  } else {
    const lines = labels.map((l, i) => `${l}\t${rank.get(res.membership[i])}`);
    process.stdout.write(lines.join('\n') + '\n');
  }
  if (o.stats) {
    console.error(
      `${res.algorithm}: ${graph.n} nodes, ${graph.edgeCount()} edges, ${res.communities} communities, ` +
        `${res.qualityName}=${res.quality.toFixed(6)}, disconnected=${disconnected}, ${ms.toFixed(1)} ms`,
    );
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`leiden: ${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main, parseArgs };
