const crypto = require("crypto");
const { centavosMonetarios } = require("../../utils/moeda");
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
const {
  normalizarDespachoAutomatico,
  validarDespachoAutomaticoEntrada,
  ORIGEM_AGENDAMENTO_AUTOMATICO
} = require("./manual-auto-dispatch");

const ARQUIVO_OFERTAS_MANUAL_V2 = "manual_ofertas_v2.json";
const ARQUIVO_CONFIG_MANUAL_V2 = "manual_config_v2.json";
const LEASE_ENVIO_MANUAL_MS = 2 * 60 * 1000;

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

function hashIdempotencia(valor = "") {
  return texto(valor).toLowerCase();
}

function textoComercialCanonico(valor = "") {
  return String(valor ?? "")
    .normalize("NFKC")
    .replace(/[\s\u00a0]+/gu, " ")
    .trim();
}

function textoOpcionalCanonico(valor = "") {
  return textoComercialCanonico(valor);
}

function moedaCanonica(valor) {
  const centavos = centavosMonetarios(valor);
  // Valor invalido nao vira zero nem se confunde com ausencia: mantemos sua forma textual.
  return centavos === null ? { invalido: textoComercialCanonico(valor) } : { centavos };
}

function numeroComercialCanonico(valor, { percentual = false } = {}) {
  const textoValor = textoComercialCanonico(valor);
  if (!textoValor) return "";
  const limpo = percentual ? textoValor.replace(/%$/, "").trim() : textoValor;
  if (!/^\d+(?:[.,]\d+)?$/.test(limpo)) return textoValor;
  const numero = Number(limpo.replace(",", "."));
  if (!Number.isFinite(numero)) return textoValor;
  return percentual ? Number(numero.toFixed(4)) : Number.isInteger(numero) ? numero : Number(numero.toFixed(4));
}

function parcelamentoCanonico(valor) {
  const textoValor = textoComercialCanonico(valor);
  const match = textoValor.match(/^(\d+)\s*x(?:\s+de\s+(.+))?$/i);
  if (!match) return textoValor;
  const resultado = { parcelas: Number(match[1]) };
  if (match[2]) resultado.valorParcela = moedaCanonica(match[2]);
  return resultado;
}

function ordenarObjetoCanonico(valor) {
  if (Array.isArray(valor)) return valor.map(ordenarObjetoCanonico);
  if (!valor || typeof valor !== "object") return valor;
  return Object.keys(valor).sort().reduce((resultado, chave) => {
    resultado[chave] = ordenarObjetoCanonico(valor[chave]);
    return resultado;
  }, {});
}

function adicionarOpcional(dto, chave, valor, normalizar = textoOpcionalCanonico) {
  const normalizado = normalizar(valor);
  const ausente = normalizado === "" ||
    (normalizado && typeof normalizado === "object" && normalizado.invalido === "");
  if (!ausente) dto[chave] = normalizado;
}

function dtoComercialCanonicoManualV2(entrada = {}) {
  const oferta = normalizarOfertaManualV2(entrada && typeof entrada === "object" ? entrada : {}, {
    clienteId: "fingerprint",
    now: "1970-01-01T00:00:00.000Z",
    idFactory: () => "fingerprint"
  });
  const dto = { marketplace: oferta.marketplace };
  for (const campo of ["titulo", "urlOriginal", "urlAfiliada", "imagem", "categoria", "seller", "cupom", "observacoes", "condicaoPrecoPor", "condicaoPix", "frete", "moedas", "linkApp", "linkPC", "linkMoedas", "linkResgate", "produtoId", "ean", "sku", "instrucaoCupom", "beneficioTexto"]) {
    adicionarOpcional(dto, campo, oferta[campo]);
  }
  for (const campo of ["precoAtual", "precoAnterior", "precoMin", "precoMax", "precoPix", "freteValor", "taxa", "imposto"]) {
    adicionarOpcional(dto, campo, oferta[campo], moedaCanonica);
  }
  adicionarOpcional(dto, "parcelamento", oferta.parcelamento, parcelamentoCanonico);
  for (const campo of ["avaliacao", "quantidadeAvaliacoes", "vendidos"]) {
    adicionarOpcional(dto, campo, oferta[campo], numeroComercialCanonico);
  }
  adicionarOpcional(dto, "descontoPercentual", oferta.descontoPercentual, (valor) => numeroComercialCanonico(valor, { percentual: true }));
  if (oferta.temVariacaoPreco === true) dto.temVariacaoPreco = true;
  return ordenarObjetoCanonico(dto);
}

function fingerprintPayloadComercialManualV2(entrada = {}) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(dtoComercialCanonicoManualV2(entrada)))
    .digest("hex");
}

