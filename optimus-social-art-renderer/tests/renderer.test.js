const assert = require("assert");
const {
  normalizarPayloadRenderer,
  hashPayload
} = require("../src/contract");
const { validarUrlImagem, detectarMime, ipPrivado } = require("../src/image-proxy");
const { caminhoArte, urlPublica, salvar } = require("../src/social-art-storage");
const { htmlPreview, renderizarSalvar } = require("../src/renderer.service");

process.env.SOCIAL_ART_PUBLIC_BASE_URL = "https://cdn.optimus.test/";
process.env.SOCIAL_ART_STORAGE_PROVIDER = "r2";
process.env.R2_BUCKET = "social-art";

function payload(overrides = {}) {
  const base = {
    clienteIdInterno: "cliente_a",
    ofertaId: "oferta_a",
    template: {
      versao: 1,
      faixaSuperiorAtiva: true,
      faixaSuperiorTexto: "OFERTA",
      faixaSuperiorCor: "#f97316",
      faixaSuperiorCorTexto: "#ffffff",
      faixaSuperiorTamanho: "md",
      faixaSuperiorAlinhamento: "center",
      mostrarPrecoAntigo: true,
      mostrarCupom: true,
      mostrarMarketplace: true,
      faixaInferiorAtiva: true,
      faixaInferiorCor: "#0f172a",
      faixaInferiorCorTexto: "#ffffff",
      faixaInferiorTamanho: "md",
      faixaInferiorAlinhamento: "center",
      gatilho: "PROMO",
      ctaTemplate: 'COMENTE "{gatilho}"',
      posicaoCard: "bottom-left",
      corMoldura: "#0f172a",
      corCard: "#ffffff",
      corDestaquePreco: "#16a34a",
      seloAtivo: false,
      seloTexto: "OFERTA DO DIA",
      seloPosicao: "top-right",
      seloCor: "#dc2626",
      seloCorTexto: "#ffffff"
    },
    dados: {
      titulo: "Produto Teste",
      precoAntigo: "299.90",
      preco: "199.90",
      cupom: "PROMO10",
      marketplace: "amazon",
      imagem: "https://img.optimus.test/produto.jpg"
    },
    cta: 'COMENTE "PROMO"',
    versao: 1
  };
  const completo = { ...base, ...overrides };
  return { ...completo, hash: hashPayload({
    clienteIdInterno: completo.clienteIdInterno,
    ofertaId: completo.ofertaId,
    template: completo.template,
    dados: completo.dados,
    cta: completo.cta,
    versao: completo.versao
  }) };
}

function fakeBrowser() {
  const page = {
    html: "",
    async setContent(html) {
      this.html = html;
    },
    async evaluate() {},
    async screenshot() {
      return Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]);
    },
    async close() {}
  };
  return {
    async newPage() {
      return page;
    }
  };
}

