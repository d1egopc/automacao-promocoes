"use strict";

const assert = require("assert");
const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");

const criarRotasClonadorGrupos = require("../modules/clonador-grupos/routes");
const { criarServicoClonadorGrupos, MAX_FONTES_ATIVAS } = require("../modules/clonador-grupos");

const raiz = path.resolve(__dirname, "..");

function clone(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function criarRepoMemoria() {
  const estado = {
    configs: new Map(),
    fontes: new Map(),
    buffer: []
  };

  function chaveBuffer(item) {
    return [item.clienteId, item.sessaoId, item.grupoJid, item.mensagemId].join("|");
  }

  return {
    estado,
    async lerConfig(clienteId) {
      return clone(estado.configs.get(clienteId) || { clienteId, ativo: false });
    },
    async salvarConfig(clienteId, dados = {}) {
      const config = { clienteId, ativo: dados.ativo === true };
      estado.configs.set(clienteId, config);
      return clone(config);
    },
    async listarFontes(clienteId) {
      return clone(estado.fontes.get(clienteId) || []);
    },
    async substituirFontes(clienteId, fontes = []) {
      const ativas = fontes.filter(fonte => fonte.ativo !== false);
      if (ativas.length > MAX_FONTES_ATIVAS) {
        const erro = new Error("limite_fontes_ativas_excedido");
        erro.codigo = "limite_fontes_ativas_excedido";
        erro.statusCode = 400;
        throw erro;
      }
      const salvas = fontes.map((fonte, index) => ({ id: String(index + 1), clienteId, ...fonte }));
      estado.fontes.set(clienteId, salvas);
      return clone(salvas);
    },
    async listarDestinos() {
      return [];
    },
    async substituirDestinos() {
      return [];
    },
    async inserirBufferCaptura(item = {}) {
      const chave = chaveBuffer(item);
      if (estado.buffer.some(buffer => chaveBuffer(buffer) === chave)) {
        return { inserido: false, item: null };
      }
      const salvo = {
        id: String(estado.buffer.length + 1),
        status: "capturada",
        ...item,
        createdAt: item.capturadoEm,
        updatedAt: item.capturadoEm
      };
      estado.buffer.push(salvo);
      return { inserido: true, item: clone(salvo) };
    },
    async listarBuffer(clienteId, filtros = {}) {
      const status = String(filtros.status || "").trim();
      const limit = Math.max(1, Math.min(100, Number(filtros.limit || 50)));
      return clone(estado.buffer
        .filter(item => item.clienteId === clienteId)
        .filter(item => !status || item.status === status)
        .slice(-limit)
        .reverse());
    }
  };
}

function mensagem({ grupoJid = "grupo_a@g.us", id = "msg_1", texto = "Oferta boa https://s.shopee.com.br/abc", fromMe = false, ts = 1788720000 } = {}) {
  return {
    key: {
      id,
      remoteJid: grupoJid,
      fromMe,
      participant: "5511999999999@s.whatsapp.net"
    },
    pushName: "Origem",
    messageTimestamp: ts,
    message: {
      conversation: texto
    }
  };
}

function req(clienteId) {
  return {
    clienteId,
    usuario: { id: clienteId },
    header(nome) {
      return nome.toLowerCase() === "x-cliente-id" ? clienteId : "";
    }
  };
}

function criarAmbiente() {
  const repo = criarRepoMemoria();
  const recursos = {
    workspace_a: true,
    workspace_b: true,
    workspace_sem_recurso: false
  };
  const sessoes = {
    workspace_a: ["sessao_a"],
    workspace_b: ["sessao_b"],
    workspace_sem_recurso: ["sessao_sem_recurso"]
  };
  const grupos = {
    workspace_a: {
      sessao_a: [
        { id: "grupo_a@g.us", nome: "Grupo A" },
        { id: "grupo_b@g.us", nome: "Grupo B" },
        { id: "grupo_c@g.us", nome: "Grupo C" },
        { id: "grupo_d@g.us", nome: "Grupo D" },
        { id: "grupo_e@g.us", nome: "Grupo E" }
      ]
    },
    workspace_b: {
      sessao_b: [
        { id: "grupo_a@g.us", nome: "Grupo A de B" },
        { id: "grupo_x@g.us", nome: "Grupo X" }
      ]
    },
    workspace_sem_recurso: {
      sessao_sem_recurso: [
        { id: "grupo_a@g.us", nome: "Grupo sem recurso" }
      ]
    }
  };
  const logs = [];
  const service = criarServicoClonadorGrupos({
    repository: repo,
    getClienteId: (request) => request.clienteId,
    usuarioTemRecurso: (request, recurso) => recurso === "clonador_grupos" && recursos[request.clienteId] === true,
    clienteTemRecurso: (clienteId, recurso) => recurso === "clonador_grupos" && recursos[clienteId] === true,
    listarSessoesWorkspace: (clienteId) => sessoes[clienteId] || [],
    listarGruposSessao: (clienteId, sessaoId) => grupos[clienteId]?.[sessaoId] || [],
    extrairLinksMensagem: (texto) => String(texto || "").match(/https?:\/\/[^\s]+/g) || [],
    logger: { log: (...args) => logs.push(args.join(" ")) }
  });
  return { repo, service, logs };
}

function ouvir(app) {
  return new Promise(resolve => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function requestHttp(server, caminho, clienteId) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port: server.address().port,
      path: caminho,
      method: "GET",
      headers: { "x-cliente-id": clienteId }
    }, (res) => {
      let dados = "";
      res.on("data", chunk => { dados += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: dados ? JSON.parse(dados) : null }));
    });
    request.on("error", reject);
    request.end();
  });
}

