const { criarGerarLinkMercadoLivre } = require("./mercadolivre.converter");
const { criarGerarLinkAmazon } = require("./amazon.converter");
const { criarGerarLinkShopee } = require("./shopee.converter");
const { criarGerarLinkAliExpress } = require("./aliexpress.converter");
const { criarGerarDeepLinkAwin } = require("./awin.converter");
const { gerarLinkMagalu } = require("./magalu.converter");

function normalizarNomeMarketplace(nome = "") {
  return String(nome || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s-]+/g, "_");
}

function registrarConversores() {
  const mercadolivre = {
    nome: "mercadolivre",
    aliases: ["mercadolivre", "mercado_livre", "mercado-livre", "mercado livre", "ml", "meli"],
    criarGerarLinkMercadoLivre
  };
  const amazon = {
    nome: "amazon",
    aliases: ["amazon"],
    criarGerarLinkAmazon
  };
  const shopee = {
    nome: "shopee",
    aliases: ["shopee"],
    criarGerarLinkShopee
  };
  const aliexpress = {
    nome: "aliexpress",
    aliases: ["aliexpress", "ali_express", "ali-express", "ali express"],
    criarGerarLinkAliExpress
  };
  const awin = {
    nome: "awin",
    aliases: ["awin", "kabum", "ka_bum", "ka-bum", "ka bum"],
    criarGerarDeepLinkAwin
  };
  const magalu = {
    nome: "magalu",
    aliases: ["magalu", "magazineluiza", "magazine_luiza", "magazine-luiza", "magazine luiza"],
    gerarLinkMagalu
  };

  const conversores = {};
  for (const conversor of [mercadolivre, amazon, shopee, aliexpress, awin, magalu]) {
    for (const alias of conversor.aliases) {
      conversores[normalizarNomeMarketplace(alias)] = conversor;
    }
  }
  return conversores;
}

function obterConversor(nomeMarketplace = "") {
  const conversores = registrarConversores();
  return conversores[normalizarNomeMarketplace(nomeMarketplace)] || null;
}

function listarConversores() {
  const conversores = registrarConversores();
  return Object.keys(conversores).sort();
}

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
      const marketplaceNormalizado = normalizarNomeMarketplace(marketplace);
      const conversor = obterConversor(marketplaceNormalizado);
      const mp = conversor?.nome || marketplaceNormalizado;

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

      if (!linkBase || !conversor) {
        return "";
      }

      if (conversor.nome === "mercadolivre") {
        const linkML = await gerarLinkMercadoLivre(
          linkBase,
          integracao,
          { clienteId }
        );

        return linkML || "";
      }

      if (conversor.nome === "shopee") {
        return await gerarLinkShopee(clienteId, ofertaBase);
      }

      if (conversor.nome === "amazon") {
        return gerarLinkAmazon(clienteId, linkBase, integracao);
      }

      if (conversor.nome === "aliexpress") {
        const linkAli = await gerarLinkAliExpress(
          linkBase,
          integracao?.credenciais || {}
        );

        return linkAli || "";
      }

      if (conversor.nome === "awin") {
        const linkAwin = await gerarDeepLinkAwin(
          linkBase,
          clienteId
        );

        return linkAwin || "";
      }

      if (conversor.nome === "magalu") {
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

function criarConversores(deps = {}) {
  const gerarLinkAfiliadoMercadoLivre = obterConversor("mercadolivre").criarGerarLinkMercadoLivre({
    fetch: deps.fetch,
    buscarCsrfTokenMercadoLivre: deps.buscarCsrfTokenMercadoLivre,
    tipoUrlMercadoLivreAfiliado: deps.tipoUrlMercadoLivreAfiliado,
    logMlAfiliadoFalhaDetalhe: deps.logMlAfiliadoFalhaDetalhe,
    registrarAlertaMercadoLivre: deps.registrarAlertaMercadoLivre,
    limparAlertaIntegracao: deps.limparAlertaIntegracao
  });
  const gerarLinkAmazon = obterConversor("amazon").criarGerarLinkAmazon({
    registrarAlertaAmazon: deps.registrarAlertaAmazon,
    limparAlertaIntegracao: deps.limparAlertaIntegracao
  });
  const gerarLinkShopeeCliente = obterConversor("shopee").criarGerarLinkShopee({
    fetch: deps.fetch,
    getIntegracaoCliente: deps.getIntegracaoCliente,
    logDebug: deps.logDebug
  });
  const gerarLinkCurtoAliExpress = obterConversor("aliexpress").criarGerarLinkAliExpress({
    fetch: deps.fetch,
    timestampGMT8: deps.timestampGMT8,
    assinar: deps.assinar
  });
  const gerarDeepLinkAwin = obterConversor("awin").criarGerarDeepLinkAwin({
    axios: deps.axios,
    getIntegracaoCliente: deps.getIntegracaoCliente,
    obterProgramaAwin: deps.obterProgramaAwin
  });
  const gerarLinkMagalu = obterConversor("magalu").gerarLinkMagalu;
  const gerarLinkAfiliadoCliente = criarGerarLinkAfiliadoCliente({
    getIntegracaoCliente: deps.getIntegracaoCliente,
    logDebug: deps.logDebug,
    gerarLinkMercadoLivre: gerarLinkAfiliadoMercadoLivre,
    gerarLinkAmazon,
    gerarLinkShopee: gerarLinkShopeeCliente,
    gerarLinkAliExpress: gerarLinkCurtoAliExpress,
    gerarDeepLinkAwin,
    gerarLinkMagalu
  });

  return {
    gerarLinkAfiliadoMercadoLivre,
    gerarLinkAmazon,
    gerarLinkShopeeCliente,
    gerarLinkCurtoAliExpress,
    gerarDeepLinkAwin,
    gerarLinkMagalu,
    gerarLinkAfiliadoCliente
  };
}

module.exports = {
  obterConversor,
  registrarConversores,
  listarConversores,
  normalizarNomeMarketplace,
  criarConversores,
  criarGerarLinkMercadoLivre,
  criarGerarLinkAmazon,
  criarGerarLinkShopee,
  criarGerarLinkAliExpress,
  criarGerarDeepLinkAwin,
  gerarLinkMagalu,
  criarGerarLinkAfiliadoCliente
};
