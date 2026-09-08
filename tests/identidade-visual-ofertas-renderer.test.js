"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-identidade-render-"));
process.env.IDENTIDADE_VISUAL_PUBLIC_BASE_URL = "https://go.test";

const identidadeVisual = require("../modules/identidade-visual-ofertas");
const storage = identidadeVisual.storageIdentidadeVisualOfertas;

const AMOSTRAS_DIR = path.join(process.env.DATA_DIR, "identidade-visual-amostras");

function criarRepoMemoria(configInicial = {}) {
  const store = { ...configInicial };
  return {
    lerConfig: (clienteId) => ({ ...(store[clienteId] || {}) }),
    salvarConfig: (clienteId, config) => {
      store[clienteId] = { ...config };
      return { ...store[clienteId] };
    },
    atualizarConfig: (clienteId, patch) => {
      store[clienteId] = { ...(store[clienteId] || {}), ...patch };
      return { ...store[clienteId] };
    },
    store
  };
}

function svgProduto({ width, height, fill, label }) {
  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="transparent"/>
      <rect x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.08)}" width="${Math.round(width * 0.84)}" height="${Math.round(height * 0.84)}" rx="28" fill="${fill}"/>
      <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="${Math.max(30, Math.round(width / 10))}" font-weight="700" fill="#fff">${label}</text>
    </svg>
  `);
}

async function bufferPng({ width, height, fill, label }) {
  return sharp(svgProduto({ width, height, fill, label })).png().toBuffer();
}

async function bufferJpeg({ width, height, fill, label }) {
  return sharp(svgProduto({ width, height, fill, label })).jpeg({ quality: 92 }).toBuffer();
}

async function salvarAmostra(nome, produtoBuffer, config) {
  const logoBuffer = storage.lerLogoBuffer("workspace_amostras", "optimus_oficial");
  const render = await identidadeVisual.renderizarIdentidadeVisualBuffer({
    imagemBuffer: produtoBuffer,
    logoBuffer,
    config
  });
  fs.mkdirSync(AMOSTRAS_DIR, { recursive: true });
  const destino = path.join(AMOSTRAS_DIR, nome);
  fs.writeFileSync(destino, render.buffer);
  const meta = await sharp(destino).metadata();
  assert.strictEqual(meta.width, 1080, `${nome} deve ter largura 1080`);
  assert.strictEqual(meta.height, 1080, `${nome} deve ter altura 1080`);
  return destino;
}

async function pixel(pathImagem, x, y) {
  const { data } = await sharp(pathImagem)
    .extract({ left: x, top: y, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Array.from(data);
}

async function main() {
  try {
    assert.ok(fs.existsSync(storage.LOGO_OFICIAL_PATH), "logo oficial precisa existir em assets/identidade-visual");
    assert.ok(
      storage.LOGO_OFICIAL_PATH.includes(path.join("assets", "identidade-visual", "optimus-oficial.png")),
      "logo oficial deve continuar no caminho versionado assets/identidade-visual"
    );
    assert.ok(
      storage.lerLogoBuffer("admin", "optimus_oficial").length > 0,
      "lerLogoBuffer deve carregar o asset oficial"
    );
    assert.strictEqual(
      identidadeVisual.normalizarConfigIdentidadeVisual({ logo: "https://externo/logo.png" }).logo,
      undefined,
      "config nao deve persistir URL externa arbitraria como logo"
    );
    assert.strictEqual(
      identidadeVisual.normalizarConfigIdentidadeVisual({ logo: "../logo.png" }).logo,
      undefined,
      "config nao deve persistir path traversal como logo"
    );
    assert.strictEqual(
      identidadeVisual.normalizarConfigIdentidadeVisual({ corFaixa: "#111827" }).corIdentidade,
      "preto",
      "config legada corFaixa deve migrar para paleta fechada"
    );

    const produto = await bufferPng({ width: 720, height: 720, fill: "#2563eb", label: "NORMAL" });
    const renderPadrao = await identidadeVisual.renderizarIdentidadeVisualBuffer({
      imagemBuffer: produto,
      logoBuffer: storage.lerLogoBuffer("workspace_amostras", "optimus_oficial"),
      config: { frase: "AS MELHORES OFERTAS, EM UM SÓ LUGAR", corIdentidade: "azul" }
    });
    assert.strictEqual(renderPadrao.metadata.rendererVersion, "identidade-visual-ofertas-v2.2");
    assert.strictEqual(renderPadrao.metadata.width, 1080, "renderer V2 deve manter largura 1080");
    assert.strictEqual(renderPadrao.metadata.height, 1080, "renderer V2 deve manter altura 1080");
    assert.deepStrictEqual(
      renderPadrao.metadata.fraseLayout.linhas,
      ["AS MELHORES OFERTAS,", "EM UM SÓ LUGAR"],
      "frase default deve aparecer na composicao em ate 2 linhas"
    );
    assert.ok(renderPadrao.metadata.fraseLayout.fontSize >= identidadeVisual.FRASE_SAFE_AREA.minFontSize);
    assert.ok(renderPadrao.metadata.fraseLayout.linhas.length <= 2, "frase default deve caber em ate 2 linhas");
    assert.strictEqual(identidadeVisual.FAIXA_ALTURA, 208, "faixa V2.2 deve preservar a altura aprovada");
    assert.strictEqual(identidadeVisual.FILETE_ALTURA, 10, "filete superior deve preservar a altura aprovada");
    assert.strictEqual(identidadeVisual.AREA_PRODUTO_ALTURA, 862, "inicio da faixa deve permanecer congelado");
    assert.strictEqual(identidadeVisual.AREA_COMPOSICAO_IMAGEM_ALTURA, 976, "imagem deve centralizar na area ampliada V2.2");
    assert.deepStrictEqual(
      renderPadrao.metadata.productContainBox,
      { width: 1000, height: 960 },
      "produto deve preservar contain no box V2.2 aprovado"
    );
    assert.strictEqual(renderPadrao.metadata.productRenderedX, 40, "produto deve manter centralizacao horizontal");
    assert.strictEqual(renderPadrao.metadata.productRenderedY, 8, "produto deve manter centralizacao vertical na area ampliada");
    assert.strictEqual(renderPadrao.metadata.productBehindBannerHeight, 96, "imagem deve manter zona sacrificavel de 96px atras da faixa");
    assert.deepStrictEqual(
      renderPadrao.metadata.logoSlot,
      { width: 248, height: 147, left: 56, top: 902 },
      "logo oficial deve usar o slot V2.2 aprovado"
    );

    const renderFraseLonga = await identidadeVisual.renderizarIdentidadeVisualBuffer({
      imagemBuffer: produto,
      logoBuffer: storage.lerLogoBuffer("workspace_amostras", "optimus_oficial"),
      config: {
        frase: "Uma frase promocional grande o suficiente para validar quebra segura no preview real",
        corIdentidade: "preto"
      }
    });
    const layoutLongo = renderFraseLonga.metadata.fraseLayout;
    const limiteInferior = layoutLongo.safeArea.top + layoutLongo.safeArea.height;
    assert.ok(layoutLongo.linhas.length <= 2, "frase longa deve caber em ate 2 linhas");
    assert.ok(
      layoutLongo.baselineY + (layoutLongo.linhas.length - 1) * layoutLongo.lineHeight <= limiteInferior,
      "nenhuma linha deve sair da safe area vertical"
    );
    assert.ok(
      layoutLongo.x >= layoutLongo.safeArea.left &&
        layoutLongo.x + layoutLongo.safeArea.width <= identidadeVisual.CANVAS,
      "frase deve respeitar safe area horizontal"
    );

    const fonteRenderer = fs.readFileSync(path.join(__dirname, "..", "modules", "identidade-visual-ofertas", "renderer.js"), "utf8");
    assert.ok(fonteRenderer.includes('fit: "contain"'), "produto e logo devem continuar usando contain");
    assert.ok(!fonteRenderer.includes('fit: "fill"'), "renderer nao deve distorcer produto/logo com fill");
    assert.ok(fonteRenderer.includes("DejaVuSans-Bold.ttf"), "renderer deve apontar fonte deterministica do container");
    assert.ok(!fonteRenderer.includes("rgba("), "SVG do renderer nao deve depender de rgba em atributos de texto");
    assert.ok(!fonteRenderer.includes('opacity="0.065"'), "logo deve ficar limpa, sem painel translucido");
    assert.ok(!fonteRenderer.includes('x="42"'), "renderer nao deve manter a caixa antiga atras da logo");

    const dockerfile = fs.readFileSync(path.join(__dirname, "..", "Dockerfile"), "utf8");
    assert.ok(dockerfile.includes("fontconfig"), "container deve instalar fontconfig");
    assert.ok(dockerfile.includes("fonts-dejavu-core"), "container deve instalar fonte DejaVu versionada pela imagem");

    let downloads = 0;
    const repo = criarRepoMemoria({
      workspace_render: {
        ativo: true,
        frase: "Oferta boa demais para passar",
        corIdentidade: "vermelho"
      }
    });
    const service = identidadeVisual.criarServicoIdentidadeVisualOfertas({
      repository: repo,
      baixarImagemBuffer: async () => {
        downloads += 1;
        return produto;
      }
    });

    const opcoesPlano = { plano: { recursos: { identidade_visual_ofertas: "obrigatoria_editavel" } } };
    const primeira = await service.aplicarIdentidadeVisualOferta({
      clienteId: "workspace_render",
      oferta: { id: "oferta_1", origem: "radar" },
      imagemAtual: "https://img.test/produto.png",
      contexto: { origem: "radar" }
    }, opcoesPlano);
    assert.strictEqual(primeira.aplicada, true);
    assert.strictEqual(primeira.motivo, "render_ok");
    assert.ok(primeira.imagemFinal.includes("/identidade-visual-ofertas/public/clientes/workspace_render/renderizados/"));
    assert.ok(fs.existsSync(storage.caminhoRenderizado("workspace_render", primeira.metadata.cacheKey).path));

    const segunda = await service.aplicarIdentidadeVisualOferta({
      clienteId: "workspace_render",
      oferta: { id: "oferta_1", origem: "clonador_grupos" },
      imagemAtual: "https://img.test/produto.png",
      contexto: { origem: "clonador_grupos" }
    }, opcoesPlano);
    assert.strictEqual(segunda.aplicada, true);
    assert.strictEqual(segunda.motivo, "cache_hit");
    assert.strictEqual(downloads, 1, "cache deve evitar novo download/render");

    const fallback = await identidadeVisual.criarServicoIdentidadeVisualOfertas({
      repository: criarRepoMemoria({ workspace_fallback: { ativo: true } }),
      baixarImagemBuffer: async () => {
        throw new Error("download_indisponivel");
      }
    }).aplicarIdentidadeVisualOferta({
      clienteId: "workspace_fallback",
      oferta: { id: "oferta_fallback" },
      imagemAtual: "https://img.test/falha.png"
    }, { plano: { recursos: { identidade_visual_ofertas: "obrigatoria" } } });
    assert.strictEqual(fallback.aplicada, false);
    assert.strictEqual(fallback.imagemFinal, "https://img.test/falha.png");
    assert.strictEqual(fallback.metadata.fallback, true);

    const pngTransparente = await sharp({
      create: { width: 240, height: 240, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).png().toBuffer();
    const logoUpload = await identidadeVisual.normalizarLogoUpload(pngTransparente, "image/png");
    const logoSalvo = storage.salvarLogoCliente("workspace_logo", logoUpload);
    assert.ok(/^cliente:[a-f0-9]{64}$/.test(logoSalvo.ref), "upload deve virar ref interna por hash");

    const serviceUpload = identidadeVisual.criarServicoIdentidadeVisualOfertas({
      repository: criarRepoMemoria()
    });
    const uploadResposta = await serviceUpload.uploadLogo("workspace_upload", {
      buffer: pngTransparente,
      mimeType: "image/png"
    }, { plano: { recursos: { identidade_visual_ofertas: "opcional_editavel" } } });
    assert.ok(/^cliente:[a-f0-9]{64}$/.test(uploadResposta.logo.ref), "upload pelo servico deve retornar ref interna");
    assert.strictEqual(uploadResposta.configEfetiva.logo, uploadResposta.logo.ref);
    await assert.rejects(
      () => serviceUpload.uploadLogo("workspace_upload", {
        buffer: pngTransparente,
        mimeType: "image/png"
      }, { plano: { recursos: { identidade_visual_ofertas: "obrigatoria" } } }),
      /identidade_visual_ofertas_edicao_bloqueada/,
      "plano nao editavel nao pode trocar logo"
    );

    await assert.rejects(
      () => identidadeVisual.normalizarLogoUpload(Buffer.from("x"), "text/plain"),
      /identidade_visual_logo_tipo_invalido/,
      "upload deve rejeitar MIME invalido"
    );

    const amostras = [];
    amostras.push(await salvarAmostra(
      "identidade-normal.png",
      produto,
      { frase: "AS MELHORES OFERTAS, EM UM SO LUGAR", corIdentidade: "azul" }
    ));
    amostras.push(await salvarAmostra(
      "identidade-vertical.png",
      await bufferPng({ width: 420, height: 900, fill: "#16a34a", label: "VERT" }),
      { frase: "Curadoria com desconto real", corIdentidade: "verde" }
    ));
    amostras.push(await salvarAmostra(
      "identidade-horizontal.png",
      await bufferJpeg({ width: 1100, height: 420, fill: "#db2777", label: "WIDE" }),
      { frase: "Aproveite as ofertas selecionadas", corIdentidade: "rosa" }
    ));
    amostras.push(await salvarAmostra(
      "identidade-caixa.png",
      await bufferPng({ width: 650, height: 520, fill: "#f97316", label: "CAIXA" }),
      { frase: "AS MELHORES OFERTAS, EM UM SO LUGAR", corIdentidade: "laranja" }
    ));

    const pixelFaixa = await pixel(amostras[0], 900, 1000);
    assert.ok(pixelFaixa[2] > pixelFaixa[0], "faixa azul deve aparecer na area inferior");

    for (const cor of ["preto", "azul", "vermelho", "rosa", "laranja", "verde"]) {
      const render = await identidadeVisual.renderizarIdentidadeVisualBuffer({
        imagemBuffer: await bufferPng({ width: 80, height: 80, fill: "#334155", label: "P" }),
        logoBuffer: storage.lerLogoBuffer("workspace_amostras", "optimus_oficial"),
        config: { frase: "Frase com limite de linha para validacao visual do renderer", corIdentidade: cor }
      });
      assert.strictEqual(render.metadata.width, 1080);
      assert.strictEqual(render.metadata.height, 1080);
      assert.strictEqual(render.metadata.corIdentidade, cor);
    }

    console.log("Amostras geradas:");
    for (const amostra of amostras) console.log(amostra);
    console.log("identidade-visual-ofertas-renderer.test.js OK");
  } finally {
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((erro) => {
  console.error(erro);
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
