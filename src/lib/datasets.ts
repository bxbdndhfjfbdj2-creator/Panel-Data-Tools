import { mulberry32, gauss } from "./prng";
import type { Dataset, Dimension, IndicatorMeta, DataRow, MeasureKind } from "./types";

function ind(
  key: string,
  name: string,
  unit: string,
  direction: 1 | -1,
  dimensionId: string,
  note?: string,
): IndicatorMeta {
  return { key, name, unit, direction, dimensionId, selected: true, weight: 0, note };
}

function dims(items: { id: string; name: string; description: string }[], measure: MeasureKind): Dimension[] {
  const w = 1 / items.length;
  return items.map((d) => ({ ...d, weight: w, measure }));
}

type Prov = {
  name: string;
  region: "east" | "central" | "west" | "northeast";
  gdppc: number;
  industry: number;
  tertiary: number;
  rd: number;
  patent: number;
  hightech: number;
  pm: number;
  energy: number;
  forest: number;
  income: number;
  urban: number;
  beds: number;
};

const PROVINCES: Prov[] = [
  { name: "北京", region: "east", gdppc: 16.4, industry: 5.2, tertiary: 83.5, rd: 6.3, patent: 92, hightech: 28, pm: 42, energy: 0.28, forest: 44, income: 6.8, urban: 87.5, beds: 6.2 },
  { name: "上海", region: "east", gdppc: 15.7, industry: 4.8, tertiary: 72.7, rd: 4.1, patent: 68, hightech: 24, pm: 35, energy: 0.32, forest: 18, income: 6.9, urban: 89.3, beds: 5.8 },
  { name: "江苏", region: "east", gdppc: 12.4, industry: 6.1, tertiary: 51.8, rd: 2.9, patent: 54, hightech: 22, pm: 43, energy: 0.41, forest: 24, income: 4.8, urban: 72.0, beds: 5.4 },
  { name: "浙江", region: "east", gdppc: 10.8, industry: 5.9, tertiary: 54.0, rd: 2.8, patent: 49, hightech: 21, pm: 34, energy: 0.38, forest: 61, income: 5.2, urban: 71.4, beds: 5.6 },
  { name: "广东", region: "east", gdppc: 9.5, industry: 6.0, tertiary: 55.5, rd: 3.1, patent: 58, hightech: 27, pm: 32, energy: 0.36, forest: 53, income: 4.5, urban: 71.7, beds: 4.9 },
  { name: "福建", region: "east", gdppc: 10.7, industry: 6.4, tertiary: 46.2, rd: 1.9, patent: 22, hightech: 16, pm: 26, energy: 0.44, forest: 67, income: 3.9, urban: 66.7, beds: 4.6 },
  { name: "山东", region: "east", gdppc: 7.2, industry: 5.4, tertiary: 52.3, rd: 2.3, patent: 28, hightech: 15, pm: 48, energy: 0.55, forest: 18, income: 3.6, urban: 62.0, beds: 5.7 },
  { name: "湖北", region: "central", gdppc: 7.7, industry: 7.5, tertiary: 51.0, rd: 2.1, patent: 19, hightech: 14, pm: 44, energy: 0.52, forest: 42, income: 3.1, urban: 61.0, beds: 6.4 },
  { name: "河南", region: "central", gdppc: 5.6, industry: 6.8, tertiary: 48.0, rd: 1.5, patent: 12, hightech: 10, pm: 55, energy: 0.61, forest: 25, income: 2.5, urban: 53.2, beds: 6.1 },
  { name: "湖南", region: "central", gdppc: 6.0, industry: 6.6, tertiary: 51.2, rd: 1.8, patent: 14, hightech: 12, pm: 40, energy: 0.54, forest: 55, income: 2.8, urban: 58.0, beds: 6.3 },
  { name: "安徽", region: "central", gdppc: 5.8, industry: 7.2, tertiary: 50.8, rd: 2.2, patent: 21, hightech: 13, pm: 46, energy: 0.53, forest: 30, income: 2.6, urban: 56.0, beds: 5.2 },
  { name: "四川", region: "west", gdppc: 5.6, industry: 7.0, tertiary: 52.4, rd: 2.0, patent: 16, hightech: 12, pm: 41, energy: 0.58, forest: 38, income: 2.5, urban: 54.2, beds: 6.5 },
  { name: "重庆", region: "west", gdppc: 7.6, industry: 6.3, tertiary: 53.0, rd: 2.1, patent: 18, hightech: 14, pm: 39, energy: 0.50, forest: 50, income: 3.3, urban: 67.0, beds: 6.0 },
  { name: "陕西", region: "west", gdppc: 6.6, industry: 5.8, tertiary: 46.5, rd: 2.3, patent: 17, hightech: 13, pm: 52, energy: 0.62, forest: 43, income: 2.6, urban: 60.0, beds: 6.2 },
  { name: "云南", region: "west", gdppc: 4.8, industry: 7.8, tertiary: 51.5, rd: 1.0, patent: 6, hightech: 6, pm: 28, energy: 0.72, forest: 65, income: 2.2, urban: 49.0, beds: 5.8 },
  { name: "辽宁", region: "northeast", gdppc: 5.8, industry: 4.1, tertiary: 52.6, rd: 1.8, patent: 11, hightech: 9, pm: 40, energy: 0.78, forest: 40, income: 3.2, urban: 68.1, beds: 6.8 },
];

