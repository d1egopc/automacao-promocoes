"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-logo-personalizada-"));
process.env.IDENTIDADE_VISUAL_PUBLIC_BASE_URL = "https://go.test";

const renderer = require("../modules/identidade-visual-ofertas/renderer");
const { criarRepositorioIdentidadeVisualOfertas } = require("../modules/identidade-visual-ofertas/repository");
const { criarServicoIdentidadeVisualOfertas } = require("../modules/identidade-visual-ofertas/service");
const storage = require("../modules/identidade-visual-ofertas/storage");
const tipoMidiaV2 = require("../modules/destinos/tipo-midia-v2");

const plano = (politica) => ({ recursos: { identidade_visual_ofertas: politica } });

async function main() {
  const imagemBuffer = await sharp({ create: { width: 640, height: 360, channels: 4, background: "#ffffff" } }).png().toBuffer();
  const logoPng = await sharp({ create: { width: 160, height: 80, channels: 4, background: { r: 220, g: 30, b: 30, alpha: 0.7 } } }).png().toBuffer();
  const logoWebp = await sharp(logoPng).webp().toBuffer();
  assert.strictEqual((await sharp(await renderer.normalizarLogoUpload(logoWebp, "image/webp")).metadata()).hasAlpha, true);
  const config = { ativo: true, logo: "optimus_oficial", frase: "OFERTAS TESTE", corIdentidade: "azul" };

  const legado = await renderer.renderizarIdentidadeVisualBuffer({ imagemBuffer, logoBuffer: logoPng, config });
  const padrao = await renderer.renderizarIdentidadeVisualBuffer({ imagemBuffer, logoBuffer: logoPng, config: {
    ...config, logoMode: "padrao", logoPlacement: "bottom-right", logoScale: "large"
  } });
  assert.deepStrictEqual(padrao.buffer, legado.buffer, "Padrão deve ser byte a byte igual ao legado");
  assert.deepStrictEqual(padrao.metadata, legado.metadata, "Padrão deve manter metadata legado");
  assert.strictEqual(renderer.configHashIdentidadeVisual(config), renderer.configHashIdentidadeVisual({
    ...config, logoMode: "padrao", logoPlacement: "bottom-right", logoScale: "large"
  }), "cache legado não deve mudar");
  assert.notStrictEqual(renderer.configHashIdentidadeVisual(config), renderer.configHashIdentidadeVisual({
    ...config, logoMode: "personalizada", logoPlacement: "top-left", logoScale: "medium"
  }), "cache personalizado deve ser isolado do legado");

  for (const logoBuffer of [logoPng, logoWebp]) {
    for (const logoPlacement of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
      const personalizada = await renderer.renderizarIdentidadeVisualBuffer({ imagemBuffer, logoBuffer, config: {
        ...config, logoMode: "personalizada", logoPlacement, logoScale: "medium"
      } });
      const slot = personalizada.metadata.logoSlot;
      assert.ok(slot.left >= 48 && slot.top >= 48);
      assert.ok(slot.left + slot.width <= 1080 - 48);
      assert.ok(slot.top + slot.height <= 1080 - 48);
      assert.strictEqual(slot.left < 540, logoPlacement.endsWith("left"));
      assert.strictEqual(slot.top < 400, logoPlacement.startsWith("top"));
      assert.notDeepStrictEqual(personalizada.buffer, legado.buffer);
      assert.strictEqual(personalizada.metadata.fraseLayout, undefined);
      assert.strictEqual(personalizada.metadata.corHex, undefined);
      const meta = await sharp(personalizada.buffer).metadata();
      assert.strictEqual(meta.width, 1080);
      assert.strictEqual(meta.height, 1080);
      assert.strictEqual(meta.format, "png");
      assert.strictEqual(personalizada.metadata.faixaAplicada, false);
      assert.strictEqual(personalizada.metadata.fraseAplicada, false);
      assert.strictEqual(personalizada.metadata.logoMode, "personalizada");
      if (logoPlacement.startsWith("bottom")) {
        assert.ok(slot.top + slot.height > renderer.AREA_PRODUTO_ALTURA, "canto inferior usa a arte inteira, não a faixa");
      }
      const pixel = await sharp(personalizada.buffer).extract({ left: slot.left + Math.floor(slot.width / 2), top: slot.top + Math.floor(slot.height / 2), width: 1, height: 1 }).raw().toBuffer();
      assert.ok(pixel[0] > pixel[1], "logo colorida deve aparecer no canto selecionado");
      const { data: rodape, info: rodapeInfo } = await sharp(personalizada.buffer)
        .extract({
          left: renderer.LOGO_SLOT.left,
          top: renderer.LOGO_SLOT.top,
          width: renderer.LOGO_SLOT.width,
          height: renderer.LOGO_SLOT.height
        })
        .raw()
        .toBuffer({ resolveWithObject: true });
      let vermelhoForaDoSlot = 0;
      for (let y = 0; y < rodapeInfo.height; y += 1) {
        for (let x = 0; x < rodapeInfo.width; x += 1) {
          const globalX = renderer.LOGO_SLOT.left + x;
          const globalY = renderer.LOGO_SLOT.top + y;
          const dentroDoSlotPersonalizado = globalX >= slot.left &&
            globalX < slot.left + slot.width &&
            globalY >= slot.top &&
            globalY < slot.top + slot.height;
          const indice = (y * rodapeInfo.width + x) * rodapeInfo.channels;
          const alpha = rodapeInfo.channels >= 4 ? rodape[indice + 3] : 255;
          if (!dentroDoSlotPersonalizado && alpha > 20 && rodape[indice] > rodape[indice + 1] + 50 && rodape[indice] > rodape[indice + 2] + 50) {
            vermelhoForaDoSlot += 1;
          }
        }
      }
      assert.strictEqual(vermelhoForaDoSlot, 0, "modo personalizado não deve duplicar a logo no rodapé");
    }
  }
  for (const [width, height] of [[320, 48], [48, 320], [180, 180]]) {
    const logoFormato = await sharp({ create: { width, height, channels: 4, background: { r: 220, g: 30, b: 30, alpha: 0.7 } } }).png().toBuffer();
    const render = await renderer.renderizarIdentidadeVisualBuffer({ imagemBuffer, logoBuffer: logoFormato, config: {
      ...config, logoMode: "personalizada", logoPlacement: "top-left", logoScale: "medium"
    } });
    assert.strictEqual((await sharp(render.buffer).metadata()).width, 1080, "proporção da logo não muda canvas");
  }
  const invalida = await renderer.renderizarIdentidadeVisualBuffer({ imagemBuffer, logoBuffer: logoPng, config: {
    ...config, logoMode: "personalizada", logoPlacement: "centro", logoScale: "large"
  } });
  assert.deepStrictEqual(invalida.buffer, legado.buffer, "posição inválida deve voltar ao legado");
  for (const [width, height] of [[600, 600], [360, 720], [960, 360]]) {
    const produto = await sharp({ create: { width, height, channels: 4, background: "#ffffff" } }).png().toBuffer();
    const render = await renderer.renderizarIdentidadeVisualBuffer({ imagemBuffer: produto, logoBuffer: logoPng, config: {
      ...config, logoMode: "personalizada", logoPlacement: "bottom-right", logoScale: "large"
    } });
    assert.strictEqual((await sharp(render.buffer).metadata()).width, 1080, "proporção do produto não muda canvas");
    assert.ok(render.metadata.logoSlot.top + render.metadata.logoSlot.height <= 1080 - 48, "logo respeita margem da arte inteira");
  }

  const configs = {};
  const repository = criarRepositorioIdentidadeVisualOfertas({
    readClienteJson: (cliente) => configs[cliente] || {},
    writeClienteJson: (cliente, _nome, valor) => { configs[cliente] = valor; }
  });
  assert.strictEqual(repository.salvarConfig("workspace_bad", { logoMode: "personalizada", logoPlacement: "centro" }).logoMode, "padrao");
  assert.strictEqual(repository.salvarConfig("workspace_bad", { logoMode: "personalizada", logoScale: "gigante" }).logoMode, "padrao");
  const servico = criarServicoIdentidadeVisualOfertas({ repository, baixarImagemBuffer: async () => imagemBuffer });
  const editavel = { plano: plano("opcional_editavel") };
  const bloqueado = { plano: plano("obrigatoria") };
  servico.atualizarConfig("workspace_a", { ...config, logoMode: "personalizada", logoPlacement: "bottom-left", logoScale: "small" }, editavel);
  assert.strictEqual(servico.resolverConfig("workspace_a", editavel).configEfetiva.logoPlacement, "bottom-left");
  assert.strictEqual(servico.resolverConfig("workspace_b", editavel).configEfetiva.logoMode, undefined);
  assert.throws(() => servico.atualizarConfig("workspace_b", { logoMode: "personalizada" }, bloqueado), /edicao_bloqueada/);
  assert.throws(() => servico.atualizarConfig("workspace_a", { ativo: false }, { plano: plano("obrigatoria_editavel") }), /nao_pode_desligar/);
  const preview = await servico.gerarPreview("workspace_a", {}, editavel);
  assert.strictEqual(preview.preview.metadata.logoSlot.left, 48);
  assert.strictEqual(preview.preview.persistida, false);
  const aplicado = await servico.aplicarIdentidadeVisualOferta({ clienteId: "workspace_a", imagemAtual: "https://example.test/produto.png" }, editavel);
  assert.strictEqual(aplicado.aplicada, true);
  assert.strictEqual(aplicado.metadata.logoSlot.left, 48);
  assert.strictEqual(aplicado.imagemOriginal, "https://example.test/produto.png");
  const upload = await servico.uploadLogo("workspace_a", { buffer: logoPng, mimeType: "image/png" }, editavel);
  assert.ok(upload.configEfetiva.logo.startsWith("cliente:"), "upload existente deve atualizar a logo do mesmo workspace");
  const aposUpload = await servico.aplicarIdentidadeVisualOferta({
    clienteId: "workspace_a", imagemAtual: "https://example.test/produto.png"
  }, editavel);
  assert.strictEqual(aposUpload.aplicada, true);
  assert.notStrictEqual(aposUpload.imagemFinal, aplicado.imagemFinal, "logo nova deve invalidar o cache do mesmo render");
  assert.strictEqual(aposUpload.metadata.logoSlot.left, 48);
  for (const tipoMidia of ["imagem_completa", "imagem_link"]) {
    const elegivel = tipoMidiaV2.destinoUsaImagem({ tipoMidia }) || tipoMidiaV2.tipoMidiaDestino({ tipoMidia }) === "imagem_link";
    assert.strictEqual(elegivel, true, `${tipoMidia} mantém a identidade no pré-envio`);
    const resultado = await servico.aplicarIdentidadeVisualOferta({
      clienteId: "workspace_a", imagemAtual: "https://example.test/produto.png", contexto: { tipoMidia }
    }, editavel);
    assert.strictEqual(resultado.imagemFinal, aposUpload.imagemFinal, `${tipoMidia} usa o mesmo render/cache`);
  }
  for (const caminho of ["modules/engine/distributor/distributor.service.js", "modules/manual-v2/manual-dispatcher.js"]) {
    const fonte = fs.readFileSync(path.join(__dirname, "..", caminho), "utf8");
    assert.ok(fonte.includes('tipoMidiaV2.tipoMidiaDestino(destino) === "imagem_link"'));
    assert.ok(fonte.includes("deps.aplicarIdentidadeVisualOferta"), `${caminho} preserva serviço único`);
  }
  servico.atualizarConfig("workspace_sem_asset", {
    logo: `cliente:${"a".repeat(64)}`, logoMode: "personalizada", logoPlacement: "top-left", logoScale: "medium"
  }, editavel);
  const semAsset = await servico.aplicarIdentidadeVisualOferta({
    clienteId: "workspace_sem_asset", imagemAtual: "https://example.test/produto.png"
  }, editavel);
  assert.strictEqual(semAsset.aplicada, false);
  assert.strictEqual(semAsset.imagemFinal, "https://example.test/produto.png", "asset ausente não quebra oferta");
  servico.atualizarConfig("workspace_a", { ativo: false }, editavel);
  const desativada = await servico.gerarPreview("workspace_a", {}, editavel);
  assert.strictEqual(desativada.aplicada, false);
  assert.strictEqual(desativada.motivo, "config_inativa");
  assert.ok(storage.lerLogoBuffer("workspace_a", "optimus_oficial").length > 0);
  console.log("identidade-visual-ofertas-logo-personalizada.test.js OK");
}

main().catch((erro) => { console.error(erro); process.exitCode = 1; });
