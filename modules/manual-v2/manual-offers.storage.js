const {
  readClienteJson,
  writeClienteJson,
  normalizarClienteId
} = require("../../utils/storage");
const {
  normalizarOfertaManualV2,
  STATUS_INICIAL_MANUAL_V2,
  normalizarStatusManualV2
} = require("./manual-offers.contract");

const ARQUIVO_OFERTAS_MANUAL_V2 = "manual_ofertas_v2.json";
const ARQUIVO_CONFIG_MANUAL_V2 = "manual_config_v2.json";

function agoraIso() {
  return new Date().toISOString();
}

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function inteiro(valor = 0) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? Math.floor(numero) : 0;
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function isoInequivoco(valor = "") {
  const textoData = texto(valor);
  if (!textoData) return "";
  const ms = Date.parse(textoData);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

function listaTexto(valor) {
  return lista(valor)
    .map(texto)
    .filter(Boolean);
}

function normalizarConfigManualV2(config = {}) {
  const automacoes = config && typeof config === "object" ? config.automacoesNovasOfertas || {} : {};
  const vitrine = automacoes && typeof automacoes === "object" ? automacoes.vitrine || {} : {};

  return {
    automacoesNovasOfertas: {
      vitrine: {
        ativa: vitrine.ativa === true
      }
    }
  };
}

function sanitizarDestinoEscolhido(destino = {}) {
  const tipo = texto(destino.tipo).toLowerCase();
  return {
    id: texto(destino.id || destino.destinoId),
    nome: texto(destino.nome),
    tipo: tipo === "telegram" || tipo === "discord" ? tipo : "whatsapp",
    ativo: destino.ativo !== false,
    utilizavel: destino.utilizavel === true,
    motivoIndisponivel: texto(destino.motivoIndisponivel),
    identificacaoVisual: texto(destino.identificacaoVisual)
  };
}

function sanitizarDestinoAgendado(destino = {}) {
  const sanitizado = sanitizarDestinoEscolhido(destino);
  return {
    id: sanitizado.id,
    nome: sanitizado.nome,
    tipo: sanitizado.tipo,
    ativo: sanitizado.ativo,
    utilizavel: sanitizado.utilizavel,
    motivoIndisponivel: sanitizado.motivoIndisponivel,
    identificacaoVisual: sanitizado.identificacaoVisual
  };
}

function sanitizarDestinosAgendados(destinos = []) {
  return lista(destinos)
    .map(sanitizarDestinoAgendado)
    .filter((destino) => destino.id);
}

function sanitizarResultadoEnvio(resultado = {}) {
  const tipo = texto(resultado.tipo).toLowerCase();
  const tipoSanitizado = tipo === "telegram" || tipo === "discord" ? tipo : "whatsapp";
  const statusOriginal = texto(resultado.status).toLowerCase() === "enviado" ? "enviado" : "erro";
  const messageId = texto(resultado.messageId).slice(0, 200);
  const statusHttp = Number(resultado.statusHttp || 0) || 0;
  const discordComSucessoForte = tipoSanitizado !== "discord" ||
    statusOriginal !== "enviado" ||
    (messageId && statusHttp >= 200 && statusHttp < 300);
  const status = discordComSucessoForte ? statusOriginal : "erro";
  const erroDiscord = statusOriginal === "enviado" && tipoSanitizado === "discord" && status === "erro"
    ? (statusHttp > 0 && (statusHttp < 200 || statusHttp >= 300)
      ? "discord_status_http_invalido"
      : "discord_resposta_sem_message_id")
    : "";
  const sanitizado = {
    destinoId: texto(resultado.destinoId),
    nome: texto(resultado.nome),
    tipo: tipoSanitizado,
    status,
    enviadoEm: texto(resultado.enviadoEm),
    erro: status === "erro" ? texto(resultado.erro || erroDiscord).slice(0, 500) : ""
  };

  if (tipoSanitizado === "discord") {
    if (messageId) sanitizado.messageId = messageId;
    if (statusHttp > 0) sanitizado.statusHttp = statusHttp;
    if (typeof resultado.imagemEnviada === "boolean") {
      sanitizado.imagemEnviada = resultado.imagemEnviada;
    }
  }

  return sanitizado;
}

function sanitizarEnvioManual(envioManual = {}) {
  const resultados = lista(envioManual.resultados)
    .map(sanitizarResultadoEnvio)
    .filter((resultado) => resultado.destinoId || resultado.erro);
  const enviadosSanitizados = resultados.filter((resultado) => resultado.status === "enviado").length;
  const errosSanitizados = resultados.filter((resultado) => resultado.status === "erro").length;
  const usarContagemSanitizada = resultados.length > 0;

  return {
    solicitadoEm: texto(envioManual.solicitadoEm),
    concluidoEm: texto(envioManual.concluidoEm),
    destinosEscolhidos: lista(envioManual.destinosEscolhidos)
      .map(sanitizarDestinoEscolhido)
      .filter((destino) => destino.id),
    resultados,
    enviados: usarContagemSanitizada ? enviadosSanitizados : inteiro(envioManual.enviados),
    erros: usarContagemSanitizada ? errosSanitizados : inteiro(envioManual.erros),
    creditosDebitados: usarContagemSanitizada
      ? Math.min(inteiro(envioManual.creditosDebitados), enviadosSanitizados)
      : inteiro(envioManual.creditosDebitados),
    erroResumo: texto(envioManual.erroResumo).slice(0, 1000)
  };
}

function resolverDepsStorage(deps = {}) {
  return {
    readClienteJson: deps.readClienteJson || readClienteJson,
    writeClienteJson: deps.writeClienteJson || writeClienteJson,
    normalizarClienteId: deps.normalizarClienteId || normalizarClienteId,
    now: deps.now || agoraIso,
    idFactory: deps.idFactory
  };
}

function lerListaCliente(clienteId = "admin", deps = {}) {
  const storage = resolverDepsStorage(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const dados = storage.readClienteJson(id, ARQUIVO_OFERTAS_MANUAL_V2, []);
  const lista = Array.isArray(dados) ? dados : [];

  return lista.filter((oferta) =>
    oferta &&
    typeof oferta === "object" &&
    String(oferta.clienteId || "") === String(id)
  );
}

function salvarListaCliente(clienteId = "admin", lista = [], deps = {}) {
  const storage = resolverDepsStorage(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const normalizada = Array.isArray(lista)
    ? lista.map((oferta) => ({ ...oferta, clienteId: id }))
    : [];

  storage.writeClienteJson(id, ARQUIVO_OFERTAS_MANUAL_V2, normalizada);
  return normalizada;
}

function listarOfertasManuaisV2(clienteId = "admin", deps = {}) {
  return lerListaCliente(clienteId, deps);
}

function lerConfigManualV2(clienteId = "admin", deps = {}) {
  const storage = resolverDepsStorage(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const config = storage.readClienteJson(id, ARQUIVO_CONFIG_MANUAL_V2, {});
  return normalizarConfigManualV2(config);
}

function salvarConfigManualV2(clienteId = "admin", entrada = {}, deps = {}) {
  const storage = resolverDepsStorage(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const config = normalizarConfigManualV2(entrada?.config || entrada || {});
  storage.writeClienteJson(id, ARQUIVO_CONFIG_MANUAL_V2, config);
  return config;
}

function buscarOfertaManualV2(clienteId = "admin", ofertaId = "", deps = {}) {
  const id = String(ofertaId || "").trim();
  if (!id) return null;

  return listarOfertasManuaisV2(clienteId, deps)
    .find((oferta) => String(oferta.id || "") === id) || null;
}

function criarOfertaManualV2(clienteId = "admin", entrada = {}, deps = {}) {
  const storage = resolverDepsStorage(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const agora = storage.now();
  const lista = lerListaCliente(id, deps);
  const oferta = normalizarOfertaManualV2(
    {
      ...entrada,
      status: STATUS_INICIAL_MANUAL_V2
    },
    {
      clienteId: id,
      now: agora,
      idFactory: storage.idFactory
    }
  );

  oferta.status = STATUS_INICIAL_MANUAL_V2;
  oferta.clienteId = id;
  oferta.criadoEm = oferta.criadoEm || agora;
  oferta.atualizadoEm = agora;

  salvarListaCliente(id, [oferta, ...lista], deps);
  return oferta;
}

function atualizarOfertaManualV2(clienteId = "admin", ofertaId = "", alteracoes = {}, deps = {}) {
  const storage = resolverDepsStorage(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const alvoId = String(ofertaId || "").trim();
  if (!alvoId) return null;

  const lista = lerListaCliente(id, deps);
  const index = lista.findIndex((oferta) => String(oferta.id || "") === alvoId);
  if (index < 0) return null;

  const existente = lista[index];
  const agora = storage.now();
  const normalizada = normalizarOfertaManualV2(
    {
      ...existente,
      ...alteracoes,
      id: existente.id,
      clienteId: id,
      criadoEm: existente.criadoEm,
      atualizadoEm: agora
    },
    {
      clienteId: id,
      now: agora,
      idFactory: () => existente.id
    }
  );

  normalizada.id = existente.id;
  normalizada.clienteId = id;
  normalizada.criadoEm = existente.criadoEm;
  normalizada.atualizadoEm = agora;

  const proxima = [...lista];
  proxima[index] = normalizada;
  salvarListaCliente(id, proxima, deps);
  return normalizada;
}

function excluirOfertaManualV2(clienteId = "admin", ofertaId = "", deps = {}) {
  const id = resolverDepsStorage(deps).normalizarClienteId(clienteId || "admin");
  const alvoId = String(ofertaId || "").trim();
  if (!alvoId) return false;

  const lista = lerListaCliente(id, deps);
  const proxima = lista.filter((oferta) => String(oferta.id || "") !== alvoId);
  if (proxima.length === lista.length) return false;

  salvarListaCliente(id, proxima, deps);
  return true;
}

function atualizarMetadadosEnvioManualV2(clienteId = "admin", ofertaId = "", metadados = {}, deps = {}) {
  const storage = resolverDepsStorage(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const alvoId = String(ofertaId || "").trim();
  if (!alvoId) return null;

  const listaOfertas = lerListaCliente(id, deps);
  const index = listaOfertas.findIndex((oferta) => String(oferta.id || "") === alvoId);
  if (index < 0) return null;

  const existente = listaOfertas[index];
  const agora = storage.now();
  const proximaOferta = {
    ...existente,
    clienteId: id,
    status: normalizarStatusManualV2(metadados.status || existente.status),
    atualizadoEm: agora
  };

  if (Object.prototype.hasOwnProperty.call(metadados, "enviadoEm")) {
    const enviadoEm = texto(metadados.enviadoEm);
    if (enviadoEm) {
      proximaOferta.enviadoEm = enviadoEm;
    } else {
      delete proximaOferta.enviadoEm;
    }
  }

  if (metadados.envioManual && typeof metadados.envioManual === "object") {
    proximaOferta.envioManual = sanitizarEnvioManual(metadados.envioManual);
    if (proximaOferta.status === "enviada" && proximaOferta.envioManual.enviados < 1) {
      proximaOferta.status = "erro";
      delete proximaOferta.enviadoEm;
    }
  }

  const proximaLista = [...listaOfertas];
  proximaLista[index] = proximaOferta;
  salvarListaCliente(id, proximaLista, deps);
  return proximaOferta;
}

function atualizarMetadadosAgendamentoManualV2(clienteId = "admin", ofertaId = "", metadados = {}, deps = {}) {
  return alterarOfertaManualV2(clienteId, ofertaId, (existente, agora) => {
    const proximaOferta = {
      ...existente,
      status: normalizarStatusManualV2(metadados.status || existente.status),
      agendamentoTentativas: Object.prototype.hasOwnProperty.call(metadados, "agendamentoTentativas")
        ? inteiro(metadados.agendamentoTentativas)
        : inteiro(existente.agendamentoTentativas)
    };

    for (const campo of [
      "agendadoPara",
      "agendamentoTimezone",
      "agendamentoLocal",
      "agendamentoCriadoEm",
      "agendamentoAtualizadoEm",
      "agendamentoCanceladoEm",
      "agendamentoLockId",
      "agendamentoLockEm",
      "agendamentoErroResumo"
    ]) {
      if (Object.prototype.hasOwnProperty.call(metadados, campo)) {
        const valor = texto(metadados[campo]);
        proximaOferta[campo] = campo === "agendamentoErroResumo" ? valor.slice(0, 1000) : valor;
      }
    }

    if (Object.prototype.hasOwnProperty.call(metadados, "destinosIds")) {
      proximaOferta.destinosIds = listaTexto(metadados.destinosIds);
    }

    if (Object.prototype.hasOwnProperty.call(metadados, "destinosAgendados")) {
      proximaOferta.destinosAgendados = sanitizarDestinosAgendados(metadados.destinosAgendados);
    }

    if (Object.prototype.hasOwnProperty.call(metadados, "limparLock") && metadados.limparLock) {
      delete proximaOferta.agendamentoLockId;
      delete proximaOferta.agendamentoLockEm;
    }

    proximaOferta.agendamentoAtualizadoEm = texto(proximaOferta.agendamentoAtualizadoEm) || agora;
    return proximaOferta;
  }, deps);
}

function alterarOfertaManualV2(clienteId = "admin", ofertaId = "", alterar, deps = {}) {
  const storage = resolverDepsStorage(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const alvoId = texto(ofertaId);
  if (!alvoId) return null;

  const listaOfertas = lerListaCliente(id, deps);
  const index = listaOfertas.findIndex((oferta) => String(oferta.id || "") === alvoId);
  if (index < 0) return null;

  const existente = listaOfertas[index];
  const agora = storage.now();
  const proximaOferta = alterar({ ...existente }, agora, id);
  if (!proximaOferta) return null;

  proximaOferta.id = existente.id;
  proximaOferta.clienteId = id;
  proximaOferta.criadoEm = existente.criadoEm;
  proximaOferta.atualizadoEm = agora;

  const proximaLista = [...listaOfertas];
  proximaLista[index] = proximaOferta;
  salvarListaCliente(id, proximaLista, deps);
  return proximaOferta;
}

function bloquearAgendamentoSeStatusFinal(status = "") {
  const atual = normalizarStatusManualV2(status);
  if (atual === "enviando" || atual === "enviada") {
    const erro = new Error("oferta_manual_v2_agendamento_status_bloqueado");
    erro.codigo = "oferta_manual_v2_agendamento_status_bloqueado";
    throw erro;
  }
}

function limparLockAgendamento(oferta = {}) {
  const proxima = { ...oferta };
  delete proxima.agendamentoLockId;
  delete proxima.agendamentoLockEm;
  return proxima;
}

function dadosAgendamentoManualV2(dados = {}, agora = "") {
  const agendadoPara = isoInequivoco(dados.agendadoPara);
  if (!agendadoPara) {
    const erro = new Error("manual_v2_agendamento_data_invalida");
    erro.codigo = "manual_v2_agendamento_data_invalida";
    throw erro;
  }

  return {
    agendadoPara,
    agendamentoTimezone: texto(dados.agendamentoTimezone || dados.timezone || "America/Sao_Paulo"),
    agendamentoLocal: texto(dados.agendamentoLocal || dados.horarioLocal),
    agendamentoAtualizadoEm: agora,
    destinosIds: listaTexto(dados.destinosIds),
    destinosAgendados: sanitizarDestinosAgendados(dados.destinosAgendados),
    agendamentoErroResumo: ""
  };
}

function marcarOfertaManualV2Agendada(clienteId = "admin", ofertaId = "", dados = {}, deps = {}) {
  return alterarOfertaManualV2(clienteId, ofertaId, (existente, agora) => {
    bloquearAgendamentoSeStatusFinal(existente.status);
    const agendamento = dadosAgendamentoManualV2(dados, agora);
    return {
      ...limparLockAgendamento(existente),
      ...agendamento,
      status: "agendada",
      agendamentoCriadoEm: texto(existente.agendamentoCriadoEm) || agora,
      agendamentoCanceladoEm: "",
      agendamentoTentativas: inteiro(existente.agendamentoTentativas)
    };
  }, deps);
}

function reprogramarOfertaManualV2Agendada(clienteId = "admin", ofertaId = "", dados = {}, deps = {}) {
  return alterarOfertaManualV2(clienteId, ofertaId, (existente, agora) => {
    bloquearAgendamentoSeStatusFinal(existente.status);
    const agendamento = dadosAgendamentoManualV2(dados, agora);
    return {
      ...limparLockAgendamento(existente),
      ...agendamento,
      status: "agendada",
      agendamentoCriadoEm: texto(existente.agendamentoCriadoEm) || agora,
      agendamentoCanceladoEm: "",
      agendamentoTentativas: inteiro(existente.agendamentoTentativas)
    };
  }, deps);
}

function cancelarAgendamentoOfertaManualV2(clienteId = "admin", ofertaId = "", deps = {}) {
  return alterarOfertaManualV2(clienteId, ofertaId, (existente, agora) => {
    bloquearAgendamentoSeStatusFinal(existente.status);
    const proxima = limparLockAgendamento(existente);
    return {
      ...proxima,
      status: STATUS_INICIAL_MANUAL_V2,
      agendadoPara: "",
      agendamentoTimezone: texto(proxima.agendamentoTimezone),
      agendamentoLocal: "",
      agendamentoAtualizadoEm: agora,
      agendamentoCanceladoEm: agora,
      destinosIds: [],
      destinosAgendados: [],
      agendamentoErroResumo: ""
    };
  }, deps);
}

module.exports = {
  ARQUIVO_OFERTAS_MANUAL_V2,
  ARQUIVO_CONFIG_MANUAL_V2,
  normalizarConfigManualV2,
  listarOfertasManuaisV2,
  lerConfigManualV2,
  salvarConfigManualV2,
  buscarOfertaManualV2,
  criarOfertaManualV2,
  atualizarOfertaManualV2,
  excluirOfertaManualV2,
  atualizarMetadadosEnvioManualV2,
  atualizarMetadadosAgendamentoManualV2,
  marcarOfertaManualV2Agendada,
  reprogramarOfertaManualV2Agendada,
  cancelarAgendamentoOfertaManualV2,
  sanitizarDestinoAgendado
};
