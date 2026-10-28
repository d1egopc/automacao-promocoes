"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{spawnSync}=require("node:child_process");
test("real Compose merge preserves data and PostgreSQL; rollback removes only approved sensor bind",{skip:process.platform==="win32"},()=>{
 const root=path.resolve(__dirname,".."),dir=fs.mkdtempSync(path.join(os.tmpdir(),"garimpei-compose-"));
 try{
  const base=path.join(dir,"base.json"),old={services:{backend:{image:"fixture/backend:old",volumes:[{type:"bind",source:"/opt/optimus/data",target:"/data"}]},postgres:{image:"postgres:17",volumes:["pg:/var/lib/postgresql/data"]}},volumes:{pg:{}}};
  fs.writeFileSync(base,JSON.stringify(old));
  function config(extra=[]){const args=["compose","-p","garimpeifixture","-f",base,...extra,"config","--format","json"],r=spawnSync("docker",args,{cwd:root,encoding:"utf8"});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
  const before=config(),after=config(["-f","docs/infra/garimpei-sensor-compose.yml"]);
  assert.deepEqual(after.services.postgres,before.services.postgres);
  assert.equal(after.services.backend.volumes.length,before.services.backend.volumes.length+1);
  const a=path.join(dir,"a.json"),b=path.join(dir,"b.json");fs.writeFileSync(a,JSON.stringify(before));fs.writeFileSync(b,JSON.stringify(after));
  for(const [approval,status]of[["false",1],["true",0]]){const r=spawnSync("python3",["-B","scripts/garimpei-infra-guard.py","compose",a,b,approval],{cwd:root,encoding:"utf8"});assert.equal(r.status,status,r.stderr);}
  assert.deepEqual(config(),before);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
