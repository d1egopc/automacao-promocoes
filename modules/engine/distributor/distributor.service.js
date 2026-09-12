const path = require("path");
const { getEnginePool, engineDbHabilitado } = require("../database");
const { limitarJobs } = require("../processor.service");
const { normalizarTexto } = require("../normalizers");
const {
  clienteValidoEngine,
  marketplaceAtivoClienteEngine
} = require("../validator.service");
const filaOfertas = require("../../../utils/fila-ofertas");
const destinosUtils = require("../../../utils/destinos");
const { resolverImagemUniversal } = require("../../imagens/resolver-imagem-universal");
const { selecionarImagemEspelhoPiloto } = require("../../ofc-v2/espelho-piloto");
const fidelidadeObs = require("../../fidelidade/observabilidade-v1");
const coberturaRadar = require("../../radar/cobertura-v1");
const {
  usuarioAtivo,
  logUsuarioInativoIgnorado
} = require("../../../utils/usuarios-atividade");
const {
  carimbarExpiracaoOperacionalFila
} = require("../flow-manager/flow-manager.service");
const {
  motivoDistribuicaoDefinitivo
} = require("./motivos-definitivos");
const { resolverOrigemFluxo } = require("../../../utils/origem-fluxo");

let engineOfertasMetadataDisponivel = null;

async function engineOfertasTemMetadataDistribuidor() {
  if (engineOfertasMetadataDisponivel !== null) return engineOfertasMetadataDisponivel;
  const pool = getEnginePool();
  if (!pool) return false;

  try {
    const resultado = await pool.query(
      `SELECT EXISTS (
         SELECT 1
           FROM information_schema.columns
          WHERE table_name = 'engine_ofertas'
            AND column_name = 'metadata'
       ) AS existe`
    );
    engineOfertasMetadataDisponivel = Boolean(resultado.rows[0]?.existe);
  } catch (_) {
    engineOfertasMetadataDisponivel = false;
  }

  return engineOfertasMetadataDisponivel;
}


function logQueryErroDistribuidor({ etapa = "", ofertaId = null, jobId = null, clienteId = "", err = null, resultado = {}, queryResumo = "" } = {}) {
  console.log("[ENGINE-DISTRIBUIDOR-QUERY-ERRO]", {
    etapa,
    ofertaId,
    jobId,
    clienteId,
    erroMessage: err?.message || resultado.erro || resultado.message || "",
    erroCode: err?.code || resultado.erroCode || resultado.code || resultado.codigo || "",
    erroDetail: err?.detail || resultado.erroDetail || resultado.detail || "",
    erroHint: err?.hint || resultado.erroHint || resultado.hint || "",
    queryResumo
  });
}

async function queryDistribuidor({ etapa = "", ofertaId = null, jobId = null, clienteId = "", queryResumo = "", sql = "", params = [], client = null } = {}) {
  const executor = client || getEnginePool();
  if (!executor) {
    const resultado = {
      ok: false,
      motivo: engineDbHabilitado() ? "pool_indisponivel" : "database_url_ausente",
      erro: engineDbHabilitado() ? "pool_indisponivel" : "database_url_ausente"
    };
    logQueryErroDistribuidor({ etapa, ofertaId, jobId, clienteId, resultado, queryResumo });
    return resultado;
  }

  try {
    const resultado = await executor.query(sql, params);
    return { ok: true, resultado };
  } catch (err) {
    logQueryErroDistribuidor({ etapa, ofertaId, jobId, clienteId, err, queryResumo });
    return {
      ok: false,
      motivo: "query_falhou",
      erro: err.message,
      erroCode: err.code || "",
      erroDetail: err.detail || "",
      erroHint: err.hint || ""
    };
  }
}

function normalizarMarketplace(valor = "") {
  return normalizarTexto(valor).toLowerCase();
}

function marketplaceEquivalentesDistribuidor(marketplace = "") {
  const mp = normalizarMarketplace(marketplace);
  const equivalentes = new Set([mp]);

  if (["awin", "kabum", "kabum-awin", "kabum/awin", "kabum awin"].includes(mp)) {
    ["awin", "kabum", "kabum-awin", "feed_awin", "feedAwin", "feedawin", "feedkabum", "feed_kabum"].forEach(chave => {
      equivalentes.add(normalizarMarketplace(chave));
    });
  }

  return [...equivalentes].filter(Boolean);
}

function destinoComMarketplacesEquivalentes(destino = {}, marketplace = "") {
  const lista = Array.isArray(destino?.marketplaces) ? destino.marketplaces : [];
  if (!lista.length) return destino;

  const equivalentes = marketplaceEquivalentesDistribuidor(marketplace);
  const normalizados = lista.map(normalizarMarketplace).filter(Boolean);
  const temAlias = equivalentes.some(chave => normalizados.includes(chave));
  if (!temAlias) return destino;

  return {
    ...destino,
    marketplaces: [...new Set([...lista, ...equivalentes])]
  };
}

function categoriaEhRotuloMarketplace(categoria = "", marketplace = "") {
  const cat = normalizarChave(categoria).replace(/\s+/g, "");
  const mp = normalizarMarketplace(marketplace).replace(/[^a-z0-9]/g, "");
  if (!cat) return false;
  if (cat === mp) return true;
  return ["aliexpress", "ali", "awin", "kabum", "kabumawin", "feedawin", "feedkabum"].includes(cat);
}

function categoriaInferidaPorTitulo(titulo = "") {
  const texto = normalizarChave(titulo);
  if (!texto) return "";

  if (/\b(?:teclado|mouse|headset|fone|monitor|placa|processador|ryzen|intel|rtx|rx\s?\d|gtx|ssd|memoria|ddr|gpu|cpu|notebook|gamer|wi\s?fi|wifi|b550|x99|ajazz|hyperx|netac|veineda|msi)\b/.test(texto)) {
    return "Gamer e Hardware";
  }

  if (/\b(?:camera|seguranca|webcam|roteador|smartwatch|fone bluetooth|carregador|baseus)\b/.test(texto)) {
    return "Eletronicos";
  }

  if (/\b(?:organizador|mesa|cadeira|cozinha|banheiro|casa|decoracao|prateleira)\b/.test(texto)) {
    return "Casa, Moveis e Decoracao";
  }

  if (/\b(?:camiseta|cueca|tenis|chinelo|calca|vestido|bolsa|moda)\b/.test(texto)) {
    return "Roupas e Moda Masculina";
  }

  return "";
}

function categoriasCandidatasOferta(oferta = {}) {
  const marketplace = normalizarMarketplace(oferta.marketplace);
  const categoriaOriginal = normalizarTexto(oferta.categoria || oferta.categoriaProduto || "");
  const categoriaNormalizada = normalizarChave(categoriaOriginal);
  const marketplaceEspecial = ["aliexpress", "awin", "kabum", "kabum-awin"].includes(marketplace);
  const categoriaLiteral = categoriaEhRotuloMarketplace(categoriaOriginal, marketplace);
  const deveReclassificar = categoriaLiteral || (marketplaceEspecial && categoriaNormalizada === "diversos");
  const candidatos = [];
  const adicionar = categoria => {
    const valor = normalizarTexto(categoria);
    if (valor && !candidatos.some(item => normalizarChave(item) === normalizarChave(valor))) candidatos.push(valor);
  };

  if (deveReclassificar) adicionar(categoriaInferidaPorTitulo(oferta.titulo || oferta.nome || ""));
  if (categoriaOriginal && !categoriaLiteral) adicionar(categoriaOriginal);
  if (marketplaceEspecial && categoriaLiteral) adicionar("Diversos");
  if (!candidatos.length && categoriaOriginal) adicionar(categoriaOriginal);

  return candidatos;
}

function limitarDistribuicao(valor = 10) {
  return limitarJobs(valor || 10);
}

