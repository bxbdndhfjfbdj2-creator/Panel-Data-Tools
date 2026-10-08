import type { Dataset, TransformSpec } from "./types";
import { DEFAULT_TRANSFORM } from "./types";
import {
  alphaIfDeleted,
  colValues,
  corrMatrix,
  cronbachAlpha,
  eigenSym,
  itemTotalCorr,
  kmo,
  listwise,
  parallelAnalysisNf,
  transpose,
  vifFromCorr,
} from "./stats";
import { applyTransform } from "./transform";

const LOAD_MIN = 0.4;
const CROSS_MIN = 0.32;
const MAX_FACTORS = 8;

export type ConstructMode = "factor" | "cluster";

export interface ConstructMember {
  key: string;
  name: string;
  loading: number | null;
  citc: number | null;
  alphaIfDeleted: number | null;
  flags: ("crossload" | "low_loading" | "redundant" | "hurts_alpha")[];
}

export interface ConstructCandidate {
  id: string;
  name: string;
  eigenvalue?: number;
  variance?: number;
  alpha: number | null;
  meanCitc: number | null;
  meanAbsR: number | null;
  members: ConstructMember[];
}

export interface LeftoverItem {
  key: string;
  name: string;
  reason: string;
}

export interface ConstructSuggestion {
  mode: ConstructMode;
  kmo: number | null;
  nItems: number;
  nObs: number;
  recommendedK: number;
  usedK: number;
  notes: string[];
  constructs: ConstructCandidate[];
  leftover: LeftoverItem[];
}

export interface SuggestOptions {
  /** 指定因子 / 维数；空则用平行分析或名称锚点自动决定。 */
  k?: number | null;
}

export function constructKBounds(nItems: number): { min: number; max: number } {
  if (nItems < 3) return { min: 0, max: 0 };
  return { min: nItems >= 4 ? 2 : 1, max: Math.max(1, Math.min(MAX_FACTORS, nItems - 1)) };
}

function clampK(k: number, nItems: number): number {
  const { min, max } = constructKBounds(nItems);
  if (max < 1) return 1;
  return Math.max(min, Math.min(max, Math.round(k)));
}

function recode(col: (number | null)[], direction: 1 | -1): (number | null)[] {
  if (direction === 1) return col;
  return col.map((x) => (x == null || !Number.isFinite(x) ? x : -x));
}

function prepared(ds: Dataset, keys: string[], tx: TransformSpec) {
  return keys.map((k) => {
    const ind = ds.indicators.find((i) => i.key === k);
    const raw = applyTransform(colValues(ds.rows, k), tx).col;
    return recode(raw, ind?.direction ?? 1);
  });
}

function alignedCols(cols: (number | null)[][]): number[][] | null {
  const { matrix, keep } = listwise(cols);
  if (keep.length < 8 || !matrix.length) return null;
  return transpose(matrix);
}

function reliability(cols: (number | null)[][]): {
  alpha: number | null;
  citc: (number | null)[];
  deleted: (number | null)[];
} {
  const empty = { alpha: null, citc: cols.map(() => null), deleted: cols.map(() => null) };
  if (cols.length < 2) return empty;
  const al = alignedCols(cols);
  if (!al || al.length < 2) return empty;
  const a = cronbachAlpha(al);
  const it = itemTotalCorr(al);
  const ad = al.length >= 3 ? alphaIfDeleted(al) : al.map(() => null);
  return {
    alpha: Number.isFinite(a) ? a : null,
    citc: it.map((v) => (v != null && Number.isFinite(v) ? v : null)),
    deleted: ad.map((v) => (v != null && Number.isFinite(v) ? v : null)),
  };
}

function meanAbsOffdiag(R: number[][], idx: number[]): number | null {
  if (idx.length < 2) return null;
  let s = 0;
  let n = 0;
  for (let a = 0; a < idx.length; a++) {
    for (let b = a + 1; b < idx.length; b++) {
      const r = R[idx[a]!]![idx[b]!]!;
      if (!Number.isFinite(r)) continue;
      s += Math.abs(r);
      n += 1;
    }
  }
  return n ? s / n : null;
}

