const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-mensageiro-programacoes-"));
process.env.DATA_DIR = dataDir;

const { writeGlobalJson } = require("../utils/storage");
const storage = require("../modules/mensageiro/storage");
const scheduler = require("../modules/mensageiro/programacoes.scheduler");

writeGlobalJson("usuarios.json", [{ id: "cliente_prog", ativo: true }]);

function criarSock({ falharGrupos = [] } = {}) {
  const envios = [];
  return {
    envios,
    async sendMessage(jid, payload) {
      envios.push({ jid, payload });
      if (falharGrupos.includes(jid)) throw new Error(`falha_${jid}`);
      return { key: { remoteJid: jid, id: `prog_${envios.length}`, fromMe: true } };
    }
  };
}

function baseProgramacao(patch = {}) {
  const programacao = {
    id: patch.id || "prog_1",
    ativo: patch.ativo === undefined ? true : patch.ativo,
    nome: patch.nome || "Bom dia",
    tipo: patch.tipo || "intervalo",
    grupos: patch.grupos === undefined ? ["grupo_1@g.us"] : patch.grupos,
    horario: patch.horario || "08:00",
    data: patch.data || "",
    intervaloMinutos: patch.intervaloMinutos === undefined ? 30 : patch.intervaloMinutos,
    janelaInicio: patch.janelaInicio || "",
    janelaFim: patch.janelaFim || "",
    timezone: "America/Sao_Paulo",
    conteudos: patch.conteudos || [{ id: "c1", tipo: "texto", texto: "Oi", imagem: "" }],
    indiceAtual: patch.indiceAtual || 0,
    nextRunAt: patch.nextRunAt || "",
    ultimoEnvioEm: "",
    processandoEm: patch.processandoEm || "",
    lockAte: patch.lockAte || "",
    status: patch.status || "pendente"
  };
  if (patch.gruposConfigurados !== undefined) programacao.gruposConfigurados = patch.gruposConfigurados;
  return programacao;
}

function configurar(programacoes, extras = {}) {
  storage.setMensageiroCliente("cliente_prog", {
    ativo: true,
    sessaoId: "sessao_prog",
    sessaoWhatsappId: "sessao_prog",
    sessaoGruposId: "sessao_prog",
    grupos: ["grupo_1@g.us", "grupo_2@g.us", "grupo_3@g.us"],
    programacoes,
    ...extras
  });
}

async function rodar({ sock = criarSock(), status = "open", agora = new Date("2026-08-24T12:00:00-03:00") } = {}) {
  await scheduler.rodarProgramacoesMensageiroPendentes({
    agora,
    getSock: () => sock,
    getStatusSessao: () => status
  });
  return sock;
}

function forcarDue(id, nextRunAt = "2026-08-24T14:59:00.000Z") {
  const config = storage.getMensageiroCliente("cliente_prog");
  storage.setMensageiroCliente("cliente_prog", {
    programacoes: config.programacoes.map((programacao) =>
      programacao.id === id ? { ...programacao, nextRunAt } : programacao
    )
  });
}

