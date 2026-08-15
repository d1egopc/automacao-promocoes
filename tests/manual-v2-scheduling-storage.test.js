const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-scheduling-"));

const {
  getClienteJsonPath
} = require("../utils/storage");
const {
  ARQUIVO_OFERTAS_MANUAL_V2,
  criarOfertaManualV2,
  buscarOfertaManualV2,
  listarOfertasManuaisV2,
  atualizarMetadadosEnvioManualV2,
  marcarOfertaManualV2Agendada,
  reprogramarOfertaManualV2Agendada,
  cancelarAgendamentoOfertaManualV2
} = require("../modules/manual-v2/manual-offers.storage");

let tick = 0;
function now() {
  tick += 1;
  return `2026-08-15T12:00:${String(tick).padStart(2, "0")}.000Z`;
}

function idFactory() {
  return `manual_v2_agenda_${tick + 1}`;
}

function destinoSeguro(extra = {}) {
  return {
    id: "destino_wa",
    nome: "Grupo Ofertas",
    tipo: "whatsapp",
    ativo: true,
    utilizavel: true,
    identificacaoVisual: "Ofertas VIP",
    token: "token_nao_pode_sair",
    botToken: "bot_token_nao_pode_sair",
    chatId: "chat_id_nao_pode_sair",
    secret: "secret_nao_pode_sair",
    cookie: "cookie_nao_pode_sair",
    ...extra
  };
}

const ofertaA = criarOfertaManualV2("cliente_agenda_a", {
  marketplace: "Amazon",
  titulo: "Oferta agendavel",
  urlOriginal: "https://amazon.com.br/produto"
}, { now, idFactory });

{
  const agendada = marcarOfertaManualV2Agendada("cliente_agenda_a", ofertaA.id, {
    agendadoPara: "2026-08-16T17:30:00.000Z",
    agendamentoLocal: "2026-08-16T14:30",
    agendamentoTimezone: "America/Sao_Paulo",
    destinosIds: ["destino_wa"],
    destinosAgendados: [destinoSeguro()]
  }, { now });

  assert.strictEqual(agendada.status, "agendada");
  assert.strictEqual(agendada.criadoEm, ofertaA.criadoEm, "agendamento preserva criadoEm da oferta");
  assert.strictEqual(agendada.atualizadoEm, "2026-08-15T12:00:02.000Z");
  assert.strictEqual(agendada.agendadoPara, "2026-08-16T17:30:00.000Z");
  assert.strictEqual(agendada.agendamentoLocal, "2026-08-16T14:30");
  assert.strictEqual(agendada.agendamentoTimezone, "America/Sao_Paulo");
  assert.strictEqual(agendada.agendamentoCriadoEm, "2026-08-15T12:00:02.000Z");
  assert.strictEqual(agendada.agendamentoAtualizadoEm, "2026-08-15T12:00:02.000Z");
  assert.deepStrictEqual(agendada.destinosIds, ["destino_wa"]);
  assert.deepStrictEqual(Object.keys(agendada.destinosAgendados[0]).sort(), [
    "ativo",
    "id",
    "identificacaoVisual",
    "motivoIndisponivel",
    "nome",
    "tipo",
    "utilizavel"
  ].sort());
  assert.strictEqual(JSON.stringify(agendada.destinosAgendados).includes("token_nao_pode_sair"), false);
  assert.strictEqual(JSON.stringify(agendada.destinosAgendados).includes("chat_id_nao_pode_sair"), false);
  assert.strictEqual(JSON.stringify(agendada.destinosAgendados).includes("secret_nao_pode_sair"), false);
}

{
  const reprogramada = reprogramarOfertaManualV2Agendada("cliente_agenda_a", ofertaA.id, {
    agendadoPara: "2026-08-17T18:45:00-03:00",
    agendamentoLocal: "2026-08-17T18:45",
    agendamentoTimezone: "America/Sao_Paulo",
    destinosIds: ["destino_tg"],
    destinosAgendados: [destinoSeguro({
      id: "destino_tg",
      nome: "Canal Telegram",
      tipo: "telegram",
      identificacaoVisual: "Canal Telegram"
    })]
  }, { now });

  assert.strictEqual(reprogramada.status, "agendada");
  assert.strictEqual(reprogramada.agendadoPara, "2026-08-17T21:45:00.000Z", "offset vira instante UTC inequivoco");
  assert.strictEqual(reprogramada.agendamentoLocal, "2026-08-17T18:45");
  assert.deepStrictEqual(reprogramada.destinosIds, ["destino_tg"]);
  assert.strictEqual(reprogramada.destinosAgendados[0].tipo, "telegram");
  assert.strictEqual(reprogramada.agendamentoCriadoEm, "2026-08-15T12:00:02.000Z", "reprogramar preserva criacao do agendamento");
  assert.strictEqual(reprogramada.agendamentoAtualizadoEm, "2026-08-15T12:00:03.000Z");
  assert.strictEqual(reprogramada.agendamentoLockId || "", "", "reprogramar limpa lock");
  assert.strictEqual(reprogramada.agendamentoLockEm || "", "", "reprogramar limpa timestamp de lock");
}

