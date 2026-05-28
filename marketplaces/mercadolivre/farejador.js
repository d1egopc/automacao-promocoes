const {
  farejarMercadoLivre
} = require("./farejador");

// ================= FAREJADOR MERCADO LIVRE =================

async function farejarMercadoLivre(clienteId = "admin", deps = {}) {

  const {
    config,
    integracoesPorCliente,
    fila,
    salvarFila,
    prepararOfertaGlobal,
    ofertaJaExiste,
    classificarCategoriaOferta,
    gerarBuscasGlobais,
    gerarHeadersStealth,
    farejarCuponsMercadoLivre,
    importarMercadoLivre
  } = deps;

  try {

console.log("🐶 ML MÓDULO RODANDO PARA CLIENTE:", clienteId);
console.log("🧪 ML config recebida?", !!config);
console.log("🧪 ML ativo?", config?.marketplaces?.mercadolivre?.ativo);
console.log("🧪 ML integração cliente?", !!integracoesPorCliente?.[clienteId]?.mercadolivre);

if (!config.marketplaces?.mercadolivre?.ativo) {
  console.log("⏸ Mercado Livre desativado. Farejador ignorado.");
  return;
}
    console.log("🐶 Farejando ofertas ML (modo stealth)...");

    const buscas = gerarBuscasGlobais(40);

      const limiteBuscas =
      config.marketplaces?.mercadolivre?.limiteBuscasPorRodada || 1;

      const buscasEmbaralhadas = [...buscas].sort(() => Math.random() - 0.5);
      const buscasDaRodada = buscasEmbaralhadas.slice(0, limiteBuscas);

      for (const termo of buscasDaRodada) {
      try {
        const url = `https://lista.mercadolivre.com.br/${encodeURIComponent(termo)}`;

       console.log("🌐 MERCADO LIVRE URL:", url);

    const response = await fetch(url, {
  headers: {
    ...gerarHeadersStealth(),

    ...(integracoesPorCliente?.[clienteId]?.mercadolivre?.credenciais?.cookies ||
    integracoesPorCliente?.admin?.mercadolivre?.credenciais?.cookies
      ? {
          Cookie:
            integracoesPorCliente?.[clienteId]?.mercadolivre?.credenciais?.cookies ||
            integracoesPorCliente?.admin?.mercadolivre?.credenciais?.cookies
        }
      : {})
  }
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
        
        console.log("🧪 TEM MLB?", html.includes("MLB"));
        console.log("🧪 TEM item?", html.includes("item"));
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
        
        const linksExtraidos = [
  ...html.matchAll(/href="([^"]*\/MLB-[^"]*)"/g),
  ...html.matchAll(/href="([^"]*\/p\/MLB[^"]*)"/g),
  ...html.matchAll(/"permalink":"([^"]*MLB[^"]*)"/g),
  ...html.matchAll(/"url":"([^"]*MLB[^"]*)"/g)
]
  .map(m => m[1] || m[0])
  .map(link => {
    let limpo = String(link)
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&")
      .split("#")[0];

    if (limpo.startsWith("/")) {
      limpo = "https://www.mercadolivre.com.br" + limpo;
    }

    return limpo;
  })
  .filter(link =>
    link.includes("mercadolivre.com.br") &&
    link.includes("MLB") &&
    !link.includes("lista.mercadolivre") &&
    !link.includes("registration") &&
    !link.includes("security.js") &&
    !link.includes("privacidade") &&
    !link.includes("account-verification")
  );

        const links = [...new Set(linksExtraidos)].slice(0, 8);
        console.log("🧪 LINKS LIMPOS:", links);

        console.log(`🔎 ${termo}: ${links.length} produtos`);

        for (const link of links) {
          try {
            const produto = await importarMercadoLivre(link, {
            credenciais:
            integracoesPorCliente?.[clienteId]?.mercadolivre?.credenciais ||
            integracoesPorCliente?.admin?.mercadolivre?.credenciais      
            });

            if (!produto.precoAtual) continue;

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

if (
  desconto < (config.marketplaces?.mercadolivre?.descontoMinimo || 20) &&
  !produto.avisoCupom
) continue;

const tituloLower = String(produto.titulo || "").toLowerCase();

if (
  tituloLower.includes("refil") ||
  tituloLower.includes("amostra") ||
  tituloLower.includes("mini") ||
  tituloLower.includes("teste")
) continue;

            
            let novaOferta = {
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
              categoria: classificarCategoriaOferta(produto, termo),
              sessaoId: "sessao1",
              status: "pendente",
              clienteId
            };

            novaOferta = prepararOfertaGlobal(novaOferta);

           const jaExiste = ofertaJaExiste(novaOferta);

            if (!jaExiste) {
              fila.push(novaOferta);
              salvarFila();

              console.log("🤖 Nova oferta ML:", {
                titulo: novaOferta.titulo,
                preco: novaOferta.precoAtual,
                precoAntigo: novaOferta.precoAntigo,
                desconto: Math.round(desconto) + "%",
                link: novaOferta.link
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
