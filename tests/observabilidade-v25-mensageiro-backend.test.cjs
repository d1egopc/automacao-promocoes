"use strict";

const assert = require("assert");
const http = require("http");
const express = require("express");

const { criarRotasObservabilidadeAdmin } = require("../modules/observabilidade/admin.routes");

const agora = new Date();
function minutosAtras(minutos) {
  return new Date(agora.getTime() - minutos * 60 * 1000).toISOString();
}
const usuarios = [
  { id: "admin", papel: "admin_master", nome: "Admin", ativo: true },
  { id: "cliente_a", papel: "cliente", nome: "Cliente A", ativo: true },
  { id: "cliente_b", papel: "cliente", nome: "Cliente B", ativo: true }
];

const configsMensageiro = {
  cliente_a: {
    ativo: true,
    sessaoId: "sessao_a",
    boasVindasAtivo: true,
    despedidaAtivo: true,
    perfis: [
      {
        id: "perfil_a",
        nome: "Perfil Principal",
        ativo: true,
        sessaoId: "sessao_a",
        grupos: ["5511999999999-123@g.us"],
        modulos: {
          boasVindas: { ativo: true },
          despedida: { ativo: true },
          comandos: { ativo: true },
          programacoes: { ativo: true },
          gerente: { ativo: true }
        }
      }
    ],
    comandos: [{ id: "cmd_pix", ativo: true, nome: "PIX" }],
    programacoes: [{ id: "prog_1", ativo: true, nome: "Bom dia" }]
  },
  cliente_b: {
    ativo: false,
    sessaoId: "sessao_b",
    perfis: [],
    comandos: [],
    programacoes: []
  }
};

const historicos = {
  cliente_a: {
    historico: [
      {
        data: minutosAtras(1),
        tipo: "comando",
        origem: "grupo",
        contato: "5511888888888@s.whatsapp.net",
        contatoNome: "Pessoa Privada",
        grupo: "5511999999999-123@g.us",
        grupoNome: "5511999999999-123@g.us",
        mensagemRecebida: "pix secreto nao deve sair",
        respostaEnviada: ["texto:chave pix secreta"],
        comandoId: "cmd_pix",
        comandoNome: "PIX",
        status: "enviado",
        resultado: "enviado"
      },
      {
        data: minutosAtras(2),
        tipo: "programacao",
        origem: "grupo",
        grupo: "5511999999999-123@g.us",
        detalhe: "Sessao WhatsApp indisponivel",
        erro: "socket com token secreto",
        gatilhoId: "prog_1",
        gatilhoNome: "Bom dia",
        status: "erro",
        resultado: "sessao_indisponivel"
      },
      {
        data: minutosAtras(3),
        tipo: "moderacao",
        origem: "grupo",
        perfilId: "perfil_a",
        perfilNome: "Perfil Principal",
        grupo: "5511999999999-123@g.us",
        contato: "5511777777777@s.whatsapp.net",
        mensagemRecebida: "conteudo infracao secreto",
        status: "removida",
        resultado: "mensagem_removida"
      },
      {
        data: minutosAtras(4),
        tipo: "boas_vindas",
        origem: "grupo",
        grupo: "5511999999999-123@g.us",
        status: "enviado",
        resultado: "enviado"
      },
      {
        data: minutosAtras(5),
        tipo: "despedida",
        origem: "privado",
        contato: "5511666666666@s.whatsapp.net",
        status: "enviado",
        resultado: "enviado"
      }
    ]
  },
  cliente_b: { historico: [] }
};

