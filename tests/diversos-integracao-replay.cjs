"use strict";
const fs=require("node:fs"),path=require("node:path"),{createHash}=require("node:crypto");
const fixture=require("./fixtures/classificador-estrutural-real-20261028.json");
const args=process.argv.slice(2),b=args.indexOf("--baseline"),o=args.indexOf("--out");
if(b<0||!args[b+1])throw Error("baseline_required");
const before=require(path.join(path.resolve(args[b+1]),"modules/inteligencia-universal/categoria.service"));
const after=require("../modules/inteligencia-universal/categoria.service");
const saved=console.log;console.log=()=>{};
let report;
try{
 const rows=fixture.real.map(row=>{const offer={titulo:row.titulo,categoria:"Diversos",marketplace:row.marketplace};
   return {...row,before:before.classificarCategoriaUniversal(offer).categoria,after:after.classificarCategoriaUniversal(offer).categoria};});
 const labeled=rows.filter(r=>r.expected!==null);
 const summary=key=>({total:rows.length,labeled:labeled.length,correct:labeled.filter(r=>r[key]===r.expected).length,
   falsePositiveSpecific:labeled.filter(r=>r[key]!=="Diversos"&&r[key]!==r.expected).length,
   remainingDiversos:rows.filter(r=>r[key]==="Diversos").length,
   unlabeledSpecificNotValidated:rows.filter(r=>r.expected===null&&r[key]!=="Diversos").length});
 report={cohortSha256:createHash("sha256").update(JSON.stringify(fixture.real)).digest("hex"),sampling:fixture.sampling,
   limitation:"Curated title labels, not blind population accuracy; null labels never count as correct.",
   summary:{before:summary("before"),after:summary("after")},changes:rows.filter(r=>r.before!==r.after),
   regressions:labeled.filter(r=>r.before===r.expected&&r.after!==r.expected),
   falsePositives:labeled.filter(r=>r.after!=="Diversos"&&r.after!==r.expected),
   pending:rows.filter(r=>r.after==="Diversos"||r.expected===null||r.after!==r.expected),rows};
}finally{console.log=saved;}
if(o>=0)fs.writeFileSync(args[o+1],JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
if(report.regressions.length||report.falsePositives.length)process.exitCode=1;
