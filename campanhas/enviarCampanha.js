const {
  obterMidiaTemporaria,
  marcarMidiaEmUso,
  liberarMidiaTemporaria,
  excluirMidiaTemporaria
} = require("./midiaTemporaria");

const {
  registrarHistoricoCampanha
} = require("./historicoCampanhas");

const TIPOS_MIDIA_UPLOAD = new Set(["imagem", "video", "documento"]);

async function httpPostPadrao(url, body, config = {}) {
  if (typeof fetch !== "function") {
    throw new Error("campanhas_http_client_indisponivel");
  }

  const headers = config.headers || {};
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const resposta = await fetch(url, {
    method: "POST",
    headers: isFormData ? headers : { "content-type": "application/json", ...headers },
    body: isFormData ? body : JSON.stringify(body || {})
  });
  const textoResposta = await resposta.text();
  let data = textoResposta;
  try {
    data = textoResposta ? JSON.parse(textoResposta) : {};
  } catch {}
  if (!resposta.ok) {
    const erro = new Error(data?.description || data?.message || `http_${resposta.status}`);
    erro.response = { status: resposta.status, data };
    throw erro;
  }
  return { status: resposta.status, data };
}

const HTTP_CLIENT_PADRAO = { post: httpPostPadrao };

function criarFormDataArquivo({ campo, buffer, filename, mimeType, mensagem, chatId }) {
  if (typeof FormData === "undefined" || typeof Blob === "undefined") {
    throw new Error("campanhas_form_data_indisponivel");
  }
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", mensagem);
  form.append(campo, new Blob([buffer], { type: mimeType }), filename);
  return form;
}
function texto(valor) {
  return valor == null ? "" : String(valor).trim();
}

function listarDestinosCliente(destinosCliente) {
  if (Array.isArray(destinosCliente)) return destinosCliente;

  if (!destinosCliente || typeof destinosCliente !== "object") {
    return [];
  }

  return Object.values(destinosCliente)
    .flatMap(item => Array.isArray(item) ? item : [])
    .filter(Boolean);
}

function normalizarTelegramSalvo(telegram = {}) {
  const botToken = texto(
    telegram.botToken || telegram.token || telegram.telegramToken
  );
  const chatId = texto(
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
  ].map(texto).filter(Boolean);

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

  return ids.map(texto).filter(Boolean);
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

function logMidia(tag, dados = {}) {
  const payload = {};
  for (const [chave, valor] of Object.entries(dados)) {
    if (valor !== undefined && valor !== "") payload[chave] = valor;
  }
  if ("grupoPresente" in dados) payload.grupoPresente = Boolean(dados.grupoPresente);
  if ("chatIdPresente" in dados) payload.chatIdPresente = Boolean(dados.chatIdPresente);
  console.log(tag, payload);
}

function criarMidiaImagemUrl(imagemUrl = "") {
  const url = texto(imagemUrl);
  if (!url) return null;
  return {
    origem: "imagemUrl",
    tipo: "imagem",
    imagemUrl: url
  };
}

function resolverMidiaPorId({ clienteId, midiaId }) {
  const id = texto(midiaId);
  if (!id) return null;

  let marcada = false;
  try {
    marcarMidiaEmUso({ clienteId, midiaId: id });
    marcada = true;
    const midia = obterMidiaTemporaria(clienteId, id);

    if (!TIPOS_MIDIA_UPLOAD.has(midia.tipo)) {
      throw new Error("campanhas_midia_tipo_incompativel");
    }

    return {
      origem: "midiaId",
      midiaId: id,
      tipo: midia.tipo,
      mimeType: midia.mimeType,
      nomeOriginal: midia.nomeOriginal,
      bytes: midia.bytes,
      buffer: midia.buffer
    };
  } catch (e) {
    if (marcada) {
      try {
        liberarMidiaTemporaria({ clienteId, midiaId: id, status: "associada" });
      } catch {}
    }
    throw e;
  }
}

function resolverMidia({ clienteId, midiaId = "", imagemUrl = "" }) {
  const upload = resolverMidiaPorId({ clienteId, midiaId });
  if (upload) return upload;
  return criarMidiaImagemUrl(imagemUrl);
}

function base64ImagemLegada(imagemUrl = "") {
  const imagemTexto = String(imagemUrl || "");
  const ehUrl = imagemTexto.startsWith("http://") || imagemTexto.startsWith("https://");
  const ehDataImage = imagemTexto.startsWith("data:image");
  const pareceBase64Puro = !ehUrl && !imagemTexto.startsWith("data:") && imagemTexto.length > 500;

  if (!ehDataImage && !pareceBase64Puro) return null;

  let mimeType = "image/jpeg";
  let base64Data = imagemTexto;

  if (ehDataImage) {
    const match = imagemTexto.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) throw new Error("Imagem base64 invalida");
    mimeType = match[1];
    base64Data = match[2];
  } else if (imagemTexto.startsWith("UklGR")) {
    mimeType = "image/webp";
  } else if (imagemTexto.startsWith("iVBOR")) {
    mimeType = "image/png";
  }

  const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
  return { buffer: Buffer.from(base64Data, "base64"), mimeType, ext };
}

