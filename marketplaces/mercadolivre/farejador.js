
const { extrairProdutosBuscaML } = require("./parser");

// ================= FAREJADOR MERCADO LIVRE =================

async function farejarMercadoLivre(clienteId = "admin", deps = {}) {

 const {
  config,
  integracoesPorCliente,
  getIntegracaoCliente,
  fila,
  salvarFila,
  prepararOfertaGlobal,
  ofertaJaExiste,
  classificarCategoriaOferta,
  gerarBuscasGlobais,
  gerarHeadersStealth,
  farejarCuponsMercadoLivre,
  importarMercadoLivre,
  gerarLinkAfiliadoMercadoLivre,
  deveIgnorarOfertaRepetida,
  registrarOfertaVista
  } = deps;

  try {


if (!config.marketplaces?.mercadolivre?.ativo) {
  console.log("⏸ Mercado Livre desativado. Farejador ignorado.");
  return;
}
    console.log("🐶 Farejando ofertas ML (modo stealth)...");

    const buscasPrioritariasML = [
  // 👟 Tênis e calçados
  "tenis masculino promocao",
  "tenis feminino promocao",
  "tenis nike promocao",
  "tenis adidas promocao",
  "tenis olympikus promocao",
  "tenis mizuno promocao",
  "tenis fila promocao",
  "chinelo havaianas promocao",

  // 👕 Moda masculina
  "kit camisetas masculinas",
  "camiseta masculina",
  "camiseta oversized masculina",
  "camisa polo masculina",
  "calca jeans masculina",
  "bermuda masculina",
  "moletom masculino",
  "jaqueta masculina",

  // 👗 Moda feminina
  "blusa feminina",
  "calca jeans feminina",
  "kit calca jeans feminina",
  "legging feminina",
  "conjunto feminino",
  "pijama feminino",
  "moletom feminino",
  "jaqueta feminina",

  // 🌸 Perfumes e beleza
  "perfume masculino promocao",
  "perfume feminino promocao",
  "perfume importado promocao",
  "kit perfume masculino",
  "kit perfume feminino",
  "malbec promocao",
  "natura perfume promocao",
  "boticario perfume promocao",
  "eudora perfume promocao",

  // ❄️ Frio / tendência
  "meia termica",
  "blusa frio masculina",
  "blusa frio feminina",
  "jaqueta corta vento",
  "moletom flanelado",
  "calca moletom",
  "pijama inverno",
  "cobertor casal"
];

const buscasGlobaisExtras = gerarBuscasGlobais(20);

const buscas = [
  ...buscasPrioritariasML,
  ...buscasGlobaisExtras
];

      const limiteBuscas =
      config.marketplaces?.mercadolivre?.limiteBuscasPorRodada || 1;

      const buscasEmbaralhadas = [...buscas].sort(() => Math.random() - 0.5);
      const buscasDaRodada = buscasEmbaralhadas.slice(0, limiteBuscas);

      for (const termo of buscasDaRodada) {
      try {
        const url = `https://lista.mercadolivre.com.br/${encodeURIComponent(termo)}`;

       console.log("🌐 MERCADO LIVRE URL:", url);

const headersML = {
  ...gerarHeadersStealth()
};

const cookiesML =
  integracoesPorCliente?.[clienteId]?.mercadolivre?.credenciais?.cookies;

if (cookiesML) {
  headersML.Cookie = cookiesML;
}

const response = await fetch(url, {
  headers: headersML
});

        console.log("🌐 URL:", url);
        console.log("📡 STATUS:", response.status);

       if (!response.ok) {

      console.log(
    "🛡️ ML bloqueou status:",
    response.status,
    "- parando rodada."
  );

  await new Promise(r => setTimeout(r, 15000));

  return;
}

const html = await response.text(); 

await farejarCuponsMercadoLivre(html);

if (html.includes("suspicious-traffic-frontend")) {
  console.log("🛡️ Mercado Livre bloqueou por tráfego suspeito.");
  return;
}

let cupom = "";
let avisoCupom = "";
        
        console.log("🧪 HTML INICIO:", html.slice(0, 1000));
        
        const cupomMatch =
  html.match(/cupom\s+([A-Z0-9]{4,20})/i) ||
  html.match(/código\s+([A-Z0-9]{4,20})/i) ||
  html.match(/use\s+o\s+cupom\s+([A-Z0-9]{4,20})/i) ||
  html.match(/aplique\s+o\s+cupom\s+([A-Z0-9]{4,20})/i);

if (cupomMatch?.[1]) {
  cupom = cupomMatch[1].trim().toUpperCase();
  avisoCupom = `Aplique o cupom ${cupom} antes de finalizar.`;
} else if (/cupom|código promocional|desconto extra|aplicar desconto/i.test(html)) {
  avisoCupom = "Há possível cupom/desconto extra na página. Confira antes de finalizar.";
}

const compraNoApp =
  /compra\s+no\s+app/i.test(html) ||
  /menor\s+preço\s+no\s+app/i.test(html) ||
  /app\s+garante/i.test(html) ||
  /desconto\s+no\s+app/i.test(html);

if (compraNoApp && !cupom) {
  cupom = "VER NO APP";
  avisoCupom = "📱 Confira pelo app do Mercado Livre, pode aparecer menor valor ou desconto exclusivo.";
}

const produtosBusca = extrairProdutosBuscaML(html).slice(0, 8);

console.log("🚨 ML PRODUTOS BUSCA RESUMO:", produtosBusca.map(p => ({
  titulo: p.titulo,
  precoAtual: p.precoAtual,
  link: p.link
})));

console.log("🔎 Busca ML:", {
  termo,
  produtos: produtosBusca.length
});

for (const itemBusca of produtosBusca) {
  try {
    const link = itemBusca.link;

    if (!link) continue;

let produto = await importarMercadoLivre(
  link,
  clienteId,
  {
    getIntegracaoCliente,
    gerarLinkAfiliadoMercadoLivre
  }
);

if (!produto) {
  console.log("⏭️ ML importador vazio, pulando:", link);
  continue;
}

if (
  !produto.precoAtual ||
  produto.precoAtual === "R$ 0,00" ||
  produto.precoAtual === "R$ 0,0"
) {
  console.log("⏭️ ML ignorado sem preço válido:", produto.titulo || link);
  continue;
}

  titulo: produto.titulo,
  precoAtual: produto.precoAtual,
  precoAntigo: produto.precoAntigo,
  imagem: !!produto.imagem,
  link: produto.linkOriginal
});

    if (!produto.precoAtual && itemBusca.precoAtual) {
      produto.precoAtual = itemBusca.precoAtual;
    }

    if (!produto.precoAntigo && itemBusca.precoAntigo) {
      produto.precoAntigo = itemBusca.precoAntigo;
    }

    if (!produto.titulo && itemBusca.titulo) {
      produto.titulo = itemBusca.titulo;
    }

    if (!produto.imagem && itemBusca.imagem) {
      produto.imagem = itemBusca.imagem;
    }

    if (!produto.linkOriginal) {
      produto.linkOriginal = link;
    }

console.log("🧪 PRECO ML:", {
  titulo: produto.titulo,
  precoAtual: produto.precoAtual,
  tipo: typeof produto.precoAtual
});

    const precoNumero = Number(
      String(produto.precoAtual)
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

    if (precoNumero < (config.marketplaces?.mercadolivre?.precoMinimo || 25)) continue;

   const descontoMinimoML =
  config.marketplaces?.mercadolivre?.descontoMinimo ?? 10;

if (
  desconto < descontoMinimoML &&
  !produto.avisoCupom &&
  !produto.linkAfiliado
) {
  console.log("⏭️ ML ignorado por desconto baixo:", {
    titulo: produto.titulo,
    desconto: Math.round(desconto) + "%",
    descontoMinimoML
  });
  continue;
}

    const tituloLower = String(produto.titulo || "").toLowerCase();

    if (
      tituloLower.includes("refil") ||
      tituloLower.includes("amostra") ||
      tituloLower.includes("mini") ||
      tituloLower.includes("teste")
    ) continue;


if (
  produto.imagem &&
  (
    produto.imagem.includes("logo_large") ||
    produto.imagem.includes("ml-web-navigation") ||
    produto.imagem.includes("mercadolibre/logo")
  )
) {
  produto.imagem = "";
}

if (["COPIADO", "APPLIED", "APPEARANCE", "APPLINK"].includes(produto.cupom)) {
  produto.cupom = "";
  produto.avisoCupom = "";
}

const categoriaProduto =
  classificarCategoriaOferta(
    produto,
    termo
  );


    let novaOferta = {
      id: `ml_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      nome: produto.titulo,
      titulo: produto.titulo,
      preco: produto.precoAtual,
      precoAtual: produto.precoAtual,
      precoAntigo: produto.precoAntigo || "",
      cupom: produto.cupom || "",
      avisoCupom: produto.avisoCupom || "",
      parcelamento: produto.parcelamento || "",
      link: produto.linkAfiliado || produto.linkOriginal || link,
      linkAfiliado: produto.linkAfiliado || produto.linkOriginal || link,
      imagem: produto.imagem || "",
      marketplace: "mercadolivre",
      categoria: categoriaProduto,
      sessaoId: "sessao1",
      status: "pendente",
      clienteId
    };

    novaOferta = prepararOfertaGlobal(novaOferta);

console.log("📦 Oferta ML pronta:", {
  titulo: novaOferta.titulo,
  preco: novaOferta.precoAtual,
  categoria: novaOferta.categoria
});

 const jaExiste = ofertaJaExiste(novaOferta);

if (jaExiste) {
  console.log("♻️ Oferta ML ignorada (duplicada):", novaOferta.titulo);
}

   if (!jaExiste) {

  if (deveIgnorarOfertaRepetida(novaOferta)) {
    console.log("🧠 ML ignorado pela memória:", novaOferta.titulo);
    continue;
  }

  novaOferta.status = novaOferta.status || "pendente";
  novaOferta.statusDetalhe = novaOferta.statusDetalhe || "Na fila";

  registrarOfertaVista(novaOferta);

  fila.push(novaOferta);

  salvarFila(clienteId);

console.log("🤖 Nova oferta ML:", {
  titulo: novaOferta.titulo,
  preco: novaOferta.precoAtual,
  desconto: Math.round(desconto) + "%",
  categoria: novaOferta.categoria
});
    }

    await new Promise(r =>
      setTimeout(r, 4000 + Math.random() * 4000)
    );

  } catch (e) {
    console.log("❌ erro produto ML:", e.message);
  }
}

         await new Promise(r =>
         setTimeout(r, 4000 + Math.random() * 6000)
        );

      } catch (e) {
        console.log("❌ erro busca ML:", e.message);
      }
    }

  } catch (e) {
    console.log("❌ erro farejador ML:", e.message);
  }
}


module.exports = {
  farejarMercadoLivre
};
