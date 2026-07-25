const {
  preservarCandidatosImagemUniversal
} = require("../../modules/imagens/resolver-imagem-universal");

function gerarIdManual(prefixo = "manual") {
  return `${prefixo}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function agoraBR() {
  return new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });
}

function camposImagemPermitidosManual(body = {}) {
  return {
    imagem: body.imagem || "",
    imagemUrl: body.imagemUrl || "",
    image: body.image || "",
    imageUrl: body.imageUrl || "",
    image_url: body.image_url || "",
    thumbnail: body.thumbnail || "",
    thumbnailUrl: body.thumbnailUrl || "",
    secure_thumbnail: body.secure_thumbnail || "",
    foto: body.foto || "",
    fotoUrl: body.fotoUrl || "",
    picture_url: body.picture_url || "",
    pictures: body.pictures,
    images: body.images,
    imagens: body.imagens,
    fotos: body.fotos,
    product_main_image_url: body.product_main_image_url || "",
    product_small_image_urls: body.product_small_image_urls,
    landingImage: body.landingImage || "",
    ogImage: body.ogImage || "",
    twitterImage: body.twitterImage || "",
    imagemRadar: body.imagemRadar || "",
    urlImagem: body.urlImagem || "",
    galeria: body.galeria,
  };
}

function normalizarOfertaManual(body = {}, deps = {}) {
  const {
    clienteId = "admin",
    classificarCategoriaOferta
  } = deps;

  const titulo = body.titulo || body.nome || "Oferta";
  const marketplace = body.marketplace || "";
  const agora = agoraBR();
  const camposImagem = camposImagemPermitidosManual(body);
  const imagemComCandidatos = preservarCandidatosImagemUniversal(camposImagem);

  const categoriaDetectada =
    typeof classificarCategoriaOferta === "function"
      ? classificarCategoriaOferta(
          {
            titulo,
            nome: titulo,
            categoria: body.categoria || body.categoriaProduto || "",
            marketplace
          },
          titulo
        )
      : body.categoria || body.categoriaProduto || "Diversos";

  return {
    id: body.id || gerarIdManual(),

    clienteId,

    marketplace,
    origem: body.origem || "manual",

    nome: titulo,
    titulo,

    preco: body.preco || body.precoAtual || "",
    precoAtual: body.precoAtual || body.preco || "",
    precoAntigo: body.precoAntigo || "",

    cupom: body.cupom ? String(body.cupom).trim() : "",
    avisoCupom: body.avisoCupom || "",
    parcelamento: body.parcelamento || "",

    categoria: categoriaDetectada || "Diversos",
    categoriaProduto: categoriaDetectada || "Diversos",

    link: body.link || body.linkAfiliado || body.linkOriginal || "",
    linkOriginal: body.linkOriginal || body.link || body.linkAfiliado || "",
    linkAfiliado: body.linkAfiliado || body.link || body.linkOriginal || "",

    ...camposImagem,
    metadata: imagemComCandidatos.metadata,

    manual: true,

    status: body.status || "rascunho",
    statusDetalhe: body.statusDetalhe || "Importada para revisão",

    criadoEm: body.criadoEm || agora,
    dataEntradaFila: body.dataEntradaFila || "",
    enviadoEm: body.enviadoEm || ""
  };
}

module.exports = {
  gerarIdManual,
  agoraBR,
  normalizarOfertaManual
};
