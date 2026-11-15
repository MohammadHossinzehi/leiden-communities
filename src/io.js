'use strict';

const { Graph } = require('./graph');

/**
 * Parse a whitespace separated edge list: "u v [weight]" per line. Node
 * labels can be any token; lines starting with # or % are comments.
 * Returns the graph plus the label of every node index.
 */
function parseEdgeList(text) {
  const index = new Map();
  const labels = [];
  const edges = [];
  const id = (label) => {
    let i = index.get(label);
    if (i === undefined) {
      i = labels.length;
      index.set(label, i);
      labels.push(label);
    }
    return i;
  };
  const lines = text.split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln].trim();
    if (!line || line[0] === '#' || line[0] === '%') continue;
    const parts = line.split(/[\s,]+/);
    if (parts.length < 2) throw new SyntaxError(`line ${ln + 1}: expected "u v [weight]"`);
    const w = parts.length > 2 ? Number(parts[2]) : 1;
    if (!Number.isFinite(w) || w < 0) throw new SyntaxError(`line ${ln + 1}: bad weight "${parts[2]}"`);
    edges.push([id(parts[0]), id(parts[1]), w]);
  }
  return { graph: Graph.fromEdges(labels.length, edges), labels };
}

module.exports = { parseEdgeList };