(async () => {
  configurar([baseProgramacao({ ativo: false, nextRunAt: "2026-08-24T14:59:00.000Z" })]);
  let sock = await rodar();
  assert.strictEqual(sock.envios.length, 0, "programacao inativa nao envia");

  configurar([baseProgramacao({ nextRunAt: "2026-08-24T16:00:00.000Z" })]);
  sock = await rodar();
  assert.strictEqual(sock.envios.length, 0, "horario futuro nao envia");

  configurar([baseProgramacao({ id: "due", nextRunAt: "2026-08-24T14:59:00.000Z" })]);
  sock = await rodar();
  assert.strictEqual(sock.envios.length, 1, "horario vencido dentro da tolerancia envia");
  await rodar({ sock });
  assert.strictEqual(sock.envios.length, 1, "nao envia duas vezes a mesma ocorrencia");

  configurar([baseProgramacao({ id: "daily", tipo: "horario", horario: "08:00", nextRunAt: "2026-08-24T14:59:00.000Z" })]);
  await rodar();
  let prog = storage.getMensageiroCliente("cliente_prog").programacoes.find((p) => p.id === "daily");
  assert.ok(prog.nextRunAt.startsWith("2026-08-25T11:00:00"), "horario fixo calcula proximo dia corretamente");

  configurar([baseProgramacao({ id: "data", tipo: "horario", data: "2026-08-24", horario: "12:00", nextRunAt: "2026-08-24T14:59:00.000Z" })]);
  sock = await rodar();
  prog = storage.getMensageiroCliente("cliente_prog").programacoes.find((p) => p.id === "data");
  assert.strictEqual(sock.envios.length, 1, "data especifica valida envia");
  assert.strictEqual(prog.nextRunAt, "", "data especifica nao agenda repeticao");
  assert.strictEqual(prog.status, "concluida", "data especifica conclui");

  configurar([baseProgramacao({ id: "piso", intervaloMinutos: 1 })]);
  prog = storage.getMensageiroCliente("cliente_prog").programacoes.find((p) => p.id === "piso");
  assert.strictEqual(prog.intervaloMinutos, 10, "intervalo respeita piso minimo");

  configurar([baseProgramacao({ id: "intervalo", intervaloMinutos: 15, nextRunAt: "2026-08-24T14:59:00.000Z" })]);
  await rodar();
  prog = storage.getMensageiroCliente("cliente_prog").programacoes.find((p) => p.id === "intervalo");
  assert.ok(prog.nextRunAt.startsWith("2026-08-24T15:15:00"), "intervalo calcula nextRunAt");

  configurar([baseProgramacao({ id: "janela", nextRunAt: "2026-08-24T09:59:00.000Z", janelaInicio: "08:00", janelaFim: "22:00" })]);
  sock = await rodar({ agora: new Date("2026-08-24T07:00:00-03:00") });
  assert.strictEqual(sock.envios.length, 0, "janela bloqueia fora do periodo");
  prog = storage.getMensageiroCliente("cliente_prog").programacoes.find((p) => p.id === "janela");
  assert.ok(prog.nextRunAt.startsWith("2026-08-24T11:00:00"), "fora da janela calcula proximo inicio");

  const programacaoLegadaSemGrupos = baseProgramacao({ id: "grupo_bloqueado", nextRunAt: "2026-08-24T14:59:00.000Z" });
  delete programacaoLegadaSemGrupos.grupos;
  configurar([programacaoLegadaSemGrupos], { grupos: ["grupo_1@g.us"] });
  sock = await rodar();
  assert.deepStrictEqual(sock.envios.map((e) => e.jid), ["grupo_1@g.us"], "propriedade ausente usa fallback legado");

  configurar([baseProgramacao({ id: "grupo_vazio", grupos: [], gruposConfigurados: true, nextRunAt: "2026-08-24T14:59:00.000Z" })], { grupos: ["grupo_1@g.us"] });
  sock = await rodar();
  assert.strictEqual(sock.envios.length, 0, "programacao.grupos=[] explicito nao envia");

  configurar([baseProgramacao({ id: "grupo_proprio", grupos: ["grupo_2@g.us"], gruposConfigurados: true, nextRunAt: "2026-08-24T14:59:00.000Z" })], { grupos: ["grupo_1@g.us"] });
  sock = await rodar();
  assert.deepStrictEqual(sock.envios.map((e) => e.jid), ["grupo_2@g.us"], "programacao.grupos proprio nao depende de config.grupos");

  configurar([baseProgramacao({ id: "multi", grupos: ["grupo_1@g.us", "grupo_2@g.us"], nextRunAt: "2026-08-24T14:59:00.000Z" })]);
  sock = await rodar();
  assert.deepStrictEqual(sock.envios.map((e) => e.jid), ["grupo_1@g.us", "grupo_2@g.us"], "multiplos grupos recebem uma vez cada");

  configurar([baseProgramacao({ id: "offline", nextRunAt: "2026-08-24T14:59:00.000Z" })]);
  sock = await rodar({ status: "closed" });
  assert.strictEqual(sock.envios.length, 0, "sessao offline nao envia");

  configurar([baseProgramacao({ id: "texto", nextRunAt: "2026-08-24T14:59:00.000Z", conteudos: [{ id: "c", tipo: "texto", texto: "Texto", imagem: "" }] })]);
  sock = await rodar();
  assert.deepStrictEqual(sock.envios[0].payload, { text: "Texto" }, "texto envia corretamente");

  configurar([baseProgramacao({ id: "imagem", nextRunAt: "2026-08-24T14:59:00.000Z", conteudos: [{ id: "c", tipo: "imagem", texto: "", imagem: "https://cdn/img.jpg" }] })]);
  sock = await rodar();
  assert.deepStrictEqual(sock.envios[0].payload, { image: { url: "https://cdn/img.jpg" } }, "imagem envia corretamente");

  const base64 = `data:image/png;base64,${Buffer.from("fake").toString("base64")}`;
  configurar([baseProgramacao({ id: "imagem_texto", nextRunAt: "2026-08-24T14:59:00.000Z", conteudos: [{ id: "c", tipo: "imagem_texto", texto: "Legenda", imagem: base64 }] })]);
  sock = await rodar();
  assert.ok(Buffer.isBuffer(sock.envios[0].payload.image), "imagem base64 vira buffer");
  assert.strictEqual(sock.envios[0].payload.caption, "Legenda", "imagem+texto envia caption");

  configurar([baseProgramacao({
    id: "rotacao",
    nextRunAt: "2026-08-24T14:59:00.000Z",
    conteudos: [
      { id: "a", tipo: "texto", texto: "A", imagem: "" },
      { id: "b", tipo: "texto", texto: "B", imagem: "" },
      { id: "c", tipo: "texto", texto: "C", imagem: "" }
    ]
  })]);
  sock = criarSock();
  for (let i = 0; i < 4; i += 1) {
    await rodar({ sock });
    forcarDue("rotacao");
  }
  assert.deepStrictEqual(sock.envios.map((e) => e.payload.text), ["A", "B", "C", "A"], "rotacao A -> B -> C -> A");
  prog = storage.getMensageiroCliente("cliente_prog").programacoes.find((p) => p.id === "rotacao");
  assert.strictEqual(prog.indiceAtual, 1, "indiceAtual persiste apos rotacao");

  configurar([baseProgramacao({ id: "atrasada", nextRunAt: "2026-08-24T14:00:00.000Z" })]);
  sock = await rodar();
  assert.strictEqual(sock.envios.length, 0, "atraso grande nao gera backlog");
  assert.ok(storage.getAtendimentoConfigCliente("cliente_prog").historico.some((e) => e.status === "pulada_restart"), "historico registra ocorrencia pulada");

  configurar([baseProgramacao({ id: "lock", nextRunAt: "2026-08-24T14:59:00.000Z", lockAte: "2026-08-24T15:10:00.000Z" })]);
  sock = await rodar();
  assert.strictEqual(sock.envios.length, 0, "lock impede execucao concorrente");

  configurar([baseProgramacao({ id: "falha_grupo", grupos: ["grupo_1@g.us", "grupo_2@g.us"], nextRunAt: "2026-08-24T14:59:00.000Z" })]);
  sock = await rodar({ sock: criarSock({ falharGrupos: ["grupo_1@g.us"] }) });
  assert.strictEqual(sock.envios.length, 2, "falha de um grupo nao derruba scheduler");

  configurar([
    baseProgramacao({ id: "p1", grupos: ["grupo_1@g.us"], nextRunAt: "2026-08-24T14:59:00.000Z" }),
    baseProgramacao({ id: "p2", grupos: ["grupo_2@g.us"], nextRunAt: "2026-08-24T14:59:00.000Z" })
  ]);
  sock = await rodar({ sock: criarSock({ falharGrupos: ["grupo_1@g.us"] }) });
  assert.ok(sock.envios.some((e) => e.jid === "grupo_2@g.us"), "falha de uma programacao nao impede as outras");
  assert.ok(storage.getAtendimentoConfigCliente("cliente_prog").historico.some((e) => e.tipo === "programacao" && e.status === "enviado"), "historico registra envio");

  const antiga = storage.setMensageiroCliente("cliente_antigo_prog", { ativo: true });
  assert.deepStrictEqual(antiga.programacoes, [], "config antiga sem programacoes continua valida");

  console.log("mensageiro-programacoes.test.cjs OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