function meanAbsToOthers(ids: number[], t: number, R: number[][]): number {
  const i = ids[t]!;
  let s = 0;
  let n = 0;
  for (let u = 0; u < ids.length; u++) {
    if (u === t) continue;
    const r = R[i]![ids[u]!]!;
    if (!Number.isFinite(r)) continue;
    s += Math.abs(r);
    n += 1;
  }
  return n ? s / n : 0;
}

/** Greedy: drop the most redundant item until VIF / |r| are acceptable. Always keep minKeep. */
export function pruneCollinear(
  idxs: number[],
  R: number[][],
  opts?: { maxVif?: number; maxAbsCorr?: number; minKeep?: number },
): { keep: number[]; drop: number[] } {
  const maxVif = opts?.maxVif ?? 10;
  const maxAbsCorr = opts?.maxAbsCorr ?? 0.9;
  const minKeep = opts?.minKeep ?? 2;
  const keep = idxs.slice();
  const drop: number[] = [];

  const weakestPivot = (ids: number[]): number => {
    const n = ids.length;
    const residual = ids.map((i) => R[i]![i]!);
    const factor = Array.from({ length: n }, () => Array<number>(n).fill(0));
    const used = Array<boolean>(n).fill(false);
    for (let rank = 0; rank < n; rank++) {
      let pivot = -1;
      for (let i = 0; i < n; i++) {
        if (!used[i] && (pivot < 0 || residual[i]! > residual[pivot]!)) pivot = i;
      }
      if (pivot < 0 || residual[pivot]! <= 1e-10) {
        let weakest = -1;
        for (let i = 0; i < n; i++) {
          if (!used[i] && (weakest < 0 || residual[i]! < residual[weakest]!)) weakest = i;
        }
        return weakest < 0 ? 0 : weakest;
      }
      used[pivot] = true;
      const root = Math.sqrt(residual[pivot]!);
      for (let i = 0; i < n; i++) {
        if (used[i]) continue;
        let value = R[ids[i]!]![ids[pivot]!]!;
        for (let j = 0; j < rank; j++) value -= factor[i]![j]! * factor[pivot]![j]!;
        factor[i]![rank] = value / root;
        residual[i] -= factor[i]![rank]! ** 2;
      }
    }
    return 0;
  };

  const pickWorse = (ids: number[], a: number, b: number, vifs: (number | null)[]) => {
    const va = vifs[a] ?? -Infinity;
    const vb = vifs[b] ?? -Infinity;
    if (va !== vb) return va > vb ? a : b;
    return meanAbsToOthers(ids, a, R) >= meanAbsToOthers(ids, b, R) ? a : b;
  };

  while (keep.length > minKeep) {
    const sub = keep.map((i) => keep.map((j) => R[i]![j]!));
    const vifs = vifFromCorr(sub);
    const singular = vifs.some((v) => v === Infinity);
    let worst = -1;
    let worstVif = maxVif;
    if (singular) {
      // Pivoted Cholesky finds a dependent direction while retaining the
      // strongest independent variables, regardless of their input order.
      worst = weakestPivot(keep);
    } else {
      for (let t = 0; t < keep.length; t++) {
        const v = vifs[t];
        if (v != null && v > worstVif) {
          worstVif = v;
          worst = t;
        }
      }
    }
    if (worst < 0) {
      let bestR = maxAbsCorr;
      let pair: [number, number] | null = null;
      for (let a = 0; a < keep.length; a++) {
        for (let b = a + 1; b < keep.length; b++) {
          const r = Math.abs(R[keep[a]!]![keep[b]!]!);
          if (!Number.isFinite(r) || r <= bestR) continue;
          bestR = r;
          pair = [a, b];
        }
      }
      if (!pair) break;
      worst = pickWorse(keep, pair[0], pair[1], vifs);
    }
    drop.push(keep[worst]!);
    keep.splice(worst, 1);
  }
  return { keep, drop };
}

