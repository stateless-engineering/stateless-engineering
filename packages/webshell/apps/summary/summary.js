#!/usr/bin/env node
/**
 * summary — wireable transformer app for the webshell compositor.
 *
 * Reads a JSON array of objects on stdin (e.g. `bench-runner --json` output),
 * emits the array-of-arrays table form the `formatting` app consumes
 * (first row = headers). This is how you wire a JSON producer into the
 * pretty-table renderer: bench-runner → summary → formatting.
 *
 * Stateless: stdin in, stdout out, nothing written.
 */
'use strict';

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let arr;
  try {
    arr = JSON.parse(raw);
  } catch (e) {
    console.error('summary: bad JSON on stdin: ' + e.message);
    process.exit(1);
  }
  if (!Array.isArray(arr)) {
    console.error('summary: expected a JSON array of objects on stdin');
    process.exit(1);
  }
  if (!arr.length) {
    process.stdout.write('[[]]\n');
    return;
  }
  const headers = Object.keys(arr[0]);
  const cell = (v) => (v && typeof v === 'object' ? JSON.stringify(v) : v);
  const rows = arr.map((o) => headers.map((h) => cell(o[h])));
  process.stdout.write(JSON.stringify([headers, ...rows]) + '\n');
});
