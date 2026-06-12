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
    "📱 PARTICIPANTE:",
    participante
  );

  const numero = String(participante).split("@")[0];
  const destinoPrivado = participante;

  const textoFinal = String(mensagem || "")
    .replaceAll("{numero}", numero)
    .replaceAll("{grupo}", grupoId)
    .replaceAll("{acao}", acao);

console.log("🧪 DESTINO PRIVADO:", destinoPrivado);
console.log("🧪 TEXTO FINAL:", textoFinal);

    // ANTI DUPLICAÇÃO
const chaveEvento =
  `${clienteId}:${sessaoId}:${grupoId}:${participante}:${acao}`;

const agora = Date.now();
const ultimo =
  eventosMensageiroRecentes.get(chaveEvento) || 0;

if (agora - ultimo < 5 * 60 * 1000) {
  console.log(
    "⏭️ Mensageiro ignorado duplicado:",
    chaveEvento
  );
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

      console.log("🤖 Mensageiro enviado:", {
        clienteId,
        sessaoId,
        grupoId,
        participante,
        acao
      });
    }
  } catch (e) {
    console.log("❌ Erro no Mensageiro:", e.message);
  }
}

module.exports = {
  mensageiroAtivo,
  boasVindasAtivo,
  despedidaAtivo,
  grupoPermitido,
  obterMensagemBoasVindas,
  obterMensagemDespedida,

  tratarEventoGrupoMensageiro,

  getMensageiroCliente,
  setMensageiroCliente
};