export function varimax(L: number[][], maxIter = 40): number[][] {
  const p = L.length;
  const k = L[0]?.length ?? 0;
  if (k < 2) return L.map((row) => row.slice());
  const A = L.map((row) => row.slice());
  for (let iter = 0; iter < maxIter; iter++) {
    let maxPhi = 0;
    for (let c0 = 0; c0 < k; c0++) {
      for (let c1 = c0 + 1; c1 < k; c1++) {
        const u: number[] = [];
        const v: number[] = [];
        for (let i = 0; i < p; i++) {
          const x = A[i]![c0]!;
          const y = A[i]![c1]!;
          u.push(x * x - y * y);
          v.push(2 * x * y);
        }
        const Su = u.reduce((a, b) => a + b, 0);
        const Sv = v.reduce((a, b) => a + b, 0);
        const Suu = u.reduce((a, x) => a + x * x, 0);
        const Svv = v.reduce((a, x) => a + x * x, 0);
        const Suv = u.reduce((a, x, i) => a + x * v[i]!, 0);
        const num = 2 * Suv - (2 * Su * Sv) / p;
        const den = Suu - Svv - (Su * Su - Sv * Sv) / p;
        const phi = 0.25 * Math.atan2(num, den);
        maxPhi = Math.max(maxPhi, Math.abs(phi));
        const c = Math.cos(phi);
        const s = Math.sin(phi);
        for (let i = 0; i < p; i++) {
          const x = A[i]![c0]!;
          const y = A[i]![c1]!;
          A[i]![c0] = c * x + s * y;
          A[i]![c1] = -s * x + c * y;
        }
      }
    }
    if (maxPhi < 1e-5) break;
  }
  return A;
}

