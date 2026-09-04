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
    conectando: false
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

  function preencherProduto(produto) {
    state.produto = contrato.normalizarProdutoCapturado(produto);
    setHidden("produtoView", false);
    el("produtoImagem").src = state.produto.imagem || "";
    el("produtoImagem").hidden = !state.produto.imagem;
    el("campoTitulo").value = state.produto.titulo || "";
    el("campoPrecoAtual").value = state.produto.precoAtual || "";
    el("campoPrecoAnterior").value = state.produto.precoAnterior || "";
    el("campoCupom").value = state.produto.cupom || "";
    el("campoDesconto").value = state.produto.descontoPercentual ? `${state.produto.descontoPercentual}%` : "";
    setTexto("statusProduto", state.produto.requerConferencia ? "Dados precisam de conferencia" : "Produto capturado");
    setTexto("statusLink", "Preview ainda nao gerado");
  }

  async function abaAtiva() {
    const abas = await chrome.tabs.query({ active: true, currentWindow: true });
    return abas?.[0] || null;
  }

  async function capturar() {
    setHidden("previewView", true);
    setTexto("estadoPagina", "Identificando pagina atual...");
    setHidden("estadoPagina", false);
    setHidden("produtoView", true);

    const aba = await abaAtiva();
    if (!aba?.id || !aba.url) {
      setTexto("estadoPagina", "Nenhuma aba ativa disponivel.");
      return;
    }

    const deteccao = detector.detectarMarketplacePorUrl(aba.url);
    if (!deteccao.suportado) {
      setTexto("estadoPagina", deteccao.motivo === "meli_la_requer_url_real"
        ? "Abra a URL real do produto Mercado Livre, nao o link curto."
        : "Pagina ainda nao suportada pelo Optimus Capture.");
      return;
    }

    try {
      const resposta = await chrome.tabs.sendMessage(aba.id, { type: "OPTIMUS_CAPTURE_PAGE" });
      if (!resposta?.produto) {
        setTexto("estadoPagina", "Produto nao reconhecido nesta pagina.");
        return;
      }
      preencherProduto(resposta.produto);
      setTexto("estadoPagina", resposta.produto.requerConferencia
        ? "Produto detectado. Confira os campos antes do preview."
        : "Produto capturado.");
    } catch {
      setTexto("estadoPagina", "Recarregue a pagina do produto e tente novamente.");
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

  async function gerarPreview() {
    if (!state.auth?.token || state.enviandoPreview) return;
    const produto = produtoEditado();
    if (!produto.precoAtual) {
      setTexto("statusLink", "Preco precisa de conferencia.");
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
      resumo.textContent = `${oferta.titulo || produto.titulo} - R$ ${oferta.precoAtual || produto.precoAtual}`;
      const link = document.createElement("p");
      link.textContent = oferta.urlAfiliada ? "Link afiliado gerado pelo Optimus." : "Link afiliado nao retornado.";
      preview.append(titulo, resumo, link);
      setHidden("previewView", false);
      setTexto("statusLink", oferta.urlAfiliada ? "Link afiliado gerado" : "Preview gerado");
    } catch (erro) {
      if (erro?.status === 401) {
        await auth.sair();
        state.auth = null;
        renderAuth();
        return;
      }
      setTexto("statusLink", `Erro: ${String(erro?.message || "preview_falhou").slice(0, 90)}`);
    } finally {
      state.enviandoPreview = false;
      el("botaoPreview").disabled = false;
    }
  }

  function renderAuth() {
    const autenticado = Boolean(state.auth?.token);
    setHidden("loginView", autenticado);
    setHidden("captureView", !autenticado);
    setHidden("botaoSair", !autenticado);
    setTexto("statusConexao", autenticado ? "Conectado" : "Desconectado");
    if (autenticado) {
      const usuario = state.auth.usuario || {};
      setTexto("usuarioResumo", usuario.nome || usuario.email || usuario.id || "Workspace conectado");
      capturar();
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
    await auth.sair();
    state.auth = null;
    state.produto = null;
    renderAuth();
  }

  async function init() {
    el("botaoConectar").addEventListener("click", conectarComOptimus);
    el("botaoConectar").addEventListener("click", conectarComOptimus);
    el("botaoLogin").addEventListener("click", entrar);
    el("botaoSair").addEventListener("click", sair);
    el("botaoCapturar").addEventListener("click", capturar);
    el("botaoPreview").addEventListener("click", gerarPreview);
    try {
      state.auth = await auth.restaurarSessao();
    } catch {
      state.auth = await global.OptimusCaptureStorage.lerAuth();
    }
    renderAuth();
  }

  document.addEventListener("DOMContentLoaded", init);
})(typeof globalThis !== "undefined" ? globalThis : window);

