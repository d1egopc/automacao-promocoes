chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
