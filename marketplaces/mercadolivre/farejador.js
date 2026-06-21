
const { extrairProdutosBuscaML } = require("./parser");

let obterCuponsMLCliente = async () => [];
let escolherCupomParaOfertaML = () => null;

try {
  ({
    obterCuponsMLCliente,
    escolherCupomParaOfertaML
  } = require("./cupons"));
} catch (e) {
  console.log("[ERRO] [ML-CUPOM]", {
    erro: e.message
  });
}

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
  console.log("[INFO] [ML] Mercado Livre desativado. Farejador ignorado.");
  return;
}
    console.log("[INFO] [ML] Farejando ofertas ML");
    const estrategiaFarejador =
      typeof deps.obterEstrategiaFarejador === "function"
        ? deps.obterEstrategiaFarejador(clienteId, "mercadolivre")
        : {
            descontoMinimo: config.marketplaces?.mercadolivre?.descontoMinimo ?? 10,
            aceitarBeneficioSemDesconto: true
          };
    const temBeneficioFarejador =
      typeof deps.ofertaTemBeneficioFarejador === "function"
        ? deps.ofertaTemBeneficioFarejador
        : (oferta) => Boolean(oferta?.cupom || oferta?.avisoCupom || oferta?.beneficioExtra);

    const buscasPrioritariasML = [
  // ðŸ‘Ÿ TÃªnis e calÃ§ados
  "tenis masculino promocao",
  "tenis feminino promocao",
  "tenis nike promocao",
  "tenis adidas promocao",
  "tenis olympikus promocao",
  "tenis mizuno promocao",
  "tenis fila promocao",
  "chinelo havaianas promocao",

  // ðŸ‘• Moda masculina
  "kit camisetas masculinas",
  "camiseta masculina",
  "camiseta oversized masculina",
  "camisa polo masculina",
  "calca jeans masculina",
  "bermuda masculina",
  "moletom masculino",
  "jaqueta masculina",

  // ðŸ‘— Moda feminina
  "blusa feminina",
  "calca jeans feminina",
  "kit calca jeans feminina",
  "legging feminina",
  "conjunto feminino",
  "pijama feminino",
  "moletom feminino",
  "jaqueta feminina",

  // ðŸŒ¸ Perfumes e beleza
  "perfume masculino promocao",
  "perfume feminino promocao",
  "perfume importado promocao",
  "kit perfume masculino",
  "kit perfume feminino",
  "malbec promocao",
  "natura perfume promocao",
  "boticario perfume promocao",
  "eudora perfume promocao",

  // â„ï¸ Frio / tendÃªncia
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

      const limiteBuscasBase = Number(
        const produtosBusca = extrairProdutosBuscaML(html).slice(0, 12);
      ) || 1;
      const limiteBuscas = estrategiaFarejador.filaCritica
        ? Math.max(limiteBuscasBase, 4)
        : estrategiaFarejador.filaBaixa
          ? Math.max(limiteBuscasBase, 2)
          : limiteBuscasBase;

      const buscasEmbaralhadas = [...buscas].sort(() => Math.random() - 0.5);
      const buscasDaRodada = buscasEmbaralhadas.slice(0, limiteBuscas);

      for (const termo of buscasDaRodada) {
      try {
        const url = `https://lista.mercadolivre.com.br/${encodeURIComponent(termo)}`;


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


       if (!response.ok) {

      console.log("[AVISO] [ML] Bloqueou status:", response.status);

  await new Promise(r => setTimeout(r, 15000));

  return;
}

const html = await response.text(); 

await farejarCuponsMercadoLivre(html);

if (html.includes("suspicious-traffic-frontend")) {
  console.log("[AVISO] [ML] Trafego suspeito");
  return;
}

let cupom = "";
let avisoCupom = "";
        
        const cupomMatch =
  html.match(/cupom\s+([A-Z0-9]{4,20})/i) ||
  html.match(/cÃ³digo\s+([A-Z0-9]{4,20})/i) ||
  html.match(/use\s+o\s+cupom\s+([A-Z0-9]{4,20})/i) ||
  html.match(/aplique\s+o\s+cupom\s+([A-Z0-9]{4,20})/i);

if (cupomMatch?.[1]) {
  cupom = cupomMatch[1].trim().toUpperCase();
  avisoCupom = `Aplique o cupom ${cupom} antes de finalizar.`;
} else if (/cupom|cÃ³digo promocional|desconto extra|aplicar desconto/i.test(html)) {
  avisoCupom = "HÃ¡ possÃ­vel cupom/desconto extra na pÃ¡gina. Confira antes de finalizar.";
}

const compraNoApp =
  /compra\s+no\s+app/i.test(html) ||
  /menor\s+preÃ§o\s+no\s+app/i.test(html) ||
  /app\s+garante/i.test(html) ||
  /desconto\s+no\s+app/i.test(html);

if (compraNoApp && !cupom) {
  cupom = "VER NO APP";
  avisoCupom = "ðŸ“± Confira pelo app do Mercado Livre, pode aparecer menor valor ou desconto exclusivo.";
}

const produtosBusca = extrairProdutosBuscaML(html).slice(0, 8);

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
  console.log("[AVISO] [ML] Importador vazio:", link);
  continue;
}

if (
  !produto.precoAtual ||
  produto.precoAtual === "R$ 0,00" ||
  produto.precoAtual === "R$ 0,0"
) {
  console.log("[AVISO] [ML] Ignorado sem preco valido:", produto.titulo || link);
  continue;
}
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


    
    const linkAfiliadoML = String(produto.linkAfiliado || produto.linkFinal || produto.link || "").trim();
    const linkOriginalML = String(produto.linkOriginal || link || "").trim();

    if (!linkAfiliadoML || linkAfiliadoML === linkOriginalML) {
      console.log("[AVISO] [ML] Ignorado sem link afiliado do cliente:", {
        clienteId,
        titulo: produto.titulo || itemBusca.titulo || "",
        linkOriginal: linkOriginalML
      });
      continue;
    }

    produto.linkAfiliado = linkAfiliadoML;
    produto.linkFinal = linkAfiliadoML;

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
  estrategiaFarejador.descontoMinimo ?? config.marketplaces?.mercadolivre?.descontoMinimo ?? 10;

if (
  desconto < descontoMinimoML &&
  !temBeneficioFarejador(produto) &&
  !cupom &&
  !avisoCupom
) {
  console.log("[AVISO] [ML] Ignorado por desconto baixo:", {
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
      cupom: produto.cupom || cupom || "",
      avisoCupom: produto.avisoCupom || avisoCupom || "",
      parcelamento: produto.parcelamento || "",
      linkOriginal: produto.linkOriginal || link,
      link: produto.linkAfiliado,
      linkAfiliado: produto.linkAfiliado,
      linkFinal: produto.linkAfiliado,
      imagem: produto.imagem || "",
      marketplace: "mercadolivre",
      categoria: categoriaProduto,
      sessaoId: "sessao1",
      status: "pendente",
      clienteId
    };

    novaOferta = prepararOfertaGlobal(novaOferta);

try {
  const cuponsML = await obterCuponsMLCliente(clienteId, cookiesML || "");
  const cupomOferta = escolherCupomParaOfertaML(novaOferta, cuponsML);

  if (cupomOferta?.cupom) {
    novaOferta.cupom = cupomOferta.cupom;
    novaOferta.tipoCupom = cupomOferta.tipoCupom || "";
    novaOferta.avisoCupom = cupomOferta.avisoCupom || novaOferta.avisoCupom || "";

  } else if (cupomOferta?.avisoCupom) {
    novaOferta.tipoCupom = cupomOferta.tipoCupom || "";
    novaOferta.avisoCupom = cupomOferta.avisoCupom;
  }

  if (cupomOferta) {
    console.log("[ML-CUPOM-OFERTA]", {
      titulo: novaOferta.titulo,
      cupom: cupomOferta.cupom || "",
      score: cupomOferta.cupomConfianca || 0,
      tipo: cupomOferta.tipoCupom || ""
    });
  }
} catch (e) {
  console.log("[ERRO] [ML-CUPOM]", {
    erro: e.message
  });
}

console.log("[ML-OFERTA]", {
  titulo: novaOferta.titulo,
  preco: novaOferta.precoAtual,
  categoria: novaOferta.categoria,
  desconto: Math.round(desconto) + "%"
});

 const jaExiste = ofertaJaExiste(novaOferta);

if (jaExiste) {
  console.log("[AVISO] [ML] Oferta duplicada:", novaOferta.titulo);
}

   if (!jaExiste) {

  if (deveIgnorarOfertaRepetida(novaOferta)) {
    console.log("[AVISO] [ML] Ignorado pela memoria:", novaOferta.titulo);
    continue;
  }

  novaOferta.status = novaOferta.status || "pendente";
  novaOferta.statusDetalhe = novaOferta.statusDetalhe || "Na fila";

  registrarOfertaVista(novaOferta);

  fila.push(novaOferta);

  salvarFila(clienteId);

    }

    await new Promise(r =>
      setTimeout(r, 4000 + Math.random() * 4000)
    );

  } catch (e) {
    console.log("[ERRO] [ML] erro produto:", e.message);
  }
}

         await new Promise(r =>
         setTimeout(r, 4000 + Math.random() * 6000)
        );

      } catch (e) {
        console.log("[ERRO] [ML] erro busca:", e.message);
      }
    }

  } catch (e) {
    console.log("[ERRO] [ML] erro farejador:", e.message);
  }
}


module.exports = {
  farejarMercadoLivre
};
