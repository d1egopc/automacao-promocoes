const eventosMensageiroRecentes = new Map();

const {
  getMensageiroCliente,
  setMensageiroCliente,
  getAtendimentoConfigCliente,
  registrarHistoricoAtendimento
} = require("./storage");
const {
  usuarioAtivo,
  logUsuarioInativoIgnorado
} = require("../../utils/usuarios-atividade");

const COOLDOWN_ATENDIMENTO_MS = 10 * 60 * 1000;

function mensageiroAtivo(clienteId) {
  const config = getMensageiroCliente(clienteId);

  return config?.ativo === true;
}

function boasVindasAtivo(clienteId) {
  const config = getMensageiroCliente(clienteId);

  return (
    config?.ativo === true &&
    config?.boasVindasAtivo === true
  );
}

function despedidaAtivo(clienteId) {
  const config = getMensageiroCliente(clienteId);

  return (
    config?.ativo === true &&
    config?.despedidaAtivo === true
  );
}

function grupoPermitido(clienteId, grupoId) {
  const config = getMensageiroCliente(clienteId);

  if (!config?.grupos?.length) {
    return true;
  }

  return config.grupos.includes(grupoId);
}

function obterMensagemBoasVindas(clienteId) {
  return (
    getMensageiroCliente(clienteId)
      ?.mensagemBoasVindas ||
    "👋 Seja bem-vindo!"
  );
}

