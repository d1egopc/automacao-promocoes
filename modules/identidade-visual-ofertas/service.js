"use strict";

const {
  criarRepositorioIdentidadeVisualOfertas,
  normalizarConfigIdentidadeVisual
} = require("./repository");
const storageIdentidadeVisual = require("./storage");
const rendererIdentidadeVisual = require("./renderer");
const {
  listarPaletaIdentidadeVisual
} = require("./paleta");
const {
  POLITICAS_IDENTIDADE_VISUAL_OFERTAS,
  resolverPoliticaIdentidadeVisualPlano
} = require("./politica");

const CONFIG_PADRAO_IDENTIDADE_VISUAL_OFERTAS = Object.freeze({
  ativo: true,
  logo: "optimus_oficial",
  frase: "AS MELHORES OFERTAS, EM UM SÓ LUGAR",
  corIdentidade: "azul"
});

const CAMPOS_CONFIG_EDITAVEIS = ["logo", "frase", "corIdentidade"];

const LAYOUT_IDENTIDADE_VISUAL_OFERTAS = Object.freeze({
  rendererVersion: rendererIdentidadeVisual.RENDERER_VERSION_IDENTIDADE_VISUAL,
  largura: rendererIdentidadeVisual.CANVAS,
  altura: rendererIdentidadeVisual.CANVAS,
  formato: "png",
  molde: "v1_fixo",
  areaProduto: {
    x: 0,
    y: 0,
    largura: rendererIdentidadeVisual.CANVAS,
    altura: rendererIdentidadeVisual.AREA_PRODUTO_ALTURA,
    fit: "contain"
  },
  faixaInferior: {
    x: 0,
    y: rendererIdentidadeVisual.AREA_PRODUTO_ALTURA + 10,
    largura: rendererIdentidadeVisual.CANVAS,
    altura: rendererIdentidadeVisual.FAIXA_ALTURA
  }
});

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function clonar(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function erroIdentidadeVisual(codigo, statusCode = 400) {
  const erro = new Error(codigo);
  erro.codigo = codigo;
  erro.statusCode = statusCode;
  return erro;
}

function logIdentidadeVisual(evento, dados = {}) {
  console.log(evento, {
    clienteId: dados.clienteId || "",
    ofertaId: dados.ofertaId || "",
    motivo: dados.motivo || "",
    cacheKey: dados.cacheKey ? String(dados.cacheKey).slice(0, 16) : "",
    rendererVersion: rendererIdentidadeVisual.RENDERER_VERSION_IDENTIDADE_VISUAL
  });
}

function resolverPlanoIdentidadeVisual(clienteId = "admin", deps = {}) {
  if (deps.plano && typeof deps.plano === "object") return deps.plano;
  if (typeof deps.getPlanoCliente === "function") return deps.getPlanoCliente(clienteId) || {};
  if (typeof deps.resolverPlanoCliente === "function") return deps.resolverPlanoCliente(clienteId) || {};
  if (typeof deps.resolverPlanoManualV2 === "function") return deps.resolverPlanoManualV2(clienteId) || {};
  return {};
}

function montarConfigEfetiva(configWorkspace = {}, politicaResolvida = {}) {
  const config = {
    ...CONFIG_PADRAO_IDENTIDADE_VISUAL_OFERTAS,
    ...normalizarConfigIdentidadeVisual(configWorkspace)
  };

  if (!politicaResolvida.habilitada) {
    return {
      ...config,
      ativo: false
    };
  }

  if (politicaResolvida.politica === POLITICAS_IDENTIDADE_VISUAL_OFERTAS.OBRIGATORIA) {
    return {
      ...CONFIG_PADRAO_IDENTIDADE_VISUAL_OFERTAS,
      ativo: true
    };
  }

  if (politicaResolvida.obrigatoria) {
    return {
      ...config,
      ativo: true
    };
  }

  return {
    ...config,
    ativo: config.ativo !== false
  };
}

function enriquecerRespostaConfig(clienteId = "admin", resposta = {}) {
  const configEfetiva = resposta.configEfetiva || {};
  return {
    ...resposta,
    configEfetiva: {
      ...configEfetiva,
      logoUrl: storageIdentidadeVisual.resolverLogoUrl(clienteId, configEfetiva.logo)
    },
    paleta: listarPaletaIdentidadeVisual(),
    layout: clonar(LAYOUT_IDENTIDADE_VISUAL_OFERTAS)
  };
}

function criarServicoIdentidadeVisualOfertas(deps = {}) {
  const repository = deps.repository || criarRepositorioIdentidadeVisualOfertas(deps);

  function resolverPolitica(clienteId = "admin", opcoes = {}) {
    const plano = resolverPlanoIdentidadeVisual(clienteId, { ...deps, ...opcoes });
    return resolverPoliticaIdentidadeVisualPlano(plano);
  }

  function resolverConfig(clienteId = "admin", opcoes = {}) {
    const politica = resolverPolitica(clienteId, opcoes);
    const configWorkspace = repository.lerConfig(clienteId);
    const configEfetiva = montarConfigEfetiva(configWorkspace, politica);

    return enriquecerRespostaConfig(clienteId, {
      politica: politica.politica,
      habilitada: politica.habilitada,
      obrigatoria: politica.obrigatoria,
      editavel: politica.editavel,
      podeDesligar: politica.podeDesligar,
      config: configWorkspace,
      configPadrao: clonar(CONFIG_PADRAO_IDENTIDADE_VISUAL_OFERTAS),
      configEfetiva
    });
  }

  function atualizarConfig(clienteId = "admin", patch = {}, opcoes = {}) {
    const politica = resolverPolitica(clienteId, opcoes);
    const alteracoes = normalizarConfigIdentidadeVisual(patch);
    const querAlterarAtivo = Object.prototype.hasOwnProperty.call(patch || {}, "ativo");
    const querEditarVisual = CAMPOS_CONFIG_EDITAVEIS.some(campo =>
      Object.prototype.hasOwnProperty.call(patch || {}, campo)
    );

    if (politica.politica === POLITICAS_IDENTIDADE_VISUAL_OFERTAS.DESABILITADA) {
      throw erroIdentidadeVisual("identidade_visual_ofertas_desabilitada", 403);
    }

    if (querEditarVisual && !politica.editavel) {
      throw erroIdentidadeVisual("identidade_visual_ofertas_edicao_bloqueada", 403);
    }

    if (querAlterarAtivo && alteracoes.ativo === false && !politica.podeDesligar) {
      throw erroIdentidadeVisual("identidade_visual_ofertas_nao_pode_desligar", 403);
    }

    if (politica.obrigatoria) {
      alteracoes.ativo = true;
    }

    repository.atualizarConfig(clienteId, alteracoes);
    return resolverConfig(clienteId, opcoes);
  }

  async function uploadLogo(clienteId = "admin", { buffer, mimeType = "" } = {}, opcoes = {}) {
    const politica = resolverPolitica(clienteId, opcoes);

    if (politica.politica === POLITICAS_IDENTIDADE_VISUAL_OFERTAS.DESABILITADA) {
      throw erroIdentidadeVisual("identidade_visual_ofertas_desabilitada", 403);
    }

    if (!politica.editavel) {
      throw erroIdentidadeVisual("identidade_visual_ofertas_edicao_bloqueada", 403);
    }

    const normalizada = await rendererIdentidadeVisual.normalizarLogoUpload(buffer, mimeType);
    const logo = storageIdentidadeVisual.salvarLogoCliente(clienteId, normalizada);
    repository.atualizarConfig(clienteId, { logo: logo.ref });
    logIdentidadeVisual("[IDENTIDADE-VISUAL-LOGO-UPLOAD]", {
      clienteId,
      motivo: "logo_salva",
      cacheKey: logo.hash
    });
    return {
      ...resolverConfig(clienteId, opcoes),
      logo: {
        ref: logo.ref,
        url: logo.url,
        hash: logo.hash.slice(0, 16)
      }
    };
  }

  async function aplicarIdentidadeVisualOferta({ clienteId = "admin", oferta = {}, imagemAtual = "", contexto = {} } = {}, opcoes = {}) {
    const imagemOriginal = texto(imagemAtual || oferta.imagem || oferta.imagemUrl || "");
    const resolucao = resolverConfig(clienteId, opcoes);

    if (!resolucao.habilitada) {
      return {
        aplicada: false,
        imagemOriginal,
        imagemFinal: imagemOriginal,
        motivo: "politica_desabilitada",
        politica: resolucao.politica,
        configEfetiva: resolucao.configEfetiva,
        contexto
      };
    }

    if (!resolucao.configEfetiva.ativo) {
      return {
        aplicada: false,
        imagemOriginal,
        imagemFinal: imagemOriginal,
        motivo: "config_inativa",
        politica: resolucao.politica,
        configEfetiva: resolucao.configEfetiva,
        contexto
      };
    }

    if (!imagemOriginal) {
      return {
        aplicada: false,
        imagemOriginal,
        imagemFinal: imagemOriginal,
        motivo: "imagem_ausente",
        politica: resolucao.politica,
        configEfetiva: resolucao.configEfetiva,
        contexto
      };
    }

    const ofertaId = oferta.id || oferta.oferta_id || oferta.uuid || "";
    const configHash = rendererIdentidadeVisual.configHashIdentidadeVisual(resolucao.configEfetiva);
    const cacheKey = rendererIdentidadeVisual.cacheKeyIdentidadeVisual({
      clienteId,
      imagemOriginal,
      configHash
    });
    const destino = storageIdentidadeVisual.caminhoRenderizado(clienteId, cacheKey);

    if (storageIdentidadeVisual.existeArquivo(destino.path)) {
      logIdentidadeVisual("[IDENTIDADE-VISUAL-CACHE]", { clienteId, ofertaId, cacheKey, motivo: "cache_hit" });
      return {
        aplicada: true,
        imagemOriginal,
        imagemFinal: destino.url,
        motivo: "cache_hit",
        politica: resolucao.politica,
        configEfetiva: resolucao.configEfetiva,
        metadata: {
          original: imagemOriginal,
          final: destino.url,
          configHash,
          rendererVersion: rendererIdentidadeVisual.RENDERER_VERSION_IDENTIDADE_VISUAL,
          cacheKey,
          cacheHit: true
        },
        contexto
      };
    }

    try {
      const imagemBuffer = typeof deps.baixarImagemBuffer === "function"
        ? await deps.baixarImagemBuffer(imagemOriginal, opcoes)
        : await rendererIdentidadeVisual.baixarImagemComoBuffer(imagemOriginal, {
            httpClient: opcoes.httpClient || deps.httpClient,
            timeoutMs: opcoes.timeoutMs
          });
      const logoBuffer = storageIdentidadeVisual.lerLogoBuffer(clienteId, resolucao.configEfetiva.logo);
      const render = await rendererIdentidadeVisual.renderizarIdentidadeVisualBuffer({
        imagemBuffer,
        logoBuffer,
        config: resolucao.configEfetiva
      });
      storageIdentidadeVisual.salvarBufferPublico(destino, render.buffer);
      logIdentidadeVisual("[IDENTIDADE-VISUAL-APLICADA]", { clienteId, ofertaId, cacheKey, motivo: "render_ok" });
      return {
        aplicada: true,
        imagemOriginal,
        imagemFinal: destino.url,
        motivo: "render_ok",
        politica: resolucao.politica,
        configEfetiva: resolucao.configEfetiva,
        metadata: {
          original: imagemOriginal,
          final: destino.url,
          configHash,
          rendererVersion: rendererIdentidadeVisual.RENDERER_VERSION_IDENTIDADE_VISUAL,
          cacheKey,
          cacheHit: false,
          aplicadoEm: new Date().toISOString(),
          ...render.metadata
        },
        contexto
      };
    } catch (erro) {
      logIdentidadeVisual("[IDENTIDADE-VISUAL-FALLBACK]", {
        clienteId,
        ofertaId,
        cacheKey,
        motivo: erro?.message || "render_fallback"
      });
      return {
        aplicada: false,
        imagemOriginal,
        imagemFinal: imagemOriginal,
        motivo: "render_fallback",
        politica: resolucao.politica,
        configEfetiva: resolucao.configEfetiva,
        metadata: {
          original: imagemOriginal,
          final: imagemOriginal,
          configHash,
          rendererVersion: rendererIdentidadeVisual.RENDERER_VERSION_IDENTIDADE_VISUAL,
          fallback: true,
          motivoFallback: erro?.message || "render_fallback"
        },
        contexto
      };
    }
  }

  return {
    resolverConfig,
    atualizarConfig,
    uploadLogo,
    aplicarIdentidadeVisualOferta
  };
}

const servicoPadrao = criarServicoIdentidadeVisualOfertas();

module.exports = {
  CONFIG_PADRAO_IDENTIDADE_VISUAL_OFERTAS,
  LAYOUT_IDENTIDADE_VISUAL_OFERTAS,
  criarServicoIdentidadeVisualOfertas,
  resolverConfigIdentidadeVisualOferta: servicoPadrao.resolverConfig,
  atualizarConfigIdentidadeVisualOferta: servicoPadrao.atualizarConfig,
  uploadLogoIdentidadeVisualOferta: servicoPadrao.uploadLogo,
  aplicarIdentidadeVisualOferta: servicoPadrao.aplicarIdentidadeVisualOferta
};
