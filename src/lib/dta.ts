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
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(start, end));
  } catch {
    throw new Error("Stata 文本不是有效 UTF-8；当前不支持该历史编码，请在 Stata 中重导出为 Unicode 118/119 格式后再导入。");
  }
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
  if (s < 0) throw new Error(`Stata 文件结构损坏：缺少 ${open} 标记。`);
  const start = s + open.length;
  const e = findTag(hay, close, start);
  if (e < 0) throw new Error(`Stata 文件结构损坏：缺少 ${close} 标记。`);
  return { start, end: e };
}

function typeSize(t: number): number {
  if (t >= 1 && t <= 2045) return t;
  if (t === STRL) return 8;
  if (t === DOUBLE) return 8;
  if (t === FLOAT || t === LONG) return 4;
  if (t === INT) return 2;
  if (t === BYTE) return 1;
  throw new Error(`不支持的 Stata 字段类型 ${t}。`);
}

function mapOffsets(u8: Uint8Array, dv: DataView, le: boolean): number[] {
  const span = inner(u8.subarray(0, 1024), "<map>", "</map>");
  if (span.end - span.start < 14 * 8) throw new Error("Stata map 区长度不足，文件可能已损坏。");
  const offsets: number[] = [];
  for (let i = 0; i < 14; i++) {
    const lo = dv.getUint32(span.start + i * 8, le);
    const hi = dv.getUint32(span.start + i * 8 + 4, le);
    const value = le ? lo + hi * 2 ** 32 : hi + lo * 2 ** 32;
    if (!Number.isSafeInteger(value) || value > u8.length) throw new Error("Stata map 包含越界位置，文件可能已损坏。");
    offsets.push(value);
  }
  return offsets;
}

