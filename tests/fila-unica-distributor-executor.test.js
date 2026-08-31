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

const saneamentoDuplicatasCliente = trechoEntre(
  "function sanearDuplicatasPendentesFilaCliente",
  "function podeAdicionarOfertaAutomaticaFila"
);

assert(
  saneamentoDuplicatasCliente.includes("fonteClienteHotState?.conclusiva === true") &&
    saneamentoDuplicatasCliente.includes("Array.isArray(fonteClienteHotState.itens)") &&
    saneamentoDuplicatasCliente.includes("const colecaoSaneamento = usandoHotStateCliente ? fonteClienteHotState.itens : fila") &&
    saneamentoDuplicatasCliente.includes("filaOfertas.sanearDuplicatasPendentes2h(colecaoSaneamento)"),
  "saneamento de duplicatas deve usar hot state do cliente somente quando a fonte V2 for conclusiva"
);

assert(
  saneamentoDuplicatasCliente.includes("const saneadasCliente = Number(resultado.saneadasPorCliente?.[String(clienteId || \"admin\")] || 0)") &&
    saneamentoDuplicatasCliente.includes("materializarFilaClienteHotStateNaGlobal(clienteId, fonteClienteHotState.itens, \"saneamento_duplicatas_fallback_legado\")") &&
    saneamentoDuplicatasCliente.includes("salvarFila(clienteId, { origem: \"saneamento\" })"),
  "saneamento por hot state deve materializar o workspace antes da persistencia legada existente"
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
  !fastPathExecutor.includes("const filaSemCliente = fila.filter") &&
    !fastPathExecutor.includes("fila = [...filaSemCliente, ...filaClienteHotState]"),
  "fast path V2 conclusivo nao deve reidratar a fila global com filter+spread recorrente"
);

const materializacaoHotState = trechoEntre(
  "function materializarFilaClienteHotStateNaGlobal",
  "function aplicarFastPathExecutorFilaViva"
);

