// ================= HELPERS DE IMPORTAÇÃO =================

function limparPreco(valor) {
  if (!valor) return "";

  let numero = Number(valor);

  if (numero > 1000) {
    numero = numero / 100;
  }

  if (!Number.isFinite(numero)) {
    let texto = String(valor).trim();

    texto = texto
      .replace("R$", "")
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", ".");

    numero = Number(texto);

    if (!Number.isFinite(numero)) return String(valor);
  }

  return numero.toFixed(2).replace(".", ",");
}

function calcularDesconto(precoAntigo, precoAtual) {
  if (!precoAntigo || !precoAtual) return null;

  const antigo = Number(precoAntigo.replace(",", "."));
  const atual = Number(precoAtual.replace(",", "."));

  if (!antigo || !atual) return null;

  const desconto = ((antigo - atual) / antigo) * 100;

  return Math.round(desconto);
}

function gerarMensagemWhatsApp(produto) {
  const { titulo, precoAntigo, precoAtual, linkAfiliado } = produto;

  const desconto = calcularDesconto(precoAntigo, precoAtual);

  return `
🔥 OFERTA IMPERDÍVEL 🔥

${titulo}

${precoAntigo ? `De: R$ ${precoAntigo}` : ""}
💸 Por: R$ ${precoAtual}
${desconto ? `🔥 Desconto de ${desconto}%` : ""}

🛒 Comprar agora:
${linkAfiliado}
`.trim();
}

async function importarMercadoLivre(url, config) {
  const cookies = config?.credenciais?.cookies || "";

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Cookie": cookies
    }
  });

  const html = await response.text();

  const titulo =
    extrairMeta(html, "og:title") ||
    "Produto Mercado Livre";

  let precoAtual =
    extrairMeta(html, "product:price:amount") ||
    extrairMeta(html, "og:price:amount") ||
    "";

  let precoAntigo =
    extrairMeta(html, "product:original_price") ||
    extrairMeta(html, "og:price:standard_amount") ||
    "";

  const imagem =
    extrairMeta(html, "og:image") || "";

  precoAtual = limparPreco(precoAtual);
  precoAntigo = limparPreco(precoAntigo);

  const produto = {
    marketplace: "mercadolivre",
    titulo: htmlDecode(titulo)
      .replace(" | MercadoLivre", "")
      .replace(" | Mercado Livre", ""),
    precoAntigo: precoAntigo || "",
    precoAtual,
    cupom: "",
    linkOriginal: url,
    linkAfiliado: url,
    imagem,
    categoria: "Mercado Livre"
  };

  produto.mensagem = gerarMensagemWhatsApp(produto);

  return produto;
}