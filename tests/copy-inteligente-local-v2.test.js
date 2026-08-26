const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-copy-local-v2-"));
process.env.DATA_DIR = dataDir;

const { CATEGORIAS_OPTIMUS } = require("../marketplaces/inteligencia/categorias-globais");
const copy = require("../modules/copy-inteligente");
const { validarCopyV2 } = require("../modules/copy-inteligente/validator-v2");
const { montarMensagemOferta } = require("../utils/mensagens-ofertas");

function planoTituloIa(ativo = true) {
  return { recursos: { tituloIa: ativo, templatePersonalizado: true, copyIaGenerativa: false } };
}

function ofertaBase(extra = {}) {
  return {
    id: "local_v2_base",
    engineOfertaId: "local_v2_base",
    clienteId: "cliente_local_v2",
    marketplace: "amazon",
    titulo: "Produto Original Oficial",
    nome: "Produto Original Oficial",
    categoria: "Diversos",
    precoAtual: 100,
    precoOriginal: 129.9,
    cupom: "",
    linkAfiliado: "https://go.example/local-v2",
    imagem: "https://img.example/local-v2.jpg",
    ...extra
  };
}

function resolver(oferta, extra = {}) {
  return copy.resolverCopyLocalV2({
    oferta,
    destino: { id: "destino_local_v2", tipo: "whatsapp", tituloOferta: "ia", ...(extra.destino || {}) },
    clienteId: extra.clienteId || "cliente_local_v2",
    plano: extra.plano || planoTituloIa(true),
    ttlMs: extra.ttlMs,
    banco: extra.banco
  });
}

function renderizar(oferta, destino = {}, plano = planoTituloIa(true)) {
  return montarMensagemOferta(oferta, {
    clienteId: "cliente_local_v2",
    destino: { id: "destino_local_v2", tipo: "whatsapp", tituloOferta: "ia", ...destino },
    plano
  });
}

copy.limparCacheCopyLocalV2();
copy.limparCacheCopyInteligente();

assert.deepStrictEqual(copy.categoriasSemFamiliaCopyV2(), [], "100% categorias oficiais possuem familia");
for (const categoria of CATEGORIAS_OPTIMUS) {
  assert.ok(copy.CATEGORIA_PARA_FAMILIA_V2[categoria], `categoria oficial mapeada: ${categoria}`);
}
assert.strictEqual(copy.familiaDaCategoriaCopyV2("Diversos"), "oportunidade", "Diversos -> oportunidade");
assert.strictEqual(copy.familiaDaCategoriaCopyV2("Climatização e Ventilação"), "climatizacao", "Climatizacao preservada");
assert.strictEqual(copy.resolverFamiliaOfertaCopyLocalV2(ofertaBase({ categoria: "Casa" })).familia, "casa", "alias legado Casa -> familia casa");

assert.strictEqual(copy.EXPANSAO_HUMANA_V23.length, 468, "V2.3 adiciona quantidade esperada de ganchos humanos");

const totalV23PorFamilia = {};
const estruturasV23PorFamilia = {};
let totalComEmojiV23 = 0;
let totalSemEmojiV23 = 0;
for (const fraseV23 of copy.EXPANSAO_HUMANA_V23) {
  totalV23PorFamilia[fraseV23.familia] = (totalV23PorFamilia[fraseV23.familia] || 0) + 1;
  const estrutura = copy.estruturaFraseCopyLocalV2(fraseV23.texto);
  estruturasV23PorFamilia[fraseV23.familia] = estruturasV23PorFamilia[fraseV23.familia] || new Set();
  estruturasV23PorFamilia[fraseV23.familia].add(estrutura);
  if (/\p{Extended_Pictographic}/u.test(fraseV23.texto)) totalComEmojiV23 += 1;
  else totalSemEmojiV23 += 1;

  const exige = Array.isArray(fraseV23.exige) ? fraseV23.exige : [];
  const validacao = validarCopyV2({
    textoGerado: fraseV23.texto,
    contexto: {
      fatosPermitidos: {
        cupom: exige.includes("cupom"),
        resgate: exige.includes("resgate"),
        beneficioSeguro: exige.includes("beneficio"),
        descontoOficial: exige.includes("desconto"),
        freteGratis: exige.includes("freteGratis"),
        parcelamento: exige.includes("parcelamento")
      }
    }
  });
  assert.strictEqual(validacao.valida, true, `V2.3 valida frase ${fraseV23.id}: ${validacao.motivoCodigo}`);
}

for (const familia of ["gamer", "celulares", "moda", "calcados", "casa", "cozinha_pratica", "pet", "ferramentas", "mercado", "beleza", "computadores", "oportunidade"]) {
  assert.ok(totalV23PorFamilia[familia] >= 35, `V2.3 tem ao menos 35 ganchos para ${familia}`);
  assert.ok(estruturasV23PorFamilia[familia].size >= 18, `V2.3 varia estrutura em ${familia}`);
}
assert.ok(totalComEmojiV23 >= 40, "V2.3 usa emojis emocionais em parte do banco");
assert.ok(totalSemEmojiV23 > totalComEmojiV23 * 5, "V2.3 nao obriga emoji em todo gancho");

