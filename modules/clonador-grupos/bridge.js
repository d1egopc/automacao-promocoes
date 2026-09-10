"use strict";

const { detectarMarketplaceLink } = require("../engine/normalizers");
const { resolverRedirectUniversal } = require("../radar/redirect/redirect-resolver");
const { extrairComercialUniversal } = require("../radar/extrator-comercial-universal");
const { registrarEventoBruto } = require("../engine/inbox.service");

const CONFIANCAS_ACEITAS = new Set(["alta", "media"]);

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function listaLinks(links = []) {
  const vistos = new Set();
  const saida = [];
  for (const link of Array.isArray(links) ? links : []) {
    const valor = texto(link);
    if (!valor || vistos.has(valor)) continue;
    vistos.add(valor);
    saida.push(valor);
  }
  return saida;
}

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function confiavel(campo = {}) {
  return CONFIANCAS_ACEITAS.has(texto(campo.confianca).toLowerCase());
}

function limparEvidenciaComercial(valor = "") {
  return texto(valor)
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([:;,.])/g, "$1")
    .trim();
}

function textoSemAcentos(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function limparLinhaTituloClonador(linha = "") {
  return texto(linha)
    .replace(/[`*_~]/g, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function linhaPromocionalTituloClonador(linha = "") {
  const limpa = limparLinhaTituloClonador(linha);
  const normalizada = textoSemAcentos(limpa).toLowerCase();
  if (!normalizada) return true;
  if (/^https?:\/\//i.test(limpa)) return true;
  if (/\b(?:mercadolivre\.com|meli\.la|amzn\.to|s\.shopee\.com|shopee\.com|aliexpress\.com|kabum\.com)\b/i.test(limpa)) return true;
  if (/^(?:preco|precinho|promo|promocao|oferta|ofertao|corre|janela|imperdivel|baratinho|achadinho)\b/i.test(normalizada)) return true;
  if (/\b(?:nao vai durar|leva \d+|so hoje|ultimas unidades)\b/i.test(normalizada)) return true;
  if (/\bantes que acabe\b/i.test(normalizada)) return true;
  if (/^(?:compre|aproveite|garanta)\b/i.test(normalizada) && /\b(?:ja|agora|hoje|logo)\b/i.test(normalizada)) return true;
  if (/^(?:de|por|cupom|codigo|confira|aplique|resgate|use)\b/i.test(normalizada)) return true;
  if (/\b(?:r\$|off|desconto|cupom|pix|cashback|frete gratis|a partir de|acima de)\b/i.test(normalizada)) return true;
  return false;
}

function pontuarTituloClonador(linha = "") {
  const limpa = limparLinhaTituloClonador(linha);
  const palavras = limpa.split(/\s+/).filter(Boolean);
  if (palavras.length < 2 || limpa.length < 8) return 0;

  const normalizada = textoSemAcentos(limpa).toLowerCase();
  let pontos = Math.min(palavras.length, 8);
  if (/[a-z]/i.test(limpa) && /\b\d+\b/.test(limpa)) pontos += 1;
  if (/\b(?:kit|bermuda|tenis|perfume|camiseta|calca|short|jeans|social|brim|sarja|fone|headset|mouse|teclado|monitor|notebook|smartphone|celular|garrafa|panela|camera|controle|cadeira|mesa|mochila|relogio)\b/i.test(normalizada)) {
    pontos += 3;
  }
  if (linhaPromocionalTituloClonador(limpa)) pontos -= 20;
  return pontos;
}

function extrairTituloCapturadoClonador(textoOriginal = "", links = []) {
  const linksIgnorados = new Set(listaLinks(links));
  const candidatos = texto(textoOriginal)
    .split(/\r?\n/)
    .map(limparLinhaTituloClonador)
    .filter(Boolean)
    .filter(linha => !linksIgnorados.has(linha))
    .filter(linha => !linhaPromocionalTituloClonador(linha))
    .map(linha => ({ linha, pontos: pontuarTituloClonador(linha) }))
    .filter(candidato => candidato.pontos >= 3)
    .sort((a, b) => b.pontos - a.pontos || b.linha.length - a.linha.length);

  return candidatos[0]?.linha || "";
}

function textoComCondicaoComercial(valor = "") {
  return /\b(?:pix|a partir de|acima de|no app|boleto|cartao|frete|resgate|aplique|para chegar|valor final)\b/i.test(textoSemAcentos(valor));
}

function textoBeneficioComercial(comercial = {}) {
  const cupom = comercial.cupom || {};
  const textoCupom = confiavel(cupom) ? texto(cupom.texto) : "";
  const evidenciaCupom = confiavel(cupom) ? texto(cupom.evidencia) : "";
  const instrucaoCupom = confiavel(cupom) ? texto(cupom.instrucao) : "";
  const instrucaoCompleta = instrucaoCupom &&
    textoComCondicaoComercial(instrucaoCupom) &&
    instrucaoCupom.length > Math.max(textoCupom.length, evidenciaCupom.length)
    ? instrucaoCupom
    : "";
  const candidatos = [
    instrucaoCompleta,
    textoCupom,
    evidenciaCupom,
    /off|desconto|cupom/i.test(comercial.valorCupom?.evidencia || "") ? comercial.valorCupom.evidencia : "",
    confiavel(comercial.descontoPercentual) ? comercial.descontoPercentual.evidencia : "",
    ...(Array.isArray(comercial.condicoesEspeciais) ? comercial.condicoesEspeciais : [])
  ];
  return limparEvidenciaComercial(candidatos.find(Boolean) || "");
}

function montarComercialCapturado({ textoOriginal = "", links = [], marketplaceDetectado = "", extrairComercial = extrairComercialUniversal } = {}) {
  if (typeof extrairComercial !== "function") return null;
  const comercial = extrairComercial({ textoOriginal, links, marketplaceDetectado });
  const precoAtual = confiavel(comercial.precoAtual) ? numero(comercial.precoAtual.valor) : null;
  const precoAnterior = precoAtual !== null && confiavel(comercial.precoAntigo)
    ? numero(comercial.precoAntigo.valor)
    : null;
  const cupom = confiavel(comercial.cupom) ? texto(comercial.cupom.codigo) : "";
  const beneficio = textoBeneficioComercial(comercial);
  const tituloCapturado = extrairTituloCapturadoClonador(textoOriginal, links);

  const contrato = {
    versao: "clonador_comercial_capturado_v1",
    origem: "clonador_grupos",
    campos: {},
    evidencias: {},
    parser: {
      versao: comercial.versao || "",
      camposEncontrados: Array.isArray(comercial.camposEncontrados) ? comercial.camposEncontrados : []
    }
  };

  if (tituloCapturado) {
    contrato.tituloCapturado = tituloCapturado;
    contrato.campos.titulo = true;
    contrato.evidencias.titulo = tituloCapturado;
  }
  if (precoAtual !== null) {
    contrato.precoAtual = precoAtual;
    contrato.campos.precoAtual = true;
    contrato.evidencias.precoAtual = comercial.precoAtual?.evidencia || "";
  }
  if (precoAnterior !== null && (precoAtual === null || precoAnterior > precoAtual)) {
    contrato.precoAnterior = precoAnterior;
    contrato.campos.precoAnterior = true;
    contrato.evidencias.precoAnterior = comercial.precoAntigo?.evidencia || "";
  }
  if (cupom) {
    contrato.cupom = cupom;
    contrato.campos.cupom = true;
    contrato.evidencias.cupom = comercial.cupom?.evidencia || comercial.cupom?.texto || "";
  }
  if (beneficio) {
    contrato.beneficioTexto = beneficio;
    contrato.beneficioExtra = beneficio;
    contrato.campos.beneficio = true;
    contrato.evidencias.beneficio = beneficio;
  }

  return Object.keys(contrato.campos).length ? contrato : null;
}

async function resolverLinksClonador(links = [], resolver = resolverRedirectUniversal) {
  const linksOriginais = listaLinks(links);
  const preparados = [];
  const redirects = [];

  for (const linkOriginal of linksOriginais) {
    let resolucao = null;
    if (typeof resolver === "function") {
      try {
        resolucao = await resolver(linkOriginal);
      } catch (erro) {
        resolucao = {
          ok: false,
          urlOriginal: linkOriginal,
          status: "falhou",
          motivo: erro.message || "redirect_falhou"
        };
      }
    }

    const linkResolvido = resolucao?.ok
      ? texto(resolucao.urlExpandida || resolucao.urlFinal)
      : "";
    const linkFinal = linkResolvido || linkOriginal;
    preparados.push(linkFinal);
    redirects.push({
      linkOriginalCapturado: linkOriginal,
      linkResolvido,
      marketplaceDetectado: resolucao?.marketplaceDetectado || detectarMarketplaceLink(linkFinal),
      chaveCanonica: resolucao?.chaveCanonica || "",
      produtoIdCanonico: resolucao?.produtoIdCanonico || "",
      marketplaceCanonico: resolucao?.marketplaceCanonico || "",
      status: resolucao?.ok ? "resolvido" : (resolucao?.status || "falhou"),
      motivo: resolucao?.ok ? "" : (resolucao?.motivo || "redirect_falhou")
    });
  }

  return {
    linksOriginais,
    linksPreparados: listaLinks(preparados),
    redirects
  };
}

function marketplacePrincipal(links = [], redirects = []) {
  return redirects.map(item => texto(item.marketplaceDetectado)).find(Boolean) ||
    links.map(detectarMarketplaceLink).find(Boolean) ||
    "";
}

function criarBridgeClonadorGrupos(deps = {}) {
  const repo = deps.repository;
  if (!repo) throw new Error("repository_obrigatorio");
  const resolver = deps.resolverRedirectUniversal || resolverRedirectUniversal;
  const registrar = deps.registrarEventoBruto || registrarEventoBruto;
  const extrairComercial = deps.extrairComercialUniversal || extrairComercialUniversal;
  const logger = deps.logger || console;

  async function processarItem(item = {}) {
    const clienteId = texto(item.clienteId || item.cliente_id);
    const destinos = typeof repo.listarDestinos === "function"
      ? await repo.listarDestinos(clienteId)
      : [];
    const destinoIds = destinos.map(destino => texto(destino.destinoId || destino.destino_id)).filter(Boolean);
    const resolvidos = await resolverLinksClonador(item.links || [], resolver);
    const marketplaceDetectado = marketplacePrincipal(resolvidos.linksPreparados, resolvidos.redirects);
    const comercialCapturado = montarComercialCapturado({
      textoOriginal: item.textoOriginal,
      links: resolvidos.linksPreparados,
      marketplaceDetectado,
      extrairComercial
    });

    const metadata = {
      origemFluxo: "clonador_grupos",
      clonadorGrupos: {
        bufferId: texto(item.id),
        mensagemId: texto(item.mensagemId),
        sessaoId: texto(item.sessaoId),
        grupoJid: texto(item.grupoJid),
        grupoNome: texto(item.grupoNome),
        linksOriginais: resolvidos.linksOriginais,
        redirects: resolvidos.redirects,
        destinoIds
      },
      ...(comercialCapturado ? { comercialCapturado } : {})
    };

    const resultado = await registrar({
      origem: "clonador_grupos",
      origemFluxo: "clonador_grupos",
      fonte: "clonador_grupos",
      origemTipo: "whatsapp",
      sessaoId: item.sessaoId,
      grupoId: item.grupoJid,
      grupoNome: item.grupoNome,
      textoOriginal: item.textoOriginal,
      linksExtraidos: resolvidos.linksPreparados.length ? resolvidos.linksPreparados : resolvidos.linksOriginais,
      marketplaceDetectado,
      capturadoEm: item.capturadoEm,
      hashEvento: `clonador_grupos:${texto(item.id)}`,
      metadata
    }, {
      clientes: [clienteId],
      perf: {
        clienteId,
        origem: "clonador_grupos",
        origemTipo: "whatsapp",
        sessaoId: item.sessaoId,
        grupoId: item.grupoJid
      }
    });

    if (!resultado?.ok) {
      await repo.atualizarBufferStatus(item.id, "erro", {
        historicoResumo: {
          statusCodigo: "erro",
          motivoCodigo: texto(resultado?.motivo || "registrar_evento_falhou").toLowerCase().replace(/[^a-z0-9_:.-]/g, "_"),
          ultimoAtualizadoEm: new Date().toISOString()
        },
        clonadorHistorico: {
          versao: 1,
          tipo: "erro",
          motivoCodigo: texto(resultado?.motivo || "registrar_evento_falhou").toLowerCase().replace(/[^a-z0-9_:.-]/g, "_"),
          atualizadoEm: new Date().toISOString()
        },
        clonadorGruposBridge: {
          status: "erro",
          motivo: resultado?.motivo || "registrar_evento_falhou",
          erro: resultado?.erro || "",
          ...(resultado?.diagnostico ? { diagnostico: resultado.diagnostico } : {}),
          atualizadoEm: new Date().toISOString()
        }
      });
      return { ok: false, item, resultado, motivo: resultado?.motivo || "registrar_evento_falhou" };
    }

    const atualizado = await repo.atualizarBufferStatus(item.id, "pronta", {
      historicoResumo: {
        eventoId: resultado.id || null,
        marketplace: texto(marketplaceDetectado) || null,
        titulo: texto(comercialCapturado?.tituloCapturado, 180) || null,
        preco: comercialCapturado?.precoAtual ?? null,
        precoAnterior: comercialCapturado?.precoAnterior ?? null,
        cupomPresente: Boolean(texto(comercialCapturado?.cupom)),
        beneficioPresente: Boolean(texto(comercialCapturado?.beneficioTexto)),
        statusCodigo: resultado.duplicado === true ? "repetida" : "processando",
        motivoCodigo: resultado.duplicado === true ? "evento_duplicado" : "",
        ultimoAtualizadoEm: new Date().toISOString()
      },
      clonadorHistorico: {
        versao: 1,
        tipo: resultado.duplicado === true ? "repeticao" : "captura",
        marketplace: texto(marketplaceDetectado),
        motivoCodigo: resultado.duplicado === true ? "evento_duplicado" : "",
        repeticao: resultado.duplicado === true ? { quantidade: 1, motivoCodigo: "evento_duplicado", ultimoEm: new Date().toISOString() } : undefined,
        atualizadoEm: new Date().toISOString()
      },
      clonadorGruposBridge: {
        status: "pronta",
        eventoId: resultado.id || null,
        jobsCriados: Number(resultado.jobsCriados || 0),
        jobsExistentes: Number(resultado.jobsExistentes || 0),
        duplicado: resultado.duplicado === true,
        atualizadoEm: new Date().toISOString()
      }
    });

    if (typeof logger.log === "function") {
      logger.log("[CLONADOR-BRIDGE-ENGINE]", JSON.stringify({
        bufferId: item.id,
        clienteId,
        eventoId: resultado.id || null,
        jobsCriados: Number(resultado.jobsCriados || 0),
        jobsExistentes: Number(resultado.jobsExistentes || 0),
        marketplaceDetectado,
        destinoIds: destinoIds.length
      }));
    }

    return { ok: true, item: atualizado, resultado };
  }

  async function processarCapturasPendentes(opcoes = {}) {
    const limite = Math.max(1, Math.min(20, Number(opcoes.limite || 5)));
    const resumo = { ok: true, processadas: 0, prontas: 0, erros: 0, vazia: false };

    for (let i = 0; i < limite; i += 1) {
      const item = await repo.reivindicarProximaCaptura({ timeoutMinutos: opcoes.timeoutMinutos || 15 });
      if (!item) {
        resumo.vazia = resumo.processadas === 0;
        break;
      }

      resumo.processadas += 1;
      try {
        const resultado = await processarItem(item);
        if (resultado.ok) resumo.prontas += 1;
        else resumo.erros += 1;
      } catch (erro) {
        resumo.erros += 1;
        await repo.atualizarBufferStatus(item.id, "erro", {
          historicoResumo: { statusCodigo: "erro", motivoCodigo: "bridge_exception", ultimoAtualizadoEm: new Date().toISOString() },
          clonadorHistorico: {
            versao: 1,
            tipo: "erro",
            motivoCodigo: "bridge_exception",
            atualizadoEm: new Date().toISOString()
          },
          clonadorGruposBridge: {
            status: "erro",
            motivo: erro.message || "bridge_exception",
            atualizadoEm: new Date().toISOString()
          }
        });
        if (typeof logger.log === "function") {
          logger.log("[CLONADOR-BRIDGE-ERRO]", JSON.stringify({
            bufferId: item.id,
            clienteId: item.clienteId,
            motivo: erro.message || "bridge_exception"
          }));
        }
      }
    }

    return resumo;
  }

  return {
    processarCapturasPendentes,
    processarItem,
    resolverLinksClonador,
    montarComercialCapturado
  };
}

module.exports = {
  criarBridgeClonadorGrupos,
  montarComercialCapturado,
  resolverLinksClonador
};
