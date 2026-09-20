"use strict";

const assert = require("assert");
const {
  VISAO_FILA,
  VISAO_PROCESSADAS,
  VISAO_ENVIADAS,
  VISAO_COM_ERRO,
  construirReadModelPublicoPorMarcos
} = require("../modules/fila/fila-read-model-publico");

const AGORA = Date.parse("2026-09-20T12:00:00.000Z");

function item(id, extra = {}) {
  return {
    id,
    clienteId: "cliente_resultado",
    marketplace: "mercadolivre",
    titulo: `Oferta ${id}`,
    precoAtual: 99.9,
    imagemFinal: `https://http2.mlstatic.com/${id}.jpg`,
    linkFinal: `https://produto.mercadolivre.com.br/MLB-${id}`,
    dataEntradaFila: new Date(AGORA - 60_000).toISOString(),
    finalizadoEm: new Date(AGORA - 30_000).toISOString(),
    status: "finalizado",
    ...extra
  };
}

function terminal(id, statusPublico, extra = {}) {
  const oferta = item(id, extra);
  return {
    chave: `chave_${id}`,
    clienteId: "cliente_resultado",
    id,
    statusPublico,
    statusOperacional: oferta.status,
    item: oferta
  };
}

function readModel({ hot = [], historicoLeve = [], visao = VISAO_PROCESSADAS } = {}) {
  return construirReadModelPublicoPorMarcos({
    clienteId: "cliente_resultado",
    hot,
    historicoLeve,
    visao,
    projectionReady: true,
    periodo: "7dias",
    agoraMs: AGORA
  });
}

{
  const enviada = terminal("100", "enviado", {
    status: "enviado",
    thumbnail: "https://http2.mlstatic.com/100-thumb.webp",
    destinosEstado: [
      { destinoId: "a", estado: "enviado" },
      { destinoId: "b", estado: "enviado" }
    ]
  });
  const processadas = readModel({ historicoLeve: [enviada] });
  assert.strictEqual(processadas.itens.length, 1);
  assert.strictEqual(processadas.itens[0].statusPublico, "enviada");
  assert.strictEqual(processadas.itens[0].resultadoResumo, "Enviado para 2 de 2 destinos");
  assert.strictEqual(processadas.itens[0].thumbRef, "https://http2.mlstatic.com/100-thumb.webp");
  assert.strictEqual(processadas.itens[0].imagemRef, "https://http2.mlstatic.com/100.jpg", "original continua disponivel no contrato existente");
}

{
  const semImagem = terminal("sem_imagem", "nao_enviado", {
    imagemFinal: "",
    imagemRef: "",
    imagem: "",
    image: "",
    motivo: "sem_imagem"
  });
  const processadas = readModel({ historicoLeve: [semImagem] });
  const erros = readModel({ historicoLeve: [semImagem], visao: VISAO_COM_ERRO });
  assert.strictEqual(processadas.itens.length, 0, "card sem imagem nao entra em Processadas");
  assert.strictEqual(erros.itens.length, 1);
  assert.strictEqual(erros.itens[0].motivoErroPublico, "sem_imagem");
  assert.strictEqual(erros.itens[0].erroPublico.titulo, "Imagem não resolvida");
  assert.strictEqual(erros.itens[0].erroPublico.codigo, "sem_imagem");
  assert.strictEqual(erros.itens[0].motivoPublico, "sem_imagem");
  assert(!JSON.stringify(erros.itens[0].erroPublico).includes("stack"));
}

{
  const semTitulo = terminal("sem_titulo", "nao_enviado", { titulo: "", motivo: "sem_titulo" });
  const erros = readModel({ historicoLeve: [semTitulo], visao: VISAO_COM_ERRO });
  assert.strictEqual(erros.itens[0].motivoErroPublico, "sem_titulo");
}

{
  const semDestino = terminal("sem_destino", "nao_enviado", {
    status: "expirada_operacional",
    motivo: "sem_destino_compativel",
    destinosEstado: []
  });
  const erros = readModel({ historicoLeve: [semDestino], visao: VISAO_COM_ERRO });
  const processadas = readModel({ historicoLeve: [semDestino] });
  assert.strictEqual(erros.itens.length, 0, "sem destino compativel nao e erro");
  assert.strictEqual(processadas.itens.length, 1, "conclusao operacional completa permanece no historico coerente");
  assert.strictEqual(processadas.itens[0].statusPublico, "nao_enviada");
}

{
  const aguardandoJanela = item("janela", {
    finalizadoEm: "",
    status: "retida",
    motivo: "janela_fechada"
  });
  const processadas = readModel({ hot: [aguardandoJanela] });
  const fila = readModel({ hot: [aguardandoJanela], visao: VISAO_FILA });
  const erros = readModel({ hot: [aguardandoJanela], visao: VISAO_COM_ERRO });
  assert.strictEqual(processadas.itens.length, 0);
  assert.strictEqual(erros.itens.length, 0);
  assert.strictEqual(fila.itens.length, 1);
  assert.strictEqual(fila.itens[0].statusPublico, "em_distribuicao");
}

{
  const parcialOperacional = terminal("parcial_operacional", "parcial", {
    status: "expirada_operacional",
    motivo: "ttl_operacional_flow",
    destinosEstado: [
      { destinoId: "enviado", estado: "enviado" },
      { destinoId: "intervalo", estado: "aguardando_intervalo" },
      { destinoId: "incompativel", estado: "nao_compativel" }
    ]
  });
  const processadas = readModel({ historicoLeve: [parcialOperacional] });
  const enviadas = readModel({ historicoLeve: [parcialOperacional], visao: VISAO_ENVIADAS });
  const erros = readModel({ historicoLeve: [parcialOperacional], visao: VISAO_COM_ERRO });
  assert.strictEqual(processadas.itens.length, 1);
  assert.strictEqual(enviadas.itens.length, 1);
  assert.strictEqual(enviadas.itens[0].resultadoResumo, "Enviado para 1 de 3 destinos");
  assert.strictEqual(erros.itens.length, 0, "parcial operacional nao vira erro automatico");
}

{
  const falhaSender = terminal("falha_sender", "nao_enviado", {
    motivo: "falha_sender",
    destinosEstado: [{ destinoId: "a", estado: "erro_final", tentativas: 1 }]
  });
  const erros = readModel({ historicoLeve: [falhaSender], visao: VISAO_COM_ERRO });
  assert.strictEqual(erros.itens.length, 1);
  assert.strictEqual(erros.itens[0].motivoErroPublico, "falha_envio");
}

{
  const semThumb = terminal("sem_thumb", "enviado", {
    status: "enviado",
    destinosEstado: [{ destinoId: "a", estado: "enviado" }]
  });
  const processadas = readModel({ historicoLeve: [semThumb] });
  assert.strictEqual(processadas.itens[0].thumbRef, "", "thumbnail nunca cai silenciosamente para a imagem original gigante");
  assert.notStrictEqual(processadas.itens[0].imagemRef, "");
}

console.log("fila-read-model-publico-resultado.test.js OK");