const casosFamilia = [
  ["gamer", ofertaBase({ id: "fam_gamer", engineOfertaId: "fam_gamer", categoria: "Gamer e Hardware" }), "gamer"],
  ["beleza", ofertaBase({ id: "fam_beleza", engineOfertaId: "fam_beleza", categoria: "Perfumaria, Farmácia e Beleza" }), "beleza"],
  ["cabelo", ofertaBase({ id: "fam_cabelo", engineOfertaId: "fam_cabelo", categoria: "Perfumaria, Farmácia e Beleza", titulo: "Escova secadora para cabelo" }), "beleza"],
  ["casa", ofertaBase({ id: "fam_casa", engineOfertaId: "fam_casa", categoria: "Casa, Móveis e Decoração" }), "casa"],
  ["cozinha", ofertaBase({ id: "fam_cozinha", engineOfertaId: "fam_cozinha", categoria: "Casa, Móveis e Decoração", titulo: "Panela antiaderente para cozinha" }), "casa"],
  ["bebe", ofertaBase({ id: "fam_bebe", engineOfertaId: "fam_bebe", categoria: "Bebês e Acessórios" }), "bebe"],
  ["pet", ofertaBase({ id: "fam_pet", engineOfertaId: "fam_pet", categoria: "Pet Shop e Fazendinha" }), "pet"],
  ["pesca", ofertaBase({ id: "fam_pesca", engineOfertaId: "fam_pesca", categoria: "Pesca e Camping", titulo: "Vara de pesca carbono" }), "pesca_camping"],
  ["automotivo", ofertaBase({ id: "fam_auto", engineOfertaId: "fam_auto", categoria: "Automotivo" }), "automotivo"],
  ["ferramentas", ofertaBase({ id: "fam_ferramentas", engineOfertaId: "fam_ferramentas", categoria: "Ferramentas" }), "ferramentas"],
  ["moda", ofertaBase({ id: "fam_moda", engineOfertaId: "fam_moda", categoria: "Roupas e Moda Feminina" }), "moda"],
  ["audio/TV", ofertaBase({ id: "fam_audio", engineOfertaId: "fam_audio", categoria: "Audio TV" }), "audio_tv"],
  ["celulares", ofertaBase({ id: "fam_cel", engineOfertaId: "fam_cel", categoria: "Celulares e Smartphones" }), "celulares"],
  ["computadores", ofertaBase({ id: "fam_pc", engineOfertaId: "fam_pc", categoria: "Computadores e Notebook" }), "computadores"],
  ["perifericos", ofertaBase({ id: "fam_perif", engineOfertaId: "fam_perif", categoria: "Periféricos" }), "perifericos"],
  ["games", ofertaBase({ id: "fam_games", engineOfertaId: "fam_games", categoria: "Games e Console" }), "games"],
  ["brinquedos", ofertaBase({ id: "fam_brinquedos", engineOfertaId: "fam_brinquedos", categoria: "Brinquedos e Artigos Infantis" }), "brinquedos"],
  ["limpeza", ofertaBase({ id: "fam_limpeza", engineOfertaId: "fam_limpeza", categoria: "Limpeza" }), "limpeza"],
  ["climatizacao", ofertaBase({ id: "fam_clima", engineOfertaId: "fam_clima", categoria: "Climatização e Ventilação" }), "climatizacao"],
  ["iluminacao", ofertaBase({ id: "fam_luz", engineOfertaId: "fam_luz", categoria: "Iluminação e Elétrica" }), "iluminacao"]
];

for (const [nome, oferta, familiaEsperada] of casosFamilia) {
  const res = resolver(oferta);
  assert.strictEqual(res.ok, true, `${nome}: resolve copy local`);
  assert.strictEqual(res.familia, familiaEsperada, `${nome}: familia correta`);
  assert.ok(res.tituloIa && res.fonte === copy.FONTE_COPY_LOCAL_V2, `${nome}: usa banco local`);
}

assert.strictEqual(resolver(ofertaBase({ id: "sub_cabelo", engineOfertaId: "sub_cabelo", categoria: "Perfumaria, Farmácia e Beleza", titulo: "Shampoo hidratante" })).subcontexto, "cabelo", "subcontexto cabelo seguro");
assert.strictEqual(resolver(ofertaBase({ id: "sub_setup", engineOfertaId: "sub_setup", categoria: "Gamer e Hardware", titulo: "Teclado mecanico gamer" })).subcontexto, "setup", "subcontexto setup seguro");
assert.strictEqual(resolver(ofertaBase({ id: "sub_limpeza", engineOfertaId: "sub_limpeza", categoria: "Limpeza", titulo: "Robo aspirador inteligente" })).subcontexto, "limpeza_pratica", "subcontexto limpeza seguro");
assert.strictEqual(resolver(ofertaBase({ id: "sub_ambiguo", engineOfertaId: "sub_ambiguo", categoria: "Periféricos", titulo: "Monitor Full HD" })).subcontexto, "", "termo ambiguo nao especializa");

const ofertaSimplesFamilia = (extra = {}) => ofertaBase({
  precoOriginal: "",
  descontoPercentual: "",
  cupom: "",
  ...extra
});

