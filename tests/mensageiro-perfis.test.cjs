const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-mensageiro-perfis-"));
process.env.DATA_DIR = dataDir;

const { writeGlobalJson } = require("../utils/storage");
const storage = require("../modules/mensageiro/storage");

writeGlobalJson("usuarios.json", [
  { id: "cliente_perfis", ativo: true },
  { id: "cliente_outro", ativo: true }
]);

function perfil(id, patch = {}) {
  return {
    id,
    nome: patch.nome || id,
    ativo: patch.ativo === undefined ? true : patch.ativo,
    sessaoId: patch.sessaoId || "sessao_1",
    grupos: patch.grupos || [`${id}@g.us`],
    modulos: {
      boasVindas: { ativo: true, configuracao: { mensagem: "Oi", imagem: "", envio: { destino: "grupo" } } },
      despedida: { ativo: true, configuracao: { mensagem: "Tchau", imagem: "", envio: { destino: "grupo" } } },
      comandos: { ativo: true },
      programacoes: { ativo: true },
      gerente: { ativo: false, configuracao: {} }
    },
    ...patch
  };
}

function assertCode(fn, code) {
  assert.throws(fn, (erro) => erro && erro.code === code);
}

const antiga = storage.setMensageiroCliente("cliente_perfis", {
  ativo: true,
  sessaoId: "sessao_legada",
  sessaoWhatsappId: "sessao_legada",
  sessaoGruposId: "sessao_legada",
  grupos: ["grupo_legado@g.us"],
  comandos: [],
  programacoes: []
});

assert.deepStrictEqual(antiga.perfis, [], "config antiga sem perfis continua valida");

const legado = storage.resolverPerfilMensageiro({
  clienteId: "cliente_perfis",
  sessaoId: "sessao_legada",
  grupoId: "grupo_legado@g.us",
  modulo: "comandos"
});
assert.strictEqual(legado.ok, true, "perfil legado virtual resolve");
assert.strictEqual(legado.perfilId, storage.PERFIL_LEGADO_ID, "id legado correto");
assert.strictEqual(legado.perfil.sessaoId, "sessao_legada", "sessao legada vem da config atual");

const umPerfil = storage.setMensageiroCliente("cliente_perfis", {
  perfis: [perfil("perfil_1", { grupos: ["grupo_1@g.us"] })]
});
assert.strictEqual(umPerfil.perfis.length, 1, "cria um perfil");

storage.setMensageiroCliente("cliente_perfis", {
  perfis: [
    perfil("perfil_1", { grupos: ["grupo_1@g.us"] }),
    perfil("perfil_2", { grupos: ["grupo_2@g.us"] }),
    perfil("perfil_3", { grupos: ["grupo_3@g.us"] }),
    perfil("perfil_4", { grupos: ["grupo_4@g.us"] })
  ]
});
assertCode(() => storage.setMensageiroCliente("cliente_perfis", {
  perfis: [
    perfil("perfil_1", { grupos: ["grupo_1@g.us"] }),
    perfil("perfil_2", { grupos: ["grupo_2@g.us"] }),
    perfil("perfil_3", { grupos: ["grupo_3@g.us"] }),
    perfil("perfil_4", { grupos: ["grupo_4@g.us"] }),
    perfil("perfil_5", { grupos: ["grupo_5@g.us"] })
  ]
}), "limite_perfis_mensageiro");

const ativoInativo = storage.setMensageiroCliente("cliente_perfis", {
  perfis: [
    perfil("ativo", { ativo: true, grupos: ["grupo_ativo@g.us"] }),
    perfil("inativo", { ativo: false, grupos: ["grupo_ativo@g.us"] })
  ]
});
assert.strictEqual(ativoInativo.perfis.find((p) => p.id === "inativo").ativo, false, "perfil inativo persiste");

assertCode(() => storage.validarPerfisMensageiro(
  [perfil("sessao_ruim", { sessaoId: "fora", grupos: ["grupo_1@g.us"] })],
  { sessoesValidas: ["sessao_1"], gruposPorSessao: { sessao_1: ["grupo_1@g.us"] } }
), "sessao_invalida");

