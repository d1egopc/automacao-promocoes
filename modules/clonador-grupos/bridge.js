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

function textoBeneficioComercial(comercial = {}) {
  const cupom = comercial.cupom || {};
  const candidatos = [
    confiavel(cupom) ? cupom.texto : "",
    confiavel(cupom) ? cupom.evidencia : "",
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
        clonadorGruposBridge: {
          status: "erro",
          motivo: resultado?.motivo || "registrar_evento_falhou",
          erro: resultado?.erro || "",
          atualizadoEm: new Date().toISOString()
        }
      });
      return { ok: false, item, resultado, motivo: resultado?.motivo || "registrar_evento_falhou" };
    }

    const atualizado = await repo.atualizarBufferStatus(item.id, "pronta", {
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
