const sharp = require("sharp");

async function otimizarBase64(imagem) {
  try {
    if (
      !imagem ||
      typeof imagem !== "string" ||
      !imagem.startsWith("data:image")
    ) {
      return imagem;
    }

    const base64 = imagem.split(",")[1];
    const buffer = Buffer.from(base64, "base64");

    const tamanhoKB =
      Math.round(buffer.length / 1024);

    console.log(
      "🖼️ Imagem recebida:",
      tamanhoKB,
      "KB"
    );

    if (buffer.length <= 500 * 1024) {
      return imagem;
    }

    const otimizada = await sharp(buffer)
      .resize({
        width: 1200,
        withoutEnlargement: true
      })
      .jpeg({
        quality: 78,
        mozjpeg: true
      })
      .toBuffer();

    console.log(
      "⚡ Imagem otimizada:",
      Math.round(otimizada.length / 1024),
      "KB"
    );

    return (
      "data:image/jpeg;base64," +
      otimizada.toString("base64")
    );
  } catch (e) {
    console.log(
      "❌ Erro ao otimizar imagem:",
      e.message
    );

    return imagem;
  }
}

module.exports = {
  otimizarBase64
};