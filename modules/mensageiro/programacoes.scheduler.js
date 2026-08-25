const {
  getMensageiroCliente,
  setMensageiroCliente,
  listarClientesMensageiro,
  moduloPossuiAlcanceProprio,
  registrarHistoricoAtendimento
} = require("./storage");
const {
  usuarioAtivo,
  logUsuarioInativoIgnorado
} = require("../../utils/usuarios-atividade");

const INTERVALO_SCHEDULER_MS = Number(process.env.MENSAGEIRO_PROGRAMACOES_INTERVALO_MS || 60000);
const ATRASO_MAXIMO_MS = Number(process.env.MENSAGEIRO_PROGRAMACOES_ATRASO_MAX_MS || 5 * 60 * 1000);
const LOCK_MS = Number(process.env.MENSAGEIRO_PROGRAMACOES_LOCK_MS || 2 * 60 * 1000);
const TZ_PADRAO = "America/Sao_Paulo";

let schedulerTimer = null;
let schedulerRodando = false;

function iso(date) {
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function normalizarHorario(horario = "00:00") {
  const match = String(horario || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "00:00";
  const h = Math.max(0, Math.min(23, Number(match[1]) || 0));
  const m = Math.max(0, Math.min(59, Number(match[2]) || 0));
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function partesSaoPaulo(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_PADRAO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const obj = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return {
    data: `${obj.year}-${obj.month}-${obj.day}`,
    minutos: (Number(obj.hour) || 0) * 60 + (Number(obj.minute) || 0)
  };
}

function dataSaoPaulo(data, horario) {
  return new Date(`${data}T${normalizarHorario(horario)}:00-03:00`);
}

function adicionarDiasData(data, dias) {
  const base = dataSaoPaulo(data, "12:00");
  base.setUTCDate(base.getUTCDate() + dias);
  return partesSaoPaulo(base).data;
}

function horarioParaMinutos(horario = "") {
  const [h, m] = normalizarHorario(horario).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function dentroDaJanela(date, programacao = {}) {
  if (!programacao.janelaInicio || !programacao.janelaFim) return true;

  const atual = partesSaoPaulo(date).minutos;
  const inicio = horarioParaMinutos(programacao.janelaInicio);
  const fim = horarioParaMinutos(programacao.janelaFim);

  if (inicio <= fim) return atual >= inicio && atual <= fim;
  return atual >= inicio || atual <= fim;
}

function proximoInicioJanela(date, programacao = {}) {
  if (!programacao.janelaInicio) return date;

  const partes = partesSaoPaulo(date);
  const atual = partes.minutos;
  const inicio = horarioParaMinutos(programacao.janelaInicio);
  const fim = programacao.janelaFim ? horarioParaMinutos(programacao.janelaFim) : 1439;

  if (programacao.janelaFim && inicio <= fim && atual > fim) {
    return dataSaoPaulo(adicionarDiasData(partes.data, 1), programacao.janelaInicio);
  }

  if (atual < inicio) {
    return dataSaoPaulo(partes.data, programacao.janelaInicio);
  }

  return date;
}

function calcularProximoRunAt(programacao = {}, referencia = new Date()) {
  const agora = referencia instanceof Date ? referencia : new Date(referencia);
  if (!Number.isFinite(agora.getTime())) return "";

  if (programacao.tipo === "intervalo") {
    const minutos = Math.max(10, Number(programacao.intervaloMinutos || 30) || 30);
    const proximo = new Date(agora.getTime() + minutos * 60 * 1000);
    const ajustado = dentroDaJanela(proximo, programacao)
      ? proximo
      : proximoInicioJanela(proximo, programacao);
    return iso(ajustado);
  }

  const horario = normalizarHorario(programacao.horario || "00:00");
  if (programacao.data) {
    const alvo = dataSaoPaulo(programacao.data, horario);
    return alvo.getTime() > agora.getTime() ? iso(alvo) : "";
  }

  const partes = partesSaoPaulo(agora);
  let candidato = dataSaoPaulo(partes.data, horario);
  while (candidato.getTime() <= agora.getTime()) {
    candidato = dataSaoPaulo(adicionarDiasData(partesSaoPaulo(candidato).data, 1), horario);
  }
  return iso(candidato);
}

function montarPayloadProgramacao(conteudo = {}) {
  const texto = String(conteudo.texto || "");
  const imagem = String(conteudo.imagem || "");
  const tipo = ["texto", "imagem", "imagem_texto"].includes(conteudo.tipo)
    ? conteudo.tipo
    : "texto";

  if (tipo === "texto") return texto ? { payload: { text: texto }, tipo: "texto" } : null;
  if (!imagem && tipo !== "texto") return null;

  const payloadImagem = imagem.startsWith("data:image")
    ? { image: Buffer.from((imagem.split(",")[1] || ""), "base64") }
    : { image: { url: imagem } };

  if (tipo === "imagem_texto" && texto) payloadImagem.caption = texto;
  return { payload: payloadImagem, tipo };
}

function atualizarProgramacao(clienteId, programacaoId, patch = {}) {
  const config = getMensageiroCliente(clienteId);
  const programacoes = (config.programacoes || []).map(programacao =>
    programacao.id === programacaoId
      ? { ...programacao, ...patch }
      : programacao
  );
  return setMensageiroCliente(clienteId, { programacoes });
}

function registrarHistoricoProgramacao(clienteId, evento = {}) {
  try {
    registrarHistoricoAtendimento(clienteId, {
      tipo: "programacao",
      origem: "grupo",
      resultado: evento.resultado || evento.status || "registrado",
      status: evento.status || evento.resultado || "registrado",
      ...evento
    });
  } catch (e) {
    console.log("[MENSAGEIRO-PROGRAMACAO-HISTORICO-ERRO]", e.message);
  }
}

function grupoPermitidoConfig(config = {}, grupoId = "") {
  const grupos = Array.isArray(config.grupos) ? config.grupos : [];
  if (!grupos.length) return true;
  return grupos.includes(grupoId);
}

function programacaoPossuiAlcanceProprio(programacao = {}) {
  return Boolean(programacao && typeof programacao === "object" && programacao.gruposConfigurados === true);
}

function gruposPermitidosProgramacao(config = {}, programacao = {}) {
  if (programacaoPossuiAlcanceProprio(programacao)) {
    return Array.isArray(programacao.grupos) ? programacao.grupos : [];
  }

  const perfil = Array.isArray(config.perfis) && programacao.perfilId
    ? config.perfis.find(item => item?.id === programacao.perfilId && item?.ativo !== false && !item?.removidoEm)
    : null;
  const moduloProgramacoes = perfil?.modulos?.programacoes;
  if (moduloPossuiAlcanceProprio(moduloProgramacoes)) {
    return Array.isArray(moduloProgramacoes.grupos) ? moduloProgramacoes.grupos : [];
  }

  return Array.isArray(config.grupos) ? config.grupos : [];
}

async function processarProgramacao({ clienteId, programacao, deps = {}, agora = new Date() }) {
  if (!programacao?.ativo) return false;
  if (!usuarioAtivo(clienteId)) {
    logUsuarioInativoIgnorado({ clienteId, fluxo: "mensageiro_programacoes" });
    return false;
  }

  const config = getMensageiroCliente(clienteId);
  if (config?.ativo !== true) return false;

  if (!programacao.nextRunAt) {
    atualizarProgramacao(clienteId, programacao.id, {
      nextRunAt: calcularProximoRunAt(programacao, agora),
      status: "agendada"
    });
    return false;
  }

  const proximo = new Date(programacao.nextRunAt);
  if (!Number.isFinite(proximo.getTime()) || proximo.getTime() > agora.getTime()) return false;

  const lockAte = new Date(programacao.lockAte || 0);
  if (Number.isFinite(lockAte.getTime()) && lockAte.getTime() > agora.getTime()) return false;

  if (agora.getTime() - proximo.getTime() > ATRASO_MAXIMO_MS) {
    const nextRunAt = calcularProximoRunAt(programacao, agora);
    atualizarProgramacao(clienteId, programacao.id, {
      nextRunAt,
      processandoEm: "",
      lockAte: "",
      status: nextRunAt ? "pulada_restart" : "concluida"
    });
    registrarHistoricoProgramacao(clienteId, {
      grupo: "",
      grupoNome: "",
      gatilhoId: programacao.id,
      gatilhoNome: programacao.nome,
      resumo: `${programacao.nome}`,
      detalhe: "Envio atrasado ignorado apos reinicio",
      resultado: "pulada_restart",
      status: "pulada_restart"
    });
    return false;
  }

  if (!dentroDaJanela(agora, programacao)) {
    const nextRunAt = calcularProximoRunAt(programacao, agora);
    atualizarProgramacao(clienteId, programacao.id, {
      nextRunAt,
      status: "fora_janela"
    });
    return false;
  }

  const runId = `prog_${programacao.id}_${agora.getTime()}`;
  atualizarProgramacao(clienteId, programacao.id, {
    processandoEm: iso(agora),
    lockAte: iso(new Date(agora.getTime() + LOCK_MS)),
    ultimoRunId: runId,
    status: "processando"
  });

  try {
    const sessaoId = String(config.sessaoGruposId || config.sessaoWhatsappId || config.sessaoId || "");
    const sock = typeof deps.getSock === "function" ? deps.getSock(sessaoId) : null;
    const statusSessao = typeof deps.getStatusSessao === "function" ? deps.getStatusSessao(sessaoId) : "";
    const sessaoAberta = Boolean(sock && (!statusSessao || statusSessao === "open" || statusSessao === "aberto"));
    if (!sessaoId || !sessaoAberta || typeof sock.sendMessage !== "function") {
      const nextRunAt = calcularProximoRunAt(programacao, agora);
      atualizarProgramacao(clienteId, programacao.id, {
        processandoEm: "",
        lockAte: "",
        nextRunAt,
        status: "sessao_indisponivel"
      });
      registrarHistoricoProgramacao(clienteId, {
        gatilhoId: programacao.id,
        gatilhoNome: programacao.nome,
        resumo: programacao.nome,
        detalhe: "Sessao WhatsApp indisponivel",
        resultado: "sessao_indisponivel",
        status: "erro"
      });
      return false;
    }

    const conteudos = Array.isArray(programacao.conteudos) ? programacao.conteudos : [];
    const indiceAtual = conteudos.length ? Math.max(0, Number(programacao.indiceAtual || 0) || 0) % conteudos.length : 0;
    const conteudo = conteudos[indiceAtual];
    const envio = montarPayloadProgramacao(conteudo);
    if (!envio) throw new Error("conteudo_programacao_invalido");

    const gruposProgramacao = gruposPermitidosProgramacao(config, programacao);
    const gruposValidos = programacaoPossuiAlcanceProprio(programacao)
      ? [...new Set(gruposProgramacao)]
      : [...new Set(gruposProgramacao)].filter(grupoId => grupoPermitidoConfig(config, grupoId));
    if (!gruposValidos.length) {
      const nextRunAt = calcularProximoRunAt(programacao, agora);
      atualizarProgramacao(clienteId, programacao.id, {
        processandoEm: "",
        lockAte: "",
        nextRunAt,
        status: "sem_grupo"
      });
      return false;
    }

    let enviados = 0;
    for (const grupoId of gruposValidos) {
      try {
        await sock.sendMessage(grupoId, envio.payload);
        enviados += 1;
        registrarHistoricoProgramacao(clienteId, {
          grupo: grupoId,
          grupoNome: grupoId,
          gatilhoId: programacao.id,
          gatilhoNome: programacao.nome,
          respostaEnviada: [`${envio.tipo}:${String(conteudo.texto || conteudo.imagem || "").slice(0, 80)}`],
          resumo: programacao.nome,
          detalhe: conteudos.length > 1
            ? `Mensagem ${indiceAtual + 1}/${conteudos.length} enviada • ${grupoId}`
            : `Mensagem programada enviada • ${grupoId}`,
          resultado: "enviado",
          status: "enviado"
        });
      } catch (e) {
        registrarHistoricoProgramacao(clienteId, {
          grupo: grupoId,
          grupoNome: grupoId,
          gatilhoId: programacao.id,
          gatilhoNome: programacao.nome,
          resumo: programacao.nome,
          detalhe: `Falha ao enviar • ${grupoId}`,
          erro: e.message,
          resultado: "erro",
          status: "erro"
        });
      }
    }

    const finalizada = programacao.tipo === "horario" && programacao.data;
    const indiceSeguinte = conteudos.length ? (indiceAtual + 1) % conteudos.length : 0;
    const nextRunAt = finalizada ? "" : calcularProximoRunAt(programacao, agora);
    atualizarProgramacao(clienteId, programacao.id, {
      indiceAtual: indiceSeguinte,
      ultimoEnvioEm: enviados ? iso(agora) : programacao.ultimoEnvioEm || "",
      processandoEm: "",
      lockAte: "",
      nextRunAt,
      status: finalizada ? "concluida" : enviados ? "enviada" : "erro"
    });

    return enviados > 0;
  } catch (e) {
    const nextRunAt = calcularProximoRunAt(programacao, agora);
    atualizarProgramacao(clienteId, programacao.id, {
      processandoEm: "",
      lockAte: "",
      nextRunAt,
      status: "erro"
    });
    registrarHistoricoProgramacao(clienteId, {
      gatilhoId: programacao.id,
      gatilhoNome: programacao.nome,
      resumo: programacao.nome,
      detalhe: "Falha ao processar programacao",
      erro: e.message,
      resultado: "erro",
      status: "erro"
    });
    return false;
  }
}

async function rodarProgramacoesMensageiroPendentes(deps = {}) {
  if (schedulerRodando) return { ok: true, ignorado: "rodada_em_andamento" };
  schedulerRodando = true;
  const agora = deps.agora instanceof Date ? deps.agora : new Date();
  let processadas = 0;

  try {
    for (const clienteId of listarClientesMensageiro()) {
      const config = getMensageiroCliente(clienteId);
      const programacoes = Array.isArray(config.programacoes) ? config.programacoes : [];
      for (const programacao of programacoes) {
        try {
          const enviou = await processarProgramacao({ clienteId, programacao, deps, agora });
          if (enviou) processadas += 1;
        } catch (e) {
          console.log("[MENSAGEIRO-PROGRAMACAO-ERRO]", e.message);
        }
      }
    }
    return { ok: true, processadas };
  } finally {
    schedulerRodando = false;
  }
}

function iniciarSchedulerProgramacoesMensageiro(deps = {}) {
  if (schedulerTimer) return schedulerTimer;

  const rodada = () => {
    rodarProgramacoesMensageiroPendentes(deps).catch((e) => {
      console.log("[MENSAGEIRO-PROGRAMACAO-SCHEDULER-ERRO]", e.message);
    });
  };

  schedulerTimer = setInterval(rodada, INTERVALO_SCHEDULER_MS);
  if (typeof schedulerTimer.unref === "function") schedulerTimer.unref();
  setTimeout(rodada, 5000).unref?.();
  return schedulerTimer;
}

function pararSchedulerProgramacoesMensageiro() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  schedulerRodando = false;
}

module.exports = {
  INTERVALO_SCHEDULER_MS,
  ATRASO_MAXIMO_MS,
  calcularProximoRunAt,
  dentroDaJanela,
  montarPayloadProgramacao,
  rodarProgramacoesMensageiroPendentes,
  iniciarSchedulerProgramacoesMensageiro,
  pararSchedulerProgramacoesMensageiro
};
