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
    categorias: Object.prototype.hasOwnProperty.call(extra, "categorias") ? extra.categorias : ["Todas as categorias"],
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
    assert.strictEqual(destinos.listaCategoriasDestinoEhGeral([]), false, "lista vazia sem flag nao representa todas as categorias");

    const geralDiversos = await distributor.validarOfertaParaDistribuicao(
      oferta({ categoria: "Diversos" }),
      contexto(destino({ todasCategorias: true, categorias: ["geral"] }))
    );
    assert.strictEqual(geralDiversos.ok, true, "todasCategorias=true deve aceitar Diversos");

    const geralCategoriaFutura = await distributor.validarOfertaParaDistribuicao(
      oferta({ categoria: "Categoria Futura Ainda Nao Cadastrada" }),
      contexto(destino({ todasCategorias: true, categorias: ["geral"] }))
    );
    assert.strictEqual(geralCategoriaFutura.ok, true, "todasCategorias=true deve aceitar categoria futura desconhecida");

    const restritoDiversos = await distributor.validarOfertaParaDistribuicao(
      oferta({ categoria: "Diversos" }),
      contexto(destino({ categorias: ["Gamer e Hardware"] }))
    );
    assert.strictEqual(restritoDiversos.ok, false);
    assert.strictEqual(restritoDiversos.motivo, "categoria_incompativel");
    assert.strictEqual(restritoDiversos.detalhes.destinosDiagnostico[0].categoriaOferta, "Diversos");
    assert.deepStrictEqual(restritoDiversos.detalhes.destinosDiagnostico[0].categoriasPermitidas, ["Gamer e Hardware"]);

    const restritoCategoriaFutura = await distributor.validarOfertaParaDistribuicao(
      oferta({ categoria: "Categoria Futura Ainda Nao Cadastrada" }),
      contexto(destino({ categorias: ["Gamer e Hardware"] }))
    );
    assert.strictEqual(restritoCategoriaFutura.ok, false, "restrito continua restrito apos nova categoria");
    assert.strictEqual(restritoCategoriaFutura.motivo, "categoria_incompativel");

    const inativoMaisRestrito = await distributor.validarOfertaParaDistribuicao(
      oferta({ categoria: "Diversos" }),
      contexto([
        destino({ id: "destino_inativo", ativo: false, todasCategorias: true, categorias: ["geral"] }),
        destino({ id: "destino_restrito", categorias: ["Gamer e Hardware"] })
      ])
    );
    assert.strictEqual(inativoMaisRestrito.ok, false);
    assert.strictEqual(inativoMaisRestrito.motivo, "categoria_incompativel", "destino inativo nao deve mascarar rejeicao ativa por categoria");

    const categoriasOficiais = destinos.categoriasOficiaisDestinoNormalizadas();
    assert(categoriasOficiais.length > 5, "lista oficial de categorias selecionaveis deve estar disponivel");
    assert.strictEqual(destinos.listaCategoriasEhSnapshotCompleto(categoriasOficiais), true);

    const snapshotCompleto = destinos.normalizarDestinoContratoCategorias(destino({
      categorias: categoriasOficiais
    }));
    assert.strictEqual(snapshotCompleto.todasCategorias, true, "lista completa atual normaliza para wildcard");
    assert.deepStrictEqual(snapshotCompleto.categorias, ["geral"], "snapshot completo nao deve persistir lista enumerada");

    const snapshotParcial = destinos.normalizarDestinoContratoCategorias(destino({
      categorias: ["Gamer e Hardware", "Ferramentas"]
    }));
    assert.strictEqual(snapshotParcial.todasCategorias, false, "lista parcial nao normaliza para geral");
    assert.deepStrictEqual(snapshotParcial.categorias, ["Gamer e Hardware", "Ferramentas"]);

    const marcadorTodas = destinos.normalizarDestinoContratoCategorias(destino({
      categorias: ["Todas as categorias"]
    }));
    assert.strictEqual(marcadorTodas.todasCategorias, true, "marcador explicito normaliza para wildcard");
    assert.deepStrictEqual(marcadorTodas.categorias, ["geral"]);

    const workspaceNova = await distributor.validarOfertaParaDistribuicao(
      oferta({ cliente_id: WORKSPACE_NOVA, categoria: "Diversos" }),
      contexto(destino({ clienteId: WORKSPACE_NOVA, todasCategorias: true, categorias: ["geral"] }))
    );
    assert.strictEqual(workspaceNova.ok, true, "workspace nova com destino geral recebe oferta Diversos");

    const indexFonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
    assert(indexFonte.includes("destinosUtils.normalizarDestinoContratoCategorias"), "endpoint de destinos deve persistir wildcard/flag, nao snapshot enumerado");

    const outroWorkspaceRestrito = await distributor.validarOfertaParaDistribuicao(
      oferta({ cliente_id: "workspace_existente", categoria: "Diversos" }),
      {
        clientesValidos: [WORKSPACE_NOVA, "workspace_existente"],
        marketplacesAtivosPorCliente: {
          [WORKSPACE_NOVA]: { mercadolivre: true },
          workspace_existente: { mercadolivre: true }
        },
        destinosPorCliente: {
          [WORKSPACE_NOVA]: [destino({ todasCategorias: true, categorias: ["geral"] })],
          workspace_existente: [destino({ categorias: ["Gamer e Hardware"] })]
        },
        validarCreditos: () => ({ ok: true })
      }
    );
    assert.strictEqual(outroWorkspaceRestrito.ok, false, "workspace restrita nao herda wildcard de outra workspace");
    assert.strictEqual(outroWorkspaceRestrito.motivo, "categoria_incompativel");

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
