const assert = require("assert");

const {
  MAX_CANDIDATOS_IMAGEM,
  coletarCandidatosImagemUniversal,
  preservarCandidatosImagemUniversal,
  resolverImagemUniversal
} = require("../modules/imagens/resolver-imagem-universal");
const {
  normalizarOfertaUniversal
} = require("../modules/inteligencia-universal/normalizacao.service");
const {
  normalizarOfertaManual
} = require("../marketplaces/manual/normalizar-oferta");

function url(nome) {
  return `https://cdn.exemplo.com/${nome}.jpg`;
}

{
  const oferta = {
    imagemUrl: url("principal"),
    imagem: url("principal-2"),
    thumbnail: url("thumb"),
    pictures: [
      url("galeria-1"),
      { secure_url: url("galeria-2") },
      { src: url("galeria-3") }
    ],
    metadata: {
      produto: {
        imageUrl: url("metadata")
      }
    }
  };

  assert.deepStrictEqual(coletarCandidatosImagemUniversal(oferta), [
    url("principal"),
    url("principal-2"),
    url("thumb"),
    url("galeria-1"),
    url("galeria-2"),
    url("galeria-3"),
    url("metadata")
  ]);
}

{
  const candidatos = coletarCandidatosImagemUniversal({
    imagem: "",
    imageUrl: ` ${url("duplicada")} `,
    images: [url("duplicada"), "", { imagemUrl: url("objeto") }],
    galeria: [{ url: url("galeria") }],
    mediaUrl: "https://cdn.exemplo.com/video.mp4",
    midiaUrl: "https://cdn.exemplo.com/video-2.mp4"
  });

  assert.deepStrictEqual(candidatos, [
    url("duplicada"),
    url("objeto"),
    url("galeria")
  ]);
}

{
  const candidatos = coletarCandidatosImagemUniversal({
    metadata: { ogImage: url("metadata-direto") },
    produto: { fotoUrl: url("produto") },
    dadosProduto: { secure_thumbnail: url("dados-produto") }
  });

  assert.deepStrictEqual(candidatos, [
    url("metadata-direto"),
    url("produto"),
    url("dados-produto")
  ]);
}

{
  const mercados = {
    mercadolivre: {
      pictures: [{ secure_url: url("ml-secure") }, { url: url("ml-url") }]
    },
    shopee: {
      imageUrl: url("shopee")
    },
    amazon: {
      landingImage: url("amazon"),
      galeria: [{ src: url("amazon-galeria") }]
    },
    aliexpress: {
      product_main_image_url: url("ali-principal"),
      product_small_image_urls: { string: [url("ali-galeria")] }
    },
    kabum: {
      ogImage: url("kabum")
    },
    awin: {
      urlImagem: url("awin")
    }
  };

  assert.deepStrictEqual(coletarCandidatosImagemUniversal(mercados.mercadolivre), [
    url("ml-secure"),
    url("ml-url")
  ]);
  assert.deepStrictEqual(coletarCandidatosImagemUniversal(mercados.shopee), [url("shopee")]);
  assert.deepStrictEqual(coletarCandidatosImagemUniversal(mercados.amazon), [
    url("amazon"),
    url("amazon-galeria")
  ]);
  assert.deepStrictEqual(coletarCandidatosImagemUniversal(mercados.aliexpress), [
    url("ali-principal"),
    url("ali-galeria")
  ]);
  assert.deepStrictEqual(coletarCandidatosImagemUniversal(mercados.kabum), [url("kabum")]);
  assert.deepStrictEqual(coletarCandidatosImagemUniversal(mercados.awin), [url("awin")]);
}

{
  const radar = {
    imagemUrl: url("radar"),
    mediaUrl: "https://cdn.exemplo.com/video-radar.mp4"
  };
  const resolvida = resolverImagemUniversal(radar, { origem: "teste_radar" });
  assert.strictEqual(resolvida.imagem, url("radar"));
  assert.deepStrictEqual(resolvida.metadata.produto.imagemCandidatos, [url("radar")]);
}