function obterMensagemDespedida(clienteId) {
  return (
    getMensageiroCliente(clienteId)
      ?.mensagemDespedida ||
    "😢 Obrigado por participar."
  );
}
function normalizarTextoMensagem(texto = "") {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function extrairTextoMensagemAtendimento(mensagem = {}) {
  const conteudo = mensagem.message || {};

  return (
    conteudo.conversation ||
    conteudo.extendedTextMessage?.text ||
    conteudo.imageMessage?.caption ||
    conteudo.videoMessage?.caption ||
    conteudo.buttonsResponseMessage?.selectedDisplayText ||
    conteudo.listResponseMessage?.title ||
    ""
  );
}

function encontrarRespostaRapida(texto = "", respostasRapidas = []) {
  const textoNormalizado = normalizarTextoMensagem(texto);

  if (!textoNormalizado) return null;
  if (!Array.isArray(respostasRapidas) || !respostasRapidas.length) return null;

  for (const respostaRapida of respostasRapidas) {
    if (!respostaRapida?.ativo) continue;
    if (!Array.isArray(respostaRapida.gatilhos) || !respostaRapida.gatilhos.length) continue;

    const tipoCorrespondencia = String(
      respostaRapida.tipoCorrespondencia || "exato"
    ).toLowerCase();

    for (const gatilho of respostaRapida.gatilhos) {
      const gatilhoNormalizado = normalizarTextoMensagem(gatilho);
      if (!gatilhoNormalizado) continue;

      const encontrou =
        tipoCorrespondencia === "exato"
          ? textoNormalizado === gatilhoNormalizado
          : tipoCorrespondencia === "inicia"
            ? textoNormalizado.startsWith(gatilhoNormalizado)
            : textoNormalizado.includes(gatilhoNormalizado);

      if (encontrou) return respostaRapida;
    }
  }

  return null;
}

function encontrarGatilhoAtendimento(texto = "", gatilhos = []) {
  const textoNormalizado = normalizarTextoMensagem(texto);

  if (!textoNormalizado) return null;
  if (!Array.isArray(gatilhos) || !gatilhos.length) return null;

  for (const gatilho of gatilhos) {
    if (!gatilho?.ativo) continue;

    const obrigatorias = Array.isArray(gatilho.palavrasObrigatorias)
      ? gatilho.palavrasObrigatorias
      : [];
    const opcionais = Array.isArray(gatilho.palavrasOpcionais)
      ? gatilho.palavrasOpcionais
      : [];

    if (!obrigatorias.length) continue;

    const modo = String(gatilho.modo || "todas").toLowerCase();
    const tipoCorrespondencia = String(
      gatilho.tipoCorrespondencia ||
      gatilho.correspondencia ||
      gatilho.match ||
      "exato"
    ).toLowerCase();
    const compararPalavra = palavra => {
      const palavraNormalizada = normalizarTextoMensagem(palavra);
      if (!palavraNormalizada) return false;

      if (tipoCorrespondencia === "contem" || tipoCorrespondencia === "contém") {
        return textoNormalizado.includes(palavraNormalizada);
      }

      if (tipoCorrespondencia === "inicia") {
        return textoNormalizado.startsWith(palavraNormalizada);
      }

      return textoNormalizado === palavraNormalizada;
    };

    const encontrou =
      modo === "qualquer"
        ? [...obrigatorias, ...opcionais].some(compararPalavra)
        : obrigatorias.every(compararPalavra);

    if (encontrou) return gatilho;
  }

  return null;
}

function aplicarDelayAtendimento(delaySegundos = 0) {
  const segundos = Math.max(0, Number(delaySegundos || 0) || 0);
  const ms = Math.min(segundos, 60) * 1000;

  if (!ms) return Promise.resolve();

  return new Promise(resolve => setTimeout(resolve, ms));
}

function logMensageiroJson(tag, dados = {}) {
  console.log(`${tag} ${JSON.stringify(dados)}`);
}

function normalizarJidMensageiro(valor = "") {
  return String(valor || "").trim();
}

function jidPrivadoWhatsappValido(jid = "") {
  return normalizarJidMensageiro(jid).endsWith("@s.whatsapp.net");
}

function jidGrupoWhatsapp(jid = "") {
  return normalizarJidMensageiro(jid).endsWith("@g.us");
}

function jidLidWhatsapp(jid = "") {
  return normalizarJidMensageiro(jid).endsWith("@lid");
}

function motivoJidAtendimentoIgnorado(jid = "") {
  const jidNormalizado = normalizarJidMensageiro(jid);

  if (!jidNormalizado) return "jid_vazio";
  if (jidNormalizado === "status@broadcast") return "status_broadcast";
  if (jidNormalizado.endsWith("@g.us")) return "grupo";
  if (jidNormalizado.endsWith("@newsletter")) return "newsletter";
  if (jidLidWhatsapp(jidNormalizado)) return "";
  if (!jidPrivadoWhatsappValido(jidNormalizado)) return "jid_nao_privado";

  return "";
}

function logAtendimentoJidIgnorado({ clienteId = "", sessaoId = "", jid = "", motivo = "" } = {}) {
  logMensageiroJson("[MENSAGEIRO-ATENDIMENTO-JID-IGNORADO]", {
    clienteId,
    sessaoId,
    jid,
    motivo
  });
}

function contarGatilhosAtendimento(gatilhos = []) {
  if (!Array.isArray(gatilhos)) return 0;

  return gatilhos.filter(gatilho =>
    gatilho?.ativo !== false &&
    Array.isArray(gatilho.palavrasObrigatorias) &&
    gatilho.palavrasObrigatorias.length
  ).length;
}

function contarRespostasRapidas(respostasRapidas = []) {
  if (!Array.isArray(respostasRapidas)) return 0;

  return respostasRapidas.filter(item =>
    item?.ativo !== false &&
    Array.isArray(item.gatilhos) &&
    item.gatilhos.length
  ).length;
}

function logGatilhoNaoCorresponde({ clienteId = "", sessaoId = "", jid = "", mensagem = "", gatilhosVerificados = 0 } = {}) {
  logMensageiroJson("[MENSAGEIRO-GATILHO-NAO-CORRESPONDE]", {
    clienteId,
    sessaoId,
    jid,
    mensagem: String(mensagem || "").slice(0, 120),
    gatilhosVerificados
  });
}

function coletarPossiveisContatosMensageiro(sock) {
  const fontes = [
    sock?.__mensageiroLidMap,
    sock?.contacts,
    sock?.store?.contacts,
    sock?.ev?.store?.contacts,
    sock?.waUploadToServer?.store?.contacts
  ];
  const contatos = [];

  for (const fonte of fontes) {
    if (!fonte) continue;

    if (fonte instanceof Map) {
      for (const [id, contato] of fonte.entries()) {
        contatos.push({ chave: id, id, ...(contato || {}) });
      }
      continue;
    }

    if (Array.isArray(fonte)) {
      contatos.push(...fonte);
      continue;
    }

    if (typeof fonte === "object") {
      for (const [id, contato] of Object.entries(fonte)) {
        contatos.push({ chave: id, id, ...(contato || {}) });
      }
    }
  }

  return contatos;
}

function registrarMapeamentoLidMensageiro(sock, lid = "", jid = "") {
  const lidNormalizado = normalizarJidMensageiro(lid);
  const jidTexto = normalizarJidMensageiro(jid);
  const jidNormalizado = /^\d+$/.test(jidTexto) ? `${jidTexto}@s.whatsapp.net` : jidTexto;

  if (!sock || !jidLidWhatsapp(lidNormalizado) || !jidPrivadoWhatsappValido(jidNormalizado)) return;

  sock.__mensageiroLidMap = sock.__mensageiroLidMap || {};
  sock.__mensageiroLidMap[lidNormalizado] = {
    id: jidNormalizado,
    lid: lidNormalizado,
    jid: jidNormalizado
  };
}

function extrairJidWhatsappDeContato(contato = {}, jidOriginal = "") {
  const lidOriginal = normalizarJidMensageiro(jidOriginal);
  const usuarioLidOriginal = lidOriginal.split("@")[0];
  const normalizarCampoJid = valor => {
    const texto = normalizarJidMensageiro(valor);
    return /^\d+$/.test(texto) ? `${texto}@s.whatsapp.net` : texto;
  };
  const camposLid = [
    contato.chave,
    contato.id,
    contato.lid,
    contato.lidJid,
    contato.lidPn,
    contato.jid,
    contato.remoteJid,
    contato.notify
  ].map(normalizarJidMensageiro);

  if (!camposLid.includes(lidOriginal) && !camposLid.includes(usuarioLidOriginal)) return "";

  const camposJid = [
    contato.jid,
    contato.id,
    contato.pn,
    contato.phoneNumber,
    contato.phoneNumberJid,
    contato.wid,
    contato.remoteJid
  ].map(normalizarCampoJid);

  return camposJid.find(jidPrivadoWhatsappValido) || "";
}

async function tentarResolverLidViaOnWhatsApp(sock, jidOriginal = "") {
  if (typeof sock?.onWhatsApp !== "function") return "";

  const usuario = normalizarJidMensageiro(jidOriginal).split("@")[0];
  const candidatos = [
    normalizarJidMensageiro(jidOriginal),
    `${usuario}@s.whatsapp.net`,
    usuario
  ];

  for (const candidato of candidatos) {
    try {
      const resultado = await sock.onWhatsApp(candidato);
      const lista = Array.isArray(resultado) ? resultado : [resultado];
      const encontrado = lista.find(item => item?.exists && jidPrivadoWhatsappValido(item?.jid));
      if (encontrado?.jid) return normalizarJidMensageiro(encontrado.jid);
    } catch {}
  }

  return "";
}

async function resolverJidPrivadoMensageiro(sock, jid, contexto = {}) {
  const jidOriginal = normalizarJidMensageiro(jid);

  if (!jidOriginal) return "";
  if (jidGrupoWhatsapp(jidOriginal)) return jidOriginal;
  if (jidPrivadoWhatsappValido(jidOriginal)) return jidOriginal;
  if (!jidLidWhatsapp(jidOriginal)) return jidOriginal;

  for (const contato of coletarPossiveisContatosMensageiro(sock)) {
    const jidResolvido = extrairJidWhatsappDeContato(contato, jidOriginal);
    if (jidResolvido) return jidResolvido;
  }

  const jidOnWhatsApp = await tentarResolverLidViaOnWhatsApp(sock, jidOriginal);
  if (jidOnWhatsApp) return jidOnWhatsApp;

  logMensageiroJson("[MENSAGEIRO-JID-LID-NAO-RESOLVIDO]", {
    clienteId: contexto.clienteId || "",
    sessaoId: contexto.sessaoId || "",
    jidOriginal
  });

  return "";
}

async function executarRespostaRapida({ sock, jid, resposta, delaySegundos = 0, clienteId = "", sessaoId = "", jidOriginalLog = "" } = {}) {
  const conteudo = String(resposta?.conteudo || "").trim();
  const tipo = String(resposta?.tipo || "texto").toLowerCase();

  if (!sock || !jid || !conteudo) return false;
  if (tipo !== "texto") return false;

  const jidOriginal = normalizarJidMensageiro(jidOriginalLog || jid);
  const jidFinal = await resolverJidPrivadoMensageiro(sock, jid, { clienteId, sessaoId });
  if (!jidFinal) return false;

  try {
    await sock.sendPresenceUpdate?.("composing", jidFinal);
  } catch (e) {
    console.log("[MENSAGEIRO-FLUXO] digitando indisponivel:", e.message);
  }

  await aplicarDelayAtendimento(delaySegundos);

  try {
    await sock.sendPresenceUpdate?.("paused", jidFinal);
  } catch {}

  logMensageiroJson("[MENSAGEIRO-ATENDIMENTO-ENVIO-TENTANDO]", {
    clienteId,
    sessaoId,
    jidOriginal,
    jidFinal,
    tipo: "texto",
    conteudoPreview: conteudo.slice(0, 120)
  });
  await sock.sendMessage(jidFinal, { text: conteudo });
  return true;
}

async function executarRespostaAtendimento({ sock, jid, resposta, clienteId = "", sessaoId = "", jidOriginalLog = "" } = {}) {
  const conteudo = String(resposta?.conteudo || "").trim();
  const tipo = String(resposta?.tipo || "texto");

  if (!sock || !jid || !conteudo) return false;

  const jidOriginal = normalizarJidMensageiro(jidOriginalLog || jid);
  const jidFinal = await resolverJidPrivadoMensageiro(sock, jid, { clienteId, sessaoId });
  if (!jidFinal) return false;

  try {
    await sock.sendPresenceUpdate?.("composing", jidFinal);
  } catch (e) {
    console.log("[MENSAGEIRO-FLUXO] digitando indisponivel:", e.message);
  }

  await aplicarDelayAtendimento(resposta?.delaySegundos || 0);

  try {
    await sock.sendPresenceUpdate?.("paused", jidFinal);
  } catch {}

  if (tipo === "imagemUrl") {
    logMensageiroJson("[MENSAGEIRO-ATENDIMENTO-ENVIO-TENTANDO]", {
      clienteId,
      sessaoId,
      jidOriginal,
      jidFinal,
      tipo,
      conteudoPreview: conteudo.slice(0, 120)
    });
    await sock.sendMessage(jidFinal, {
      image: { url: conteudo }
    });
    return true;
  }

  if (tipo === "videoUrl") {
    logMensageiroJson("[MENSAGEIRO-ATENDIMENTO-ENVIO-TENTANDO]", {
      clienteId,
      sessaoId,
      jidOriginal,
      jidFinal,
      tipo,
      conteudoPreview: conteudo.slice(0, 120)
    });
    await sock.sendMessage(jidFinal, {
      video: { url: conteudo }
    });
    return true;
  }

  if (tipo === "arquivoUrl") {
    const nomeArquivo = conteudo.split("/").pop()?.split("?")[0] || "arquivo";
    logMensageiroJson("[MENSAGEIRO-ATENDIMENTO-ENVIO-TENTANDO]", {
      clienteId,
      sessaoId,
      jidOriginal,
      jidFinal,
      tipo,
      conteudoPreview: conteudo.slice(0, 120)
    });
    await sock.sendMessage(jidFinal, {
      document: { url: conteudo },
      fileName: nomeArquivo
    });
    return true;
  }

  if (tipo === "link") {
    logMensageiroJson("[MENSAGEIRO-ATENDIMENTO-ENVIO-TENTANDO]", {
      clienteId,
      sessaoId,
      jidOriginal,
      jidFinal,
      tipo: "texto",
      conteudoPreview: conteudo.slice(0, 120)
    });
    await sock.sendMessage(jidFinal, { text: conteudo });
    return true;
  }

  logMensageiroJson("[MENSAGEIRO-ATENDIMENTO-ENVIO-TENTANDO]", {
    clienteId,
    sessaoId,
    jidOriginal,
    jidFinal,
    tipo: "texto",
    conteudoPreview: conteudo.slice(0, 120)
  });
  await sock.sendMessage(jidFinal, { text: conteudo });
  return true;
}

function atendimentoEscopoPermitido({ clienteId, jid, escopo }) {
  const isGrupo = String(jid || "").endsWith("@g.us");
  const escopoFinal = String(escopo || "privado");

  if (jid === "status@broadcast") return false;
  if (escopoFinal === "privado" && isGrupo) return false;
  if (escopoFinal === "grupo" && !isGrupo) return false;
  if (isGrupo && !grupoPermitido(clienteId, jid)) return false;

  return true;
}

function registrarHistoricoSeguro(clienteId, evento) {
  try {
    registrarHistoricoAtendimento(clienteId, evento);
  } catch (e) {
    console.log("[MENSAGEIRO-ERRO] historico atendimento:", e.message);
  }
}

async function tratarMensagemAtendimentoV1({
  clienteId,
  sessaoId,
  sock,
  mensagem,
  texto,
  jid
} = {}) {
  const configAtendimento = getAtendimentoConfigCliente(clienteId);

  if (configAtendimento?.atendimentoAtivo !== true) return false;
  if (configAtendimento.sessaoId && configAtendimento.sessaoId !== sessaoId) return false;
  if (!atendimentoEscopoPermitido({ clienteId, jid, escopo: configAtendimento.escopo })) return false;

  const gatilho = encontrarGatilhoAtendimento(texto, configAtendimento.gatilhos);
  if (!gatilho) {
    if (texto) {
      logGatilhoNaoCorresponde({
        clienteId,
        sessaoId,
        jid,
        mensagem: texto,
        gatilhosVerificados: contarGatilhosAtendimento(configAtendimento.gatilhos)
      });
    }
    return false;
  }

  const chaveCooldown = `${clienteId}:${sessaoId}:${jid}:${gatilho.id}`;
  const agora = Date.now();
  const ultimo = eventosMensageiroRecentes.get(chaveCooldown) || 0;
  const cooldownMs = Math.max(1, Number(configAtendimento.cooldownMinutos || 10) || 10) * 60 * 1000;

  if (agora - ultimo < cooldownMs) {
    registrarHistoricoSeguro(clienteId, {
      origem: jid.endsWith("@g.us") ? "grupo" : "privado",
      contato: jid,
      grupo: jid.endsWith("@g.us") ? jid : "",
      mensagemRecebida: texto,
      gatilhoId: gatilho.id,
      gatilhoNome: gatilho.nome,
      respostaEnviada: [],
      status: "cooldown"
    });
    return true;
  }

  const respostasEnviadas = [];
  const jidOriginalAtendimento = normalizarJidMensageiro(jid);
  const jidFinalAtendimento = await resolverJidPrivadoMensageiro(sock, jidOriginalAtendimento, { clienteId, sessaoId });

  if (!jidFinalAtendimento) {
    registrarHistoricoSeguro(clienteId, {
      origem: jid.endsWith("@g.us") ? "grupo" : "privado",
      contato: jid,
      grupo: jid.endsWith("@g.us") ? jid : "",
      mensagemRecebida: texto,
      gatilhoId: gatilho.id,
      gatilhoNome: gatilho.nome,
      respostaEnviada: [],
      status: "sem_resposta"
    });
    return true;
  }

  eventosMensageiroRecentes.set(chaveCooldown, agora);

  try {
    for (const resposta of gatilho.respostas || []) {
      const enviada = await executarRespostaAtendimento({
        sock,
        jid: jidFinalAtendimento,
        resposta,
        clienteId,
        sessaoId,
        jidOriginalLog: jidOriginalAtendimento
      });
      if (enviada) respostasEnviadas.push(`${resposta.tipo}:${String(resposta.conteudo || "").slice(0, 80)}`);
    }

    registrarHistoricoSeguro(clienteId, {
      origem: jid.endsWith("@g.us") ? "grupo" : "privado",
      contato: jid,
      grupo: jid.endsWith("@g.us") ? jid : "",
      mensagemRecebida: texto,
      gatilhoId: gatilho.id,
      gatilhoNome: gatilho.nome,
      respostaEnviada: respostasEnviadas,
      status: respostasEnviadas.length ? "enviado" : "sem_resposta"
    });

    if (respostasEnviadas.length) {
      logMensageiroJson("[MENSAGEIRO-ATENDIMENTO-ENVIADO]", {
        clienteId,
        sessaoId,
        jidOriginal: jidOriginalAtendimento,
        jidFinal: jidFinalAtendimento,
        gatilhoId: gatilho.id,
        gatilhoNome: gatilho.nome,
        respostas: respostasEnviadas.length
      });
    }

    return true;
  } catch (e) {
    logMensageiroJson("[MENSAGEIRO-ATENDIMENTO-ERRO]", {
      clienteId,
      sessaoId,
      jidOriginal: jidOriginalAtendimento,
      jidFinal: jidFinalAtendimento,
      erro: e.message
    });

    registrarHistoricoSeguro(clienteId, {
      origem: jid.endsWith("@g.us") ? "grupo" : "privado",
      contato: jid,
      grupo: jid.endsWith("@g.us") ? jid : "",
      mensagemRecebida: texto,
      gatilhoId: gatilho.id,
      gatilhoNome: gatilho.nome,
      respostaEnviada: respostasEnviadas,
      status: "erro",
      erro: e.message
    });
    throw e;
  }
}

async function tratarMensagemPrivadaAtendimento({
  clienteId,
  sessaoId,
  sock,
  mensagem,
  planoLiberado = false
} = {}) {
  try {
    if (!usuarioAtivo(clienteId)) {
      logUsuarioInativoIgnorado({ clienteId, fluxo: "mensageiro_atendimento_privado" });
      return;
    }

    if (planoLiberado !== true) return;

    const jid = mensagem?.key?.remoteJid || "";
    const motivoJidIgnorado = motivoJidAtendimentoIgnorado(jid);

    if (motivoJidIgnorado) {
      logAtendimentoJidIgnorado({
        clienteId,
        sessaoId,
        jid,
        motivo: motivoJidIgnorado
      });
      return;
    }
    if (mensagem?.key?.fromMe) return;

    registrarMapeamentoLidMensageiro(
      sock,
      mensagem?.key?.remoteJid,
      mensagem?.key?.senderPn || mensagem?.senderPn
    );

    const texto = extrairTextoMensagemAtendimento(mensagem);

    const processouV1 = await tratarMensagemAtendimentoV1({
      clienteId,
      sessaoId,
      sock,
      mensagem,
      texto,
      jid
    });

    if (processouV1) return;

    const config = getMensageiroCliente(clienteId);
    const atendimento = config?.atendimento || {};

    if (config?.ativo !== true) return;
    if (atendimento.ativo !== true) return;
    if (String(atendimento.escopo || "privado") !== "privado") return;
    const sessaoAtendimentoLegado = String(atendimento.sessaoAtendimentoId || atendimento.sessaoId || "");
    if (sessaoAtendimentoLegado && sessaoAtendimentoLegado !== sessaoId) return;
    if (!sessaoAtendimentoLegado && config.sessaoId && config.sessaoId !== sessaoId) return;

    const respostaRapida = encontrarRespostaRapida(
      texto,
      atendimento.respostasRapidas
    );

    if (!respostaRapida) {
      if (texto) {
        logGatilhoNaoCorresponde({
          clienteId,
          sessaoId,
          jid,
          mensagem: texto,
          gatilhosVerificados: contarRespostasRapidas(atendimento.respostasRapidas)
        });
      }
      return;
    }

    const jidOriginalRespostaRapida = normalizarJidMensageiro(jid);
    const jidFinalRespostaRapida = await resolverJidPrivadoMensageiro(sock, jidOriginalRespostaRapida, { clienteId, sessaoId });
    if (!jidFinalRespostaRapida) return;

    const enviado = await executarRespostaRapida({
      sock,
      jid: jidFinalRespostaRapida,
      resposta: respostaRapida.resposta,
      delaySegundos: atendimento.delaySegundos,
      clienteId,
      sessaoId,
      jidOriginalLog: jidOriginalRespostaRapida
    });

    if (enviado) {
      logMensageiroJson("[MENSAGEIRO-ATENDIMENTO-RESPOSTA-RAPIDA-ENVIADA]", {
        clienteId,
        sessaoId,
        jidOriginal: jidOriginalRespostaRapida,
        jidFinal: jidFinalRespostaRapida,
        respostaId: respostaRapida.id || ""
      });
    }
  } catch (e) {
    console.log("[MENSAGEIRO-ERRO] atendimento privado:", e.message);
  }
}

async function tratarEventoGrupoMensageiro({
  clienteId,
  sessaoId,
  sock,
  evento
}) {
  try {
    if (!usuarioAtivo(clienteId)) {
      logUsuarioInativoIgnorado({ clienteId, fluxo: "mensageiro_evento_grupo" });
      return;
    }

    const config = getMensageiroCliente(clienteId);

    if (!config?.ativo) return;
    if (config.sessaoId && config.sessaoId !== sessaoId) return;

    const grupoId = evento.id;
    const participantes = evento.participants || [];
    const acao = evento.action;

    if (!grupoPermitido(clienteId, grupoId)) return;

    if (acao === "add" && !config.boasVindasAtivo) return;
    if ((acao === "remove" || acao === "leave") && !config.despedidaAtivo) return;

    const mensagem =
      acao === "add"
        ? obterMensagemBoasVindas(clienteId)
        : obterMensagemDespedida(clienteId);

    const imagem =
      acao === "add"
        ? config.imagemBoasVindas
        : config.imagemDespedida;

for (const participante of participantes) {

  console.log(
    "📱 PARTICIPANTE:",
    participante
  );

  const numero = String(participante).split("@")[0];
  const jidOriginal = normalizarJidMensageiro(participante);
  const destinoPrivado =
    await resolverJidPrivadoMensageiro(sock, jidOriginal, { clienteId, sessaoId }) ||
    jidOriginal;

  if (!destinoPrivado || destinoPrivado === "status@broadcast" || destinoPrivado.endsWith("@newsletter") || destinoPrivado.endsWith("@g.us")) {
    continue;
  }

  const textoFinal = String(mensagem || "")
    .replaceAll("{numero}", numero)
    .replaceAll("{grupo}", grupoId)
    .replaceAll("{acao}", acao);

    // ANTI DUPLICAÇÃO
const chaveEvento =
  `${clienteId}:${sessaoId}:${grupoId}:${participante}:${acao}`;

const agora = Date.now();
const ultimo =
  eventosMensageiroRecentes.get(chaveEvento) || 0;

if (agora - ultimo < 25 * 1000) {
  console.log("[MENSAGEIRO] Mensageiro ignorado duplicado:", {
    chaveEvento,
    segundosDesdeUltimo: Math.round((agora - ultimo) / 1000)
  });
  continue;
}

eventosMensageiroRecentes.set(
  chaveEvento,
  agora
);

      if (imagem) {
  const imagemStr = String(imagem);

  if (imagemStr.startsWith("data:image")) {
    const base64 = imagemStr.split(",")[1];
    const buffer = Buffer.from(base64, "base64");

    logMensageiroJson("[MENSAGEIRO-ENVIO-TENTANDO]", {
      clienteId,
      sessaoId,
      jidOriginal,
      jidFinal: destinoPrivado,
      tipo: "imagem",
      conteudoPreview: textoFinal.slice(0, 120)
    });
    await sock.sendMessage(destinoPrivado, {
      image: buffer,
      caption: textoFinal
    });
  } else {
    logMensageiroJson("[MENSAGEIRO-ENVIO-TENTANDO]", {
      clienteId,
      sessaoId,
      jidOriginal,
      jidFinal: destinoPrivado,
      tipo: "imagem",
      conteudoPreview: textoFinal.slice(0, 120)
    });
    await sock.sendMessage(destinoPrivado, {
      image: { url: imagemStr },
      caption: textoFinal
    });
  }
} else {
  logMensageiroJson("[MENSAGEIRO-ENVIO-TENTANDO]", {
    clienteId,
    sessaoId,
    jidOriginal,
    jidFinal: destinoPrivado,
    tipo: "texto",
    conteudoPreview: textoFinal.slice(0, 120)
  });
  await sock.sendMessage(destinoPrivado, {
    text: textoFinal
  });
}

      logMensageiroJson("[MENSAGEIRO-ENVIADO]", {
        clienteId,
        sessaoId,
        grupoId,
        participante,
        jidOriginal,
        jidFinal: destinoPrivado,
        acao
      });
    }
  } catch (e) {
    console.log("[ERRO] [MENSAGEIRO] Erro no Mensageiro:", e.message);
  }
}

module.exports = {
  mensageiroAtivo,
  boasVindasAtivo,
  despedidaAtivo,
  grupoPermitido,
  obterMensagemBoasVindas,
  obterMensagemDespedida,
  normalizarTextoMensagem,
  encontrarRespostaRapida,
  encontrarGatilhoAtendimento,
  resolverJidPrivadoMensageiro,
  executarRespostaRapida,
  executarRespostaAtendimento,
  aplicarDelayAtendimento,

  tratarEventoGrupoMensageiro,
  tratarMensagemPrivadaAtendimento,

  getMensageiroCliente,
  setMensageiroCliente
};
