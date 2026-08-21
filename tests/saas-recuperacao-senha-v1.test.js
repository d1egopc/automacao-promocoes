"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const raiz = path.resolve(__dirname, "..");
const indexFonte = fs.readFileSync(path.join(raiz, "index.js"), "utf8");

function assertSemSegredo(payload, contexto) {
  const texto = JSON.stringify(payload || {});
  assert.ok(!/senhaHash|passwordHash|tokenHash|senha"\s*:|password"\s*:|pass"\s*:/i.test(texto), `${contexto} nao deve expor senha/hash`);
}

function request({ method = "GET", port, path: urlPath, body, token }) {
  return new Promise((resolve, reject) => {
    const dados = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: urlPath,
      method,
      headers: {
        ...(token ? { Authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}` } : {}),
        ...(dados ? { "Content-Type": "application/json", "Content-Length": dados.length } : {})
      }
    }, res => {
      let texto = "";
      res.on("data", chunk => { texto += chunk; });
      res.on("end", () => {
        let json = null;
        try { json = texto ? JSON.parse(texto) : null; } catch { json = { raw: texto }; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on("error", reject);
    if (dados) req.write(dados);
    req.end();
  });
}

async function esperarServidor(port, proc) {
  const limite = Date.now() + 20000;
  while (Date.now() < limite) {
    if (proc.exitCode !== null) {
      throw new Error(`servidor encerrou antes de subir: ${proc.exitCode}`);
    }
    try {
      const res = await request({ port, path: "/" });
      if (res.status === 200) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("timeout aguardando servidor");
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, valor) {
  fs.writeFileSync(file, JSON.stringify(valor, null, 2));
}

function usuarioPorEmail(dataDir, email) {
  return readJson(path.join(dataDir, "usuarios.json"), [])
    .find(u => String(u.email || "").toLowerCase() === String(email || "").toLowerCase());
}

function trechoEntre(inicio, fim) {
  const ini = indexFonte.indexOf(inicio);
  assert.ok(ini >= 0, `trecho inicial nao encontrado: ${inicio}`);
  const end = indexFonte.indexOf(fim, ini + inicio.length);
  assert.ok(end > ini, `trecho final nao encontrado: ${fim}`);
  return indexFonte.slice(ini, end);
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-senha-reset-v1-"));
  const port = 3061 + Math.floor(Math.random() * 200);
  const jwtSecret = "segredo_reset_v1";
  const email = "reset@teste.local";
  const senhaAntiga = "SenhaAntiga123";
  const senhaNova = "SenhaNova123";
  const senhaHash = await bcrypt.hash(senhaAntiga, 4);

  writeJson(path.join(dataDir, "usuarios.json"), [
    {
      id: "admin",
      nome: "Admin",
      email: "admin@teste.local",
      senhaHash: await bcrypt.hash("AdminSenha123", 4),
      papel: "admin_master",
      plano: "master",
      ativo: true
    },
    {
      id: "user_reset",
      nome: "Reset",
      email,
      senhaHash,
      papel: "cliente",
      plano: "pro",
      ativo: true,
      creditos: 10
    },
    {
      id: "user_inativo",
      nome: "Inativo",
      email: "inativo@teste.local",
      senhaHash,
      papel: "cliente",
      ativo: false
    }
  ]);
  writeJson(path.join(dataDir, "planos.json"), {
    pro: { nome: "pro", limites: { creditos: 100 }, recursos: {}, marketplaces: [] }
  });

  const proc = spawn(process.execPath, ["index.js"], {
    cwd: raiz,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: String(port),
      JWT_SECRET: jwtSecret,
      PERF_DIAGNOSTICO: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", chunk => { stdout += chunk.toString(); });
  proc.stderr.on("data", chunk => { stderr += chunk.toString(); });

  try {
    await esperarServidor(port, proc);

    const existente = await request({
      method: "POST",
      port,
      path: "/senha/recuperar",
      body: { email: " RESET@TESTE.LOCAL " }
    });
    const inexistente = await request({
      method: "POST",
      port,
      path: "/senha/recuperar",
      body: { email: "ninguem@teste.local" }
    });
    assert.strictEqual(existente.status, 200);
    assert.strictEqual(inexistente.status, 200);
    assert.deepStrictEqual(existente.body, inexistente.body, "resposta deve ser indistinguivel");
    assertSemSegredo(existente.body, "recuperar existente");

    let usuario = usuarioPorEmail(dataDir, email);
    assert.ok(usuario.senhaReset?.tokenHash, "token deve ser persistido apenas como hash");
    assert.ok(!JSON.stringify(usuario).includes("SenhaNova123"), "senha nova nao pode aparecer antes da redefinicao");

    const adminToken = jwt.sign({ clienteId: "admin", papel: "admin_master" }, jwtSecret, { expiresIn: "5m" });
    const clienteToken = jwt.sign({ clienteId: "user_reset", papel: "cliente" }, jwtSecret, { expiresIn: "5m" });

    const adminSemToken = await request({
      method: "POST",
      port,
      path: "/admin/senha/recuperacao-teste",
      body: { email }
    });
    assert.strictEqual(adminSemToken.status, 401, "admin teste sem token deve ser 401");

    const adminCliente = await request({
      method: "POST",
      port,
      path: "/admin/senha/recuperacao-teste",
      token: clienteToken,
      body: { email }
    });
    assert.strictEqual(adminCliente.status, 403, "cliente comum na rota admin deve ser 403");

    const adminReset = await request({
      method: "POST",
      port,
      path: "/admin/senha/recuperacao-teste",
      token: adminToken,
      body: { email }
    });
    assert.strictEqual(adminReset.status, 200);
    assert.ok(adminReset.body.tokenTeste, "admin teste deve obter token efemero");
    assert.ok(adminReset.body.expiraEm, "admin teste deve retornar expiracao");
    assert.ok(!adminReset.body.recuperacao.tokenHash, "admin teste nao deve expor hash persistido");

    const getAdminUsuarios = await request({
      method: "GET",
      port,
      path: "/admin/usuarios",
      token: adminToken
    });
    assert.strictEqual(getAdminUsuarios.status, 200);
    assertSemSegredo(getAdminUsuarios.body, "GET /admin/usuarios");
    const usuarioAdmin = getAdminUsuarios.body.usuarios.find(u => u.id === "user_reset");
    assert.ok(usuarioAdmin.senhaReset, "Admin pode ver status da recuperacao");
    assert.ok(usuarioAdmin.senhaReset.expiraEm, "Admin preserva expiracao da recuperacao");
    assert.strictEqual(usuarioAdmin.senhaReset.tokenHash, undefined, "Admin nao pode ver tokenHash aninhado");

    const senhaCurta = await request({
      method: "POST",
      port,
      path: "/senha/redefinir",
      body: { token: adminReset.body.tokenTeste, novaSenha: "123" }
    });
    assert.strictEqual(senhaCurta.status, 400);
    assert.strictEqual(senhaCurta.body.codigo, "senha_minima");

    const loginAntigoAntes = await request({
      method: "POST",
      port,
      path: "/login",
      body: { user: email, pass: senhaAntiga }
    });
    assert.strictEqual(loginAntigoAntes.status, 200, "senha antiga deve funcionar antes da redefinicao concluida");

    const redefinir = await request({
      method: "POST",
      port,
      path: "/senha/redefinir",
      body: { token: adminReset.body.tokenTeste, novaSenha: senhaNova }
    });
    assert.strictEqual(redefinir.status, 200);
    assertSemSegredo(redefinir.body, "redefinir sucesso");

    usuario = usuarioPorEmail(dataDir, email);
    assert.ok(usuario.senhaHash, "senhaHash deve existir");
    assert.ok(await bcrypt.compare(senhaNova, usuario.senhaHash), "nova senha deve bater com hash");
    assert.ok(!usuario.senha, "plaintext legado nao pode permanecer");
    assert.strictEqual(usuario.senhaReset.tokenHash, "", "token hash deve ser invalidado no sucesso");
    assert.ok(usuario.senhaReset.usadoEm, "token deve marcar uso");

    const reutilizado = await request({
      method: "POST",
      port,
      path: "/senha/redefinir",
      body: { token: adminReset.body.tokenTeste, novaSenha: "OutraSenha123" }
    });
    assert.strictEqual(reutilizado.status, 400, "token reutilizado deve falhar");

    const loginAntigo = await request({
      method: "POST",
      port,
      path: "/login",
      body: { user: email, pass: senhaAntiga }
    });
    assert.strictEqual(loginAntigo.status, 401, "senha antiga deve parar de funcionar");

    const loginNovo = await request({
      method: "POST",
      port,
      path: "/login",
      body: { user: email, pass: senhaNova }
    });
    assert.strictEqual(loginNovo.status, 200, "nova senha deve funcionar");
    assertSemSegredo(loginNovo.body, "login nova senha");

    const expiradoReq = await request({
      method: "POST",
      port,
      path: "/admin/senha/recuperacao-teste",
      token: adminToken,
      body: { email, expiraEmTeste: "2026-01-01T00:00:00.000Z" }
    });
    assert.strictEqual(expiradoReq.status, 200);

    const expirado = await request({
      method: "POST",
      port,
      path: "/senha/redefinir",
      body: { token: expiradoReq.body.tokenTeste, novaSenha: "Expirada123" }
    });
    assert.strictEqual(expirado.status, 400);
    assert.strictEqual(expirado.body.codigo, "token_expirado");

    const inativoPublico = await request({
      method: "POST",
      port,
      path: "/senha/recuperar",
      body: { email: "inativo@teste.local" }
    });
    assert.deepStrictEqual(inativoPublico.body, existente.body, "usuario inativo tambem deve ter resposta neutra");
    const inativo = usuarioPorEmail(dataDir, "inativo@teste.local");
    assert.ok(!inativo.senhaReset, "usuario inativo nao deve receber token");

    const putAdmin = await request({
      method: "PUT",
      port,
      path: "/admin/usuarios/user_reset",
      token: adminToken,
      body: { ativo: true }
    });
    assert.strictEqual(putAdmin.status, 200);
    assertSemSegredo(putAdmin.body, "PUT /admin/usuarios/:id");
    assert.strictEqual(putAdmin.body.usuario.senhaReset?.tokenHash, undefined, "PUT Admin nao pode retornar tokenHash aninhado");

    const postAdmin = await request({
      method: "POST",
      port,
      path: "/admin/usuarios",
      token: adminToken,
      body: {
        nome: "Admin Criado",
        email: "admin-criado@teste.local",
        senha: "SenhaAdmin123",
        plano: "pro"
      }
    });
    assert.strictEqual(postAdmin.status, 200);
    assertSemSegredo(postAdmin.body, "POST /admin/usuarios");

    assert.ok(!stdout.includes(adminReset.body.tokenTeste), "token nao pode ser logado em stdout");
    assert.ok(!stderr.includes(adminReset.body.tokenTeste), "token nao pode ser logado em stderr");
    assert.ok(!stdout.includes(senhaNova), "senha nao pode ser logada em stdout");
    assert.ok(!stderr.includes(senhaNova), "senha nao pode ser logada em stderr");

    const blocoAuth = trechoEntre("function auth(req, res, next)", "const authHeader = req.headers.authorization");
    assert.ok(blocoAuth.includes('req.path === "/senha/recuperar"'), "recuperar deve ser rota publica controlada");
    assert.ok(blocoAuth.includes('req.path === "/senha/redefinir"'), "redefinir deve ser rota publica controlada");
    const blocoAdmin = trechoEntre('app.post("/admin/senha/recuperacao-teste"', 'app.post("/login"');
    assert.ok(blocoAdmin.includes("exigirAdminMasterEstrito"), "token de teste deve exigir Admin Master estrito");

    console.log("saas-recuperacao-senha-v1.test.js OK");
  } finally {
    proc.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
