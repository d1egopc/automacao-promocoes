const { gerarBuscasAmazon } =
  require("./buscas");

const {
  extrairLinksAmazon
} = require("./parser");

const {
  extrairCuponsAmazonDoHtml,
  detectarAvisoCupomAmazon,
  escolherCupomParaOfertaAmazon
} = require("./cupons");

async function buscarHtmlCupomAmazon(url, integracao = {}) {
  try {
    const cookies = integracao?.credenciais?.cookies || "";
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cookie": cookies
      }
    });

    if (!response.ok) {
      console.log("[AMZ-CUPOM] HTML produto indisponivel:", response.status);
      return "";
    }

    return await response.text();
  } catch (e) {
    console.log("[ERRO] [AMZ-CUPOM] erro HTML produto:", e.message);
    return "";
  }
}

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
  encurtarUrl,
  importarAmazon
} = deps;

const buscas = gerarBuscasAmazon({
  gerarBuscasGlobais
}).slice(0, 5);

console.log("[AMZ] DENTRO FAREJADOR:", typeof importarAmazon);

 try {
    if (!config.marketplaces?.amazon?.ativo) {
      console.log("[AMZ] Amazon desativada. Farejador ignorado.");
      return;
    }

    console.log("[AMZ] Farejando ofertas Amazon...");
    const estrategiaFarejador =
      typeof deps.obterEstrategiaFarejador === "function"
        ? deps.obterEstrategiaFarejador(clienteId, "amazon")
        : {
            descontoMinimo: 15,
            aceitarBeneficioSemDesconto: true
          };
    const temBeneficioFarejador =
      typeof deps.ofertaTemBeneficioFarejador === "function"
        ? deps.ofertaTemBeneficioFarejador
        : (oferta) => Boolean(oferta?.cupom || oferta?.avisoCupom || oferta?.beneficioExtra);
  
  
    let adicionadasNestaRodada = 0;
    let ofertasEncontradas = [];
    
    const limitePorRodada =
    config.marketplaces?.amazon?.limitePorRodada || 5;

    
    for (const termo of buscas) {
      const url = `https://www.amazon.com.br/s?k=${encodeURIComponent(termo)}&rh=p_n_deal_type%3A23565492011`;

      console.log("[AMZ] AMAZON URL:", url);

      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Accept-Language":
            "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
        }
      });

      console.log("[AMZ] AMAZON STATUS:", response.status);

      if (!response.ok) {
      console.log("[AMZ] Amazon recusou essa busca:", response.status);
      if (typeof registrarAbastecimento === "function") registrarAbastecimento("recusada", { motivo: "bloqueio_http" });
      continue;
      }

   const html = await response.text();


    if (!html || html.length < 5000) {
    console.log("[AMZ] HTML Amazon muito pequeno ou invlido.");
    continue;
    }
   
const links =
  extrairLinksAmazon(html)
    .slice(0, 2);
if (typeof registrarAbastecimento === "function") registrarAbastecimento("encontradas", { quantidade: links.length });

