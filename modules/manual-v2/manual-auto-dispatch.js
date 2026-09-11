const INTERVALO_AUTO_MINIMO_MS = 150000;
const INTERVALO_AUTO_MAXIMO_MS = 600000;
const ORIGEM_AGENDAMENTO_AUTOMATICO = "despacho_automatico";
const {
  listarDestinosManuaisV2Async: listarDestinosManuaisV2AsyncPadrao
} = require("./manual-destinations");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function listaTexto(valor) {
  return [...new Set((Array.isArray(valor) ? valor : [])
    .map(texto)
    .filter(Boolean))];
}

function isoInequivoco(valor = "") {
  const ms = Date.parse(texto(valor));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

function intervaloAutoValido(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) &&
    Number.isInteger(numero) &&
    numero >= INTERVALO_AUTO_MINIMO_MS &&
    numero <= INTERVALO_AUTO_MAXIMO_MS;
}

function normalizarDespachoAutomatico(valor = {}) {
  const origem = valor && typeof valor === "object" ? valor : {};
  return {
    ativo: origem.ativo === true,
    destinosIds: listaTexto(origem.destinosIds),
    intervaloMs: intervaloAutoValido(origem.intervaloMs)
      ? Number(origem.intervaloMs)
      : INTERVALO_AUTO_MINIMO_MS,
    ultimoDespachoEm: isoInequivoco(origem.ultimoDespachoEm)
  };
}

function erroConfiguracao(codigo) {
  const erro = new Error(codigo);
  erro.codigo = codigo;
  erro.statusCode = 400;
  return erro;
}

function validarDespachoAutomaticoEntrada(valor = {}) {
  const origem = valor && typeof valor === "object" ? valor : {};
  if (Object.prototype.hasOwnProperty.call(origem, "intervaloMs") && !intervaloAutoValido(origem.intervaloMs)) {
    throw erroConfiguracao("manual_v2_despacho_automatico_intervalo_invalido");
  }

  const normalizado = normalizarDespachoAutomatico(origem);
  if (normalizado.ativo && !normalizado.destinosIds.length) {
    throw erroConfiguracao("manual_v2_despacho_automatico_destinos_obrigatorios");
  }
  return normalizado;
}

function configuracaoAutoValida(config = {}) {
  const auto = config && typeof config === "object" ? config.despachoAutomatico || {} : {};
  const normalizado = normalizarDespachoAutomatico(auto);
  if (normalizado.ativo !== true) return { ok: false, motivo: "despacho_automatico_inativo", auto: normalizado };
  if (!normalizado.destinosIds.length) return { ok: false, motivo: "despacho_automatico_sem_destinos", auto: normalizado };
  if (!intervaloAutoValido(auto.intervaloMs)) return { ok: false, motivo: "despacho_automatico_intervalo_invalido", auto: normalizado };
  return { ok: true, auto: normalizado };
}

function ehAgendamentoAutomatico(oferta = {}) {
  return texto(oferta.origemAgendamento) === ORIGEM_AGENDAMENTO_AUTOMATICO;
}

function ordenarElegiveis(ofertas = []) {
  return (Array.isArray(ofertas) ? ofertas : [])
    .filter((oferta) => texto(oferta.status).toLowerCase() === "salva")
    .sort((a, b) => {
      const aData = Date.parse(texto(a.criadoEm)) || 0;
      const bData = Date.parse(texto(b.criadoEm)) || 0;
      if (aData !== bData) return aData - bData;
      return texto(a.id).localeCompare(texto(b.id));
    });
}

function intervaloVencido(ultimoDespachoEm = "", intervaloMs = 0, agoraMs = Date.now()) {
  const ultimoMs = Date.parse(texto(ultimoDespachoEm));
  return !Number.isFinite(ultimoMs) || agoraMs - ultimoMs >= intervaloMs;
}