function tokens(name: string): Set<string> {
  const out = new Set<string>();
  const cjk = name.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const w of cjk) {
    if (w.length <= 2) out.add(w);
    else {
      for (let i = 0; i < w.length - 1; i++) out.add(w.slice(i, i + 2));
    }
  }
  for (const w of name.toLowerCase().match(/[a-z]{3,}/g) ?? []) out.add(w);
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function suggestName(names: string[], fallback: string): string {
  const stop = new Set(
    "我的、我们、可以、是否、感到、目前、自己、他人、即使、遇到、以及、或者、这个、那个、一项、一种、什么、如何、一个、不是、没有、就是、还是、为了、如果、整体、常常".split(
      "、",
    ),
  );
  const cleaned = names.map((n) => n.replace(/^[A-Za-z]+\d+[.\s]*/, "").trim());
  const counts = new Map<string, number>();
  for (const n of cleaned) {
    for (const t of tokens(n)) {
      if (t.length < 2 || stop.has(t)) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  const hit = ranked.find(([, c]) => c >= Math.ceil(cleaned.length * 0.5) && c >= 2);
  if (hit) return hit[0];
  const first = cleaned[0] ?? fallback;
  return first.length > 12 ? first.slice(0, 12) : first;
}

function stripCode(name: string): string {
  return name.replace(/^[A-Za-z_]+\d+[.\s_-]*/, "").trim() || name;
}

function factorSuggest(
  keys: string[],
  names: string[],
  cols: (number | null)[][],
  R: number[][],
  kmoVal: number | null,
  kWanted?: number | null,
): { constructs: ConstructCandidate[]; leftover: LeftoverItem[]; notes: string[]; recommendedK: number; usedK: number } {
  const notes: string[] = [];
  const p = keys.length;
  const { values, vectors } = eigenSym(R);
  const total = values.reduce((a, b) => a + Math.max(b, 0), 0) || 1;
  const kaiser = values.filter((v) => v > 1.0001).length;
  const nObs = cols[0]?.length ?? 0;
  const pa = parallelAnalysisNf(R, nObs);
  let rec = Math.min(kaiser || pa, pa);
  rec = Math.max(1, Math.min(rec, MAX_FACTORS, Math.floor(p / 2) || 1, p - 1));
  const nf = kWanted != null ? Math.max(1, Math.min(Math.round(kWanted), MAX_FACTORS, p - 1)) : rec;
  if (kmoVal != null && kmoVal < 0.5) {
    notes.push("KMO 低于 0.5，题组不太适合因子分析，结果仅作探索。");
  }
  notes.push(
    kWanted != null
      ? `已按指定 ${nf} 个因子旋转（平行分析建议 ${pa}，Kaiser 建议 ${Math.max(kaiser, 1)}，自动会取 ${rec}）。`
      : `平行分析建议 ${pa} 个因子，Kaiser 建议 ${Math.max(kaiser, 1)} 个，取 ${nf} 个并作方差最大化旋转。`,
  );

  let L = Array.from({ length: p }, (_, i) =>
    Array.from({ length: nf }, (_, f) => {
      const ev = Math.max(values[f]!, 0);
      return (vectors[f]?.[i] ?? 0) * Math.sqrt(ev);
    }),
  );
  L = varimax(L);
  for (let f = 0; f < nf; f++) {
    let s = 0;
    for (let i = 0; i < p; i++) s += L[i]![f]!;
    if (s < 0) for (let i = 0; i < p; i++) L[i]![f]! *= -1;
  }

  const assign: number[] = Array(p).fill(-1);
  const leftover: LeftoverItem[] = [];
  const cross: boolean[] = Array(p).fill(false);
  for (let i = 0; i < p; i++) {
    const abs = L[i]!.map((x) => Math.abs(x));
    const order = abs.map((v, j) => j).sort((a, b) => abs[b]! - abs[a]!);
    const f0 = order[0]!;
    const f1 = order[1];
    if (abs[f0]! < LOAD_MIN) {
      leftover.push({ key: keys[i]!, name: names[i]!, reason: "各因子载荷均低于 0.40" });
      continue;
    }
    assign[i] = f0;
    if (f1 != null && abs[f1]! >= CROSS_MIN && abs[f0]! - abs[f1]! < 0.15) cross[i] = true;
  }

  const constructs: ConstructCandidate[] = [];
  for (let f = 0; f < nf; f++) {
    const idxs = keys.map((_, i) => i).filter((i) => assign[i] === f);
    if (idxs.length < 2) {
      for (const i of idxs) {
        leftover.push({ key: keys[i]!, name: names[i]!, reason: "所属因子不足 2 题，未成构念" });
        assign[i] = -1;
      }
      continue;
    }
    const subCols = idxs.map((i) => cols[i]!);
    const rel = reliability(subCols);
    const members: ConstructMember[] = idxs.map((i, t) => {
      const flags: ConstructMember["flags"] = [];
      if (cross[i]) flags.push("crossload");
      if (Math.abs(L[i]![f]!) < LOAD_MIN) flags.push("low_loading");
      const aDel = rel.deleted[t];
      if (rel.alpha != null && aDel != null && aDel > rel.alpha + 0.02) flags.push("hurts_alpha");
      return {
        key: keys[i]!,
        name: names[i]!,
        loading: L[i]![f]!,
        citc: rel.citc[t] ?? null,
        alphaIfDeleted: aDel ?? null,
        flags,
      };
    });
    members.sort((a, b) => Math.abs(b.loading ?? 0) - Math.abs(a.loading ?? 0));
    const top = members[0]!;
    const memberNames = idxs.map((i) => names[i]!);
    constructs.push({
      id: `c${f + 1}`,
      name: suggestName(memberNames, stripCode(top.name).slice(0, 12) || `构念 ${constructs.length + 1}`),
      eigenvalue: values[f],
      variance: Math.max(values[f]!, 0) / total,
      alpha: rel.alpha,
      meanCitc: rel.citc.filter((x): x is number => x != null).length
        ? rel.citc.reduce<number>((a, x) => a + (x ?? 0), 0) /
          rel.citc.filter((x): x is number => x != null).length
        : null,
      meanAbsR: meanAbsOffdiag(R, idxs),
      members,
    });
  }
  return { constructs, leftover, notes, recommendedK: rec, usedK: nf };
}

function hacLabels(D: number[][], k: number, linkage: "average" | "complete" = "complete"): number[] {
  const n = D.length;
  const labels = Array.from({ length: n }, (_, i) => i);
  let nCl = n;
  while (nCl > k) {
    let best = Infinity;
    let ia = 0;
    let ib = 1;
    const seen = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const lab = labels[i]!;
      const arr = seen.get(lab);
      if (arr) arr.push(i);
      else seen.set(lab, [i]);
    }
    const groups = [...seen.values()];
    for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        const A = groups[a]!;
        const B = groups[b]!;
        let d: number;
        if (linkage === "complete") {
          let m = -Infinity;
          for (const i of A) for (const j of B) m = Math.max(m, D[i]![j]!);
          d = m;
        } else {
          let s = 0;
          for (const i of A) for (const j of B) s += D[i]![j]!;
          d = s / (A.length * B.length);
        }
        if (d < best) {
          best = d;
          ia = A[0]!;
          ib = B[0]!;
        }
      }
    }
    const la = labels[ia]!;
    const lb = labels[ib]!;
    for (let i = 0; i < n; i++) if (labels[i] === lb) labels[i] = la;
    nCl -= 1;
  }
  const map = new Map<number, number>();
  let next = 0;
  return labels.map((lab) => {
    const g = map.get(lab);
    if (g != null) return g;
    map.set(lab, next);
    return next++;
  });
}

