// ================= FAREJADOR AMAZON =================

async function farejarAmazon(clienteId = "admin", deps = {}) {

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
    gerarHeadersStealth,
    normalizarSessaoId,
    distribuirOfertaParaClientes,
    encurtarUrl
  } = deps;

 try {

    if (!config.marketplaces?.amazon?.ativo) {
      console.log("⏸ Amazon desativada. Farejador ignorado.");
      return;
    }

    console.log("🐶 Farejando ofertas Amazon...");
  
  
    let adicionadasNestaRodada = 0;
    let ofertasEncontradas = [];
    
    const limitePorRodada =
    config.marketplaces?.amazon?.limitePorRodada || 5;

    const buscas = gerarBuscasGlobais(
    config.marketplaces?.amazon?.limiteBuscas || 30
    );

    for (const termo of buscas) {
      const url = `https://www.amazon.com.br/s?k=${encodeURIComponent(termo)}&rh=p_n_deal_type%3A23565492011`;

      console.log("🌐 AMAZON URL:", url);

      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Accept-Language":
            "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
        }
      });

      console.log("📡 AMAZON STATUS:", response.status);

      if (!response.ok) {
      console.log("⚠️ Amazon recusou essa busca:", response.status);
      continue;
      }

   const html = await response.text();


    if (!html || html.length < 5000) {
    console.log("⚠️ HTML Amazon muito pequeno ou inválido.");
    continue;
    }
   
      const linksExtraidos = [
  ...html.matchAll(/href="([^"]*\/dp\/[A-Z0-9]{10}[^"]*)"/g),
  ...html.matchAll(/href="([^"]*\/gp\/product\/[A-Z0-9]{10}[^"]*)"/g)
]
  .map(m => m[1])
  .map(link => {
    let limpo = String(link)
      .replace(/&amp;/g, "&")
      .split("?")[0];

    if (limpo.startsWith("/")) {
      limpo = "https://www.amazon.com.br" + limpo;
    }

    return limpo;
  })
  .filter(link =>
    link.includes("amazon.com.br") &&
    !link.includes("/sspa/") &&
    !link.includes("/gp/slredirect")
  );

const links = [...new Set(linksExtraidos)].slice(0, 3);

for (const link of links) {
  try {
  
const produto = await importarAmazon(
  link,
  integracoesPorCliente[clienteId]?.amazon
  );

    console.log("🧪 PRODUTO AMAZON:", {
      titulo: produto.titulo,
      precoAtual: produto.precoAtual,
      precoAntigo: produto.precoAntigo,
      cupom: produto.cupom,
      avisoCupom: produto.avisoCupom
    });

 const precoNumero = Number(
  String(produto.precoAtual || "")
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim()
);

const precoAntigoNumero = Number(
  String(produto.precoAntigo || "")
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim()
);

const desconto =
  precoAntigoNumero > precoNumero
    ? ((precoAntigoNumero - precoNumero) / precoAntigoNumero) * 100
    : 0;

if (!precoNumero || !Number.isFinite(precoNumero)) continue;
if (precoNumero < 30) continue;
if (desconto < 15 && !produto.avisoCupom) continue;

const clienteId = clienteIdAlvo || "admin";

let novaOferta = {
  nome: produto.titulo,
  titulo: produto.titulo,
  preco: produto.precoAtual,
  precoAtual: produto.precoAtual,
  precoAntigo: produto.precoAntigo || "",
  cupom: produto.cupom || "",
  avisoCupom: produto.avisoCupom || "",
  parcelamento: produto.parcelamento || "",
  linkOriginal: produto.linkOriginal || link,
  link: produto.linkOriginal || link,
  linkAfiliado: "",
  imagem: produto.imagem || "",
  marketplace: "amazon",
  categoria: "Amazon",
  sessaoId: normalizarSessaoId(clienteId, "sessao1"),
  status: "pendente",
  clienteId
};

novaOferta = prepararOfertaGlobal(novaOferta);

const jaExiste = ofertaJaExiste(novaOferta);

if (!jaExiste) {

  novaOferta.criadoEm =
    novaOferta.criadoEm ||
    new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo"
    });

  ofertasEncontradas.push(novaOferta);

  adicionadasNestaRodada++;

  console.log("🛒 Nova oferta Amazon:", {
    titulo: novaOferta.titulo,
    preco: novaOferta.precoAtual
  });

  console.log("🤖 Nova oferta Amazon:", {
    titulo: novaOferta.titulo,
    preco: novaOferta.precoAtual,
    precoAntigo: novaOferta.precoAntigo,
    desconto: Math.round(desconto) + "%",
    cupom: novaOferta.cupom,
    avisoCupom: novaOferta.avisoCupom
  });

  if (adicionadasNestaRodada >= limitePorRodada) {
    console.log("🛑 Limite Amazon por rodada atingido");
    break;
  }
}

  console.log("🤖 Nova oferta Amazon:", {
    titulo: novaOferta.titulo,
    preco: novaOferta.precoAtual,
    precoAntigo: novaOferta.precoAntigo,
    desconto: Math.round(desconto) + "%",
    cupom: novaOferta.cupom,
    avisoCupom: novaOferta.avisoCupom
  });
}

      await new Promise(r =>
      setTimeout(r, 3000 + Math.random() * 5000)
    );

  } catch (e) {
    console.log("❌ erro produto Amazon:", e.message);
  }
} // fecha for (const link of links)

} // fecha for (const termo of buscas)

const ofertasFiltradas =
  aplicarFiltrosUniversais(ofertasEncontradas);

console.log(
  `🧠 Ofertas Amazon após filtros universais: ${ofertasFiltradas.length}`
);

for (const oferta of ofertasFiltradas) {
  await distribuirOfertaParaClientes(oferta);
}

console.log(
  `✅ Amazon finalizado. Adicionadas: ${ofertasFiltradas.length}`
);

} catch (e) {
  console.log("❌ erro farejador Amazon:", e.message);
}
}

module.exports = {
  farejarAmazon
};
