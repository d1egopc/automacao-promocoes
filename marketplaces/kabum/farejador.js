const { gerarBuscasKabum } =
require("./buscas");

const { extrairProdutosKabum } =
require("./parser");

// ================= FAREJADOR KABUM =================

async function farejarKabum(clienteId = "admin", deps = {}) {
  const {
    config,
    integracoesPorCliente,
    fila,
    salvarFila,
    prepararOfertaGlobal,
    ofertaJaExiste,
    classificarCategoriaOferta,
    aplicarFiltrosUniversais,
    gerarHeadersStealth,
    encurtarUrl,
    gerarDeepLinkAwin
  } = deps;

  try {
    console.log("🧡 Farejando KaBuM stealth...", { clienteId });

const cfg = config.marketplaces?.kabum || {};

    if (!cfg.ativo) {
      console.log("⏸ KaBuM desativada. Farejador ignorado.");
      return [];
    }

const buscas = gerarBuscasKabum();

console.log("🔎 Buscas KaBuM:", buscas.slice(0, 10));

for (const termo of buscas.slice(0, 3)) {

  try {

    const slug =
      encodeURIComponent(termo);

    const url =
      `https://www.kabum.com.br/busca/${slug}`;

    console.log("🌐 KABUM URL:", url);

    const response = await fetch(url, {
      headers: {
        ...gerarHeadersStealth(),
        "Referer": "https://www.google.com/"
      }
    });

    console.log("📡 KABUM STATUS:", response.status);

    if (!response.ok) {
      console.log("🛡️ KaBuM bloqueou:", response.status);
      continue;
    }

    const html = await response.text();

    console.log(
      "🧪 HTML KABUM tamanho:",
      html.length
    );

    console.log(
      "🧪 HTML KABUM trecho:",
      html.slice(0, 500)
    );

console.log(
  "🧪 PRECO KABUM:",
  html.match(/price["']?\s*:\s*["']?[0-9.,]+/i)?.[0]
);

console.log(
  "🧪 IMAGE KABUM:",
  html.match(/https:\/\/images\.kabum\.com\.br[^"]+/i)?.[0]
);

    const produtos =
  extrairProdutosKabum(html);

   console.log(
  "📦 Produtos KaBuM encontrados:",
  produtos.length
);


for (const produto of produtos.slice(0, cfg.limitePorRodada || 2)) {

  const titulo = produto.titulo;

  if (!titulo) continue;

let linkAfiliado = produto.link;

if (typeof gerarDeepLinkAwin === "function") {
  try {
    linkAfiliado =
      await gerarDeepLinkAwin(
        produto.link,
        clienteId
      );

    console.log(
      "🔗 DeepLink Awin KaBuM:",
      linkAfiliado
    );

  } catch (e) {
    console.log(
      "⚠️ Erro DeepLink Awin:",
      e.message
    );
  }
}

let novaOferta = {
  id: `kabum_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  nome: produto.titulo,
  titulo: produto.titulo,
  preco: produto.precoAtual || "R$ 0,00",
  precoAtual: produto.precoAtual || "R$ 0,00",
  precoAntigo: produto.precoAntigo || "",
  cupom: "",
  avisoCupom: "",
  parcelamento: "",
  link: produto.link,
  linkAfiliado,
  imagem: produto.imagem || "",
  marketplace: "kabum",
  categoria: classificarCategoriaOferta(produto, termo),
  sessaoId: "sessao1",
  status: "pendente",
  clienteId
};

  novaOferta = prepararOfertaGlobal(novaOferta);

  if (!ofertaJaExiste(novaOferta)) {
    fila.push(novaOferta);
    salvarFila();

    console.log("🧡 Nova oferta KaBuM:", {
      titulo: novaOferta.titulo,
      preco: novaOferta.precoAtual,
      link: novaOferta.link
    });
  }
}

    await new Promise(r =>
      setTimeout(
        r,
        3000 + Math.random() * 4000
      )
    );

  } catch (e) {

    console.log(
      "❌ erro busca KaBuM:",
      e.message
    );

  }

}

    
    const integracaoAwin =
      integracoesPorCliente?.[clienteId]?.awin ||
      integracoesPorCliente?.admin?.awin;

    if (!integracaoAwin?.credenciais) {
      console.log("⚠️ KaBuM sem Awin configurada para gerar afiliado:", clienteId);
    }

    console.log("✅ KaBuM modular carregado com sucesso.");

    return [];
  } catch (e) {
    console.log("❌ erro farejador KaBuM:", e.message);
    return [];
  }
}

module.exports = farejarKabum;