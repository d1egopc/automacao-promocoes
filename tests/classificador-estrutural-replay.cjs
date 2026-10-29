"use strict";
const fs=require("node:fs"),path=require("node:path"),Module=require("node:module"),{execFileSync}=require("node:child_process");
const {createHash}=require("node:crypto");
const fixture=require("./fixtures/classificador-estrutural-real-20261028.json");
const {createStructuralClassifier}=require("../modules/inteligencia-universal/classificador-estrutural.candidate");
const args=process.argv.slice(2),root=path.resolve(__dirname,".."),at=args.indexOf("--baseline");
if(at<0||!args[at+1])throw new Error("baseline_required");
const baseline=require(path.join(path.resolve(args[at+1]),"modules/inteligencia-universal/categoria.service.js"));
function focalService(){
 const relative="marketplaces/inteligencia/classificador-categorias.js",file=path.join(root,relative);
 const source=execFileSync("git",["show",`278468cf267b506f0310b229439551a546a2e677:${relative}`],{cwd:root,encoding:"utf8",windowsHide:true});
 const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(source,file);
 return {classificarCategoriaUniversal:offer=>({categoria:m.exports.classificarCategoriaOferta(offer,offer.titulo)})};
}
const focal=focalService(),candidate=require("../modules/inteligencia-universal/categoria.service");
const lab=createStructuralClassifier(),originalLog=console.log;console.log=()=>{};
let report;
try{
 const results=fixture.real.map(row=>{
  const offer={titulo:row.titulo,categoria:"Diversos",marketplace:row.marketplace};
  return {...row,current:baseline.classificarCategoriaUniversal(offer).categoria,focal:focal.classificarCategoriaUniversal(offer).categoria,candidate:candidate.classificarCategoriaUniversal(offer).categoria,lab:lab.decide(offer,{workspaceId:"replay_fixture",origin:row.origin}).categoria};
 });
 const labeled=results.filter(r=>r.expected!==null),unlabeled=results.filter(r=>r.expected===null);
 const summary=variant=>({total:results.length,labeled:labeled.length,unlabeled:unlabeled.length,labeledCorrect:labeled.filter(r=>r[variant]===r.expected).length,labeledIncorrect:labeled.filter(r=>r[variant]!==r.expected).length,falsePositiveSpecific:labeled.filter(r=>r[variant]!=="Diversos"&&r[variant]!==r.expected).length,remainingDiversos:results.filter(r=>r[variant]==="Diversos").length,labeledDiversosUndue:labeled.filter(r=>r[variant]==="Diversos"&&r.expected!=="Diversos").length,unlabeledSpecificNotValidated:unlabeled.filter(r=>r[variant]!=="Diversos").length});
 report={sampleSha256:createHash("sha256").update(JSON.stringify(fixture.real)).digest("hex"),sampling:fixture.sampling,persistedSnapshot:fixture.snapshotCounts,labels:"Curated factual-title review; not blind independent labeling, not population accuracy. null is not judged correct or incorrect.",summary:Object.fromEntries(["current","focal","candidate","lab"].map(k=>[k,summary(k)])),changes:results.filter(r=>r.current!==r.candidate),regressions:labeled.filter(r=>r.current===r.expected&&r.candidate!==r.expected),falsePositives:labeled.filter(r=>r.candidate!=="Diversos"&&r.candidate!==r.expected),metricsLab:lab.metrics("replay_fixture"),results};
}finally{console.log=originalLog;}
const out=args.indexOf("--out");if(out>=0)fs.writeFileSync(args[out+1],JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
if(report.regressions.length||report.falsePositives.length)process.exitCode=1;
