"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {spawnSync}=require("node:child_process");
const root=path.resolve(__dirname,"..");
const guardian=require("../scripts/guardian-v1.cjs");
const {BAILEYS_BUFFER_PROFILE:p,buildPlan,renderDockerfile}=guardian;
const fixtureParent=path.join(root,"tmp","baileys-packaging-guards");
function git(cwd,args){const r=spawnSync("git",args,{cwd,encoding:"utf8",windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function clone(){
 fs.mkdirSync(fixtureParent,{recursive:true});const dir=fs.mkdtempSync(path.join(fixtureParent,"fixture-"));
 git(root,["clone","--quiet","--shared","--no-checkout",root,dir]);
 git(dir,["checkout","--quiet","--detach",git(root,["rev-parse","HEAD"])]);
 git(dir,["config","user.email","fixture@example.invalid"]);git(dir,["config","user.name","Fixture"]);return dir;
}
function cleanup(dir){assert.ok(path.resolve(dir).startsWith(path.resolve(fixtureParent)+path.sep));fs.rmSync(dir,{recursive:true,force:true});}
function commit(dir,file,text){fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),text);
 git(dir,["add","--",file]);git(dir,["commit","--quiet","-m","negative fixture"]);return git(dir,["rev-parse","HEAD"]);}
const plan=()=>buildPlan(root,p.baseSha,git(root,["rev-parse","HEAD"]));

test("reviewed runtime exact hashes and unchanged complete Dockerfile/postinstall produce only the pinned mode",()=>{
 const r=plan();assert.equal(r.validation,"PASS");assert.equal(r.deployMode,"baileys_buffer_patch");
 assert.deepEqual(r.runtimeFiles,Object.keys(p.runtimeHashes).sort());
 for(const [file,hash]of Object.entries({...p.runtimeHashes,...p.unchangedBuildHashes}))
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(root,file))).digest("hex"),hash,file);
 assert.equal(git(root,["diff",p.baseSha,"HEAD","--","Dockerfile","scripts/apply-baileys-retry-hotfix.cjs","package.json","package-lock.json",".dockerignore"]),"");
});

test("generated Dockerfile has exactly three COPYs and one reviewed offline installer; no npm/env/secrets/data commands",()=>{
 const dockerfile=renderDockerfile(plan(),"local/optimus-deploy-base:123-1");
 assert.equal(dockerfile,["FROM local/optimus-deploy-base:123-1","USER root",
  ...Object.keys(p.runtimeHashes).sort().map(f=>`COPY --chown=node:node ${f} /app/${f}`),
  "RUN node -e \"require('/app/modules/whatsapp/baileys-buffer-hotfix.service.js').applyPatch({rootDir:'/app'})\"","USER node", ""].join("\n"));
 assert.equal((dockerfile.match(/^RUN /gm)||[]).length,1);
 assert.doesNotMatch(dockerfile,/npm|curl|wget|apt-get|\/data|\.env|secret|ADD /i);
 assert.throws(()=>renderDockerfile(plan(),"base; cat /secret"),/unapproved_image_build/);
 assert.throws(()=>renderDockerfile({...plan(),deployMode:"full"},"local/optimus-deploy-base:123-1"),/unapproved_build_mode/);
 assert.throws(()=>renderDockerfile({...plan(),deployMode:"overlay"},"local/optimus-deploy-base:123-1"),/dependency_patch_mode_required/);
});

for(const file of Object.keys(p.runtimeHashes))test("negative: modified approved file remains blocked: "+file,()=>{
 const dir=clone();try{
  const sha=commit(dir,file,fs.readFileSync(path.join(dir,file),"utf8")+"\n// unauthorized\n");
  const r=buildPlan(dir,p.baseSha,sha);assert.equal(r.validation,"BLOCKED");
  assert.ok(r.blocked.some(x=>x.file===file&&x.cause==="unapproved_hotfix_content"));
 }finally{cleanup(dir);}
});

for(const file of ["Dockerfile","scripts/apply-baileys-retry-hotfix.cjs","package.json",".dockerignore","scripts/unexpected.cjs","modules/unexpected.js"])
 test("negative: additional build/runtime modification rejected: "+file,()=>{
 const dir=clone();try{
  const filename=path.join(dir,file),original=fs.existsSync(filename)?fs.readFileSync(filename,"utf8"):"";
  const sha=commit(dir,file,original+"\n# unauthorized\n");const r=buildPlan(dir,p.baseSha,sha);
  assert.equal(r.validation,"BLOCKED");assert.ok(r.blocked.length);
 }finally{cleanup(dir);}
});

test("negative: deleted runtime, wrong base, absolute/traversal path never become an exception",()=>{
 const dir=clone();try{
  git(dir,["rm","--","modules/whatsapp/baileys-buffer-recovery.service.js"]);git(dir,["commit","--quiet","-m","delete negative"]);
  const r=buildPlan(dir,p.baseSha,git(dir,["rev-parse","HEAD"]));assert.equal(r.validation,"BLOCKED");
  assert.ok(r.blocked.some(x=>x.cause==="deleted_file_not_supported"));
 }finally{cleanup(dir);}
 const r=buildPlan(root,"e55890ca4cf789cbdbdaf523f289ba6a2c891755",git(root,["rev-parse","HEAD"]));
 assert.equal(r.validation,"BLOCKED");assert.ok(r.blocked.some(x=>x.cause==="unapproved_hotfix_base"));
 for(const file of ["/app/secret","../secret","modules/../secret","C:/secret"])
  assert.throws(()=>guardian.normalizeRuntimePath(file),/unsafe_path/);
});

test("packaging does not change the hotfix: eight other session fixtures stay on original behavior",()=>{
 const {createBufferRecovery}=require("../modules/whatsapp/baileys-buffer-recovery.service");
 for(let i=0;i<8;i++){
  let called=false;
  const r=createBufferRecovery({workspaceId:"fixture_workspace_"+i,sessionId:"fixture_workspace_"+i+"_phone",
   isCurrent:()=>{called=true;return true;}});
  assert.equal(r,null);assert.equal(called,false);
 }
});

test("official deployment preserves network isolation, base/hash gates, Compose/mount/PG identity and rollback",()=>{
 const s=fs.readFileSync(path.join(root,"scripts/deploy-backend-vps-manual.sh"),"utf8");
 assert.match(s,/docker build --pull=false --network=none/);
 assert.match(s,/--format dependencies-before/);assert.match(s,/--format dependencies-after/);
 assert.match(s,/validate_runtime_overlay_path/);assert.match(s,/env_fingerprint optimus-backend/);
 assert.match(s,/mount_fingerprint optimus-backend/);assert.match(s,/postgres_id/);
 assert.match(s,/Effective Compose changed beyond backend image/);
 assert.match(s,/cp -p -- "\$backup" "\$release"/);
 assert.match(s,/up -d --no-deps --no-build --force-recreate backend/);
 const installer=fs.readFileSync(path.join(root,"modules/whatsapp/baileys-buffer-hotfix.service.js"),"utf8");
 assert.doesNotMatch(installer,/process\.env|child_process|https?:|fetch\(|\/data/);
});
