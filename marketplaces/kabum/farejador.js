const { gerarBuscasKabum } =
require("./buscas");

const {
  extrairProdutosKabum,
  extrairDetalheProdutoKabum
} = require("./parser");

// ================= FAREJADOR KABUM =================

async function farejarKabum(clienteId = "admin", deps = {}) {
    const {
    config,
    integracoesPorCliente,
    fila,
    salvarFila,
    prepararOfertaGlobal,
    ofertaJaExiste,
    deveIgnorarOfertaRepetida,
    registrarOfertaVista,
    classificarCategoriaOferta,
    aplicarFiltrosUniversais,
    gerarHeadersStealth,
    encurtarUrl,
    gerarDeepLinkAwin,
    importarProdutoKabumViaAwin
  } = deps;

  try {
    console.log("[INFO] Farejando KaBuM stealth...", { clienteId });

const cfg = config.marketplaces?.kabum || {};

    if (!cfg.ativo) {
      console.log("[AVISO] KaBuM desativada. Farejador ignorado.");
      return [];
    }

const buscas = gerarBuscasKabum();

console.log("[INFO] Buscas KaBuM:", buscas.slice(0, 10));

for (const termo of buscas.slice(0, cfg.limiteBuscas || 8)) {

  try {

    const slug =
      encodeURIComponent(termo);

    const url =
      `https://www.kabum.com.br/busca/${slug}`;

    console.log("[INFO] KABUM URL:", url);

    const response = await fetch(url, {
      headers: {
        ...gerarHeadersStealth(),
        "Referer": "https://www.google.com/"
      }
    });

    console.log("[INFO] KABUM STATUS:", response.status);

    if (!response.ok) {
      console.log("[AVISO] KaBuM bloqueou:", response.status);
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


for (let produto of produtos.slice(0, cfg.limitePorRodada || 2)) {
  
const titulo = produto.titulo;

  if (!titulo) continue;

try {
  const respDetalhe = await fetch(produto.link, {
    headers: {
      ...gerarHeadersStealth(),
      "Referer": "https://www.kabum.com.br/"
    }
  });

  if (respDetalhe.ok) {
    const htmlDetalhe = await respDetalhe.text();
    const detalhe = extrairDetalheProdutoKabum(htmlDetalhe);

    console.log("[INFO] KABUM DETALHE:", {
      titulo: produto.titulo,
      precoLista: produto.precoAtual,
      precoDetalhe: detalhe.precoAtual,
      link: produto.link
    });

    if (detalhe.precoAtual) {
      produto.precoAtual = detalhe.precoAtual;
    }

    if (detalhe.imagem) {
      produto.imagem = detalhe.imagem;
    }
  }
} catch (e) {
  console.log("[ERRO] Erro ao validar detalhe KaBuM:", e.message);
}

let linkAfiliado = produto.link;

console.log("[INFO] gerarDeepLinkAwin recebido?", typeof gerarDeepLinkAwin);

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

console.log("[API] CHECK IMPORTADOR:", {
  tipo: typeof importarProdutoKabumViaAwin,
  link: produto.link
});

if (typeof importarProdutoKabumViaAwin === "function" && produto.link) {
  const produtoImportado = await importarProdutoKabumViaAwin(
    produto.link,
    clienteId,
    {
      gerarDeepLinkAwin
    }
  );

  console.log("[API] PRODUTO IMPORTADO KABUM:", {
    titulo: produtoImportado?.titulo,
    precoAtual: produtoImportado?.precoAtual,
    avisoPagamento: produtoImportado?.avisoPagamento,
    avisoCupom: produtoImportado?.avisoCupom,
    parcelamento: produtoImportado?.parcelamento,
    linkAfiliado: produtoImportado?.linkAfiliado
  });

  if (produtoImportado?.precoAtual) {
    produto = {
      ...produto,
      ...produtoImportado
    };

    console.log("[INFO] PRODUTO FINAL KABUM:", {
      titulo: produto.titulo,
      precoAtual: produto.precoAtual,
      avisoPagamento: produto.avisoPagamento,
      avisoCupom: produto.avisoCupom,
      parcelamento: produto.parcelamento,
      linkAfiliado: produto.linkAfiliado
    });
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
  avisoCupom: produto.avisoPagamento || "💳 Com desconto à vista no PIX.",
  parcelamento: produto.parcelamento || "",
  link: produto.link,
  linkAfiliado,
  imagem: produto.imagem || "",
  marketplace: "kabum",
  categoria: classificarCategoriaOferta(produto, termo),
  sessaoId: "sessao1",
  status: "pendente",
  clienteId
};


const textoCategoriaKabum = `${novaOferta.titulo || ""} ${termo || ""}`.toLowerCase();

if (
  textoCategoriaKabum.includes("placa mae") ||
  textoCategoriaKabum.includes("placa mãe") ||
  textoCategoriaKabum.includes("placa de video") ||
  textoCategoriaKabum.includes("placa de vídeo") ||
  textoCategoriaKabum.includes("processador") ||
  textoCategoriaKabum.includes("memoria ram") ||
  textoCategoriaKabum.includes("memória ram") ||
  textoCategoriaKabum.includes("ssd") ||
  textoCategoriaKabum.includes("gabinete") ||
  textoCategoriaKabum.includes("water cooler") ||
  textoCategoriaKabum.includes("fonte")
) {
  novaOferta.categoria = "Gamer e Hardware";
}

  novaOferta = prepararOfertaGlobal(novaOferta);

 const jaExisteKabum = ofertaJaExiste(novaOferta);

console.log("[INFO] KaBuM duplicidade:", {
  jaExiste: jaExisteKabum,
  titulo: novaOferta.titulo
});

if (!jaExisteKabum) {

  if (deveIgnorarOfertaRepetida(novaOferta)) {
    console.log("[AVISO] KaBuM ignorado pela memria:", novaOferta.titulo);
    continue;
  }

  novaOferta.status = novaOferta.status || "pendente";
  novaOferta.statusDetalhe = novaOferta.statusDetalhe || "Na fila";

  registrarOfertaVista(novaOferta);

  fila.push(novaOferta);

  salvarFila(clienteId);

  console.log("[INFO] Nova oferta KaBuM:", {

      titulo: novaOferta.titulo,
      preco: novaOferta.precoAtual,
      link: novaOferta.link
    });

} else {
  console.log("[AVISO] KaBuM duplicado ignorado:", novaOferta.titulo);
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
  integracoesPorCliente?.[clienteId]?.awin;

    if (!integracaoAwin?.credenciais) {
      console.log("[AVISO] KaBuM sem Awin configurada para gerar afiliado:", clienteId);
    }

    console.log("[OK] KaBuM modular carregado com sucesso.");

    return [];
  } catch (e) {
    console.log("[ERRO] erro farejador KaBuM:", e.message);
    return [];
  }
}

module.exports = farejarKabum;