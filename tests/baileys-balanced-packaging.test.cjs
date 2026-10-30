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
