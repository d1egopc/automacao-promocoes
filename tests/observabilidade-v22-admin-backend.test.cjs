"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");

const raiz = path.join(__dirname, "..");
const { criarRotasObservabilidadeAdmin } = require("../modules/observabilidade/admin.routes");
const observabilidadeService = require("../modules/observabilidade/admin.service");

const usuarios = [
  {
    id: "admin",
    nome: "Admin",
    email: "admin@optimus.local",
    papel: "admin_master",
    ativo: true,
    plano: "master",
    creditos: 999
  },
  {
    id: "user_d1egopc",
    nome: "Diego",
    email: "diego@example.com",
    workspaceNome: "D1EGOPC",
    papel: "cliente",
    ativo: true,
    plano: "pro",
    creditos: 42,
    senhaHash: "HASH_NAO_DEVE_SAIR"
  },
  {
    id: "user_wolff",
    nome: "Wolff",
    email: "wolff@example.com",
    workspaceNome: "WOLFF",
    papel: "cliente",
    ativo: false,
    plano: "free",
    creditos: 0
  }
];

const configsPorCliente = {
  user_d1egopc: { workspaceNome: "D1EGOPC Config", tokenInterno: "NAO_SAIR" }
};

const integracoesPorCliente = {
  user_d1egopc: {
    amazon: {
      marketplace: "amazon",
      cookies: "COOKIE_SECRETO",
      accessToken: "TOKEN_SECRETO",
      saude: {
        status: "saudavel",
        codigo: "cookie_valido",
        atualizadoEm: "2026-08-24T12:00:00.000Z"
      }
    },
    mercadolivre: {
      credenciais: { secret: "ML_SECRET" },
      statusSaude: "invalida",
      codigoSaude: "cookie_expirado",
      atualizadoEm: "2026-08-24T11:00:00.000Z"
    }
  }
};

function rows(linhas) {
  return { ok: true, resultado: { rows: linhas } };
}

const queries = [];
async function queryFake(sql, params = []) {
  queries.push({ sql, params });
  if (sql.includes("observabilidade_v22_workspaces_atividade")) {
    return rows([
      {
        cliente_id: "user_d1egopc",
        ultima_atividade_em: "2026-08-24T12:10:00.000Z",
        eventos_recentes: 7,
        destinos_rejeitados: 0,
        destinos_selecionados: 2,
        enviados: 1,
        jobs_erro: 0,
        retidos: 0
      }
    ]);
  }
  if (sql.includes("observabilidade_v22_workspace_pipeline")) {
    assert.strictEqual(params[0], "user_d1egopc", "resumo deve respeitar clienteId");
    return rows([
      {
        ultima_captura_radar: "2026-08-24T12:05:00.000Z",
        eventos_recentes: 4,
        jobs_pendentes: 1,
        processando: 1,
        importando: 0,
        erro: 0,
        retidos: 0,
        lease_expirado: 0
      }
    ]);
  }
  if (sql.includes("observabilidade_v22_workspace_marketplaces")) {
    return rows([
      {
        marketplace: "mercadolivre",
        capturados: 3,
        importados: 2,
        aprovados: 1,
        rejeitados: 0,
        enviados: 1,
        ultimo_evento: "2026-08-24T12:08:00.000Z"
      }
    ]);
  }
  if (sql.includes("observabilidade_v22_workspace_destinos")) {
    return rows([
      {
        destino_id: "dest_op_geral",
        canal: "whatsapp",
        candidatos: 2,
        selecionados: 1,
        rejeitados: 1,
        enviados: 1,
        motivo_codigo: "categoria_nao_permitida",
        ultimo_evento: "2026-08-24T12:09:00.000Z"
      }
    ]);
  }
  if (sql.includes("observabilidade_v22_problemas")) {
    return rows([
      {
        motivo_codigo: "categoria_nao_permitida",
        marketplace: "mercadolivre",
        cliente_id: params.includes("user_d1egopc") ? "user_d1egopc" : "user_wolff",
        quantidade: 31,
        primeiro_ocorrido_em: "2026-08-24T11:30:00.000Z",
        ultimo_ocorrido_em: "2026-08-24T12:00:00.000Z"
      }
    ]);
  }
  if (sql.includes("observabilidade_v22_workspace_eventos")) {
    assert(sql.includes("LIMIT $"), "eventos deve ter LIMIT parametrizado");
    return rows([
      {
        eventoId: "191459",
        jobId: "88",
        ofertaId: "99",
        clienteId: "user_d1egopc",
        marketplace: "mercadolivre",
        tipoEvento: "destino_rejeitado",
        status: "rejeitado",
        motivoCodigo: "categoria_nao_permitida",
        destinoId: "dest_wolff",
        timestamp: "2026-08-24T12:04:00.000Z",
        metadata: {
          motivoCodigo: "categoria_nao_permitida",
          cookie: "COOKIE_NAO_SAIR",
          token: "TOKEN_NAO_SAIR",
          payloadBruto: "<html>nao</html>",
          destinoNomeSanitizado: "WOLFF"
        }
      },
      {
        eventoId: "191458",
        jobId: "87",
        ofertaId: "98",
        clienteId: "user_d1egopc",
        marketplace: "mercadolivre",
        tipoEvento: "destino_selecionado",
        status: "selecionado",
        motivoCodigo: "destino_liberado",
        destinoId: "dest_op",
        timestamp: "2026-08-24T12:03:00.000Z",
        metadata: { motivoCodigo: "destino_liberado" }
      }
    ]);
  }
  return rows([]);
}

function criarApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const papel = req.headers["x-papel"];
    if (papel) req.usuario = { id: papel === "admin_master" ? "admin" : "user_d1egopc", papel };
    next();
  });
  app.use("/admin/observabilidade", criarRotasObservabilidadeAdmin({
    query: queryFake,
    getUsuarios: () => usuarios,
    getConfigsPorCliente: () => configsPorCliente,
    getIntegracoesPorCliente: () => integracoesPorCliente,
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
          server.close(() => resolve({
            status: res.statusCode,
            body: body ? JSON.parse(body) : null
          }));
        });
      });
      req.end();
    });
  });
}

(async () => {
  const app = criarApp();

  const comum = await request(app, "GET", "/admin/observabilidade/workspaces", "cliente");
  assert.strictEqual(comum.status, 403, "usuario comum nao pode acessar observabilidade admin");

  const tokenAuditoria = await request(app, "GET", "/admin/observabilidade/workspaces", null);
  assert.strictEqual(tokenAuditoria.status, 403, "rota Admin nao aceita token temporario sem Admin Master");

  const porClienteId = await request(app, "GET", "/admin/observabilidade/workspaces?busca=user_d1egopc&limit=999");
  assert.strictEqual(porClienteId.status, 200);
  assert.strictEqual(porClienteId.body.limit, 100, "busca deve limitar consulta");
  assert.strictEqual(porClienteId.body.workspaces.length, 1);
  assert.strictEqual(porClienteId.body.workspaces[0].clienteId, "user_d1egopc");
  assert.strictEqual(porClienteId.body.workspaces[0].saudeOperacional.status, "saudavel");

  const porNome = await request(app, "GET", "/admin/observabilidade/workspaces?busca=Diego");
  assert.strictEqual(porNome.body.workspaces[0].nome, "Diego", "busca por nome deve funcionar");

  const porEmail = await request(app, "GET", "/admin/observabilidade/workspaces?busca=diego@example.com");
  assert.strictEqual(porEmail.body.workspaces[0].email, "diego@example.com", "busca por email deve funcionar");

  const inexistente = await request(app, "GET", "/admin/observabilidade/workspaces/user_inexistente/resumo");
  assert.strictEqual(inexistente.status, 404, "workspace inexistente deve falhar de forma controlada");

  const resumo = await request(app, "GET", "/admin/observabilidade/workspaces/user_d1egopc/resumo?janelaMinutos=999");
  assert.strictEqual(resumo.status, 200);
  assert.strictEqual(resumo.body.janelaMinutos, 60, "janela invalida volta ao default permitido");
  assert.strictEqual(resumo.body.identidade.clienteId, "user_d1egopc");
  assert.strictEqual(resumo.body.pipeline.jobsPendentes, 1, "contagem de pipeline deve vir agregada");
  assert.strictEqual(resumo.body.marketplaces[0].marketplace, "mercadolivre", "marketplace deve agregar");
  assert.strictEqual(resumo.body.destinos.rejeitados, 1, "decisoes por destino V2.1 devem aparecer");
  assert.strictEqual(resumo.body.problemas[0].motivoCodigo, "categoria_nao_permitida", "top motivoCodigo deve aparecer");
  assert.strictEqual(resumo.body.integracoes[0].marketplace, "amazon", "integracao sanitizada deve aparecer");

  const serializadoResumo = JSON.stringify(resumo.body);
  assert(!/COOKIE_SECRETO|TOKEN_SECRETO|ML_SECRET|HASH_NAO_DEVE_SAIR|tokenInterno/i.test(serializadoResumo), "resumo nao pode vazar segredo");

  const problemas = await request(app, "GET", "/admin/observabilidade/problemas?janelaMinutos=30&clienteId=user_d1egopc&marketplace=mercadolivre&motivoCodigo=categoria_nao_permitida");
  assert.strictEqual(problemas.status, 200);
  assert.strictEqual(problemas.body.janelaMinutos, 30);
  assert.strictEqual(problemas.body.problemas[0].quantidade, 31);

  const eventos = await request(app, "GET", "/admin/observabilidade/workspaces/user_d1egopc/eventos?limit=1&tipoEvento=destino_rejeitado");
  assert.strictEqual(eventos.status, 200);
  assert.strictEqual(eventos.body.items.length, 1, "eventos devem ser paginados por limit");
  assert(eventos.body.cursorProximo, "eventos devem retornar cursor quando ha mais registros");
  assert.strictEqual(eventos.body.items[0].motivoCodigo, "categoria_nao_permitida");
  const serializadoEventos = JSON.stringify(eventos.body);
  assert(!/COOKIE_NAO_SAIR|TOKEN_NAO_SAIR|payloadBruto|<html>/i.test(serializadoEventos), "eventos nao podem vazar payload bruto ou segredo");

  const originalRastrear = observabilidadeService.rastrearEventoObservabilidade;
  observabilidadeService.rastrearEventoObservabilidade = async eventoId => ({
    ok: true,
    readOnly: true,
    eventoId,
    observabilidadeV22: {
      decisoesDestino: [{ tipoEvento: "destino_selecionado", destinoId: "dest_op" }],
      destinoSelecionado: { tipoEvento: "destino_selecionado", destinoId: "dest_op" },
      rejeicoesDestino: [],
      executor: []
    }
  });
  const rastreio = await request(app, "GET", "/admin/observabilidade/rastrear/191459");
  observabilidadeService.rastrearEventoObservabilidade = originalRastrear;
  assert.strictEqual(rastreio.status, 200);
  assert.strictEqual(rastreio.body.observabilidadeV22.destinoSelecionado.destinoId, "dest_op");

  const fonteRotas = fs.readFileSync(path.join(raiz, "modules", "observabilidade", "admin.routes.js"), "utf8");
  assert(!/router\.(post|put|patch|delete)\(/i.test(fonteRotas), "V2.2 deve expor somente GET read-only");
  assert(fonteRotas.includes("isAdminMaster"), "rotas devem exigir Admin Master");

  const fonteService = fs.readFileSync(path.join(raiz, "modules", "observabilidade", "admin.service.js"), "utf8");
  assert(fonteService.includes("consultarRastreioTelemetria"), "rastreio deve reaproveitar Telemetria V1");
  assert(fonteService.includes("engine_eventos_comerciais"), "V2.2 deve usar eventos comerciais V2.1");
  assert(!/\b(INSERT\s+INTO|UPDATE\s+[a-z_]+|DELETE\s+FROM)\b/i.test(fonteService), "service V2.2 nao deve escrever no banco");
  assert(fonteService.includes("LIMIT"), "queries devem ter limites conservadores");
  assert(fonteService.includes("sanitizarIntegracao"), "integracoes devem passar por serializer sanitizado");

  console.log("observabilidade-v22-admin-backend.test.cjs OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
