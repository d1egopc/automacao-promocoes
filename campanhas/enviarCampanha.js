const axios = require("axios");
const FormData = require("form-data");

function listarDestinosCliente(destinosCliente) {
  if (Array.isArray(destinosCliente)) return destinosCliente;

  if (!destinosCliente || typeof destinosCliente !== "object") {
    return [];
  }

  return Object.values(destinosCliente)
    .flatMap(item => Array.isArray(item) ? item : [])
    .filter(Boolean);
}

function textoTelegram(valor) {
  return valor == null ? "" : String(valor).trim();
}

function normalizarTelegramSalvo(telegram = {}) {
  const botToken = textoTelegram(
    telegram.botToken || telegram.token || telegram.telegramToken
  );
  const chatId = textoTelegram(
    telegram.chatId || telegram.grupoId || telegram.canalId || telegram.channelId
  );

  const chaves = [
    telegram.id,
    telegram.botId,
    telegram.telegramId,
    telegram.destinoId,
    telegram.nome,
    telegram.apelido,
    telegram.username,
    telegram.chatId,
    telegram.grupoId,
    telegram.canalId,
    telegram.channelId
  ].map(textoTelegram).filter(Boolean);

  return {
    ...telegram,
    botToken,
    chatId,
    ativo: telegram.ativo !== false,
    chaves
  };
}

function telegramTemCredenciais(telegram = {}) {
  const normalizado = normalizarTelegramSalvo(telegram);
  return normalizado.botToken && normalizado.chatId ? normalizado : null;
}

function idsTelegramDestino(destino = {}) {
  const ids = [];

  if (Array.isArray(destino.telegramDestinos)) {
    ids.push(...destino.telegramDestinos);
  }

  ids.push(
    destino.telegramId,
    destino.botId,
    destino.destinoId,
    destino.idTelegram,
    destino.conexaoId,
    destino.sessao,
    destino.chatId,
    destino.grupoId,
    destino.canalId,
    destino.channelId
  );

  return ids.map(textoTelegram).filter(Boolean);
}

function telegramsDiretosDestino(destino = {}) {
  const diretos = [];

  const direto = telegramTemCredenciais(destino);
  if (direto) diretos.push(direto);

  if (Array.isArray(destino.telegramDestinos)) {
    destino.telegramDestinos.forEach(item => {
      if (item && typeof item === "object") {
        const normalizado = telegramTemCredenciais(item);
        if (normalizado) diretos.push(normalizado);
      }
    });
  }

  if (destino.telegram && typeof destino.telegram === "object") {
    const normalizado = telegramTemCredenciais(destino.telegram);
    if (normalizado) diretos.push(normalizado);
  }

  return diretos;
}

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

  const destinosCliente = listarDestinosCliente(
    destinosPorCliente?.[clienteId]
  );

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
  const telegrams = Array.isArray(configCliente.telegram?.destinos)
    ? configCliente.telegram.destinos.map(normalizarTelegramSalvo)
    : [];
  const telegramsSelecionados = idsTelegramDestino(destino);
  const telegramsDiretos = telegramsDiretosDestino(destino);

  let selecionados = telegramsSelecionados.length
    ? telegrams.filter(t =>
        telegramsSelecionados.some(id => t.chaves.includes(id))
      )
    : telegrams.filter(t => t.ativo);

  if (telegramsDiretos.length) {
    selecionados = [...telegramsDiretos, ...selecionados];
  }

  if (!selecionados.length && telegrams.length === 1) {
    selecionados = telegrams.filter(t => t.ativo);
  }

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

    if (!tel.botToken || !tel.chatId) {
      resultado.erros++;
      resultado.detalhes.push({
        destino: destino.nome,
        tipo: "telegram",
        status: "erro",
        motivo: "Token ou Chat ID ausente"
      });
      continue;
    }

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
  console.log("[TELEGRAM] DEBUG IMAGEM CAMPANHA TELEGRAM:", {
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

      console.log("[TELEGRAM] TELEGRAM FOTO OK:", respostaTelegram.data);

    } else {
      const respostaTelegram = await axios.post(
        `https://api.telegram.org/bot${tel.botToken}/sendPhoto`,
        {
          chat_id: tel.chatId,
          photo: corrigirImagemUrl(imagemUrl) || imagemUrl,
          caption: mensagem
        }
      );

      console.log("[TELEGRAM] TELEGRAM FOTO OK:", respostaTelegram.data);
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
    let base64Data = imagemTexto;

    if (ehDataImage) {
      const match = imagemTexto.match(
        /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/
      );

      if (!match) {
        throw new Error("Imagem base64 inválida para WhatsApp");
      }

      base64Data = match[1];
    }

    const buffer = Buffer.from(base64Data, "base64");

    await sock.sendMessage(grupo, {
      image: buffer,
      caption: mensagem
    });

  } else {
    await sock.sendMessage(grupo, {
      image: {
        url: corrigirImagemUrl(imagemUrl) || imagemUrl
      },
      caption: mensagem
    });
  }

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
