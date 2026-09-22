function texto(valor = "") {
  return String(valor ?? "").trim();
}

async function expandirShortlinkShopeeManualV2(url = "", deps = {}) {
  const shortLink = texto(url);
  if (!shortLink) return "";

  if (typeof deps.expandirShortlinkShopee === "function") {
    const resultado = await deps.expandirShortlinkShopee(shortLink);
    return texto(typeof resultado === "string"
      ? resultado
      : resultado?.urlExpandida || resultado?.urlFinal || resultado?.url);
  }

  const fetchImpl = deps.fetch || global.fetch;
  if (typeof fetchImpl !== "function") return "";

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 6000) : null;
  try {
    const response = await fetchImpl(shortLink, {
      method: "GET",
      redirect: "follow",
      signal: controller?.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
      }
    });
    return texto(response?.url);
  } catch (_) {
    return "";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  expandirShortlinkShopeeManualV2
};
