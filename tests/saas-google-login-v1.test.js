"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const raiz = path.resolve(__dirname, "..");
const indexFonte = fs.readFileSync(path.join(raiz, "index.js"), "utf8");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, valor) {
  fs.writeFileSync(file, JSON.stringify(valor, null, 2));
}

function assertSemSegredo(payload, contexto) {
  const texto = JSON.stringify(payload || {});
  assert.ok(!/google.*token|idToken|credential|senhaHash|passwordHash|tokenHash|accessToken|refreshToken|\"senha\"\s*:|\"password\"\s*:/i.test(texto), `${contexto} nao deve expor segredo`);
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

function tokenGoogle({ privateKey, kid, clientId, sub, email, emailVerified = true, aud = clientId, expiresIn = "5m" }) {
  return jwt.sign(
    {
      sub,
      email,
      email_verified: emailVerified,
      name: "Google Teste"
    },
    privateKey,
    {
      algorithm: "RS256",
      keyid: kid,
      issuer: "https://accounts.google.com",
      audience: aud,
      expiresIn
    }
  );
}

function usuarioPorId(dataDir, id) {
  return readJson(path.join(dataDir, "usuarios.json"), []).find(u => u.id === id);
}

function trechoEntre(inicio, fim) {
  const ini = indexFonte.indexOf(inicio);
  assert.ok(ini >= 0, `trecho inicial nao encontrado: ${inicio}`);
  const end = indexFonte.indexOf(fim, ini + inicio.length);
  assert.ok(end > ini, `trecho final nao encontrado: ${fim}`);
  return indexFonte.slice(ini, end);
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-google-login-v1-"));
  const port = 3081 + Math.floor(Math.random() * 200);
  const jwtSecret = "segredo_google_login_v1";
  const clientId = "google-client-teste.apps.googleusercontent.com";
  const kid = "kid-google-v1";
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = kid;
  jwk.alg = "RS256";
  jwk.use = "sig";

  const senhaOriginal = "SenhaGoogle123";
  const senhaHash = await bcrypt.hash(senhaOriginal, 4);
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
      id: "user_existente",
      nome: "Existente",
      email: "cliente@teste.local",
      senhaHash,
      papel: "cliente",
      plano: "pro",
      creditos: 432,
      assinaturaStatus: "ativa",
      ativo: true
    },
    {
      id: "user_conflito",
      nome: "Conflito",
      email: "conflito@teste.local",
      googleSub: "sub_conflito",
      papel: "cliente",
      plano: "pro",
      ativo: true
    },
    {
      id: "user_inativo",
      nome: "Inativo",
      email: "inativo@teste.local",
      papel: "cliente",
      plano: "pro",
      ativo: false
    }
  ]);
  writeJson(path.join(dataDir, "planos.json"), {
    pro: { nome: "pro", limites: { creditos: 100 }, recursos: {}, marketplaces: [] },
    beta: {
      id: "plano_beta_google",
      nome: "Beta Google",
      visivelPublicamente: true,
      contratavel: true,
      emBreve: false,
      creditosModelo: "unicos",
      limites: { creditosUnicos: 321, maxConexoes: 2, destinos: 3 },
      recursos: { whatsapp: true, telegram: true, discord: false },
      marketplaces: ["amazon", "shopee"]
    },
    futuro: {
      id: "plano_futuro_google",
      nome: "Futuro Google",
      visivelPublicamente: true,
      contratavel: false,
      emBreve: true,
      creditosModelo: "unicos",
      limites: { creditosUnicos: 111 },
      recursos: {},
      marketplaces: []
    },
    restrito: {
      id: "plano_restrito_google",
      nome: "Restrito Google",
      visivelPublicamente: true,
      contratavel: false,
      emBreve: false,
      creditosModelo: "unicos",
      limites: { creditosUnicos: 222 },
      recursos: {},
      marketplaces: []
    }
  });
  writeJson(path.join(dataDir, "configs_clientes.json"), {
    user_existente: { workspace: "preservado", nested: { valor: 1 } }
  });

  const proc = spawn(process.execPath, ["index.js"], {
    cwd: raiz,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: String(port),
      JWT_SECRET: jwtSecret,
      PERF_DIAGNOSTICO: "0",
      GOOGLE_CLIENT_ID: clientId,
      GOOGLE_JWKS_JSON: JSON.stringify({ keys: [jwk] })
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", chunk => { stdout += chunk.toString(); });
  proc.stderr.on("data", chunk => { stderr += chunk.toString(); });

  try {
    await esperarServidor(port, proc);

    const antesUsuarios = readJson(path.join(dataDir, "usuarios.json"), []);
    const workspaceAntes = JSON.stringify(readJson(path.join(dataDir, "configs_clientes.json"), {}).user_existente);

    const idToken = tokenGoogle({
      privateKey,
      kid,
      clientId,
      sub: "sub_cliente",
      email: "cliente@teste.local"
    });

    const googleLogin = await request({
      method: "POST",
      port,
      path: "/auth/google",
      body: { idToken }
    });
    assert.strictEqual(googleLogin.status, 200, JSON.stringify(googleLogin.body));
    assert.ok(googleLogin.body.token, "login Google deve emitir JWT Optimus");
    assert.strictEqual(googleLogin.body.usuario.id, "user_existente");
    assertSemSegredo(googleLogin.body, "login Google");

    let usuarios = readJson(path.join(dataDir, "usuarios.json"), []);
    assert.strictEqual(usuarios.length, antesUsuarios.length, "login Google nao pode duplicar usuario");
    let usuario = usuarioPorId(dataDir, "user_existente");
    assert.strictEqual(usuario.googleSub, "sub_cliente", "deve vincular googleSub");
    assert.strictEqual(usuario.provedoresAuth.google.sub, "sub_cliente");
    assert.strictEqual(usuario.creditos, 432, "creditos preservados");
    assert.strictEqual(usuario.assinaturaStatus, "ativa", "assinatura preservada");
    assert.strictEqual(
      JSON.stringify(readJson(path.join(dataDir, "configs_clientes.json"), {}).user_existente),
      workspaceAntes,
      "workspace/config deve ser preservado"
    );

    const me = await request({
      method: "GET",
      port,
      path: "/me",
      token: googleLogin.body.token
    });
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.body.usuario.id, "user_existente");
    assertSemSegredo(me.body, "/me Google");

    const loginSenha = await request({
      method: "POST",
      port,
      path: "/login",
      body: { user: "cliente@teste.local", pass: senhaOriginal }
    });
    assert.strictEqual(loginSenha.status, 200, "senha deve continuar funcionando apos vincular Google");

    const googleLoginMudouEmail = await request({
      method: "POST",
      port,
      path: "/auth/google",
      body: {
        idToken: tokenGoogle({
          privateKey,
          kid,
          clientId,
          sub: "sub_cliente",
          email: "cliente-novo@google.local"
        })
      }
    });
    assert.strictEqual(googleLoginMudouEmail.status, 200, "sub ja vinculado deve continuar sendo autoridade estavel");
    usuario = usuarioPorId(dataDir, "user_existente");
    assert.strictEqual(usuario.email, "cliente@teste.local", "email principal Optimus nao deve mudar automaticamente");
    assert.strictEqual(usuario.googleEmail, "cliente-novo@google.local", "email Google observado pode ser atualizado");

    const conflitoSub = await request({
      method: "POST",
      port,
      path: "/auth/google",
      body: {
        idToken: tokenGoogle({
          privateKey,
          kid,
          clientId,
          sub: "sub_conflito",
          email: "cliente@teste.local"
        })
      }
    });
    assert.strictEqual(conflitoSub.status, 409);
    assert.strictEqual(conflitoSub.body.codigo, "google_sub_conflitante");

    const subDivergente = await request({
      method: "POST",
      port,
      path: "/auth/google",
      body: {
        idToken: tokenGoogle({
          privateKey,
          kid,
          clientId,
          sub: "sub_outro",
          email: "cliente@teste.local"
        })
      }
    });
    assert.strictEqual(subDivergente.status, 409);
    assert.strictEqual(subDivergente.body.codigo, "google_sub_divergente");

    const naoVerificado = await request({
      method: "POST",
      port,
      path: "/auth/google",
      body: {
        idToken: tokenGoogle({
          privateKey,
          kid,
          clientId,
          sub: "sub_nao_verificado",
          email: "naoverificado@teste.local",
          emailVerified: false
        })
      }
    });
    assert.strictEqual(naoVerificado.status, 403);
    assert.strictEqual(naoVerificado.body.codigo, "google_email_nao_verificado");

    const inativo = await request({
      method: "POST",
      port,
      path: "/auth/google",
      body: {
        idToken: tokenGoogle({
          privateKey,
          kid,
          clientId,
          sub: "sub_inativo",
          email: "inativo@teste.local"
        })
      }
    });
    assert.strictEqual(inativo.status, 403);
    assert.strictEqual(inativo.body.codigo, "usuario_inativo");

    const invalido = await request({
      method: "POST",
      port,
      path: "/auth/google",
      body: { idToken: "token-invalido" }
    });
    assert.strictEqual(invalido.status, 401);

    const audErrada = await request({
      method: "POST",
      port,
      path: "/auth/google",
      body: {
        idToken: tokenGoogle({
          privateKey,
          kid,
          clientId,
          sub: "sub_aud",
          email: "aud@teste.local",
          aud: "outro-client-id"
        })
      }
    });
    assert.strictEqual(audErrada.status, 401);
    assert.strictEqual(audErrada.body.codigo, "google_audience_invalida");

    const expirado = await request({
      method: "POST",
      port,
      path: "/auth/google",
      body: {
        idToken: tokenGoogle({
          privateKey,
          kid,
          clientId,
          sub: "sub_exp",
          email: "exp@teste.local",
          expiresIn: -10
        })
      }
    });
    assert.strictEqual(expirado.status, 401);
    assert.strictEqual(expirado.body.codigo, "google_token_expirado");

    const novoGoogle = await request({
      method: "POST",
      port,
      path: "/auth/google",
      body: {
        idToken: tokenGoogle({
          privateKey,
          kid,
          clientId,
          sub: "sub_novo",
          email: "novo@teste.local"
        })
      }
    });
    assert.strictEqual(novoGoogle.status, 403);
    assert.strictEqual(novoGoogle.body.codigo, "cadastro_publico_desativado");
    usuarios = readJson(path.join(dataDir, "usuarios.json"), []);
    assert.strictEqual(usuarios.length, antesUsuarios.length, "Google novo nao pode criar conta com cadastro publico OFF");

    const adminToken = jwt.sign({ clienteId: "admin", papel: "admin_master" }, jwtSecret, { expiresIn: "5m" });

    const adminCriaSemOverride = await request({
      method: "POST",
      port,
      path: "/admin/usuarios",
      token: adminToken,
      body: {
        nome: "Admin Free Sem Override",
        email: "admin-free-sem-override@teste.local",
        senha: "AdminFree123",
        plano: "plano_beta_google"
      }
    });
    assert.strictEqual(adminCriaSemOverride.status, 200, JSON.stringify(adminCriaSemOverride.body));
    assert.strictEqual(adminCriaSemOverride.body.usuario.creditos, 321, "Admin sem override deve herdar creditos do plano");
    assert.strictEqual(adminCriaSemOverride.body.usuario.creditosModelo, "unicos");
    const usuarioAdminSemOverride = readJson(path.join(dataDir, "usuarios.json"), []).find(u => u.email === "admin-free-sem-override@teste.local");
    assert.ok(usuarioAdminSemOverride, "Admin manual deve criar usuario");
    assert.ok(readJson(path.join(dataDir, "configs_clientes.json"), {})[usuarioAdminSemOverride.id], "Admin manual deve criar workspace");

    const adminCriaOverride500 = await request({
      method: "POST",
      port,
      path: "/admin/usuarios",
      token: adminToken,
      body: {
        nome: "Admin Free Override",
        email: "admin-free-override@teste.local",
        senha: "AdminFree123",
        plano: "plano_beta_google",
        creditosOverrideManual: true,
        creditos: 500
      }
    });
    assert.strictEqual(adminCriaOverride500.status, 200, JSON.stringify(adminCriaOverride500.body));
    assert.strictEqual(adminCriaOverride500.body.usuario.creditos, 500, "Admin com override explicito deve respeitar valor informado");

    const adminCriaOverrideZero = await request({
      method: "POST",
      port,
      path: "/admin/usuarios",
      token: adminToken,
      body: {
        nome: "Admin Free Zero",
        email: "admin-free-zero@teste.local",
        senha: "AdminFree123",
        plano: "plano_beta_google",
        creditos: 0
      }
    });
    assert.strictEqual(adminCriaOverrideZero.status, 200, JSON.stringify(adminCriaOverrideZero.body));
    assert.strictEqual(adminCriaOverrideZero.body.usuario.creditos, 0, "Admin deve preservar override explicito zero");

    const adminDuplicado = await request({
      method: "POST",
      port,
      path: "/admin/usuarios",
      token: adminToken,
      body: {
        nome: "Admin Duplicado",
        email: "admin-free-zero@teste.local",
        senha: "AdminFree123",
        plano: "plano_beta_google"
      }
    });
    assert.strictEqual(adminDuplicado.status, 400, "email duplicado deve continuar bloqueado");

    const abrirCadastro = await request({
      method: "PUT",
      port,
      path: "/admin/saas-config",
      token: adminToken,
      body: { betaAtivo: true, cadastroPublicoAtivo: true, maxContasFreeBeta: 1 }
    });
    assert.strictEqual(abrirCadastro.status, 200, JSON.stringify(abrirCadastro.body));

    const googleSemPlano = await request({
      method: "POST",
      port,
      path: "/auth/google",
      body: {
        idToken: tokenGoogle({
          privateKey,
          kid,
          clientId,
          sub: "sub_sem_plano",
          email: "sem-plano@teste.local"
        })
      }
    });
    assert.strictEqual(googleSemPlano.status, 400);
    assert.strictEqual(googleSemPlano.body.codigo, "plano_obrigatorio");

    const googleEmBreve = await request({
      method: "POST",
      port,
      path: "/auth/google",
      body: {
        plano: "plano_futuro_google",
        idToken: tokenGoogle({
          privateKey,
          kid,
          clientId,
          sub: "sub_futuro_google",
          email: "futuro-google@teste.local"
        })
      }
    });
    assert.strictEqual(googleEmBreve.status, 403);
    assert.strictEqual(googleEmBreve.body.codigo, "plano_nao_contratavel");

    const googleNaoContratavel = await request({
      method: "POST",
      port,
      path: "/auth/google",
      body: {
        plano: "plano_restrito_google",
        idToken: tokenGoogle({
          privateKey,
          kid,
          clientId,
          sub: "sub_restrito_google",
          email: "restrito-google@teste.local"
        })
      }
    });
    assert.strictEqual(googleNaoContratavel.status, 403);
    assert.strictEqual(googleNaoContratavel.body.codigo, "plano_nao_contratavel");

    const googleNovoElegivel = await request({
      method: "POST",
      port,
      path: "/auth/google",
      body: {
        credential: tokenGoogle({
          privateKey,
          kid,
          clientId,
          sub: "sub_beta_google",
          email: "beta-google@teste.local"
        }),
        plano: "plano_beta_google"
      }
    });
    assert.strictEqual(googleNovoElegivel.status, 200, JSON.stringify(googleNovoElegivel.body));
    assert.ok(googleNovoElegivel.body.token, "Google novo elegivel deve receber JWT");
    assertSemSegredo(googleNovoElegivel.body, "Google novo elegivel");
    usuarios = readJson(path.join(dataDir, "usuarios.json"), []);
    const usuarioGoogleNovo = usuarios.find(u => u.email === "beta-google@teste.local");
    assert.ok(usuarioGoogleNovo, "Google novo deve criar usuario");
    assert.strictEqual(usuarios.filter(u => u.email === "beta-google@teste.local").length, 1, "Google novo cria um usuario unico");
    assert.strictEqual(usuarioGoogleNovo.googleSub, "sub_beta_google");
    assert.strictEqual(usuarioGoogleNovo.provedoresAuth.google.sub, "sub_beta_google");
    assert.strictEqual(usuarioGoogleNovo.plano, "Beta Google");
    assert.strictEqual(usuarioGoogleNovo.creditos, 321);
    assert.strictEqual(usuarioGoogleNovo.creditosModelo, "unicos");
    assert.ok(!usuarioGoogleNovo.senhaHash, "Google-only criado nao deve ter senhaHash");
    const configsAposGoogle = readJson(path.join(dataDir, "configs_clientes.json"), {});
    assert.ok(configsAposGoogle[usuarioGoogleNovo.id], "Google novo deve criar workspace/config");

    const meGoogleNovo = await request({
      method: "GET",
      port,
      path: "/me",
      token: googleNovoElegivel.body.token
    });
    assert.strictEqual(meGoogleNovo.status, 200);
    assert.strictEqual(meGoogleNovo.body.usuario.id, usuarioGoogleNovo.id);
    assert.strictEqual(meGoogleNovo.body.usuario.creditos, 321);
    assert.strictEqual(meGoogleNovo.body.usuario.limites.maxConexoes, 2);
    assert.deepStrictEqual(meGoogleNovo.body.usuario.marketplacesLiberados, ["amazon", "shopee"]);
    assert.strictEqual(meGoogleNovo.body.usuario.recursos.whatsapp, true);
    assertSemSegredo(meGoogleNovo.body, "/me Google novo");

    const googleNovoReentrada = await request({
      method: "POST",
      port,
      path: "/auth/google",
      body: {
        credential: tokenGoogle({
          privateKey,
          kid,
          clientId,
          sub: "sub_beta_google",
          email: "beta-google@teste.local"
        }),
        plano: "plano_beta_google"
      }
    });
    assert.strictEqual(googleNovoReentrada.status, 200, "Google criado deve logar por sub sem duplicar");
    usuarios = readJson(path.join(dataDir, "usuarios.json"), []);
    assert.strictEqual(usuarios.filter(u => u.email === "beta-google@teste.local").length, 1, "Reentrada Google nao duplica usuario");

    const googleVagaEsgotada = await request({
      method: "POST",
      port,
      path: "/auth/google",
      body: {
        credential: tokenGoogle({
          privateKey,
          kid,
          clientId,
          sub: "sub_beta_google_dois",
          email: "beta-google-dois@teste.local"
        }),
        plano: "plano_beta_google"
      }
    });
    assert.strictEqual(googleVagaEsgotada.status, 403);
    assert.strictEqual(googleVagaEsgotada.body.codigo, "vagas_beta_esgotadas");

    const adminSemToken = await request({ method: "GET", port, path: "/admin/usuarios" });
    assert.strictEqual(adminSemToken.status, 401, "Admin segue protegido");

    const adminUsuarios = await request({ method: "GET", port, path: "/admin/usuarios", token: adminToken });
    assert.strictEqual(adminUsuarios.status, 200);
    assertSemSegredo(adminUsuarios.body, "Admin usuarios Google");
    const adminUser = adminUsuarios.body.usuarios.find(u => u.id === "user_existente");
    assert.strictEqual(adminUser.googleSub, "sub_cliente", "Admin deve ver vinculo Google sanitizado");
    assert.ok(adminUser.provedoresAuth.google.emailVerificado, "Admin ve metadados nao sensiveis");

    const reset = await request({
      method: "POST",
      port,
      path: "/senha/recuperar",
      body: { email: "cliente@teste.local" }
    });
    assert.strictEqual(reset.status, 200, "recuperacao de senha segue operacional");
    assertSemSegredo(reset.body, "recuperacao apos Google");

    assert.ok(!stdout.includes(idToken), "ID token Google nao pode ser logado em stdout");
    assert.ok(!stderr.includes(idToken), "ID token Google nao pode ser logado em stderr");

    const blocoAuth = trechoEntre("function auth(req, res, next)", "const authHeader = req.headers.authorization");
    assert.ok(blocoAuth.includes('req.path === "/auth/google"'), "rota Google deve ser publica controlada");
    const blocoGoogle = trechoEntre("async function validarGoogleIdToken", 'app.post("/login"');
    assert.ok(blocoGoogle.includes("issuer: GOOGLE_ISSUERS_VALIDOS"), "validacao deve checar issuer");
    assert.ok(blocoGoogle.includes("audience: clientId"), "validacao deve checar audience");
    assert.ok(blocoGoogle.includes('algorithms: ["RS256"]'), "validacao deve restringir algoritmo");
    assert.ok(!/if\s*\([^)]*plano\s*===|free|premium|enterprise|ultimate/i.test(blocoGoogle), "Google Login nao pode hardcodar plano");

    console.log("saas-google-login-v1.test.js OK");
  } finally {
    proc.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
