// ================= FAREJADOR SHOPEE =================

async function farejarShopee(clienteId = "admin", deps = {}) {
  
const {
    config,
    integracoesPorCliente,
    fila,
    salvarFila,
    prepararOfertaGlobal,
    ofertaJaExiste,
    classificarCategoriaOferta,
    aplicarFiltrosUniversais
  } = deps;


 try {
    if (!config.marketplaces?.shopee?.ativo) {
      console.log("⏸ Shopee desativada. Farejador ignorado.");
      return;
    }

    console.log("🛍️ Farejando ofertas Shopee...");

    const produtos = await buscarOfertasShopee();

    if (!Array.isArray(produtos)) {
      console.log("❌ Shopee não retornou array");
      return;
    }

    console.log(`🔎 ${produtos.length} produtos Shopee encontrados`);

    let adicionadasNestaRodada = 0;
    let ofertasEncontradas = [];

    const limitePorRodada =
      config.marketplaces?.shopee?.limitePorRodada || 10;

    for (const item of produtos) {
      try {
        const desconto = Number(item.priceDiscountRate || 0);
        const vendas = Number(item.sales || 0);
        const nota = Number(item.ratingStar || 0);
        const precoAtualNumero = Number(item.priceMin || 0);

        if (desconto < (config.marketplaces?.shopee?.descontoMinimo || 15)) continue;
        if (!precoAtualNumero) continue;
        if (precoAtualNumero < (config.marketplaces?.shopee?.precoMinimo || 20)) continue;
        if (vendas < 20) continue;
        if (nota > 0 && nota < 4.5) continue;

        const precoAtual = precoAtualNumero.toFixed(2).replace(".", ",");

        const precoAntigoNumero =
          precoAtualNumero / (1 - desconto / 100);

        const precoAntigo = precoAntigoNumero.toFixed(2).replace(".", ",");

     const clienteId = clienteIdAlvo || "admin";

let novaOferta = {
  nome: item.productName,
  titulo: item.productName,
  preco: precoAtual,
  precoAtual,
  precoAntigo,
  linkOriginal: item.productLink || item.offerLink,
  link: item.productLink || item.offerLink,
  linkAfiliado: "",
  imagem: item.imageUrl,
  marketplace: "shopee",
  categoria: "Shopee",
  sessaoId: normalizarSessaoId(clienteId, "sessao1"),
  status: "pendente",
  clienteId,
  criadoEm: new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  }),
  cupom: "",
  avisoCupom: "🎟️ Confira cupons disponíveis na página antes de finalizar."
};

        novaOferta = prepararOfertaGlobal(novaOferta);

        const jaExiste = fila.some(o =>
          o.link === novaOferta.link ||
          o.titulo === novaOferta.titulo
        );

        if (jaExiste) continue;

        ofertasEncontradas.push(novaOferta);
        adicionadasNestaRodada++;

        console.log("🛍️ Nova oferta Shopee:", {
          titulo: novaOferta.titulo,
          preco: novaOferta.precoAtual,
          desconto: desconto + "%"
        });

        if (adicionadasNestaRodada >= limitePorRodada) {
          console.log("🛑 Limite Shopee atingido");
          break;
        }

        await new Promise(r =>
          setTimeout(r, 3000 + Math.random() * 4000)
        );

      } catch (e) {
        console.log("❌ erro item Shopee:", e.message);
      }
    }

    const ofertasFiltradas = aplicarFiltrosUniversais(
      ofertasEncontradas,
      {
        preferirEnvioBrasil: false,
        bloquearSemImagem: true,
        bloquearSemPreco: true,
      }
    );

    console.log(
      `🧠 Ofertas Shopee após filtros universais: ${ofertasFiltradas.length}`
    );

   for (const oferta of ofertasFiltradas) {
   await distribuirOfertaParaClientes(oferta);
   }

    console.log(`✅ Shopee finalizado. Adicionadas: ${adicionadasNestaRodada}`);

  } catch (e) {
    console.log("❌ erro farejador Shopee:", e.message);
  }
}


const PORT = process.env.PORT || 3000;

function podeRodarAgora() {
  const agoraBR = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );

  const horaAtual = agoraBR.getHours() * 60 + agoraBR.getMinutes();

  console.log({
    pausarMadrugada: config.pausarMadrugada,
    inicio: config.horarioInicio,
    fim: config.horarioFim,
    horaServidorBR: `${String(agoraBR.getHours()).padStart(2, "0")}:${String(agoraBR.getMinutes()).padStart(2, "0")}`
  });

  if (!config.pausarMadrugada) return true;

  const [inicioH, inicioM] = (config.horarioInicio || "08:00").split(":").map(Number);
  const [fimH, fimM] = (config.horarioFim || "23:00").split(":").map(Number);

  const inicio = inicioH * 60 + inicioM;
  const fim = fimH * 60 + fimM;

  if (inicio <= fim) {
    return horaAtual >= inicio && horaAtual <= fim;
  }

  return horaAtual >= inicio || horaAtual <= fim;
}

carregarConfig();

for (const usuario of usuarios) {
  carregarFila(usuario.id);
}

function garantirIdsFila() {
  let alterou = false;

  fila = fila.map((item) => {
    if (!item.id) {
      alterou = true;

      return {
        ...item,
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`
      };
    }

    return item;
  });

  if (alterou) {
    salvarFila();
    console.log("🆔 IDs antigos da fila corrigidos");
  }
}

garantirIdsFila();

console.log("🚀 Dados iniciais carregados:", {
  fila: fila.length,
  usuarios: usuarios.length,
  integracoesClientes: Object.keys(integracoesPorCliente || {}).length,
  destinosClientes: Object.keys(destinosPorCliente || {}).length
});

app.listen(PORT, () => {
  console.log("🔥 API ONLINE NA PORTA " + PORT);

decairConfiancaCupons();

setInterval(() => {
  decairConfiancaCupons();
}, 4 * 60 * 60 * 1000);

  setTimeout(() => {
    console.log("🔄 Reconectando sessões WhatsApp automaticamente...");
 
let sessoesParaReconectar = [
  ...new Set(config?.sessoesWhatsapp || [])
];

sessoesParaReconectar = sessoesParaReconectar
  .filter(id => id && id.includes("_"))
  .filter(id => !id.includes("_user_"))
  .filter(id => !/^user_[^_]+_user_/.test(id));

config.sessoesWhatsapp = sessoesParaReconectar;
salvarConfig();

    sessoesParaReconectar.forEach((id, index) => {
      setTimeout(() => {
        console.log("🚀 Reconectando sessão:", id);
        iniciarWhatsApp(id);
      }, 3000 + index * 4000);
    });

  }, 3000);
});
