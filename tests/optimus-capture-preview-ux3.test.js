const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const raiz = path.join(__dirname, "..", "optimus-capture");
const painel = fs.readFileSync(path.join(raiz, "sidepanel", "panel.js"), "utf8");
const html = fs.readFileSync(path.join(raiz, "sidepanel", "panel.html"), "utf8");
const contrato = require(path.join(raiz, "core", "product-contract.js"));
const detector = require(path.join(raiz, "core", "marketplace-detector.js"));

function node(id) {
  return {
    id, hidden: false, value: "", textContent: "", src: "", dataset: {},
    listeners: {}, children: [], disabled: false, checked: false,
    addEventListener(tipo, callback) { this.listeners[tipo] = callback; },
    append(...filhos) { this.children.push(...filhos); },
    setAttribute() {},
    focus() {}
  };
}

async function testarPreview(caso) {
  const elementos = new Map();
  const elemento = (id) => {
    if (!elementos.has(id)) elementos.set(id, node(id));
    return elementos.get(id);
  };
  let domReady;
  let capturas = 0;
  let previews = 0;
  let saves = 0;
  let envios = 0;
  let concluirPreview;
  const produto = {
    marketplace: caso.marketplace,
    urlOriginal: caso.url,
    titulo: "Produto original",
    precoAtual: caso.precoAtual ?? 100,
    precoAnterior: 150,
    imagem: "https://example.com/produto.webp",
    ...caso.dados
  };
  const contexto = {
    console, URL, setTimeout, clearTimeout,
    document: {
      hidden: false,
      body: { dataset: {} },
      getElementById: elemento,
      createElement: () => node(""),
      addEventListener(tipo, callback) { if (tipo === "DOMContentLoaded") domReady = callback; }
    },
    chrome: {
      tabs: {
        async query() { return [{ id: 1, url: caso.url }]; },
        async sendMessage() { capturas += 1; return { produto }; },
        onActivated: { addListener() {} },
        onUpdated: { addListener() {} }
      }
    },
    OptimusCaptureAuth: {
      async restaurarSessao() { return { token: "teste", usuario: { nome: "Teste" } }; },
      async sair() {}
    },
    OptimusCaptureApi: {
      async gerarPreviewCapture(_token, payload) {
        previews += 1;
        return new Promise((resolve, reject) => {
          concluirPreview = () => caso.falharPreview
            ? reject(new Error("preview_indisponivel"))
            : resolve({ oferta: { ...payload, urlAfiliada: "https://example.com/afiliado" } });
        });
      },
      async salvarOfertaManualV2() { saves += 1; return { oferta: { id: "salva_1" } }; },
      async listarDestinosManualV2() { return { destinos: [] }; },
      async enviarAgoraManualV2() { envios += 1; return { envio: { enviados: 0 } }; }
    },
    OptimusCaptureContract: contrato,
    OptimusCaptureDetector: detector
  };
  contexto.globalThis = contexto;
  contexto.window = contexto;
  vm.createContext(contexto);
  vm.runInContext(painel, contexto);
  await domReady();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.strictEqual(capturas, 1, caso.marketplace);
  assert.strictEqual(previews, 1, caso.marketplace);
  assert.strictEqual(elemento("produtoView").hidden, false, "formulario visivel antes da conversao");
  assert.strictEqual(elemento("previewView").hidden, false);
  assert.strictEqual(elemento("previewMarketplace").textContent, caso.label);
  assert.strictEqual(elemento("previewPrecoAtual").textContent, caso.precoEsperado);
  assert.strictEqual(elemento("previewLinkLinha").hidden, true, "link ainda nao aprovado nao aparece");
  assert.strictEqual(elemento("botaoSalvar").disabled, true, "save aguarda preview aprovado");
  assert.strictEqual(elemento("botaoEnviar").disabled, true, "envio aguarda preview aprovado");
  assert.strictEqual(elemento("botaoLista").disabled, true, "lista aguarda preview aprovado");
  concluirPreview();
  await new Promise((resolve) => setTimeout(resolve, 20));
  if (caso.falharPreview) {
    assert.strictEqual(elemento("produtoView").hidden, false);
    assert.strictEqual(elemento("previewView").hidden, false, "falha nao esconde a previa basica");
    assert.strictEqual(elemento("previewLinkLinha").hidden, true);
    assert.strictEqual(elemento("botaoSalvar").disabled, true);
    assert.strictEqual(elemento("botaoEnviar").disabled, true);
    assert.strictEqual(elemento("botaoLista").disabled, true);
    return;
  }
  assert.strictEqual(elemento("previewLinkLinha").hidden, false);
  if (caso.avaliacao) assert.strictEqual(elemento("previewAvaliacao").textContent, caso.avaliacao);
  if (caso.taxa) assert.strictEqual(elemento("previewTaxa").textContent, caso.taxa);
  if (caso.parcelamento) assert.strictEqual(elemento("previewParcelamento").textContent, caso.parcelamento);

  elemento("campoTitulo").value = "Produto editado";
  elemento("campoTitulo").listeners.input();
  assert.strictEqual(elemento("previewTitulo").textContent, "Produto editado");
  assert.strictEqual(elemento("previewLinkLinha").hidden, true);
  if (caso.marketplace !== "shopee") {
    elemento("campoPrecoAtual").value = "R$ 90,00";
    elemento("campoPrecoAtual").listeners.input();
    assert.strictEqual(elemento("previewPrecoAtual").textContent, "R$ 90,00");
  } else {
    assert.strictEqual(elemento("previewPrecoAtual").textContent, "A partir de R$ 67,99");
  }
  assert.strictEqual(capturas, 1, "render local nao recaptura");
  assert.strictEqual(previews, 1, "render local nao antecipa request");
  assert.strictEqual(saves, 0);
  assert.strictEqual(envios, 0);
}

