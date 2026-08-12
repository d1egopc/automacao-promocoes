const { classificarCategoriaOferta } = require("../../../../marketplaces/inteligencia/classificador-categorias");
const { avaliarOfertaUniversal } = require("../../../../modules/inteligencia-universal");
const { queryEngine } = require("../../database");
const {
  extrairIdsShopee,
  tituloShopeeValido
} = require("../../../../marketplaces/shopee/normalizacao");
const {
  PAPEL_LINK,
  classificarCandidatosLinks,
  escolherProdutoPrincipal,
  resumoLinksClassificados
} = require("../../link-role.service");
const {
  normalizarCodigoCupomSemantico
} = require("../../../radar/cupom-semantico");

function texto(valor = "") {
  return String(valor || "").trim();
}

function numeroPrecoShopeeAdapter(valor = "") {
  const bruto = texto(valor).replace(/R\$/gi, "").replace(/\s+/g, "");
  if (!bruto || /\s+a\s/i.test(texto(valor))) return null;
  let normalizado = bruto.replace(/[^\d.,]/g, "");
  if (normalizado.includes(",") && normalizado.includes(".")) normalizado = normalizado.replace(/\./g, "").replace(",", ".");
  else if (normalizado.includes(",")) normalizado = normalizado.replace(",", ".");
  const numero = Number(normalizado);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

async function buscarImagemHistoricaShopee(shopId = "", itemId = "") {
  if (!/^\d+$/.test(texto(shopId)) || !/^\d+$/.test(texto(itemId))) {
    return { imagem: "", origem: "", motivo: "shopee_ids_ausentes" };
  }

  const resultado = await queryEngine(
    `SELECT id, imagem
       FROM engine_ofertas
      WHERE LOWER(REGEXP_REPLACE(COALESCE(marketplace, ''), '[[:space:]_-]+', '', 'g')) LIKE '%shopee%'
        AND NULLIF(TRIM(COALESCE(imagem, '')), '') IS NOT NULL
        AND (
          CONCAT_WS(' ', link_original, link_expandido, link_afiliado, COALESCE(metadata::text, '')) LIKE $1
          OR CONCAT_WS(' ', link_original, link_expandido, link_afiliado, COALESCE(metadata::text, '')) LIKE $2
          OR CONCAT_WS(' ', link_original, link_expandido, link_afiliado, COALESCE(metadata::text, '')) LIKE $3
          OR (
            COALESCE(metadata::text, '') LIKE $4
            AND COALESCE(metadata::text, '') LIKE $5
          )
        )
      ORDER BY atualizada_em DESC NULLS LAST, id DESC
      LIMIT 1`,
    [`%/product/${shopId}/${itemId}%`, `%-i.${shopId}.${itemId}%`, `%/opaanlp/${shopId}/${itemId}%`, `%${shopId}%`, `%${itemId}%`]
  );

  if (!resultado.ok) return { imagem: "", origem: "", motivo: "consulta_imagem_historica_falhou" };
  const anterior = resultado.resultado.rows[0];
  return anterior?.imagem
    ? { imagem: texto(anterior.imagem), origem: `engine_ofertas.imagem:${anterior.id}`, motivo: "imagem_historica_shop_item" }
    : { imagem: "", origem: "", motivo: "imagem_historica_nao_encontrada" };
}

function logAuditoriaShopee(dados = {}) {
  console.log("[SHOPEE-IMPORTER-AUDITORIA]", JSON.stringify({
    jobId: dados.jobId || null,
    clienteId: dados.clienteId || "",
    urlOriginal: dados.urlOriginal || "",
    urlExpandida: dados.urlExpandida || "",
    shopId: dados.shopId || "",
    itemId: dados.itemId || "",
    tituloExtraido: dados.tituloExtraido || "",
    tituloValido: dados.tituloValido === true,
    precoExtraido: dados.precoExtraido ?? null,
    precoValido: dados.precoValido === true,
    temImagem: Boolean(dados.imagem),
    origemImagem: dados.origemImagem || "nenhuma",
    motivoFalha: dados.motivoFalha || "",
    statusFinal: dados.statusFinal || ""
  }));
}

function detectarSuspeitaFator100(precoTextoRadar = "", precoAdapter = null) {
  const precoRadar = numeroPrecoShopeeAdapter(precoTextoRadar);
  const precoFinal = numeroPrecoShopeeAdapter(precoAdapter);
  if (precoRadar === null || precoFinal === null) return false;
  return Math.abs((precoFinal / precoRadar) - 100) < 0.01;
}

function extrairPrecoTextoRadarShopee(textoRadar = "") {
  const linhas = String(textoRadar || "").split(/\r?\n/);
  for (const linha of linhas) {
    const textoLinha = texto(linha);
    if (!textoLinha || !/R\$\s*\d/i.test(textoLinha)) continue;
    if (/\b(cupom|resgate|voucher|cashback|frete|moedas?|off|desconto|limite|economia)\b/i.test(textoLinha)) continue;
    const match = textoLinha.match(/R\$\s*\d{1,5}(?:\.\d{3})*(?:,\d{1,2})?|R\$\s*\d{1,5}(?:\.\d{1,2})?/i);
    const preco = numeroPrecoShopeeAdapter(match?.[0] || "");
    if (preco !== null) return { texto: match[0], valor: preco };
  }

  return { texto: "", valor: null };
}

function escolherPrecoShopeeComRadarSeguro(precoAdapter = null, textoRadar = "") {
  const precoRadar = extrairPrecoTextoRadarShopee(textoRadar);
  const precoApi = numeroPrecoShopeeAdapter(precoAdapter);
  if (precoRadar.valor === null) {
    return { preco: precoApi, origem: "adapter", precoRadarTexto: "", usouRadar: false };
  }
  if (precoApi === null) {
    return { preco: precoRadar.valor, origem: "texto_radar", precoRadarTexto: precoRadar.texto, usouRadar: true };
  }

  const menor = Math.min(precoApi, precoRadar.valor);
  const maior = Math.max(precoApi, precoRadar.valor);
  if (menor > 0 && maior / menor >= 3) {
    return { preco: precoRadar.valor, origem: "texto_radar_incompativel_api", precoRadarTexto: precoRadar.texto, usouRadar: true };
  }

  return { preco: precoApi, origem: "adapter", precoRadarTexto: precoRadar.texto, usouRadar: false };
}

function logPrecoAuditoriaShopee(dados = {}) {
  console.log("[SHOPEE-PRECO-AUDITORIA]", JSON.stringify({
    etapa: dados.etapa || "adapter",
    jobId: dados.jobId || null,
    clienteId: dados.clienteId || "",
    urlOriginal: dados.urlOriginal || "",
    urlExpandida: dados.urlExpandida || "",
    shopId: dados.shopId || "",
    itemId: dados.itemId || "",
    titulo: dados.titulo || "",
    precoTextoRadar: dados.precoTextoRadar || "",
    precoApi: dados.precoApi ?? "",
    precoBruto: dados.precoBruto ?? "",
    precoNormalizado: dados.precoNormalizado ?? "",
    precoAdapter: dados.precoAdapter ?? null,
    precoEngine: dados.precoEngine ?? null,
    precoTemplate: dados.precoTemplate ?? null,
    origemPreco: dados.origemPreco || "",
    motivoEscolhaPreco: dados.motivoEscolhaPreco || "",
    campoPrecoUsado: dados.campoPrecoUsado || "",
    tipoCampoPrecoUsado: dados.tipoCampoPrecoUsado || "",
    precoAntesNormalizacao: dados.precoAntesNormalizacao ?? "",
    precoDepoisNormalizacao: dados.precoDepoisNormalizacao ?? "",
    normalizadorAplicado: dados.normalizadorAplicado || "",
    suspeitaFator100: dados.suspeitaFator100 === true
  }));
}

function valorPresente(valor) {
  return valor !== null && valor !== undefined && texto(valor) !== "";
}

function primeiroValor(...valores) {
  for (const valor of valores) {
    if (valorPresente(valor)) return valor;
  }
  return "";
}

function textoOriginalEvento(evento = {}) {
  return texto(evento.texto_original || evento.textoOriginal || evento.texto || "");
}

function escolherLinkShopee(links = [], evento = {}) {
  const candidatos = montarCandidatosLinksShopee(links, evento);
  if (!candidatos.length) return { url: "", link: null, campo: "" };

  return escolherProdutoPrincipal(candidatos, "shopee", evento);
}

function montarCandidatosLinksShopee(links = [], evento = {}) {
  const candidatos = [];
  const vistos = new Set();

  function adicionar(url = "", link = null, campo = "") {
    const valor = texto(url);
    if (!valor || !/(?:^|\.)shopee\.com\.br|s\.shopee\.com\.br/i.test(valor)) return;
    const chave = `${campo}|${valor}`;
    if (vistos.has(chave)) return;
    vistos.add(chave);
    candidatos.push({ url: valor, link, campo });
  }

  for (const link of Array.isArray(links) ? links : []) {
    adicionar(link.url_expandida, link, "url_expandida");
    adicionar(link.url_normalizada, link, "url_normalizada");
    adicionar(link.url_original, link, "url_original");
  }

  if (Array.isArray(evento.links_extraidos)) {
    for (const url of evento.links_extraidos) {
      adicionar(url, null, "links_extraidos");
    }
  }

  return candidatos;
}

function linkShopeeAuxiliarBloqueado(candidato = {}) {
  return [
    PAPEL_LINK.CUPOM,
    PAPEL_LINK.CAMPANHA,
    PAPEL_LINK.MOEDAS,
    PAPEL_LINK.LOJA,
    PAPEL_LINK.CATEGORIA
  ].includes(candidato.papelLink);
}

function ordenarCandidatosShopee(candidatos = []) {
  const prioridadeCampo = {
    url_expandida: 4,
    url_normalizada: 3,
    url_original: 2,
    links_extraidos: 1
  };
  return [...candidatos].sort((a, b) => {
    const produtoB = b.papelLink === PAPEL_LINK.PRODUTO ? 100 : 0;
    const produtoA = a.papelLink === PAPEL_LINK.PRODUTO ? 100 : 0;
    if (produtoB !== produtoA) return produtoB - produtoA;
    const confiancaB = b.papelLinkConfianca === "alta" ? 20 : b.papelLinkConfianca === "media" ? 10 : 0;
    const confiancaA = a.papelLinkConfianca === "alta" ? 20 : a.papelLinkConfianca === "media" ? 10 : 0;
    if (confiancaB !== confiancaA) return confiancaB - confiancaA;
    return (prioridadeCampo[b.campo] || 0) - (prioridadeCampo[a.campo] || 0);
  });
}

function deduplicarCandidatosShopee(candidatos = []) {
  const vistos = new Set();
  const unicos = [];
  for (const candidato of candidatos) {
    const chave = texto(candidato.url).toLowerCase();
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    unicos.push(candidato);
  }
  return unicos;
}

function candidatosProcessaveisShopee(links = [], evento = {}) {
  const candidatos = montarCandidatosLinksShopee(links, evento);
  const classificados = classificarCandidatosLinks(candidatos, "shopee", evento);
  const processaveis = deduplicarCandidatosShopee(ordenarCandidatosShopee(
    classificados.filter(candidato => !linkShopeeAuxiliarBloqueado(candidato))
  ));
  const auxiliares = deduplicarCandidatosShopee(classificados.filter(linkShopeeAuxiliarBloqueado));
  return { classificados, processaveis, auxiliares };
}

function resumoCandidatosShopee(candidatos = []) {
  return candidatos.map(candidato => ({
    campo: candidato.campo || "",
    url: candidato.url || "",
    papelLink: candidato.papelLink || "",
    papelLinkMotivo: candidato.papelLinkMotivo || "",
    papelLinkConfianca: candidato.papelLinkConfianca || ""
  }));
}

function pareceCupomRealShopee(codigo = "") {
  const cupom = texto(codigo).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9_-]/g, "").trim();
  if (cupom.length < 5 || cupom.length > 40) return false;
  if (!/[A-Z]/.test(cupom)) return false;

  const bloqueados = new Set([
    "SHOPEE",
    "CUPOM",
    "CUPONS",
    "CODIGO",
    "CODIGO",
    "VOUCHER",
    "RESGATE",
    "RESGATAR",
    "APLIQUE",
    "DISPON",
    "DISPONIVEL",
    "DISPONVEL",
    "CLIENTE",
    "PARA",
    "PRODUTO",
    "LINK",
    "PAGINA",
    "PAGINA"
  ]);

  if (bloqueados.has(cupom)) return false;
  return /[A-Z]{3,}/.test(cupom) && /[A-Z0-9_-]/.test(cupom);
}

