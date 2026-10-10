#!/usr/bin/env node
// Minimal read-only asar extractor (zero dependencies).
//
// DSH ships its runtime inside `app.asar`. To build a client plugin that is
// actually loaded by this exact app, we must read the app's own loader code.
// This tool extracts only the named members -- it never writes into the app.
//
// Usage:
//   node tools/asar-extract.mjs --asar <app.asar> --list [substring]
//   node tools/asar-extract.mjs --asar <app.asar> --get <inner/path> --out <file>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function parseArgs(argv) {
  const out = { list: false, filters: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--asar') out.asar = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--get') out.get = argv[++i];
    else if (a === '--list') out.list = true;
    else out.filters.push(a);
  }
  return out;
}

function readHeader(buf) {
  // This build's app.asar does NOT use the classic Pickle layout. Its header is:
  //   [0..4)   0x00000004
  //   [4..16)  three u32 values (byte sizes, descending)
  //   [16..)   the JSON directory -- the same object the sibling
  //            `.asar-index.json` checkpoints -- followed by the file data.
  // Rather than guess the size fields, locate the JSON start and brace-match it.
  const start = buf.indexOf('{"files"', 0, 'utf8');
  if (start < 0) throw new Error('asar header JSON not found');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < buf.length; i++) {
    const c = buf[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === 0x5c) escaped = true;
      else if (c === 0x22) inString = false;
      continue;
    }
    if (c === 0x22) inString = true;
    else if (c === 0x7b) depth++;
    else if (c === 0x7d) {
      depth--;
      if (depth === 0) {
        const json = buf.toString('utf8', start, i + 1);
        return { json: JSON.parse(json), dataOffset: i + 1 };
      }
    }
  }
  throw new Error('unterminated asar header');
}

function walk(node, prefix, visit) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const full = prefix + '/' + name;
    if (entry.files) walk(entry, full, visit);
    else visit(full, entry);
  }
}

const args = parseArgs(process.argv.slice(2));
if (!args.asar) {
  console.error('need --asar <path>');
  process.exit(2);
}
const buf = readFileSync(args.asar);
const header = readHeader(buf);
const files = new Map();
walk(header.json, '', (path, entry) => files.set(path, entry));

if (args.list) {
  const needles = args.filters;
  for (const path of [...files.keys()].sort()) {
    if (!needles.length || needles.some(n => path.includes(n))) console.log(path);
  }
  console.log(`\n# ${files.size} files total; header dataOffset=${header.dataOffset}`);
} else if (args.get) {
  const key = '/' + args.get.replace(/^\/+/, '');
  const entry = files.get(key);
  if (!entry) {
    console.error('not found: ' + key);
    process.exit(1);
  }
  const start = header.dataOffset + Number(entry.offset);
  const bytes = buf.subarray(start, start + entry.size);
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, bytes);
    console.log(`${key} -> ${args.out} (${entry.size} bytes)`);
  } else {
    process.stdout.write(bytes);
  }
} else {
  console.error('need --list or --get');
  process.exit(2);
}
