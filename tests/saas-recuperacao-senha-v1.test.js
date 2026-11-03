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

function sanitizarLinhaDiagnostico(linha, segredos = []) {
  let texto = String(linha || "").replace(/\u001b\[[0-9;]*m/g, "");
  for (const segredo of segredos.filter(valor => typeof valor === "string" && valor.length >= 4).sort((a, b) => b.length - a.length)) {
    texto = texto.split(segredo).join("[redacted]");
  }
  return texto
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi, "[url-redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[token-redacted]")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----/gi, "[private-key-redacted]")
    .replace(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, "[password-hash-redacted]")
    .replace(/((?:DATABASE_URL|JWT_SECRET|[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|SENHA|CREDENTIAL|API_KEY)[A-Z0-9_]*|accessToken|refreshToken|credential|senhaHash|passwordHash)\s*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}]+)/gi, "$1[redacted]")
    .replace(/(["']?(?:email|nome|name|phone|telefone|user|usuario|clienteId|workspaceId)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,\s}]+)/gi, "$1[redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email-redacted]")
    .replace(/(?:[A-Z]:\\|\/)(?:[^\\/\s]+[\\/]){2,}[^\\/\s]*/gi, "[path-redacted]")
    .slice(0, 400);
}

const PADRAO_LOG_INICIALIZACAO = /(?:\[API\]|\[ENGINE-DB|\[PERF DB|\[LOCAL-WORKER-SCHEMA\]|\[ENGINE-V2-PIPELINE|\[OK\].*\/data|MODULE_NOT_FOUND|ERR_REQUIRE|ERR_[A-Z_]+|ECONN[A-Z]+|EAI_AGAIN|ETIMEDOUT|EACCES|EPERM|ENOTFOUND|\b(?:error|erro|fatal|warning|warn|exception|falha|failed|timeout|listening|online|database_url_ausente|engine_database_unavailable)\b)/i;

function linhasDiagnosticoStartup(texto = "", segredos = []) {
  return String(texto)
    .split(/\r?\n/)
    .filter(linha => PADRAO_LOG_INICIALIZACAO.test(linha))
    .slice(-16)
    .map(linha => sanitizarLinhaDiagnostico(linha, segredos))
    .filter(Boolean)
    .join("\n") || "(nenhuma linha de inicializacao/erro reconhecida)";
}

function etapaInicializacaoDaLinha(linha = "") {
  if (/\[API\].*API ONLINE/i.test(linha)) return "http_listener_started";
  if (/database_url_ausente|engine_database_unavailable/i.test(linha)) return "engine_database_missing_block";
  if (/\[ENGINE-DB-ERRO\]/i.test(linha)) return "engine_database_error";
  if (/\[ENGINE-DB-OK\]/i.test(linha)) return "engine_database_ready";
  if (/\[PERF DB POOL\].*connect/i.test(linha)) return "postgres_connection_acquired";
  if (/\[PERF DB POOL\]/i.test(linha)) return "postgres_pool_created";
  if (/\[PERF DB\].*initEngineDatabase/i.test(linha)) return "engine_schema_ready";
  if (/\[LOCAL-WORKER-SCHEMA\]/i.test(linha)) return "local_worker_schema_checked";
  if (/MODULE_NOT_FOUND|ERR_REQUIRE/i.test(linha)) return "module_load_error";
  if (/\b(?:error|erro|fatal|exception|falha|failed|timeout|ECONN[A-Z]+|ETIMEDOUT|EACCES|EPERM|ENOTFOUND)\b/i.test(linha)) return "startup_error_output";
  return "";
}

function diagnosticarDiretorio(caminho, configurado = false) {
  if (!caminho) return { configurado, existe: false, diretorio: false, gravavel: false };
  try {
    const stat = fs.statSync(caminho);
    const diretorio = stat.isDirectory();
    if (diretorio) fs.accessSync(caminho, fs.constants.W_OK);
    return { configurado, existe: true, diretorio, gravavel: diretorio };
  } catch (erro) {
    return {
      configurado,
      existe: fs.existsSync(caminho),
      diretorio: false,
      gravavel: false,
      codigo: /^[A-Z0-9_]{2,32}$/.test(String(erro?.code || "")) ? erro.code : "filesystem_error"
    };
  }
}

function resumoDatabaseUrl(valor = "") {
  const texto = String(valor || "").trim();
  const esquema = texto.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase() || null;
  return { presente: Boolean(texto), esquema };
}

function validarSanitizadorDiagnostico() {
  const senha = "SenhaNova123";
  const amostra = "[ENGINE-DB-ERRO] DATABASE_URL=postgresql://ci:password@db/test https://identity.test/path Authorization: Bearer eyJhbGci.eyJzdWIi.signature raw eyJhbGci.eyJzdWIi.signature email=qa@example.test contact qa@example.test " + senha + " /home/runner/work/project/index.js";
  const limpo = sanitizarLinhaDiagnostico(amostra, [senha]);
  assert.ok(limpo.includes("[url-redacted]"), "URL deve ser removida do diagnostico");
  assert.ok(limpo.includes("[email-redacted]"), "email deve ser removido do diagnostico");
  assert.ok(limpo.includes("[token-redacted]"), "token deve ser removido do diagnostico");
  assert.ok(limpo.includes("[redacted]"), "segredos conhecidos devem ser removidos do diagnostico");
  assert.ok(!/postgresql:\/\/|password@db|qa@example\.test|eyJhbGci|SenhaNova123|\/home\/runner/i.test(limpo), "diagnostico nao pode conter valores sensiveis ou caminhos pessoais");
}

validarSanitizadorDiagnostico();

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

async function esperarServidor(port, proc, estadoInicializacao, obterDiagnostico, segredos) {
  const inicio = Date.now();
  const limite = inicio + 20000;
  let tentativas = 0;
  let ultimaSonda = { tipo: "nao_iniciada" };
  estadoInicializacao.ultimaEtapa = "aguardando_http_root_200";

  function emitirDiagnostico(motivo) {
    const dados = obterDiagnostico({
      motivo,
      porta: port,
      tempoDecorridoMs: Date.now() - inicio,
      tentativas,
      ultimaSonda,
      processo: {
        pid: proc.pid || null,
        exitCode: proc.exitCode,
        signalCode: proc.signalCode,
        killed: proc.killed,
        erroSpawn: estadoInicializacao.erroSpawn
      }
    }, segredos);
    console.error("[SAAS-RECOVERY-STARTUP-DIAGNOSTIC]", JSON.stringify(dados));
    throw new Error(motivo);
  }

  while (Date.now() < limite) {
    if (estadoInicializacao.erroSpawn) {
      emitirDiagnostico("falha ao iniciar processo filho");
    }
    if (proc.exitCode !== null || proc.signalCode !== null) {
      emitirDiagnostico("servidor encerrou antes de subir");
    }
    tentativas += 1;
    try {
      const res = await request({ port, path: "/" });
      ultimaSonda = { tipo: "http", status: res.status };
      if (res.status === 200) {
        estadoInicializacao.ultimaEtapa = "http_root_ready";
        return;
      }
    } catch (erro) {
      ultimaSonda = {
        tipo: "socket_error",
        classe: String(erro?.name || "Error").slice(0, 40),
        codigo: /^[A-Z0-9_]{2,32}$/.test(String(erro?.code || "")) ? erro.code : null
      };
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  emitirDiagnostico("timeout aguardando servidor");
}

function aguardarSaidaProcesso(proc, timeoutMs) {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const aoSair = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      proc.removeListener("exit", aoSair);
      resolve(false);
    }, timeoutMs);
    proc.once("exit", aoSair);
  });
}

async function encerrarProcessoFilho(proc) {
  const estado = {
    processoIniciado: Boolean(proc.pid),
    killSolicitado: false,
    killAceito: null,
    encerramentoForcado: false,
    killForcadoAceito: null,
    terminou: false,
    exitCode: proc.exitCode,
    signalCode: proc.signalCode
  };
  if (proc.pid && proc.exitCode === null && proc.signalCode === null) {
    estado.killSolicitado = true;
    try { estado.killAceito = proc.kill("SIGTERM"); } catch {}
    estado.terminou = await aguardarSaidaProcesso(proc, 2500);
    if (!estado.terminou && proc.exitCode === null && proc.signalCode === null) {
      estado.encerramentoForcado = true;
      try { estado.killForcadoAceito = proc.kill("SIGKILL"); } catch {}
      estado.terminou = await aguardarSaidaProcesso(proc, 2500);
    }
  } else {
    estado.terminou = !proc.pid || proc.exitCode !== null || proc.signalCode !== null;
  }
  estado.exitCode = proc.exitCode;
  estado.signalCode = proc.signalCode;
  return estado;
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

  const envFilho = {
    ...process.env,
    DATA_DIR: dataDir,
    PORT: String(port),
    JWT_SECRET: jwtSecret,
    PERF_DIAGNOSTICO: "0"
  };
  const segredosDiagnostico = [jwtSecret, email, senhaAntiga, senhaNova, "AdminSenha123"];
  const proc = spawn(process.execPath, ["index.js"], {
    cwd: raiz,
    env: envFilho,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  const estadoInicializacao = {
    ultimaEtapa: "processo_filho_iniciado",
    ultimoCanalEtapa: "fixture",
    erroSpawn: null
  };
  proc.once("error", erro => {
    estadoInicializacao.erroSpawn = {
      classe: String(erro?.name || "Error").slice(0, 40),
      codigo: /^[A-Z0-9_]{2,32}$/.test(String(erro?.code || "")) ? erro.code : null
    };
    estadoInicializacao.ultimaEtapa = "spawn_error";
    estadoInicializacao.ultimoCanalEtapa = "fixture";
  });

  function acompanharSaida(stream, canal) {
    let parcial = "";
    stream.on("data", chunk => {
      const texto = chunk.toString();
      if (canal === "stdout") stdout += texto;
      else stderr += texto;
      const partes = (parcial + texto).split(/\r?\n/);
      parcial = partes.pop() || "";
      for (const linha of partes) {
        const etapa = etapaInicializacaoDaLinha(linha);
        if (etapa) {
          estadoInicializacao.ultimaEtapa = etapa;
          estadoInicializacao.ultimoCanalEtapa = canal;
        }
      }
    });
    stream.on("end", () => {
      const etapa = etapaInicializacaoDaLinha(parcial);
      if (etapa) {
        estadoInicializacao.ultimaEtapa = etapa;
        estadoInicializacao.ultimoCanalEtapa = canal;
      }
    });
  }
  acompanharSaida(proc.stdout, "stdout");
  acompanharSaida(proc.stderr, "stderr");

  function moduloDisponivel(nome) {
    try {
      require.resolve(nome, { paths: [raiz] });
      return true;
    } catch {
      return false;
    }
  }

  function obterDiagnosticoInicializacao(probe, segredos = []) {
    const dataDirMensageiroV3 = envFilho.MENSAGEIRO_V3_DATA_DIR || "/data/mensageiro-v3";
    return {
      ...probe,
      ultimaEtapaInicializacao: estadoInicializacao.ultimaEtapa,
      canalUltimaEtapa: estadoInicializacao.ultimoCanalEtapa,
      ambiente: {
        node: process.version,
        plataforma: process.platform,
        databaseUrl: { herdadaPeloFilho: Boolean(envFilho.DATABASE_URL), ...resumoDatabaseUrl(envFilho.DATABASE_URL) },
        pgSslMode: !envFilho.PGSSLMODE ? "unset" : String(envFilho.PGSSLMODE).toLowerCase() === "disable" ? "disable" : "configured",
        dataDirDoTeste: diagnosticarDiretorio(dataDir, true),
        dataRoot: diagnosticarDiretorio("/data", false),
        mensageiroV3DataDir: diagnosticarDiretorio(dataDirMensageiroV3, Boolean(envFilho.MENSAGEIRO_V3_DATA_DIR)),
        jwtSecretConfigurado: Boolean(envFilho.JWT_SECRET),
        modulos: {
          express: moduloDisponivel("express"),
          pg: moduloDisponivel("pg"),
          jsonwebtoken: moduloDisponivel("jsonwebtoken"),
          bcryptjs: moduloDisponivel("bcryptjs")
        }
      },
      stdoutSanitizado: linhasDiagnosticoStartup(stdout, segredos),
      stderrSanitizado: linhasDiagnosticoStartup(stderr, segredos)
    };
  }

  try {
    await esperarServidor(port, proc, estadoInicializacao, obterDiagnosticoInicializacao, segredosDiagnostico);

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
    const encerramentoFilho = await encerrarProcessoFilho(proc);
    console.log("[SAAS-RECOVERY-CHILD-CLEANUP]", JSON.stringify(encerramentoFilho));
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (!encerramentoFilho.terminou) throw new Error("processo filho nao encerrou apos SIGTERM/SIGKILL");
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