function extrairBeneficioTextoShopee(textoRadar = "") {
  const fonte = String(textoRadar || "");
  const beneficio =
    fonte.match(/(?:cupom\s+de\s+)?R\$\s*\d{1,5}(?:[.,]\d{1,2})?\s*OFF/i)?.[0] ||
    fonte.match(/\d{1,3}%\s*OFF/i)?.[0] ||
    fonte.match(/(?:no pix|pague via pix|\d{1,2}x\s+no\s+(?:cartao|cart.o))/i)?.[0] ||
    "";

  return texto(beneficio);
}

function extrairCupomTextoRadarShopee(textoRadar = "") {
  const fonte = String(textoRadar || "");
  const fonteSemUrls = fonte.replace(/https?:\/\/\S+|www\.\S+/gi, " ");
  const match = fonte.match(/(?:cupom|use o cupom|aplique o cupom|(?:codigo|c.digo))\s*:?[\s\n]*([A-Z0-9_-]{5,40})/i);
  const matchSemUrl = fonteSemUrls.match(/(?:cupom|use o cupom|aplique o cupom|(?:codigo|c.digo))\s*:?[\s\n]*([A-Z0-9_-]{5,40})/i);
  const cupomCandidato = matchSemUrl?.[1] || match?.[1] || "";
  const cupom = pareceCupomRealShopee(cupomCandidato)
    ? normalizarCodigoCupomSemantico(cupomCandidato)
    : "";

  if (cupom) {
    return {
      cupom,
      tipoCupom: "texto_radar",
      cupomTipo: "texto_radar",
      avisoCupom: `Use o cupom ${cupom} antes de finalizar a compra.`,
      beneficioExtra: ""
    };
  }

  const beneficio = extrairBeneficioTextoShopee(fonte);
  if (beneficio) {
    return {
      cupom: "",
      tipoCupom: "beneficio_texto_radar",
      cupomTipo: "beneficio_texto_radar",
      avisoCupom: /resgate\s+o\s+cupom/i.test(fonte) ? "Resgate o cupom no link abaixo." : beneficio,
      beneficioExtra: beneficio
    };
  }

  if (/resgate\s+o\s+cupom|cupom\s+(?:disponivel|dispon.vel)|aplique\s+o\s+cupom\s+(?:disponivel|dispon.vel)/i.test(fonte)) {
    return {
      cupom: "",
      tipoCupom: "resgate_pagina_shopee",
      cupomTipo: "resgate_pagina_shopee",
      avisoCupom: "Cupom disponivel na pagina. Resgate antes de finalizar.",
      beneficioExtra: "Cupom disponivel na pagina. Resgate antes de finalizar."
    };
  }

  return { cupom: "", tipoCupom: "", cupomTipo: "", avisoCupom: "", beneficioExtra: "" };
}

