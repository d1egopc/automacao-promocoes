"use strict";

// Executes the complete current server handler source for its Engine-only
// Amazon route. Peripheral transport, logging and marketplace calls are
// deterministic fixtures; the capture guard and handler branching are real.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { criarHandlerRadarServidor } =
  require("./helpers/universal-flow-radar-server-handler");

test("servidor Radar completo preserva T0 WhatsApp e Telegram ate o handoff Engine",async()=>{
  const records=[];
  const handler=criarHandlerRadarServidor(async input=>{
    records.push(input);return {ok:true,id:records.length};
  });
  const seconds=1791547200;
  const original=new Date(seconds*1000).toISOString();
  const url="https://www.amazon.com.br/dp/B012345678";
  const common={sessaoId:"fixture",grupoId:"fixture_group",grupoNome:"Fixture",
    texto:`Oferta ${url}`,linksCapturados:[url],aguardarAckEngine:true,
    origemAutorizadaInternamente:true,
    capturadaEm:"2026-10-09T12:00:00.000Z"};
  const wa=await handler({...common,origemTipo:"whatsapp",
    raw:{messageTimestamp:{toNumber:()=>seconds}}});
  const tg=await handler({...common,origemTipo:"telegram",
    raw:{message:{date:seconds}}});
  assert.equal(wa.radarAccepted,true);
  assert.equal(tg.radarAccepted,true);
  assert.equal(records.length,2);
  assert(records.every(row=>row.capturadoEm===original));
  const noClock=await handler({...common,origemTipo:"telegram",
    raw:{message:{}}});
  assert.deepEqual(noClock,{ok:false,motivo:"captura_sem_tempo_factual"});
  assert.equal(records.length,2);
});
