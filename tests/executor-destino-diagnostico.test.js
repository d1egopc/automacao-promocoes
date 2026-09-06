const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const indexPath = path.join(__dirname, "..", "index.js");
const fonte = fs.readFileSync(indexPath, "utf8");

function extrairFuncao(nome) {
  const inicio = fonte.indexOf(`function ${nome}`);
  assert(inicio >= 0, `${nome} deve existir`);
  const assinatura = new RegExp(`function\\s+${nome}\\s*\\([\\s\\S]*?\\)\\s*\\{`).exec(fonte.slice(inicio));
  assert(assinatura, `${nome} deve ter assinatura valida`);
  const abre = inicio + assinatura[0].lastIndexOf("{");
  let profundidade = 0;
  for (let i = abre; i < fonte.length; i += 1) {
    const char = fonte[i];
    if (char === "{") profundidade += 1;
    if (char === "}") profundidade -= 1;
    if (profundidade === 0) return fonte.slice(inicio, i + 1);
  }
  throw new Error(`${nome} sem fechamento`);
}

function contarAnterior({ fila, clienteId = "admin", destino = {}, hoje }) {
  const destinoSeguro = destino || {};
  const nomeDestino = String(destinoSeguro.nome || destinoSeguro.titulo || destinoSeguro.label || destinoSeguro.id || destinoSeguro.conexaoId || "Destino");
  const idDestino = String(destinoSeguro.id || destinoSeguro.conexaoId || destinoSeguro.chatId || "");

  return fila.filter(item => String(item.clienteId || "admin") === String(clienteId))
    .flatMap(item => Array.isArray(item.destinosEnviados) ? item.destinosEnviados : [])
    .filter(envio => {
      const data = String(envio.dataEnvio || envio.data || "");
      if (!data.includes(hoje)) return false;

      const nomeEnvio = String(envio.nome || envio.destino || "");
      const idEnvio = String(envio.id || envio.destinoId || envio.conexaoId || envio.chatId || envio.grupo || "");

      return (
        nomeEnvio === nomeDestino ||
        (idDestino && idEnvio === idDestino)
      );
    }).length;
}

function contarAtual({ fila, clienteId = "admin", destino = {}, hoje }) {
  const logs = [];
  const contexto = {
    fila,
    console: {
      log: (...args) => logs.push(args)
    },
    dataBRHoje: () => hoje,
    destinoOperacionalSeguro: valor => valor || {},
    destinoNomeLog: valor => String(valor.nome || valor.titulo || valor.label || valor.id || valor.conexaoId || "Destino"),
    limiteDiarioDestino: valor => Number(valor.maxPorDia || valor.limiteDiario || 0),
    Set
  };
  contexto.clienteId = clienteId;
  contexto.destino = destino;
  vm.createContext(contexto);
  vm.runInContext(
    `${extrairFuncao("emitirDiagnosticoUnicidadeLimiteDiario")}; ${extrairFuncao("contarEnviosDestinoHoje")}; resultado = contarEnviosDestinoHoje(clienteId, destino);`,
    contexto
  );

  return { usados: contexto.resultado, logs };
}

function contarAtualDuasVezesMesmoProcesso({ fila, clienteId = "admin", destino = {}, hoje }) {
  const logs = [];
  const contexto = {
    fila,
    console: {
      log: (...args) => logs.push(args)
    },
    dataBRHoje: () => hoje,
    destinoOperacionalSeguro: valor => valor || {},
    destinoNomeLog: valor => String(valor.nome || valor.titulo || valor.label || valor.id || valor.conexaoId || "Destino"),
    limiteDiarioDestino: valor => Number(valor.maxPorDia || valor.limiteDiario || 0),
    Set
  };
  contexto.clienteId = clienteId;
  contexto.destino = destino;
  vm.createContext(contexto);
  vm.runInContext(
    `${extrairFuncao("emitirDiagnosticoUnicidadeLimiteDiario")}; ${extrairFuncao("contarEnviosDestinoHoje")}; primeiro = contarEnviosDestinoHoje(clienteId, destino); segundo = contarEnviosDestinoHoje(clienteId, destino);`,
    contexto
  );

  return { primeiro: contexto.primeiro, segundo: contexto.segundo, logs };
}

const hoje = "05/09/2026";
const outroDia = "04/09/2026";
const destino = {
  id: "destino_1",
  nome: "Op Geral Testes",
  tipo: "whatsapp",
  maxPorDia: 1
};

const cenarios = [
  {
    nome: "match somente por nome",
    fila: [{ clienteId: "user_a", status: "enviado", destinosEnviados: [{ nome: destino.nome, id: "outro", dataEnvio: hoje }] }]
  },
  {
    nome: "match somente por id",
    fila: [{ clienteId: "user_a", status: "enviado", destinosEnviados: [{ nome: "Outro Nome", id: destino.id, dataEnvio: hoje }] }]
  },
  {
    nome: "match simultaneo nome e id no mesmo registro",
    fila: [{ clienteId: "user_a", status: "enviado", destinosEnviados: [{ nome: destino.nome, id: destino.id, dataEnvio: hoje }] }]
  },
  {
    nome: "registros de outro cliente",
    fila: [{ clienteId: "user_b", status: "enviado", destinosEnviados: [{ nome: destino.nome, id: destino.id, dataEnvio: hoje }] }]
  },
  {
    nome: "registros de outra data",
    fila: [{ clienteId: "user_a", status: "enviado", destinosEnviados: [{ nome: destino.nome, id: destino.id, dataEnvio: outroDia }] }]
  },
  {
    nome: "multiplos destinosEnviados na mesma oferta",
    fila: [{
      clienteId: "user_a",
      status: "enviado",
      destinosEnviados: [
        { nome: destino.nome, id: "x", dataEnvio: hoje },
        { nome: "Outro Nome", id: destino.id, dataEnvio: hoje },
        { nome: "Nao bate", id: "nao_bate", dataEnvio: hoje }
      ]
    }]
  }
];

