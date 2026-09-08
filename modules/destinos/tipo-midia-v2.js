const sharp = require("sharp");
const { normalizarPrecoTextoBR } = require("../../utils/moeda");
const { baixarImagemComoBuffer } = require("../identidade-visual-ofertas/renderer");

function tipoMidiaDestino(destino = {}) {
  return String(destino.tipoMidia || "").trim().toLowerCase();
}

function destinoUsaImagem(destino = {}) {
  const tipoMidia = tipoMidiaDestino(destino);
  if (tipoMidia === "imagem_completa") return true;
  return !["texto", "imagem_link", "texto_link"].includes(tipoMidia);
}

function textoPreview(valor = "") {
  return String(valor ?? "").replace(/\s+/g, " ").trim();
}

function descricaoPreview(oferta = {}) {
  const marketplace = textoPreview(oferta.marketplace);
  const preco = normalizarPrecoTextoBR(oferta.preco ?? oferta.precoAtual);
  return [marketplace, preco ? `Por R$ ${preco}` : ""].filter(Boolean).join(" · ");
}

async function montarPreviewWhatsapp({ oferta = {}, linkFinal = "", upload, prepareWAMessageMedia, baixarImagem = baixarImagemComoBuffer, logger = console } = {}) {
  const url = textoPreview(linkFinal);
  const title = textoPreview(oferta.titulo || oferta.nome);
  const description = descricaoPreview(oferta);
  const imagem = textoPreview(oferta.imagem);
  if (!url || !title || !description || !imagem) return null;

  const imagemBuffer = await baixarImagem(imagem);
  const jpegThumbnail = await sharp(imagemBuffer, { limitInputPixels: 24_000_000 })
    .rotate()
    .resize({ width: 192, height: 192, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 75, mozjpeg: true })
    .toBuffer();
  if (!Buffer.isBuffer(jpegThumbnail) || jpegThumbnail.length === 0) return null;

  const preview = { "matched-text": url, title, description, jpegThumbnail };
  const dimensoes = async (buffer) => {
    try {
      const metadata = await sharp(buffer, { limitInputPixels: 24_000_000 }).metadata();
      return { largura: Number(metadata?.width) || null, altura: Number(metadata?.height) || null };
    } catch {
      return { largura: null, altura: null };
    }
  };
  const dimensoesJpeg = await dimensoes(jpegThumbnail);
  const registrarHq = ({ hqTentado = false, hqAnexado = false, motivoFallback = "", imagemHq = null, dimensoesHq = null, highQualityThumbnail = null } = {}) => {
    logger.log("[EXECUTOR-LINK-PREVIEW-HQ]", {
      ofertaId: String(oferta.id || oferta.ofertaId || oferta.engineOfertaId || "") || null,
      filaItemId: String(oferta.filaItemId || oferta.itemFilaId || "") || null,
      hqTentado,
      hqAnexado,
      motivoFallback: motivoFallback || null,
      larguraHq: dimensoesHq?.largura || null,
      alturaHq: dimensoesHq?.altura || null,
      bytesHq: Buffer.isBuffer(imagemHq) ? imagemHq.length : null,
      larguraHqPayload: Number(highQualityThumbnail?.width) || null,
      alturaHqPayload: Number(highQualityThumbnail?.height) || null,
      larguraJpegThumbnail: dimensoesJpeg.largura,
      alturaJpegThumbnail: dimensoesJpeg.altura,
      bytesJpegThumbnail: jpegThumbnail.length,
      camposHq: {
        directPath: Boolean(highQualityThumbnail?.directPath),
        mediaKey: Boolean(highQualityThumbnail?.mediaKey),
        fileEncSha256: Boolean(highQualityThumbnail?.fileEncSha256),
        fileSha256: Boolean(highQualityThumbnail?.fileSha256),
        mediaKeyTimestamp: Boolean(highQualityThumbnail?.mediaKeyTimestamp)
      },
      previewType: highQualityThumbnail?.previewType || preview.previewType || null
    });
  };

  if (typeof upload !== "function" || typeof prepareWAMessageMedia !== "function") {
    registrarHq({ motivoFallback: "upload_indisponivel" });
    return preview;
  }
  try {
    const imagemHq = await sharp(imagemBuffer, { limitInputPixels: 24_000_000 })
      .rotate()
      .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    const dimensoesHq = await dimensoes(imagemHq);
    const { imageMessage } = await prepareWAMessageMedia(
      { image: imagemHq },
      { upload, mediaTypeOverride: "thumbnail-link" }
    );
    const obrigatorios = ["directPath", "mediaKey", "fileEncSha256", "fileSha256", "mediaKeyTimestamp", "width", "height"];
    if (obrigatorios.every((campo) => Boolean(imageMessage?.[campo]))) {
      const highQualityThumbnail = {};
      for (const campo of [...obrigatorios, "mimetype", "fileLength", "previewType"]) {
        if (imageMessage[campo] !== undefined) highQualityThumbnail[campo] = imageMessage[campo];
      }
      preview.highQualityThumbnail = highQualityThumbnail;
      registrarHq({ hqTentado: true, hqAnexado: true, imagemHq, dimensoesHq, highQualityThumbnail });
    } else {
      logger.log("[EXECUTOR-LINK-PREVIEW-HQ-FALLBACK]", { motivoFallback: "hq_retorno_incompleto" });
      registrarHq({ hqTentado: true, motivoFallback: "hq_retorno_incompleto", imagemHq, dimensoesHq, highQualityThumbnail: imageMessage });
    }
  } catch (_erro) {
    logger.log("[EXECUTOR-LINK-PREVIEW-HQ-FALLBACK]", { motivoFallback: "hq_upload_erro" });
    registrarHq({ hqTentado: true, motivoFallback: "hq_upload_erro" });
  }
  return preview;
}

