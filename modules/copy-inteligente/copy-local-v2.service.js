const crypto = require("crypto");
const { CATEGORIAS_OPTIMUS, categoriaExiste } = require("../../marketplaces/inteligencia/categorias-globais");
const { classificarCategoriaOferta } = require("../../marketplaces/inteligencia/classificador-categorias");
const { BANCO_ASSOCIATIVO_V2 } = require("./banco-associativo.v2");
const { familiaDaCategoriaCopyV2, FAMILIA_OPORTUNIDADE_V2 } = require("./familias-v2");
const { normalizarSinaisCopy, texto, normalizar } = require("./resolver-intencao");
const { validarCopyV2 } = require("./validator-v2");
const {
  planoPermiteTituloIa,
  ofertaIdCopy,
  chaveSinais,
  hashSinaisComerciais
} = require("./copy-inteligente.service");

const TTL_COPY_LOCAL_V2_MS = 45 * 60 * 1000;
const MAX_CACHE_COPY_LOCAL_V2 = 1000;
const LIMITE_HISTORICO_COPY_LOCAL_V2 = 24;
const FONTE_COPY_LOCAL_V2 = "banco_associativo_local_v2";
const PADRAO_COPY_LOCAL_V2_INELEGIVEL = /\b(?:pare|pense|calma|avalie|avaliar|compare antes|comparar com calma|antes de decidir|ponta do lapis|sem pressa|radar|contexto|analise|comparacao|valor efetivo|conta final|calculadora|simulacao|algoritmo|motor|classificacao|ganhou possibilidade|aba imaginaria|entrou sem pedir licenca|prateleira.*abra espaco|curiosidade bem vestida|possibilidade nova|combina com sala mais completa|bancada digital|ambiente ganhou)\b/i;
const INTENCOES_COMERCIAIS_GLOBAIS_COPY_LOCAL_V2 = Object.freeze([
  "cupom",
  "resgate",
  "beneficio",
  "economia",
  "frete_gratis",
  "parcelamento"
]);

const cacheLocalV2 = new Map();
const historicoLocalV2 = new Map();
const historicoMetaLocalV2 = new Map();
const EMOJIS_FAMILIA_COPY_LOCAL_V2 = Object.freeze({
  mercado: ["🛒", "👀"], bebidas: ["🥤", "👀"], audio_tv: ["📺", "🎧"],
  celulares: ["📱", "👀"], computadores: ["💻", "👀"], casa: ["🏠", "✨"],
  casa_eletro: ["🏠", "✨"], cozinha_pratica: ["🍳", "✨"], ferramentas: ["🛠️", "😂"],
  limpeza: ["🧹", "✨"], eletronicos: ["🔌", "👀"], perifericos: ["🎧", "🎮"],
  moda: ["😎", "🤩"], calcados: ["👟", "🤩"], gamer: ["🎮", "👀"],
  beleza: ["😍", "✨"], esporte: ["💪", "👀"], pesca_camping: ["🎣", "👀"],
  oportunidade: ["👀", "✨"]
});
const ALIASES_CATEGORIA_OFICIAL_COPY_LOCAL_V2 = {
  "alimentos": "Alimentos e Mercearia",
  "mercado": "Alimentos e Mercearia",
  "bebidas": "Bebidas",
  "audio": "Audio TV",
  "audio tv": "Audio TV",
  "tv": "Audio TV",
  "automotivo": "Automotivo",
  "bebes": "Bebês e Acessórios",
  "bebe": "Bebês e Acessórios",
  "celular": "Celulares e Smartphones",
  "celulares": "Celulares e Smartphones",
  "smartphones": "Celulares e Smartphones",
  "computadores e informatica": "Computadores e Notebook",
  "computadores e informática": "Computadores e Notebook",
  "computadores": "Computadores e Notebook",
  "informatica": "Computadores e Notebook",
  "informática": "Computadores e Notebook",
  "informatica e computadores": "Computadores e Notebook",
  "informática e computadores": "Computadores e Notebook",
  "notebook": "Computadores e Notebook",
  "notebooks": "Computadores e Notebook",
  "brinquedos": "Brinquedos e Artigos Infantis",
  "casa": "Casa, Móveis e Decoração",
  "casa e cozinha": "Casa, Móveis e Decoração",
  "decoracao": "Casa, Móveis e Decoração",
  "eletrodomesticos": "Eletrodomésticos",
  "eletroportateis": "Eletroportáteis",
  "ferramentas": "Ferramentas",
  "limpeza": "Limpeza",
  "eletronicos": "Eletrônicos",
  "perifericos": "Periféricos",
  "moda feminina": "Roupas e Moda Feminina",
  "moda masculina": "Roupas e Moda Masculina",
  "calcados": "Tênis e Chinelos",
  "tenis": "Tênis e Chinelos",
  "chinelos": "Tênis e Chinelos",
  "gamer": "Gamer e Hardware",
  "hardware": "Gamer e Hardware",
  "infantil": "Roupas e Calçados Infantil",
  "pet": "Pet Shop e Fazendinha",
  "pet shop": "Pet Shop e Fazendinha",
  "beleza": "Perfumaria, Farmácia e Beleza",
  "perfumaria": "Perfumaria, Farmácia e Beleza",
  "farmacia": "Perfumaria, Farmácia e Beleza",
  "esporte": "Esporte e Suplementos",
  "suplementos": "Esporte e Suplementos",
  "pesca": "Pesca e Camping",
  "camping": "Pesca e Camping",
  "games": "Games e Console",
  "console": "Games e Console",
  "climatizacao": "Climatização e Ventilação",
  "ventilacao": "Climatização e Ventilação",
  "iluminacao": "Iluminação e Elétrica",
  "eletrica": "Iluminação e Elétrica",
  "diversos": "Diversos"
};

function hashLocalV2(valor = "") {
  return crypto.createHash("sha1").update(String(valor || "")).digest("hex").slice(0, 16);
}

function agoraMs() {
  return Date.now();
}