function categoriaGenericaShopee(categoria = "") {
  const normalizada = texto(categoria)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  return !normalizada || normalizada === "shopee" || normalizada === "marketplace" || normalizada === "generica" || normalizada === "geral";
}

function resolverCategoriaShopee(produto = {}, oferta = {}) {
  const categoria = produto.categoria || produto.categoriaProduto || oferta.categoria || "";
  if (!categoriaGenericaShopee(categoria)) return categoria;

  const titulo = produto.titulo || produto.nome || oferta.titulo || "";
  return classificarCategoriaOferta({
    titulo,
    nome: titulo,
    marketplace: "shopee"
  }, titulo);
}

function aplicarFallbackTextoRadar(produto = {}, evento = {}) {
  const cupomTexto = extrairCupomTextoRadarShopee(textoOriginalEvento(evento));
  if (!cupomTexto.cupom && !cupomTexto.avisoCupom && !cupomTexto.beneficioExtra) return produto;

  return {
    ...produto,
    cupom: produto.cupom || cupomTexto.cupom,
    tipoCupom: produto.tipoCupom || produto.cupomTipo || cupomTexto.tipoCupom,
    cupomTipo: produto.cupomTipo || produto.tipoCupom || cupomTexto.cupomTipo,
    avisoCupom: produto.avisoCupom || cupomTexto.avisoCupom,
    beneficioExtra: produto.beneficioExtra || produto.beneficioTexto || cupomTexto.beneficioExtra || cupomTexto.avisoCupom,
    beneficioTexto: produto.beneficioTexto || produto.beneficioExtra || cupomTexto.beneficioExtra || cupomTexto.avisoCupom
  };
}

function urlsOcorrenciaShopee(link = {}) {
  const metadata = link && typeof link.metadata === "object" && !Array.isArray(link.metadata) ? link.metadata : {};
  return [
    link.url_original,
    link.urlOriginal,
    link.url,
    link.url_normalizada,
    link.urlNormalizada,
    link.url_expandida,
    link.urlExpandida,
    metadata.linkOriginalCapturado,
    metadata.linkResolvido
  ].map(texto).filter(Boolean);
}

function urlPrincipalOcorrenciaShopee(link = {}) {
  return urlsOcorrenciaShopee(link)[0] || "";
}

function papelComercialShopee(papel = "") {
  const chave = texto(papel).toLowerCase();
  if ([PAPEL_LINK.CUPOM, "cupom", "resgate", "link_resgate", "voucher"].includes(chave)) return "resgate";
  if ([PAPEL_LINK.PRODUTO, "produto", "link_produto", "product"].includes(chave)) return "produto";
  return "";
}

function mesmoLinkShopee(a = "", b = "") {
  const chaveA = texto(a).replace(/\/+$/g, "").toLowerCase();
  const chaveB = texto(b).replace(/\/+$/g, "").toLowerCase();
  return Boolean(chaveA && chaveB && chaveA === chaveB);
}

function chaveConversaoOcorrenciaShopee(clienteId = "", papel = "", url = "") {
  return `shopee:${texto(clienteId)}:${texto(papel)}:${texto(url).toLowerCase()}`;
}

function resultadoConversaoLinkShopee({ link = {}, urlAfiliada = "", renderizavel = false, motivo = "", status = "" } = {}) {
  return {
    ...link,
    urlAfiliada: urlAfiliada || "",
    urlAfiliadaWorkspace: urlAfiliada || "",
    linkAfiliado: urlAfiliada || "",
    afiliado: urlAfiliada || "",
    renderizavel: renderizavel === true,
    seguro: renderizavel === true,
    convertidoWorkspace: renderizavel === true,
    conversaoStatus: status || (renderizavel ? "convertida" : "falhou"),
    motivoConversao: motivo || (renderizavel ? "conversao_ocorrencia_shopee" : "conversao_ocorrencia_shopee_falhou")
  };
}

