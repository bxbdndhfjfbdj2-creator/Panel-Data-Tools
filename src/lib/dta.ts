/** Stata 117–119 (.dta) reader for browser / Node. */

export interface DtaTable {
  nObs: number;
  nVar: number;
  headers: string[];
  labels: Record<string, string>;
  rows: Record<string, string | number | null>[];
  /** varname → value-label set name */
  lblnames: Record<string, string>;
  /** label-set name → numeric code → text */
  valueLabels: Record<string, Record<number, string>>;
}

const DOUBLE = 65526;
const FLOAT = 65527;
const LONG = 65528;
const INT = 65529;
const BYTE = 65530;
const STRL = 32768;

function decodeC(buf: Uint8Array, start: number, len: number): string {
  let end = start;
  const last = Math.min(start + len, buf.length);
  while (end < last && buf[end] !== 0) end++;
  return new TextDecoder("utf-8").decode(buf.subarray(start, end)).trim();
}

function findTag(hay: Uint8Array, tag: string, from = 0): number {
  const needle = new TextEncoder().encode(tag);
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function inner(hay: Uint8Array, open: string, close: string, from = 0): { start: number; end: number } {
  const s = findTag(hay, open, from);
  if (s < 0) throw new Error(`dta 缺少 ${open}`);
  const start = s + open.length;
  const e = findTag(hay, close, start);
  if (e < 0) throw new Error(`dta 缺少 ${close}`);
  return { start, end: e };
}

function typeSize(t: number): number {
  if (t >= 1 && t <= 2045) return t;
  if (t === STRL) return 8;
  if (t === DOUBLE) return 8;
  if (t === FLOAT || t === LONG) return 4;
  if (t === INT) return 2;
  if (t === BYTE) return 1;
  throw new Error(`不支持的 Stata 类型 ${t}`);
}

function isMiss(t: number, v: number): boolean {
  if (!Number.isFinite(v)) return true;
  if (t === BYTE) return v > 100;
  if (t === INT) return v > 32740;
  if (t === LONG) return v >= 2147483621;
  if (t === FLOAT) return Math.abs(v) >= 1.701e38;
  if (t === DOUBLE) return Math.abs(v) >= 8.988e307;
  return false;
}

export function parseDta(buffer: ArrayBuffer): DtaTable {
  const u8 = new Uint8Array(buffer);
  const head = new TextDecoder("latin1").decode(u8.subarray(0, 40));
  if (!head.includes("<stata_dta>")) {
    throw new Error("仅支持 Stata 117–119（XML 头）的 .dta 文件。");
  }
  const relSpan = inner(u8, "<release>", "</release>");
  const release = Number(new TextDecoder().decode(u8.subarray(relSpan.start, relSpan.end)));
  if (release < 117 || release > 119) throw new Error(`不支持 Stata 格式 ${release}。`);
  const boSpan = inner(u8, "<byteorder>", "</byteorder>");
  const bo = new TextDecoder().decode(u8.subarray(boSpan.start, boSpan.end)).trim();
  const le = bo === "LSF";
  const dv = new DataView(buffer);

  const kBytes = release >= 119 ? 4 : 2;
  const nBytes = release >= 118 ? 8 : 4;
  const nameW = release >= 118 ? 129 : 33;
  const labW = release >= 118 ? 321 : 81;

  const kSpan = inner(u8, "<K>", "</K>");
  const nSpan = inner(u8, "<N>", "</N>");
  const nVar = kBytes === 4 ? dv.getUint32(kSpan.start, le) : dv.getUint16(kSpan.start, le);
  let nObs: number;
  if (nBytes === 8) {
    const lo = dv.getUint32(nSpan.start, le);
    const hi = dv.getUint32(nSpan.start + 4, le);
    nObs = le ? lo + hi * 2 ** 32 : hi + lo * 2 ** 32;
  } else {
    nObs = dv.getUint32(nSpan.start, le);
  }
  if (!nVar || !nObs) throw new Error("空的 Stata 文件。");
  if (nObs > 250_000) throw new Error(`观测过多（${nObs}），请先在 Stata 中裁成子集再导入。`);

  const tSpan = inner(u8, "<variable_types>", "</variable_types>");
  const types: number[] = [];
  for (let i = 0; i < nVar; i++) types.push(dv.getUint16(tSpan.start + i * 2, le));

  const vSpan = inner(u8, "<varnames>", "</varnames>");
  const headers: string[] = [];
  const used = new Set<string>();
  for (let i = 0; i < nVar; i++) {
    let h = decodeC(u8, vSpan.start + i * nameW, nameW) || `v${i + 1}`;
    if (used.has(h)) {
      let k = 2;
      while (used.has(`${h}_${k}`)) k++;
      h = `${h}_${k}`;
    }
    used.add(h);
    headers.push(h);
  }

  const lSpan = inner(u8, "<variable_labels>", "</variable_labels>");
  const labels: Record<string, string> = {};
  for (let i = 0; i < nVar; i++) {
    const lab = decodeC(u8, lSpan.start + i * labW, labW);
    if (lab) labels[headers[i]!] = lab;
  }

  const sizes = types.map(typeSize);
  const rowBytes = sizes.reduce((a, b) => a + b, 0);
  const dSpan = inner(u8, "<data>", "</data>");
  const expected = rowBytes * nObs;
  if (dSpan.end - dSpan.start < expected) {
    throw new Error("dta 数据区不完整。");
  }

  const rows: Record<string, string | number | null>[] = [];
  let pos = dSpan.start;
  for (let r = 0; r < nObs; r++) {
    const o: Record<string, string | number | null> = {};
    for (let j = 0; j < nVar; j++) {
      const t = types[j]!;
      const h = headers[j]!;
      if (t >= 1 && t <= 2045) {
        const s = decodeC(u8, pos, t);
        o[h] = s === "" ? null : s;
        pos += t;
        continue;
      }
      if (t === STRL) {
        o[h] = null;
        pos += 8;
        continue;
      }
      let v: number;
      if (t === BYTE) {
        v = dv.getInt8(pos);
        pos += 1;
      } else if (t === INT) {
        v = dv.getInt16(pos, le);
        pos += 2;
      } else if (t === LONG) {
        v = dv.getInt32(pos, le);
        pos += 4;
      } else if (t === FLOAT) {
        v = dv.getFloat32(pos, le);
        pos += 4;
      } else {
        v = dv.getFloat64(pos, le);
        pos += 8;
      }
      o[h] = isMiss(t, v) ? null : v;
    }
    rows.push(o);
  }

  const lblnames: Record<string, string> = {};
  const valueLabels: Record<string, Record<number, string>> = {};
  try {
    const lnSpan = inner(u8, "<value_label_names>", "</value_label_names>");
    for (let i = 0; i < nVar; i++) {
      const nm = decodeC(u8, lnSpan.start + i * nameW, nameW);
      if (nm) lblnames[headers[i]!] = nm;
    }
  } catch {
    /* optional */
  }
  try {
    parseValueLabels(u8, dv, le, release, valueLabels);
  } catch {
    /* optional */
  }

  return { nObs, nVar, headers, labels, rows, lblnames, valueLabels };
}

function parseValueLabels(
  u8: Uint8Array,
  dv: DataView,
  le: boolean,
  release: number,
  out: Record<string, Record<number, string>>,
) {
  const span = inner(u8, "<value_labels>", "</value_labels>");
  const nameW = release >= 118 ? 129 : 33;
  const open = new TextEncoder().encode("<lbl>");
  const close = new TextEncoder().encode("</lbl>");
  let pos = span.start;
  while (pos + open.length + 8 < span.end) {
    const s = findTag(u8, "<lbl>", pos);
    if (s < 0 || s >= span.end) break;
    const e = findTag(u8, "</lbl>", s + open.length);
    if (e < 0 || e > span.end) break;
    pos = e + close.length;
    let p = s + open.length;
    if (p + 4 + nameW + 3 + 8 > e) continue;
    const tableLen = dv.getUint32(p, le);
    p += 4;
    const labname = decodeC(u8, p, nameW);
    p += nameW + 3;
    if (!labname || tableLen < 8 || p + tableLen > e + 4) continue;
    const n = dv.getInt32(p, le);
    const txtlen = dv.getInt32(p + 4, le);
    p += 8;
    if (n <= 0 || n > 5000 || txtlen <= 0 || txtlen > 2_000_000) continue;
    if (p + 8 * n + txtlen > e + 8) continue;
    const off: number[] = [];
    for (let i = 0; i < n; i++) off.push(dv.getInt32(p + i * 4, le));
    p += 4 * n;
    const val: number[] = [];
    for (let i = 0; i < n; i++) val.push(dv.getInt32(p + i * 4, le));
    p += 4 * n;
    const txt = u8.subarray(p, p + txtlen);
    const map: Record<number, string> = {};
    for (let i = 0; i < n; i++) {
      const o = off[i]!;
      if (o < 0 || o >= txtlen) continue;
      let end = o;
      while (end < txtlen && txt[end] !== 0) end++;
      const label = new TextDecoder("utf-8").decode(txt.subarray(o, end)).trim();
      if (label) map[val[i]!] = label;
    }
    if (Object.keys(map).length) out[labname] = map;
  }
}
