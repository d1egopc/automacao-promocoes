const express = require("express");
const {
  importarUrlManualV2
} = require("./manual-import.adapters");
const storagePadrao = require("./manual-offers.storage");
const {
  listarDestinosManuaisV2Async
} = require("./manual-destinations");
const {
  enviarOfertaManualV2
} = require("./manual-dispatcher");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function statusErro(e) {
  if (e.codigo === "oferta_manual_v2_agendamento_status_bloqueado") return 409;
  return e.statusCode || e.status || 500;
}

function payloadErro(e, fallback = "manual_v2_erro") {
  return {
    ok: false,
    erro: e.codigo || e.motivo || e.message || fallback,
    motivo: e.motivo || e.codigo || e.message || fallback
  };
}

function agoraIso(deps = {}) {
  return typeof deps.now === "function" ? deps.now() : new Date().toISOString();
}

function listaTexto(valor) {
  if (!Array.isArray(valor)) return [];
  return valor
    .map((item) => texto(item))
    .filter(Boolean);
}

function timezoneValido(timezone = "") {
  const zona = texto(timezone) || "America/Sao_Paulo";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zona }).format(new Date());
    return zona;
  } catch (_e) {
    return "";
  }
}

function partesTimezone(data, timezone) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(data);
  const mapa = {};
  for (const parte of partes) {
    if (parte.type !== "literal") mapa[parte.type] = Number(parte.value);
  }
  return mapa;
}

function dataHoraLocalParaIso(dataHoraLocal = "", timezoneEntrada = "") {
  const timezone = timezoneValido(timezoneEntrada) || "America/Sao_Paulo";
  const match = texto(dataHoraLocal).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    const erro = new Error("manual_v2_agendamento_data_invalida");
    erro.statusCode = 400;
    erro.codigo = "manual_v2_agendamento_data_invalida";
    throw erro;
  }

  const alvo = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] || 0)
  };
  const utcAlvo = Date.UTC(alvo.year, alvo.month - 1, alvo.day, alvo.hour, alvo.minute, alvo.second);
  if (!Number.isFinite(utcAlvo)) {
    const erro = new Error("manual_v2_agendamento_data_invalida");
    erro.statusCode = 400;
    erro.codigo = "manual_v2_agendamento_data_invalida";
    throw erro;
  }

  let tentativa = utcAlvo;
  for (let i = 0; i < 3; i += 1) {
    const partes = partesTimezone(new Date(tentativa), timezone);
    const localComoUtc = Date.UTC(partes.year, partes.month - 1, partes.day, partes.hour, partes.minute, partes.second || 0);
    const proxima = utcAlvo - (localComoUtc - utcAlvo);
    if (Math.abs(proxima - tentativa) < 1000) {
      tentativa = proxima;
      break;
    }
    tentativa = proxima;
  }

  const conferida = partesTimezone(new Date(tentativa), timezone);
  const confere = conferida.year === alvo.year &&
    conferida.month === alvo.month &&
    conferida.day === alvo.day &&
    conferida.hour === alvo.hour &&
    conferida.minute === alvo.minute;

  if (!confere) {
    const erro = new Error("manual_v2_agendamento_data_invalida");
    erro.statusCode = 400;
    erro.codigo = "manual_v2_agendamento_data_invalida";
    throw erro;
  }

  return {
    agendadoPara: new Date(tentativa).toISOString(),
    agendamentoLocal: texto(dataHoraLocal),
    agendamentoTimezone: timezone
  };
}

function erroResumo(resultados = []) {
  return resultados
    .filter((item) => item?.status === "erro" && texto(item.erro))
    .map((item) => `${texto(item.nome || item.destinoId)}: ${texto(item.erro)}`)
    .filter(Boolean)
    .join("; ")
    .slice(0, 1000);
}

