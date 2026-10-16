"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const jwt = require("jsonwebtoken");
const { criarAdminMasterEstrito } = require("../utils/admin-auth-estrito");
const { criarRotasDiagnosticoCapturaEngine } =
  require("../modules/links/engine-capture-diagnostic.routes");

const index = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
assert.match(index, /app\.use\("\/admin\/links\/engine-eventos",\s*exigirAdminMasterEstrito,\s*criarRotasDiagnosticoCapturaEngine\(\)\)/);

const segredo = "segredo_sintetico_teste";
const usuarios = [
  { id: "admin", papel: "admin_master", ativo: true },
  { id: "user_a", papel: "cliente", ativo: true }
];
const auth = criarAdminMasterEstrito({
  jwt, getJwtSecret: () => segredo, getUsuarios: () => usuarios,
  usuarioEhAdminMaster: usuario => usuario.papel === "admin_master"
});
const consultas = [];
const eventos = new Map([
  ["11:user_a", { id: "11", origem: "radar", fonte: "radar", origem_tipo: "whatsapp",
    capturado_em: "2026-10-15T12:00:00Z", links: [] }],
  ["12:user_a", { id: "12", origem: "radar", fonte: "teleradar", origem_tipo: "telegram",
    links: [{ id: "21", redirect_ok: false, motivo_redirect: "promozone_redirect_bloqueado",
      motivo_tecnico: "REDIRECT_LIMIT", marketplace: "aliexpress", destino_resolvido: false,
      url_original: "https://secret.test/?token=PRIVATE", metadata: { segredo: "PRIVATE" } }] }],
  ["13:user_a", { id: "13", origem: "clonador_grupos", fonte: "clonador_grupos", origem_tipo: "whatsapp",
    links: [{ id: "22", redirect_ok: false, motivo_redirect: "https://secret.test/?token=PRIVATE",
      motivo_tecnico: "erro token=PRIVATE", marketplace: "shopee", destino_resolvido: false }] }],
  ["14:user_a", { id: "14", origem: "radar", fonte: "radar", origem_tipo: "whatsapp",
    links: [{ id: "23", redirect_ok: null, motivo_redirect: null, motivo_tecnico: null,
      marketplace: "magalu", destino_resolvido: false }] }],
  ["15:user_a", { id: "15", origem: "radar", fonte: "radar", origem_tipo: "whatsapp",
    links: [{ id: "24", redirect_ok: true, motivo_redirect: null, motivo_tecnico: "REDIRECT_LIMIT",
      marketplace: "amazon", destino_resolvido: true }] }],
  ["16:user_a", { id: "16", origem: "radar", fonte: "radar", origem_tipo: "whatsapp",
    links: [{ id: "25", redirect_ok: false, motivo_redirect: "redirect_falhou",
      motivo_tecnico: "http_status_403?token=PRIVATE", marketplace: "amazon", destino_resolvido: false }] }]
]);
eventos.set("17:user_a", { id: "17", origem: "radar", fonte: "radar", origem_tipo: "whatsapp",
  links: Array.from({ length: 65 }, (_, indice) => ({ id: indice + 30, redirect_ok: null })) });
const query = async (sql, params) => {
  consultas.push({ sql, params });
  assert.match(sql, /FROM engine_eventos_brutos e/);
  assert.match(sql, /WHERE e\.id = \$1/);
  assert.match(sql, /j\.evento_id = e\.id AND j\.cliente_id = \$2/);
  assert.match(sql, /FROM engine_links WHERE evento_id = e\.id ORDER BY id LIMIT 65/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|LOCK)\b/i);
  if (params[0] === "18") return { ok: false, motivo: "private database error" };
  const row = eventos.get(`${params[0]}:${params[1]}`);
  return { ok: true, resultado: { rows: row ? [row] : [] } };
};

async function run() {
  const app = express();
  app.use("/admin/links/engine-eventos", auth, criarRotasDiagnosticoCapturaEngine({ query }));
  const server = await new Promise(resolve => {
    const opened = app.listen(0, "127.0.0.1", () => resolve(opened));
  });
  const base = `http://127.0.0.1:${server.address().port}/admin/links/engine-eventos`;
  const admin = { authorization: `Bearer ${jwt.sign({ clienteId: "admin" }, segredo)}` };
  const cliente = { authorization: `Bearer ${jwt.sign({ clienteId: "user_a" }, segredo)}` };
  const get = async (id, workspace = "user_a", headers = admin) => {
    const response = await fetch(`${base}/${id}/diagnostico?clienteId=${workspace}`, { headers });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await get("12", "user_a", {})).status, 401);
    assert.equal((await get("12", "user_a", cliente)).status, 403);
    assert.equal(consultas.length, 0, "nao autorizado nao consulta o banco");
    assert.equal((await get("12", "user_b")).status, 404, "outro workspace nao ve o evento");
    assert.deepEqual((await get("999")).body, { ok: false, estado: "evento_inexistente" });
    assert.equal((await get("a".repeat(64))).status, 400, "eventId externo nao e ID da Engine");
    assert.equal((await get("12", "../user_a")).status, 400);
    assert.equal((await get("11")).body.estado, "sem_link_persistido");

    const telegram = (await get("12")).body;
    assert.equal(telegram.fonte, "teleradar");
    assert.equal(telegram.origemTipo, "telegram");
    assert.equal(telegram.estado, "com_diagnostico");
    assert.equal(telegram.links[0].motivoRedirectTecnico, "REDIRECT_LIMIT");
    assert.equal(telegram.links[0].motivoRedirect, "promozone_redirect_bloqueado");
    assert.equal(telegram.links[0].marketplace, "nao_comprovado");
    assert.equal(telegram.links[0].metodo, undefined);
    assert.equal(JSON.stringify(telegram).includes("PRIVATE"), false);
    assert.equal(JSON.stringify(telegram).includes("secret.test"), false);
    assert.equal(JSON.stringify(telegram).includes("metadata"), false);

    const clone = (await get("13")).body;
    assert.equal(clone.origem, "clonador_grupos");
    assert.equal(clone.links[0].motivoRedirectTecnico, "redirect_falha_nao_classificada");
    assert.equal(clone.links[0].motivoRedirect, "redirect_falha_nao_classificada");
    assert.equal(JSON.stringify(clone).includes("PRIVATE"), false);
    assert.equal((await get("14")).body.estado, "sem_diagnostico_tecnico");
    const resolvido = (await get("15")).body;
    assert.equal(resolvido.links[0].marketplace, "amazon");
    assert.equal(resolvido.links[0].motivoRedirectTecnico, null, "metadata antiga nao cria falha em link resolvido");
    assert.equal((await get("16")).body.links[0].motivoRedirectTecnico, "redirect_falha_nao_classificada");
    const truncado = (await get("17")).body;
    assert.equal(truncado.links.length, 64);
    assert.equal(truncado.linksTruncados, true);
    const indisponivel = await get("18");
    assert.equal(indisponivel.status, 503);
    assert.equal(JSON.stringify(indisponivel.body).includes("private database error"), false);
    assert.equal(consultas.length, 10, "uma consulta delimitada por evento autorizado");
    console.log("links-engine-capture-diagnostic-api.test.js OK");
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
