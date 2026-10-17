const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-multiperfil-"));
const { writeGlobalJson } = require("../utils/storage");
const storage = require("../modules/mensageiro/storage");
const service = require("../modules/mensageiro/service");
const scheduler = require("../modules/mensageiro/programacoes.scheduler");

writeGlobalJson("usuarios.json", [
  { id: "workspace_a", ativo: true },
  { id: "workspace_b", ativo: true }
]);

const imagemA = `data:image/png;base64,${Buffer.from("imagem-a").toString("base64")}`;
const imagemB = `data:image/png;base64,${Buffer.from("imagem-b").toString("base64")}`;
const imagemC = `data:image/png;base64,${Buffer.from("imagem-c").toString("base64")}`;

function perfil(id, grupo, imagem, sessaoId = "sessao_compartilhada") {
  return {
    id, nome: id, ativo: true, sessaoId, grupos: [grupo],
    modulos: {
      boasVindas: {
        ativo: true, conteudoConfigurado: true, gruposConfigurados: true, grupos: [grupo],
        configuracao: { mensagem: `Ola ${id}`, imagem, envio: { destino: "grupo", modoGrupo: "imagem_texto" } }
      },
      despedida: {
        ativo: false, conteudoConfigurado: true, gruposConfigurados: true, grupos: [grupo],
        configuracao: { mensagem: "", imagem: "", envio: { destino: "grupo" } }
      },
      comandos: { ativo: false, gruposConfigurados: true, grupos: [grupo] },
      programacoes: { ativo: false },
      gerente: { ativo: false, gruposConfigurados: true, grupos: [grupo], configuracao: { regras: [] } }
    }
  };
}

const grupos = ["a@g.us", "b@g.us", "c@g.us"];
const perfis = [perfil("a", grupos[0], imagemA), perfil("b", grupos[1], imagemB), perfil("c", grupos[2], imagemC)];

function sock() {
  const envios = [];
  return {
    envios,
    async sendMessage(jid, payload) {
      envios.push({ jid, payload });
      return { key: { remoteJid: jid, id: `envio_${envios.length}`, fromMe: true } };
    }
  };
}

async function entrada(clienteId, grupo, participante) {
  const socket = sock();
  await service.tratarEventoGrupoMensageiro({
    clienteId, sessaoId: "sessao_compartilhada", sock: socket,
    evento: { id: grupo, participants: [participante], action: "add" }
  });
  return socket.envios;
}

