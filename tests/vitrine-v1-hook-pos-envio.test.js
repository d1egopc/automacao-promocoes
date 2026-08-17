"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const storage = require("../modules/vitrine/storage");
const { normalizarCuponsSemanticos } = require("../modules/radar/cupom-semantico");
const {
  coletarLinksComerciaisFinais,
  montarOfertaVitrine,
  publicarOfertaConfirmadaVitrine
} = require("../modules/vitrine/hook");

const raiz = path.resolve(__dirname, "..");
const ler = (relativo) => fs.readFileSync(path.join(raiz, relativo), "utf8");

function clone(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function criarDeps({ recurso = true, falharWrite = false } = {}) {
  const globais = new Map();
  const clientes = new Map();
  const logs = [];

  function chaveCliente(clienteId, arquivo) {
    return `${clienteId}:${arquivo}`;
  }

  const deps = {
    globais,
    clientes,
    logs,
    clienteTemRecurso: () => recurso === true,
    logger: {
      warn(tag, payload) {
        logs.push({ tag, payload });
      },
      log(tag, payload) {
        logs.push({ tag, payload });
      }
    },
    readGlobalJson(arquivo, fallback) {
      return globais.has(arquivo) ? clone(globais.get(arquivo)) : clone(fallback);
    },
    writeGlobalJson(arquivo, dados) {
      globais.set(arquivo, clone(dados));
    },
    readClienteJson(clienteId, arquivo, fallback) {
      const chave = chaveCliente(clienteId, arquivo);
      return clientes.has(chave) ? clone(clientes.get(chave)) : clone(fallback);
    },
    writeClienteJson(clienteId, arquivo, dados) {
      if (falharWrite && arquivo === storage.ARQUIVO_VITRINE) {
        throw new Error("falha_storage_vitrine");
      }
      clientes.set(chaveCliente(clienteId, arquivo), clone({ ...dados, clienteId }));
    }
  };

  return deps;
}

function ativarVitrine(deps, clienteId = "workspace-a", slug = "workspace-a") {
  storage.salvarConfigVitrine(clienteId, {
    ativa: true,
    slug,
    nomePublico: `Vitrine ${clienteId}`
  }, deps);
}

function ofertaBase(overrides = {}) {
  return {
    id: "oferta-1",
    ofertaId: "oferta-1",
    clienteId: "workspace-a",
    status: "enviado",
    titulo: "Produto enviado",
    imagem: "https://cdn.example.com/produto.jpg",
    marketplace: "aliexpress",
    categoria: "Gamer e Hardware",
    preco: "99,90",
    enviadoEm: "2026-08-17T15:00:00.000Z",
    linksComerciais: [
      {
        tipo: "app",
        papel: "link_app",
        ordemCaptura: 1,
        urlOptimus: "https://go.optimuspromo.com.br/r/app123",
        renderizavel: true,
        conversaoStatus: "convertida"
      },
      {
        tipo: "pc",
        papel: "link_pc",
        ordemCaptura: 2,
        urlOptimus: "https://go.optimuspromo.com.br/r/pc123",
        renderizavel: true,
        conversaoStatus: "convertida"
      },
      {
        tipo: "produto",
        papel: "link_produto",
        ordemCaptura: 3,
        url: "https://aliexpress.com/item/tecnico",
        renderizavel: true,
        conversaoStatus: "convertida"
      }
    ],
    ...overrides
  };
}

function publicar(deps, oferta, destinosEnviados = 1, clienteId = "workspace-a") {
  return publicarOfertaConfirmadaVitrine({
    clienteId,
    oferta,
    destinosEnviados,
    deps
  });
}

const depsAtiva = criarDeps();
ativarVitrine(depsAtiva);

const resultado = publicar(depsAtiva, ofertaBase(), 1);
assert.strictEqual(resultado.ok, true, "Vitrine ativa + envio confirmado deve publicar");

let vitrine = storage.lerVitrineWorkspace("workspace-a", depsAtiva);
assert.strictEqual(vitrine.ofertas.length, 1);
assert.strictEqual(vitrine.ofertas[0].id, "oferta-1");
assert.deepStrictEqual(
  vitrine.ofertas[0].linksComerciais.map(link => link.papel),
  ["link_app", "link_pc"],
  "AliExpress APP+PC devem ser preservados e link tecnico deve ficar fora"
);

const ofertaComSnapshotRico = montarOfertaVitrine(ofertaBase({
  id: "oferta-rica",
  ofertaId: "oferta-rica",
  imagem: "",
  imagemUrl: "https://cdn.example.com/imagem-url.jpg",
  cupom: "PROMO10 ou APP20",
  cupons: ["PROMO10", "FRETE15"],
  beneficios: ["Moedas no APP"]
}));
assert.strictEqual(ofertaComSnapshotRico.imagem, "https://cdn.example.com/imagem-url.jpg", "Vitrine deve preservar imagem alternativa existente na oferta enviada");
assert.deepStrictEqual(
  ofertaComSnapshotRico.cupons,
  ["PROMO10", "FRETE15", "APP20"],
  "Vitrine deve separar e deduplicar multiplos cupons"
);
assert.deepStrictEqual(ofertaComSnapshotRico.beneficios, ["Moedas no APP"]);

const ofertaComContratoFinalCupom = montarOfertaVitrine(ofertaBase({
  id: "ali-cupom-final",
  ofertaId: "ali-cupom-final",
  cupom: "MOEDAS ou ABRAOPRODUTO ou VAIAPARECER",
  cupons: ["MOEDAS"],
  contratoComercialFinal: {
    cupomCodigo: "ALONG95WK ou BRGM3",
    codigosCupom: ["ALONG95WK", "BRGM3"]
  }
}));
assert.deepStrictEqual(
  ofertaComContratoFinalCupom.cupons,
  ["ALONG95WK", "BRGM3"],
  "Vitrine deve preferir cupons finais e ignorar instrucoes/beneficios crus quando ha contrato final"
);
assert.deepStrictEqual(
  normalizarCuponsSemanticos(["MOEDAS", "ABRAOPRODUTO", "VAIAPARECER", "Abra o produto", "Vai aparecer"]),
  [],
  "Instrucoes e beneficios nao devem virar cupom"
);
assert.deepStrictEqual(
  normalizarCuponsSemanticos(["ALONG95WK", "BRGM3", "IFPHZ5IU", "MEGABR03"]),
  ["ALONG95WK", "BRGM3", "IFPHZ5IU", "MEGABR03"],
  "Codigos reais continuam validos"
);

publicar(depsAtiva, ofertaBase({ enviadoEm: "2026-08-17T15:10:00.000Z" }), 3);
vitrine = storage.lerVitrineWorkspace("workspace-a", depsAtiva);
assert.strictEqual(vitrine.ofertas.length, 1, "Fanout WA/TG/Discord deve virar um unico card");
assert.strictEqual(vitrine.ofertas[0].enviadoEm, "2026-08-17T15:10:00.000Z", "Reenvio legitimo deve atualizar ultimoEnvioEm");

const depsInativa = criarDeps();
storage.salvarConfigVitrine("workspace-a", {
  ativa: false,
  slug: "workspace-inativa",
  nomePublico: "Inativa"
}, depsInativa);
assert.strictEqual(publicar(depsInativa, ofertaBase(), 1).motivo, "vitrine_inativa");
assert.strictEqual(storage.lerVitrineWorkspace("workspace-a", depsInativa).ofertas.length, 0, "Vitrine inativa nao deve registrar oferta");

const depsSemRecurso = criarDeps({ recurso: false });
ativarVitrine(depsSemRecurso);
assert.strictEqual(publicar(depsSemRecurso, ofertaBase(), 1).motivo, "recurso_indisponivel");
assert.strictEqual(storage.lerVitrineWorkspace("workspace-a", depsSemRecurso).ofertas.length, 0, "Plano sem recurso nao publica");

assert.strictEqual(publicar(depsAtiva, ofertaBase({ status: "erro" }), 1).motivo, "status_nao_enviado", "Envio com erro nao publica");
assert.strictEqual(publicar(depsAtiva, ofertaBase(), 0).motivo, "sem_envio_confirmado", "Sem envio confirmado nao publica");

const linksShopee = coletarLinksComerciaisFinais({
  marketplace: "shopee",
  contratoComercialFinal: {
    linksProduto: [
      { tipo: "produto", papel: "link_produto", ordemCaptura: 2, urlAfiliadaWorkspace: "https://go.optimuspromo.com.br/r/produto123", renderizavel: true }
    ],
    linksResgate: [
      { tipo: "resgate", papel: "link_resgate", ordemCaptura: 1, urlAfiliadaWorkspace: "https://go.optimuspromo.com.br/r/resgate123", renderizavel: true }
    ]
  }
});
assert.deepStrictEqual(linksShopee.map(link => link.papel), ["link_resgate", "link_produto"], "Shopee Produto+Resgate devem ser preservados");

const linksShopeeSomenteProduto = coletarLinksComerciaisFinais({
  marketplace: "shopee",
  linksComerciais: [
    { tipo: "produto", papel: "link_produto", urlOptimus: "https://go.optimuspromo.com.br/r/produto-only", renderizavel: true }
  ]
});
assert.deepStrictEqual(linksShopeeSomenteProduto.map(link => link.papel), ["link_produto"], "Shopee somente produto deve mostrar so produto");

const linksShopeeSomenteResgate = coletarLinksComerciaisFinais({
  marketplace: "shopee",
  linksComerciais: [
    { tipo: "resgate", papel: "link_resgate", urlOptimus: "https://go.optimuspromo.com.br/r/resgate-only", renderizavel: true }
  ]
});
assert.deepStrictEqual(linksShopeeSomenteResgate.map(link => link.papel), ["link_resgate"], "Shopee somente resgate comprovado deve mostrar so resgate");

const linksAliConvergentes = coletarLinksComerciaisFinais({
  marketplace: "aliexpress",
  linksComerciais: [
    { tipo: "app", papel: "link_app", ordemCaptura: 1, urlOptimus: "https://go.optimuspromo.com.br/r/mesmo", renderizavel: true },
    { tipo: "app", papel: "link_app", ordemCaptura: 2, urlOptimus: "https://go.optimuspromo.com.br/r/mesmo", renderizavel: true },
    { tipo: "pc", papel: "link_pc", ordemCaptura: 3, urlOptimus: "https://go.optimuspromo.com.br/r/mesmo", renderizavel: true }
  ]
});
assert.deepStrictEqual(
  linksAliConvergentes.map(link => link.papel),
  ["link_app", "link_pc"],
  "APP repetido dedupa, mas APP/PC com mesma URL preservam papeis distintos"
);

const linksAliComFallbackConcorrente = coletarLinksComerciaisFinais({
  marketplace: "aliexpress",
  linkAfiliado: "https://go.optimuspromo.com.br/r/principal",
  linksComerciais: [
    { tipo: "app", papel: "link_app", ordemCaptura: 1, urlOptimus: "https://go.optimuspromo.com.br/r/app789", renderizavel: true },
    { tipo: "pc", papel: "link_pc", ordemCaptura: 2, urlOptimus: "https://go.optimuspromo.com.br/r/pc789", renderizavel: true }
  ]
});
assert.deepStrictEqual(
  linksAliComFallbackConcorrente.map(link => link.papel),
  ["link_app", "link_pc"],
  "AliExpress APP+PC estruturados nao devem receber fallback escalar concorrente"
);

const ofertaFallbackEscalar = montarOfertaVitrine(ofertaBase({
  id: "fallback-escalar",
  ofertaId: "fallback-escalar",
  marketplace: "amazon",
  linksComerciais: [],
  linkAfiliado: "https://go.optimuspromo.com.br/r/principal"
}));
assert.deepStrictEqual(ofertaFallbackEscalar.linksComerciais.map(link => link.papel), ["link_produto"], "CTA principal Optimus escalar deve virar CTA publico");
assert.strictEqual(ofertaFallbackEscalar.linksComerciais[0].urlOptimus, "https://go.optimuspromo.com.br/r/principal");

for (const marketplace of ["mercadolivre", "kabum", "amazon"]) {
  const ofertaMarketplace = montarOfertaVitrine(ofertaBase({
    id: `principal-${marketplace}`,
    ofertaId: `principal-${marketplace}`,
    marketplace,
    linksComerciais: [],
    linkAfiliado: `https://go.optimuspromo.com.br/r/${marketplace}`
  }));
  assert.deepStrictEqual(ofertaMarketplace.linksComerciais.map(link => link.papel), ["link_produto"], `${marketplace} deve publicar CTA principal`);
}

const ofertaUrlOriginal = montarOfertaVitrine(ofertaBase({
  id: "url-original",
  ofertaId: "url-original",
  linksComerciais: [],
  linkAfiliado: "https://www.amazon.com.br/produto-original"
}));
assert.deepStrictEqual(ofertaUrlOriginal.linksComerciais, [], "URL original nao pode virar CTA publico");

const ofertaIntegridade = montarOfertaVitrine(ofertaBase({
  id: "integridade",
  ofertaId: "integridade",
  linksComerciais: [],
  metadata: {
    integridadeComercial: {
      linksComerciais: [
        { tipo: "produto", papel: "link_produto", urlAfiliadaWorkspace: "https://go.optimuspromo.com.br/r/integridade", renderizavel: true }
      ]
    }
  }
}));
assert.deepStrictEqual(ofertaIntegridade.linksComerciais.map(link => link.urlOptimus), ["https://go.optimuspromo.com.br/r/integridade"], "Vitrine deve considerar metadata.integridadeComercial.linksComerciais");

const ofertaShopee = montarOfertaVitrine({
  ...ofertaBase({
    id: "shopee-1",
    ofertaId: "shopee-1",
    marketplace: "shopee",
    linksComerciais: [],
    contratoComercialFinal: {
      linksProduto: [
        { tipo: "produto", papel: "link_produto", ordemCaptura: 2, urlOptimus: "https://go.optimuspromo.com.br/r/produto456", renderizavel: true }
      ],
      linksResgate: [
        { tipo: "resgate", papel: "link_resgate", ordemCaptura: 1, urlOptimus: "https://go.optimuspromo.com.br/r/resgate456", renderizavel: true }
      ]
    }
  })
});
assert.deepStrictEqual(ofertaShopee.linksComerciais.map(link => link.papel), ["link_resgate", "link_produto"]);

const depsFalha = criarDeps({ falharWrite: true });
depsFalha.clientes.set("workspace-a:vitrine.json", clone({
  versao: 1,
  clienteId: "workspace-a",
  config: {
    ativa: true,
    slug: "workspace-falha",
    nomePublico: "Falha",
    logo: "",
    descricao: "",
    links: {},
    atualizadoEm: "2026-08-17T00:00:00.000Z"
  },
  ofertas: []
}));
const falha = publicar(depsFalha, ofertaBase(), 1);
assert.strictEqual(falha.ok, false, "Falha do storage nao deve escapar como exception");
assert.strictEqual(falha.motivo, "vitrine_hook_falhou");
assert.ok(depsFalha.logs.some(item => item.tag === "[VITRINE-HOOK-FALHA]"), "Falha deve ser logada de forma sanitizada");

const depsIsolamento = criarDeps();
ativarVitrine(depsIsolamento, "workspace-a", "workspace-a");
ativarVitrine(depsIsolamento, "workspace-b", "workspace-b");
const isolamento = publicar(depsIsolamento, ofertaBase({ clienteId: "workspace-b" }), 1, "workspace-a");
assert.strictEqual(isolamento.motivo, "workspace_divergente", "Workspace A nao pode publicar oferta do workspace B");
assert.strictEqual(storage.lerVitrineWorkspace("workspace-a", depsIsolamento).ofertas.length, 0);
assert.strictEqual(storage.lerVitrineWorkspace("workspace-b", depsIsolamento).ofertas.length, 0);

const muitas = [];
const agora = Date.now();
for (let i = 0; i < 55; i += 1) {
  muitas.push({
    id: `item-${i}`,
    titulo: `Item ${i}`,
    ultimoEnvioEm: new Date(agora - i * 1000).toISOString(),
    linksComerciais: [{ papel: "link_produto", urlOptimus: "https://go.optimuspromo.com.br/r/produto", renderizavel: true }]
  });
}
muitas.push({ id: "velho", titulo: "Velho", ultimoEnvioEm: new Date(agora - 25 * 60 * 60 * 1000).toISOString() });
const retidas = storage.aplicarRetencaoOfertas(muitas, agora);
assert.strictEqual(retidas.length, 50, "Retencao 50 continua valendo");
assert.ok(!retidas.some(item => item.id === "velho"), "Retencao 24h continua valendo");

const index = ler("index.js");
assert.ok(index.includes('require("./modules/vitrine/hook")'), "index deve usar hook da Vitrine");
assert.ok(index.includes("void publicarOfertaConfirmadaVitrine"), "executor deve chamar hook pos-envio");
assert.ok(
  index.indexOf("const finalizacaoEnvio = filaOfertas.finalizarOfertaEnviadaFila") <
    index.indexOf("void publicarOfertaConfirmadaVitrine"),
  "hook deve rodar depois de finalizarOfertaEnviadaFila"
);
assert.ok(
  index.indexOf("void publicarOfertaConfirmadaVitrine") <
    index.indexOf("void registrarExecutorEnviado"),
  "hook deve ficar no bloco pos-envio confirmado antes dos eventos auxiliares"
);

console.log("vitrine-v1-hook-pos-envio.test.js OK");