async function converterOcorrenciasShopee({
  links = [],
  evento = {},
  clienteId = "",
  integracao = {},
  deps = {},
  produtoPrincipal = {},
  linkAfiliadoPrincipal = "",
  urlOriginalEngine = "",
  cacheImportacoesShopee = new Map()
} = {}) {
  const cacheConversoes = new Map();
  const textoOriginalRadar = textoOriginalEvento(evento);
  const saida = [];

  for (const [indice, link] of (Array.isArray(links) ? links : []).entries()) {
    const urlOriginal = urlPrincipalOcorrenciaShopee(link);
    const classificado = candidatoOcorrenciaShopee(link, evento, indice);
    const papel = classificado.papel || papelComercialShopee(link.papel || link.papelLink || link.tipo || "");
    if (!urlOriginal || !["produto", "resgate"].includes(papel)) {
      saida.push(link);
      continue;
    }

    const chave = chaveConversaoOcorrenciaShopee(clienteId, papel, urlOriginal);
    let conversao = cacheConversoes.get(chave);
    if (!conversao) {
      if (papel === "produto" && (
        mesmoLinkShopee(urlOriginal, urlOriginalEngine) ||
        urlsOcorrenciaShopee(link).some(url => mesmoLinkShopee(url, urlOriginalEngine))
      ) && linkAfiliadoPrincipal) {
        conversao = {
          urlAfiliada: linkAfiliadoPrincipal,
          renderizavel: true,
          motivo: "produto_principal_workspace_convertido",
          status: "convertida"
        };
      } else {
        try {
          let produtoConvertido = cacheImportacoesShopee.get(urlOriginal);
          if (!produtoConvertido) {
            produtoConvertido = await deps.importarShopee(urlOriginal, {
              ...integracao,
              textoOriginal: textoOriginalRadar,
              contextoRadar: {
                textoOriginal: textoOriginalRadar,
                grupoId: evento.grupo_id || "",
                grupoNome: evento.grupo_nome || "",
                origem: evento.origem || "engine"
              },
              contextoEngine: {
                eventoId: evento.id || evento.evento_id || "",
                clienteId,
                conversaoLinkAlternativo: true,
                papelLink: papel
              }
            });
            cacheImportacoesShopee.set(urlOriginal, produtoConvertido);
          }
          const urlAfiliada = texto(produtoConvertido?.linkAfiliado || produtoConvertido?.linkFinal || produtoConvertido?.link || produtoConvertido?.offerLink || "");
          conversao = {
            urlAfiliada,
            renderizavel: Boolean(urlAfiliada),
            motivo: urlAfiliada ? `${papel}_workspace_convertido_por_ocorrencia` : `${papel}_sem_conversao_workspace`,
            status: urlAfiliada ? "convertida" : "falhou"
          };
        } catch (e) {
          conversao = {
            urlAfiliada: "",
            renderizavel: false,
            motivo: `falha_tecnica_conversao_${papel}`,
            status: "falhou"
          };
        }
      }
      cacheConversoes.set(chave, conversao);
    }

    saida.push(resultadoConversaoLinkShopee({
      link: {
        ...link,
        url: urlOriginal,
        urlOriginal,
        url_original: urlOriginal,
        papelLink: papel === "resgate" ? PAPEL_LINK.CUPOM : PAPEL_LINK.PRODUTO,
        papelLinkMotivo: link.papelLinkMotivo || classificado.motivo
      },
      ...conversao
    }));
  }

  return saida;
}

function candidatoOcorrenciaShopee(link = {}, evento = {}, indice = 0) {
  const url = urlPrincipalOcorrenciaShopee(link);
  const papelExistente = papelComercialShopee(link.papel || link.papelLink || link.tipo || link.role || "");
  if (papelExistente) return { url, papel: papelExistente, motivo: link.papelLinkMotivo || link.motivo || "papel_preexistente" };

  const classificado = classificarCandidatosLinks([{ url, link, campo: "ocorrencia_radar" }], "shopee", evento)[0] || {};
  return {
    url,
    papel: papelComercialShopee(classificado.papelLink),
    motivo: classificado.papelLinkMotivo || classificado.motivo || "classificacao_shopee"
  };
}

function montarLinksComerciaisShopee({ links = [], evento = {}, analiseLinksShopee = {}, linkEscolhido = null, linkAfiliado = "", urlOriginalEngine = "" } = {}) {
  const ocorrencias = [];
  const vistos = new Set();
  const linksEntrada = Array.isArray(links) ? links : [];

  function adicionar(link = {}, indice = 0, origem = "radar.links") {
    const urlOriginal = urlPrincipalOcorrenciaShopee(link) || texto(link.url || "");
    if (!urlOriginal) return;
    const classificado = candidatoOcorrenciaShopee({ ...link, url: urlOriginal }, evento, indice);
    const papel = classificado.papel;
    if (!['produto', 'resgate'].includes(papel)) return;

    const ordemCaptura = Number(link.ordemCaptura || link.ordem || link.indiceCaptura || indice + 1) || (indice + 1);
    const ocorrenciaId = texto(link.ocorrenciaId || link.idOcorrencia || `shopee:${papel}:${ordemCaptura}:${indice + 1}`);
    const chave = `${ocorrenciaId}|${papel}|${ordemCaptura}|${urlOriginal}`;
    if (vistos.has(chave)) return;
    vistos.add(chave);

    const urls = urlsOcorrenciaShopee({ ...link, url: urlOriginal });
    const produtoEscolhido = papel === 'produto' && (
      mesmoLinkShopee(urlOriginal, urlOriginalEngine) ||
      mesmoLinkShopee(urlOriginal, linkEscolhido?.url || "") ||
      urls.some(url => mesmoLinkShopee(url, urlOriginalEngine) || mesmoLinkShopee(url, linkEscolhido?.url || ""))
    );
    const urlAfiliadaWorkspace = texto(link.urlOptimus || link.urlAfiliadaWorkspace || link.urlAfiliada || link.afiliado || link.linkAfiliado || (produtoEscolhido ? linkAfiliado : ""));
    const renderizavel = papel === 'resgate' || Boolean(urlAfiliadaWorkspace);

    ocorrencias.push({
      papel: papel === 'resgate' ? 'link_resgate' : 'link_produto',
      tipo: papel,
      url: urlOriginal,
      original: urlOriginal,
      resolvido: texto(link.url_expandida || link.urlExpandida || link.url_normalizada || link.urlNormalizada || urlOriginal),
      urlOriginal,
      urlExpandida: texto(link.url_expandida || link.urlExpandida || ""),
      urlAfiliada: urlAfiliadaWorkspace,
      urlAfiliadaWorkspace,
      urlOptimus: texto(link.urlOptimus || ""),
      ordemCaptura,
      ocorrenciaId,
      renderizavel,
      seguro: renderizavel,
      origem,
      proveniencia: origem,
      conversaoStatus: urlAfiliadaWorkspace ? 'convertida' : (papel === 'resgate' ? 'preservada_sem_conversao_workspace' : 'falhou'),
      motivoConversao: urlAfiliadaWorkspace ? 'cta_workspace_convertido' : (papel === 'resgate' ? 'resgate_shopee_preservado' : 'produto_sem_conversao_workspace'),
      motivo: classificado.motivo
    });
  }

  linksEntrada.forEach((link, indice) => adicionar(link, indice, "radar.links"));

  if (!ocorrencias.some(item => item.tipo === 'resgate')) {
    const auxiliares = Array.isArray(analiseLinksShopee.auxiliares) ? analiseLinksShopee.auxiliares : [];
    auxiliares.forEach((candidato, indice) => {
      if (candidato.papelLink !== PAPEL_LINK.CUPOM) return;
      adicionar({ ...(candidato.link || {}), url: candidato.url, papelLink: candidato.papelLink, papelLinkMotivo: candidato.papelLinkMotivo }, linksEntrada.length + indice, "adapter.linksAuxiliaresShopee");
    });
  }

  return ocorrencias.sort((a, b) => Number(a.ordemCaptura || 0) - Number(b.ordemCaptura || 0));
}
function aplicarContextoLinksShopee(produto = {}, auxiliares = []) {
  const linksCupom = auxiliares
    .filter(item => item.papelLink === PAPEL_LINK.CUPOM)
    .map(item => item.url)
    .filter(Boolean);

  if (!linksCupom.length) return produto;

  const avisoCupom = produto.avisoCupom || produto.beneficioTexto || produto.beneficioExtra || "Resgate o cupom na Shopee antes de finalizar.";
  return {
    ...produto,
    avisoCupom,
    beneficioTexto: produto.beneficioTexto || produto.beneficioExtra || avisoCupom,
    beneficioExtra: produto.beneficioExtra || produto.beneficioTexto || avisoCupom,
    linksResgateShopee: Array.from(new Set([...(produto.linksResgateShopee || []), ...linksCupom]))
  };
}

