const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-usuarios-inativos-"));
process.env.DATA_DIR = dataDir;
process.env.USUARIO_INATIVO_LOG_COOLDOWN_MS = "1";

const { writeClienteJson, readClienteJson, writeGlobalJson } = require("../utils/storage");
const {
  usuarioAtivo,
  listarClientesAtivos
} = require("../utils/usuarios-atividade");

let importerErroRegistrado = null;
let importerAdapterChamado = false;
const importerServicePath = require.resolve("../modules/engine/importer/importer.service");
require.cache[importerServicePath] = {
  id: importerServicePath,
  filename: importerServicePath,
  loaded: true,
  exports: {
    buscarJobsProntos: async () => ({ ok: true, jobs: [] }),
    tentarMarcarImportando: async () => ({ ok: true }),
    registrarEtapaImportacao: async () => ({ ok: true }),
    carregarEventoBruto: async () => ({ evento: null }),
    carregarLinksEvento: async () => ({ links: [] }),
    gravarOfertaEngine: async () => ({ ok: true }),
    marcarJobOfertaCriada: async () => ({ ok: true }),
    marcarJobRetidaV2: async () => ({ ok: true }),
    marcarJobErroImportacao: async (jobId, motivo, detalhes) => {
      importerErroRegistrado = { jobId, motivo, detalhes };
      return { ok: true };
    }
  }
};
for (const [relativo, nome] of [
  ["../modules/engine/importer/adapters/mercadolivre.adapter", "importarMercadoLivreEngine"],
  ["../modules/engine/importer/adapters/amazon.adapter", "importarAmazonEngine"],
  ["../modules/engine/importer/adapters/shopee.adapter", "importarShopeeEngine"],
  ["../modules/engine/importer/adapters/aliexpress.adapter", "importarAliExpressEngine"],
  ["../modules/engine/importer/adapters/awin.adapter", "importarAwinEngine"]
]) {
  const adapterPath = require.resolve(relativo);
  require.cache[adapterPath] = {
    id: adapterPath,
    filename: adapterPath,
    loaded: true,
    exports: {
      [nome]: async () => {
        importerAdapterChamado = true;
        return { ok: true };
      }
    }
  };
}

const distributor = require("../modules/engine/distributor/distributor.service");
const importerRunner = require("../modules/engine/importer/importer.runner");
const socialAutomatico = require("../modules/social/automatico.service");
const campanhas = require("../campanhas/agendamentosCampanhas");
const mensageiro = require("../modules/mensageiro/service");
const instagram = require("../modules/social/instagram");

writeGlobalJson("usuarios.json", [
  { id: "cliente_ativo", ativo: true },
  { id: "cliente_inativo", ativo: false }
]);
writeClienteJson("cliente_orfao", "fila.json", [{ id: "orfao" }]);

assert.strictEqual(usuarioAtivo("cliente_ativo"), true, "usuario ativo deve ser aceito");
assert.strictEqual(usuarioAtivo("cliente_inativo"), false, "usuario inativo deve ser bloqueado");
assert.strictEqual(usuarioAtivo("cliente_inexistente"), false, "usuario inexistente deve ser inativo");
assert.deepStrictEqual(listarClientesAtivos(), ["cliente_ativo"], "pasta orfa nao entra como cliente ativo");

