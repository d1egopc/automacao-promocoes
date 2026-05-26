// ================= FAREJADOR SHOPEE =================

async function farejarShopee(clienteId = "admin", deps = {}) {
  
const {
  config,
  integracoesPorCliente,
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
      console.log("⏸ Shopee desativada. Farejador ignorado.");
      return;
    }

    console.log("🛍️ Farejando ofertas Shopee...");

    const produtos = await buscarOfertasShopee();

    if (!Array.isArray(produtos)) {
      console.log("❌ Shopee não retornou array");
      return;
    }

    console.log(`🔎 ${produtos.length} produtos Shopee encontrados`);

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

        if (desconto < (config.marketplaces?.shopee?.descontoMinimo || 15)) continue;
        if (!precoAtualNumero) continue;
        if (precoAtualNumero < (config.marketplaces?.shopee?.precoMinimo || 20)) continue;
        if (vendas < 20) continue;
        if (nota > 0 && nota < 4.5) continue;

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
  avisoCupom: "🎟️ Confira cupons disponíveis na página antes de finalizar."
};

        novaOferta = prepararOfertaGlobal(novaOferta);

        const jaExiste = fila.some(o =>
          o.link === novaOferta.link ||
          o.titulo === novaOferta.titulo
        );

        if (jaExiste) continue;

        ofertasEncontradas.push(novaOferta);
        adicionadasNestaRodada++;

        console.log("🛍️ Nova oferta Shopee:", {
          titulo: novaOferta.titulo,
          preco: novaOferta.precoAtual,
          desconto: desconto + "%"
        });

        if (adicionadasNestaRodada >= limitePorRodada) {
          console.log("🛑 Limite Shopee atingido");
          break;
        }

        await new Promise(r =>
          setTimeout(r, 3000 + Math.random() * 4000)
        );

      } catch (e) {
        console.log("❌ erro item Shopee:", e.message);
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

    console.log(`✅ Shopee finalizado. Adicionadas: ${adicionadasNestaRodada}`);

  } catch (e) {
    console.log("❌ erro farejador Shopee:", e.message);
  }
}

module.exports = {
  farejarShopee
};
