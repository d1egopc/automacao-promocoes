const crypto = require("crypto");
const {
  readClienteJson,
  writeClienteJson,
  listClientes,
  normalizarClienteId
} = require("../utils/storage");
const {
  usuarioAtivo,
  listarClientesAtivos,
  logUsuarioInativoIgnorado
} = require("../utils/usuarios-atividade");
const { enviarCampanhaManual } = require("./enviarCampanha");
const {
  associarMidiaTemporaria,
  excluirMidiaTemporaria
} = require("./midiaTemporaria");
const { obterCampanhaHistorico } = require("./historicoCampanhas");

const ARQUIVO_AGENDAMENTOS = "campanhas-agendamentos.json";
const LIMITE_PADRAO = 100;
const LIMITE_MAXIMO = 500;
const STATUS_ATIVOS = new Set(["agendada", "processando"]);
const STATUS_EXECUTADOS = new Set(["enviada", "parcial", "erro", "sem_envio"]);
const STATUS_HISTORICO_CONCLUIDO = new Set(["enviada", "parcial", "erro", "sem_envio"]);
const PROCESSANDO_TIMEOUT_MS_PADRAO = 15 * 60 * 1000;
const locks = new Set();

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function clienteSeguro(clienteId = "admin") {
  return normalizarClienteId(clienteId || "admin");
}

function agoraIso(agora = new Date()) {
  const data = agora instanceof Date ? agora : new Date(agora);
  return Number.isFinite(data.getTime()) ? data.toISOString() : new Date().toISOString();
}

function inteiro(valor = 0, padrao = 0) {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : padrao;
}

