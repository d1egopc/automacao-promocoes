const crypto = require("crypto");

const MENSAGENS = {
  ok: "Integração válida.",
  cookie_expirado: "Cookies expirados. Atualize os cookies e teste novamente.",
  cookie_ausente: "Cookies ausentes.",
  tag_ausente: "Tag ID ausente.",
  credencial_ausente: "Credenciais ausentes.",
  credencial_invalida: "Credenciais inválidas.",
  bloqueio_ml: "Mercado Livre bloqueou a validação. Tente novamente mais tarde.",
  falha_teste: "Não conseguimos validar a integração agora.",
  teste_nao_implementado: "Teste real ainda não implementado para este marketplace.",
  marketplace_nao_suportado: "Marketplace não suportado para teste de integração."
};

function normalizarMarketplace(marketplace = "") {
  const valor = String(marketplace || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

  const aliases = {
    ml: "mercadolivre",
    meli: "mercadolivre",
    mercadolivrebr: "mercadolivre",
    mercadolivre: "mercadolivre",
    mercadoLivre: "mercadolivre",
    amazonbr: "amazon",
    amazon: "amazon",
    shopee: "shopee",
    awin: "awin",
    feedawin: "awin",
    kabum: "kabum",
    feedkabum: "kabum",
    ali: "aliexpress",
    aliexpress: "aliexpress",
    aliexpressbr: "aliexpress"
  };

  return aliases[valor] || valor;
}

function resultado(marketplace, status, detalhes = {}, ok = false, mensagem = "") {
  const codigo = String(status || "falha_teste");
  return {
    ok: ok === true,
    marketplace: normalizarMarketplace(marketplace),
    status: codigo,
    codigo,
    mensagem: mensagem || MENSAGENS[codigo] || MENSAGENS.falha_teste,
    detalhes: detalhes || {},
    testadoEm: new Date().toISOString()
  };
}

function credenciais(config = {}) {
  return config?.credenciais || config || {};
}

function valorTexto(obj = {}, campos = []) {
  for (const campo of campos) {
    const valor = obj?.[campo];
    if (valor !== undefined && valor !== null && String(valor).trim()) {
      return String(valor).trim();
    }
  }
  return "";
}

function textoAuditoria(valor = "") {
  return String(valor || "")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url]")
    .slice(0, 240);
}

function logAuditoriaIntegracao(prefixo, dados = {}) {
  try {
    console.log(prefixo, JSON.stringify(dados));
  } catch (_) {
    console.log(prefixo, "{\"erro\":\"falha_serializacao_auditoria\"}");
  }
}

function tagAmazon(config = {}) {
  const c = credenciais(config);
  return valorTexto(c, [
    "trackingId",
    "partnerTag",
    "tag",
    "tagId",
    "affiliateTag",
    "appId"
  ]);
}

function linkTesteMercadoLivre(config = {}) {
  const c = credenciais(config);
  return (
    valorTexto(c, ["urlTeste", "linkTeste", "produtoTesteUrl", "testProductUrl"]) ||
    valorTexto(config, ["urlTeste", "linkTeste", "produtoTesteUrl", "testProductUrl"]) ||
    process.env.MERCADOLIVRE_TEST_PRODUCT_URL ||
    "https://meli.la/2q2wuJL"
  );
}

function motivoImportadorMercadoLivre(produto = {}) {
  return valorTexto(produto, ["motivo", "motivoTecnico", "erro", "status", "statusDetalhe", "aviso"]);
}