for (const link of links) {
  try {
  
const integracaoAmazon = integracoesPorCliente[clienteId]?.amazon;
const produto = await importarAmazon(
  link,
  integracaoAmazon
  );

    console.log("[AMZ] PRODUTO AMAZON:", {
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

console.log("[AMZ] AMAZON FILTRO:", {
  titulo: produto.titulo,
  precoAtual: produto.precoAtual,
  precoAntigo: produto.precoAntigo,
  precoNumero,
  precoAntigoNumero,
  desconto: Math.round(desconto),
  avisoCupom: produto.avisoCupom,
  link: produto.linkAfiliado
});

if (!precoNumero || !Number.isFinite(precoNumero)) {
  console.log("[AMZ] Amazon sem preo vlido:", produto.titulo);
  if (typeof registrarAbastecimento === "function") registrarAbastecimento("recusada", { motivo: "sem_preco" });
  continue;
}

if (precoNumero < 30) {
  console.log("[AMZ] Amazon preo baixo:", produto.titulo, precoNumero);
  if (typeof registrarAbastecimento === "function") registrarAbastecimento("recusada", { motivo: "desconto_baixo" });
  continue;
}

if (desconto < estrategiaFarejador.descontoMinimo && !temBeneficioFarejador(produto)) {
  console.log("[AMZ] Amazon desconto baixo:", {
    titulo: produto.titulo,
    desconto: Math.round(desconto),
    descontoMinimo: estrategiaFarejador.descontoMinimo,
    avisoCupom: produto.avisoCupom
  });
  if (typeof registrarAbastecimento === "function") registrarAbastecimento("recusada", { motivo: "desconto_baixo" });
  continue;
}


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
  link: produto.linkAfiliado || produto.link || produto.linkOriginal || link,
  linkAfiliado: produto.linkAfiliado || produto.link || produto.linkOriginal || link,
  imagem: produto.imagem || "",
  marketplace: "amazon",
  categoria: "Amazon",
  sessaoId: normalizarSessaoId(clienteId, "sessao1"),
  status: "pendente",
  clienteId
};

let htmlCupomAmazon = "";

if (desconto >= 15 || produto.avisoCupom || produto.cupom) {
  htmlCupomAmazon = await buscarHtmlCupomAmazon(
    produto.linkOriginal || link,
    integracaoAmazon
  );
}

if (htmlCupomAmazon) {
  const cuponsAmazon = extrairCuponsAmazonDoHtml(htmlCupomAmazon);
  const avisoAmazon = detectarAvisoCupomAmazon(htmlCupomAmazon);
  const dadosCuponsAmazon = avisoAmazon
    ? [...cuponsAmazon, avisoAmazon]
    : cuponsAmazon;
  const cupomOfertaAmazon = escolherCupomParaOfertaAmazon(
    novaOferta,
    dadosCuponsAmazon
  );

  if (cupomOfertaAmazon?.cupom) {
    novaOferta.cupom = cupomOfertaAmazon.cupom;
    novaOferta.tipoCupom = cupomOfertaAmazon.tipoCupom || "";
    novaOferta.avisoCupom =
      cupomOfertaAmazon.avisoCupom || novaOferta.avisoCupom || "";
  } else if (cupomOfertaAmazon?.avisoCupom) {
    novaOferta.tipoCupom = cupomOfertaAmazon.tipoCupom || "";
    novaOferta.avisoCupom = cupomOfertaAmazon.avisoCupom;
  }

  if (cupomOfertaAmazon) {
    novaOferta.valorCupom = cupomOfertaAmazon.valorCupom || cupomOfertaAmazon.cupomValor || "";
    novaOferta.percentualCupom = cupomOfertaAmazon.percentualCupom || cupomOfertaAmazon.cupomPercentual || "";
    novaOferta.descontoPix = cupomOfertaAmazon.descontoPix || "";
    novaOferta.descontoApp = cupomOfertaAmazon.descontoApp || "";
    novaOferta.beneficioExtra = cupomOfertaAmazon.beneficioExtra || "";
  }
}

novaOferta = prepararOfertaGlobal(novaOferta);

console.log("[AMZ] AMAZON OFERTA PRONTA PARA DISTRIBUIO:", {
  titulo: novaOferta.titulo,
  link: novaOferta.link,
  linkAfiliado: novaOferta.linkAfiliado
});

if (typeof registrarAbastecimento === "function") registrarAbastecimento("importada");

novaOferta.criadoEm =
  novaOferta.criadoEm ||
  new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });

ofertasEncontradas.push(novaOferta);

adicionadasNestaRodada++;

console.log("[AMZ] Nova oferta Amazon:", {
  titulo: novaOferta.titulo,
  preco: novaOferta.precoAtual
});

console.log("[AMZ] Nova oferta Amazon:", {
  titulo: novaOferta.titulo,
  preco: novaOferta.precoAtual,
  precoAntigo: novaOferta.precoAntigo,
  desconto: Math.round(desconto) + "%",
  cupom: novaOferta.cupom,
  avisoCupom: novaOferta.avisoCupom
});

if (adicionadasNestaRodada >= limitePorRodada) {
  console.log("[AMZ] Limite Amazon por rodada atingido");
  break;
}


      await new Promise(r =>
      setTimeout(r, 3000 + Math.random() * 5000)
    );

  } catch (e) {
    console.log("[ERRO] [AMZ] erro produto Amazon:", e.message);
  }
} // fecha for (const link of links)

} // fecha for (const termo of buscas)

const ofertasFiltradas =
  aplicarFiltrosUniversais(ofertasEncontradas);


let adicionadasDistribuidas = 0;
console.log(
  `Ã°Å¸Â§Â  Ofertas Amazon apÃƒÂ³s filtros universais: ${ofertasFiltradas.length}`
);

for (const oferta of ofertasFiltradas) {
  const distribuicao = await distribuirOfertaParaClientes(oferta);
  adicionadasDistribuidas += Number(distribuicao?.adicionadas || 0) || 0;
}

console.log(
  `Ã¢Å“â€¦ Amazon finalizado. Filtradas: ${ofertasFiltradas.length}. Distribuidas: ${adicionadasDistribuidas}`
);

return {
  marketplace: "amazon",
  encontradas: ofertasEncontradas.length,
  filtradas: ofertasFiltradas.length,
  adicionadas: adicionadasDistribuidas
};

} catch (e) {
  console.log("[ERRO] [AMZ] erro farejador Amazon:", e.message);
}
}

module.exports = {
  farejarAmazon
};


