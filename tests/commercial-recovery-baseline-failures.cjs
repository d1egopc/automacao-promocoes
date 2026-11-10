"use strict";
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process"),assert=require("node:assert/strict");
const root=process.cwd(),base=process.argv[2];
assert.ok(base && fs.existsSync(base));
const files=["imagem-candidatos-universal.test.js","engine-v2-marketplaces-fidelidade.test.js","template-universal-visual-contract.test.js"];
function signature(output,dir){
 const start=output.lastIndexOf("AssertionError");
 assert.ok(start>=0,"failure must be an assertion, never infrastructure");
 return output.slice(start).replaceAll(dir,"<TREE>").split(/\r?\n/)
   .filter(line=>!/^\s*at /.test(line) && !/^Node\.js v/.test(line)).join("\n").trim();
}
for(const file of files){
 const runs=[base,root].map(dir=>{
  const r=cp.spawnSync(process.execPath,[path.join(dir,"tests",file)],{cwd:dir,encoding:"utf8",timeout:60000,env:{...process.env,NODE_PATH:path.join(root,"node_modules")}});
  assert.equal(r.status,1,`${file}: expected exact assertion failure`);
  const output=r.stdout+"\n"+r.stderr;
  fs.writeFileSync(path.join(process.env.RUNNER_TEMP,`${file}.${dir===root?"candidate":"base"}.log`),output);
  return signature(output,dir);
 });
 assert.equal(runs[1],runs[0],`${file}: new or changed failure`);
 console.log(JSON.stringify({file,base:"d38a59af34db2c5d42ae204a3987f8b5888a41cb",sameAssertion:true,signature:runs[0]}));
}
