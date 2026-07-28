const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-fidelidade-v1-"));

const obs = require("../modules/fidelidade/observabilidade-v1");
const { montarMensagemOferta } = require("../utils/mensagens-ofertas");
const { renderizarTemplatePersonalizado } = require("../modules/templates-clientes/renderer");
const { criarRadarMirror } = require("../modules/radar/radar-mirror");

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

function parsearLogsFidelidade(logs = []) {
  return logs
    .filter(linha => linha.includes("[FIDELIDADE-V1-"))
    .map(linha => {
      const inicioJson = linha.indexOf("{");
      return JSON.parse(linha.slice(inicioJson));
    });
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
  const semTrace = criarRadarMirror({
    clienteId: "cliente_fid",
    textoOriginal: "Oferta sem trace",
    links: ["https://produto.mercadolivre.com.br/MLB-123456"],
    raw: { key: { id: "3EB0247F557B8785BE77DE" } }
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(semTrace, "fidelidadeTraceId"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(semTrace.origem, "fidelidadeTraceId"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(semTrace.origem, "mensagemId"), false);

  const comTrace = criarRadarMirror({
    clienteId: "cliente_fid",
    textoOriginal: "Oferta com trace",
    links: ["https://produto.mercadolivre.com.br/MLB-123456"],
    raw: { key: { id: "3EB0247F557B8785BE77DE" } },
    fidelidadeTraceId: "fid_f0b74def6d93c6c7",
    mensagemId: "3EB0247F557B8785BE77DE"
  });
  assert.strictEqual(comTrace.fidelidadeTraceId, "fid_f0b74def6d93c6c7");
  assert.strictEqual(comTrace.origem.fidelidadeTraceId, "fid_f0b74def6d93c6c7");
  assert.strictEqual(comTrace.origem.mensagemId, "3EB0247F557B8785BE77DE");
}

{
  const baseSemMensagemId = {
    clienteId: "cliente_fid",
    origemTipo: "whatsapp",
    grupoId: "grupo_ofertas",
    grupoNome: "Grupo Ofertas",
    textoOriginal: "Produto repetido por R$ 10",
    linksExtraidos: ["https://produto.example/oferta"]
  };
  const traceMensagemA = obs.resolverFidelidadeTraceId({
    ...baseSemMensagemId,
    raw: {
      messageTimestamp: 111,
      key: { remoteJid: "grupo_ofertas@g.us", participant: "5511999999999@s.whatsapp.net" }
    }
  });
  const traceMensagemB = obs.resolverFidelidadeTraceId({
    ...baseSemMensagemId,
    raw: {
      messageTimestamp: 112,
      key: { remoteJid: "grupo_ofertas@g.us", participant: "5511999999999@s.whatsapp.net" }
    }
  });
  assert(traceMensagemA.startsWith("fid_"));
  assert(traceMensagemB.startsWith("fid_"));
  assert.notStrictEqual(traceMensagemA, traceMensagemB, "mensagens sem mensagemId nao devem reutilizar trace apenas por texto/link/grupo iguais");
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
  const mensagemId = "3EB0247F557B8785BE77DE";
  const fidelidadeTraceId = obs.resolverFidelidadeTraceId({ mensagemId });
  assert.strictEqual(fidelidadeTraceId, "fid_f0b74def6d93c6c7");

  const oferta = {
    ...clonar(ofertaBase),
    mensagemId,
    fidelidadeTraceId,
    condicaoPix: "Resgate o cupom 50% OFF",
    cupom: "50OFF",
    metadata: {
      fidelidadeTraceId,
      radarMirror: {
        fidelidadeTraceId,
        origem: {
          mensagemId,
          fidelidadeTraceId
        }
      }
    }
  };
  const contexto = { fidelidadeTraceId, mensagemId, clienteId: "cliente_fid", oferta };
  const { logs } = capturarLogs(() => {
    obs.registrarTrace("captura_radar_inicio", contexto);
    obs.registrarSnapshot("origem_capturada", contexto);
    obs.registrarLinks("captura_radar_links", { ...contexto, links: oferta.linksOriginais });
    obs.registrarImagem("captura_radar_imagem", { ...contexto, imagem: oferta.imagem });
    obs.registrarIdentidade("espelho_comercial_saida", contexto);
    obs.registrarPreco("radar_mirror", contexto);
    obs.registrarCupom("radar_mirror", contexto);
    obs.registrarTemplate("template_entrada", { ...contexto, mensagem: "texto renderizado" });
    obs.registrarExecutor("executor_entrada", {
      ...contexto,
      canal: "telegram",
      tipoMidia: "imagem",
      tentativaImagem: true,
      caiuParaTexto: false
    });
  });

  const payloads = parsearLogsFidelidade(logs);
  assert(payloads.length >= 9);
  assert(payloads.every(payload => payload.fidelidadeTraceId === fidelidadeTraceId), "todos os logs da mesma oferta devem usar o mesmo fidelidadeTraceId");

  const chavesCaptura = payloads
    .filter(payload => String(payload.etapa || "").startsWith("captura_radar"))
    .map(payload => payload.etapa);
  assert.deepStrictEqual(chavesCaptura, ["captura_radar_inicio", "captura_radar_links", "captura_radar_imagem"]);
  assert.strictEqual(new Set(chavesCaptura).size, chavesCaptura.length, "etapas captura_radar devem ser diferenciadas para nao parecer duplicidade");
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