function criarAgendamentoId() {
  return `agendamento_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

function limitarTexto(valor = "", limite = 4000) {
  const t = texto(valor);
  return t.length > limite ? t.slice(0, limite) : t;
}

function listaTexto(valor) {
  return Array.isArray(valor) ? valor.map(texto).filter(Boolean) : [];
}

function dataValida(valor = "") {
  const ms = new Date(valor).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function dataMs(valor = "") {
  return dataValida(valor);
}

function timeoutProcessandoMs() {
  const valor = Number(process.env.CAMPANHAS_AGENDAMENTOS_PROCESSANDO_TIMEOUT_MS);
  return Number.isFinite(valor) && valor >= 60000 ? Math.floor(valor) : PROCESSANDO_TIMEOUT_MS_PADRAO;
}

function processandoPreso(item = {}, agora = new Date()) {
  const status = texto(item.status).toLowerCase();
  if (status !== "processando") return false;
  const referenciaMs = dataMs(item.processandoEm || item.atualizadoEm || item.criadoEm);
  const agoraMs = new Date(agora).getTime();
  return Number.isFinite(referenciaMs) && Number.isFinite(agoraMs) && agoraMs - referenciaMs >= timeoutProcessandoMs();
}

function historicoConcluidoAgendamento(clienteId = "admin", item = {}) {
  const campanhaId = texto(item.campanhaId || item.resultado?.campanhaId);
  if (!campanhaId) return null;
  const historico = obterCampanhaHistorico(clienteId, campanhaId);
  const status = texto(historico?.status).toLowerCase();
  return historico && STATUS_HISTORICO_CONCLUIDO.has(status) ? historico : null;
}

function sanitizarErro(e) {
  return texto(e?.message || e).slice(0, 240);
}

function lerAgendamentosCampanhas(clienteId = "admin") {
  const dados = readClienteJson(clienteSeguro(clienteId), ARQUIVO_AGENDAMENTOS, []);
  return Array.isArray(dados) ? dados : [];
}

function salvarListaAgendamentos(clienteId = "admin", itens = []) {
  const lista = Array.isArray(itens) ? itens : [];
  writeClienteJson(clienteSeguro(clienteId), ARQUIVO_AGENDAMENTOS, lista.slice(-LIMITE_MAXIMO));
}

function normalizarAgendamento(clienteId, dados = {}, existente = {}) {
  const clienteIdSeguro = clienteSeguro(clienteId);
  const agendamentoId = texto(dados.agendamentoId || dados.id || existente.agendamentoId || existente.id || criarAgendamentoId());
  const criadoEm = texto(existente.criadoEm) || agoraIso();
  const status = texto(dados.status || existente.status || "agendada").toLowerCase();

  return {
    agendamentoId,
    id: agendamentoId,
    clienteId: clienteIdSeguro,
    origem: texto(dados.origem || existente.origem || "manual"),
    tipo: texto(dados.tipo || existente.tipo || "campanha"),
    mensagem: limitarTexto(dados.mensagem ?? existente.mensagem),
    imagemUrl: texto(dados.imagemUrl ?? existente.imagemUrl),
    midiaId: texto(dados.midiaId ?? existente.midiaId),
    destinosIds: listaTexto(dados.destinosIds ?? existente.destinosIds),
    agendadoPara: texto(dados.agendadoPara ?? existente.agendadoPara),
    status,
    criadoEm,
    atualizadoEm: agoraIso(),
    processandoEm: texto(dados.processandoEm ?? existente.processandoEm),
    executadoEm: texto(dados.executadoEm ?? existente.executadoEm),
    canceladoEm: texto(dados.canceladoEm ?? existente.canceladoEm),
    campanhaId: texto(dados.campanhaId ?? existente.campanhaId),
    resultado: dados.resultado ?? existente.resultado ?? null,
    erro: texto(dados.erro ?? existente.erro)
  };
}

function validarPayloadCriacao(payload = {}, { agora = new Date() } = {}) {
  if (!texto(payload.mensagem)) throw new Error("campanhas_agendamento_mensagem_obrigatoria");
  if (!listaTexto(payload.destinosIds).length) throw new Error("campanhas_agendamento_destinos_obrigatorios");
  const agendadoMs = dataValida(payload.agendadoPara);
  if (!Number.isFinite(agendadoMs)) throw new Error("campanhas_agendamento_data_invalida");
  const agoraMs = new Date(agora).getTime();
  if (Number.isFinite(agoraMs) && agendadoMs <= agoraMs) throw new Error("campanhas_agendamento_data_passada");
}

function respostaPublicaAgendamento(item = {}) {
  return {
    agendamentoId: item.agendamentoId,
    id: item.id || item.agendamentoId,
    clienteId: item.clienteId,
    origem: item.origem,
    tipo: item.tipo,
    mensagem: item.mensagem,
    imagemUrl: item.imagemUrl,
    midiaId: item.midiaId,
    destinosIds: item.destinosIds,
    agendadoPara: item.agendadoPara,
    status: item.status,
    criadoEm: item.criadoEm,
    atualizadoEm: item.atualizadoEm,
    processandoEm: item.processandoEm,
    executadoEm: item.executadoEm,
    canceladoEm: item.canceladoEm,
    campanhaId: item.campanhaId,
    resultado: item.resultado,
    erro: item.erro
  };
}

function salvarAgendamentoCampanha(clienteId = "admin", payload = {}, opcoes = {}) {
  validarPayloadCriacao(payload, opcoes);
  const clienteIdSeguro = clienteSeguro(clienteId);
  const lista = lerAgendamentosCampanhas(clienteIdSeguro);
  const item = normalizarAgendamento(clienteIdSeguro, { ...payload, status: "agendada" });

  if (item.midiaId) {
    associarMidiaTemporaria({ clienteId: clienteIdSeguro, midiaId: item.midiaId, campanhaId: item.agendamentoId });
  }

  lista.push(item);
  salvarListaAgendamentos(clienteIdSeguro, lista);
  return respostaPublicaAgendamento(item);
}

function listarAgendamentosCampanhas(clienteId = "admin", { limite = LIMITE_PADRAO, status = "" } = {}) {
  const max = Math.min(Math.max(inteiro(limite, LIMITE_PADRAO) || LIMITE_PADRAO, 1), LIMITE_MAXIMO);
  const statusFiltro = texto(status).toLowerCase();
  return lerAgendamentosCampanhas(clienteId)
    .filter(item => !statusFiltro || texto(item.status).toLowerCase() === statusFiltro)
    .sort((a, b) => texto(b.criadoEm).localeCompare(texto(a.criadoEm)))
    .slice(0, max)
    .map(respostaPublicaAgendamento);
}

function obterAgendamentoCampanha(clienteId = "admin", agendamentoId = "") {
  const id = texto(agendamentoId);
  if (!id) return null;
  const item = lerAgendamentosCampanhas(clienteId).find(ag => ag.agendamentoId === id || ag.id === id);
  return item ? respostaPublicaAgendamento(item) : null;
}

function atualizarAgendamento(clienteId = "admin", agendamentoId = "", alterar) {
  const clienteIdSeguro = clienteSeguro(clienteId);
  const lista = lerAgendamentosCampanhas(clienteIdSeguro);
  const id = texto(agendamentoId);
  const pos = lista.findIndex(item => item.agendamentoId === id || item.id === id);
  if (pos < 0) throw new Error("campanhas_agendamento_nao_encontrado");
  const atual = lista[pos];
  const proximo = typeof alterar === "function" ? alterar({ ...atual }) : atual;
  lista[pos] = { ...proximo, atualizadoEm: agoraIso() };
  salvarListaAgendamentos(clienteIdSeguro, lista);
  return lista[pos];
}

function cancelarAgendamentoCampanha(clienteId = "admin", agendamentoId = "") {
  const item = atualizarAgendamento(clienteId, agendamentoId, atual => {
    const status = texto(atual.status).toLowerCase();
    if (STATUS_EXECUTADOS.has(status)) throw new Error("campanhas_agendamento_ja_executado");
    if (status === "processando") throw new Error("campanhas_agendamento_em_processamento");
    return { ...atual, status: "cancelada", canceladoEm: agoraIso(), erro: "" };
  });
  if (item.midiaId) {
    try { excluirMidiaTemporaria(clienteId, item.midiaId, { forcar: true }); } catch {}
  }
  return respostaPublicaAgendamento(item);
}

function removerAgendamentoCampanha(clienteId = "admin", agendamentoId = "") {
  const clienteIdSeguro = clienteSeguro(clienteId);
  const id = texto(agendamentoId);
  const lista = lerAgendamentosCampanhas(clienteIdSeguro);
  const item = lista.find(ag => ag.agendamentoId === id || ag.id === id);
  if (!item) throw new Error("campanhas_agendamento_nao_encontrado");
  const status = texto(item.status).toLowerCase();
  if (status === "processando") throw new Error("campanhas_agendamento_em_processamento");
  salvarListaAgendamentos(clienteIdSeguro, lista.filter(ag => ag.agendamentoId !== id && ag.id !== id));
  if (item.midiaId && STATUS_ATIVOS.has(status)) {
    try { excluirMidiaTemporaria(clienteIdSeguro, item.midiaId, { forcar: true }); } catch {}
  }
  return respostaPublicaAgendamento(item);
}

function vencido(item = {}, agora = new Date()) {
  const agendadoMs = dataValida(item.agendadoPara);
  const agoraMs = new Date(agora).getTime();
  return Number.isFinite(agendadoMs) && Number.isFinite(agoraMs) && agendadoMs <= agoraMs;
}

async function executarAgendamentoCampanha({ clienteId = "admin", agendamentoId = "", deps = {}, agora = new Date(), recuperarProcessando = false } = {}) {
  const clienteIdSeguro = clienteSeguro(clienteId);
  const id = texto(agendamentoId);
  if (!usuarioAtivo(clienteIdSeguro)) {
    logUsuarioInativoIgnorado({ clienteId: clienteIdSeguro, fluxo: "campanhas_agendamento_execucao" });
    return {
      ok: false,
      clienteId: clienteIdSeguro,
      agendamentoId: id,
      erro: "usuario_inativo"
    };
  }

  const lock = `${clienteIdSeguro}:${id}`;
  if (!id) throw new Error("campanhas_agendamento_id_obrigatorio");
  if (locks.has(lock)) return { ok: true, ignorado: true, motivo: "em_processamento" };

  locks.add(lock);
  try {
    const existente = lerAgendamentosCampanhas(clienteIdSeguro).find(item => item.agendamentoId === id || item.id === id);
    if (!existente) throw new Error("campanhas_agendamento_nao_encontrado");

    if (recuperarProcessando && texto(existente.status).toLowerCase() === "processando") {
      if (!processandoPreso(existente, agora)) throw new Error("campanhas_agendamento_status_invalido");
      const historico = historicoConcluidoAgendamento(clienteIdSeguro, existente);
      if (historico) {
        const finalizadoPorHistorico = atualizarAgendamento(clienteIdSeguro, id, atual => ({
          ...atual,
          status: texto(historico.status) || "enviada",
          executadoEm: texto(atual.executadoEm) || texto(historico.concluidoEm) || agoraIso(agora),
          campanhaId: texto(historico.campanhaId),
          resultado: atual.resultado || {
            campanhaId: texto(historico.campanhaId),
            status: texto(historico.status),
            enviados: inteiro(historico.enviados),
            erros: inteiro(historico.erros)
          },
          recuperadoEm: agoraIso(agora),
          recuperacaoMotivo: "historico_concluido",
          erro: ""
        }));
        console.log("[CAMPANHAS-AGENDAMENTO-RECUPERADO]", {
          clienteId: clienteIdSeguro,
          agendamentoId: id,
          motivo: "historico_concluido",
          campanhaId: finalizadoPorHistorico.campanhaId,
          recuperadoEm: finalizadoPorHistorico.recuperadoEm
        });
        return {
          ok: true,
          recuperado: true,
          motivo: "historico_concluido",
          agendamento: respostaPublicaAgendamento(finalizadoPorHistorico),
          resultado: finalizadoPorHistorico.resultado
        };
      }
    }

    let recuperadoNestaExecucao = false;
    const marcado = atualizarAgendamento(clienteIdSeguro, id, atual => {
      const status = texto(atual.status).toLowerCase();
      if (status === "agendada") {
        if (!vencido(atual, agora)) throw new Error("campanhas_agendamento_ainda_nao_vencido");
        return { ...atual, status: "processando", processandoEm: agoraIso(agora), erro: "" };
      }
      if (status === "processando" && recuperarProcessando && processandoPreso(atual, agora)) {
        recuperadoNestaExecucao = true;
        return {
          ...atual,
          status: "processando",
          processandoEm: agoraIso(agora),
          recuperadoEm: agoraIso(agora),
          recuperacaoMotivo: "processando_timeout",
          erro: ""
        };
      }
      throw new Error("campanhas_agendamento_status_invalido");
    });

    if (recuperadoNestaExecucao) {
      console.log("[CAMPANHAS-AGENDAMENTO-RECUPERADO]", {
        clienteId: clienteIdSeguro,
        agendamentoId: id,
        motivo: "processando_timeout",
        recuperadoEm: marcado.recuperadoEm
      });
    }

    console.log("[CAMPANHAS-AGENDAMENTO-INICIO]", {
      clienteId: clienteIdSeguro,
      agendamentoId: id,
      midiaPresente: Boolean(marcado.midiaId),
      destinos: Array.isArray(marcado.destinosIds) ? marcado.destinosIds.length : 0,
      recuperado: recuperadoNestaExecucao
    });

    try {
      const resultado = await enviarCampanhaManual({
        clienteId: clienteIdSeguro,
        mensagem: marcado.mensagem,
        imagemUrl: marcado.imagemUrl,
        midiaId: marcado.midiaId,
        destinosIds: marcado.destinosIds,
        ...deps
      });
      const statusFinal = texto(resultado.status) || (resultado.enviados > 0 ? "enviada" : "erro");
      const finalizado = atualizarAgendamento(clienteIdSeguro, id, atual => ({
        ...atual,
        status: statusFinal,
        executadoEm: agoraIso(),
        campanhaId: texto(resultado.campanhaId),
        resultado,
        erro: ""
      }));
      console.log("[CAMPANHAS-AGENDAMENTO-FIM]", {
        clienteId: clienteIdSeguro,
        agendamentoId: id,
        status: finalizado.status,
        campanhaId: finalizado.campanhaId,
        enviados: resultado.enviados,
        erros: resultado.erros
      });
      return { ok: true, agendamento: respostaPublicaAgendamento(finalizado), resultado };
    } catch (e) {
      const finalizado = atualizarAgendamento(clienteIdSeguro, id, atual => ({
        ...atual,
        status: "erro",
        executadoEm: agoraIso(),
        erro: sanitizarErro(e)
      }));
      console.log("[CAMPANHAS-AGENDAMENTO-ERRO]", {
        clienteId: clienteIdSeguro,
        agendamentoId: id,
        erro: sanitizarErro(e)
      });
      return { ok: false, agendamento: respostaPublicaAgendamento(finalizado), erro: sanitizarErro(e) };
    }
  } finally {
    locks.delete(lock);
  }
}

async function executarAgendamentosPendentesCliente({ clienteId = "admin", deps = {}, agora = new Date() } = {}) {
  const clienteIdSeguro = clienteSeguro(clienteId);
  if (!usuarioAtivo(clienteIdSeguro)) {
    logUsuarioInativoIgnorado({ clienteId: clienteIdSeguro, fluxo: "campanhas_agendamentos_cliente" });
    return { ok: false, clienteId: clienteIdSeguro, processados: 0, resultados: [], motivo: "usuario_inativo" };
  }

  const pendentes = lerAgendamentosCampanhas(clienteIdSeguro)
    .filter(item => {
      const status = texto(item.status).toLowerCase();
      return (status === "agendada" && vencido(item, agora)) || processandoPreso(item, agora);
    })
    .sort((a, b) => texto(a.agendadoPara).localeCompare(texto(b.agendadoPara)) || texto(a.criadoEm).localeCompare(texto(b.criadoEm)));
  const resultados = [];
  for (const item of pendentes) {
    resultados.push(await executarAgendamentoCampanha({ clienteId: clienteIdSeguro, agendamentoId: item.agendamentoId, deps, agora, recuperarProcessando: true }));
  }
  return { ok: true, clienteId: clienteIdSeguro, processados: resultados.length, resultados };
}

async function executarAgendamentosPendentesTodosClientes({ deps = {}, agora = new Date(), clientes = null } = {}) {
  const idsBase = Array.isArray(clientes) ? clientes.map(texto).filter(Boolean) : listarClientesAtivos();
  const ids = idsBase.filter(clienteId => {
    if (usuarioAtivo(clienteId)) return true;
    logUsuarioInativoIgnorado({ clienteId, fluxo: "campanhas_agendamentos_todos" });
    return false;
  });
  const resultados = [];
  for (const clienteId of ids) {
    resultados.push(await executarAgendamentosPendentesCliente({ clienteId, deps, agora }));
  }
  return { ok: true, clientes: resultados.length, resultados };
}

module.exports = {
  ARQUIVO_AGENDAMENTOS,
  salvarAgendamentoCampanha,
  listarAgendamentosCampanhas,
  obterAgendamentoCampanha,
  cancelarAgendamentoCampanha,
  removerAgendamentoCampanha,
  executarAgendamentoCampanha,
  executarAgendamentosPendentesCliente,
  executarAgendamentosPendentesTodosClientes,
  lerAgendamentosCampanhas
};
