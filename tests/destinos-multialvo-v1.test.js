"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const multi = require("../utils/destinos-multialvo");

function waDestino(extra = {}) {
  return {
    id: "destino-wa",
    nome: "WA Geral",
    tipo: "whatsapp",
    conexaoId: "sessao_1",
    grupo: "grupo_1@g.us",
    ativo: true,
    ...extra
  };
}

function discordDestino(extra = {}) {
  return {
    id: "destino-dc",
    nome: "Discord Geral",
    tipo: "discord",
    conexaoId: "discord_1",
    channelId: "canal_1",
    ativo: true,
    ...extra
  };
}

function cincoGrupos() {
  return ["g1@g.us", "g2@g.us", "g3@g.us", "g4@g.us", "g5@g.us"];
}

{
  const normalizado = multi.aplicarContratoMultiAlvoDestino(waDestino());
  assert.strictEqual(normalizado.alvos.length, 1, "destino legado WA vira alvos[1]");
  assert.strictEqual(normalizado.alvos[0].grupoId, "grupo_1@g.us");
  assert.strictEqual(normalizado.grupo, "grupo_1@g.us", "espelho legado grupo deve ser preservado");
  assert.deepStrictEqual(normalizado.gruposWhatsapp, ["grupo_1@g.us"], "espelho legado gruposWhatsapp deve ser preservado");
}

{
  const normalizado = multi.aplicarContratoMultiAlvoDestino(discordDestino());
  assert.strictEqual(normalizado.alvos.length, 1, "destino legado Discord vira alvos[1]");
  assert.strictEqual(normalizado.alvos[0].channelId, "canal_1");
  assert.strictEqual(normalizado.channelId, "canal_1", "espelho legado channelId deve ser preservado");
  assert.strictEqual(normalizado.grupo, "canal_1", "espelho legado grupo deve apontar para o canal");
}

{
  const normalizado = multi.aplicarContratoMultiAlvoDestino(waDestino({
    grupo: "",
    gruposWhatsapp: [],
    alvos: [
      ...cincoGrupos().map((grupoId, index) => ({ grupoId, nome: `Grupo ${index + 1}` })),
      { grupoId: "g6@g.us", nome: "Grupo 6" }
    ]
  }));

  assert.strictEqual(normalizado.alvos.length, multi.MAX_ALVOS_DESTINO, "maximo deve ser 5 alvos");
  assert.deepStrictEqual(normalizado.gruposWhatsapp, cincoGrupos(), "espelho legado deve conter os 5 primeiros grupos");
  assert.strictEqual(normalizado.grupo, "g1@g.us", "primeiro alvo alimenta o espelho legado");
}

{
  const destino = multi.aplicarContratoMultiAlvoDestino(waDestino({
    grupo: "",
    alvos: cincoGrupos().map(grupoId => ({ grupoId }))
  }));
  let estado = multi.criarOuAtualizarSnapshotEstado({}, destino);
  for (const alvo of estado.snapshotAlvos.slice(0, 4)) {
    estado = multi.registrarResultadoAlvo(estado, alvo, { ok: true, estado: "enviado", enviadoEm: "2026-08-20T10:00:00.000Z" });
  }
  estado = multi.registrarResultadoAlvo(estado, estado.snapshotAlvos[4], { ok: false, estado: "falha", erro: "falha_mock" });

  assert.strictEqual(multi.destinoEnviadoPorAlvos(estado), false, "4/5 nao conclui o destino logico");
  assert.strictEqual(multi.destinoConcluidoPorAlvos(estado), false, "falha recuperavel continua pendente");
  assert.deepStrictEqual(
    multi.alvosPendentesEstado(estado).map(alvo => alvo.grupoId),
    ["g5@g.us"],
    "retry deve mirar somente o quinto alvo"
  );
}

{
  const destino = multi.aplicarContratoMultiAlvoDestino(waDestino({
    grupo: "",
    alvos: cincoGrupos().map(grupoId => ({ grupoId }))
  }));
  let estadoPersistido = multi.criarOuAtualizarSnapshotEstado({}, destino);
  for (const alvo of estadoPersistido.snapshotAlvos.slice(0, 4)) {
    estadoPersistido = multi.registrarResultadoAlvo(estadoPersistido, alvo, { ok: true, estado: "enviado" });
  }
  estadoPersistido = multi.registrarResultadoAlvo(estadoPersistido, estadoPersistido.snapshotAlvos[4], { ok: false, estado: "falha", erro: "queda" });

  const aposReinicio = multi.criarOuAtualizarSnapshotEstado(estadoPersistido, destino);
  assert.deepStrictEqual(
    multi.alvosPendentesEstado(aposReinicio).map(alvo => alvo.grupoId),
    ["g5@g.us"],
    "reinicio nao pode duplicar os 4 alvos ja enviados"
  );

  const concluido = multi.registrarResultadoAlvo(aposReinicio, aposReinicio.snapshotAlvos[4], { ok: true, estado: "enviado" });
  assert.strictEqual(multi.destinoEnviadoPorAlvos(concluido), true, "quinto sucesso conclui o destino");
}

{
  const telegram = {
    tipo: "telegram",
    chatId: "-100123",
    telegramDestinos: ["-100123"]
  };
  assert.deepStrictEqual(multi.normalizarAlvosDestino(telegram), [], "Telegram permanece legado e sem alvos[] funcional na V1");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(multi.aplicarContratoMultiAlvoDestino(telegram), "alvos"), false);
}

{
  const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.ok(fonte.includes("destinosMultiAlvo.aplicarContratoMultiAlvoDestino(normalizado)"), "normalizador oficial deve aplicar contrato MultiAlvo");
  assert.ok(fonte.includes("return `${tipo || \"destino\"}:${id || \"sem_id\"}`;"), "chave de fanout deve continuar por destino logico");
  assert.ok(fonte.includes("destinosMultiAlvo.destinoConcluidoPorAlvos(estadoFanout)"), "skip deve considerar conclusao por alvos");
  assert.ok(fonte.includes("alvosPendentesFanout(oferta, destino)"), "executor deve enviar apenas alvos pendentes");
  assert.ok(fonte.includes("registrarResultadoAlvoFanout(oferta, destino, alvoFanout"), "WhatsApp deve registrar resultado por alvo");
  assert.ok(fonte.includes("registrarResultadoAlvoFanout(oferta, destino, alvoDiscord"), "Discord deve registrar resultado por alvo");
  assert.ok(fonte.includes("destinosDisponiveis: destinosLiberados.length"), "Fila Viva deve continuar contando slots logicos");
  assert.ok(!/tipo:\s*\"telegram\"[\s\S]{0,120}alvos/.test(fonte), "index nao deve criar alvos funcionais para Telegram nesta V1");
}

console.log("destinos-multialvo-v1.test.js OK");
