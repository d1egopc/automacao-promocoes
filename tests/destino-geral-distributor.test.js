const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-destino-geral-"));

const { writeGlobalJson } = require("../utils/storage");
const destinos = require("../utils/destinos");
const distributor = require("../modules/engine/distributor/distributor.service");

const WORKSPACE_NOVA = "workspace_nova_destino_geral";

writeGlobalJson("usuarios.json", [
  { id: WORKSPACE_NOVA, ativo: true, plano: "pro" },
  { id: "workspace_existente", ativo: true, plano: "pro" }
]);

function destino(extra = {}) {
  return {
    id: extra.id || "destino_geral",
    nome: extra.nome || "OP Geral",
    ativo: extra.ativo !== false,
    tipo: "whatsapp",
    marketplaces: extra.marketplaces || ["mercadolivre"],
    categorias: extra.categorias || ["Todas as categorias"],
    ...extra
  };
}

function oferta(extra = {}) {
  return {
    id: extra.id || "oferta_teste",
    job_id: extra.job_id || "job_teste",
    cliente_id: extra.cliente_id || WORKSPACE_NOVA,
    marketplace: extra.marketplace || "mercadolivre",
    titulo: extra.titulo || "Oferta comercial valida",
    categoria: extra.categoria || "Diversos",
    preco: 21,
    link_original: "https://produto.mercadolivre.com.br/MLB-1",
    link_afiliado: "https://meli.la/workspace_nova_tag",
    metadata: {},
    ...extra
  };
}

function contexto(destinosWorkspace) {
  return {
    clientesValidos: [WORKSPACE_NOVA, "workspace_existente"],
    marketplacesAtivosPorCliente: {
      [WORKSPACE_NOVA]: { mercadolivre: true },
      workspace_existente: { mercadolivre: true }
    },
    destinosPorCliente: {
      [WORKSPACE_NOVA]: Array.isArray(destinosWorkspace) ? destinosWorkspace : [destinosWorkspace]
    },
    validarCreditos: () => ({ ok: true })
  };
}

(async () => {
  try {
    assert.strictEqual(destinos.categoriaDestinoEhGeral("geral"), true);
    assert.strictEqual(destinos.categoriaDestinoEhGeral("todos"), true);
    assert.strictEqual(destinos.categoriaDestinoEhGeral("todas"), true);
    assert.strictEqual(destinos.categoriaDestinoEhGeral("Todas as categorias"), true);
    assert.strictEqual(destinos.listaCategoriasDestinoEhGeral([]), true);

    const geralDiversos = await distributor.validarOfertaParaDistribuicao(
      oferta({ categoria: "Diversos" }),
      contexto(destino({ categorias: ["Todas as categorias"] }))
    );
    assert.strictEqual(geralDiversos.ok, true, "destino geral deve aceitar Diversos");

    const geralCategoriaConhecida = await distributor.validarOfertaParaDistribuicao(
      oferta({ categoria: "Gamer e Hardware" }),
      contexto(destino({ categorias: ["geral"] }))
    );
    assert.strictEqual(geralCategoriaConhecida.ok, true, "destino geral deve aceitar categoria conhecida");

    const restritoDiversos = await distributor.validarOfertaParaDistribuicao(
      oferta({ categoria: "Diversos" }),
      contexto(destino({ categorias: ["Gamer e Hardware"] }))
    );
    assert.strictEqual(restritoDiversos.ok, false);
    assert.strictEqual(restritoDiversos.motivo, "categoria_incompativel");
    assert.strictEqual(restritoDiversos.detalhes.destinosDiagnostico[0].categoriaOferta, "Diversos");
    assert.deepStrictEqual(restritoDiversos.detalhes.destinosDiagnostico[0].categoriasPermitidas, ["Gamer e Hardware"]);

    const inativoMaisRestrito = await distributor.validarOfertaParaDistribuicao(
      oferta({ categoria: "Diversos" }),
      contexto([
        destino({ id: "destino_inativo", ativo: false, categorias: ["Todas as categorias"] }),
        destino({ id: "destino_restrito", categorias: ["Gamer e Hardware"] })
      ])
    );
    assert.strictEqual(inativoMaisRestrito.ok, false);
    assert.strictEqual(inativoMaisRestrito.motivo, "categoria_incompativel", "destino inativo nao deve mascarar rejeicao ativa por categoria");

    const workspaceNova = await distributor.validarOfertaParaDistribuicao(
      oferta({ cliente_id: WORKSPACE_NOVA, categoria: "Diversos" }),
      contexto(destino({ categorias: [] }))
    );
    assert.strictEqual(workspaceNova.ok, true, "workspace nova com destino geral recebe oferta Diversos");

    const adicionados = [];
    const fila = await distributor.adicionarOfertaNaFilaCliente(oferta({
      cliente_id: WORKSPACE_NOVA,
      link_afiliado: "https://meli.la/workspace_nova_tag"
    }), {
      deps: {
        adicionarOfertaNaFilaGlobal: (clienteId, itemFila) => {
          adicionados.push({ clienteId, itemFila });
          return { ok: true, itemFila };
        }
      }
    });

    assert.strictEqual(fila.ok, true);
    assert.strictEqual(adicionados[0].clienteId, WORKSPACE_NOVA);
    assert.strictEqual(adicionados[0].itemFila.linkAfiliado, "https://meli.la/workspace_nova_tag");
    assert.ok(!adicionados[0].itemFila.linkAfiliado.includes("user_40qdblgt"), "link de outra workspace nao pode vazar");

    console.log("destino-geral-distributor.test.js OK");
  } finally {
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }
})().catch(err => {
  console.error(err);
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
