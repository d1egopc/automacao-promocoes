const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-fidelidade-v1-"));

const obs = require("../modules/fidelidade/observabilidade-v1");
const { montarMensagemOferta } = require("../utils/mensagens-ofertas");
const { renderizarTemplatePersonalizado } = require("../modules/templates-clientes/renderer");

function clonar(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function capturarLogs(fn) {
  const original = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.map(String).join(" "));
  try {
    const retorno = fn();
    return { logs, retorno };
  } finally {
    console.log = original;
  }
}

const ofertaBase = {
  id: "oferta_teste_fid",
  clienteId: "cliente_fid",
  marketplace: "mercadolivre",
  titulo: "Kit 2 Cameras Icsee",
  preco: 123,
  precoAtual: 123,
  precoOriginal: 158,
  cupom: "USAESSAPROMO",
  linkOriginal: "https://produto.mercadolivre.com.br/MLB-123456?tracking=segredo",
  linkAfiliado: "https://go.optimus.test/cliente_fid/mlb123456?token=segredo",
  linkResgate: "https://www.mercadolivre.com.br/cupons?secret=abc",
  imagem: "https://cdn.exemplo.com/produto.jpg",
  linksOriginais: [
    "https://www.mercadolivre.com.br/cupons?secret=abc",
    "https://produto.mercadolivre.com.br/MLB-123456?tracking=segredo"
  ]
};

{
  delete process.env.FIDELIDADE_OBSERVABILIDADE_ENABLED;
  const { logs, retorno } = capturarLogs(() => obs.registrarSnapshot("teste_desligado", { oferta: ofertaBase }));
  assert.strictEqual(retorno, false);
  assert.deepStrictEqual(logs, []);
}

{
  process.env.FIDELIDADE_OBSERVABILIDADE_ENABLED = "1";
  const oferta = {
    ...ofertaBase,
    imagem: "data:image/jpeg;base64,AAAABBBBCCCCDDDDEEEEFFFF"
  };
  const copia = clonar(oferta);
  const { logs, retorno } = capturarLogs(() => {
    obs.registrarSnapshot("teste_data_uri", { oferta });
    return obs.registrarImagem("teste_data_uri", { oferta, imagem: oferta.imagem });
  });
  assert.strictEqual(retorno, true);
  assert.deepStrictEqual(oferta, copia, "observabilidade nao deve mutar a oferta");
  assert(logs.some(linha => linha.includes("[FIDELIDADE-V1-SNAPSHOT]")));
  assert(logs.some(linha => linha.includes("[FIDELIDADE-V1-IMAGEM]")));
  assert(logs.some(linha => linha.includes("data_uri")));
  assert(!logs.join("\n").includes("AAAABBBBCCCCDDDDEEEEFFFF"), "log nao deve vazar base64 completo");
}

{
  const traceA = obs.resolverFidelidadeTraceId({ id: "oferta_123", clienteId: "cliente_a" });
  const traceB = obs.resolverFidelidadeTraceId({ id: "oferta_123", clienteId: "cliente_a" });
  assert.strictEqual(traceA, traceB);
  assert(traceA.startsWith("fid_"));
}

{
  const links = obs.linksDaOferta(ofertaBase);
  assert.strictEqual(links.length, 3);
  assert(links.some(item => item.url.includes("?[params]")));
  assert(links.every(item => !item.url.includes("secret=abc") && !item.url.includes("token=segredo")));
}

{
  assert.strictEqual(obs.suspeitaCupomContaminado("ABAIXODOPRECODOPRODUTO_"), true);
  assert.strictEqual(obs.suspeitaCupomContaminado("USAESSAPROMO"), false);
}

{
  const oferta = clonar(ofertaBase);
  delete process.env.FIDELIDADE_OBSERVABILIDADE_ENABLED;
  const mensagemSemFlag = montarMensagemOferta(oferta, { clienteId: "cliente_fid" });
  const copiaDepoisSemFlag = clonar(oferta);

  process.env.FIDELIDADE_OBSERVABILIDADE_ENABLED = "1";
  const { logs, retorno: mensagemComFlag } = capturarLogs(() => montarMensagemOferta(oferta, { clienteId: "cliente_fid" }));

  assert.strictEqual(mensagemComFlag, mensagemSemFlag, "observabilidade nao deve mudar texto final");
  assert.deepStrictEqual(oferta, copiaDepoisSemFlag, "observabilidade nao deve mutar oferta no template");
  assert(logs.some(linha => linha.includes("[FIDELIDADE-V1-TEMPLATE]")));
  assert.strictEqual(oferta.imagem, ofertaBase.imagem, "observabilidade nao deve mudar imagem final");
  assert.strictEqual(oferta.linksOriginais.length, ofertaBase.linksOriginais.length, "observabilidade nao deve mudar links");
}

{
  const template = {
    id: "template_fid",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "titulo", ativo: true, ordem: 1 },
      { tipo: "preco_por", ativo: true, ordem: 2 },
      { tipo: "cupom", ativo: true, ordem: 3 },
      { tipo: "link", ativo: true, ordem: 4 }
    ],
    rodape: { ativo: false, texto: "" }
  };
  const oferta = clonar(ofertaBase);
  delete process.env.FIDELIDADE_OBSERVABILIDADE_ENABLED;
  const semFlag = renderizarTemplatePersonalizado({ oferta, template, canal: "whatsapp" });

  process.env.FIDELIDADE_OBSERVABILIDADE_ENABLED = "1";
  const { logs, retorno: comFlag } = capturarLogs(() => renderizarTemplatePersonalizado({ oferta, template, canal: "whatsapp" }));

  assert.deepStrictEqual(comFlag, semFlag, "observabilidade nao deve mudar renderer personalizado");
  assert(logs.some(linha => linha.includes("[FIDELIDADE-V1-TEMPLATE]")));
}

{
  process.env.FIDELIDADE_OBSERVABILIDADE_ENABLED = "1";
  const { logs } = capturarLogs(() => obs.registrarExecutor("executor_entrada", {
    canal: "telegram",
    oferta: { ...ofertaBase, imagem: "" },
    tipoMidia: "imagem",
    caiuParaTexto: true,
    motivoTecnico: "imagem_ausente"
  }));
  const combinado = logs.join("\n");
  assert(combinado.includes("[FIDELIDADE-V1-EXECUTOR]"));
  assert(combinado.includes("executor_entrada"));
  assert(combinado.includes("imagem_ausente"));
  assert(combinado.includes("caiuParaTexto"));
}

delete process.env.FIDELIDADE_OBSERVABILIDADE_ENABLED;

console.log("fidelidade-observabilidade-v1.test.js OK");