function normalizarChave(valor = "") {
  return normalizarTexto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function numeroComparavel(valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero.toFixed(2) : String(valor || "").trim();
}

function ofertaJaExisteNaFila(fila = [], oferta = {}) {
  const clienteId = String(oferta.cliente_id || oferta.clienteId || "").trim();
  const linkOriginal = normalizarChave(oferta.link_original || oferta.linkOriginal || "");
  const linkAfiliado = normalizarChave(oferta.link_afiliado || oferta.linkAfiliado || "");
  const titulo = normalizarChave(oferta.titulo || oferta.nome || "");
  const preco = numeroComparavel(oferta.preco || oferta.precoAtual);

  return fila.some(item => {
    if (String(item?.clienteId || "") !== clienteId) return false;

    const itemLinkOriginal = normalizarChave(item.linkOriginal || item.link_original || "");
    const itemLinkAfiliado = normalizarChave(item.linkAfiliado || item.link || item.linkFinal || "");
    const itemTitulo = normalizarChave(item.titulo || item.nome || "");
    const itemPreco = numeroComparavel(item.preco || item.precoAtual);

    if (linkOriginal && (linkOriginal === itemLinkOriginal || linkOriginal === itemLinkAfiliado)) return true;
    if (linkAfiliado && (linkAfiliado === itemLinkAfiliado || linkAfiliado === itemLinkOriginal)) return true;
    return Boolean(titulo && preco && titulo === itemTitulo && preco === itemPreco);
  });
}

function getFilaFileSeguro(deps = {}, clienteId = "admin") {
  if (typeof deps.getFilaFile === "function") return deps.getFilaFile(clienteId);
  if (typeof deps.getClientePath === "function") return path.join(deps.getClientePath(clienteId), "fila.json");
  return path.join(process.env.DATA_DIR || "/data", "clientes", String(clienteId || "admin"), "fila.json");
}

function carregarFilaCliente(clienteId = "admin", deps = {}) {
  return filaOfertas.carregarFila({
    fila: [],
    clienteId,
    getFilaFile: id => getFilaFileSeguro(deps, id),
    readClienteJson: deps.readClienteJson,
    logger: console
  }).filter(item => String(item?.clienteId || "") === String(clienteId));
}

function salvarFilaCliente(clienteId = "admin", filaCliente = [], deps = {}) {
  const inicio = Date.now();
  const ok = filaOfertas.salvarFila({
    fila: filaCliente,
    clienteId,
    getFilaFile: id => getFilaFileSeguro(deps, id),
    writeClienteJson: deps.writeClienteJson,
    logger: console
  });
  if (ok) {
    try {
      const file = getFilaFileSeguro(deps, clienteId);
      const stat = fs.existsSync(file) ? fs.statSync(file) : null;
      console.log("[FILA-LEGACY-WRITE]", JSON.stringify({
        versao: 1,
        clienteId: String(clienteId || "admin"),
        origem: "distributor_fallback",
        caller: "modules_engine_distributor_salvarFilaCliente",
        arquivo: "fila.json",
        bytes: stat ? stat.size : null,
        tempoMs: Date.now() - inicio,
        v2Operacional: null,
        recoveryAuthority: String(process.env.FILA_V2_RECOVERY_AUTORIDADE || "mtime").toLowerCase() === "generation"
          ? "generation"
          : "mtime",
        vivaGeneration: null,
        durableCheckpointGeneration: null,
        dirtyGeneration: null,
        timestamp: new Date().toISOString()
      }));
    } catch {}
  }
  return ok;
}

function obterDestinosCliente(clienteId = "admin", contexto = {}) {
  const destinosCliente = contexto.destinosPorCliente?.[clienteId];
  if (Array.isArray(destinosCliente)) return destinosCliente;
  if (destinosCliente && typeof destinosCliente === "object") {
    return Object.values(destinosCliente).filter(Array.isArray).flat();
  }

  const configCliente = contexto.configsPorCliente?.[clienteId] || {};
  if (Array.isArray(configCliente.destinosInteligentes)) return configCliente.destinosInteligentes;
  if (Array.isArray(configCliente.destinos)) return configCliente.destinos;
  if (Array.isArray(contexto.configGlobal?.destinosInteligentes)) return contexto.configGlobal.destinosInteligentes;
  return [];
}

function destinoIdDistribuidor(destino = {}) {
  return normalizarTexto(destino.id || destino.destinoId || destino.destino_id || "");
}

function origemClonadorGruposOferta(oferta = {}) {
  const origemFluxo = resolverOrigemFluxo(oferta);
  if (origemFluxo) return origemFluxo === "clonador_grupos";
  const metadata = objetoSeguro(oferta.metadata);
  const jobMetadata = objetoSeguro(oferta.job_metadata);
  const eventoMetadata = objetoSeguro(oferta.evento_metadata);
  const metadataEventoJob = objetoSeguro(jobMetadata.metadataEvento);
  const metadataEventoOferta = objetoSeguro(metadata.metadataEvento);
  const origens = [
    oferta.origem,
    metadata.origem,
    eventoMetadata.origem,
    metadataEventoJob.origem,
    metadataEventoOferta.origem
  ];
  return origens.some(origem => normalizarTexto(origem).toLowerCase() === "clonador_grupos");
}

function metadataClonadorGruposOferta(oferta = {}) {
  if (!origemClonadorGruposOferta(oferta)) return null;
  const metadata = objetoSeguro(oferta.metadata);
  const jobMetadata = objetoSeguro(oferta.job_metadata);
  const eventoMetadata = objetoSeguro(oferta.evento_metadata);
  const fontes = [
    metadata.clonadorGrupos,
    objetoSeguro(jobMetadata.metadataEvento).clonadorGrupos,
    eventoMetadata.clonadorGrupos
  ];
  return fontes.find(item => item && typeof item === "object" && !Array.isArray(item)) || null;
}

function filtrarDestinosClonadorGrupos(destinos = [], oferta = {}) {
  const clonadorGrupos = metadataClonadorGruposOferta(oferta);
  if (!clonadorGrupos) return destinos;
  const destinoIds = Array.isArray(clonadorGrupos.destinoIds)
    ? clonadorGrupos.destinoIds.map(normalizarTexto).filter(Boolean)
    : [];
  if (!destinoIds.length) return [];
  const autorizados = new Set(destinoIds);
  return destinos.filter(destino => autorizados.has(destinoIdDistribuidor(destino)));
}

function analisarDestinosOferta(clienteId = "admin", oferta = {}, contexto = {}) {
  const destinos = filtrarDestinosClonadorGrupos(obterDestinosCliente(clienteId, contexto), oferta);
  const compativeis = [];
  const rejeitados = [];
  const categorias = categoriasCandidatasOferta(oferta);

  for (const destino of destinos) {
    const destinoNormalizado = destinoComMarketplacesEquivalentes(destino, oferta.marketplace);
    let analiseAceita = null;
    let analiseRetida = null;

    for (const categoria of categorias.length ? categorias : [oferta.categoria || oferta.categoriaProduto || ""]) {
      const analise = destinosUtils.analisarDestinoOferta(destinoNormalizado, {
        origem: oferta.origem,
        origemFluxo: resolverOrigemFluxo(oferta),
        fonte: oferta.fonte,
        marketplace: oferta.marketplace,
        categoria,
        categoriaProduto: categoria,
        titulo: oferta.titulo,
        termo: oferta.titulo,
        metadata: oferta.metadata,
        evento_metadata: oferta.evento_metadata,
        job_metadata: oferta.job_metadata
      });
      const analiseComCategoria = { ...analise, categoriaUsada: categoria };

      if (analise.aceita) {
        analiseAceita = analiseComCategoria;
        break;
      }

      analiseRetida = analiseRetida || analiseComCategoria;
    }

    if (analiseAceita) compativeis.push({ destino, analise: analiseAceita });
    else rejeitados.push({ destino, analise: analiseRetida || { aceita: false, motivo: "categoria", categoriaUsada: oferta.categoria || "" } });

    logDiagnosticoDestinoDistribuidor({
      clienteId,
      oferta,
      destino,
      analise: analiseAceita || analiseRetida || {},
      aceita: Boolean(analiseAceita)
    });
  }

  return { destinos, compativeis, rejeitados };
}

function categoriasDestinoRetencao(destinos = []) {
  const categorias = new Set();

  for (const destino of Array.isArray(destinos) ? destinos : []) {
    const lista = destino?.categorias || destino?.categoriasPermitidas || [];
    for (const categoria of Array.isArray(lista) ? lista : []) {
      const texto = normalizarTexto(categoria);
      if (texto) categorias.add(texto);
    }
  }

  return [...categorias];
}

function listaSeguraDestino(lista = []) {
  return (Array.isArray(lista) ? lista : [])
    .map(item => normalizarTexto(item))
    .filter(Boolean)
    .slice(0, 25);
}

function listaDestinoDiagnostico(...listas) {
  for (const lista of listas) {
    if (Array.isArray(lista) && lista.length) return lista;
  }
  return [];
}

function detalhesDestinoAnalise(item = {}) {
  const destino = item.destino || {};
  const analise = item.analise || {};
  const categoriasPermitidas = listaSeguraDestino(listaDestinoDiagnostico(destino.categorias, destino.categoriasPermitidas));
  const marketplacesPermitidos = listaSeguraDestino(listaDestinoDiagnostico(destino.marketplaces, destino.marketplacesPermitidos));
  const ativo = destino?.ativo !== false;
  const aceitaMarketplace = analise.aceitaMarketplace === true;
  const aceitaCategoria = analise.aceitaCategoria === true;

  return {
    destinoId: normalizarTexto(destino.id || destino.destinoId || ""),
    destinoNome: normalizarTexto(destino.nome || destino.name || ""),
    ativo,
    marketplaceCompativel: aceitaMarketplace,
    marketplacesPermitidos,
    categoriaOferta: normalizarTexto(analise.categoriaUsada || analise.categoriaOferta || ""),
    categoriasPermitidas,
    aceitaCategoria,
    aceito: analise.aceita === true,
    motivoFinal: analise.aceita === true
      ? "destino_compativel"
      : (analise.motivo === "categoria" ? "categoria_incompativel" : (analise.motivo || "sem_motivo"))
  };
}

function logDiagnosticoDestinoDistribuidor({ clienteId = "", oferta = {}, destino = {}, analise = {}, aceita = false } = {}) {
  try {
    const diagnostico = detalhesDestinoAnalise({
      destino,
      analise: {
        ...analise,
        aceita
      }
    });

    console.log("[ENGINE-DISTRIBUIDOR-DESTINO-DIAGNOSTICO]", JSON.stringify({
      clienteId,
      ofertaId: oferta.id || null,
      jobId: oferta.job_id || null,
      marketplace: normalizarMarketplace(oferta.marketplace),
      ...diagnostico
    }));
  } catch (_) {}
}

function motivoDestinoRetido(analise = {}) {
  if (!analise.destinos.length) return "sem_destino";
  const rejeitados = Array.isArray(analise.rejeitados) ? analise.rejeitados : [];
  const ativos = rejeitados.filter(item => item.destino?.ativo !== false);
  const ativosOuTodos = ativos.length ? ativos : rejeitados;
  if (ativosOuTodos.length && ativosOuTodos.every(item => item.analise?.motivo === "marketplace")) return "marketplace_bloqueado";
  if (ativosOuTodos.some(item => item.analise?.motivo === "categoria" && item.analise?.aceitaMarketplace === true)) return "categoria_incompativel";
  if (ativosOuTodos.length && ativosOuTodos.every(item => item.analise?.motivo === "categoria")) return "categoria_incompativel";
  if (ativosOuTodos.length && ativosOuTodos.every(item => item.analise?.motivo === "origem_nao_permitida")) return "origem_nao_permitida";
  return "sem_destino";
}

function objetoSeguro(valor = {}) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function normalizarValorImagemFila(valor) {
  if (typeof valor === "string") return normalizarTexto(valor);
  if (Array.isArray(valor)) {
    for (const item of valor) {
      const imagem = normalizarValorImagemFila(item);
      if (imagem) return imagem;
    }
    return "";
  }
  if (!valor || typeof valor !== "object") return "";
  return normalizarTexto(
    valor.url ||
    valor.src ||
    valor.imagem ||
    valor.image ||
    valor.thumbnail ||
    valor.imagemUrl ||
    valor.imageUrl ||
    valor.urlImagem ||
    valor.picture ||
    valor.pictureUrl ||
    ""
  );
}

function adicionarImagemFila(candidatos = [], origem = "", valor = "", tipo = "fallback") {
  const imagem = normalizarValorImagemFila(valor);
  if (imagem) candidatos.push({ imagem, origem, tipo });
}

function adicionarCamposImagemFila(candidatos = [], prefixo = "", fonte = {}, tipo = "fallback") {
  const objeto = objetoSeguro(fonte);
  const diretos = ["imagem", "image", "thumbnail", "imagemUrl", "imageUrl", "urlImagem", "foto", "midia", "imagemRadar", "imagemOriginal", "imageOriginal", "picture", "pictureUrl"];
  const alternativos = ["imagens", "images", "imageUrls", "image_urls", "fotos", "thumbnails", "galeria", "pictures", "imagensAlternativas", "alternativeImages", "product_small_image_urls"];

  for (const campo of diretos) {
    adicionarImagemFila(candidatos, `${prefixo}.${campo}`, objeto[campo], tipo);
  }

  for (const campo of alternativos) {
    adicionarImagemFila(candidatos, `${prefixo}.${campo}`, objeto[campo], "fallback_alternativo");
  }
}

function origemImagemFilaCompat(origem = "") {
  if (origem === "imagem") return "engine_ofertas.imagem";
  if (origem === "imagemUrl") return "engine_ofertas.imagemUrl";
  if (/^metadata\.produto\.images\[\d+\]/.test(origem)) return "metadata.produto.images";
  if (/^metadata\.produto\.imagens\[\d+\]/.test(origem)) return "metadata.produto.imagens";
  if (/^evento_metadata\./.test(origem)) return origem.replace(/^evento_metadata\./, "evento.metadata.");
  if (/^job_metadata\./.test(origem)) return origem.replace(/^job_metadata\./, "job.metadata.");
  if (/^link_metadata\./.test(origem)) return origem.replace(/^link_metadata\./, "link.metadata.");
  return origem || "nenhuma";
}

function resolverImagemFilaEngine(oferta = {}) {
  const resolvida = resolverImagemUniversal(oferta, { origem: "engine_distributor" });
  const imagem = resolvida.imagem || resolvida.imagemUrl || "";

  if (!imagem) {
    return {
      imagem: "",
      origem: "nenhuma",
      fallbackUsado: false,
      ausenciaMotivo: "nenhuma_fonte_de_imagem",
      imagemStatus: resolvida.imagemStatus || "nao_resolvida",
      imagemConfianca: resolvida.imagemConfianca || 0,
      imagemUrlPresente: resolvida.imagemUrlPresente === true,
      imagemRecuperavel: resolvida.imagemRecuperavel === true,
      imagemDuravel: resolvida.imagemDuravel === true,
      imagemEnviavel: resolvida.imagemEnviavel === true,
      imagemTentativas: resolvida.imagemTentativas || [],
    };
  }

  const origem = origemImagemFilaCompat(resolvida.imagemOrigem);

  return {
    imagem,
    origem,
    fallbackUsado: origem !== "engine_ofertas.imagem",
    ausenciaMotivo: "",
    imagemStatus: resolvida.imagemStatus,
    imagemConfianca: resolvida.imagemConfianca,
    imagemUrlPresente: resolvida.imagemUrlPresente === true,
    imagemRecuperavel: resolvida.imagemRecuperavel === true,
    imagemDuravel: resolvida.imagemDuravel === true,
    imagemEnviavel: resolvida.imagemEnviavel === true,
    imagemResolvidaEm: resolvida.imagemResolvidaEm,
    imagemTentativas: resolvida.imagemTentativas || [],
  };
}

function logImagemFilaEngine(oferta = {}, resolucao = {}) {
  const base = {
    ofertaId: oferta.id || null,
    jobId: oferta.job_id || null,
    clienteId: oferta.cliente_id || "",
    marketplace: oferta.marketplace || "",
    origem: resolucao.origem || "nenhuma",
    fallbackUsado: resolucao.fallbackUsado === true,
    motivo: resolucao.ausenciaMotivo || ""
  };

  if (resolucao.imagem && resolucao.fallbackUsado === true) {
    console.log("[ENGINE-IMAGEM-FALLBACK-USADO]", JSON.stringify(base));
    return;
  }

  if (resolucao.imagem) {
    console.log("[ENGINE-IMAGEM-ORIGEM]", JSON.stringify(base));
    return;
  }

  console.log("[ENGINE-IMAGEM-AUSENTE]", JSON.stringify(base));
}

function textoComercialFila(valor = "") {
  return normalizarTexto(valor || "").toLowerCase();
}

function urlRenderizavelComercialFila(item = {}) {
  if (!item || typeof item !== "object") return "";
  return normalizarTexto(
    item.urlOptimus ||
    item.urlAfiliadaWorkspace ||
    item.urlAfiliada ||
    item.afiliado ||
    item.linkAfiliado ||
    ""
  );
}

function papelComercialFila(item = {}) {
  return textoComercialFila(item?.papel || item?.tipo || "").replace(/^link_/, "");
}

function linksComerciaisCompletosParaFila({ oferta = {}, links = [] } = {}) {
  const lista = Array.isArray(links)
    ? links.map(item => item && typeof item === "object" ? { ...item } : item)
    : [];
  const temResgateRenderizavel = lista.some(item => (
    papelComercialFila(item) === "resgate" &&
    item?.renderizavel === true &&
    Boolean(urlRenderizavelComercialFila(item))
  ));
  const temProdutoRenderizavel = lista.some(item => (
    papelComercialFila(item) === "produto" &&
    item?.renderizavel === true &&
    Boolean(urlRenderizavelComercialFila(item))
  ));
  if (!temResgateRenderizavel || temProdutoRenderizavel) return lista;

  const metadata = oferta.metadata && typeof oferta.metadata === "object" ? oferta.metadata : {};
  const integridade = metadata.integridadeComercial && typeof metadata.integridadeComercial === "object"
    ? metadata.integridadeComercial
    : (metadata.ofcV24?.integridadeComercial && typeof metadata.ofcV24.integridadeComercial === "object"
      ? metadata.ofcV24.integridadeComercial
      : {});
  const documento = metadata.ofcV24?.documentoComercialCanonico && typeof metadata.ofcV24.documentoComercialCanonico === "object"
    ? metadata.ofcV24.documentoComercialCanonico
    : {};
  const linkOriginal = normalizarTexto(oferta.link_original || oferta.linkOriginal || "");
  const linkAfiliado = normalizarTexto(oferta.link_afiliado || oferta.linkAfiliado || "");
  if (!linkOriginal || !linkAfiliado) return lista;

  const mesmaUrl = (a, b) => {
    const esquerda = textoComercialFila(a);
    const direita = textoComercialFila(b);
    return Boolean(esquerda && direita && esquerda === direita);
  };
  const provaIntegridade = (Array.isArray(integridade.linksDescartadosRadar) ? integridade.linksDescartadosRadar : [])
    .some(item => (
      papelComercialFila(item) === "produto" &&
      mesmaUrl(item?.urlOriginal || item?.url, linkOriginal) &&
      mesmaUrl(item?.destinoFuncionalFinal?.url, linkAfiliado)
    ));
  const provaDocumento = mesmaUrl(documento.linkAfiliado, linkAfiliado) &&
    (Array.isArray(documento.linksComerciais) ? documento.linksComerciais : []).some(item => (
      papelComercialFila(item) === "produto" &&
      mesmaUrl(urlRenderizavelComercialFila(item) || item?.url, linkAfiliado)
    ));
  if (!provaIntegridade && !provaDocumento) return lista;

  const ordemCaptura = Math.max(0, ...lista.map(item => Number(item?.ordemCaptura || item?.ordem || 0) || 0)) + 1;
  return [...lista, {
    tipo: "produto",
    papel: "link_produto",
    urlOriginal: linkOriginal,
    urlAfiliada: linkAfiliado,
    urlAfiliadaWorkspace: linkAfiliado,
    urlOptimus: linkAfiliado,
    renderizavel: true,
    seguro: true,
    ordemCaptura,
    origem: "distribuidor.produto_afiliado_canonico",
    conversaoStatus: "convertida",
    motivoConversao: "produto_afiliado_canonico_preservado_fila"
  }];
}

function copiarCamposComerciaisRadarFila(oferta = {}) {
  const contrato = oferta.metadata?.radarEspelhoComercial?.contratoComercial &&
    typeof oferta.metadata.radarEspelhoComercial.contratoComercial === "object"
      ? oferta.metadata.radarEspelhoComercial.contratoComercial
      : {};
  const origem = { ...contrato, ...oferta };
  const campos = {};

  for (const campo of [
    "textoComercialCanonico",
    "documentoComercialCanonico",
    "textoComercialOriginal",
    "descricao",
    "precoAnterior",
    "precoPix",
    "condicaoPix",
    "precoUnitario",
    "quantidade",
    "parcelamento",
    "quantidadeParcelas",
    "valorParcela",
    "codigoCupom",
    "cupons",
    "codigosCupom",
    "instrucaoCupom",
    "beneficioExtra",
    "beneficios",
    "condicoes",
    "observacoes",
    "cashback",
    "frete",
    "freteGratis",
    "variantes",
    "tamanhos",
    "cores",
    "voltagem",
    "ofertaRelampago",
    "validade",
    "linksComerciais",
    "linksProduto",
    "linksResgate",
    "produtoId"
  ]) {
    const valor = origem[campo];
    if (valor === null || valor === undefined || valor === "") continue;
    campos[campo] = Array.isArray(valor)
      ? valor.map(item => item && typeof item === "object" ? { ...item } : item)
      : (valor && typeof valor === "object" ? { ...valor } : valor);
  }

  const integridadeComercial = oferta.metadata?.integridadeComercial || oferta.metadata?.ofcV24?.integridadeComercial || null;
  if (integridadeComercial && typeof integridadeComercial === "object" && !Array.isArray(integridadeComercial)) {
    campos.integridadeComercial = {
      ...integridadeComercial,
      linksComerciais: Array.isArray(integridadeComercial.linksComerciais)
        ? integridadeComercial.linksComerciais.map(item => item && typeof item === "object" ? { ...item } : item)
        : []
    };

    if (!campos.linksComerciais && Array.isArray(integridadeComercial.linksComerciais)) {
      campos.linksComerciais = integridadeComercial.linksComerciais
        .map(item => item && typeof item === "object" ? { ...item } : item);
    }

    if (!campos.precoValidado && integridadeComercial.precoValidado) {
      campos.precoValidado = { ...integridadeComercial.precoValidado };
    }
  }

  const linksComerciaisCompletos = linksComerciaisCompletosParaFila({
    oferta,
    links: campos.linksComerciais
  });
  if (linksComerciaisCompletos.length !== (campos.linksComerciais || []).length) {
    campos.linksComerciais = linksComerciaisCompletos;
    if (campos.integridadeComercial) {
      campos.integridadeComercial.linksComerciais = linksComerciaisCompletos
        .map(item => item && typeof item === "object" ? { ...item } : item);
    }
  }

  return campos;
}

function montarItemFilaEngine(oferta = {}) {
  const linkAfiliado = normalizarTexto(oferta.link_afiliado || oferta.link_expandido || oferta.link_original || "");
  const linkOriginal = normalizarTexto(oferta.link_original || oferta.link_expandido || linkAfiliado || "");
  const titulo = normalizarTexto(oferta.titulo || "");
  const cupom = normalizarTexto(oferta.cupom || "");
  const cupomTipo = normalizarTexto(oferta.tipo_cupom || oferta.cupomTipo || oferta.tipoCupom || "");
  const beneficioExtra = normalizarTexto(oferta.beneficio_extra || oferta.beneficioExtra || "");
  const avisoCupom = normalizarTexto(oferta.aviso_cupom || oferta.avisoCupom || "");
  const imagemResolvida = resolverImagemFilaEngine(oferta);
  const imagemPiloto = selecionarImagemEspelhoPiloto({
    workspaceId: oferta.cliente_id,
    oferta,
    imagemAtual: imagemResolvida.imagem
  });
  const imagemFinal = imagemPiloto.usarImagemEspelho ? imagemPiloto.imagem : imagemResolvida.imagem;
  const camposComerciaisRadar = copiarCamposComerciaisRadarFila(oferta);
  const origemFluxo = resolverOrigemFluxo(oferta);

  return {
    id: `engine_${oferta.id}_${Date.now()}`,
    engineOfertaId: oferta.id,
    engineOfertaUuid: oferta.uuid,
    engineJobId: oferta.job_id,
    clienteId: normalizarTexto(oferta.cliente_id),
    marketplace: normalizarMarketplace(oferta.marketplace),
    titulo,
    nome: titulo,
    preco: oferta.preco,
    precoAtual: oferta.preco,
    precoOriginal: oferta.preco_original,
    ...camposComerciaisRadar,
    imagem: imagemFinal,
    imagemUrl: imagemFinal,
    imagemOrigem: imagemPiloto.usarImagemEspelho ? (imagemPiloto.origem || "ofc_v2_4_espelho_comercial") : imagemResolvida.origem,
    imagemFallbackUsado: imagemPiloto.usarImagemEspelho ? false : imagemResolvida.fallbackUsado,
    imagemEspelhoPiloto: {
      ativo: imagemPiloto.motivo !== "workspace_fora_do_piloto",
      aplicada: imagemPiloto.usarImagemEspelho === true,
      motivo: imagemPiloto.motivo || ""
    },
    imagemAusenteMotivo: imagemResolvida.ausenciaMotivo,
    imagemStatus: imagemResolvida.imagemStatus,
    imagemConfianca: imagemResolvida.imagemConfianca,
    imagemUrlPresente: imagemResolvida.imagemUrlPresente,
    imagemRecuperavel: imagemResolvida.imagemRecuperavel,
    imagemDuravel: imagemResolvida.imagemDuravel,
    imagemEnviavel: imagemResolvida.imagemEnviavel,
    imagemResolvidaEm: imagemResolvida.imagemResolvidaEm,
    imagemTentativas: imagemResolvida.imagemTentativas,
    linkOriginal,
    linkAfiliado,
    link: linkAfiliado,
    linkFinal: linkAfiliado,
    categoria: normalizarTexto(oferta.categoria || ""),
    score: oferta.score,
    cupom,
    tipoCupom: cupomTipo,
    cupomTipo,
    avisoCupom,
    beneficioExtra,
    beneficioTexto: beneficioExtra,
    origem: "engine",
    ...(origemFluxo ? { origemFluxo } : {}),
    origemDetalhe: "Engine V2",
    metadata: oferta.metadata && typeof oferta.metadata === "object" ? oferta.metadata : {},
    status: "pendente",
    statusDetalhe: "Aguardando envio",
    destinosEnviados: [],
    logsEnvio: [],
    enviadoEm: "",
    dataEnvio: "",
    criadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    dataEntradaFila: new Date().toISOString()
  };
}

async function buscarOfertasDistribuiveis({ limite = 10, marketplace = "", clienteId = "", excluirOfertaIds = [] } = {}) {
  const params = [];
  const filtros = ["o.status IN ('importada', 'oferta_criada')"];
  const idsExcluidos = Array.isArray(excluirOfertaIds)
    ? [...new Set(excluirOfertaIds.map(id => Number(id)).filter(id => Number.isSafeInteger(id) && id > 0))]
    : [];

  if (marketplace) {
    params.push(normalizarMarketplace(marketplace));
    filtros.push(`LOWER(COALESCE(o.marketplace, '')) = $${params.length}`);
  }

  if (clienteId) {
    params.push(String(clienteId).trim());
    filtros.push(`j.cliente_id = $${params.length}`);
  }

  if (idsExcluidos.length) {
    params.push(idsExcluidos);
    filtros.push(`NOT (o.id = ANY($${params.length}::bigint[]))`);
  }

  params.push(limitarDistribuicao(limite));
  const temMetadataOferta = await engineOfertasTemMetadataDistribuidor();
  const metadataOfertaExpr = temMetadataOferta
    ? "COALESCE(o.metadata, '{}'::jsonb)"
    : "'{}'::jsonb";
  const campoMetadata = temMetadataOferta
    ? "o.metadata"
    : "'{}'::jsonb AS metadata";

  const resultado = await queryDistribuidor({
    etapa: "buscar_ofertas_distribuiveis",
    queryResumo: "SELECT engine_ofertas JOIN engine_jobs_cliente",
    sql: `WITH candidatos_distribuiveis AS (
      SELECT o.id, o.uuid, o.evento_id, e.origem, o.link_id, o.marketplace, o.titulo,
             o.preco, o.preco_original, o.cupom, o.tipo_cupom, o.beneficio_extra,
             o.imagem, o.link_original, o.link_expandido,
             o.link_afiliado, o.categoria, o.score, o.prioridade, o.status, o.motivo_status,
             ${campoMetadata},
             o.criada_em, o.atualizada_em, e.capturado_em AS evento_capturado_em, j.id AS job_id, j.cliente_id,
              j.metadata AS job_metadata, e.metadata AS evento_metadata,
              CASE
                WHEN LOWER(COALESCE(
                  NULLIF(${metadataOfertaExpr}->>'origemFluxo', ''),
                  NULLIF(${metadataOfertaExpr}->>'origem_fluxo', ''),
                  NULLIF(j.metadata->>'origemFluxo', ''),
                  NULLIF(j.metadata->>'origem_fluxo', ''),
                  NULLIF(j.metadata #>> '{metadataEvento,origemFluxo}', ''),
                  NULLIF(j.metadata #>> '{metadataEvento,origem_fluxo}', ''),
                  NULLIF(e.metadata->>'origemFluxo', ''),
                  NULLIF(e.metadata->>'origem_fluxo', '')
                )) IN ('optimus', 'clonador_grupos')
                  THEN LOWER(COALESCE(
                    NULLIF(${metadataOfertaExpr}->>'origemFluxo', ''),
                    NULLIF(${metadataOfertaExpr}->>'origem_fluxo', ''),
                    NULLIF(j.metadata->>'origemFluxo', ''),
                    NULLIF(j.metadata->>'origem_fluxo', ''),
                    NULLIF(j.metadata #>> '{metadataEvento,origemFluxo}', ''),
                    NULLIF(j.metadata #>> '{metadataEvento,origem_fluxo}', ''),
                    NULLIF(e.metadata->>'origemFluxo', ''),
                    NULLIF(e.metadata->>'origem_fluxo', '')
                  ))
                ELSE ''
              END AS origem_fluxo_explicita_distribuidor,
             ROW_NUMBER() OVER (
               PARTITION BY LOWER(COALESCE(o.marketplace, '')), j.cliente_id
               ORDER BY COALESCE(e.capturado_em, o.criada_em, o.atualizada_em, NOW()) DESC,
                        COALESCE(o.prioridade, o.score, 0) DESC,
                        o.id ASC
             ) AS ordem_workspace_marketplace,
             ROW_NUMBER() OVER (
               PARTITION BY LOWER(COALESCE(o.marketplace, ''))
               ORDER BY COALESCE(e.capturado_em, o.criada_em, o.atualizada_em, NOW()) DESC,
                        COALESCE(o.prioridade, o.score, 0) DESC,
                        o.id ASC
             ) AS ordem_marketplace
        FROM engine_ofertas o
        JOIN engine_jobs_cliente j ON j.oferta_id = o.id
        LEFT JOIN engine_eventos_brutos e ON e.id = o.evento_id
       WHERE ${filtros.join(" AND ")}
    ),
    baseline AS (
      SELECT *,
             NULL::bigint AS origem_head_rank_distribuidor,
             ROW_NUMBER() OVER (
               ORDER BY ordem_workspace_marketplace ASC,
                        ordem_marketplace ASC,
                        COALESCE(evento_capturado_em, criada_em, atualizada_em, NOW()) DESC,
                        COALESCE(prioridade, score, 0) DESC,
                        id ASC
             ) AS baseline_ordem_distribuidor
        FROM candidatos_distribuiveis
       ORDER BY ordem_workspace_marketplace ASC,
                ordem_marketplace ASC,
                COALESCE(evento_capturado_em, criada_em, atualizada_em, NOW()) DESC,
                COALESCE(prioridade, score, 0) DESC,
                id ASC
       LIMIT $${params.length}
    ),
    grupos_representados_baseline AS (
      SELECT DISTINCT cliente_id, LOWER(COALESCE(marketplace, '')) AS marketplace_chave_distribuidor
        FROM baseline
    ),
    heads_origem_ranked AS (
      SELECT candidatos.*,
             ROW_NUMBER() OVER (
               PARTITION BY cliente_id,
                            LOWER(COALESCE(marketplace, '')),
                            origem_fluxo_explicita_distribuidor
               ORDER BY COALESCE(evento_capturado_em, criada_em, atualizada_em, NOW()) DESC,
                        COALESCE(prioridade, score, 0) DESC,
                        id ASC
             ) AS origem_head_rank_distribuidor
        FROM candidatos_distribuiveis candidatos
       WHERE origem_fluxo_explicita_distribuidor IN ('optimus', 'clonador_grupos')
    ),
    heads_protegidas AS (
      SELECT heads.*, NULL::bigint AS baseline_ordem_distribuidor
        FROM heads_origem_ranked heads
        JOIN grupos_representados_baseline grupos
          ON grupos.cliente_id = heads.cliente_id
         AND grupos.marketplace_chave_distribuidor = LOWER(COALESCE(heads.marketplace, ''))
       WHERE heads.origem_head_rank_distribuidor = 1
    ),
    candidate_pool_bruto AS (
      SELECT baseline.*, 'baseline'::text AS candidate_pool_origem_distribuidor
        FROM baseline
      UNION ALL
      SELECT heads.*, 'head_protegida'::text AS candidate_pool_origem_distribuidor
        FROM heads_protegidas heads
    ),
    candidate_pool_ranqueado AS (
      SELECT *,
             ROW_NUMBER() OVER (
               PARTITION BY id
               ORDER BY CASE WHEN candidate_pool_origem_distribuidor = 'baseline' THEN 0 ELSE 1 END,
                        baseline_ordem_distribuidor ASC NULLS LAST,
                        origem_head_rank_distribuidor ASC NULLS LAST,
                        id ASC
             ) AS candidate_pool_dedup_rank_distribuidor
        FROM candidate_pool_bruto
    ),
    candidate_pool AS (
      SELECT *
        FROM candidate_pool_ranqueado
       WHERE candidate_pool_dedup_rank_distribuidor = 1
    ),
    saida_distribuidor AS (
      SELECT 'baseline'::text AS tipo_saida_distribuidor, baseline.*,
             NULL::text AS candidate_pool_origem_distribuidor,
             NULL::bigint AS candidate_pool_dedup_rank_distribuidor
        FROM baseline
      UNION ALL
      SELECT 'candidate_pool'::text AS tipo_saida_distribuidor, *
        FROM candidate_pool
    )
    SELECT tipo_saida_distribuidor, id, uuid, evento_id, origem, link_id, marketplace, titulo,
           preco, preco_original, cupom, tipo_cupom, beneficio_extra,
           imagem, link_original, link_expandido,
           link_afiliado, categoria, score, prioridade, status, motivo_status,
           metadata,
           criada_em, atualizada_em, evento_capturado_em, job_id, cliente_id,
           job_metadata, evento_metadata, origem_fluxo_explicita_distribuidor,
           baseline_ordem_distribuidor, origem_head_rank_distribuidor,
           candidate_pool_origem_distribuidor, candidate_pool_dedup_rank_distribuidor
      FROM saida_distribuidor
     ORDER BY CASE WHEN tipo_saida_distribuidor = 'baseline' THEN 0 ELSE 1 END,
              baseline_ordem_distribuidor ASC NULLS LAST,
              ordem_workspace_marketplace ASC,
              ordem_marketplace ASC,
              id ASC`,
    params
  });

  if (!resultado.ok) {
    return { ok: false, ofertas: [], candidatePool: [], motivo: resultado.motivo, erro: resultado.erro, erroCode: resultado.erroCode || "" };
  }
  return { ok: true, ...separarResultadoOfertasDistribuiveis(resultado.resultado.rows) };
}

function removerCamposInternosCandidatePoolDistribuidor(linha = {}) {
  const {
    tipo_saida_distribuidor,
    origem_fluxo_explicita_distribuidor,
    baseline_ordem_distribuidor,
    origem_head_rank_distribuidor,
    candidate_pool_origem_distribuidor,
    candidate_pool_dedup_rank_distribuidor,
    ...oferta
  } = linha;
  return oferta;
}

function separarResultadoOfertasDistribuiveis(linhas = []) {
  const resultado = Array.isArray(linhas) ? linhas : [];
  return {
    ofertas: resultado
      .filter(linha => linha.tipo_saida_distribuidor !== "candidate_pool")
      .map(removerCamposInternosCandidatePoolDistribuidor),
    candidatePool: resultado
      .filter(linha => linha.tipo_saida_distribuidor === "candidate_pool")
      .map(linha => {
        const oferta = removerCamposInternosCandidatePoolDistribuidor(linha);
        const origemFluxo = String(linha.origem_fluxo_explicita_distribuidor || "").trim();
        return origemFluxo
          ? {
            ...oferta,
            origemFluxo,
            origemFluxoHead: Number(linha.origem_head_rank_distribuidor) === 1
          }
          : oferta;
      })
  };
}

async function tentarMarcarDistribuindo(ofertaId, contextoLog = {}, client = null) {
  const resultado = await queryDistribuidor({
    etapa: "marcar_distribuindo",
    ofertaId,
    queryResumo: "UPDATE engine_ofertas SET status = distribuindo",
    sql: `UPDATE engine_ofertas
        SET status = 'distribuindo', motivo_status = NULL, atualizada_em = NOW()
      WHERE id = $1 AND status IN ('importada', 'oferta_criada')
      RETURNING id, status`,
    params: [ofertaId],
    client
  });

  if (!resultado.ok) {
    return { ok: false, motivo: resultado.motivo, erro: resultado.erro, erroCode: resultado.erroCode || "" };
  }
  return { ok: resultado.resultado.rowCount > 0, ignorado: resultado.resultado.rowCount === 0 };
}

async function marcarOfertaStatus(ofertaId, status, motivo = "", contextoLog = {}) {
  const resultado = await queryDistribuidor({
    etapa: "marcar_status_oferta",
    ofertaId,
    clienteId: contextoLog.clienteId || "",
    queryResumo: "UPDATE engine_ofertas SET status/motivo_status",
    sql: `UPDATE engine_ofertas
        SET status = $2, motivo_status = $3, atualizada_em = NOW()
      WHERE id = $1
      RETURNING id, status, motivo_status`,
    params: [ofertaId, status, motivo || null]
  });

  return resultado;
}

async function restaurarOfertaStatusSeDistribuindo(ofertaId, statusAnterior, motivo = "", contextoLog = {}) {
  const statusSeguro = String(statusAnterior || "").trim();
  if (!["importada", "oferta_criada"].includes(statusSeguro)) {
    return { ok: true, ignorado: true, motivo: "status_anterior_nao_restauravel" };
  }

  const resultado = await queryDistribuidor({
    etapa: "restaurar_status_pos_gate",
    ofertaId,
    clienteId: contextoLog.clienteId || "",
    queryResumo: "UPDATE engine_ofertas SET status anterior WHERE status = distribuindo",
    sql: `UPDATE engine_ofertas
        SET status = $2, motivo_status = NULL, atualizada_em = NOW()
      WHERE id = $1 AND status = 'distribuindo'
      RETURNING id, status, motivo_status`,
    params: [ofertaId, statusSeguro]
  });

  if (!resultado.ok) return resultado;
  if (resultado.resultado.rowCount === 0) {
    console.log("[OFC-GATE-ATIVO-RESTAURACAO-CONFLITO]", JSON.stringify({
      ofertaId: ofertaId || null,
      jobId: contextoLog.jobId || null,
      workspaceId: contextoLog.clienteId || "",
      statusAnterior: statusSeguro,
      motivo: motivo || "",
      preservouEstadoMaisNovo: true
    }));
    return { ok: true, ignorado: true, motivo: "status_alterado_por_concorrencia" };
  }

  return resultado;
}

async function restaurarOfertaParaReentradaFlow(ofertaId, statusAnterior, motivo = "", detalhes = {}, contextoLog = {}) {
  const statusSeguro = String(statusAnterior || "").trim();
  if (!["importada", "oferta_criada"].includes(statusSeguro)) {
    return { ok: true, ignorado: true, motivo: "status_anterior_nao_restauravel" };
  }

  const motivoSeguro = String(motivo || "flow_reentrada_temporaria").trim();
  const temMetadata = await engineOfertasTemMetadataDistribuidor();
  const detalhesSeguros = detalhes && typeof detalhes === "object" ? detalhes : {};
  const metadataFlow = {
    natureza: "temporaria",
    motivo: motivoSeguro,
    proximaTentativaEm: detalhesSeguros.proximaTentativaEm || "",
    origem: detalhesSeguros.origem || "flow_manager",
    atualizadoEm: new Date().toISOString()
  };

  const sql = temMetadata
    ? `UPDATE engine_ofertas
        SET status = $2,
            motivo_status = $3,
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('flowReentrada', $4::jsonb),
            atualizada_em = NOW()
      WHERE id = $1 AND status = 'distribuindo'
      RETURNING id, status, motivo_status, metadata`
    : `UPDATE engine_ofertas
        SET status = $2, motivo_status = $3, atualizada_em = NOW()
      WHERE id = $1 AND status = 'distribuindo'
      RETURNING id, status, motivo_status`;

  const params = temMetadata
    ? [ofertaId, statusSeguro, motivoSeguro, JSON.stringify(metadataFlow)]
    : [ofertaId, statusSeguro, motivoSeguro];

  const resultado = await queryDistribuidor({
    etapa: "restaurar_status_flow_reentrada",
    ofertaId,
    clienteId: contextoLog.clienteId || "",
    queryResumo: "UPDATE engine_ofertas SET status anterior + flow reentrada",
    sql,
    params
  });

  if (!resultado.ok) return resultado;
  if (resultado.resultado.rowCount === 0) {
    console.log("[OPTIMUS-FLOW-V1-REENTRADA-CONFLITO]", JSON.stringify({
      ofertaId: ofertaId || null,
      jobId: contextoLog.jobId || null,
      workspaceId: contextoLog.clienteId || "",
      statusAnterior: statusSeguro,
      motivo: motivoSeguro,
      preservouEstadoMaisNovo: true
    }));
    return { ok: true, ignorado: true, motivo: "status_alterado_por_concorrencia" };
  }

  return resultado;
}

async function registrarEtapaDistribuicao(jobId, etapa, status, motivo = "", detalhes = {}) {
  if (!jobId) {
    logQueryErroDistribuidor({
      etapa,
      jobId,
      ofertaId: detalhes.ofertaId || null,
      clienteId: detalhes.clienteId || "",
      resultado: { erro: "job_id_ausente" },
      queryResumo: "INSERT engine_processamentos"
    });
    return { ok: false, motivo: "job_id_ausente" };
  }

  return queryDistribuidor({
    etapa,
    jobId,
    ofertaId: detalhes.ofertaId || null,
    clienteId: detalhes.clienteId || "",
    queryResumo: "INSERT engine_processamentos",
    sql: `INSERT INTO engine_processamentos (job_id, etapa, status, motivo, detalhes)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id`,
    params: [jobId, etapa, status, motivo || null, JSON.stringify({ ...(detalhes || {}), fase: "distribuicao" })]
  });
}

async function validarOfertaParaDistribuicao(oferta = {}, contexto = {}) {
  const clienteId = normalizarTexto(oferta.cliente_id);
  const marketplace = normalizarMarketplace(oferta.marketplace);

  const rejeitar = (motivo, detalhes = {}) => {
    const classificacao = motivoDistribuicaoDefinitivo(motivo, {
      ...detalhes,
      clienteId,
      marketplace
    });
    return {
      ok: false,
      motivo,
      detalhes: {
        ...detalhes,
        definitivoOperacional: classificacao.definitivo === true,
        classificacaoOperacional: classificacao.tipo,
        statusOperacional: classificacao.statusOperacional
      }
    };
  };

  if (!usuarioAtivo(clienteId)) {
    logUsuarioInativoIgnorado({ clienteId, fluxo: "engine_distributor_validacao" });
    return rejeitar("usuario_inativo");
  }

  if (!clienteValidoEngine(clienteId, contexto.clientesValidos || [], {
    origemFluxo: resolverOrigemFluxo(oferta),
    avaliarWorkspaceParaEngine: contexto.avaliarWorkspaceParaEngine
  })) {
    return rejeitar("cliente_invalido");
  }

  if (!marketplaceAtivoClienteEngine(clienteId, marketplace, contexto.marketplacesAtivosPorCliente || {})) {
    return rejeitar("marketplace_bloqueado");
  }

  if (!normalizarTexto(oferta.categoria)) {
    return rejeitar("categoria_bloqueada");
  }

  if (typeof contexto.validarCreditos === "function") {
    const creditos = await contexto.validarCreditos(clienteId, oferta);
    if (creditos?.ok === false) return rejeitar(creditos.motivo || "creditos_insuficientes", { creditos });
  }

  const destinos = analisarDestinosOferta(clienteId, oferta, contexto);
  if (!destinos.compativeis.length) {
    const destinosDiagnostico = destinos.rejeitados.map(detalhesDestinoAnalise);
    const motivo = motivoDestinoRetido(destinos);
    return rejeitar(motivo, {
        destinosTotal: destinos.destinos.length,
        destinosCompativeis: 0,
        rejeitados: destinos.rejeitados.map(item => item.analise?.motivo || ""),
        destinosDiagnostico,
        categoriaOferta: destinosDiagnostico.map(item => item.categoriaOferta).find(Boolean) || normalizarTexto(oferta.categoria || ""),
        categoriasDestino: destinosDiagnostico.flatMap(item => item.categoriasPermitidas || []).filter(Boolean)
    });
  }

  const retorno = {
    ok: true,
    destinosCompativeis: destinos.compativeis.length,
    destinosTotal: destinos.destinos.length,
    destinosCompativeisDetalhes: destinos.compativeis.map(item => ({
      destino: item.destino?.nome || item.destino?.id || item.destino?.destinoId || "",
      tipoMidia: item.destino?.tipoMidia || ""
    }))
  };

  Object.defineProperty(retorno, "__destinosCompativeisRaw", {
    value: destinos.compativeis.map(item => item.destino).filter(Boolean),
    enumerable: false
  });

  return retorno;
}

async function adicionarOfertaNaFilaCliente(oferta = {}, contexto = {}) {
  const clienteId = normalizarTexto(oferta.cliente_id);
  const deps = contexto.deps || {};
  const registrarSnapshotFila = async (item = {}) => {
    if (typeof deps.atualizarResumoHistoricoClonador !== "function") return;
    const fontes = [item.metadata, oferta.metadata, oferta.job_metadata?.metadataEvento, oferta.evento_metadata];
    const clonador = fontes.map(fonte => objetoSeguro(fonte).clonadorGrupos).find(valor => objetoSeguro(valor).bufferId);
    if (!clonador?.bufferId) return;
    try {
      await deps.atualizarResumoHistoricoClonador({
        clienteId,
        bufferId: clonador.bufferId,
        resumo: {
          jobIds: oferta.job_id ? [String(oferta.job_id)] : [],
          ofertaIds: oferta.id ? [String(oferta.id)] : [],
          filaItemIds: item.id ? [String(item.id)] : [],
          marketplace: normalizarMarketplace(oferta.marketplace) || null,
          titulo: normalizarTexto(oferta.titulo || "").slice(0, 180) || null,
          imagem: normalizarTexto(oferta.imagem || "").slice(0, 500) || null,
          preco: oferta.preco ?? null,
          precoAnterior: oferta.preco_original ?? null,
          cupomPresente: Boolean(normalizarTexto(oferta.cupom || "")),
          beneficioPresente: Boolean(normalizarTexto(oferta.beneficio_extra || "")),
          statusCodigo: "na_fila",
          resultadoAgregado: "na_fila",
          ultimoAtualizadoEm: new Date().toISOString()
        }
      });
    } catch (erro) {
      console.log("[CLONADOR-HISTORICO-SNAPSHOT-OBSERVADOR]", { clienteId, bufferId: clonador.bufferId, motivo: erro?.codigo || erro?.message || "falha_snapshot" });
    }
  };

  if (!usuarioAtivo(clienteId)) {
    logUsuarioInativoIgnorado({ clienteId, fluxo: "engine_distributor_adicionar_fila" });
    return { ok: false, motivo: "usuario_inativo" };
  }

  let itemFila = montarItemFilaEngine(oferta);
  if (typeof deps.aplicarIdentidadeVisualOferta === "function") {
    try {
      const identidadeVisual = await deps.aplicarIdentidadeVisualOferta({
        clienteId,
        oferta,
        imagemAtual: itemFila.imagem,
        contexto: {
          fluxo: "engine_distributor",
          etapa: "pre_fila",
          origem: oferta.origem || oferta.fonte || oferta.metadata?.origem || "engine"
        }
      }, deps);

      if (identidadeVisual && typeof identidadeVisual === "object") {
        const imagemFinalIdentidade = normalizarTexto(identidadeVisual.imagemFinal || itemFila.imagem || "");
        itemFila = {
          ...itemFila,
          imagem: imagemFinalIdentidade,
          imagemUrl: imagemFinalIdentidade,
          metadata: {
            ...(itemFila.metadata && typeof itemFila.metadata === "object" ? itemFila.metadata : {}),
            identidadeVisual: identidadeVisual.metadata || {
              aplicada: identidadeVisual.aplicada === true,
              motivo: identidadeVisual.motivo || "",
              original: identidadeVisual.imagemOriginal || itemFila.imagem || "",
              final: imagemFinalIdentidade
            }
          }
        };
      }
    } catch (erro) {
      console.log("[IDENTIDADE-VISUAL-OFERTAS-PASSTHROUGH]", {
        clienteId,
        ofertaId: oferta.id || "",
        motivo: erro?.message || "erro_identidade_visual"
      });
    }
  }
  const fidelidadeTraceIdPrincipal = fidelidadeObs.flagAtiva()
    ? fidelidadeObs.resolverFidelidadeTraceId(oferta, oferta.metadata, itemFila, itemFila.metadata, contexto)
    : "";
  const contextoFidelidadeDistributor = fidelidadeTraceIdPrincipal
    ? { fidelidadeTraceId: fidelidadeTraceIdPrincipal }
    : {};
  if (fidelidadeTraceIdPrincipal) {
    itemFila = {
      ...itemFila,
      fidelidadeTraceId: fidelidadeTraceIdPrincipal,
      metadata: {
        ...(itemFila.metadata && typeof itemFila.metadata === "object" ? itemFila.metadata : {}),
        fidelidadeTraceId: fidelidadeTraceIdPrincipal
      }
    };
  }
  const metadataOfertaCobertura = oferta?.metadata && typeof oferta.metadata === "object" ? oferta.metadata : {};
  const metadataJobCobertura = oferta?.job_metadata && typeof oferta.job_metadata === "object" ? oferta.job_metadata : {};
  const metadataEventoCobertura = oferta?.evento_metadata && typeof oferta.evento_metadata === "object" ? oferta.evento_metadata : {};
  const coberturaTraceIdPrincipal = coberturaRadar.flagAtiva()
    ? (
      oferta.coberturaTraceId ||
      metadataOfertaCobertura.coberturaTraceId ||
      metadataJobCobertura.coberturaTraceId ||
      metadataJobCobertura.metadataEvento?.coberturaTraceId ||
      metadataEventoCobertura.coberturaTraceId ||
      ""
    )
    : "";
  if (coberturaTraceIdPrincipal) {
    itemFila = {
      ...itemFila,
      coberturaTraceId: coberturaTraceIdPrincipal,
      metadata: {
        ...(itemFila.metadata && typeof itemFila.metadata === "object" ? itemFila.metadata : {}),
        coberturaTraceId: coberturaTraceIdPrincipal
      }
    };
  }
  if (contexto.flowManagerDecisao?.aceitarAgora === true) {
    carimbarExpiracaoOperacionalFila(itemFila, contexto.flowManagerDecisao);
  }
  fidelidadeObs.registrarSnapshot("distributor_entrada", {
    ...contextoFidelidadeDistributor,
    clienteId,
    oferta,
    marketplace: oferta.marketplace || "",
    observacoes: "entrada_distributor"
  });
  fidelidadeObs.registrarImagem("distributor_entrada", {
    ...contextoFidelidadeDistributor,
    clienteId,
    oferta,
    imagem: oferta.imagem || "",
    imagemOrigem: oferta.metadata?.imagemOrigem || "",
    status: oferta.imagem ? "URL_http_presente" : "perdida_entre_etapas"
  });
  fidelidadeObs.registrarSnapshot("fila_entrada", {
    ...contextoFidelidadeDistributor,
    clienteId,
    oferta: itemFila,
    marketplace: itemFila.marketplace || "",
    observacoes: "item_montado_para_fila"
  });
  fidelidadeObs.registrarLinks("fila_entrada", {
    ...contextoFidelidadeDistributor,
    clienteId,
    oferta: itemFila
  });
  fidelidadeObs.registrarImagem("fila_entrada", {
    ...contextoFidelidadeDistributor,
    clienteId,
    oferta: itemFila,
    imagem: itemFila.imagem || "",
    imagemOrigem: itemFila.imagemOrigem || "",
    status: itemFila.imagem ? "URL_http_presente" : "perdida_entre_etapas"
  });
  if (itemFila.metadata?.radarMirror) {
    console.log("[RADAR-MIRROR-PRESERVADO]", JSON.stringify({
      clienteId,
      marketplace: itemFila.marketplace || "",
      ofertaId: oferta.id || "",
      etapa: "fila"
    }));
  }
  logImagemFilaEngine(oferta, {
    imagem: itemFila.imagem,
    origem: itemFila.imagemOrigem,
    fallbackUsado: itemFila.imagemFallbackUsado,
    ausenciaMotivo: itemFila.imagemAusenteMotivo
  });
  const imagemAuditoria = oferta.metadata?.imagemAuditoria && typeof oferta.metadata.imagemAuditoria === "object"
    ? oferta.metadata.imagemAuditoria
    : {};

  console.log("[OFERTA-IMAGEM-AUDITORIA]", JSON.stringify({
    ofertaId: oferta.id,
    marketplace: normalizarMarketplace(oferta.marketplace),
    titulo: normalizarTexto(oferta.titulo || ""),
    temImagemImporter: imagemAuditoria.temImagemImporter === true || (!Object.keys(imagemAuditoria).length && Boolean(oferta.imagem)),
    temImagemEngine: Boolean(oferta.imagem),
    temImagemFila: Boolean(itemFila.imagem),
    campoImagemUsado: imagemAuditoria.campoImagemUsado || (itemFila.imagem ? "engine_ofertas.imagem" : ""),
    origemImagem: imagemAuditoria.origemImagem || (itemFila.imagem ? "engine_ofertas.imagem" : "nenhuma"),
    motivoSemImagem: itemFila.imagem ? "" : (imagemAuditoria.motivoSemImagem || "engine_ofertas_sem_imagem")
  }));

  console.log("[ENGINE-DISTRIBUIDOR-IMAGEM-AUDITORIA]", {
    etapa: "montar_item_fila",
    marketplace: normalizarMarketplace(oferta.marketplace),
    ofertaId: oferta.id,
    jobId: oferta.job_id,
    clienteId,
    temImagem: Boolean(itemFila.imagem),
    imagemPreview: normalizarTexto(itemFila.imagem || "").slice(0, 140),
    destino: "",
    tipoMidia: ""
  });

  if (typeof deps.adicionarOfertaNaFilaGlobal === "function") {
    const resultadoMemoria = await deps.adicionarOfertaNaFilaGlobal(clienteId, itemFila);

    if (resultadoMemoria?.duplicada) {
      console.log("[ENGINE-DISTRIBUIDOR-FILA-DUPLICADA]", {
        clienteId,
        ofertaId: oferta.id,
        itemId: itemFila.id,
        motivo: "duplicidade_fila"
      });
      return { ok: false, motivo: "duplicidade_fila", itemFila };
    }

    if (!resultadoMemoria?.ok) {
      return { ok: false, motivo: resultadoMemoria?.motivo || "erro_fila", erro: resultadoMemoria?.erro || "" };
    }

    console.log("[ENGINE-DISTRIBUIDOR-FILA-MEMORIA]", {
      clienteId,
      ofertaId: oferta.id,
      itemId: resultadoMemoria.itemFila?.id || itemFila.id
    });
    coberturaRadar.registrar("fila_item_criado", {
      coberturaTraceId: coberturaTraceIdPrincipal,
      fidelidadeTraceId: fidelidadeTraceIdPrincipal,
      clienteId,
      marketplace: itemFila.marketplace || oferta.marketplace || "",
      ofertaId: oferta.id || "",
      filaItemId: resultadoMemoria.itemFila?.id || itemFila.id || "",
      decisao: "aceito",
      motivo: "item_criado",
      filaRecebeu: true,
      statusFilaDepois: resultadoMemoria.itemFila?.status || itemFila.status || "pendente"
    });

    const itemFilaFinal = resultadoMemoria.itemFila || itemFila;
    await registrarSnapshotFila(itemFilaFinal);
    return { ok: true, itemFila: itemFilaFinal };
  }

  const filaCliente = carregarFilaCliente(clienteId, deps);

  if (ofertaJaExisteNaFila(filaCliente, oferta)) {
    return { ok: false, motivo: "duplicidade_fila" };
  }

  const adicionou = filaOfertas.adicionarOfertaFila(filaCliente, itemFila);
  if (!adicionou) return { ok: false, motivo: "erro_fila" };

  const salvou = salvarFilaCliente(clienteId, filaCliente, deps);
  if (!salvou) return { ok: false, motivo: "erro_fila" };
  coberturaRadar.registrar("fila_item_criado", {
    coberturaTraceId: coberturaTraceIdPrincipal,
    fidelidadeTraceId: fidelidadeTraceIdPrincipal,
    clienteId,
    marketplace: itemFila.marketplace || oferta.marketplace || "",
    ofertaId: oferta.id || "",
    filaItemId: itemFila.id || "",
    decisao: "aceito",
    motivo: "item_criado",
    filaRecebeu: true,
    statusFilaDepois: itemFila.status || "pendente"
  });

  await registrarSnapshotFila(itemFila);
  return { ok: true, itemFila };
}

module.exports = {
  limitarDistribuicao,
  buscarOfertasDistribuiveis,
  separarResultadoOfertasDistribuiveis,
  tentarMarcarDistribuindo,
  marcarOfertaStatus,
  restaurarOfertaStatusSeDistribuindo,
  restaurarOfertaParaReentradaFlow,
  registrarEtapaDistribuicao,
  validarOfertaParaDistribuicao,
  adicionarOfertaNaFilaCliente,
  montarItemFilaEngine,
  resolverImagemFilaEngine,
  ofertaJaExisteNaFila,
  categoriasCandidatasOferta,
  filtrarDestinosClonadorGrupos,
  marketplaceEquivalentesDistribuidor,
  motivoDistribuicaoDefinitivo
};
