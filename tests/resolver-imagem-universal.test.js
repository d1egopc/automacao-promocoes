const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-resolver-img-"));

const {
  resolverImagemUniversal,
  imagemUrlValidaUniversal,
  coletarCandidatosImagemUniversal
} = require("../modules/imagens/resolver-imagem-universal");
const { resolverImagemFilaEngine } = require("../modules/engine/distributor/distributor.service");
const { adicionarOfertaFila } = require("../utils/fila-ofertas");
const { writeClienteJson } = require("../utils/storage");
const { listarOportunidadesSocial } = require("../modules/social/storage");

function url(nome) {
  return `https://cdn.exemplo.com/produtos/${nome}.jpg`;
}

function semDatas(resultado) {
  const clone = { ...resultado };
  delete clone.imagemResolvidaEm;
  return clone;
}

{
  const importerService = fs.readFileSync(path.join(__dirname, "../modules/engine/importer/importer.service.js"), "utf8");
  assert(!importerService.includes('motivo: "nao_necessario"'));
  assert(importerService.includes('imagemResolucaoEngine.motivo === "nenhuma_fonte_de_imagem"'));
  assert(importerService.includes('"sem_candidato"'));
}

{
  const entrada = { titulo: "Produto", imagemUrl: url("principal"), imageUrl: url("alias") };
  const copia = JSON.parse(JSON.stringify(entrada));
  const saida = resolverImagemUniversal(entrada);
  assert.deepStrictEqual(entrada, copia, "resolver nao deve mutar a entrada");
  assert.strictEqual(saida.imagem, url("principal"));
  assert.strictEqual(saida.imagemUrl, url("principal"));
  assert.strictEqual(saida.imagemStatus, "preservada");
  assert.strictEqual(saida.imagemOrigem, "imagemUrl");
  assert.strictEqual(saida.imagemConfianca, 100);
}

{
  const saida = resolverImagemUniversal({ imagem: url("imagem") });
  assert.strictEqual(saida.imagemStatus, "preservada");
  assert.strictEqual(saida.imagemOrigem, "imagem");
  assert.strictEqual(saida.imagemUrl, url("imagem"));
}

{
  const saida = resolverImagemUniversal({ imageUrl: url("alias") });
  assert.strictEqual(saida.imagem, url("alias"));
  assert.strictEqual(saida.imagemStatus, "resolvida_alias");
  assert.strictEqual(saida.imagemOrigem, "imageUrl");
  assert.strictEqual(saida.imagemConfianca, 90);
}

{
  const saida = resolverImagemUniversal({ pictures: [{ secure_url: url("foto-segura") }] });
  assert.strictEqual(saida.imagem, url("foto-segura"));
  assert.strictEqual(saida.imagemStatus, "resolvida_alias");
  assert.strictEqual(saida.imagemOrigem, "pictures[0].secure_url");
  assert.strictEqual(saida.imagemConfianca, 80);
}

{
  const saida = resolverImagemUniversal({ product_small_image_urls: { string: [url("ali-1")] } });
  assert.strictEqual(saida.imagem, url("ali-1"));
  assert.strictEqual(saida.imagemOrigem, "product_small_image_urls.string[0]");
}

{
  const saida = resolverImagemUniversal({ jsonLd: { image: [url("jsonld")] } });
  assert.strictEqual(saida.imagem, url("jsonld"));
  assert.strictEqual(saida.imagemOrigem, "jsonLd.image[0]");
}

{
  const saida = resolverImagemUniversal({ metadata: { produto: { imageUrl: url("payload") } } });
  assert.strictEqual(saida.imagem, url("payload"));
  assert.strictEqual(saida.imagemStatus, "resolvida_payload_bruto");
  assert.strictEqual(saida.imagemOrigem, "metadata.produto.imageUrl");
  assert.strictEqual(saida.imagemConfianca, 70);
}

