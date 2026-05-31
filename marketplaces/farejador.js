const { gerarBuscasAliExpress } = require("./buscas");

const {
  buscarProdutosAliExpressAPI
} = require("./api");

// ================= FAREJADOR ALIEXPRESS MODULAR =================

async function farejarAliExpress(clienteId = "admin", deps = {}) {
  const {
    config,
    integracoesPorCliente,
    fila,
    salvarFila,
    prepararOfertaGlobal,
    ofertaJaExiste,
    classificarCategoriaOferta,
    aplicarFiltrosUniversais,
    gerarBuscasGlobais,
    distribuirOfertaParaClientes,
    encurtarUrl
  } = deps;

  try {
    console.log("🛒 Farejando ofertas AliExpress modular...", { clienteId });

    const cfg = config.marketplaces?.aliexpress || {};

    if (!cfg.ativo) {
      console.log("⏸ AliExpress desativado. Farejador ignorado.");
      return [];
    }

    const integracao =
      integracoesPorCliente?.[clienteId]?.aliexpress ||
      integracoesPorCliente?.admin?.aliexpress;

    if (!integracao?.credenciais) {
      console.log("❌ AliExpress sem integração configurada:", clienteId);
      return [];
    }

    const limitePorRodada = cfg.limitePorRodada || 5;

const buscas = gerarBuscasAliExpress({
  gerarBuscasGlobais
});

const buscasBrasil = buscas.brasil || [];
const buscasInternacionais = buscas.internacional || [];

console.log(
  "🔎 Buscas AliExpress Brasil:",
  buscasBrasil.slice(0, 10)
);

console.log(
  "🔎 Buscas AliExpress Internacional:",
  buscasInternacionais.slice(0, 10)
);

   const produtosEncontrados = [];

for (const termo of buscasBrasil) {
  try {
    if (produtosEncontrados.length >= limitePorRodada) break;

    console.log("🇧🇷 Busca AliExpress API:", termo);

    const produtosAPI = await buscarProdutosAliExpressAPI(
      termo,
      integracao.credenciais,
      {
        page: 1,
        limit: 20
      }
    );

    console.log(`🔎 ${termo}: ${produtosAPI.length} produtos AliExpress via API`);

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
       
        console.log("🔗 ALI LINKS:", {
        short: item.promotion_link_short,
        normal: item.promotion_link
        });
       
        if (!linkAfiliadoOriginal) continue;

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

        if (!precoNumero || !Number.isFinite(precoNumero)) continue;

        const precoMinimo = Number(cfg.precoMinimo) || 0;
        const descontoMinimo = Number(cfg.descontoMinimo) || 0;

        if (precoNumero < precoMinimo) continue;
        if (desconto < descontoMinimo) continue;

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

let linkFinal = linkAfiliadoOriginal;

// Se AliExpress já mandar link curto oficial, usa ele
if (
  item.promotion_link_short ||
  String(linkAfiliadoOriginal).includes("s.click.aliexpress.com")
) {
  linkFinal =
    item.promotion_link_short ||
    linkAfiliadoOriginal;
}
       

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
  console.log("🚫 AliExpress bloqueado por palavra:", titulo);
  continue;
}

        let novaOferta = {
          nome: titulo,
          titulo,
          preco: precoAtual,
          precoAtual,
          precoAntigo: precoAntigo || "",
          cupom: "",
          avisoCupom:
          desconto > 0
          ? `${Math.round(desconto)}% OFF no AliExpress.`
          : "",
          parcelamento: "",
          link: linkFinal,
          linkOriginal,
          linkAfiliado: linkFinal,
          imagem: corrigirImagemAli(imagem),
          marketplace: "aliexpress",
          categoria,
          categoriaProduto: categoria,
          status: "pendente",
          clienteId
        };

        if (typeof prepararOfertaGlobal === "function") {
          novaOferta = prepararOfertaGlobal(novaOferta);
        }

        if (typeof ofertaJaExiste === "function" && ofertaJaExiste(novaOferta)) {
          console.log("⏭️ AliExpress já existe:", titulo);
          continue;
        }

        produtosEncontrados.push(novaOferta);

        console.log("🤖 Nova oferta AliExpress API:", {
          titulo: novaOferta.titulo,
          preco: novaOferta.precoAtual,
          precoAntigo: novaOferta.precoAntigo,
          desconto: Math.round(desconto) + "%",
          link: novaOferta.linkAfiliado?.slice(0, 80)
        });

        await new Promise(r => setTimeout(r, 3000));
      } catch (e) {
        console.log("❌ erro produto AliExpress API:", e.message);
      }
    }

    await new Promise(r => setTimeout(r, 5000));
  } catch (e) {
    console.log("❌ erro busca AliExpress API:", termo, e.message);
  }
}

    // Por enquanto só estrutura inicial
    console.log("✅ AliExpress modular carregado com sucesso.");

for (const oferta of produtosEncontrados) {
  fila.push(oferta);
}

salvarFila();

console.log("✅ AliExpress ofertas enviadas para fila:", produtosEncontrados.length);

   
return produtosEncontrados;

  } catch (e) {
    console.log("❌ erro farejador AliExpress modular:", e.message);
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