function removerExpiradasCopyLocalV2(now = agoraMs()) {
  for (const [id, item] of cacheLocalV2.entries()) {
    if (Number(item?.expiraEm || 0) <= now) cacheLocalV2.delete(id);
  }
}

function limitarCacheCopyLocalV2() {
  removerExpiradasCopyLocalV2();
  while (cacheLocalV2.size > MAX_CACHE_COPY_LOCAL_V2) {
    const primeira = cacheLocalV2.keys().next().value;
    if (!primeira) break;
    cacheLocalV2.delete(primeira);
  }
}

function lerCacheCopyLocalV2(chave = "") {
  const id = String(chave || "");
  if (!id) return null;
  const item = cacheLocalV2.get(id);
  if (!item) return null;
  if (Number(item.expiraEm || 0) <= agoraMs()) {
    cacheLocalV2.delete(id);
    return null;
  }
  return item.valor || null;
}

function salvarCacheCopyLocalV2(chave = "", valor = {}, ttlMs = TTL_COPY_LOCAL_V2_MS) {
  const id = String(chave || "");
  if (!id || !valor || typeof valor !== "object") return null;
  limitarCacheCopyLocalV2();
  if (!cacheLocalV2.has(id) && cacheLocalV2.size >= MAX_CACHE_COPY_LOCAL_V2) {
    const primeira = cacheLocalV2.keys().next().value;
    if (primeira) cacheLocalV2.delete(primeira);
  }
  const expiraEm = agoraMs() + Math.max(1000, Number(ttlMs) || TTL_COPY_LOCAL_V2_MS);
  if (cacheLocalV2.has(id)) cacheLocalV2.delete(id);
  cacheLocalV2.set(id, { valor, expiraEm });
  return valor;
}

function limparCacheCopyLocalV2() {
  cacheLocalV2.clear();
  historicoLocalV2.clear();
  historicoMetaLocalV2.clear();
}

