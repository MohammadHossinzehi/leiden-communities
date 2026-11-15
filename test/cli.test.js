'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseEdgeList } = require('../src');

const BIN = path.join(__dirname, '..', 'bin', 'leiden.js');
const KARATE = path.join(__dirname, '..', 'examples', 'karate.txt');

test('parseEdgeList handles labels, comments, weights and commas', () => {
  const { graph, labels } = parseEdgeList('# comment\nalice bob 2\nbob,carol\n\n% other comment\ncarol alice 0.5\n');
  assert.deepEqual(labels, ['alice', 'bob', 'carol']);
  assert.equal(graph.totalWeight(), 3.5);
  assert.throws(() => parseEdgeList('a\n'), SyntaxError);
  assert.throws(() => parseEdgeList('a b x\n'), SyntaxError);
});

test('CLI prints a tab separated assignment', () => {
  const out = execFileSync('node', [BIN, KARATE], { encoding: 'utf8' });
  const lines = out.trim().split('\n');
  assert.equal(lines.length, 34);
  const comms = new Set(lines.map((l) => l.split('\t')[1]));
  assert.equal(comms.size, 4);
});

test('CLI JSON output reports quality and connectivity', () => {
  const out = execFileSync('node', [BIN, KARATE, '--json', '--seed', '3', '--iterations', '-1'], { encoding: 'utf8' });
  const r = JSON.parse(out);
  assert.equal(r.algorithm, 'leiden');
  assert.equal(r.communities, 4);
  assert.equal(r.disconnected, 0);
  assert.ok(Math.abs(r.value - 0.4197896) < 1e-6);
  assert.equal(Object.keys(r.assignment).length, 34);
});

test('CLI reads stdin and rejects unknown options', () => {
  const out = execFileSync('node', [BIN, '-', '--quality', 'cpm', '--resolution', '0.5'], {
    input: 'a b\nb c\nc a\nx y\n',
    encoding: 'utf8',
  });
  assert.equal(out.trim().split('\n').length, 5);
  assert.throws(() => execFileSync('node', [BIN, KARATE, '--bogus'], { stdio: 'pipe' }));
});
