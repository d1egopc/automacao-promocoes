const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-copy-inteligente-"));
process.env.DATA_DIR = dataDir;

const { criarTemplate } = require("../modules/templates-clientes/service");
const copy = require("../modules/copy-inteligente");
const { montarMensagemOferta } = require("../utils/mensagens-ofertas");

function planoTituloIa(ativo = true) {
  return { recursos: { tituloIa: ativo, templatePersonalizado: true } };
}

function ofertaBase(extra = {}) {
  return {
    id: "oferta_copy_base",
    engineOfertaId: "engine_copy_base",
    clienteId: "cliente_copy",
    marketplace: "amazon",
    titulo: "Produto Original Oficial",
    nome: "Produto Original Oficial",
    categoria: "Diversos",
    precoAtual: 100,
    precoOriginal: 129.9,
    cupom: "",
    linkAfiliado: "https://go.example/oferta",
    imagem: "https://img.example/oferta.jpg",
    ...extra
  };
}

function renderizar(oferta, destino = {}, plano = planoTituloIa(true)) {
  return montarMensagemOferta(oferta, {
    clienteId: "cliente_copy",
    destino: { id: "destino_copy", tipo: "whatsapp", tituloOferta: "ia", ...destino },
    plano
  });
}

copy.limparCacheCopyInteligente();

assert.strictEqual(copy.resolverIntencaoCopy(ofertaBase({ linkResgate: "https://shopee.test/resgate", cupom: "PROMO10" })).intencao, "resgate", "resgate vence cupom");
assert.strictEqual(copy.resolverIntencaoCopy(ofertaBase({ cupom: "PROMO10", categoria: "Beleza" })).intencao, "cupom", "cupom vence categoria");
assert.strictEqual(copy.resolverIntencaoCopy(ofertaBase({ categoria: "Beleza e Cabelo" })).intencao, "beleza", "categoria beleza");
assert.strictEqual(copy.resolverIntencaoCopy(ofertaBase({ categoria: "Gamer e Hardware" })).intencao, "gamer", "categoria gamer");
assert.strictEqual(copy.resolverIntencaoCopy(ofertaBase({ categoria: "Casa e Cozinha" })).intencao, "casa", "categoria casa");
assert.strictEqual(copy.resolverIntencaoCopy(ofertaBase({ categoria: "Sem categoria confiavel" })).intencao, "oportunidade", "fallback oportunidade");

assert.strictEqual(copy.fraseSegura({ texto: "Tem cupom nessa oferta", exige: ["cupom"] }, copy.normalizarSinaisCopy(ofertaBase())), false, "frase exige cupom sem cupom nao participa");
assert.strictEqual(copy.fraseSegura({ texto: "Tem resgate nessa oferta", exige: ["resgate"] }, copy.normalizarSinaisCopy(ofertaBase())), false, "frase exige resgate sem resgate nao participa");
assert.strictEqual(copy.fraseSegura({ texto: "Frete gratis nessa oferta", exige: ["freteGratis"] }, copy.normalizarSinaisCopy(ofertaBase())), false, "frete gratis sem prova bloqueia");
assert.strictEqual(copy.fraseSegura({ texto: "Frete gratis nessa oferta", exige: ["freteGratis"] }, copy.normalizarSinaisCopy(ofertaBase({ freteGratis: true }))), true, "frete gratis com prova permite");
assert.strictEqual(copy.fraseAfirmaSemProva("Menor preco dos ultimos tempos", copy.normalizarSinaisCopy(ofertaBase())), true, "menor preco sem prova bloqueia");
assert.strictEqual(copy.fraseSegura({ texto: "Essa frase ficou propositalmente muito longa para passar do limite maximo definido pelo contrato", exige: [] }, copy.normalizarSinaisCopy(ofertaBase())), false, "frase longa rejeitada");

const semFeature = renderizar(ofertaBase({ cupom: "PROMO10" }), { tituloOferta: "ia" }, planoTituloIa(false));
assert.ok(semFeature.includes("Produto Original Oficial"), "destino IA sem feature usa original");
assert.ok(!semFeature.includes("Tem cupom nessa oferta") && !semFeature.includes("Opa, essa veio com cupom"), "sem feature nao usa motor");