{
  const saida = resolverImagemUniversal({
    metadata: {
      radarMirror: {
        midia: {
          imagemOriginal: url("radar-mirror-mensagem"),
          imagemOrigem: "mensagem",
        },
      },
    },
  });
  assert.strictEqual(saida.imagem, url("radar-mirror-mensagem"));
  assert.strictEqual(saida.imagemStatus, "radar_mirror_preservada");
  assert.strictEqual(saida.imagemOrigem, "radar_mirror/mensagem.midia.imagemOriginal");
  assert.strictEqual(saida.imagemConfianca, 110);
}

{
  const saida = resolverImagemUniversal({
    imagem: url("api-diferente"),
    metadata: {
      radarMirror: {
        midia: {
          imagemOriginal: url("radar-preferida"),
          imagemOrigem: "mensagem",
        },
      },
    },
  });
  assert.strictEqual(saida.imagem, url("radar-preferida"));
  assert.strictEqual(saida.imagemOrigem, "radar_mirror/mensagem.midia.imagemOriginal");
  assert(saida.imagemTentativas.some((tentativa) => tentativa.origem === "radar_mirror/mensagem.midia.imagemOriginal" && tentativa.status === "selecionada"));
}

{
  const saida = resolverImagemUniversal({
    marketplace: "amazon",
    imagem: url("amazon-api"),
    metadata: {
      radarMirror: {
        midia: {
          imagemOrigem: "ausente",
        },
      },
    },
  });
  assert.strictEqual(saida.imagem, url("amazon-api"));
  assert.strictEqual(saida.imagemOrigem, "imagem");
}

{
  const saidaComApi = resolverImagemUniversal({
    marketplace: "mercadolivre",
    imagem: url("api-produto"),
    metadata: {
      radarMirror: {
        midia: {
          imagemOriginal: url("avatar-grupo"),
          imagemOrigem: "grupo",
        },
      },
    },
  });
  assert.strictEqual(saidaComApi.imagem, url("api-produto"));
  assert.strictEqual(saidaComApi.imagemOrigem, "imagem");
  assert(!saidaComApi.imagemTentativas.some((tentativa) => tentativa.origem.includes("avatar-grupo")));

  const saidaSemFonteLegitima = resolverImagemUniversal({
    marketplace: "mercadolivre",
    metadata: {
      radarMirror: {
        midia: {
          imagemOriginal: url("avatar-grupo-sem-api"),
          imagemOrigem: "avatar_grupo",
        },
      },
    },
  });
  assert.strictEqual(saidaSemFonteLegitima.imagem, "");
  assert.strictEqual(saidaSemFonteLegitima.imagemStatus, "nao_resolvida");
  assert.strictEqual(saidaSemFonteLegitima.imagemOrigem, "nenhuma");
}

{
  const saidaShopee = resolverImagemUniversal({
    marketplace: "shopee",
    imageUrl: url("shopee-api"),
  });
  assert.strictEqual(saidaShopee.imagem, url("shopee-api"));
  assert.strictEqual(saidaShopee.imagemOrigem, "imageUrl");

  const saidaAmazon = resolverImagemUniversal({
    marketplace: "amazon",
    metadata: { produto: { imageUrl: url("amazon-metadata") } },
  });
  assert.strictEqual(saidaAmazon.imagem, url("amazon-metadata"));
  assert.strictEqual(saidaAmazon.imagemOrigem, "metadata.produto.imageUrl");
}