(async () => {
  storage.setMensageiroCliente("workspace_a", {
    ativo: true,
    sessaoId: "sessao_compartilhada",
    sessaoWhatsappId: "sessao_compartilhada",
    sessaoGruposId: "sessao_compartilhada",
    grupos,
    mensagemBoasVindas: "Global antiga",
    perfis
  });
  storage.setMensageiroCliente("workspace_b", {
    ativo: true,
    sessaoId: "sessao_compartilhada",
    grupos: ["outro@g.us"],
    perfis: [perfil("outro", "outro@g.us", imagemA)]
  });

  for (const [index, grupo] of grupos.entries()) {
    const envios = await entrada("workspace_a", grupo, `55110000000${index}@s.whatsapp.net`);
    assert.equal(envios.length, 1, `perfil ${index} envia somente uma vez`);
    assert.equal(envios[0].jid, grupo);
    assert.equal(envios[0].payload.caption, `Ola ${perfis[index].id}`);
    assert.deepEqual(envios[0].payload.image, Buffer.from(`imagem-${perfis[index].id}`));
  }

  const antes = storage.getMensageiroCliente("workspace_a");
  const novos = antes.perfis.map(item => item.id === "b" ? {
    ...item,
    modulos: {
      ...item.modulos,
      boasVindas: {
        ...item.modulos.boasVindas,
        conteudoConfigurado: true,
        configuracao: { ...item.modulos.boasVindas.configuracao, mensagem: "", imagem: "" }
      }
    }
  } : item);
  storage.setMensageiroCliente("workspace_a", { perfis: novos });
  const depois = storage.getMensageiroCliente("workspace_a");
  assert.equal(depois.perfis.find(item => item.id === "a").modulos.boasVindas.configuracao.imagem, imagemA);
  assert.equal(depois.perfis.find(item => item.id === "c").modulos.boasVindas.configuracao.imagem, imagemC);
  assert.equal(depois.perfis.find(item => item.id === "b").modulos.boasVindas.configuracao.imagem, "");
  assert.equal((await entrada("workspace_a", "b@g.us", "5511000000099@s.whatsapp.net")).length, 0,
    "conteudo vazio explicito nao reativa mensagem global");
  assert.equal(storage.getMensageiroCliente("workspace_b").perfis[0].modulos.boasVindas.configuracao.imagem, imagemA,
    "outra workspace permanece intacta");

  const legado = perfil("legado", "legado@g.us", "");
  delete legado.modulos.boasVindas.conteudoConfigurado;
  legado.modulos.boasVindas.configuracao.mensagem = "";
  storage.setMensageiroCliente("workspace_a", { perfis: [...depois.perfis, legado] });
  const legadoEnvios = await entrada("workspace_a", "legado@g.us", "5511000000088@s.whatsapp.net");
  assert.equal(legadoEnvios.length, 1, "fallback legado continua disponivel para perfil antigo sem marcador");
  assert.equal(legadoEnvios[0].payload.text, "Global antiga");

  const perfisComandos = [perfil("cmd_a", "cmd_a@g.us", ""), perfil("cmd_b", "cmd_b@g.us", "")];
  for (const item of perfisComandos) item.modulos.comandos.ativo = true;
  const comandos = perfisComandos.map(item => ({
    id: `comando_${item.id}`, nome: item.id, ativo: true, perfilId: item.id,
    gatilhos: ["!ajuda"], correspondencia: "exato", grupos: [], gruposConfigurados: false,
    resposta: { tipo: "texto", texto: `Resposta ${item.id}`, imagem: "" },
    cooldownSegundos: 0, cooldownParticipanteSegundos: 0
  }));
  storage.setMensageiroCliente("workspace_a", { perfis: perfisComandos, comandos });
  for (const item of perfisComandos) {
    const socket = sock();
    await service.tratarMensagemGrupoComando({
      clienteId: "workspace_a", sessaoId: "sessao_compartilhada", sock: socket, planoLiberado: true,
      mensagem: {
        key: { remoteJid: item.grupos[0], participant: "5511000000077@s.whatsapp.net", fromMe: false,
          id: `teste_${item.id}` },
        message: { conversation: "!ajuda" }
      }
    });
    assert.equal(socket.envios.length, 1, "gatilho igual deve escolher o perfil elegivel");
    assert.equal(socket.envios[0].jid, item.grupos[0]);
    assert.equal(socket.envios[0].payload.text, `Resposta ${item.id}`);
  }
  assert.equal((await entrada("workspace_a", "outro@g.us", "5511000000077@s.whatsapp.net")).length, 0,
    "grupo de outra workspace nao participa do roteamento");

  const compartilhado = "compartilhado@g.us";
  const welcome = perfil("welcome", compartilhado, imagemA);
  const manager = perfil("manager", compartilhado, imagemB);
  welcome.modulos.gerente.ativo = false;
  manager.modulos.boasVindas.ativo = false;
  manager.modulos.gerente.ativo = true;
  assert.equal(storage.validarPerfisMensageiro([welcome, manager]).length, 2,
    "mesma sessao/grupo pode ser compartilhada por modulos distintos");
  manager.modulos.boasVindas.ativo = true;
  assert.throws(() => storage.validarPerfisMensageiro([welcome, manager]),
    error => error?.code === "grupo_duplicado_em_perfis" && error?.modulo === "boasVindas",
    "mesmo modulo/grupo/sessao em dois perfis e rejeitado");

  const horario = "2026-08-24T14:59:00.000Z";
  const programacao = (id, perfilId, grupo, imagem) => ({
    id, perfilId, nome: id, ativo: true, tipo: "horario", horario: "12:00",
    timezone: "America/Sao_Paulo", gruposConfigurados: true, grupos: [grupo],
    conteudos: [{ id: `conteudo_${id}`, tipo: "imagem_texto", texto: `Agenda ${id}`, imagem }],
    nextRunAt: horario, status: "pendente"
  });
  const perfilA = perfil("agenda_a", "agenda_a@g.us", imagemA);
  const perfilB = perfil("agenda_b", "agenda_b@g.us", imagemB, "sessao_b");
  perfilA.modulos.programacoes.ativo = true;
  perfilB.modulos.programacoes.ativo = true;
  storage.setMensageiroCliente("workspace_a", {
    perfis: [perfilA], programacoes: [programacao("ag_a", perfilA.id, perfilA.grupos[0], imagemA)]
  });
  storage.setMensageiroCliente("workspace_b", {
    sessaoId: "sessao_b", sessaoWhatsappId: "sessao_b", sessaoGruposId: "sessao_b",
    perfis: [perfilB], programacoes: [programacao("ag_b", perfilB.id, perfilB.grupos[0], imagemB)]
  });
  const socketA = sock();
  const socketB = sock();
  await scheduler.rodarProgramacoesMensageiroPendentes({
    agora: new Date("2026-08-24T12:00:00-03:00"),
    getSock: sessaoId => sessaoId === "sessao_compartilhada" ? socketA : sessaoId === "sessao_b" ? socketB : null,
    getStatusSessao: () => "open"
  });
  assert.deepEqual(socketA.envios.map(item => item.jid), ["agenda_a@g.us"]);
  assert.deepEqual(socketB.envios.map(item => item.jid), ["agenda_b@g.us"]);
  assert.equal(socketA.envios[0].payload.caption, "Agenda ag_a");
  assert.equal(socketB.envios[0].payload.caption, "Agenda ag_b");
  assert.deepEqual(socketA.envios[0].payload.image, Buffer.from("imagem-a"));
  assert.deepEqual(socketB.envios[0].payload.image, Buffer.from("imagem-b"));

  console.log("mensageiro-multiperfil-isolamento: ok");
})().catch(error => { console.error(error); process.exitCode = 1; });