(async () => {
  const normal = normalizarPayloadRenderer(payload());
  assert.strictEqual(normal.versao, 1);
  assert.strictEqual(normal.dados.titulo, "Produto Teste");
  assert.strictEqual(normal.template.faixaInferiorAtiva, true);
  assert.strictEqual(normal.template.faixaSuperiorCorTexto, "#ffffff");
  assert.strictEqual(normal.template.faixaInferiorCor, "#0f172a");
  assert.strictEqual(normal.template.seloAtivo, false);

  const antigo = normalizarPayloadRenderer(payload({
    template: {
      faixaSuperiorAtiva: true,
      faixaSuperiorTexto: "LEGADO",
      faixaSuperiorCor: "#111111",
      mostrarPrecoAntigo: true,
      mostrarCupom: true,
      mostrarMarketplace: true,
      faixaInferiorAtiva: true,
      gatilho: "PROMO",
      ctaTemplate: 'COMENTE "{gatilho}"',
      posicaoCard: "top-right",
      corMoldura: "#222222",
      corCard: "#ffffff",
      corDestaquePreco: "#16a34a"
    }
  }));
  assert.strictEqual(antigo.template.faixaSuperiorCorTexto, "#ffffff", "template antigo recebe default de cor de texto");
  assert.strictEqual(antigo.template.faixaInferiorCor, "#222222", "template antigo usa corMoldura como fallback da faixa inferior");
  assert.strictEqual(antigo.template.seloAtivo, false, "selo novo deve ser opcional");

  const v2 = normalizarPayloadRenderer(payload({
    template: {
      ...payload().template,
      faixaSuperiorCorTexto: "#101010",
      faixaSuperiorTamanho: "lg",
      faixaSuperiorAlinhamento: "left",
      faixaInferiorCor: "#334155",
      faixaInferiorCorTexto: "#f8fafc",
      faixaInferiorTamanho: "sm",
      faixaInferiorAlinhamento: "right",
      seloAtivo: true,
      seloTexto: "CUPOM",
      seloPosicao: "bottom-right",
      seloCor: "#dc2626",
      seloCorTexto: "#ffffff"
    }
  }));
  assert.strictEqual(v2.template.faixaSuperiorTamanho, "lg");
  assert.strictEqual(v2.template.faixaInferiorAlinhamento, "right");
  assert.strictEqual(v2.template.seloAtivo, true);
  const htmlV2 = htmlPreview({ template: v2.template, dados: v2.dados, cta: v2.cta, imagemSrc: "data:image/png;base64,AA==" });
  assert.ok(htmlV2.includes("class=\"badge\""));
  assert.ok(htmlV2.includes("CUPOM"));
  assert.ok(htmlV2.includes("background:#334155"));

  const semCupom = normalizarPayloadRenderer(payload({ dados: { ...payload().dados, cupom: "" } }));
  assert.strictEqual(semCupom.dados.cupom, "", "cupom ausente deve ser aceito");
  assert.ok(!htmlPreview({ template: semCupom.template, dados: semCupom.dados, cta: semCupom.cta, imagemSrc: "data:image/png;base64,AA==" }).includes("PROMO10"));

  const semPrecoAntigo = normalizarPayloadRenderer(payload({ dados: { ...payload().dados, precoAntigo: "" } }));
  assert.strictEqual(semPrecoAntigo.dados.precoAntigo, "", "preco antigo ausente deve ser aceito");

  const gatilhoDesligado = normalizarPayloadRenderer(payload({
    template: { ...payload().template, faixaInferiorAtiva: false },
    cta: ""
  }));
  assert.ok(!htmlPreview({ template: gatilhoDesligado.template, dados: gatilhoDesligado.dados, cta: "", imagemSrc: "data:image/png;base64,AA==" }).includes('<div class="bottom-band"'));

  const gatilhoLigado = htmlPreview({ template: normal.template, dados: normal.dados, cta: normal.cta, imagemSrc: "data:image/png;base64,AA==" });
  assert.ok(gatilhoLigado.includes("bottom-band"));
  assert.ok(gatilhoLigado.includes("COMENTE"));

  assert.doesNotThrow(() => validarUrlImagem("https://cdn.exemplo.com/a.jpg"));
  assert.throws(() => validarUrlImagem("http://127.0.0.1/a.jpg"), /imagem_host_bloqueado/);
  assert.throws(() => validarUrlImagem("file:///tmp/a.jpg"), /imagem_protocolo_invalido/);
  assert.strictEqual(ipPrivado("10.0.0.1"), true);
  assert.strictEqual(detectarMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8])), "image/png");

  const key = caminhoArte({ clienteId: "cliente_a", ofertaId: "oferta_a", hash: normal.hash });
  assert.strictEqual(key, `posts/cliente_a/oferta_a/${normal.hash}.png`);
  assert.strictEqual(urlPublica(key), `https://cdn.optimus.test/posts/cliente_a/oferta_a/${normal.hash}.png`);

  const sent = [];
  const s3Client = {
    async send(cmd) {
      sent.push(cmd.constructor.name);
      if (cmd.constructor.name === "HeadObjectCommand") {
        const erro = new Error("not found");
        erro.$metadata = { httpStatusCode: 404 };
        throw erro;
      }
      return {};
    }
  };
  const salvo = await salvar({
    clienteId: "cliente_a",
    ofertaId: "oferta_a",
    hash: normal.hash,
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]),
    mimeType: "image/png",
    s3Client,
    comandos: {
      HeadObjectCommand: class HeadObjectCommand {
        constructor(args) { this.args = args; }
      },
      PutObjectCommand: class PutObjectCommand {
        constructor(args) { this.args = args; }
      }
    }
  });
  assert.strictEqual(salvo.cache, false);
  assert.ok(sent.includes("PutObjectCommand"));

  const renderizado = await renderizarSalvar(payload({
    dados: { ...payload().dados, imagem: "https://img.optimus.test/horizontal.jpg" }
  }), {
    browserFactory: fakeBrowser,
    baixarImagem: async () => ({
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00, 1, 2, 3, 4, 5, 6, 7, 8]),
      mimeType: "image/jpeg",
      bytes: 12,
      host: "img.optimus.test"
    }),
    storageSalvar: async ({ hash }) => ({
      ok: true,
      cache: true,
      imagemUrlPublica: `https://cdn.optimus.test/posts/cliente_a/oferta_a/${hash}.png`
    })
  });
  assert.strictEqual(renderizado.ok, true);
  assert.strictEqual(renderizado.cache, true, "cache por hash deve ser preservado");

  await assert.rejects(
    () => renderizarSalvar(payload({ dados: { ...payload().dados, imagem: "https://img.optimus.test/invalida.jpg" } }), {
      browserFactory: fakeBrowser,
      baixarImagem: async () => { throw new Error("imagem_mime_real_invalido"); },
      storageSalvar: async () => { throw new Error("nao_deveria_salvar"); }
    }),
    /imagem_mime_real_invalido/
  );

  await assert.rejects(
    () => renderizarSalvar(payload({ dados: { ...payload().dados, imagem: "https://img.optimus.test/vertical.jpg" } }), {
      browserFactory: fakeBrowser,
      baixarImagem: async () => ({
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]),
        mimeType: "image/png",
        bytes: 12,
        host: "img.optimus.test"
      }),
      storageSalvar: async () => { throw new Error("storage_indisponivel"); }
    }),
    /storage_indisponivel/
  );

  console.log("social-art-renderer: ok");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
