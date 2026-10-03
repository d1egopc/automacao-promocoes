const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const raiz = path.join(__dirname, "..", "optimus-capture");
const panelFonte = fs.readFileSync(path.join(raiz, "sidepanel", "panel.js"), "utf8");
const apiFonte = fs.readFileSync(path.join(raiz, "services", "api.js"), "utf8");
const panelHtml = fs.readFileSync(path.join(raiz, "sidepanel", "panel.html"), "utf8");
const contrato = require(path.join(raiz, "core", "product-contract.js"));
const detector = require(path.join(raiz, "core", "marketplace-detector.js"));

function criarNode(id = "") {
  const node = {
    id,
    hidden: false,
    textContent: "",
    value: "",
    src: "",
    disabled: false,
    checked: false,
    dataset: {},
    title: "",
    type: "",
    name: "",
    className: "",
    children: [],
    listeners: {},
    addEventListener(evento, callback) { this.listeners[evento] = callback; },
    append(...itens) { this.children.push(...itens); },
    setAttribute() {},
    focus() { this.focused = true; }
  };
  Object.defineProperty(node, "innerHTML", {
    get() { return this._innerHTML || ""; },
    set(valor) { this._innerHTML = String(valor || ""); this.children = []; }
  });
  return node;
}

async function executar() {
  assert.ok(panelHtml.includes('id="botaoLista"'));
  assert.ok(panelHtml.includes('id="listaModal"'));
  assert.ok(apiFonte.includes('body: { origem: "ofertas", ofertaId: texto(ofertaId) }'));
  assert.ok(apiFonte.includes('body: { origem: "captura_extensao", oferta }'));

  const requests = [];
  const apiContexto = {
    setTimeout,
    clearTimeout,
    fetch: async (url, opcoes = {}) => {
      requests.push({ url, opcoes });
      return { ok: true, status: 200,
        async json() { return { ok: true, listas: [], lista: { id: "nova" } }; } };
    }
  };
  apiContexto.globalThis = apiContexto;
  apiContexto.window = apiContexto;
  vm.createContext(apiContexto);
  vm.runInContext(apiFonte, apiContexto);
  await apiContexto.OptimusCaptureApi.listarListasManualV2("jwt");
  await apiContexto.OptimusCaptureApi.criarListaManualV2("jwt", "OFERTAS TECH");
  await apiContexto.OptimusCaptureApi.adicionarOfertaListaManualV2("jwt", "lista/1", "oferta_1");
  await apiContexto.OptimusCaptureApi.adicionarCapturaListaManualV2("jwt", "lista/1", { titulo: "Captura" });
  assert.ok(requests[0].url.startsWith("https://go.optimuspromo.com.br/manual-v2/listas?_="));
  assert.strictEqual(requests[1].url, "https://go.optimuspromo.com.br/manual-v2/listas");
  assert.strictEqual(requests[1].opcoes.method, "POST");
  assert.strictEqual(requests[1].opcoes.body, JSON.stringify({ nome: "OFERTAS TECH" }));
  assert.strictEqual(requests[2].url, "https://go.optimuspromo.com.br/manual-v2/listas/lista%2F1/itens");
  assert.strictEqual(requests[2].opcoes.body, JSON.stringify({ origem: "ofertas", ofertaId: "oferta_1" }));
  assert.strictEqual(requests[2].opcoes.headers.authorization, "Bearer jwt");
  assert.strictEqual(requests[3].opcoes.body, JSON.stringify({
    origem: "captura_extensao", oferta: { titulo: "Captura" }
  }));

  const elementos = new Map();
  const elemento = (id) => {
    if (!elementos.has(id)) elementos.set(id, criarNode(id));
    return elementos.get(id);
  };
  let domReady;
  let capturas = 0;
  let previews = 0;
  let saves = 0;
  let listagens = 0;
  let criacoes = 0;
  let adicoes = 0;
  let envios = 0;
  let duplicar = false;
  let falharAdicao = false;
  const payloadsAdicao = [];
  const ofertasSalvas = [];
  const produto = {
    marketplace: "aliexpress",
    urlOriginal: "https://pt.aliexpress.com/item/1005000000000001.html",
    titulo: "Produto editavel",
    precoAtual: 117,
    imagem: "https://ae01.alicdn.com/kf/produto.jpg",
    observacoes: "Produto ja no Brasil",
    completo: true
  };

  const contexto = {
    console,
    setTimeout,
    clearTimeout,
    document: {
      hidden: false,
      body: { dataset: {} },
      getElementById: elemento,
      createElement: () => criarNode(),
      addEventListener(evento, callback) {
        if (evento === "DOMContentLoaded") domReady = callback;
      }
    },
    chrome: {
      tabs: {
        async query() { return [{ id: 1, url: produto.urlOriginal }]; },
        async sendMessage() { capturas += 1; return { produto }; },
        onActivated: { addListener() {} },
        onUpdated: { addListener() {} }
      }
    },
    OptimusCaptureAuth: {
      async restaurarSessao() { return { token: "jwt", usuario: { nome: "DiegoPC" } }; },
      async sair() {}
    },
    OptimusCaptureApi: {
      async gerarPreviewCapture(_token, payload) {
        previews += 1;
        return { oferta: { ...payload, urlAfiliada: "https://s.click.aliexpress.com/e/teste" } };
      },
      async salvarOfertaManualV2(_token, oferta) {
        saves += 1;
        ofertasSalvas.push(oferta);
        return { oferta: { id: "oferta_1" } };
      },
      async listarListasManualV2() {
        listagens += 1;
        return { listas: [{ id: "lista_2", nome: "SEGUNDA OP" }] };
      },
      async criarListaManualV2(_token, nome) {
        criacoes += 1;
        return { lista: { id: "lista_nova", nome } };
      },
      async adicionarOfertaListaManualV2() {
        throw new Error("origem_ofertas_nao_deve_ser_usada_pela_extensao");
      },
      async adicionarCapturaListaManualV2(_token, listaId, oferta) {
        adicoes += 1;
        payloadsAdicao.push({ listaId, oferta });
        if (duplicar) {
          const erro = new Error("item_ja_na_lista");
          erro.status = 409;
          throw erro;
        }
        if (falharAdicao) {
          const erro = new Error("rede_indisponivel");
          erro.status = 503;
          throw erro;
        }
        return { ok: true };
      },
      async listarDestinosManualV2() { return { destinos: [] }; },
      async enviarAgoraManualV2() { envios += 1; return { envio: { enviados: 0, erros: 0 } }; }
    },
    OptimusCaptureContract: contrato,
    OptimusCaptureDetector: detector
  };
  contexto.globalThis = contexto;
  contexto.window = contexto;
  vm.createContext(contexto);
  vm.runInContext(panelFonte, contexto);

  await domReady();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.strictEqual(previews, 1);
  assert.strictEqual(capturas, 1);
  assert.strictEqual(listagens, 0, "listas nao carregam na abertura da extensao");
  assert.strictEqual(elemento("botaoLista").hidden, false);

  elemento("campoTitulo").value = "Titulo editado";
  elemento("campoPrecoAtual").value = "R$ 118,00";
  elemento("campoCupom").value = "BRCD1";
  elemento("campoObservacoes").value = "Brasil sem imposto adicional";
  elemento("campoParcelamento").value = "10x sem juros";
  elemento("campoTitulo").listeners.input();
  elemento("campoPrecoAtual").listeners.input();
  elemento("campoCupom").listeners.input();
  elemento("campoObservacoes").listeners.input();
  elemento("campoParcelamento").listeners.input();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const camposEditados = ["campoTitulo", "campoPrecoAtual", "campoCupom", "campoObservacoes", "campoParcelamento"];
  const formularioAntes = camposEditados.map((id) => elemento(id).value);

  await elemento("botaoLista").listeners.click();
  assert.strictEqual(listagens, 1, "listas carregam somente no clique");
  assert.strictEqual(elemento("listaModal").hidden, false);
  const radio = elemento("listasDisponiveis").children[0].children[0];
  radio.checked = true;
  radio.listeners.change();
  await elemento("adicionarListaExistente").listeners.click();
  assert.strictEqual(saves, 0, "+ Lista nao cria Oferta implicita");
  assert.strictEqual(adicoes, 1);
  assert.strictEqual(payloadsAdicao[0].listaId, "lista_2");
  assert.strictEqual(payloadsAdicao[0].oferta.titulo, "Titulo editado");
  assert.strictEqual(payloadsAdicao[0].oferta.precoAtual, 118);
  assert.strictEqual(payloadsAdicao[0].oferta.cupom, "BRCD1");
  assert.strictEqual(payloadsAdicao[0].oferta.observacoes, "Brasil sem imposto adicional");
  assert.strictEqual(payloadsAdicao[0].oferta.parcelamento, "10x sem juros");
  assert.strictEqual(payloadsAdicao[0].oferta.urlAfiliada, "https://s.click.aliexpress.com/e/teste");
  assert.strictEqual(elemento("listaModalFeedback").textContent, "Adicionado à SEGUNDA OP");
  assert.deepStrictEqual(camposEditados.map((id) => elemento(id).value), formularioAntes);
  assert.strictEqual(capturas, 1, "adicionar a lista nao recaptura marketplace");
  assert.strictEqual(previews, 2, "adicionar a lista nao refaz preview alem da atualizacao normal das edicoes");

  duplicar = true;
  await elemento("adicionarListaExistente").listeners.click();
  assert.strictEqual(saves, 0, "duplicidade nao persiste Oferta orfa");
  assert.strictEqual(adicoes, 2);
  assert.strictEqual(elemento("listaModalFeedback").textContent, "Esta oferta ja esta nesta lista");
  duplicar = false;

  elemento("abrirCriarLista").listeners.click();
  elemento("nomeNovaLista").value = "OFERTAS TECH";
  await elemento("criarEAdicionarLista").listeners.click();
  assert.strictEqual(criacoes, 1);
  assert.strictEqual(adicoes, 3);
  assert.strictEqual(saves, 0);
  assert.strictEqual(payloadsAdicao[2].listaId, "lista_nova");
  assert.strictEqual(payloadsAdicao[2].oferta.titulo, "Titulo editado");
  assert.strictEqual(elemento("listaModalFeedback").textContent, 'Lista "OFERTAS TECH" criada e oferta adicionada');
  assert.strictEqual(envios, 0, "+ Lista nao dispara envio nem consome credito");

  falharAdicao = true;
  elemento("nomeNovaLista").value = "LISTA SEM ITEM";
  await elemento("criarEAdicionarLista").listeners.click();
  assert.strictEqual(criacoes, 2);
  assert.strictEqual(elemento("listaModalFeedback").textContent, 'Lista "LISTA SEM ITEM" criada, mas a oferta nao foi adicionada.');
  await elemento("voltarListas").listeners.click();
  await elemento("adicionarListaExistente").listeners.click();
  assert.strictEqual(elemento("listaModalFeedback").textContent, "Nao foi possivel adicionar a oferta.");
  assert.deepStrictEqual(camposEditados.map((id) => elemento(id).value), formularioAntes);
  falharAdicao = false;

  elemento("fecharListaModal").listeners.click();
  assert.strictEqual(elemento("listaModal").hidden, true);
  assert.deepStrictEqual(camposEditados.map((id) => elemento(id).value), formularioAntes);
  await elemento("botaoSalvar").listeners.click();
  assert.strictEqual(saves, 1, "Salvar no Optimus continua sendo a unica acao que cria a Oferta");
  assert.strictEqual(ofertasSalvas[0].titulo, "Titulo editado");
  assert.ok(elemento("botaoSalvar").listeners.click, "Salvar no Optimus permanece ligado");
  assert.ok(elemento("botaoEnviar").listeners.click, "Enviar agora permanece ligado");
}

executar().then(() => {
  console.log("optimus-capture-listas-ux.test.js: PASS");
}).catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
