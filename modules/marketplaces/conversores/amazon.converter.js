function criarGerarLinkAmazon({
  registrarAlertaAmazon,
  limparAlertaIntegracao
} = {}) {
  return function gerarLinkAmazon(clienteId, linkBase, integracao = {}) {
    const trackingId =
      integracao?.credenciais?.trackingId ||
      integracao?.credenciais?.partnerTag ||
      integracao?.credenciais?.tag ||
      integracao?.credenciais?.affiliateTag ||
      "";

    if (!trackingId) {
      console.log("[AVISO] Amazon sem trackingId/tag afiliada:", {
        clienteId,
        credenciais: Object.keys(integracao?.credenciais || {})
      });
      registrarAlertaAmazon(clienteId, "tag_ausente", {
        credenciais: Object.keys(integracao?.credenciais || {})
      });
      return "";
    }

    try {
      const u = new URL(linkBase);
      u.searchParams.set("tag", trackingId);
      limparAlertaIntegracao(clienteId, "amazon");
      return u.toString();
    } catch {
      return "";
    }
  };
}

module.exports = {
  criarGerarLinkAmazon
};
