(function publishLauncherPolicy(global) {
  "use strict";
  // UI permission only. Reuse the detector's host predicates, never its
  // commercial/product eligibility. Capture remains the panel's authority.
  const domains = Object.freeze([
    ["mercadolivre", "hostMercadoLivre"], ["amazon", "hostAmazon"],
    ["shopee", "hostShopee"], ["aliexpress", "hostAliExpress"],
    ["kabum", "hostKabum"], ["magalu", "hostMagalu"]
  ]);
  function contextForUrl(value, detector = global.OptimusCaptureDetector) {
    try {
      const url = new URL(String(value || ""));
      const marketplace = domains.find(([, predicate]) => detector?.[predicate]?.(url.hostname))?.[0] || "";
      return { homologated: url.protocol === "https:" && Boolean(marketplace),
        marketplace, hostname: url.hostname };
    } catch {
      return { homologated: false, marketplace: "", hostname: "" };
    }
  }
  const api = Object.freeze({ contextForUrl });
  global.OptimusLauncherPolicy = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
