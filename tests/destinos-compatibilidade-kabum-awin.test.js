const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-destinos-kabum-awin-"));
process.env.DATA_DIR = dataDir;

const { writeGlobalJson } = require("../utils/storage");
const destinos = require("../utils/destinos");
const {
  validarOfertaParaDistribuicao,
  categoriasCandidatasOferta
} = require("../modules/engine/distributor/distributor.service");
const {
  montarOfertaUniversalEngine,
  validarContratoOfertaUniversal
} = require("../modules/engine/oferta-universal.contract");

const clienteId = "user_40qdblgt";

writeGlobalJson("usuarios.json", [{ id: clienteId, ativo: true }]);

function destinoAwinKabum(extra = {}) {
  return {
    id: "destino_awin_kabum",
    nome: "AWIN / KaBuM",
    ativo: true,
    tipo: "whatsapp",
    grupoId: "grupo_ativo",
    marketplaces: ["AWIN / KaBuM"],
    categorias: ["Gamer e Hardware"],
    ...extra
  };
}

function destinoMarketplace(marketplaces, extra = {}) {
  return destinoAwinKabum({
    marketplaces: Array.isArray(marketplaces) ? marketplaces : [marketplaces],
    ...extra
  });
}

function assertDestinoCompativel(marketplaceOferta, marketplacesDestino, mensagem) {
  const analise = destinos.analisarDestinoOferta(
    destinoMarketplace(marketplacesDestino),
    oferta({ marketplace: marketplaceOferta })
  );

  assert.strictEqual(analise.aceitaMarketplace, true, mensagem);
  assert.strictEqual(analise.aceitaCategoria, true, mensagem);
  assert.strictEqual(analise.aceita, true, mensagem);
}

function contexto(destino) {
  return {
    clientesValidos: [clienteId],
    marketplacesAtivosPorCliente: {
      [clienteId]: {
        kabum: true,
        awin: true,
        mercadolivre: true,
        amazon: true,
        aliexpress: true
      }
    },
    destinosPorCliente: {
      [clienteId]: [destino]
    },
    validarCreditos: () => ({ ok: true })
  };
}

function oferta(base = {}) {
  return {
    id: `oferta_${base.marketplace || "kabum"}`,
    cliente_id: clienteId,
    marketplace: "KaBuM",
    titulo: "Notebook AORUS gamer",
    categoria: "Gamer e Hardware",
    ...base
  };
}

