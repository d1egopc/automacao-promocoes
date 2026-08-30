"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const filaOfertas = require("../utils/fila-ofertas");

const indexPath = path.join(__dirname, "..", "index.js");
const fonteIndex = fs.readFileSync(indexPath, "utf8");
const distributorPath = path.join(__dirname, "..", "modules", "engine", "distributor", "distributor.service.js");
const fonteDistributor = fs.readFileSync(distributorPath, "utf8");

function trechoEntre(inicio, fim) {
  const a = fonteIndex.indexOf(inicio);
  const b = fonteIndex.indexOf(fim, a + inicio.length);
  assert(a >= 0, `inicio nao encontrado: ${inicio}`);
  assert(b > a, `fim nao encontrado apos ${inicio}: ${fim}`);
  return fonteIndex.slice(a, b);
}

function pos(texto, busca) {
  const indice = texto.indexOf(busca);
  assert(indice >= 0, `trecho nao encontrado: ${busca}`);
  return indice;
}

const processarFila = trechoEntre(
  "async function processarFila",
  "const {"
);

assert(
  pos(processarFila, "await reconciliarFilaV2ParaLeituraCliente(clienteFila, \"executor\");") <
    pos(processarFila, "sanearExpiradosFila(clienteFila)"),
  "executor deve reconciliar a fila oficial antes de sanear expirados"
);

assert(
  pos(processarFila, "await reconciliarFilaV2ParaLeituraCliente(clienteFila, \"executor\");") <
    pos(processarFila, "selecionarProximaOfertaFila(clienteFila)"),
  "executor deve reconciliar a fila oficial antes de selecionar pendente"
);

const reconciliarExecutor = trechoEntre(
  "async function reconciliarFilaV2ParaLeituraCliente",
  "function sanearDuplicatasPendentesFilaCliente"
);

assert(
  pos(reconciliarExecutor, "contextoTexto === \"executor\"") <
    pos(reconciliarExecutor, "carregarFilaLegadaOficial(clienteId)"),
  "executor deve avaliar o preflight V2 antes de ler a fila legada"
);

assert(
  pos(reconciliarExecutor, "await filaOperacionalV2.reconciliarFilaV2ParaLeitura(cliente, {") <
    pos(reconciliarExecutor, "carregarFilaLegadaOficial(clienteId)"),
  "preflight generation do executor deve acontecer antes do parse de fila.json"
);

assert(
  reconciliarExecutor.includes("aplicarFastPathExecutorFilaViva(cliente, decisaoPreflightExecutor)"),
  "generation conclusiva deve usar a fila viva no fast path do executor"
);

assert(
  reconciliarExecutor.includes("decisaoPreflightExecutor ||") &&
    pos(reconciliarExecutor, "decisaoPreflightExecutor ||") > pos(reconciliarExecutor, "carregarFilaLegadaOficial(clienteId)"),
  "fallback legado deve reutilizar o preflight e nao reconciliar duas vezes no mesmo ciclo"
);

assert(
  reconciliarExecutor.includes("bytesFilaJsonLidos: 0") &&
    reconciliarExecutor.includes("executor_v2_legacy_fallback"),
  "fast path e fallback devem registrar que o preflight nao leu payload de fila.json"
);

const fastPathExecutor = trechoEntre(
  "function aplicarFastPathExecutorFilaViva",
  "function salvarFila"
);

assert(
  fastPathExecutor.includes("lerFilaVivaParaMerge") &&
    !fastPathExecutor.includes("carregarFilaLegadaOficial") &&
    !fastPathExecutor.includes("filaOfertas.carregarFila"),
  "fast path do executor deve carregar somente fila-viva, sem chamar loader legado"
);

assert(
  fastPathExecutor.includes("filaClienteHotState") &&
    fastPathExecutor.includes("hotState: true") &&
    fastPathExecutor.includes("pendentes"),
  "fast path deve materializar hot state por cliente, incluindo caso de zero pendentes"
);

const logWriteLegadoFila = trechoEntre(
  "function logWriteLegadoFila",
  "function logFilaV22C"
);

