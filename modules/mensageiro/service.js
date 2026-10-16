const eventosMensageiroRecentes = new Map();
const atendimentosPrivadosEmExecucao = new Map();
const eventosPrivadosRespondidos = new Map();
const DEDUPE_EVENTO_PRIVADO_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTOS_PRIVADOS_RESPONDIDOS = 5000;

function eventoPrivadoJaRespondido(chave) {
  if (!chave) return false;
  const instante = eventosPrivadosRespondidos.get(chave);
  if (!instante) return false;
  if (Date.now() - instante < DEDUPE_EVENTO_PRIVADO_MS) return true;
  eventosPrivadosRespondidos.delete(chave);
  return false;
}

function registrarEventoPrivadoRespondido(chave) {
  if (!chave) return;
  eventosPrivadosRespondidos.set(chave, Date.now());
  if (eventosPrivadosRespondidos.size > MAX_EVENTOS_PRIVADOS_RESPONDIDOS) {
    eventosPrivadosRespondidos.delete(eventosPrivadosRespondidos.keys().next().value);
  }
}

async function executarAtendimentoPrivadoExclusivo(chave, executar) {
  const anterior = atendimentosPrivadosEmExecucao.get(chave);
  let liberar;
  const atual = new Promise(resolve => { liberar = resolve; });
  atendimentosPrivadosEmExecucao.set(chave, atual);
  if (anterior) await anterior;
  try {
    return await executar();
  } finally {
    if (atendimentosPrivadosEmExecucao.get(chave) === atual) {
      atendimentosPrivadosEmExecucao.delete(chave);
    }
    liberar();
  }
}

const {
  getMensageiroCliente,
  setMensageiroCliente,
  getAtendimentoConfigCliente,
  listarAtendimentosPerfilCliente,
  listarVinculosContatoPerfilCliente,
  registrarHistoricoAtendimento,
  resolverPerfilMensageiro,
  moduloPossuiAlcanceProprio,
  gruposAlcanceModuloPerfil
} = require("./storage");
const {
  usuarioAtivo,
  logUsuarioInativoIgnorado
} = require("../../utils/usuarios-atividade");

const COOLDOWN_ATENDIMENTO_MS = 10 * 60 * 1000;
const COOLDOWN_COMANDO_MIN_MS = 5 * 1000;
const DEDUPE_COMANDO_MS = 10 * 60 * 1000;

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

function moduloEventoGrupoMensageiro(acao = "") {
  if (acao === "add") return "boasVindas";
  if (acao === "remove" || acao === "leave") return "despedida";
  return "";
}

