"use strict";

const sharp = require("sharp");
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
  molde: "v2_base_profissional",
  areaProduto: {
    x: 0,
    y: 0,
    largura: rendererIdentidadeVisual.CANVAS,
    altura: rendererIdentidadeVisual.AREA_PRODUTO_ALTURA,
    fit: "contain"
  },
  faixaInferior: {
    x: 0,
    y: rendererIdentidadeVisual.AREA_PRODUTO_ALTURA + rendererIdentidadeVisual.FILETE_ALTURA,
    largura: rendererIdentidadeVisual.CANVAS,
    altura: rendererIdentidadeVisual.FAIXA_ALTURA
  },
  logoSlot: rendererIdentidadeVisual.LOGO_SLOT,
  fraseSafeArea: rendererIdentidadeVisual.FRASE_SAFE_AREA
});

const PREVIEW_SAMPLE_PRODUTO_SVG = Buffer.from(`
  <svg width="840" height="760" viewBox="0 0 840 760" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="caixa" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#f8fafc"/>
        <stop offset="1" stop-color="#dbeafe"/>
      </linearGradient>
      <filter id="sombra" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="24" stdDeviation="22" flood-color="#0f172a" flood-opacity="0.18"/>
      </filter>
    </defs>
    <rect width="840" height="760" fill="#ffffff"/>
    <ellipse cx="420" cy="650" rx="250" ry="36" fill="#0f172a" opacity="0.10"/>
    <g filter="url(#sombra)">
      <rect x="220" y="120" width="400" height="430" rx="44" fill="url(#caixa)" stroke="#cbd5e1" stroke-width="8"/>
      <rect x="272" y="184" width="296" height="224" rx="30" fill="#ffffff" stroke="#93c5fd" stroke-width="7"/>
      <circle cx="420" cy="296" r="72" fill="#2563eb" opacity="0.92"/>
      <path d="M382 300l28 28 54-68" fill="none" stroke="#ffffff" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="286" y="448" width="268" height="36" rx="18" fill="#bfdbfe"/>
    </g>
  </svg>
`);

const PREVIEW_SAMPLE_SEM_IDENTIDADE_SVG = Buffer.from(`
  <svg width="1080" height="1080" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
    <rect width="1080" height="1080" fill="#ffffff"/>
    <rect x="250" y="230" width="580" height="520" rx="56" fill="#f8fafc" stroke="#cbd5e1" stroke-width="10"/>
    <circle cx="540" cy="450" r="96" fill="#e2e8f0"/>
    <rect x="356" y="614" width="368" height="46" rx="23" fill="#e2e8f0"/>
    <text x="540" y="860" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="800" fill="#64748b">IDENTIDADE VISUAL DESATIVADA</text>
  </svg>
`);

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

function normalizarPatchPreview(patch = {}) {
  const fonte = patch && typeof patch === "object" ? patch : {};
  const normalizada = normalizarConfigIdentidadeVisual(fonte);
  const saida = {};
  for (const campo of ["logo", "frase", "corIdentidade"]) {
    if (Object.prototype.hasOwnProperty.call(fonte, campo) && normalizada[campo] !== undefined) {
      saida[campo] = normalizada[campo];
    }
  }
  if (Object.prototype.hasOwnProperty.call(fonte, "ativo")) {
    saida.ativo = normalizada.ativo;
  }
  return saida;
}

async function samplePreviewProdutoBuffer() {
  return sharp(PREVIEW_SAMPLE_PRODUTO_SVG, { limitInputPixels: 4_000_000 }).png().toBuffer();
}

async function samplePreviewSemIdentidadeBuffer() {
  return sharp(PREVIEW_SAMPLE_SEM_IDENTIDADE_SVG, { limitInputPixels: 4_000_000 }).png().toBuffer();
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

  async function gerarPreview(clienteId = "admin", patch = {}, opcoes = {}) {
    const resolucao = resolverConfig(clienteId, opcoes);
    let configPreview = { ...resolucao.configEfetiva };

    if (resolucao.editavel) {
      configPreview = {
        ...configPreview,
        ...normalizarPatchPreview(patch)
      };
    }

    if (resolucao.obrigatoria) {
      configPreview.ativo = true;
    }

    if (!resolucao.podeDesligar) {
      configPreview.ativo = true;
    }

    if (!resolucao.habilitada || configPreview.ativo === false) {
      const buffer = typeof deps.samplePreviewSemIdentidadeBuffer === "function"
        ? await deps.samplePreviewSemIdentidadeBuffer()
        : await samplePreviewSemIdentidadeBuffer();
      return {
        ...resolucao,
        configEfetiva: {
          ...configPreview,
          logoUrl: storageIdentidadeVisual.resolverLogoUrl(clienteId, configPreview.logo)
        },
        aplicada: false,
        motivo: !resolucao.habilitada ? "politica_desabilitada" : "config_inativa",
        preview: {
          mimeType: "image/png",
          dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
          rendererVersion: rendererIdentidadeVisual.RENDERER_VERSION_IDENTIDADE_VISUAL,
          persistida: false
        }
      };
    }

    const imagemBuffer = typeof deps.samplePreviewProdutoBuffer === "function"
      ? await deps.samplePreviewProdutoBuffer()
      : await samplePreviewProdutoBuffer();
    const logoBuffer = storageIdentidadeVisual.lerLogoBuffer(clienteId, configPreview.logo);
    const render = await rendererIdentidadeVisual.renderizarIdentidadeVisualBuffer({
      imagemBuffer,
      logoBuffer,
      config: configPreview
    });

    return {
      ...resolucao,
      configEfetiva: {
        ...configPreview,
        logoUrl: storageIdentidadeVisual.resolverLogoUrl(clienteId, configPreview.logo)
      },
      aplicada: true,
      motivo: "preview_render_ok",
      preview: {
        mimeType: "image/png",
        dataUrl: `data:image/png;base64,${render.buffer.toString("base64")}`,
        rendererVersion: rendererIdentidadeVisual.RENDERER_VERSION_IDENTIDADE_VISUAL,
        persistida: false,
        metadata: render.metadata
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
    gerarPreview,
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
  gerarPreviewIdentidadeVisualOferta: servicoPadrao.gerarPreview,
  aplicarIdentidadeVisualOferta: servicoPadrao.aplicarIdentidadeVisualOferta
};
