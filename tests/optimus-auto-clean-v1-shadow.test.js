"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  TTL_PADRAO,
  autoCleanShadowAtivo,
  autoCleanExecuteAtivo,
  criarPoliticaRetencao,
  avaliarRegistroAutoClean,
  executarAutoCleanShadow,
  executarAutoCleanShadowSeguro,
  auditarFilaJson,
  inventariarArquivosPorCategoria,
  memoriaComercialStatus
} = require("../modules/engine/auto-clean/auto-clean.service");

const AGORA = Date.parse("2026-08-03T12:00:00.000Z");

function isoAtras(ms) {
  return new Date(AGORA - ms).toISOString();
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "optimus-auto-clean-shadow-"));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function escreverJson(file, dados) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(dados, null, 2));
}

function tocarArquivo(file, conteudo, mtimeMs) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, conteudo);
  const data = new Date(mtimeMs);
  fs.utimesSync(file, data, data);
}

function capturarLogger() {
  const logs = [];
  return {
    logs,
    logger: {
      log: (...args) => logs.push(args.join(" "))
    }
  };
}

async function testarTtlEStatus() {
  const politica = criarPoliticaRetencao({ loteLimite: 100 });

  const vivo = avaliarRegistroAutoClean({
    origem: "fila_json",
    tipoRegistro: "fila_json",
    status: "pendente",
    referenciaTemporal: isoAtras(10 * TTL_PADRAO.filaTerminalMs)
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(vivo.elegivel, false);
  assert.strictEqual(vivo.motivo, "item_vivo");

  const flowRecente = avaliarRegistroAutoClean({
    origem: "engine_ofertas",
    tipoRegistro: "engine_ofertas",
    status: "flow_nao_aceita",
    referenciaTemporal: isoAtras(23 * 60 * 60 * 1000)
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(flowRecente.elegivel, false);
  assert.strictEqual(flowRecente.motivo, "dentro_ttl");

  const flowAntigo = avaliarRegistroAutoClean({
    origem: "engine_ofertas",
    tipoRegistro: "engine_ofertas",
    status: "flow_nao_aceita",
    referenciaTemporal: isoAtras(25 * 60 * 60 * 1000)
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(flowAntigo.elegivel, true);
  assert.strictEqual(flowAntigo.aplicouMudancas, false);

  const enviadoRecente = avaliarRegistroAutoClean({
    origem: "fila_json",
    tipoRegistro: "fila_json",
    status: "enviado",
    referenciaTemporal: isoAtras(6 * 60 * 60 * 1000)
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(enviadoRecente.elegivel, false);

  const enviadoAntigo = avaliarRegistroAutoClean({
    origem: "fila_json",
    tipoRegistro: "fila_json",
    status: "enviado",
    referenciaTemporal: isoAtras(26 * 60 * 60 * 1000)
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(enviadoAntigo.elegivel, true);
}

async function testarDependenciasProtegidas() {
  const politica = criarPoliticaRetencao();

  const ofertaComFilaViva = avaliarRegistroAutoClean({
    origem: "engine_ofertas",
    tipoRegistro: "engine_ofertas",
    status: "flow_nao_aceita",
    referenciaTemporal: isoAtras(48 * 60 * 60 * 1000),
    temReferenciaFilaViva: true
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(ofertaComFilaViva.elegivel, false);
  assert.strictEqual(ofertaComFilaViva.motivo, "referencia_fila_viva");

  const eventoComJobAtivo = avaliarRegistroAutoClean({
    origem: "engine_eventos_brutos",
    tipoRegistro: "engine_eventos_brutos",
    status: "evento_bruto",
    referenciaTemporal: isoAtras(20 * 24 * 60 * 60 * 1000),
    temJobAtivo: true
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(eventoComJobAtivo.elegivel, false);
  assert.strictEqual(eventoComJobAtivo.motivo, "job_ativo");

  const linkComOfertaAtiva = avaliarRegistroAutoClean({
    origem: "engine_links",
    tipoRegistro: "engine_links",
    status: "link",
    referenciaTemporal: isoAtras(20 * 24 * 60 * 60 * 1000),
    temOfertaAtiva: true
  }, { politica, agoraMs: AGORA });
  assert.strictEqual(linkComOfertaAtiva.elegivel, false);
  assert.strictEqual(linkComOfertaAtiva.motivo, "oferta_ativa");
}

async function testarFilaJsonShadow() {
  const dir = tempDir();
  const clienteDir = path.join(dir, "clientes", "user_40qdblgt");
  const filaPath = path.join(clienteDir, "fila.json");
  const fila = [];
  for (let i = 0; i < 150; i += 1) {
    fila.push({ id: `enviado_${i}`, status: "enviado", enviadoEm: isoAtras(48 * 60 * 60 * 1000), titulo: "Oferta teste" });
  }
  fila.push({ id: "vivo", status: "pendente", dataEntradaFila: isoAtras(48 * 60 * 60 * 1000) });
  escreverJson(filaPath, fila);
  const antes = fs.readFileSync(filaPath, "utf8");

  const resumo = auditarFilaJson({ dataDir: dir, agoraMs: AGORA, loteLimite: 100 });
  assert.strictEqual(resumo.quantidade, 100, "lote nao deve ultrapassar 100");
  assert.strictEqual(resumo.elegiveis, 100);
  assert.strictEqual(resumo.aplicouMudancas, false);
  assert.strictEqual(fs.readFileSync(filaPath, "utf8"), antes, "shadow nao reescreve fila");

  const dirInvalido = tempDir();
  const filaInvalida = path.join(dirInvalido, "clientes", "user_invalido", "fila.json");
  mkdirp(path.dirname(filaInvalida));
  fs.writeFileSync(filaInvalida, "{ json invalido");
  const invalidaAntes = fs.readFileSync(filaInvalida, "utf8");
  const resumoInvalido = auditarFilaJson({ dataDir: dirInvalido, agoraMs: AGORA });
  assert.strictEqual(resumoInvalido.filasInvalidas, 1);
  assert.strictEqual(fs.readFileSync(filaInvalida, "utf8"), invalidaAntes, "fila invalida nao e reescrita");
}

async function testarArquivosProtegidosEShadow() {
  const dir = tempDir();
  tocarArquivo(path.join(dir, "logs", "app.log"), "linha antiga", AGORA - 20 * 24 * 60 * 60 * 1000);
  tocarArquivo(path.join(dir, "cache", "imagem.tmp"), "cache", AGORA - 5 * 24 * 60 * 60 * 1000);
  tocarArquivo(path.join(dir, "sessions", "auth", "creds.json"), "segredo", AGORA - 60 * 24 * 60 * 60 * 1000);

  const resumos = inventariarArquivosPorCategoria({ dataDir: dir, agoraMs: AGORA, loteLimite: 100 });
  const logs = resumos.find(item => item.origem === "logs_persistidos");
  const temporarios = resumos.find(item => item.origem === "temporarios");
  assert.strictEqual(logs.elegiveis, 1);
  assert.strictEqual(temporarios.elegiveis, 1);
  assert.ok(!JSON.stringify(resumos).includes("creds.json"), "sessao/auth nao entra no inventario de limpeza");
}

async function testarMemoriaComercialIntacta() {
  const dir = tempDir();
  const memoria = path.join(dir, "ofertas_vistas.json");
  escreverJson(memoria, [{ chave: "produto", vistoEm: new Date(AGORA).toISOString() }]);
  const antes = fs.readFileSync(memoria, "utf8");
  const resumo = memoriaComercialStatus({ dataDir: dir });
  assert.strictEqual(resumo.elegiveis, 0);
  assert.strictEqual(resumo.protegidos, 1);
  assert.strictEqual(fs.readFileSync(memoria, "utf8"), antes);
}

async function testarPostgresShadowEDependencias() {
  const { logger, logs } = capturarLogger();
  const chamadas = [];
  const queryMock = async (sql, params) => {
    chamadas.push({ sql, params });
    if (/FROM engine_eventos_brutos/i.test(sql)) {
      return { ok: true, resultado: { rows: [{ id: 1, status: "evento_bruto", referencia_temporal: isoAtras(20 * 24 * 60 * 60 * 1000), bytes_estimados: 200, tem_job_ativo: true }] } };
    }
    if (/FROM engine_links/i.test(sql)) {
      return { ok: true, resultado: { rows: [{ id: 2, status: "link", referencia_temporal: isoAtras(20 * 24 * 60 * 60 * 1000), bytes_estimados: 150, tem_oferta_ativa: true }] } };
    }
    if (/FROM engine_ofertas/i.test(sql)) {
      return { ok: true, resultado: { rows: [{ id: 3, status: "flow_nao_aceita", referencia_temporal: isoAtras(26 * 60 * 60 * 1000), bytes_estimados: 300 }] } };
    }
    return { ok: true, resultado: { rows: [] } };
  };

  const resumo = await executarAutoCleanShadow({
    shadow: true,
    incluirArquivos: false,
    queryEngine: queryMock,
    agoraMs: AGORA,
    logger
  });

  assert.strictEqual(resumo.aplicouMudancas, false);
  assert.ok(chamadas.length >= 6, "inventario postgres deve consultar origens esperadas");
  const origemEventos = resumo.origens.find(item => item.origem === "engine_eventos_brutos");
  const origemLinks = resumo.origens.find(item => item.origem === "engine_links");
  const origemOfertas = resumo.origens.find(item => item.origem === "engine_ofertas");
  assert.strictEqual(origemEventos.protegidos, 1);
  assert.strictEqual(origemEventos.motivos.job_ativo, 1);
  assert.strictEqual(origemLinks.protegidos, 1);
  assert.strictEqual(origemLinks.motivos.oferta_ativa, 1);
  assert.strictEqual(origemOfertas.elegiveis, 1);
  assert.ok(logs.some(linha => linha.includes("[OPTIMUS-AUTO-CLEAN-V1-SHADOW]")));
  assert.ok(logs.some(linha => linha.includes("[OPTIMUS-AUTO-CLEAN-V1-RESUMO]")));
  assert.ok(!logs.join("\n").includes("http"));
  assert.ok(!logs.join("\n").includes("cupom"));
  assert.ok(!logs.join("\n").includes("preco"));
}

async function testarFailOpenEFlags() {
  const shadowAnterior = process.env.OPTIMUS_AUTO_CLEAN_SHADOW;
  const executeAnterior = process.env.OPTIMUS_AUTO_CLEAN_EXECUTE;
  try {
    delete process.env.OPTIMUS_AUTO_CLEAN_SHADOW;
    delete process.env.OPTIMUS_AUTO_CLEAN_EXECUTE;
    assert.strictEqual(autoCleanShadowAtivo(), false);
    assert.strictEqual(autoCleanExecuteAtivo(), false);
    process.env.OPTIMUS_AUTO_CLEAN_SHADOW = "1";
    assert.strictEqual(autoCleanShadowAtivo(), true);

    const { logger, logs } = capturarLogger();
    const retorno = await executarAutoCleanShadowSeguro({
      shadow: true,
      incluirArquivos: false,
      queryEngine: async () => { throw Object.assign(new Error("falha com https://segredo.test?token=1"), { code: "MOCK" }); },
      logger
    });
    assert.strictEqual(retorno.failOpen, true);
    assert.strictEqual(retorno.aplicouMudancas, false);
    assert.ok(logs.some(linha => linha.includes("[OPTIMUS-AUTO-CLEAN-V1-ERRO]")));
    assert.ok(!logs.join("\n").includes("segredo.test"));
    assert.ok(!logs.join("\n").includes("token"));
  } finally {
    if (shadowAnterior === undefined) delete process.env.OPTIMUS_AUTO_CLEAN_SHADOW;
    else process.env.OPTIMUS_AUTO_CLEAN_SHADOW = shadowAnterior;
    if (executeAnterior === undefined) delete process.env.OPTIMUS_AUTO_CLEAN_EXECUTE;
    else process.env.OPTIMUS_AUTO_CLEAN_EXECUTE = executeAnterior;
  }
}

(async () => {
  await testarTtlEStatus();
  await testarDependenciasProtegidas();
  await testarFilaJsonShadow();
  await testarArquivosProtegidosEShadow();
  await testarMemoriaComercialIntacta();
  await testarPostgresShadowEDependencias();
  await testarFailOpenEFlags();
  console.log("optimus-auto-clean-v1-shadow.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});

