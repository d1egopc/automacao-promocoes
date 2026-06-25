// ================= FAREJADOR SHOPEE =================

const {
  extrairCuponsShopeeDoHtml,
  detectarAvisoCupomShopee,
  escolherCupomParaOfertaShopee
} = require("./cupons");

function normalizarPrecoShopee(valor) {
  if (valor === null || valor === undefined || valor === "") return "";

  const texto = String(valor).trim();

  if (/^\d+$/.test(texto)) {
    const centavos = Number(texto);
    return Number.isFinite(centavos) && centavos > 0
      ? (centavos / 100).toFixed(2).replace(".", ",")
      : "";
  }

  const decimalInteiro = texto.match(/^(\d+)[.,]0+$/);
  if (decimalInteiro) {
    const centavos = Number(decimalInteiro[1]);
    return Number.isFinite(centavos) && centavos > 0
      ? (centavos / 100).toFixed(2).replace(".", ",")
      : "";
  }

  if (/^\d+\.\d+$/.test(texto)) {
    return Number(texto).toFixed(2).replace(".", ",");
  }

  return texto
    .replace("R$", "")
    .replace(/\s+/g, "")
    .trim();
}

function numeroPrecoShopee(valor) {
  const preco = normalizarPrecoShopee(valor);
  const numero = Number(String(preco || "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(numero) && numero > 0 ? numero : 0;
}

function diagnosticarVariacaoPrecoShopee(precoMin = "", precoMax = "") {
  const minNumero = numeroPrecoShopee(precoMin);
  const maxNumero = numeroPrecoShopee(precoMax);

  if (!minNumero || !maxNumero || maxNumero <= minNumero) {
    return {
      precoMin,
      precoMax: precoMax || precoMin,
      temVariacaoPreco: false,
      avisoVariacaoPreco: ""
    };
  }

  const diferenca = maxNumero - minNumero;
  const percentual = diferenca / minNumero;

  if (diferenca < 1 || percentual <= 0.03) {
    return {
      precoMin,
      precoMax,
      temVariacaoPreco: false,
      avisoVariacaoPreco: ""
    };
  }

  const variacaoGrande = percentual > 0.2 || diferenca >= 20;

  return {
    precoMin,
    precoMax,
    temVariacaoPreco: true,
    avisoVariacaoPreco: variacaoGrande
      ? `Variacoes de R$ ${precoMin} a R$ ${precoMax}`
      : `A partir de R$ ${precoMin}`
  };
}

async function farejarShopee(clienteId = "admin", deps = {}) {
  const {
    config,
    getIntegracaoCliente,
    fila,
    prepararOfertaGlobal,
    ofertaJaExiste,
    classificarCategoriaOferta,
    aplicarFiltrosUniversais,
    buscarOfertasShopee,
    normalizarSessaoId,
    distribuirOfertaParaClientes
  } = deps;

  try {
    if (!config?.marketplaces?.shopee?.ativo) {
      console.log("[SHOPEE] Shopee desativada. Farejador ignorado.");
      return;
    }

    if (typeof buscarOfertasShopee !== "function") {
      console.log("[ERRO] [SHOPEE] buscarOfertasShopee ausente no farejador");
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

    const produtos = await buscarOfertasShopee(clienteId, {
      config,
      getIntegracaoCliente
    });

    if (!Array.isArray(produtos)) {
      console.log("[SHOPEE] Shopee nao retornou array");
      return;
    }

    console.log(`[SHOPEE] ${produtos.length} produtos Shopee encontrados`);

    let adicionadasNestaRodada = 0;
    const ofertasEncontradas = [];
    const limitePorRodada = config.marketplaces?.shopee?.limitePorRodada || 10;
    const precoMinimo = config.marketplaces?.shopee?.precoMinimo || 20;

    for (const item of produtos) {
      try {
        const desconto = Number(item.priceDiscountRate || 0);
        const vendas = Number(item.sales || 0);
        const nota = Number(item.ratingStar || 0);
        const precoMin = normalizarPrecoShopee(item.priceMin);
        const precoMax = normalizarPrecoShopee(item.priceMax);
        const precoAtualNumero = numeroPrecoShopee(precoMin || precoMax);
        const variacaoPreco = diagnosticarVariacaoPrecoShopee(precoMin, precoMax);

        console.log("[SHOPEE-PRECO-API]", {
          titulo: item.productName || "",
          priceMin: item.priceMin ?? "",
          priceMax: item.priceMax ?? "",
          precoMin,
          precoMax
        });

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
        if (precoAtualNumero < precoMinimo) continue;
        if (vendas < (estrategiaFarejador.filaCritica ? 5 : 20) && !temBeneficioItem) continue;
        if (nota > 0 && nota < (estrategiaFarejador.filaCritica ? 4.2 : 4.5) && !temBeneficioItem) continue;

        const precoAtual = variacaoPreco.temVariacaoPreco
          ? `${variacaoPreco.precoMin} a ${variacaoPreco.precoMax}`
          : (variacaoPreco.precoMin || variacaoPreco.precoMax || precoMin || precoMax);

        const precoAntigoNumero = desconto > 0
          ? precoAtualNumero / (1 - desconto / 100)
          : 0;
        const precoAntigo = Number.isFinite(precoAntigoNumero) && precoAntigoNumero > precoAtualNumero
          ? precoAntigoNumero.toFixed(2).replace(".", ",")
          : "";

        let novaOferta = {
          nome: item.productName,
          titulo: item.productName,
          preco: precoAtual,
          precoAtual,
          precoAntigo,
          precoMin: variacaoPreco.precoMin,
          precoMax: variacaoPreco.precoMax,
          temVariacaoPreco: variacaoPreco.temVariacaoPreco,
          avisoVariacaoPreco: variacaoPreco.avisoVariacaoPreco,
          priceMinOriginal: item.priceMin ?? "",
          priceMaxOriginal: item.priceMax ?? "",
          precoAntesGlobal: precoAtual,
          linkOriginal: item.productLink || item.offerLink,
          link: item.productLink || item.offerLink,
          linkAfiliado: item.offerLink || item.productLink || "",
          linkFinal: item.offerLink || item.productLink || "",
          imagem: item.imageUrl,
          marketplace: "shopee",
          categoria: "Shopee",
          sessaoId: typeof normalizarSessaoId === "function"
            ? normalizarSessaoId(clienteId, "sessao1")
            : "sessao1",
          status: "pendente",
          clienteId,
          criadoEm: new Date().toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo"
          }),
          cupom: "",
          avisoCupom: temBeneficioItem
            ? "Confira voucher/cupom disponivel na Shopee antes de finalizar."
            : ""
        };

        if (typeof classificarCategoriaOferta === "function") {
          novaOferta.categoria = classificarCategoriaOferta(novaOferta);
        }

        if (typeof prepararOfertaGlobal === "function") {
          novaOferta = prepararOfertaGlobal(novaOferta);
        }

        novaOferta.precoDepoisGlobal = novaOferta.precoAtual || novaOferta.preco || "";

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

        console.log("[SHOPEE-PRECO-ANTES-FILA]", {
          titulo: novaOferta.titulo,
          precoAntesGlobal: novaOferta.precoAntesGlobal,
          precoDepoisGlobal: novaOferta.precoDepoisGlobal,
          precoFinalFila: novaOferta.precoAtual || novaOferta.preco || "",
          priceMinOriginal: novaOferta.priceMinOriginal,
          priceMaxOriginal: novaOferta.priceMaxOriginal
        });

        const jaExiste = typeof ofertaJaExiste === "function"
          ? ofertaJaExiste(novaOferta)
          : Array.isArray(fila) && fila.some(o =>
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

    const ofertasFiltradas = typeof aplicarFiltrosUniversais === "function"
      ? aplicarFiltrosUniversais(
          ofertasEncontradas,
          {
            preferirEnvioBrasil: false,
            bloquearSemImagem: true,
            bloquearSemPreco: true
          }
        )
      : ofertasEncontradas;

    console.log(
      `[SHOPEE] Ofertas Shopee apos filtros universais: ${ofertasFiltradas.length}`
    );

    for (const oferta of ofertasFiltradas) {
      if (typeof distribuirOfertaParaClientes === "function") {
        await distribuirOfertaParaClientes(oferta);
      }
    }

    console.log(`[SHOPEE] Shopee finalizado. Adicionadas: ${adicionadasNestaRodada}`);
  } catch (e) {
    console.log("[ERRO] [SHOPEE] erro farejador Shopee:", e.message);
  }
}

module.exports = {
  farejarShopee
};
