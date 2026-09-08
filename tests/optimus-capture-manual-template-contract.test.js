const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-capture-manual-template-"));

const storage = require("../modules/manual-v2/manual-offers.storage");
const { criarTemplate } = require("../modules/templates-clientes/service");
const { montarMensagemOferta } = require("../utils/mensagens-ofertas");
const { enviarOfertaManualV2 } = require("../modules/manual-v2/manual-dispatcher");
const { processarOfertaAgendadaManualV2, limparLocksMemoriaManualV2 } = require("../modules/manual-v2/manual-scheduler");

const CLIENTE_ID = "cliente_optimus_capture_template";
const NOW = "2026-09-08T15:00:00.000Z";

function criarOfertaCapture(id, extra = {}) {
  return storage.criarOfertaManualV2(CLIENTE_ID, {
    id,
    marketplace: "amazon",
    titulo: "Produto capturado pelo Optimus Capture",
    precoAtual: "99,90",
    precoAnterior: "149,90",
    urlOriginal: "https://www.amazon.com.br/dp/B0CTTVR415",
    urlAfiliada: "https://www.amazon.com.br/dp/B0CTTVR415?tag=workspace-20",
    imagem: "https://images.example/produto.jpg",
    fonteImportacao: {
      adapter: "optimus_capture_v1",
      parseOnly: true
    },
    ...extra
  }, {
    now: () => NOW,
    idFactory: () => id
  });
}

function criarDestino(templateId) {
  return {
    id: "destino_capture",
    nome: "Grupo Capture",
    tipo: "whatsapp",
    ativo: true,
    conexaoId: "sessao_capture",
    gruposWhatsapp: ["120363000000@g.us"],
    templateId
  };
}

function depsEnvio(destino, mensagens) {
  return {
    buscarOfertaManualV2: storage.buscarOfertaManualV2,
    destinosPorCliente: { [CLIENTE_ID]: [destino] },
    sessoes: { sessao_capture: { id: "sock_capture" } },
    statusSessao: { sessao_capture: "open" },
    plano: { recursos: { whatsapp: true, templatePersonalizado: true } },
    usuarioTemCreditos: () => true,
    debitarCreditos: () => true,
    montarMensagemOferta,
    enviarWhatsApp: async ({ mensagem }) => mensagens.push(mensagem),
    now: () => NOW
  };
}

(async function main() {
  const template = criarTemplate(CLIENTE_ID, {
    nome: "Template Capture",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "titulo", ativo: true, ordem: 10 },
      { tipo: "preco_por", ativo: true, ordem: 20 },
      { tipo: "link", ativo: true, ordem: 30 }
    ],
    rodape: { ativo: true, texto: "MARCADOR TEMPLATE CAPTURE" }
  }).template;

  const ofertaImediata = criarOfertaCapture("capture_imediata");
  assert.strictEqual(ofertaImediata.fonteImportacao.adapter, "optimus_capture_v1");

  const mensagensPersonalizadas = [];
  const retornoImediato = await enviarOfertaManualV2({
    clienteId: CLIENTE_ID,
    ofertaId: ofertaImediata.id,
    destinosIds: ["destino_capture"]
  }, depsEnvio(criarDestino(template.id), mensagensPersonalizadas));

  assert.strictEqual(retornoImediato.ok, true);
  assert.strictEqual(mensagensPersonalizadas.length, 1);
  assert.ok(mensagensPersonalizadas[0].includes("MARCADOR TEMPLATE CAPTURE"), "Capture deve usar o Template Personalizado oficial quando o destino o seleciona");

  const mensagensUniversais = [];
  const retornoUniversal = await enviarOfertaManualV2({
    clienteId: CLIENTE_ID,
    ofertaId: ofertaImediata.id,
    destinosIds: ["destino_capture"]
  }, depsEnvio(criarDestino("padrao_optimus"), mensagensUniversais));

  assert.strictEqual(retornoUniversal.ok, true);
  assert.strictEqual(mensagensUniversais.length, 1);
  assert.ok(mensagensUniversais[0].includes("Produto capturado pelo Optimus Capture"));
  assert.ok(!mensagensUniversais[0].includes("MARCADOR TEMPLATE CAPTURE"), "Template padrao deve manter o fallback Universal oficial");

  const ofertaAgendada = criarOfertaCapture("capture_agendada");
  storage.marcarOfertaManualV2Agendada(CLIENTE_ID, ofertaAgendada.id, {
    agendadoPara: "2026-09-08T14:59:00.000Z",
    agendamentoLocal: "2026-09-08T11:59",
    agendamentoTimezone: "America/Sao_Paulo",
    destinosIds: ["destino_capture"],
    destinosAgendados: [{ id: "destino_capture", nome: "Grupo Capture", tipo: "whatsapp", ativo: true, utilizavel: true }]
  }, { now: () => NOW });

  limparLocksMemoriaManualV2();
  const mensagensAgendadas = [];
  const retornoAgendado = await processarOfertaAgendadaManualV2({
    clienteId: CLIENTE_ID,
    ofertaId: ofertaAgendada.id
  }, {
    ...depsEnvio(criarDestino(template.id), mensagensAgendadas),
    storageOptions: { now: () => NOW },
    enviarOfertaManualV2
  });

  assert.strictEqual(retornoAgendado.ok, true);
  assert.strictEqual(mensagensAgendadas.length, 1);
  assert.ok(mensagensAgendadas[0].includes("MARCADOR TEMPLATE CAPTURE"), "Scheduler deve usar o mesmo enviarOfertaManualV2 e o mesmo Template oficial");

  const fonteDispatcher = fs.readFileSync(path.join(__dirname, "..", "modules", "manual-v2", "manual-dispatcher.js"), "utf8");
  assert.ok(fonteDispatcher.includes("deps.montarMensagemOferta(entradaTemplate"));
  assert.ok(!fonteDispatcher.includes("OptimusCapture"), "Dispatcher nao pode possuir renderer textual proprio da extensao");

  console.log("optimus-capture-manual-template-contract.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
