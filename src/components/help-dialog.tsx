import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

const SECTIONS = [
  {
    title: "工作流",
    body: "数据 → 筛选 → 体系 → 聚合 → 结果。面板数据是个体 × 时间；问卷数据是受访者 × 题目。筛选只标记、不强制删除；体系步把指标归入准则层；聚合步在维度内赋权后合成目标层。",
  },
  {
    title: "筛选规则",
    body: "缺失、变异、相关与 VIF 会按是否已归维分流：未归维用全局规则；反映性量表内高相关不再当错误，形成性维度标维内冗余；维间高相关只提示。问卷另检 CITC、地板 / 天花板与删题后 α。有抽样权重时相关也加权。",
  },
  {
    title: "指标体系",
    body: "目标层 → 准则层 → 指标层。自动构念：问卷用平行分析 + Kaiser 定因子数，也可在对话框指定 2–8 维后重新旋转；方差最大化旋转后给 α / CITC。面板按名称锚定经济 / 创新 / 绿色 / 民生再聚类，同样可改维数。簇内共线只剔除最冗余项、保留代表变量，不会整组删除。每个维度可标反映性或形成性。写入后给出 α、AVE、CR 近似与维间相关，不是完整 CFA。",
  },
  {
    title: "赋权方法",
    body: "等权、熵权、变异系数、CRITIC、主成分载荷、TOPSIS 贴近度，以及自定义 / 德尔菲权重。客观方法均在维度内计算，再按准则层权重合成。可对照多种方法的 Spearman 秩相关检验稳健性。",
  },
  {
    title: "标准化、缺失与变换",
    body: "极差映射到 [0,1] 后乘 100；Z 分数合成为均分 50、标准差 10。缺失可选整行删除、列均值填补，或按行内可用指标重标权重。面板可截取年份窗口。收入、产值等右偏变量可先 1%/99% 或 5%/95% 缩尾，再取 ln 或 ln(1+x)；李克特量表不要取对数。",
  },
  {
    title: "抽样权重",
    body: "问卷设计权重（weight / pweight）用于筛选阶段的加权均值与标准差、熵权与变异系数，以及结果页的分组加权均值（并给出 Kish 有效样本量）。个体综合指数与排名仍按未加权得分，避免把抽样权重当成个人重要性。",
  },
  {
    title: "文件格式",
    body: "可在浏览器本地读取 CSV/TSV、Excel 与 Stata 117–119。宽表按完整度预选，其余可按题组搜索加入（最多 80 列）。Stata 值标签会用于分类列；李克特数字保留。超过 120 MB 请先裁子集。结果页可导出 Markdown 报告与 Stata/R 草图。",
  },
];

export function HelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <CircleHelp />
        方法
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogTitle>方法说明</DialogTitle>
          <DialogDescription>
            全部计算在浏览器本地完成，数据不会上传。示意样本只用于演示数量级与流程。
          </DialogDescription>
          <ol className="mt-4 space-y-4">
            {SECTIONS.map((s) => (
              <li key={s.title}>
                <h3 className="text-sm font-medium">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}
