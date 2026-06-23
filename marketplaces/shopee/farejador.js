// ================= FAREJADOR SHOPEE =================

const {
  extrairCuponsShopeeDoHtml,
  detectarAvisoCupomShopee,
  escolherCupomParaOfertaShopee
} = require("./cupons");

async function farejarShopee(clienteId = "admin", deps = {}) {

const {
  config,
  integracoesPorCliente,
  getIntegracaoCliente,
  fila,
  salvarFila,
  prepararOfertaGlobal,
  ofertaJaExiste,
  classificarCategoriaOferta,
  aplicarFiltrosUniversais,
  buscarOfertasShopee,
  normalizarSessaoId,
  distribuirOfertaParaClientes
} = deps;

try {

  if (!config.marketplaces?.shopee?.ativo) {
    console.log("[SHOPEE] Shopee desativada. Farejador ignorado.");
    return;
  }

  console.log("[SHOPEE] Farejando ofertas Shopee...");
  const estrategiaFarejador =
    typeof deps.obterEstrategiaFarejador === "function"
      ? deps.obterEstrategiaFarejador(clienteId, "shopee")
      : {
          descontoMinimo: config.marketplaces?.shopee?.descontoMinimo || 15,
          filaCritica: false,
          aceitarBeneficioSemDesconto: true
        };
  const temBeneficioFarejador =
    typeof deps.ofertaTemBeneficioFarejador === "function"
      ? deps.ofertaTemBeneficioFarejador
      : (oferta) => Boolean(oferta?.cupom || oferta?.avisoCupom || oferta?.beneficioExtra || oferta?.cupomUrl);

  const produtos = await buscarOfertasShopee(clienteId, {
    config,
    getIntegracaoCliente
  });


    if (!Array.isArray(produtos)) {
      console.log("[SHOPEE] Shopee no retornou array");
      return;
    }

    console.log(`[SHOPEE] ${produtos.length} produtos Shopee encontrados`);

    let adicionadasNestaRodada = 0;
    let ofertasEncontradas = [];

    const limitePorRodada =
      config.marketplaces?.shopee?.limitePorRodada || 10;

    for (const item of produtos) {
      try {
        const desconto = Number(item.priceDiscountRate || 0);
        const vendas = Number(item.sales || 0);
        const nota = Number(item.ratingStar || 0);
        const precoAtualNumero = Number(item.priceMin || 0);

        const temBeneficioItem = Boolean(
          item.coupon ||
          item.cupom ||
          item.voucher ||
          item.couponInfo ||
          item.promotionInfo ||
          item.offerInfo
        );

        if (desconto < estrategiaFarejador.descontoMinimo && !temBeneficioItem) continue;
        if (!precoAtualNumero) continue;
        if (precoAtualNumero < (config.marketplaces?.shopee?.precoMinimo || 20)) continue;
        if (vendas < (estrategiaFarejador.filaCritica ? 5 : 20) && !temBeneficioItem) continue;
        if (nota > 0 && nota < (estrategiaFarejador.filaCritica ? 4.2 : 4.5) && !temBeneficioItem) continue;

        const precoAtual = precoAtualNumero.toFixed(2).replace(".", ",");

        const precoAntigoNumero =
          precoAtualNumero / (1 - desconto / 100);

        const precoAntigo = precoAntigoNumero.toFixed(2).replace(".", ",");

let novaOferta = {
  nome: item.productName,
  titulo: item.productName,
  preco: precoAtual,
  precoAtual,
  precoAntigo,
  linkOriginal: item.productLink || item.offerLink,
  link: item.productLink || item.offerLink,
  linkAfiliado: "",
  imagem: item.imageUrl,
  marketplace: "shopee",
  categoria: "Shopee",
  sessaoId: normalizarSessaoId(clienteId, "sessao1"),
  status: "pendente",
  clienteId,
  criadoEm: new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  }),
  cupom: "",
  avisoCupom: temBeneficioItem
    ? "Confira voucher/cupom disponível na Shopee antes de finalizar."
    : ""
};

        novaOferta = prepararOfertaGlobal(novaOferta);

        const htmlShopee =
          item.html ||
          item.rawHtml ||
          item.htmlProduto ||
          item.pageHtml ||
          item.productHtml ||
          "";

        if (htmlShopee) {
          const cuponsShopee = extrairCuponsShopeeDoHtml(htmlShopee);
          const avisoShopee = detectarAvisoCupomShopee(htmlShopee, novaOferta);
          const dadosExtraidos = avisoShopee
            ? [...cuponsShopee, avisoShopee]
            : cuponsShopee;
          const cupomOferta = escolherCupomParaOfertaShopee(
            novaOferta,
            dadosExtraidos
          );

          if (cupomOferta?.cupom) {
            novaOferta.cupom = cupomOferta.cupom;
            novaOferta.tipoCupom = cupomOferta.tipoCupom || "";
            novaOferta.avisoCupom =
              cupomOferta.avisoCupom || novaOferta.avisoCupom || "";

            if (cupomOferta.cupomUrl) {
              novaOferta.cupomUrl = cupomOferta.cupomUrl;
            }
          } else if (cupomOferta?.avisoCupom) {
            novaOferta.tipoCupom = cupomOferta.tipoCupom || "";
            novaOferta.avisoCupom = cupomOferta.avisoCupom;

            if (cupomOferta.cupomUrl) {
              novaOferta.cupomUrl = cupomOferta.cupomUrl;
            }
          }
        }

        const jaExiste = fila.some(o =>
          o.link === novaOferta.link ||
          o.titulo === novaOferta.titulo
        );

        if (jaExiste) continue;

        ofertasEncontradas.push(novaOferta);
        adicionadasNestaRodada++;

        console.log("[SHOPEE] Nova oferta Shopee:", {
          titulo: novaOferta.titulo,
          preco: novaOferta.precoAtual,
          desconto: desconto + "%"
        });

        if (adicionadasNestaRodada >= limitePorRodada) {
          console.log("[SHOPEE] Limite Shopee atingido");
          break;
        }

        await new Promise(r =>
          setTimeout(r, 3000 + Math.random() * 4000)
        );

      } catch (e) {
        console.log("[ERRO] [SHOPEE] erro item Shopee:", e.message);
      }
    }

    const ofertasFiltradas = aplicarFiltrosUniversais(
      ofertasEncontradas,
      {
        preferirEnvioBrasil: false,
        bloquearSemImagem: true,
        bloquearSemPreco: true,
      }
    );

    console.log(
      `🧠 Ofertas Shopee após filtros universais: ${ofertasFiltradas.length}`
    );

   for (const oferta of ofertasFiltradas) {
   await distribuirOfertaParaClientes(oferta);
   }

    console.log(`[SHOPEE] Shopee finalizado. Adicionadas: ${adicionadasNestaRodada}`);

  } catch (e) {
    console.log("[ERRO] [SHOPEE] erro farejador Shopee:", e.message);
  }
}

module.exports = {
  farejarShopee
};
