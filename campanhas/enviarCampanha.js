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
  imagemUrl,
  tipo: typeof imagemUrl,
  inicio: String(imagemUrl || "").slice(0, 120)
});
     
try {

  const respostaTelegram = await axios.post(
    `https://api.telegram.org/bot${tel.botToken}/sendPhoto`,
    {
      chat_id: tel.chatId,
      photo: corrigirImagemUrl(imagemUrl) || imagemUrl,
      caption: mensagem
    }
  );

  console.log("✅ TELEGRAM FOTO OK:", respostaTelegram.data);

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