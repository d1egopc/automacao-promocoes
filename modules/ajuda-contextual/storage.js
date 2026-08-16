"use strict";

const ARQUIVO_AJUDA_CONTEXTUAL = "ajuda-contextual.json";

const HELP_IDS_PILOTO = [
  "dashboard",
  "campanhas",
  "fila",
  "automacao",
  "destinos",
  "templates",
  "mensageiro",
  "ofertas",
  "social",
  "integracoes.mercadolivre",
  "integracoes.amazon",
  "integracoes.shopee",
  "integracoes.aliexpress",
  "integracoes.awin",
  "integracoes.magalu",
  "conexoes.whatsapp",
  "conexoes.telegram",
  "conexoes.discord"
];

const SEED_AJUDAS = {
  dashboard: {
    titulo: "Dashboard",
    texto: "Bem-vindo ao painel principal do Optimus Promo. Aqui voce acompanha conexoes, destinos, fila, automacao, integracoes e atividades recentes em um so lugar."
  },
  campanhas: { titulo: "Campanhas", texto: "" },
  fila: { titulo: "Fila", texto: "" },
  automacao: { titulo: "Automacao", texto: "" },
  destinos: { titulo: "Destinos", texto: "" },
  templates: { titulo: "Templates", texto: "" },
  mensageiro: { titulo: "Mensageiro", texto: "" },
  ofertas: { titulo: "Ofertas", texto: "" },
  social: { titulo: "Social", texto: "" },
  "integracoes.mercadolivre": {
    titulo: "Mercado Livre",
    texto: "Conecte sua integracao do Mercado Livre para que o Optimus possa importar, identificar e preparar ofertas desse marketplace. No video voce vera onde localizar os dados necessarios e como configurar corretamente a integracao."
  },
  "integracoes.amazon": { titulo: "Amazon", texto: "" },
  "integracoes.shopee": { titulo: "Shopee", texto: "" },
  "integracoes.aliexpress": { titulo: "AliExpress", texto: "" },
  "integracoes.awin": { titulo: "AWIN / KaBuM", texto: "" },
  "integracoes.magalu": { titulo: "Magazine Luiza / Magalu", texto: "" },
  "conexoes.whatsapp": {
    titulo: "WhatsApp",
    texto: "Conecte uma sessao do WhatsApp ao Optimus para enviar ofertas aos grupos configurados. No video voce vera como criar a sessao, ler o QR Code e confirmar que a conexao ficou ativa."
  },
  "conexoes.telegram": { titulo: "Telegram", texto: "" },
  "conexoes.discord": { titulo: "Discord", texto: "" }
};

function texto(valor = "") {
  return String(valor || "").trim();
}

function contemHtml(valor = "") {
  const s = texto(valor);
  return /<[^>]*>|[<>]/.test(s);
}

function limitarTexto(valor = "", max = 2000) {
  return texto(valor).slice(0, max);
}

function validarSemHtml(valor = "", campo = "texto") {
  if (contemHtml(valor)) {
    const erro = new Error(`${campo}_nao_aceita_html`);
    erro.statusCode = 400;
    throw erro;
  }
}

function idYoutubeValido(id = "") {
  return /^[A-Za-z0-9_-]{6,32}$/.test(texto(id));
}

function erroYoutube() {
  const erro = new Error("youtube_url_invalida");
  erro.statusCode = 400;
  return erro;
}

function erroLink() {
  const erro = new Error("link_url_invalida");
  erro.statusCode = 400;
  return erro;
}

function normalizarLinkUrl(valor = "") {
  const original = texto(valor);
  if (!original) return "";

  validarSemHtml(original, "linkUrl");

  let url;
  try {
    url = new URL(original);
  } catch {
    throw erroLink();
  }

  if (url.protocol !== "https:") throw erroLink();
  return url.toString().slice(0, 500);
}

