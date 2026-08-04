'use strict';
/**
 * formatting — stateless output formatting.
 *
 * Zero-dependency helpers for pretty terminal output. ANSI colors are
 * auto-disabled when stdout is not a TTY or when NO_COLOR is set, so piped
 * output stays clean.
 */

const USE_COLOR = !!process.stdout && !!process.stdout.isTTY && !process.env.NO_COLOR;

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

const paint = (code, s) => (USE_COLOR ? ANSI[code] + s + ANSI.reset : String(s));
const bold = (s) => paint('bold', s);
const dim = (s) => paint('dim', s);
const red = (s) => paint('red', s);
const green = (s) => paint('green', s);
const yellow = (s) => paint('yellow', s);
const cyan = (s) => paint('cyan', s);

// visible length, ignoring ANSI escapes
function vlen(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '').length;
}

function pad(s, width, align = 'left') {
  const str = String(s);
  const diff = Math.max(0, width - vlen(str));
  if (align === 'right') return ' '.repeat(diff) + str;
  if (align === 'center') {
    const l = Math.floor(diff / 2);
    return ' '.repeat(l) + str + ' '.repeat(diff - l);
  }
  return str + ' '.repeat(diff);
}

/**
 * Pretty box table.
 *   headers: string[]
 *   rows:    array of arrays (cells may contain ANSI via the helpers above)
 *   opts.align: { [colIndex]: 'left' | 'right' | 'center' }
 */
function table(headers, rows, opts = {}) {
  const widths = headers.map((h, i) =>
    Math.max(vlen(h), ...rows.map((r) => vlen(r[i] === undefined ? '' : r[i])))
  );
  const border = (l, m, r) =>
    l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r;
  const render = (cells) =>
    '│ ' +
    cells.map((c, i) => pad(c, widths[i], (opts.align && opts.align[i]) || 'left')).join(' │ ') +
    ' │';
  const out = [border('┌', '┬', '┐')];
  out.push(render(headers.map((h) => bold(h))));
  out.push(border('├', '┼', '┤'));
  for (const r of rows) out.push(render(r));
  out.push(border('└', '┴', '┘'));
  return out.join('\n');
}

// colored status chip for runner summaries
function statusChip(status) {
  const s = String(status).toUpperCase();
  if (s === 'OK') return green(' ok ');
  if (s === 'FAILED' || s.startsWith('FAILED')) return red('FAIL ');
  if (s === 'TIMED OUT') return yellow('TIME ');
  return dim(' ' + s + ' ');
}

module.exports = { table, statusChip, pad, paint, bold, dim, red, green, yellow, cyan, vlen };