const comFeature = renderizar(ofertaBase({ id: "copy_cupom", engineOfertaId: "copy_cupom", cupom: "PROMO10" }));
assert.ok(comFeature.includes("cupom"), "destino IA com feature usa copy de cupom");

const originalNaoChamaMotor = renderizar(ofertaBase({ cupom: "PROMO10" }), { tituloOferta: "original" });
assert.ok(originalNaoChamaMotor.includes("Produto Original Oficial"), "destino original nao usa motor");
assert.ok(!originalNaoChamaMotor.includes("cupom nessa oferta"), "destino original nao troca titulo");

copy.limparCacheCopyInteligente();
const ofertaFanout = ofertaBase({ id: "copy_fanout", engineOfertaId: "copy_fanout", categoria: "Gamer e Hardware" });
const primeira = copy.resolverCopyInteligente({ oferta: ofertaFanout, destino: { tituloOferta: "ia" }, clienteId: "cliente_copy", plano: planoTituloIa(true) });
const segunda = copy.resolverCopyInteligente({ oferta: ofertaFanout, destino: { tituloOferta: "ia" }, clienteId: "cliente_copy", plano: planoTituloIa(true) });
assert.strictEqual(primeira.tituloIa, segunda.tituloIa, "fanout/cache reutiliza mesma copy por oferta");
assert.strictEqual(segunda.cacheHit, true, "cache hit registrado");

copy.limparCacheCopyInteligente();
const semIdA = ofertaBase({
  id: "",
  engineOfertaId: "",
  jobId: "",
  titulo: "Produto Sem Id Igual",
  nome: "Produto Sem Id Igual",
  categoria: "Casa",
  precoAtual: 101,
  linkAfiliado: "https://go.example/produto-a"
});
const semIdB = ofertaBase({
  id: "",
  engineOfertaId: "",
  jobId: "",
  titulo: "Produto Sem Id Igual",
  nome: "Produto Sem Id Igual",
  categoria: "Casa",
  precoAtual: 102,
  linkAfiliado: "https://go.example/produto-b"
});
const semIdPrimeiraA = copy.resolverCopyInteligente({ oferta: semIdA, destino: { tituloOferta: "ia" }, clienteId: "cliente_copy", plano: planoTituloIa(true) });
const semIdPrimeiraB = copy.resolverCopyInteligente({ oferta: semIdB, destino: { tituloOferta: "ia" }, clienteId: "cliente_copy", plano: planoTituloIa(true) });
const semIdSegundaA = copy.resolverCopyInteligente({ oferta: semIdA, destino: { tituloOferta: "ia" }, clienteId: "cliente_copy", plano: planoTituloIa(true) });
assert.strictEqual(semIdPrimeiraA.cacheHit, false, "oferta sem ID A gera primeira copy sem cache hit");
assert.strictEqual(semIdPrimeiraB.cacheHit, false, "oferta sem ID B diferente nao herda cache de A");
assert.strictEqual(semIdSegundaA.cacheHit, true, "oferta sem ID com fingerprint seguro cacheia para fanout");

copy.limparCacheCopyInteligente();
const semFingerprint = {
  marketplace: "amazon",
  categoria: "Casa",
  titulo: "Produto Sem Identificador Seguro",
  nome: "Produto Sem Identificador Seguro",
  precoAtual: 55
};
const semFingerprintA = copy.resolverCopyInteligente({ oferta: semFingerprint, destino: { tituloOferta: "ia" }, clienteId: "cliente_copy", plano: planoTituloIa(true) });
const semFingerprintB = copy.resolverCopyInteligente({ oferta: semFingerprint, destino: { tituloOferta: "ia" }, clienteId: "cliente_copy", plano: planoTituloIa(true) });
assert.strictEqual(semFingerprintA.cacheHit, false, "sem fingerprint seguro nao usa cache na primeira resolucao");
assert.strictEqual(semFingerprintB.cacheHit, false, "sem fingerprint seguro nao usa cache na segunda resolucao");

