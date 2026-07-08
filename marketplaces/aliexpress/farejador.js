const { gerarBuscasAliExpress } = require("./buscas");

const {
  buscarProdutosAliExpressAPI,
  gerarLinkCurtoAliExpress
} = require("./api");
const { avaliarLimiteFilaHotfix } = require("../../utils/performance-hotfix");

// ================= FAREJADOR ALIEXPRESS MODULAR =================

async function farejarAliExpress(clienteId = "admin", deps = {}) {
  const {
    config,
    integracoesPorCliente,
    getIntegracaoCliente,
    fila,
    salvarFila,
    prepararOfertaGlobal,
    ofertaJaExiste,
    deveIgnorarOfertaRepetida,
    registrarOfertaVista,
    classificarCategoriaOferta,
    aplicarFiltrosUniversais,
    gerarBuscasGlobais,
    distribuirOfertaParaClientes,
    encurtarUrl,
    registrarAbastecimento
  } = deps;

  try {
    console.log("[INFO] Farejando ofertas AliExpress modular...", { clienteId });

    const cfg = config.marketplaces?.aliexpress || {};

    if (!cfg.ativo) {
      console.log("[AVISO] AliExpress desativado. Farejador ignorado.");
      return [];
    }

  const integracao = typeof getIntegracaoCliente === "function"
    ? getIntegracaoCliente(clienteId, "aliexpress")
    : integracoesPorCliente?.[clienteId]?.aliexpress;

    if (!integracao?.credenciais) {
      console.log("[AVISO] AliExpress sem integracao configurada:", {
        clienteId,
        origemIntegracao: typeof getIntegracaoCliente === "function" ? "getIntegracaoCliente" : "integracoesPorCliente"
      });
      return [];
    }

    const limitePorRodada = cfg.limitePorRodada || 5;
    const estrategiaFarejador =
      typeof deps.obterEstrategiaFarejador === "function"
        ? deps.obterEstrategiaFarejador(clienteId, "aliexpress")
        : {
            descontoMinimo: Number(cfg.descontoMinimo) || 0,
            aceitarBeneficioSemDesconto: true
          };
    const temBeneficioFarejador =
      typeof deps.ofertaTemBeneficioFarejador === "function"
        ? deps.ofertaTemBeneficioFarejador
        : (oferta) => Boolean(oferta?.cupom || oferta?.avisoCupom || oferta?.beneficioExtra);

const buscas = gerarBuscasAliExpress({
  gerarBuscasGlobais
});

const buscasBrasil = buscas.brasil || [];
const buscasInternacionais = buscas.internacional || [];

const buscasBrasilRodada = [...buscasBrasil]
  .sort(() => Math.random() - 0.5)
  .slice(0, 10);

const buscasInternacionaisRodada = [...buscasInternacionais]
  .sort(() => Math.random() - 0.5)
  .slice(0, 5);

console.log(
  "🔎 Buscas AliExpress Brasil:",
  buscasBrasil.slice(0, 10)
);

console.log(
  "🔎 Buscas AliExpress Internacional:",
  buscasInternacionais.slice(0, 10)
);

   const produtosEncontrados = [];


for (const termo of buscasBrasilRodada) {
  
try {
    if (produtosEncontrados.length >= limitePorRodada) break;

    console.log("[INFO] Busca AliExpress API:", termo);

    const produtosAPI = await buscarProdutosAliExpressAPI(
      termo,
      integracao.credenciais,
      {
        page: 1,
        limit: 20
      }
    );

    console.log(`[INFO] ${termo}: ${produtosAPI.length} produtos AliExpress via API`);
    if (typeof registrarAbastecimento === "function") registrarAbastecimento("encontradas", { quantidade: produtosAPI.length });

    for (const item of produtosAPI) {
      try {
        if (produtosEncontrados.length >= limitePorRodada) break;

        const titulo =
          item.product_title ||
          item.title ||
          item.product_subject ||
          "Produto AliExpress";

        const linkOriginal =
          item.product_detail_url ||
          item.product_url ||
          item.target_sale_url ||
          "";

        const linkAfiliadoOriginal =
        item.promotion_link_short ||
        item.promotion_link ||
        linkOriginal;
       
        console.log("[INFO] ALI LINKS:", {
        short: item.promotion_link_short,
        normal: item.promotion_link
        });
       
        if (!linkAfiliadoOriginal) {
          if (typeof registrarAbastecimento === "function") registrarAbastecimento("recusada", { motivo: "sem_link_afiliado" });
          continue;
        }

        const precoAtual =
          limparPrecoAli(
            item.target_sale_price ||
            item.sale_price ||
            item.app_sale_price ||
            item.target_app_sale_price ||
            item.target_min_sale_price ||
            item.min_sale_price ||
            ""
          );

        const precoAntigo =
          limparPrecoAli(
            item.target_original_price ||
            item.original_price ||
            item.product_original_price ||
            ""
          );

        const precoNumero = Number(
          String(precoAtual || "")
            .replace("R$", "")
            .replace(/\./g, "")
            .replace(",", ".")
            .trim()
        );

        const precoAntigoNumero = Number(
          String(precoAntigo || "")
            .replace("R$", "")
            .replace(/\./g, "")
            .replace(",", ".")
            .trim()
        );

        const descontoTexto =
          item.discount ||
          item.discount_rate ||
          item.evaluate_rate ||
          "";

        const desconto =
          precoAntigoNumero > precoNumero
            ? ((precoAntigoNumero - precoNumero) / precoAntigoNumero) * 100
            : Number(String(descontoTexto).replace(/\D/g, "")) || 0;

        if (!precoNumero || !Number.isFinite(precoNumero)) {
          if (typeof registrarAbastecimento === "function") registrarAbastecimento("recusada", { motivo: "sem_preco" });
          continue;
        }

        const precoMinimo = Number(cfg.precoMinimo) || 0;
        const descontoMinimo = Number(estrategiaFarejador.descontoMinimo) || 0;
        const beneficioAli = Boolean(
          item.coupon_info ||
          item.coupon ||
          item.shop_coupon ||
          item.seller_coupon ||
          item.promotion_link ||
          item.promotion_link_short
        );

        if (precoNumero < precoMinimo) {
          if (typeof registrarAbastecimento === "function") registrarAbastecimento("recusada", { motivo: "desconto_baixo" });
          continue;
        }
        if (desconto < descontoMinimo && !beneficioAli) {
          if (typeof registrarAbastecimento === "function") registrarAbastecimento("recusada", { motivo: "desconto_baixo" });
          continue;
        }

        const imagem =
          item.product_main_image_url ||
          item.image_url ||
          item.product_small_image_urls?.string?.[0] ||
          item.product_small_image_urls?.[0] ||
          "";

        const categoria =
          item.first_level_category_name ||
          item.second_level_category_name ||
          "AliExpress";

let linkFinal =
  await gerarLinkCurtoAliExpress(
    linkAfiliadoOriginal,
    integracao.credenciais
  );

console.log("[INFO] LINK FINAL ALI:", linkFinal);       

const tituloLower = String(titulo || "").toLowerCase();

const palavrasBloqueadasAli = [
  // moda/calçados
  "sapato",
  "sandália",
  "sandalia",
  "salto",
  "stiletto",
  "casamento",
  "wedding",
  "bridal",

  // beleza
  "unha",
  "cabelo",
  "peruca",
  "bolsa",
  "sutiã",
  "calcinha",

  // adesivos
  "adesivo",
  "adesivos",
  "decalque",
  "decalques",
  "vinil",

  // acessórios femininos
  "mary jane",
  "ankle strap",
  "bodycon"
];

if (palavrasBloqueadasAli.some(p => tituloLower.includes(p))) {
  console.log("[AVISO] AliExpress bloqueado por palavra:", titulo);
  if (typeof registrarAbastecimento === "function") registrarAbastecimento("recusada", { motivo: "categoria" });
  continue;
}

const categoriaDetectada =
  typeof classificarCategoriaOferta === "function"
    ? classificarCategoriaOferta({
        titulo,
        nome: titulo,
        categoria
      })
    : categoria;

        let novaOferta = {
          nome: titulo,
          titulo,
          preco: precoAtual,
          precoAtual,
          precoAntigo: precoAntigo || "",
          cupom: "",
          avisoCupom:
          beneficioAli
          ? "Confira cupom/moedas/desconto do vendedor no AliExpress."
          : desconto > 0
          ? `${Math.round(desconto)}% OFF no AliExpress.`
          : "",
          parcelamento: "",
          link: linkFinal,
          linkOriginal,
          linkAfiliado: linkFinal,
          imagem: corrigirImagemAli(imagem),
          marketplace: "aliexpress",
          categoria: categoriaDetectada,
          categoriaProduto: categoria,
          status: "pendente",
          clienteId
        };

        if (temBeneficioFarejador(novaOferta)) {
          novaOferta.tipoCupom = novaOferta.tipoCupom || "provavel";
        }

       if (typeof prepararOfertaGlobal === "function") {

  console.log("[INFO] ANTES PREPARAR:", {
    link: novaOferta.link,
    linkAfiliado: novaOferta.linkAfiliado
  });

  novaOferta = prepararOfertaGlobal(novaOferta);

  console.log("[INFO] DEPOIS PREPARAR:", {
    link: novaOferta.link,
    linkAfiliado: novaOferta.linkAfiliado
  });

}

        if (typeof ofertaJaExiste === "function" && ofertaJaExiste(novaOferta)) {
          console.log("[INFO] AliExpress j existe:", titulo);
          if (typeof registrarAbastecimento === "function") registrarAbastecimento("recusada", { motivo: "duplicada" });
          continue;
        }

        if (typeof registrarAbastecimento === "function") registrarAbastecimento("importada");
        produtosEncontrados.push(novaOferta);

        console.log("[INFO] Nova oferta AliExpress API:", {
          titulo: novaOferta.titulo,
          preco: novaOferta.precoAtual,
          precoAntigo: novaOferta.precoAntigo,
          desconto: Math.round(desconto) + "%",
          link: novaOferta.linkAfiliado?.slice(0, 80)
        });

        await new Promise(r => setTimeout(r, 3000));
      } catch (e) {
        console.log("[ERRO] erro produto AliExpress API:", e.message);
      }
    }

    await new Promise(r => setTimeout(r, 5000));
  } catch (e) {
    console.log("[ERRO] erro busca AliExpress API:", termo, e.message);
  }
}

    // Por enquanto só estrutura inicial
    console.log("[OK] AliExpress modular carregado com sucesso.");

let adicionadasNaFila = 0;

for (const oferta of produtosEncontrados) {

  if (deveIgnorarOfertaRepetida(oferta)) {
    console.log("[AVISO] AliExpress ignorado pela memria:", oferta.titulo);
    if (typeof registrarAbastecimento === "function") registrarAbastecimento("recusada", { motivo: "memoria_repetida" });
    continue;
  }

  oferta.status = oferta.status || "pendente";
  oferta.statusDetalhe = oferta.statusDetalhe || "Na fila";

  registrarOfertaVista(oferta);

  const limiteFila = avaliarLimiteFilaHotfix(fila, oferta, clienteId);
  if (!limiteFila.permitido) {
    console.log("[PERFORMANCE-FILA-LIMITE]", {
      clienteId,
      origem: "farejador_aliexpress",
      pendentes: limiteFila.pendentes,
      motivo: limiteFila.motivo,
      prioridade: limiteFila.prioridade,
      cupomForte: limiteFila.cupomForte,
      titulo: oferta.titulo || oferta.nome || ""
    });
    continue;
  }

  fila.push(oferta);
  if (typeof registrarAbastecimento === "function") registrarAbastecimento("adicionada");

  adicionadasNaFila++;
}

if (adicionadasNaFila > 0) {
  salvarFila(clienteId);
  console.log("[PERFORMANCE-FILA-SAVES]", {
    clienteId,
    origem: "farejador_aliexpress",
    savesEvitados: Math.max(0, adicionadasNaFila - 1),
    alteracoes: adicionadasNaFila
  });
}

console.log("[FILA] AliExpress ofertas enviadas para fila:", produtosEncontrados.length);
console.log("[PERFORMANCE-RODADA-RESUMO]", {
  runner: "farejador_aliexpress",
  clienteId,
  adicionadas: adicionadasNaFila,
  encontradas: produtosEncontrados.length
});

   
return produtosEncontrados;

  } catch (e) {
    console.log("[ERRO] erro farejador AliExpress modular:", e.message);
    return [];
  }
}


function limparPrecoAli(valor) {
  if (!valor) return "";

  return String(valor)
    .replace("R$", "")
    .replace(/\s/g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "")
    .trim();
}

function corrigirImagemAli(url = "") {
  if (!url) return "";
  if (url.startsWith("//")) return "https:" + url;
  return url;
}

module.exports = {
  farejarAliExpress
};