assert(
  materializacaoHotState.includes("Array.isArray(filaClienteHotState)") &&
    materializacaoHotState.includes("String(item?.clienteId || \"admin\") === cliente") &&
    materializacaoHotState.includes("const filaSemCliente = fila.filter(item => String(item?.clienteId || \"admin\") !== cliente)") &&
    materializacaoHotState.includes("fila = [...filaSemCliente, ...itensCliente]"),
  "materializacao sob demanda deve substituir somente a fatia do workspace atual por hot state"
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
  persistirExpiracao.includes("materializarFilaClienteHotStateNaGlobal(cliente, opcoes.filaClienteHotState, `${motivo}_fallback_legado`)") &&
    persistirExpiracao.includes("motivo: `${motivo}_fallback_legado`"),
  "expiracao V2 inconclusiva deve materializar hot state antes de preservar fallback legado"
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
    saneamentoExpiracao.includes("await persistirExpiracaoFila(cliente, itensAlterados, \"expiracao_saneamento\", {") &&
    saneamentoExpiracao.includes("filaClienteHotState: usandoFilaViva ? itensCandidatos : null"),
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
    selecaoExpiracao.includes("await persistirExpiracaoFila(clienteIdAlvo || \"admin\", expiradasSelecao, \"expiracao_selecao\", {") &&
    selecaoExpiracao.includes("filaClienteHotState: usandoFilaVivaExpiracaoSelecao ? itensExpiracaoSelecao : null"),
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

assert(
  pos(selecaoExecutor, "const diagnosticoSemElegivel = diagnosticarFilaCliente(clienteLog, {") >
    pos(selecaoExecutor, "if (selecionada)") &&
    selecaoExecutor.includes("filaClienteHotState: Array.isArray(fonteClienteHotState?.itens)") &&
    selecaoExecutor.includes("? fonteClienteHotState.itens") &&
    selecaoExecutor.includes(": null"),
  "diagnostico final sem elegivel deve reutilizar hot state conclusivo e preservar fallback global quando ausente"
);

assert(
  processarFila.includes("const colecaoDuplicidadeProcessamento = (") &&
    processarFila.includes("fonteClienteHotStateSelecao?.conclusiva === true") &&
    processarFila.includes("Array.isArray(fonteClienteHotStateSelecao.itens)") &&
    processarFila.includes(") ? fonteClienteHotStateSelecao.itens : fila;") &&
    processarFila.includes("avaliarDuplicidadeAntesProcessarFila(colecaoDuplicidadeProcessamento, oferta, {"),
  "anti-dup do executor V2 conclusivo deve usar hot state do cliente e preservar fila global como fallback"
);

assert(
  processarFila.includes("const candidatosEnvioRecente = filaStore.candidatosEnvioRecente2h(oferta, { clienteId });") &&
    processarFila.includes("const colecaoFallbackEnvioRecenteExecutor = (") &&
    processarFila.includes("fonteClienteHotStateSelecao?.conclusiva === true") &&
    processarFila.includes("Array.isArray(fonteClienteHotStateSelecao.itens)") &&
    processarFila.includes(") ? fonteClienteHotStateSelecao.itens : fila;") &&
    processarFila.includes("consultarEnvioRecenteExecutor2h(colecaoFallbackEnvioRecenteExecutor, oferta, {") &&
    processarFila.includes("obterItens: () => candidatosEnvioRecente.ok ? candidatosEnvioRecente.itens : colecaoFallbackEnvioRecenteExecutor"),
  "anti-repeat deve manter FilaStore como primeira fonte e usar hot state do cliente como fallback no V2 conclusivo"
);

assert(
  processarFila.includes("const colecaoReservaProcessamento = (") &&
    processarFila.includes("fonteClienteHotStateSelecao?.conclusiva === true") &&
    processarFila.includes("Array.isArray(fonteClienteHotStateSelecao.itens)") &&
    processarFila.includes(") ? fonteClienteHotStateSelecao.itens : fila;") &&
    processarFila.includes("reservarOfertaProcessandoFila(colecaoReservaProcessamento, oferta, {"),
  "reserva processando deve usar hot state do cliente no V2 conclusivo e preservar fila global como fallback"
);

assert(
  processarFila.includes("let colecaoPosEnvioProcessamento = fila;") &&
    processarFila.includes("colecaoPosEnvioProcessamento = (") &&
    processarFila.includes(") ? fonteClienteHotStateSelecao.itens : fila;") &&
    processarFila.includes("relocalizarOfertaFila(colecaoPosEnvioProcessamento, oferta, { clienteId })") &&
    processarFila.includes("finalizarOfertaEnviadaFila(colecaoPosEnvioProcessamento, oferta, {") &&
    processarFila.includes("marcarErroEnvioFila(colecaoPosEnvioProcessamento, oferta, {"),
  "pos-envio V2 conclusivo deve relocalizar, finalizar e marcar erro pelo hot state, preservando fila global como fallback"
);

const salvarFilaCentral = trechoEntre(
  "function salvarFila",
  "function checkpointRevisionSeguro"
);

const salvarFilaSeAlteradaExecutor = trechoEntre(
  "const salvarFilaSeAlterada = async",
  "try {"
);

assert(
  salvarFilaSeAlteradaExecutor.includes("syncVivaMutacaoConfirmada(syncViva)") &&
    salvarFilaSeAlteradaExecutor.includes("materializarFilaClienteHotStateNaGlobal(") &&
    salvarFilaSeAlteradaExecutor.includes("fonteClienteHotStateSelecao.itens") &&
    pos(salvarFilaSeAlteradaExecutor, "materializarFilaClienteHotStateNaGlobal(") <
      pos(salvarFilaSeAlteradaExecutor, "const salvou = salvarFila(clienteSeguroFila"),
  "fallback legado do executor deve materializar hot state do cliente imediatamente antes de salvarFila"
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
    processarFila.includes("sanearDuplicatasPendentesFilaCliente(clienteFila, \"processar_fila\", {") &&
    processarFila.includes("fonteClienteHotState: fonteClienteHotStateSelecao") &&
    processarFila.includes("await selecionarProximaOfertaFila(clienteFila, {") &&
    processarFila.includes("fonteClienteHotState: fonteClienteHotStateSelecao"),
  "processarFila deve encaminhar hot state por cliente para saneamento/diagnostico/selecao sem refiltrar a global"
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
  "boot deve preservar lazy homologado para usuario.ativo === false"
);

assert(
  bootLazyInativo.includes("const configClienteBoot = configsPorCliente?.[usuario.id] || config;") &&
    bootLazyInativo.includes("if (configClienteBoot.automacaoAtiva !== true)") &&
    bootLazyInativo.includes("marcarFilaClienteNaoInicializada(usuario.id, \"boot_automacao_desligada\");") &&
    pos(bootLazyInativo, "if (configClienteBoot.automacaoAtiva !== true)") <
      pos(bootLazyInativo, "carregarFila(usuario.id);"),
  "boot deve deixar ativo com automacaoAtiva diferente de true em lazy sem carregar fila"
);

assert(
  pos(bootLazyInativo, "if (usuario.ativo === false)") <
    pos(bootLazyInativo, "if (configClienteBoot.automacaoAtiva !== true)") &&
    pos(bootLazyInativo, "if (configClienteBoot.automacaoAtiva !== true)") <
      pos(bootLazyInativo, "carregarFila(usuario.id);"),
  "boot deve carregar normalmente somente ativo com automacaoAtiva true"
);

assert(
  bootLazyInativo.includes("continue;") &&
    bootLazyInativo.includes("boot_usuario_inativo") &&
    bootLazyInativo.includes("boot_automacao_desligada") &&
    !bootLazyInativo.includes("destino") &&
    !bootLazyInativo.includes("creditos"),
  "segundo corte lazy deve usar apenas config de automacao ja carregada, sem destino, credito ou outro sinal pesado"
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

const rotaAutomacaoToggle = trechoEntre(
  'app.post("/automacao/toggle"',
  'app.delete("/fila/item/:id"'
);

assert(
  rotaAutomacaoToggle.includes('app.post("/automacao/toggle", async (req, res) =>') &&
    rotaAutomacaoToggle.includes("const proximoEstadoAutomacao =") &&
    rotaAutomacaoToggle.includes("if (proximoEstadoAutomacao === true)") &&
    pos(rotaAutomacaoToggle, "garantirFilaClienteInicializadaHttp(res, clienteId, \"ativacao_automacao\")") <
      pos(rotaAutomacaoToggle, "configsPorCliente[clienteId].automacaoAtiva =") &&
    pos(rotaAutomacaoToggle, "configsPorCliente[clienteId].automacaoAtiva =") <
      pos(rotaAutomacaoToggle, "salvarConfigsClientes();"),
  "toggle de automacao deve inicializar fila antes de tornar automacao ativa persistida"
);

const rotaMinhaConfig = trechoEntre(
  'app.post("/minha-config"',
  'app.post("/config"'
);

assert(
  rotaMinhaConfig.includes('app.post("/minha-config", async (req, res) =>') &&
    rotaMinhaConfig.includes("const configAtual = configsPorCliente[clienteId] || {};") &&
    rotaMinhaConfig.includes("if (body.automacaoAtiva === true && configAtual.automacaoAtiva !== true)") &&
    pos(rotaMinhaConfig, "garantirFilaClienteInicializadaHttp(res, clienteId, \"ativacao_automacao_minha_config\")") <
      pos(rotaMinhaConfig, "configsPorCliente[clienteId] = {"),
  "minha-config deve inicializar fila antes de gravar automacaoAtiva true"
);

const rotaConfig = trechoEntre(
  'app.post("/config"',
  "// ===================== FUNCAO ADMIN MASTER"
);

assert(
  rotaConfig.includes('app.post("/config", async (req, res) =>') &&
    rotaConfig.includes("const ativandoAutomacao =") &&
    rotaConfig.includes("body.automacaoAtiva === true && configCliente.automacaoAtiva !== true") &&
    pos(rotaConfig, "garantirFilaClienteInicializadaHttp(res, clienteId, \"ativacao_automacao_config\")") <
      pos(rotaConfig, "configCliente.automacaoAtiva =") &&
    pos(rotaConfig, "configCliente.automacaoAtiva =") <
      pos(rotaConfig, "salvarConfigsClientes();"),
  "config deve inicializar fila antes de gravar automacaoAtiva true"
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
  {
    const duplicataAntiga = criarItem(wolff, "dup_antiga", {
      titulo: "Notebook Gamer",
      linkOriginal: "https://produto.mercadolivre.com.br/MLB-duplicado",
      linkAfiliado: "https://mercadolivre.com.br/MLB-duplicado?aff=1",
      criadoEm: "24/07/2026, 19:00:00",
      dataEntradaFila: "2026-07-24T22:00:00.000Z"
    });
    const duplicataNova = criarItem(wolff, "dup_nova", {
      titulo: "Notebook Gamer",
      linkOriginal: "https://produto.mercadolivre.com.br/MLB-duplicado",
      linkAfiliado: "https://mercadolivre.com.br/MLB-duplicado?aff=2",
      criadoEm: "24/07/2026, 19:05:00",
      dataEntradaFila: "2026-07-24T22:05:00.000Z"
    });
    const outroCliente = criarItem(controle, "dup_outro_cliente", {
      titulo: "Notebook Gamer",
      linkOriginal: "https://produto.mercadolivre.com.br/MLB-duplicado",
      criadoEm: "24/07/2026, 19:03:00",
      dataEntradaFila: "2026-07-24T22:03:00.000Z"
    });
    const globalEquivalente = [
      { ...duplicataAntiga },
      { ...duplicataNova },
      { ...outroCliente }
    ];
    const hotStateCliente = [
      { ...duplicataAntiga },
      { ...duplicataNova }
    ];

    const resultadoGlobal = filaOfertas.sanearDuplicatasPendentes2h(globalEquivalente, {
      agora: Date.parse("2026-07-24T22:30:00.000Z")
    });
    const resultadoHotState = filaOfertas.sanearDuplicatasPendentes2h(hotStateCliente, {
      agora: Date.parse("2026-07-24T22:30:00.000Z")
    });

    assert.strictEqual(resultadoHotState.ok, true, "saneamento por hot state deve continuar valido");
    assert.strictEqual(
      resultadoHotState.totalSaneado,
      Number(resultadoGlobal.saneadasPorCliente?.[wolff] || 0),
      "hot state do cliente deve sanear o mesmo total que o global filtrado para o cliente"
    );
    assert.strictEqual(hotStateCliente[0].status, "pendente", "sobrevivente mais antiga deve ser preservada");
    assert.strictEqual(hotStateCliente[1].status, "retida", "duplicata do mesmo cliente deve ser retida");
    assert.strictEqual(globalEquivalente[2].status, "pendente", "cliente B nao pode influenciar mutacao do cliente A");
    assert.strictEqual(
      hotStateCliente[1].motivoRetencao,
      globalEquivalente[1].motivoRetencao,
      "mutacao/status do hot state deve permanecer identica ao saneamento global"
    );
    assert.strictEqual(
      hotStateCliente[1].antiRepeticao2h?.motivo,
      "repetida_pendente_saneada_2h",
      "anti-repeat deve manter marcador oficial de saneamento"
    );
    assert.strictEqual(hotStateCliente[0].cupom, duplicataAntiga.cupom, "cupom nao deve ser alterado pelo saneamento");
    assert.strictEqual(hotStateCliente[0].linkAfiliado, duplicataAntiga.linkAfiliado, "link afiliado deve ser preservado");
  }

  {
    const agora = Date.parse("2026-08-08T20:30:00.000Z");
    const identidadeBase = {
      produtoId: "MLB-anti-dup-hot-state",
      titulo: "Console Portatil Pro",
      preco: 153,
      precoAtual: 153,
      marketplace: "mercadolivre",
      linkOriginal: "https://produto.mercadolivre.com.br/MLB-anti-dup-hot-state",
      linkAfiliado: "https://mercadolivre.com.br/MLB-anti-dup-hot-state?aff=1",
      cupom: "CUPOM10"
    };

    function resumoDuplicidade(resultado) {
      return {
        ok: resultado.ok,
        bloquear: resultado.bloquear,
        motivo: resultado.motivo,
        statusAnterior: resultado.statusAnterior || "",
        ofertaAnteriorId: resultado.ofertaAnterior?.id || ""
      };
    }

    function compararDuplicidade(caso, itemAnterior, itemAtual, esperado) {
      const outroCliente = criarItem(controle, `${caso}_cliente_b`, {
        ...identidadeBase,
        status: "processando",
        destinoId: `destino_${controle}`
      });
      const global = [itemAnterior, outroCliente, itemAtual];
      const hotStateCliente = [itemAnterior, itemAtual];
      const resultadoGlobal = filaOfertas.avaliarDuplicidadeAntesProcessarFila(global, itemAtual, {
        clienteId: wolff,
        agora
      });
      const resultadoHotState = filaOfertas.avaliarDuplicidadeAntesProcessarFila(hotStateCliente, itemAtual, {
        clienteId: wolff,
        agora
      });

      assert.deepStrictEqual(
        resumoDuplicidade(resultadoHotState),
        resumoDuplicidade(resultadoGlobal),
        `${caso}: hot state do cliente deve preservar a decisao da global filtrada`
      );
      assert.strictEqual(resultadoHotState.bloquear, esperado.bloquear, `${caso}: decisao bloquear preservada`);
      assert.strictEqual(resultadoHotState.motivo, esperado.motivo, `${caso}: motivo preservado`);
      assert.strictEqual(
        resultadoHotState.ofertaAnterior,
        itemAnterior,
        `${caso}: cliente A deve decidir apenas com seu proprio item anterior`
      );
      assert.strictEqual(outroCliente.status, "processando", `${caso}: cliente B nao pode participar da decisao`);
      assert.strictEqual(itemAtual.cupom, identidadeBase.cupom, `${caso}: cupom deve ser preservado`);
      assert.strictEqual(itemAtual.linkAfiliado, identidadeBase.linkAfiliado, `${caso}: link afiliado deve ser preservado`);

      if (resultadoHotState.bloquear) {
        filaOfertas.marcarOfertaRetidaDuplicidadeFila(itemAtual, resultadoHotState.motivo, {
          identidade: resultadoHotState.identidade,
          ofertaAnteriorId: resultadoHotState.ofertaAnterior?.id || "",
          agoraIso: "2026-08-08T20:30:00.000Z"
        });
        assert.strictEqual(itemAtual.status, "retida", `${caso}: retencao posterior deve permanecer identica`);
        assert.strictEqual(itemAtual.motivoRetencao, esperado.motivo, `${caso}: motivo da retencao preservado`);
        assert.strictEqual(itemAnterior.status, esperado.statusAnterior, `${caso}: item anterior nao deve ser mutado`);
      }
    }

    compararDuplicidade(
      "pendente",
      criarItem(wolff, "dup_pendente_antiga", {
        ...identidadeBase,
        status: "pendente",
        criadoEm: "08/08/2026, 17:00:00",
        dataEntradaFila: "2026-08-08T20:00:00.000Z"
      }),
      criarItem(wolff, "dup_pendente_atual", {
        ...identidadeBase,
        status: "pendente",
        criadoEm: "08/08/2026, 17:10:00",
        dataEntradaFila: "2026-08-08T20:10:00.000Z"
      }),
      { bloquear: true, motivo: "duplicata_pendente_com_precedencia", statusAnterior: "pendente" }
    );

    compararDuplicidade(
      "processando",
      criarItem(wolff, "dup_processando_anterior", {
        ...identidadeBase,
        status: "processando"
      }),
      criarItem(wolff, "dup_processando_atual", {
        ...identidadeBase,
        status: "pendente"
      }),
      { bloquear: true, motivo: "duplicata_ja_processando", statusAnterior: "processando" }
    );

    compararDuplicidade(
      "enviando",
      criarItem(wolff, "dup_enviando_anterior", {
        ...identidadeBase,
        status: "enviando"
      }),
      criarItem(wolff, "dup_enviando_atual", {
        ...identidadeBase,
        status: "pendente"
      }),
      { bloquear: true, motivo: "duplicata_ja_processando", statusAnterior: "enviando" }
    );

    compararDuplicidade(
      "enviado_recente_2h",
      criarItem(wolff, "dup_enviado_recente", {
        ...identidadeBase,
        status: "enviado",
        enviadoEm: "2026-08-08T20:00:00.000Z"
      }),
      criarItem(wolff, "dup_enviado_atual", {
        ...identidadeBase,
        status: "pendente"
      }),
      { bloquear: true, motivo: "repetida_no_executor_2h", statusAnterior: "enviado" }
    );

    const enviadoAntigo = criarItem(wolff, "dup_enviado_antigo", {
      ...identidadeBase,
      status: "enviado",
      enviadoEm: "2026-08-08T17:00:00.000Z"
    });
    const enviadoAntigoAtual = criarItem(wolff, "dup_enviado_antigo_atual", {
      ...identidadeBase,
      status: "pendente"
    });
    const resultadoAntigo = filaOfertas.avaliarDuplicidadeAntesProcessarFila(
      [enviadoAntigo, enviadoAntigoAtual],
      enviadoAntigoAtual,
      { clienteId: wolff, agora }
    );
    assert.strictEqual(resultadoAntigo.ok, true, "item antigo fora da janela deve avaliar com sucesso");
    assert.strictEqual(resultadoAntigo.bloquear, false, "enviado antigo fora de 2h nao deve bloquear indevidamente");
    assert.strictEqual(resultadoAntigo.motivo, "sem_duplicidade_ativa", "historico antigo deve preservar regra atual");
  }

  {
    const agora = Date.parse("2026-08-08T21:30:00.000Z");
    const enviadaRecente = criarItem(wolff, "repeat_enviado_recente_hot_state", {
      produtoId: "MLB-repeat-hot-state",
      marketplace: "mercadolivre",
      linkOriginal: "https://produto.mercadolivre.com.br/MLB-repeat-hot-state",
      linkAfiliado: "https://mercadolivre.com.br/MLB-repeat-hot-state?aff=1",
      preco: 190,
      precoAtual: 190,
      status: "enviado",
      enviadoEm: "2026-08-08T20:00:00.000Z",
      cupom: "HOT10"
    });
    const enviadaAntiga = criarItem(wolff, "repeat_enviado_antigo_hot_state", {
      ...enviadaRecente,
      id: "repeat_enviado_antigo_hot_state",
      status: "enviado",
      enviadoEm: "2026-08-08T18:00:00.000Z"
    });
    const envioComMelhoria = criarItem(wolff, "repeat_melhoria_hot_state", {
      ...enviadaRecente,
      id: "repeat_melhoria_hot_state",
      status: "enviado",
      preco: 220,
      precoAtual: 220,
      enviadoEm: "2026-08-08T20:45:00.000Z"
    });
    const atual = criarItem(wolff, "repeat_atual_hot_state", {
      ...enviadaRecente,
      id: "repeat_atual_hot_state",
      status: "pendente",
      enviadoEm: "",
      preco: 190,
      precoAtual: 190
    });
    const atualMelhorada = criarItem(wolff, "repeat_atual_melhorada_hot_state", {
      ...atual,
      id: "repeat_atual_melhorada_hot_state",
      preco: 180,
      precoAtual: 180
    });
    const outroCliente = criarItem(controle, "repeat_cliente_b", {
      ...enviadaRecente,
      clienteId: controle,
      status: "enviado",
      enviadoEm: "2026-08-08T21:00:00.000Z"
    });
    const hotStateCliente = [enviadaRecente, enviadaAntiga, envioComMelhoria, atual, atualMelhorada];
    const global = [outroCliente, ...hotStateCliente];
    const fallbackGlobal = filaOfertas.consultarEnvioRecenteExecutor2h(global, atual, {
      agora,
      obterItens: () => global
    });
    const fallbackHotState = filaOfertas.consultarEnvioRecenteExecutor2h(hotStateCliente, atual, {
      agora,
      obterItens: () => hotStateCliente
    });
    assert.deepStrictEqual(
      {
        ok: fallbackHotState.ok,
        bloqueada: fallbackHotState.bloqueada,
        motivo: fallbackHotState.motivo,
        ofertaAnteriorId: fallbackHotState.ofertaAnterior?.id || ""
      },
      {
        ok: fallbackGlobal.ok,
        bloqueada: fallbackGlobal.bloqueada,
        motivo: fallbackGlobal.motivo,
        ofertaAnteriorId: fallbackGlobal.ofertaAnterior?.id || ""
      },
      "fallback anti-repeat por hot state deve preservar decisao da global filtrada"
    );
    assert.strictEqual(fallbackHotState.bloqueada, true, "envio recente menor que 2h deve continuar bloqueando");
    assert.strictEqual(fallbackHotState.ofertaAnterior, enviadaRecente, "cliente A deve decidir com seu proprio historico recente");
    assert.strictEqual(outroCliente.status, "enviado", "cliente B nao deve participar da decisao de anti-repeat");

    const foraJanela = filaOfertas.consultarEnvioRecenteExecutor2h([enviadaAntiga, atual], atual, {
      agora,
      obterItens: () => [enviadaAntiga, atual]
    });
    assert.strictEqual(foraJanela.bloqueada, false, "envio fora da janela de 2h deve continuar liberando");

    const melhoria = filaOfertas.consultarEnvioRecenteExecutor2h([envioComMelhoria, atualMelhorada], atualMelhorada, {
      agora,
      obterItens: () => [envioComMelhoria, atualMelhorada]
    });
    assert.strictEqual(melhoria.bloqueada, false, "melhoria comercial valida deve continuar liberando repeat");
    assert.strictEqual(atual.cupom, "HOT10", "cupom deve ser preservado pela consulta anti-repeat");
    assert.strictEqual(atual.linkAfiliado, "https://mercadolivre.com.br/MLB-repeat-hot-state?aff=1", "link afiliado deve ser preservado");
  }

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

  const hotStateWolff = pendentes(cacheExecutor, wolff);
  const alvoEnvio = hotStateWolff[0];
  const reserva = filaOfertas.reservarOfertaProcessandoFila(hotStateWolff, alvoEnvio, {
    clienteId: wolff,
    agoraIso: "2026-08-08T18:05:00.000Z"
  });
  assert.strictEqual(reserva.ok, true, "executor deve reservar pendente antes do envio usando hot state do cliente");
  assert.strictEqual(
    cacheExecutor.find(item => item.id === alvoEnvio.id && item.clienteId === wolff)?.status,
    "processando",
    "mutacao da reserva por hot state deve refletir nas mesmas referencias do cache executor"
  );
  assert.strictEqual(
    cacheExecutor.find(item => item.clienteId === controle)?.status,
    "pendente",
    "reserva por hot state do cliente nao deve alterar item de outro workspace"
  );

  const relocalizacaoPosEnvio = filaOfertas.relocalizarOfertaFila(hotStateWolff, alvoEnvio, {
    clienteId: wolff
  });
  assert.strictEqual(relocalizacaoPosEnvio.ok, true, "pos-envio deve relocalizar pelo hot state do cliente");
  assert.strictEqual(
    relocalizacaoPosEnvio.oferta,
    alvoEnvio,
    "hot state deve preservar a mesma referencia operacional selecionada/reservada"
  );

  alvoEnvio.destinosEstado = [{ chave: "whatsapp:destino_a", estado: "enviado", motivo: "envio_confirmado" }];
  const finalizacao = filaOfertas.finalizarOfertaEnviadaFila(hotStateWolff, alvoEnvio, {
    clienteId: wolff,
    enviadoEm: "2026-08-08T18:06:00.000Z",
    statusDetalhe: "Enviada para 1 destino(s)"
  });
  assert.strictEqual(finalizacao.ok, true, "executor deve finalizar o item relocalizado pelo hot state");
  assert.strictEqual(
    cacheExecutor.find(item => item.id === alvoEnvio.id && item.clienteId === wolff)?.status,
    "enviado",
    "finalizacao por hot state deve refletir nas mesmas referencias do cache executor"
  );
  assert.strictEqual(
    cacheExecutor.find(item => item.clienteId === controle)?.status,
    "pendente",
    "finalizacao por hot state do cliente nao deve alterar outro workspace"
  );
  assert.strictEqual(alvoEnvio.destinosEstado[0].estado, "enviado", "destino enviado deve ser preservado");
  assert.strictEqual(alvoEnvio.cupom, itemA.cupom, "cupom deve ser preservado na finalizacao");
  assert.strictEqual(alvoEnvio.linkAfiliado, itemA.linkAfiliado, "link afiliado deve ser preservado na finalizacao");
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

  {
    const parcial = criarItem(wolff, "wolff_parcial", {
      destinosEstado: [{ chave: "whatsapp:destino_a", estado: "aguardando", motivo: "intervalo" }]
    });
    const outroClienteParcial = criarItem(controle, "controle_parcial");
    const cacheParcial = [parcial, outroClienteParcial];
    const hotStateParcial = [parcial];
    const reservaParcial = filaOfertas.reservarOfertaProcessandoFila(hotStateParcial, parcial, {
      clienteId: wolff,
      agoraIso: "2026-08-08T18:07:00.000Z"
    });
    assert.strictEqual(reservaParcial.ok, true, "reserva parcial deve usar hot state");
    parcial.status = "pendente";
    parcial.processandoEm = "";
    parcial.statusDetalhe = "Aguardando envio: intervalo";
    assert.strictEqual(cacheParcial[0].status, "pendente", "item deve poder voltar a pendente apos destino futuro");
    assert.strictEqual(
      cacheParcial[0].destinosEstado[0].estado,
      "aguardando",
      "destino em intervalo deve permanecer preservado no mesmo objeto"
    );
    assert.strictEqual(cacheParcial[1].status, "pendente", "workspace B nao deve ser percorrido no hot state parcial");
  }

  {
    const erro = criarItem(wolff, "wolff_erro", {
      status: "processando",
      destinosEstado: [{ chave: "telegram:destino_b", estado: "erro_definitivo", motivo: "falha_envio" }],
      proximaTentativaEnvioEm: "2026-08-08T18:20:00.000Z"
    });
    const outroClienteErro = criarItem(controle, "controle_erro", { status: "processando" });
    const hotStateErro = [erro];
    const erroFila = filaOfertas.marcarErroEnvioFila(hotStateErro, erro, {
      clienteId: wolff,
      erro: "falha teste",
      erroEm: "2026-08-08T18:08:00.000Z",
      statusDetalhe: "Erro no envio: falha teste"
    });
    assert.strictEqual(erroFila.ok, true, "erro de envio deve ser marcado pelo hot state");
    assert.strictEqual(erro.status, "erro", "status de erro deve ser preservado");
    assert.strictEqual(erro.erro, "falha teste", "mensagem de erro/retry deve ser preservada");
    assert.strictEqual(erro.destinosEstado[0].estado, "erro_definitivo", "destino em erro deve ser preservado");
    assert.strictEqual(erro.proximaTentativaEnvioEm, "2026-08-08T18:20:00.000Z", "retry existente deve ser preservado");
    assert.strictEqual(outroClienteErro.status, "processando", "erro por hot state nao deve alterar cliente B");
  }

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
