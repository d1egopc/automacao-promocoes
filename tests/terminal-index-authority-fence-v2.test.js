const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const fence = require("../modules/fila/terminal-index-authority-fence");

let sequenciaToken = 0;

function deps(workspace, extras = {}) {
  return {
    fs: extras.fs || fs,
    getClientePath: () => workspace,
    token: () => `authority-token-${++sequenciaToken}`,
    logger: { warn() {} },
    ...extras
  };
}

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "terminal-authority-fence-v2-"));
}

function limpar(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function lerState(dir) {
  const { stateFile } = fence.getFencePaths("admin", deps(dir));
  return JSON.parse(fs.readFileSync(stateFile, "utf8"));
}

function fsComRenameDeEstadoFalho(dir) {
  const paths = fence.getFencePaths("admin", deps(dir));
  return {
    ...fs,
    renameSync(source, destination) {
      if (destination === paths.stateFile) {
        const erro = new Error("rename_injetado_falhou");
        erro.code = "EIO";
        throw erro;
      }
      return fs.renameSync(source, destination);
    }
  };
}

function testeDoisWritersNaoSeApagam() {
  const dir = workspace();
  try {
    const d = deps(dir);
    const armA = fence.armarRewrite("admin", d);
    const armB = fence.armarRewrite("admin", d);
    assert.strictEqual(armA.ok, true);
    assert.strictEqual(armB.ok, true);
    assert.strictEqual(armB.epoch, armA.epoch + 1);
    assert.deepStrictEqual(fence.snapshot("admin", d).owners, [armA.token, armB.token]);

    const clearA = fence.limparRewrite("admin", armA.token, d);
    assert.strictEqual(clearA.ok, true);
    assert.deepStrictEqual(fence.snapshot("admin", d).owners, [armB.token]);
    assert.strictEqual(fence.snapshot("admin", d).pending, true);

    const clearB = fence.limparRewrite("admin", armB.token, d);
    assert.strictEqual(clearB.ok, true);
    const final = fence.snapshot("admin", d);
    assert.deepStrictEqual(final.owners, []);
    assert.strictEqual(final.pending, false);
    assert.strictEqual(final.epoch, armB.epoch);
  } finally {
    limpar(dir);
  }
}

function executarEmProcessoSeparado(dir, operacao, token = "") {
  const modulo = path.join(__dirname, "..", "modules", "fila", "terminal-index-authority-fence.js");
  const script = [
    `const fence=require(${JSON.stringify(modulo)});`,
    `const fs=require("fs");`,
    `const dir=process.argv[1];`,
    `const deps={getClientePath:()=>dir};`,
    operacao === "arm"
      ? `process.stdout.write(JSON.stringify(fence.armarRewrite("admin", deps)));`
      : `process.stdout.write(JSON.stringify(fence.limparRewrite("admin", process.argv[2], deps)));`
  ].join("");
  const args = ["-e", script, dir];
  if (token) args.push(token);
  return JSON.parse(execFileSync(process.execPath, args, { encoding: "utf8" }));
}

function testeDoisProcessosIsoladosNaoSeApagam() {
  const dir = workspace();
  try {
    const armA = executarEmProcessoSeparado(dir, "arm");
    const armB = executarEmProcessoSeparado(dir, "arm");
    assert.strictEqual(armA.ok, true);
    assert.strictEqual(armB.ok, true);
    assert.deepStrictEqual(fence.snapshot("admin", deps(dir)).owners, [armA.token, armB.token]);

    const clearA = executarEmProcessoSeparado(dir, "clear", armA.token);
    assert.strictEqual(clearA.ok, true);
    assert.deepStrictEqual(fence.snapshot("admin", deps(dir)).owners, [armB.token]);

    const clearB = executarEmProcessoSeparado(dir, "clear", armB.token);
    assert.strictEqual(clearB.ok, true);
    assert.deepStrictEqual(fence.snapshot("admin", deps(dir)).owners, []);
  } finally {
    limpar(dir);
  }
}

function testeEpochMonotonoEAba() {
  const dir = workspace();
  try {
    const d = deps(dir);
    const pre = fence.snapshot("admin", d);
    assert.strictEqual(pre.ok, false);
    assert.strictEqual(pre.reasonCode, "state_absent");

    const arm = fence.armarRewrite("admin", d);
    const clear = fence.limparRewrite("admin", arm.token, d);
    const post = fence.snapshot("admin", d);

    assert.strictEqual(arm.ok, true);
    assert.strictEqual(clear.ok, true);
    assert.strictEqual(post.pending, false);
    assert.strictEqual(post.epoch, arm.epoch);
    assert.notStrictEqual(post.epoch, pre.epoch);
    assert.strictEqual(lerState(dir).epoch, arm.epoch);
  } finally {
    limpar(dir);
  }
}

function testeCrashDepoisDoArmamento() {
  const dir = workspace();
  try {
    const d = deps(dir);
    const arm = fence.armarRewrite("admin", d);
    assert.strictEqual(arm.ok, true);
    const observadoDepoisDoCrash = fence.snapshot("admin", d);
    assert.strictEqual(observadoDepoisDoCrash.ok, true);
    assert.strictEqual(observadoDepoisDoCrash.pending, true);
    assert.deepStrictEqual(observadoDepoisDoCrash.owners, [arm.token]);
    assert.strictEqual(observadoDepoisDoCrash.epoch, arm.epoch);
  } finally {
    limpar(dir);
  }
}

function testeFalhaClearPermaneceFailClosed() {
  const dir = workspace();
  try {
    const d = deps(dir);
    const arm = fence.armarRewrite("admin", d);
    const clear = fence.limparRewrite("admin", arm.token, {
      ...d,
      fs: fsComRenameDeEstadoFalho(dir)
    });
    assert.strictEqual(clear.ok, false);
    assert.strictEqual(clear.failClosed, true);
    const observado = fence.snapshot("admin", d);
    assert.strictEqual(observado.pending, true);
    assert.deepStrictEqual(observado.owners, [arm.token]);
    assert.strictEqual(observado.epoch, arm.epoch);
  } finally {
    limpar(dir);
  }
}

function testeLockAbandonadoBloqueiaElegibilidade() {
  const dir = workspace();
  try {
    const d = deps(dir);
    const arm = fence.armarRewrite("admin", d);
    assert.strictEqual(fence.limparRewrite("admin", arm.token, d).ok, true);
    const lock = fence.getFencePaths("admin", d).lockFile;
    fs.writeFileSync(lock, "abandoned-owner", "utf8");

    const snapshot = fence.snapshot("admin", d);
    assert.strictEqual(snapshot.ok, false);
    assert.strictEqual(snapshot.eligible, false);
    assert.strictEqual(snapshot.metadataLockPresent, true);
    assert.strictEqual(snapshot.reasonCode, "metadata_lock_present");
    assert.strictEqual(fence.armarRewrite("admin", d).ok, false);
  } finally {
    limpar(dir);
  }
}

function testeEstadoCorrompidoEParcialFailClosed() {
  const dir = workspace();
  try {
    const d = deps(dir);
    const paths = fence.getFencePaths("admin", d);
    fs.writeFileSync(paths.stateFile, "{", "utf8");
    const corrompido = fence.snapshot("admin", d);
    assert.strictEqual(corrompido.ok, false);
    assert.strictEqual(corrompido.failClosed, true);
    assert.strictEqual(corrompido.reasonCode, "state_corrupt");

    fs.unlinkSync(paths.stateFile);
    fs.writeFileSync(`${paths.stateFile}.tmp.partial`, "{\"version\":1", "utf8");
    const somenteTemp = fence.snapshot("admin", d);
    assert.strictEqual(somenteTemp.ok, false);
    assert.strictEqual(somenteTemp.reasonCode, "state_absent");

    fs.unlinkSync(`${paths.stateFile}.tmp.partial`);
    fs.writeFileSync(paths.stateFile, JSON.stringify({ version: 1, epoch: 2, owners: ["same-owner", "same-owner"] }), "utf8");
    const duplicado = fence.snapshot("admin", d);
    assert.strictEqual(duplicado.ok, false);
    assert.strictEqual(duplicado.reasonCode, "state_owners_duplicate");
  } finally {
    limpar(dir);
  }
}

function testeFalhaArmNaoPublicaEstadoParcial() {
  const dir = workspace();
  try {
    const d = deps(dir);
    const paths = fence.getFencePaths("admin", d);
    const arm = fence.armarRewrite("admin", {
      ...d,
      fs: fsComRenameDeEstadoFalho(dir)
    });
    assert.strictEqual(arm.ok, false);
    assert.strictEqual(fs.existsSync(paths.stateFile), false);
    const temporarios = fs.readdirSync(dir).filter(nome => nome.startsWith("fila-terminal-authority-fence.json.tmp."));
    assert.deepStrictEqual(temporarios, []);
  } finally {
    limpar(dir);
  }
}

function testeClearNaoPodeApagarOwnerAlheio() {
  const dir = workspace();
  try {
    const d = deps(dir);
    const armA = fence.armarRewrite("admin", d);
    const armB = fence.armarRewrite("admin", d);
    const clearErrado = fence.limparRewrite("admin", "authority-token-foreign", d);
    assert.strictEqual(clearErrado.ok, false);
    assert.strictEqual(clearErrado.failClosed, true);
    assert.deepStrictEqual(fence.snapshot("admin", d).owners, [armA.token, armB.token]);
  } finally {
    limpar(dir);
  }
}

function testeIsolamentoPorWorkspace() {
  const a = workspace();
  const b = workspace();
  try {
    const da = deps(a);
    const db = deps(b);
    const armA = fence.armarRewrite("admin", da);
    assert.strictEqual(fence.snapshot("admin", db).reasonCode, "state_absent");
    assert.strictEqual(fence.snapshot("admin", db).metadataLockPresent, false);
    assert.strictEqual(fence.armarRewrite("admin", db).ok, true);
    assert.strictEqual(fence.snapshot("admin", da).pending, true);
    assert.strictEqual(fence.snapshot("admin", db).pending, true);
    assert.strictEqual(fence.limparRewrite("admin", armA.token, da).ok, true);
  } finally {
    limpar(a);
    limpar(b);
  }
}

function testeArmFalhoNaoReescreveHistoricoMasPreservaFilaFactual() {
  const dir = workspace();
  try {
    const d = deps(dir);
    const paths = fence.getFencePaths("admin", d);
    fs.writeFileSync(path.join(dir, "fila.json"), JSON.stringify([{ id: "factual" }]), "utf8");
    fs.writeFileSync(paths.lockFile, "occupied", "utf8");

    let historyWrites = 0;
    const arm = fence.armarRewrite("admin", d);
    if (arm.ok === true) historyWrites += 1;
    assert.strictEqual(arm.ok, false);
    assert.strictEqual(historyWrites, 0);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, "fila.json"), "utf8")), [{ id: "factual" }]);
    assert.strictEqual(fs.existsSync(path.join(dir, "fila-historico.json")), false);
  } finally {
    limpar(dir);
  }
}