const casosAutoridadeFamilia = [
  ["notebook_alias_informatica", ofertaSimplesFamilia({
    id: "auth_notebook_alias",
    engineOfertaId: "auth_notebook_alias",
    categoria: "Computadores e Informatica",
    titulo: "Notebook Lenovo IdeaPad Intel Core i5 16GB 512GB SSD"
  }), "Computadores e Notebook", "computadores", "familia"],
  ["computadores_gamer_incidental", ofertaSimplesFamilia({
    id: "auth_pc_gamer_incidental",
    engineOfertaId: "auth_pc_gamer_incidental",
    categoria: "Computadores e Informatica",
    titulo: "Notebook Lenovo gamer Intel Core i5 16GB 512GB SSD"
  }), "Computadores e Notebook", "computadores", "familia"],
  ["cabo_usb_c_informatica", ofertaSimplesFamilia({
    id: "auth_cabo_usb_c",
    engineOfertaId: "auth_cabo_usb_c",
    categoria: "Informatica",
    titulo: "Cabo USB-C 60W trancado 2m para celular e notebook"
  }), "Computadores e Notebook", "computadores", "familia"],
  ["smartphone_celulares", ofertaSimplesFamilia({
    id: "auth_smartphone",
    engineOfertaId: "auth_smartphone",
    categoria: "Celulares e Smartphones",
    titulo: "Smartphone Samsung Galaxy A56 5G 256GB"
  }), "Celulares e Smartphones", "celulares", "familia"],
  ["gamer_hardware_setup", ofertaSimplesFamilia({
    id: "auth_gamer_setup",
    engineOfertaId: "auth_gamer_setup",
    categoria: "Gamer e Hardware",
    titulo: "SSD NVMe para setup gamer"
  }), "Gamer e Hardware", "gamer", "familia"],
  ["casa_panela_cozinha", ofertaSimplesFamilia({
    id: "auth_casa_panela",
    engineOfertaId: "auth_casa_panela",
    categoria: "Casa, Móveis e Decoração",
    titulo: "Panela de pressao inox 4,5L"
  }), "Casa, Móveis e Decoração", "casa", "familia"],
  ["diversos_indicativo_seguro", ofertaSimplesFamilia({
    id: "auth_diversos_indicativo",
    engineOfertaId: "auth_diversos_indicativo",
    categoria: "Diversos",
    titulo: "Smartphone Samsung Galaxy A56 5G 256GB"
  }), "Diversos", "oportunidade", "oportunidade"]
];

copy.limparCacheCopyLocalV2();
for (const [nome, oferta, categoriaEsperada, familiaEsperada, intencaoEsperada] of casosAutoridadeFamilia) {
  const res = resolver(oferta, { clienteId: `workspace_${nome}` });
  assert.strictEqual(res.ok, true, `${nome}: resolve copy local`);
  assert.strictEqual(res.categoriaOficial, categoriaEsperada, `${nome}: categoria oficial tem autoridade`);
  assert.strictEqual(res.familia, familiaEsperada, `${nome}: familia respeita categoria oficial`);
  assert.strictEqual(res.intencao, intencaoEsperada, `${nome}: intencao esperada`);
}
assert.strictEqual(
  resolver(ofertaSimplesFamilia({
    id: "auth_casa_panela_sub",
    engineOfertaId: "auth_casa_panela_sub",
    categoria: "Casa, Móveis e Decoração",
    titulo: "Panela de pressao inox 4,5L"
  }), { clienteId: "workspace_auth_casa_panela_sub" }).subcontexto,
  "cozinha",
  "titulo refina subcontexto cozinha dentro da familia casa"
);

const casosComerciaisContextuaisV23 = [
  ["gamer_cupom", { categoria: "Gamer e Hardware", titulo: "Teclado mecanico gamer", cupom: "PROMO10" }, "gamer", "cupom"],
  ["calcados_cupom", { categoria: "Tênis e Chinelos", titulo: "Tenis Nike Revolution", cupom: "PROMO10" }, "calcados", "cupom"],
  ["casa_desconto", { categoria: "Casa, Móveis e Decoração", titulo: "Organizador para cozinha", descontoPercentual: 20 }, "casa", "economia"],
  ["celular_parcelamento", { categoria: "Celulares e Smartphones", titulo: "Smartphone Samsung Galaxy A56", parcelamento: "10x sem juros" }, "celulares", "parcelamento"]
];

copy.limparCacheCopyLocalV2();
for (const [nome, extra, familiaEsperada, intencaoEsperada] of casosComerciaisContextuaisV23) {
  const res = resolver(ofertaSimplesFamilia({
    id: `v23_${nome}`,
    engineOfertaId: `v23_${nome}`,
    ...extra
  }), { clienteId: `workspace_v23_${nome}` });
  assert.strictEqual(res.ok, true, `${nome}: resolve copy local contextual`);
  assert.strictEqual(res.familia, familiaEsperada, `${nome}: familia preservada`);
  assert.strictEqual(res.intencao, intencaoEsperada, `${nome}: intencao comercial preservada`);
  assert.ok(/_v23_/.test(res.fraseId), `${nome}: usa frase contextual V2.3`);
}

copy.limparCacheCopyLocalV2();
const semCupom = resolver(ofertaBase({ id: "sem_cupom", engineOfertaId: "sem_cupom", categoria: "Diversos" }), {
  banco: [{ id: "danger_cupom", texto: "Tem cupom nessa oferta", familia: "qualquer", intencoes: ["cupom"], exige: ["cupom"], proibe: [], palavrasContexto: [], peso: 1, ativo: true }]
});
assert.strictEqual(semCupom.ok, false, "sem cupom nao usa frase de cupom");

const cupom = resolver(ofertaBase({ id: "cupom_real", engineOfertaId: "cupom_real", cupom: "PROMO10" }));
assert.strictEqual(cupom.intencao, "cupom", "cupom real vence familia");
assert.ok(/cupom/i.test(cupom.tituloIa), "cupom real pode usar frase de cupom");