for (const cenario of cenarios) {
  const esperado = contarAnterior({ fila: cenario.fila, clienteId: "user_a", destino, hoje });
  const atual = contarAtual({ fila: cenario.fila, clienteId: "user_a", destino, hoje });
  assert.strictEqual(atual.usados, esperado, cenario.nome);
  if (esperado > 0) {
    assert.strictEqual(atual.logs.length, 1, `${cenario.nome}: deve logar uma vez quando usados > 0`);
    assert.strictEqual(atual.logs[0][0], "[EXECUTOR-LIMITE-DIARIO-UNICIDADE]");
  } else {
    assert.strictEqual(atual.logs.length, 0, `${cenario.nome}: nao deve logar quando usados = 0`);
  }
}

const simultaneo = contarAtual({
  fila: [{ clienteId: "user_a", status: "enviado", destinosEnviados: [{ nome: destino.nome, id: destino.id, dataEnvio: hoje }] }],
  clienteId: "user_a",
  destino,
  hoje
});
assert.strictEqual(simultaneo.logs[0][1].matchesTotal, 1);
assert.strictEqual(simultaneo.logs[0][1].assinaturasEstruturaisDuplicadas, 0);

const duplicataEstrutural = contarAtual({
  fila: [
    {
      clienteId: "user_a",
      id: "oferta_1",
      status: "enviado",
      destinosEnviados: [
        { nome: destino.nome, id: destino.id, tipo: "whatsapp", dataEnvio: hoje },
        { nome: destino.nome, id: destino.id, tipo: "whatsapp", dataEnvio: hoje }
      ]
    }
  ],
  clienteId: "user_a",
  destino,
  hoje
});
assert.strictEqual(duplicataEstrutural.usados, 2);
assert.strictEqual(duplicataEstrutural.logs[0][1].assinaturasEstruturaisUnicas, 1);
assert.strictEqual(duplicataEstrutural.logs[0][1].assinaturasEstruturaisDuplicadas, 1);
assert.strictEqual(duplicataEstrutural.logs[0][1].maiorMultiplicidadeEstrutural, 2);

const duplicataSemItemId = contarAtual({
  fila: [
    {
      clienteId: "user_a",
      id: "oferta_1",
      status: "enviado",
      destinosEnviados: [{ nome: destino.nome, id: destino.id, tipo: "whatsapp", dataEnvio: hoje }]
    },
    {
      clienteId: "user_a",
      id: "oferta_2",
      status: "enviado",
      destinosEnviados: [{ nome: destino.nome, id: destino.id, tipo: "whatsapp", dataEnvio: hoje }]
    }
  ],
  clienteId: "user_a",
  destino,
  hoje
});
assert.strictEqual(duplicataSemItemId.usados, 2);
assert.strictEqual(duplicataSemItemId.logs[0][1].assinaturasEstruturaisUnicas, 2);
assert.strictEqual(duplicataSemItemId.logs[0][1].assinaturasEstruturaisDuplicadas, 0);
assert.strictEqual(duplicataSemItemId.logs[0][1].assinaturasSemItemIdUnicas, 1);
assert.strictEqual(duplicataSemItemId.logs[0][1].assinaturasSemItemIdDuplicadas, 1);
assert.strictEqual(duplicataSemItemId.logs[0][1].maiorMultiplicidadeSemItemId, 2);

const datasDiferentes = contarAtual({
  fila: [
    {
      clienteId: "user_a",
      id: "oferta_1",
      status: "enviado",
      destinosEnviados: [
        { nome: destino.nome, id: destino.id, tipo: "whatsapp", dataEnvio: `${hoje} 10:00:00` },
        { nome: destino.nome, id: destino.id, tipo: "whatsapp", dataEnvio: `${hoje} 10:01:00` }
      ]
    }
  ],
  clienteId: "user_a",
  destino,
  hoje
});
assert.strictEqual(datasDiferentes.usados, 2);
assert.strictEqual(datasDiferentes.logs[0][1].assinaturasEstruturaisUnicas, 2);
assert.strictEqual(datasDiferentes.logs[0][1].assinaturasEstruturaisDuplicadas, 0);
assert.strictEqual(datasDiferentes.logs[0][1].assinaturasSemItemIdUnicas, 2);
assert.strictEqual(datasDiferentes.logs[0][1].assinaturasSemItemIdDuplicadas, 0);

const antiSpam = contarAtualDuasVezesMesmoProcesso({
  fila: [
    {
      clienteId: "user_a",
      id: "oferta_1",
      status: "enviado",
      destinosEnviados: [{ nome: destino.nome, id: destino.id, tipo: "whatsapp", dataEnvio: hoje }]
    }
  ],
  clienteId: "user_a",
  destino,
  hoje
});
assert.strictEqual(antiSpam.primeiro, 1);
assert.strictEqual(antiSpam.segundo, 1);
assert.strictEqual(antiSpam.logs.length, 1);
assert.strictEqual(antiSpam.logs[0][0], "[EXECUTOR-LIMITE-DIARIO-UNICIDADE]");

console.log("executor-destino-diagnostico.test.js OK");
