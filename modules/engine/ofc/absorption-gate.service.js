const { readGlobalJson, readClienteJson } = require("../../../utils/storage");
const { listarClientesAtivos } = require("../../../utils/usuarios-atividade");
const destinosUtils = require("../../../utils/destinos");
const {
  destinoPossuiIntegracaoBasica,
  numeroIntervaloDestino
} = require("./commercial-capacity.service");
const { consultarEventosAbsorcaoPorWorkspace } = require("./absorption-gate.repository");

const STATUS_PENDENTES_VIVOS = new Set([
  "",
  "pendente",
  "novo",
  "aguardando",
  "aguardando_envio",
  "pronto",
  "pronta",
  "programado",
  "programada"
]);

const STATUS_EM_TENTATIVA = new Set([
  "enviando",
  "em_envio",
  "processando_envio",
  "tentando_envio",
  "tentativa_envio",
  "processando",
  "em_processamento"
]);

const STATUS_ERROS_TEMPORARIOS = new Set([
  "erro_temporario",
  "erro_retry",
  "retry",
  "aguardando_retry",
  "falha_temporaria",
  "reprocessar"
]);

const STATUS_ENVIADOS = new Set([
  "enviado",
  "enviada",
  "sucesso",
  "publicado",
  "publicada"
]);

const STATUS_ERROS_FINAIS = new Set([
  "erro",
  "erro_final",
  "falha_final",
  "executor_erro_final",
  "sem_destino",
  "sem_creditos"
]);

const STATUS_CANCELADOS = new Set([
  "cancelado",
  "cancelada",
  "retida",
  "retido",
  "retida_v2",
  "bloqueado",
  "bloqueada"
]);

const STATUS_EXPIRADOS = new Set([
  "expirado",
  "expirada",
  "expirada_operacional",
  "expirado_operacional"
]);

const STATUS_HISTORICO = new Set([
  "historico",
  "histórico",
  "arquivado",
  "arquivada",
  "arquivo"
]);

