const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-mensageiro-destination-"));
process.env.DATA_DIR = dataDir;

const { writeGlobalJson, writeClienteJson, readClienteJson, getClienteJsonPath } = require("../utils/storage");
writeGlobalJson("usuarios.json", [
  { id: "cliente_destino", ativo: true },
  { id: "cliente_ambiguo", ativo: true },
  { id: "cliente_falha", ativo: true }
]);

const storage = require("../modules/mensageiro/storage");
const scheduler = require("../modules/mensageiro/programacoes.scheduler");

function perfil(id, sessaoId, grupoId, nome = id) {
  return {
    id,
    nome,
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

function programacao(id, grupos, extra = {}) {
  return {
    id,
    nome: id,
    tipo: "intervalo",
    intervaloMinutos: 30,
    grupos,
    gruposConfigurados: true,
    conteudos: [{ id: `${id}_conteudo`, tipo: "texto", texto: id, imagem: "" }],
    nextRunAt: new Date(Date.now() - 1000).toISOString(),
    ...extra
  };
}

async function executar(clienteId, id, envios) {
  const config = storage.getMensageiroCliente(clienteId);
  return scheduler.processarProgramacao({
    clienteId,
    programacao: config.programacoes.find((item) => item.id === id),
    agora: new Date(),
    deps: {
      getSock: () => ({ sendMessage: async (grupoId) => { envios.push(grupoId); } }),
      getStatusSessao: () => "open"
    }
  });
}

(async () => {
  const grupoPermitido = "grupo_permitido@g.us";
  const grupoExcluido = "grupo_excluido@g.us";
  const sessao = "sessao_compartilhada";

  storage.setMensageiroCliente("cliente_destino", {
    ativo: true,
    sessaoGruposId: sessao,
    perfis: [
      perfil("perfil_excluido_destino", sessao, grupoExcluido, "Perfil compartilhado"),
      perfil("perfil_legitimo", sessao, grupoPermitido)
    ],
    programacoes: []
  });
  storage.excluirPerfilMensageiro("cliente_destino", "perfil_excluido_destino");

  // A legacy schedule must skip a blocked second/last destination, not let the
  // first allowed destination authorize the whole list.
  storage.setMensageiroCliente("cliente_destino", {
    programacoes: [programacao("legado_misto_1", [grupoPermitido, grupoExcluido])]
  });
  const enviosPrimeiraOrdem = [];
  assert.strictEqual(await executar("cliente_destino", "legado_misto_1", enviosPrimeiraOrdem), true);
  assert.deepStrictEqual(enviosPrimeiraOrdem, [grupoPermitido], "grupo excluido no segundo lugar nunca recebe");

  // The result must not depend on the order of the groups.
  storage.setMensageiroCliente("cliente_destino", {
    programacoes: [programacao("legado_misto_2", [grupoExcluido, grupoPermitido])]
  });
  const enviosOrdemInversa = [];
  assert.strictEqual(await executar("cliente_destino", "legado_misto_2", enviosOrdemInversa), true);
  assert.deepStrictEqual(enviosOrdemInversa, [grupoPermitido], "grupo permitido continua quando o bloqueado vem primeiro");

  // A new profile ID may legitimately reuse the old group and session; the
  // old tombstone must not block a profile-specific schedule.
  storage.setMensageiroCliente("cliente_destino", {
    perfis: [perfil("perfil_novo", sessao, grupoExcluido, "Perfil compartilhado")],
    programacoes: [programacao("perfil_novo_programacao", [grupoExcluido], { perfilId: "perfil_novo" })]
  });
  const enviosPerfilNovo = [];
  assert.strictEqual(await executar("cliente_destino", "perfil_novo_programacao", enviosPerfilNovo), true);
  assert.deepStrictEqual(enviosPerfilNovo, [grupoExcluido], "tombstone antigo nao bloqueia perfil novo autorizado");

  // An empty tombstone has no provable owner/group mapping: legacy fallback is
  // fail-closed for every effective destination.
  storage.setMensageiroCliente("cliente_ambiguo", {
    ativo: true,
    sessaoGruposId: "sessao_ambigua",
    perfisExcluidos: [{ perfilId: "perfil_sem_grupos", sessaoId: "sessao_ambigua", grupos: [] }],
    programacoes: [programacao("legado_ambiguo", ["grupo_novo@g.us"])]
  });
  const enviosAmbiguos = [];
  assert.strictEqual(await executar("cliente_ambiguo", "legado_ambiguo", enviosAmbiguos), false);
  assert.deepStrictEqual(enviosAmbiguos, [], "titularidade legada ambigua falha fechada");

  // If the exclusive file publication fails after the tombstone is persisted,
  // deletion is not reported as success and a retry completes it idempotently.
  const perfilFalha = perfil("perfil_falha", "sessao_falha", "grupo_falha@g.us");
  storage.setMensageiroCliente("cliente_falha", {
    ativo: true,
    perfis: [perfilFalha],
    programacoes: []
  });
  writeClienteJson("cliente_falha", "mensageiro-config.json", {
    atendimentosPorPerfil: { perfil_falha: { ativo: true } },
    vinculosContatoPerfil: [{ perfilId: "perfil_falha", contato: "5511999999999" }]
  });
  const exclusiveFile = getClienteJsonPath("cliente_falha", "mensageiro-config.json");
  fs.rmSync(exclusiveFile, { force: true, recursive: true });
  fs.mkdirSync(exclusiveFile);

  assert.throws(
    () => storage.excluirPerfilMensageiro("cliente_falha", "perfil_falha"),
    (error) => Boolean(error && (error.code || error.message)),
    "falha da segunda persistencia nao pode virar falso sucesso"
  );
  const pendente = storage.getMensageiroCliente("cliente_falha").perfisExcluidos
    .find((item) => item.perfilId === "perfil_falha");
  assert.strictEqual(pendente?.limpezaExclusivaPendente, true, "tombstone pendente fica recuperavel");
  assert.ok(!storage.getMensageiroCliente("cliente_falha").perfis.some((item) => item.id === "perfil_falha"));

  fs.rmSync(exclusiveFile, { recursive: true, force: true });
  const retry = storage.excluirPerfilMensageiro("cliente_falha", "perfil_falha");
  assert.strictEqual(retry.ok, true);
  assert.strictEqual(retry.limpezaConcluida, true);
  const concluido = storage.getMensageiroCliente("cliente_falha").perfisExcluidos
    .find((item) => item.perfilId === "perfil_falha");
  assert.strictEqual(concluido?.limpezaExclusivaPendente, false, "retry conclui e marca a limpeza");
  const arquivoLimpo = readClienteJson("cliente_falha", "mensageiro-config.json", {});
  assert.deepStrictEqual(arquivoLimpo.atendimentosPorPerfil, {});
  assert.deepStrictEqual(arquivoLimpo.vinculosContatoPerfil, []);

  console.log("mensageiro-profile-delete-destination.test.cjs OK");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
