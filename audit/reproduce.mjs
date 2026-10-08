import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { parseDta } from '../src/lib/dta.ts';
import { computeWeights, computeScores, indicatorContributions, screenDataset } from '../src/lib/engine.ts';
import { datasetFromCsv, datasetFromParsed } from '../src/lib/csv.ts';
import { parseWorkspace, writeWorkspace } from '../src/lib/persist.ts';
import { eigenSym, topsisCloseness } from '../src/lib/stats.ts';
import { pruneCollinear } from '../src/lib/construct.ts';
import { solveAhp, saatyFromStep } from '../src/lib/ahp.ts';
import { numericYears } from '../src/lib/slice.ts';
import { useStudio } from '../src/lib/store.ts';
import { DEFAULT_THRESHOLDS } from '../src/lib/types.ts';
import { mulberry32, gauss } from '../src/lib/prng.ts';

const results = [];
function record(id, detail) { results.push({ id, ...detail }); }
// Expose only the existing private numerical function in audit memory.
const source=ts.createSourceFile('construct.ts',readFileSync(new URL('../src/lib/construct.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='varimax');
const rotateImpl=new Function(ts.transpileModule(fn.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return varimax;')();
const L=[[.9,.1],[.8,.2],[.7,.3],[.1,.8]];
const objective=A=>{let out=0;for(let j=0;j<2;j++){let sum=0,q=0;for(const row of A){sum+=row[j]**2;q+=row[j]**4;}out+=q-sum*sum/A.length;}return out;};
let best=-Infinity,angle=0;
for(let i=0;i<=20000;i++){const t=-Math.PI/4+i*Math.PI/2/20000;const rotated=L.map(([x,y])=>[Math.cos(t)*x+Math.sin(t)*y,-Math.sin(t)*x+Math.cos(t)*y]);const value=objective(rotated);if(value>best){best=value;angle=t;}}
record('varimax-objective',{input:L,before:objective(L),after:objective(rotateImpl(L)),gridBest:best,angle,gridPoints:20001,expected:'rotation should not decrease the unnormalized gamma=1 varimax objective'});
for(const version of [117,118,119]) {
  const bytes=readFileSync(new URL(`./tag-in-string-${version}.dta`,import.meta.url));
  let error=null,table;
  try{table=parseDta(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));}catch(e){error=e.message;}
  record('stata-tag-in-string-'+version,{version,error,actualRows:table?.rows,fixture:'pandas 2.2.3 to_stata; 3 rows, one note contains literal </data>'});
}
const strlBytes=readFileSync(new URL('./strl.dta',import.meta.url));
const strlTable=parseDta(strlBytes.buffer.slice(strlBytes.byteOffset,strlBytes.byteOffset+strlBytes.byteLength));
record('stata-strl',{actual:strlTable.rows.map(r=>r.note),expectedLengths:[2100,2100]});
function dataset(values) {
  const keys = values[0].map((_, j) => 'q' + j);
  return {
    id: 'audit', name: 'audit', kind: 'survey', description: '', sourceNote: '', entityKey: 'id',
    rows: values.map((row, i) => Object.fromEntries([['id', 'R' + i], ...keys.map((k, j) => [k, row[j]])])),
    indicators: keys.map(key => ({ key, name: key, direction: 1, dimensionId: 'd', selected: true, weight: 1 / keys.length })),
    dimensions: [{ id: 'd', name: 'd', weight: 1, measure: 'reflective' }], goalName: 'audit',
  };
}
const ds = dataset([[0,0,100], [100,100,0], [50,50,50], [20,80,20], [80,20,80], [10,90,10]]);
for (const method of ['equal', 'median', 'trimmed']) {
  const b = computeScores(ds, computeWeights(ds, method), 'minmax', method);
  record('aggregation-' + method, { actualFirst: b.rows[0].composite, expectedFirst: method === 'median' ? 0 : 100 / 3 });
}
const ds10 = dataset([Array(9).fill(0).concat(100), Array(9).fill(100).concat(0), Array(10).fill(50), Array(10).fill(20)]);
record('trimmed-10-items', { actualFirst: computeScores(ds10, computeWeights(ds10, 'trimmed'), 'minmax', 'trimmed').rows[0].composite, expectedFirst: 0 });
const tw = computeWeights(ds, 'topsis');
const tl = computeScores(ds, tw, 'minmax', 'topsis', 'listwise');
const tp = computeScores(ds, tw, 'minmax', 'topsis', 'pairwise');
record('topsis-missing-mode', { noMissingValues: true, listwise: tl.rows[0].composite, pairwise: tp.rows[0].composite, pairwiseCloseness: tp.rows[0].closeness, expectedInvariant: 'same TOPSIS scores for complete data; closeness in [0,1]' });
record('topsis-zscore-dimensions', { dims: computeScores(ds, tw, 'zscore', 'topsis').rows.map(r => r.dims.d), expectedConvention: 'document and consistently scale dimensions' });
const zd = computeScores(ds, computeWeights(ds, 'equal'), 'zscore', 'equal');
record('zscore-contributions', { displayedComposite: zd.rows[0].composite, sumContributions: indicatorContributions(ds, computeWeights(ds, 'equal'), zd.rows[0]).reduce((s,c) => s+c.contrib,0) });
const panel = datasetFromCsv('panel.csv', 'id,year,增长\nA,2020,-1\nA,2021,2\nB,2020,-3\nB,2021,4\nC,2020,5\nC,2021,6');
record('negative-values-lost', { kind: panel.kind, actual: panel.rows.map(r => r['增长']), expected: [-1,2,-3,4,5,6] });
const survey = datasetFromCsv('survey.csv', 'id,x\nA,1\nB,2\nC,97\nD,4');
record('97-value-lost', { actual: survey.rows.map(r => r.x), expected: [1,2,97,4] });
const tsv = datasetFromCsv('x.tsv', 'id\tx\ty\nA\t1\t2\nB\t2\t3');
record('tsv', { columns: Object.keys(tsv.rows[0]), indicators: tsv.indicators.length, expectedColumns: ['id','x','y'] });
const dup = datasetFromCsv('x.csv', 'id,x,x\nA,1,2\nB,3,4');
record('duplicate-header', { actual: dup.rows, indicatorKeys: dup.indicators.map(i=>i.key), expected: 'preserve both x columns using unique names' });
const ids = datasetFromCsv('x.csv', 'id,x\n001,1\n002,2');
record('identifier-coercion', { actual: ids.rows.map(r => r.id), expected: ['001','002'] });
const raw = Array.from({length:10}, (_,i)=>({id:'R'+i,x:i<5?i+1:null,y:i+1}));
const sparse = datasetFromParsed('x', ['id','x','y'], raw);
record('sparse-column-inaccessible', { catalog: sparse.catalog.map(c=>c.key), expectedCandidate: 'x (50% observed), user decides via missing threshold' });
const labeled = datasetFromParsed('x', ['id','income'], [{id:'A',income:100},{id:'B',income:200},{id:'C',income:300}], {lblnames:{income:'labels'},valueLabelSets:{labels:{100:'low',200:'mid',300:'high'}}});
record('value-label-rewrites-number', { actual: labeled.rows, indicators: labeled.indicators.map(i=>i.key), expected: 'preserve numeric codes separately from display labels' });
const malformed = { v:1,dataset:{rows:[],indicators:[],dimensions:[]} };
record('workspace-validation', { acceptedMalformed: parseWorkspace(malformed) !== null });
let roundtripError;
try { JSON.parse('\uFEFF' + JSON.stringify(malformed)); } catch(e) { roundtripError = e.message; }
assert.ok(roundtripError);
record('json-direct-bom-parser', { error: roundtripError, browserExportPrefixesBOM: true, caveat: 'Browser File.text strips BOM; browser round-trip succeeds. This is not an app defect.' });
globalThis.localStorage = { setItem() { throw new Error('QuotaExceededError'); } };
record('save-error-swallowed', { writeReturned: writeWorkspace(malformed) ?? null, expected: 'failure result surfaced to UI' });
delete globalThis.localStorage;
record('ahp-direction', { uiMinusEnd: '左侧更重要', minusValue: saatyFromStep(-8), minusWeights: solveAhp([[1, saatyFromStep(-8)],[1/saatyFromStep(-8),1]]).weights, expectedLeftHigher: true });
for (const n of [12,24,60,80]) {
  const R=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?1:0.5));
  const e=eigenSym(R); const v=e.vectors[0];
  const residual=Math.sqrt(R.reduce((s,row,i)=>s+(row.reduce((t,x,j)=>t+x*v[j],0)-e.values[0]*v[i])**2,0));
  record('eigen-' + n, { n, actualLargest:e.values[0], expectedLargest:(n+1)/2, eigenpairResidual:residual });
}
const rand=mulberry32(1949);
for (const n of [12,24,60,80]) {
  const X=Array.from({length:n},()=>Array.from({length:50},()=>gauss(rand)));
  const R=X.map((a)=>X.map(b=>a.reduce((s,x,i)=>s+x*b[i],0)/Math.sqrt(a.reduce((s,x)=>s+x*x,0)*b.reduce((s,x)=>s+x*x,0))));
  const small=eigenSym(R), reference=eigenSym(R,16000); const v=small.vectors[0];
  const residual=Math.sqrt(R.reduce((s,row,i)=>s+(row.reduce((t,x,j)=>t+x*v[j],0)-small.values[0]*v[i])**2,0));
  record('dense-eigen-'+n,{n,seed:1949,actualLargest:small.values[0],referenceLargest:reference.values[0],eigenpairResidual:residual,benchmark:'orthogonal invariant Rv=lambda*v; 16000 rotations only as a comparison'});
}
const wide=dataset(Array.from({length:10},(_,i)=>Array(49).fill(i+1)));
record('wide-screen-silent-skip', { nIndicators:49, firstMaxCorr:screenDataset(wide,DEFAULT_THRESHOLDS)[0].maxCorr, firstVif:screenDataset(wide,DEFAULT_THRESHOLDS)[0].vif, expectedCorrelation:1 });
record('singular-pruning-order', { matrix:[[1,0,0,0],[0,1,1,1],[0,1,1,1],[0,1,1,1]], result:pruneCollinear([0,1,2,3],[[1,0,0,0],[0,1,1,1],[0,1,1,1],[0,1,1,1]]), independentItem:0, expected:'independent item 0 must stay' });
let largeError;
try { topsisCloseness(Array.from({length:150000},(_,i)=>[i/150000])); } catch(e) { largeError=e.message; }
record('large-topsis', { n:150000, error:largeError ?? null, stataImportLimit:250000 });
record('missing-year-zero', { years:numericYears({...ds,timeKey:'year',rows:[{year:null},{year:''},{year:2024}]}), expected:[2024] });
useStudio.getState().importDataset(structuredClone(ds));
useStudio.getState().assignIndicator('q0', null);
record('unassigned-still-selected', { indicator:useStudio.getState().dataset.indicators[0], actuallyScored:computeScores(useStudio.getState().dataset,computeWeights(useStudio.getState().dataset,'equal'),'minmax','equal').rows[0].z });
useStudio.getState().importDataset(structuredClone(ds));
useStudio.getState().applyConstructs([{name:'new',keys:['q0','q1']}]);
record('construct-uncheck-not-deselected', { excludedItem:useStudio.getState().dataset.indicators.find(i=>i.key==='q2') });
const zempty={...ds,dimensions:[{id:'d',name:'d',weight:0},{id:'empty',name:'empty',weight:0}]};
record('zero-weights-with-empty-dim', { normalized:computeWeights(zempty,'equal').dimension, actualScore:computeScores(zempty,computeWeights(zempty,'equal'),'minmax','equal').rows[0].composite, expected:'reject zero vector or normalize active dimensions only' });
const out={timestamp:new Date().toISOString(),node:process.version,contract:'Bounded software audit cases; no population inference or proof of all inputs',cases:results};
writeFileSync(new URL('./reproductions.json',import.meta.url),JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
