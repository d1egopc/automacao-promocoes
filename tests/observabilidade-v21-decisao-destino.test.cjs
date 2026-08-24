const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  TIPOS_EVENTO_COMERCIAL,
  metadataSanitizada,
  normalizarEventoComercial,
  normalizarMotivoDestino,
  registrarDecisaoDestinoComercial
} = require("../modules/engine/ofc/commercial-events.service");

const ofertaBase = {
  id: "fila_123",
  engineEventoId: 191459,
  engineOfertaId: 987,
  engineJobId: 654,
  marketplace: "MercadoLivre",
  categoria: "Diversos",
  cookie: "nao_deve_persistir",
  token: "nao_deve_persistir",
  payload: { bruto: true }
};

const destinoBase = {
  id: "destino_wolff",
  tipo: "whatsapp",
  nome: "WOLFF Ofertas",
  categoria: "Diversos",
  cookie: "nao_deve_persistir",
  token: "nao_deve_persistir",
  headers: { authorization: "Bearer segredo" }
};

async function capturarDecisao(payload) {
  const eventos = [];
  const resultado = await registrarDecisaoDestinoComercial({
    clienteId: "user_d1egopc",
    oferta: ofertaBase,
    destino: destinoBase,
    repositorio: async evento => {
      eventos.push(evento);
      return { ok: true, inserido: true, id: eventos.length };
    },
    ...payload
  });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(eventos.length, 1);
  return eventos[0];
}

