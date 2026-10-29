'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),base=fs.mkdtempSync(path.join(os.tmpdir(),'op-boundary-base-'));
const run=(args,cwd)=>cp.spawnSync(process.execPath,args,{cwd,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
try{
 for(const file of ['index.js','modules/whatsapp/baileys-buffer-recovery.service.js','modules/whatsapp/socket-listener-lifecycle.service.js','modules/whatsapp/baileys-buffer-hotfix.service.js','tests/baileys-initial-buffer-recovery.test.cjs']){
  const git=cp.spawnSync('git',['show','f02b5a590c6f01f8ceb430013990a1c86ddcd522:'+file],{cwd:root,maxBuffer:8*1024*1024});if(git.status!==0)throw Error('baseline_read_failed');
  fs.mkdirSync(path.dirname(path.join(base,file)),{recursive:true});fs.writeFileSync(path.join(base,file),git.stdout);
 }
 fs.symlinkSync(path.join(root,'node_modules'),path.join(base,'node_modules'),process.platform==='win32'?'junction':'dir');
 const args=['--test','--test-reporter=tap','tests/baileys-initial-buffer-recovery.test.cjs'];const before=run(args,base),after=run(args,root);
 const failures=r=>[...r.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map(x=>x[1]);const b=failures(before),a=failures(after);
 if(before.error||after.error||!before.stdout.includes('# tests ')||!after.stdout.includes('# tests '))throw Error('comparison_incomplete');
 const added=a.filter(x=>!b.includes(x));console.log(JSON.stringify({test:'baileys-initial-buffer-recovery',baselineFailures:b,candidateFailures:a,newFailures:added,baselineExit:before.status,candidateExit:after.status}));
 if(added.length)process.exitCode=1;
}finally{fs.rmSync(base,{recursive:true,force:true});}
