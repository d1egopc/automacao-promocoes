const {
  readGlobalJson,
  writeGlobalJson
} = require("../../utils/storage");

const ARQUIVO_OFERTAS_VISTAS = "ofertas_vistas.json";
const JANELA_ANTI_REPETICAO_AUTOMATICA_HORAS = 2;

function normalizarTextoLocal(texto = "") {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&quot;/g, "")
    .replace(/[^\w\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function garantirArquivoOfertasVistas() {
  const atual = readGlobalJson(ARQUIVO_OFERTAS_VISTAS, null);

  if (!Array.isArray(atual)) {
    writeGlobalJson(ARQUIVO_OFERTAS_VISTAS, []);
  }
}

function carregarOfertasVistas() {
  try {
    garantirArquivoOfertasVistas();
    const dados = readGlobalJson(ARQUIVO_OFERTAS_VISTAS, []);
    return Array.isArray(dados) ? dados : [];
  } catch (e) {
    console.log("[ERRO] Erro ao carregar memoria de ofertas:", e.message);
    return [];
  }
}

function salvarOfertasVistas(lista = []) {
  try {
    garantirArquivoOfertasVistas();
    writeGlobalJson(ARQUIVO_OFERTAS_VISTAS, lista.slice(-7000));
  } catch (e) {
    console.log("[ERRO] Erro ao salvar memoria de ofertas:", e.message);
  }
}

function precoNumero(valor) {
  return Number(
    String(valor || "0")
      .replace(/[^\d,.-]/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
  ) || 0;
}

function descontoNumero(oferta = {}) {
  return Number(String(oferta.desconto || "0").replace(/[^\d]/g, "")) || 0;
}

function normalizarUrlProdutoMemoria(valor = "") {
  const texto = String(valor || "").trim();
  if (!texto) return "";

  try {
    const url = new URL(texto);
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "");
    return `${url.hostname}${url.pathname}`.toLowerCase();
  } catch {
    return texto.split("#")[0].split("?")[0].replace(/\/+$/, "").toLowerCase();
  }
}

function tituloNormalizadoForteMemoria(valor = "") {
  return normalizarTextoLocal(valor)
    .replace(/\b(oferta|promocao|cupom|desconto|frete gratis)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numeroFinanceiro(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;

  const texto = String(valor)
    .replace(/R\$/gi, "")
    .replace(/\s/g, "")
    .trim();

  if (!texto) return null;

  const ultimoPonto = texto.lastIndexOf(".");
  const ultimaVirgula = texto.lastIndexOf(",");
  let normalizado = texto.replace(/[^\d,.-]/g, "");

  if (ultimoPonto >= 0 && ultimaVirgula >= 0) {
    if (ultimoPonto > ultimaVirgula) {
      normalizado = normalizado.replace(/,/g, "");
    } else {
      normalizado = normalizado.replace(/\./g, "").replace(",", ".");
    }
  } else if (ultimaVirgula >= 0) {
    normalizado = normalizado.replace(/\./g, "").replace(",", ".");
  }

  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

function cupomRealMemoria(oferta = {}) {
  const cupom = String(oferta.cupom || "").trim();
  const tipo = normalizarTextoLocal(oferta.cupomTipo || oferta.tipoCupom || "");
  if (!cupomValidoMemoria(oferta)) return "";
  if (tipo === "provavel") return "";
  return cupom;
}

function valorCupomMemoria(oferta = {}) {
  return numeroFinanceiro(
    oferta.valorCupom ??
    oferta.cupomValor ??
    oferta.descontoCupomValor ??
    oferta.metadata?.produto?.valorCupom ??
    oferta.metadata?.produto?.cupomValor
  );
}

function percentualCupomMemoria(oferta = {}) {
  return numeroFinanceiro(
    oferta.percentualCupom ??
    oferta.cupomPercentual ??
    oferta.descontoCupomPercentual ??
    oferta.metadata?.produto?.percentualCupom ??
    oferta.metadata?.produto?.cupomPercentual
  );
}

function economiaMemoria(oferta = {}) {
  const direta = numeroFinanceiro(oferta.economia ?? oferta.economiaValor ?? oferta.valorEconomia);
  if (direta !== null) return direta;

  const precoOriginal = numeroFinanceiro(oferta.precoOriginal ?? oferta.precoAntigo);
  const precoAtual = numeroFinanceiro(oferta.precoAtual ?? oferta.preco);
  if (precoOriginal !== null && precoAtual !== null && precoOriginal > precoAtual) {
    return precoOriginal - precoAtual;
  }

  return null;
}

function identidadeAntiRepeticaoAutomatica(oferta = {}) {
  const clienteId = normalizarTextoLocal(oferta.clienteId || "admin");
  const marketplace = normalizarTextoLocal(oferta.marketplace || oferta.mercado || "geral");
  const produtoId = extrairProdutoId(oferta) ||
    String(oferta.produtoIdCanonico || oferta.produtoId || oferta.idProduto || oferta.itemId || oferta.asin || oferta.mlb || "").trim();
  const link = normalizarUrlProdutoMemoria(
    oferta.linkOriginal ||
    oferta.linkResolvidoRadar ||
    oferta.linkCapturado ||
    oferta.link ||
    oferta.linkAfiliado ||
    oferta.linkFinal ||
    ""
  );
  const titulo = tituloNormalizadoForteMemoria(oferta.titulo || oferta.nome || "");
  const preco = numeroFinanceiro(oferta.valorEfetivo ?? oferta.precoAtual ?? oferta.preco);
  const condicao = preco === null ? "preco:indisponivel" : `preco:${preco.toFixed(2)}`;
  const base = produtoId
    ? `produto:${normalizarTextoLocal(produtoId)}`
    : (link ? `url:${link}` : `titulo:${titulo}`);
  const identidadeBase = `${clienteId}|${marketplace}|${base}`;

  return {
    clienteId,
    marketplace,
    produtoId,
    identidadeBase,
    identidade: `${identidadeBase}|${condicao}`,
    preco
  };
}

function logAntiRepeticao2h(dados = {}) {
  console.log("[ANTI-REPETICAO-2H-DECISAO]", JSON.stringify({
    clienteId: dados.clienteId || "",
    marketplace: dados.marketplace || "",
    identidade: dados.identidade || "",
    produtoIdPresente: Boolean(dados.produtoId),
    origem: dados.origem || "",
    precoAtual: dados.precoAtual ?? null,
    precoAnterior: dados.precoAnterior ?? null,
    cupomAtual: dados.cupomAtual || "",
    cupomAnterior: dados.cupomAnterior || "",
    economiaAtual: dados.economiaAtual ?? null,
    economiaAnterior: dados.economiaAnterior ?? null,
    idadeOcorrenciaMinutos: dados.idadeOcorrenciaMinutos ?? null,
    decisao: dados.decisao || "",
    motivo: dados.motivo || ""
  }));
}

function melhoriaFinanceiraComprovada(oferta = {}, anterior = {}) {
  const precoAtual = numeroFinanceiro(oferta.valorEfetivo ?? oferta.precoAtual ?? oferta.preco);
  const precoAnterior = numeroFinanceiro(anterior.precoAtual ?? anterior.preco);
  const cupomAtual = cupomRealMemoria(oferta);
  const cupomAnterior = String(anterior.cupom || "").trim();
  const economiaAtual = economiaMemoria(oferta);
  const economiaAnterior = economiaMemoria(anterior);
  const valorCupomAtual = valorCupomMemoria(oferta);
  const valorCupomAnterior = valorCupomMemoria(anterior);
  const percentualCupomAtual = percentualCupomMemoria(oferta);
  const percentualCupomAnterior = percentualCupomMemoria(anterior);

  if (precoAtual !== null && precoAnterior !== null && precoAtual < precoAnterior) {
    return { ok: true, motivo: "queda_real_preco", precoAtual, precoAnterior, cupomAtual, cupomAnterior, economiaAtual, economiaAnterior };
  }

  if (
    cupomAtual &&
    cupomAtual.toLowerCase() !== cupomAnterior.toLowerCase() &&
    (
      (valorCupomAtual !== null && (valorCupomAnterior === null || valorCupomAtual > valorCupomAnterior)) ||
      (percentualCupomAtual !== null && (percentualCupomAnterior === null || percentualCupomAtual > percentualCupomAnterior))
    )
  ) {
    return { ok: true, motivo: "cupom_real_novo_mensuravel", precoAtual, precoAnterior, cupomAtual, cupomAnterior, economiaAtual, economiaAnterior };
  }

  if (economiaAtual !== null && economiaAnterior !== null && economiaAtual > economiaAnterior) {
    return { ok: true, motivo: "economia_real_maior", precoAtual, precoAnterior, cupomAtual, cupomAnterior, economiaAtual, economiaAnterior };
  }

  const tipoCupom = normalizarTextoLocal(oferta.cupomTipo || oferta.tipoCupom || "");
  const temCupomProvavel = tipoCupom === "provavel" ||
    Boolean(String(oferta.avisoCupom || oferta.beneficioExtra || "").trim());
  const mesmoPreco = precoAtual !== null && precoAnterior !== null && Math.abs(precoAtual - precoAnterior) < 0.01;
  const mesmaEconomia = (
    (economiaAtual === null && economiaAnterior === null) ||
    (economiaAtual !== null && economiaAnterior !== null && Math.abs(economiaAtual - economiaAnterior) < 0.01)
  );
  const motivo = temCupomProvavel
    ? "cupom_provavel_nao_libera"
    : (mesmoPreco && mesmaEconomia ? "mesma_condicao_comercial_janela_2h" : "sem_evidencia_financeira");

  return { ok: false, motivo, precoAtual, precoAnterior, cupomAtual, cupomAnterior, economiaAtual, economiaAnterior };
}

const ORIGENS_MANUAIS_PRESERVADAS_ANTI_REPETICAO = new Set([
  "manual",
  "manual-kabum-awin",
  "manual-magalu",
  "importacao_manual",
  "magalu_manual"
]);

function reservarOfertaAutomatica2h(oferta = {}, contexto = {}) {
  const origem = normalizarTextoLocal(contexto.origem || oferta.origem || "");
  const manual = oferta.manual === true ||
    oferta.origemManual === true ||
    ORIGENS_MANUAIS_PRESERVADAS_ANTI_REPETICAO.has(origem);
  const identidade = identidadeAntiRepeticaoAutomatica(oferta);

  if (manual) {
    logAntiRepeticao2h({
      ...identidade,
      origem,
      precoAtual: identidade.preco,
      decisao: "liberar",
      motivo: "oferta_manual_preservada"
    });
    return { ok: true, bloqueada: false, motivo: "oferta_manual_preservada", identidade: identidade.identidade };
  }

  const agora = Date.now();
  const janelaMs = JANELA_ANTI_REPETICAO_AUTOMATICA_HORAS * 60 * 60 * 1000;
  const vistas = carregarOfertasVistas();
  const anterior = [...vistas].reverse().find(item =>
    item.tipoMemoria === "anti_repeticao_automatica_2h" &&
    (item.identidadeBaseAntiRepeticao2h === identidade.identidadeBase ||
      item.identidadeAntiRepeticao2h === identidade.identidade)
  );

  if (anterior) {
    const vistoMs = new Date(anterior.vistoEm).getTime();
    const idadeMs = Number.isFinite(vistoMs) ? agora - vistoMs : Infinity;
    const idadeMinutos = Number.isFinite(idadeMs) ? Number((idadeMs / 60000).toFixed(1)) : null;

    if (idadeMs < janelaMs) {
      const melhoria = melhoriaFinanceiraComprovada(oferta, anterior);
      logAntiRepeticao2h({
        ...identidade,
        origem,
        precoAtual: melhoria.precoAtual,
        precoAnterior: melhoria.precoAnterior,
        cupomAtual: melhoria.cupomAtual,
        cupomAnterior: melhoria.cupomAnterior,
        economiaAtual: melhoria.economiaAtual,
        economiaAnterior: melhoria.economiaAnterior,
        idadeOcorrenciaMinutos: idadeMinutos,
        decisao: melhoria.ok ? "liberar" : "bloquear",
        motivo: melhoria.ok ? melhoria.motivo : melhoria.motivo
      });

      if (!melhoria.ok) {
        return { ok: false, bloqueada: true, motivo: melhoria.motivo || "mesma_condicao_comercial_janela_2h", identidade: identidade.identidade };
      }
    } else {
      logAntiRepeticao2h({
        ...identidade,
        origem,
        precoAtual: identidade.preco,
        precoAnterior: anterior.precoAtual ?? null,
        cupomAtual: cupomRealMemoria(oferta),
        cupomAnterior: anterior.cupom || "",
        economiaAtual: economiaMemoria(oferta),
        economiaAnterior: economiaMemoria(anterior),
        idadeOcorrenciaMinutos: idadeMinutos,
        decisao: "liberar",
        motivo: "fora_janela_2h"
      });
    }
  }

  vistas.push({
    tipoMemoria: "anti_repeticao_automatica_2h",
    identidadeBaseAntiRepeticao2h: identidade.identidadeBase,
    identidadeAntiRepeticao2h: identidade.identidade,
    produtoId: identidade.produtoId,
    chave: identidade.identidade,
    clienteId: oferta.clienteId || "admin",
    marketplace: oferta.marketplace || oferta.mercado || "",
    titulo: oferta.titulo || oferta.nome || "",
    preco: identidade.preco,
    precoAtual: identidade.preco,
    cupom: cupomRealMemoria(oferta),
    valorCupom: valorCupomMemoria(oferta),
    percentualCupom: percentualCupomMemoria(oferta),
    economia: economiaMemoria(oferta),
    origem: origem || "automatica",
    vistoEm: new Date(agora).toISOString()
  });
  salvarOfertasVistas(vistas);

  if (!anterior) {
    logAntiRepeticao2h({
      ...identidade,
      origem,
      precoAtual: identidade.preco,
      cupomAtual: cupomRealMemoria(oferta),
      economiaAtual: economiaMemoria(oferta),
      decisao: "liberar",
      motivo: "sem_ocorrencia_recente"
    });
  }

  return { ok: true, bloqueada: false, motivo: "reservada", identidade: identidade.identidade };
}

function extrairProdutoId(oferta = {}) {
  const texto = [
    oferta.idProduto,
    oferta.productId,
    oferta.asin,
    oferta.mlb,
    oferta.itemId,
    oferta.linkOriginal,
    oferta.link,
    oferta.linkAfiliado
  ].filter(Boolean).join(" ");

  const mlb = String(texto).match(/MLB-?\d{6,}/i)?.[0];
  if (mlb) return mlb.toUpperCase().replace("MLB-", "MLB");

  const asin = String(texto).match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i)?.[1];
  if (asin) return asin.toUpperCase();

  return "";
}

function chaveOferta(oferta = {}) {
  const clienteId = normalizarTextoLocal(oferta.clienteId || "admin");
  const marketplace = normalizarTextoLocal(oferta.marketplace || "geral");
  const produtoId = extrairProdutoId(oferta);

  if (produtoId) {
    return `${clienteId}|${marketplace}|produto:${produtoId}`;
  }

  let titulo = normalizarTextoLocal(oferta.titulo || oferta.nome || "");

  titulo = titulo
    .replace(/\b(oferta|promocao|promoção|original|novo|nova|kit|combo)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return `${clienteId}|${marketplace}|titulo:${titulo}`;
}

function ofertaOrigemRadar(oferta = {}) {
  return String(oferta.origem || "").toLowerCase() === "radar" ||
    oferta.radar === true ||
    oferta.radarNaFila === true;
}

function cupomValidoMemoria(oferta = {}) {
  const cupom = String(oferta.cupom || "").trim().toLowerCase();

  return Boolean(
    cupom &&
    cupom !== "copiado" &&
    cupom !== "cupom copiado" &&
    cupom !== "sem cupom"
  );
}

function ofertaTemBeneficioMemoria(oferta = {}) {
  return Boolean(
    cupomValidoMemoria(oferta) ||
    String(oferta.tipoCupom || "").trim() ||
    String(oferta.avisoCupom || "").trim() ||
    String(oferta.beneficioExtra || "").trim() ||
    String(oferta.linkResgateCupom || "").trim() ||
    String(oferta.descontoPix || "").trim() ||
    String(oferta.descontoApp || "").trim() ||
    descontoNumero(oferta) >= 25 ||
    Number(oferta.score || 0) >= 80
  );
}

function janelaHorasPorOferta(oferta = {}) {
  const categoria = normalizarTextoLocal(oferta.categoria || "");
  const marketplace = normalizarTextoLocal(oferta.marketplace || "");
  const ehRadar = ofertaOrigemRadar(oferta);

  if (ehRadar) return 0.5;

  if (marketplace.includes("mercadolivre") || marketplace.includes("mercado livre")) {
    return 0.5;
  }

  if (marketplace.includes("shopee")) {
    return 2;
  }

  if (marketplace.includes("amazon")) {
    return 3;
  }

  if (
    categoria.includes("roupas") ||
    categoria.includes("moda") ||
    categoria.includes("tenis") ||
    categoria.includes("chinelos")
  ) {
    return 2;
  }

  if (
    categoria.includes("gamer") ||
    categoria.includes("hardware") ||
    categoria.includes("computadores") ||
    categoria.includes("notebook")
  ) {
    return 5;
  }

  return 4;
}

function quedaPrecoRelevante(precoAtual = 0, precoAnterior = 0) {
  if (!precoAtual || !precoAnterior) return false;

  const diferenca = precoAnterior - precoAtual;
  const percentual = diferenca / precoAnterior;

  if (percentual >= 0.12) return true;

  if (precoAnterior <= 30 && diferenca >= 5) return true;
  if (precoAnterior <= 80 && diferenca >= 10) return true;
  if (precoAnterior > 80 && diferenca >= 20) return true;

  return false;
}

function deveIgnorarOfertaRepetida(oferta = {}) {
  const agora = Date.now();
  const vistas = carregarOfertasVistas();
  const chave = chaveOferta(oferta);


let anterior = null;
for (let i = vistas.length - 1; i >= 0; i--) {
  if (vistas[i].chave === chave) {
    anterior = vistas[i];
    break;
  }
}

  if (!anterior) return false;

  const horasPassadas =
    (agora - new Date(anterior.vistoEm).getTime()) / 36e5;

  const precoAtual = precoNumero(oferta.precoAtual || oferta.preco);
  const precoAnterior = precoNumero(anterior.precoAtual || anterior.preco);

  const cupomAtual = String(oferta.cupom || "").trim();
  const cupomAnterior = String(anterior.cupom || "").trim();

  const temCupomNovo =
    cupomAtual &&
    cupomAtual.toLowerCase() !== "copiado" &&
    cupomAtual !== cupomAnterior;

  const ehRadar = ofertaOrigemRadar(oferta);
  const temBeneficio = ofertaTemBeneficioMemoria(oferta);
  const desconto = descontoNumero(oferta);
  const quedaPreco = quedaPrecoRelevante(precoAtual, precoAnterior);

  const marketplace = normalizarTextoLocal(oferta.marketplace || oferta.mercado || "");

if (
  marketplace.includes("mercadolivre") ||
  marketplace.includes("mercado livre")
) {
  if (ehRadar || temBeneficio || desconto >= 5 || quedaPreco) {
    return false;
  }
}

  if (ehRadar) return false;
  if (temCupomNovo) return false;
  if (temBeneficio && horasPassadas >= 0.25) return false;
  if (desconto >= 25 && horasPassadas >= 0.25) return false;
  if (quedaPreco && horasPassadas >= 0.25) return false;

  if (horasPassadas < 0.25 && !temCupomNovo && !quedaPreco && !temBeneficio) {
    console.log("[INFO] Oferta repetida ignorada <15min:", oferta.titulo || oferta.nome);
    return true;
  }

  const janelaHoras = janelaHorasPorOferta(oferta);

  if (horasPassadas < janelaHoras && !temCupomNovo && !quedaPreco && !temBeneficio) {
    console.log("[INFO] Oferta repetida ignorada:", {
      titulo: oferta.titulo || oferta.nome,
      horasPassadas: Number(horasPassadas.toFixed(2)),
      janelaHoras,
      precoAtual,
      precoAnterior,
      origem: ehRadar ? "radar" : (oferta.origem || "farejador")
    });
    return true;
  }

  return false;
}

function registrarOfertaVista(oferta = {}) {
  const vistas = carregarOfertasVistas();

  vistas.push({
    chave: chaveOferta(oferta),
    produtoId: extrairProdutoId(oferta),
    clienteId: oferta.clienteId || "admin",
    marketplace: oferta.marketplace || "",
    titulo: oferta.titulo || oferta.nome || "",
    categoria: oferta.categoria || "",
    preco: oferta.preco || oferta.precoAtual || "",
    precoAtual: oferta.precoAtual || oferta.preco || "",
    cupom: oferta.cupom || "",
    tipoCupom: oferta.tipoCupom || "",
    avisoCupom: oferta.avisoCupom || "",
    origem: oferta.origem || "",
    vistoEm: new Date().toISOString()
  });

  salvarOfertasVistas(vistas);
}

module.exports = {
  deveIgnorarOfertaRepetida,
  registrarOfertaVista,
  reservarOfertaAutomatica2h,
  identidadeAntiRepeticaoAutomatica
};