function criarApp() {
  const app = express();
  app.use((req, _res, next) => {
    const papel = req.headers["x-papel"];
    if (papel) req.usuario = { id: papel === "admin_master" ? "admin" : "cliente_a", papel };
    next();
  });
  app.use("/admin/observabilidade", criarRotasObservabilidadeAdmin({
    getUsuarios: () => usuarios,
    getConfigsPorCliente: () => ({}),
    getIntegracoesPorCliente: () => ({}),
    getMensageiroCliente: clienteId => configsMensageiro[clienteId] || {},
    getAtendimentoConfigCliente: clienteId => historicos[clienteId] || { historico: [] },
    listarInfracoesGerenteCliente: clienteId => clienteId === "cliente_a" ? [{ id: "inf_1", status: "ativa", participante: "5511777777777@s.whatsapp.net" }] : [],
    getStatusSessao: sessaoId => sessaoId === "sessao_a" ? "closed" : "",
    isAdminMaster: req => req.usuario?.papel === "admin_master"
  }));
  return app;
}

function request(app, metodo, url, papel = "admin_master") {
  return new Promise(resolve => {
    const server = app.listen(0, "127.0.0.1", () => {
      const req = http.request({
        hostname: "127.0.0.1",
        port: server.address().port,
        method: metodo,
        path: url,
        headers: papel ? { "x-papel": papel } : {}
      }, res => {
        let body = "";
        res.on("data", chunk => { body += chunk; });
        res.on("end", () => {
          server.close(() => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
        });
      });
      req.end();
    });
  });
}

(async () => {
  const app = criarApp();
  const comum = await request(app, "GET", "/admin/observabilidade/workspaces/cliente_a/mensageiro", "cliente");
  assert.strictEqual(comum.status, 403, "usuario comum nao acessa observabilidade Mensageiro");

  const inexistente = await request(app, "GET", "/admin/observabilidade/workspaces/inexistente/mensageiro");
  assert.strictEqual(inexistente.status, 404, "workspace inexistente falha controlado");

  const resposta = await request(app, "GET", "/admin/observabilidade/workspaces/cliente_a/mensageiro?janelaMinutos=180&limit=3");
  assert.strictEqual(resposta.status, 200);
  assert.strictEqual(resposta.body.ok, true);
  assert.strictEqual(resposta.body.readOnly, true);
  assert.strictEqual(resposta.body.ativo, true);
  assert.strictEqual(resposta.body.perfis.total, 1);
  assert.strictEqual(resposta.body.perfis.ativos, 1);
  assert.strictEqual(resposta.body.modulos.boasVindas.eventos, 1);
  assert.strictEqual(resposta.body.modulos.despedida.eventos, 1);
  assert.strictEqual(resposta.body.modulos.comandos.execucoes, 1);
  assert.strictEqual(resposta.body.modulos.programacoes.erros, 1);
  assert.strictEqual(resposta.body.modulos.gerente.mensagensApagadas, 1);
  assert.strictEqual(resposta.body.modulos.gerente.infracoesAtivas, 1);
  assert.strictEqual(resposta.body.eventosRecentes.length, 3, "eventos recentes devem respeitar limit");
  assert(resposta.body.problemas.some(p => p.motivoCodigo === "mensageiro_sessao_offline"), "sessao offline deve virar problema normalizado");
  assert.strictEqual(resposta.body.saude.status, "atencao", "sessao offline deve gerar atencao observacional");

  const serializado = JSON.stringify(resposta.body);
  assert(!/pix secreto|chave pix|conteudo infracao|Pessoa Privada|5511|@s\.whatsapp\.net|@g\.us|token secreto|mensagemRecebida|respostaEnviada|contato/i.test(serializado), "saida nao pode vazar conteudo, JID, telefone ou payload");
  assert(/hash_[a-f0-9]{16}/.test(serializado), "identificadores operacionais devem ser hash quando vierem de JID/sessao");

  const desligado = await request(app, "GET", "/admin/observabilidade/workspaces/cliente_b/mensageiro");
  assert.strictEqual(desligado.status, 200);
  assert.strictEqual(desligado.body.saude.status, "desligado", "Mensageiro desligado deve ser classificado como desligado");

  console.log("observabilidade-v25-mensageiro-backend.test.cjs OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