function normalizarYoutubeUrl(valor = "") {
  const original = texto(valor);
  if (!original) {
    return { youtubeUrl: "", youtubeVideoId: "", youtubeEmbedUrl: "" };
  }

  validarSemHtml(original, "youtubeUrl");

  let url;
  try {
    url = new URL(original);
  } catch {
    throw erroYoutube();
  }

  if (!/^https?:$/i.test(url.protocol)) throw erroYoutube();

  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  let videoId = "";

  if (host === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] || "";
  } else if (host === "youtube.com") {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v") || "";
    } else if (url.pathname.startsWith("/embed/")) {
      videoId = url.pathname.split("/").filter(Boolean)[1] || "";
    } else if (url.pathname.startsWith("/shorts/")) {
      videoId = url.pathname.split("/").filter(Boolean)[1] || "";
    }
  }

  if (!idYoutubeValido(videoId)) throw erroYoutube();

  return {
    youtubeUrl: original,
    youtubeVideoId: videoId,
    youtubeEmbedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`
  };
}

function ajudaPadrao(id = "") {
  const seed = SEED_AJUDAS[id] || { titulo: id, texto: "" };
  const ativoPadrao = Boolean(seed.texto);
  return {
    id,
    titulo: seed.titulo,
    texto: seed.texto,
    youtubeUrl: "",
    youtubeVideoId: "",
    youtubeEmbedUrl: "",
    linkUrl: "",
    linkLabel: "",
    ativo: ativoPadrao,
    atualizadoEm: ""
  };
}

function normalizarAjuda(id = "", dados = {}) {
  const base = ajudaPadrao(id);
  const atual = dados && typeof dados === "object" ? dados : {};
  const youtube = normalizarYoutubeUrl(atual.youtubeUrl || "");
  const linkUrl = normalizarLinkUrl(atual.linkUrl || "");
  validarSemHtml(atual.linkLabel || "", "linkLabel");

  return {
    ...base,
    ...atual,
    id,
    titulo: limitarTexto(atual.titulo || base.titulo, 120),
    texto: limitarTexto(atual.texto || base.texto, 3000),
    youtubeUrl: youtube.youtubeUrl,
    youtubeVideoId: youtube.youtubeVideoId,
    youtubeEmbedUrl: youtube.youtubeEmbedUrl,
    linkUrl,
    linkLabel: limitarTexto(atual.linkLabel || "", 80),
    ativo: atual.ativo !== false,
    atualizadoEm: atual.atualizadoEm ? texto(atual.atualizadoEm) : base.atualizadoEm
  };
}

function normalizarPayloadAdmin(id = "", body = {}) {
  if (!HELP_IDS_PILOTO.includes(id)) {
    const erro = new Error("help_id_invalido");
    erro.statusCode = 404;
    throw erro;
  }

  const payload = body && typeof body === "object" ? body : {};
  validarSemHtml(payload.titulo || "", "titulo");
  validarSemHtml(payload.texto || "", "texto");
  validarSemHtml(payload.linkLabel || "", "linkLabel");

  const youtube = normalizarYoutubeUrl(payload.youtubeUrl || "");
  const linkUrl = normalizarLinkUrl(payload.linkUrl || "");

  return {
    id,
    titulo: limitarTexto(payload.titulo || ajudaPadrao(id).titulo, 120),
    texto: limitarTexto(payload.texto || ajudaPadrao(id).texto, 3000),
    youtubeUrl: youtube.youtubeUrl,
    youtubeVideoId: youtube.youtubeVideoId,
    youtubeEmbedUrl: youtube.youtubeEmbedUrl,
    linkUrl,
    linkLabel: limitarTexto(payload.linkLabel || "", 80),
    ativo: payload.ativo !== false,
    atualizadoEm: new Date().toISOString()
  };
}

function normalizarEnvelope(dados = {}) {
  const entrada = dados && typeof dados === "object" ? dados : {};
  const ajudasFonte = entrada.ajudas && typeof entrada.ajudas === "object" ? entrada.ajudas : entrada;
  const ajudas = {};

  for (const id of HELP_IDS_PILOTO) {
    ajudas[id] = normalizarAjuda(id, ajudasFonte[id] || ajudaPadrao(id));
  }

  return {
    versao: 1,
    escopo: "oficial",
    atualizadoEm: texto(entrada.atualizadoEm || ""),
    ajudas
  };
}

function lerAjudaContextual({ readGlobalJson, writeGlobalJson, criarSeAusente = true } = {}) {
  const lido = readGlobalJson(ARQUIVO_AJUDA_CONTEXTUAL, null);
  const envelope = normalizarEnvelope(lido || {});

  if (!lido && criarSeAusente && typeof writeGlobalJson === "function") {
    try {
      writeGlobalJson(ARQUIVO_AJUDA_CONTEXTUAL, {
        ...envelope,
        atualizadoEm: new Date().toISOString()
      });
    } catch {}
  }

  return envelope;
}

function salvarAjudaContextual(id = "", body = {}, deps = {}) {
  const atual = lerAjudaContextual({ ...deps, criarSeAusente: true });
  const ajuda = normalizarPayloadAdmin(id, body);
  const proximo = {
    ...atual,
    atualizadoEm: new Date().toISOString(),
    ajudas: {
      ...atual.ajudas,
      [id]: ajuda
    }
  };

  deps.writeGlobalJson(ARQUIVO_AJUDA_CONTEXTUAL, proximo);
  return { envelope: proximo, ajuda };
}

function ajudasAtivas(envelope = {}) {
  const ajudas = envelope?.ajudas && typeof envelope.ajudas === "object" ? envelope.ajudas : {};
  return Object.fromEntries(
    Object.entries(ajudas).filter(([, ajuda]) => ajuda?.ativo === true)
  );
}

module.exports = {
  ARQUIVO_AJUDA_CONTEXTUAL,
  HELP_IDS_PILOTO,
  SEED_AJUDAS,
  ajudasAtivas,
  contemHtml,
  lerAjudaContextual,
  normalizarEnvelope,
  normalizarPayloadAdmin,
  normalizarLinkUrl,
  normalizarYoutubeUrl,
  salvarAjudaContextual
};
