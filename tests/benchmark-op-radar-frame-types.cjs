"use strict";
const {EventEmitter}=require("node:events"),{performance}=require("node:perf_hooks");
const {createIngressBoundaryObservation}=require("../modules/whatsapp/ingress-boundary-observation");
function measure(active){
 const ws=new EventEmitter(),ev=new EventEmitter(),sock={ws,ev};ev.isBuffering=()=>false;
 const original=ws.emit,o=createIngressBoundaryObservation(),frame={tag:"iq"};
 if(active)o.start({workspaceId:"admin",sessionId:"admin_Zoiao Claro",groupId:"120363408782037034@g.us",generation:1,sock,scopeValidated:true});
 for(let i=0;i<1000;i++)ws.emit("frame",frame);
 const n=20000,t=performance.now();for(let i=0;i<n;i++)ws.emit("frame",frame);const elapsed=performance.now()-t;
 const offUnchanged=active?null:ws.emit===original;o.stop();return {events:n,elapsedMs:elapsed,usPerEvent:elapsed*1000/n,offUnchanged};
}
const samples={off:[],active:[]};for(let i=0;i<5;i++){samples.off.push(measure(false));samples.active.push(measure(true));}
const median=a=>a.map(x=>x.usPerEvent).sort((x,y)=>x-y)[2];
console.log(JSON.stringify({version:process.versions.node,offMedianUsPerEvent:median(samples.off),activeMedianUsPerEvent:median(samples.active),offEmitUnchanged:samples.off.every(x=>x.offUnchanged),samples}));