function normalizarUrlComparacao(valor = "") {
  const texto = String(valor || "").trim();
  if (!texto) return "";
  try {
    const url = new URL(texto);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch (_) {
    return texto.replace(/\/$/, "");
  }
}

function temProdutoImportado(produto = {}) {
  return Boolean(valorTexto(produto, [
    "titulo",
    "nome",
    "productName",
    "produtoId",
    "produtoIdCanonico",
    "itemId",
    "asin"
  ]));
}

function linkOriginalIgual(link = "", produto = {}, urlTeste = "") {
  const linkNormalizado = normalizarUrlComparacao(link);
  if (!linkNormalizado) return true;
  const originais = [
    produto.linkOriginal,
    produto.urlFinal,
    produto.productLink,
    produto.linkExpandido,
    urlTeste
  ].map(normalizarUrlComparacao).filter(Boolean);
  return originais.includes(linkNormalizado);
}

function linkAfiliadoMercadoLivreValido(linkAfiliado = "", produto = {}, urlTeste = "") {
  const link = String(linkAfiliado || "").trim();
  if (!/^https?:\/\//i.test(link)) return false;

  if (linkOriginalIgual(link, produto, urlTeste)) return false;

  return /^https?:\/\/([^/]+\.)?meli\.la\//i.test(link) ||
    /[?&](tag|matt_tool|matt_word|matt_source|matt_campaign|matt_adgroup|matt_match_type)=/i.test(link);
}

function linkAmazonComTag(linkAfiliado = "", tagId = "") {
  const link = String(linkAfiliado || "").trim();
  const tag = String(tagId || "").trim();
  if (!/^https?:\/\//i.test(link) || !tag) return false;
  try {
    const url = new URL(link);
    return url.searchParams.get("tag") === tag ||
      link.includes(`tag=${encodeURIComponent(tag)}`) ||
      link.includes(`tag=${tag}`);
  } catch (_) {
    return link.includes(`tag=${encodeURIComponent(tag)}`) || link.includes(`tag=${tag}`);
  }
}

function linkAfiliadoGenericoValido(linkAfiliado = "", produto = {}, urlTeste = "") {
  const link = String(linkAfiliado || "").trim();
  if (!/^https?:\/\//i.test(link)) return false;
  return !linkOriginalIgual(link, produto, urlTeste);
}

async function testarMercadoLivre(clienteId = "admin", config = {}, deps = {}) {
  const importarMercadoLivre = deps.importarMercadoLivre;
  const getIntegracaoCliente = deps.getIntegracaoCliente || (() => config);
  const gerarLinkAfiliadoMercadoLivre = deps.gerarLinkAfiliadoMercadoLivre;
  const urlTeste = linkTesteMercadoLivre(config);
  const c = credenciais(config);
  const cookies = valorTexto(c, ["cookies", "cookie"]);
  const tag = valorTexto(c, ["tag", "tagId", "tagID", "tag_id", "codigoAfiliado", "trackingId", "partnerTag", "affiliateTag"]);
  const logMl = (dados = {}) => logAuditoriaIntegracao("[INTEGRACAO-TESTE-ML-AUDITORIA]", {
    clienteId,
    cookiesPresentes: !!cookies,
    tagPresente: !!tag,
    funcaoOficialChamada: false,
    importadorRetornouProduto: false,
    linkOriginalPresente: false,
    linkFinalPresente: false,
    linkAfiliadoPresente: false,
    linkFinalIgualLinkOriginal: false,
    ...dados,
    mensagemMotivoFinal: textoAuditoria(dados.mensagemMotivoFinal)
  });

  if (!cookies) {
    logMl({ criterioDecisao: "cookie_ausente", mensagemMotivoFinal: MENSAGENS.cookie_ausente });
    return resultado("mercadolivre", "cookie_ausente", { faltandoCookies: true }, false);
  }
  if (!tag) {
    logMl({ criterioDecisao: "tag_ausente", mensagemMotivoFinal: MENSAGENS.tag_ausente });
    return resultado("mercadolivre", "tag_ausente", { faltandoTag: true }, false);
  }

  if (typeof importarMercadoLivre !== "function") {
    logMl({
      criterioDecisao: "importador_ml_indisponivel",
      mensagemMotivoFinal: "Importador oficial do Mercado Livre indisponivel para teste."
    });
    return resultado("mercadolivre", "importador_ml_indisponivel", {
      motivo: "importador_oficial_indisponivel"
    }, false, "Importador oficial do Mercado Livre indisponível para teste.");
  }

  try {
    const produto = await importarMercadoLivre(urlTeste, clienteId, {
      getIntegracaoCliente,
      gerarLinkAfiliadoMercadoLivre
    });

    if (!produto || typeof produto !== "object") {
      logMl({
        funcaoOficialChamada: true,
        criterioDecisao: "importador_sem_retorno",
        mensagemMotivoFinal: "Importador oficial nao retornou produto."
      });
      return resultado("mercadolivre", "importador_sem_retorno", {
        urlTestePresente: !!urlTeste
      }, false, "Importador oficial não retornou produto.");
    }

    const linkAfiliado = valorTexto(produto, ["linkAfiliado", "linkFinal"]);
    const linkOriginal = valorTexto(produto, ["linkOriginal", "urlFinal"]);
    const linkFinal = valorTexto(produto, ["linkFinal", "link"]);
    const motivo = motivoImportadorMercadoLivre(produto);
    const linkAfiliadoValido = linkAfiliadoMercadoLivreValido(linkAfiliado, produto, urlTeste);
    const auditoriaProdutoMl = {
      funcaoOficialChamada: true,
      importadorRetornouProduto: true,
      linkOriginalPresente: !!linkOriginal,
      linkFinalPresente: !!linkFinal,
      linkAfiliadoPresente: !!linkAfiliado,
      linkFinalIgualLinkOriginal: Boolean(linkFinal && linkOriginal && normalizarUrlComparacao(linkFinal) === normalizarUrlComparacao(linkOriginal))
    };

    if (!linkAfiliadoValido) {
      logMl({
        ...auditoriaProdutoMl,
        criterioDecisao: motivo || "link_afiliado_ausente",
        mensagemMotivoFinal: motivo || "Importador oficial nao retornou link afiliado."
      });
      return resultado("mercadolivre", motivo || "link_afiliado_ausente", {
        motivo: motivo || "importador_nao_retornou_link_afiliado",
        temTitulo: !!valorTexto(produto, ["titulo", "nome"]),
        temPreco: !!valorTexto(produto, ["preco", "precoAtual"])
      }, false, motivo || "Importador oficial não retornou link afiliado.");
    }

    logMl({
      ...auditoriaProdutoMl,
      criterioDecisao: "link_afiliado_valido",
      mensagemMotivoFinal: "Importador oficial gerou link afiliado com sucesso."
    });
    return resultado("mercadolivre", "ok", {
      origem: "importador_oficial",
      linkAfiliado,
      temTitulo: !!valorTexto(produto, ["titulo", "nome"]),
      temPreco: !!valorTexto(produto, ["preco", "precoAtual"]),
      temImagem: !!valorTexto(produto, ["imagem", "imagemUrl"])
    }, true, "Importador oficial gerou link afiliado com sucesso.");
  } catch (e) {
    const motivo = e?.message || "erro_importador";
    logMl({
      funcaoOficialChamada: true,
      criterioDecisao: "erro_importador",
      mensagemMotivoFinal: motivo
    });
    return resultado("mercadolivre", motivo, {
      motivo,
      origem: "importador_oficial"
    }, false, motivo);
  }
}
function linkTesteAmazon(config = {}) {
  const c = credenciais(config);
  const asin = valorTexto(c, ["asinTeste", "asin"]) || "B07PGL2ZSL";
  return valorTexto(c, ["urlTeste", "linkTeste", "produtoTesteUrl", "testProductUrl"]) ||
    valorTexto(config, ["urlTeste", "linkTeste", "produtoTesteUrl", "testProductUrl"]) ||
    `https://www.amazon.com.br/dp/${encodeURIComponent(asin)}`;
}

async function testarAmazon(clienteId = "admin", config = {}, deps = {}) {
  const c = credenciais(config);
  const modo = String(config?.modo || c.modo || "cookies").toLowerCase();
  const modoEscolhido = modo === "api" ? "PA-API" : "cookies";
  const tagId = tagAmazon(config);
  const cookies = valorTexto(c, ["cookies", "cookie"]);
  const accessKey = valorTexto(c, ["accessKey", "access_key"]);
  const secretKey = valorTexto(c, ["secretKey", "secret_key"]);
  const urlTeste = linkTesteAmazon(config);
  const logAmazon = (dados = {}) => logAuditoriaIntegracao("[INTEGRACAO-TESTE-AMAZON-AUDITORIA]", {
    clienteId,
    modoEscolhido,
    cookiesPresentes: !!cookies,
    tagPresente: !!tagId,
    accessKeyPresente: !!accessKey,
    secretKeyPresente: !!secretKey,
    funcaoOficialChamada: false,
    produtoRetornado: false,
    linkOriginalPresente: false,
    linkAfiliadoContemTagId: false,
    ...dados,
    mensagemMotivoFinal: textoAuditoria(dados.mensagemMotivoFinal)
  });

  if (!tagId) {
    logAmazon({ criterioDecisao: "tag_ausente", mensagemMotivoFinal: MENSAGENS.tag_ausente });
    return resultado("amazon", "tag_ausente", { faltandoTag: true, modo }, false);
  }

  if (modo === "api") {
    if (!accessKey || !secretKey) {
      logAmazon({ criterioDecisao: "credencial_ausente", mensagemMotivoFinal: MENSAGENS.credencial_ausente });
      return resultado("amazon", "credencial_ausente", {
        modo,
        faltandoAccessKey: !accessKey,
        faltandoSecretKey: !secretKey
      }, false);
    }

    if (typeof deps.testarAmazonPaApi === "function") {
      try {
        const produtoApi = await deps.testarAmazonPaApi(clienteId, config, { urlTeste });
        const linkAfiliadoApi = valorTexto(produtoApi, ["linkAfiliado", "linkFinal", "link"]);
        const produtoRetornado = temProdutoImportado(produtoApi);
        const linkContemTag = linkAmazonComTag(linkAfiliadoApi, tagId);
        const auditoriaApi = {
          funcaoOficialChamada: true,
          produtoRetornado,
          linkOriginalPresente: !!valorTexto(produtoApi, ["linkOriginal", "urlFinal", "productLink"]),
          linkAfiliadoContemTagId: linkContemTag
        };
        if (!produtoRetornado || !linkContemTag) {
          logAmazon({
            ...auditoriaApi,
            criterioDecisao: "link_afiliado_ausente",
            mensagemMotivoFinal: "Fluxo oficial da Amazon nao comprovou produto com link afiliado valido."
          });
          return resultado("amazon", "link_afiliado_ausente", {
            modo,
            temProduto: produtoRetornado,
            temLinkAfiliado: !!linkAfiliadoApi
          }, false, "Fluxo oficial da Amazon não comprovou produto com link afiliado válido.");
        }
        logAmazon({
          ...auditoriaApi,
          criterioDecisao: "produto_com_link_tag_id",
          mensagemMotivoFinal: MENSAGENS.ok
        });
        return resultado("amazon", "ok", {
          modo,
          linkAfiliado: linkAfiliadoApi,
          origem: "paapi_oficial"
        }, true);
      } catch (e) {
        logAmazon({
          funcaoOficialChamada: true,
          criterioDecisao: "falha_teste",
          mensagemMotivoFinal: e?.message || "erro_paapi"
        });
        return resultado("amazon", "falha_teste", { modo, erro: e.message }, false);
      }
    }

    logAmazon({ criterioDecisao: "teste_nao_implementado", mensagemMotivoFinal: MENSAGENS.teste_nao_implementado });
    return resultado("amazon", "teste_nao_implementado", { modo }, false);
  }

  if (!cookies) {
    logAmazon({ criterioDecisao: "cookie_ausente", mensagemMotivoFinal: MENSAGENS.cookie_ausente });
    return resultado("amazon", "cookie_ausente", { faltandoCookies: true, modo }, false);
  }

  if (typeof deps.importarAmazon === "function") {
    try {
      const produto = await deps.importarAmazon(urlTeste, config);
      const linkAfiliado = valorTexto(produto, ["linkAfiliado", "linkFinal", "link"]);
      const produtoRetornado = temProdutoImportado(produto);
      const linkContemTag = linkAmazonComTag(linkAfiliado, tagId);
      const auditoriaProdutoAmazon = {
        funcaoOficialChamada: true,
        produtoRetornado,
        linkOriginalPresente: !!valorTexto(produto, ["linkOriginal", "urlFinal", "productLink"]),
        linkAfiliadoContemTagId: linkContemTag
      };
      if (!produtoRetornado || !linkContemTag) {
        logAmazon({
          ...auditoriaProdutoAmazon,
          criterioDecisao: "link_afiliado_ausente",
          mensagemMotivoFinal: "Importador oficial da Amazon nao comprovou produto com link afiliado valido."
        });
        return resultado("amazon", "link_afiliado_ausente", {
          modo,
          temProduto: produtoRetornado,
          temLinkAfiliado: !!linkAfiliado
        }, false, "Importador oficial da Amazon não comprovou produto com link afiliado válido.");
      }
      logAmazon({
        ...auditoriaProdutoAmazon,
        criterioDecisao: "produto_com_link_tag_id",
        mensagemMotivoFinal: MENSAGENS.ok
      });
      return resultado("amazon", "ok", {
        modo,
        linkAfiliado,
        temTitulo: !!valorTexto(produto, ["titulo", "nome"]),
        temPreco: !!valorTexto(produto, ["preco", "precoAtual"])
      }, true);
    } catch (e) {
      logAmazon({
        funcaoOficialChamada: true,
        criterioDecisao: "falha_teste",
        mensagemMotivoFinal: e?.message || "erro_importador"
      });
      return resultado("amazon", "falha_teste", { modo, erro: e.message }, false);
    }
  }

  try {
    const url = new URL(urlTeste);
    url.searchParams.set("tag", tagId);
    const linkAfiliado = url.toString();

    const response = await fetch(linkAfiliado, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        Cookie: cookies
      }
    });

    const html = await response.text().catch(() => "");
    const urlFinal = response.url || "";
    const lower = `${urlFinal}\n${html}`.toLowerCase();

    if (
      [401, 403, 419, 429, 503].includes(Number(response.status)) ||
      lower.includes("captcha") ||
      lower.includes("robot check") ||
      lower.includes("automated access") ||
      lower.includes("digite os caracteres")
    ) {
      logAmazon({
        criterioDecisao: "cookie_expirado",
        linkOriginalPresente: !!urlTeste,
        linkAfiliadoContemTagId: linkAmazonComTag(linkAfiliado, tagId),
        mensagemMotivoFinal: MENSAGENS.cookie_expirado
      });
      return resultado("amazon", "cookie_expirado", { modo, httpStatus: response.status, urlFinal }, false);
    }

    if (!response.ok) {
      logAmazon({
        criterioDecisao: "falha_teste_http",
        linkOriginalPresente: !!urlTeste,
        linkAfiliadoContemTagId: linkAmazonComTag(linkAfiliado, tagId),
        mensagemMotivoFinal: MENSAGENS.falha_teste
      });
      return resultado("amazon", "falha_teste", { modo, httpStatus: response.status, urlFinal }, false);
    }

    if (!linkAfiliado.includes(`tag=${encodeURIComponent(tagId)}`) && !linkAfiliado.includes(`tag=${tagId}`)) {
      logAmazon({
        criterioDecisao: "link_sem_tag_id",
        linkOriginalPresente: !!urlTeste,
        linkAfiliadoContemTagId: false,
        mensagemMotivoFinal: MENSAGENS.falha_teste
      });
      return resultado("amazon", "falha_teste", { modo, linkAfiliado }, false);
    }

    logAmazon({
      criterioDecisao: "importador_oficial_indisponivel",
      linkOriginalPresente: !!urlTeste,
      linkAfiliadoContemTagId: true,
      mensagemMotivoFinal: "Importador oficial indisponivel; teste real nao implementado neste caminho."
    });
    return resultado("amazon", "teste_nao_implementado", {
      modo,
      httpStatus: response.status,
      motivo: "importador_oficial_indisponivel"
    }, false);
  } catch (e) {
    logAmazon({
      criterioDecisao: "falha_teste",
      mensagemMotivoFinal: e?.message || "erro_teste"
    });
    return resultado("amazon", "falha_teste", { modo, erro: e.message }, false);
  }
}
function credenciaisShopee(config = {}) {
  const c = credenciais(config);
  return {
    appId: valorTexto(c, ["appId", "app_id"]),
    secret: valorTexto(c, ["secret", "appSecret", "app_secret"])
  };
}

async function testarShopee(config = {}) {
  const c = credenciaisShopee(config);
  if (!c.appId || !c.secret) {
    return resultado("shopee", "credencial_ausente", {
      faltandoAppId: !c.appId,
      faltandoSecret: !c.secret
    }, false);
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = {
      query: `
        query {
          productOfferV2(keyword: "oferta", page: 1, limit: 1) {
            nodes {
              itemId
              productName
              productLink
              offerLink
            }
          }
        }
      `
    };
    const payload = JSON.stringify(body);
    const sign = crypto
      .createHash("sha256")
      .update(`${c.appId}${timestamp}${payload}${c.secret}`, "utf8")
      .digest("hex");

    const response = await fetch("https://open-api.affiliate.shopee.com.br/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `SHA256 Credential=${c.appId}, Timestamp=${timestamp}, Signature=${sign}`
      },
      body: payload
    });

    const data = await response.json().catch(() => null);
    const erros = Array.isArray(data?.errors) ? data.errors : [];

    if ([401, 403].includes(Number(response.status)) || erros.length) {
      return resultado("shopee", "credencial_invalida", {
        httpStatus: response.status,
        erros
      }, false);
    }

    if (!response.ok) {
      return resultado("shopee", "falha_teste", { httpStatus: response.status, resposta: data }, false);
    }

    const nodes = data?.data?.productOfferV2?.nodes || [];
    const primeiro = nodes?.[0] || {};
    const primeiroLink = String(primeiro?.offerLink || "").trim();
    if (!temProdutoImportado(primeiro) || !linkAfiliadoGenericoValido(primeiroLink, {
      productLink: primeiro.productLink
    })) {
      return resultado("shopee", "falha_teste", {
        motivo: "offer_link_nao_retornado",
        totalItens: Array.isArray(nodes) ? nodes.length : 0
      }, false);
    }

    return resultado("shopee", "ok", {
      httpStatus: response.status,
      totalItens: nodes.length,
      linkAfiliado: primeiroLink
    }, true);
  } catch (e) {
    return resultado("shopee", "falha_teste", { erro: e.message }, false);
  }
}