{
  const saida = resolverImagemUniversal({
    marketplace: "aliexpress",
    linkApp: "https://a.aliexpress.com/_c33QRa2n",
    linkPc: "https://a.aliexpress.com/_c3OvfRej",
    linkAfiliado: "https://s.click.aliexpress.com/e/_c4N0M3JN",
    imagem: url("ali-api"),
    metadata: {
      radarMirror: {
        midia: {
          imagemOriginal: url("ali-radar-mensagem"),
          imagemOrigem: "mensagem",
        },
      },
    },
  });
  assert.strictEqual(saida.imagem, url("ali-radar-mensagem"));
  assert.strictEqual(saida.imagemOrigem, "radar_mirror/mensagem.midia.imagemOriginal");
  assert.strictEqual(saida.linkApp, "https://a.aliexpress.com/_c33QRa2n");
  assert.strictEqual(saida.linkPc, "https://a.aliexpress.com/_c3OvfRej");
  assert.strictEqual(saida.linkAfiliado, "https://s.click.aliexpress.com/e/_c4N0M3JN");
}

{
  const saida = resolverImagemUniversal({
    metadata: {
      produto: {
        imagemCandidatos: [url("contrato-canonico"), url("contrato-secundario")]
      }
    }
  });
  assert.strictEqual(saida.imagem, url("contrato-canonico"));
  assert.strictEqual(saida.imagemOrigem, "metadata.produto.imagemCandidatos[0]");
  assert.deepStrictEqual(coletarCandidatosImagemUniversal(saida), [
    url("contrato-canonico"),
    url("contrato-secundario")
  ]);
}

{
  const saida = resolverImagemUniversal({ imagemUrl: "https://cdn.exemplo.com/placeholder.jpg", imageUrl: url("boa") });
  assert.strictEqual(saida.imagem, url("boa"));
  assert.strictEqual(saida.imagemOrigem, "imageUrl");
  assert(saida.imagemTentativas.some((tentativa) => tentativa.origem === "imagemUrl" && tentativa.status === "rejeitada"));
}

{
  assert.strictEqual(imagemUrlValidaUniversal("data:image/png;base64,abc").ok, false);
  assert.strictEqual(imagemUrlValidaUniversal("blob:https://exemplo.com/abc").ok, false);
  assert.strictEqual(imagemUrlValidaUniversal("https://localhost/imagem.jpg").ok, false);
  assert.strictEqual(imagemUrlValidaUniversal("https://127.0.0.1/imagem.jpg").ok, false);
  assert.strictEqual(imagemUrlValidaUniversal("https://192.168.0.1/imagem.jpg").ok, false);
  assert.strictEqual(imagemUrlValidaUniversal("https://cdn.exemplo.com/icone.svg").ok, false);
}

{
  const saida = resolverImagemUniversal({ imagemUrl: "https://cdn.exemplo.com/a&amp;b.jpg" });
  assert.strictEqual(saida.imagemUrl, "https://cdn.exemplo.com/a&b.jpg");
}

{
  const circular = { metadata: {} };
  circular.metadata.circular = circular;
  const resolvida = resolverImagemUniversal(circular);
  assert.strictEqual(typeof resolvida, "object");
}

{
  const saida = resolverImagemUniversal({ titulo: "Sem imagem", imagemUrl: "", raw: { thumbnail: "nota uma url" } });
  assert.strictEqual(saida.imagemStatus, "nao_resolvida");
  assert.strictEqual(saida.imagem, "");
  assert.strictEqual(saida.imagemUrl, "");
}

{
  const uma = resolverImagemUniversal({ imagemUrl: url("idempotente") });
  const duas = resolverImagemUniversal(uma);
  assert.deepStrictEqual(semDatas(duas), semDatas(uma));
  assert.strictEqual(duas.imagemResolvidaEm, uma.imagemResolvidaEm);
}

{
  const saida = resolverImagemUniversal({}, {
    evento: {
      payload: { imageUrl: url("payload-generico-contexto") },
      metadata: { produto: { imageUrl: url("metadata-contexto") } },
    },
  });
  assert.strictEqual(saida.imagem, url("metadata-contexto"));
  assert.strictEqual(saida.imagemOrigem, "contexto.evento.metadata.produto.imageUrl");
}

{
  const saida = resolverImagemUniversal({}, {
    job: {
      payload: { imageUrl: url("payload-generico-ignorado") },
    },
  });
  assert.strictEqual(saida.imagemStatus, "nao_resolvida");
}

