const axios = require("axios");
const FormData = require("form-data");

async function enviarCampanhaManual({
  clienteId,
  mensagem,
  imagemUrl = "",
  destinosIds = [],
  destinosPorCliente,
  sessoes,
  configsPorCliente,
  usuarioTemCreditos,
  debitarCreditos,
  corrigirImagemUrl
}) {
  if (!clienteId) {
    throw new Error("clienteId obrigatório");
  }

  if (!mensagem || !String(mensagem).trim()) {
    throw new Error("Mensagem obrigatória");
  }

  const destinosCliente =
    destinosPorCliente?.[clienteId] || [];

  const destinosSelecionados = destinosIds.length
    ? destinosCliente.filter(d => destinosIds.includes(d.id))
    : [];

  if (!destinosSelecionados.length) {
    throw new Error("Nenhum destino selecionado");
  }

  const resultado = {
    clienteId,
    totalDestinos: destinosSelecionados.length,
    enviados: 0,
    erros: 0,
    detalhes: []
  };

  for (const destino of destinosSelecionados) {
    try {
    const tipo = String(destino.tipo || "").toLowerCase();

if (tipo === "telegram") {
  const configCliente = configsPorCliente?.[clienteId] || {};
  const telegrams = configCliente.telegram?.destinos || [];
  const telegramsSelecionados = destino.telegramDestinos || [];

  const selecionados = telegramsSelecionados.length
    ? telegrams.filter(t =>
        telegramsSelecionados.includes(t.nome) ||
        telegramsSelecionados.includes(String(t.chatId))
      )
    : telegrams.filter(t => t.ativo);

  if (!selecionados.length) {
    resultado.erros++;
    resultado.detalhes.push({
      destino: destino.nome,
      tipo: "telegram",
      status: "erro",
      motivo: "Nenhum Telegram selecionado"
    });
    continue;
  }

  for (const tel of selecionados) {
    if (!tel.ativo) continue;

    if (!usuarioTemCreditos(clienteId, 1)) {
      resultado.erros++;
      resultado.detalhes.push({
        destino: destino.nome,
        chatId: tel.chatId,
        status: "erro",
        motivo: "Sem créditos"
      });
      continue;
    }

   if (imagemUrl) {
  console.log("🖼️ DEBUG IMAGEM CAMPANHA TELEGRAM:", {
    tipo: typeof imagemUrl,
    inicio: String(imagemUrl || "").slice(0, 80)
  });

  try {
    const imagemTexto = String(imagemUrl || "");

    const ehUrl =
      imagemTexto.startsWith("http://") ||
      imagemTexto.startsWith("https://");

    const ehDataImage =
      imagemTexto.startsWith("data:image");

    const pareceBase64Puro =
      !ehUrl &&
      !imagemTexto.startsWith("data:") &&
      imagemTexto.length > 500;

    if (ehDataImage || pareceBase64Puro) {
      let mimeType = "image/jpeg";
      let base64Data = imagemTexto;

      if (ehDataImage) {
        const match = imagemTexto.match(
          /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
        );

        if (!match) {
          throw new Error("Imagem base64 inválida para Telegram");
        }

        mimeType = match[1];
        base64Data = match[2];
      } else {
        if (imagemTexto.startsWith("UklGR")) {
          mimeType = "image/webp";
        } else if (imagemTexto.startsWith("iVBOR")) {
          mimeType = "image/png";
        } else if (imagemTexto.startsWith("/9j/")) {
          mimeType = "image/jpeg";
        }
      }

      const buffer = Buffer.from(base64Data, "base64");

      const ext =
        mimeType.includes("png") ? "png" :
        mimeType.includes("webp") ? "webp" :
        "jpg";

      const form = new FormData();

      form.append("chat_id", String(tel.chatId));
      form.append("caption", mensagem);
      form.append("photo", buffer, {
        filename: `campanha.${ext}`,
        contentType: mimeType
      });

      const respostaTelegram = await axios.post(
        `https://api.telegram.org/bot${tel.botToken}/sendPhoto`,
        form,
        {
          headers: form.getHeaders(),
          maxBodyLength: Infinity,
          maxContentLength: Infinity
        }
      );

      console.log("✅ TELEGRAM FOTO OK:", respostaTelegram.data);

    } else {
      const respostaTelegram = await axios.post(
        `https://api.telegram.org/bot${tel.botToken}/sendPhoto`,
        {
          chat_id: tel.chatId,
          photo: corrigirImagemUrl(imagemUrl) || imagemUrl,
          caption: mensagem
        }
      );

      console.log("✅ TELEGRAM FOTO OK:", respostaTelegram.data);
    }

  } catch (erroTelegram) {
    console.log(
      "❌ TELEGRAM FOTO ERRO:",
      erroTelegram.response?.data || erroTelegram.message
    );

    throw erroTelegram;
  }

} else {


      await axios.post(
        `https://api.telegram.org/bot${tel.botToken}/sendMessage`,
        {
          chat_id: tel.chatId,
          text: mensagem
        }
      );
    }

    debitarCreditos(clienteId, 1);
    resultado.enviados++;

    resultado.detalhes.push({
      destino: destino.nome,
      tipo: "telegram",
      chatId: tel.chatId,
      status: "enviado",
      creditos: 1
    });

    await new Promise(r => setTimeout(r, 2000));
  }

  continue;
}

if (tipo !== "whatsapp") {
  resultado.detalhes.push({
    destino: destino.nome,
    tipo: destino.tipo,
    status: "ignorado",
    motivo: "Tipo não suportado"
  });
  continue;
}

      const sock = sessoes[destino.conexaoId];

      if (!sock) {
        resultado.erros++;
        resultado.detalhes.push({
          destino: destino.nome,
          tipo: "whatsapp",
          status: "erro",
          motivo: "Sessão não encontrada"
        });
        continue;
      }

      const grupos = destino.gruposWhatsapp || [];

      if (!grupos.length) {
        resultado.erros++;
        resultado.detalhes.push({
          destino: destino.nome,
          tipo: "whatsapp",
          status: "erro",
          motivo: "Destino sem grupos"
        });
        continue;
      }

      for (const grupo of grupos) {
        if (!usuarioTemCreditos(clienteId, 1)) {
          resultado.erros++;
          resultado.detalhes.push({
            destino: destino.nome,
            grupo,
            status: "erro",
            motivo: "Sem créditos"
          });
          continue;
        }

        if (imagemUrl) {
          await sock.sendMessage(grupo, {
            image: {
              url: corrigirImagemUrl(imagemUrl) || imagemUrl
            },
            caption: mensagem
          });
        } else {
          await sock.sendMessage(grupo, {
            text: mensagem
          });
        }

        debitarCreditos(clienteId, 1);

        resultado.enviados++;

        resultado.detalhes.push({
          destino: destino.nome,
          grupo,
          status: "enviado",
          creditos: 1
        });

        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (e) {
      resultado.erros++;
      resultado.detalhes.push({
        destino: destino.nome,
        status: "erro",
        motivo: e.message
      });
    }
  }

  return resultado;
}

module.exports = {
  enviarCampanhaManual
};