async function aguardar(ms = 0) {
  const tempo = Number(ms);
  if (!Number.isFinite(tempo) || tempo <= 0) return;
  await new Promise(resolve => setTimeout(resolve, tempo));
}

async function enviarWhatsApp({ sock, grupo, mensagem, midia, corrigirImagemUrl }) {
  if (!midia) {
    await sock.sendMessage(grupo, { text: mensagem });
    return;
  }

  if (midia.origem === "imagemUrl") {
    const base64 = base64ImagemLegada(midia.imagemUrl);
    if (base64) {
      await sock.sendMessage(grupo, { image: base64.buffer, caption: mensagem });
      return;
    }

    await sock.sendMessage(grupo, {
      image: { url: corrigirImagemUrl(midia.imagemUrl) || midia.imagemUrl },
      caption: mensagem
    });
    return;
  }

  switch (midia.tipo) {
    case "imagem":
      await sock.sendMessage(grupo, { image: midia.buffer, caption: mensagem });
      return;
    case "video":
      await sock.sendMessage(grupo, { video: midia.buffer, mimetype: midia.mimeType, caption: mensagem });
      return;
    case "documento":
      await sock.sendMessage(grupo, {
        document: midia.buffer,
        mimetype: midia.mimeType,
        fileName: midia.nomeOriginal || "documento",
        caption: mensagem
      });
      return;
    default:
      throw new Error("campanhas_midia_tipo_incompativel");
  }
}

async function enviarTelegramMidiaUpload({ httpClient, tel, mensagem, midia }) {
  const config = {
    imagem: { metodo: "sendPhoto", campo: "photo", nome: "campanha" },
    video: { metodo: "sendVideo", campo: "video", nome: "campanha" },
    documento: { metodo: "sendDocument", campo: "document", nome: midia.nomeOriginal || "documento" }
  }[midia.tipo];

  if (!config) throw new Error("campanhas_midia_tipo_incompativel");

  const form = criarFormDataArquivo({
    campo: config.campo,
    buffer: midia.buffer,
    filename: config.nome,
    mimeType: midia.mimeType,
    mensagem,
    chatId: tel.chatId
  });

  await httpClient.post(
    `https://api.telegram.org/bot${tel.botToken}/${config.metodo}`,
    form,
    { maxBodyLength: Infinity, maxContentLength: Infinity }
  );
}

async function enviarTelegramImagemUrl({ httpClient, tel, mensagem, imagemUrl, corrigirImagemUrl }) {
  const base64 = base64ImagemLegada(imagemUrl);
  if (base64) {
    const form = criarFormDataArquivo({
      campo: "photo",
      buffer: base64.buffer,
      filename: `campanha.${base64.ext}`,
      mimeType: base64.mimeType,
      mensagem,
      chatId: tel.chatId
    });
    await httpClient.post(
      `https://api.telegram.org/bot${tel.botToken}/sendPhoto`,
      form,
      { maxBodyLength: Infinity, maxContentLength: Infinity }
    );
    return;
  }

  await httpClient.post(
    `https://api.telegram.org/bot${tel.botToken}/sendPhoto`,
    {
      chat_id: tel.chatId,
      photo: corrigirImagemUrl(imagemUrl) || imagemUrl,
      caption: mensagem
    }
  );
}