function novoAttemptId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.createHash("sha256").update(`${Date.now()}:${Math.random()}`).digest("hex").slice(0, 32);
}

function msIso(valor = "") {
  const ms = Date.parse(texto(valor));
  return Number.isFinite(ms) ? ms : 0;
}

function leaseValido(envio = {}, agoraMs = Date.now()) {
  return msIso(envio.leaseExpiraEm) > agoraMs;
}

function estadoEnvioIdempotente(valor = "") {
  const estado = texto(valor).toLowerCase();
  if (["solicitado", "processando", "concluido", "falha_confirmada", "resultado_indeterminado"].includes(estado)) return estado;
  // Compatibilidade com a primeira versao do P0: esse estado era gravado no catch antes de existir lease.
  if (estado === "erro") return "falha_confirmada";
  return "";
}

function normalizarConfigManualV2(config = {}) {
  const origem = config && typeof config === "object" ? config : {};
  const automacoes = origem.automacoesNovasOfertas || {};
  const vitrine = automacoes && typeof automacoes === "object" ? automacoes.vitrine || {} : {};

  return {
    automacoesNovasOfertas: {
      vitrine: {
        ativa: vitrine.ativa === true
      }
    },
    despachoAutomatico: normalizarDespachoAutomatico(origem.despachoAutomatico)
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
  const recebida = entrada?.config || entrada || {};
  const atual = storage.readClienteJson(id, ARQUIVO_CONFIG_MANUAL_V2, {});
  const proxima = {
    ...(atual && typeof atual === "object" ? atual : {}),
    ...(recebida && typeof recebida === "object" ? recebida : {}),
    automacoesNovasOfertas: {
      ...((atual && atual.automacoesNovasOfertas) || {}),
      ...((recebida && recebida.automacoesNovasOfertas) || {})
    }
  };
  if (recebida && Object.prototype.hasOwnProperty.call(recebida, "despachoAutomatico")) {
    validarDespachoAutomaticoEntrada(recebida.despachoAutomatico);
  }
  const config = normalizarConfigManualV2(proxima);
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

function criarOfertaManualV2Idempotente(clienteId = "admin", entrada = {}, idempotencyHash = "", deps = {}) {
  const storage = resolverDepsStorage(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const chave = hashIdempotencia(idempotencyHash);
  if (!chave) {
    return { oferta: criarOfertaManualV2(id, entrada, deps), idempotencyReplayed: false };
  }

  // Esta leitura, decisao e escrita sao sincronos no mesmo arquivo do workspace.
  // Assim, duas requisicoes no mesmo processo nao se intercalam entre reserva e criacao.
  const lista = lerListaCliente(id, deps);
  const fingerprint = fingerprintPayloadComercialManualV2(entrada);
  const existente = lista.find((oferta) =>
    hashIdempotencia(oferta?.idempotencia?.salvar?.hash) === chave
  );
  if (existente) {
    const fingerprintExistente = texto(existente?.idempotencia?.salvar?.fingerprint);
    if (!fingerprintExistente || fingerprintExistente !== fingerprint) {
      return { oferta: existente, idempotencyConflict: true, idempotencyReplayed: false };
    }
    return { oferta: existente, idempotencyReplayed: true };
  }

  const agora = storage.now();
  const oferta = normalizarOfertaManualV2(
    { ...entrada, status: STATUS_INICIAL_MANUAL_V2 },
    { clienteId: id, now: agora, idFactory: storage.idFactory }
  );
  oferta.status = STATUS_INICIAL_MANUAL_V2;
  oferta.clienteId = id;
  oferta.criadoEm = oferta.criadoEm || agora;
  oferta.atualizadoEm = agora;
  oferta.idempotencia = {
    ...(oferta.idempotencia && typeof oferta.idempotencia === "object" ? oferta.idempotencia : {}),
    salvar: { hash: chave, fingerprint, criadoEm: agora }
  };
  salvarListaCliente(id, [oferta, ...lista], deps);
  return { oferta, idempotencyReplayed: false };
}

function reservarEnvioManualV2Idempotente(clienteId = "admin", ofertaId = "", idempotencyHash = "", deps = {}) {
  const storage = resolverDepsStorage(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const alvoId = texto(ofertaId);
  const chave = hashIdempotencia(idempotencyHash);
  if (!alvoId) return { oferta: null, motivo: "oferta_manual_v2_nao_encontrada" };

  const lista = lerListaCliente(id, deps);
  const index = lista.findIndex((oferta) => String(oferta.id || "") === alvoId);
  if (index < 0) return { oferta: null, motivo: "oferta_manual_v2_nao_encontrada" };
  const existente = lista[index];
  const envioExistente = existente.idempotencia?.enviar || {};
  const estadoExistente = estadoEnvioIdempotente(envioExistente.estado);
  const agora = storage.now();
  const agoraMs = msIso(agora) || Date.now();
  const mesmaChaveRetomavel = chave && hashIdempotencia(envioExistente.hash) === chave &&
    ["solicitado", "falha_confirmada"].includes(estadoExistente);
  if (chave && hashIdempotencia(envioExistente.hash) === chave) {
    if (estadoExistente === "concluido") return { oferta: existente, idempotencyReplayed: true, estado: "concluido" };
    if (estadoExistente === "resultado_indeterminado") {
      return { oferta: existente, motivo: "manual_v2_envio_resultado_indeterminado", estado: estadoExistente };
    }
    if (["solicitado", "processando"].includes(estadoExistente) && leaseValido(envioExistente, agoraMs)) {
      return { oferta: existente, idempotencyReplayed: true, estado: estadoExistente, envioEmAndamento: true };
    }
    if (estadoExistente === "processando") {
      const indeterminada = {
        ...existente,
        status: "erro",
        atualizadoEm: agora,
        idempotencia: {
          ...(existente.idempotencia || {}),
          enviar: { ...envioExistente, estado: "resultado_indeterminado", atualizadoEm: agora, motivoSeguro: "lease_expirada_apos_inicio_externo" }
        }
      };
      const proximaLista = [...lista];
      proximaLista[index] = indeterminada;
      salvarListaCliente(id, proximaLista, deps);
      return { oferta: indeterminada, motivo: "manual_v2_envio_resultado_indeterminado", estado: "resultado_indeterminado" };
    }
    // "solicitado" e "falha_confirmada" sao anteriores ao dispatcher. O retry e explicito, nunca automatico.
    if (!["solicitado", "falha_confirmada"].includes(estadoExistente)) {
      return { oferta: existente, motivo: "manual_v2_envio_resultado_indeterminado", estado: estadoExistente || "resultado_indeterminado" };
    }
  }
  // Ofertas legadas marcadas somente como "enviando" não carregam uma tentativa
  // idempotente. Esse é um processamento conhecido em curso, não evidência de
  // resultado externo indeterminado; preservamos o contrato histórico de bloqueio.
  if (existente.status === "enviando" && !estadoExistente) {
    return { oferta: existente, motivo: "oferta_manual_v2_ja_enviando" };
  }
  if (existente.status === "enviando" && leaseValido(envioExistente, agoraMs)) {
    return { oferta: existente, motivo: "oferta_manual_v2_ja_enviando" };
  }
  if (existente.status === "enviando" && !mesmaChaveRetomavel) {
    return { oferta: existente, motivo: "manual_v2_envio_resultado_indeterminado", estado: "resultado_indeterminado" };
  }

  const leaseExpiraEm = new Date(agoraMs + LEASE_ENVIO_MANUAL_MS).toISOString();
  const proximaOferta = {
    ...existente,
    status: "enviando",
    atualizadoEm: agora,
    idempotencia: {
      ...(existente.idempotencia && typeof existente.idempotencia === "object" ? existente.idempotencia : {}),
      ...(chave ? { enviar: {
        hash: chave,
        attemptId: novoAttemptId(),
        estado: "solicitado",
        solicitadoEm: agora,
        leaseIniciadoEm: agora,
        leaseExpiraEm,
        atualizadoEm: agora,
        motivoSeguro: ""
      } } : {})
    }
  };
  const proximaLista = [...lista];
  proximaLista[index] = proximaOferta;
  salvarListaCliente(id, proximaLista, deps);
  return { oferta: proximaOferta, idempotencyReplayed: false, estado: "solicitado", envioEmAndamento: false };
}

function iniciarProcessamentoEnvioManualV2Idempotente(clienteId = "admin", ofertaId = "", attemptId = "", deps = {}) {
  const storage = resolverDepsStorage(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const alvoId = texto(ofertaId);
  const alvoAttemptId = texto(attemptId);
  if (!alvoId || !alvoAttemptId) return null;
  const lista = lerListaCliente(id, deps);
  const index = lista.findIndex((oferta) => String(oferta.id || "") === alvoId);
  if (index < 0) return null;
  const existente = lista[index];
  const envio = existente?.idempotencia?.enviar || {};
  if (texto(envio.attemptId) !== alvoAttemptId || estadoEnvioIdempotente(envio.estado) !== "solicitado") return null;
  const agora = storage.now();
  const proximaOferta = {
    ...existente,
    atualizadoEm: agora,
    idempotencia: {
      ...(existente.idempotencia || {}),
      enviar: { ...envio, estado: "processando", iniciadoEm: agora, atualizadoEm: agora }
    }
  };
  const proximaLista = [...lista];
  proximaLista[index] = proximaOferta;
  salvarListaCliente(id, proximaLista, deps);
  return proximaOferta;
}

function marcarFalhaConfirmadaEnvioManualV2Idempotente(clienteId = "admin", ofertaId = "", attemptId = "", motivoSeguro = "", deps = {}) {
  const storage = resolverDepsStorage(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const alvoId = texto(ofertaId);
  const alvoAttemptId = texto(attemptId);
  if (!alvoId || !alvoAttemptId) return null;
  const lista = lerListaCliente(id, deps);
  const index = lista.findIndex((oferta) => String(oferta.id || "") === alvoId);
  if (index < 0) return null;
  const existente = lista[index];
  const envio = existente?.idempotencia?.enviar || {};
  if (texto(envio.attemptId) !== alvoAttemptId || estadoEnvioIdempotente(envio.estado) !== "solicitado") return null;
  const agora = storage.now();
  const proximaOferta = {
    ...existente,
    status: "erro",
    atualizadoEm: agora,
    idempotencia: {
      ...(existente.idempotencia || {}),
      enviar: {
        ...envio,
        estado: "falha_confirmada",
        concluidoEm: agora,
        atualizadoEm: agora,
        motivoSeguro: texto(motivoSeguro).slice(0, 120) || "falha_antes_do_dispatcher"
      }
    }
  };
  const proximaLista = [...lista];
  proximaLista[index] = proximaOferta;
  salvarListaCliente(id, proximaLista, deps);
  return proximaOferta;
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

function removerOfertasManuaisPorStatusV2(clienteId = "admin", status = "", deps = {}) {
  const id = resolverDepsStorage(deps).normalizarClienteId(clienteId || "admin");
  const statusAlvo = String(status || "").trim();
  if (!statusAlvo) return { removidas: 0 };

  const lista = lerListaCliente(id, deps);
  const proxima = lista.filter((oferta) => oferta.status !== statusAlvo);
  const removidas = lista.length - proxima.length;
  if (removidas > 0) salvarListaCliente(id, proxima, deps);

  return { removidas };
}

function excluirOfertasManuaisSalvasV2(clienteId = "admin", deps = {}) {
  return removerOfertasManuaisPorStatusV2(clienteId, "salva", deps);
}

function limparHistoricoManualV2(clienteId = "admin", deps = {}) {
  return removerOfertasManuaisPorStatusV2(clienteId, "enviada", deps);
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

  if (metadados.idempotenciaEnvio && typeof metadados.idempotenciaEnvio === "object") {
    proximaOferta.idempotencia = {
      ...(existente.idempotencia && typeof existente.idempotencia === "object" ? existente.idempotencia : {}),
      enviar: {
        ...(existente.idempotencia?.enviar && typeof existente.idempotencia.enviar === "object" ? existente.idempotencia.enviar : {}),
        ...metadados.idempotenciaEnvio
      }
    };
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
      "agendamentoErroResumo",
      "origemAgendamento"
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
    origemAgendamento: texto(dados.origemAgendamento) === ORIGEM_AGENDAMENTO_AUTOMATICO
      ? ORIGEM_AGENDAMENTO_AUTOMATICO
      : "",
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

function agendarOfertaManualV2Automaticamente(clienteId = "admin", ofertaId = "", dados = {}, deps = {}) {
  return alterarOfertaManualV2(clienteId, ofertaId, (existente, agora) => {
    if (normalizarStatusManualV2(existente.status) !== STATUS_INICIAL_MANUAL_V2) return null;
    const agendamento = dadosAgendamentoManualV2({
      ...dados,
      origemAgendamento: ORIGEM_AGENDAMENTO_AUTOMATICO
    }, agora);
    return {
      ...limparLockAgendamento(existente),
      ...agendamento,
      status: "agendada",
      agendamentoCriadoEm: agora,
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
      origemAgendamento: "",
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
  criarOfertaManualV2Idempotente,
  fingerprintPayloadComercialManualV2,
  reservarEnvioManualV2Idempotente,
  iniciarProcessamentoEnvioManualV2Idempotente,
  marcarFalhaConfirmadaEnvioManualV2Idempotente,
  atualizarOfertaManualV2,
  excluirOfertaManualV2,
  excluirOfertasManuaisSalvasV2,
  limparHistoricoManualV2,
  atualizarMetadadosEnvioManualV2,
  atualizarMetadadosAgendamentoManualV2,
  marcarOfertaManualV2Agendada,
  agendarOfertaManualV2Automaticamente,
  reprogramarOfertaManualV2Agendada,
  cancelarAgendamentoOfertaManualV2,
  sanitizarDestinoAgendado
};