const DOMAINS: { name: string; needles: string[] }[] = [
  { name: "经济发展", needles: ["人均gdp", "生产总值", "产值", "工业", "财政", "投资", "增长", "第三产业"] },
  { name: "创新驱动", needles: ["研发", "专利", "高技术", "科技", "创新", "发明"] },
  { name: "绿色转型", needles: ["污染", "排放", "能耗", "pm2", "森林", "环境", "生态", "废水"] },
  { name: "民生福祉", needles: ["收入", "城镇", "医疗", "教育", "就业", "床位", "住房", "消费"] },
];

function domainScore(name: string, key: string): { name: string; n: number }[] {
  const blob = `${name} ${key}`.toLowerCase();
  return DOMAINS.map((d) => ({
    name: d.name,
    n: d.needles.filter((x) => blob.includes(x.toLowerCase())).length,
  }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
}

function reassignSingletons(labels: number[], D: number[][]): number[] {
  const n = labels.length;
  const sizes = new Map<number, number>();
  for (const lab of labels) sizes.set(lab, (sizes.get(lab) ?? 0) + 1);
  const out = labels.slice();
  for (let i = 0; i < n; i++) {
    if ((sizes.get(out[i]!) ?? 0) >= 2) continue;
    let best = Infinity;
    let target = out[i]!;
    const groups = new Map<number, number[]>();
    for (let j = 0; j < n; j++) {
      if ((sizes.get(out[j]!) ?? 0) < 2) continue;
      const arr = groups.get(out[j]!);
      if (arr) arr.push(j);
      else groups.set(out[j]!, [j]);
    }
    for (const [lab, mem] of groups) {
      let m = -Infinity;
      for (const j of mem) m = Math.max(m, D[i]![j]!);
      if (m < best) {
        best = m;
        target = lab;
      }
    }
    out[i] = target;
  }
  return out;
}

function clusterSuggest(
  keys: string[],
  names: string[],
  cols: (number | null)[][],
  R: number[][],
  kWanted?: number | null,
): { constructs: ConstructCandidate[]; leftover: LeftoverItem[]; notes: string[]; recommendedK: number; usedK: number } {
  const notes: string[] = [
    "面板按形成性维度聚类：优先用指标名称归入经济 / 创新 / 绿色 / 民生，其余按完全联结聚类；簇内高相关标为冗余。",
  ];
  const p = keys.length;
  const tok = names.map(tokens);
  const D = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (_, j) => {
      if (i === j) return 0;
      const r = R[i]![j]!;
      const jr = jaccard(tok[i]!, tok[j]!);
      return 0.45 * (1 - (Number.isFinite(r) ? Math.abs(r) : 0)) + 0.55 * (1 - jr);
    }),
  );

  const pre = keys.map((k, i) => {
    const hits = domainScore(names[i]!, k);
    if (!hits.length) return -1;
    if (hits.length > 1 && hits[0]!.n === hits[1]!.n) return -1;
    return DOMAINS.findIndex((d) => d.name === hits[0]!.name);
  });
  const seeded = pre.filter((x) => x >= 0).length;
  const uniqueSeeds = new Set(pre.filter((x) => x >= 0)).size;
  const rec = seeded >= 4 ? Math.max(2, uniqueSeeds) : Math.max(2, Math.min(6, Math.round(p / 3)));
  const k =
    kWanted != null ? Math.max(1, Math.min(Math.round(kWanted), MAX_FACTORS, Math.max(1, p - 1))) : rec;
  const useDomains = seeded >= 4 && (kWanted == null || k === rec);
  let labels: number[];
  if (useDomains) {
    labels = pre.map((d) => (d >= 0 ? d : -1));
    for (let i = 0; i < p; i++) {
      if (labels[i] !== -1) continue;
      let best = -Infinity;
      let lab = 0;
      for (const dom of new Set(pre.filter((x) => x >= 0))) {
        const mem = keys.map((_, j) => j).filter((j) => labels[j] === dom);
        if (!mem.length) continue;
        const m = mem.reduce((s, j) => s + Math.abs(R[i]![j] ?? 0), 0) / mem.length;
        if (m > best) {
          best = m;
          lab = dom;
        }
      }
      labels[i] = best >= 0.2 ? lab : -1;
    }
    const unassigned = labels.map((x, i) => (x < 0 ? i : -1)).filter((i) => i >= 0);
    if (unassigned.length >= 2) {
      const subD = unassigned.map((i) => unassigned.map((j) => D[i]![j]!));
      const kSub = Math.max(1, Math.min(3, Math.round(unassigned.length / 3)));
      const subL = hacLabels(subD, kSub);
      const offset = 10;
      unassigned.forEach((i, t) => {
        labels[i] = offset + subL[t]!;
      });
    } else if (unassigned.length === 1) {
      labels = reassignSingletons(
        labels.map((x) => (x < 0 ? 99 : x)),
        D,
      );
    }
    notes.push("已按指标名称预归经济 / 创新 / 绿色 / 民生等常见准则层。");
  } else {
    labels = reassignSingletons(hacLabels(D, k), D);
    notes.push(
      kWanted != null
        ? `已按指定 ${k} 维做完全联结聚类（自动建议 ${rec} 维）。`
        : `无稳定名称锚点，按完全联结聚类为 ${k} 维。`,
    );
  }

  const leftover: LeftoverItem[] = [];
  const constructs: ConstructCandidate[] = [];
  const used = [...new Set(labels.filter((x) => x >= 0))].sort((a, b) => a - b);
  for (const c of used) {
    const idxs = keys.map((_, i) => i).filter((i) => labels[i] === c);
    if (idxs.length < 2) {
      for (const i of idxs) leftover.push({ key: keys[i]!, name: names[i]!, reason: "单独成簇，缺少共变结构" });
      continue;
    }
    const pruned = pruneCollinear(idxs, R);
    const dropSet = new Set(pruned.drop);
    const rel = reliability(idxs.map((i) => cols[i]!));
    const members: ConstructMember[] = idxs.map((i, t) => {
      const flags: ConstructMember["flags"] = [];
      if (dropSet.has(i)) flags.push("redundant");
      let loading: number | null = null;
      let s = 0;
      let n = 0;
      for (const j of idxs) {
        if (j === i) continue;
        const r = R[i]![j]!;
        if (Number.isFinite(r)) {
          s += Math.abs(r);
          n += 1;
        }
      }
      loading = n ? s / n : null;
      return {
        key: keys[i]!,
        name: names[i]!,
        loading,
        citc: rel.citc[t] ?? null,
        alphaIfDeleted: rel.deleted[t] ?? null,
        flags,
      };
    });
    members.sort((a, b) => (b.loading ?? 0) - (a.loading ?? 0));
    const dimName = domainScore(idxs.map((i) => names[i]!).join("、"), "").find((d) => d.n >= 2)?.name
      ?? suggestName(idxs.map((i) => names[i]!), `维度 ${constructs.length + 1}`);
    if (pruned.drop.length) {
      const keepNames = pruned.keep.map((i) => names[i]!);
      const dropNames = pruned.drop.map((i) => names[i]!);
      notes.push(
        `${dimName}：簇内共线只说明部分指标可代表该组，已保留 ${keepNames.join("、")}，建议剔除 ${dropNames.join("、")}。`,
      );
    }
    constructs.push({
      id: `c${constructs.length + 1}`,
      name: dimName,
      alpha: rel.alpha,
      meanCitc: null,
      meanAbsR: meanAbsOffdiag(R, idxs),
      members,
    });
  }
  return { constructs, leftover, notes, recommendedK: rec, usedK: k };
}