assert(
  logWriteLegadoFila.includes("[FILA-LEGACY-WRITE]") &&
    logWriteLegadoFila.includes("clienteId: cliente") &&
    logWriteLegadoFila.includes("origem: normalizarOrigemWriteLegadoFila(opcoes)") &&
    logWriteLegadoFila.includes("arquivo: \"fila.json\"") &&
    logWriteLegadoFila.includes("bytes: stat ? stat.size : null") &&
    logWriteLegadoFila.includes("tempoMs:") &&
    logWriteLegadoFila.includes("v2Operacional") &&
    logWriteLegadoFila.includes("recoveryAuthority") &&
    logWriteLegadoFila.includes("vivaGeneration") &&
    logWriteLegadoFila.includes("durableCheckpointGeneration") &&
    logWriteLegadoFila.includes("dirtyGeneration"),
  "write legado deve emitir telemetria central barata com cliente, origem, arquivo, bytes, tempo, V2 e generations observaveis"
);

assert(
  logWriteLegadoFila.includes("fs.statSync(caminho)") &&
    !logWriteLegadoFila.includes("manifestStateRepository") &&
    !logWriteLegadoFila.includes("queryEngine") &&
    !logWriteLegadoFila.includes("await ") &&
    !logWriteLegadoFila.includes("publicarProof") &&
    !logWriteLegadoFila.includes("confirmarCheckpoint"),
  "telemetria de write legado deve usar apenas stat O(1), sem query PG, proof, checkpoint ou payload"
);

const salvarFilaCentral = trechoEntre(
  "function salvarFila",
  "function checkpointRevisionSeguro"
);

assert(
  pos(salvarFilaCentral, "const salvou = filaOfertas.salvarFila({") <
    pos(salvarFilaCentral, "logWriteLegadoFila(clienteId, opcoes, {") &&
    pos(salvarFilaCentral, "logWriteLegadoFila(clienteId, opcoes, {") <
    pos(salvarFilaCentral, "registrarRewriteLegadoSemProofV2(clienteId, motivo, opcoes);"),
  "telemetria deve rodar somente depois do write legado bem-sucedido e antes da invalidacao diagnostica existente"
);

assert(
  ["checkpoint_b1", "executor", "expiracao", "saneamento", "boot", "radar", "importador", "rota_manual", "enviar_agora", "distributor_fallback", "engine_fallback"]
    .every(origem => fonteIndex.includes(`origem: "${origem}"`) || fonteIndex.includes(`return "${origem}"`)),
  "call sites instrumentados devem distinguir as origens principais sem stack trace"
);

const salvarFilaClienteDistributor = (() => {
  const inicio = fonteDistributor.indexOf("function salvarFilaCliente");
  const fim = fonteDistributor.indexOf("function obterDestinosCliente", inicio);
  assert(inicio >= 0 && fim > inicio, "salvarFilaCliente do distributor deve existir");
  return fonteDistributor.slice(inicio, fim);
})();

assert(
  salvarFilaClienteDistributor.includes("[FILA-LEGACY-WRITE]") &&
    salvarFilaClienteDistributor.includes("origem: \"distributor_fallback\"") &&
    salvarFilaClienteDistributor.includes("caller: \"modules_engine_distributor_salvarFilaCliente\"") &&
    salvarFilaClienteDistributor.includes("vivaGeneration: null") &&
    !salvarFilaClienteDistributor.includes("publicarProof") &&
    !salvarFilaClienteDistributor.includes("confirmarCheckpoint"),
  "fallback direto do distributor deve logar write legado sem participar de proof/generation"
);

const puloRapidoV2 = trechoEntre(
  "async function reconciliarPuloRapidoFilaV2",
  "async function rodarProcessadorFilaGlobal"
);

assert(
    puloRapidoV2.includes("puloRapido?.motivo !== \"sem_pendentes\"") &&
    puloRapidoV2.includes("enviandoAgoraPorCliente[cliente]") &&
    puloRapidoV2.includes("process.env.FILA_V2_RECOVERY_AUTORIDADE") &&
    puloRapidoV2.includes("!== \"generation\"") &&
    puloRapidoV2.includes("!filaOperacionalV2.deveUsarFilaV2Operacional(cliente)"),
  "preflight do pulo rapido deve ser restrito a sem_pendentes V2 com authority generation"
);