{
  const antes = buscarOfertaManualV2("cliente_agenda_a", ofertaA.id);
  const cancelada = cancelarAgendamentoOfertaManualV2("cliente_agenda_a", ofertaA.id, { now });

  assert.strictEqual(cancelada.status, "salva");
  assert.strictEqual(cancelada.criadoEm, antes.criadoEm);
  assert.strictEqual(cancelada.atualizadoEm, "2026-08-15T12:00:04.000Z");
  assert.strictEqual(cancelada.agendadoPara, "");
  assert.strictEqual(cancelada.agendamentoLocal, "");
  assert.strictEqual(cancelada.agendamentoCanceladoEm, "2026-08-15T12:00:04.000Z");
  assert.deepStrictEqual(cancelada.destinosIds, []);
  assert.deepStrictEqual(cancelada.destinosAgendados, []);
  assert.strictEqual(cancelada.agendamentoLockId || "", "");
  assert.strictEqual(cancelada.agendamentoLockEm || "", "");
}

{
  const ofertaB = criarOfertaManualV2("cliente_agenda_b", {
    marketplace: "Shopee",
    titulo: "Oferta de outro cliente"
  }, { now, idFactory });

  assert.strictEqual(marcarOfertaManualV2Agendada("cliente_agenda_b", ofertaA.id, {
    agendadoPara: "2026-08-16T17:30:00.000Z",
    destinosIds: ["destino_wa"]
  }, { now }), null, "cliente B nao agenda oferta A");
  assert.strictEqual(buscarOfertaManualV2("cliente_agenda_a", ofertaB.id), null, "cliente A nao le oferta B");
  assert.strictEqual(listarOfertasManuaisV2("cliente_agenda_a").length, 1);
  assert.strictEqual(listarOfertasManuaisV2("cliente_agenda_b").length, 1);
}

{
  const ofertaEnviando = criarOfertaManualV2("cliente_bloqueio", {
    titulo: "Em envio"
  }, { now, idFactory });
  atualizarMetadadosEnvioManualV2("cliente_bloqueio", ofertaEnviando.id, { status: "enviando" }, { now });

  assert.throws(
    () => marcarOfertaManualV2Agendada("cliente_bloqueio", ofertaEnviando.id, {
      agendadoPara: "2026-08-16T17:30:00.000Z",
      destinosIds: ["destino_wa"]
    }, { now }),
    /oferta_manual_v2_agendamento_status_bloqueado/
  );

  const ofertaEnviada = criarOfertaManualV2("cliente_bloqueio", {
    titulo: "Ja enviada"
  }, { now, idFactory });
  atualizarMetadadosEnvioManualV2("cliente_bloqueio", ofertaEnviada.id, { status: "enviada" }, { now });

  assert.throws(
    () => cancelarAgendamentoOfertaManualV2("cliente_bloqueio", ofertaEnviada.id, { now }),
    /oferta_manual_v2_agendamento_status_bloqueado/
  );
}

{
  const arquivoManual = getClienteJsonPath("cliente_agenda_a", ARQUIVO_OFERTAS_MANUAL_V2);
  const arquivoFila = getClienteJsonPath("cliente_agenda_a", "fila.json");
  assert.ok(fs.existsSync(arquivoManual), "agendamento usa storage Manual V2");
  assert.strictEqual(fs.existsSync(arquivoFila), false, "agendamento Manual V2 nao cria fila.json");
}

{
  const fonteStorage = fs.readFileSync(
    path.join(__dirname, "..", "modules", "manual-v2", "manual-offers.storage.js"),
    "utf8"
  );
  const fonteContract = fs.readFileSync(
    path.join(__dirname, "..", "modules", "manual-v2", "manual-offers.contract.js"),
    "utf8"
  );
  const proibidos = [
    "utils/fila-ofertas",
    "processarFila",
    "prepararOfertaGlobal",
    "adicionarOfertaInicioFila",
    "Distributor",
    "Oferta Universal",
    "oferta-universal",
    "inteligencia-universal",
    "memoria-ofertas",
    "radar-ofertas",
    "/fila",
    "/enviar-manual"
  ];

  for (const termo of proibidos) {
    assert.ok(!fonteStorage.includes(termo), `storage Manual V2 nao pode referenciar ${termo}`);
    assert.ok(!fonteContract.includes(termo), `contrato Manual V2 nao pode referenciar ${termo}`);
  }
}

console.log("manual-v2-scheduling-storage.test.js ok");
