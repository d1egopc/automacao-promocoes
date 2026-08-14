"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const express = require("express");

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "telemetria-v1-"));
process.env.DATA_DIR = tempDataDir;

const queriesDb = [];
let throwDb = false;
const databasePath = path.join(__dirname, "..", "modules", "engine", "database.js");
require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: {
    queryEngine: async (sql, params = []) => {
      if (throwDb) {
        throw new Error("SELECT segredo FROM /data/credenciais.env WHERE secret='abc'");
      }
      queriesDb.push({ sql, params });
      if (/COUNT\(DISTINCT e\.id\)::int AS eventos_recentes/.test(sql)) {
        return {
          ok: true,
          resultado: { rows: [{ eventos_recentes: 2, ultima_captura_em: "2026-08-13T10:00:00.000Z" }] }
        };
      }
      if (/COUNT\(\*\)::int AS eventos_recentes/.test(sql)) {
        return {
          ok: true,
          resultado: { rows: [{ eventos_recentes: 99, ultima_captura_em: "2026-08-13T10:00:00.000Z" }] }
        };
      }
      if (/COUNT\(\*\) FILTER/.test(sql)) {
        return {
          ok: true,
          resultado: {
            rows: [{
              jobs_vivos: 1,
              circulaveis: 1,
              processando: 0,
              importando: 0,
              em_curso: 0,
              criados_janela: 1
            }]
          }
        };
      }
      return {
        ok: true,
        resultado: {
          rows: [
            {
              eventoId: "1",
              jobId: "10",
              ofertaId: "20",
              clienteId: "user_a",
              marketplace: "marketplace_dinamico",
              etapa: "job",
              status: "pendente",
              motivo: null,
              timestamp: "2026-08-13T10:00:00.000Z"
            }
          ]
        }
      };
    },
    engineDbHabilitado: () => true
  }
};

const liveFlowPath = path.join(__dirname, "..", "modules", "engine", "ofc", "live-flow.service.js");
require.cache[liveFlowPath] = {
  id: liveFlowPath,
  filename: liveFlowPath,
  loaded: true,
  exports: {
    criarFluxoVivoShadowOfc: async () => ({
      ok: true,
      totalJobsVivos: 99,
      totalCirculaveis: 88,
      totalEmCursoProtegidos: 7,
      saudeJobsEmCurso: { processandoTotal: 3, importandoTotal: 4 },
      tempoMedioRadarOfertaMs: 10,
      tempoMedioAtePrimeiraTentativaMs: 20,
      primeiraTentativa: { medianaMs: 15, p95Ms: 30 }
    })
  }
};

const commercialFlowPath = path.join(__dirname, "..", "modules", "engine", "ofc", "commercial-flow.service.js");
require.cache[commercialFlowPath] = {
  id: commercialFlowPath,
  filename: commercialFlowPath,
  loaded: true,
  exports: {
    criarFluxoComercialShadowOfc: async () => ({
      ok: true,
      segmentacao: {
        porMarketplace: [
          { marketplace: "marketplace_global", tipo_evento: "executor_enviado", total: 99 }
        ]
      }
    })
  }
};

const gatePath = path.join(__dirname, "..", "modules", "engine", "ofc", "absorption-gate.service.js");
require.cache[gatePath] = {
  id: gatePath,
  filename: gatePath,
  loaded: true,
  exports: {
    criarGateAbsorcaoShadowOfc: async () => ({
      ok: true,
      workspaces: [
        {
          workspaceId: "user_a",
          estado: "LIVRE",
          motivo: "capacidade_disponivel",
          filaAlvo15Min: 3,
          pressaoEsteiraViva: 1,
          capacidadeAbsorcaoAgora: 2,
          enviosUltimos15Min: 1,
          statusDesconhecido: 0,
          itensSemTimestamp: 0,
          vencidosOperacionalmente: 0,
          aguardandoAuditoria: 0,
          motivosForaPressaoViva: {},
          porMarketplace: { marketplace_dinamico: 1 }
        },
        {
          workspaceId: "user_b",
          estado: "SATURADA",
          motivo: "esteira_saturada",
          filaAlvo15Min: 3,
          pressaoEsteiraViva: 3,
          capacidadeAbsorcaoAgora: 0,
          enviosUltimos15Min: 9,
          statusDesconhecido: 0,
          itensSemTimestamp: 0,
          vencidosOperacionalmente: 0,
          aguardandoAuditoria: 0,
          motivosForaPressaoViva: {},
          porMarketplace: { marketplace_b: 3 }
        }
      ]
    })
  }
};

const service = require("../modules/telemetria/telemetria.service");
const { criarRotasTelemetria } = require("../modules/telemetria/telemetria.routes");

function criarReq(pathname, method = "GET", token = "") {
  return {
    path: pathname,
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    query: {}
  };
}