assert(
  pos(puloRapidoV2, "await reconciliarFilaV2ParaLeituraCliente(cliente, \"executor\");") <
    pos(puloRapidoV2, "pendentes = fila.filter"),
  "runner deve reconciliar hot state V2 antes de confirmar sem_pendentes"
);

assert(
  puloRapidoV2.includes("executor_v2_fast_skip_sem_pendentes") &&
    puloRapidoV2.includes("bytesFilaJsonLidos: 0"),
  "sem_pendentes conclusivo em V2 deve registrar fast skip sem ler fila.json"
);

const runnerGlobal = trechoEntre(
  "async function rodarProcessadorFilaGlobal",
  "setInterval(() =>"
);

assert(
  pos(runnerGlobal, "const puloRapido = avaliarPuloRapidoClienteFila(usuario);") <
    pos(runnerGlobal, "await reconciliarPuloRapidoFilaV2(clienteId, puloRapido);") &&
    pos(runnerGlobal, "await reconciliarPuloRapidoFilaV2(clienteId, puloRapido);") <
    pos(runnerGlobal, "logProcessarFilaResumo({"),
  "runner real deve executar a fronteira V2 antes de registrar o pulo rapido sem_pendentes"
);

assert(
  runnerGlobal.includes("await processarFila(clienteId, { reconciliacaoFilaV2: puloV2.reconciliacao });"),
  "runner real deve encaminhar pendentes V2 ao executor reutilizando o preflight do mesmo ciclo"
);

assert(
  processarFila.includes("reconciliacaoPreviaFilaV2") &&
    processarFila.includes("resumoFila.reconciliacaoFilaV2Reutilizada = true") &&
    processarFila.includes("await reconciliarFilaV2ParaLeituraCliente(clienteFila, \"executor\");"),
  "processarFila deve reutilizar o preflight recebido do runner e evitar segunda reconciliacao"
);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-fila-unica-"));
const dataDirAnterior = process.env.DATA_DIR;
process.env.DATA_DIR = root;

const logger = { log() {}, error() {} };
const wolff = "user_wolff";
const controle = "user_controle";

function getFilaFile(clienteId = "admin") {
  return path.join(root, "clientes", String(clienteId || "admin"), "fila.json");
}

function criarItem(clienteId, id, overrides = {}) {
  return {
    id,
    ofertaId: id,
    engineOfertaId: id,
    clienteId,
    marketplace: "mercadolivre",
    titulo: `Oferta ${id}`,
    preco: 153,
    precoAtual: 153,
    linkOriginal: `https://produto.mercadolivre.com.br/${id}`,
    linkAfiliado: `https://mercadolivre.com.br/${id}?aff=1`,
    destinoId: `destino_${clienteId}`,
    status: "pendente",
    criadoEm: "08/08/2026, 15:01:14",
    dataEntradaFila: "2026-08-08T18:01:14.000Z",
    ...overrides
  };
}

function salvarOficial(clienteId, itens) {
  fs.mkdirSync(path.dirname(getFilaFile(clienteId)), { recursive: true });
  const ok = filaOfertas.salvarFila({
    fila: itens,
    clienteId,
    getFilaFile,
    logger
  });
  assert.strictEqual(ok, true, `fila oficial deve salvar para ${clienteId}`);
}