const resgate = resolver(ofertaBase({ id: "resgate_real", engineOfertaId: "resgate_real", cupom: "PROMO10", linkResgate: "https://shopee.test/resgate" }));
assert.strictEqual(resgate.intencao, "resgate", "resgate real vence cupom");
assert.ok(/resgat|beneficio/i.test(resgate.tituloIa), "resgate real usa frase compativel");

const semResgate = resolver(ofertaBase({ id: "sem_resgate", engineOfertaId: "sem_resgate" }), {
  banco: [{ id: "danger_resgate", texto: "Tem beneficio pra resgatar nessa", familia: "qualquer", intencoes: ["resgate"], exige: ["resgate"], proibe: [], palavrasContexto: [], peso: 1, ativo: true }]
});
assert.strictEqual(semResgate.ok, false, "sem resgate nao usa frase de resgate");

const frete = resolver(ofertaBase({ id: "frete_true", engineOfertaId: "frete_true", freteGratis: true }));
assert.strictEqual(frete.intencao, "frete_gratis", "frete gratis verdadeiro tem intencao propria");
assert.ok(/frete/i.test(frete.tituloIa), "frete gratis verdadeiro permite frase de frete");

const freteFalso = resolver(ofertaBase({ id: "frete_false", engineOfertaId: "frete_false", freteGratis: false }), {
  banco: [{ id: "danger_frete", texto: "Frete gratis ajuda bastante", familia: "qualquer", intencoes: ["frete_gratis"], exige: ["freteGratis"], proibe: [], palavrasContexto: [], peso: 1, ativo: true }]
});
assert.strictEqual(freteFalso.ok, false, "frete falso ou ausente nao usa frete gratis");

assert.strictEqual(resolver(ofertaBase({ id: "economia_real", engineOfertaId: "economia_real", descontoPercentual: 15 })).intencao, "economia", "desconto oficial tem precedencia");
assert.strictEqual(resolver(ofertaBase({ id: "parcelamento_real", engineOfertaId: "parcelamento_real", parcelamento: "10x sem juros" })).intencao, "parcelamento", "parcelamento tem intencao propria");
assert.strictEqual(resolver(ofertaBase({ id: "beneficio_real", engineOfertaId: "beneficio_real", beneficioTexto: "Beneficio no app" })).intencao, "beneficio", "beneficio comprovado tem precedencia");

copy.limparCacheCopyLocalV2();
const ofertaFanout = ofertaBase({ id: "fanout_local_v2", engineOfertaId: "fanout_local_v2", categoria: "Gamer e Hardware" });
const fanoutA = resolver(ofertaFanout);
const fanoutB = resolver(ofertaFanout);
assert.strictEqual(fanoutA.tituloIa, fanoutB.tituloIa, "fanout IA reutiliza mesma copy");
assert.strictEqual(fanoutB.cacheHit, true, "fanout IA gera cache hit");
for (let i = 0; i < 20; i += 1) {
  const fanoutDestino = resolver(ofertaFanout, { destino: { id: `destino_fanout_${i}`, tituloOferta: "ia" } });
  assert.strictEqual(fanoutDestino.tituloIa, fanoutA.tituloIa, `fanout 20 destinos reutiliza copy ${i}`);
  assert.strictEqual(fanoutDestino.cacheHit, true, `fanout 20 destinos cache hit ${i}`);
}
const originalFanout = renderizar(ofertaFanout, { tituloOferta: "original" });
assert.ok(originalFanout.includes("Produto Original Oficial"), "destino original permanece original");
assert.ok(!originalFanout.includes(fanoutA.tituloIa), "destino original nao usa Local V2");

copy.limparCacheCopyLocalV2();
for (let i = 0; i < copy.MAX_CACHE_COPY_LOCAL_V2 + 5; i += 1) {
  copy.salvarCacheCopyLocalV2(`local_cache_${i}`, { tituloIa: `Copy ${i}`, ok: true }, 60 * 1000);
}
assert.ok(copy.tamanhoCacheCopyLocalV2() <= copy.MAX_CACHE_COPY_LOCAL_V2, "cache local respeita limite");
copy.salvarCacheCopyLocalV2("local_expirada", { tituloIa: "Velha", ok: true }, 1000);
copy.removerExpiradasCopyLocalV2(Date.now() + 2000);
assert.strictEqual(copy.lerCacheCopyLocalV2("local_expirada"), null, "cache local remove expiradas");

copy.limparCacheCopyLocalV2();
const antiA = resolver(ofertaBase({ id: "anti_a", engineOfertaId: "anti_a", categoria: "Diversos", titulo: "Oferta anti A" }));
const antiB = resolver(ofertaBase({ id: "anti_b", engineOfertaId: "anti_b", categoria: "Diversos", titulo: "Oferta anti B" }));
assert.notStrictEqual(antiA.tituloIa, antiB.tituloIa, "anti-repeticao evita repeticao imediata quando ha alternativa");

function bancoOportunidade(qtd) {
  return Array.from({ length: qtd }, (_, index) => ({
    id: `anti_pool_${qtd}_${index + 1}`,
    texto: `Frase segura ${qtd} ${index + 1}`,
    familia: "oportunidade",
    intencoes: ["oportunidade"],
    exige: [],
    proibe: [],
    palavrasContexto: [],
    peso: 1,
    ativo: true
  }));
}