function testeFenceAusenteMantemRewriteLegadoSemEstado() {
  const dir = workspace();
  try {
    const d = { ...deps(dir), env: {} };
    const paths = fence.getFencePaths("admin", d);
    let writes = 0;
    const resultado = fence.executarRewriteComFence("admin", d, () => {
      writes += 1;
      fs.writeFileSync(path.join(dir, "fila-historico.json"), JSON.stringify([{ id: "legado" }]), "utf8");
      return { ok: true, writes };
    });
    assert.deepStrictEqual(resultado, { ok: true, writes: 1 });
    assert.strictEqual(writes, 1);
    assert.strictEqual(fs.existsSync(paths.stateFile), false);
    assert.strictEqual(fs.existsSync(paths.lockFile), false);
    assert.strictEqual(fs.existsSync(path.join(dir, "fila-historico.json")), true);
  } finally {
    limpar(dir);
  }
}

function testeFenceExplicitamenteOffMantemRewriteLegado() {
  const dir = workspace();
  try {
    const d = { ...deps(dir), env: { [fence.FLAG]: "0" } };
    const paths = fence.getFencePaths("admin", d);
    let writes = 0;
    const resultado = fence.executarRewriteComFence("admin", d, () => {
      writes += 1;
      fs.writeFileSync(path.join(dir, "fila-historico.json"), "[]", "utf8");
      return { ok: true };
    });
    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(writes, 1);
    assert.strictEqual(fs.existsSync(paths.stateFile), false);
    assert.strictEqual(fs.existsSync(paths.lockFile), false);
  } finally {
    limpar(dir);
  }
}