function parseStrLs(u8: Uint8Array, dv: DataView, le: boolean, release: number, start: number, end: number): Map<string, string> {
  const values = new Map<string, string>();
  let pos = start;
  while (pos < end) {
    const referenceWidth = release === 117 ? 8 : 12;
    const headerWidth = 3 + referenceWidth + 1 + 4;
    if (pos + headerWidth > end) throw new Error("Stata strL 区固定头部长度不足，文件可能已损坏。");
    if (u8[pos] !== 0x47 || u8[pos + 1] !== 0x53 || u8[pos + 2] !== 0x4f) throw new Error("Stata strL 区包含无法识别的记录。");
    pos += 3;
    let keyBytes: number[];
    if (release === 117) {
      keyBytes = [...u8.subarray(pos, pos + 8)];
      pos += 8;
    } else {
      const packed = u8.subarray(pos, pos + 12);
      const vSize = release === 118 ? 2 : 3;
      keyBytes = le
        ? [...packed.subarray(0, vSize), ...packed.subarray(4, 12 - vSize)]
        : [...packed.subarray(0, vSize), ...packed.subarray(4 + vSize, 12)];
      pos += 12;
    }
    const kind = u8[pos++]!;
    const length = dv.getUint32(pos, le);
    pos += 4;
    if (length === 0 || length > end - pos) throw new Error("Stata strL 文本长度越过数据区边界或为空。");
    if (kind !== 130) throw new Error("此 Stata 文件包含二进制 strL 字段，当前导入仅支持文本 strL；文件未被导入。");
    if (u8[pos + length - 1] !== 0) throw new Error("Stata strL 文本缺少结尾 NUL 字节，文件可能已损坏。");
    let value: string;
    try { value = new TextDecoder("utf-8", { fatal: true }).decode(u8.subarray(pos, pos + length - 1)); }
    catch { throw new Error("Stata strL 文本不是有效 UTF-8，文件未被导入。"); }
    const key = keyBytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (values.has(key)) throw new Error("Stata strL 区包含重复引用，文件可能已损坏。");
    values.set(key, value);
    pos += length;
  }
  return values;
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
  const relSpan = inner(u8.subarray(0, 512), "<release>", "</release>");
  const release = Number(new TextDecoder().decode(u8.subarray(relSpan.start, relSpan.end)));
  if (release < 117 || release > 119) throw new Error(`不支持 Stata 格式 ${release}。`);
  const boSpan = inner(u8.subarray(0, 512), "<byteorder>", "</byteorder>");
  const bo = new TextDecoder().decode(u8.subarray(boSpan.start, boSpan.end)).trim();
  if (bo !== "LSF" && bo !== "MSF") throw new Error("Stata 文件字节序无效。");
  const le = bo === "LSF";
  const dv = new DataView(buffer);
  const offsets = mapOffsets(u8, dv, le);

  const kBytes = release >= 119 ? 4 : 2;
  const nBytes = release >= 118 ? 8 : 4;
  const nameW = release >= 118 ? 129 : 33;
  const labW = release >= 118 ? 321 : 81;

  const kSpan = inner(u8.subarray(0, 512), "<K>", "</K>");
  const nSpan = inner(u8.subarray(0, 512), "<N>", "</N>");
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
  const expected = rowBytes * nObs;
  const dataStart = offsets[9]! + "<data>".length;
  const dataEnd = offsets[10]! - "</data>".length;
  if (dataStart + expected !== dataEnd) throw new Error("Stata 数据区长度与 map 和字段宽度不一致，文件可能已损坏。");
  const strlValues = types.includes(STRL)
    ? parseStrLs(u8, dv, le, release, offsets[10]! + "<strls>".length, offsets[11]! - "</strls>".length)
    : new Map<string, string>();

  const rows: Record<string, string | number | null>[] = [];
  let pos = dataStart;
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
        const key = [...u8.subarray(pos, pos + 8)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
        if (key === "0000000000000000") o[h] = null;
        else {
          const value = strlValues.get(key);
          if (value === undefined) throw new Error(`Stata 第 ${r + 1} 行「${h}」字段引用了不存在的 strL 记录，文件未被导入。`);
          o[h] = value;
        }
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
  parseValueLabels(
    u8,
    dv,
    le,
    release,
    offsets[11]! + "<value_labels>".length,
    offsets[12]! - "</value_labels>".length,
    valueLabels,
  );

  return { nObs, nVar, headers, labels, rows, lblnames, valueLabels };
}

function parseValueLabels(
  u8: Uint8Array,
  dv: DataView,
  le: boolean,
  release: number,
  start: number,
  end: number,
  out: Record<string, Record<number, string>>,
) {
  const nameW = release >= 118 ? 129 : 33;
  const open = new TextEncoder().encode("<lbl>");
  const close = new TextEncoder().encode("</lbl>");
  let pos = start;
  while (pos < end) {
    const s = findTag(u8, "<lbl>", pos);
    if (s < 0 || s >= end) throw new Error("Stata 值标签区结构不完整。");
    let p = s + open.length;
    if (p + 4 + nameW + 3 > end) throw new Error("Stata 值标签固定头部长度不足。");
    const tableLen = dv.getUint32(p, le);
    p += 4;
    const labname = decodeC(u8, p, nameW);
    p += nameW + 3;
    const tableEnd = p + tableLen;
    if (!labname || tableLen < 8 || tableEnd + close.length > end) throw new Error("Stata 值标签表长度越过 map 边界。");
    if (findTag(u8, "</lbl>", tableEnd) !== tableEnd) throw new Error("Stata 值标签表长度与结束标记不符。");
    const n = dv.getInt32(p, le);
    const txtlen = dv.getInt32(p + 4, le);
    if (n <= 0 || n > 5000 || txtlen < 0 || txtlen > 2_000_000 || 8 + 8 * n + txtlen !== tableLen) {
      throw new Error("Stata 值标签表中的数量或长度无效。");
    }
    const arraysStart = p + 8;
    const off: number[] = [];
    for (let i = 0; i < n; i++) off.push(dv.getInt32(arraysStart + i * 4, le));
    const valsStart = arraysStart + 4 * n;
    const val: number[] = [];
    for (let i = 0; i < n; i++) val.push(dv.getInt32(valsStart + i * 4, le));
    const textStart = valsStart + 4 * n;
    const txt = u8.subarray(textStart, textStart + txtlen);
    const map: Record<number, string> = {};
    for (let i = 0; i < n; i++) {
      const o = off[i]!;
      if (o < 0 || o >= txtlen) throw new Error("Stata 值标签文本偏移越界。");
      let end = o;
      while (end < txtlen && txt[end] !== 0) end++;
      try { map[val[i]!] = new TextDecoder("utf-8", { fatal: true }).decode(txt.subarray(o, end)); }
      catch { throw new Error("Stata 值标签文本不是有效 UTF-8。"); }
    }
    out[labname] = map;
    pos = tableEnd + close.length;
  }
}
