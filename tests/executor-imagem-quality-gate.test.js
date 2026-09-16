"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  VISAO_COM_ERRO,
  construirReadModelPublicoPorMarcos
} = require("../modules/fila/fila-read-model-publico");

const root = path.join(__dirname, "..");
const indexFonte = fs.readFileSync(path.join(root, "index.js"), "utf8");

function trechoEntre(inicio, fim) {
  const i = indexFonte.indexOf(inicio);
  assert.ok(i >= 0, `inicio nao encontrado: ${inicio}`);
  const j = fim ? indexFonte.indexOf(fim, i + inicio.length) : indexFonte.length;
  assert.ok(j > i, `fim nao encontrado: ${fim}`);
  return indexFonte.slice(i, j);
}

{
  const helper = trechoEntre(
    "function avaliarImagemPublicavelOfertaExecutor",
    "function tipoMidiaDestinoExecutor"
  );
  assert.ok(helper.includes("oferta.imagemEnviavel === false"), "gate deve bloquear imagemEnviavel=false");
  assert.ok(helper.includes("avaliarPublicabilidadeImagemUniversal"), "gate deve validar proveniencia/base da imagem");
  assert.ok(helper.includes("motivo: \"sem_imagem\""), "gate deve expor motivo publico sem_imagem");
  assert.ok(helper.includes("imagemUrlEfemeraUniversal"), "gate deve bloquear URL efemera antes do dispatch");
}

{
  const executor = trechoEntre(
    "async function enviarParaDestinoInteligente",
    "async function processarFilaInterna"
  );
  const gate = executor.indexOf("avaliarImagemPublicavelOfertaExecutor(oferta)");
  assert.ok(gate >= 0, "executor inteligente deve ter gate central de imagem");

  for (const chamada of [
    "sock.sendMessage(grupo",
    "enviarDiscord({",
    "sendPhoto",
    "sendMessage`"
  ]) {
    const pos = executor.indexOf(chamada);
    assert.ok(pos < 0 || gate < pos, `gate deve ocorrer antes de ${chamada}`);
  }

  assert.ok(executor.includes("return {\n        enviado: false,\n        tentouEnvio: false,\n        motivo: \"sem_imagem\""), "gate central deve retornar sem tentativa de envio");
  assert.ok(gate < executor.indexOf("await registrarCreditoCheckpoint"), "gate deve ocorrer antes de qualquer debito por checkpoint");
  assert.ok(!executor.slice(gate, executor.indexOf("if (", gate + 1)).includes("sendMessage"), "gate nao pode chamar sender externo");
}

{
  const processamento = trechoEntre(
    "const resultadoEnvio =",
    "ultimoEnvioFila = Date.now();"
  );
  assert.ok(processamento.includes("const bloqueioHardSemImagem"), "processamento deve ter finalizacao hard sem imagem");
  assert.ok(processamento.indexOf("const bloqueioHardSemImagem") < processamento.indexOf("Oferta nao enviada; marcando erro tecnico"), "sem_imagem deve finalizar antes do erro generico");
  assert.ok(processamento.includes('oferta.statusPublico = "nao_enviado"'), "sem_imagem deve ser terminal nao_enviado");
  assert.ok(processamento.includes('oferta.statusOperacional = "sem_imagem"'), "sem_imagem deve manter motivo operacional proprio");
  assert.ok(processamento.includes('oferta.erro = ""'), "sem_imagem nao deve persistir erro generico");
  assert.ok(processamento.includes('registrarHistoricoLeveTerminalLegadoAposSave(clienteId, oferta, "executor_sem_imagem")'), "sem_imagem deve preservar historico/auditoria terminal");
}

{
  const telegramLegado = trechoEntre(
    "async function enviarTelegram(oferta, mensagem)",
    "// ================= FUN"
  );
  const gate = telegramLegado.indexOf("avaliarImagemPublicavelOfertaExecutor(oferta)");
  assert.ok(gate >= 0, "Telegram legado deve reutilizar gate de imagem");
  assert.ok(gate < telegramLegado.indexOf("sendPhoto"), "Telegram legado deve bloquear antes de sendPhoto");
  assert.ok(gate < telegramLegado.indexOf("sendMessage"), "Telegram legado deve bloquear antes de sendMessage");
}

{
  const agora = Date.parse("2026-09-16T12:00:00.000Z");
  const item = {
    id: "sem_imagem_executor",
    clienteId: "cliente_quality_gate",
    titulo: "Oferta bloqueada sem imagem",
    marketplace: "mercadolivre",
    preco: "R$ 100,00",
    cupom: "RADAROK",
    linkAfiliado: "https://meli.la/produto",
    dataEntradaFila: new Date(agora - 60_000).toISOString(),
    finalizadoEm: new Date(agora).toISOString(),
    status: "nao_enviado",
    statusPublico: "nao_enviado",
    statusOperacional: "sem_imagem",
    statusDetalhe: "Nao enviada: sem imagem publicavel.",
    motivo: "sem_imagem",
    erro: "",
    erroEm: "",
    imagem: "",
    imagemFinal: "",
    imagemRef: "",
    imagemEnviavel: false,
    progresso: { total: 3, enviados: 0, erros: 0, motivo: "sem_imagem" },
    destinosEstado: [
      { destinoId: "wa", nome: "WhatsApp", tipo: "whatsapp", estado: "sem_imagem", motivo: "sem_imagem" },
      { destinoId: "tg", nome: "Telegram", tipo: "telegram", estado: "sem_imagem", motivo: "sem_imagem" },
      { destinoId: "dc", nome: "Discord", tipo: "discord", estado: "sem_imagem", motivo: "sem_imagem" }
    ]
  };

  const readModel = construirReadModelPublicoPorMarcos({
    clienteId: "cliente_quality_gate",
    hot: [],
    historicoLeve: [{ id: "hist_sem_imagem", clienteId: "cliente_quality_gate", item }],
    projectionReady: true,
    agoraMs: agora,
    periodo: "7dias",
    visao: VISAO_COM_ERRO
  });

  assert.strictEqual(readModel.metricas.comErro, 1);
  assert.strictEqual(readModel.itens.length, 1);
  assert.strictEqual(readModel.itens[0].motivoErroPublico, "sem_imagem");
  assert.strictEqual(readModel.itens[0].statusPublico, "erro");
}

console.log("executor-imagem-quality-gate.test.js OK");