function testeFenceOnExecutaArmClearV2() {
  const dir = workspace();
  try {
    const d = { ...deps(dir), env: { [fence.FLAG]: "1" } };
    const resultado = fence.executarRewriteComFence("admin", d, () => {
      const durante = fence.snapshot("admin", d);
      assert.strictEqual(durante.pending, true);
      fs.writeFileSync(path.join(dir, "fila-historico.json"), "[]", "utf8");
      return { ok: true };
    });
    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(resultado.fence.epoch, 1);
    assert.strictEqual(resultado.fenceClear.ok, true);
    assert.strictEqual(fence.snapshot("admin", d).pending, false);
    assert.strictEqual(lerState(dir).epoch, 1);
  } finally {
    limpar(dir);
  }
}

function testeFenceOnArmFalhoBloqueiaHistoricoMasNaoFilaFactual() {
  const dir = workspace();
  try {
    const d = { ...deps(dir), env: { [fence.FLAG]: "1" } };
    const paths = fence.getFencePaths("admin", d);
    fs.writeFileSync(path.join(dir, "fila.json"), JSON.stringify([{ id: "factual" }]), "utf8");
    fs.writeFileSync(paths.lockFile, "abandoned-owner", "utf8");
    let writes = 0;
    const resultado = fence.executarRewriteComFence("admin", d, () => {
      writes += 1;
      fs.writeFileSync(path.join(dir, "fila-historico.json"), "[]", "utf8");
      return { ok: true };
    });
    assert.strictEqual(resultado.skipped, true);
    assert.strictEqual(writes, 0);
    assert.strictEqual(fs.existsSync(path.join(dir, "fila-historico.json")), false);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, "fila.json"), "utf8")), [{ id: "factual" }]);
  } finally {
    limpar(dir);
  }
}

