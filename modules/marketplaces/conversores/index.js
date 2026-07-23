const { criarGerarLinkMercadoLivre } = require("./mercadolivre.converter");
const { criarGerarLinkAmazon } = require("./amazon.converter");
const { criarGerarLinkShopee } = require("./shopee.converter");
const { criarGerarLinkAliExpress } = require("./aliexpress.converter");
const { criarGerarDeepLinkAwin } = require("./awin.converter");
const { gerarLinkMagalu } = require("./magalu.converter");

function criarGerarLinkAfiliadoCliente({
  getIntegracaoCliente,
  logDebug,
  gerarLinkMercadoLivre,
  gerarLinkAmazon,
  gerarLinkShopee,
  gerarLinkAliExpress,
  gerarDeepLinkAwin,
  gerarLinkMagalu
} = {}) {
  return async function gerarLinkAfiliadoCliente(clienteId, marketplace, linkOriginal, ofertaBase = {}) {
    try {
      const mp = String(marketplace || "").toLowerCase();

      const integracao = getIntegracaoCliente(clienteId, mp);

      logDebug("[INFO] ====================================");
      logDebug("[INFO] CLIENTE:", clienteId);
      logDebug("[INFO] MARKETPLACE:", mp);
      logDebug("[INFO] Integrao encontrada?", !!integracao);
      logDebug("[INFO] Tem credenciais?", !!integracao?.credenciais);
      logDebug("[INFO] ====================================");

      const linkBase =
        linkOriginal ||
        ofertaBase.linkOriginal ||
        ofertaBase.link ||
        "";

      if (!linkBase) {
        return "";
      }

      if (mp === "mercadolivre") {
        const linkML = await gerarLinkMercadoLivre(
          linkBase,
          integracao,
          { clienteId }
        );

        return linkML || "";
      }

      if (mp === "shopee") {
        return await gerarLinkShopee(clienteId, ofertaBase);
      }

      if (mp === "amazon") {
        return gerarLinkAmazon(clienteId, linkBase, integracao);
      }

      if (mp === "aliexpress") {
        const linkAli = await gerarLinkAliExpress(
          linkBase,
          integracao?.credenciais || {}
        );

        return linkAli || "";
      }

      if (mp === "awin") {
        const linkAwin = await gerarDeepLinkAwin(
          linkBase,
          clienteId
        );

        return linkAwin || "";
      }

      if (mp === "magalu") {
        const promoterId =
          integracao?.credenciais?.promoterId || "";

        if (!promoterId) {
          return "";
        }

        try {
          return gerarLinkMagalu(linkBase, promoterId) || "";
        } catch {
          return "";
        }
      }

      return "";

    } catch (e) {
      console.log("[ERRO]❌ Erro ao gerar link afiliado do cliente:", {
        clienteId,
        marketplace,
        erro: e.message
      });

      return "";
    }
  };
}

module.exports = {
  criarGerarLinkMercadoLivre,
  criarGerarLinkAmazon,
  criarGerarLinkShopee,
  criarGerarLinkAliExpress,
  criarGerarDeepLinkAwin,
  gerarLinkMagalu,
  criarGerarLinkAfiliadoCliente
};
