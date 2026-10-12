importScripts("../local-worker/worker-client.js", "../local-worker/magalu-image.js", "../local-worker/magalu-opportunity.js", "../local-worker/mercadolivre-image.js", "../local-worker/mercadolivre-identity.js", "../local-worker/task-runner.js");
importScripts("../core/marketplace-detector.js");
importScripts("../core/launcher-policy.js");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "OPTIMUS_OPEN_CURRENT_PRODUCT") return false;
  // No commercial data or tab identity is accepted from the page. Chrome is
  // the authority for the sender; open synchronously to retain the user gesture.
  const context = globalThis.OptimusLauncherPolicy.contextForUrl(sender?.url);
  if (Object.keys(message).length !== 1 || sender?.id !== chrome.runtime.id ||
      sender?.frameId !== 0 || !Number.isInteger(sender?.tab?.id) ||
      !context.homologated) {
    sendResponse({ ok: false, motivo: "launcher_contexto_nao_suportado" });
    return false;
  }
  if (!chrome.sidePanel?.open) {
    sendResponse({ ok: false, motivo: "side_panel_requer_chrome_116" });
    return false;
  }
  try {
    chrome.sidePanel.open({ tabId: sender.tab.id }).then(
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