function erroStatusAgendamentoBloqueado() {
  const erro = new Error("oferta_manual_v2_agendamento_status_bloqueado");
  erro.codigo = "oferta_manual_v2_agendamento_status_bloqueado";
  erro.statusCode = 409;
  return erro;
}

function bloquearAgendamentoPorStatus(oferta = {}) {
  const status = texto(oferta.status).toLowerCase();
  if (status === "enviando" || status === "enviada") {
    throw erroStatusAgendamentoBloqueado();
  }
}

function criarRotasManualV2(deps = {}) {
  const router = express.Router();
  const getClienteId = typeof deps.getClienteId === "function" ? deps.getClienteId : () => "admin";
  const importarManual = typeof deps.importarUrlManualV2 === "function" ? deps.importarUrlManualV2 : importarUrlManualV2;
  const dispatcherManual = typeof deps.enviarOfertaManualV2 === "function" ? deps.enviarOfertaManualV2 : enviarOfertaManualV2;
  const storage = {
    listarOfertasManuaisV2: deps.listarOfertasManuaisV2 || storagePadrao.listarOfertasManuaisV2,
    buscarOfertaManualV2: deps.buscarOfertaManualV2 || storagePadrao.buscarOfertaManualV2,
    criarOfertaManualV2: deps.criarOfertaManualV2 || storagePadrao.criarOfertaManualV2,
    atualizarOfertaManualV2: deps.atualizarOfertaManualV2 || storagePadrao.atualizarOfertaManualV2,
    excluirOfertaManualV2: deps.excluirOfertaManualV2 || storagePadrao.excluirOfertaManualV2,
    atualizarMetadadosEnvioManualV2: deps.atualizarMetadadosEnvioManualV2 || storagePadrao.atualizarMetadadosEnvioManualV2,
    marcarOfertaManualV2Agendada: deps.marcarOfertaManualV2Agendada || storagePadrao.marcarOfertaManualV2Agendada,
    reprogramarOfertaManualV2Agendada: deps.reprogramarOfertaManualV2Agendada || storagePadrao.reprogramarOfertaManualV2Agendada,
    cancelarAgendamentoOfertaManualV2: deps.cancelarAgendamentoOfertaManualV2 || storagePadrao.cancelarAgendamentoOfertaManualV2
  };

  function cliente(req) {
    return getClienteId(req) || "admin";
  }

  function depsDestinos(req, clienteId) {
    const plano = typeof deps.getPlanoUsuario === "function"
      ? deps.getPlanoUsuario(req)
      : deps.plano || {};
    return {
      destinosPorCliente: deps.destinosPorCliente || {},
      configsPorCliente: deps.configsPorCliente || {},
      sessoes: deps.sessoes || {},
      statusSessao: deps.statusSessao || {},
      plano,
      discordConexoes: deps.discordConexoes || [],
      discordConexoesPorCliente: deps.discordConexoesPorCliente || {},
      discordCanaisPorConexao: deps.discordCanaisPorConexao || {},
      listarConexoesDiscord: deps.listarConexoesDiscord,
      listarCanaisDiscord: deps.listarCanaisDiscord,
      enviarDiscord: deps.enviarDiscord,
      discordSenderDisponivel: deps.discordSenderDisponivel,
      env: deps.env || process.env,
      httpClient: deps.httpClient
    };
  }

  router.get("/destinos", async (req, res) => {
    try {
      const clienteId = cliente(req);
      const destinos = await listarDestinosManuaisV2Async(clienteId, depsDestinos(req, clienteId));

      return res.json({
        ok: true,
        destinos
      });
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e, "manual_v2_destinos_falhou"));
    }
  });

  router.post("/importar", async (req, res) => {
    try {
      const clienteId = cliente(req);
      const urlOriginal = texto(req.body?.urlOriginal || req.body?.url);
      if (!urlOriginal) {
        return res.status(400).json({
          ok: false,
          erro: "url_original_obrigatoria",
          motivo: "url_original_obrigatoria"
        });
      }

      const oferta = await importarManual(urlOriginal, {
        ...(deps.importOptions || {}),
        clienteId
      });

      if (!oferta || oferta.ok === false) {
        return res.status(400).json({
          ok: false,
          erro: oferta?.erro || oferta?.motivo || "manual_v2_importacao_falhou",
          motivo: oferta?.motivo || oferta?.erro || "manual_v2_importacao_falhou",
          aviso: oferta?.aviso || ""
        });
      }

      return res.json({
        ok: true,
        oferta
      });
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e, "manual_v2_importacao_falhou"));
    }
  });

  router.get("/ofertas", (req, res) => {
    try {
      const ofertas = storage.listarOfertasManuaisV2(cliente(req), deps.storageOptions || {});
      return res.json({
        ok: true,
        ofertas
      });
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e, "manual_v2_listagem_falhou"));
    }
  });

  router.post("/ofertas", (req, res) => {
    try {
      const oferta = storage.criarOfertaManualV2(cliente(req), req.body?.oferta || req.body || {}, deps.storageOptions || {});
      return res.status(201).json({
        ok: true,
        oferta
      });
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e, "manual_v2_criacao_falhou"));
    }
  });

  router.put("/ofertas/:id", (req, res) => {
    try {
      const oferta = storage.atualizarOfertaManualV2(cliente(req), req.params.id, req.body?.oferta || req.body || {}, deps.storageOptions || {});
      if (!oferta) {
        return res.status(404).json({
          ok: false,
          erro: "oferta_manual_v2_nao_encontrada",
          motivo: "oferta_manual_v2_nao_encontrada"
        });
      }

      return res.json({
        ok: true,
        oferta
      });
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e, "manual_v2_atualizacao_falhou"));
    }
  });

  router.post("/ofertas/:id/enviar-agora", async (req, res) => {
    const clienteId = cliente(req);
    const ofertaId = texto(req.params.id);
    const destinosIds = listaTexto(req.body?.destinosIds);
    const storageOptions = deps.storageOptions || {};

    if (!destinosIds.length) {
      return res.status(400).json({
        ok: false,
        erro: "manual_v2_destinos_obrigatorios",
        motivo: "manual_v2_destinos_obrigatorios"
      });
    }

    try {
      const ofertaAtual = storage.buscarOfertaManualV2(clienteId, ofertaId, storageOptions);
      if (!ofertaAtual) {
        return res.status(404).json({
          ok: false,
          erro: "oferta_manual_v2_nao_encontrada",
          motivo: "oferta_manual_v2_nao_encontrada"
        });
      }

      if (ofertaAtual.status === "enviando") {
        return res.status(409).json({
          ok: false,
          erro: "oferta_manual_v2_ja_enviando",
          motivo: "oferta_manual_v2_ja_enviando"
        });
      }

      const solicitadoEm = agoraIso(deps);
      const plano = typeof deps.getPlanoUsuario === "function"
        ? deps.getPlanoUsuario(req)
        : deps.plano || {};
      const destinosSanitizados = await listarDestinosManuaisV2Async(clienteId, depsDestinos(req, clienteId));
      const destinosEscolhidos = destinosSanitizados.filter((destino) =>
        destinosIds.includes(destino.id)
      );

      storage.atualizarMetadadosEnvioManualV2(clienteId, ofertaId, {
        status: "enviando"
      }, storageOptions);

      const resultado = await dispatcherManual({
        clienteId,
        ofertaId,
        destinosIds
      }, {
        buscarOfertaManualV2: storage.buscarOfertaManualV2,
        storageOptions,
        destinosPorCliente: deps.destinosPorCliente || {},
        configsPorCliente: deps.configsPorCliente || {},
        sessoes: deps.sessoes || {},
        statusSessao: deps.statusSessao || {},
        plano,
        usuarioTemCreditos: deps.usuarioTemCreditos,
        debitarCreditos: deps.debitarCreditos,
        montarMensagemOferta: deps.montarMensagemOferta,
        enviarWhatsApp: deps.enviarWhatsApp,
        enviarTelegram: deps.enviarTelegram,
        listarConexoesDiscord: deps.listarConexoesDiscord,
        listarCanaisDiscord: deps.listarCanaisDiscord,
        enviarDiscord: deps.enviarDiscord,
        discordSenderDisponivel: deps.discordSenderDisponivel,
        env: deps.env || process.env,
        corrigirImagemUrl: deps.corrigirImagemUrl,
        httpClient: deps.httpClient,
        now: deps.now
      });

      const concluidoEm = agoraIso(deps);
      const algumSucesso = Number(resultado?.enviados || 0) > 0;
      const resumoErro = erroResumo(resultado?.resultados || []);
      const envioManual = {
        solicitadoEm,
        concluidoEm,
        destinosEscolhidos,
        resultados: resultado?.resultados || [],
        enviados: Number(resultado?.enviados || 0),
        erros: Number(resultado?.erros || 0),
        creditosDebitados: Number(resultado?.creditosDebitados || 0),
        erroResumo: resumoErro
      };
      const ofertaFinal = storage.atualizarMetadadosEnvioManualV2(clienteId, ofertaId, {
        status: algumSucesso ? "enviada" : "erro",
        enviadoEm: algumSucesso ? concluidoEm : "",
        envioManual
      }, storageOptions);
      const envioPersistido = ofertaFinal?.envioManual || envioManual;

      return res.status(algumSucesso ? 200 : 409).json({
        ok: algumSucesso,
        oferta: ofertaFinal,
        envio: {
          ok: algumSucesso,
          ofertaId: resultado?.ofertaId || ofertaId,
          enviados: envioPersistido.enviados,
          erros: envioPersistido.erros,
          creditosDebitados: envioPersistido.creditosDebitados,
          resultados: envioPersistido.resultados,
          erroResumo: envioPersistido.erroResumo
        }
      });
    } catch (e) {
      const concluidoEm = agoraIso(deps);
      const envioManual = {
        solicitadoEm: concluidoEm,
        concluidoEm,
        destinosEscolhidos: [],
        resultados: [{
          destinoId: "",
          nome: "",
          tipo: "",
          status: "erro",
          enviadoEm: "",
          erro: e.message || "manual_v2_envio_falhou"
        }],
        enviados: 0,
        erros: 1,
        creditosDebitados: 0,
        erroResumo: e.message || "manual_v2_envio_falhou"
      };
      storage.atualizarMetadadosEnvioManualV2(clienteId, ofertaId, {
        status: "erro",
        enviadoEm: "",
        envioManual
      }, storageOptions);
      return res.status(statusErro(e)).json(payloadErro(e, "manual_v2_envio_falhou"));
    }
  });

  async function destinosSelecionadosAgendamento(req, clienteId, destinosIds) {
    const destinosSanitizados = await listarDestinosManuaisV2Async(clienteId, depsDestinos(req, clienteId));
    const mapa = new Map(destinosSanitizados.map((destino) => [destino.id, destino]));
    const selecionados = destinosIds.map((id) => mapa.get(id)).filter(Boolean);
    const todosUtilizaveis = selecionados.length === destinosIds.length &&
      selecionados.every((destino) => destino.utilizavel === true);

    if (!todosUtilizaveis) {
      const erro = new Error("manual_v2_destino_indisponivel");
      erro.statusCode = 400;
      erro.codigo = "manual_v2_destino_indisponivel";
      throw erro;
    }

    return selecionados;
  }

  async function dadosAgendamento(req, clienteId) {
    const destinosIds = listaTexto(req.body?.destinosIds);
    if (!destinosIds.length) {
      const erro = new Error("manual_v2_destinos_obrigatorios");
      erro.statusCode = 400;
      erro.codigo = "manual_v2_destinos_obrigatorios";
      throw erro;
    }

    const tempo = dataHoraLocalParaIso(req.body?.dataHoraLocal, req.body?.timezone || "America/Sao_Paulo");
    const agendadoMs = Date.parse(tempo.agendadoPara);
    const agoraMs = Date.parse(agoraIso(deps));
    if (!Number.isFinite(agendadoMs) || agendadoMs <= agoraMs) {
      const erro = new Error("manual_v2_agendamento_no_passado");
      erro.statusCode = 400;
      erro.codigo = "manual_v2_agendamento_no_passado";
      throw erro;
    }

    return {
      ...tempo,
      destinosIds,
      destinosAgendados: await destinosSelecionadosAgendamento(req, clienteId, destinosIds)
    };
  }

  router.post("/ofertas/:id/agendar", async (req, res) => {
    try {
      const clienteId = cliente(req);
      const ofertaAtual = storage.buscarOfertaManualV2(clienteId, req.params.id, deps.storageOptions || {});
      if (!ofertaAtual) {
        return res.status(404).json({
          ok: false,
          erro: "oferta_manual_v2_nao_encontrada",
          motivo: "oferta_manual_v2_nao_encontrada"
        });
      }

      bloquearAgendamentoPorStatus(ofertaAtual);
      const dados = await dadosAgendamento(req, clienteId);
      const oferta = storage.marcarOfertaManualV2Agendada(clienteId, req.params.id, dados, deps.storageOptions || {});

      return res.status(201).json({
        ok: true,
        oferta
      });
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e, "manual_v2_agendamento_falhou"));
    }
  });

  router.put("/ofertas/:id/agendamento", async (req, res) => {
    try {
      const clienteId = cliente(req);
      const ofertaAtual = storage.buscarOfertaManualV2(clienteId, req.params.id, deps.storageOptions || {});
      if (!ofertaAtual) {
        return res.status(404).json({
          ok: false,
          erro: "oferta_manual_v2_nao_encontrada",
          motivo: "oferta_manual_v2_nao_encontrada"
        });
      }

      bloquearAgendamentoPorStatus(ofertaAtual);
      const dados = await dadosAgendamento(req, clienteId);
      const oferta = storage.reprogramarOfertaManualV2Agendada(clienteId, req.params.id, dados, deps.storageOptions || {});

      return res.json({
        ok: true,
        oferta
      });
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e, "manual_v2_reprogramacao_falhou"));
    }
  });

  router.post("/ofertas/:id/agendamento/cancelar", (req, res) => {
    try {
      const clienteId = cliente(req);
      const ofertaAtual = storage.buscarOfertaManualV2(clienteId, req.params.id, deps.storageOptions || {});
      if (!ofertaAtual) {
        return res.status(404).json({
          ok: false,
          erro: "oferta_manual_v2_nao_encontrada",
          motivo: "oferta_manual_v2_nao_encontrada"
        });
      }

      bloquearAgendamentoPorStatus(ofertaAtual);
      const oferta = storage.cancelarAgendamentoOfertaManualV2(clienteId, req.params.id, deps.storageOptions || {});

      return res.json({
        ok: true,
        oferta
      });
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e, "manual_v2_cancelamento_agendamento_falhou"));
    }
  });

  router.delete("/ofertas/:id", (req, res) => {
    try {
      const excluida = storage.excluirOfertaManualV2(cliente(req), req.params.id, deps.storageOptions || {});
      if (!excluida) {
        return res.status(404).json({
          ok: false,
          erro: "oferta_manual_v2_nao_encontrada",
          motivo: "oferta_manual_v2_nao_encontrada"
        });
      }

      return res.json({
        ok: true,
        excluida: true
      });
    } catch (e) {
      return res.status(statusErro(e)).json(payloadErro(e, "manual_v2_exclusao_falhou"));
    }
  });

  return router;
}

module.exports = criarRotasManualV2;
