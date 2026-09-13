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

function svgProdutoComRodape({ width, height, fill, label }) {
  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="transparent"/>
      <rect x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.08)}" width="${Math.round(width * 0.84)}" height="${Math.round(height * 0.84)}" rx="28" fill="${fill}"/>
      <rect x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.91)}" width="${Math.round(width * 0.76)}" height="${Math.round(height * 0.07)}" rx="12" fill="#dc2626"/>
      <text x="50%" y="94.5%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="${Math.max(24, Math.round(width / 16))}" font-weight="700" fill="#fff">LOGO GRUPO</text>
      <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="${Math.max(30, Math.round(width / 10))}" font-weight="700" fill="#fff">${label}</text>
    </svg>
  `);
}

async function bufferPng({ width, height, fill, label }) {
  return sharp(svgProduto({ width, height, fill, label })).png().toBuffer();
}

async function bufferPngComRodape({ width, height, fill, label }) {
  return sharp(svgProdutoComRodape({ width, height, fill, label })).png().toBuffer();
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

async function validarPng1080(buffer, contexto = "") {
  const meta = await sharp(buffer).metadata();
  assert.strictEqual(meta.format, "png", `${contexto} deve sair em PNG`);
  assert.strictEqual(meta.width, 1080, `${contexto} deve ter largura 1080`);
  assert.strictEqual(meta.height, 1080, `${contexto} deve ter altura 1080`);
  return meta;
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
    assert.strictEqual(renderPadrao.metadata.rendererVersion, "identidade-visual-ofertas-v2.4");
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
    assert.strictEqual(renderPadrao.metadata.composicao, "composicao_normal", "imagem quadrada deve manter composicao normal");
    assert.strictEqual(renderPadrao.metadata.cropMargemBranca, false, "imagem sem margem branca relevante nao deve sofrer crop");
    assert.deepStrictEqual(
      renderPadrao.metadata.logoSlot,
      { width: 248, height: 147, left: 56, top: 902 },
      "logo oficial deve usar o slot V2.2 aprovado"
    );
    assert.strictEqual(renderPadrao.metadata.mascaraNeutraRodape, undefined, "Render ON nao deve receber mascara neutra OFF");

    const renderNeutroQuadrado = await identidadeVisual.renderizarImagemGlobalNeutraBuffer({ imagemBuffer: produto });
    await validarPng1080(renderNeutroQuadrado.buffer, "imagem neutra quadrada");
    assert.strictEqual(renderNeutroQuadrado.metadata.padraoGlobalImagem, true, "neutro marca padrao global");
    assert.strictEqual(renderNeutroQuadrado.metadata.brandingAplicado, false, "neutro nao aplica branding");
    assert.strictEqual(renderNeutroQuadrado.metadata.faixaAplicada, false, "neutro nao aplica faixa");
    assert.strictEqual(renderNeutroQuadrado.metadata.logoAplicado, false, "neutro nao aplica logo");
    assert.strictEqual(renderNeutroQuadrado.metadata.width, 1080);
    assert.strictEqual(renderNeutroQuadrado.metadata.height, 1080);
    assert.deepStrictEqual(
      renderNeutroQuadrado.metadata.productContainBox,
      renderPadrao.metadata.productContainBox,
      "neutro reutiliza o mesmo contain/enquadramento do render identidade"
    );
    const baseYEsperado = identidadeVisual.AREA_PRODUTO_ALTURA + identidadeVisual.FILETE_ALTURA;
    const alturaMascaraNormal = 96;
    const topMascaraOffEsperado = identidadeVisual.CANVAS - alturaMascaraNormal;
    const deslocamentoOffEsperado = identidadeVisual.CANVAS - (baseYEsperado + alturaMascaraNormal);
    assert.strictEqual(renderNeutroQuadrado.metadata.mascaraNeutraRodape.aplicada, true, "neutro aplica mascara apenas quando ha zona sacrificavel");
    assert.strictEqual(renderNeutroQuadrado.metadata.mascaraNeutraRodape.referencia, "faixa_render_on");
    assert.strictEqual(renderNeutroQuadrado.metadata.mascaraNeutraRodape.top, topMascaraOffEsperado, "mascara OFF reduz rodape morto e termina no fim do canvas");
    assert.strictEqual(renderNeutroQuadrado.metadata.mascaraNeutraRodape.height, alturaMascaraNormal, "caso normal mascara a mesma zona sacrificavel do Render ON");
    assert.strictEqual(renderNeutroQuadrado.metadata.productShiftYOff, deslocamentoOffEsperado, "OFF reposiciona verticalmente sem aumentar a mascara anti-logo");
    assert.strictEqual(
      renderNeutroQuadrado.metadata.productRenderedYOff,
      renderPadrao.metadata.productRenderedY + deslocamentoOffEsperado,
      "OFF move a composicao para baixo sem alterar a geometria congelada do Render ON"
    );
    assert.strictEqual(
      identidadeVisual.CANVAS - renderNeutroQuadrado.metadata.mascaraNeutraRodape.top,
      alturaMascaraNormal,
      "rodape branco final fica limitado a altura util da mascara"
    );
    assert.ok(
      renderNeutroQuadrado.metadata.mascaraNeutraRodape.maxHeight <= Math.round(identidadeVisual.FAIXA_ALTURA * 0.5),
      "mascara nao pode usar a faixa inteira"
    );
    const caminhoNeutroQuadrado = path.join(AMOSTRAS_DIR, "global-neutro-quadrado.png");
    fs.mkdirSync(AMOSTRAS_DIR, { recursive: true });
    fs.writeFileSync(caminhoNeutroQuadrado, renderNeutroQuadrado.buffer);
    const pixelAntesMascaraNeutro = await pixel(caminhoNeutroQuadrado, 540, topMascaraOffEsperado - 22);
    assert.ok(
      pixelAntesMascaraNeutro[0] < 248 || pixelAntesMascaraNeutro[1] < 248 || pixelAntesMascaraNeutro[2] < 248,
      "neutro preserva produto acima da zona sacrificavel"
    );
    const pixelInicioMascaraNeutro = await pixel(caminhoNeutroQuadrado, 540, topMascaraOffEsperado + 8);
    assert.ok(
      pixelInicioMascaraNeutro[0] >= 248 && pixelInicioMascaraNeutro[1] >= 248 && pixelInicioMascaraNeutro[2] >= 248,
      "neutro mascara em branco apenas a zona inferior permitida"
    );
    const pixelInferiorNeutro = await pixel(caminhoNeutroQuadrado, 900, 1000);
    assert.ok(
      pixelInferiorNeutro[0] >= 248 && pixelInferiorNeutro[1] >= 248 && pixelInferiorNeutro[2] >= 248,
      "neutro preserva fundo branco/sem faixa inferior"
    );

    for (const casoNeutro of [
      { nome: "vertical", buffer: await bufferPng({ width: 420, height: 900, fill: "#16a34a", label: "VERT" }) },
      { nome: "horizontal", buffer: await bufferJpeg({ width: 1100, height: 420, fill: "#db2777", label: "WIDE" }) },
      { nome: "pequena", buffer: await bufferPng({ width: 80, height: 80, fill: "#334155", label: "P" }) },
      { nome: "grande", buffer: await bufferJpeg({ width: 1800, height: 1600, fill: "#0f766e", label: "BIG" }) },
      { nome: "oficial_limpa", buffer: await bufferPng({ width: 720, height: 720, fill: "#2563eb", label: "OK" }) },
      { nome: "radar_fallback", buffer: await bufferJpeg({ width: 904, height: 503, fill: "#1f2937", label: "RADAR" }) }
    ]) {
      const renderNeutro = await identidadeVisual.renderizarImagemGlobalNeutraBuffer({ imagemBuffer: casoNeutro.buffer });
      await validarPng1080(renderNeutro.buffer, `imagem neutra ${casoNeutro.nome}`);
      assert.strictEqual(renderNeutro.metadata.padraoGlobalImagem, true, `${casoNeutro.nome} passa pelo padrao global`);
      assert.strictEqual(renderNeutro.metadata.brandingAplicado, false, `${casoNeutro.nome} nao recebe branding`);
      assert.ok(renderNeutro.metadata.productRenderedWidth > 0, `${casoNeutro.nome} tem produto renderizado`);
      assert.ok(renderNeutro.metadata.productRenderedHeight > 0, `${casoNeutro.nome} tem produto renderizado`);
      assert.ok(renderNeutro.metadata.mascaraNeutraRodape.height <= Math.round(identidadeVisual.FAIXA_ALTURA * 0.5), `${casoNeutro.nome} respeita teto conservador da mascara`);
      if (renderNeutro.metadata.mascaraNeutraRodape.aplicada) {
        assert.strictEqual(
          identidadeVisual.CANVAS - renderNeutro.metadata.mascaraNeutraRodape.top,
          renderNeutro.metadata.mascaraNeutraRodape.height,
          `${casoNeutro.nome} reduz rodape morto para a propria altura da mascara`
        );
      }
      if (casoNeutro.nome === "vertical") {
        assert.ok(renderNeutro.metadata.productShiftYOff > 0, "vertical alto e reposicionado no OFF sem cortar mais produto");
      }
      if (casoNeutro.nome === "horizontal") {
        assert.strictEqual(renderNeutro.metadata.mascaraNeutraRodape.aplicada, false, "horizontal sem invasao da faixa nao deve receber mascara");
        assert.strictEqual(renderNeutro.metadata.mascaraNeutraRodape.height, 0, "horizontal sem zona sacrificavel nao mascara rodape");
      }
    }

    const renderRodape = await identidadeVisual.renderizarImagemGlobalNeutraBuffer({
      imagemBuffer: await bufferPngComRodape({ width: 720, height: 720, fill: "#2563eb", label: "RADAR/CLONE" })
    });
    const caminhoRodape = path.join(AMOSTRAS_DIR, "global-neutro-rodape-logo.png");
    fs.writeFileSync(caminhoRodape, renderRodape.buffer);
    assert.strictEqual(renderRodape.metadata.mascaraNeutraRodape.aplicada, true, "rodape de fallback passa pela mascara conservadora");
    assert.strictEqual(renderRodape.metadata.mascaraNeutraRodape.height, alturaMascaraNormal, "rodape usa apenas a zona sacrificavel normal");
    assert.strictEqual(renderRodape.metadata.mascaraNeutraRodape.top, topMascaraOffEsperado, "mascara de rodape termina no fim do canvas OFF");
    const pixelRodapeMascarado = await pixel(caminhoRodape, 540, topMascaraOffEsperado + 50);
    assert.ok(
      pixelRodapeMascarado[0] >= 248 && pixelRodapeMascarado[1] >= 248 && pixelRodapeMascarado[2] >= 248,
      "logo/faixa de rodape dentro da zona sacrificavel fica escondida por fundo neutro"
    );
    const pixelRodapeProduto = await pixel(caminhoRodape, 540, topMascaraOffEsperado - 40);
    assert.ok(
      pixelRodapeProduto[0] < 248 || pixelRodapeProduto[1] < 248 || pixelRodapeProduto[2] < 248,
      "conteudo acima da zona sacrificavel continua visivel"
    );

    const produtoComMargemBranca = await sharp({
      create: { width: 800, height: 780, channels: 3, background: "#ffffff" }
    })
      .composite([{ input: await bufferPng({ width: 680, height: 660, fill: "#2563eb", label: "SEM MARGEM" }), left: 60, top: 60 }])
      .jpeg({ quality: 92 })
      .toBuffer();
    const renderMargemBranca = await identidadeVisual.renderizarIdentidadeVisualBuffer({
      imagemBuffer: produtoComMargemBranca,
      logoBuffer: storage.lerLogoBuffer("workspace_amostras", "optimus_oficial"),
      config: { frase: "AS MELHORES OFERTAS, EM UM SO LUGAR", corIdentidade: "azul" }
    });
    assert.strictEqual(renderMargemBranca.metadata.composicao, "crop_margem_branca");
    assert.strictEqual(renderMargemBranca.metadata.cropMargemBranca, true);
    assert.ok(renderMargemBranca.metadata.margemBranca.reducao >= 0.08, "crop deve ser material e conservador");

    const produtoPaisagem = await bufferJpeg({ width: 904, height: 503, fill: "#0f766e", label: "PAISAGEM" });
    const renderPaisagem = await identidadeVisual.renderizarIdentidadeVisualBuffer({
      imagemBuffer: produtoPaisagem,
      logoBuffer: storage.lerLogoBuffer("workspace_amostras", "optimus_oficial"),
      config: { frase: "AS MELHORES OFERTAS, EM UM SO LUGAR", corIdentidade: "azul" }
    });
    assert.strictEqual(renderPaisagem.metadata.composicao, "composicao_paisagem");
    assert.deepStrictEqual(renderPaisagem.metadata.productContainBox, { width: 1040, height: 960 });
    assert.ok(renderPaisagem.metadata.productContentWidth > 1000, "paisagem deve ganhar area sem cover");
    assert.ok(renderPaisagem.metadata.productContentHeight > 556, "paisagem deve ganhar altura sem corte");
    assert.ok(
      Math.abs((renderPaisagem.metadata.productContentWidth / renderPaisagem.metadata.productContentHeight) - (904 / 503)) < 0.02,
      "paisagem deve preservar proporcao"
    );

    const produtoPaisagemExtrema = await bufferJpeg({ width: 1491, height: 678, fill: "#1f2937", label: "PAISAGEM EXTREMA" });
    const renderPaisagemExtrema = await identidadeVisual.renderizarIdentidadeVisualBuffer({
      imagemBuffer: produtoPaisagemExtrema,
      logoBuffer: storage.lerLogoBuffer("workspace_amostras", "optimus_oficial"),
      config: { frase: "AS MELHORES OFERTAS, EM UM SO LUGAR", corIdentidade: "azul" }
    });
    assert.strictEqual(renderPaisagemExtrema.metadata.composicao, "composicao_paisagem_extrema");
    assert.strictEqual(renderPaisagemExtrema.metadata.fundoDerivado, true, "paisagem extrema deve preencher o fundo sem cortar o primeiro plano");
    assert.strictEqual(renderPaisagemExtrema.metadata.cropMargemBranca, false);
    assert.ok(
      Math.abs((renderPaisagemExtrema.metadata.productContentWidth / renderPaisagemExtrema.metadata.productContentHeight) - (1491 / 678)) < 0.02,
      "paisagem extrema deve preservar a imagem principal inteira"
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

    let downloadsNeutro = 0;
    const serviceNeutro = identidadeVisual.criarServicoIdentidadeVisualOfertas({
      repository: criarRepoMemoria({ workspace_neutro: { ativo: false } }),
      baixarImagemBuffer: async () => {
        downloadsNeutro += 1;
        return produto;
      }
    });
    const inicioMissNeutro = process.hrtime.bigint();
    const neutroMiss = await serviceNeutro.aplicarIdentidadeVisualOferta({
      clienteId: "workspace_neutro",
      oferta: { id: "oferta_neutra", origem: "manual_v2" },
      imagemAtual: "https://img.test/neutra.png",
      contexto: { origem: "manual_v2" }
    }, { plano: { recursos: { identidade_visual_ofertas: "opcional_editavel" } } });
    const duracaoMissNeutroMs = Number(process.hrtime.bigint() - inicioMissNeutro) / 1e6;
    assert.strictEqual(neutroMiss.aplicada, false, "OFF nao marca identidade aplicada");
    assert.strictEqual(neutroMiss.padraoGlobalImagem, true, "OFF aplica padrao global neutro");
    assert.strictEqual(neutroMiss.metadata.brandingAplicado, false, "OFF nao aplica branding");
    assert.ok(neutroMiss.imagemFinal.includes("/identidade-visual-ofertas/public/clientes/workspace_neutro/renderizados/"));
    assert.ok(fs.existsSync(storage.caminhoRenderizado("workspace_neutro", neutroMiss.metadata.cacheKey).path));
    const metaNeutroArquivo = await sharp(storage.caminhoRenderizado("workspace_neutro", neutroMiss.metadata.cacheKey).path).metadata();
    assert.strictEqual(metaNeutroArquivo.width, 1080, "OFF persistido tem 1080 de largura");
    assert.strictEqual(metaNeutroArquivo.height, 1080, "OFF persistido tem 1080 de altura");

    const inicioHitNeutro = process.hrtime.bigint();
    const neutroHit = await serviceNeutro.aplicarIdentidadeVisualOferta({
      clienteId: "workspace_neutro",
      oferta: { id: "oferta_neutra_clone", origem: "clonador_grupos" },
      imagemAtual: "https://img.test/neutra.png",
      contexto: { origem: "clonador_grupos" }
    }, { plano: { recursos: { identidade_visual_ofertas: "opcional_editavel" } } });
    const duracaoHitNeutroMs = Number(process.hrtime.bigint() - inicioHitNeutro) / 1e6;
    assert.strictEqual(neutroHit.padraoGlobalImagem, true, "cache hit preserva padrao global neutro");
    assert.strictEqual(neutroHit.metadata.cacheHit, true);
    assert.strictEqual(neutroHit.imagemFinal, neutroMiss.imagemFinal, "cache hit retorna a mesma imagem neutra");
    assert.strictEqual(downloadsNeutro, 1, "cache neutro evita novo download/render");
    console.log("[TESTE-IMAGEM-GLOBAL-NEUTRA-TEMPOS]", {
      cacheMissMs: Math.round(duracaoMissNeutroMs),
      cacheHitMs: Math.round(duracaoHitNeutroMs),
      downloads: downloadsNeutro,
      renders: 1
    });

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
