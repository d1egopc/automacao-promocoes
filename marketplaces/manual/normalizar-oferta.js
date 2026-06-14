function gerarIdManual(prefixo = "manual") {
  return `${prefixo}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function agoraBR() {
  return new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });
}

function normalizarOfertaManual(body = {}, deps = {}) {
  const {
    clienteId = "admin",
    classificarCategoriaOferta
  } = deps;

  const titulo = body.titulo || body.nome || "Oferta";
  const marketplace = body.marketplace || "";
  const agora = agoraBR();

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

    imagem: body.imagem || "",

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