function resolverSequenciaAntiRepeticao({ qtdFrases, total = 30, clienteId = `cliente_anti_${qtdFrases}`, banco = bancoOportunidade(qtdFrases), categoria = "Diversos", titulo = "Oferta anti repeticao" } = {}) {
  copy.limparCacheCopyLocalV2();
  const saidas = [];
  for (let i = 0; i < total; i += 1) {
    const res = resolver(ofertaBase({
      id: `${clienteId}_${i}`,
      engineOfertaId: `${clienteId}_${i}`,
      categoria,
      titulo: `${titulo} ${i}`
    }), { clienteId, banco });
    assert.strictEqual(res.ok, true, `sequencia anti ${qtdFrases}: resolve item ${i}`);
    saidas.push(res.tituloIa);
  }
  return saidas;
}

function contarRepeticoesImediatas(saidas = []) {
  return saidas.filter((item, index) => index > 0 && item === saidas[index - 1]).length;
}

const categoriasRotacaoComercial = [
  "Gamer e Hardware",
  "Perfumaria, Farmácia e Beleza",
  "Diversos",
  "Casa, Móveis e Decoração",
  "Eletrônicos",
  "Celulares e Smartphones",
  "Computadores e Notebook",
  "Pet Shop e Fazendinha",
  "Ferramentas",
  "Bebidas"
];

copy.limparCacheCopyLocalV2();
const seqCupom50 = [];
for (let i = 0; i < 50; i += 1) {
  const res = resolver(ofertaBase({
    id: `cupom_50_${i}`,
    engineOfertaId: `cupom_50_${i}`,
    categoria: categoriasRotacaoComercial[i % categoriasRotacaoComercial.length],
    titulo: `Oferta com cupom ${i}`,
    cupom: `PROMO${i}`
  }), { clienteId: "workspace_cupom_50" });
  assert.strictEqual(res.intencao, "cupom", `cupom 50 item ${i}: intencao correta`);
  assert.ok(/cupom/i.test(res.tituloIa), `cupom 50 item ${i}: frase de cupom`);
  assert.ok(!/resgate/i.test(res.tituloIa), `cupom 50 item ${i}: nao mistura resgate`);
  seqCupom50.push(res.tituloIa);
}
assert.strictEqual(contarRepeticoesImediatas(seqCupom50), 0, "50 ofertas com cupom nao repetem imediatamente");
assert.ok(new Set(seqCupom50).size >= 15, "50 ofertas com cupom usam sacola ampla");
assert.ok(copy.ultimasFrasesCopyLocalV2("workspace_cupom_50:cupom").length <= copy.LIMITE_HISTORICO_COPY_LOCAL_V2, "historico cupom global continua limitado");

copy.limparCacheCopyLocalV2();
const seqCupomFamilias = ["Gamer e Hardware", "Perfumaria, Farmácia e Beleza", "Diversos", "Casa, Móveis e Decoração", "Eletrônicos"].map((categoria, index) =>
  resolver(ofertaBase({
    id: `cupom_familia_${index}`,
    engineOfertaId: `cupom_familia_${index}`,
    categoria,
    titulo: `Oferta cupom familia ${index}`,
    cupom: `FAM${index}`
  }), { clienteId: "workspace_cupom_familias" }).tituloIa
);
assert.strictEqual(contarRepeticoesImediatas(seqCupomFamilias), 0, "cupom nao repete imediatamente ao mudar familia");
assert.strictEqual(copy.ultimasFrasesCopyLocalV2("workspace_cupom_familias:cupom").length, 5, "cupom usa historico workspace:intencao");

copy.limparCacheCopyLocalV2();
const seqResgate30 = [];
for (let i = 0; i < 30; i += 1) {
  const res = resolver(ofertaBase({
    id: `resgate_30_${i}`,
    engineOfertaId: `resgate_30_${i}`,
    categoria: categoriasRotacaoComercial[i % categoriasRotacaoComercial.length],
    titulo: `Oferta com resgate ${i}`,
    cupom: `APP${i}`,
    linkResgate: `https://resgate.example/${i}`
  }), { clienteId: "workspace_resgate_30" });
  assert.strictEqual(res.intencao, "resgate", `resgate 30 item ${i}: intencao correta`);
  assert.ok(/resgat|beneficio/i.test(res.tituloIa), `resgate 30 item ${i}: frase de resgate`);
  assert.ok(!/cupom/i.test(res.tituloIa), `resgate 30 item ${i}: nao mistura cupom`);
  seqResgate30.push(res.tituloIa);
}
assert.strictEqual(contarRepeticoesImediatas(seqResgate30), 0, "30 ofertas com resgate nao repetem imediatamente");
assert.ok(new Set(seqResgate30).size >= 15, "30 ofertas com resgate usam sacola ampla");
assert.ok(copy.ultimasFrasesCopyLocalV2("workspace_resgate_30:resgate").length <= copy.LIMITE_HISTORICO_COPY_LOCAL_V2, "historico resgate global continua limitado");

const seqUmaFrase = resolverSequenciaAntiRepeticao({ qtdFrases: 1 });
assert.ok(contarRepeticoesImediatas(seqUmaFrase) > 0, "1 frase permite repeticao por falta de alternativa");
const seqDuasFrases = resolverSequenciaAntiRepeticao({ qtdFrases: 2 });
assert.strictEqual(contarRepeticoesImediatas(seqDuasFrases), 0, "2 frases alternam sem repeticao imediata");
const seqTresFrases = resolverSequenciaAntiRepeticao({ qtdFrases: 3 });
assert.strictEqual(contarRepeticoesImediatas(seqTresFrases), 0, "3 frases nao repetem imediatamente");
assert.ok(new Set(seqTresFrases).size >= 3, "3 frases distribuem uso sem travar no historico");

