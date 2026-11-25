const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=__dirname;
const rows=JSON.parse(fs.readFileSync(path.join(root,'baseline_source_rows.json'),'utf8'));
const core=require('./original/main.js').studyCore;
const finalCore=require('./fixed/main.js').studyCore;
for(const r of rows){
  r.final_prediction=core.mapFrequency(r.text);
  assert.equal(finalCore.mapFrequency(r.text),r.final_prediction,'Order patch must not change mapper');
}
for(const order of ['AB','BA']) for(const random of [()=>0,()=>.999999]) {
  const a=finalCore.randomAssignment(random,order);
  assert.equal(a.order,order);assert.deepEqual(a.A,[1,2,3,4,5]);assert.deepEqual(a.B,[6,7,8,9,10]);
}
function metrics(field,ref='closed_reference'){
  const eligible=rows.filter(r=>Number.isInteger(r[ref]));
  const mapped=eligible.filter(r=>Number.isInteger(r[field]));
  const matrix=Array.from({length:5},()=>Array(5).fill(0));
  for(const r of mapped)matrix[r[ref]][r[field]]++;
  const n=mapped.length,correct=mapped.filter(r=>r[ref]===r[field]).length;
  const rt=matrix.map(r=>r.reduce((a,b)=>a+b,0));
  const ct=matrix[0].map((_,c)=>matrix.reduce((s,r)=>s+r[c],0));
  function kappa(power){let obs=0,exp=0;for(let a=0;a<5;a++)for(let b=0;b<5;b++){
    const d=power===0?(a===b?0:1):Math.pow(Math.abs(a-b)/4,power);
    obs+=d*matrix[a][b]/n;exp+=d*rt[a]*ct[b]/(n*n);
  } return exp===0?null:1-obs/exp;}
  return {eligible_items:eligible.length,mapped:n,unmapped:eligible.length-n,correct,
    coverage:n/eligible.length,exact_on_mapped:correct/n,correct_over_all:correct/eligible.length,
    unweighted_kappa:kappa(0),linear_weighted_kappa:kappa(1),quadratic_weighted_kappa:kappa(2),
    confusion_matrix_rows_reference_columns_prediction:matrix};
}
const results={source:'Kloster_Liu_Baseline_Log_Final.xlsx, 2.1 Questionnaire, rows 5–16',
  baseline_version:'v1.2.1, commit 3ffb2e5 (logged predictions; baseline code not rerun)',
  frozen_final_version:require('./original/assessment.json').version,
  frozen_final_source_sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'original/main.js'))).digest('hex'),
  participants:3,items:12,comparison:'Same 12 original free texts. Initial automatic pass only. No clarification responses are available.',
  baseline_vs_closed:metrics('baseline_prediction'),final_vs_closed:metrics('final_prediction'),
  baseline_vs_available_human:metrics('baseline_prediction','human_category'),final_vs_available_human:metrics('final_prediction','human_category'),
  cautions:[
    'Closed-choice answers are historical cross-format references, not independent coding of the typed text.',
    'The six optional human categories are incomplete, and some source notes record coder disagreement. They are not a complete adjudicated gold standard.',
    'PSS-4 historical prompts differ from the final PSS-10 B items. This tests only the context-independent frequency mapper on a frozen regression set.',
    'Different mapped subsets make the apparent 40% to 50% exact-agreement change unsuitable as an overall accuracy improvement claim.',
    'No statistical significance or population-level improvement is claimed from three baseline participants.'
  ]};
assert.equal(results.baseline_vs_closed.mapped,5);assert.equal(results.baseline_vs_closed.correct,2);
assert.equal(results.final_vs_closed.mapped,4);assert.equal(results.final_vs_closed.correct,2);
fs.writeFileSync(path.join(root,'baseline_replay_results.json'),JSON.stringify(results,null,2));
fs.writeFileSync(path.join(root,'baseline_replay_items.csv'),core.toCSV(rows));
console.log(JSON.stringify({baseline:results.baseline_vs_closed,final:results.final_vs_closed,tests:'mapper unchanged and fixed item partitions/order passed'}));
