importScripts("../local-worker/worker-client.js", "../local-worker/magalu-image.js", "../local-worker/magalu-opportunity.js", "../local-worker/mercadolivre-image.js", "../local-worker/mercadolivre-identity.js", "../local-worker/task-runner.js");

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
  globalThis.OptimusLocalWorkerRunner?.iniciar();
});

chrome.runtime.onStartup?.addListener(() => globalThis.OptimusLocalWorkerRunner?.iniciar());
globalThis.OptimusLocalWorkerRunner?.iniciar();