(async () => {
  try {
    const analiseLiteral = destinos.analisarDestinoOferta(destinoAwinKabum(), oferta());
    assert.strictEqual(analiseLiteral.marketplaceOferta, "kabum");
    assert.deepStrictEqual(analiseLiteral.marketplacesDestino, ["awinkabum", "awin", "kabum"]);
    assert.strictEqual(analiseLiteral.categoriaOferta, "gamerehardware");
    assert.strictEqual(analiseLiteral.aceitaMarketplace, true, "KaBuM deve casar com destino AWIN / KaBuM");
    assert.strictEqual(analiseLiteral.aceitaCategoria, true, "Gamer e Hardware deve casar literalmente apos normalizacao");
    assert.strictEqual(analiseLiteral.aceita, true);

    assert.deepStrictEqual(destinos.expandirMarketplacesDestino(["awin"]), ["awin", "kabum"]);
    assert.deepStrictEqual(destinos.expandirMarketplacesDestino(["kabum"]), ["kabum", "awin"]);
    assert.deepStrictEqual(destinos.expandirMarketplacesDestino(["AWIN / KaBuM"]), ["awinkabum", "awin", "kabum"]);
    assert.deepStrictEqual(destinos.expandirMarketplacesDestino(["feed_awin"]), ["feedawin", "awin", "kabum"]);
    assert.deepStrictEqual(destinos.expandirMarketplacesDestino(["feed_kabum"]), ["feedkabum", "kabum", "awin"]);

    assertDestinoCompativel("kabum", ["awin"], "oferta kabum + destino awin deve ser compativel");
    assertDestinoCompativel("awin", ["kabum"], "oferta awin + destino kabum deve ser compativel");
    assertDestinoCompativel("kabum", ["AWIN / KaBuM"], "oferta kabum + destino AWIN/KaBuM deve ser compativel");
    assertDestinoCompativel("awin", ["AWIN / KaBuM"], "oferta awin + destino AWIN/KaBuM deve ser compativel");
    assertDestinoCompativel("feed_awin", ["kabum"], "feed_awin + destino kabum deve ser compativel");
    assertDestinoCompativel("feed_kabum", ["awin"], "feed_kabum + destino awin deve ser compativel");

    const destinoRealWorkspace = destinoMarketplace(["mercadolivre", "aliexpress", "awin", "amazon", "shopee"], {
      id: "6cf3af18-536e-4d83-a2b5-2367fbf38daf",
      nome: "OP GERAL"
    });
    const placaMsi = destinos.analisarDestinoOferta(destinoRealWorkspace, oferta({
      id: "engine_74455_1785983469820",
      marketplace: "kabum",
      titulo: "Placa Mae MSI Pro B650M-P",
      categoria: "Gamer e Hardware"
    }));
    assert.strictEqual(placaMsi.aceitaMarketplace, true, "destino real com awin deve aceitar oferta kabum");
    assert.deepStrictEqual(placaMsi.marketplacesOferta, ["kabum", "awin"]);
    assert.deepStrictEqual(placaMsi.marketplacesDestino, ["mercadolivre", "aliexpress", "awin", "kabum", "amazon", "shopee"]);
    assert.strictEqual(placaMsi.aceita, true);

    const kabum = await validarOfertaParaDistribuicao(oferta(), contexto(destinoAwinKabum()));
    assert.strictEqual(kabum.ok, true, "KaBuM + destino AWIN/KaBuM deve ser compativel");

    const awin = await validarOfertaParaDistribuicao(oferta({ marketplace: "AWIN" }), contexto(destinoAwinKabum()));
    assert.strictEqual(awin.ok, true, "AWIN + destino AWIN/KaBuM deve ser compativel");

    const estruturaPermitidos = await validarOfertaParaDistribuicao(oferta(), contexto(destinoAwinKabum({
      marketplaces: [],
      marketplacesPermitidos: ["AWIN / KaBuM"],
      categorias: [],
      categoriasPermitidas: ["Gamer e Hardware"]
    })));
    assert.strictEqual(estruturaPermitidos.ok, true, "marketplacesPermitidos/categoriasPermitidas devem alimentar a decisao quando campos principais estao vazios");

    const marketplaceNaoPermitido = await validarOfertaParaDistribuicao(
      oferta({ marketplace: "mercadolivre" }),
      contexto(destinoAwinKabum())
    );
    assert.strictEqual(marketplaceNaoPermitido.ok, false);
    assert.strictEqual(marketplaceNaoPermitido.motivo, "marketplace_bloqueado", "marketplace realmente nao permitido continua retido");

    const destinoInativo = destinos.analisarDestinoOferta(
      destinoMarketplace(["awin"], { ativo: false }),
      oferta({ marketplace: "kabum" })
    );
    assert.strictEqual(destinoInativo.aceita, false);
    assert.strictEqual(destinoInativo.motivo, "destino_inativo");

    const categoriaNaoPermitida = await validarOfertaParaDistribuicao(
      oferta({ categoria: "Perfumaria, Farmacia e Beleza" }),
      contexto(destinoAwinKabum())
    );
    assert.strictEqual(categoriaNaoPermitida.ok, false);
    assert.strictEqual(categoriaNaoPermitida.motivo, "categoria_incompativel", "categoria realmente nao permitida continua retida");

    const ofertaAmazonSemTitulo = montarOfertaUniversalEngine({
      oferta: {
        marketplace: "amazon",
        preco: 99.9,
        linkAfiliado: "https://amazon.test/oferta"
      },
      job: { id: "job_amazon", evento_id: "evento_amazon", cliente_id: clienteId },
      evento: { id: "evento_amazon" }
    });
    const validacaoAmazon = validarContratoOfertaUniversal(ofertaAmazonSemTitulo);
    assert.strictEqual(validacaoAmazon.ok, false);
    assert(validacaoAmazon.motivos.includes("titulo_ausente"), "Amazon titulo_ausente continua retida pelo contrato oficial");

    const categoriasAli = categoriasCandidatasOferta({
      marketplace: "aliexpress",
      categoria: "Diversos",
      titulo: "Organizador de cozinha compacto"
    });
    assert(categoriasAli.includes("Casa, Moveis e Decoracao"));
    assert(categoriasAli.includes("Diversos"), "AliExpress Diversos continua seguindo a regra propria de candidatos");

    console.log("destinos-compatibilidade-kabum-awin.test.js OK");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((erro) => {
  console.error(erro);
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