copy.limparCacheCopyLocalV2();
const seqGamer = [];
for (let i = 0; i < 30; i += 1) {
  const res = resolver(ofertaBase({
    id: `anti_gamer_${i}`,
    engineOfertaId: `anti_gamer_${i}`,
    categoria: "Gamer e Hardware",
    titulo: `Produto gamer sequencial ${i}`
  }));
  assert.strictEqual(res.ok, true, `gamer anti-repeticao resolve item ${i}`);
  seqGamer.push(res.tituloIa);
}
assert.strictEqual(contarRepeticoesImediatas(seqGamer), 0, "familia gamer nao repete imediatamente em 30 ofertas");
assert.ok(new Set(seqGamer).size >= 3, "familia gamer distribui entre frases elegiveis");
assert.ok(copy.ultimasFrasesCopyLocalV2("cliente_local_v2:gamer:familia").length <= copy.LIMITE_HISTORICO_COPY_LOCAL_V2, "historico maximo continua limitado");

copy.limparCacheCopyLocalV2();
const bancoWorkspace = bancoOportunidade(2);
const workspaceA1 = resolver(ofertaBase({ id: "workspace_anti", engineOfertaId: "workspace_anti", categoria: "Diversos", titulo: "Oferta workspace" }), { clienteId: "workspace_a", banco: bancoWorkspace });
const workspaceA2 = resolver(ofertaBase({ id: "workspace_anti_2", engineOfertaId: "workspace_anti_2", categoria: "Diversos", titulo: "Oferta workspace 2" }), { clienteId: "workspace_a", banco: bancoWorkspace });
const workspaceB1 = resolver(ofertaBase({ id: "workspace_anti", engineOfertaId: "workspace_anti", categoria: "Diversos", titulo: "Oferta workspace" }), { clienteId: "workspace_b", banco: bancoWorkspace });
assert.notStrictEqual(workspaceA1.tituloIa, workspaceA2.tituloIa, "workspace A evita repeticao imediata");
assert.strictEqual(copy.ultimasFrasesCopyLocalV2("workspace_a:oportunidade:oportunidade").length, 2, "workspace A mantem seu historico");
assert.deepStrictEqual(copy.ultimasFrasesCopyLocalV2("workspace_b:oportunidade:oportunidade"), [workspaceB1.tituloIa], "workspace B nao herda historico do workspace A");

copy.limparCacheCopyLocalV2();
resolver(ofertaBase({ id: "hist_gamer_1", engineOfertaId: "hist_gamer_1", categoria: "Gamer e Hardware", titulo: "Produto gamer historico 1" }), { clienteId: "workspace_contextual" });
resolver(ofertaBase({ id: "hist_gamer_2", engineOfertaId: "hist_gamer_2", categoria: "Gamer e Hardware", titulo: "Produto gamer historico 2" }), { clienteId: "workspace_contextual" });
resolver(ofertaBase({ id: "hist_beleza_1", engineOfertaId: "hist_beleza_1", categoria: "Perfumaria, Farmácia e Beleza", titulo: "Perfume historico 1" }), { clienteId: "workspace_contextual" });
assert.strictEqual(copy.ultimasFrasesCopyLocalV2("workspace_contextual:gamer:familia").length, 2, "familia gamer mantem historico proprio");
assert.strictEqual(copy.ultimasFrasesCopyLocalV2("workspace_contextual:beleza:familia").length, 1, "familia beleza mantem historico proprio");
assert.deepStrictEqual(copy.ultimasFrasesCopyLocalV2("workspace_contextual:cupom"), [], "historico contextual nao usa chave comercial");

const perigosa = resolver(ofertaBase({ id: "perigosa", engineOfertaId: "perigosa", categoria: "Diversos" }), {
  banco: [
    { id: "danger", texto: "Ultimas unidades pra garantir", familia: "oportunidade", intencoes: ["oportunidade"], exige: [], proibe: [], palavrasContexto: [], peso: 1, ativo: true }
  ]
});
assert.strictEqual(perigosa.ok, false, "validator rejeita frase perigosa do banco");
assert.strictEqual(resolver(ofertaBase({ id: "banco_vazio", engineOfertaId: "banco_vazio" }), { banco: [] }).ok, false, "banco vazio falha sem bloquear");
assert.strictEqual(resolver(ofertaBase({ id: "exception_ttl", engineOfertaId: "exception_ttl" }), { ttlMs: Symbol("ttl") }).ok, false, "exception interna cai segura");

const semFeature = resolver(ofertaBase({ id: "sem_feature", engineOfertaId: "sem_feature" }), { plano: planoTituloIa(false) });
assert.strictEqual(semFeature.ok, false, "feature ausente bloqueia Local V2");
const destinoOriginal = resolver(ofertaBase({ id: "destino_original", engineOfertaId: "destino_original" }), { destino: { tituloOferta: "original" } });
assert.strictEqual(destinoOriginal.ok, false, "destino original nao chama copy local");

const explicit = renderizar(ofertaBase({ id: "explicit", engineOfertaId: "explicit", tituloIa: "Titulo IA Explicito" }));
assert.ok(explicit.includes("Titulo IA Explicito"), "tituloIa explicito preserva precedencia homologada");

