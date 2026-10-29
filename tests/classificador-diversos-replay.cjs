"use strict";
// Replay offline dos títulos sanitizados; não lê dados, mensagens ou URLs produtivas.
const assert=require("node:assert/strict"), path=require("node:path"), fs=require("node:fs");
const {createHash}=require("node:crypto");
const fixture=require("./fixtures/classificador-diversos-real-20261028.json");
const args=process.argv.slice(2), at=args.indexOf("--baseline");
if(at<0 || !args[at+1])throw new Error("baseline_directory_required");
const baseline=require(path.join(path.resolve(args[at+1]),"modules/inteligencia-universal/categoria.service.js"));
const candidate=require("../modules/inteligencia-universal/categoria.service");
const old=console.log;console.log=()=>{};
let report;
try {
  const rows=[...fixture.real28.map(row=>({...row,cohort:"real_28"})),...fixture.historical.map(row=>({...row,cohort:"historical_pre_v3"})),...fixture.controls.map(row=>({...row,cohort:"synthetic_control"}))];
  const results=rows.map(row=>{
    const offer={titulo:row.titulo,categoria:row.before||"Diversos"};
    const before=baseline.classificarCategoriaUniversal(offer),after=candidate.classificarCategoriaUniversal(offer);
    return {titulo:row.titulo,cohort:row.cohort,historyId:row.historyId||row.historyIds||null,historyCategory:row.historicalCategory||row.before||null,before:before.categoria,after:after.categoria,reason:after.motivo||after.logs.at(-1)?.motivo,expected:row.categoria||null,forbidden:row.forbidden||null};
  });
  const errors=results.filter(r=>r.expected?r.after!==r.expected:r.after===r.forbidden);
  report={cohortSha256:createHash("sha256").update(JSON.stringify(rows)).digest("hex"),total:rows.length,real28:fixture.real28.length,historicalPreV3:fixture.historical.length,syntheticControls:fixture.controls.length,changes:results.filter(r=>r.before!==r.after),results,errors,raw2000:"NOT_AVAILABLE_NOT_REPLAYED",whatsappExport:"Owner supplied dates/titles; original chat(5).txt not present. PG corroboration identified per row, not a fabricated WhatsApp timestamp."};
  assert.equal(errors.length,0,JSON.stringify(errors));
} finally {console.log=old;}
const out=args.indexOf("--out");if(out>=0)fs.writeFileSync(args[out+1],JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
