"use strict";
const test=require("node:test"), assert=require("node:assert/strict"), fs=require("node:fs"), vm=require("node:vm"),{EventEmitter}=require("node:events");
const patch=require("../modules/whatsapp/baileys-balanced-buffer-patch");
// Published tarball omits the final newline; fixture has a Git-friendly newline.
const source=require("./fixtures/baileys-6.7.22-event-buffer.json");
const logger={debug(){},trace(){}};
function fixture(patched=true) {
  let code=patched?patch.transform(source):source;
  code=code.replace(/^import .*;\r?\n/gm,"").replace("export const makeEventBuffer", "const makeEventBuffer");
  const timers=new Map(); let id=0;
  const ctx={EventEmitter,logger,WAMessageStatus:{},setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:i=>timers.delete(i)};
  vm.runInNewContext(code+"\nglobalThis.ev=makeEventBuffer(logger)",ctx);
  const rows=[];ctx.ev.on("messages.upsert",x=>rows.push(...x.messages.map(m=>m.key.id)));
  const emit=id=>ctx.ev.emit("messages.upsert",{type:"notify",messages:[{key:{id,remoteJid:"fixture@g.us"}}]});
  const tick=()=>{for(const [i,fn]of [...timers]){timers.delete(i);fn();}};
  return {ev:ctx.ev,rows,emit,tick,timers};
}
test("production defect before correction; post-sync upsert delivered after correction",async()=>{
  for(const fixed of [false,true]){const f=fixture(fixed);f.ev.buffer();f.ev.flush();await f.ev.createBufferedFunction(async()=>f.emit("one"))();f.tick();assert.equal(f.rows.length,fixed?1:0);assert.equal(f.ev.isBuffering(),!fixed);}
});
test("initial explicit hold survives completed work until sync finishes",async()=>{
  const f=fixture();f.ev.buffer();await f.ev.createBufferedFunction(async()=>f.emit("initial"))();f.tick();assert.equal(f.rows.length,0);f.ev.flush();assert.deepEqual(f.rows,["initial"]);
});
test("nested and concurrent work cannot flush before last completion",async()=>{
  const f=fixture();let release;const wait=new Promise(r=>release=r);
  const a=f.ev.createBufferedFunction(async()=>{f.emit("a");await wait;})();
  await f.ev.createBufferedFunction(async()=>{await f.ev.createBufferedFunction(async()=>f.emit("b"))();})();
  f.tick();assert.equal(f.rows.length,0);release();await a;f.tick();assert.deepEqual(f.rows,["a","b"]);f.tick();assert.equal(f.rows.length,2);
});
test("exception preserves error and releases settled work",async()=>{
  const f=fixture(),error=new Error("fixture");await assert.rejects(f.ev.createBufferedFunction(async()=>{f.emit("error");throw error;})(),e=>e===error);f.tick();assert.deepEqual(f.rows,["error"]);
});
test("sync completes during work without premature dispatch",async()=>{
  const f=fixture();f.ev.buffer();let release;const p=f.ev.createBufferedFunction(async()=>{f.emit("one");await new Promise(r=>release=r);})();assert.equal(f.ev.flush(),false);assert.equal(f.rows.length,0);release();await p;f.tick();assert.deepEqual(f.rows,["one"]);
});
test("consecutive/reactivated operations and independent socket generations",async()=>{
  const a=fixture(),b=fixture();for(let i=0;i<8;i++){await a.ev.createBufferedFunction(async()=>a.emit(String(i)))();a.tick();}b.ev.buffer();await b.ev.createBufferedFunction(async()=>b.emit("new-generation"))();b.tick();assert.equal(b.rows.length,0);assert.equal(a.rows.length,8);b.ev.flush();assert.deepEqual(b.rows,["new-generation"]);
});
test("new synchronization cancels pending release",async()=>{
  const f=fixture();await f.ev.createBufferedFunction(async()=>f.emit("one"))();f.ev.buffer();f.tick();assert.equal(f.rows.length,0);f.ev.flush();assert.deepEqual(f.rows,["one"]);
});
test("installer is version/hash pinned, idempotent and rejects foreign files before writing",()=>{
  const os=require("node:os"),path=require("node:path");
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"optimus-balanced-fixture-"));
  const dir=path.join(root,"node_modules/@whiskeysockets/baileys"),file=path.join(root,patch.FILE);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(path.join(dir,"package.json"),JSON.stringify({version:"6.7.22"}));
  fs.writeFileSync(file,source);
  try {
    assert.equal(patch.applyPatch({rootDir:root}).status,"applied");
    assert.equal(patch.applyPatch({rootDir:root}).status,"already_applied");
    fs.appendFileSync(file,"\n// unexpected");const before=fs.readFileSync(file,"utf8");
    assert.throws(()=>patch.applyPatch({rootDir:root}));assert.equal(fs.readFileSync(file,"utf8"),before);
    fs.writeFileSync(path.join(dir,"package.json"),JSON.stringify({version:"7.0.0"}));
    assert.throws(()=>patch.applyPatch({rootDir:root}),/version_mismatch/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