(async () => {
  const validacaoInativa = await distributor.validarOfertaParaDistribuicao({
    id: "oferta_inativa",
    cliente_id: "cliente_inativo",
    marketplace: "amazon"
  }, {
    clientesValidos: ["cliente_inativo"],
    configsPorCliente: { cliente_inativo: { automacaoAtiva: true } },
    marketplacesAtivosPorCliente: { cliente_inativo: { amazon: true } },
    validarCreditos: () => ({ ok: true }),
    destinosPorCliente: { cliente_inativo: [] }
  });
  assert.strictEqual(validacaoInativa.motivo, "usuario_inativo", "Distributor deve rejeitar usuario inativo");

  const validacaoAtiva = await distributor.validarOfertaParaDistribuicao({
    id: "oferta_ativa",
    cliente_id: "cliente_ativo",
    marketplace: "amazon"
  }, {
    clientesValidos: ["cliente_ativo"],
    configsPorCliente: { cliente_ativo: { automacaoAtiva: true } },
    marketplacesAtivosPorCliente: { cliente_ativo: { amazon: true } },
    validarCreditos: () => ({ ok: true }),
    destinosPorCliente: { cliente_ativo: [] }
  });
  assert.notStrictEqual(validacaoAtiva.motivo, "usuario_inativo", "usuario ativo nao deve cair no bloqueio central");

  const importerInativo = await importerRunner.importarJobPronto({
    id: "job_inativo",
    evento_id: "evento_inativo",
    cliente_id: "cliente_inativo",
    marketplace: "amazon"
  });
  assert.strictEqual(importerInativo.motivo, "usuario_inativo", "Importer Runner deve rejeitar inativo antes do adapter");
  assert.strictEqual(importerErroRegistrado?.motivo, "usuario_inativo", "Importer Runner deve registrar motivo seguro");
  assert.strictEqual(importerAdapterChamado, false, "adapter nao deve ser chamado para inativo");

  let chamouFila = false;
  const filaInativa = await distributor.adicionarOfertaNaFilaCliente({
    id: "oferta_inativa",
    cliente_id: "cliente_inativo",
    marketplace: "amazon",
    titulo: "Oferta inativa"
  }, {
    deps: {
      adicionarOfertaNaFilaGlobal: () => {
        chamouFila = true;
        return { ok: true };
      }
    }
  });
  assert.strictEqual(filaInativa.motivo, "usuario_inativo", "Distributor nao deve adicionar fila para inativo");
  assert.strictEqual(chamouFila, false, "fila nao deve ser chamada para usuario inativo");

  const socialInativo = await socialAutomatico.executarAutomaticoCliente({ clienteId: "cliente_inativo" });
  assert.strictEqual(socialInativo.motivo, "usuario_inativo", "Social automatico deve ignorar inativo");

  const campanhaInativa = await campanhas.executarAgendamentosPendentesCliente({ clienteId: "cliente_inativo" });
  assert.strictEqual(campanhaInativa.motivo, "usuario_inativo", "Campanhas devem ignorar inativo");

  const campanhaTodos = await campanhas.executarAgendamentosPendentesTodosClientes({
    clientes: ["cliente_ativo", "cliente_inativo", "cliente_inexistente"]
  });
  assert.deepStrictEqual(
    campanhaTodos.resultados.map(item => item.clienteId),
    ["cliente_ativo"],
    "campanhas com lista externa devem processar apenas usuarios ativos"
  );

  await mensageiro.tratarMensagemPrivadaAtendimento({
    clienteId: "cliente_inativo",
    sessaoId: "sessao_inativa",
    planoLiberado: true,
    sock: {},
    mensagem: { key: { remoteJid: "5511999999999@s.whatsapp.net" }, message: { conversation: "oi" } }
  });
  await mensageiro.tratarEventoGrupoMensageiro({
    clienteId: "cliente_inativo",
    sessaoId: "sessao_inativa",
    sock: {},
    evento: { id: "grupo@g.us", participants: ["p@s.whatsapp.net"], action: "add" }
  });

  writeClienteJson("cliente_inativo", "social-instagram.json", {
    clienteId: "cliente_inativo",
    conectado: true,
    instagramUserId: "ig_inativo",
    token: { accessToken: "token_fake" }
  });
  writeClienteJson("cliente_inativo", "social-publicacoes.json", [{
    id: "pub_inativa",
    status: "publicada",
    instagramMediaId: "media_inativa",
    tipoPublicacao: "livre",
    respostaPublica: "ok",
    gatilho: { ativo: true, palavra: "quero", respostaPublica: "ok" }
  }]);
  const webhookInativo = await instagram.processarEventoComentarioInstagram({
    field: "comments",
    instagramUserId: "ig_inativo",
    instagramMediaId: "media_inativa",
    instagramCommentId: "comentario_1",
    textoComentario: "quero"
  }, {
    httpClient: {
      get: async () => {
        throw new Error("http_nao_deveria_ser_chamado");
      },
      post: async () => {
        throw new Error("http_nao_deveria_ser_chamado");
      }
    }
  });
  assert.strictEqual(webhookInativo.motivo, "publicacao_nao_optimus", "webhook Social deve ignorar publicacao de inativo");
  assert.strictEqual(readClienteJson("cliente_inativo", "social-interacoes.json", []).length, 0, "webhook inativo nao cria interacao");

  const indexFonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.ok(indexFonte.includes("logUsuarioInativoOperacional(clienteId, \"creditos_debito\")"), "debitarCreditos deve bloquear inativo");
  assert.ok(indexFonte.includes("return listarClientesAtivosOperacionais();"), "Engine Processor deve listar apenas usuarios ativos");
  assert.ok(indexFonte.includes("logUsuarioInativoOperacional(clienteFila, \"executor_processar_fila\")"), "processarFila direto deve bloquear inativo");
  assert.ok(indexFonte.includes("logUsuarioInativoOperacional(clienteIdMensageiro, \"whatsapp_reconexao_automatica\")"), "WhatsApp deve bloquear reconexao automatica de inativo");
  assert.ok(indexFonte.includes("logUsuarioInativoOperacional(clienteIdMensageiro, \"whatsapp_messages_upsert\")"), "WhatsApp conectado deve ignorar eventos de inativo");

  console.log("usuarios-inativos-hotfix.test.js OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
