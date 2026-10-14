importScripts("../local-worker/worker-client.js", "../local-worker/magalu-image.js", "../local-worker/magalu-identity.js", "../local-worker/magalu-opportunity.js", "../local-worker/mercadolivre-image.js", "../local-worker/mercadolivre-identity.js", "../local-worker/task-runner.js");
importScripts("../core/marketplace-detector.js");
importScripts("../core/launcher-policy.js");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const currentProduct = message?.type === "OPTIMUS_OPEN_CURRENT_PRODUCT";
  const selectionMode = message?.type === "OPTIMUS_OPEN_SELECTION";
  if (!currentProduct && !selectionMode) return false;
  // No commercial data or tab identity is accepted from the page. Chrome is
  // the authority for the sender; open synchronously to retain the user gesture.
  const context = globalThis.OptimusLauncherPolicy.contextForUrl(sender?.url);
  if (sender?.id !== chrome.runtime.id ||
      sender?.frameId !== 0 || !Number.isInteger(sender?.tab?.id) ||
      !context.homologated) {
    sendResponse({ ok: false, motivo: "launcher_contexto_nao_suportado" });
    return false;
  }
  if (currentProduct && Object.keys(message).length !== 1) {
    sendResponse({ ok: false, motivo: "launcher_contexto_nao_suportado" });
    return false;
  }
  let selectionBatch = null;
  if (selectionMode) {
    const items = Array.isArray(message.items) ? message.items : [];
    const requestId = String(message.requestId || "").trim();
    const valid = requestId && items.length > 0 && items.length <= 30 && items.every((item) => {
      const detection = globalThis.OptimusCaptureDetector.detectarMarketplacePorUrl(item?.url);
      return detection.suportado && detection.marketplace === context.marketplace &&
        String(item?.marketplace || "") === context.marketplace && String(item?.identity || "").trim();
    });
    if (!valid) {
      sendResponse({ ok: false, motivo: "selection_payload_invalido" });
      return false;
    }
    selectionBatch = {
      requestId,
      sourceTabId: sender.tab.id,
      sourceMarketplace: context.marketplace,
      createList: message.createList === true,
      createdAt: new Date().toISOString(),
      items: items.map((item) => ({
        key: String(item.key || "").slice(0, 500),
        url: globalThis.OptimusCaptureDetector.detectarMarketplacePorUrl(item.url).url,
        marketplace: context.marketplace,
        identity: String(item.identity || "").slice(0, 300)
      }))
    };
  }
  if (!chrome.sidePanel?.open) {
    sendResponse({ ok: false, motivo: "side_panel_requer_chrome_116" });
    return false;
  }
  try {
    const opening = chrome.sidePanel.open({ tabId: sender.tab.id });
    const storing = selectionBatch
      ? chrome.storage.session.set({ "optimus.selection.batch.v1": selectionBatch })
      : Promise.resolve();
    Promise.all([opening, storing]).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false, motivo: "side_panel_nao_abriu" })
    );
  } catch {
    sendResponse({ ok: false, motivo: "side_panel_nao_abriu" });
    return false;
  }
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
  globalThis.OptimusLocalWorkerRunner?.iniciar();
});

chrome.runtime.onStartup?.addListener(() => globalThis.OptimusLocalWorkerRunner?.iniciar());
globalThis.OptimusLocalWorkerRunner?.iniciar();