async function montarPayloadTextoWhatsappPorTipoMidia({ mensagem = "", destino = {}, linkFinal = "", oferta = {}, upload, prepareWAMessageMedia, baixarImagem, logger = console } = {}) {
  const tipoMidia = tipoMidiaDestino(destino);
  if (tipoMidia === "texto_link") return { text: mensagem, linkPreview: null };
  if (tipoMidia !== "imagem_link") return { text: mensagem };
  try {
    const preview = await montarPreviewWhatsapp({ oferta, linkFinal, upload, prepareWAMessageMedia, baixarImagem, logger });
    return preview ? { text: mensagem, linkPreview: preview } : { text: mensagem, linkPreview: null };
  } catch (erro) {
    logger.log("[EXECUTOR-LINK-PREVIEW-FALLBACK]", {
      destino: destino.nome || destino.id || "",
      motivo: erro?.message || "link_preview_indisponivel"
    });
    return { text: mensagem, linkPreview: null };
  }
}

function montarPayloadTextoTelegramPorTipoMidia({ chatId = "", mensagem = "", destino = {} } = {}) {
  return {
    chat_id: chatId,
    text: mensagem,
    ...(tipoMidiaDestino(destino) === "texto_link" ? { link_preview_options: { is_disabled: true } } : {})
  };
}

function opcoesDiscordPorTipoMidia(destino = {}, imagemUrl = "") {
  const tipoMidia = tipoMidiaDestino(destino);
  return {
    imagemUrl: destinoUsaImagem(destino) ? imagemUrl : "",
    suprimirEmbeds: tipoMidia === "texto_link"
  };
}

module.exports = {
  tipoMidiaDestino,
  destinoUsaImagem,
  montarPreviewWhatsapp,
  montarPayloadTextoWhatsappPorTipoMidia,
  montarPayloadTextoTelegramPorTipoMidia,
  opcoesDiscordPorTipoMidia
};