const msgLocal = renderizar(ofertaBase({ id: "render_local", engineOfertaId: "render_local", tituloIa: "", categoria: "Gamer e Hardware" }));
const blocoTituloLocal = msgLocal.split("\n\n")[0] || "";
assert.ok(msgLocal.includes("*Produto Original Oficial*"), "destino IA preserva titulo factual quando usa Banco Local V2");
assert.ok(blocoTituloLocal.split("\n").length >= 2, "destino IA renderiza gancho Local V2 abaixo do titulo factual");

const snapshot = JSON.parse(JSON.stringify(ofertaFanout));
renderizar(ofertaFanout, { tituloOferta: "ia" });
assert.deepStrictEqual(ofertaFanout, snapshot, "Local V2 nao muta oferta compartilhada");

const originalLocal = copy.resolverCopyLocalV2;
const originalV1 = copy.resolverCopyInteligente;
copy.resolverCopyLocalV2 = () => ({ ok: false, tituloIa: "", motivoFallback: "local_forcado" });
const fallbackV1 = renderizar(ofertaBase({ id: "fallback_v1", engineOfertaId: "fallback_v1", cupom: "PROMO10", tituloIa: "" }));
assert.ok(/cupom/i.test(fallbackV1), "fallback Local V2 -> V1 funciona");
copy.resolverCopyInteligente = () => ({ ok: false, tituloIa: "", motivoFallback: "v1_forcado" });
const fallbackOriginal = renderizar(ofertaBase({ id: "fallback_original", engineOfertaId: "fallback_original", categoria: "Gamer e Hardware", tituloIa: "" }));
assert.ok(fallbackOriginal.includes("Produto Original Oficial"), "fallback Local V2 -> V1 -> Original funciona");
copy.resolverCopyLocalV2 = originalLocal;
copy.resolverCopyInteligente = originalV1;

for (const marketplace of ["mercadolivre", "shopee", "amazon", "aliexpress", "awin", "kabum"]) {
  const msg = renderizar(ofertaBase({ id: `mk_${marketplace}`, engineOfertaId: `mk_${marketplace}`, marketplace, categoria: "Casa, Móveis e Decoração", tituloIa: "" }));
  assert.ok(msg.includes("R$ 100,00"), `marketplace ${marketplace} preserva preco`);
  assert.ok(msg.includes("https://go.example/local-v2"), `marketplace ${marketplace} preserva link`);
}

const sourceLocal = fs.readFileSync(path.join(__dirname, "..", "modules", "copy-inteligente", "copy-local-v2.service.js"), "utf8");
assert.ok(!/\b(?:fetch|axios|openai|gemini|claude|anthropic|provider)\b/i.test(sourceLocal), "Local V2 nao usa chamada externa/provider");
assert.ok(!sourceLocal.includes("oferta.titulo =") && !sourceLocal.includes("oferta.nome ="), "Local V2 nao muta titulo/nome");

const resumo = copy.resumoBancoAssociativoV2();
assert.strictEqual(copy.BANCO_ASSOCIATIVO_V2_BASE.length, 196, "as 196 frases antigas continuam preservadas como base");
assert.strictEqual(copy.EXPANSAO_HUMANA_V21.length, 675, "Copy Local V2.1 adiciona 675 frases humanas");
assert.strictEqual(copy.EXPANSAO_HUMANA_V23.length, 468, "Copy Local V2.3 adiciona 468 ganchos humanos");
assert.strictEqual(resumo.total, 1339, "banco associativo V2.3 totaliza 1339 frases ativas");
assert.strictEqual(copy.MAX_CARACTERES_COPY_V2, 90, "validator V2.1 aceita ate 90 caracteres");
assert.strictEqual(copy.MAX_PALAVRAS_COPY_V2, 16, "validator V2.1 aceita ate 16 palavras");
assert.ok(resumo.porIntencao.familia >= 700, "maioria das frases e contextual por familia");
assert.ok(resumo.porIntencao.oportunidade >= 10, "ha bloco de oportunidades genericas");
assert.ok(
  ["cupom", "resgate", "beneficio", "economia", "frete_gratis", "parcelamento"].every(k => resumo.porIntencao[k] >= 1),
  "ha frases comerciais condicionais"
);

const idsBanco = new Set();
const textosBanco = new Set();
const tomBanco = {};
const eixoBanco = {};
const familiasExpandidas = {};
const proibidasSemProva = /\b(?:ultimas unidades|ultima unidade|estoque acabando|vai acabar|menor preco|melhor preco|frete gratis|cupom|resgate|cashback|exclusivo|corre|urgente|so hoje|ultima chance|desconto|economia|parcelamento|beneficio)\b/i;