{
  const saida = resolverImagemFilaEngine({ imagem: url("fila-principal") });
  assert.strictEqual(saida.imagem, url("fila-principal"));
  assert.strictEqual(saida.origem, "engine_ofertas.imagem");
  assert.strictEqual(saida.fallbackUsado, false);
}

{
  const saida = resolverImagemFilaEngine({ metadata: { produto: { images: [{ url: url("fila-fallback") }] } } });
  assert.strictEqual(saida.imagem, url("fila-fallback"));
  assert.strictEqual(saida.origem, "metadata.produto.images");
  assert.strictEqual(saida.fallbackUsado, true);
}

{
  const fila = [];
  const adicionou = adicionarOfertaFila(fila, {
    titulo: "Produto legado",
    marketplace: "teste",
    preco: 99,
    imageUrl: url("fila-legado"),
    linkAfiliado: "https://loja.exemplo.com/produto",
  }, { origem: "teste" });
  assert.strictEqual(adicionou, true);
  assert.strictEqual(fila[0].imagem, url("fila-legado"));
  assert.strictEqual(fila[0].imagemUrl, url("fila-legado"));
}

{
  const clienteId = "cliente_social_resolver";
  writeClienteJson(clienteId, "fila.json", [{
    id: "oferta_social_1",
    ofertaId: "oferta_social_1",
    titulo: "Oferta social",
    marketplace: "teste",
    preco: 100,
    score: 90,
    linkAfiliado: "https://loja.exemplo.com/social",
    imagem: url("social"),
    imagemUrl: url("social"),
    status: "pendente",
    criadoEm: new Date().toISOString(),
  }]);
  const oportunidades = listarOportunidadesSocial(clienteId);
  assert(oportunidades.some((item) => item.ofertaId === "oferta_social_1" && item.imagem === url("social")));
}

{
  const secureThumb = resolverImagemUniversal({ secure_thumbnail: url("ml-secure-thumb") });
  assert.strictEqual(secureThumb.imagem, url("ml-secure-thumb"));
  assert.strictEqual(secureThumb.imagemOrigem, "secure_thumbnail");

  const pictureUrl = resolverImagemUniversal({ picture_url: url("ml-picture-url") });
  assert.strictEqual(pictureUrl.imagem, url("ml-picture-url"));
  assert.strictEqual(pictureUrl.imagemOrigem, "picture_url");

  const metaSecure = resolverImagemUniversal({ metadata: { produto: { pictures: [{ secure_url: url("ml-meta-secure") }] } } });
  assert.strictEqual(metaSecure.imagem, url("ml-meta-secure"));
  assert.strictEqual(metaSecure.imagemOrigem, "metadata.produto.pictures[0].secure_url");

  const metaUrl = resolverImagemUniversal({ metadata: { produto: { pictures: [{ url: url("ml-meta-url") }] } } });
  assert.strictEqual(metaUrl.imagem, url("ml-meta-url"));
  assert.strictEqual(metaUrl.imagemOrigem, "metadata.produto.pictures[0].url");
}

{
  const saida = resolverImagemUniversal({
    imagem: url("principal-ml"),
    metadata: { produto: { secure_thumbnail: url("thumb-ml") } }
  });
  assert.strictEqual(saida.imagem, url("principal-ml"));
  assert.strictEqual(saida.imagemOrigem, "imagem");
}

{
  const saida = resolverImagemUniversal({ metadata: { produto: { images: ["data:image/png;base64,abc", "data:image/png;base64,abc"] } } });
  assert.strictEqual(saida.imagemStatus, "nao_resolvida");
  assert.strictEqual(saida.imagem, "");
  assert.strictEqual(imagemUrlValidaUniversal("data:image/png;base64,abc").ok, false);
}

console.log("resolver-imagem-universal.test.js OK");
