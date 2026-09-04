(function iniciarPainel(global) {
  const auth = global.OptimusCaptureAuth;
  const api = global.OptimusCaptureApi;
  const contrato = global.OptimusCaptureContract;
  const detector = global.OptimusCaptureDetector;

  const el = (id) => document.getElementById(id);
  const state = {
    auth: null,
    produto: null,
    enviandoPreview: false,
    conectando: false,
    capturaInicialExecutada: false,
    capturando: false,
    capturaTimer: null,
    eventosAbasRegistrados: false,
    ultimaUrlCapturada: "",
    ultimoPreviewKey: "",
    previewOferta: null,
    previewKey: "",
    salvandoOferta: false,
    ofertaSalvaId: "",
    previewSalvoKey: ""
  };

  function setTexto(id, valor) {
    const node = el(id);
    if (node) node.textContent = String(valor || "");
  }

  function setHidden(id, hidden) {
    const node = el(id);
    if (node) node.hidden = hidden;
  }

  function valor(id) {
    return el(id)?.value || "";
  }

  const formatadorMoedaPtBr = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  });

  function formatarMoeda(valorBruto) {
    const numero = contrato.precoNumero(valorBruto);
    if (!numero) return "";
    return formatadorMoedaPtBr.format(numero).replace(/[\u00a0\u202f]/g, " ");
  }

  function chavePreview(produto = {}) {
    return [
      produto.urlOriginal || "",
      produto.titulo || "",
      produto.precoAtual || "",
      produto.imagem || "",
      produto.cupom || ""
    ].join("|");
  }

  function previewSalvoAtual() {
    return Boolean(state.previewKey && state.previewSalvoKey === state.previewKey);
  }

  function atualizarBotaoSalvar() {
    const botao = el("botaoSalvar");
    if (!botao) return;
    const temPreview = Boolean(state.previewOferta && state.previewKey);
    const salvo = previewSalvoAtual();
    botao.disabled = state.salvandoOferta || !temPreview || salvo;
    botao.dataset.estado = salvo ? "salvo" : (state.salvandoOferta ? "salvando" : "");
    botao.title = salvo ? "Oferta ja salva na Galeria do Optimus" : "";
    botao.textContent = state.salvandoOferta
      ? "Salvando..."
      : (salvo ? "Salvo no Optimus" : "Salvar no Optimus");
  }

  function limparPreviewAtual() {
    state.previewOferta = null;
    state.previewKey = "";
    state.salvandoOferta = false;
    state.ofertaSalvaId = "";
    atualizarBotaoSalvar();
  }

  function limparSaveCompleto() {
    limparPreviewAtual();
    state.previewSalvoKey = "";
  }

  function ofertaPreviewParaSalvar(oferta = {}) {
    const {
      id: _id,
      clienteId: _clienteId,
      status: _status,
      criadoEm: _criadoEm,
      atualizadoEm: _atualizadoEm,
      ...campos
    } = oferta && typeof oferta === "object" ? oferta : {};
    return campos;
  }

  function limparCapturaAgendada() {
    if (state.capturaTimer) {
      clearTimeout(state.capturaTimer);
      state.capturaTimer = null;
    }
  }

  function agendarCapturaAutomatica() {
    if (!state.auth?.token) return;
    limparCapturaAgendada();
    state.capturaTimer = setTimeout(() => {
      state.capturaTimer = null;
      void capturar({ automatico: true });
    }, 700);
  }

  function prepararFichaVazia() {
    state.produto = null;
    limparPreviewAtual();
    setHidden("produtoView", false);
    el("produtoImagem").src = "";
    el("produtoImagem").hidden = true;
    el("campoTitulo").value = "";
    el("campoPrecoAtual").value = "";
    el("campoPrecoAnterior").value = "";
    el("campoCupom").value = "";
    el("campoDesconto").value = "";
    setTexto("statusProduto", "Produto ainda nao carregado");
    setTexto("statusLink", "Preview ainda nao gerado");
  }

  function preencherProduto(produto) {
    state.produto = contrato.normalizarProdutoCapturado(produto);
    setHidden("produtoView", false);
    el("produtoImagem").src = state.produto.imagem || "";
    el("produtoImagem").hidden = !state.produto.imagem;
    el("campoTitulo").value = state.produto.titulo || "";
    el("campoPrecoAtual").value = formatarMoeda(state.produto.precoAtual);
    el("campoPrecoAnterior").value = formatarMoeda(state.produto.precoAnterior);
    el("campoCupom").value = state.produto.cupom || "";
    el("campoDesconto").value = state.produto.descontoPercentual ? `${state.produto.descontoPercentual}%` : "";
    setTexto("statusProduto", state.produto.requerConferencia ? "Dados precisam de conferencia" : "Produto capturado");
    setTexto("statusLink", "Preview ainda nao gerado");
    return state.produto;
  }

  async function abaAtiva() {
    const abas = await chrome.tabs.query({ active: true, currentWindow: true });
    return abas?.[0] || null;
  }

  async function capturar(opcoes = {}) {
    const automatico = opcoes.automatico === true;
    const forcar = opcoes.forcar === true;
    if (state.capturando && !forcar) return;
    state.capturando = true;
    setHidden("previewView", true);
    setTexto("estadoPagina", "Identificando oferta...");
    setHidden("estadoPagina", false);
    if (!state.produto) prepararFichaVazia();

    try {
      const aba = await abaAtiva();
      if (!aba?.id || !aba.url) {
        setTexto("estadoPagina", "Nenhuma aba ativa disponivel.");
        return;
      }

      const deteccao = detector.detectarMarketplacePorUrl(aba.url);
      if (!deteccao.suportado) {
        state.ultimaUrlCapturada = "";
        state.ultimoPreviewKey = "";
        limparSaveCompleto();
        prepararFichaVazia();
        setTexto("estadoPagina", deteccao.motivo === "pagina_mercadolivre_sem_produto"
          ? "Abra um produto para capturar."
          : "Pagina ainda nao suportada pelo Optimus Capture.");
        return;
      }

      const urlCaptura = deteccao.url || aba.url;
      if (automatico && !forcar && state.ultimaUrlCapturada === urlCaptura && state.produto?.urlOriginal === urlCaptura) {
        setTexto("estadoPagina", "Oferta identificada");
        if (!state.produto.requerConferencia && state.ultimoPreviewKey !== chavePreview(state.produto)) {
          void gerarPreview({ automatico: true });
        }
        return;
      }
      prepararFichaVazia();
      const resposta = await chrome.tabs.sendMessage(aba.id, { type: "OPTIMUS_CAPTURE_PAGE" });
      if (!resposta?.produto) {
        setTexto("estadoPagina", "Produto nao reconhecido nesta pagina.");
        return;
      }
      const produto = preencherProduto(resposta.produto);
      state.ultimaUrlCapturada = produto.urlOriginal || urlCaptura;
      setTexto("estadoPagina", produto.requerConferencia
        ? "Produto detectado. Confira os campos antes do preview."
        : "Oferta identificada");
      if (!produto.requerConferencia) {
        void gerarPreview({ automatico: true });
      }
    } catch {
      setTexto("estadoPagina", "Produto ainda nao carregado. Clique em Atualizar captura.");
    } finally {
      state.capturando = false;
    }
  }

  function produtoEditado() {
    return contrato.normalizarProdutoCapturado({
      ...(state.produto || {}),
      titulo: valor("campoTitulo"),
      precoAtual: valor("campoPrecoAtual"),
      precoAnterior: valor("campoPrecoAnterior"),
      cupom: valor("campoCupom")
    });
  }

  async function gerarPreview(opcoes = {}) {
    const automatico = opcoes.automatico === true;
    if (!state.auth?.token || state.enviandoPreview) return;
    const produto = produtoEditado();
    if (!produto.precoAtual) {
      if (!automatico) setTexto("statusLink", "Preco precisa de conferencia.");
      return;
    }
    const previewKey = chavePreview(produto);
    if (automatico && state.ultimoPreviewKey === previewKey) {
      return;
    }
    state.enviandoPreview = true;
    el("botaoPreview").disabled = true;
    setTexto("statusLink", "Gerando preview no Optimus...");
    try {
      const resposta = await api.gerarPreviewCapture(state.auth.token, contrato.payloadPreview(produto));
      const oferta = resposta?.oferta || {};
      const preview = el("previewView");
      preview.innerHTML = "";
      const titulo = document.createElement("h2");
      titulo.textContent = "Preview aprovado";
      const resumo = document.createElement("p");
      const tituloResumo = oferta.titulo || produto.titulo;
      const precoResumo = formatarMoeda(oferta.precoAtual || produto.precoAtual);
      resumo.textContent = precoResumo ? `${tituloResumo} - ${precoResumo}` : tituloResumo;
      const link = document.createElement("p");
      link.textContent = oferta.urlAfiliada ? "Link afiliado gerado pelo Optimus." : "Link afiliado nao retornado.";
      preview.append(titulo, resumo, link);
      setHidden("previewView", false);
      state.ultimoPreviewKey = previewKey;
      state.previewOferta = ofertaPreviewParaSalvar(oferta);
      state.previewKey = previewKey;
      if (state.previewSalvoKey !== previewKey) {
        state.ofertaSalvaId = "";
      }
      atualizarBotaoSalvar();
      setTexto("statusLink", oferta.urlAfiliada ? "Link afiliado gerado" : "Preview gerado");
    } catch (erro) {
      if (erro?.status === 401) {
        await auth.sair();
        state.auth = null;
        renderAuth();
        return;
      }
      setTexto("statusLink", automatico
        ? "Preview ainda nao gerado. Clique em Atualizar captura."
        : `Erro: ${String(erro?.message || "preview_falhou").slice(0, 90)}`);
    } finally {
      state.enviandoPreview = false;
      el("botaoPreview").disabled = false;
    }
  }

  async function salvarNoOptimus() {
    if (!state.auth?.token || state.salvandoOferta) return;
    if (!state.previewOferta || !state.previewKey || previewSalvoAtual()) {
      atualizarBotaoSalvar();
      return;
    }

    const previewKey = state.previewKey;
    const oferta = ofertaPreviewParaSalvar(state.previewOferta);
    state.salvandoOferta = true;
    atualizarBotaoSalvar();
    setTexto("statusLink", "Salvando...");

    try {
      const resposta = await api.salvarOfertaManualV2(state.auth.token, oferta);
      state.ofertaSalvaId = String(resposta?.oferta?.id || "");
      state.previewSalvoKey = previewKey;
      setTexto("statusLink", "Salvo na Galeria do Optimus");
    } catch (erro) {
      if (erro?.status === 401) {
        await auth.sair();
        state.auth = null;
        renderAuth();
        return;
      }
      setTexto("statusLink", "Nao foi possivel salvar. Tente novamente.");
    } finally {
      state.salvandoOferta = false;
      atualizarBotaoSalvar();
    }
  }

  function renderAuth() {
    const autenticado = Boolean(state.auth?.token);
    setHidden("loginView", autenticado);
    setHidden("captureView", !autenticado);
    setHidden("botaoSair", !autenticado);
    if (autenticado) {
      const usuario = state.auth.usuario || {};
      const nome = usuario.nome || usuario.email || usuario.id || "Workspace conectado";
      setTexto("statusConexao", `Conectado - ${nome}`);
      setTexto("usuarioResumo", "Produto atual");
      if (!state.capturaInicialExecutada) {
        state.capturaInicialExecutada = true;
        void capturar();
      }
    } else {
      state.capturaInicialExecutada = false;
      setTexto("statusConexao", "Desconectado");
    }
  }

  async function conectarComOptimus() {
    if (state.conectando) return;
    setHidden("loginErro", true);
    setHidden("handoffStatus", false);
    state.conectando = true;
    el("botaoConectar").disabled = true;
    try {
      state.auth = await auth.conectarComOptimus({
        onStatus: (mensagem) => setTexto("handoffStatus", mensagem)
      });
      setTexto("handoffStatus", "Conectado ao Optimus.");
      renderAuth();
    } catch (erro) {
      setTexto("loginErro", `Nao foi possivel conectar: ${String(erro?.message || "handoff_falhou").slice(0, 80)}`);
      setHidden("loginErro", false);
    } finally {
      state.conectando = false;
      el("botaoConectar").disabled = false;
    }
  }


  async function entrar() {
    setHidden("loginErro", true);
    el("botaoLogin").disabled = true;
    try {
      state.auth = await auth.autenticar(valor("loginUser"), valor("loginPass"));
      el("loginPass").value = "";
      renderAuth();
    } catch {
      setTexto("loginErro", "Nao foi possivel autenticar.");
      setHidden("loginErro", false);
    } finally {
      el("botaoLogin").disabled = false;
    }
  }

  async function sair() {
    limparCapturaAgendada();
    await auth.sair();
    state.auth = null;
    state.produto = null;
    limparSaveCompleto();
    state.capturaInicialExecutada = false;
    state.ultimaUrlCapturada = "";
    state.ultimoPreviewKey = "";
    renderAuth();
  }

  function registrarEventosAbas() {
    const tabs = global.chrome?.tabs;
    if (state.eventosAbasRegistrados || !tabs) return;
    if (tabs.onActivated?.addListener) {
      tabs.onActivated.addListener(() => agendarCapturaAutomatica());
    }
    if (tabs.onUpdated?.addListener) {
      tabs.onUpdated.addListener((_tabId, changeInfo = {}) => {
        if (changeInfo.url || changeInfo.status === "complete") agendarCapturaAutomatica();
      });
    }
    state.eventosAbasRegistrados = true;
  }

  async function init() {
    registrarEventosAbas();
    el("botaoConectar").addEventListener("click", conectarComOptimus);
    el("botaoLogin").addEventListener("click", entrar);
    el("botaoSair").addEventListener("click", sair);
    el("botaoCapturar").addEventListener("click", () => capturar({ forcar: true }));
    el("botaoPreview").addEventListener("click", gerarPreview);
    el("botaoSalvar").addEventListener("click", salvarNoOptimus);
    try {
      state.auth = await auth.restaurarSessao();
    } catch {
      state.auth = await global.OptimusCaptureStorage.lerAuth();
    }
    renderAuth();
  }

  document.addEventListener("DOMContentLoaded", init);
})(typeof globalThis !== "undefined" ? globalThis : window);