function produtoShopeeImportadoValido(produto = {}) {
  if (!produto || produto.ok === false) return false;
  const linkProduto = produto.linkExpandido || produto.linkOriginal || produto.linkAfiliado || produto.linkFinal || produto.link || "";
  const ids = extrairIdsShopee(linkProduto);
  return Boolean(ids.itemId || produto.itemId);
}

function auditarV2Shopee({ job = {}, produto = {}, ofertaAdapter = {} } = {}) {
  try {
    const resultadoV2 = avaliarOfertaUniversal({
      titulo: ofertaAdapter.titulo || produto.titulo || produto.nome || "",
      marketplace: "shopee",
      precoAtual: ofertaAdapter.preco || produto.precoAtual || produto.preco || "",
      precoOriginal: ofertaAdapter.precoOriginal || produto.precoAntigo || produto.precoOriginal || "",
      cupom: ofertaAdapter.cupom || produto.cupom || "",
      cupomTipo: ofertaAdapter.cupomTipo || produto.tipoCupom || produto.cupomTipo || "",
      beneficioTexto: ofertaAdapter.beneficioTexto || ofertaAdapter.beneficioExtra || produto.beneficioTexto || produto.beneficioExtra || produto.avisoCupom || "",
      linkAfiliado: ofertaAdapter.linkAfiliado || produto.linkAfiliado || produto.link || "",
      linkOriginal: ofertaAdapter.linkOriginal || produto.linkOriginal || "",
      linkExpandido: ofertaAdapter.linkExpandido || produto.linkExpandido || "",
      shopId: ofertaAdapter.shopId || produto.shopId || "",
      itemId: ofertaAdapter.itemId || produto.itemId || "",
      produtoIdDetectado: ofertaAdapter.produtoIdDetectado || produto.produtoId || "",
      imagem: ofertaAdapter.imagem || produto.imagem || "",
      categoria: ofertaAdapter.categoria || produto.categoria || produto.categoriaProduto || "",
      score: ofertaAdapter.score || produto.score || null,
      parcelamento: ofertaAdapter.parcelamento || produto.parcelamento || produto.avisoVariacaoPreco || "",
      freteGratis: ofertaAdapter.freteGratis === true || produto.freteGratis === true,
      cashback: ofertaAdapter.cashback || produto.cashback || "",
      precoPix: ofertaAdapter.precoPix || produto.precoPix || "",
      descontoPix: ofertaAdapter.descontoPix || produto.descontoPix || "",
      valorCupom: ofertaAdapter.valorCupom || produto.valorCupom || produto.cupomValor || "",
      percentualCupom: ofertaAdapter.percentualCupom || produto.percentualCupom || produto.cupomPercentual || "",
      freteValor: ofertaAdapter.freteValor || produto.freteValor || produto.valorFrete || "",
      origem: "engine_shopee"
    }, {
      clienteId: job.cliente_id || job.clienteId || "",
      origem: "engine_shopee",
      exigirLinkAfiliado: true
    });

    console.log("[ENGINE-SHOPEE-V2-AUDITORIA]", JSON.stringify({
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId: job.cliente_id || job.clienteId || "",
      fonteFinal: false,
      tipoAvaliacao: "auditoria_adapter_sem_memoria",
      titulo: ofertaAdapter.titulo || produto.titulo || produto.nome || "",
      okV2: resultadoV2.ok,
      statusV2: resultadoV2.status,
      motivoV2: resultadoV2.motivo,
      antes: {
        preco: produto.precoAtual || produto.preco || "",
        precoOriginal: produto.precoAntigo || produto.precoOriginal || "",
        cupom: produto.cupom || "",
        tipoCupom: produto.tipoCupom || produto.cupomTipo || "",
        avisoCupom: produto.avisoCupom || "",
        beneficioExtra: produto.beneficioExtra || produto.beneficioTexto || "",
        linkAfiliado: produto.linkAfiliado || produto.link || "",
        categoria: produto.categoria || ""
      },
      depois: {
        preco: resultadoV2.ofertaUniversal?.precoAtual ?? "",
        precoOriginal: resultadoV2.ofertaUniversal?.precoOriginal ?? "",
        cupom: resultadoV2.ofertaUniversal?.cupom || "",
        tipoCupom: resultadoV2.ofertaUniversal?.cupomTipo || "",
        beneficioTexto: resultadoV2.ofertaUniversal?.beneficioTexto || "",
        linkAfiliado: resultadoV2.ofertaUniversal?.linkAfiliado || "",
        categoria: resultadoV2.categoria || "",
        score: resultadoV2.score?.score ?? null,
        templateInput: resultadoV2.templateInput || {}
      }
    }));

    return resultadoV2;
  } catch (e) {
    console.log("[ENGINE-SHOPEE-V2-AUDITORIA-ERRO]", JSON.stringify({
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId: job.cliente_id || job.clienteId || "",
      erro: e.message
    }));
    return null;
  }
}

