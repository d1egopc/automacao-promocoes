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

    const categoriaNaoPermitida = await validarOfertaParaDistribuicao(
      oferta({ categoria: "Perfumaria, Farmacia e Beleza" }),
      contexto(destinoAwinKabum())
    );
    assert.strictEqual(categoriaNaoPermitida.ok, false);
    assert.strictEqual(categoriaNaoPermitida.motivo, "categoria_bloqueada", "categoria realmente nao permitida continua retida");

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