{
  const manual = normalizarOfertaManual({
    titulo: "Oferta manual",
    marketplace: "amazon",
    imageUrl: url("manual-principal"),
    galeria: [{ secure_url: url("manual-galeria") }]
  }, {
    clienteId: "cliente_teste"
  });

  assert.deepStrictEqual(manual.metadata.produto.imagemCandidatos, [
    url("manual-principal"),
    url("manual-galeria")
  ]);
  assert.strictEqual(manual.imageUrl, url("manual-principal"));
}

{
  const normalizada = normalizarOfertaUniversal({
    titulo: "Oferta universal",
    marketplace: "shopee",
    preco: 99,
    linkAfiliado: "https://loja.exemplo.com/oferta",
    imageUrl: url("normalizacao"),
    metadata: {
      produto: {
        pictures: [{ url: url("normalizacao-galeria") }]
      }
    }
  });

  assert.deepStrictEqual(normalizada.metadata.produto.imagemCandidatos, [
    url("normalizacao"),
    url("normalizacao-galeria")
  ]);
}

{
  const uma = preservarCandidatosImagemUniversal({
    imagem: url("idempotente"),
    images: [url("idempotente"), url("secundaria")]
  });
  const duas = preservarCandidatosImagemUniversal(uma);

  assert.deepStrictEqual(duas, uma);
  assert.deepStrictEqual(duas.metadata.produto.imagemCandidatos, [
    url("idempotente"),
    url("secundaria")
  ]);
}

{
  const galeria = Array.from({ length: 300 }, (_, indice) => url(`grande-${indice}`));
  const candidatos = coletarCandidatosImagemUniversal({ images: galeria });

  assert.strictEqual(candidatos.length, MAX_CANDIDATOS_IMAGEM);
  assert.deepStrictEqual(candidatos, galeria.slice(0, MAX_CANDIDATOS_IMAGEM));
}

{
  const unicos = Array.from({ length: MAX_CANDIDATOS_IMAGEM + 5 }, (_, indice) => url(`unico-${indice}`));
  const galeria = [
    unicos[0],
    unicos[0],
    ...unicos.slice(1, MAX_CANDIDATOS_IMAGEM),
    unicos[0],
    unicos[MAX_CANDIDATOS_IMAGEM]
  ];
  const candidatos = coletarCandidatosImagemUniversal({ pictures: galeria });

  assert.deepStrictEqual(candidatos, unicos.slice(0, MAX_CANDIDATOS_IMAGEM));
}

{
  const galeria = Array.from(
    { length: 200 },
    (_, indice) => [{ secure_url: url(`aninhada-${indice}`) }]
  );
  const candidatos = coletarCandidatosImagemUniversal({ galeria });

  assert.strictEqual(candidatos.length, MAX_CANDIDATOS_IMAGEM);
  assert.deepStrictEqual(
    candidatos,
    Array.from({ length: MAX_CANDIDATOS_IMAGEM }, (_, indice) => url(`aninhada-${indice}`))
  );
}

{
  const entrada = {
    images: Array.from({ length: 100 }, (_, indice) => url(`repeticao-${indice}`))
  };
  const uma = preservarCandidatosImagemUniversal(entrada);
  const duas = preservarCandidatosImagemUniversal(uma);
  const tres = preservarCandidatosImagemUniversal(duas);

  assert.deepStrictEqual(duas, uma);
  assert.deepStrictEqual(tres, uma);
  assert.strictEqual(tres.metadata.produto.imagemCandidatos.length, MAX_CANDIDATOS_IMAGEM);
}

{
  const manual = normalizarOfertaManual({
    titulo: "Manual com metadata nao confiavel",
    marketplace: "amazon",
    imageUrl: url("manual-permitida"),
    metadata: {
      campoArbitrario: "nao deve passar",
      produto: {
        segredo: "nao deve passar",
        imagemCandidatos: [url("injetada")],
        imageUrl: url("metadata-injetada")
      }
    }
  }, {
    clienteId: "cliente_teste"
  });

  assert.deepStrictEqual(manual.metadata, {
    produto: {
      imagemCandidatos: [url("manual-permitida")]
    }
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(manual.metadata, "campoArbitrario"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(manual.metadata.produto, "segredo"), false);
}

console.log("imagem-candidatos-universal.test.js OK");