const YEARS = [2019, 2020, 2021, 2022, 2023, 2024];

export function makePanelDataset(): Dataset {
  const rand = mulberry32(20240618);
  const dimensions = dims([
    { id: "econ", name: "经济发展", description: "规模、结构与增长质量" },
    { id: "innov", name: "创新驱动", description: "研发投入与创新产出" },
    { id: "env", name: "绿色转型", description: "污染、能耗与生态本底" },
    { id: "life", name: "民生福祉", description: "收入、城镇化与医疗资源" },
  ], "formative");

  const indicators: IndicatorMeta[] = [
    ind("gdppc", "人均GDP", "万元", 1, "econ"),
    ind("industry", "规上工业增速", "%", 1, "econ", "2020 年受疫情冲击，部分省份为负增长"),
    ind("tertiary", "第三产业占比", "%", 1, "econ"),
    ind("rd", "研发强度", "%", 1, "innov"),
    ind("patent", "万人发明专利", "件/万人", 1, "innov"),
    ind("hightech", "高技术产业占比", "%", 1, "innov"),
    ind("pm", "PM2.5 年均浓度", "μg/m³", -1, "env"),
    ind("energy", "单位GDP能耗", "吨标煤/万元", -1, "env"),
    ind("forest", "森林覆盖率", "%", 1, "env"),
    ind("income", "人均可支配收入", "万元", 1, "life"),
    ind("urban", "常住人口城镇化率", "%", 1, "life"),
    ind("beds", "千人医疗卫生床位", "张", 1, "life"),
  ];

  const equal = 1 / 3;
  for (const d of dimensions) {
    const members = indicators.filter((i) => i.dimensionId === d.id);
    for (const i of members) i.weight = equal;
  }

  const rows: DataRow[] = [];
  for (const p of PROVINCES) {
    for (const year of YEARS) {
      const t = year - 2019;
      const covid = year === 2020 ? -1 : year === 2021 ? 0.4 : 0;
      const n = () => gauss(rand) * 0.035;
      const row: DataRow = { 省份: p.name, 年份: year, 区域: regionLabel(p.region) };

      row.gdppc = round(p.gdppc * (1.055 + n()) ** t * (year === 2020 ? 0.98 : 1), 2);
      row.industry = round(p.industry + covid * 6.5 + gauss(rand) * 1.1, 1);
      row.tertiary = round(clampNum(p.tertiary + t * 0.45 + gauss(rand) * 0.35, 35, 90), 1);
      row.rd = round(clampNum(p.rd * (1.03 + n() * 0.4) ** t, 0.4, 8), 2);
      row.patent = round(p.patent * (1.08 + n()) ** t, 1);
      row.hightech = round(clampNum(p.hightech + t * 0.55 + gauss(rand) * 0.5, 3, 40), 1);
      row.pm = round(clampNum(p.pm * (0.96 + n() * 0.3) ** t + gauss(rand) * 1.2, 12, 80), 1);
      row.energy = round(clampNum(p.energy * (0.97 + n() * 0.2) ** t, 0.18, 1.1), 3);
      row.forest = round(clampNum(p.forest + t * 0.22 + gauss(rand) * 0.15, 8, 80), 1);
      row.income = round(p.income * (1.06 + n()) ** t * (year === 2020 ? 0.99 : 1), 2);
      row.urban = round(clampNum(p.urban + t * 0.7 + gauss(rand) * 0.2, 40, 95), 1);
      row.beds = round(clampNum(p.beds + t * 0.12 + gauss(rand) * 0.08, 3.5, 9), 2);

      if (p.name === "云南" && year <= 2020 && rand() < 0.7) row.rd = null;
      if (p.name === "云南" && year === 2019 && rand() < 0.8) row.patent = null;
      if (p.name === "辽宁" && year === 2020) row.industry = round(-3.2 + gauss(rand) * 0.6, 1);

      rows.push(row);
    }
  }

  return {
    id: "panel-hq",
    name: "省级发展质量面板",
    kind: "panel",
    description: "16 个省份、2019–2024 年，覆盖经济、创新、绿色与民生四个维度的合成示意数据。",
    sourceNote: "示意数据，数值参考公开统计的数量级与区域格局生成，不可作为正式引用。",
    rows,
    entityKey: "省份",
    timeKey: "年份",
    groupKey: "区域",
    indicators,
    dimensions,
    goalName: "发展质量综合指数",
  };
}