function testeFenceOffIgnoraLockAbandonado() {
  const dir = workspace();
  try {
    const d = { ...deps(dir), env: { [fence.FLAG]: "0" } };
    const paths = fence.getFencePaths("admin", d);
    fs.writeFileSync(paths.lockFile, "abandoned-owner", "utf8");
    const resultado = fence.executarRewriteComFence("admin", d, () => {
      fs.writeFileSync(path.join(dir, "fila-historico.json"), "[]", "utf8");
      return { ok: true };
    });
    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(fs.existsSync(path.join(dir, "fila-historico.json")), true);
    assert.strictEqual(fs.existsSync(paths.stateFile), false);
    assert.strictEqual(fs.existsSync(paths.lockFile), true);
  } finally {
    limpar(dir);
  }
}

function testeClearBemSucedidoSomenteDepoisDoRewrite() {
  const dir = workspace();
  try {
    const d = deps(dir);
    const arm = fence.armarRewrite("admin", d);
    let historyWritten = false;
    assert.strictEqual(fence.snapshot("admin", d).pending, true);
    fs.writeFileSync(path.join(dir, "fila-historico.json"), JSON.stringify([{ id: "terminal" }]), "utf8");
    historyWritten = true;
    const clear = historyWritten ? fence.limparRewrite("admin", arm.token, d) : { ok: false };
    assert.strictEqual(clear.ok, true);
    assert.strictEqual(fence.snapshot("admin", d).pending, false);
  } finally {
    limpar(dir);
  }
}

function executar() {
  testeDoisWritersNaoSeApagam();
  testeDoisProcessosIsoladosNaoSeApagam();
  testeEpochMonotonoEAba();
  testeCrashDepoisDoArmamento();
  testeFalhaClearPermaneceFailClosed();
  testeLockAbandonadoBloqueiaElegibilidade();
  testeEstadoCorrompidoEParcialFailClosed();
  testeFalhaArmNaoPublicaEstadoParcial();
  testeClearNaoPodeApagarOwnerAlheio();
  testeIsolamentoPorWorkspace();
  testeArmFalhoNaoReescreveHistoricoMasPreservaFilaFactual();
  testeFenceAusenteMantemRewriteLegadoSemEstado();
  testeFenceExplicitamenteOffMantemRewriteLegado();
  testeFenceOnExecutaArmClearV2();
  testeFenceOnArmFalhoBloqueiaHistoricoMasNaoFilaFactual();
  testeFenceOffIgnoraLockAbandonado();
  testeClearBemSucedidoSomenteDepoisDoRewrite();
  console.log("terminal-index-authority-fence-v2: ok");
}

executar();
