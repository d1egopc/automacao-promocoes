function fontePrecoOficialProntaShopee() {
  return globalThis.OptimusCaptureShopee?.precoProntoShopee?.(document) === true;
}

function aguardarProntidaoPrecoShopee(message) {
  const limiteMs = Math.min(4000, Math.max(0, Number(message?.timeoutMs) || 3500));
  const intervaloMs = Math.min(250, Math.max(50, Number(message?.intervalMs) || 250));
  const inicio = Date.now();
  return new Promise((resolve) => {
    let encerrado = false;
    let timer = null;
    const finalizar = (ready) => {
      if (encerrado) return;
      encerrado = true;
      if (timer) clearInterval(timer);
      const waitMs = Math.max(0, Date.now() - inicio);
      resolve({ ok: true, ready: ready === true, timeout: ready !== true, waitMs });
    };
    const amostrar = () => {
      let pronto = false;
      try { pronto = fontePrecoOficialProntaShopee(); } catch { pronto = false; }
      if (pronto || Date.now() - inicio >= limiteMs) finalizar(pronto);
    };
    amostrar();
    if (!encerrado) timer = setInterval(amostrar, intervaloMs);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OPTIMUS_SHOPEE_SELECTION_READINESS_WAIT") {
    aguardarProntidaoPrecoShopee(message)
      .then((resultado) => sendResponse(resultado))
      .catch(() => sendResponse({ ok: false, ready: false, timeout: true, waitMs: null }));
    return true;
  }
  if (!message || message.type !== "OPTIMUS_CAPTURE_PAGE") return false;

  try {
    const resultado = globalThis.OptimusCaptureRegistry.capturarPaginaAtual(document, window.location);
    sendResponse(resultado);
  } catch (erro) {
    sendResponse({
      ok: false,
      motivo: "capture_content_erro",
      erro: String(erro?.message || "erro").slice(0, 120)
    });
  }

  return false;
});