assertCode(() => storage.validarPerfisMensageiro(
  [perfil("grupo_ruim", { sessaoId: "sessao_1", grupos: ["fora@g.us"] })],
  { sessoesValidas: ["sessao_1"], gruposPorSessao: { sessao_1: ["grupo_1@g.us"] } }
), "grupo_fora_da_sessao");

assertCode(() => storage.validarPerfisMensageiro([
  perfil("a", { grupos: ["duplicado@g.us"] }),
  perfil("b", { grupos: ["duplicado@g.us"] })
]), "grupo_duplicado_em_perfis");

storage.setMensageiroCliente("cliente_perfis", {
  perfis: [
    perfil("perfil_a", { sessaoId: "sessao_a", grupos: ["grupo_a@g.us"] }),
    perfil("perfil_b", { sessaoId: "sessao_b", grupos: ["grupo_b@g.us"] })
  ]
});
const resolvido = storage.resolverPerfilMensageiro({
  clienteId: "cliente_perfis",
  sessaoId: "sessao_b",
  grupoId: "grupo_b@g.us",
  modulo: "programacoes"
});
assert.strictEqual(resolvido.ok, true, "resolver retorna perfil correto");
assert.strictEqual(resolvido.perfilId, "perfil_b", "resolver respeita sessao/grupo");

const conflito = storage.resolverPerfilMensageiro({
  clienteId: "cliente_perfis",
  sessaoId: "",
  grupoId: "",
  modulo: "comandos",
  config: {
    perfis: [
      perfil("c1", { sessaoId: "s1", grupos: ["g1@g.us"] }),
      perfil("c2", { sessaoId: "s2", grupos: ["g2@g.us"] })
    ]
  }
});
assert.strictEqual(conflito.ok, false, "conflito retorna erro seguro quando mais de um perfil corresponde");
assert.strictEqual(conflito.codigo, "grupo_duplicado_em_perfis", "codigo de conflito estruturado");

storage.setMensageiroCliente("cliente_outro", {
  perfis: [perfil("outro", { sessaoId: "sessao_outro", grupos: ["grupo_outro@g.us"] })]
});
const isolado = storage.resolverPerfilMensageiro({
  clienteId: "cliente_perfis",
  sessaoId: "sessao_outro",
  grupoId: "grupo_outro@g.us",
  modulo: "comandos"
});
assert.strictEqual(isolado.ok, false, "resolver nunca atravessa workspace");

const comPerfilId = storage.setMensageiroCliente("cliente_perfis", {
  perfis: [perfil("perfil_vinculado", { grupos: ["grupo_vinculado@g.us"] })],
  comandos: [{
    id: "cmd_perfil",
    nome: "Cmd",
    perfilId: "perfil_vinculado",
    gatilhos: ["!cmd"],
    resposta: { tipo: "texto", texto: "ok", imagem: "" }
  }],
  programacoes: [{
    id: "prog_perfil",
    nome: "Prog",
    perfilId: "perfil_vinculado",
    tipo: "intervalo",
    grupos: ["grupo_vinculado@g.us"],
    conteudos: [{ id: "c1", tipo: "texto", texto: "ok", imagem: "" }]
  }]
});
assert.strictEqual(comPerfilId.comandos[0].perfilId, "perfil_vinculado", "perfilId opcional persiste em comandos");
assert.strictEqual(comPerfilId.programacoes[0].perfilId, "perfil_vinculado", "perfilId opcional persiste em programacoes");

storage.registrarHistoricoAtendimento("cliente_perfis", {
  tipo: "comando",
  perfilId: "perfil_vinculado",
  perfilNome: "Perfil Vinculado",
  resumo: "Evento"
});
const historico = storage.getAtendimentoConfigCliente("cliente_perfis").historico;
assert.ok(historico.some((evento) => evento.perfilId === "perfil_vinculado"), "historico aceita perfilId opcional");

console.log("mensageiro-perfis.test.cjs OK");
