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

    console.log("🧪 KABUM DETALHE:", {
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
  console.log("⚠️ Erro ao validar detalhe KaBuM:", e.message);
}

let linkAfiliado = produto.link;

console.log("🧪 gerarDeepLinkAwin recebido?", typeof gerarDeepLinkAwin);

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

if (typeof importarProdutoKabumViaAwin === "function" && produto.link) {
  const produtoImportado = await importarProdutoKabumViaAwin(
    produto.link,
    clienteId
  );

  if (produtoImportado?.precoAtual) {
    produto = {
      ...produto,
      ...produtoImportado
    };
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

if (typeof deps?.importarProdutoKabumViaAwin !== "function") {
  console.log("⚠️ importarProdutoKabumViaAwin não recebido no farejador KaBuM");
} else {

try {
  const urlOriginalKabum =
    produto.linkOriginal || produto.url || produto.link;

  console.log("🧪 ENRIQUECENDO KABUM:", {
    urlOriginalKabum,
    clienteId
  });

 const detalhes = await deps.importarProdutoKabumViaAwin(
  urlOriginalKabum,
  clienteId,
  {
    gerarDeepLinkAwin: deps.gerarDeepLinkAwin
  }
);

console.log("🧪 DETALHES KABUM:", detalhes);


  novaOferta.nome = detalhes.titulo || novaOferta.nome;
  novaOferta.titulo = detalhes.titulo || novaOferta.titulo;
  novaOferta.preco = detalhes.precoAtual || novaOferta.preco;
  novaOferta.precoAtual = detalhes.precoAtual || novaOferta.precoAtual;
  novaOferta.precoAntigo = detalhes.precoAntigo || novaOferta.precoAntigo;
  novaOferta.avisoCupom = detalhes.avisoCupom || novaOferta.avisoCupom;
  novaOferta.avisoPagamento = detalhes.avisoPagamento || novaOferta.avisoPagamento;
  novaOferta.parcelamento = detalhes.parcelamento || novaOferta.parcelamento;
  novaOferta.imagem = detalhes.imagem || novaOferta.imagem;
  novaOferta.link = detalhes.linkAfiliado || novaOferta.link;
  novaOferta.linkAfiliado = detalhes.linkAfiliado || novaOferta.linkAfiliado;

  console.log("✅ KABUM ENRIQUECIDA:", {
    titulo: novaOferta.titulo,
    precoAtual: novaOferta.precoAtual,
    parcelamento: novaOferta.parcelamento,
    avisoCupom: novaOferta.avisoCupom
  });

} catch (e) {
  console.log("⚠️ Falha ao enriquecer KaBuM:", e.message);
}

}

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

console.log("🧪 KABUM jaExiste?", {
  jaExiste: jaExisteKabum,
  titulo: novaOferta.titulo,
  link: novaOferta.link
});

if (!jaExisteKabum) {
  fila.push(novaOferta);
  salvarFila();

    console.log("🧡 Nova oferta KaBuM:", {
      titulo: novaOferta.titulo,
      preco: novaOferta.precoAtual,
      link: novaOferta.link
    });

} else {
  console.log("⏭️ KaBuM duplicado ignorado:", novaOferta.titulo);
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