function lerOficial(clienteId) {
  const file = getFilaFile(clienteId);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function carregarOficial(cache, clienteId) {
  return filaOfertas.carregarFila({
    fila: cache,
    clienteId,
    getFilaFile,
    logger
  });
}

function pendentes(cache, clienteId) {
  return cache.filter(
    item => String(item.clienteId || "admin") === String(clienteId) && item.status === "pendente"
  );
}

try {
  const itemA = criarItem(wolff, "wolff_a");
  const itemB = criarItem(wolff, "wolff_b", { preco: 46.55 });

  salvarOficial(wolff, [itemA, itemB]);

  let cacheExecutor = [];
  assert.strictEqual(
    pendentes(cacheExecutor, wolff).length,
    0,
    "cache em memoria pode iniciar vazio antes do reload oficial"
  );

  cacheExecutor = carregarOficial(cacheExecutor, wolff);
  assert.deepStrictEqual(
    pendentes(cacheExecutor, wolff).map(item => item.id).sort(),
    ["wolff_a", "wolff_b"],
    "executor deve enxergar os mesmos 2 pendentes gravados pelo distributor"
  );

  const filaAntesSessaoIndisponivel = JSON.stringify(lerOficial(wolff));
  const filaDepoisSessaoIndisponivel = JSON.stringify(lerOficial(wolff));
  assert.strictEqual(
    filaDepoisSessaoIndisponivel,
    filaAntesSessaoIndisponivel,
    "sessao indisponivel nao deve remover nem mudar status de pendentes"
  );
  assert.strictEqual(
    pendentes(carregarOficial([], wolff), wolff).length,
    2,
    "quando a sessao volta, o executor deve encontrar os pendentes persistidos"
  );

  salvarOficial(controle, [criarItem(controle, "controle_a", { marketplace: "amazon" })]);
  cacheExecutor = carregarOficial(cacheExecutor, controle);
  assert.strictEqual(pendentes(cacheExecutor, wolff).length, 2, "WOLFF preserva seus pendentes");
  assert.strictEqual(pendentes(cacheExecutor, controle).length, 1, "controle preserva seu pendente");
  assert(
    pendentes(cacheExecutor, wolff).every(item => item.clienteId === wolff),
    "fila WOLFF nao pode conter item de outro workspace"
  );
  assert(
    pendentes(cacheExecutor, controle).every(item => item.clienteId === controle),
    "fila controle nao pode conter item de outro workspace"
  );

  const alvoEnvio = pendentes(cacheExecutor, wolff)[0];
  const reserva = filaOfertas.reservarOfertaProcessandoFila(cacheExecutor, alvoEnvio, {
    clienteId: wolff,
    agoraIso: "2026-08-08T18:05:00.000Z"
  });
  assert.strictEqual(reserva.ok, true, "executor deve reservar pendente antes do envio");

  const finalizacao = filaOfertas.finalizarOfertaEnviadaFila(cacheExecutor, alvoEnvio, {
    clienteId: wolff,
    enviadoEm: "2026-08-08T18:06:00.000Z",
    statusDetalhe: "Enviada para 1 destino(s)"
  });
  assert.strictEqual(finalizacao.ok, true, "executor deve finalizar o item relocalizado");
  salvarOficial(wolff, cacheExecutor);

  const cacheAposEnvio = carregarOficial([], wolff);
  assert.strictEqual(
    cacheAposEnvio.filter(item => item.id === alvoEnvio.id && item.status === "enviado").length,
    1,
    "item enviado deve aparecer como enviado uma unica vez"
  );
  assert.strictEqual(
    cacheAposEnvio.filter(item => item.id === alvoEnvio.id && item.status === "pendente").length,
    0,
    "item enviado nao deve continuar pendente"
  );

  const cacheAposRestart = carregarOficial([], wolff);
  assert.strictEqual(
    pendentes(cacheAposRestart, wolff).length,
    1,
    "restart deve recarregar pendentes persistidos"
  );

  let cacheProcessoRodando = carregarOficial([], wolff);
  assert.strictEqual(pendentes(cacheProcessoRodando, wolff).length, 1);

  salvarOficial(wolff, [...lerOficial(wolff), criarItem(wolff, "wolff_c", { preco: 140 })]);
  assert.strictEqual(
    pendentes(cacheProcessoRodando, wolff).length,
    1,
    "cache antigo ainda nao sabe do item novo antes do reload"
  );

  cacheProcessoRodando = carregarOficial(cacheProcessoRodando, wolff);
  assert.deepStrictEqual(
    pendentes(cacheProcessoRodando, wolff).map(item => item.id).sort(),
    ["wolff_b", "wolff_c"],
    "executor deve enxergar item adicionado durante processo rodando sem restart manual"
  );
} finally {
  process.env.DATA_DIR = dataDirAnterior;
  fs.rmSync(root, { recursive: true, force: true });
}