const SURVEY_ITEMS: { key: string; name: string; dim: string }[] = [
  { key: "e1", name: "我对目前的工作充满热情", dim: "engage" },
  { key: "e2", name: "工作时常常感觉时间过得很快", dim: "engage" },
  { key: "e3", name: "我为自己完成的工作感到自豪", dim: "engage" },
  { key: "e4", name: "即使遇到困难也愿意持续投入", dim: "engage" },
  { key: "l1", name: "上级会认真听取我的意见", dim: "lead" },
  { key: "l2", name: "遇到困难时能获得领导帮助", dim: "lead" },
  { key: "l3", name: "领导认可我的贡献", dim: "lead" },
  { key: "l4", name: "任务目标被清晰传达", dim: "lead" },
  { key: "w1", name: "我能保持良好的睡眠", dim: "well" },
  { key: "w2", name: "工作压力处在可承受范围", dim: "well" },
  { key: "w3", name: "我有时间照顾个人生活", dim: "well" },
  { key: "w4", name: "整体上我感到精力充沛", dim: "well" },
  { key: "c1", name: "同事之间彼此信任", dim: "climate" },
  { key: "c2", name: "团队协作顺畅", dim: "climate" },
  { key: "c3", name: "组织鼓励提出改进意见", dim: "climate" },
  { key: "c4", name: "我愿意向他人推荐这家组织", dim: "climate" },
  { key: "x1", name: "我对食堂菜品感到满意", dim: "noise" },
];

const DEPTS = ["研发", "产品", "运营", "销售", "职能"];
const LEVELS = ["专员", "主管", "经理", "总监"];

export function makeSurveyDataset(): Dataset {
  const rand = mulberry32(8848);
  const dimensions = dims([
    { id: "engage", name: "工作投入", description: "活力、奉献与专注" },
    { id: "lead", name: "领导支持", description: "倾听、帮助、认可与目标清晰度" },
    { id: "well", name: "身心福祉", description: "睡眠、压力、生活平衡与精力" },
    { id: "climate", name: "组织氛围", description: "信任、协作、建言与推荐意愿" },
  ], "reflective");

  const indicators: IndicatorMeta[] = SURVEY_ITEMS.map((it) =>
    ind(it.key, it.name, "1–5", 1, it.dim === "noise" ? "climate" : it.dim),
  );
  const noise = indicators.find((i) => i.key === "x1")!;
  noise.selected = false;
  noise.dimensionId = null;
  noise.note = "示意干扰题，与构念相关弱，默认不纳入。";

  for (const d of dimensions) {
    const members = indicators.filter((i) => i.dimensionId === d.id && i.selected);
    const w = members.length ? 1 / members.length : 0;
    for (const i of members) i.weight = w;
  }

  const rows: DataRow[] = [];
  const n = 180;
  for (let i = 0; i < n; i++) {
    const dept = DEPTS[Math.floor(rand() * DEPTS.length)]!;
    const tenure = 1 + Math.floor(rand() * 12);
    const level = LEVELS[tenure > 8 ? 2 + (rand() > 0.7 ? 1 : 0) : tenure > 4 ? 1 : 0]!;
    const deptBoost =
      dept === "研发" ? 0.25 : dept === "产品" ? 0.1 : dept === "销售" ? -0.15 : 0;
    const latent = {
      engage: 3.6 + deptBoost + gauss(rand) * 0.55,
      lead: 3.4 + deptBoost * 0.6 + gauss(rand) * 0.7,
      well: 3.2 - (tenure > 8 ? 0.15 : 0) + gauss(rand) * 0.65,
      climate: 3.5 + deptBoost * 0.4 + gauss(rand) * 0.5,
    };
    const row: DataRow = {
      编号: `R${String(i + 1).padStart(3, "0")}`,
      部门: dept,
      司龄: tenure,
      职级: level,
    };
    for (const it of SURVEY_ITEMS) {
      if (it.key === "x1") {
        row[it.key] = clampLikert(3 + gauss(rand) * 1.3);
        continue;
      }
      const L = latent[it.dim as keyof typeof latent];
      row[it.key] = clampLikert(L + gauss(rand) * 0.55);
    }
    if (i % 23 === 0) row.w3 = null;
    if (i % 41 === 0) row.l2 = null;
    rows.push(row);
  }

  return {
    id: "survey-org",
    name: "组织健康问卷",
    kind: "survey",
    description: "180 名员工、17 道李克特题，四个构念加一道示意干扰题。可用于信度与量表筛选。",
    sourceNote: "示意问卷，潜变量加噪声生成，仅供演示筛选、信度与合成。",
    rows,
    entityKey: "编号",
    groupKey: "部门",
    idKey: "编号",
    indicators,
    dimensions,
    goalName: "组织健康指数",
  };
}

export const SAMPLE_DATASETS = [makePanelDataset(), makeSurveyDataset()];

function regionLabel(r: Prov["region"]) {
  return { east: "东部", central: "中部", west: "西部", northeast: "东北" }[r];
}

function round(n: number, d: number) {
  const m = 10 ** d;
  return Math.round(n * m) / m;
}

function clampNum(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n));
}

function clampLikert(x: number) {
  return Math.min(5, Math.max(1, Math.round(x)));
}
