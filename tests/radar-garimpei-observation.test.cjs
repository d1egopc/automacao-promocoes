"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { createRadarIngressObservation } = require("../modules/radar/ingress-observation-v1");
const source = fs.readFileSync(require.resolve("../index.js"), "utf8");
const jid = "123456789@g.us", session = "admin_ZOIAO";
function validate(change = () => {}) {
  const sock = { ev: {} };
  sock.__optimusListeners = { "messages.upsert": { emissor: sock.ev, evento: "messages.upsert", handler() {} } };
  const config = { monitoramentoAtivo: true, sessoesWhatsappMonitoradas: [{ sessaoId: session,
    gruposMonitorados: [{ id: jid, grupoId: jid, remoteJid: jid, sessaoId: session, ativo: true, nome: "renamed" }] }] };
  const ctx = {
    // Synthetic JID substitutes the approved identity; all other inputs use real SHA-256.
    createHash: algorithm => { let value; return { update(input) { value = input; return this; },
      digest(format) { return value === jid ? "ec288ef5bc72eae2" : crypto.createHash(algorithm).update(value).digest(format); } }; },
    carregarRadarConfigCliente: () => config,
    obterGrupoWhatsappIdTecnicoRadar: g => g.remoteJid || g.grupoId || g.id,
    resolverSessaoWhatsappRadarCliente: (_, id) => id,
    sessoesMeta: { [session]: { workspaceId: "admin", clienteId: "admin" } },
    resolverClienteMensageiroPorSessao: () => ({ clienteIdMensageiro: "admin" }),
    sessoes: { [session]: sock }, statusSessao: { [session]: "open" },
    socketEhAtual: () => true, geracoesSocketWhatsapp: { [session]: 2 }
  };
  change({ config, ctx, group: config.sessoesWhatsappMonitoradas[0].gruposMonitorados[0], sock });
  const start = source.indexOf("const RADAR_INGRESS_OBSERVATION_TARGET");
  vm.runInNewContext(source.slice(start, source.indexOf("function responderObservacaoIngressRadar", start)) +
    ";this.validate=validarAlvoObservacaoIngressRadar", ctx);
  return ctx.validate();
}
test("target uses approved identity regardless of display name and rejects spoofed title", () => {
  assert.equal(validate().ok, true);
  assert.equal(validate(({ group }) => { group.nome = "Garimpei #176"; group.remoteJid = group.id = group.grupoId = "999999999@g.us"; }).ok, false);
});
test("inactive, duplicate, inconsistent identity, session and tenant fail closed", () => {
  for (const change of [
    ({config}) => {config.monitoramentoAtivo=false;},
    ({group}) => {group.ativo=false;},
    ({group}) => {group.grupoId="999999999@g.us";},
    ({group}) => {group.sessaoId="user_other_ZOIAO";},
    ({config}) => {config.sessoesWhatsappMonitoradas[0].sessaoId="admin_other";},
    ({ctx}) => {ctx.sessoesMeta[session].workspaceId="user_pss60lus";},
    ({ctx}) => {ctx.sessoesMeta[session].clienteId="user_pss60lus";},
    ({ctx}) => {ctx.resolverClienteMensageiroPorSessao=()=>({clienteIdMensageiro:"user_pss60lus"});},
    ({config,group}) => {config.sessoesWhatsappMonitoradas[0].gruposMonitorados.push({...group});},
    ({sock}) => {sock.ev.listeners=()=>[];}
  ]) assert.equal(validate(change).ok,false);
});
test("metadata-only correlation, exact target, filter reasons and safe Engine event ID", () => {
  const sock={ev:{}}, o=createRadarIngressObservation();
  assert.equal(o.status().state,"off");
  o.start({workspaceId:"admin",sessionId:session,groupId:jid,sock,generation:2,scopeValidated:true,listenerRegistered:true});
  const message={key:{id:"PRIVATE_ID",remoteJid:jid,participant:"PRIVATE_PHONE",fromMe:false},message:{conversation:"PRIVATE_TEXT cookie=PRIVATE_SECRET"}};
  const context={workspaceId:"admin",sessionId:session,sock,message,generation:2};
  o.observeUpsert({...context,emitter:sock.ev,current:true,messages:[message],type:"notify"});
  o.recordStage({...context,stage:"listener_gate",decision:"ignored",reason:"buffer_recovery_suppressed"});
  o.recordStage({...context,stage:"radar_gate",decision:"accepted",reason:"accepted"});
  o.recordStage({...context,stage:"engine_event",decision:"accepted",engineResult:"created",eventId:"1234"});
  o.recordStage({...context,stage:"engine_event",decision:"error",eventId:"PRIVATE_SECRET"});
  const report=o.stop();
  assert.equal(report.sampleStatus,"AMOSTRA_OBSERVADA");
  assert.equal(report.records[0].stages[1].reason,"buffer_recovery_suppressed");
  assert.equal(report.records[0].stages[3].eventId,"1234");
  assert.equal(report.records[0].stages[4].eventId,undefined);
  assert.equal(report.records[0].workspaceHash,report.scope.workspaceHash);
  assert.equal(typeof report.records[0].observedAt,"number");
  for(const value of [jid,session,"PRIVATE_","cookie=","participant"]) assert.equal(JSON.stringify(report).includes(value),false);
});
test("no natural publication is SEM_AMOSTRA, never a transport failure", () => {
  const o=createRadarIngressObservation({maxDurationMs:1});
  o.start({workspaceId:"admin",sessionId:session,groupId:jid,sock:{ev:{}},generation:2,scopeValidated:true,listenerRegistered:true});
  assert.equal(o.stop().sampleStatus,"SEM_AMOSTRA");
});
test("existing Engine promise hook correlates actual result.id without awaiting or changing its result", async () => {
  const start=source.indexOf("if (radarIngressObservation.isActiveFor({", source.indexOf("const registroEngineRadarPromise ="));
  const end=source.indexOf("const registroEngineRadar =",start);
  assert.ok(start>0 && end>start);
  const stages=[], result={ok:true,id:"9812",duplicado:false};
  const promise=Promise.resolve(result);
  vm.runInNewContext(source.slice(start,end),{
    radarIngressObservation:{isActiveFor:()=>true,recordStage:value=>stages.push(value)},
    diagnosticoWorkspaceId:"admin",sessaoIdTexto:session,grupoIdTexto:jid,sock:{__optimusSocketGeracao:2},
    raw:{},links:[],marketplaceDetectadoLinks:"magalu",registroEngineRadarPromise:promise
  });
  await promise; await Promise.resolve();
  assert.equal(stages.length,1);
  assert.equal(stages[0].eventId,"9812");
  assert.equal(stages[0].engineResult,"created");
  assert.equal(await promise,result);
});
