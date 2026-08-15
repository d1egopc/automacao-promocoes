const {
  importarMercadoLivreManualV2
} = require("./adapters/mercadolivre.manual.adapter");
const {
  importarAmazonManualV2
} = require("./adapters/amazon.manual.adapter");
const {
  importarShopeeManualV2
} = require("./adapters/shopee.manual.adapter");
const {
  importarAliExpressManualV2
} = require("./adapters/aliexpress.manual.adapter");
const {
  importarKabumAwinManualV2
} = require("./adapters/kabum-awin.manual.adapter");
const {
  importarProdutoMagaluManualV2
} = require("./adapters/magalu.manual.adapter");

const ADAPTERS_MANUAL_V2 = Object.freeze({
  mercadolivre: importarMercadoLivreManualV2,
  amazon: importarAmazonManualV2,
  shopee: importarShopeeManualV2,
  aliexpress: importarAliExpressManualV2,
  kabum: importarKabumAwinManualV2,
  magalu: importarProdutoMagaluManualV2
});

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function urlComProtocolo(url = "") {
  const valor = texto(url);
  if (!valor) return "";
  return /^https?:\/\//i.test(valor) ? valor : `https://${valor}`;
}

function hostUrl(url = "") {
  try {
    return new URL(urlComProtocolo(url)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function decodificarUrl(valor = "") {
  let atual = texto(valor);
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(atual); i += 1) {
    try {
      const proximo = decodeURIComponent(atual);
      if (proximo === atual) break;
      atual = proximo;
    } catch {
      break;
    }
  }
  return atual;
}

function destinoKabumEmLinkAwin(url = "") {
  const original = urlComProtocolo(url);
  const decodificada = decodificarUrl(original);
  if (/kabum\.com\.br\/produto\/\d+/i.test(decodificada)) return true;

  try {
    const parsed = new URL(original);
    const candidatos = [
      parsed.searchParams.get("ued"),
      parsed.searchParams.get("url"),
      parsed.searchParams.get("u"),
      parsed.searchParams.get("destination"),
      parsed.searchParams.get("dest")
    ].map(decodificarUrl);

    return candidatos.some((candidato) => /kabum\.com\.br\/produto\/\d+/i.test(candidato));
  } catch {
    return false;
  }
}

function erroImportacaoManualV2(urlOriginal = "", motivo = "url_manual_invalida", aviso = "URL manual invalida.") {
  return {
    ok: false,
    erro: motivo,
    motivo,
    aviso,
    urlOriginal: texto(urlOriginal),
    marketplaceDetectado: "",
    parseOnly: true
  };
}

function detectarMarketplaceManualV2(urlManual = "") {
  const urlOriginal = texto(urlManual);
  if (!urlOriginal) {
    return erroImportacaoManualV2(urlManual, "url_manual_obrigatoria", "Informe uma URL para importar.");
  }

  const url = urlComProtocolo(urlOriginal);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return erroImportacaoManualV2(urlOriginal, "url_manual_invalida", "URL manual invalida.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return erroImportacaoManualV2(urlOriginal, "url_manual_invalida", "URL manual invalida.");
  }

  const host = hostUrl(url);

  if (host === "meli.la" || host.endsWith(".meli.la") || host.includes("mercadolivre.") || host.includes("mercadolibre.")) {
    return { ok: true, marketplace: "mercadolivre", url };
  }

  if (host === "amzn.to" || host.endsWith(".amzn.to") || host.includes("amazon.")) {
    return { ok: true, marketplace: "amazon", url };
  }

  if (host === "s.shopee.com.br" || host.endsWith(".s.shopee.com.br") || host === "shopee.com.br" || host.endsWith(".shopee.com.br")) {
    return { ok: true, marketplace: "shopee", url };
  }

  if (host === "a.aliexpress.com" || host === "s.click.aliexpress.com" || host.includes("aliexpress.")) {
    return { ok: true, marketplace: "aliexpress", url };
  }

  if (host === "kabum.com.br" || host.endsWith(".kabum.com.br")) {
    return { ok: true, marketplace: "kabum", url };
  }

  if (host === "magazineluiza.com.br" || host.endsWith(".magazineluiza.com.br") ||
    host === "magazinevoce.com.br" || host.endsWith(".magazinevoce.com.br")) {
    return { ok: true, marketplace: "magalu", url };
  }

  if (host === "magazineluiza.onelink.me") {
    return erroImportacaoManualV2(
      urlOriginal,
      "magalu_onelink_sem_resolucao_segura",
      "Link OneLink Magalu sem resolucao segura para produto."
    );
  }

  if ((host === "awin1.com" || host.endsWith(".awin1.com") || host === "awin.com" || host.endsWith(".awin.com")) && destinoKabumEmLinkAwin(url)) {
    return { ok: true, marketplace: "kabum", url };
  }

  if (host.includes("awin")) {
    return erroImportacaoManualV2(urlOriginal, "awin_sem_destino_kabum_comprovado", "Link AWIN sem destino KaBuM comprovado.");
  }

  return erroImportacaoManualV2(urlOriginal, "marketplace_manual_v2_nao_suportado", "Marketplace nao suportado no Manual V2.");
}

async function importarUrlManualV2(urlManual = "", opcoes = {}) {
  const deteccao = detectarMarketplaceManualV2(urlManual);
  if (!deteccao.ok) return deteccao;

  const adapters = opcoes.adapters && typeof opcoes.adapters === "object"
    ? opcoes.adapters
    : ADAPTERS_MANUAL_V2;
  const adapter = adapters[deteccao.marketplace];

  if (typeof adapter !== "function") {
    return erroImportacaoManualV2(urlManual, "adapter_manual_v2_indisponivel", "Adapter Manual V2 indisponivel.");
  }

  return adapter(deteccao.url, {
    ...opcoes,
    marketplaceDetectado: deteccao.marketplace
  });
}

module.exports = {
  ADAPTERS_MANUAL_V2,
  detectarMarketplaceManualV2,
  importarUrlManualV2,
  destinoKabumEmLinkAwin
};