for (const fraseBanco of copy.BANCO_ASSOCIATIVO_V2) {
  assert.ok(fraseBanco.id && fraseBanco.texto, `frase valida tem id/texto: ${fraseBanco.id}`);
  assert.ok(!idsBanco.has(fraseBanco.id), `id unico: ${fraseBanco.id}`);
  assert.ok(!textosBanco.has(fraseBanco.texto), `texto unico: ${fraseBanco.texto}`);
  idsBanco.add(fraseBanco.id);
  textosBanco.add(fraseBanco.texto);

  const fatosPermitidos = {
    cupom: fraseBanco.exige.includes("cupom"),
    resgate: fraseBanco.exige.includes("resgate"),
    freteGratis: fraseBanco.exige.includes("freteGratis"),
    descontoOficial: fraseBanco.exige.includes("desconto"),
    beneficioSeguro: fraseBanco.exige.includes("beneficio"),
    parcelamento: fraseBanco.exige.includes("parcelamento")
  };
  const validacao = copy.validarCopyV2({
    textoGerado: fraseBanco.texto,
    contexto: { fatosPermitidos }
  });
  assert.strictEqual(validacao.valida, true, `frase passa validator: ${fraseBanco.id} (${validacao.motivoCodigo})`);

  if (fraseBanco.id.includes("_v21_")) {
    assert.ok(fraseBanco.tom === "curta" || fraseBanco.tom === "media", `frase nova tem tom: ${fraseBanco.id}`);
    assert.ok(fraseBanco.eixo, `frase nova tem eixo: ${fraseBanco.id}`);
    assert.ok(!proibidasSemProva.test(fraseBanco.texto), `frase nova nao inventa alegacao comercial: ${fraseBanco.id}`);
    tomBanco[fraseBanco.tom] = (tomBanco[fraseBanco.tom] || 0) + 1;
    eixoBanco[fraseBanco.eixo] = (eixoBanco[fraseBanco.eixo] || 0) + 1;
    familiasExpandidas[fraseBanco.familia] = (familiasExpandidas[fraseBanco.familia] || 0) + 1;
  }
}

for (const fraseAntiga of copy.BANCO_ASSOCIATIVO_V2_BASE) {
  assert.ok(idsBanco.has(fraseAntiga.id), `frase antiga preservada: ${fraseAntiga.id}`);
  assert.ok(textosBanco.has(fraseAntiga.texto), `texto antigo preservado: ${fraseAntiga.id}`);
}

for (const [familia, totalNovas] of Object.entries(familiasExpandidas)) {
  assert.strictEqual(totalNovas, 25, `familia ${familia} recebeu 25 frases novas`);
}
assert.ok(tomBanco.curta >= 200 && tomBanco.media >= 400, "novas frases misturam tom curto e medio");
assert.ok(Object.keys(eixoBanco).length >= 6, "novas frases distribuem eixos de linguagem");

copy.limparCacheCopyLocalV2();
for (const categoria of CATEGORIAS_OPTIMUS) {
  const res = resolver(ofertaBase({
    id: `categoria_v21_${categoria}`,
    engineOfertaId: `categoria_v21_${categoria}`,
    categoria,
    titulo: `Produto seguro categoria ${categoria}`
  }), { clienteId: `workspace_categoria_v21_${categoria}` });
  assert.strictEqual(res.ok, true, `categoria oficial resolve: ${categoria}`);
  assert.strictEqual(res.categoriaOficial, categoria, `categoria oficial preservada: ${categoria}`);
  assert.ok(res.tituloIa, `categoria oficial gera copy: ${categoria}`);
}

const familiasOficiais = Object.values(copy.CATEGORIA_PARA_FAMILIA_V2);
for (const familia of [...new Set(familiasOficiais)]) {
  const frasesFamilia = copy.BANCO_ASSOCIATIVO_V2.filter(item => item.familia === familia && item.intencoes.includes(familia === "oportunidade" ? "oportunidade" : "familia"));
  assert.ok(frasesFamilia.some(item => item.id.includes("_v21_")), `familia ${familia} tem frase V2.1 elegivel`);
}

copy.limparCacheCopyLocalV2();
const seqGamerExpandida = [];
for (let i = 0; i < 45; i += 1) {
  const res = resolver(ofertaBase({
    id: `gamer_v21_${i}`,
    engineOfertaId: `gamer_v21_${i}`,
    categoria: "Gamer e Hardware",
    titulo: `Produto gamer variado ${i}`
  }), { clienteId: "workspace_gamer_v21" });
  assert.strictEqual(res.ok, true, `gamer V2.1 resolve item ${i}`);
  seqGamerExpandida.push(res.tituloIa);
}
assert.strictEqual(contarRepeticoesImediatas(seqGamerExpandida), 0, "banco expandido gamer nao repete imediatamente");
assert.ok(new Set(seqGamerExpandida).size >= 20, "banco expandido amplia variedade gamer");

copy.limparCacheCopyLocalV2();
const seqV23Computadores = [];
for (let i = 0; i < 30; i += 1) {
  const res = resolver(ofertaSimplesFamilia({
    id: `v23_pc_${i}`,
    engineOfertaId: `v23_pc_${i}`,
    categoria: "Computadores e Informatica",
    titulo: `Notebook Lenovo IdeaPad ${i}`
  }), { clienteId: "workspace_v23_pc_30" });
  assert.strictEqual(res.ok, true, `V2.3 computadores resolve ${i}`);
  assert.strictEqual(res.familia, "computadores", `V2.3 computadores familia ${i}`);
  seqV23Computadores.push(res);
}
assert.strictEqual(contarRepeticoesImediatas(seqV23Computadores.map(item => item.tituloIa)), 0, "V2.3 nao repete texto imediato em 30 ofertas");
const estruturasPc = seqV23Computadores.map(item => copy.estruturaFraseCopyLocalV2(item.tituloIa));
assert.ok(new Set(estruturasPc).size >= 10, "V2.3 varia começos/estruturas em 30 ofertas");

console.log("copy-inteligente-local-v2.test.js OK");