async function prepararFonteAtiva(service, clienteId = "workspace_a", sessaoId = "sessao_a", grupoJid = "grupo_a@g.us") {
  await service.salvarConfig(req(clienteId), { ativo: true });
  await service.salvarFontes(req(clienteId), {
    fontes: [{ sessaoId, grupoJid, grupoNome: "Grupo selecionado" }]
  });
}

async function testarCapturaGuardsBuffer() {
  const { repo, service } = criarAmbiente();
  await prepararFonteAtiva(service);

  const captura = await service.capturarMensagemWhatsapp({
    clienteId: "workspace_a",
    sessaoId: "sessao_a",
    mensagem: mensagem()
  });
  assert.strictEqual(captura.capturada, true);
  assert.strictEqual(repo.estado.buffer.length, 1);
  assert.strictEqual(repo.estado.buffer[0].clienteId, "workspace_a");
  assert.strictEqual(repo.estado.buffer[0].sessaoId, "sessao_a");
  assert.strictEqual(repo.estado.buffer[0].grupoJid, "grupo_a@g.us");
  assert.strictEqual(repo.estado.buffer[0].mensagemId, "msg_1");
  assert.strictEqual(repo.estado.buffer[0].status, "capturada");
  assert.deepStrictEqual(repo.estado.buffer[0].links, ["https://s.shopee.com.br/abc"]);

  const repetida = await service.capturarMensagemWhatsapp({
    clienteId: "workspace_a",
    sessaoId: "sessao_a",
    mensagem: mensagem()
  });
  assert.strictEqual(repetida.capturada, false);
  assert.strictEqual(repetida.motivo, "duplicada");
  assert.strictEqual(repo.estado.buffer.length, 1);

  const naoSelecionado = await service.capturarMensagemWhatsapp({
    clienteId: "workspace_a",
    sessaoId: "sessao_a",
    mensagem: mensagem({ grupoJid: "grupo_b@g.us", id: "msg_2" })
  });
  assert.strictEqual(naoSelecionado.capturada, false);
  assert.strictEqual(naoSelecionado.motivo, "fonte_nao_selecionada");

  await service.salvarConfig(req("workspace_a"), { ativo: false });
  const inativa = await service.capturarMensagemWhatsapp({
    clienteId: "workspace_a",
    sessaoId: "sessao_a",
    mensagem: mensagem({ id: "msg_3" })
  });
  assert.strictEqual(inativa.capturada, false);
  assert.strictEqual(inativa.motivo, "config_inativa");

  const semRecurso = await service.capturarMensagemWhatsapp({
    clienteId: "workspace_sem_recurso",
    sessaoId: "sessao_sem_recurso",
    mensagem: mensagem({ id: "msg_4" })
  });
  assert.strictEqual(semRecurso.capturada, false);
  assert.strictEqual(semRecurso.motivo, "recurso_indisponivel");
}

