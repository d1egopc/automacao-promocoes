const assert = require("assert");
const express = require("express");
const http = require("http");
const {
  criarCaptureHandoffService,
  hashCodeChallenge
} = require("../modules/auth/capture-handoff.service");
const { criarRotasCaptureHandoff } = require("../modules/auth/capture-handoff.routes");

function verifier() {
  return "verifier_seguro_capture_" + "x".repeat(48);
}

function state() {
  return "state_capture_" + "s".repeat(32);
}

async function withServer(app, fn) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function post(base, path, body, token = "") {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body || {})
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function criarAppTeste(opcoes = {}) {
  const service = opcoes.service || criarCaptureHandoffService({ limpezaPeriodica: false });
  const usuarios = opcoes.usuarios || new Map([
    ["cliente_a", { id: "cliente_a", nome: "Cliente A", papel: "cliente", plano: "ultimate", ativo: true }],
    ["cliente_inativo", { id: "cliente_inativo", nome: "Inativo", papel: "cliente", plano: "free", ativo: false }]
  ]);
  const app = express();
  app.use(express.json());
  app.use("/auth/capture/handoff", criarRotasCaptureHandoff({
    service,
    auth(req, res, next) {
      if (req.headers.authorization !== "Bearer site_jwt") {
        return res.status(401).json({ ok: false, erro: "nao_autorizado" });
      }
      req.clienteId = opcoes.clienteIdAuth || "cliente_a";
      req.usuario = { id: req.clienteId };
      return next();
    },
    getUsuarioById: (clienteId) => usuarios.get(clienteId),
    emitirJwtOptimusUsuario: (usuario) => `jwt_emitido_para_${usuario.id}`
  }));
  return { app, service };
}

(async function main() {
  {
    const service = criarCaptureHandoffService({ limpezaPeriodica: false });
    const codeVerifier = verifier();
    const handoff = service.iniciarHandoff({ state: state(), codeChallenge: hashCodeChallenge(codeVerifier) });
    service.autorizarHandoff({ handoffId: handoff.handoffId, state: handoff.state, clienteId: "cliente_a" });
    const troca = service.validarTrocaHandoff({ handoffId: handoff.handoffId, state: handoff.state, codeVerifier });
    assert.strictEqual(troca.clienteId, "cliente_a");
    assert.strictEqual(service.consumirHandoff(handoff.handoffId), true);
    assert.throws(() => service.validarTrocaHandoff({ handoffId: handoff.handoffId, state: handoff.state, codeVerifier }), /capture_handoff_nao_encontrado|capture_handoff_ja_consumido/);
    service.pararLimpezaPeriodica();
  }

  {
    const service = criarCaptureHandoffService({ limpezaPeriodica: false });
    const codeVerifier = verifier();
    const handoff = service.iniciarHandoff({ state: state(), codeChallenge: hashCodeChallenge(codeVerifier) });
    service.autorizarHandoff({ handoffId: handoff.handoffId, state: handoff.state, clienteId: "cliente_a" });
    assert.throws(() => service.validarTrocaHandoff({ handoffId: handoff.handoffId, state: "state_errado_" + "x".repeat(32), codeVerifier }), /capture_handoff_state_invalido/);
    assert.throws(() => service.validarTrocaHandoff({ handoffId: handoff.handoffId, state: handoff.state, codeVerifier: "verifier_errado_" + "z".repeat(48) }), /capture_handoff_verifier_invalido/);
    service.pararLimpezaPeriodica();
  }

  {
    let agora = 1000;
    const service = criarCaptureHandoffService({ ttlMs: 100, now: () => agora, limpezaPeriodica: false });
    const handoff = service.iniciarHandoff({ state: state(), codeChallenge: hashCodeChallenge(verifier()) });
    agora += 101;
    assert.throws(() => service.autorizarHandoff({ handoffId: handoff.handoffId, state: handoff.state, clienteId: "cliente_a" }), /capture_handoff_expirado|capture_handoff_nao_encontrado/);
    service.pararLimpezaPeriodica();
  }

  await withServer(criarAppTeste().app, async (base) => {
    const codeVerifier = verifier();
    const iniciado = await post(base, "/auth/capture/handoff/iniciar", { state: state(), codeChallenge: hashCodeChallenge(codeVerifier) });
    assert.strictEqual(iniciado.status, 201);
    assert.ok(iniciado.json.handoffId);
    assert.ok(!JSON.stringify(iniciado.json).includes("jwt_"));

    const antesAutorizar = await post(base, "/auth/capture/handoff/trocar", {
      handoffId: iniciado.json.handoffId,
      state: iniciado.json.state,
      codeVerifier
    });
    assert.strictEqual(antesAutorizar.status, 409);

    const autorizado = await post(base, "/auth/capture/handoff/autorizar", {
      handoffId: iniciado.json.handoffId,
      state: iniciado.json.state,
      clienteId: "cliente_malicioso"
    }, "site_jwt");
    assert.strictEqual(autorizado.status, 200);
    assert.ok(!JSON.stringify(autorizado.json).includes("jwt_"));

    const troca = await post(base, "/auth/capture/handoff/trocar", {
      handoffId: iniciado.json.handoffId,
      state: iniciado.json.state,
      codeVerifier
    });
    assert.strictEqual(troca.status, 200);
    assert.strictEqual(troca.json.token, "jwt_emitido_para_cliente_a");
    assert.strictEqual(troca.json.usuario.id, "cliente_a");

    const segundaTroca = await post(base, "/auth/capture/handoff/trocar", {
      handoffId: iniciado.json.handoffId,
      state: iniciado.json.state,
      codeVerifier
    });
    assert.notStrictEqual(segundaTroca.status, 200);
  });

  await withServer(criarAppTeste({ clienteIdAuth: "cliente_inativo" }).app, async (base) => {
    const codeVerifier = verifier();
    const iniciado = await post(base, "/auth/capture/handoff/iniciar", { state: state(), codeChallenge: hashCodeChallenge(codeVerifier) });
    await post(base, "/auth/capture/handoff/autorizar", {
      handoffId: iniciado.json.handoffId,
      state: iniciado.json.state
    }, "site_jwt");
    const troca = await post(base, "/auth/capture/handoff/trocar", {
      handoffId: iniciado.json.handoffId,
      state: iniciado.json.state,
      codeVerifier
    });
    assert.strictEqual(troca.status, 403);
  });

  console.log("capture-handoff.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
