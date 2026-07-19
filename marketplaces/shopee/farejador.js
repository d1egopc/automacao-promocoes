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

  let normalizado = texto
    .replace("R$", "")
    .replace(/\s+/g, "")
    .replace(/[^\d.,]/g, "")
    .trim();

  if (normalizado.includes(",") && normalizado.includes(".")) {
    normalizado = normalizado.replace(/\./g, "").replace(",", ".");
  } else if (normalizado.includes(",")) {
    normalizado = normalizado.replace(",", ".");
  }

  const numero = Number(normalizado);
  return Number.isFinite(numero) && numero > 0
    ? numero.toFixed(2).replace(".", ",")
    : texto
      .replace("R$", "")
      .replace(/\s+/g, "")
      .trim();
}

function numeroPrecoShopee(valor) {
  const preco = normalizarPrecoShopee(valor);
  const numero = Number(String(preco || "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(numero) && numero > 0 ? numero : 0;
}


function normalizarTextoShopeeLocal(texto = "") {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensTituloShopee(oferta = {}) {
  const texto = normalizarTextoShopeeLocal(
    oferta.titulo || oferta.nome || oferta.productName || ""
  );
  const stopwords = new Set([
    "produto", "shopee", "original", "oficial", "promocao", "promo",
    "kit", "combo", "para", "com", "sem", "uma", "uns", "das", "dos",
    "por", "de", "da", "do", "em", "no", "na", "ao", "aos", "as",
    "os", "un", "und", "novo", "nova", "loja"
  ]);

  return texto
    .split(" ")
    .filter(token => token.length >= 3 && !stopwords.has(token))
    .slice(0, 8);
}

function chaveTituloShopee(oferta = {}) {
  return tokensTituloShopee(oferta).slice(0, 5).join(" ");
}

function titulosParecidosShopee(a = {}, b = {}) {
  const tokensA = tokensTituloShopee(a);
  const tokensB = tokensTituloShopee(b);
  if (!tokensA.length || !tokensB.length) return false;

  const setB = new Set(tokensB);
  const intersecao = tokensA.filter(token => setB.has(token)).length;
  const menor = Math.min(tokensA.length, tokensB.length);
  return intersecao >= Math.max(2, Math.ceil(menor * 0.7));
}

function precoNumeroOfertaShopee(oferta = {}) {
  return numeroPrecoShopee(oferta.precoAtual || oferta.preco || oferta.precoMin || "");
}

function cupomResumoShopee(oferta = {}) {
  return normalizarTextoShopeeLocal([
    oferta.cupom,
    oferta.tipoCupom,
    oferta.avisoCupom,
    oferta.cupomUrl
  ].filter(Boolean).join(" "));
}

function temCupomShopeeOferta(oferta = {}) {
  return Boolean(cupomResumoShopee(oferta));
}

function dataMsShopee(valor) {
  if (!valor) return 0;
  const direto = Date.parse(valor);
  if (Number.isFinite(direto)) return direto;

  const match = String(valor).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return 0;

  const [, dia, mes, ano, hora, minuto, segundo = "0"] = match;
  const data = new Date(
    Number(ano),
    Number(mes) - 1,
    Number(dia),
    Number(hora),
    Number(minuto),
    Number(segundo)
  );

  const ms = data.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function encontrarShopeeRecente(fila = [], clienteId, oferta = {}) {
  const limiteMs = Date.now() - 8 * 60 * 60 * 1000;
  let maisRecente = null;

  for (const item of Array.isArray(fila) ? fila : []) {
    if (String(item.marketplace || "").toLowerCase() !== "shopee") continue;
    if (item.clienteId && String(item.clienteId) !== String(clienteId)) continue;
    if (!titulosParecidosShopee(item, oferta)) continue;

    const criadoMs = dataMsShopee(
      item.criadoEm || item.dataCriacao || item.emFilaEm || item.atualizadoEm || item.createdAt
    );
    if (!criadoMs || criadoMs < limiteMs) continue;
    if (!maisRecente || criadoMs > maisRecente.criadoMs) {
      maisRecente = { oferta: item, criadoMs };
    }
  }

  return maisRecente;
}

function podeRepetirShopeeAntesCooldown(oferta = {}, anterior = null) {
  if (!anterior?.oferta) return true;

  const precoAtual = precoNumeroOfertaShopee(oferta);
  const precoAnterior = precoNumeroOfertaShopee(anterior.oferta);
  if (precoAtual && precoAnterior && precoAtual <= precoAnterior * 0.9) {
    return true;
  }

  const cupomAtual = cupomResumoShopee(oferta);
  const cupomAnterior = cupomResumoShopee(anterior.oferta);
  return Boolean(cupomAtual && cupomAtual !== cupomAnterior);
}

function scoreBalanceamentoShopee(oferta = {}) {
  const preco = precoNumeroOfertaShopee(oferta);
  const desconto = Number(oferta.descontoPercentualShopee || 0);
  let score = Number(oferta.score || 0);

  if (temCupomShopeeOferta(oferta)) score += 120;
  if (desconto > 0) score += desconto * 3;
  if (oferta.imagem) score += 15;
  if (String(oferta.titulo || "").length >= 18) score += 10;
  if (oferta.temBeneficioShopee) score += 20;
  if (preco > 0) score += Math.max(0, 300 - Math.min(preco, 300)) / 3;

  return score;
}

function motivoPrincipalShopee(contadores = {}) {
  const pares = [
    ["cooldown", contadores.ignoradosCooldown || 0],
    ["categoria", contadores.ignoradosCategoria || 0],
    ["titulo_parecido", contadores.ignoradosTitulo || 0],
    ["limite_rodada", contadores.ignoradosLimiteRodada || 0]
  ];
  pares.sort((a, b) => b[1] - a[1]);
  return pares[0][1] > 0 ? pares[0][0] : "nenhum";
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

    const ofertasEncontradas = [];
    const limiteConfigurado = Number(config.marketplaces?.shopee?.limitePorRodada || 4) || 4;
    const limitePorRodada = Math.min(4, limiteConfigurado);
    const limiteCandidatosShopee = Math.max(limitePorRodada * 6, 24);
    const precoMinimo = config.marketplaces?.shopee?.precoMinimo || 20;

    for (const item of produtos) {
      if (ofertasEncontradas.length >= limiteCandidatosShopee) break;
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
            : "",
          descontoPercentualShopee: desconto,
          vendasShopee: vendas,
          notaShopee: nota,
          temBeneficioShopee: temBeneficioItem
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

        console.log("[SHOPEE] Candidato Shopee:", {
          titulo: novaOferta.titulo,
          preco: novaOferta.precoAtual,
          desconto: desconto + "%"
        });

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

    const ofertasOrdenadas = [...ofertasFiltradas].sort((a, b) => {
      const scoreDiff = scoreBalanceamentoShopee(b) - scoreBalanceamentoShopee(a);
      if (scoreDiff) return scoreDiff;
      return precoNumeroOfertaShopee(a) - precoNumeroOfertaShopee(b);
    });

    const balanceamento = {
      ignoradosCooldown: 0,
      ignoradosCategoria: 0,
      ignoradosTitulo: 0,
      ignoradosLimiteRodada: 0
    };
    const categoriasRodada = new Map();
    const titulosRodada = [];
    const ofertasBalanceadas = [];

    for (const oferta of ofertasOrdenadas) {
      if (ofertasBalanceadas.length >= limitePorRodada) {
        balanceamento.ignoradosLimiteRodada++;
        continue;
      }

      const categoria = String(oferta.categoria || "Shopee");
      const totalCategoria = categoriasRodada.get(categoria) || 0;
      if (totalCategoria >= 2) {
        balanceamento.ignoradosCategoria++;
        continue;
      }

      if (titulosRodada.some(item => titulosParecidosShopee(item, oferta))) {
        balanceamento.ignoradosTitulo++;
        continue;
      }

      const recente = encontrarShopeeRecente(fila, clienteId, oferta);
      if (recente && !podeRepetirShopeeAntesCooldown(oferta, recente)) {
        balanceamento.ignoradosCooldown++;
        continue;
      }

      ofertasBalanceadas.push(oferta);
      categoriasRodada.set(categoria, totalCategoria + 1);
      titulosRodada.push(oferta);
    }

    let adicionadasNestaRodada = 0;
    for (const oferta of ofertasBalanceadas) {
      if (typeof distribuirOfertaParaClientes === "function") {
        await distribuirOfertaParaClientes(oferta);
      }
      adicionadasNestaRodada++;
    }

    console.log("[SHOPEE-BALANCEAMENTO]", {
      clienteId,
      encontrados: produtos.length,
      aprovados: ofertasBalanceadas.length,
      adicionados: adicionadasNestaRodada,
      ignoradosCooldown: balanceamento.ignoradosCooldown,
      ignoradosCategoria: balanceamento.ignoradosCategoria,
      ignoradosTitulo: balanceamento.ignoradosTitulo,
      ignoradosLimiteRodada: balanceamento.ignoradosLimiteRodada,
      motivoPrincipal: motivoPrincipalShopee(balanceamento)
    });

    console.log("[SHOPEE] Shopee finalizado. Adicionadas: " + adicionadasNestaRodada);
  } catch (e) {
    console.log("[ERRO] [SHOPEE] erro farejador Shopee:", e.message);
  }
}

module.exports = {
  farejarShopee
};
