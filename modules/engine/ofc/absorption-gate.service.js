const { readGlobalJson, readClienteJson } = require("../../../utils/storage");
const { listarClientesAtivos } = require("../../../utils/usuarios-atividade");
const destinosUtils = require("../../../utils/destinos");
const {
  destinoPossuiIntegracaoBasica,
  numeroIntervaloDestino
} = require("./commercial-capacity.service");
const { consultarEventosAbsorcaoPorWorkspace } = require("./absorption-gate.repository");

const STATUS_FILA_TERMINAIS = new Set([
  "enviado",
  "retida",
  "retido",
  "retida_v2",
  "erro",
  "cancelado",
  "cancelada",
  "expirado",
  "expirada"
]);

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

function arredondar(valor, casas = 2) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

function porMinuto(total, janelaMinutos) {
  return arredondar(numero(total) / Math.max(1, numero(janelaMinutos, 15)), 2);
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

function filaPendente(item = {}) {
  const status = String(item?.status || "pendente").toLowerCase().trim();
  return !STATUS_FILA_TERMINAIS.has(status);
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

function resumoFilaWorkspace(clienteId = "", opcoes = {}) {
  const lerFila = opcoes.readClienteJson || readClienteJson;
  const agora = Number(opcoes.agoraMs || Date.now());
  const fila = lista(lerFila(clienteId, "fila.json", []));
  const pendentes = fila.filter(filaPendente);
  let maisAntigo = null;

  for (const item of pendentes) {
    const ts = timestampFila(item);
    if (ts === null) continue;
    if (maisAntigo === null || ts < maisAntigo) maisAntigo = ts;
  }

  return {
    quantidadeFilaAtual: pendentes.length,
    idadeItemMaisAntigoFila: maisAntigo === null ? null : Math.max(0, agora - maisAntigo)
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

function avaliarDestinosWorkspace(destinos = [], janelaMinutos = 15) {
  let ativos = 0;
  let integracoesAptas = 0;
  let destinosAptos = 0;
  let capacidadeTeorica = 0;

  for (const destino of lista(destinos)) {
    if (!destino || destino.ativo === false) continue;
    ativos += 1;
    if (!destinoPossuiIntegracaoBasica(destino)) continue;
    integracoesAptas += 1;
    if (!destinosUtils.destinoDentroHorario(destino)) continue;
    destinosAptos += 1;
    capacidadeTeorica += janelaMinutos / numeroIntervaloDestino(destino);
  }

  return {
    destinosAtivos: ativos,
    integracoesAptas,
    destinosAptos,
    janelaAbertaAgora: destinosAptos > 0,
    automacaoAtiva: ativos > 0 && integracoesAptas > 0,
    capacidadeTeorica: arredondar(capacidadeTeorica, 2)
  };
}

function classificarEstadoEsteira({ janelaAbertaAgora, automacaoAtiva, destinosAptos, capacidadeTeorica, capacidadeUtilizada, capacidadeLivre, quantidadeFilaAtual } = {}) {
  if (!automacaoAtiva) return { estado: "FECHADA", motivo: "automacao_sem_destino_ativo" };
  if (!janelaAbertaAgora || destinosAptos <= 0) return { estado: "FECHADA", motivo: "janela_fechada_ou_sem_destino_apto" };
  if (capacidadeTeorica <= 0) return { estado: "FECHADA", motivo: "capacidade_teorica_zero" };
  if (capacidadeLivre <= 0 || quantidadeFilaAtual >= capacidadeTeorica) return { estado: "SATURADA", motivo: "fila_ocupa_capacidade_da_janela" };
  if (capacidadeUtilizada !== null && capacidadeUtilizada >= 0.8) return { estado: "LIMITADA", motivo: "capacidade_utilizada_alta" };
  if (quantidadeFilaAtual >= capacidadeTeorica * 0.6) return { estado: "LIMITADA", motivo: "fila_proxima_da_capacidade" };
  if (quantidadeFilaAtual > 0 || (capacidadeUtilizada !== null && capacidadeUtilizada >= 0.4)) return { estado: "ESTAVEL", motivo: "esteira_com_fluxo_controlado" };
  return { estado: "LIVRE", motivo: "capacidade_livre_para_agua_nova" };
}

function montarGateWorkspace({ clienteId = "", usuario = {}, destinos = [], fila = {}, eventos = {}, janelaMinutos = 15 } = {}) {
  const destinosResumo = avaliarDestinosWorkspace(destinos, janelaMinutos);
  const enviosUltimos15Min = numero(eventos.enviosConfirmados);
  const consumoComercialUltimos15Min = enviosUltimos15Min;
  const entradaComercialUltimos15Min = numero(eventos.ofertasCriadas);
  const capacidadeTeorica = destinosResumo.capacidadeTeorica;
  const capacidadeUtilizada = capacidadeTeorica > 0
    ? arredondar(consumoComercialUltimos15Min / capacidadeTeorica, 2)
    : null;
  const capacidadeLivre = Math.max(0, arredondar(capacidadeTeorica - numero(fila.quantidadeFilaAtual), 2));
  const quantidadeQueAceitariaAgora = destinosResumo.janelaAbertaAgora
    ? Math.max(0, Math.floor(capacidadeLivre))
    : 0;
  const quantidadeQueRecusariaAgora = quantidadeQueAceitariaAgora > 0 ? 0 : 1;
  const classificacao = classificarEstadoEsteira({
    ...destinosResumo,
    capacidadeUtilizada,
    capacidadeLivre,
    quantidadeFilaAtual: numero(fila.quantidadeFilaAtual)
  });

  return {
    workspaceId: clienteId,
    estado: classificacao.estado,
    estadoDaEsteira: classificacao.estado,
    motivo: classificacao.motivo,
    janelaAbertaAgora: destinosResumo.janelaAbertaAgora,
    automacaoAtiva: destinosResumo.automacaoAtiva,
    integracoesAptas: destinosResumo.integracoesAptas,
    destinosAptos: destinosResumo.destinosAptos,
    limiteDiarioRestante: limiteDiarioRestante(usuario),
    quantidadeFilaAtual: numero(fila.quantidadeFilaAtual),
    filaAtual: numero(fila.quantidadeFilaAtual),
    idadeItemMaisAntigoFila: fila.idadeItemMaisAntigoFila,
    idadeMaisAntiga: fila.idadeItemMaisAntigoFila,
    velocidadeExecutor: porMinuto(enviosUltimos15Min, janelaMinutos),
    enviosUltimos15Min,
    consumoComercialUltimos15Min,
    entradaComercialUltimos15Min,
    capacidadeAbsorcaoAgora: quantidadeQueAceitariaAgora,
    capacidadeTeorica,
    capacidadeUtilizada,
    capacidadeLivre,
    quantidadeQueAceitariaAgora,
    quantidadeQueRecusariaAgora
  };
}

function resumirGate(workspaces = []) {
  const porEstado = {};
  let aceitariamAgora = 0;
  let recusariamAgora = 0;
  for (const item of lista(workspaces)) {
    porEstado[item.estado] = (porEstado[item.estado] || 0) + 1;
    aceitariamAgora += numero(item.quantidadeQueAceitariaAgora);
    recusariamAgora += numero(item.quantidadeQueRecusariaAgora);
  }
  return { porEstado, aceitariamAgora, recusariamAgora };
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
  avaliarDestinosWorkspace,
  classificarEstadoEsteira,
  montarGateWorkspace,
  resumirGate,
  criarGateAbsorcaoShadowOfc
};