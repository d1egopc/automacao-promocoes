const assert = require("assert");
const {
  avaliarOfertaUniversal,
  decidirOfertaUniversal
} = require("../modules/inteligencia-universal");

function ofertaValidaBaixoScore(marketplace) {
  return {
    clienteId: "workspace_teste",
    titulo: `Produto valido ${marketplace}`,
    marketplace,
    precoAtual: 199.9,
    linkAfiliado: `https://afiliado.test/${marketplace}/produto`,
    linkOriginal: `https://produto.test/${marketplace}/produto`,
    categoria: "Diversos",
    score: 1
  };
}

for (const marketplace of ["mercadolivre", "shopee", "amazon", "aliexpress", "kabum", "awin"]) {
  const resultado = avaliarOfertaUniversal(ofertaValidaBaixoScore(marketplace), {
    clienteId: "workspace_teste",
    origem: "engine_importer",
    exigirLinkAfiliado: true,
    memoriaAnteriores: []
  });

  assert.strictEqual(resultado.ok, true, `${marketplace} valido com score baixo deve entrar`);
  assert.strictEqual(resultado.status, "aprovada", `${marketplace} deve ser aprovado`);
  assert.strictEqual(resultado.motivo, "inteligencia_universal_aprovada", `${marketplace} nao deve reter por score`);
  assert(Number(resultado.score.score) < 20, `${marketplace} fixture deve permanecer com score baixo`);
}

{
  const resultado = avaliarOfertaUniversal({
    ...ofertaValidaBaixoScore("mercadolivre"),
    precoAtual: 0
  }, {
    clienteId: "workspace_teste",
    origem: "engine_importer",
    exigirLinkAfiliado: true,
    memoriaAnteriores: []
  });

  assert.strictEqual(resultado.ok, false, "preco invalido continua retido");
  assert.strictEqual(resultado.status, "retida");
  assert.strictEqual(resultado.motivo, "preco_invalido");
}

{
  const resultado = avaliarOfertaUniversal({
    ...ofertaValidaBaixoScore("amazon"),
    linkAfiliado: ""
  }, {
    clienteId: "workspace_teste",
    origem: "engine_importer",
    exigirLinkAfiliado: true,
    memoriaAnteriores: []
  });

  assert.strictEqual(resultado.ok, false, "link obrigatorio ausente continua retido");
  assert.strictEqual(resultado.status, "retida");
  assert.strictEqual(resultado.motivo, "link_afiliado_ausente");
}

{
  const oferta = ofertaValidaBaixoScore("shopee");
  const resultado = avaliarOfertaUniversal(oferta, {
    clienteId: "workspace_teste",
    origem: "engine_importer",
    exigirLinkAfiliado: true,
    memoriaAnteriores: [{
      clienteId: "workspace_teste",
      titulo: oferta.titulo,
      marketplace: oferta.marketplace,
      precoAtual: oferta.precoAtual,
      linkAfiliado: oferta.linkAfiliado,
      linkOriginal: oferta.linkOriginal,
      criadaEm: new Date().toISOString()
    }]
  });

  assert.strictEqual(resultado.ok, false, "duplicidade sem melhoria continua retida");
  assert.strictEqual(resultado.status, "retida");
  assert.strictEqual(resultado.motivo, "sem_melhoria_financeira_janela_2h");
}

{
  const resultado = decidirOfertaUniversal({
    validacao: { ok: true },
    score: { score: 1 },
    memoria: { bloquear: false },
    destino: { ok: false, motivo: "sem_destino_compativel" },
    beneficios: { temBeneficio: false }
  });

  assert.strictEqual(resultado.ok, false, "destino invalido continua retido");
  assert.strictEqual(resultado.status, "retida");
  assert.strictEqual(resultado.motivo, "sem_destino_compativel");
}

console.log("inteligencia-universal-decisao.test.js OK");