function enriquecerComV2(ofertaAdapter = {}, auditoriaV2 = null, produto = {}) {
  if (!auditoriaV2) return ofertaAdapter;

  const ofertaUniversal = auditoriaV2.ofertaUniversal || {};
  const templateInput = auditoriaV2.templateInput || {};
  const beneficioTexto = primeiroValor(
    ofertaUniversal.beneficioTexto,
    templateInput.beneficioTexto,
    ofertaAdapter.beneficioTexto,
    ofertaAdapter.beneficioExtra,
    produto.beneficioTexto,
    produto.beneficioExtra,
    produto.avisoCupom
  );
  const cupomTipo = primeiroValor(ofertaUniversal.cupomTipo, templateInput.cupomTipo, ofertaAdapter.cupomTipo, produto.tipoCupom, produto.cupomTipo);

  return {
    ...ofertaAdapter,
    preco: primeiroValor(ofertaUniversal.precoAtual, templateInput.precoAtual, ofertaAdapter.preco),
    precoOriginal: primeiroValor(ofertaUniversal.precoOriginal, templateInput.precoOriginal, ofertaAdapter.precoOriginal),
    cupom: primeiroValor(ofertaUniversal.cupom, templateInput.cupom, ofertaAdapter.cupom, produto.cupom),
    cupomTipo,
    tipoCupom: cupomTipo,
    avisoCupom: primeiroValor(ofertaUniversal.avisoCupom, ofertaUniversal.beneficioTexto, templateInput.beneficioTexto, ofertaAdapter.avisoCupom, produto.avisoCupom),
    beneficioTexto,
    beneficioExtra: beneficioTexto,
    parcelamento: primeiroValor(ofertaUniversal.parcelamento, templateInput.parcelamento, ofertaAdapter.parcelamento, produto.parcelamento, produto.avisoVariacaoPreco),
    freteGratis: ofertaUniversal.freteGratis === true || templateInput.freteGratis === true || ofertaAdapter.freteGratis === true || produto.freteGratis === true,
    cashback: primeiroValor(ofertaUniversal.cashback, templateInput.cashback, ofertaAdapter.cashback, produto.cashback),
    precoPix: primeiroValor(ofertaUniversal.precoPix, ofertaAdapter.precoPix, produto.precoPix),
    descontoPix: primeiroValor(ofertaUniversal.descontoPix, ofertaAdapter.descontoPix, produto.descontoPix),
    valorEfetivo: primeiroValor(ofertaUniversal.valorEfetivo, ofertaAdapter.valorEfetivo, produto.valorEfetivo),
    valorEfetivoOrigem: primeiroValor(ofertaUniversal.valorEfetivoOrigem, ofertaAdapter.valorEfetivoOrigem, produto.valorEfetivoOrigem),
    categoria: primeiroValor(auditoriaV2.categoria, ofertaUniversal.categoria, ofertaAdapter.categoria),
    score: ofertaAdapter.score
  };
}