copy.limparCacheCopyInteligente();
copy.salvarCacheCopy("expirada", { tituloIa: "Velha", ok: true }, 1000);
copy.removerExpiradas(Date.now() + 2000);
assert.strictEqual(copy.lerCacheCopy("expirada"), null, "cache remove entradas expiradas");

copy.limparCacheCopyInteligente();
for (let i = 0; i < copy.MAX_ENTRIES + 5; i += 1) {
  copy.salvarCacheCopy(`cache_${i}`, { tituloIa: `Copy ${i}`, ok: true }, 60 * 1000);
}
assert.ok(copy.tamanhoCacheCopyInteligente() <= copy.MAX_ENTRIES, "cache respeita MAX_ENTRIES");
const aposEviction = copy.resolverCopyInteligente({ oferta: ofertaFanout, destino: { tituloOferta: "ia" }, clienteId: "cliente_copy", plano: planoTituloIa(true) });
assert.ok(aposEviction.ok, "eviction nao quebra resolucao");

const chaveCupomA = copy.chaveSinais("cliente_copy", ofertaBase({ id: "sinais", engineOfertaId: "sinais", cupom: "PROMO10" }));
const chaveCupomB = copy.chaveSinais("cliente_copy", ofertaBase({ id: "sinais", engineOfertaId: "sinais", cupom: "PROMO20" }));
assert.notStrictEqual(chaveCupomA, chaveCupomB, "mudanca de codigo de cupom gera chave diferente");

const chaveResgateA = copy.chaveSinais("cliente_copy", ofertaBase({ id: "sinais_resgate", engineOfertaId: "sinais_resgate", linkResgate: "https://shopee.test/resgate-a" }));
const chaveResgateB = copy.chaveSinais("cliente_copy", ofertaBase({ id: "sinais_resgate", engineOfertaId: "sinais_resgate", linkResgate: "https://shopee.test/resgate-b" }));
assert.notStrictEqual(chaveResgateA, chaveResgateB, "mudanca de link de resgate gera chave diferente");

const chaveDescontoA = copy.chaveSinais("cliente_copy", ofertaBase({ id: "sinais_desconto", engineOfertaId: "sinais_desconto", descontoPercentual: 10 }));
const chaveDescontoB = copy.chaveSinais("cliente_copy", ofertaBase({ id: "sinais_desconto", engineOfertaId: "sinais_desconto", descontoPercentual: 15 }));
assert.notStrictEqual(chaveDescontoA, chaveDescontoB, "mudanca de desconto relevante gera chave diferente");

const chaveMesmoSinalA = copy.chaveSinais("cliente_copy", ofertaBase({ id: "sinais_iguais", engineOfertaId: "sinais_iguais", cupom: "PROMO10" }));
const chaveMesmoSinalB = copy.chaveSinais("cliente_copy", ofertaBase({ id: "sinais_iguais", engineOfertaId: "sinais_iguais", cupom: "PROMO10" }));
assert.strictEqual(chaveMesmoSinalA, chaveMesmoSinalB, "mesmos sinais mantem mesma chave");

copy.limparCacheCopyInteligente();
const mesmoSinalPrimeiro = copy.resolverCopyInteligente({ oferta: ofertaBase({ id: "cache_hit_sinais", engineOfertaId: "cache_hit_sinais", cupom: "PROMO10" }), destino: { tituloOferta: "ia" }, clienteId: "cliente_copy", plano: planoTituloIa(true) });
const mesmoSinalSegundo = copy.resolverCopyInteligente({ oferta: ofertaBase({ id: "cache_hit_sinais", engineOfertaId: "cache_hit_sinais", cupom: "PROMO10" }), destino: { tituloOferta: "ia" }, clienteId: "cliente_copy", plano: planoTituloIa(true) });
assert.strictEqual(mesmoSinalPrimeiro.tituloIa, mesmoSinalSegundo.tituloIa, "mesmos sinais reutilizam mesma copy");
assert.strictEqual(mesmoSinalSegundo.cacheHit, true, "mesmos sinais geram cache hit");

assert.ok(!Object.prototype.hasOwnProperty.call(copy.BANCO_FRASES_V1, "preparacao"), "preparacao removida da V1 sem sinal seguro proprio");

