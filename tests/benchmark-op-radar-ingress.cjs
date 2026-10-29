'use strict';
const {performance}=require('node:perf_hooks');
const {EventEmitter}=require('node:events');
const {createIngressBoundaryObservation,TARGET_GROUP_ID,TARGET_SESSION_ID}=require('../modules/whatsapp/ingress-boundary-observation');
const o=createIngressBoundaryObservation();const n=1000000;const start=performance.now();for(let i=0;i<n;i++)o.mark('wrapper',{});const offMs=performance.now()-start;
const sock={ev:new EventEmitter()},packet={messages:[{key:{id:'fixture',remoteJid:TARGET_GROUP_ID,fromMe:false}}]};
const baseline=performance.now();for(let i=0;i<500;i++)sock.ev.emit('messages.upsert',packet);const nativeMs=performance.now()-baseline;
o.start({workspaceId:'admin',sessionId:TARGET_SESSION_ID,groupId:TARGET_GROUP_ID,sock,generation:1,scopeValidated:true});const active=performance.now();for(let i=0;i<500;i++)sock.ev.emit('messages.upsert',packet);const activeMs=performance.now()-active;const snapshot=o.status();o.stop();
console.log(JSON.stringify({offCalls:n,offMs,offNsPerCall:offMs*1e6/n,native500Ms:nativeMs,active500Ms:activeMs,retainedMessages:snapshot.messages.length,records:snapshot.records.length,note:'Microbenchmark local/CI; no network, no production capacity extrapolation.'}));
