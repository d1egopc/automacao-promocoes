"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),{spawnSync}=require("node:child_process");
const root=path.resolve(__dirname,".."),g=require("../scripts/guardian-v1.cjs"),p=g.BALANCED_BUFFER_PROFILE;
const sha=()=>spawnSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).stdout.trim();
const hash=s=>crypto.createHash("sha256").update(s).digest("hex");
test("closed balanced profile pins build recipe, installer, version and dependency",()=>{
  for(const [file,h] of Object.entries({...p.runtimeHashes,...p.unchangedBuildHashes}))
    assert.equal(hash(fs.readFileSync(path.join(root,file))),h,file);
  const patch=require("../modules/whatsapp/baileys-balanced-buffer-patch");
  const source=require("./fixtures/baileys-6.7.22-event-buffer.json");
  assert.equal(hash(source),p.dependencies["lib/Utils/event-buffer.js"].before);
  assert.equal(hash(patch.transform(source)),p.dependencies["lib/Utils/event-buffer.js"].after);
});
test("generated image recipe runs only pinned offline installer and preserves node user",()=>{
  const plan=g.buildPlan(root,p.baseSha,sha());assert.equal(plan.validation,"PASS");
  assert.equal(plan.deployMode,"baileys_balanced_buffer_patch");
  assert.deepEqual(plan.runtimeFiles,Object.keys(p.runtimeHashes).sort());
  const recipe=g.renderDockerfile(plan,"local/optimus-deploy-base:fixture");
  assert.equal((recipe.match(/^RUN /gm)||[]).length,1);
  assert.match(recipe,/require\('\/app\/modules\/whatsapp\/baileys-balanced-buffer-patch.js'\)/);
  assert.doesNotMatch(recipe,/npm|curl|wget|apt-get|\/data|\.env|secret|ADD /i);
  assert.ok(recipe.endsWith("USER node\n"));
  assert.throws(()=>g.renderDockerfile({...plan,baseSha:"0".repeat(40)},"local/optimus-deploy-base:fixture"));
  assert.throws(()=>g.renderDockerfile({...plan,runtimeFiles:[...plan.runtimeFiles,"index.js"]},"local/optimus-deploy-base:fixture"));
});
test("clean install chain and Docker preinstall use the exact tested patch",()=>{
  const pkg=require("../package.json"),installer=fs.readFileSync(path.join(root,"scripts/apply-baileys-retry-hotfix.cjs"),"utf8"),docker=fs.readFileSync(path.join(root,"Dockerfile"),"utf8");
  assert.equal(pkg.dependencies["@whiskeysockets/baileys"],"6.7.22");
  assert.equal(pkg.scripts.postinstall,"node scripts/apply-baileys-retry-hotfix.cjs");
  assert.match(installer,/require\("\.\.\/modules\/whatsapp\/baileys-balanced-buffer-patch"\).applyPatch\(\)/);
  assert.ok(docker.indexOf("COPY modules/whatsapp/baileys-balanced-buffer-patch.js")<docker.indexOf("RUN npm ci"));
});
test("tampered Docker recipe, installer, extra runtime and wrong base fail closed",()=>{
  const parent=path.join(root,"tmp/balanced-negative");fs.mkdirSync(parent,{recursive:true});
  const dir=fs.mkdtempSync(path.join(parent,"fixture-"));
  function git(args){const r=spawnSync("git",args,{cwd:dir,encoding:"utf8",windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
  try {
    git(["clone","--quiet","--shared","--no-checkout",root,"."]);
    git(["config","core.autocrlf","false"]);
    git(["config","core.longpaths","true"]);
    git(["checkout","--quiet","--detach",sha()]);
    git(["config","user.name","Fixture"]);git(["config","user.email","fixture@example.invalid"]);
    assert.equal(g.buildPlan(dir,p.baseSha,git(["rev-parse","HEAD"])).validation,"PASS");
    for(const file of ["Dockerfile","scripts/apply-baileys-retry-hotfix.cjs","modules/engine/unapproved-buffer-fixture.js"]){
      const target=path.join(dir,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.appendFileSync(target,"\n# unapproved fixture\n");
      git(["add","--",file]);git(["commit","--quiet","-m","negative fixture"]);
      assert.equal(g.buildPlan(dir,p.baseSha,git(["rev-parse","HEAD"])).validation,"BLOCKED",file);
    }
    assert.equal(g.buildPlan(dir,p.hotfixSha,git(["rev-parse","HEAD"])).validation,"BLOCKED");
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
