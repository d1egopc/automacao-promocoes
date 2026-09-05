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
    previewPendente: false,
    conectando: false,
    capturaInicialExecutada: false,
    capturando: false,
    capturaPendente: false,
    capturaTimer: null,
    eventosAbasRegistrados: false,
    ultimaUrlCapturada: "",
    ultimoPreviewKey: "",
    previewOferta: null,
    previewKey: "",
    salvandoOferta: false,
    ofertaSalvaId: "",
    previewSalvoKey: "",
    destinos: [],
    destinosSelecionados: new Set(),
    carregandoDestinos: false,
    enviandoAgora: false,
    previewEnviadoKey: ""
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

  function textoPrecoProduto(produto = {}) {
    if (produto.temVariacaoPreco && produto.precoMin) {
      const minimo = formatarMoeda(produto.precoMin);
      return minimo ? `A partir de ${minimo}` : "";
    }
    return formatarMoeda(produto.precoAtual);
  }

  function chavePreview(produto = {}) {
    return [
      produto.urlOriginal || "",
      produto.titulo || "",
      produto.precoAtual || "",
      produto.precoMin || "",
      produto.precoMax || "",
      produto.temVariacaoPreco === true ? "variacao" : "",
      produto.imagem || "",
      produto.cupom || ""
    ].join("|");
  }

  function previewSalvoAtual() {
    return Boolean(state.previewKey && state.previewSalvoKey === state.previewKey);
  }

  function previewEnviadoAtual() {
    return Boolean(state.previewKey && state.previewEnviadoKey === state.previewKey);
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

  function atualizarBotaoConfirmarEnvio() {
    const botao = el("botaoConfirmarEnvio");
    if (!botao) return;
    botao.disabled = state.enviandoAgora || state.destinosSelecionados.size < 1;
    botao.textContent = state.enviandoAgora ? "Enviando..." : "Confirmar envio";
  }

  function atualizarBotaoEnviar() {
    const botao = el("botaoEnviar");
    if (!botao) return;
    const temPreview = Boolean(state.previewOferta && state.previewKey);
    const enviado = previewEnviadoAtual();
    botao.disabled = !temPreview || state.enviandoAgora || state.carregandoDestinos || enviado;
    botao.dataset.estado = enviado ? "salvo" : (state.enviandoAgora ? "salvando" : "");
    botao.textContent = state.enviandoAgora
      ? "Enviando..."
      : (enviado ? "Enviado" : "Enviar agora");
    botao.title = enviado ? "Oferta ja enviada para o preview atual" : "";
  }

  function ocultarDestinos() {
    setHidden("destinosView", true);
    const lista = el("destinosLista");
    if (lista) lista.innerHTML = "";
    state.destinosSelecionados = new Set();
    atualizarBotaoConfirmarEnvio();
  }

  function limparPreviewAtual() {
    state.previewOferta = null;
    state.previewKey = "";
    state.salvandoOferta = false;
    state.ofertaSalvaId = "";
    state.enviandoAgora = false;
    state.carregandoDestinos = false;
    state.destinos = [];
    state.previewEnviadoKey = "";
    ocultarDestinos();
    atualizarBotaoSalvar();
    atualizarBotaoEnviar();
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

  function destinoSeguro(destino = {}) {
    const tipo = String(destino.tipo || "").toLowerCase();
    return {
      id: String(destino.id || "").trim(),
      nome: String(destino.nome || destino.identificacaoVisual || destino.id || "").trim(),
      tipo: ["telegram", "discord"].includes(tipo) ? tipo : "whatsapp",
      ativo: destino.ativo !== false,
      utilizavel: destino.utilizavel === true,
      motivoIndisponivel: String(destino.motivoIndisponivel || "").trim(),
      identificacaoVisual: String(destino.identificacaoVisual || "").trim()
    };
  }

  function tipoDestinoLabel(tipo = "") {
    if (tipo === "telegram") return "Telegram";
    if (tipo === "discord") return "Discord";
    return "WhatsApp";
  }

  function destinosUtilizaveis() {
    return state.destinos.filter((destino) => destino.id && destino.ativo && destino.utilizavel);
  }

  function marketplaceLabel(marketplace = "") {
    const valor = String(marketplace || "").toLowerCase();
    if (valor === "shopee") return "Shopee";
    if (valor === "mercadolivre") return "Mercado Livre";
    return "Marketplace";
  }

  function capturaUtilizavel(produto = {}) {
    const normalizado = produto.completo === true && !produto.requerConferencia;
    return normalizado && Boolean(produto.titulo && (produto.precoAtual || produto.precoMin) && produto.urlOriginal);
  }

  function renderizarDestinos() {
    const lista = el("destinosLista");
    if (!lista) return;
    lista.innerHTML = "";

    if (state.carregandoDestinos) {
      const vazio = document.createElement("p");
      vazio.className = "destino-vazio";
      vazio.textContent = "Carregando destinos...";
      lista.append(vazio);
      atualizarBotaoConfirmarEnvio();
      return;
    }

    if (!state.destinos.length) {
      const vazio = document.createElement("p");
      vazio.className = "destino-vazio";
      vazio.textContent = "Nenhum destino disponivel.";
      lista.append(vazio);
      atualizarBotaoConfirmarEnvio();
      return;
    }

    for (const destino of state.destinos) {
      const utilizavel = destino.id && destino.ativo && destino.utilizavel;
      const label = document.createElement("label");
      label.className = utilizavel ? "destino-opcao" : "destino-opcao indisponivel";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = destino.id;
      checkbox.disabled = !utilizavel;
      checkbox.checked = state.destinosSelecionados.has(destino.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          state.destinosSelecionados.add(destino.id);
        } else {
          state.destinosSelecionados.delete(destino.id);
        }
        atualizarBotaoConfirmarEnvio();
      });

      const textoDestino = document.createElement("span");
      textoDestino.textContent = destino.nome || destino.identificacaoVisual || destino.id;
      const meta = document.createElement("span");
      meta.className = "destino-tipo";
      meta.textContent = utilizavel
        ? tipoDestinoLabel(destino.tipo)
        : `${tipoDestinoLabel(destino.tipo)} - ${destino.motivoIndisponivel || "indisponivel"}`;
      const corpo = document.createElement("span");
      corpo.append(textoDestino, meta);
      label.append(checkbox, corpo);
      lista.append(label);
    }

    atualizarBotaoConfirmarEnvio();
  }

  function limparCapturaAgendada() {
    if (state.capturaTimer) {
      clearTimeout(state.capturaTimer);
      state.capturaTimer = null;
    }
  }

  function esperar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function agendarCapturaAutomatica(delayMs = 700) {
    if (!state.auth?.token) return;
    limparCapturaAgendada();
    state.capturaTimer = setTimeout(() => {
      state.capturaTimer = null;
      void capturar({ automatico: true });
    }, delayMs);
  }

  function erroCanalMensagem(erro) {
    const mensagem = String(erro?.message || erro || "").toLowerCase();
    return mensagem.includes("receiving end does not exist") ||
      mensagem.includes("message channel closed") ||
      mensagem.includes("could not establish connection") ||
      mensagem.includes("extension context invalidated");
  }

  async function enviarMensagemCapturaComRecuperacao(abaId) {
    try {
      const resposta = await chrome.tabs.sendMessage(abaId, { type: "OPTIMUS_CAPTURE_PAGE" });
      const produto = contrato.normalizarProdutoCapturado(resposta?.produto || {});
      if (resposta?.ok === false || !capturaUtilizavel(produto)) {
        await esperar(900);
        return chrome.tabs.sendMessage(abaId, { type: "OPTIMUS_CAPTURE_PAGE" });
      }
      return resposta;
    } catch (erro) {
      if (!erroCanalMensagem(erro)) throw erro;
      await esperar(900);
      return chrome.tabs.sendMessage(abaId, { type: "OPTIMUS_CAPTURE_PAGE" });
    }
  }

  async function abaPermaneceNaCaptura(abaId, urlCaptura) {
    const abaAtual = await abaAtiva();
    const deteccaoAtual = detector.detectarMarketplacePorUrl(abaAtual?.url || "");
    const urlAtual = deteccaoAtual.url || abaAtual?.url || "";
    return Boolean(abaAtual?.id === abaId && deteccaoAtual.suportado && urlAtual === urlCaptura);
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
    setTexto("produtoMarketplace", "Marketplace");
    setTexto("statusProduto", "Produto ainda nao carregado");
    setTexto("statusLink", "Aguardando captura");
  }

  function preencherProduto(produto) {
    state.produto = contrato.normalizarProdutoCapturado(produto);
    setHidden("produtoView", false);
    el("produtoImagem").src = state.produto.imagem || "";
    el("produtoImagem").hidden = !state.produto.imagem;
    el("campoTitulo").value = state.produto.titulo || "";
    el("campoPrecoAtual").value = textoPrecoProduto(state.produto);
    el("campoPrecoAnterior").value = formatarMoeda(state.produto.precoAnterior);
    el("campoCupom").value = state.produto.cupom || "";
    el("campoDesconto").value = state.produto.descontoPercentual ? `${state.produto.descontoPercentual}%` : "";
    setTexto("produtoMarketplace", marketplaceLabel(state.produto.marketplace));
    setTexto("statusProduto", capturaUtilizavel(state.produto) ? "Produto capturado" : "Captura incompleta");
    setTexto("statusLink", capturaUtilizavel(state.produto) ? "Preparando oferta..." : "Nao foi possivel preparar a oferta");
    return state.produto;
  }

  async function abaAtiva() {
    const abas = await chrome.tabs.query({ active: true, currentWindow: true });
    return abas?.[0] || null;
  }

  async function capturar(opcoes = {}) {
    const automatico = opcoes.automatico === true;
    const forcar = opcoes.forcar === true;
    if (state.capturando && !forcar) {
      state.capturaPendente = true;
      return;
    }
    state.capturando = true;
    state.capturaPendente = false;
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
        setTexto("estadoPagina", ["pagina_mercadolivre_sem_produto", "pagina_shopee_sem_produto"].includes(deteccao.motivo)
          ? "Abra um produto para capturar."
          : "Pagina ainda nao suportada pelo Optimus Capture.");
        return;
      }

      const urlCaptura = deteccao.url || aba.url;
      if (automatico && !forcar && state.ultimaUrlCapturada === urlCaptura && state.produto?.urlOriginal === urlCaptura) {
        if (capturaUtilizavel(state.produto)) {
          if (state.ultimoPreviewKey !== chavePreview(state.produto)) {
            setTexto("estadoPagina", "Preparando oferta...");
            await gerarPreview({ automatico: true });
          } else {
            setTexto("estadoPagina", "Oferta pronta");
          }
        } else {
          setTexto("estadoPagina", "Nao foi possivel capturar este produto.");
        }
        return;
      }
      prepararFichaVazia();
      const resposta = await enviarMensagemCapturaComRecuperacao(aba.id);
      if (!await abaPermaneceNaCaptura(aba.id, urlCaptura)) {
        state.capturaPendente = true;
        return;
      }
      if (!resposta?.produto) {
        setTexto("estadoPagina", "Nao foi possivel capturar este produto.");
        return;
      }
      const produto = preencherProduto(resposta.produto);
      if (!await abaPermaneceNaCaptura(aba.id, urlCaptura)) {
        state.capturaPendente = true;
        return;
      }
      if (!capturaUtilizavel(produto)) {
        state.ultimaUrlCapturada = "";
        setTexto("estadoPagina", "Nao foi possivel capturar este produto.");
        return;
      }
      state.ultimaUrlCapturada = produto.urlOriginal || urlCaptura;
      setTexto("estadoPagina", "Preparando oferta...");
      await gerarPreview({ automatico: true });
    } catch {
      setTexto("estadoPagina", "Nao foi possivel capturar este produto.");
    } finally {
      state.capturando = false;
      if (state.capturaPendente && state.auth?.token) {
        state.capturaPendente = false;
        agendarCapturaAutomatica(120);
      }
    }
  }

  function produtoEditado() {
    return contrato.normalizarProdutoCapturado({
      ...(state.produto || {}),
      titulo: valor("campoTitulo"),
      precoAtual: valor("campoPrecoAtual"),
      precoMin: state.produto?.precoMin || "",
      precoMax: state.produto?.precoMax || "",
      temVariacaoPreco: state.produto?.temVariacaoPreco === true,
      precoAnterior: valor("campoPrecoAnterior"),
      cupom: valor("campoCupom")
    });
  }

  async function gerarPreview(opcoes = {}) {
    const automatico = opcoes.automatico === true;
    if (!state.auth?.token) return;
    if (state.enviandoPreview) {
      if (automatico) state.previewPendente = true;
      return;
    }
    const produto = produtoEditado();
    if (!produto.precoAtual && !produto.precoMin) {
      setTexto("statusProduto", "Captura incompleta");
      setTexto("statusLink", automatico ? "Nao foi possivel preparar a oferta" : "Preco precisa de conferencia.");
      return;
    }
    const previewKey = chavePreview(produto);
    if (automatico && state.ultimoPreviewKey === previewKey) {
      return;
    }
    state.enviandoPreview = true;
    el("botaoPreview").disabled = true;
    setTexto("estadoPagina", "Preparando oferta...");
    setTexto("statusLink", "Preparando oferta...");
    try {
      const resposta = await api.gerarPreviewCapture(state.auth.token, contrato.payloadPreview(produto));
      if (chavePreview(produtoEditado()) !== previewKey) {
        state.previewPendente = true;
        return;
      }
      const oferta = resposta?.oferta || {};
      const preview = el("previewView");
      preview.innerHTML = "";
      const titulo = document.createElement("h2");
      titulo.textContent = "Preview aprovado";
      const resumo = document.createElement("p");
      const tituloResumo = oferta.titulo || produto.titulo;
      const precoResumo = textoPrecoProduto({
        ...produto,
        ...oferta,
        precoAtual: oferta.precoAtual || produto.precoAtual,
        precoMin: oferta.precoMin || produto.precoMin,
        precoMax: oferta.precoMax || produto.precoMax,
        temVariacaoPreco: oferta.temVariacaoPreco === true || produto.temVariacaoPreco === true
      });
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
      if (state.previewEnviadoKey !== previewKey) {
        state.previewEnviadoKey = "";
      }
      ocultarDestinos();
      atualizarBotaoSalvar();
      atualizarBotaoEnviar();
      setTexto("estadoPagina", "Oferta pronta");
      setTexto("statusLink", "Oferta pronta");
    } catch (erro) {
      if (erro?.status === 401) {
        await auth.sair();
        state.auth = null;
        renderAuth();
        return;
      }
      setTexto("estadoPagina", "Nao foi possivel preparar a oferta.");
      setTexto("statusLink", automatico
        ? "Nao foi possivel preparar a oferta"
        : `Erro: ${String(erro?.message || "preview_falhou").slice(0, 90)}`);
    } finally {
      state.enviandoPreview = false;
      el("botaoPreview").disabled = false;
      if (state.previewPendente && state.auth?.token) {
        state.previewPendente = false;
        void gerarPreview({ automatico: true });
      }
    }
  }

  async function salvarPreviewAtual() {
    if (!state.auth?.token || !state.previewOferta || !state.previewKey) return "";
    if (state.ofertaSalvaId && previewSalvoAtual()) return state.ofertaSalvaId;
    if (state.salvandoOferta) throw new Error("salvamento_em_andamento");
    const previewKey = state.previewKey;
    const oferta = ofertaPreviewParaSalvar(state.previewOferta);
    state.salvandoOferta = true;
    atualizarBotaoSalvar();
    atualizarBotaoEnviar();

    try {
      const resposta = await api.salvarOfertaManualV2(state.auth.token, oferta);
      if (state.previewKey !== previewKey) throw new Error("preview_alterado");
      const ofertaId = String(resposta?.oferta?.id || "");
      if (!ofertaId) throw new Error("oferta_salva_sem_id");
      state.ofertaSalvaId = ofertaId;
      state.previewSalvoKey = previewKey;
      return ofertaId;
    } finally {
      state.salvandoOferta = false;
      atualizarBotaoSalvar();
      atualizarBotaoEnviar();
    }
  }

  async function salvarNoOptimus() {
    if (!state.auth?.token || state.salvandoOferta) return;
    if (!state.previewOferta || !state.previewKey || previewSalvoAtual()) {
      atualizarBotaoSalvar();
      return;
    }

    setTexto("statusLink", "Salvando...");

    try {
      await salvarPreviewAtual();
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
      atualizarBotaoSalvar();
      atualizarBotaoEnviar();
    }
  }

  async function abrirSeletorEnvio() {
    if (!state.auth?.token || !state.previewOferta || !state.previewKey || state.enviandoAgora || previewEnviadoAtual()) {
      atualizarBotaoEnviar();
      return;
    }

    setHidden("destinosView", false);
    state.carregandoDestinos = true;
    state.destinos = [];
    state.destinosSelecionados = new Set();
    setTexto("statusLink", "Carregando destinos...");
    renderizarDestinos();
    atualizarBotaoEnviar();

    try {
      const resposta = await api.listarDestinosManualV2(state.auth.token);
      state.destinos = Array.isArray(resposta?.destinos)
        ? resposta.destinos.map(destinoSeguro).filter((destino) => destino.id)
        : [];
      setTexto("statusLink", destinosUtilizaveis().length
        ? "Selecione os destinos para enviar."
        : "Nenhum destino disponivel.");
    } catch (erro) {
      if (erro?.status === 401) {
        await auth.sair();
        state.auth = null;
        renderAuth();
        return;
      }
      setTexto("statusLink", "Nao foi possivel carregar destinos.");
    } finally {
      state.carregandoDestinos = false;
      renderizarDestinos();
      atualizarBotaoEnviar();
    }
  }

  async function confirmarEnviarAgora() {
    if (!state.auth?.token || state.enviandoAgora || previewEnviadoAtual()) return;
    const idsUtilizaveis = new Set(destinosUtilizaveis().map((destino) => destino.id));
    const destinosIds = Array.from(state.destinosSelecionados).filter((id) => idsUtilizaveis.has(id));
    if (!destinosIds.length) {
      setTexto("statusLink", "Selecione ao menos um destino.");
      atualizarBotaoConfirmarEnvio();
      return;
    }

    const previewKey = state.previewKey;
    state.enviandoAgora = true;
    setTexto("statusLink", "Enviando...");
    atualizarBotaoEnviar();
    atualizarBotaoSalvar();
    atualizarBotaoConfirmarEnvio();

    try {
      const ofertaId = await salvarPreviewAtual();
      if (!ofertaId) throw new Error("oferta_nao_salva");
      if (state.previewKey !== previewKey) throw new Error("preview_alterado");
      const resposta = await api.enviarAgoraManualV2(state.auth.token, ofertaId, destinosIds);
      if (state.previewKey !== previewKey) return;
      const envio = resposta?.envio || {};
      const enviados = Number(envio.enviados || 0);
      const erros = Number(envio.erros || 0);
      if (enviados > 0) {
        state.previewEnviadoKey = previewKey;
        ocultarDestinos();
      }
      setTexto("statusLink", erros > 0
        ? `Enviado: ${enviados} • Erros: ${erros}`
        : `Enviado para ${enviados} destino(s)`);
    } catch (erro) {
      if (erro?.status === 401) {
        await auth.sair();
        state.auth = null;
        renderAuth();
        return;
      }
      setTexto("statusLink", `Nao foi possivel enviar: ${String(erro?.message || "envio_falhou").slice(0, 80)}`);
    } finally {
      state.enviandoAgora = false;
      atualizarBotaoEnviar();
      atualizarBotaoSalvar();
      atualizarBotaoConfirmarEnvio();
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
    el("botaoPreview").addEventListener("click", gerarPreview);
    el("botaoSalvar").addEventListener("click", salvarNoOptimus);
    el("botaoEnviar").addEventListener("click", abrirSeletorEnvio);
    el("botaoConfirmarEnvio").addEventListener("click", confirmarEnviarAgora);
    el("botaoCancelarEnvio").addEventListener("click", ocultarDestinos);
    try {
      state.auth = await auth.restaurarSessao();
    } catch {
      state.auth = await global.OptimusCaptureStorage.lerAuth();
    }
    renderAuth();
  }

  document.addEventListener("DOMContentLoaded", init);
})(typeof globalThis !== "undefined" ? globalThis : window);