async function importarShopeeEngine({ job = {}, evento = {}, links = [], deps = {} } = {}) {
  const clienteId = texto(job.cliente_id || job.clienteId || "");

  if (!clienteId) {
    return { ok: false, marketplace: "shopee", motivo: "cliente_invalido" };
  }

  const analiseLinksShopee = candidatosProcessaveisShopee(links, evento);
  const candidatosShopee = analiseLinksShopee.processaveis;
  const linksAuxiliaresShopee = analiseLinksShopee.auxiliares;

  console.log("[SHOPEE-CANDIDATOS]", JSON.stringify({
    jobId: job.id,
    eventoId: job.evento_id,
    clienteId,
    totalClassificados: analiseLinksShopee.classificados.length,
    totalProcessaveis: candidatosShopee.length,
    totalAuxiliares: linksAuxiliaresShopee.length,
    candidatos: resumoCandidatosShopee(analiseLinksShopee.classificados)
  }));

  if (candidatosShopee.length > 1) {
    console.log("[SHOPEE-PRODUTOS-AMBIGUOS]", JSON.stringify({
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId,
      totalCandidatosProduto: candidatosShopee.length,
      candidatos: resumoCandidatosShopee(candidatosShopee)
    }));
  }

  if (!candidatosShopee.length) {
    const linkEscolhido = escolherLinkShopee(links, evento);
    return {
      ok: false,
      marketplace: "shopee",
      motivo: linkEscolhido.papelLinkMotivo || "link_produto_shopee_nao_confirmado",
      metadata: {
        adapter: "shopee",
        linksClassificados: resumoLinksClassificados(links, evento, "shopee"),
        candidatosShopee: resumoCandidatosShopee(analiseLinksShopee.classificados)
      }
    };
  }

  if (typeof deps.importarShopee !== "function") {
    return { ok: false, marketplace: "shopee", motivo: "importador_shopee_indisponivel" };
  }

  if (typeof deps.getIntegracaoCliente !== "function") {
    return { ok: false, marketplace: "shopee", motivo: "get_integracao_indisponivel" };
  }

  const integracao = deps.getIntegracaoCliente(clienteId, "shopee");
  if (!integracao) {
    return { ok: false, marketplace: "shopee", motivo: "integracao_ausente" };
  }

  const textoOriginalRadar = textoOriginalEvento(evento);
  const cacheImportacoesShopee = new Map();
  let produtoBase = null;
  let linkEscolhido = null;
  let urlOriginalEngine = "";
  let ultimaFalha = null;

  for (const candidato of candidatosShopee) {
    const urlCandidato = candidato.url;
    if (!urlCandidato) continue;

    console.log("[ENGINE-SHOPEE-IMPORTADOR-CHAMADA]", {
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId,
      urlUsada: urlCandidato,
      papelLink: candidato.papelLink || "",
      papelLinkMotivo: candidato.papelLinkMotivo || "",
      temAppId: Boolean(integracao?.credenciais?.appId),
      temSecret: Boolean(integracao?.credenciais?.secret)
    });

    let resultadoImportador = cacheImportacoesShopee.get(urlCandidato);
    if (!resultadoImportador) {
      resultadoImportador = await deps.importarShopee(urlCandidato, {
        ...integracao,
        textoOriginal: textoOriginalRadar,
        contextoRadar: {
          textoOriginal: textoOriginalRadar,
          grupoId: evento.grupo_id || "",
          grupoNome: evento.grupo_nome || "",
          origem: evento.origem || "engine"
        },
        contextoEngine: {
          jobId: job.id,
          eventoId: job.evento_id,
          clienteId
        }
      });
      cacheImportacoesShopee.set(urlCandidato, resultadoImportador);
    }

    if (resultadoImportador?.ok === false || !produtoShopeeImportadoValido(resultadoImportador)) {
      const idsFalha = extrairIdsShopee(resultadoImportador?.linkExpandido || urlCandidato);
      ultimaFalha = {
        candidato,
        resultado: resultadoImportador || {},
        motivo: resultadoImportador?.motivo || "shopee_produto_nao_confirmado_apos_importador"
      };
      logAuditoriaShopee({
        jobId: job.id,
        clienteId,
        urlOriginal: urlCandidato,
        urlExpandida: resultadoImportador?.linkExpandido || "",
        shopId: resultadoImportador?.shopId || idsFalha.shopId,
        itemId: resultadoImportador?.itemId || idsFalha.itemId,
        tituloExtraido: resultadoImportador?.titulo || "",
        tituloValido: tituloShopeeValido(resultadoImportador?.titulo || ""),
        precoExtraido: numeroPrecoShopeeAdapter(resultadoImportador?.precoAtual || resultadoImportador?.preco),
        precoValido: numeroPrecoShopeeAdapter(resultadoImportador?.precoAtual || resultadoImportador?.preco) !== null,
        imagem: resultadoImportador?.imagem || "",
        origemImagem: resultadoImportador?.imagemOrigem || "nenhuma",
        motivoFalha: ultimaFalha.motivo,
        statusFinal: "falha_parser"
      });
      continue;
    }

    produtoBase = resultadoImportador;
    linkEscolhido = candidato;
    urlOriginalEngine = urlCandidato;
    console.log("[SHOPEE-PRODUTO-CONFIRMADO]", JSON.stringify({
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId,
      urlUsada: urlOriginalEngine,
      urlExpandida: produtoBase.linkExpandido || "",
      shopId: produtoBase.shopId || "",
      itemId: produtoBase.itemId || "",
      papelLink: candidato.papelLink || "",
      papelLinkMotivo: candidato.papelLinkMotivo || ""
    }));
    break;
  }

  if (!produtoBase) {
    return {
      ok: false,
      marketplace: "shopee",
      motivo: ultimaFalha?.motivo || "link_produto_shopee_nao_confirmado",
      linkOriginal: ultimaFalha?.candidato?.url || "",
      metadata: {
        adapter: "shopee",
        linksClassificados: resumoLinksClassificados(links, evento, "shopee"),
        candidatosShopee: resumoCandidatosShopee(analiseLinksShopee.classificados)
      }
    };
  }
  let produto = aplicarContextoLinksShopee(aplicarFallbackTextoRadar(produtoBase || {}, evento), linksAuxiliaresShopee);
  if (linksAuxiliaresShopee.some(item => item.papelLink === PAPEL_LINK.CUPOM)) {
    console.log("[SHOPEE-CUPOM-ASSOCIADO]", JSON.stringify({
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId,
      totalLinksCupom: linksAuxiliaresShopee.filter(item => item.papelLink === PAPEL_LINK.CUPOM).length
    }));
  }
  const idsDetectados = extrairIdsShopee(produto.linkExpandido || produto.linkOriginal || urlOriginalEngine);
  const idsProduto = {
    shopId: produto.shopId || idsDetectados.shopId,
    itemId: produto.itemId || idsDetectados.itemId
  };
  const tituloValido = tituloShopeeValido(produto.titulo || produto.nome || "");
  const precoEscolhido = escolherPrecoShopeeComRadarSeguro(produto.precoAtual || produto.preco || produto.precoMin || "", textoOriginalRadar);
  const precoNumerico = precoEscolhido.preco;
  if (precoEscolhido.usouRadar) {
    produto = {
      ...produto,
      preco: precoNumerico,
      precoAtual: precoNumerico,
      precoOrigem: precoEscolhido.origem
    };
  }
  const precoAuditoria = produto.precoAuditoria && typeof produto.precoAuditoria === "object"
    ? produto.precoAuditoria
    : {};
  const suspeitaFator100 = detectarSuspeitaFator100(precoAuditoria.precoTextoRadar, precoNumerico);

  logPrecoAuditoriaShopee({
    etapa: "adapter",
    jobId: job.id,
    clienteId,
    urlOriginal: urlOriginalEngine,
    urlExpandida: produto.linkExpandido || produto.linkOriginal || "",
    shopId: idsProduto.shopId,
    itemId: idsProduto.itemId,
    titulo: produto.titulo || produto.nome || "",
    ...precoAuditoria,
    precoAdapter: precoNumerico,
    precoTextoRadar: precoAuditoria.precoTextoRadar || precoEscolhido.precoRadarTexto,
    origemPreco: precoEscolhido.origem || precoAuditoria.origemPreco || precoAuditoria.precoOrigem || "",
    motivoEscolhaPreco: precoEscolhido.usouRadar ? "texto_radar_explicitamente_mais_confiavel" : precoAuditoria.motivoEscolhaPreco,
    suspeitaFator100
  });

  if (!tituloValido || precoNumerico === null) {
    const motivo = !tituloValido ? "shopee_titulo_indisponivel" : "shopee_preco_indisponivel";
    logAuditoriaShopee({
      jobId: job.id,
      clienteId,
      urlOriginal: urlOriginalEngine,
      urlExpandida: produto.linkExpandido || produto.linkOriginal || "",
      shopId: idsProduto.shopId,
      itemId: idsProduto.itemId,
      tituloExtraido: produto.titulo || produto.nome || "",
      tituloValido,
      precoExtraido: precoNumerico,
      precoValido: precoNumerico !== null,
      imagem: produto.imagem || "",
      origemImagem: produto.imagemOrigem || "nenhuma",
      motivoFalha: motivo,
      statusFinal: "falha_parser"
    });
    return { ok: false, marketplace: "shopee", motivo, linkOriginal: urlOriginalEngine };
  }

  if (!produto.imagem) {
    const historica = await buscarImagemHistoricaShopee(idsProduto.shopId, idsProduto.itemId);
    if (historica.imagem) {
      produto = { ...produto, imagem: historica.imagem, imagemOrigem: historica.origem };
    } else if (!produto.motivoFalha) {
      produto = { ...produto, motivoFalha: historica.motivo || "shopee_imagem_indisponivel" };
    }
  }

  console.log("[ENGINE-SHOPEE-IMPORTADOR-RETORNO]", JSON.stringify({
    jobId: job.id,
    eventoId: job.evento_id,
    clienteId,
    ok: Boolean(produtoBase),
    titulo: produto?.titulo || produto?.nome || "",
    precoAtual: produto?.precoAtual || produto?.preco || "",
    precoOriginal: produto?.precoOriginal || produto?.precoAntigo || "",
    cupom: produto?.cupom || "",
    avisoCupom: produto?.avisoCupom || "",
    tipoCupom: produto?.tipoCupom || produto?.cupomTipo || "",
    beneficioExtra: produto?.beneficioExtra || produto?.beneficioTexto || "",
    linkAfiliado: produto?.linkAfiliado || produto?.link || "",
    imagem: produto?.imagem || "",
    categoria: produto?.categoria || "",
    camposRetorno: Object.keys(produto || {})
  }));

  if (!produtoBase) {
    return { ok: false, marketplace: "shopee", motivo: "importador_sem_retorno", linkOriginal: urlOriginalEngine };
  }

  const linkAfiliado = produto.linkAfiliado || produto.linkFinal || produto.link || "";
  console.log("[SHOPEE-LINK-AFILIADO-GERADO]", JSON.stringify({
    jobId: job.id,
    eventoId: job.evento_id,
    clienteId,
    temLinkAfiliado: Boolean(linkAfiliado),
    urlExpandida: produto.linkExpandido || produto.linkOriginal || ""
  }));
  if (!linkAfiliado) {
    return { ok: false, marketplace: "shopee", motivo: "link_afiliado_vazio", linkOriginal: urlOriginalEngine };
  }

  if (linksAuxiliaresShopee.length || produto.avisoCupom || produto.beneficioTexto || produto.linksResgateShopee?.length) {
    console.log("[SHOPEE-OFERTA-RICA]", JSON.stringify({
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId,
      totalLinksAuxiliares: linksAuxiliaresShopee.length,
      temCupomAssociado: Boolean(produto.avisoCupom || produto.beneficioTexto),
      totalLinksResgate: Array.isArray(produto.linksResgateShopee) ? produto.linksResgateShopee.length : 0
    }));
  }

  const cupomTipo = produto.tipoCupom || produto.cupomTipo || "";
  const beneficioExtra = produto.beneficioExtra || produto.beneficioTexto || produto.avisoCupom || produto.avisoVariacaoPreco || "";
  const linksConvertidosShopee = await converterOcorrenciasShopee({
    links,
    evento,
    clienteId,
    integracao,
    deps,
    produtoPrincipal: produto,
    linkAfiliadoPrincipal: linkAfiliado,
    urlOriginalEngine,
    cacheImportacoesShopee
  });
  const linksComerciaisShopee = montarLinksComerciaisShopee({
    links: linksConvertidosShopee,
    evento,
    analiseLinksShopee,
    linkEscolhido,
    linkAfiliado,
    urlOriginalEngine
  });
  const ofertaAdapter = {
    ok: true,
    marketplace: "shopee",
    titulo: produto.titulo || produto.nome || "",
    preco: precoNumerico,
    precoOriginal: produto.precoOriginal || produto.precoAntigo || "",
    imagem: produto.imagem || "",
    imagemOrigem: produto.imagemOrigem || "",
    linkOriginal: urlOriginalEngine,
    linkExpandido: produto.linkExpandido || produto.linkOriginal || urlOriginalEngine,
    linkAfiliado,
    categoria: resolverCategoriaShopee(produto),
    cupom: produto.cupom || "",
    cupomTipo,
    tipoCupom: cupomTipo,
    avisoCupom: produto.avisoCupom || "",
    beneficioTexto: beneficioExtra,
    beneficioExtra,
    parcelamento: produto.parcelamento || produto.avisoVariacaoPreco || "",
    freteGratis: produto.freteGratis === true,
    cashback: produto.cashback || "",
    precoPix: produto.precoPix || "",
    descontoPix: produto.descontoPix || "",
    descontoApp: produto.descontoApp || "",
    valorEfetivo: produto.valorEfetivo ?? null,
    valorEfetivoOrigem: produto.valorEfetivoOrigem || "",
    precoMin: produto.precoMin || "",
    precoMax: produto.precoMax || "",
    precoOrigem: produto.precoOrigem || precoAuditoria.precoOrigem || precoAuditoria.origemPreco || "",
    precoRadarUsado: precoEscolhido.usouRadar === true,
    precoRadarTexto: precoEscolhido.precoRadarTexto || "",
    precoAmbiguo: produto.precoAmbiguo === true || precoAuditoria.precoAmbiguo === true,
    faixaPreco: produto.faixaPreco || precoAuditoria.faixaPreco || "",
    variacaoComprovada: produto.variacaoComprovada === true || precoAuditoria.variacaoComprovada === true,
    score: produto.score || null,
    shopId: idsProduto.shopId,
    itemId: idsProduto.itemId,
    produtoIdDetectado: idsProduto.shopId && idsProduto.itemId ? `${idsProduto.shopId}/${idsProduto.itemId}` : "",
    linksComerciais: linksComerciaisShopee,
    linksProduto: linksComerciaisShopee.filter(item => item.tipo === "produto"),
    linksResgate: linksComerciaisShopee.filter(item => item.tipo === "resgate")
  };

  const auditoriaV2 = auditarV2Shopee({ job, produto, ofertaAdapter });
  const ofertaEnriquecida = enriquecerComV2(ofertaAdapter, auditoriaV2, produto);

  logAuditoriaShopee({
    jobId: job.id,
    clienteId,
    urlOriginal: urlOriginalEngine,
    urlExpandida: ofertaAdapter.linkExpandido,
    shopId: idsProduto.shopId,
    itemId: idsProduto.itemId,
    tituloExtraido: ofertaAdapter.titulo,
    tituloValido: true,
    precoExtraido: precoNumerico,
    precoValido: true,
    imagem: ofertaAdapter.imagem,
    origemImagem: ofertaAdapter.imagemOrigem || "nenhuma",
    motivoFalha: ofertaAdapter.imagem ? "" : (produto.motivoFalha || "shopee_imagem_indisponivel"),
    statusFinal: auditoriaV2?.status || "pronto_para_v2"
  });

  return {
    ...ofertaEnriquecida,
    metadata: {
      adapter: "shopee",
      jobId: job.id,
      eventoId: job.evento_id,
      linkOriginalEngine: urlOriginalEngine,
      url_original: urlOriginalEngine,
      url_expandida: ofertaAdapter.linkExpandido,
      shopId: idsProduto.shopId,
      itemId: idsProduto.itemId,
      produtoId: ofertaAdapter.produtoIdDetectado,
      precoAuditoria: {
        ...precoAuditoria,
        precoAdapter: precoNumerico,
        precoTextoRadar: precoAuditoria.precoTextoRadar || precoEscolhido.precoRadarTexto,
        origemPreco: precoEscolhido.origem || precoAuditoria.origemPreco || precoAuditoria.precoOrigem || "",
        motivoEscolhaPreco: precoEscolhido.usouRadar ? "texto_radar_explicitamente_mais_confiavel" : precoAuditoria.motivoEscolhaPreco,
        suspeitaFator100
      },
      campoLinkEscolhido: linkEscolhido.campo || "",
      papelLinkEscolhido: linkEscolhido.papelLink || "",
      papelLinkMotivo: linkEscolhido.papelLinkMotivo || "",
      ambiguidadeLinksProduto: candidatosShopee.length > 1,
      totalCandidatosProduto: candidatosShopee.length,
      linksClassificados: resumoLinksClassificados(linksConvertidosShopee, evento, "shopee"),
      candidatosShopee: resumoCandidatosShopee(analiseLinksShopee.classificados),
      linksAuxiliaresShopee: resumoCandidatosShopee(linksAuxiliaresShopee),
      linksComerciais: linksComerciaisShopee,
      precoRadarUsado: precoEscolhido.usouRadar === true,
      precoRadarTexto: precoEscolhido.precoRadarTexto || "",
      textoRadarTemCupom: Boolean(extrairCupomTextoRadarShopee(textoOriginalRadar).cupom),
      camposProduto: Object.keys(produto || {}),
      produto,
      auditoriaInteligenciaUniversalV2: auditoriaV2 ? {
        fonteFinal: false,
        tipoAvaliacao: "auditoria_adapter_sem_memoria",
        ok: auditoriaV2.ok,
        status: auditoriaV2.status,
        motivo: auditoriaV2.motivo,
        categoria: auditoriaV2.categoria,
        score: auditoriaV2.score?.score ?? null,
        prioridade: auditoriaV2.prioridade,
        templateInput: auditoriaV2.templateInput
      } : null
    }
  };
}

module.exports = {
  importarShopeeEngine
};