async function enviarTelegram({ httpClient, tel, mensagem, midia, corrigirImagemUrl }) {
  if (!midia) {
    await httpClient.post(
      `https://api.telegram.org/bot${tel.botToken}/sendMessage`,
      { chat_id: tel.chatId, text: mensagem }
    );
    return;
  }

  if (midia.origem === "imagemUrl") {
    await enviarTelegramImagemUrl({ httpClient, tel, mensagem, imagemUrl: midia.imagemUrl, corrigirImagemUrl });
    return;
  }

  await enviarTelegramMidiaUpload({ httpClient, tel, mensagem, midia });
}

async function enviarCampanhaManual({
  clienteId,
  mensagem,
  imagemUrl = "",
  midiaId = "",
  destinosIds = [],
  destinosPorCliente,
  sessoes,
  configsPorCliente,
  usuarioTemCreditos,
  debitarCreditos,
  corrigirImagemUrl,
  httpClient = HTTP_CLIENT_PADRAO,
  esperaMsTelegram = 2000,
  esperaMsWhatsApp = 3000
}) {
  if (!clienteId) {
    throw new Error("clienteId obrigatorio");
  }

  const mensagemFinal = String(mensagem || "").trim();
  if (!mensagemFinal) {
    throw new Error("Mensagem obrigatoria");
  }

  const destinosCliente = listarDestinosCliente(destinosPorCliente?.[clienteId]);
  const destinosSelecionados = destinosIds.length
    ? destinosCliente.filter(d => destinosIds.includes(d.id))
    : [];

  if (!destinosSelecionados.length) {
    throw new Error("Nenhum destino selecionado");
  }

  const criadoEm = new Date().toISOString();
  const iniciadoEm = criadoEm;
  const resultado = {
    clienteId,
    totalDestinos: destinosSelecionados.length,
    enviados: 0,
    erros: 0,
    detalhes: []
  };

  const midia = resolverMidia({ clienteId, midiaId, imagemUrl });
  const midiaUploadEmUso = midia?.origem === "midiaId";
  let envioIniciado = false;

  if (midia) {
    logMidia("[CAMPANHAS-MIDIA-INICIO]", {
      clienteId,
      tipo: midia.tipo,
      origem: midia.origem,
      midiaId: midia.midiaId,
      bytes: midia.bytes
    });
    logMidia("[CAMPANHAS-MIDIA-TIPO]", {
      clienteId,
      tipo: midia.tipo,
      origem: midia.origem,
      midiaId: midia.midiaId
    });
  }

  try {
    envioIniciado = true;

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
            ? telegrams.filter(t => telegramsSelecionados.some(id => t.chaves.includes(id)))
            : telegrams.filter(t => t.ativo);

          if (telegramsDiretos.length) {
            selecionados = [...telegramsDiretos, ...selecionados];
          }

          if (!selecionados.length && telegrams.length === 1) {
            selecionados = telegrams.filter(t => t.ativo);
          }

          if (!selecionados.length) {
            resultado.erros++;
            resultado.detalhes.push({ destino: destino.nome, tipo: "telegram", status: "erro", motivo: "Nenhum Telegram selecionado" });
            continue;
          }

          for (const tel of selecionados) {
            if (!tel.ativo) continue;

            if (!tel.botToken || !tel.chatId) {
              resultado.erros++;
              resultado.detalhes.push({ destino: destino.nome, tipo: "telegram", status: "erro", motivo: "Token ou Chat ID ausente" });
              continue;
            }

            if (!usuarioTemCreditos(clienteId, 1)) {
              resultado.erros++;
              resultado.detalhes.push({ destino: destino.nome, chatId: tel.chatId, status: "erro", motivo: "Sem creditos" });
              continue;
            }

            if (midia) {
              logMidia("[CAMPANHAS-MIDIA-TELEGRAM]", {
                clienteId,
                tipo: midia.tipo,
                origem: midia.origem,
                midiaId: midia.midiaId,
                destinoTipo: "telegram",
                destinoNome: destino.nome,
                chatIdPresente: Boolean(tel.chatId)
              });
            }

            await enviarTelegram({ httpClient, tel, mensagem: mensagemFinal, midia, corrigirImagemUrl });
            debitarCreditos(clienteId, 1);
            resultado.enviados++;
            resultado.detalhes.push({ destino: destino.nome, tipo: "telegram", chatId: tel.chatId, status: "enviado", creditos: 1 });
            await aguardar(esperaMsTelegram);
          }

          continue;
        }

        if (tipo !== "whatsapp") {
          resultado.detalhes.push({ destino: destino.nome, tipo: destino.tipo, status: "ignorado", motivo: "Tipo nao suportado" });
          continue;
        }

        const sock = sessoes[destino.conexaoId];
        if (!sock) {
          resultado.erros++;
          resultado.detalhes.push({ destino: destino.nome, tipo: "whatsapp", status: "erro", motivo: "Sessao nao encontrada" });
          continue;
        }

        const grupos = destino.gruposWhatsapp || [];
        if (!grupos.length) {
          resultado.erros++;
          resultado.detalhes.push({ destino: destino.nome, tipo: "whatsapp", status: "erro", motivo: "Destino sem grupos" });
          continue;
        }

        for (const grupo of grupos) {
          if (!usuarioTemCreditos(clienteId, 1)) {
            resultado.erros++;
            resultado.detalhes.push({ destino: destino.nome, grupo, status: "erro", motivo: "Sem creditos" });
            continue;
          }

          if (midia) {
            logMidia("[CAMPANHAS-MIDIA-WHATSAPP]", {
              clienteId,
              tipo: midia.tipo,
              origem: midia.origem,
              midiaId: midia.midiaId,
              destinoTipo: "whatsapp",
              destinoNome: destino.nome,
              grupoPresente: Boolean(grupo)
            });
          }

          await enviarWhatsApp({ sock, grupo, mensagem: mensagemFinal, midia, corrigirImagemUrl });
          debitarCreditos(clienteId, 1);
          resultado.enviados++;
          resultado.detalhes.push({ destino: destino.nome, grupo, status: "enviado", creditos: 1 });
          await aguardar(esperaMsWhatsApp);
        }
      } catch (e) {
        resultado.erros++;
        resultado.detalhes.push({ destino: destino.nome, status: "erro", motivo: e.message });
      }
    }

    const concluidoEm = new Date().toISOString();
    try {
      const historico = registrarHistoricoCampanha({
        clienteId,
        tipo: midia?.tipo || "texto",
        mensagem: mensagemFinal,
        legenda: mensagemFinal,
        midia,
        destinos: destinosSelecionados,
        detalhes: resultado.detalhes,
        enviados: resultado.enviados,
        erros: resultado.erros,
        criadoEm,
        iniciadoEm,
        concluidoEm
      });
      resultado.campanhaId = historico.campanhaId;
      resultado.status = historico.status;
    } catch (e) {
      console.log("[CAMPANHAS-HISTORICO-ERRO]", { clienteId, erro: e.message });
    }

    return resultado;
  } finally {
    if (midiaUploadEmUso && envioIniciado) {
      try {
        excluirMidiaTemporaria(clienteId, midia.midiaId, { forcar: true });
        logMidia("[CAMPANHAS-MIDIA-FIM]", {
          clienteId,
          tipo: midia.tipo,
          origem: midia.origem,
          midiaId: midia.midiaId,
          status: "removida"
        });
      } catch (e) {
        logMidia("[CAMPANHAS-MIDIA-FIM]", {
          clienteId,
          tipo: midia.tipo,
          origem: midia.origem,
          midiaId: midia.midiaId,
          status: "erro_limpeza",
          erro: e.message
        });
      }
    }
  }
}

module.exports = {
  enviarCampanhaManual,
  enviarWhatsApp,
  enviarTelegram
};