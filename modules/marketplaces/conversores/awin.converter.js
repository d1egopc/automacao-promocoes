const {
  credencialFingerprintIntegracao
} = require("../../../utils/alertas-integracoes");

function criarGerarDeepLinkAwin({
  axios,
  getIntegracaoCliente,
  obterProgramaAwin,
  registrarSucessoIntegracao,
  registrarAlertaIntegracao
} = {}) {
  function integracaoIdAwin(advertiserId = "") {
    const id = String(advertiserId || "").trim();
    return id ? `advertiser:${id}` : "";
  }

  function marketplaceSaudeAwin(urlOriginal = "") {
    return /kabum\.com\.br/i.test(String(urlOriginal || "")) ? "kabum" : "awin";
  }

  function registrarSucessoFailOpen(clienteId = "", marketplace = "awin", detalhes = {}) {
    try {
      if (clienteId && typeof registrarSucessoIntegracao === "function") {
        registrarSucessoIntegracao(clienteId, marketplace, {
          codigo: "afiliado_ok",
          origem: "linkbuilder_awin",
          ...detalhes
        });
      }
    } catch {
      // Saude das integracoes nunca interfere no deeplink comercial.
    }
  }

  function registrarFalhaFailOpen(clienteId = "", marketplace = "awin", codigo = "", detalhes = {}) {
    try {
      if (clienteId && typeof registrarAlertaIntegracao === "function") {
        registrarAlertaIntegracao(clienteId, marketplace, {
          tipo: codigo,
          status: "atencao",
          mensagem: "Falha qualificada na integracao AWIN.",
          detalhes
        });
      }
    } catch {
      // Saude das integracoes nunca interfere no deeplink comercial.
    }
  }

  return async function gerarDeepLinkAwin(urlOriginal, clienteId = "admin") {
    const integracao =
    getIntegracaoCliente(clienteId, "awin");
    const credenciais = integracao?.credenciais || {};

    const { publisherId, apiToken } = credenciais;
    const programaAwin = obterProgramaAwin(credenciais, urlOriginal);
    const advertiserId = programaAwin?.advertiserId || "";
    const integracaoId = integracaoIdAwin(advertiserId);
    const marketplaceSaude = marketplaceSaudeAwin(urlOriginal);

  if (!publisherId || !apiToken || !advertiserId) {
    console.log("[AVISO] AWIN sem credenciais/programa:", {
      clienteId,
      programa: programaAwin?.nome || ""
    });
  }
    if (!publisherId || !apiToken || !advertiserId) {
      throw new Error("Awin sem publisherId, apiToken ou programa advertiserId configurado.");
    }

    let response;
    try {
      response = await axios.post(
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
    } catch (e) {
      const httpStatus = Number(e?.response?.status || 0);
      if ([401, 403].includes(httpStatus)) {
        registrarFalhaFailOpen(clienteId, marketplaceSaude, "credencial_invalida", {
          httpStatus,
          integracaoId,
          advertiserId,
          credencialFingerprint: credencialFingerprintIntegracao(marketplaceSaude, credenciais, { integracaoId })
        });
      }
      throw e;
    }

  console.log("[INFO] AWIN Deeplink OK");

    const link = (
      response.data?.shortUrl ||
      response.data?.url ||
      response.data?.link ||
      response.data?.trackingLink ||
      response.data?.clickUrl ||
      ""
    );

    if (/^https?:\/\//i.test(String(link || ""))) {
      registrarSucessoFailOpen(clienteId, marketplaceSaude, {
        integracaoId,
        advertiserId,
        credencialFingerprint: credencialFingerprintIntegracao(marketplaceSaude, credenciais, { integracaoId })
      });
    }

    return link;
  };
}

module.exports = {
  criarGerarDeepLinkAwin
};