const INTERVALO_TURBO_PADRAO_MINUTOS = 2.5;
const COBERTURA_PRINCIPAL_MINUTOS = 15;

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function objeto(valor) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function numero(valor, padrao = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

function numeroPositivo(valor, padrao = null) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

function arredondar(valor, casas = 2) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

function porMinuto(total, janelaMinutos) {
  return arredondar(numero(total) / Math.max(1, numero(janelaMinutos, 15)), 2);
}

function statusFila(item = {}) {
  return String(item?.status || item?.situacao || "pendente").toLowerCase().trim();
}

function classificarStatusFila(item = {}) {
  const status = statusFila(item);
  if (STATUS_PENDENTES_VIVOS.has(status)) return "pendentesVivos";
  if (STATUS_EM_TENTATIVA.has(status)) return "emTentativaEnvio";
  if (STATUS_ERROS_TEMPORARIOS.has(status)) return "errosTemporariosRecuperaveis";
  if (STATUS_ENVIADOS.has(status)) return "enviados";
  if (STATUS_ERROS_FINAIS.has(status)) return "errosFinais";
  if (STATUS_CANCELADOS.has(status)) return "cancelados";
  if (STATUS_EXPIRADOS.has(status)) return "expirados";
  if (STATUS_HISTORICO.has(status)) return "historico";
  return "pendentesVivos";
}

function itemVivoFila(item = {}) {
  return ["pendentesVivos", "emTentativaEnvio", "errosTemporariosRecuperaveis"].includes(classificarStatusFila(item));
}

function destinosDoCliente(mapa = {}, clienteId = "") {
  const bruto = mapa?.[clienteId];
  if (Array.isArray(bruto)) return bruto;
  if (bruto && typeof bruto === "object") return Object.values(bruto).filter(Array.isArray).flat();
  return [];
}

function carregarDestinosPorCliente(opcoes = {}) {
  return opcoes.destinosPorCliente || objeto(readGlobalJson("destinos_clientes.json", readGlobalJson("destinos.json", {})));
}

function carregarUsuarios(opcoes = {}) {
  if (Array.isArray(opcoes.usuarios)) return opcoes.usuarios;
  const usuarios = readGlobalJson("usuarios.json", []);
  return Array.isArray(usuarios) ? usuarios : [];
}

function usuarioPorId(usuarios = [], clienteId = "") {
  return usuarios.find(usuario => String(usuario?.id || "") === String(clienteId || "")) || null;
}

function timestampFila(item = {}) {
  const candidatos = [
    item.criadoEm,
    item.criado_em,
    item.adicionadoEm,
    item.adicionado_em,
    item.dataCriacao,
    item.createdAt,
    item.timestamp
  ];

  for (const candidato of candidatos) {
    const data = new Date(candidato || "");
    const ms = data.getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function destinoId(destino = {}, indice = 0) {
  return String(destino.id || destino.destinoId || destino.jid || destino.chatId || destino.nome || `destino_${indice + 1}`).trim();
}

function normalizarTexto(valor = "") {
  return String(valor || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function itemDestinadoAoDestino(item = {}, destino = {}, indice = 0) {
  const id = destinoId(destino, indice);
  const candidatos = [
    item.destinoId,
    item.destino_id,
    item.destino,
    item.chatId,
    item.grupoId,
    item.jid,
    item.canalId
  ].map(valor => String(valor || "").trim()).filter(Boolean);

  if (!candidatos.length) return true;
  return candidatos.includes(id);
}

function resumoFilaWorkspace(clienteId = "", opcoes = {}) {
  const lerFila = opcoes.readClienteJson || readClienteJson;
  const agora = Number(opcoes.agoraMs || Date.now());
  const fila = lista(lerFila(clienteId, "fila.json", []));
  const contagem = {
    pendentesVivos: 0,
    emTentativaEnvio: 0,
    errosTemporariosRecuperaveis: 0,
    enviados: 0,
    errosFinais: 0,
    cancelados: 0,
    expirados: 0,
    historico: 0
  };
  let maisAntigo = null;

  for (const item of fila) {
    const classe = classificarStatusFila(item);
    contagem[classe] = (contagem[classe] || 0) + 1;
    if (!itemVivoFila(item)) continue;
    const ts = timestampFila(item);
    if (ts === null) continue;
    if (maisAntigo === null || ts < maisAntigo) maisAntigo = ts;
  }

  const pressaoEsteiraViva = contagem.pendentesVivos + contagem.emTentativaEnvio + contagem.errosTemporariosRecuperaveis;
  const totalEnviadosHistorico = contagem.enviados + contagem.historico;

  return {
    itens: fila,
    quantidadeFilaAtual: pressaoEsteiraViva,
    pressaoEsteiraViva,
    pendentesVivos: contagem.pendentesVivos,
    emTentativaEnvio: contagem.emTentativaEnvio,
    errosTemporariosRecuperaveis: contagem.errosTemporariosRecuperaveis,
    enviados: contagem.enviados,
    errosFinais: contagem.errosFinais,
    cancelados: contagem.cancelados,
    expirados: contagem.expirados,
    historico: contagem.historico,
    totalEnviadosHistorico,
    idadeItemMaisAntigoFila: maisAntigo === null ? null : Math.max(0, agora - maisAntigo),
    idadeMaisAntigaViva: maisAntigo === null ? null : Math.max(0, agora - maisAntigo)
  };
}

function limiteDiarioRestante(usuario = {}) {
  const candidatos = [
    usuario.limiteDiarioRestante,
    usuario.limite_diario_restante,
    usuario.creditosRestantesDia,
    usuario.creditosDiaRestantes
  ];
  for (const candidato of candidatos) {
    const n = Number(candidato);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function limiteDiarioDestino(destino = {}) {
  const limite = numeroPositivo(
    destino.limiteDiario ?? destino.limite_diario ?? destino.limiteEnviosDia ?? destino.limiteDiarioEnvios,
    null
  );
  const enviadosHoje = numero(destino.enviosHoje ?? destino.enviadosHoje ?? destino.enviosRealizadosHoje, 0);
  const restanteExplicito = destino.limiteDiarioRestante ?? destino.limite_diario_restante ?? destino.enviosRestantesHoje;
  const restante = Number.isFinite(Number(restanteExplicito))
    ? Math.max(0, Number(restanteExplicito))
    : (limite === null ? null : Math.max(0, limite - enviadosHoje));
  return { limite, enviadosHoje, restante };
}

function turboAplicavelDestino(destino = {}) {
  return Boolean(
    destino.cupomTurbo === true ||
    destino.cupom_turbo === true ||
    destino.turboCupom === true ||
    destino.turbo === true ||
    normalizarTexto(destino.modoEnvio || destino.modo) === "cupomturbo"
  );
}

function intervaloTurboDestino(destino = {}) {
  return numeroPositivo(
    destino.intervaloTurboMinutos ??
    destino.intervaloCupomTurboMinutos ??
    destino.turboIntervaloMinutos ??
    destino.intervaloTurbo,
    INTERVALO_TURBO_PADRAO_MINUTOS
  );
}

function integracaoAptaDestino(destino = {}) {
  if (destino.integracaoApta === false || destino.integracao_apta === false) return false;
  if (destino.cookiesVencidos === true || destino.cookieVencido === true || destino.cookies_expirados === true) return false;
  const status = normalizarTexto(destino.statusIntegracao || destino.integracaoStatus || destino.statusSessao || destino.status);
  if (["inapta", "inapto", "vencida", "vencido", "desconectada", "desconectado", "bloqueada", "bloqueado"].includes(status)) return false;
  const erro = normalizarTexto(destino.erroIntegracao || destino.motivoInapto || destino.motivoBloqueio || "");
  if (/cookie|credencial|token|sessao/.test(erro) && /vencid|expirad|invalid|ausent|inapt/.test(erro)) return false;
  return destinoPossuiIntegracaoBasica(destino);
}

function capacidadeDestinoShadow(destino = {}, indice = 0, filaItens = []) {
  const id = destinoId(destino, indice);
  const ativo = destino?.ativo !== false;
  const integracaoApta = ativo && integracaoAptaDestino(destino);
  const janelaAbertaAgora = ativo && integracaoApta && destinosUtils.destinoDentroHorario(destino);
  const limiteDiario = limiteDiarioDestino(destino);
  const limiteOk = limiteDiario.restante === null || limiteDiario.restante > 0;
  const destinoApto = janelaAbertaAgora && limiteOk;
  const intervaloNormal = numeroIntervaloDestino(destino);
  const turboAplicavel = destinoApto && turboAplicavelDestino(destino);
  const intervaloTurbo = intervaloTurboDestino(destino);
  const intervaloEfetivo = turboAplicavel ? intervaloTurbo : intervaloNormal;
  const filaVivaDestino = lista(filaItens).filter(item => itemVivoFila(item) && itemDestinadoAoDestino(item, destino, indice)).length;

  const capacidade5 = destinoApto ? 5 / intervaloEfetivo : 0;
  const capacidade10 = destinoApto ? 10 / intervaloEfetivo : 0;
  const capacidade15 = destinoApto ? 15 / intervaloEfetivo : 0;

  return {
    destinoId: id,
    tipo: String(destino.tipo || destino.canal || "").toLowerCase(),
    destinoHabilitado: ativo,
    janelaAbertaAgora,
    integracaoApta,
    limiteDiarioConfigurado: limiteDiario.limite,
    enviosRealizadosHoje: limiteDiario.enviadosHoje,
    limiteDiarioRestante: limiteDiario.restante,
    intervaloNormal: arredondar(intervaloNormal, 2),
    intervaloTurbo: arredondar(intervaloTurbo, 2),
    turboAplicavel,
    intervaloEfetivo: arredondar(intervaloEfetivo, 2),
    filaVivaDestino,
    capacidade5Min: arredondar(capacidade5, 2),
    capacidade10Min: arredondar(capacidade10, 2),
    capacidade15Min: arredondar(capacidade15, 2),
    aptoAgora: destinoApto
  };
}

function metricasEventosWorkspace(linhas = []) {
  const mapa = new Map();
  for (const linha of lista(linhas)) {
    const id = String(linha.workspace_id || linha.cliente_id || "").trim();
    if (!id) continue;
    mapa.set(id, {
      ofertasCriadas: numero(linha.ofertas_criadas),
      itensAdicionadosFila: numero(linha.itens_adicionados_fila),
      distribuicoesFinais: numero(linha.distribuicoes_finais),
      enviosConfirmados: numero(linha.envios_confirmados),
      enviosErroFinal: numero(linha.envios_erro_final)
    });
  }
  return mapa;
}

function avaliarDestinosWorkspace(destinos = [], janelaMinutos = 15, filaItens = []) {
  const capacidadePorDestino = lista(destinos).map((destino, indice) => capacidadeDestinoShadow(destino, indice, filaItens));
  const destinosAtivos = capacidadePorDestino.filter(item => item.destinoHabilitado).length;
  const integracoesAptas = capacidadePorDestino.filter(item => item.integracaoApta).length;
  const destinosAptos = capacidadePorDestino.filter(item => item.aptoAgora).length;
  const destinosFechados = capacidadePorDestino.length - destinosAptos;
  const filaAlvo5Min = arredondar(capacidadePorDestino.reduce((total, item) => total + item.capacidade5Min, 0), 2);
  const filaAlvo10Min = arredondar(capacidadePorDestino.reduce((total, item) => total + item.capacidade10Min, 0), 2);
  const filaAlvo15Min = arredondar(capacidadePorDestino.reduce((total, item) => total + item.capacidade15Min, 0), 2);

  return {
    destinosAtivos,
    integracoesAptas,
    destinosAptos,
    destinosFechados,
    janelaAbertaAgora: destinosAptos > 0,
    automacaoAtiva: destinosAtivos > 0 && integracoesAptas > 0,
    capacidadePorDestino,
    filaAlvo5Min,
    filaAlvo10Min,
    filaAlvo15Min,
    capacidadeTeorica: filaAlvo15Min,
    intervaloNormal: capacidadePorDestino.find(item => item.aptoAgora)?.intervaloNormal || null,
    intervaloTurbo: capacidadePorDestino.find(item => item.turboAplicavel)?.intervaloTurbo || INTERVALO_TURBO_PADRAO_MINUTOS,
    turboAplicavel: capacidadePorDestino.some(item => item.turboAplicavel)
  };
}

function classificarEstadoEsteira({ janelaAbertaAgora, automacaoAtiva, destinosAptos, filaAlvo15Min, capacidadeUtilizada, capacidadeAbsorcaoAgora, pressaoEsteiraViva } = {}) {
  if (!automacaoAtiva) return { estado: "FECHADA", motivo: "automacao_sem_destino_ativo" };
  if (!janelaAbertaAgora || destinosAptos <= 0) return { estado: "FECHADA", motivo: "janela_fechada_ou_sem_destino_apto" };
  if (filaAlvo15Min <= 0) return { estado: "FECHADA", motivo: "capacidade_dinamica_zero" };
  if (pressaoEsteiraViva >= filaAlvo15Min || capacidadeAbsorcaoAgora <= 0) return { estado: "SATURADA", motivo: "pressao_viva_acima_da_fila_alvo" };
  if (pressaoEsteiraViva >= filaAlvo15Min * 0.7 || capacidadeAbsorcaoAgora < 1) return { estado: "LIMITADA", motivo: "pouca_capacidade_livre" };
  if (pressaoEsteiraViva > 0 || (capacidadeUtilizada !== null && capacidadeUtilizada >= 0.4)) return { estado: "ESTAVEL", motivo: "esteira_viva_com_fluxo_controlado" };
  return { estado: "LIVRE", motivo: "capacidade_dinamica_livre_para_agua_nova" };
}

function montarGateWorkspace({ clienteId = "", usuario = {}, destinos = [], fila = {}, eventos = {}, janelaMinutos = 15 } = {}) {
  const destinosResumo = avaliarDestinosWorkspace(destinos, janelaMinutos, fila.itens || []);
  const enviosUltimos15Min = numero(eventos.enviosConfirmados);
  const consumoComercialUltimos15Min = enviosUltimos15Min;
  const entradaComercialUltimos15Min = numero(eventos.ofertasCriadas);
  const saida15Min = consumoComercialUltimos15Min;
  const saldoFluxo = entradaComercialUltimos15Min - saida15Min;
  const entrandoMaisQueSaindo = saldoFluxo > 0;
  const pressaoEsteiraViva = numero(fila.pressaoEsteiraViva);
  const filaAlvoWorkspace = destinosResumo.filaAlvo15Min;
  const capacidadeAbsorcaoAgora = Math.max(0, arredondar(filaAlvoWorkspace - pressaoEsteiraViva, 2));
  const capacidadeUtilizada = filaAlvoWorkspace > 0
    ? arredondar(pressaoEsteiraViva / filaAlvoWorkspace, 2)
    : null;
  const velocidadeExecutor = porMinuto(enviosUltimos15Min, janelaMinutos);
  const tempoEstimadoEsvaziarEsteira = velocidadeExecutor > 0
    ? arredondar(pressaoEsteiraViva / velocidadeExecutor, 2)
    : null;
  const quantidadeQueAceitariaAgora = destinosResumo.janelaAbertaAgora
    ? Math.max(0, Math.floor(capacidadeAbsorcaoAgora))
    : 0;
  const quantidadeQueRecusariaAgora = quantidadeQueAceitariaAgora > 0 ? 0 : 1;
  const classificacao = classificarEstadoEsteira({
    ...destinosResumo,
    filaAlvo15Min: destinosResumo.filaAlvo15Min,
    capacidadeUtilizada,
    capacidadeAbsorcaoAgora,
    pressaoEsteiraViva
  });

  return {
    workspaceId: clienteId,
    estado: classificacao.estado,
    estadoDaEsteira: classificacao.estado,
    motivo: classificacao.motivo,
    totalEnviadosHistorico: numero(fila.totalEnviadosHistorico),
    pressaoEsteiraViva,
    pendentesVivos: numero(fila.pendentesVivos),
    emTentativaEnvio: numero(fila.emTentativaEnvio),
    errosTemporariosRecuperaveis: numero(fila.errosTemporariosRecuperaveis),
    enviados: numero(fila.enviados),
    errosFinais: numero(fila.errosFinais),
    cancelados: numero(fila.cancelados),
    expirados: numero(fila.expirados),
    historico: numero(fila.historico),
    idadeMaisAntigaViva: fila.idadeMaisAntigaViva,
    idadeItemMaisAntigoFila: fila.idadeMaisAntigaViva,
    idadeMaisAntiga: fila.idadeMaisAntigaViva,
    janelaAbertaAgora: destinosResumo.janelaAbertaAgora,
    automacaoAtiva: destinosResumo.automacaoAtiva,
    integracoesAptas: destinosResumo.integracoesAptas,
    destinosAptos: destinosResumo.destinosAptos,
    destinosFechados: destinosResumo.destinosFechados,
    limiteDiarioRestante: limiteDiarioRestante(usuario),
    quantidadeFilaAtual: pressaoEsteiraViva,
    filaAtual: pressaoEsteiraViva,
    capacidadePorDestino: destinosResumo.capacidadePorDestino,
    intervaloNormal: destinosResumo.intervaloNormal,
    intervaloTurbo: destinosResumo.intervaloTurbo,
    turboAplicavel: destinosResumo.turboAplicavel,
    velocidadeExecutor,
    enviosUltimos15Min,
    consumoComercialUltimos15Min,
    entradaComercialUltimos15Min,
    entrada15Min: entradaComercialUltimos15Min,
    saida15Min,
    saldoFluxo,
    entrandoMaisQueSaindo,
    filaAlvo5Min: destinosResumo.filaAlvo5Min,
    filaAlvo10Min: destinosResumo.filaAlvo10Min,
    filaAlvo15Min: destinosResumo.filaAlvo15Min,
    capacidadeAbsorcaoAgora,
    capacidadeTeorica: destinosResumo.capacidadeTeorica,
    capacidadeUtilizada,
    tempoEstimadoEsvaziarEsteira,
    quantidadeQueAceitariaAgora,
    quantidadeQueRecusariaAgora
  };
}

function resumirGate(workspaces = []) {
  const porEstado = {};
  let aceitariamAgora = 0;
  let recusariamAgora = 0;
  let pressaoEsteiraViva = 0;
  for (const item of lista(workspaces)) {
    porEstado[item.estado] = (porEstado[item.estado] || 0) + 1;
    aceitariamAgora += numero(item.quantidadeQueAceitariaAgora);
    recusariamAgora += numero(item.quantidadeQueRecusariaAgora);
    pressaoEsteiraViva += numero(item.pressaoEsteiraViva);
  }
  return { porEstado, aceitariamAgora, recusariamAgora, pressaoEsteiraViva };
}

async function criarGateAbsorcaoShadowOfc(opcoes = {}) {
  const inicio = Date.now();
  const janelaMinutos = Math.max(1, Math.min(120, Math.floor(Number(opcoes.janelaMinutos) || 15)));

  try {
    const consultarEventos = opcoes.consultarEventosAbsorcao || consultarEventosAbsorcaoPorWorkspace;
    const eventos = await consultarEventos({ janelaMinutos });
    if (!eventos.ok) {
      return {
        ok: false,
        modo: "shadow",
        aplicouMudancas: false,
        failSafe: true,
        motivo: eventos.motivo || "eventos_absorcao_indisponiveis",
        erro: eventos.erro || "",
        duracaoMs: Date.now() - inicio
      };
    }

    const usuarios = carregarUsuarios(opcoes);
    const clientesAtivos = typeof opcoes.listarClientesAtivos === "function"
      ? opcoes.listarClientesAtivos()
      : listarClientesAtivos({ usuarios });
    const destinosPorCliente = carregarDestinosPorCliente(opcoes);
    const eventosPorWorkspace = metricasEventosWorkspace(eventos.porWorkspace);
    const workspaces = [];

    for (const clienteId of lista(clientesAtivos)) {
      const id = String(clienteId || "").trim();
      if (!id) continue;
      workspaces.push(montarGateWorkspace({
        clienteId: id,
        usuario: usuarioPorId(usuarios, id) || {},
        destinos: destinosDoCliente(destinosPorCliente, id),
        fila: resumoFilaWorkspace(id, opcoes),
        eventos: eventosPorWorkspace.get(id) || {},
        janelaMinutos
      }));
    }

    const resumo = resumirGate(workspaces);
    return {
      ok: true,
      modo: "shadow",
      aplicouMudancas: false,
      janelaMinutos,
      totalWorkspaces: workspaces.length,
      resumo,
      workspaces,
      duracaoMs: Date.now() - inicio
    };
  } catch (e) {
    return {
      ok: false,
      modo: "shadow",
      aplicouMudancas: false,
      failSafe: true,
      motivo: "gate_absorcao_exception",
      erro: e?.message || "",
      duracaoMs: Date.now() - inicio
    };
  }
}

module.exports = {
  classificarStatusFila,
  itemVivoFila,
  resumoFilaWorkspace,
  capacidadeDestinoShadow,
  avaliarDestinosWorkspace,
  classificarEstadoEsteira,
  montarGateWorkspace,
  resumirGate,
  criarGateAbsorcaoShadowOfc
};