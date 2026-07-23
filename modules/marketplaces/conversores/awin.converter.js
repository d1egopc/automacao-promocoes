function criarGerarDeepLinkAwin({
  axios,
  getIntegracaoCliente,
  obterProgramaAwin
} = {}) {
  return async function gerarDeepLinkAwin(urlOriginal, clienteId = "admin") {
    const integracao =
    getIntegracaoCliente(clienteId, "awin");
    const credenciais = integracao?.credenciais || {};

    const { publisherId, apiToken } = credenciais;
    const programaAwin = obterProgramaAwin(credenciais, urlOriginal);
    const advertiserId = programaAwin?.advertiserId || "";

  if (!publisherId || !apiToken || !advertiserId) {
    console.log("[AVISO] AWIN sem credenciais/programa:", {
      clienteId,
      programa: programaAwin?.nome || ""
    });
  }
    if (!publisherId || !apiToken || !advertiserId) {
      throw new Error("Awin sem publisherId, apiToken ou programa advertiserId configurado.");
    }

    const response = await axios.post(
      `https://api.awin.com/publishers/${publisherId}/linkbuilder/generate`,
      {
        advertiserId: Number(advertiserId),
        destinationUrl: urlOriginal
      },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

  console.log("[INFO] AWIN Deeplink OK");

    return (
      response.data?.shortUrl ||
      response.data?.url ||
      response.data?.link ||
      response.data?.trackingLink ||
      response.data?.clickUrl ||
      ""
    );
  };
}

module.exports = {
  criarGerarDeepLinkAwin
};