const erroCache = copy.resolverCopyInteligente({ oferta: ofertaBase({ id: "cache_erro", engineOfertaId: "cache_erro", categoria: "Casa" }), destino: { tituloOferta: "ia" }, clienteId: "cliente_copy", plano: planoTituloIa(true), ttlMs: Symbol("ttl_invalido") });
assert.strictEqual(erroCache.ok, false, "erro de cache cai de forma segura");
assert.strictEqual(erroCache.fonte, "fallback_original", "erro de cache usa fallback seguro");

copy.limparCacheCopyInteligente();
const anterior = copy.escolherFrase({ intencao: "oportunidade", sinais: copy.normalizarSinaisCopy(ofertaBase()), chaveOferta: "anti-repeticao", clienteId: "cliente_copy" });
const proxima = copy.escolherFrase({ intencao: "oportunidade", sinais: copy.normalizarSinaisCopy(ofertaBase()), chaveOferta: "anti-repeticao", clienteId: "cliente_copy" });
assert.notStrictEqual(anterior.texto, proxima.texto, "anti-repeticao evita repeticao imediata");

const snapshot = JSON.parse(JSON.stringify(ofertaFanout));
renderizar(ofertaFanout, { tituloOferta: "ia" });
assert.deepStrictEqual(ofertaFanout, snapshot, "oferta/fila/universal nao muta");

const mensagemResgate = renderizar(ofertaBase({ id: "copy_resgate", engineOfertaId: "copy_resgate", marketplace: "shopee", linkResgate: "https://shopee.test/resgate", cupom: "PROMO10" }));
assert.ok(mensagemResgate.includes("resgate") || mensagemResgate.includes("beneficio"), "resgate real gera copy de resgate");

for (const marketplace of ["mercadolivre", "shopee", "amazon", "aliexpress", "awin", "kabum"]) {
  const msg = renderizar(ofertaBase({ id: `copy_${marketplace}`, engineOfertaId: `copy_${marketplace}`, marketplace, categoria: "Casa" }));
  assert.ok(msg.includes("casa") || msg.includes("pratica") || msg.includes("upgrade"), `marketplace ${marketplace} compativel`);
}

const template = criarTemplate("cliente_copy", {
  nome: "Template Copy",
  canais: ["whatsapp"],
  blocos: [
    { tipo: "titulo", ativo: true, ordem: 10 },
    { tipo: "preco_por", ativo: true, ordem: 20 },
    { tipo: "link", ativo: true, ordem: 30 }
  ]
}).template;
const personalizada = renderizar(ofertaBase({ id: "copy_tpl", engineOfertaId: "copy_tpl", categoria: "Gamer e Hardware" }), { templateId: template.id });
assert.ok(personalizada.includes("setup") || personalizada.includes("upgrade"), "template personalizado recebe copy");

const camposComerciais = ofertaBase({ cupom: "PROMO10", categoria: "Casa", score: 99 });
const msgCampos = renderizar(camposComerciais);
assert.ok(msgCampos.includes("R$ 100,00"), "preco intacto");
assert.ok(msgCampos.includes("https://go.example/oferta"), "link intacto");
assert.strictEqual(camposComerciais.cupom, "PROMO10", "cupom intacto no objeto");
assert.strictEqual(camposComerciais.imagem, "https://img.example/oferta.jpg", "imagem intacta no objeto");
assert.strictEqual(camposComerciais.categoria, "Casa", "categoria intacta no objeto");
assert.strictEqual(camposComerciais.score, 99, "score intacto no objeto");

const originalService = copy.resolverCopyInteligente;
const originalLocalV2Service = copy.resolverCopyLocalV2;
copy.resolverCopyLocalV2 = () => {
  throw new Error("falha simulada local v2");
};
copy.resolverCopyInteligente = () => {
  throw new Error("falha simulada");
};
const fallbackErro = renderizar(ofertaBase({ id: "copy_erro", engineOfertaId: "copy_erro", categoria: "Gamer e Hardware" }));
assert.ok(fallbackErro.includes("Produto Original Oficial"), "erro do motor cai para original");
copy.resolverCopyInteligente = originalService;
copy.resolverCopyLocalV2 = originalLocalV2Service;

console.log("copy-inteligente-v1.test.js OK");
