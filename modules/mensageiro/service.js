const eventosMensageiroRecentes = new Map();

const {
  getMensageiroCliente,
  setMensageiroCliente
} = require("./storage");

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
    "ðŸ‘‹ Seja bem-vindo!"
  );
}

function obterMensagemDespedida(clienteId) {
  return (
    getMensageiroCliente(clienteId)
      ?.mensagemDespedida ||
    "ðŸ˜¢ Obrigado por participar."
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
      respostaRapida.tipoCorrespondencia || "contem"
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

function aplicarDelayAtendimento(delaySegundos = 0) {
  const segundos = Math.max(0, Number(delaySegundos || 0) || 0);
  const ms = Math.min(segundos, 60) * 1000;

  if (!ms) return Promise.resolve();

  return new Promise(resolve => setTimeout(resolve, ms));
}

async function executarRespostaRapida({ sock, jid, resposta, delaySegundos = 0 } = {}) {
  const conteudo = String(resposta?.conteudo || "").trim();
  const tipo = String(resposta?.tipo || "texto").toLowerCase();

  if (!sock || !jid || !conteudo) return false;
  if (tipo !== "texto") return false;

  try {
    await sock.sendPresenceUpdate?.("composing", jid);
  } catch (e) {
    console.log("[MENSAGEIRO-FLUXO] digitando indisponivel:", e.message);
  }

  await aplicarDelayAtendimento(delaySegundos);

  try {
    await sock.sendPresenceUpdate?.("paused", jid);
  } catch {}

  await sock.sendMessage(jid, { text: conteudo });
  return true;
}

async function tratarMensagemPrivadaAtendimento({
  clienteId,
  sessaoId,
  sock,
  mensagem,
  planoLiberado = false
} = {}) {
  try {
    if (planoLiberado !== true) return;

    const config = getMensageiroCliente(clienteId);
    const atendimento = config?.atendimento || {};

    if (config?.ativo !== true) return;
    if (config.sessaoId && config.sessaoId !== sessaoId) return;
    if (atendimento.ativo !== true) return;
    if (String(atendimento.escopo || "privado") !== "privado") return;

    const jid = mensagem?.key?.remoteJid || "";

    if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast") return;
    if (mensagem?.key?.fromMe) return;

    const texto = extrairTextoMensagemAtendimento(mensagem);
    const respostaRapida = encontrarRespostaRapida(
      texto,
      atendimento.respostasRapidas
    );

    if (!respostaRapida) return;

    const enviado = await executarRespostaRapida({
      sock,
      jid,
      resposta: respostaRapida.resposta,
      delaySegundos: atendimento.delaySegundos
    });

    if (enviado) {
      console.log("[MENSAGEIRO-ATENDIMENTO] resposta rapida enviada", {
        clienteId,
        sessaoId,
        jid,
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
    "ðŸ“± PARTICIPANTE:",
    participante
  );

  const numero = String(participante).split("@")[0];
  const destinoPrivado = participante;

  const textoFinal = String(mensagem || "")
    .replaceAll("{numero}", numero)
    .replaceAll("{grupo}", grupoId)
    .replaceAll("{acao}", acao);

    // ANTI DUPLICAÃ‡ÃƒO
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

    await sock.sendMessage(destinoPrivado, {
      image: buffer,
      caption: textoFinal
    });
  } else {
    await sock.sendMessage(destinoPrivado, {
      image: { url: imagemStr },
      caption: textoFinal
    });
  }
} else {
  await sock.sendMessage(destinoPrivado, {
    text: textoFinal
  });
}

      console.log("[MENSAGEIRO] Mensageiro enviado:", {
        clienteId,
        sessaoId,
        grupoId,
        participante,
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
  executarRespostaRapida,
  aplicarDelayAtendimento,

  tratarEventoGrupoMensageiro,
  tratarMensagemPrivadaAtendimento,

  getMensageiroCliente,
  setMensageiroCliente
};