async function main() {
  assert.ok(html.includes("Prévia padrão. O envio final segue o template do destino."));
  const casos = [
    { marketplace: "mercadolivre", label: "Mercado Livre", url: "https://produto.mercadolivre.com.br/MLB-123456-produto-_JM", precoEsperado: "R$ 100,00" },
    { marketplace: "amazon", label: "Amazon", url: "https://www.amazon.com.br/dp/B0G2T13LT6", precoEsperado: "R$ 100,00" },
    { marketplace: "shopee", label: "Shopee", url: "https://shopee.com.br/product/123456/555555", precoAtual: null, precoEsperado: "A partir de R$ 67,99", dados: { precoMin: 67.99, precoMax: 99.99, temVariacaoPreco: true } },
    { marketplace: "aliexpress", label: "AliExpress", url: "https://pt.aliexpress.com/item/1005000000000001.html", precoEsperado: "R$ 100,00", taxa: "Imposto/taxas: R$ 23,83", dados: { taxa: 23.83, observacoes: "Compra internacional" } },
    { marketplace: "magalu", label: "Magalu", url: "https://www.magazineluiza.com.br/produto/p/123456", precoEsperado: "R$ 100,00", avaliacao: "Avaliação: 4.7", dados: { avaliacao: 4.7 } },
    { marketplace: "kabum", label: "KaBuM", url: "https://www.kabum.com.br/produto/619753/monitor", precoEsperado: "R$ 100,00", parcelamento: "10x R$ 12,00", dados: { condicaoPrecoPor: "pix", parcelamento: "10x R$ 12,00" } }
  ];
  for (const caso of casos) await testarPreview(caso);
  await testarPreview({ ...casos[0], falharPreview: true });
  console.log("optimus-capture-preview-ux3.test.js: PASS (6 marketplaces + falha de conversao)");
}

main().catch((erro) => { console.error(erro); process.exitCode = 1; });
