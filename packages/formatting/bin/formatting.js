#!/usr/bin/env node
/**
 * formatting — stateless CLI. Reads JSON on stdin, prints a pretty table.
 *
 * Input forms:
 *   {"headers": ["a","b"], "rows": [[1,2],[3,4]], "align": {"1":"right"}}
 *   [[header1, header2], [row...], [row...]]     (first row = headers)
 *
 * Flags:
 *   --no-color   force plain output (auto-disabled when not a TTY anyway)
 *
 * Usage:
 *   echo '{"headers":["demo","dur"],"rows":[["a","1.2s"]]}' | formatting
 */
'use strict';

const { table } = require('../lib/format.js');

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('formatting: bad JSON:', e.message);
    process.exit(1);
  }
  let headers;
  let rows;
  let align;
  if (Array.isArray(data)) {
    headers = data[0];
    rows = data.slice(1);
  } else {
    headers = data.headers;
    rows = data.rows;
    align = data.align;
  }
  if (!Array.isArray(headers) || !Array.isArray(rows)) {
    console.error('formatting: expected {"headers":[],"rows":[[]]} or [[header],[row],...]');
    process.exit(2);
  }
  process.stdout.write(table(headers, rows, { align }) + '\n');
});