async function testarLimiteQuatroEMultiworkspace() {
  const { repo, service } = criarAmbiente();
  await service.salvarConfig(req("workspace_a"), { ativo: true });
  await service.salvarFontes(req("workspace_a"), {
    fontes: ["grupo_a@g.us", "grupo_b@g.us", "grupo_c@g.us", "grupo_d@g.us"].map(grupoJid => ({
      sessaoId: "sessao_a",
      grupoJid
    }))
  });
  assert.strictEqual((await service.listarFontes(req("workspace_a"))).fontes.length, 4);
  await assert.rejects(
    () => service.salvarFontes(req("workspace_a"), {
      fontes: ["grupo_a@g.us", "grupo_b@g.us", "grupo_c@g.us", "grupo_d@g.us", "grupo_e@g.us"].map(grupoJid => ({
        sessaoId: "sessao_a",
        grupoJid
      }))
    }),
    erro => erro.codigo === "limite_fontes_ativas_excedido"
  );

  await service.salvarConfig(req("workspace_b"), { ativo: true });
  await service.salvarFontes(req("workspace_b"), {
    fontes: [{ sessaoId: "sessao_b", grupoJid: "grupo_a@g.us" }]
  });

  await service.capturarMensagemWhatsapp({
    clienteId: "workspace_a",
    sessaoId: "sessao_a",
    mensagem: mensagem({ grupoJid: "grupo_a@g.us", id: "mesmo_id" })
  });
  await service.capturarMensagemWhatsapp({
    clienteId: "workspace_b",
    sessaoId: "sessao_b",
    mensagem: mensagem({ grupoJid: "grupo_a@g.us", id: "mesmo_id" })
  });
  assert.strictEqual(repo.estado.buffer.length, 2);
  assert.deepStrictEqual(repo.estado.buffer.map(item => item.clienteId).sort(), ["workspace_a", "workspace_b"]);

  await service.capturarMensagemWhatsapp({
    clienteId: "workspace_a",
    sessaoId: "sessao_a",
    mensagem: mensagem({ grupoJid: "grupo_b@g.us", id: "mesmo_id" })
  });
  assert.strictEqual(repo.estado.buffer.length, 3, "mesma mensagemId em grupos diferentes nao deve colidir");
}

async function testarEndpointBufferIsolado() {
  const { service } = criarAmbiente();
  await prepararFonteAtiva(service);
  await service.salvarConfig(req("workspace_b"), { ativo: true });
  await service.salvarFontes(req("workspace_b"), {
    fontes: [{ sessaoId: "sessao_b", grupoJid: "grupo_a@g.us" }]
  });
  await service.capturarMensagemWhatsapp({ clienteId: "workspace_a", sessaoId: "sessao_a", mensagem: mensagem({ id: "a_1" }) });
  await service.capturarMensagemWhatsapp({ clienteId: "workspace_b", sessaoId: "sessao_b", mensagem: mensagem({ id: "b_1" }) });

  const app = express();
  app.use((request, _res, next) => {
    request.clienteId = request.header("x-cliente-id") || "";
    next();
  });
  app.use("/clonador-grupos", criarRotasClonadorGrupos({ service }));
  const server = await ouvir(app);
  try {
    const resposta = await requestHttp(server, "/clonador-grupos/buffer?clienteId=workspace_b&status=capturada&limit=10", "workspace_a");
    assert.strictEqual(resposta.status, 200);
    assert.deepStrictEqual(resposta.body.itens.map(item => item.clienteId), ["workspace_a"]);
    assert.deepStrictEqual(resposta.body.itens.map(item => item.mensagemId), ["a_1"]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function testarEscopoEstrutural() {
  const serviceFonte = fs.readFileSync(path.join(raiz, "modules", "clonador-grupos", "service.js"), "utf8");
  const repositoryFonte = fs.readFileSync(path.join(raiz, "modules", "clonador-grupos", "repository.js"), "utf8");
  const routesFonte = fs.readFileSync(path.join(raiz, "modules", "clonador-grupos", "routes.js"), "utf8");
  const moduloFonte = [serviceFonte, repositoryFonte, routesFonte].join("\n");
  assert.ok(!/registrarEventoBruto|criarJobsParaClientes|adicionarOfertaNaFilaGlobalEngine|processarFila|debitarCreditos|usuarioTemCreditos/.test(moduloFonte));

  const indexFonte = fs.readFileSync(path.join(raiz, "index.js"), "utf8");
  const listener = indexFonte.slice(
    indexFonte.indexOf("handler: async ({ messages = [] } = {}) =>"),
    indexFonte.indexOf("sock.ev.on(\"group-participants.update\"")
  );
  assert.ok(listener.includes("processarMensagemRadarAutomatica"));
  assert.ok(listener.includes("mensageiro.tratarMensagemGrupoGerente"));
  assert.ok(listener.includes("mensageiro.tratarMensagemGrupoComando"));
  assert.ok(listener.includes("mensageiro.tratarMensagemPrivadaAtendimento"));
  assert.ok(listener.includes("clonadorGruposService.capturarMensagemWhatsapp"));
  assert.ok(
    listener.indexOf("processarMensagemRadarAutomatica") <
      listener.indexOf("clonadorGruposService.capturarMensagemWhatsapp"),
    "Radar deve continuar antes do Clonador"
  );
  assert.ok(
    listener.indexOf("mensageiro.tratarMensagemPrivadaAtendimento") <
      listener.indexOf("clonadorGruposService.capturarMensagemWhatsapp"),
    "Mensageiro deve continuar antes do Clonador"
  );
}

async function main() {
  await testarCapturaGuardsBuffer();
  await testarLimiteQuatroEMultiworkspace();
  await testarEndpointBufferIsolado();
  testarEscopoEstrutural();
  console.log("clonador-grupos-capture-buffer.test.js OK");
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