function formatarPrecoContextualCopyLocalV2(valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  const bruto = typeof valor === "number"
    ? valor
    : Number(String(valor).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", "."));
  if (!Number.isFinite(bruto) || bruto <= 0) return "";
  return bruto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const ACENTOS_APRESENTACAO_COPY_LOCAL_V2 = Object.freeze({
  nao: "não", voce: "você", voces: "vocês", ja: "já", so: "só", tambem: "também",
  atencao: "atenção", opcao: "opção", opcoes: "opções", calcado: "calçado", calcados: "calçados",
  pratica: "prática", praticas: "práticas", pratico: "prático", praticos: "práticos",
  proxima: "próxima", proximas: "próximas", proximo: "próximo", proximos: "próximos",
  combinacao: "combinação", combinacoes: "combinações", cabeca: "cabeça", licenca: "licença",
  espaco: "espaço", espacos: "espaços", organizacao: "organização", transformacao: "transformação",
  especificacao: "especificação", especificacoes: "especificações", comparacao: "comparação",
  comparacoes: "comparações", tecnico: "técnico", tecnicos: "técnicos", tecnica: "técnica",
  tecnicas: "técnicas", possivel: "possível", facil: "fácil", dificil: "difícil", serie: "série",
  musica: "música", audio: "áudio", saida: "saída", pes: "pés", mao: "mão", maos: "mãos",
  proprias: "próprias", armario: "armário", refeicao: "refeição", fogao: "fogão", almoco: "almoço",
  rapida: "rápida", rapidas: "rápidas", rapido: "rápido", rapidos: "rápidos", ai: "aí", ne: "né",
  promocao: "promoção", promocoes: "promoções", eletronico: "eletrônico", eletronicos: "eletrônicos",
  acessorio: "acessório", acessorios: "acessórios", otima: "ótima", otimo: "ótimo", ate: "até"
});
const PADRAO_ACENTOS_APRESENTACAO_COPY_LOCAL_V2 = new RegExp(`\\b(${Object.keys(ACENTOS_APRESENTACAO_COPY_LOCAL_V2).join("|")})\\b`, "gi");

function acentuarApresentacaoCopyLocalV2(valor = "") {
  return texto(valor).replace(PADRAO_ACENTOS_APRESENTACAO_COPY_LOCAL_V2, encontrado => {
    const acentuado = ACENTOS_APRESENTACAO_COPY_LOCAL_V2[encontrado.toLowerCase()] || encontrado;
    return encontrado[0] === encontrado[0].toUpperCase()
      ? acentuado.charAt(0).toUpperCase() + acentuado.slice(1)
      : acentuado;
  });
}

function extrairAtributosTituloCopyLocalV2(titulo = "") {
  const original = texto(titulo);
  if (!original) return [];
  const encontrados = [];
  const vistos = new Set();
  const adicionar = (tipo, valor) => {
    const item = texto(valor).replace(/\s+/g, " ");
    const chave = normalizar(item).replace(/\s+/g, "");
    if (!item || vistos.has(chave)) return;
    vistos.add(chave);
    encontrados.push({ tipo, texto: item });
  };

  const unidades = /\b\d+(?:[.,]\d+)?\s*(?:kg|g|mg|ml|l|w|kw|tb|gb|mb|cm|mm|metros?|unidades?|unid\.?|pcs?)\b/gi;
  for (const match of original.matchAll(unidades)) adicionar("atributo", match[0]);
  const polegadas = /\b\d+(?:[.,]\d+)?\s*(?:polegadas?|["”])/gi;
  for (const match of original.matchAll(polegadas)) adicionar("atributo", match[0]);

  const modelos = /\b[A-Z]{1,8}(?:[- ]?[A-Z]{0,4}\d{2,6}[A-Z0-9-]*)\b/g;
  for (const match of original.matchAll(modelos)) {
    if (/^(?:kg|g|mg|ml|l|w|kw|tb|gb|mb|cm|mm|unid|pcs?)[- ]?\d/i.test(match[0])) continue;
    if (!vistos.has(normalizar(match[0]).replace(/\s+/g, ""))) adicionar("modelo", match[0]);
  }
  return encontrados.slice(0, 3);
}

function emojiContextualCopyLocalV2(familia = "", assinatura = "", titulo = "") {
  const contexto = normalizar(titulo);
  const opcoes = familia === "audio_tv" && /\b(?:caixa de som|audio|som|fone|headset)\b/.test(contexto)
    ? ["🎧", "👀"]
    : familia === "audio_tv" && /\b(?:smart tv|televisao|tv)\b/.test(contexto)
      ? ["📺", "👀"]
      : EMOJIS_FAMILIA_COPY_LOCAL_V2[familia] || EMOJIS_FAMILIA_COPY_LOCAL_V2.oportunidade;
  const indice = parseInt(hashLocalV2(`${familia}:${assinatura}`).slice(0, 8), 16) % opcoes.length;
  return opcoes[indice] || "👀";
}

function rotuloFamiliaCopyLocalV2(familia = "") {
  return ({
    mercado: "Esse item", bebidas: "Essa bebida", audio_tv: "Esse achado",
    celulares: "Esse celular", computadores: "Esse computador", casa: "Esse item para casa",
    casa_eletro: "Esse item para casa", cozinha_pratica: "Esse item de cozinha",
    ferramentas: "Essa ferramenta", limpeza: "Esse item de limpeza", eletronicos: "Esse eletrônico",
    perifericos: "Esse acessório", moda: "Essa peça", calcados: "Esse calçado",
    gamer: "Esse item para o setup", beleza: "Esse item de beleza", esporte: "Esse item para o treino",
    pesca_camping: "Esse item para a próxima aventura"
  })[familia] || "Essa oferta";
}

function produtoContextualCopyLocalV2(titulo = "") {
  const original = texto(titulo);
  const base = normalizar(original);
  const marcaNike = /\bnike\b/.test(base) ? " Nike" : "";
  const modelo = original.match(/\b[A-Z]{1,6}\d{2,6}[A-Z0-9-]*\b/)?.[0] || "";
  const produtos = [
    [/\bcaixa de som\b/, "Caixa de som"], [/\bsmart tv\b|\btelevisao\b|\btv\b/, "TV"],
    [/\brobo aspirador\b|\baspirador\b/, "Aspirador"], [/\bvara de pesca\b|\bvara\b/, "Vara de pesca"],
    [/\bsmartphone\b|\bcelular\b/, `Smartphone${modelo ? ` ${modelo}` : ""}`],
    [/\bmonitor\b/, "Monitor"], [/\bnotebook\b/, "Notebook"], [/\bssd\b/, "SSD"],
    [/\bferramenta\b|\bfuradeira\b/, /\bfuradeira\b/.test(base) ? "Furadeira" : "Ferramenta"],
    [/\bpanela\b/, "Panela"], [/\bbone\b/, `Boné${marcaNike}`], [/\bblusa\b/, "Blusa"],
    [/\btenis\b/, `Tênis${marcaNike}`], [/\bperfume\b/, "Perfume"], [/\bcreme\b/, "Creme"],
    [/\bsuco\b/, "Suco"], [/\bwhey\b/, "Whey"], [/\bcabo\b/, "Cabo"], [/\bbarril\b/, "Barril"]
  ];
  for (const [padrao, produto] of produtos) {
    if (padrao.test(base)) return produto;
  }
  return modelo ? `Modelo ${modelo}` : "";
}

function humorContextualCopyLocalV2({ titulo = "", produto = "", atributo = "", preco = "" } = {}) {
  const base = normalizar(titulo);
  const fato = atributo || produto;
  const precoContextual = preco ? "nesse preço" : "na oferta";
  if (/\bbone\b/.test(base)) return [`Cabelo não colaborou? ${produto || "O boné"} resolve no estilo 😂`, `${produto || fato} ${precoContextual}? O look já abriu espaço 😂`, `${produto || fato} nesse valor? O cabelo aceitou o plano 😂`, `${produto || fato} na oferta? O espelho já aprovou 😂`];
  if (/\bcaixa de som\b/.test(base)) return [`${fato} nesse preço? A vizinhança que lute 😂`, `${fato} na oferta? A playlist já aumentou o volume 😂`, `${fato} nesse valor? A resenha ganhou trilha 😂`, `${fato} na oferta? O silêncio perdeu espaço 😂`];
  if (/\bsmart tv\b|\btv\b/.test(base)) return [`${fato} nesse preço? A sala já ficou interessada 😂`, `${fato} na oferta? A maratona de série agradece 😂`, `${fato} nesse valor? O sofá pediu para conferir 😂`, `${fato} na oferta? A pipoca já ficou pronta 😂`];
  if (/\bferramenta\b|\bfuradeira\b/.test(base)) return [`${fato} nesse preço? A gambiarra agora vem equipada 😂`, `${fato} na oferta? O projeto parado perdeu a desculpa 😂`, `${fato} nesse valor? O reparo já apareceu 😂`, `${fato} na oferta? A bancada aprovou 😂`];
  if (/\bsuco\b|\bbebida\b|\bbarril\b/.test(base)) return [`${fato} nesse preço? A geladeira agradece 😂`, `${fato} na oferta? A resenha percebeu 😂`, `${fato} nesse valor? O copo já se apresentou 😂`, `${fato} na oferta? A geladeira abriu espaço 😂`];
  if (/\brobo aspirador\b|\baspirador\b/.test(base)) return [`${fato} nesse preço? A poeira não gostou dessa oferta 😂`, `${fato} nesse valor? A vassoura sentiu a concorrência 😂`, `${fato} na oferta? A poeira pediu revisão 😂`, `${fato} na oferta? A casa já escalou o reforço 😂`];
  if (/\bpanela\b/.test(base)) return [`${fato} nesse preço? A cozinha já separou lugar 😂`, `${fato} nesse valor? A receita apareceu sozinha 😂`, `${fato} na oferta? O almoço já fez planos 😂`, `${fato} na oferta? O fogão percebeu 😂`];
  if (/\bssd\b/.test(base)) return [`${fato} nesse preço? Os arquivos já fizeram fila 😂`, `${fato} na oferta? O armazenamento chamou 😂`, `${fato} nesse valor? A pasta de arquivos comemorou 😂`, `${fato} na oferta? O espaço ficou interessante 😂`];
  if (/\bcabo\b/.test(base)) return [`${fato} nesse preço? A gaveta de cabos sentiu concorrência 😂`, `${fato} nesse valor? Até o carregador olhou 😂`, `${fato} na oferta? A tomada prestou atenção 😂`, `${fato} na oferta? A gaveta abriu vaga 😂`];
  if (/\btenis\b/.test(base)) return [`${fato} nesse preço? O carrinho já quis calçar 😂`, `${fato} nesse valor? O look saiu andando 😂`, `${fato} na oferta? O pé pediu para conferir 😂`, `${fato} na oferta? O armário abriu espaço 😂`];
  if (/\bblusa\b/.test(base)) return [`${fato} nesse preço? O look já se montou sozinho 😂`, `${fato} nesse valor? O guarda-roupa fez contato visual 😂`, `${fato} na oferta? O espelho pediu uma olhada 😂`, `${fato} na oferta? O look mudou os planos 😂`];
  if (/\bmonitor\b/.test(base)) return [`${fato} nesse preço? O setup já abriu espaço 😂`, `${fato} nesse valor? O setup piscou primeiro 😂`, `${fato} na oferta? O mouse quase clicou sozinho 😂`, `${fato} na oferta? O setup percebeu 😂`];
  return [];
}

function construcoesContextuaisCopyLocalV2({ oferta = {}, sinais = {}, familia = "oportunidade", intencao = "oportunidade", subcontexto = "", assinatura = "" } = {}) {
  const preco = formatarPrecoContextualCopyLocalV2(oferta.precoAtual ?? oferta.precoPor ?? oferta.preco);
  const atributos = extrairAtributosTituloCopyLocalV2(sinais.tituloOriginal || oferta.titulo || oferta.nome);
  const atributo = atributos[0]?.texto || "";
  const emoji = emojiContextualCopyLocalV2(familia, assinatura || sinais.tituloOriginal, sinais.tituloOriginal);
  const rotulo = rotuloFamiliaCopyLocalV2(familia);
  const produto = produtoContextualCopyLocalV2(sinais.tituloOriginal || oferta.titulo || oferta.nome);
  const nome = produto || rotulo;
  const atributoJaNoNome = Boolean(atributo && normalizar(nome).includes(normalizar(atributo)));
  const nomeParaAtributo = atributoJaNoNome ? rotulo : nome;
  const desconto = Number(oferta.descontoPercentual ?? oferta.desconto);
  let construcoes = [];
  const diretas = textos => textos.map(fraseTexto => ({ texto: fraseTexto, tom: "direta" }));

  if (intencao === "cupom" && sinais.cupom === true) {
    construcoes = diretas([
      `${nome} com cupom? Merece carrinho ${emoji}🎟️`, `Tem cupom em ${nome}? Aí ficou bonito 🎟️`,
      `${nome} já chamou atenção; com cupom então... 👀`, `Cupom em ${nome}. Vale abrir 🎟️`,
      `${nome} com cupom no meio? Difícil passar reto ${emoji}`, `Tem cupom nessa oferta. Veja: ${nome} 🎟️`,
      `Cupom deixou ${nome} com um bom motivo para o clique 🎟️`, `Cupom + ${nome}? Vale conferir 👀`
    ]);
  } else if (intencao === "economia" && sinais.desconto === true) {
    const percentual = Number.isFinite(desconto) && desconto > 0 ? `${Math.round(desconto)}% OFF` : "Tem desconto";
    construcoes = diretas([
      `${percentual} em ${nome}? Olha isso ${emoji}`, `${nome} com desconto? Vale o clique 👀`,
      `${nome} por ${preco}? O desconto chamou atenção ${emoji}`, `${percentual} e preço de ${preco}. Vale conferir 👀`,
      `Tem desconto em ${nome}. Difícil passar reto ${emoji}`, `${nome} nesse preço? Abre essa oferta 👀`,
      `${percentual} nessa oferta. ${nome} merece uma olhada`, `${nome} nesse preço chamou atenção ${emoji}`
    ]);
  } else if (intencao === "resgate" && sinais.resgate === true) {
    construcoes = diretas([`Tem resgate em ${nome} 🎟️`, `${nome} com resgate disponível? Vale abrir 🎟️`, `Resgate nessa oferta. Veja: ${nome} 👀`]);
  } else if (intencao === "beneficio" && sinais.beneficio === true) {
    construcoes = diretas([`${nome} com benefício extra? Vale olhar ✨`, `Tem benefício nessa oferta de ${nome} 👀`, `Benefício em ${nome}. Abre para conferir ✨`]);
  } else if (intencao === "frete_gratis" && sinais.freteGratis === true) {
    construcoes = diretas([`${nome} com frete grátis? Vale conferir 🚚`, `Tem frete grátis em ${nome} 🚚`, `${nome} sem frete no caminho? Merece clique 👀`]);
  } else if (intencao === "parcelamento" && sinais.parcelamento === true) {
    construcoes = diretas([`${nome} com parcelamento? Vale conferir 💳`, `Parcelamento disponível em ${nome} 💳`, `${nome} por ${preco} com parcelas disponíveis 👀`]);
  } else if (atributo && preco) {
    construcoes = diretas([
      `${atributo} por esse valor? Olha essa oferta ${emoji}`, `${atributo} nesse preço? Difícil passar reto ${emoji}`,
      `${nomeParaAtributo} com ${atributo} nesse preço? Vale conferir ${emoji}`, `${nomeParaAtributo}, ${atributo}, por esse valor. Abre a oferta 👀`,
      `Olha: ${nomeParaAtributo} com ${atributo}, nesse preço ${emoji}`, `${atributo} por esse preço? Merece clique 👀`,
      `${nomeParaAtributo} nesse valor com ${atributo}? Chamou atenção ${emoji}`, `${atributo} por esse valor? Dá uma olhada ${emoji}`,
      `${nomeParaAtributo} com ${atributo} nesse preço? Olha isso 👀`, `Com ${atributo} nesse preço, vale conferir ${emoji}`,
      `${atributo} nesse preço? Essa oferta pediu um clique 👀`, `${atributo} nesse valor? Difícil passar reto ${emoji}`
    ]);
    construcoes.push(...humorContextualCopyLocalV2({ titulo: sinais.tituloOriginal, produto: nome, atributo, preco }).map(fraseTexto => ({ texto: fraseTexto, tom: "humor" })));
  } else if (preco) {
    construcoes = diretas([
      `${nome} por esse valor? Difícil passar reto ${emoji}`, `Por esse preço, ${nome} merece uma olhada 👀`,
      `Olha: ${nome} nesse preço ${emoji}`, `Com esse valor, ${nome} chamou atenção 👀`,
      `Esse preço combina com ${nome}? Vale o clique ${emoji}`, `Vale abrir: ${nome} por esse valor 👀`,
      `Nesse preço, ${nome} chamou atenção ${emoji}`, `Dá uma conferida em ${nome} nesse valor 👀`,
      `Oferta de ${nome} nesse preço? Merece atenção ${emoji}`, `Se estava de olho em ${nome}, vale conferir 👀`
    ]);
    construcoes.push(...humorContextualCopyLocalV2({ titulo: sinais.tituloOriginal, produto: nome, preco }).map(fraseTexto => ({ texto: fraseTexto, tom: "humor" })));
  } else if (atributo) {
    construcoes = diretas([`${nome} com ${atributo}? Vale conferir ${emoji}`, `${atributo} explícito no ${nome}. Olha isso 👀`, `${nome}, ${atributo}. Merece uma olhada ${emoji}`]);
  } else if (subcontexto === "cabelo") {
    construcoes = diretas(["Cuidado para os fios que chamou atenção 😍", "Rotina do cabelo com novidade por aqui ✨"]);
  } else if (subcontexto === "cozinha") {
    construcoes = diretas(["Item de cozinha que merece uma olhada 🍳", "Olha essa opção para a rotina da cozinha 🍳"]);
  } else if (subcontexto === "setup") {
    construcoes = diretas(["O setup merece ver essa oferta 🎮", "Tem item para o setup chamando por aqui 🎮"]);
  } else if (subcontexto === "limpeza_pratica") {
    construcoes = diretas(["Item de limpeza que merece uma olhada 🧹", "Olha essa opção para a rotina de limpeza 🧹"]);
  } else if (subcontexto === "pesca") {
    construcoes = diretas(["Item para a próxima pescaria? Vale olhar 🎣", "Quem gosta de pesca vai querer conferir 🎣"]);
  } else {
    construcoes = diretas([`${rotulo} chamou atenção por aqui ${emoji}`, `Essa oferta merece uma olhada ${emoji}`, `Vale abrir para conferir os detalhes 👀`]);
  }

  return construcoes.map((construcao, indice) => ({
    id: `contextual_${intencao}_${familia}_${indice + 1}`,
    texto: construcao.texto,
    familia,
    intencoes: [intencao],
    exige: intencao === "cupom" ? ["cupom"] : intencao === "economia" ? ["desconto"] : [],
    proibe: [],
    palavrasContexto: subcontexto ? [subcontexto] : [],
    tom: construcao.tom || "direta",
    peso: construcao.tom === "humor" ? 44 : 52,
    ativo: true,
    contextual: true,
    atributos
  }));
}

function tamanhoCacheCopyLocalV2() {
  removerExpiradasCopyLocalV2();
  return cacheLocalV2.size;
}

function categoriaAliasOficialCopyLocalV2(categoria = "") {
  const alias = ALIASES_CATEGORIA_OFICIAL_COPY_LOCAL_V2[normalizar(categoria)];
  return categoriaExiste(alias) ? alias : "";
}

function categoriaOficialCopyLocalV2(oferta = {}, sinais = normalizarSinaisCopy(oferta)) {
  const declarada = texto(sinais.categoria || oferta.categoria || oferta.categoriaProduto);
  if (categoriaExiste(declarada)) return declarada;
  const aliasOficial = categoriaAliasOficialCopyLocalV2(declarada);
  if (aliasOficial) return aliasOficial;

  const classificada = classificarCategoriaOferta({
    ...oferta,
    categoria: "",
    categoriaProduto: ""
  }, sinais.tituloOriginal || oferta.titulo || oferta.nome || "");
  return categoriaExiste(classificada) ? classificada : "Diversos";
}

function resolverFamiliaOfertaCopyLocalV2(oferta = {}, sinais = normalizarSinaisCopy(oferta)) {
  const categoriaOficial = categoriaOficialCopyLocalV2(oferta, sinais);
  return {
    categoriaOficial,
    familia: familiaDaCategoriaCopyV2(categoriaOficial)
  };
}

function contemToken(base = "", termos = []) {
  return termos.some(termo => {
    const alvo = normalizar(termo);
    return alvo && ` ${base} `.includes(` ${alvo} `);
  });
}

function resolverSubcontextoCopyLocalV2({ tituloOriginal = "", familia = "" } = {}) {
  const base = normalizar(tituloOriginal);
  if (!base) return "";

  if (["limpeza", "casa_eletro", "cozinha_pratica"].includes(familia) && contemToken(base, [
    "aspirador robo", "robo aspirador", "aspirador de po", "aspirador vertical"
  ])) {
    return "limpeza_pratica";
  }

  if (familia === "beleza" && contemToken(base, [
    "escova secadora", "secador de cabelo", "chapinha", "prancha de cabelo",
    "shampoo", "condicionador", "mascara capilar"
  ])) {
    return "cabelo";
  }

  if (["casa", "casa_eletro", "cozinha_pratica"].includes(familia) && contemToken(base, [
    "panela", "frigideira", "air fryer", "cafeteira", "liquidificador",
    "batedeira", "processador de alimentos"
  ])) {
    return "cozinha";
  }

  if (["gamer", "perifericos"].includes(familia) && contemToken(base, [
    "mouse gamer", "teclado gamer", "teclado mecanico", "headset gamer",
    "mousepad", "controle gamer"
  ])) {
    return "setup";
  }

  if (familia === "pesca_camping" && contemToken(base, [
    "vara de pesca", "molinete", "carretilha", "isca artificial", "anzol"
  ])) {
    return "pesca";
  }

  return "";
}

function resolverIntencaoCopyLocalV2(sinais = {}, familia = FAMILIA_OPORTUNIDADE_V2) {
  if (sinais.resgate === true) return { intencao: "resgate", motivo: "resgate_real" };
  if (sinais.cupom === true) return { intencao: "cupom", motivo: "cupom_real" };
  if (sinais.beneficio === true) return { intencao: "beneficio", motivo: "beneficio_comprovado" };
  if (sinais.desconto === true) return { intencao: "economia", motivo: "desconto_oficial" };
  if (sinais.freteGratis === true) return { intencao: "frete_gratis", motivo: "frete_gratis_oficial" };
  if (sinais.parcelamento === true) return { intencao: "parcelamento", motivo: "parcelamento_oficial" };
  if (familia && familia !== FAMILIA_OPORTUNIDADE_V2) return { intencao: "familia", motivo: "familia_oficial" };
  return { intencao: "oportunidade", motivo: "fallback_oportunidade" };
}

function fatosValidatorCopyLocalV2(sinais = {}) {
  return {
    cupom: sinais.cupom === true,
    resgate: sinais.resgate === true,
    freteGratis: sinais.freteGratis === true,
    descontoOficial: sinais.desconto === true,
    beneficioSeguro: sinais.beneficio === true,
    parcelamento: sinais.parcelamento === true
  };
}

function requisitoAtendidoLocalV2(requisito = "", sinais = {}) {
  const req = texto(requisito);
  if (!req) return true;
  return sinais[req] === true;
}

function proibicaoAtendidaLocalV2(proibicao = "", sinais = {}) {
  const item = texto(proibicao);
  if (!item) return true;
  return sinais[item] !== true;
}

function fraseContextoCompativel(frase = {}, subcontexto = "") {
  const palavras = Array.isArray(frase.palavrasContexto) ? frase.palavrasContexto.map(texto).filter(Boolean) : [];
  if (!palavras.length) return true;
  return Boolean(subcontexto && palavras.includes(subcontexto));
}

function fraseElegivelCopyLocalV2(frase = {}, contexto = {}) {
  if (!frase || typeof frase !== "object" || frase.ativo === false) return false;
  const intencoes = Array.isArray(frase.intencoes) ? frase.intencoes : [];
  const familiaFrase = texto(frase.familia || FAMILIA_OPORTUNIDADE_V2);
  const familiaOk = familiaFrase === "qualquer" ||
    familiaFrase === contexto.familia ||
    (contexto.intencao === "oportunidade" && familiaFrase === FAMILIA_OPORTUNIDADE_V2);
  const intencaoOk = intencoes.includes(contexto.intencao);
  const requisitos = Array.isArray(frase.exige) ? frase.exige : [];
  const proibe = Array.isArray(frase.proibe) ? frase.proibe : [];
  if (!familiaOk || !intencaoOk) return false;
  if (PADRAO_COPY_LOCAL_V2_INELEGIVEL.test(normalizar(frase.texto))) return false;
  if (!fraseContextoCompativel(frase, contexto.subcontexto)) return false;
  if (!requisitos.every(req => requisitoAtendidoLocalV2(req, contexto.sinais))) return false;
  if (!proibe.every(item => proibicaoAtendidaLocalV2(item, contexto.sinais))) return false;

  const validacao = validarCopyV2({
    textoGerado: frase.texto,
    contexto: { fatosPermitidos: fatosValidatorCopyLocalV2(contexto.sinais) }
  });
  return validacao.valida === true;
}

function filtrarFrasesCopyLocalV2(banco = BANCO_ASSOCIATIVO_V2, contexto = {}) {
  const lista = Array.isArray(banco) ? banco : [];
  const candidatas = lista.filter(frase => fraseElegivelCopyLocalV2(frase, contexto));
  if (candidatas.length) {
    if (INTENCOES_COMERCIAIS_GLOBAIS_COPY_LOCAL_V2.includes(texto(contexto.intencao))) {
      const contextuais = candidatas.filter(frase => texto(frase.familia) === texto(contexto.familia));
      if (contextuais.length) return contextuais;
    }
    const subcontexto = texto(contexto.subcontexto);
    const especificas = subcontexto
      ? candidatas.filter(frase => (Array.isArray(frase.palavrasContexto) ? frase.palavrasContexto.map(texto) : []).includes(subcontexto))
      : [];
    return especificas.length ? especificas : candidatas;
  }
  if (contexto.intencao === "oportunidade") return [];
  return lista.filter(frase => fraseElegivelCopyLocalV2(frase, {
    ...contexto,
    familia: FAMILIA_OPORTUNIDADE_V2,
    intencao: "oportunidade",
    subcontexto: ""
  }));
}

function ultimasFrasesCopyLocalV2(chave = "") {
  return historicoLocalV2.get(String(chave || "")) || [];
}

function estruturaFraseCopyLocalV2(fraseTexto = "") {
  const base = normalizar(fraseTexto)
    .replace(/^[^\w]+/, "")
    .replace(/\b(?:mesmo|ai|aqui|so)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const palavras = base.split(/\s+/).filter(Boolean);
  if (!palavras.length) return "";
  if (["vai", "olha", "tem", "essa", "esse", "seu", "sua", "quem", "para", "ja", "nao"].includes(palavras[0])) {
    return palavras.slice(0, 2).join(" ");
  }
  return palavras[0];
}

function registrarFraseCopyLocalV2(chave = "", fraseEntrada = "") {
  const id = String(chave || "");
  const frase = fraseEntrada && typeof fraseEntrada === "object" ? fraseEntrada : { texto: fraseEntrada };
  const valor = texto(frase.texto);
  if (!id || !valor) return;
  const lista = [valor, ...ultimasFrasesCopyLocalV2(id).filter(item => item !== valor)].slice(0, LIMITE_HISTORICO_COPY_LOCAL_V2);
  historicoLocalV2.set(id, lista);
  const emoji = (valor.match(/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u) || valor.match(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]$/u) || [""])[0];
  const meta = {
    id: texto(frase.id),
    estrutura: estruturaFraseCopyLocalV2(valor),
    emoji,
    texto: valor
  };
  const anteriores = historicoMetaLocalV2.get(id) || [];
  historicoMetaLocalV2.set(id, [meta, ...anteriores.filter(item => item.texto !== valor)].slice(0, LIMITE_HISTORICO_COPY_LOCAL_V2));
}

function escolherPorPesoLocalV2(frases = [], chaveOferta = "") {
  const candidatas = [...frases].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!candidatas.length) return null;
  const totalPeso = candidatas.reduce((total, item) => total + Math.max(1, Number(item.peso) || 1), 0);
  let ponto = parseInt(hashLocalV2(chaveOferta).slice(0, 8), 16) % totalPeso;
  for (let i = 0; i < candidatas.length; i += 1) {
    ponto -= Math.max(1, Number(candidatas[i].peso) || 1);
    if (ponto < 0) return candidatas[i];
  }
  return candidatas[0];
}

function escolherFrasePonderadaCopyLocalV2({ frases = [], chaveOferta = "", historicoKey = "" } = {}) {
  const candidatas = [...frases].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!candidatas.length) return null;

  const historico = ultimasFrasesCopyLocalV2(historicoKey);
  const historicoMeta = historicoMetaLocalV2.get(String(historicoKey || "")) || [];
  const ultima = historico[0] || "";
  const elegiveis = candidatas.length > 1
    ? candidatas.filter(item => texto(item.texto) !== ultima)
    : candidatas;
  const recentes = new Set(historico);
  const idsRecentes = new Set(historicoMeta.map(item => item.id).filter(Boolean));
  const foraDoHistorico = elegiveis.filter(item => !recentes.has(texto(item.texto)) && !idsRecentes.has(texto(item.id)));
  const estruturasRecentes = new Set(historico.slice(0, 6).map(estruturaFraseCopyLocalV2).filter(Boolean));
  const semEstruturaRecente = foraDoHistorico.filter(item => {
    const estrutura = estruturaFraseCopyLocalV2(item.texto);
    return !estrutura || !estruturasRecentes.has(estrutura);
  });
  const pool = semEstruturaRecente.length ? semEstruturaRecente : foraDoHistorico.length ? foraDoHistorico : elegiveis;
  const escolhida = foraDoHistorico.length
    ? escolherPorPesoLocalV2(pool, chaveOferta)
    : [...pool].sort((a, b) => {
      const idadeA = historico.indexOf(texto(a.texto));
      const idadeB = historico.indexOf(texto(b.texto));
      const ordemA = idadeA >= 0 ? idadeA : Number.MAX_SAFE_INTEGER;
      const ordemB = idadeB >= 0 ? idadeB : Number.MAX_SAFE_INTEGER;
      if (ordemA !== ordemB) return ordemB - ordemA;
      return String(a.id).localeCompare(String(b.id));
    })[0];
  if (!escolhida) return null;
  registrarFraseCopyLocalV2(historicoKey, escolhida);
  return escolhida;
}

function historicoKeyCopyLocalV2({ clienteId = "admin", familia = "", intencao = "" } = {}) {
  const workspace = texto(clienteId) || "admin";
  const intencaoNormalizada = texto(intencao);
  if (INTENCOES_COMERCIAIS_GLOBAIS_COPY_LOCAL_V2.includes(intencaoNormalizada)) {
    return `${workspace}:${intencaoNormalizada}`;
  }
  return `${workspace}:${familia}:${intencaoNormalizada}`;
}

function chaveCacheCopyLocalV2({ clienteId = "admin", oferta = {}, sinais = {}, categoriaOficial = "", familia = "", intencao = "", subcontexto = "" } = {}) {
  const chaveOferta = chaveSinais(clienteId, oferta, sinais);
  if (!chaveOferta) return "";
  return hashLocalV2(JSON.stringify({
    versao: "copy-local-v2-2-contextual",
    clienteId: texto(clienteId) || "admin",
    chaveOferta,
    categoriaOficial,
    familia,
    intencao,
    subcontexto,
    sinaisHash: hashSinaisComerciais(oferta, sinais)
  }));
}

function fallbackLocalV2(motivo = "fallback_v1", extra = {}) {
  return {
    ok: false,
    tituloIa: "",
    fonte: FONTE_COPY_LOCAL_V2,
    motivoFallback: motivo,
    cacheHit: false,
    ...extra
  };
}

function resolverCopyLocalV2({ oferta = {}, destino = {}, clienteId = "admin", plano = {}, ttlMs = TTL_COPY_LOCAL_V2_MS, banco = BANCO_ASSOCIATIVO_V2 } = {}) {
  try {
    if (String(destino?.tituloOferta || "").trim().toLowerCase() !== "ia") {
      return fallbackLocalV2("destino_original");
    }
    if (!planoPermiteTituloIa(plano)) {
      return fallbackLocalV2("feature_tituloIa_indisponivel", { ofertaId: ofertaIdCopy(oferta) });
    }

    const sinais = normalizarSinaisCopy(oferta);
    const { categoriaOficial, familia } = resolverFamiliaOfertaCopyLocalV2(oferta, sinais);
    const subcontexto = resolverSubcontextoCopyLocalV2({ tituloOriginal: sinais.tituloOriginal, familia });
    const resolucaoIntencao = resolverIntencaoCopyLocalV2(sinais, familia);
    const contexto = {
      sinais,
      categoriaOficial,
      familia,
      intencao: resolucaoIntencao.intencao,
      subcontexto,
      atributos: extrairAtributosTituloCopyLocalV2(sinais.tituloOriginal)
    };
    const cacheKey = chaveCacheCopyLocalV2({ clienteId, oferta, sinais, categoriaOficial, familia, intencao: contexto.intencao, subcontexto });

    if (cacheKey) {
      const cached = lerCacheCopyLocalV2(cacheKey);
      if (cached?.tituloIa) return { ...cached, cacheHit: true };
    }

    const frasesContextuais = construcoesContextuaisCopyLocalV2({
      oferta,
      sinais,
      familia,
      intencao: contexto.intencao,
      subcontexto,
      assinatura: cacheKey || chaveSinais(clienteId, oferta, sinais)
    }).filter(frase => fraseElegivelCopyLocalV2(frase, contexto));
    const precoContextual = formatarPrecoContextualCopyLocalV2(oferta.precoAtual ?? oferta.precoPor ?? oferta.preco);
    const produtoContextual = produtoContextualCopyLocalV2(sinais.tituloOriginal);
    const sinalComercialForte = INTENCOES_COMERCIAIS_GLOBAIS_COPY_LOCAL_V2.includes(contexto.intencao);
    const contextoFactualForte = sinalComercialForte || contexto.atributos.length > 0 || Boolean(precoContextual && produtoContextual);
    const frasesBanco = filtrarFrasesCopyLocalV2(banco, contexto);
    const frases = contextoFactualForte && frasesContextuais.length
      ? frasesContextuais
      : [...frasesContextuais, ...frasesBanco];
    if (!frases.length) {
      return fallbackLocalV2("frase_segura_indisponivel", contexto);
    }

    const historicoKey = historicoKeyCopyLocalV2({ clienteId, familia, intencao: contexto.intencao });
    const frase = escolherFrasePonderadaCopyLocalV2({
      frases,
      chaveOferta: `${cacheKey || chaveSinais(clienteId, oferta, sinais)}:${familia}:${contexto.intencao}:${subcontexto}`,
      historicoKey
    });
    if (!frase) return fallbackLocalV2("frase_segura_indisponivel", contexto);

    const resultado = {
      ok: true,
      tituloIa: acentuarApresentacaoCopyLocalV2(frase.texto),
      intencao: contexto.intencao,
      familia,
      categoriaOficial,
      subcontexto,
      atributos: contexto.atributos,
      fraseId: frase.id,
      tom: frase.tom || "",
      contextual: frase.contextual === true,
      fonte: FONTE_COPY_LOCAL_V2,
      motivo: resolucaoIntencao.motivo,
      cacheHit: false
    };
    if (cacheKey) salvarCacheCopyLocalV2(cacheKey, resultado, ttlMs);
    return resultado;
  } catch (erro) {
    return fallbackLocalV2("erro_motor_local_v2", {
      motivo: erro?.message || "erro"
    });
  }
}

function resumoBancoAssociativoV2(banco = BANCO_ASSOCIATIVO_V2) {
  const porFamilia = {};
  const porIntencao = {};
  for (const item of Array.isArray(banco) ? banco : []) {
    if (!item || item.ativo === false) continue;
    const familia = item.familia || "";
    porFamilia[familia] = (porFamilia[familia] || 0) + 1;
    for (const intencao of Array.isArray(item.intencoes) ? item.intencoes : []) {
      porIntencao[intencao] = (porIntencao[intencao] || 0) + 1;
    }
  }
  return {
    total: Array.isArray(banco) ? banco.filter(item => item?.ativo !== false).length : 0,
    porFamilia,
    porIntencao,
    categoriasOficiais: CATEGORIAS_OPTIMUS.length
  };
}

function tamanhoCacheCopyLocalV2Bruto() {
  return cacheLocalV2.size;
}

function tamanhoHistoricoCopyLocalV2() {
  return historicoLocalV2.size;
}

module.exports = {
  TTL_COPY_LOCAL_V2_MS,
  MAX_CACHE_COPY_LOCAL_V2,
  LIMITE_HISTORICO_COPY_LOCAL_V2,
  INTENCOES_COMERCIAIS_GLOBAIS_COPY_LOCAL_V2,
  FONTE_COPY_LOCAL_V2,
  PADRAO_COPY_LOCAL_V2_INELEGIVEL,
  EMOJIS_FAMILIA_COPY_LOCAL_V2,
  hashLocalV2,
  categoriaOficialCopyLocalV2,
  categoriaAliasOficialCopyLocalV2,
  resolverFamiliaOfertaCopyLocalV2,
  resolverSubcontextoCopyLocalV2,
  extrairAtributosTituloCopyLocalV2,
  acentuarApresentacaoCopyLocalV2,
  produtoContextualCopyLocalV2,
  humorContextualCopyLocalV2,
  construcoesContextuaisCopyLocalV2,
  resolverIntencaoCopyLocalV2,
  fatosValidatorCopyLocalV2,
  fraseElegivelCopyLocalV2,
  filtrarFrasesCopyLocalV2,
  chaveCacheCopyLocalV2,
  escolherFrasePonderadaCopyLocalV2,
  estruturaFraseCopyLocalV2,
  historicoKeyCopyLocalV2,
  ultimasFrasesCopyLocalV2,
  lerCacheCopyLocalV2,
  salvarCacheCopyLocalV2,
  removerExpiradasCopyLocalV2,
  limparCacheCopyLocalV2,
  tamanhoCacheCopyLocalV2,
  tamanhoCacheCopyLocalV2Bruto,
  tamanhoHistoricoCopyLocalV2,
  resolverCopyLocalV2,
  resumoBancoAssociativoV2
};
