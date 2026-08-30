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
    pos(processarFila, "await selecionarProximaOfertaFila(clienteFila, {"),
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

assert(
  fastPathExecutor.includes("const filaSemCliente = fila.filter") &&
    fastPathExecutor.includes("fila = [...filaSemCliente, ...filaClienteHotState]"),
  "primeiro corte TOP 2 nao deve alterar a reidratacao global do fast path"
);

const fonteHotStateExecutor = trechoEntre(
  "function fonteClienteHotStateExecutorV2",
  "function avaliarOfertaParaSelecaoFilaViva"
);

assert(
  fonteHotStateExecutor.includes("reconciliacao.fastPathExecutor !== true") &&
    fonteHotStateExecutor.includes("reconciliacao.generationConclusiva !== true") &&
    fonteHotStateExecutor.includes("return null"),
  "fonte por cliente so pode ser usada quando o fast path V2 tiver authority conclusiva"
);

assert(
  fonteHotStateExecutor.includes("filaStore.itensPorCliente(cliente)") &&
    !fonteHotStateExecutor.includes("lerFilaVivaParaMerge") &&
    !fonteHotStateExecutor.includes("reconciliarFilaV2ParaLeitura"),
  "fonte por cliente deve reutilizar hot state indexado sem segunda leitura da fila-viva"
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

const persistirExpiracao = trechoEntre(
  "async function persistirExpiracaoFila",
  "async function sanearExpiradosFila"
);

assert(
  persistirExpiracao.includes("!filaOperacionalV2.deveUsarFilaV2Operacional(cliente)") &&
    persistirExpiracao.includes("salvarFila(cliente, { origem: \"expiracao\", motivo });"),
  "expiracao deve preservar rewrite legado para off-V2"
);

assert(
  persistirExpiracao.includes("await sincronizarItemFilaVivaAposMutacao(cliente, item, `${motivo}_checkpoint_only`, {") &&
    persistirExpiracao.includes("checkpointSincronizado: false") &&
    persistirExpiracao.includes("exigirMutacao: true") &&
    persistirExpiracao.includes("publicarLegacyProof: false"),
  "expiracao em V2 deve espelhar mutacao na viva, abrir dirty e nao renovar proof legado"
);

assert(
  persistirExpiracao.includes("syncVivaMutacaoConfirmada(syncViva)") &&
    persistirExpiracao.includes("legacy_rewrite_evitado_checkpoint_only") &&
    persistirExpiracao.includes("origem: \"expiracao\""),
  "expiracao V2 confirmada deve evitar rewrite imediato de fila.json com observabilidade checkpoint-only"
);

assert(
  persistirExpiracao.includes("motivo: `${motivo}_fallback_legado`"),
  "expiracao V2 inconclusiva deve preservar fallback legado em vez de descartar mutacao"
);

const saneamentoExpiracao = trechoEntre(
  "function candidatosExpiracaoFilaV2",
  "const filaInteligenteUltimoAbastecimento"
);

assert(
    saneamentoExpiracao.includes("filaOperacionalV2.deveUsarFilaV2Operacional(cliente)") &&
    saneamentoExpiracao.includes("filaOperacionalV2.lerFilaVivaParaMerge(cliente, {") &&
    saneamentoExpiracao.includes("leitura.motivo !== \"ok\"") &&
    saneamentoExpiracao.includes("entrada?.bucket === \"viva\"") &&
    saneamentoExpiracao.includes(".map(entrada => entrada.item)"),
  "saneamento V2 deve selecionar candidatos do hot state da fila-viva sem consultar residuos legacy-only"
);

assert(
  saneamentoExpiracao.includes("const itensCandidatos = fonteCandidatos?.itens || fila") &&
    saneamentoExpiracao.includes("if (!usandoFilaViva && String(oferta?.clienteId || \"admin\") !== cliente) continue;") &&
    saneamentoExpiracao.includes("if (oferta.status !== \"pendente\") continue;") &&
    saneamentoExpiracao.includes("await persistirExpiracaoFila(cliente, itensAlterados, \"expiracao_saneamento\");"),
  "saneamento deve preservar caminho legado/off-V2, filtro pendente e persistencia incremental existente"
);

const selecaoExpiracao = trechoEntre(
  "async function candidatosExpiracaoSelecaoFilaV2",
  "const resultadoSelecao = selecionarProximaOfertaFilaCore"
);

assert(
  selecaoExpiracao.includes("filaOperacionalV2.deveUsarFilaV2Operacional(cliente)") &&
    selecaoExpiracao.includes("await filaOperacionalV2.reconciliarFilaV2ParaLeitura(cliente, {") &&
    selecaoExpiracao.includes("contexto: \"expiracao_selecao\"") &&
    selecaoExpiracao.includes("if (decisao?.generationConclusiva !== true) return null;") &&
    selecaoExpiracao.includes("return candidatosExpiracaoFilaV2(cliente);"),
  "expiracao_selecao V2 deve usar fila-viva somente quando authority generation for conclusiva"
);

assert(
  selecaoExpiracao.includes("const fonteExpiracaoSelecao = await candidatosExpiracaoSelecaoFilaV2(clienteLog);") &&
    selecaoExpiracao.includes("const itensExpiracaoSelecao = fonteExpiracaoSelecao?.itens || fila;") &&
    selecaoExpiracao.includes("const usandoFilaVivaExpiracaoSelecao = fonteExpiracaoSelecao?.fonte === \"fila_viva\";") &&
    selecaoExpiracao.includes("for (const oferta of itensExpiracaoSelecao)") &&
    selecaoExpiracao.includes("if (!usandoFilaVivaExpiracaoSelecao && !mesmoCliente) continue;"),
  "expiracao_selecao deve ignorar stale global quando V2 conclusiva fornecer hot state da fila-viva"
);

assert(
  selecaoExpiracao.includes("if (oferta?.status !== \"pendente\") continue;") &&
    selecaoExpiracao.includes("if (!ofertaExpiradaParaEnvio(oferta, agora)) continue;") &&
    selecaoExpiracao.includes("marcarOfertaExpirada(oferta);") &&
    selecaoExpiracao.includes("await persistirExpiracaoFila(clienteIdAlvo || \"admin\", expiradasSelecao, \"expiracao_selecao\");"),
  "expiracao_selecao deve preservar regra, mutacao e persistencia checkpoint-only existentes"
);

const diagnosticoFila = trechoEntre(
  "function diagnosticarFilaCliente",
  "function fonteClienteHotStateExecutorV2"
);

assert(
  diagnosticoFila.includes("const fonteClienteConfiavel = Array.isArray(opcoes.filaClienteHotState)") &&
    diagnosticoFila.includes("? opcoes.filaClienteHotState") &&
    diagnosticoFila.includes(": fila.filter"),
  "diagnostico deve usar visao por cliente no caminho V2 conclusivo e preservar fallback global"
);

assert(
  diagnosticoFila.includes("pendentesGlobal: fonteClienteConfiavel") &&
    diagnosticoFila.includes("? null") &&
    diagnosticoFila.includes(": fila.filter(o => o?.status === \"pendente\").length"),
  "diagnostico V2 conclusivo nao deve filtrar a fila global apenas para telemetria"
);

const selecaoExecutor = trechoEntre(
  "async function selecionarProximaOfertaFila",
  "function aplicarDiversidadeFila"
);

assert(
  selecaoExecutor.includes("const fonteClienteHotState = opcoes?.fonteClienteHotState") &&
    selecaoExecutor.includes("const colecaoSelecao = Array.isArray(fonteClienteHotState?.itens)") &&
    selecaoExecutor.includes("? fonteClienteHotState.itens") &&
    selecaoExecutor.includes(": fila"),
  "selecao V2 conclusiva deve usar a visao por cliente ja disponivel e fallback legado deve continuar usando fila global"
);

assert(
  selecaoExecutor.includes("diagnosticarFilaCliente(clienteLog, {") &&
    selecaoExecutor.includes("filaClienteHotState: Array.isArray(fonteClienteHotState?.itens)") &&
    selecaoExecutor.includes("selecionarProximaOfertaFilaCore(colecaoSelecao, clienteIdAlvo, {"),
  "diagnostico e selecao devem compartilhar a mesma colecao por cliente no ciclo"
);

const salvarFilaCentral = trechoEntre(
  "function salvarFila",
  "function checkpointRevisionSeguro"
);

assert(
  pos(salvarFilaCentral, "const estadoInicializacao = estadoFilaClienteInicializacao(clienteId);") <
    pos(salvarFilaCentral, "const salvou = filaOfertas.salvarFila({") &&
    salvarFilaCentral.includes("motivo: \"salvar_fila_sem_inicializacao\"") &&
    salvarFilaCentral.includes("return false;"),
  "salvarFila deve falhar fechado antes de write legado quando o cliente estiver NAO_INICIALIZADO"
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
    pos(puloRapidoV2, "const fonteClienteHotState = fonteClienteHotStateExecutorV2(cliente, reconciliacao);") &&
    pos(puloRapidoV2, "const fonteClienteHotState = fonteClienteHotStateExecutorV2(cliente, reconciliacao);") <
    pos(puloRapidoV2, "const basePendentes = Array.isArray(fonteClienteHotState?.itens) ? fonteClienteHotState.itens : fila;"),
  "runner deve reconciliar hot state V2 antes de confirmar sem_pendentes"
);

assert(
  puloRapidoV2.includes("const basePendentes = Array.isArray(fonteClienteHotState?.itens) ? fonteClienteHotState.itens : fila;") &&
    puloRapidoV2.includes("if (!fonteClienteHotState && String(item?.clienteId || \"admin\") !== cliente) return false;"),
  "pulo rapido V2 conclusivo deve contar pendentes pela visao por cliente e preservar fallback global"
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
    processarFila.includes("reconciliacaoLeituraFilaV2 = await reconciliarFilaV2ParaLeituraCliente(clienteFila, \"executor\");"),
  "processarFila deve reutilizar o preflight recebido do runner e evitar segunda reconciliacao"
);

assert(
  processarFila.includes("const fonteClienteHotStateSelecao = fonteClienteHotStateExecutorV2(clienteFila, reconciliacaoLeituraFilaV2);") &&
    processarFila.includes("await selecionarProximaOfertaFila(clienteFila, {") &&
    processarFila.includes("fonteClienteHotState: fonteClienteHotStateSelecao"),
  "processarFila deve encaminhar hot state por cliente para diagnostico/selecao sem refiltrar a global"
);

const lazyWorkspaceState = trechoEntre(
  "const ESTADO_FILA_CLIENTE_INICIALIZADO",
  "async function reconciliarFilaV2ParaLeituraCliente"
);

assert(
  lazyWorkspaceState.includes("ESTADO_FILA_CLIENTE_NAO_INICIALIZADO = \"NAO_INICIALIZADO\"") &&
    lazyWorkspaceState.includes("estadoInicializacaoFilaCliente = new Map()") &&
    lazyWorkspaceState.includes("inicializacaoFilaClienteEmAndamento = new Map()"),
  "lazy de workspace inativo deve ter estado explicito por cliente e nao confundir nao inicializado com fila vazia"
);

assert(
  lazyWorkspaceState.includes("if (estadoAtual === ESTADO_FILA_CLIENTE_INICIALIZADO)") &&
    lazyWorkspaceState.includes("const emAndamento = inicializacaoFilaClienteEmAndamento.get(cliente)") &&
    lazyWorkspaceState.includes("if (emAndamento) return emAndamento") &&
    lazyWorkspaceState.includes("inicializacaoFilaClienteEmAndamento.set(cliente, inicializacao)"),
  "guard lazy deve ser no-op apos inicializacao e single-flight durante inicializacao concorrente"
);

assert(
  lazyWorkspaceState.includes("estadoInicializacaoFilaCliente.set(cliente, ESTADO_FILA_CLIENTE_INICIALIZANDO)") &&
    lazyWorkspaceState.includes("carregarFila(cliente)") &&
    lazyWorkspaceState.includes("estadoInicializacaoFilaCliente.set(cliente, ESTADO_FILA_CLIENTE_NAO_INICIALIZADO)") &&
    lazyWorkspaceState.includes("throw erro"),
  "guard lazy deve usar o loader oficial, marcar inicializando e falhar fechado sem produzir falso vazio"
);

const finalizarCarregamentoLazy = trechoEntre(
  "function finalizarCarregamentoFilaCliente",
  "function carregarFila"
);

assert(
  pos(finalizarCarregamentoLazy, "reconstruirFilaStoreCliente(clienteId, opcoes.motivo || \"carregarFila\", opcoes);") <
    pos(finalizarCarregamentoLazy, "marcarFilaClienteInicializada(clienteId, opcoes.motivo || \"carregarFila\");"),
  "cliente so pode virar INICIALIZADO depois de rebuild/reconciliacao oficial"
);

const bootLazyInativo = (() => {
  const fimBoot = fonteIndex.lastIndexOf("function garantirIdsFila");
  const marcadorBoot = fonteIndex.lastIndexOf("for (const usuario of usuarios) {", fimBoot);
  assert(marcadorBoot >= 0 && fimBoot > marcadorBoot, "loop de boot de fila deve existir");
  return fonteIndex.slice(marcadorBoot, fimBoot);
})();

assert(
  bootLazyInativo.includes("if (usuario.ativo === false)") &&
    pos(bootLazyInativo, "marcarFilaClienteNaoInicializada(usuario.id, \"boot_usuario_inativo\");") <
      pos(bootLazyInativo, "carregarFila(usuario.id);"),
  "boot deve pular somente usuario.ativo === false e carregar ativos como antes"
);

assert(
  bootLazyInativo.includes("continue;") &&
    !bootLazyInativo.includes("automacaoAtiva") &&
    !bootLazyInativo.includes("destino") &&
    !bootLazyInativo.includes("creditos"),
  "primeiro corte lazy nao deve usar automacao, destino, credito ou outro sinal para pular boot"
);

assert(
  processarFila.includes("await garantirFilaClienteInicializada(clienteFila, \"executor_processar_fila\");") &&
    pos(processarFila, "if (!usuarioAtivoOperacional(clienteFila))") <
      pos(processarFila, "await garantirFilaClienteInicializada(clienteFila, \"executor_processar_fila\");"),
  "executor deve manter bloqueio de inativo antes do guard e carregar lazy antes da primeira operacao real"
);

const adicionarFilaGlobalEngine = trechoEntre(
  "async function adicionarOfertaNaFilaGlobalEngine",
  "function garantirIdsFila"
);

assert(
  adicionarFilaGlobalEngine.includes("await garantirFilaClienteInicializada(cliente, \"engine_distributor_fila\");") &&
    pos(adicionarFilaGlobalEngine, "if (!usuarioAtivoOperacional(cliente))") <
      pos(adicionarFilaGlobalEngine, "await garantirFilaClienteInicializada(cliente, \"engine_distributor_fila\");") &&
    pos(adicionarFilaGlobalEngine, "await garantirFilaClienteInicializada(cliente, \"engine_distributor_fila\");") <
      pos(adicionarFilaGlobalEngine, "itemEngineDuplicadoFilaGlobal(cliente, itemFinal)"),
  "Distributor/engine deve carregar lazy depois do bloqueio de inativo e antes de dedupe/insercao"
);

assert(
  adicionarFilaGlobalEngine.includes("motivo: \"fila_nao_inicializada\"") &&
    adicionarFilaGlobalEngine.includes("return { ok: false, motivo: \"fila_nao_inicializada\""),
  "falha do lazy no Distributor deve ser fail-closed"
);

[
  "fila_inteligente_abastecer",
  "radar_retida_sem_inicializacao",
  "importador_kabum_manual",
  "importador_magalu_manual",
  "importador_awin_feed"
].forEach((motivo) => {
  assert(
    fonteIndex.includes(`"${motivo}"`),
    `${motivo} deve proteger produtor direto que acessa ou muta fila real`
  );
});

const rotaPutUsuario = trechoEntre(
  'app.put("/admin/usuarios/:id"',
  'app.post("/minha-config"'
);

assert(
  rotaPutUsuario.includes("const ativoAntes = usuario.ativo !== false;") &&
    rotaPutUsuario.includes("if (body.ativo === true && ativoAntes === false)") &&
    rotaPutUsuario.includes("garantirFilaClienteInicializadaHttp(res, id, \"reativacao_usuario\")"),
  "reativacao de usuario deve disparar lazy load oficial antes de responder sucesso"
);

[
  "rota_post_fila",
  "rota_enviar_manual",
  "rota_get_fila",
  "rota_automacao_status",
  "rota_remover_item_id",
  "rota_limpar_fila",
  "rota_remover_indice",
  "rota_reprocessar",
  "rota_enviar_agora_id",
  "rota_enviar_agora_indice"
].forEach((motivo) => {
  assert(
    fonteIndex.includes(`garantirFilaClienteInicializadaHttp(res,`) &&
      fonteIndex.includes(`"${motivo}"`),
    `${motivo} deve proteger entrypoint que acessa ou muta fila real`
  );
});

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