async function autorizarProximoDespachoAutomaticoCliente(clienteId = "admin", deps = {}) {
  const cliente = texto(clienteId) || "admin";
  const lerConfig = deps.lerConfigManualV2;
  const listarOfertas = deps.listarOfertasManuaisV2;
  const listarDestinos = deps.listarDestinosManuaisV2Async || listarDestinosManuaisV2AsyncPadrao;
  const agendarAutomaticamente = deps.agendarOfertaManualV2Automaticamente;
  const now = typeof deps.now === "function" ? deps.now : () => new Date().toISOString();
  const storageOptions = deps.storageOptions || {};

  if (typeof lerConfig !== "function" || typeof listarOfertas !== "function" ||
    typeof listarDestinos !== "function" || typeof agendarAutomaticamente !== "function") {
    return { ok: false, clienteId: cliente, motivo: "despacho_automatico_dependencias_ausentes" };
  }

  const config = lerConfig(cliente, storageOptions);
  const validacao = configuracaoAutoValida(config);
  if (!validacao.ok) return { ok: true, clienteId: cliente, autorizado: false, motivo: validacao.motivo };

  const ofertas = listarOfertas(cliente, storageOptions);
  if (ofertas.some((oferta) => texto(oferta.status).toLowerCase() === "agendada" && ehAgendamentoAutomatico(oferta))) {
    return { ok: true, clienteId: cliente, autorizado: false, motivo: "despacho_automatico_ja_agendado" };
  }

  const agora = isoInequivoco(now()) || new Date().toISOString();
  if (!intervaloVencido(validacao.auto.ultimoDespachoEm, validacao.auto.intervaloMs, Date.parse(agora))) {
    return { ok: true, clienteId: cliente, autorizado: false, motivo: "despacho_automatico_intervalo_ativo" };
  }

  const destinosPorCliente = typeof deps.getDestinosPorCliente === "function"
    ? deps.getDestinosPorCliente() || {}
    : deps.destinosPorCliente || {};
  const destinosDisponiveis = await listarDestinos(cliente, { ...deps, destinosPorCliente });
  const porId = new Map((Array.isArray(destinosDisponiveis) ? destinosDisponiveis : [])
    .filter((destino) => destino && destino.utilizavel === true)
    .map((destino) => [texto(destino.id), destino]));
  const destinosAgendados = validacao.auto.destinosIds.map((id) => porId.get(id)).filter(Boolean);
  if (destinosAgendados.length !== validacao.auto.destinosIds.length) {
    return { ok: true, clienteId: cliente, autorizado: false, motivo: "despacho_automatico_destino_indisponivel" };
  }

  const proxima = ordenarElegiveis(ofertas)[0];
  if (!proxima) return { ok: true, clienteId: cliente, autorizado: false, motivo: "despacho_automatico_sem_oferta_elegivel" };

  const oferta = agendarAutomaticamente(cliente, proxima.id, {
    agendadoPara: agora,
    agendamentoTimezone: "America/Sao_Paulo",
    agendamentoLocal: "",
    destinosIds: validacao.auto.destinosIds,
    destinosAgendados,
    origemAgendamento: ORIGEM_AGENDAMENTO_AUTOMATICO
  }, storageOptions);

  if (!oferta) return { ok: true, clienteId: cliente, autorizado: false, motivo: "despacho_automatico_oferta_indisponivel" };
  return { ok: true, clienteId: cliente, autorizado: true, ofertaId: oferta.id, oferta };
}

function registrarTentativaDespachoAutomatico(clienteId = "admin", resultadoOferta = {}, deps = {}) {
  const oferta = resultadoOferta && resultadoOferta.oferta || {};
  if (resultadoOferta.processado !== true || !ehAgendamentoAutomatico(oferta)) return null;
  const lerConfig = deps.lerConfigManualV2;
  const salvarConfig = deps.salvarConfigManualV2;
  if (typeof lerConfig !== "function" || typeof salvarConfig !== "function") return null;
  const storageOptions = deps.storageOptions || {};
  const agora = isoInequivoco(typeof deps.now === "function" ? deps.now() : new Date().toISOString());
  if (!agora) return null;
  const config = lerConfig(clienteId, storageOptions);
  return salvarConfig(clienteId, {
    ...config,
    despachoAutomatico: {
      ...(config.despachoAutomatico || {}),
      ultimoDespachoEm: agora
    }
  }, storageOptions);
}

module.exports = {
  INTERVALO_AUTO_MINIMO_MS,
  INTERVALO_AUTO_MAXIMO_MS,
  ORIGEM_AGENDAMENTO_AUTOMATICO,
  intervaloAutoValido,
  normalizarDespachoAutomatico,
  validarDespachoAutomaticoEntrada,
  configuracaoAutoValida,
  ehAgendamentoAutomatico,
  ordenarElegiveis,
  intervaloVencido,
  autorizarProximoDespachoAutomaticoCliente,
  registrarTentativaDespachoAutomatico
};
