const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-mensageiro-delete-"));
process.env.DATA_DIR = dataDir;

const { writeGlobalJson } = require("../utils/storage");
writeGlobalJson("usuarios.json", [{ id: "cliente_delete", ativo: true }, { id: "cliente_outro", ativo: true }]);

const storage = require("../modules/mensageiro/storage");
const scheduler = require("../modules/mensageiro/programacoes.scheduler");

(async () => {

function perfil(id, sessaoId, grupoId) {
  return {
    id,
    nome: id,
    ativo: true,
    sessaoId,
    grupos: [grupoId],
    modulos: {
      boasVindas: { ativo: true },
      despedida: { ativo: true },
      comandos: { ativo: true },
      programacoes: { ativo: true },
      gerente: { ativo: false, configuracao: {} }
    }
  };
}

const p1 = perfil("perfil_excluir", "sessao_delete", "grupo_delete@g.us");
const p2 = perfil("perfil_preservar", "sessao_preservar", "grupo_preservar@g.us");
const config = storage.setMensageiroCliente("cliente_delete", {
  ativo: true,
  perfis: [p1, p2],
  comandos: [{ id: "cmd_delete", nome: "cmd", perfilId: p1.id, gatilhos: ["!x"], resposta: { tipo: "texto", texto: "ok" } }],
  programacoes: [{
    id: "prog_delete",
    nome: "programacao",
    perfilId: p1.id,
    tipo: "intervalo",
    intervaloMinutos: 30,
    grupos: ["grupo_delete@g.us"],
    gruposConfigurados: true,
    conteudos: [{ id: "c1", tipo: "texto", texto: "nao enviar", imagem: "" }],
    nextRunAt: new Date(Date.now() - 1000).toISOString()
  }]
});

const resultado = storage.excluirPerfilMensageiro("cliente_delete", p1.id);
assert.strictEqual(resultado.ok, true, "exclusao retorna sucesso");
const depois = storage.getMensageiroCliente("cliente_delete");
assert.ok(!depois.perfis.some((item) => item.id === p1.id), "perfil removido da lista oficial");
assert.ok(depois.perfis.some((item) => item.id === p2.id), "outro perfil preservado");
assert.ok(!depois.comandos.some((item) => item.perfilId === p1.id), "comando exclusivo cancelado");
assert.ok(!depois.programacoes.some((item) => item.perfilId === p1.id), "programacao exclusiva cancelada");
assert.ok(depois.perfisExcluidos.some((item) => item.perfilId === p1.id), "tombstone persistido");

const bloqueado = storage.resolverPerfilMensageiro({
  clienteId: "cliente_delete",
  sessaoId: "sessao_delete",
  grupoId: "grupo_delete@g.us",
  modulo: "comandos"
});
assert.strictEqual(bloqueado.ok, false, "legado nao adota perfil excluido");
assert.ok(["perfil_excluido", "perfil_nao_encontrado"].includes(bloqueado.codigo), "resolucao falha fechada");
assert.strictEqual(storage.perfilExcluidoBloqueia({
  config: depois,
  sessaoId: "sessao_delete",
  grupoId: "grupo_delete@g.us"
}).ok, false, "tombstone bloqueia fallback legado");

const preservado = storage.resolverPerfilMensageiro({
  clienteId: "cliente_delete",
  sessaoId: "sessao_preservar",
  grupoId: "grupo_preservar@g.us",
  modulo: "comandos"
});
assert.strictEqual(preservado.ok, true, "outro perfil continua resolvido");
assert.strictEqual(preservado.perfilId, p2.id);

const idempotente = storage.excluirPerfilMensageiro("cliente_delete", p1.id);
assert.strictEqual(idempotente.ok, true, "exclusao repetida e idempotente");
assert.strictEqual(idempotente.jaExcluido, true);

const snapshotConfig = storage.getMensageiroCliente("cliente_delete");
storage.setMensageiroCliente("cliente_delete", {
  ...snapshotConfig,
  programacoes: [{
    id: "prog_legado_excluido",
    nome: "legado antigo",
    tipo: "intervalo",
    intervaloMinutos: 30,
    grupos: ["grupo_delete@g.us"],
    gruposConfigurados: true,
    conteudos: [{ id: "c1", tipo: "texto", texto: "nao enviar", imagem: "" }],
    nextRunAt: new Date(Date.now() - 1000).toISOString()
  }]
});
let envios = 0;
const processou = await scheduler.processarProgramacao({
  clienteId: "cliente_delete",
  programacao: storage.getMensageiroCliente("cliente_delete").programacoes[0],
  agora: new Date(),
  deps: {
    getSock: () => ({ sendMessage: async () => { envios += 1; } }),
    getStatusSessao: () => "open"
  }
});
assert.strictEqual(processou, false, "programacao legado do perfil removido fica bloqueada");
assert.strictEqual(envios, 0, "nenhum envio apos exclusao");

const mesmoNomeNovoId = storage.setMensageiroCliente("cliente_delete", {
  perfis: [perfil("perfil_novo", "sessao_delete", "grupo_delete@g.us")],
  programacoes: []
});
const recriado = storage.resolverPerfilMensageiro({
  clienteId: "cliente_delete",
  sessaoId: "sessao_delete",
  grupoId: "grupo_delete@g.us",
  modulo: "programacoes"
});
assert.strictEqual(recriado.ok, true, "perfil recriado com novo id nao herda bloqueio do legado");
assert.strictEqual(recriado.perfilId, "perfil_novo");

const outroWorkspace = storage.setMensageiroCliente("cliente_outro", {
  ativo: true,
  perfis: [perfil("perfil_outro", "sessao_delete", "grupo_delete@g.us")]
});
assert.strictEqual(outroWorkspace.perfis.length, 1, "workspace distinta preservada");

  console.log("mensageiro-profile-delete.test.cjs OK");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