function resolverEventoGrupoMensageiro({ clienteId, config = {}, sessaoId = "", grupoId = "", acao = "" } = {}) {
  const modulo = moduloEventoGrupoMensageiro(acao);
  if (!modulo) return { ok: false, legado: false, perfil: null, moduloConfig: null };

  const perfis = Array.isArray(config.perfis)
    ? config.perfis.filter(perfil => perfil?.ativo !== false && !perfil?.removidoEm)
    : [];

  if (!perfis.length && Array.isArray(config.perfis) && config.perfis.length) {
    return { ok: false, legado: false, perfil: null, moduloConfig: null };
  }

  if (!perfis.length) {
    return {
      ok: grupoPermitido(clienteId, grupoId),
      legado: true,
      perfil: null,
      moduloConfig: null
    };
  }

  const resolucao = resolverPerfilMensageiro({
    clienteId,
    sessaoId,
    grupoId,
    modulo,
    config
  });

  return {
    ...resolucao,
    moduloConfig: resolucao?.perfil?.modulos?.[modulo] || null
  };
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

function resolverEnvioGrupoMensageiro(config = {}, acao = "", envioOverride = null) {
  const envio = envioOverride || (acao === "add"
    ? config.boasVindasEnvio
    : config.despedidaEnvio);

  return {
    destino: envio?.destino === "grupo" ? "grupo" : "privado",
    modoGrupo: ["texto", "imagem", "imagem_texto"].includes(envio?.modoGrupo)
      ? envio.modoGrupo
      : "imagem_texto",
    mensagemTemporaria: envio?.mensagemTemporaria === true,
    apagarAposSegundos: Math.max(
      1,
      Math.min(3600, Number(envio?.apagarAposSegundos || 20) || 20)
    )
  };
}

function envioModuloEventoEfetivo(moduloConfig = {}) {
  const envio = moduloConfig?.configuracao?.envio || {};
  return Boolean(
    envio.destino === "grupo" ||
    envio.modoGrupo !== "imagem_texto" ||
    envio.mensagemTemporaria === true ||
    Number(envio.apagarAposSegundos || 20) !== 20
  );
}

function configuracaoModuloEventoEfetiva(moduloConfig = {}) {
  const configuracao = moduloConfig?.configuracao || {};
  return Boolean(
    String(configuracao.mensagem || "").trim() ||
    String(configuracao.imagem || "").trim() ||
    envioModuloEventoEfetivo(moduloConfig)
  );
}

function resolverConteudoEventoGrupo({ clienteId, config = {}, resolucao = {}, acao = "" } = {}) {
  const moduloConfig = resolucao?.moduloConfig;
  const conteudoConfigurado = moduloConfig?.conteudoConfigurado === true;
  const configuracaoPerfil = conteudoConfigurado || configuracaoModuloEventoEfetiva(moduloConfig)
    ? moduloConfig?.configuracao || {}
    : {};
  const mensagemLegada = acao === "add"
    ? obterMensagemBoasVindas(clienteId)
    : obterMensagemDespedida(clienteId);
  const imagemLegada = acao === "add"
    ? config.imagemBoasVindas
    : config.imagemDespedida;
  const envioLegado = acao === "add"
    ? config.boasVindasEnvio
    : config.despedidaEnvio;

  return {
    mensagem: String(configuracaoPerfil.mensagem || "").trim()
      ? configuracaoPerfil.mensagem
      : conteudoConfigurado ? "" : mensagemLegada,
    imagem: String(configuracaoPerfil.imagem || "").trim()
      ? configuracaoPerfil.imagem
      : conteudoConfigurado ? "" : imagemLegada,
    envio: resolverEnvioGrupoMensageiro(
      config,
      acao,
      conteudoConfigurado || envioModuloEventoEfetivo(moduloConfig)
        ? configuracaoPerfil.envio
        : envioLegado
    )
  };
}

function montarTextoEventoMensageiro(mensagem = "", { numero = "", grupoId = "", acao = "" } = {}) {
  return String(mensagem || "")
    .replaceAll("{numero}", numero)
    .replaceAll("{grupo}", grupoId)
    .replaceAll("{acao}", acao);
}

function montarPayloadImagemMensageiro(imagem = "", caption = "") {
  const imagemStr = String(imagem || "");
  if (!imagemStr) return null;

  const payload = imagemStr.startsWith("data:image")
    ? { image: Buffer.from((imagemStr.split(",")[1] || ""), "base64") }
    : { image: { url: imagemStr } };

  if (caption) payload.caption = caption;
  return payload;
}

function montarPayloadPrivadoMensageiro({ imagem = "", texto = "" } = {}) {
  const payloadImagem = montarPayloadImagemMensageiro(imagem, texto);
  if (payloadImagem) return { payload: payloadImagem, tipo: "imagem" };
  return { payload: { text: texto }, tipo: "texto" };
}

function montarPayloadGrupoMensageiro({ imagem = "", texto = "", modoGrupo = "imagem_texto" } = {}) {
  if (modoGrupo === "texto") {
    return texto ? { payload: { text: texto }, tipo: "texto" } : null;
  }

  if (modoGrupo === "imagem") {
    const payloadImagem = montarPayloadImagemMensageiro(imagem, "");
    return payloadImagem ? { payload: payloadImagem, tipo: "imagem" } : null;
  }

  const payloadImagem = montarPayloadImagemMensageiro(imagem, texto);
  if (payloadImagem) return { payload: payloadImagem, tipo: "imagem_texto" };
  return texto ? { payload: { text: texto }, tipo: "texto" } : null;
}

function montarPayloadComandoGrupo({ resposta = {}, mencionarAutor = false, participante = "" } = {}) {
  const tipo = ["texto", "imagem", "imagem_texto"].includes(resposta?.tipo)
    ? resposta.tipo
    : "texto";
  const mencaoSegura = mencionarAutor === true &&
    typeof participante === "string" &&
    (participante.endsWith("@s.whatsapp.net") || participante.endsWith("@lid"));
  const numeroMencao = mencaoSegura ? participante.split("@")[0] : "";
  const textoBase = String(resposta?.texto || "");
  const textoFinal = mencaoSegura && textoBase
    ? `@${numeroMencao} ${textoBase}`
    : textoBase;

  const envio = montarPayloadGrupoMensageiro({
    imagem: resposta?.imagem || "",
    texto: textoFinal,
    modoGrupo: tipo
  });

  if (!envio) return null;
  if (mencaoSegura && (envio.payload.text || envio.payload.caption)) {
    envio.payload.mentions = [participante];
  }

  return envio;
}

function respostaComandoSemMencao(resposta = {}) {
  return {
    ...resposta,
    texto: String(resposta?.texto || "")
  };
}

function agendarExclusaoMensagemTemporaria({
  sock,
  grupoId,
  mensagemKey,
  segundos,
  clienteId,
  sessaoId,
  acao,
  participante = ""
}) {
  if (!mensagemKey) return;

  const apagarAposSegundos = Math.max(1, Number(segundos || 20) || 20);
  logMensageiroJson("[mensagem_temporaria_agendada]", {
    clienteId,
    sessaoId,
    grupoId,
    acao,
    apagarAposSegundos
  });

  const timer = setTimeout(() => {
    Promise.resolve()
      .then(async () => {
        if (!sock || typeof sock.sendMessage !== "function") {
          throw new Error("socket_indisponivel");
        }

        await sock.sendMessage(grupoId, { delete: mensagemKey });
        logMensageiroJson("[mensagem_temporaria_apagada]", {
          clienteId,
          sessaoId,
          grupoId,
          acao
        });
        registrarHistoricoSeguro(clienteId, {
          tipo: acao === "gerente_aviso" ? "moderacao" : acao === "add" ? "boas_vindas" : "despedida",
          origem: "grupo",
          contato: participante,
          grupo: grupoId,
          resultado: "removida",
          status: "removida",
          resumo: acao === "gerente_aviso"
            ? "Aviso de moderação removido"
            : acao === "add"
              ? "Boas-vindas removida"
              : "Despedida removida",
          detalhe: "Mensagem temporária apagada no grupo"
        });
      })
      .catch((e) => {
        logMensageiroJson("[mensagem_temporaria_falha_delete]", {
          clienteId,
          sessaoId,
          grupoId,
          acao,
          erro: e?.message || String(e || "erro_desconhecido")
        });
      });
  }, apagarAposSegundos * 1000);

  if (typeof timer.unref === "function") timer.unref();
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
  jid,
  configAtendimento = null,
  perfilId = "",
  chaveEvento = ""
} = {}) {
  configAtendimento = configAtendimento || getAtendimentoConfigCliente(clienteId);

  if (configAtendimento?.atendimentoAtivo !== true && configAtendimento?.ativo !== true &&
      configAtendimento?.faqAtivo !== true && configAtendimento?.fluxosAtivo !== true) return false;
  if (configAtendimento.sessaoId && configAtendimento.sessaoId !== sessaoId) return false;
  if (!atendimentoEscopoPermitido({ clienteId, jid, escopo: configAtendimento.escopo })) return false;

  const gatilhosElegiveis = perfilId ? configAtendimento.gatilhos.filter(item =>
    (item.categoria === "faq" && configAtendimento.faqAtivo === true) ||
    (item.categoria === "fluxos" && configAtendimento.fluxosAtivo === true) ||
    (item.categoria === "atendimento" && configAtendimento.ativo === true)) : configAtendimento.gatilhos;
  const gatilho = encontrarGatilhoAtendimento(texto, gatilhosElegiveis);
  if (!gatilho) {
    if (texto) {
      logGatilhoNaoCorresponde({
        clienteId,
        sessaoId,
        jid,
        mensagem: texto,
        gatilhosVerificados: contarGatilhosAtendimento(gatilhosElegiveis)
      });
    }
    return false;
  }

  const chaveCooldown = `${clienteId}:${perfilId || "legado"}:${sessaoId}:${jid}:${gatilho.id}`;
  const agora = Date.now();
  const ultimo = eventosMensageiroRecentes.get(chaveCooldown) || 0;
  const cooldownMs = Math.max(1, Number(configAtendimento.cooldownMinutos || 10) || 10) * 60 * 1000;

  if (agora - ultimo < cooldownMs) {
    registrarHistoricoSeguro(clienteId, {
      perfilId,
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
      perfilId,
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
      if (enviada) {
        respostasEnviadas.push(`${resposta.tipo}:${String(resposta.conteudo || "").slice(0, 80)}`);
        registrarEventoPrivadoRespondido(chaveEvento);
      }
    }

    if (!respostasEnviadas.length) eventosMensageiroRecentes.delete(chaveCooldown);

    registrarHistoricoSeguro(clienteId, {
      perfilId,
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
    if (!respostasEnviadas.length) eventosMensageiroRecentes.delete(chaveCooldown);
    logMensageiroJson("[MENSAGEIRO-ATENDIMENTO-ERRO]", {
      clienteId,
      sessaoId,
      jidOriginal: jidOriginalAtendimento,
      jidFinal: jidFinalAtendimento,
      erro: e.message
    });

    registrarHistoricoSeguro(clienteId, {
      perfilId,
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

async function resolverAtendimentoPrivadoPerfil({ clienteId, sessaoId, sock, mensagem, jid }) {
  const configurados = listarAtendimentosPerfilCliente(clienteId, sessaoId, { estrito: true })
    .filter(item => item.atendimento.configurado === true);
  const elegiveis = configurados.filter(item => item.atendimento.ativo === true ||
    item.atendimento.faqAtivo === true || item.atendimento.fluxosAtivo === true ||
    item.atendimento.respostasRapidasAtivo === true);

  const senderPn = String(mensagem?.key?.senderPn || mensagem?.senderPn || "").trim();
  const pn = /^\d{5,20}(@s\.whatsapp\.net)?$/.test(senderPn)
    ? (senderPn.includes("@") ? senderPn : `${senderPn}@s.whatsapp.net`) : "";
  const contatoId = pn || (jidPrivadoWhatsappValido(jid) ? jid :
    await resolverJidPrivadoMensageiro(sock, jid, { clienteId, sessaoId }) || jid);
  const vinculos = listarVinculosContatoPerfilCliente(clienteId, sessaoId, { incluirInvalidos: true })
    .filter(item => item.contatoId === contatoId);
  if (vinculos.length) {
    if (vinculos.length !== 1) return { modo: "bloqueado", motivo: "vinculo_invalido" };
    const escolhido = elegiveis.find(item => item.perfil.id === vinculos[0].perfilId);
    return escolhido ? { modo: "perfil", ...escolhido } :
      { modo: "bloqueado", motivo: "vinculo_invalido" };
  }
  if (!configurados.length) return { modo: "legado" };
  if (elegiveis.length === 1) return { modo: "perfil", ...elegiveis[0] };
  return { modo: "bloqueado", motivo: elegiveis.length ? "contato_ambiguo" : "perfil_desativado" };
}

function comandoPossuiAlcanceProprio(comando = {}) {
  return Boolean(comando && typeof comando === "object" && comando.gruposConfigurados === true);
}

function comandoGrupoPermitido(config = {}, comando = {}, grupoId = "", sessaoId = "") {
  const gruposComando = Array.isArray(comando.grupos) ? comando.grupos : [];
  const perfis = Array.isArray(config.perfis) ? config.perfis : [];
  const perfilComando = comando.perfilId
    ? perfis.find(perfil => perfil?.id === comando.perfilId && perfil?.ativo !== false && !perfil?.removidoEm &&
      perfil?.sessaoId === sessaoId && perfil?.modulos?.comandos?.ativo === true)
    : null;
  if (comando.perfilId && !perfilComando) return false;
  if (!comando.perfilId && config.sessaoId && config.sessaoId !== sessaoId) return false;
  if (comandoPossuiAlcanceProprio(comando)) return gruposComando.includes(grupoId);
  const resolucao = perfilComando
    ? { ok: true, legado: false, perfil: perfilComando }
    : resolverPerfilMensageiro({
      clienteId: config.clienteId,
      sessaoId,
      grupoId,
      modulo: "comandos",
      config
    });
  const perfil = resolucao?.ok && resolucao.legado !== true ? resolucao.perfil : null;
  const perfilModuloConfigurado = perfil || perfis.find(item =>
    item?.ativo !== false &&
    !item?.removidoEm &&
    (!sessaoId || item?.sessaoId === sessaoId) &&
    item?.modulos?.comandos?.ativo === true &&
    moduloPossuiAlcanceProprio(item?.modulos?.comandos)
  );
  const moduloComandos = perfilModuloConfigurado?.modulos?.comandos;

  if (moduloPossuiAlcanceProprio(moduloComandos)) {
    return gruposAlcanceModuloPerfil(perfilModuloConfigurado, "comandos").includes(grupoId);
  }

  if (perfil) {
    const gruposPerfil = Array.isArray(perfil.grupos) ? perfil.grupos : [];
    return !gruposPerfil.length || gruposPerfil.includes(grupoId);
  }

  return grupoPermitido(config.clienteId, grupoId);
}

function encontrarComandoGrupo(texto = "", comandos = [], permitido = () => true) {
  const textoNormalizado = normalizarTextoMensagem(texto);
  if (!textoNormalizado || !Array.isArray(comandos)) return null;

  for (const comando of comandos) {
    if (comando?.ativo === false) continue;
    if (!permitido(comando)) continue;
    const correspondencia = comando?.correspondencia === "inicia" ? "inicia" : "exato";
    const gatilhos = Array.isArray(comando?.gatilhos) ? comando.gatilhos : [];

    for (const gatilho of gatilhos) {
      const gatilhoNormalizado = normalizarTextoMensagem(gatilho);
      if (!gatilhoNormalizado) continue;

      const encontrou = correspondencia === "inicia"
        ? textoNormalizado === gatilhoNormalizado || textoNormalizado.startsWith(`${gatilhoNormalizado} `)
        : textoNormalizado === gatilhoNormalizado;

      if (encontrou) return { comando, gatilho: gatilhoNormalizado };
    }
  }

  return null;
}

function extrairParticipanteGrupoMensagem(mensagem = {}) {
  return normalizarJidMensageiro(
    mensagem?.key?.participant ||
    mensagem?.participant ||
    mensagem?.key?.senderPn ||
    mensagem?.senderPn ||
    ""
  );
}

function nomeContatoHistorico(participante = "", mensagem = {}) {
  const nome = String(mensagem?.pushName || mensagem?.verifiedBizName || "").trim();
  if (nome) return nome;
  return String(participante || "").split("@")[0] || "Participante";
}

function chaveCooldownComando({ clienteId = "", sessaoId = "", grupoId = "", comandoId = "", participante = "", escopo = "" } = {}) {
  if (escopo === "participante") {
    return `cmd:${escopo}:${clienteId}:${sessaoId}:${comandoId}:${participante || "*"}`;
  }

  return `cmd:${escopo}:${clienteId}:${sessaoId}:${grupoId}:${comandoId}:${participante || "*"}`;
}

function comandoEmCooldown(chave, cooldownMs) {
  const agora = Date.now();
  const ultimo = eventosMensageiroRecentes.get(chave) || 0;
  return agora - ultimo < cooldownMs;
}

function marcarCooldownComando(chaves = []) {
  const agora = Date.now();
  for (const chave of chaves) {
    eventosMensageiroRecentes.set(chave, agora);
  }
}

async function tratarMensagemGrupoComando({
  clienteId,
  sessaoId,
  sock,
  mensagem,
  planoLiberado = false
} = {}) {
  try {
    if (!usuarioAtivo(clienteId)) {
      logUsuarioInativoIgnorado({ clienteId, fluxo: "mensageiro_bot_comandos" });
      return false;
    }

    if (planoLiberado !== true) return false;
    if (mensagem?.key?.fromMe) return false;

    const grupoId = normalizarJidMensageiro(mensagem?.key?.remoteJid || "");
    if (!jidGrupoWhatsapp(grupoId)) return false;

    const config = getMensageiroCliente(clienteId);
    if (config?.ativo !== true) return false;
    const texto = extrairTextoMensagemAtendimento(mensagem);
    const encontrado = encontrarComandoGrupo(texto, config.comandos, comando =>
      comandoGrupoPermitido({ ...config, clienteId }, comando, grupoId, sessaoId));
    if (!encontrado) return false;

    const { comando, gatilho } = encontrado;

    const participante = extrairParticipanteGrupoMensagem(mensagem);
    const messageId = String(mensagem?.key?.id || "");
    const chaveDedupe = `cmd:dedupe:${clienteId}:${sessaoId}:${grupoId}:${comando.id}:${messageId}`;
    if (messageId && comandoEmCooldown(chaveDedupe, DEDUPE_COMANDO_MS)) return true;

    const cooldownGrupoMs = Math.max(
      COOLDOWN_COMANDO_MIN_MS,
      Number(comando.cooldownSegundos || 30) * 1000
    );
    const cooldownParticipanteMs = Math.max(
      COOLDOWN_COMANDO_MIN_MS,
      Number(comando.cooldownParticipanteSegundos || 60) * 1000
    );
    const chaveGrupo = chaveCooldownComando({
      clienteId,
      sessaoId,
      grupoId,
      comandoId: comando.id,
      escopo: "grupo"
    });
    const chaveParticipante = chaveCooldownComando({
      clienteId,
      sessaoId,
      grupoId,
      comandoId: comando.id,
      participante,
      escopo: "participante"
    });

    if (comandoEmCooldown(chaveGrupo, cooldownGrupoMs) || comandoEmCooldown(chaveParticipante, cooldownParticipanteMs)) {
      registrarHistoricoSeguro(clienteId, {
        tipo: "comando",
        origem: "grupo",
        contato: participante,
        contatoNome: nomeContatoHistorico(participante, mensagem),
        grupo: grupoId,
        grupoNome: grupoId,
        mensagemRecebida: texto,
        comandoId: comando.id,
        comandoNome: comando.nome,
        resultado: "cooldown",
        status: "cooldown",
        resumo: `${nomeContatoHistorico(participante, mensagem)} usou ${gatilho}`,
        detalhe: "Resposta automática em cooldown"
      });
      if (messageId) eventosMensageiroRecentes.set(chaveDedupe, Date.now());
      return true;
    }

    const envioComMencao = montarPayloadComandoGrupo({
      resposta: comando.resposta,
      mencionarAutor: comando.mencionarAutor,
      participante
    });
    if (!envioComMencao) return false;

    let envioFinal = envioComMencao;
    try {
      await sock.sendMessage(grupoId, envioComMencao.payload);
    } catch (e) {
      if (!envioComMencao.payload?.mentions?.length) throw e;
      envioFinal = montarPayloadComandoGrupo({
        resposta: respostaComandoSemMencao(comando.resposta),
        mencionarAutor: false,
        participante
      });
      if (!envioFinal) throw e;
      await sock.sendMessage(grupoId, envioFinal.payload);
    }

    marcarCooldownComando([chaveGrupo, chaveParticipante]);
    if (messageId) eventosMensageiroRecentes.set(chaveDedupe, Date.now());

    registrarHistoricoSeguro(clienteId, {
      tipo: "comando",
      origem: "grupo",
      contato: participante,
      contatoNome: nomeContatoHistorico(participante, mensagem),
      grupo: grupoId,
      grupoNome: grupoId,
      mensagemRecebida: texto,
      comandoId: comando.id,
      comandoNome: comando.nome,
      respostaEnviada: [`${envioFinal.tipo}:${String(comando.resposta?.texto || comando.resposta?.imagem || "").slice(0, 80)}`],
      resultado: "enviado",
      status: "enviado",
      resumo: `${nomeContatoHistorico(participante, mensagem)} usou ${gatilho}`,
      detalhe: `Resposta automática enviada • ${grupoId}`
    });

    logMensageiroJson("[MENSAGEIRO-COMANDO-ENVIADO]", {
      clienteId,
      sessaoId,
      grupoId,
      participante,
      comandoId: comando.id,
      comandoNome: comando.nome,
      tipo: envioFinal.tipo,
      mencao: Boolean(envioFinal.payload?.mentions?.length)
    });

    return true;
  } catch (e) {
    logMensageiroJson("[MENSAGEIRO-COMANDO-ERRO]", {
      clienteId,
      sessaoId,
      grupoId: mensagem?.key?.remoteJid || "",
      erro: e?.message || String(e || "erro_desconhecido")
    });
    return false;
  }
}

async function processarMensagemPrivadaAtendimento({
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

    const roteamento = await resolverAtendimentoPrivadoPerfil({ clienteId, sessaoId, sock, mensagem, jid });
    if (roteamento.modo === "bloqueado") return;
    const perfilId = roteamento.modo === "perfil" ? roteamento.perfil.id : "";
    const mensagemId = String(mensagem?.key?.id || "").trim();
    const chaveEvento = mensagemId
      ? JSON.stringify([clienteId, sessaoId, jid, mensagemId]) : "";
    if (eventoPrivadoJaRespondido(chaveEvento)) return;

    const processouV1 = await tratarMensagemAtendimentoV1({
      clienteId,
      sessaoId,
      sock,
      mensagem,
      texto,
      jid,
      perfilId,
      chaveEvento,
      configAtendimento: roteamento.modo === "perfil" ? roteamento.atendimento : null
    });

    if (processouV1) return;

    const config = getMensageiroCliente(clienteId);
    const atendimento = perfilId ? roteamento.atendimento : config?.atendimento || {};

    if (!perfilId && config?.ativo !== true) return;
    if (perfilId ? atendimento.respostasRapidasAtivo !== true : atendimento.ativo !== true) return;
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

    const chaveResposta = perfilId ? `${clienteId}:${perfilId}:${sessaoId}:${jid}:rapida:${respostaRapida.id}` : "";
    if (chaveResposta) {
      const agora = Date.now();
      const ultimo = eventosMensageiroRecentes.get(chaveResposta) || 0;
      if (agora - ultimo < atendimento.cooldownMinutos * 60 * 1000) return;
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
      registrarEventoPrivadoRespondido(chaveEvento);
      if (chaveResposta) eventosMensageiroRecentes.set(chaveResposta, Date.now());
      if (perfilId) registrarHistoricoSeguro(clienteId, {
        perfilId,
        origem: "privado",
        contato: jid,
        mensagemRecebida: texto,
        gatilhoId: respostaRapida.id,
        respostaEnviada: ["resposta_rapida"],
        status: "enviado"
      });
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

async function tratarMensagemPrivadaAtendimento(dados = {}) {
  const jid = dados.mensagem?.key?.remoteJid || "";
  const senderPn = String(dados.mensagem?.key?.senderPn || dados.mensagem?.senderPn || "").trim();
  const contato = /^\d{5,20}(@s\.whatsapp\.net)?$/.test(senderPn)
    ? (senderPn.includes("@") ? senderPn : `${senderPn}@s.whatsapp.net`)
    : normalizarJidMensageiro(jid) || jid;
  const chave = JSON.stringify([dados.clienteId, dados.sessaoId, contato]);
  return executarAtendimentoPrivadoExclusivo(chave, () => processarMensagemPrivadaAtendimento(dados));
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

    const grupoId = evento.id;
    const participantes = evento.participants || [];
    const acao = evento.action;

    const resolucaoEvento = resolverEventoGrupoMensageiro({
      clienteId,
      config,
      sessaoId,
      grupoId,
      acao
    });
    if (resolucaoEvento?.legado === true) {
      if (config.sessaoId && config.sessaoId !== sessaoId) return;
      if (acao === "add" && !config.boasVindasAtivo) return;
      if ((acao === "remove" || acao === "leave") && !config.despedidaAtivo) return;
    }
    if (!resolucaoEvento?.ok) return;

    const conteudoEvento = resolverConteudoEventoGrupo({
      clienteId,
      config,
      resolucao: resolucaoEvento,
      acao
    });
    const mensagem = conteudoEvento.mensagem;
    const imagem = conteudoEvento.imagem;
    const envioEvento = conteudoEvento.envio;
    const eventoLogGrupo = acao === "add"
      ? "[boas_vindas_grupo_enviada]"
      : "[despedida_grupo_enviada]";

for (const participante of participantes) {

  console.log(
    "📱 PARTICIPANTE:",
    participante
  );

  const numero = String(participante).split("@")[0];
  const jidOriginal = normalizarJidMensageiro(participante);
  const textoFinal = montarTextoEventoMensageiro(mensagem, { numero, grupoId, acao });

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

  let jidFinalEnviado = "";

  if (envioEvento.destino === "grupo") {
    if (!jidGrupoWhatsapp(grupoId)) continue;
    jidFinalEnviado = grupoId;

    const envioGrupo = montarPayloadGrupoMensageiro({
      imagem,
      texto: textoFinal,
      modoGrupo: envioEvento.modoGrupo
    });
    if (!envioGrupo) continue;

    logMensageiroJson("[MENSAGEIRO-ENVIO-TENTANDO]", {
      clienteId,
      sessaoId,
      jidOriginal,
      jidFinal: grupoId,
      tipo: envioGrupo.tipo,
      destino: "grupo",
      conteudoPreview: textoFinal.slice(0, 120)
    });

    const mensagemEnviada = await sock.sendMessage(grupoId, envioGrupo.payload);

    logMensageiroJson(eventoLogGrupo, {
      clienteId,
      sessaoId,
      grupoId,
      participante,
      acao,
      tipo: envioGrupo.tipo,
      temporaria: envioEvento.mensagemTemporaria === true
    });

    registrarHistoricoSeguro(clienteId, {
      tipo: acao === "add" ? "boas_vindas" : "despedida",
      origem: "grupo",
      contato: participante,
      contatoNome: numero,
      grupo: grupoId,
      grupoNome: grupoId,
      mensagemRecebida: "",
      respostaEnviada: [envioGrupo.tipo],
      resultado: "enviado",
      status: "enviado",
      resumo: acao === "add"
        ? `${numero} entrou no grupo`
        : `${numero} saiu do grupo`,
      detalhe: envioEvento.mensagemTemporaria
        ? `${acao === "add" ? "Boas-vindas" : "Despedida"} enviada no grupo • removida após ${envioEvento.apagarAposSegundos}s`
        : `${acao === "add" ? "Boas-vindas" : "Despedida"} enviada no grupo`
    });

    if (envioEvento.mensagemTemporaria && mensagemEnviada?.key) {
      agendarExclusaoMensagemTemporaria({
        sock,
        grupoId,
        mensagemKey: mensagemEnviada.key,
        segundos: envioEvento.apagarAposSegundos,
        clienteId,
        sessaoId,
        acao,
        participante
      });
    }
  } else {
    const destinoPrivado =
      await resolverJidPrivadoMensageiro(sock, jidOriginal, { clienteId, sessaoId }) ||
      jidOriginal;

    if (!destinoPrivado || destinoPrivado === "status@broadcast" || destinoPrivado.endsWith("@newsletter") || destinoPrivado.endsWith("@g.us")) {
      continue;
    }
    jidFinalEnviado = destinoPrivado;

    const envioPrivado = montarPayloadPrivadoMensageiro({ imagem, texto: textoFinal });

    logMensageiroJson("[MENSAGEIRO-ENVIO-TENTANDO]", {
      clienteId,
      sessaoId,
      jidOriginal,
      jidFinal: destinoPrivado,
      tipo: envioPrivado.tipo,
      conteudoPreview: textoFinal.slice(0, 120)
    });
    await sock.sendMessage(destinoPrivado, envioPrivado.payload);

    registrarHistoricoSeguro(clienteId, {
      tipo: acao === "add" ? "boas_vindas" : "despedida",
      origem: "privado",
      contato: participante,
      contatoNome: numero,
      grupo: grupoId,
      grupoNome: grupoId,
      respostaEnviada: [envioPrivado.tipo],
      resultado: "enviado",
      status: "enviado",
      resumo: acao === "add"
        ? `${numero} entrou no grupo`
        : `${numero} saiu do grupo`,
      detalhe: acao === "add"
        ? "Boas-vindas enviada no privado"
        : "Despedida enviada no privado"
    });
  }

      logMensageiroJson("[MENSAGEIRO-ENVIADO]", {
        clienteId,
        sessaoId,
        grupoId,
        participante,
        jidOriginal,
        jidFinal: jidFinalEnviado,
        destino: envioEvento.destino,
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
  agendarExclusaoMensagemTemporaria,

  tratarEventoGrupoMensageiro,
  tratarMensagemGrupoComando,
  tratarMensagemPrivadaAtendimento,

  getMensageiroCliente,
  setMensageiroCliente
};