function criarAuthNormal(papel = "admin_master", clienteId = "admin") {
  return (req, res, next) => {
    const header = String(req.headers.authorization || "");
    if (header.includes("tel_")) {
      return res.status(401).json({ ok: false, erro: "nao_autorizado" });
    }
    req.usuario = { id: clienteId, papel, ativo: true };
    req.clienteId = clienteId;
    next();
  };
}

async function request(app, method, url, { token = "", body } = {}) {
  return new Promise(resolve => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const http = require("http");
      const dados = body ? Buffer.from(JSON.stringify(body)) : null;
      const req = http.request({
        hostname: "127.0.0.1",
        port,
        path: url,
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(dados ? { "Content-Type": "application/json", "Content-Length": dados.length } : {})
        }
      }, res => {
        let texto = "";
        res.on("data", chunk => { texto += chunk; });
        res.on("end", () => {
          server.close();
          resolve({ status: res.statusCode, body: texto ? JSON.parse(texto) : null });
        });
      });
      if (dados) req.write(dados);
      req.end();
    });
  });
}

(async () => {
  const auditoria = service.criarAuditoriaTemporaria({
    ttlMinutos: 15,
    escopo: "workspace",
    clienteId: "user_a",
    criadoPor: "admin"
  });
  assert.strictEqual(auditoria.ok, true);
  assert.ok(auditoria.codigo.startsWith("tel_"));

  const arquivo = path.join(tempDataDir, service.AUDITORIAS_ARQUIVO);
  const persistido = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  assert.strictEqual(persistido.length, 1);
  assert.strictEqual(persistido[0].clienteId, "user_a");
  assert.strictEqual(persistido[0].escopo, "workspace");
  assert.strictEqual(persistido[0].hash, service.hashSegredo(auditoria.codigo));
  assert.strictEqual(JSON.stringify(persistido).includes(auditoria.codigo), false);

  const authOk = service.autenticarTokenAuditoria(criarReq("/telemetria/saude", "GET", auditoria.codigo));
  assert.strictEqual(authOk.ok, true);
  assert.strictEqual(authOk.auditoria.clienteId, "user_a");

  const escritaBloqueada = service.autenticarTokenAuditoria(criarReq("/telemetria/auditoria/ativar", "POST", auditoria.codigo));
  assert.strictEqual(escritaBloqueada.ok, false);
  assert.strictEqual(escritaBloqueada.motivo, "rota_nao_permitida");

  const consultaAdminBloqueada = service.autenticarTokenAuditoria(criarReq("/telemetria/auditorias", "GET", auditoria.codigo));
  assert.strictEqual(consultaAdminBloqueada.ok, false);
  assert.strictEqual(consultaAdminBloqueada.motivo, "rota_nao_permitida");

  const revogada = service.revogarAuditoriaTemporaria({ auditoriaId: auditoria.auditoriaId });
  assert.strictEqual(revogada.ok, true);
  const authRevogada = service.autenticarTokenAuditoria(criarReq("/telemetria/saude", "GET", auditoria.codigo));
  assert.strictEqual(authRevogada.ok, false);
  assert.strictEqual(authRevogada.motivo, "token_revogado");

  const expirada = service.criarAuditoriaTemporaria({ ttlMinutos: 15, escopo: "plataforma", criadoPor: "admin" });
  const lista = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  const item = lista.find(x => x.auditoriaId === expirada.auditoriaId);
  item.expiraEm = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(arquivo, JSON.stringify(lista, null, 2));
  const authExpirada = service.autenticarTokenAuditoria(criarReq("/telemetria/saude", "GET", expirada.codigo));
  assert.strictEqual(authExpirada.ok, false);
  assert.strictEqual(authExpirada.motivo, "token_expirado");

  const saneado = service.sanitizarValor({
    tokenMeta: "segredo",
    nested: { senha: "abc", ok: true },
    payload: { grande: true },
    normal: "valor"
  });
  assert.strictEqual(saneado.tokenMeta, "***");
  assert.strictEqual(saneado.nested.senha, "***");
  assert.strictEqual(saneado.payload, "***");
  assert.strictEqual(saneado.normal, "valor");

  const links = service.sanitizarLinks([
    "https://shopee.com.br/m/cupom-de-desconto?a=1&token=segredo",
    {
      url: "https://user:pass@exemplo.com/p?q=1&token=x#frag",
      destinoFuncional: "/p?q=1&token=x#frag"
    }
  ]);
  assert.strictEqual(links[0].dominio, "shopee.com.br");
  assert.strictEqual(links[0].urlSanitizada, "https://shopee.com.br/m/cupom-de-desconto");
  assert.strictEqual(links[1].urlSanitizada, "https://exemplo.com/p");
  assert.strictEqual(links[1].destinoFuncional, "/p");
  assert.strictEqual(JSON.stringify(links).includes("token=x"), false);

  queriesDb.length = 0;
  const eventosWorkspace = await service.consultarEventosTelemetria({
    clienteId: "user_b",
    marketplace: "marketplace_dinamico",
    limit: 1,
    escopo: { tipo: "workspace", clienteId: "user_a" }
  });
  assert.strictEqual(eventosWorkspace.ok, true);
  assert.strictEqual(eventosWorkspace.items[0].clienteId, "user_a");
  assert(queriesDb[0].params.includes("user_a"), "escopo workspace deve forcar clienteId autorizado");
  assert(!queriesDb[0].params.includes("user_b"), "query nao pode escapar para clienteId solicitado");

  const saudeWorkspace = await service.consultarSaudeTelemetria({
    janelaMinutos: 15,
    escopo: { tipo: "workspace", clienteId: "user_a" }
  });
  assert.strictEqual(saudeWorkspace.radar.eventosRecentes, 2);
  assert.notStrictEqual(saudeWorkspace.radar.eventosRecentes, 99);
  assert.deepStrictEqual(saudeWorkspace.workspaces.map(item => item.clienteId), ["user_a"]);
  assert.deepStrictEqual(saudeWorkspace.marketplaces, [{ marketplace: "marketplace_dinamico", total: 1 }]);

  const saudePlataforma = await service.consultarSaudeTelemetria({
    janelaMinutos: 15,
    escopo: { tipo: "plataforma" }
  });
  assert.strictEqual(saudePlataforma.radar.eventosRecentes, 99);

  const app = express();
  app.use(express.json());
  app.use("/telemetria", criarRotasTelemetria({
    authNormal: criarAuthNormal("admin_master", "admin"),
    isAdminMaster: req => req.usuario?.papel === "admin_master"
  }));
  app.use(criarAuthNormal("admin_master", "admin"));
  app.get("/me", (req, res) => res.json({ ok: true }));
  app.get("/fila", (req, res) => res.json({ ok: true }));
  app.post("/engine/processar-pendentes", (req, res) => res.json({ ok: true }));

  const novo = await request(app, "POST", "/telemetria/auditoria/ativar", {
    body: { ttlMinutos: 30, escopo: "workspace", clienteId: "user_b" }
  });
  assert.strictEqual(novo.status, 201);
  assert.strictEqual(novo.body.ok, true);
  assert.ok(novo.body.codigo);

  const adminList = await request(app, "GET", "/telemetria/auditorias");
  assert.strictEqual(adminList.status, 200);
  assert.strictEqual(adminList.body.ok, true);
  assert.strictEqual(JSON.stringify(adminList.body).includes(novo.body.codigo), false);

  const tokenAdmin = await request(app, "GET", "/telemetria/auditorias", { token: novo.body.codigo });
  assert.strictEqual(tokenAdmin.status, 403);

  const foraMe = await request(app, "GET", "/me", { token: novo.body.codigo });
  assert.strictEqual(foraMe.status, 401);
  const foraFila = await request(app, "GET", "/fila", { token: novo.body.codigo });
  assert.strictEqual(foraFila.status, 401);
  const foraPost = await request(app, "POST", "/engine/processar-pendentes", { token: novo.body.codigo, body: { limite: 1 } });
  assert.strictEqual(foraPost.status, 401);

  throwDb = true;
  const erroHostil = await request(app, "GET", "/telemetria/eventos", { token: novo.body.codigo });
  throwDb = false;
  assert.strictEqual(erroHostil.status, 500);
  assert.strictEqual(erroHostil.body.erro, "telemetria_indisponivel");
  assert.strictEqual(JSON.stringify(erroHostil.body).includes("SELECT segredo"), false);
  assert.strictEqual(JSON.stringify(erroHostil.body).includes("/data/credenciais.env"), false);

  const fonteRotas = fs.readFileSync(path.join(__dirname, "..", "modules", "telemetria", "telemetria.routes.js"), "utf8");
  assert(!/router\.(put|patch|delete)\(/i.test(fonteRotas), "telemetria nao deve expor PUT/PATCH/DELETE");
  assert(fonteRotas.includes('router.post("/auditoria/ativar"'), "ativacao administrativa deve existir");
  assert(fonteRotas.includes('router.post("/auditoria/revogar"'), "revogacao administrativa deve existir");

  const fonteService = fs.readFileSync(path.join(__dirname, "..", "modules", "telemetria", "telemetria.service.js"), "utf8");
  assert(fonteService.includes("criarFluxoVivoShadowOfc"), "saude deve reaproveitar fluxo vivo existente");
  assert(fonteService.includes("criarGateAbsorcaoShadowOfc"), "saude deve reaproveitar gate existente");
  assert(fonteService.includes("engine_eventos_comerciais"), "eventos comerciais reais devem ser fonte");
  assert(!/D1|Wolf|Roger|Mercado Livre|Shopee|Amazon|AliExpress|AWIN/.test(fonteService), "telemetria nao deve hardcodar workspace/marketplace");

  console.log("telemetria-v1-backend.test.js OK");
})().catch(e => {
  console.error(e);
  process.exit(1);
});