function credenciaisAwin(config = {}) {
  const c = credenciais(config);
  const programas = Array.isArray(c.programas) ? c.programas : [];
  const programaComAdvertiser = programas.find((programa) => valorTexto(programa, ["advertiserId", "advertiser_id", "id"]));
  return {
    publisherId: valorTexto(c, ["publisherId", "publisher_id", "publisher"]),
    apiToken: valorTexto(c, ["apiToken", "api_token", "token"]),
    advertiserId: valorTexto(c, ["advertiserId", "advertiser_id", "awinmid"]) ||
      valorTexto(programaComAdvertiser || {}, ["advertiserId", "advertiser_id", "id"])
  };
}

function linkTesteKabumAwin(config = {}) {
  const c = credenciais(config);
  return valorTexto(c, ["urlTeste", "linkTeste", "produtoTesteUrl", "testProductUrl"]) ||
    valorTexto(config, ["urlTeste", "linkTeste", "produtoTesteUrl", "testProductUrl"]) ||
    "https://www.kabum.com.br/produto/944475/produto-teste";
}

async function testarAwin(clienteId = "admin", config = {}, marketplace = "awin", deps = {}) {
  const c = credenciaisAwin(config);
  if (!c.publisherId || !c.apiToken || !c.advertiserId) {
    return resultado(marketplace, "credencial_ausente", {
      faltandoPublisherId: !c.publisherId,
      faltandoApiToken: !c.apiToken,
      faltandoAdvertiserId: !c.advertiserId
    }, false);
  }

  if (typeof deps.importarProdutoKabumViaAwin === "function" && typeof deps.gerarDeepLinkAwin === "function") {
    const urlTeste = linkTesteKabumAwin(config);
    try {
      const produto = await deps.importarProdutoKabumViaAwin(urlTeste, clienteId, {
        gerarDeepLinkAwin: deps.gerarDeepLinkAwin
      });
      const linkAfiliado = valorTexto(produto, ["linkAfiliado", "linkFinal", "link"]);
      if (!temProdutoImportado(produto) || !linkAfiliadoGenericoValido(linkAfiliado, produto, urlTeste)) {
        return resultado(marketplace, "link_afiliado_ausente", {
          temProduto: temProdutoImportado(produto),
          temLinkAfiliado: !!linkAfiliado
        }, false, "Fluxo oficial AWIN/KaBuM não comprovou produto com link afiliado válido.");
      }
      return resultado(marketplace, "ok", {
        linkAfiliado,
        temTitulo: !!valorTexto(produto, ["titulo", "nome"]),
        temPreco: !!valorTexto(produto, ["preco", "precoAtual"])
      }, true);
    } catch (e) {
      return resultado(marketplace, "falha_teste", { erro: e.message }, false);
    }
  }

  try {
    const url = new URL(`https://api.awin.com/publishers/${encodeURIComponent(c.publisherId)}/programmes`);
    url.searchParams.set("relationship", "joined");

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${c.apiToken}`
      }
    });
    const data = await response.json().catch(() => null);

    if ([401, 403].includes(Number(response.status))) {
      return resultado(marketplace, "credencial_invalida", { httpStatus: response.status }, false);
    }

    if (!response.ok) {
      return resultado(marketplace, "falha_teste", { httpStatus: response.status, resposta: data }, false);
    }

    return resultado(marketplace, "teste_nao_implementado", {
      httpStatus: response.status,
      totalProgramas: Array.isArray(data) ? data.length : 0,
      motivo: "importador_oficial_indisponivel"
    }, false);
  } catch (e) {
    return resultado(marketplace, "falha_teste", { erro: e.message }, false);
  }
}

function linkTesteAliExpress(config = {}) {
  const c = credenciais(config);
  return valorTexto(c, ["urlTeste", "linkTeste", "produtoTesteUrl", "testProductUrl"]) ||
    valorTexto(config, ["urlTeste", "linkTeste", "produtoTesteUrl", "testProductUrl"]) ||
    "https://www.aliexpress.com/item/100500.html";
}

async function testarAliExpress(config = {}, deps = {}) {
  const c = credenciais(config);
  const appKey = valorTexto(c, ["appKey", "app_key"]);
  const secret = valorTexto(c, ["secret", "appSecret", "app_secret"]);
  const trackingId = valorTexto(c, ["trackingId", "tracking_id"]);

  if (!appKey || !secret || !trackingId) {
    return resultado("aliexpress", "credencial_ausente", {
      faltandoAppKey: !appKey,
      faltandoSecret: !secret,
      faltandoTrackingId: !trackingId
    }, false);
  }

  if (typeof deps.importarAliExpress === "function") {
    const urlTeste = linkTesteAliExpress(config);
    try {
      const produto = await deps.importarAliExpress(urlTeste, config);
      const linkAfiliado = valorTexto(produto, ["linkAfiliado", "linkFinal", "link"]);
      if (!temProdutoImportado(produto) || !linkAfiliadoGenericoValido(linkAfiliado, produto, urlTeste)) {
        return resultado("aliexpress", "link_afiliado_ausente", {
          temProduto: temProdutoImportado(produto),
          temLinkAfiliado: !!linkAfiliado
        }, false, "Importador oficial do AliExpress não comprovou produto com link afiliado válido.");
      }
      return resultado("aliexpress", "ok", {
        linkAfiliado,
        temTitulo: !!valorTexto(produto, ["titulo", "nome"]),
        temPreco: !!valorTexto(produto, ["preco", "precoAtual"])
      }, true);
    } catch (e) {
      return resultado("aliexpress", "falha_teste", { erro: e.message }, false);
    }
  }

  return resultado("aliexpress", "teste_nao_implementado", {
    camposPresentes: ["appKey", "secret", "trackingId"]
  }, false);
}

async function testarIntegracaoMarketplace(clienteId = "admin", marketplace = "", integracao = {}, deps = {}) {
  const mp = normalizarMarketplace(marketplace);
  const config = integracao || {};

  if (!config && mp !== "kabum") {
    return resultado(mp, "credencial_ausente", { clienteId, motivo: "integracao_nao_configurada" }, false);
  }

  if (mp === "mercadolivre") return testarMercadoLivre(clienteId, config, deps);
  if (mp === "amazon") return testarAmazon(clienteId, config, deps);
  if (mp === "shopee") return testarShopee(config);
  if (mp === "awin") return testarAwin(clienteId, config, "awin", deps);
  if (mp === "kabum") return testarAwin(clienteId, config, "kabum", deps);
  if (mp === "aliexpress") return testarAliExpress(config, deps);

  return resultado(mp, "marketplace_nao_suportado", { clienteId }, false);
}

module.exports = {
  testarIntegracaoMarketplace,
  normalizarMarketplaceIntegracaoTeste: normalizarMarketplace
};