(async () => {
  assert.strictEqual(TIPOS_EVENTO_COMERCIAL.DESTINO_CANDIDATO, "destino_candidato");
  assert.strictEqual(TIPOS_EVENTO_COMERCIAL.DESTINO_SELECIONADO, "destino_selecionado");
  assert.strictEqual(TIPOS_EVENTO_COMERCIAL.DESTINO_REJEITADO, "destino_rejeitado");

  assert.strictEqual(normalizarMotivoDestino("marketplace"), "marketplace_nao_permitido");
  assert.strictEqual(normalizarMotivoDestino("categoria"), "categoria_nao_permitida");
  assert.strictEqual(normalizarMotivoDestino("fora_horario"), "fora_janela");
  assert.strictEqual(normalizarMotivoDestino("intervalo"), "cooldown");
  assert.strictEqual(normalizarMotivoDestino("limite_diario"), "max_dia");
  assert.strictEqual(normalizarMotivoDestino("sessao_indisponivel"), "sessao_offline");
  assert.strictEqual(normalizarMotivoDestino("motivo_sem_prova"), "nao_determinado");

  const candidato = await capturarDecisao({
    decisao: "candidato",
    motivo: "destino_compativel",
    marketplacePermitido: true,
    destinosTotal: 3,
    destinosCompativeis: 2
  });
  assert.strictEqual(candidato.tipoEvento, "destino_candidato");
  assert.strictEqual(candidato.clienteId, "user_d1egopc");
  assert.strictEqual(candidato.workspaceId, "user_d1egopc");
  assert.strictEqual(candidato.ofertaId, 987);
  assert.strictEqual(candidato.jobId, 654);
  assert.strictEqual(candidato.filaItemId, "fila_123");
  assert.strictEqual(candidato.destinoId, "destino_wolff");
  assert.strictEqual(candidato.canal, "whatsapp");
  assert.strictEqual(candidato.marketplace, "mercadolivre");
  assert.strictEqual(candidato.metadata.eventoId, 191459);
  assert.strictEqual(candidato.metadata.decisao, "candidato");
  assert.strictEqual(candidato.metadata.motivoCodigo, "destino_compativel");
  assert.strictEqual(candidato.metadata.categoriaOferta, "Diversos");
  assert.strictEqual(candidato.metadata.categoriaDestino, "Diversos");
  assert.strictEqual(candidato.metadata.marketplacePermitido, true);
  assert.strictEqual(candidato.metadata.destinoNomeSanitizado, "WOLFF Ofertas");
  assert.strictEqual(candidato.metadata.observabilidadeVersao, "v2.1");

  const selecionado = await capturarDecisao({
    decisao: "selecionado",
    motivo: "destino_liberado",
    dentroJanela: true,
    cooldownAtivo: false,
    maxDiaAtingido: false,
    selecionadoEm: "2026-08-24T20:00:00.000Z"
  });
  assert.strictEqual(selecionado.tipoEvento, "destino_selecionado");
  assert.strictEqual(selecionado.metadata.dentroJanela, true);
  assert.strictEqual(selecionado.metadata.cooldownAtivo, false);
  assert.strictEqual(selecionado.metadata.maxDiaAtingido, false);
  assert.strictEqual(selecionado.metadata.selecionadoEm, "2026-08-24T20:00:00.000Z");

  const rejeitadoMarketplace = await capturarDecisao({
    decisao: "rejeitado",
    motivo: "marketplace",
    marketplacePermitido: false
  });
  assert.strictEqual(rejeitadoMarketplace.tipoEvento, "destino_rejeitado");
  assert.strictEqual(rejeitadoMarketplace.metadata.motivoCodigo, "marketplace_nao_permitido");
  assert.strictEqual(rejeitadoMarketplace.metadata.marketplacePermitido, false);

  const rejeitadoCategoria = await capturarDecisao({
    decisao: "rejeitado",
    motivo: "categoria"
  });
  assert.strictEqual(rejeitadoCategoria.metadata.motivoCodigo, "categoria_nao_permitida");

  const rejeitadoSessao = await capturarDecisao({
    decisao: "rejeitado",
    motivo: "sessao_indisponivel",
    sessaoStatus: "closed"
  });
  assert.strictEqual(rejeitadoSessao.metadata.motivoCodigo, "sessao_offline");
  assert.strictEqual(rejeitadoSessao.metadata.sessaoStatus, "closed");

  const rejeitadoDesconhecido = await capturarDecisao({
    decisao: "rejeitado",
    motivo: "motivo_sem_prova"
  });
  assert.strictEqual(rejeitadoDesconhecido.metadata.motivoCodigo, "nao_determinado");

  const jsonEvento = JSON.stringify(rejeitadoDesconhecido);
  assert.strictEqual(jsonEvento.includes("nao_deve_persistir"), false);
  assert.strictEqual(jsonEvento.includes("authorization"), false);
  assert.strictEqual(jsonEvento.includes("Bearer segredo"), false);
  assert.strictEqual(jsonEvento.includes("bruto"), false);

  const metadata = metadataSanitizada({
    decisao: "rejeitado",
    motivoCodigo: "categoria_nao_permitida",
    eventoId: 191459,
    destinoNomeSanitizado: "D1EGOPC OFERTAS",
    cookie: "segredo",
    accessToken: "segredo",
    payload: { textoCompleto: "nao" },
    html: "<html></html>"
  });
  assert.deepStrictEqual(metadata, {
    decisao: "rejeitado",
    motivoCodigo: "categoria_nao_permitida",
    eventoId: 191459,
    destinoNomeSanitizado: "D1EGOPC OFERTAS"
  });

  const falha = await registrarDecisaoDestinoComercial({
    clienteId: "user_d1egopc",
    oferta: ofertaBase,
    destino: destinoBase,
    decisao: "rejeitado",
    motivo: "categoria",
    repositorio: async () => ({ ok: false, motivo: "db_timeout", erro: "timeout" })
  });
  assert.strictEqual(falha.ok, false);
  assert.strictEqual(falha.motivo, "db_timeout");

  const decisaoInvalida = await registrarDecisaoDestinoComercial({
    clienteId: "user_d1egopc",
    oferta: ofertaBase,
    destino: destinoBase,
    decisao: "ignorada"
  });
  assert.strictEqual(decisaoInvalida.ok, false);
  assert.strictEqual(decisaoInvalida.motivo, "decisao_destino_invalida");

  const eventoNormalizado = normalizarEventoComercial({
    tipoEvento: "destino_rejeitado",
    clienteId: "user_d1egopc",
    ofertaId: 987,
    jobId: 654,
    destinoId: "destino_wolff",
    marketplace: "MercadoLivre",
    metadata: {
      decisao: "rejeitado",
      motivoCodigo: "categoria_nao_permitida",
      cookie: "segredo"
    }
  });
  assert.strictEqual(eventoNormalizado.tipoEvento, "destino_rejeitado");
  assert.strictEqual(eventoNormalizado.metadata.cookie, undefined);
  assert.ok(eventoNormalizado.chaveIdempotencia.includes("destino_rejeitado"));

  const raiz = path.join(__dirname, "..");
  const indexFonte = fs.readFileSync(path.join(raiz, "index.js"), "utf8");
  assert.ok(indexFonte.includes("registrarDecisaoDestinoObservabilidade(\"candidato\""));
  assert.ok(indexFonte.includes("registrarDecisaoDestinoObservabilidade(\"selecionado\""));
  assert.ok(indexFonte.includes("registrarDecisaoDestinoObservabilidade(\"rejeitado\""));
  assert.ok(indexFonte.includes("void registrarDecisaoDestinoObservabilidade"));
  assert.ok(!/await\s+registrarDecisaoDestinoObservabilidade/.test(indexFonte));

  const telemetriaFonte = fs.readFileSync(path.join(raiz, "modules", "telemetria", "telemetria.service.js"), "utf8");
  assert.ok(telemetriaFonte.includes("engine_eventos_comerciais"), "/telemetria/eventos continua lendo eventos comerciais");
  assert.ok(telemetriaFonte.includes("eventosComerciais"), "/telemetria/rastrear continua retornando eventos comerciais");
  assert.ok(telemetriaFonte.includes("sanitizarValor"), "rastreio continua sanitizando metadata");

  console.log("observabilidade-v21-decisao-destino.test.cjs OK");
})().catch(e => {
  console.error(e);
  process.exit(1);
});
