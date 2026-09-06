const socialMediaStorage = require("../social/social-media-storage");

const LOG_TAG = "[RADAR-IMAGEM-MATERIALIZACAO]";

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function objetoSeguro(valor) {
  return valor && typeof valor === "object" ? valor : {};
}

function loggerSeguro(logger = console) {
  return logger && typeof logger.log === "function" ? logger : console;
}

function logMaterializacao(logger, etapa, payload = {}) {
  loggerSeguro(logger).log(LOG_TAG, {
    etapa,
    ...payload
  });
}

function encontrarImageMessage(valor, profundidade = 0, visitados = new WeakSet()) {
  if (!valor || typeof valor !== "object" || profundidade > 8) return null;
  if (visitados.has(valor)) return null;
  visitados.add(valor);

  if (valor.imageMessage && typeof valor.imageMessage === "object") return valor.imageMessage;
  if (valor.message && typeof valor.message === "object") {
    const encontrada = encontrarImageMessage(valor.message, profundidade + 1, visitados);
    if (encontrada) return encontrada;
  }

  for (const chave of ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension", "documentWithCaptionMessage"]) {
    const encontrada = encontrarImageMessage(valor[chave], profundidade + 1, visitados);
    if (encontrada) return encontrada;
  }

  return null;
}

function montarContextoBaileys(sock) {
  if (!sock || typeof sock.updateMediaMessage !== "function") return undefined;
  return {
    reuploadRequest: sock.updateMediaMessage.bind(sock),
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
      trace() {},
      child() {
        return this;
      }
    }
  };
}

function nomeLogicoRadar(mensagem = {}) {
  const mensagemId = texto(mensagem?.key?.id || "sem_id")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 48) || "sem_id";
  return `radar_whatsapp_${mensagemId}`;
}

async function materializarImagemRadarWhatsApp({
  mensagem = {},
  sock = null,
  sessaoId = "",
  remoteJid = "",
  grupoNome = "",
  clienteId = "engine",
  storage = socialMediaStorage,
  downloadMediaMessageImpl,
  logger = console
} = {}) {
  const imageMessage = encontrarImageMessage(mensagem?.message || mensagem);
  if (!imageMessage) return { ok: false, motivo: "sem_image_message", detectada: false };

  const contextoLog = {
    sessaoId: texto(sessaoId),
    remoteJid: texto(remoteJid),
    grupoNome: texto(grupoNome),
    mensagemId: texto(mensagem?.key?.id || ""),
    origem: "whatsapp/imageMessage",
    possuiUrl: Boolean(imageMessage.url),
    possuiMediaKey: Boolean(imageMessage.mediaKey),
    mimeTypeDeclarado: texto(imageMessage.mimetype || imageMessage.mimeType || ""),
    bytesDeclarados: Number(imageMessage.fileLength || 0) || null
  };

  logMaterializacao(logger, "detectada", contextoLog);

  if (typeof downloadMediaMessageImpl !== "function") {
    logMaterializacao(logger, "falha", {
      ...contextoLog,
      motivo: "download_media_message_indisponivel"
    });
    return { ok: false, motivo: "download_media_message_indisponivel", detectada: true };
  }

  if (!sock) {
    logMaterializacao(logger, "falha", {
      ...contextoLog,
      motivo: "sock_indisponivel"
    });
    return { ok: false, motivo: "sock_indisponivel", detectada: true };
  }

  try {
    logMaterializacao(logger, "tentativa", contextoLog);
    const buffer = await downloadMediaMessageImpl(
      mensagem,
      "buffer",
      {},
      montarContextoBaileys(sock)
    );

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      logMaterializacao(logger, "falha", {
        ...contextoLog,
        motivo: "buffer_vazio"
      });
      return { ok: false, motivo: "buffer_vazio", detectada: true };
    }

    const mimeReal = storage.detectarMime ? storage.detectarMime(buffer) : "";
    if (!mimeReal || !mimeReal.startsWith("image/")) {
      logMaterializacao(logger, "falha", {
        ...contextoLog,
        motivo: "mime_nao_imagem",
        bytes: buffer.length
      });
      return { ok: false, motivo: "mime_nao_imagem", detectada: true, bytes: buffer.length };
    }

    const salva = storage.salvar({
      clienteId: texto(clienteId || "engine") || "engine",
      buffer,
      mimeType: mimeReal,
      nomeLogico: nomeLogicoRadar(mensagem)
    });

    logMaterializacao(logger, "sucesso", {
      ...contextoLog,
      imagemDuravel: true,
      imagemEnviavel: true,
      mimeType: salva.mimeType,
      bytes: salva.bytes,
      storage: "social_media_storage"
    });

    const materializadaEm = new Date().toISOString();
    return {
      ok: true,
      detectada: true,
      urlDuravel: salva.url,
      mimeType: salva.mimeType,
      bytes: salva.bytes,
      midia: {
        imagemMaterializada: salva.url,
        imagemDuravel: salva.url,
        imagemEnviavel: salva.url,
        imagemStatus: "radar_mirror_baileys_materializada",
        imagemMaterializadaEm: materializadaEm,
        imagemMaterializacaoOrigem: "radar_whatsapp/baileys",
        imagemMaterializacaoStorage: "social_media_storage",
        imagemMaterializacaoMimeType: salva.mimeType,
        imagemMaterializacaoBytes: salva.bytes
      }
    };
  } catch (erro) {
    logMaterializacao(logger, "falha", {
      ...contextoLog,
      motivo: erro?.message || "materializacao_falhou"
    });
    return {
      ok: false,
      detectada: true,
      motivo: erro?.message || "materializacao_falhou"
    };
  }
}

function aplicarMidiaMaterializadaRadarMirror(radarMirror = {}, materializacao = {}) {
  const mirror = objetoSeguro(radarMirror);
  const midiaAtual = objetoSeguro(mirror.midia);
  const midiaMaterializada = objetoSeguro(materializacao.midia);
  if (!materializacao.ok || !Object.keys(midiaMaterializada).length) return mirror;

  return {
    ...mirror,
    midia: {
      ...midiaAtual,
      imagemOrigem: midiaAtual.imagemOrigem || "mensagem",
      ...midiaMaterializada
    }
  };
}

module.exports = {
  materializarImagemRadarWhatsApp,
  aplicarMidiaMaterializadaRadarMirror,
  encontrarImageMessage
};