export function suggestConstructs(
  ds: Dataset,
  tx: TransformSpec = DEFAULT_TRANSFORM,
  opts: SuggestOptions = {},
): ConstructSuggestion {
  const items = ds.indicators.filter((i) => i.selected);
  const notes: string[] = [];
  if (items.length < 3) {
    return {
      mode: ds.kind === "survey" ? "factor" : "cluster",
      kmo: null,
      nItems: items.length,
      nObs: ds.rows.length,
      recommendedK: 0,
      usedK: 0,
      notes: ["至少需要 3 个纳入指标才能建议构念。"],
      constructs: [],
      leftover: items.map((i) => ({ key: i.key, name: i.name, reason: "指标过少" })),
    };
  }
  const keys = items.map((i) => i.key);
  const names = items.map((i) => i.name);
  const cols = prepared(ds, keys, tx);
  const R = corrMatrix(cols);
  const kmoVal = keys.length >= 3 ? kmo(R) : null;
  const mode: ConstructMode = ds.kind === "survey" ? "factor" : "cluster";
  const kOpt = opts.k != null && Number.isFinite(opts.k) ? clampK(opts.k, keys.length) : null;
  const part =
    mode === "factor"
      ? factorSuggest(keys, names, cols, R, kmoVal, kOpt)
      : clusterSuggest(keys, names, cols, R, kOpt);
  if (tx.winsor > 0 || tx.logMode !== "off") {
    notes.push("构念诊断使用当前缩尾 / 对数变换后的取值。");
  }
  notes.push(...part.notes);
  if (!part.constructs.length) notes.push("没有形成稳定构念，请调整纳入指标后再试。");
  return {
    mode,
    kmo: kmoVal != null && Number.isFinite(kmoVal) ? kmoVal : null,
    nItems: keys.length,
    nObs: ds.rows.length,
    recommendedK: part.recommendedK,
    usedK: part.usedK,
    notes,
    constructs: part.constructs,
    leftover: part.leftover,
  };
}

export function alphaLabel(a: number | null): string {
  if (a == null || !Number.isFinite(a)) return "α —";
  if (a >= 0.8) return `α ${a.toFixed(2)} 良好`;
  if (a >= 0.7) return `α ${a.toFixed(2)} 可接受`;
  if (a >= 0.6) return `α ${a.toFixed(2)} 勉强`;
  return `α ${a.toFixed(2)} 偏弱`;
}

export const MEMBER_FLAG_LABEL: Record<ConstructMember["flags"][number], string> = {
  crossload: "交叉载荷",
  low_loading: "载荷偏低",
  redundant: "建议剔除",
  hurts_alpha: "降低信度",
};
