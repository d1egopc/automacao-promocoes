
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const csv = require("csv-parser");
const zlib = require("zlib");

const {
  initEngineDatabase,
  registrarEventoBruto,
  consultarEventosEngine,
  consultarJobsEngine,
  consultarResumoEngine,
  consultarOfertasEngine,
  processarJobsPendentesEngine,
  validarJobsDiagnosticadosEngine,
  importarJobsProntosEngine,
  limparJobsAntigosEngine,
  distribuirOfertasEngine
} = require("./modules/engine");

const {
  iniciarOrquestradorEngine
} = require("./modules/engine/orchestrator.runner");

const {
  farejarMercadoLivre: farejarMercadoLivreModulo,
  importarMercadoLivre
} = require("./marketplaces/mercadolivre");

const {
  farejarShopee,
  buscarOfertasShopee
} = require("./marketplaces/shopee");

const {
  farejarAmazon
} = require("./marketplaces/amazon");

const {
  farejarAliExpress
} = require("./marketplaces/aliexpress/farejador");

const farejarKabum =
require("./marketplaces/kabum/farejador");

const {
  importarProdutoKabumViaAwin
} = require("./marketplaces/kabum/importador");

const {
  aplicarCuponsAutomaticos
} = require("./marketplaces/cupons");
const {
  deveIgnorarOfertaRepetida,
  registrarOfertaVista
} = require("./marketplaces/inteligencia/memoria-ofertas");

const {
  classificarCategoriaOferta
} = require("./marketplaces/inteligencia/classificador-categorias");

const {
  adicionarOfertaNaFila
} = require("./marketplaces/inteligencia/fila-inteligente");

const {
  normalizarOfertaManual,
  adicionarManualNaFila
} = require("./marketplaces/manual");

const {
  detectarMarketplaceManual,
  importarProdutoManual
} = require("./marketplaces/manual");

const {
  criarImportarAmazon
} = require("./marketplaces/amazon");

const {
  extrairCuponsAmazonDoHtml,
  detectarAvisoCupomAmazon,
  escolherCupomParaOfertaAmazon
} = require("./marketplaces/amazon/cupons");

const {
  criarImportarShopee
} = require("./marketplaces/shopee");

const {
  testarIntegracaoMarketplace
} = require("./utils/testar-integracao-marketplace");

const {
  BUSCAS_GLOBAIS,
  gerarBuscasGlobais
} = require("./marketplaces/inteligencia/buscas-globais");

const {
  CATEGORIAS_DESTINOS
} = require("./marketplaces/inteligencia/categorias-destinos");

const {
  enviarCampanhaManual
} = require("./campanhas/enviarCampanha");

const {
  salvarMidiaTemporaria,
  excluirMidiaTemporaria,
  limparMidiasOrfas,
  parseMultipartFormData
} = require("./campanhas/midiaTemporaria");

const {
  listarHistoricoCampanhas,
  obterCampanhaHistorico
} = require("./campanhas/historicoCampanhas");

const {
  salvarAgendamentoCampanha,
  listarAgendamentosCampanhas,
  obterAgendamentoCampanha,
  cancelarAgendamentoCampanha,
  removerAgendamentoCampanha,
  executarAgendamentoCampanha,
  executarAgendamentosPendentesTodosClientes
} = require("./campanhas/agendamentosCampanhas");

const mensageiro = require("./modules/mensageiro");
const criarRotasMensageiro = require("./modules/mensageiro/routes");
const socialModule = require("./modules/social");
const criarRotasSocial = require("./modules/social/routes");
const criarRotasTemplatesClientes = require("./modules/templates-clientes/routes");

const {
  calcularScoreOferta
} = require("./marketplaces/inteligencia/score-oferta");

const {
  avaliarOfertaRadar
} = require("./marketplaces/inteligencia/radar-ofertas");

const {
  montarMensagemOferta
} = require("./utils/mensagens-ofertas");

const filaOfertas = require("./utils/fila-ofertas");
const destinosUtils = require("./utils/destinos");
const integracoesUtils = require("./utils/integracoes");
const radarCupomMensagem = require("./utils/radar-cupom-mensagem");
const {
  aplicarLimiteLista,
  avaliarLimiteFilaHotfix,
  finalizarRunnerHotfix,
  iniciarRunnerHotfix,
  paginaLimiteSeguro
} = require("./utils/performance-hotfix");
const {
  resultadoTentouEnvio,
  decidirStatusExecutorSemEnvio
} = require("./modules/executor/destino-diagnostico");
const {
  dominioRedirectPermitido,
  resolverRedirectUniversal
} = require("./modules/radar/redirect/redirect-resolver");
const {
  camposIdentidadeCanonicaOferta,
  compararIdentidadeCanonicaOfertas,
  origemDominioCanonicoOferta,
  resolverIdentidadeCanonicaOferta
} = require("./modules/radar/produto-canonico");
const alertasIntegracoes = require("./utils/alertas-integracoes");
const storageUtils = require("./utils/storage");

const {
  storage,
  getClientePath,
  readClienteJson,
  writeClienteJson,
  listClientes,
  readGlobalJson,
  writeGlobalJson,
  mascararSecrets
} = storageUtils;

const LOG_OPTIMUS_ICONS = {
  FILA: "\u{1F4E6}",
  RADAR: "\u{1F4E1}",
  CAPTURA: "\u{1F4E5}",
  CUPOM: "\u{1F39F}",
  DESTINO: "\u{1F50D}",
  ENVIO: "\u{1F4E4}",
  INTELIGENCIA: "\u{1F9E0}",
  INTEGRACAO: "\u{1F50C}",
  WHATSAPP: "\u{1F4F1}",
  TELEGRAM: "\u2708\uFE0F",
  MERCADOLIVRE: "\u{1F6D2}",
  SHOPEE: "\u{1F7E0}",
  AMAZON: "\u{1F535}",
  ALIEXPRESS: "\u{1F7E3}",
  KABUM: "\u{1F9F0}",
  ORQUESTRADOR: "\u{1F504}",
  RESUMO: "\u{1F4CA}",
  SUCESSO: "\u2705",
  AVISO: "\u26A0\uFE0F",
  ERRO: "\u274C"
};

function logOptimus(categoria = "INFO", mensagem = "", dados = {}) {
  const chave = String(categoria || "INFO").toUpperCase();
  const icone = LOG_OPTIMUS_ICONS[chave] || "\u2139\uFE0F";
  const prefixo = `${icone} ${chave} | ${mensagem}`;

  if (dados && typeof dados === "object" && Object.keys(dados).length) {
    console.log(prefixo, dados);
    return;
  }

  console.log(prefixo);
}

const ABASTECIMENTO_MOTIVOS = [
  "memoria_repetida",
  "duplicada",
  "desconto_baixo",
  "sem_link_afiliado",
  "sem_preco",
  "integracao_ausente",
  "bloqueio_http",
  "categoria",
  "outros"
];

let abastecimentoRodadaAtual = null;

function criarResumoAbastecimento(marketplace = "") {
  return {
    marketplace: normalizarTexto(marketplace || ""),
    encontradas: 0,
    importadas: 0,
    adicionadasFila: 0,
    recusadas: 0,
    motivosRecusa: ABASTECIMENTO_MOTIVOS.reduce((acc, motivo) => {
      acc[motivo] = 0;
      return acc;
    }, {})
  };
}

function motivoAbastecimentoPadrao(motivo = "") {
  const texto = normalizarTexto(motivo || "");

  if (/memoria|repetida/.test(texto)) return "memoria_repetida";
  if (/duplicad|ja_existe|existe/.test(texto)) return "duplicada";
  if (/desconto|preco_minimo|preco_baixo|baixo/.test(texto)) return "desconto_baixo";
  if (/sem_link|link_afiliado|afiliado/.test(texto)) return "sem_link_afiliado";
  if (/sem_preco|preco_ausente|preco_invalido/.test(texto)) return "sem_preco";
  if (/integracao|credencial/.test(texto)) return "integracao_ausente";
  if (/http|bloqueio|bloqueado|status|traffic|verification|cookie/.test(texto)) return "bloqueio_http";
  if (/categoria|destino/.test(texto)) return "categoria";

  return "outros";
}

function registrarAbastecimento(tipo = "", dados = {}) {
  if (!abastecimentoRodadaAtual) return;

  const quantidade = Math.max(1, Number(dados.quantidade || 1) || 1);

  if (tipo === "encontrada" || tipo === "encontradas") {
    abastecimentoRodadaAtual.encontradas += quantidade;
    return;
  }

  if (tipo === "importada" || tipo === "importadas") {
    abastecimentoRodadaAtual.importadas += quantidade;
    return;
  }

  if (tipo === "adicionada" || tipo === "adicionadasFila") {
    abastecimentoRodadaAtual.adicionadasFila += quantidade;
    return;
  }

  if (tipo === "recusada" || tipo === "recusa") {
    const motivo = motivoAbastecimentoPadrao(dados.motivo || "outros");
    abastecimentoRodadaAtual.recusadas += quantidade;
    abastecimentoRodadaAtual.motivosRecusa[motivo] =
      (abastecimentoRodadaAtual.motivosRecusa[motivo] || 0) + quantidade;
  }
}

function logResumoAbastecimento(resumo = {}, extras = {}) {
  if (!resumo) return;

  console.log("[ABASTECIMENTO]", {
    marketplace: resumo.marketplace,
    encontradas: resumo.encontradas,
    importadas: resumo.importadas,
    adicionadasFila: resumo.adicionadasFila,
    recusadas: resumo.recusadas,
    motivosRecusa: resumo.motivosRecusa,
    ...extras
  });
}

const MARKETPLACES_RESUMO_ORQUESTRADOR = [
  "mercadolivre",
  "amazon",
  "shopee",
  "aliexpress",
  "awin"
];

function contarItensFilaClienteOrquestrador(clienteId = "admin") {
  return Array.isArray(fila)
    ? fila.filter(item => String(item?.clienteId || "admin") === String(clienteId || "admin")).length
    : 0;
}

function clonarResumoAbastecimento(resumo = {}) {
  return {
    encontradas: Number(resumo.encontradas || 0),
    importadas: Number(resumo.importadas || 0),
    adicionadasFila: Number(resumo.adicionadasFila || 0),
    recusadas: Number(resumo.recusadas || 0),
    motivosRecusa: { ...(resumo.motivosRecusa || {}) }
  };
}

function diffResumoAbastecimento(antes = {}, depois = {}) {
  const motivos = {};
  const chaves = new Set([
    ...Object.keys(antes.motivosRecusa || {}),
    ...Object.keys(depois.motivosRecusa || {})
  ]);

  for (const chave of chaves) {
    motivos[chave] = Math.max(0, Number(depois.motivosRecusa?.[chave] || 0) - Number(antes.motivosRecusa?.[chave] || 0));
  }

  return {
    encontradas: Math.max(0, Number(depois.encontradas || 0) - Number(antes.encontradas || 0)),
    importadas: Math.max(0, Number(depois.importadas || 0) - Number(antes.importadas || 0)),
    adicionadasFila: Math.max(0, Number(depois.adicionadasFila || 0) - Number(antes.adicionadasFila || 0)),
    recusadas: Math.max(0, Number(depois.recusadas || 0) - Number(antes.recusadas || 0)),
    motivosRecusa: motivos
  };
}

function numeroResumoOrquestrador(...valores) {
  for (const valor of valores) {
    if (Array.isArray(valor)) return valor.length;
    if (valor === null || valor === undefined || valor === "") continue;
    const numero = Number(valor);
    if (Number.isFinite(numero)) return numero;
  }

  return "nao_informado";
}

function motivoMaisComumOrquestrador(motivos = {}) {
  let motivoFinal = "";
  let maior = 0;

  for (const [motivo, total] of Object.entries(motivos || {})) {
    const numero = Number(total || 0);
    if (numero > maior) {
      maior = numero;
      motivoFinal = motivo;
    }
  }

  return motivoFinal;
}

function criarMarketplacesResumoOrquestrador(marketplaceAtual = "") {
  return MARKETPLACES_RESUMO_ORQUESTRADOR.reduce((acc, marketplace) => {
    acc[marketplace] = {
      chamado: false,
      statusHttpBusca: "nao_informado",
      produtosEncontrados: "nao_informado",
      importados: "nao_informado",
      ofertasMontadas: "nao_informado",
      aprovados: "nao_informado",
      adicionados: 0,
      principalMotivoZero: marketplace === marketplaceAtual ? "nao_chamado" : "nao_rodado_nesta_rodada"
    };
    return acc;
  }, {});
}

function normalizarRetornoFarejadorOrquestrador(retorno, marketplace = "", delta = {}, adicionadasCalculadas = 0) {
  const objeto = Array.isArray(retorno)
    ? { ofertasMontadas: retorno.length, aprovados: retorno.length, produtosEncontrados: retorno.length }
    : (retorno && typeof retorno === "object" ? retorno : {});
  const temRetorno = retorno !== undefined && retorno !== null;
  const motivosRetorno = objeto.motivosRecusa || objeto.recusas || {};
  const bloqueio = Array.isArray(objeto.bloqueios) && objeto.bloqueios.length ? objeto.bloqueios[0] : "";
  const erros = Array.isArray(objeto.erros) && objeto.erros.length ? objeto.erros[0] : "";
  const produtosEncontrados = numeroResumoOrquestrador(
    objeto.produtosEncontrados,
    objeto.encontrados,
    objeto.encontradas,
    objeto.totalProdutos,
    delta.encontradas
  );
  const importados = numeroResumoOrquestrador(
    objeto.importados,
    objeto.importadas,
    objeto.importadosTotal,
    delta.importadas
  );
  const ofertasMontadas = numeroResumoOrquestrador(
    objeto.ofertasMontadas,
    objeto.ofertasEncontradas,
    objeto.ofertasFiltradas,
    objeto.produtosEncontrados,
    delta.importadas
  );
  const aprovados = numeroResumoOrquestrador(
    objeto.aprovados,
    objeto.aprovadas,
    objeto.linkAfiliadoOk,
    objeto.ofertasAprovadas
  );
  const adicionados = numeroResumoOrquestrador(
    objeto.adicionadosFila,
    objeto.adicionadasFila,
    objeto.adicionados,
    objeto.adicionadas,
    delta.adicionadasFila,
    adicionadasCalculadas
  );
  const adicionadosNumero = Number(adicionados);
  const motivoRecusa = motivoMaisComumOrquestrador(motivosRetorno) || motivoMaisComumOrquestrador(delta.motivosRecusa);
  let principalMotivoZero = "";

  if (Number.isFinite(adicionadosNumero) && adicionadosNumero > 0) {
    principalMotivoZero = "";
  } else if (objeto.principalMotivoZero || objeto.motivoPrincipal || objeto.motivo) {
    principalMotivoZero = objeto.principalMotivoZero || objeto.motivoPrincipal || objeto.motivo;
  } else if (bloqueio) {
    principalMotivoZero = bloqueio;
  } else if (erros) {
    principalMotivoZero = erros;
  } else if (motivoRecusa) {
    principalMotivoZero = motivoRecusa;
  } else if (!temRetorno) {
    principalMotivoZero = "retorno_nao_informado";
  } else if (produtosEncontrados === 0) {
    principalMotivoZero = "busca_sem_produtos";
  } else {
    principalMotivoZero = "nao_identificado";
  }

  return {
    chamado: true,
    statusHttpBusca: objeto.statusHttpBusca || objeto.statusHttp || objeto.status || "nao_informado",
    produtosEncontrados,
    importados,
    ofertasMontadas,
    aprovados,
    adicionados: Number.isFinite(adicionadosNumero) ? adicionadosNumero : adicionados,
    principalMotivoZero
  };
}

function criarItemResumoClienteOrquestrador(clienteId = "admin", marketplace = "", saudeFila = {}) {
  return {
    clienteId,
    pendentesAntes: Number(saudeFila.pendentes || 0),
    pendentesDepois: Number(saudeFila.pendentes || 0),
    deveAbastecer: saudeFila.deveAbastecer === true,
    marketplaces: criarMarketplacesResumoOrquestrador(marketplace)
  };
}
const DEBUG_LOGS = String(process.env.DEBUG_LOGS || "").toLowerCase() === "true";
const LOG_THROTTLE_MS = 60 * 1000;
const logsThrottle = new Map();
const radarListenerRecentes = [];
const radarBloqueiosRecentes = [];

function deveLogarThrottle(chave = "geral", intervaloMs = LOG_THROTTLE_MS) {
  const agora = Date.now();
  const id = String(chave || "geral");
  const ultimo = logsThrottle.get(id) || 0;

  if (agora - ultimo < intervaloMs) return false;

  logsThrottle.set(id, agora);
  return true;
}

function logDebug(...args) {
  if (DEBUG_LOGS) console.log(...args);
}

function logRadarBloqueadoMonitoramento(dados = {}) {
  const sessaoId = dados.sessaoId || dados.origemMonitorada?.sessaoId || dados.origemMonitorada?.origemSessaoId || "sem_sessao";
  const grupoId = dados.grupoId || dados.origemMonitorada?.grupoId || dados.origemMonitorada?.origemGrupoId || "sem_grupo";
  const grupoNome = dados.grupoNome || dados.origemMonitorada?.grupoNome || dados.origemMonitorada?.origemGrupoNome || "";
  const motivo = dados.motivo || dados.origemMonitorada?.motivo || "origem_nao_monitorada";
  const evento = {
    capturadoEm: new Date().toISOString(),
    clienteId: dados.clienteId || "",
    motivo,
    sessaoId,
    grupoId,
    grupoNome,
    diagnostico: dados.origemMonitorada?.diagnostico || {}
  };

  radarBloqueiosRecentes.push(evento);
  if (radarBloqueiosRecentes.length > 30) radarBloqueiosRecentes.shift();

  const chave = `radar-bloqueado:${sessaoId}:${grupoId}`;
  if (!deveLogarThrottle(chave)) return;

  console.log("🚫 Radar bloqueado por configuração", evento);
}

if (!fs.existsSync("/data")) {
  fs.mkdirSync("/data", { recursive: true });
  console.log("[OK] Pasta /data criada");
}

let config = {
  automacaoAtiva: false,

linksOptimus: {
  ativo: true,
  dominio: "",
  formato: "/r",
  rastrearCliques: true
},

linksGerados: {},
  intervaloEnvioMinutos: 5,

  horarioInicio: "08:00",
  horarioFim: "23:00",

  pausarMadrugada: true,


  telegram: {
    ativo: false,

    destinos: [
      {
        nome: "Canal Principal",
        botToken: "",
        chatId: "",
        ativo: true
      }
    ]
  },


// ================= DESTINOS INTELIGENTES =================

destinosInteligentes: [],

  marketplaces: {
    amazon: {
      ativo: true,
      intervaloFarejoMinutos: 25,
      limitePorRodada: 5,
      descontoMinimo: 10,
      precoMinimo: 20
    },

    shopee: {
      ativo: true,
      intervaloFarejoMinutos: 20,
      limitePorRodada: 10,
      descontoMinimo: 15,
      precoMinimo: 15
    },

    mercadolivre: {
  ativo: true,
  intervaloFarejoMinutos: 15,
  limitePorRodada: 7,
  descontoMinimo: 10,
  precoMinimo: 15
},

magalu: {
  ativo: true,
  intervaloFarejoMinutos: 30,
  limitePorRodada: 10,
  descontoMinimo: 15,
  precoMinimo: 20
},

awin: {
  ativo: true,
  intervaloFarejoMinutos: 30,
  limitePorRodada: 5,
  descontoMinimo: 10,
  precoMinimo: 15,
  loja: "kabum",
  feedFile: "awin_kabum.csv.gz"
},

kabum: {
  ativo: true,
  intervaloFarejoMinutos: 20,
  limitePorRodada: 3,
  descontoMinimo: 10,
  precoMinimo: 20
},

aliexpress: {
  ativo: true,
  intervaloFarejoMinutos: 28,
  limitePorRodada: 5,
  descontoMinimo: 20,
  precoMinimo: 20,
  priorizarBrasil: true,
  permitirInternacionalForte: true,
  descontoMinimoInternacional: 30
  }
 }
};

let fila = [];
let enviandoAgoraPorCliente = {};
let controleEnvio = {}; // por cliente
let controleIntervaloEnvioPorCliente = {};
let historicoOfertas = {};
let cuponsAtivos = config.cuponsAtivos || [];
let usuarios = [];

let planos = {};
let configsPorCliente = {};
let destinosPorCliente = {};

let sessoes = {};
let qrCodes = {};
let statusSessao = {};
let destinosPorSessao = {};
let gruposPorSessao = {};
let reconectando = {};
let integracoesPorCliente = {};
let sessoesMeta = {};

const FILA_FILE = "/data/fila.json";
const CONFIG_FILE = "/data/config.json";
const USUARIOS_FILE = "/data/usuarios.json";
const CONFIGS_CLIENTES_FILE = "/data/configs_clientes.json";
const DESTINOS_CLIENTES_FILE = "/data/destinos_clientes.json";
const CONTROLE_INTERVALO_DESTINOS_FILE = "controle-envio-destinos.json";
const PLANOS_FILE = "/data/planos.json";
const SESSOES_FILE = "/data/sessoes.json";
const INTEGRACOES_FILE = "/data/integracoes.json";

function getClienteDir(clienteId = "admin") {
  return getClientePath(clienteId);
}

function getFilaFile(clienteId = "admin") {
  return `${getClienteDir(clienteId)}/fila.json`;
}

const BRANDING_FILE = "/data/branding.json";

const BRANDING_MAX_BYTES = 5 * 1024 * 1024;

function brandingPadrao() {
  return {
    escopo: "oficial",
    logoUrl: "",
    logoDataUrl: "",
    iconUrl: "",
    iconDataUrl: "",
    nomeMarca: "",
    slogan: "",
    frase: "",
    theme: "dark",
    corPrimaria: "",
    corDestaque: "",
    atualizadoEm: ""
  };
}

function tamanhoDataUrlBytes(valor = "") {
  const texto = String(valor || "");
  const base64 = texto.includes(",") ? texto.split(",").pop() || "" : texto;
  return Math.ceil((base64.length * 3) / 4);
}

function validarImagemBranding(valor = "", campo = "imagem") {
  const texto = String(valor || "").trim();
  if (!texto) return { ok: true, valor: "" };

  if (/^https?:\/\//i.test(texto)) {
    return { ok: true, valor: texto };
  }

  const match = texto.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,/i);
  if (!match) {
    return {
      ok: false,
      erro: `${campo} deve ser URL http(s) ou data URL PNG/JPEG/WEBP`
    };
  }

  if (tamanhoDataUrlBytes(texto) > BRANDING_MAX_BYTES) {
    return {
      ok: false,
      erro: `${campo} excede o limite de 5 MB`
    };
  }

  return { ok: true, valor: texto };
}

function normalizarBranding(dados = {}) {
  const atual = dados && typeof dados === "object" ? dados : {};
  const padrao = brandingPadrao();

  return {
    ...padrao,
    ...atual,
    escopo: "oficial",
    logoUrl: String(atual.logoUrl || "").trim(),
    logoDataUrl: String(atual.logoDataUrl || atual.logo || "").trim(),
    iconUrl: String(atual.iconUrl || "").trim(),
    iconDataUrl: String(atual.iconDataUrl || atual.icon || "").trim(),
    nomeMarca: String(atual.nomeMarca || atual.nome || "").trim().slice(0, 80),
    slogan: String(atual.slogan || atual.frase || "").trim().slice(0, 160),
    frase: String(atual.frase || atual.slogan || "").trim().slice(0, 160),
    theme: ["dark", "light", "system"].includes(atual.theme) ? atual.theme : "dark",
    corPrimaria: String(atual.corPrimaria || "").trim(),
    corDestaque: String(atual.corDestaque || "").trim(),
    atualizadoEm: atual.atualizadoEm || ""
  };
}

function lerBrandingOficial() {
  try {
    const dados = readGlobalJson("branding.json", null);

    if (!dados) {
      const brandingAdminAntigo = path.join(getClienteDir("admin"), "branding.json");
      if (fs.existsSync(brandingAdminAntigo)) {
        const dadosAntigos = JSON.parse(fs.readFileSync(brandingAdminAntigo, "utf8") || "{}");
        const migrado = normalizarBranding(dadosAntigos);
        writeGlobalJson("branding.json", migrado);
        console.log("[BRANDING] Logo oficial migrada de /data/clientes/admin/branding.json");
        return migrado;
      }

      return brandingPadrao();
    }

    return normalizarBranding(dados);
  } catch (e) {
    console.log("[BRANDING] Falha ao ler branding:", e.message);
    return brandingPadrao();
  }
}

function salvarBrandingOficial(dados = {}) {
  const atual = lerBrandingOficial();
  const payload = dados && typeof dados === "object" ? dados : {};

  const logo = validarImagemBranding(payload.logoDataUrl ?? payload.logo ?? atual.logoDataUrl, "logoDataUrl");
  if (!logo.ok) return { ok: false, erro: logo.erro };

  const icon = validarImagemBranding(payload.iconDataUrl ?? payload.icon ?? atual.iconDataUrl, "iconDataUrl");
  if (!icon.ok) return { ok: false, erro: icon.erro };

  const logoUrl = validarImagemBranding(payload.logoUrl ?? atual.logoUrl, "logoUrl");
  if (!logoUrl.ok) return { ok: false, erro: logoUrl.erro };

  const iconUrl = validarImagemBranding(payload.iconUrl ?? atual.iconUrl, "iconUrl");
  if (!iconUrl.ok) return { ok: false, erro: iconUrl.erro };

  const atualizado = normalizarBranding({
    ...atual,
    ...payload,
    logoDataUrl: logo.valor,
    iconDataUrl: icon.valor,
    logoUrl: logoUrl.valor,
    iconUrl: iconUrl.valor,
    atualizadoEm: new Date().toISOString()
  });

  writeGlobalJson("branding.json", atualizado);
  return { ok: true, branding: atualizado };
}

function restaurarBrandingOficial() {
  const padrao = {
    ...brandingPadrao(),
    atualizadoEm: new Date().toISOString()
  };

  writeGlobalJson("branding.json", padrao);
  return padrao;
}

console.log("[OK]📂Salvando dados em:", FILA_FILE);

function gerarChaveProduto(titulo = "") {
  return String(titulo)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(preto|branco|azul|rosa|verde|vermelho|127v|220v|110v|bivolt)\b/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function normalizarTextoBasico(texto = "") {
  return gerarChaveProduto(texto);
}

function produtoRepetidoRecentemente(titulo, horas = 12) {
  const chave = gerarChaveProduto(titulo);
  const agora = Date.now();
  const limite = horas * 60 * 60 * 1000;

  if (historicoOfertas[chave] && agora - historicoOfertas[chave] < limite) {
    return true;
  }

  historicoOfertas[chave] = agora;
  return false;
}

function detectarMarcaOferta(texto = "", oferta = {}) {
  if (oferta.marca) {
    return normalizarTextoBasico(oferta.marca);
  }

  const marcas = [
    "jbl", "kingston", "samsung", "xiaomi", "lg", "philips", "sony",
    "lenovo", "dell", "acer", "asus", "apple", "motorola", "nike",
    "adidas", "olympikus", "puma", "fila", "topper", "tramontina",
    "vonder", "bosch", "makita", "dewalt", "mondial", "britania",
    "philco", "electrolux", "consul", "brastemp", "redragon", "hyperx",
    "logitech", "corsair", "intel", "amd", "nvidia", "kabum"
  ];

  return marcas.find(marca => texto.includes(` ${marca} `)) || "";
}

function detectarProdutoBaseOferta(texto = "") {
  const padroes = [
    ["memoria ram", ["memoria ram", "ddr4", "ddr5"]],
    ["placa de video", ["placa de video", "placa grafica", "rtx", "gtx", "radeon"]],
    ["fone", ["fone", "headphone", "headset", "earbuds"]],
    ["smartphone", ["smartphone", "celular", "iphone", "galaxy", "redmi", "moto g"]],
    ["notebook", ["notebook", "laptop", "chromebook"]],
    ["ssd", ["ssd", "nvme", "m 2"]],
    ["moletom", ["moletom", "blusa de frio", "casaco"]],
    ["tenis", ["tenis", "sapatenis", "chinelo", "sandalia"]],
    ["bola", ["bola futebol", "bola futsal", "bola society", "bola volei", "bola"]],
    ["furadeira", ["furadeira", "parafusadeira", "martelete"]],
    ["air fryer", ["air fryer", "fritadeira sem oleo"]],
    ["perfume", ["perfume", "parfum", "colonia", "malbec"]]
  ];

  for (const [base, termos] of padroes) {
    if (termos.some(termo => texto.includes(termo))) {
      return base;
    }
  }

  const stopwords = new Set([
    "kit", "combo", "oferta", "promocao", "original", "novo", "nova",
    "com", "sem", "para", "por", "de", "do", "da", "das", "dos",
    "masculino", "feminino", "infantil", "preto", "branco", "azul",
    "rosa", "verde", "vermelho", "unissex", "premium"
  ]);

  return texto
    .split(" ")
    .filter(token =>
      token.length > 2 &&
      !stopwords.has(token) &&
      !/^\d+$/.test(token)
    )
    .slice(0, 3)
    .join(" ");
}

function sinaisDiversidadeOferta(oferta = {}) {
  const texto = ` ${normalizarTextoBasico([
    oferta.titulo,
    oferta.nome,
    oferta.categoria,
    oferta.categoriaProduto,
    oferta.marketplace,
    oferta.marca
  ].filter(Boolean).join(" "))} `;

  const categoria = normalizarTextoBasico(
    oferta.categoria || oferta.categoriaProduto || "geral"
  );

  const marca = detectarMarcaOferta(texto, oferta);
  const produtoBase = detectarProdutoBaseOferta(texto);
  const tema = produtoBase || categoria || "geral";

  return {
    categoria,
    marca,
    produtoBase,
    tema
  };
}

function calcularDiversidadeOferta(oferta = {}, recentes = []) {
  const sinais = sinaisDiversidadeOferta(oferta);
  let score = 100;
  const motivos = [];

  recentes.forEach((recente, index) => {
    const peso = Math.max(1, 4 - index);
    const sinaisRecentes = recente.__sinaisDiversidade || sinaisDiversidadeOferta(recente);

    if (sinais.produtoBase && sinais.produtoBase === sinaisRecentes.produtoBase) {
      score -= 18 * peso;
      motivos.push("produto_base_repetido");
    }

    if (sinais.marca && sinais.marca === sinaisRecentes.marca) {
      score -= 10 * peso;
      motivos.push("marca_repetida");
    }

    if (sinais.tema && sinais.tema === sinaisRecentes.tema) {
      score -= 8 * peso;
      motivos.push("tema_repetido");
    }

    if (sinais.categoria && sinais.categoria === sinaisRecentes.categoria) {
      score -= 5 * peso;
      motivos.push("categoria_repetida");
    }
  });

  return {
    score: Math.max(0, score),
    sinais,
    motivos: [...new Set(motivos)]
  };
}

function ordenarPendentesPorDiversidade(itens = []) {
  const pendentes = itens
    .map((oferta, index) => ({ oferta, index }))
    .filter(item => item.oferta?.status === "pendente");

  if (pendentes.length < 3) {
    return itens;
  }

  const restantes = [...pendentes];
  const ordenados = [];

  while (restantes.length) {
    const recentes = ordenados.slice(-4).reverse().map(item => item.oferta);

    const melhor = restantes
      .map((item, posicao) => {
        const diversidade = calcularDiversidadeOferta(item.oferta, recentes);
        return {
          item,
          posicao,
          diversidade,
          scoreFinal: diversidade.score - item.index * 0.001
        };
      })
      .sort((a, b) => b.scoreFinal - a.scoreFinal)[0];

    melhor.item.oferta.diversidadeScore = melhor.diversidade.score;
    melhor.item.oferta.diversidadeSinais = melhor.diversidade.sinais;
    melhor.item.oferta.diversidadeMotivos = melhor.diversidade.motivos;
    melhor.item.oferta.__sinaisDiversidade = melhor.diversidade.sinais;

    ordenados.push(melhor.item);
    restantes.splice(melhor.posicao, 1);
  }

  const filaOrdenada = [...itens];
  let indicePendente = 0;

  for (let i = 0; i < filaOrdenada.length; i++) {
    if (filaOrdenada[i]?.status === "pendente") {
      filaOrdenada[i] = ordenados[indicePendente].oferta;
      delete filaOrdenada[i].__sinaisDiversidade;
      indicePendente++;
    }
  }

  return filaOrdenada;
}

function dataFilaMs(oferta = {}) {
  const data = oferta.criadoEm || oferta.dataEntradaFila || 0;
  const ms = new Date(data).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function prioridadeEnvioOferta(oferta = {}) {
  const prioridade = Number(oferta.prioridadeEnvio ?? 40);
  return Number.isFinite(prioridade) ? prioridade : 40;
}

function cupomFastLaneTipo(oferta = {}, agora = Date.now()) {
  if (!oferta || typeof oferta !== "object") return "";
  if (oferta.status === "retida") return "";
  if (oferta.cupomSuspeito === true || oferta.cupomMonetarioIncompativel === true) return "";
  if (ofertaExpiradaParaEnvio(oferta, agora)) return "";

  const tipo = String(oferta.cupomTipo || oferta.tipoCupom || "").toLowerCase();
  const temCupom =
    Boolean(oferta.cupom) ||
    oferta.cupomDetectado === true ||
    oferta.cupomDetectadoTexto === true;

  if (
    tipo === "real" ||
    tipo === "detectado" ||
    oferta.cupomConfirmado === true ||
    oferta.cupomValidado === true ||
    (temCupom && prioridadeEnvioOferta(oferta) >= 95)
  ) {
    return "real_detectado";
  }

  if (
    tipo === "provavel" ||
    oferta.possivelCupom === true ||
    Boolean(oferta.avisoCupom || oferta.beneficioExtra || oferta.linkResgateCupom)
  ) {
    return "provavel";
  }

  return "";
}

function rankFastLaneCupom(oferta = {}) {
  const tipo = cupomFastLaneTipo(oferta);
  if (tipo === "real_detectado") return 2;
  if (tipo === "provavel") return 1;
  return 0;
}

function cupomQuenteParaTurboOferta(oferta = {}) {
  if (cupomFastLaneTipo(oferta) !== "real_detectado") return false;

  const score = Number(oferta.radarScore || oferta.score || 0);
  const desconto = percentualDescontoRadar(oferta, {
    descontoPercentual: oferta.descontoPercentual || oferta.percentualDesconto || oferta.desconto
  });
  const temBeneficioExtra = Boolean(
    oferta.beneficioExtra ||
    oferta.linkResgateCupom ||
    oferta.descontoPix ||
    oferta.descontoApp
  );
  const cupomConfirmado = oferta.cupomConfirmado === true || oferta.cupomValidado === true || oferta.cupomTipo === "real";

  return score >= 90 || desconto >= 40 || (cupomConfirmado && temBeneficioExtra);
}

function ordenarPendentesPorPrioridade(pendentes = []) {
  return [...pendentes].sort((a, b) => {
    const fastLaneA = rankFastLaneCupom(a);
    const fastLaneB = rankFastLaneCupom(b);

    if (fastLaneB !== fastLaneA) {
      return fastLaneB - fastLaneA;
    }

    const prioridadeA = prioridadeEnvioOferta(a);
    const prioridadeB = prioridadeEnvioOferta(b);

    if (prioridadeB !== prioridadeA) {
      return prioridadeB - prioridadeA;
    }

    const scoreA = Number(a.radarScore || a.score || 0);
    const scoreB = Number(b.radarScore || b.score || 0);

    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }

    return dataFilaMs(a) - dataFilaMs(b);
  });
}

function ofertaExpiradaParaEnvio(oferta = {}, agora = Date.now()) {
  if (!oferta.expiraEm) return false;
  const expiraEmMs = new Date(oferta.expiraEm).getTime();
  return Number.isFinite(expiraEmMs) && expiraEmMs < agora;
}

function marcarOfertaExpirada(oferta = {}) {
  oferta.status = "expirado";
  oferta.statusDetalhe = "Oferta/cupom expirado antes do envio";
  oferta.expiradaEm = new Date().toISOString();

  console.log("⏰ OFERTA EXPIRADA:", {
    titulo: oferta.titulo || oferta.nome || "",
    expiraEm: oferta.expiraEm || ""
  });
}

function sanearExpiradosFila(clienteId = "admin") {
  const cliente = String(clienteId || "admin");
  let alterou = false;

  for (const oferta of fila) {
    if (String(oferta?.clienteId || "admin") !== cliente) continue;
    if (oferta.status !== "pendente") continue;
    if (!ofertaExpiradaParaEnvio(oferta)) continue;

    marcarOfertaExpirada(oferta);
    alterou = true;
  }

  if (alterou) {
    salvarFila(cliente);
  }

  return alterou;
}

const filaInteligenteUltimoAbastecimento = new Map();
const FILA_INTELIGENTE_COOLDOWN_MS = 5 * 60 * 1000;

function avaliarSaudeFilaCliente(clienteId = "admin") {
  const cliente = String(clienteId || "admin");
  const filaCliente = readClienteJson(cliente, "fila.json", []);
  const itens = Array.isArray(filaCliente) ? filaCliente : [];
  const pendentes = itens.filter(item => item?.status === "pendente").length;

let status = "normal";
let deveAbastecer = true;
let motivo = "Fila em volume operacional normal.";

if (pendentes <= 20) {
  status = "critica";
  deveAbastecer = true;
  motivo = "Fila com 20 ou menos ofertas pendentes.";
} else if (pendentes <= 80) {
  status = "baixa";
  deveAbastecer = true;
  motivo = "Fila com 80 ou menos ofertas pendentes.";
} else if (pendentes <= 150) {
  status = "normal";
  deveAbastecer = true;
  motivo = "Fila em volume operacional.";
} else {
  status = "cheia";
  deveAbastecer = false;
  motivo = "Fila com mais de 180 ofertas pendentes.";
}

  console.log(
    `🧠 FILA IA: cliente ${cliente} pendentes ${pendentes} status ${status} deveAbastecer ${deveAbastecer}`
  );

  return {
    clienteId: cliente,
    pendentes,
    status,
    deveAbastecer,
    motivo
  };
}

function ofertaTemBeneficioFarejador(oferta = {}) {
  if (!oferta || typeof oferta !== "object") return false;
  if (oferta.cupomSuspeito === true || oferta.cupomMonetarioIncompativel === true) return false;

  const campos = [
    oferta.cupom,
    oferta.avisoCupom,
    oferta.tipoCupom,
    oferta.valorCupom,
    oferta.percentualCupom,
    oferta.cupomUrl,
    oferta.linkResgateCupom,
    oferta.descontoPix,
    oferta.descontoApp,
    oferta.beneficioExtra,
    oferta.beneficioDetectado,
    oferta.avisoPagamento
  ].filter(Boolean);

  const texto = normalizarTexto(campos.join(" "));
  if (!texto) return false;

  const avisoGenerico =
    texto.includes("confira cupons disponiveis na pagina") ||
    texto.includes("verifique na pagina") ||
    texto.includes("confira antes de finalizar");

  return Boolean(
    oferta.cupom ||
    oferta.valorCupom ||
    oferta.percentualCupom ||
    oferta.cupomUrl ||
    oferta.linkResgateCupom ||
    oferta.descontoPix ||
    oferta.descontoApp ||
    oferta.beneficioExtra ||
    oferta.beneficioDetectado ||
    /(?:r\$\s*)?\d+(?:[,.]\d{1,2})?\s*(?:off|%|por cento|reais)/i.test(campos.join(" ")) ||
    (!avisoGenerico && /\b(cupom|coupon|promocode|voucher|pix|app|aplicativo|cashback|frete gratis|desconto)\b/.test(texto))
  );
}

function obterEstrategiaFarejador(clienteId = "admin", marketplace = "", opcoes = {}) {
  const mp = normalizarTexto(marketplace || "");
  const cfg = config.marketplaces?.[mp] || {};
  const saude = avaliarSaudeFilaCliente(clienteId);
  const descontoBase = Number(opcoes.descontoMinimo ?? cfg.descontoMinimo ?? 15);
  const precoBase = Number(opcoes.precoMinimo ?? cfg.precoMinimo ?? 0);

  let descontoMinimo = Number.isFinite(descontoBase) ? descontoBase : 15;

  if (saude.status === "critica") {
    descontoMinimo = Math.min(descontoMinimo, 7);
  } else if (saude.status === "baixa") {
    descontoMinimo = Math.min(descontoMinimo, 10);
  }

  const estrategia = {
    clienteId,
    marketplace: mp,
    saude,
    statusFila: saude.status,
    filaCritica: saude.status === "critica",
    filaBaixa: saude.status === "baixa" || saude.status === "critica",
    filaCheia: saude.status === "cheia",
    descontoMinimo,
    descontoMinimoBase: descontoBase,
    precoMinimo: Number.isFinite(precoBase) ? precoBase : 0,
    aceitarCupomSemDesconto: true,
    aceitarBeneficioSemDesconto: true
  };

  logOptimus("INTELIGENCIA", "Estrategia farejador", {
    clienteId,
    marketplace: mp,
    pendentes: saude.pendentes,
    statusFila: saude.status,
    descontoMinimoBase: estrategia.descontoMinimoBase,
    descontoMinimo: estrategia.descontoMinimo
  });

  return estrategia;
}

function farejadoresAutoDesativados() {
  const valor = String(process.env.DESATIVAR_FAREJADORES_AUTO || "").trim().toLowerCase();
  return !["false", "0", "off", "nao", "no"].includes(valor);
}

function logFarejadorAutoDesativado(marketplace = "", origem = "automatico", clienteId = "admin", detalhes = {}) {
  const marketplaceLog = String(marketplace || "").trim();

  console.log("[FAREJADORES-AUTO-DESATIVADOS]", {
    marketplace: marketplaceLog || normalizarTexto(marketplace || "") || "todos",
    origem,
    clienteId: String(clienteId || "admin"),
    titulo: detalhes.titulo || detalhes.nome || "",
    motivo: "modo_radar_diagnostico"
  });
}

function ofertaAwinKabum(oferta = {}) {
  const marketplace = normalizarTexto(oferta.marketplace || oferta.mercado || "");
  const loja = normalizarTexto(oferta.loja || oferta.seller || "");
  return marketplace === "awin" ||
    marketplace === "kabum" ||
    loja === "kabum";
}

function origemAutomaticaAwinKabum(oferta = {}, origem = "") {
  const origemTexto = normalizarTexto(origem || oferta.origem || oferta.fonte || oferta.origemLabel || "");
  if (origemTexto.includes("manual")) return false;
  if (origemTexto.includes("radar")) return false;
  return true;
}

function logAwinEntradaFilaDebug({
  clienteId = "admin",
  oferta = {},
  origem = "",
  permitido = false,
  motivo = ""
} = {}) {
  if (!ofertaAwinKabum(oferta)) return;

  console.log("[AWIN-ENTRADA-FILA-DEBUG]", {
    clienteId: String(clienteId || oferta.clienteId || "admin"),
    titulo: oferta.titulo || oferta.nome || "",
    marketplace: oferta.marketplace || oferta.mercado || "",
    origem: origem || oferta.origem || oferta.fonte || "",
    origemAutomatica: origemAutomaticaAwinKabum(oferta, origem),
    permitido,
    motivo
  });
}

function bloquearAwinKabumAutoNaFila(oferta = {}, origem = "automatico", clienteId = "admin") {
  if (!ofertaAwinKabum(oferta)) return false;

  const automatica = origemAutomaticaAwinKabum(oferta, origem);
  const bloqueada = automatica && farejadoresAutoDesativados();
  const motivo = bloqueada
    ? "modo_radar_diagnostico"
    : automatica
      ? "automatico_permitido"
      : "origem_manual_ou_radar";

  logAwinEntradaFilaDebug({
    clienteId,
    oferta,
    origem,
    permitido: !bloqueada,
    motivo
  });

  if (bloqueada) {
    logFarejadorAutoDesativado("awin/kabum", origem, clienteId, {
      titulo: oferta.titulo || oferta.nome || ""
    });
    return true;
  }

  return false;
}

async function abastecerFilaComMercadoLivre(clienteId = "admin", limite = 3) {
  const cliente = String(clienteId || "admin");
  const maximo = Math.max(0, Math.min(Number(limite) || 3, 3));
  const resultado = {
    marketplace: "mercadolivre",
    limite: maximo,
    tentadas: 0,
    adicionadas: 0,
    recusadas: 0,
    ignoradas: 0,
    motivosRecusa: {},
    bloqueios: [],
    statusEntradaFila: "nao_tentada",
    erros: []
  };

  const registrarRecusaAbastecimento = (motivo, quantidade = 1) => {
    const total = Math.max(0, Number(quantidade) || 0);
    if (!total) return;
    resultado.recusadas += total;
    resultado.ignoradas += total;
    resultado.motivosRecusa[motivo] = (resultado.motivosRecusa[motivo] || 0) + total;
  };

  try {
    if (maximo <= 0) return resultado;

    if (farejadoresAutoDesativados()) {
      logFarejadorAutoDesativado("mercadolivre", "fila_inteligente", cliente);
      resultado.erros.push("farejadores_auto_desativados");
      resultado.statusEntradaFila = "bloqueada_antes_fila";
      return resultado;
    }

    if (!config.marketplaces?.mercadolivre?.ativo) {
      resultado.erros.push("mercadolivre_desativado");
      resultado.statusEntradaFila = "bloqueada_antes_fila";
      return resultado;
    }

    if (!usuarioTemIntegracaoMarketplace(cliente, "mercadolivre")) {
      resultado.erros.push("integracao_mercadolivre_ausente");
      resultado.statusEntradaFila = "bloqueada_antes_fila";
      return resultado;
    }

    const filaControlada = [];

    filaControlada.push = (oferta) => {
      if (resultado.adicionadas >= maximo) {
        registrarRecusaAbastecimento("limite_rodada_atingido");
        return fila.length;
      }

      filaOfertas.adicionarOfertaFila(fila, oferta, {
        clienteId: oferta?.clienteId || cliente,
        origem: oferta?.origem || "fila_inteligente",
        logger: console
      });
      resultado.adicionadas += 1;
      return fila.length;
    };

    const configControlada = {
      ...config,
      marketplaces: {
        ...(config.marketplaces || {}),
        mercadolivre: {
          ...(config.marketplaces?.mercadolivre || {}),
          limiteBuscasPorRodada: 1
        }
      }
    };

    const resumoML = await farejarMercadoLivreModulo(cliente, {
      config: configControlada,
      integracoesPorCliente,
      getIntegracaoCliente,
      fila: filaControlada,
      salvarFila: () => salvarFila(cliente),
      prepararOfertaGlobal,
      ofertaJaExiste,
      deveIgnorarOfertaRepetida,
      registrarOfertaVista,
      classificarCategoriaOferta,
      gerarBuscasGlobais,
      gerarHeadersStealth,
      obterEstrategiaFarejador,
      ofertaTemBeneficioFarejador,
      farejarCuponsMercadoLivre,
      registrarAbastecimento,
      importarMercadoLivre: (url, clienteIdAlvo = cliente) =>
        importarMercadoLivre(url, clienteIdAlvo, {
          getIntegracaoCliente,
          gerarLinkAfiliadoMercadoLivre
        })
    });

    if (resumoML && typeof resumoML === "object") {
      resultado.tentadas = Number(resumoML.tentadas || 0);
      resultado.bloqueios = Array.isArray(resumoML.bloqueios) ? resumoML.bloqueios : [];

      for (const [motivo, quantidade] of Object.entries(resumoML.motivosRecusa || {})) {
        registrarRecusaAbastecimento(motivo, quantidade);
      }
    }

    resultado.statusEntradaFila = resultado.adicionadas > 0
      ? "fila"
      : resultado.bloqueios.length > 0
        ? "bloqueada_antes_fila"
        : resultado.recusadas > 0
          ? "recusada_antes_fila"
          : "sem_ofertas_tentadas";

    if (resultado.adicionadas > 0) {
      salvarFila(cliente);
    }
  } catch (e) {
    resultado.erros.push(e.message || "erro_abastecimento_mercadolivre");
  }

  return resultado;
}

async function abastecerFilaSeNecessario(clienteId = "admin", opcoes = {}) {
  const cliente = String(clienteId || "admin");
  const simulado = opcoes.simulado === true;

  if (farejadoresAutoDesativados()) {
    logFarejadorAutoDesativado("mercadolivre", "fila_inteligente", cliente);
    return {
      ok: true,
      clienteId: cliente,
      abasteceu: false,
      modo: simulado ? "simulado" : "real",
      motivo: "farejadores_auto_desativados",
      abastecimento: {
        marketplace: "mercadolivre",
        tentadas: 0,
        adicionadas: 0,
        recusadas: 0,
        motivosRecusa: {},
        bloqueios: [],
        erros: ["farejadores_auto_desativados"]
      }
    };
  }

  const saude = avaliarSaudeFilaCliente(cliente);

  if (!saude.deveAbastecer) {
    return {
      ok: true,
      clienteId: cliente,
      abasteceu: false,
      modo: simulado ? "simulado" : "real",
      motivo: saude.motivo,
      saude,
      abastecimento: {
        marketplace: "mercadolivre",
        tentadas: 0,
        adicionadas: 0,
        recusadas: 0,
        motivosRecusa: {},
        bloqueios: [],
        erros: ["fila_nao_precisa_abastecer"]
      }
    };
  }

  const agora = Date.now();
  const ultimo = filaInteligenteUltimoAbastecimento.get(cliente) || 0;
  const restanteMs = FILA_INTELIGENTE_COOLDOWN_MS - (agora - ultimo);

  if (!opcoes.ignorarCooldown && restanteMs > 0) {
    return {
      ok: true,
      clienteId: cliente,
      abasteceu: false,
      modo: simulado ? "simulado" : "real",
      motivo: "Abastecimento ja executado ha menos de 5 minutos.",
      cooldownRestanteSegundos: Math.ceil(restanteMs / 1000),
      saude,
      abastecimento: {
        marketplace: "mercadolivre",
        tentadas: 0,
        adicionadas: 0,
        recusadas: 0,
        motivosRecusa: {},
        bloqueios: [],
        erros: ["cooldown_ativo"]
      }
    };
  }

  if (!simulado) {
    const abastecimento = await abastecerFilaComMercadoLivre(cliente, 3);
    const tentativaValida =
      abastecimento.tentadas > 0 ||
      abastecimento.adicionadas > 0 ||
      abastecimento.recusadas > 0 ||
      abastecimento.bloqueios?.length > 0;

    if (tentativaValida) {
      filaInteligenteUltimoAbastecimento.set(cliente, Date.now());
    }

    console.log(
      `🧠 FILA IA ABASTECER: cliente ${cliente} status ${saude.status} modo real`
    );

    return {
      ok: true,
      clienteId: cliente,
      abasteceu: abastecimento.adicionadas > 0,
      modo: "real",
      motivo: abastecimento.adicionadas > 0
        ? saude.motivo
        : abastecimento.erros?.[0] || "Nenhuma oferta adicionada na tentativa real.",
      saude,
      abastecimento
    };
  }

  console.log(
    `🧠 FILA IA ABASTECER: cliente ${cliente} status ${saude.status} modo simulado`
  );

  return {
    ok: true,
    clienteId: cliente,
    abasteceu: true,
    modo: "simulado",
    motivo: saude.motivo,
    saude,
    abastecimento: {
      marketplace: "mercadolivre",
      tentadas: 0,
      adicionadas: 0,
      recusadas: 0,
      motivosRecusa: {},
      bloqueios: [],
      erros: []
    }
  };
}

const diagnosticosFilaPorCliente = new Map();

function filaForaHorarioConfigurado() {
  if (!config.pausarMadrugada) return false;

  const agoraBR = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );

  const horaAtual = agoraBR.getHours() * 60 + agoraBR.getMinutes();
  const [inicioH, inicioM] = (config.horarioInicio || "08:00").split(":").map(Number);
  const [fimH, fimM] = (config.horarioFim || "23:00").split(":").map(Number);

  const inicio = inicioH * 60 + inicioM;
  const fim = fimH * 60 + fimM;

  if (inicio <= fim) {
    return horaAtual < inicio || horaAtual > fim;
  }

  return horaAtual < inicio && horaAtual > fim;
}

function motivoPrincipalDiagnosticoFila(diagnostico = {}) {
  if (!diagnostico.pendentesTotal) return "sem_pendentes";
  if (diagnostico.elegiveisAgora > 0) return "elegivel";

  const motivos = [
    ["automacao_desligada", diagnostico.bloqueadasPorAutomacaoDesligada],
    ["aguardando_proxima_tentativa", diagnostico.bloqueadasPorProximaTentativa],
    ["fora_horario", diagnostico.bloqueadasPorHorario],
    ["sem_destino_compativel", diagnostico.bloqueadasPorDestino],
    ["outros_motivos", diagnostico.bloqueadasPorOutrosMotivos]
  ];

  const principal = motivos
    .filter(([, total]) => Number(total) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))[0];

  return principal?.[0] || "outros_motivos";
}

function diagnosticarFilaCliente(clienteIdAlvo = null) {
  const cliente = String(clienteIdAlvo || "admin");
  const agora = Date.now();
  const foraHorario = filaForaHorarioConfigurado();
  const itensCliente = fila.filter(o =>
    String(o?.clienteId || "admin") === cliente
  );
  const pendentesCliente = itensCliente.filter(o => o?.status === "pendente");

  const diagnostico = {
    clienteIdAlvo: cliente,
    totalGlobal: fila.length,
    totalCliente: itensCliente.length,
    pendentesGlobal: fila.filter(o => o?.status === "pendente").length,
    pendentesTotal: pendentesCliente.length,
    elegiveisAgora: 0,
    bloqueadasPorAutomacaoDesligada: 0,
    bloqueadasPorProximaTentativa: 0,
    bloqueadasPorHorario: 0,
    bloqueadasPorDestino: 0,
    bloqueadasPorOutrosMotivos: 0,
    motivoPrincipal: "sem_pendentes"
  };

  for (const oferta of pendentesCliente) {
    const motivos = [];
    const clienteIdOferta = oferta.clienteId || "admin";
    const configClienteOferta = configsPorCliente?.[clienteIdOferta] || config;

    if (configClienteOferta.automacaoAtiva !== true) {
      diagnostico.bloqueadasPorAutomacaoDesligada += 1;
      motivos.push("automacao_desligada");
    }

    if (oferta.proximaTentativaEnvioEm) {
      const proxima = Date.parse(oferta.proximaTentativaEnvioEm);
      if (Number.isFinite(proxima) && proxima > agora) {
        diagnostico.bloqueadasPorProximaTentativa += 1;
        motivos.push("aguardando_proxima_tentativa");
      }
    }

    if (foraHorario) {
      diagnostico.bloqueadasPorHorario += 1;
      motivos.push("fora_horario");
    }

    try {
      const analiseDestinos = analisarDestinosCompativeisFila(clienteIdOferta, oferta, configClienteOferta);
      if (!analiseDestinos.compativeis.length) {
        diagnostico.bloqueadasPorDestino += 1;
        motivos.push("sem_destino_compativel");
      }
    } catch (e) {
      diagnostico.bloqueadasPorOutrosMotivos += 1;
      motivos.push("outros_motivos");
    }

    if (!motivos.length) {
      diagnostico.elegiveisAgora += 1;
    }
  }

  const bloqueadasConhecidas = new Set();

  pendentesCliente.forEach((oferta, indice) => {
    const clienteIdOferta = oferta.clienteId || "admin";
    const configClienteOferta = configsPorCliente?.[clienteIdOferta] || config;
    const proxima = oferta.proximaTentativaEnvioEm
      ? Date.parse(oferta.proximaTentativaEnvioEm)
      : NaN;

    if (configClienteOferta.automacaoAtiva !== true) bloqueadasConhecidas.add(indice);
    if (Number.isFinite(proxima) && proxima > agora) bloqueadasConhecidas.add(indice);
    if (foraHorario) bloqueadasConhecidas.add(indice);

    try {
      const analiseDestinos = analisarDestinosCompativeisFila(clienteIdOferta, oferta, configClienteOferta);
      if (!analiseDestinos.compativeis.length) bloqueadasConhecidas.add(indice);
    } catch {
      bloqueadasConhecidas.add(indice);
    }
  });

  diagnostico.bloqueadasPorOutrosMotivos += Math.max(
    0,
    diagnostico.pendentesTotal - diagnostico.elegiveisAgora - bloqueadasConhecidas.size
  );
  diagnostico.motivoPrincipal = motivoPrincipalDiagnosticoFila(diagnostico);

  return diagnostico;
}

function selecionarProximaOfertaFila(clienteIdAlvo = null) {
  const clienteLog = String(clienteIdAlvo || "admin");
  const diagnostico = diagnosticarFilaCliente(clienteLog);

  diagnosticosFilaPorCliente.set(clienteLog, diagnostico);

  if (deveLogarThrottle(`fila-diagnostico:${clienteLog}`)) {
    console.log("🧠 Diagnóstico da fila", diagnostico);
  }

  const pendentes = fila.filter(o => {
    const mesmoCliente =
      !clienteIdAlvo ||
      String(o.clienteId || "admin") === String(clienteIdAlvo);

    if (!mesmoCliente) return false;
    if (o.status !== "pendente") return false;

    if (o.proximaTentativaEnvioEm) {
      const proxima = Date.parse(o.proximaTentativaEnvioEm);
      if (Number.isFinite(proxima) && proxima > Date.now()) return false;
    }

    const clienteIdOferta = o.clienteId || "admin";
    const configClienteOferta =
      configsPorCliente?.[clienteIdOferta] || config;

    return configClienteOferta.automacaoAtiva === true;
  });

  let expirouAlguma = false;

  for (const oferta of ordenarPendentesPorPrioridade(pendentes)) {
    if (ofertaExpiradaParaEnvio(oferta)) {
      marcarOfertaExpirada(oferta);
      expirouAlguma = true;
      continue;
    }

    if (expirouAlguma) {
      salvarFila(oferta.clienteId || clienteIdAlvo || "admin");
    }

    return oferta;
  }

  if (expirouAlguma) {
    salvarFila(clienteIdAlvo || "admin");
  }

  const diagnosticoSemElegivel = diagnosticarFilaCliente(clienteLog);
  diagnosticosFilaPorCliente.set(clienteLog, diagnosticoSemElegivel);

  if (deveLogarThrottle(`fila-sem-elegivel:${clienteLog}`)) {
    console.log("🚨 Fila sem oferta elegível", diagnosticoSemElegivel);
  }

  return null;
}
function aplicarDiversidadeFila(clienteId = "admin") {
  const cliente = String(clienteId || "admin");
  const itensCliente = fila.filter(item =>
    String(item.clienteId || "admin") === cliente
  );

  const itensOrdenados = ordenarPendentesPorDiversidade(itensCliente);
  let indiceCliente = 0;

  fila = fila.map(item => {
    if (String(item.clienteId || "admin") !== cliente) {
      return item;
    }

    return itensOrdenados[indiceCliente++];
  });
}

function salvarFila(clienteId = "admin") {
  aplicarDiversidadeFila(clienteId);

  return filaOfertas.salvarFila({
    fila,
    clienteId,
    getFilaFile,
    writeClienteJson,
    logger: console
  });
}

function carregarFila(clienteId = "admin") {
  fila = filaOfertas.carregarFila({
    fila,
    clienteId,
    getFilaFile,
    readClienteJson,
    logger: console
  });

  return fila;
}

function podeAdicionarOfertaAutomaticaFila(oferta = {}, clienteId = "admin", origem = "automatico") {
  const resultado = avaliarLimiteFilaHotfix(fila, { ...oferta, origem: oferta.origem || origem }, clienteId);
  if (!resultado.permitido) {
    console.log("[PERFORMANCE-FILA-LIMITE]", {
      clienteId,
      origem,
      pendentes: resultado.pendentes,
      motivo: resultado.motivo,
      prioridade: resultado.prioridade,
      cupomForte: resultado.cupomForte,
      titulo: oferta.titulo || oferta.nome || ""
    });
  }
  return resultado.permitido;
}


function normalizarChaveFilaEngine(valor = "") {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function numeroComparavelFilaEngine(valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero.toFixed(2) : String(valor || "").trim();
}

function itemEngineDuplicadoFilaGlobal(clienteId = "admin", itemFila = {}) {
  const cliente = String(clienteId || "admin");
  const engineOfertaId = itemFila.engineOfertaId || itemFila.engine_oferta_id || "";
  const linkOriginal = normalizarChaveFilaEngine(itemFila.linkOriginal || itemFila.link_original || "");
  const linkAfiliado = normalizarChaveFilaEngine(itemFila.linkAfiliado || itemFila.link || itemFila.linkFinal || "");
  const titulo = normalizarChaveFilaEngine(itemFila.titulo || itemFila.nome || "");
  const preco = numeroComparavelFilaEngine(itemFila.preco || itemFila.precoAtual);

  return fila.some(item => {
    if (String(item?.clienteId || "admin") !== cliente) return false;
    if (engineOfertaId && String(item.engineOfertaId || "") === String(engineOfertaId)) return true;

    const itemLinkOriginal = normalizarChaveFilaEngine(item.linkOriginal || item.link_original || "");
    const itemLinkAfiliado = normalizarChaveFilaEngine(item.linkAfiliado || item.link || item.linkFinal || "");
    const itemTitulo = normalizarChaveFilaEngine(item.titulo || item.nome || "");
    const itemPreco = numeroComparavelFilaEngine(item.preco || item.precoAtual);

    if (linkOriginal && (linkOriginal === itemLinkOriginal || linkOriginal === itemLinkAfiliado)) return true;
    if (linkAfiliado && (linkAfiliado === itemLinkAfiliado || linkAfiliado === itemLinkOriginal)) return true;
    return Boolean(titulo && preco && titulo === itemTitulo && preco === itemPreco);
  });
}

function adicionarOfertaNaFilaGlobalEngine(clienteId = "admin", itemFila = {}) {
  try {
    const cliente = String(clienteId || itemFila.clienteId || "admin").trim() || "admin";
    carregarFila(cliente);

    const itemFinal = {
      ...itemFila,
      clienteId: cliente,
      status: itemFila.status || "pendente",
      origem: itemFila.origem || "engine",
      origemDetalhe: itemFila.origemDetalhe || "Engine V2"
    };

    if (itemEngineDuplicadoFilaGlobal(cliente, itemFinal)) {
      console.log("[ENGINE-DISTRIBUIDOR-FILA-DUPLICADA]", {
        clienteId: cliente,
        engineOfertaId: itemFinal.engineOfertaId || null,
        titulo: itemFinal.titulo || itemFinal.nome || "",
        linkOriginal: itemFinal.linkOriginal || "",
        linkAfiliado: itemFinal.linkAfiliado || itemFinal.link || ""
      });
      return { ok: false, duplicada: true, motivo: "duplicidade_fila" };
    }

    filaOfertas.adicionarOfertaFila(fila, itemFinal, {
      clienteId: cliente,
      origem: itemFinal.origem || "engine",
      logger: console
    });
    const salvou = salvarFila(cliente);

    if (!salvou) {
      return { ok: false, motivo: "erro_fila" };
    }

    console.log("[ENGINE-DISTRIBUIDOR-FILA-MEMORIA]", {
      clienteId: cliente,
      engineOfertaId: itemFinal.engineOfertaId || null,
      itemId: itemFinal.id || "",
      totalCliente: fila.filter(item => String(item?.clienteId || "admin") === cliente).length
    });

    return { ok: true, itemFila: itemFinal };
  } catch (e) {
    console.log("[ENGINE-DISTRIBUIDOR-FILA-MEMORIA]", {
      ok: false,
      clienteId,
      erro: e.message
    });
    return { ok: false, motivo: "erro_fila", erro: e.message };
  }
}
function garantirIdsFila() {
  let alterou = false;

  for (const item of fila) {
    if (!item.id) {
      item.id = `oferta_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      alterou = true;
    }
  }

  if (alterou) {
    salvarFila(clienteId)
    console.log("[FILA] IDs corrigidos em itens antigos da fila");
  }
}

// ================= FUNCAO SALVAR SESSOES META =======================

function salvarSessoesMeta() {
  writeGlobalJson("sessoes.json", sessoesMeta);
}

function removerClienteIdRaiz(dados = {}) {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return dados;
  const { clienteId, ...restante } = dados;
  return restante;
}

function carregarMapaClientesJson(arquivo = "", legado = {}) {
  const mapa = legado && typeof legado === "object" && !Array.isArray(legado)
    ? { ...legado }
    : {};

  for (const clienteId of listClientes()) {
    const dados = readClienteJson(clienteId, arquivo, null);
    if (!dados || typeof dados !== "object") continue;
    mapa[clienteId] = removerClienteIdRaiz(dados);
  }

  return mapa;
}

function salvarMapaClientesJson(arquivo = "", mapa = {}) {
  const origem = mapa && typeof mapa === "object" ? mapa : {};

  for (const [clienteId, dados] of Object.entries(origem)) {
    if (!clienteId || !dados || typeof dados !== "object") continue;
    writeClienteJson(clienteId, arquivo, dados);
  }
}

// ================= FUNCAO CARREGA SESSOES META =======================

function carregarSessoesMeta() {
  try {
    const dados = readGlobalJson("sessoes.json", {});

    sessoesMeta = dados && typeof dados === "object" ? dados : {};

    console.log("[OK] Sesses meta carregadas:", Object.keys(sessoesMeta).length);
  } catch (e) {
    console.log("[ERRO]❌Erro ao carregar sesses meta:", e.message);
    sessoesMeta = {};
  }
}

// ================= FUNCAO SALVA INTEGRACOES =======================

function salvarIntegracoesPersistidas() {
  writeGlobalJson("integracoes.json", integracoesPorCliente);
  salvarMapaClientesJson("integracoes.json", integracoesPorCliente);
}

// ================= FUNCAO SALVA USUARIO =================

function salvarUsuarios() {
  writeGlobalJson("usuarios.json", usuarios);
}

// ================= CREDITOS =================

const CREDITOS_PLANO = {
  free: 300,
  starter: 2500,
  pro: 7500,
  enterprise: 9500
};

function obterUsuario(clienteId) {
  return usuarios.find(
    u => String(u.id) === String(clienteId)
  );
}

function renovarCreditosSeNecessario(usuario) {
  if (!usuario) return;

  const hoje = new Date();

  const mesAtual =
    `${hoje.getFullYear()}-${hoje.getMonth() + 1}`;

  if (usuario.mesCreditos === mesAtual) {
    return;
  }

  const plano =
    String(usuario.plano || "free").toLowerCase();

  usuario.creditos =
    CREDITOS_PLANO[plano] || 300;

  usuario.mesCreditos = mesAtual;

  salvarUsuarios();

  console.log("[INFO] Crditos renovados:", {
    usuario: usuario.email,
    plano,
    creditos: usuario.creditos
  });
}

// ================ FUNCAO USUARIO TEM CRÉDITO ==================

function usuarioTemCreditos(clienteId, quantidade = 1) {
  const usuario = obterUsuario(clienteId);

  if (!usuario) return false;

  renovarCreditosSeNecessario(usuario);

  return Number(usuario.creditos || 0) >= quantidade;
}

function debitarCreditos(clienteId, quantidade = 1) {
  const usuario = obterUsuario(clienteId);

  if (!usuario) return false;

  renovarCreditosSeNecessario(usuario);

  if (Number(usuario.creditos || 0) < quantidade) {
    return false;
  }

  usuario.creditos =
    Number(usuario.creditos || 0) - quantidade;

  salvarUsuarios();

  console.log("[INFO] Crditos debitados:", {
    usuario: usuario.email,
    restante: usuario.creditos,
    debitado: quantidade
  });

  return true;
}

// ================= FUNCAO SALVA PLANO ===================

function salvarPlanos() {
  writeGlobalJson("planos.json", planos);
}

// ============ FUNCAO SALVA CONFIG CLIENTES ==============

function salvarConfigsClientes() {
  writeGlobalJson("configs_clientes.json", configsPorCliente);
  salvarMapaClientesJson("config.json", configsPorCliente);
}

function salvarDestinosClientes() {
  writeGlobalJson("destinos_clientes.json", destinosPorCliente);
  salvarMapaClientesJson("destinos.json", destinosPorCliente);
}

function normalizarTemplateIdDestinoContrato(valor) {
  const id = String(valor || "").trim();
  if (!id || id === "padrao_optimus") return id || null;
  return /^tpl_[a-zA-Z0-9_-]+$/.test(id) ? id : null;
}

function normalizarModoLinkDestino(valor = "") {
  return String(valor || "").trim().toLowerCase() === "optimus" ? "optimus" : "original";
}

function normalizarDestinoContrato(destino = {}) {
  if (!destino || typeof destino !== "object" || Array.isArray(destino)) return destino;
  return {
    ...destino,
    templateId: normalizarTemplateIdDestinoContrato(destino.templateId),
    prioridadeCupomAtiva: destino.prioridadeCupomAtiva === true,
    modoLink: normalizarModoLinkDestino(destino.modoLink)
  };
}

function normalizarDestinosContrato(valor) {
  if (Array.isArray(valor)) {
    return valor.map(item => normalizarDestinoContrato(item));
  }

  if (valor && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor).map(([chave, item]) => [
        chave,
        Array.isArray(item) ? normalizarDestinosContrato(item) : item
      ])
    );
  }

  return valor;
}

function numeroIntervaloValido(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function destinoIdIntervalo(destino = {}) {
  return String(
    destino.id ||
    destino.destinoId ||
    destino.conexaoId ||
    destino.chatId ||
    destino.grupoId ||
    destino.nome ||
    "destino"
  );
}

function canalDestinoIntervalo(destino = {}) {
  return String(destino.tipo || destino.canal || "").toLowerCase();
}

function dataIsoIntervalo(ms = 0) {
  const valor = Number(ms || 0);
  return Number.isFinite(valor) && valor > 0 ? new Date(valor).toISOString() : "";
}

function timestampIntervalo(valor = "") {
  const ms = Date.parse(String(valor || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function logFilaIntervalo(tag, payload = {}) {
  console.log(tag, JSON.stringify(payload));
}

function controleIntervaloCliente(clienteId = "admin") {
  const cliente = String(clienteId || "admin");
  if (!controleIntervaloEnvioPorCliente[cliente] || typeof controleIntervaloEnvioPorCliente[cliente] !== "object") {
    controleIntervaloEnvioPorCliente[cliente] = {};
  }
  return controleIntervaloEnvioPorCliente[cliente];
}

function lerControleIntervaloPersistido(clienteId = "admin") {
  const dados = readClienteJson(clienteId, CONTROLE_INTERVALO_DESTINOS_FILE, {});
  const limpo = removerClienteIdRaiz(dados);
  return limpo && typeof limpo === "object" && !Array.isArray(limpo) ? limpo : {};
}

function salvarControleIntervaloCliente(clienteId = "admin") {
  writeClienteJson(clienteId, CONTROLE_INTERVALO_DESTINOS_FILE, controleIntervaloCliente(clienteId));
}

function restaurarControleIntervaloEnvio() {
  controleIntervaloEnvioPorCliente = {};

  for (const clienteId of listClientes()) {
    const controles = lerControleIntervaloPersistido(clienteId);
    const normalizados = {};

    for (const [chaveControle, item] of Object.entries(controles)) {
      if (!item || typeof item !== "object") continue;
      const ultimoEnvioMs = timestampIntervalo(item.ultimoEnvioEm);
      normalizados[chaveControle] = {
        ...item,
        ultimoEnvioEm: dataIsoIntervalo(ultimoEnvioMs),
        proximoEnvioPermitidoEm: String(item.proximoEnvioPermitidoEm || "")
      };
      if (ultimoEnvioMs > 0) controleEnvio[chaveControle] = ultimoEnvioMs;

      logFilaIntervalo("[FILA-CONTROLE-INTERVALO-RESTAURADO]", {
        clienteId,
        destinoId: item.destinoId || chaveControle,
        canal: item.canal || "",
        ofertaId: "",
        ofertaTemCupomReal: false,
        prioridadeCupomAtiva: item.prioridadeCupomAtiva === true,
        intervaloConfigurado: Number(item.intervaloConfiguradoMinutos || item.intervaloConfigurado || 0),
        intervaloAplicado: Number(item.intervaloAplicadoMinutos || item.intervaloAplicado || 0),
        ultimoEnvioEm: normalizados[chaveControle].ultimoEnvioEm,
        proximoEnvioPermitidoEm: normalizados[chaveControle].proximoEnvioPermitidoEm,
        tentativaEm: new Date().toISOString(),
        permitido: false,
        motivo: "controle_restaurado"
      });
    }

    controleIntervaloEnvioPorCliente[clienteId] = normalizados;
  }
}

function salvarConfig() {
  try {
    writeGlobalJson("config.json", config);

    console.log("[OK]💾 Config salva");
  } catch (e) {
    console.error("[ERRO]❌ ERRO AO SALVAR CONFIG:", e.message);
  }
}

function sessaoPersistidaValida(id) {
  if (!id) return false;

  return !!sessoesMeta?.[id];
}

function removerIdsDeArray(lista, idsRemover) {
  if (!Array.isArray(lista)) return lista;

  return lista.filter(id => !idsRemover.has(String(id)));
}

function limparDestinoSessao(destino, idsRemover) {
  if (!destino || typeof destino !== "object") return;

  if (destino.conexaoId && idsRemover.has(String(destino.conexaoId))) {
    destino.conexaoId = "";
  }

  if (destino.sessaoId && idsRemover.has(String(destino.sessaoId))) {
    destino.sessaoId = "";
  }

  if (destino.idSessao && idsRemover.has(String(destino.idSessao))) {
    destino.idSessao = "";
  }

  destino.sessoes = removerIdsDeArray(destino.sessoes, idsRemover);
  destino.sessoesWhatsapp = removerIdsDeArray(destino.sessoesWhatsapp, idsRemover);
}

function limparMapaDestinosPorSessao(mapa, idsRemover) {
  if (!mapa || typeof mapa !== "object") return;

  for (const id of idsRemover) {
    delete mapa[id];
  }
}

function removerReferenciasSessao(ids = [], clienteId = null) {
  const idsRemover = new Set(
    ids
      .map(id => String(id || "").trim())
      .filter(Boolean)
  );

  if (!idsRemover.size) return;

  config.sessoesWhatsapp = removerIdsDeArray(config.sessoesWhatsapp || [], idsRemover);
  limparMapaDestinosPorSessao(config.destinosPorSessao, idsRemover);
  limparMapaDestinosPorSessao(destinosPorSessao, idsRemover);

  for (const cfg of Object.values(configsPorCliente || {})) {
    limparMapaDestinosPorSessao(cfg?.destinosPorSessao, idsRemover);
  }

  const clientes = clienteId
    ? [clienteId]
    : Object.keys(destinosPorCliente || {});

  for (const cid of clientes) {
    const destinosCliente = destinosPorCliente?.[cid];

    if (Array.isArray(destinosCliente)) {
      destinosCliente.forEach(destino => limparDestinoSessao(destino, idsRemover));
    } else if (destinosCliente && typeof destinosCliente === "object") {
      for (const id of idsRemover) {
        delete destinosCliente[id];
      }

      Object.values(destinosCliente).forEach(lista => {
        if (Array.isArray(lista)) {
          lista.forEach(destino => limparDestinoSessao(destino, idsRemover));
        }
      });
    }
  }
}

// ================ FUNCAO CRIAR PLANO =====================

function criarPlanosPadrao() {
  if (Object.keys(planos || {}).length) return;

  planos = {

    free: {
      nome: "free",

      marketplaces: [
        "amazon",
        "shopee"
      ],

      limites: {
        sessoes: 1,
        destinos: 2,
        enviosDia: 50,
        creditos: 300
      },

      recursos: {
        buscaManual: true,
        farejadorAutomatico: false,

        whatsapp: true,
        telegram: false,

        multiSessao: false,

        linkOptimus: false,
        analytics: false,
        cupomInteligente: false,
        campanhas: true,
        templatePersonalizado: false,
        social: false
      },

      atualizadoEm: new Date().toISOString()
    },

    pro: {
      nome: "pro",

      marketplaces: [
        "amazon",
        "shopee",
        "mercadolivre",
        "aliexpress"
      ],

      limites: {
        sessoes: 3,
        destinos: 10,
        enviosDia: 500,
        creditos: 2500
      },

      recursos: {
        buscaManual: true,
        farejadorAutomatico: false,

        whatsapp: true,
        telegram: true,

        multiSessao: true,

        linkOptimus: true,
        analytics: true,
        cupomInteligente: true,
        campanhas: false,
        mensageiro: false,
        templatePersonalizado: false,
        social: false
      },

      atualizadoEm: new Date().toISOString()
    },

    premium: {
      nome: "premium",

      marketplaces: [
        "amazon",
        "shopee",
        "mercadolivre",
        "aliexpress",
        "awin",
        "magalu"
      ],

      limites: {
        sessoes: 10,
        destinos: 50,
        enviosDia: 5000,
        creditos: 9500
      },

      recursos: {
        buscaManual: true,
        farejadorAutomatico: true,

        whatsapp: true,
        telegram: true,

        multiSessao: true,

        linkOptimus: true,
        analytics: true,
        cupomInteligente: true,
        adminAvancado: true,
        campanhas: true,
        templatePersonalizado: false,
        social: false
      },

      atualizadoEm: new Date().toISOString()
    }
  };

  salvarPlanos();

  console.log("[OK]✅ Planos padro criados");
}

// ================= FUNÇÃO CARREGA CONFIG =================

function carregarConfig() {
  try {
    const configSalva = readGlobalJson("config.json", null);

    if (configSalva && typeof configSalva === "object") {
      config = {
        ...config,
        ...configSalva,
        marketplaces: {
          ...config.marketplaces,
          ...(configSalva.marketplaces || {})
        }
      };

      console.log("[OK]✅ Config carregada");
    }


usuarios = readGlobalJson("usuarios.json", []);

if (Array.isArray(usuarios) && usuarios.length) {
  console.log("[OK]✅ Usurios carregados");
}

integracoesPorCliente = carregarMapaClientesJson(
  "integracoes.json",
  readGlobalJson("integracoes.json", {})
);

if (integracoesPorCliente && Object.keys(integracoesPorCliente).length) {
  console.log("[OK]✅ Integraes carregadas");
}

configsPorCliente = carregarMapaClientesJson(
  "config.json",
  readGlobalJson("configs_clientes.json", {})
);

if (configsPorCliente && Object.keys(configsPorCliente).length) {
  console.log("[OK]✅ Configs dos clientes carregadas");
}

destinosPorCliente = carregarMapaClientesJson(
  "destinos.json",
  readGlobalJson("destinos_clientes.json", {})
);
destinosPorCliente = normalizarDestinosContrato(destinosPorCliente);

if (destinosPorCliente && Object.keys(destinosPorCliente).length) {
  console.log("[DESTINO] Destinos dos clientes carregados");
}

restaurarControleIntervaloEnvio();

planos = readGlobalJson("planos.json", {});

if (planos && Object.keys(planos).length) {
  console.log("[OK]✅ Planos carregados");
}

sessoesMeta = readGlobalJson("sessoes.json", {});

if (sessoesMeta && Object.keys(sessoesMeta).length) {
  console.log("[OK]✅ Sesses meta carregadas:", Object.keys(sessoesMeta).length);
}

  mensageiro.carregarMensageiro();
  socialModule.inicializarSocialModule({ logger: console });

   criarPlanosPadrao();


if (!usuarios.length) {
console.log("[INFO] CRIANDO ADMIN PADRO");
  usuarios = [
 {
  id: "admin",
  nome: "Diego",
  email: "admin@optimus.local",
  senha: "fzt976",
  papel: "admin_master",
  plano: "master",
  creditos: 999999,
  ativo: true,
  criadoEm: new Date().toISOString()
}
  ];

  salvarUsuarios();

  console.log("[OK]✅ Usurio admin inicial criado");
}

  } catch (e) {
    console.error("[ERRO] ERRO AO CARREGAR CONFIG:", e.message);
  }
}

// =========== LINK GLOBAL OPTIMUS ===========

function normalizarDominioLinkOptimus(valor = "") {
  const texto = String(valor || "").trim();
  if (!texto) return "";
  const candidato = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(texto) ? texto : "https://" + texto;
  try {
    const url = new URL(candidato);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) return "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch (erro) {
    return "";
  }
}

function normalizarFormatoLinkOptimus(valor = "/r") {
  const texto = String(valor || "/r").trim() || "/r";
  const comBarra = texto.startsWith("/") ? texto : "/" + texto;
  return comBarra.replace(/\/+$/, "") || "/r";
}

function resolverDominioBaseLinkOptimus(configBase = config) {
  const dominioConfigurado = normalizarDominioLinkOptimus(configBase?.linksOptimus?.dominio);
  if (dominioConfigurado) return dominioConfigurado;
  return normalizarDominioLinkOptimus(process.env.RAILWAY_PUBLIC_DOMAIN || "");
}

function montarUrlLinkOptimus(codigo = "", configBase = config) {
  const dominio = resolverDominioBaseLinkOptimus(configBase);
  if (!dominio || !codigo) return "";
  return dominio + "/r/" + codigo;
}

function origemDominioLinkOptimus(configBase = config) {
  const dominioConfig = normalizarDominioLinkOptimus(configBase?.linksOptimus?.dominio);
  if (dominioConfig) {
    return {
      dominio: dominioConfig,
      origem: "config"
    };
  }

  const dominioRailway = normalizarDominioLinkOptimus(process.env.RAILWAY_PUBLIC_DOMAIN || "");
  if (dominioRailway) {
    return {
      dominio: dominioRailway,
      origem: "railway"
    };
  }

  return {
    dominio: "",
    origem: "indisponivel"
  };
}

function montarRespostaConfigLinksOptimus(configBase = config) {
  const efetivo = origemDominioLinkOptimus(configBase);
  return {
    dominio: normalizarDominioLinkOptimus(configBase?.linksOptimus?.dominio),
    dominioEfetivo: efetivo.dominio,
    origem: efetivo.origem
  };
}

function normalizarDominioConfigLinkOptimus(valor = "") {
  const texto = String(valor || "").trim();
  if (!texto) {
    return {
      ok: true,
      dominio: ""
    };
  }

  if (!/^https?:\/\//i.test(texto)) {
    return {
      ok: false,
      erro: "dominio_deve_incluir_http_ou_https"
    };
  }

  try {
    const url = new URL(texto);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
      return {
        ok: false,
        erro: "dominio_invalido"
      };
    }

    if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
      return {
        ok: false,
        erro: "dominio_nao_deve_conter_caminho_query_ou_fragmento"
      };
    }

    url.pathname = "/";
    url.search = "";
    url.hash = "";

    return {
      ok: true,
      dominio: url.toString().replace(/\/+$/, "")
    };
  } catch (erro) {
    return {
      ok: false,
      erro: "dominio_invalido"
    };
  }
}

function logConfigLinkOptimus(evento, dados = {}) {
  console.log(evento, {
    adminId: dados.adminId || "",
    origem: dados.origem || "",
    dominioConfigurado: Boolean(dados.dominioConfigurado),
    dominioEfetivo: Boolean(dados.dominioEfetivo),
    motivo: dados.motivo || ""
  });
}

function adminMasterAutorizadoLinksOptimus(req, res) {
  if (req.usuario?.papel === "admin_master") return true;
  res.status(403).json({
    ok: false,
    erro: "Acesso restrito ao admin_master"
  });
  return false;
}

function responderAdminConfigLinksOptimus(req, res) {
  try {
    if (!adminMasterAutorizadoLinksOptimus(req, res)) return;

    const linksOptimus = montarRespostaConfigLinksOptimus(config);
    logConfigLinkOptimus("[LINK-OPTIMUS-CONFIG-LIDA]", {
      adminId: req.usuario?.id || req.clienteId || "",
      origem: linksOptimus.origem,
      dominioConfigurado: Boolean(linksOptimus.dominio),
      dominioEfetivo: Boolean(linksOptimus.dominioEfetivo)
    });

    return res.json({
      ok: true,
      linksOptimus
    });
  } catch (erro) {
    logConfigLinkOptimus("[LINK-OPTIMUS-CONFIG-ERRO]", {
      adminId: req.usuario?.id || req.clienteId || "",
      motivo: "leitura"
    });
    return res.status(500).json({
      ok: false,
      erro: "Nao foi possivel carregar a configuracao do Link Optimus"
    });
  }
}

function salvarAdminConfigLinksOptimus(req, res) {
  try {
    if (!adminMasterAutorizadoLinksOptimus(req, res)) return;

    const resultado = normalizarDominioConfigLinkOptimus(req.body?.dominio || "");
    if (!resultado.ok) {
      logConfigLinkOptimus("[LINK-OPTIMUS-CONFIG-ERRO]", {
        adminId: req.usuario?.id || req.clienteId || "",
        motivo: resultado.erro || "dominio_invalido"
      });
      return res.status(400).json({
        ok: false,
        erro: resultado.erro || "dominio_invalido"
      });
    }

    config.linksOptimus = {
      ativo: config.linksOptimus?.ativo !== false,
      formato: config.linksOptimus?.formato || "/r",
      rastrearCliques: config.linksOptimus?.rastrearCliques !== false,
      ...config.linksOptimus,
      dominio: resultado.dominio
    };

    salvarConfig();

    const linksOptimus = montarRespostaConfigLinksOptimus(config);
    logConfigLinkOptimus(resultado.dominio ? "[LINK-OPTIMUS-CONFIG-SALVA]" : "[LINK-OPTIMUS-CONFIG-LIMPA]", {
      adminId: req.usuario?.id || req.clienteId || "",
      origem: linksOptimus.origem,
      dominioConfigurado: Boolean(linksOptimus.dominio),
      dominioEfetivo: Boolean(linksOptimus.dominioEfetivo)
    });

    return res.json({
      ok: true,
      linksOptimus
    });
  } catch (erro) {
    logConfigLinkOptimus("[LINK-OPTIMUS-CONFIG-ERRO]", {
      adminId: req.usuario?.id || req.clienteId || "",
      motivo: "salvar"
    });
    return res.status(500).json({
      ok: false,
      erro: "Nao foi possivel salvar a configuracao do Link Optimus"
    });
  }
}

function extrairLinkAfiliadoOferta(oferta = {}) {
  return String(
    oferta.linkAfiliado ||
    oferta.linkFinal ||
    oferta.link ||
    oferta.urlAfiliada ||
    oferta.url ||
    ""
  ).trim();
}

function localizarLinkOptimusExistente({ clienteId = "", linkOriginal = "", marketplace = "", configBase = config } = {}) {
  const linksGerados = configBase?.linksGerados || {};
  const cliente = String(clienteId || "").trim();
  const link = String(linkOriginal || "").trim();
  if (!link) return null;

  for (const [codigo, dados] of Object.entries(linksGerados)) {
    if (!dados || typeof dados !== "object") continue;
    const linkGerado = String(dados.urlOriginal || dados.original || "").trim();
    const clienteGerado = String(dados.clienteId || "").trim();
    if (linkGerado !== link) continue;
    if (clienteGerado !== cliente) continue;
    const url = montarUrlLinkOptimus(codigo, configBase);
    if (!url) continue;
    return { codigo, url, dados };
  }

  return null;
}

function gerarCodigoLinkOptimus(configBase = config) {
  const linksGerados = configBase.linksGerados || {};
  for (let tentativa = 0; tentativa < 10; tentativa += 1) {
    const codigo = Math.random().toString(36).substring(2, 8);
    if (codigo && !linksGerados[codigo]) return codigo;
  }
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
}

function criarLinkOptimus(linkOriginal = "", marketplace = "", opcoes = {}) {
  const configBase = opcoes.configGlobal || config;
  const link = String(linkOriginal || "").trim();
  const clienteId = String(opcoes.clienteId || "").trim();
  if (!link) return { ok: false, motivo: "link_original_ausente" };
  if (configBase?.linksOptimus?.ativo !== true) return { ok: false, motivo: "config_desativada" };
  if (!resolverDominioBaseLinkOptimus(configBase)) return { ok: false, motivo: "dominio_ausente" };

  configBase.linksGerados = configBase.linksGerados || {};
  const existente = localizarLinkOptimusExistente({ clienteId, linkOriginal: link, marketplace, configBase });
  if (existente) {
    return { ok: true, url: existente.url, codigo: existente.codigo, reutilizado: true };
  }

  const codigo = gerarCodigoLinkOptimus(configBase);
  configBase.linksGerados[codigo] = {
    original: link,
    urlOriginal: link,
    marketplace,
    clienteId,
    cliques: 0,
    ultimoClique: null,
    criadoEm: new Date().toISOString()
  };

  try {
    salvarConfig();
  } catch (erro) {
    delete configBase.linksGerados[codigo];
    throw erro;
  }

  return { ok: true, url: montarUrlLinkOptimus(codigo, configBase), codigo, reutilizado: false };
}

function gerarLinkOptimus(linkOriginal = "", marketplace = "", opcoes = {}) {
  const resultado = criarLinkOptimus(linkOriginal, marketplace, opcoes);
  return resultado.ok ? resultado.url : String(linkOriginal || "");
}

function logLinkOptimus(tag, payload = {}) {
  const seguro = {
    clienteId: payload.clienteId || "",
    destinoId: payload.destinoId || "",
    marketplace: payload.marketplace || "",
    motivo: payload.motivo || "",
    codigo: payload.codigo || ""
  };
  console.log(tag, JSON.stringify(seguro));
}

function copiarOfertaComLinkResolvido(oferta = {}, linkResolvido = "", linkOriginal = "") {
  return {
    ...oferta,
    linkAfiliadoOriginal: oferta.linkAfiliado || "",
    linkFinalOriginal: oferta.linkFinal || "",
    linkOriginalAntesLinkOptimus: linkOriginal,
    linkAfiliado: linkResolvido,
    linkFinal: linkResolvido,
    link: linkResolvido,
    urlAfiliada: linkResolvido,
    url: linkResolvido,
    linkOptimusAplicado: true
  };
}

function resolverLinkOfertaPorDestino({ oferta = {}, destino = {}, clienteId = "admin", plano = null, recursos = null, configGlobal = config } = {}) {
  const linkOriginal = extrairLinkAfiliadoOferta(oferta);
  const marketplace = String(oferta.marketplace || oferta.mercado || "").toLowerCase();
  const destinoId = destinoIdIntervalo(destino);
  const recursosPlano = recursos || plano?.recursos || {};
  const modoLink = normalizarModoLinkDestino(destino?.modoLink);

  const baseLog = { clienteId, destinoId, marketplace };

  if (modoLink !== "optimus") {
    logLinkOptimus("[LINK-OPTIMUS-ORIGINAL]", { ...baseLog, motivo: "modo_original" });
    return { oferta, linkOriginal, linkFinal: linkOriginal, aplicado: false, motivo: "modo_original" };
  }

  if (!linkOriginal) {
    logLinkOptimus("[LINK-OPTIMUS-FALLBACK]", { ...baseLog, motivo: "link_original_ausente" });
    return { oferta, linkOriginal, linkFinal: linkOriginal, aplicado: false, motivo: "link_original_ausente" };
  }

  if (recursosPlano?.linkOptimus !== true) {
    logLinkOptimus("[LINK-OPTIMUS-FALLBACK]", { ...baseLog, motivo: "plano_sem_permissao" });
    return { oferta, linkOriginal, linkFinal: linkOriginal, aplicado: false, motivo: "plano_sem_permissao" };
  }

  if (configGlobal?.linksOptimus?.ativo !== true) {
    logLinkOptimus("[LINK-OPTIMUS-FALLBACK]", { ...baseLog, motivo: "config_desativada" });
    return { oferta, linkOriginal, linkFinal: linkOriginal, aplicado: false, motivo: "config_desativada" };
  }

  if (!resolverDominioBaseLinkOptimus(configGlobal)) {
    logLinkOptimus("[LINK-OPTIMUS-FALLBACK]", { ...baseLog, motivo: "dominio_ausente" });
    return { oferta, linkOriginal, linkFinal: linkOriginal, aplicado: false, motivo: "dominio_ausente" };
  }

  try {
    const resultado = criarLinkOptimus(linkOriginal, marketplace, { clienteId, configGlobal });
    if (!resultado.ok || !resultado.url) {
      logLinkOptimus("[LINK-OPTIMUS-FALLBACK]", { ...baseLog, motivo: resultado.motivo || "geracao_indisponivel" });
      return { oferta, linkOriginal, linkFinal: linkOriginal, aplicado: false, motivo: resultado.motivo || "geracao_indisponivel" };
    }

    const ofertaResolvida = copiarOfertaComLinkResolvido(oferta, resultado.url, linkOriginal);
    logLinkOptimus(resultado.reutilizado ? "[LINK-OPTIMUS-REUTILIZADO]" : "[LINK-OPTIMUS-APLICADO]", {
      ...baseLog,
      motivo: resultado.reutilizado ? "redirect_existente" : "redirect_criado",
      codigo: resultado.codigo
    });
    return {
      oferta: ofertaResolvida,
      linkOriginal,
      linkFinal: resultado.url,
      codigo: resultado.codigo,
      aplicado: true,
      reutilizado: resultado.reutilizado === true,
      motivo: resultado.reutilizado ? "redirect_existente" : "redirect_criado"
    };
  } catch (erro) {
    logLinkOptimus("[LINK-OPTIMUS-FALLBACK]", { ...baseLog, motivo: "erro_geracao" });
    return { oferta, linkOriginal, linkFinal: linkOriginal, aplicado: false, motivo: "erro_geracao" };
  }
}


// ========== LIGAÇÃO IMPORTAR AMAZON E SHOPEE ===================

const importarAmazon = criarImportarAmazon({
  extrairJsonLd,
  extrairMeta,
  htmlDecode,
  limparPreco,
  corrigirImagemUrl,
  limparLinkAmazon,
  gerarLinkOptimus,
  extrairCuponsAmazonDoHtml,
  detectarAvisoCupomAmazon,
  escolherCupomParaOfertaAmazon
});

const importarShopee = criarImportarShopee({
  limparPreco,
  htmlDecode,
  extrairMeta,
  corrigirImagemUrl
});

// ================= FILTROS OFERTA JA EXISTE =================

function gerarChaveDuplicidadeOferta(oferta = {}) {
  return normalizarTexto(
    oferta.titulo ||
    oferta.nome ||
    ""
  )
    .replace(/\b(preto|preta|branco|branca|azul|vermelho|verde|rosa|cinza)\b/g, "")
    .replace(/\b(bivolt|110v|220v|110-220v|110\/220v)\b/g, "")
    .replace(/\b(cor|tamanho|modelo)\b/g, "")
    .replace(/\b(mlb\d+)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extrairIdMercadoLivreOferta(oferta = {}) {
  const texto = String(
    oferta.linkOriginal ||
    oferta.link ||
    oferta.linkAfiliado ||
    ""
  );

  return texto.match(/MLB-?\d+/i)?.[0]?.replace("-", "").toUpperCase() || "";
}

function precoNumeroDuplicidade(valor = "") {
  return Number(
    String(valor || "0")
      .replace(/[^\d,.-]/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
  ) || 0;
}

function horasBloqueioDuplicidadeFila(ofertaExistente = {}) {
  const status = normalizarTexto(ofertaExistente.status || "");

  if (status === "pendente" || status === "retida") return 12;
  if (status === "enviado" || status === "fila") return 6;
  if (status === "expirado" || status === "erro") return 2;

  return 6;
}

function ofertaTemMelhoriaParaRepetir(novaOferta = {}, ofertaExistente = {}) {
  const cupomNovo = String(novaOferta.cupom || "").trim();
  const cupomExistente = String(ofertaExistente.cupom || "").trim();

  if (cupomNovo && cupomNovo !== cupomExistente) return true;

  const precoNovo = precoNumeroDuplicidade(novaOferta.precoAtual || novaOferta.preco);
  const precoExistente = precoNumeroDuplicidade(ofertaExistente.precoAtual || ofertaExistente.preco);

  return precoExistente > 0 && precoNovo > 0 && precoNovo <= precoExistente * 0.92;
}

function ofertaJaExiste(novaOferta) {
  const tituloNovo = normalizarTexto(novaOferta.titulo || novaOferta.nome);
  const chaveNova = gerarChaveDuplicidadeOferta(novaOferta);
  const idMlNovo = extrairIdMercadoLivreOferta(novaOferta);

  const linkNovo = String(
    novaOferta.linkOriginal ||
    novaOferta.link ||
    novaOferta.linkAfiliado ||
    ""
  ).trim();

  const precoNovo = String(
    novaOferta.preco ||
    novaOferta.precoAtual ||
    ""
  ).trim();

  const marketplaceNovo = normalizarTexto(novaOferta.marketplace || novaOferta.mercado || "");

  const agora = Date.now();
  return fila.some((o) => {
    const tituloExistente = normalizarTexto(o.titulo || o.nome);
    const chaveExistente = gerarChaveDuplicidadeOferta(o);
    const idMlExistente = extrairIdMercadoLivreOferta(o);

    const linkExistente = String(
      o.linkOriginal ||
      o.link ||
      o.linkAfiliado ||
      ""
    ).trim();

    const precoExistente = String(
      o.preco ||
      o.precoAtual ||
      ""
    ).trim();

    const marketplaceExistente = normalizarTexto(o.marketplace || o.mercado || "");

    const dataItem = new Date(
      o.criadoEm || o.dataCriacao || o.enviadoEm || o.dataEnvio || 0
    ).getTime();

    const horasBloqueio = horasBloqueioDuplicidadeFila(o);
    const itemRecente =
      dataItem && agora - dataItem < horasBloqueio * 60 * 60 * 1000;

  if (!itemRecente) return false;

const ehRadar =
  normalizarTexto(novaOferta.origem || "") === "radar" ||
  novaOferta.radar === true ||
  novaOferta.radarNaFila === true;

const temMelhoria = ofertaTemMelhoriaParaRepetir(novaOferta, o);

const descontoNovo =
  Number(String(novaOferta.desconto || "0").replace(/[^\d]/g, "")) || 0;

const cupomNovoValido =
  String(novaOferta.cupom || "").trim() &&
  !["copiado", "cupom copiado", "sem cupom"].includes(
    normalizarTexto(novaOferta.cupom || "")
  );

if (ehRadar || temMelhoria || descontoNovo >= 25 || cupomNovoValido) {
  return false;
}

    if (idMlNovo && idMlExistente && idMlNovo === idMlExistente) {
      console.log("[INFO] DUPLICADA ML POR ID:", {
        id: idMlNovo,
        tituloNovo: novaOferta.titulo || novaOferta.nome,
        tituloExistente: o.titulo || o.nome
      });
      return true;
    }

    if (linkNovo && linkExistente && linkNovo === linkExistente) {
      console.log("[INFO] DUPLICADA POR LINK:", {
        tituloNovo: novaOferta.titulo || novaOferta.nome,
        tituloExistente: o.titulo || o.nome
      });
      return true;
    }

 if (
  tituloNovo &&
  tituloExistente &&
  tituloNovo === tituloExistente &&
  precoNovo &&
  precoExistente &&
  precoNovo === precoExistente &&
  marketplaceNovo &&
  marketplaceExistente &&
  marketplaceNovo === marketplaceExistente
) {
  console.log("[INFO] DUPLICADA POR TITULO + PRECO + MARKETPLACE:", {
    tituloNovo: novaOferta.titulo || novaOferta.nome,
    tituloExistente: o.titulo || o.nome
  });
  return true;
}

    if (
      chaveNova &&
      chaveExistente &&
      chaveNova === chaveExistente &&
      precoNovo &&
      precoExistente &&
      precoNovo === precoExistente &&
      marketplaceNovo &&
      marketplaceExistente &&
      marketplaceNovo === marketplaceExistente
    ) {
      console.log("[INFO] DUPLICADA POR CHAVE + PREO + MARKETPLACE:", {
        chave: chaveNova,
        preco: precoNovo,
        marketplace: marketplaceNovo,
        tituloNovo: novaOferta.titulo || novaOferta.nome,
        tituloExistente: o.titulo || o.nome
      });
      return true;
    }

    return false;
  });
}

function normalizarLinkDuplicidadeRadar(link = "", marketplace = "") {
  const texto = String(link || "").trim();
  if (!texto) return "";

  const semEspacos = texto.replace(/\s+/g, "");

  try {
    const parsed = new URL(semEspacos);
    parsed.hash = "";
    parsed.search = "";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return parsed.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    const mp = normalizarMarketplaceRadar(marketplace);
    return limparUrlProdutoRadar(semEspacos, mp).replace(/\/$/, "").toLowerCase() ||
      semEspacos.split("?")[0].replace(/\/$/, "").toLowerCase();
  }
}

function linksDuplicidadeRadar(oferta = {}) {
  const marketplace = oferta.marketplace || oferta.mercado || "";
  const links = [
    oferta.linkOriginal,
    oferta.linkResolvidoRadar,
    oferta.linkCapturado,
    oferta.link,
    oferta.linkAfiliado,
    oferta.linkFinal
  ]
    .map(link => normalizarLinkDuplicidadeRadar(link, marketplace))
    .filter(Boolean);

  return [...new Set(links)];
}

function identidadeCanonicaRadar(oferta = {}) {
  return resolverIdentidadeCanonicaOferta(oferta);
}

function chaveCanonicaRadarOferta(oferta = {}) {
  return identidadeCanonicaRadar(oferta).chaveCanonica || "";
}

function aplicarIdentidadeCanonicaRadar(oferta = {}) {
  const camposCanonicos = camposIdentidadeCanonicaOferta(oferta);
  if (!camposCanonicos.chaveCanonica) return oferta;

  return {
    ...oferta,
    ...camposCanonicos
  };
}

function logProdutoCanonicoRadar(oferta = {}) {
  const identidade = identidadeCanonicaRadar(oferta);
  if (!identidade.chaveCanonica) return;

  console.log("[RADAR-PRODUTO-CANONICO]", {
    origemDominio: identidade.origemDominio || origemDominioCanonicoOferta(oferta),
    marketplaceCanonico: identidade.marketplaceCanonico,
    produtoIdCanonico: identidade.produtoIdCanonico,
    chaveCanonica: identidade.chaveCanonica
  });
}

function logDuplicidadeCanonicaRadar({ oferta = {}, existente = {}, janela = "" } = {}) {
  const chaveCanonica = chaveCanonicaRadarOferta(oferta) || chaveCanonicaRadarOferta(existente);
  if (!chaveCanonica) return;

  console.log("[RADAR-DUPLICIDADE-CANONICA-BLOQUEADA]", {
    chaveCanonica,
    origemAtual: origemDominioCanonicoOferta(oferta),
    origemExistente: origemDominioCanonicoOferta(existente),
    janela
  });
}

function precoNumericoDuplicidadeRadar(oferta = {}) {
  return numeroMoedaOferta(
    oferta.precoAtual ||
    oferta.preco ||
    oferta.precoFinal ||
    oferta.valor ||
    oferta.precoPor ||
    ""
  );
}

function faixaPrecoDuplicidadeRadar(oferta = {}) {
  const preco = precoNumericoDuplicidadeRadar(oferta);
  if (!preco) return "";

  const tamanhoFaixa =
    preco <= 50 ? 5 :
    preco <= 200 ? 10 :
    preco <= 1000 ? 50 :
    100;

  return String(Math.floor(preco / tamanhoFaixa));
}

function dataMsDuplicidadeRadar(valor = "") {
  if (!valor) return 0;

  const direto = new Date(valor).getTime();
  if (Number.isFinite(direto)) return direto;

  const match = String(valor).match(
    /(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2})?:?(\d{1,2})?:?(\d{1,2})?/
  );

  if (!match) return 0;

  const [, dia, mes, ano, hora = "0", minuto = "0", segundo = "0"] = match;
  return new Date(
    Number(ano),
    Number(mes) - 1,
    Number(dia),
    Number(hora),
    Number(minuto),
    Number(segundo)
  ).getTime();
}

function itemFilaBloqueiaDuplicidadeRadar(item = {}) {
  const status = normalizarTexto(item.status || item.statusRadar || "");
  return [
    "pendente",
    "enviado",
    "enviada",
    "erro",
    "processando",
    "agendado",
    "agendada"
  ].includes(status);
}

function mesmoRegistroRadarDuplicidade(item = {}, oferta = {}) {
  const idsItem = [item.id, item._id, item.codigo, item.uuid].filter(Boolean).map(String);
  const idsOferta = [oferta.id, oferta._id, oferta.codigo, oferta.uuid].filter(Boolean).map(String);

  return idsItem.length > 0 && idsOferta.length > 0 && idsItem.some(id => idsOferta.includes(id));
}

function motivoDuplicidadeRadarItem(item = {}, oferta = {}, contexto = {}) {
  const linksNovos = contexto.linksNovos || linksDuplicidadeRadar(oferta);
  const tituloNovo = contexto.tituloNovo || normalizarTexto(oferta.titulo || oferta.nome || "");
  const marketplaceNovo = contexto.marketplaceNovo || normalizarMarketplaceRadar(oferta.marketplace || oferta.mercado || "");
  const faixaPrecoNova = contexto.faixaPrecoNova || faixaPrecoDuplicidadeRadar(oferta);
  const comparacaoCanonica = compararIdentidadeCanonicaOfertas(oferta, item);

  if (comparacaoCanonica.duplicada) {
    return comparacaoCanonica.motivo;
  }

  if (comparacaoCanonica.ambasCanonicas) {
    return "";
  }

  const linksExistentes = linksDuplicidadeRadar(item);
  if (linksNovos.some(link => linksExistentes.includes(link))) {
    return "mesmo_link";
  }

  const tituloExistente = normalizarTexto(item.titulo || item.nome || "");
  const marketplaceExistente = normalizarMarketplaceRadar(item.marketplace || item.mercado || "");
  const faixaPrecoExistente = faixaPrecoDuplicidadeRadar(item);

  if (
    tituloNovo &&
    tituloExistente &&
    tituloNovo === tituloExistente &&
    marketplaceNovo &&
    marketplaceExistente &&
    marketplaceNovo === marketplaceExistente &&
    faixaPrecoNova &&
    faixaPrecoExistente &&
    faixaPrecoNova === faixaPrecoExistente
  ) {
    return "mesmo_titulo_marketplace_faixa_preco";
  }

  return "";
}

function logDecisaoDuplicidadeRadar({
  clienteId = "admin",
  oferta = {},
  linkNormalizado = "",
  encontrouDuplicada = false,
  statusDuplicada = "",
  motivoDuplicidade = "",
  bloqueou = false
} = {}) {
  console.log("[RADAR-DUPLICIDADE-DECISAO]", {
    clienteId,
    titulo: oferta.titulo || oferta.nome || "",
    linkNormalizado,
    encontrouDuplicada,
    statusDuplicada,
    motivoDuplicidade,
    bloqueou
  });
}

function duplicidadeRadarNaFilaCliente(oferta = {}, clienteId = "admin") {
  const cliente = String(clienteId || "admin");
  const linksNovos = linksDuplicidadeRadar(oferta);
  const tituloNovo = normalizarTexto(oferta.titulo || oferta.nome || "");
  const marketplaceNovo = normalizarMarketplaceRadar(oferta.marketplace || oferta.mercado || "");
  const faixaPrecoNova = faixaPrecoDuplicidadeRadar(oferta);

  const contextoDuplicidade = {
    linksNovos,
    tituloNovo,
    marketplaceNovo,
    faixaPrecoNova
  };
  const linkNormalizado = linksNovos[0] || "";

  for (const item of fila) {
    if (String(item.clienteId || "admin") !== cliente) continue;
    if (mesmoRegistroRadarDuplicidade(item, oferta)) continue;

    const status = normalizarTexto(item.status || item.statusRadar || "");
    if (status !== "retida") continue;

    const motivoRetida = motivoDuplicidadeRadarItem(item, oferta, contextoDuplicidade);
    if (!motivoRetida) continue;

    console.log("[RADAR-DUPLICIDADE-RETIDA-IGNORADA]", {
      clienteId: cliente,
      titulo: item.titulo || item.nome || oferta.titulo || oferta.nome || "",
      link: item.linkOriginal || item.link || item.linkAfiliado || oferta.linkOriginal || oferta.link || "",
      statusAnterior: status,
      motivo: "retida_nao_bloqueia_duplicidade"
    });
  }

  const itensCliente = fila.filter(item =>
    String(item.clienteId || "admin") === cliente &&
    !mesmoRegistroRadarDuplicidade(item, oferta) &&
    itemFilaBloqueiaDuplicidadeRadar(item)
  );

  for (const item of itensCliente) {
    const motivoDuplicidade = motivoDuplicidadeRadarItem(item, oferta, contextoDuplicidade);

    if (motivoDuplicidade) {
      const statusDuplicada = normalizarTexto(item.status || item.statusRadar || "");
      if (motivoDuplicidade === "mesma_chave_canonica") {
        logDuplicidadeCanonicaRadar({
          oferta,
          existente: item,
          janela: statusDuplicada || "fila"
        });
      }
      logDecisaoDuplicidadeRadar({
        clienteId: cliente,
        oferta,
        linkNormalizado,
        encontrouDuplicada: true,
        statusDuplicada,
        motivoDuplicidade,
        bloqueou: true
      });
      return { duplicada: true, motivo: motivoDuplicidade, statusDuplicada, itemDuplicado: item };
    }
  }

  logDecisaoDuplicidadeRadar({
    clienteId: cliente,
    oferta,
    linkNormalizado,
    encontrouDuplicada: false,
    statusDuplicada: "",
    motivoDuplicidade: "",
    bloqueou: false
  });

  return { duplicada: false, motivo: "" };
}

function logRadarDuplicadaBloqueada(clienteId = "admin", oferta = {}, motivo = "") {
  console.log("[RADAR-DUPLICADA-BLOQUEADA]", {
    clienteId,
    titulo: oferta.titulo || oferta.nome || "",
    marketplace: oferta.marketplace || oferta.mercado || "",
    link: oferta.linkOriginal || oferta.link || oferta.linkAfiliado || "",
    motivo
  });
}

// ================= FILTROS UNIVERSAIS DE OFERTAS =================

function produtoSuspeito(oferta = {}) {
  const texto = normalizarTexto(`
    ${oferta.titulo || ""}
    ${oferta.nome || ""}
    ${oferta.descricao || ""}
    ${oferta.categoria || ""}
    ${oferta.marketplace || ""}
  `);

  const preco = Number(
    String(oferta.precoAtual || oferta.preco || "")
      .replace("R$", "")
      .replace(/\./g, "")
      .replace(",", ".")
      .trim()
  );

  const suspeitos = [
    "ssd externo 2026",
    "1tb 2tb 4tb",
    "alta velocidade original",
    "super capacidade",
    "expansao memoria",
    "cartao memoria 2tb",
    "pendrive 2tb",
    "disco rigido externo 4tb",
    "brand+",
    "sem marca",
    "generico",
    "unidade flash",
    "usb 3.0",
    "memoria expandida",
    "disco externo",
    "hd externo portatil",
    "armazenamento externo",
    "ssd externo",
    "expansao de memoria",
    "cartao tf",
    "micro sd 1tb",
   "micro sd 2tb",
   "pendrive usb",
   "flash drive",
   "super armazenamento",
   "armazenamento movel",
  ];

  if (suspeitos.some(p => texto.includes(normalizarTexto(p)))) {
    return true;
  }

  if (
    texto.includes("ssd") &&
    texto.includes("4tb") &&
    preco > 0 &&
    preco < 250
  ) {
    return true;
  }

  if (
    texto.includes("ssd") &&
    texto.includes("2tb") &&
    preco > 0 &&
    preco < 150
  ) {
    return true;
  }

  if (
    texto.includes("pendrive") &&
    texto.includes("2tb") &&
    preco > 0 &&
    preco < 100
  ) {
    return true;
  }

if (
  texto.includes("ssd") &&
  texto.includes("1tb") &&
  preco > 0 &&
  preco < 80
) {
  return true;
}

if (
  texto.includes("hd") &&
  texto.includes("16tb") &&
  preco > 0 &&
  preco < 400
) {
  return true;
}

if (
  texto.includes("hd") &&
  texto.includes("18tb") &&
  preco > 0 &&
  preco < 500
) {
  return true;
}

if (
  texto.includes("placa de video") &&
  preco > 0 &&
  preco < 250
) {
  return true;
}

return false;
}

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const qrcode = require("qrcode");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const app = express(); // 👈 MUITO IMPORTANTE ter isso

function capturarRawBody(req, res, buf) {
  if (buf && buf.length) req.rawBody = Buffer.from(buf);
}

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb", verify: capturarRawBody }));

function configurarRotaPublicaMidiaSocial() {
  const dir = String(process.env.SOCIAL_MEDIA_STORAGE_DIR || "").trim();
  if (!dir) return;

  const raiz = path.resolve(dir);
  app.use("/social/midia/publica", express.static(raiz, {
    dotfiles: "deny",
    fallthrough: false,
    index: false,
    immutable: true,
    maxAge: "30d",
    redirect: false,
    setHeaders(res) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    }
  }));

  console.log("[SOCIAL-MIDIA-PUBLICA]", {
    rota: "/social/midia/publica",
    storageConfigurado: true
  });
}

configurarRotaPublicaMidiaSocial();

const horarioInicio = 9;
const horarioFim = 23;


// ================= FUNÇÃO RODAR AGORA =================

function podeRodarAgora() {
  return true;
}

let ultimoEnvioFila = 0;

// =================== NÚCLEO GLOBAL DE OFERTAS ===================

function normalizarTexto(valor = "") {
  return String(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function detectarCategoriaGlobal(oferta = {}) {
  const texto = normalizarTexto(
    `${oferta.titulo || oferta.nome || ""} ${oferta.categoria || ""}`
  );

  for (const [categoria, buscas] of Object.entries(BUSCAS_GLOBAIS || {})) {
    const bate = buscas.some(termo => {
      const termoLimpo = normalizarTexto(termo)
        .replace("promocao", "")
        .replace("oferta", "")
        .trim();

      return termoLimpo && texto.includes(termoLimpo.split(" ")[0]);
    });

    if (bate) return categoria;
  }

  return oferta.categoria || "geral";
}

//================= FUNCAO REGISTRA CUPOM =======================

function registrarCupomAtivo(regra = {}) {
  console.log("[INFO] registrarCupomAtivo desativado");
  return false;
}

// ====================== FUNCAO PREPARA OFERTA GLOBAL =========================

function dataExpiracaoPrioridade(horas = 0) {
  if (!horas) return "";
  return new Date(Date.now() + horas * 60 * 60 * 1000).toISOString();
}

function numeroMoedaOferta(valor = "") {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;

  const texto = String(valor || "");
  const match = texto.match(/R\$\s*\d{1,6}(?:\.\d{3})*(?:[,.]\d{1,2})?|\d{1,6}(?:\.\d{3})*(?:[,.]\d{1,2})?/i);
  if (!match) return 0;

  const normalizado = match[0]
    .replace(/R\$/gi, "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : 0;
}

function extrairValorMonetarioCupomOferta(oferta = {}) {
  const campos = [
    oferta.valorCupom,
    oferta.cupomValor,
    oferta.cupom,
    oferta.avisoCupom,
    oferta.beneficioExtra,
    oferta.beneficioDetectado
  ];

  for (const campo of campos) {
    const texto = String(campo || "");
    const match = texto.match(/R\$\s*\d{1,6}(?:\.\d{3})*(?:[,.]\d{1,2})?/i);
    if (match) return numeroMoedaOferta(match[0]);
  }

  return 0;
}

function adicionarAvisoInternoOferta(oferta = {}, aviso = "") {
  if (!aviso) return oferta;

  const atuais = Array.isArray(oferta.avisosInternos)
    ? oferta.avisosInternos
    : oferta.avisosInternos
      ? [oferta.avisosInternos]
      : [];

  if (!atuais.includes(aviso)) atuais.push(aviso);
  oferta.avisosInternos = atuais;
  return oferta;
}

function campoTemCupomMonetario(valor = "") {
  return /R\$\s*\d{1,6}(?:\.\d{3})*(?:[,.]\d{1,2})?/i.test(String(valor || ""));
}

function limparCupomMonetarioOferta(oferta = {}) {
  if (campoTemCupomMonetario(oferta.cupom)) oferta.cupom = "";
  if (campoTemCupomMonetario(oferta.avisoCupom)) oferta.avisoCupom = "";
  if (campoTemCupomMonetario(oferta.beneficioExtra)) oferta.beneficioExtra = "";
  if (campoTemCupomMonetario(oferta.beneficioDetectado)) oferta.beneficioDetectado = "";

  oferta.valorCupom = "";
  oferta.cupomValor = "";
  oferta.cupomConfirmado = false;
  oferta.cupomValidado = false;
  oferta.cupomDetectado = false;
  oferta.cupomDetectadoTexto = false;
  oferta.possivelCupom = false;
  oferta.cupomTipo = "nenhum";

  return oferta;
}

function validarCupomMonetarioOferta(oferta = {}) {
  if (!oferta || typeof oferta !== "object") return oferta;

  const preco = numeroMoedaOferta(oferta.precoAtual || oferta.preco || oferta.valor || "");
  const valorCupom = extrairValorMonetarioCupomOferta(oferta);
  const ehRadar =
    String(oferta.origem || "").toLowerCase() === "radar" ||
    oferta.radar === true ||
    oferta.radarNaFila === true;

  if (!preco || !valorCupom) return oferta;

  if (valorCupom > preco) {
    limparCupomMonetarioOferta(oferta);
    oferta.cupomSuspeito = true;
    oferta.cupomMonetarioIncompativel = true;
    adicionarAvisoInternoOferta(oferta, "cupom_monetario_incompativel_com_preco");

    if (ehRadar) {
      delete oferta.prioridadeEnvio;
      delete oferta.motivoPrioridade;
      delete oferta.prioridadeFila;
    }

    console.log("[CUPOM] monetario incompativel removido", {
      titulo: oferta.titulo || oferta.nome || "",
      preco,
      valorCupom
    });

    return oferta;
  }

  if (valorCupom >= preco * 0.7) {
    oferta.cupomSuspeito = true;
    oferta.cupomConfirmado = false;
    oferta.cupomValidado = false;
    adicionarAvisoInternoOferta(oferta, "cupom_monetario_suspeito_70_pct_preco");

    if (ehRadar) {
      oferta.cupomDetectado = false;
      if (oferta.cupomTipo === "real" || oferta.cupomTipo === "detectado" || oferta.cupomTipo === "provavel") {
        oferta.cupomTipo = "suspeito";
      }
      delete oferta.prioridadeEnvio;
      delete oferta.motivoPrioridade;
      delete oferta.prioridadeFila;
    }

    console.log("[CUPOM] monetario suspeito", {
      titulo: oferta.titulo || oferta.nome || "",
      preco,
      valorCupom
    });
  }

  return oferta;
}

function aplicarPrioridadeEnvioOferta(oferta = {}) {
  if (!oferta || typeof oferta !== "object") return oferta;

  if (oferta.prioridadeEnvio !== undefined && oferta.motivoPrioridade) {
    return oferta;
  }

  const origem = String(oferta.origem || "").toLowerCase();
  const ehRadar = origem === "radar" || oferta.radar === true || oferta.radarNaFila === true;
  const cupomSuspeito = oferta.cupomSuspeito === true || oferta.cupomMonetarioIncompativel === true;

  const cupomTexto = String(oferta.cupom || "").trim().toUpperCase();
  const cupomFake = ["COPIADO", "APPLIED", "APPEARANCE", "APPLINK", "SEM CUPOM"].includes(cupomTexto);

  if (cupomFake) {
  oferta.cupom = "";
  }

  const cupomReal = !cupomSuspeito && (
    oferta.cupomConfirmado === true ||
    oferta.cupomValidado === true ||
    oferta.cupomTipo === "real" ||
    oferta.tipoCupom === "real"
  );
  const cupomDetectado = !cupomSuspeito && Boolean(
    (!cupomFake && oferta.cupom) ||
    oferta.cupomDetectado === true ||
    oferta.cupomDetectadoTexto === true
  );
  const cupomProvavel = !cupomSuspeito && Boolean(
    oferta.possivelCupom ||
    oferta.beneficioExtra ||
    oferta.linkResgateCupom
  );
  const ehManualEscolhida =
    !ehRadar &&
    (
      oferta.manual === true ||
      origem === "manual" ||
      origem.startsWith("manual-") ||
      oferta.origemManual === true
    );

  if (ehRadar) {
    const scoreAlto = Number(oferta.radarScore || oferta.score || 0) >= 60;

    oferta.origem = "radar";

    if (cupomReal) {
      oferta.prioridadeEnvio = 110;
      oferta.cupomTipo = "real";
      oferta.cupomDetectado = true;
      oferta.expiraEm = oferta.expiraEm || dataExpiracaoPrioridade(4);
      oferta.motivoPrioridade = "Cupom real detectado pelo Radar";
      return oferta;
    }

    if (cupomDetectado) {
      oferta.prioridadeEnvio = 95;
      oferta.cupomTipo = "detectado";
      oferta.cupomDetectado = true;
      oferta.expiraEm = oferta.expiraEm || dataExpiracaoPrioridade(4);
      oferta.motivoPrioridade = "Cupom detectado pelo Radar";
      return oferta;
    }

    if (cupomProvavel) {
      oferta.prioridadeEnvio = 80;
      oferta.cupomTipo = "provavel";
      oferta.cupomDetectado = true;
      oferta.expiraEm = oferta.expiraEm || dataExpiracaoPrioridade(3);
      oferta.motivoPrioridade = "Cupom provável detectado pelo Radar";
      return oferta;
    }

    oferta.prioridadeEnvio = scoreAlto ? 60 : 40;
    oferta.cupomTipo = "nenhum";
    oferta.cupomDetectado = false;
    oferta.expiraEm = oferta.expiraEm || (scoreAlto ? dataExpiracaoPrioridade(8) : "");
    oferta.motivoPrioridade = scoreAlto
      ? "Oferta Radar com score alto"
      : "Oferta comum";
    return oferta;
  }

  if (ehManualEscolhida) {
    oferta.origem = "manual";
    oferta.prioridadeEnvio = 100;
    oferta.cupomTipo = oferta.cupom ? "detectado" : "nenhum";
    oferta.cupomDetectado = Boolean(oferta.cupom);
    oferta.motivoPrioridade = "Oferta escolhida manualmente pelo usuário";
    return oferta;
  }

  if (cupomReal) {
    oferta.origem = oferta.origem || "farejador";
    oferta.prioridadeEnvio = 110;
    oferta.cupomTipo = "real";
    oferta.cupomDetectado = true;
    oferta.expiraEm = oferta.expiraEm || dataExpiracaoPrioridade(4);
    oferta.motivoPrioridade = "Cupom real detectado";
    return oferta;
  }

  if (cupomDetectado) {
    oferta.origem = oferta.origem || "farejador";
    oferta.prioridadeEnvio = 95;
    oferta.cupomTipo = "detectado";
    oferta.cupomDetectado = true;
    oferta.expiraEm = oferta.expiraEm || dataExpiracaoPrioridade(4);
    oferta.motivoPrioridade = "Cupom detectado";
    return oferta;
  }

  if (cupomProvavel) {
    oferta.origem = oferta.origem || "farejador";
    oferta.prioridadeEnvio = 80;
    oferta.cupomTipo = "provavel";
    oferta.cupomDetectado = true;
    oferta.expiraEm = oferta.expiraEm || dataExpiracaoPrioridade(3);
    oferta.motivoPrioridade = "Cupom provável detectado";
    return oferta;
  }

  oferta.origem = oferta.origem || "farejador";
  oferta.prioridadeEnvio = 40;
  oferta.cupomTipo = "nenhum";
  oferta.cupomDetectado = false;
  oferta.motivoPrioridade = "Oferta comum";
  return oferta;
}

function logPrioridadeFila(oferta = {}) {
  console.log("🧠 PRIORIDADE FILA:", {
    titulo: oferta.titulo || oferta.nome || "",
    origem: oferta.origem || "",
    cupomTipo: oferta.cupomTipo || "",
    prioridadeEnvio: prioridadeEnvioOferta(oferta),
    motivoPrioridade: oferta.motivoPrioridade || ""
  });
}

function prepararOfertaGlobal(oferta = {}) {

if (!oferta.id) {
    oferta.id = `oferta_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  if (!oferta) return oferta;

  oferta.titulo = oferta.titulo || oferta.nome || "Oferta";
  oferta.nome = oferta.nome || oferta.titulo;

  oferta.marketplace = normalizarTexto(oferta.marketplace || "geral");

const categoriaNormalizada = normalizarTexto(oferta.categoria || "");

if (
  !oferta.categoria ||
  ["aliexpress", "amazon", "shopee", "mercadolivre", "magalu", "awin", "kabum"].includes(categoriaNormalizada) ||
  categoriaNormalizada.includes("computador") ||
  categoriaNormalizada.includes("escritorio") ||
  categoriaNormalizada.includes("escritório")
) {
  oferta.categoria = classificarCategoriaOferta(oferta);
}

  const agoraBR = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });

  oferta.criadoEm = oferta.criadoEm || agoraBR;
  oferta.dataEntradaFila = oferta.dataEntradaFila || agoraBR;

  oferta.status = oferta.status || "pendente";
  oferta.statusDetalhe = oferta.statusDetalhe || "Aguardando envio";
  oferta.destinosEnviados = oferta.destinosEnviados || [];
  oferta.logsEnvio = oferta.logsEnvio || [];
  oferta.erro = oferta.erro || "";
  oferta.erroEm = oferta.erroEm || "";
  oferta.dataEntradaFila = oferta.dataEntradaFila || agoraBR;

  // oferta = aplicarCupomAutomatico(oferta); // cupom antigo desativado

oferta.precoAtual = oferta.precoAtual || oferta.preco || "";
oferta.preco = oferta.preco || oferta.precoAtual || "";

oferta.avisoPagamento = oferta.avisoPagamento || "";
oferta.parcelamento = oferta.parcelamento || "";
oferta.avisoCupom = oferta.avisoCupom || "";

  validarCupomMonetarioOferta(oferta);
  aplicarPrioridadeEnvioOferta(oferta);

  return oferta;
}

// ================= HELPERS DESTINOS INTELIGENTES =================

function normalizarTexto(valor = "") {
  return String(valor || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "e")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

// ================= HELPERS DESTINOS INTELIGENTES =================

function normalizarDestino(valor = "") {
  return destinosUtils.normalizarDestino(valor);
}


function normalizarCategoriaDestino(valor = "") {
  return destinosUtils.normalizarCategoriaDestino(valor);
}


// ====================== FUNCAO DESTINO ACEITA OFERTAS =========================

function destinoAceitaOferta(destino, oferta) {
  return destinosUtils.destinoAceitaOferta(destino, oferta, {
    classificarCategoriaOferta,
    logger: console
  });

}

function analisarDestinoOferta(destino, oferta) {
  return destinosUtils.analisarDestinoOferta(destino, oferta, {
    classificarCategoriaOferta,
    logger: console
  });
}

function obterDestinosInteligentesCliente(clienteId = "admin", configCliente = {}) {
  return Array.isArray(destinosPorCliente?.[clienteId]) && destinosPorCliente[clienteId].length
    ? destinosPorCliente[clienteId]
    : Array.isArray(configCliente?.destinosInteligentes) && configCliente.destinosInteligentes.length
      ? configCliente.destinosInteligentes
      : Array.isArray(config?.destinosInteligentes)
        ? config.destinosInteligentes
        : [];
}

function motivoRetencaoSemDestino(analises = []) {
  if (!analises.length) return "retida_sem_destino_compativel";

  const motivos = analises.map(item => item?.analise?.motivo || "").filter(Boolean);

  if (motivos.length && motivos.every(motivo => motivo === "categoria")) {
    return "retida_categoria_nao_marcada";
  }

  if (motivos.length && motivos.every(motivo => motivo === "marketplace")) {
    return "retida_marketplace_nao_marcado";
  }

  return "retida_sem_destino_compativel";
}

function marcarOfertaRetida(oferta = {}, motivoRetencao = "retida_sem_destino_compativel") {
  oferta.status = "retida";
  oferta.statusDetalhe = "Retida por falta de destino compatível.";
  oferta.motivoRetencao = motivoRetencao;
  oferta.retidaEm = new Date().toISOString();
  oferta.erro = "";
  oferta.erroEm = "";
  delete oferta.proximaTentativaEnvioEm;

  return oferta;
}

function ofertaEhShopee(oferta = {}) {
  return normalizarTexto(oferta.marketplace || oferta.mercado || "") === "shopee";
}

function ofertaEhRadar(oferta = {}) {
  return (
    normalizarTexto(oferta.origem || "") === "radar" ||
    oferta.radar === true ||
    oferta.radarNaFila === true
  );
}

function ofertaTemCupomRealOuDetectado(oferta = {}) {
  const cupomTexto = String(oferta.cupom || "").trim();
  const cupomTipo = normalizarTexto(oferta.cupomTipo || oferta.tipoCupom || "");
  const cupomFake = ["copiado", "cupomcopiado", "semcupom", "applied", "appearance", "applink"].includes(normalizarTexto(cupomTexto));

  return Boolean(
    !cupomFake &&
    (
      cupomTexto ||
      oferta.cupomConfirmado === true ||
      oferta.cupomValidado === true ||
      oferta.cupomDetectado === true ||
      oferta.cupomDetectadoTexto === true ||
      cupomTipo === "real" ||
      cupomTipo === "detectado"
    )
  );
}

function precoShopeeAparentaCentavosBruto(oferta = {}) {
  const preco = numeroMoedaOferta(oferta.precoAtual || oferta.preco || oferta.valor || "");
  if (!Number.isFinite(preco) || preco < 1000) return false;

  const textoPreco = String(oferta.precoAtual || oferta.preco || "").trim();
  const terminaComCentavosZero = /(?:,|\.)00$/.test(textoPreco);
  const inteiro = Math.abs(preco - Math.round(preco)) < 0.001;
  const priceMinOriginal = Number(oferta.priceMinOriginal ?? oferta.priceMin ?? oferta.precoMinOriginal ?? 0);
  const priceMaxOriginal = Number(oferta.priceMaxOriginal ?? oferta.priceMax ?? oferta.precoMaxOriginal ?? 0);
  const originalInteiroAlto = [priceMinOriginal, priceMaxOriginal].some(valor =>
    Number.isFinite(valor) && valor >= 1000 && Math.abs(valor - Math.round(valor)) < 0.001
  );

  return inteiro && (terminaComCentavosZero || originalInteiroAlto);
}

function diagnosticoPrecoShopee(oferta = {}) {
  return {
    titulo: oferta.titulo || oferta.nome || "",
    precoAntesGlobal: oferta.precoAntesGlobal || "",
    precoDepoisGlobal: oferta.precoDepoisGlobal || oferta.precoAtual || oferta.preco || "",
    precoFinalFila: oferta.precoAtual || oferta.preco || "",
    priceMinOriginal: oferta.priceMinOriginal ?? oferta.priceMin ?? oferta.precoMinOriginal ?? "",
    priceMaxOriginal: oferta.priceMaxOriginal ?? oferta.priceMax ?? oferta.precoMaxOriginal ?? ""
  };
}

function reterShopeePrecoSuspeitoSeNecessario(oferta = {}) {
  if (!ofertaEhShopee(oferta)) return false;

  const diagnostico = diagnosticoPrecoShopee(oferta);
  console.log("[SHOPEE-PRECO-DEBUG]", diagnostico);

  if (
    ofertaEhRadar(oferta) ||
    ofertaTemCupomRealOuDetectado(oferta) ||
    !precoShopeeAparentaCentavosBruto(oferta)
  ) {
    return false;
  }

  marcarOfertaRetida(oferta, "retida_preco_shopee_suspeito");
  oferta.statusDetalhe = "Retida por preco Shopee suspeito";
  adicionarAvisoInternoOferta(oferta, "retida_preco_shopee_suspeito");

  console.log("[SHOPEE-PRECO-SUSPEITO]", {
    ...diagnostico,
    marketplace: oferta.marketplace || "",
    categoria: oferta.categoria || "",
    origem: oferta.origem || "",
    motivoRetencao: oferta.motivoRetencao
  });

  return true;
}

function analisarDestinosCompativeisFila(clienteId = "admin", oferta = {}, configCliente = {}) {
  const destinosInteligentes = obterDestinosInteligentesCliente(clienteId, configCliente);
  const compativeis = [];
  const rejeitados = [];

  for (const destino of destinosInteligentes) {
    const analise = analisarDestinoOferta(destino, oferta);

    if (analise.aceita) {
      compativeis.push({ destino, analise });
    } else {
      rejeitados.push({ destino, analise });
    }
  }

  return {
    destinosInteligentes,
    compativeis,
    rejeitados,
    motivoRetencao: motivoRetencaoSemDestino(rejeitados)
  };
}


// ========== FUNCAO DESTINO DENTRO HORARIO ==================

function destinoDentroHorario(destino = {}) {
  return destinosUtils.destinoDentroHorario(destino);
}

function destinoNomeLog(destino = {}) {
  return String(destino.nome || destino.titulo || destino.label || destino.id || destino.conexaoId || "Destino");
}

function categoriasDestinoDebug(destino = {}) {
  const categorias = destino.categorias || destino.categoriasPermitidas || [];
  return Array.isArray(categorias) ? categorias : [];
}

function destinoSessaoOkDebug(clienteId = "admin", destino = {}) {
  const canal = String(destino.tipo || "").toLowerCase();

  if (canal === "whatsapp") {
    const conexaoId = destino.conexaoId || "";
    const status = statusSessao[conexaoId];
    return Boolean(conexaoId && sessoes[conexaoId] && (!status || status === "open" || status === "aberto"));
  }

  if (canal === "telegram") {
    try {
      const telegrams = listarTelegramsCliente(clienteId).map(normalizarTelegramFila);
      const idsSelecionados = idsTelegramDestinoFila(destino);
      const telegramsDiretos = telegramsDiretosDestinoFila(destino);
      const selecionados = idsSelecionados.length
        ? telegrams.filter(t => idsSelecionados.some(id => t.chaves.includes(id)))
        : telegrams.filter(t => t.ativo);

      return [...telegramsDiretos, ...selecionados].some(t => t.ativo && t.botToken && t.chatId);
    } catch {
      return false;
    }
  }

  return false;
}

function logEnvioDestinoDebug(dados = {}) {
  const destino = dados.destino || {};
  const oferta = dados.oferta || {};
  const analise = dados.analise || analisarDestinoOferta(destino, oferta);

  console.log("[ENVIO-DESTINO-DEBUG]", {
    clienteId: dados.clienteId || oferta.clienteId || "admin",
    ofertaTitulo: oferta.titulo || oferta.nome || "",
    marketplace: oferta.marketplace || oferta.mercado || "",
    categoriaOferta: oferta.categoria || oferta.categoriaProduto || "",
    destinosAtivosTotal: Number(dados.destinosAtivosTotal || 0),
    destinosCompativeis: Number(dados.destinosCompativeis || 0),
    destinosTentados: Number(dados.destinosTentados || 0),
    destinoNome: destinoNomeLog(destino),
    canal: destino.tipo || "",
    categoriasDestino: categoriasDestinoDebug(destino),
    dentroHorario: dados.dentroHorario === undefined ? destinoDentroHorario(destino) : Boolean(dados.dentroHorario),
    automacaoAtiva: Boolean(config.automacaoAtiva),
    sessaoOk: dados.sessaoOk === undefined ? destinoSessaoOkDebug(dados.clienteId || oferta.clienteId || "admin", destino) : Boolean(dados.sessaoOk),
    enviado: Boolean(dados.enviado),
    erro: dados.erro || analise.motivo || ""
  });
}

function sessaoStatusDestinosDiagnostico(clienteId = "admin", itens = []) {
  return (Array.isArray(itens) ? itens : []).map(item => {
    const destino = item?.destino || item || {};
    const canal = String(destino.tipo || "").toLowerCase();

    if (canal === "whatsapp") {
      const conexaoId = destino.conexaoId || "";
      return {
        destino: destinoNomeLog(destino),
        canal,
        status: statusSessao[conexaoId] || (sessoes[conexaoId] ? "conectada" : "ausente")
      };
    }

    if (canal === "telegram") {
      return {
        destino: destinoNomeLog(destino),
        canal,
        status: destinoSessaoOkDebug(clienteId, destino) ? "ativo" : "inativo_ou_incompleto"
      };
    }

    return { destino: destinoNomeLog(destino), canal: canal || "desconhecido", status: "nao_suportado" };
  });
}

function logExecutorDestinoDiagnostico({
  oferta = {},
  clienteId = "admin",
  destinosElegiveis = [],
  destinosTentados = 0,
  motivoSemEnvio = "",
  dentroJanela = false,
  statusFinal = ""
} = {}) {
  console.log("[EXECUTOR-DESTINO-DIAGNOSTICO]", JSON.stringify({
    ofertaId: oferta.id || oferta.engineOfertaId || "",
    categoria: oferta.categoria || oferta.categoriaProduto || "",
    marketplace: oferta.marketplace || oferta.mercado || "",
    destinosElegiveis: Array.isArray(destinosElegiveis) ? destinosElegiveis.length : Number(destinosElegiveis || 0),
    destinosTentados: Number(destinosTentados || 0),
    motivoSemEnvio: motivoSemEnvio || "",
    dentroJanela: Boolean(dentroJanela),
    sessaoStatus: sessaoStatusDestinosDiagnostico(clienteId, destinosElegiveis),
    statusFinal: statusFinal || oferta.status || ""
  }));
}

function destinoChaveControle(clienteId = "admin", destino = {}) {
  return `${clienteId}_${destino.id || destino.nome || destino.conexaoId || destino.chatId || "destino"}`;
}

function limiteDiarioDestino(destino = {}) {
  const limite = Number(
    destino.limiteDiario ??
    destino.limiteDiarioEnvios ??
    destino.maximoDiario ??
    destino.maxPorDia ??
    destino.maxEnviosDia ??
    destino.enviosPorDia ??
    0
  );

  return Number.isFinite(limite) && limite > 0 ? limite : 0;
}

function dataBRHoje() {
  return new Date().toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });
}

function contarEnviosDestinoHoje(clienteId = "admin", destino = {}) {
  const hoje = dataBRHoje();
  const nomeDestino = destinoNomeLog(destino);
  const idDestino = String(destino.id || destino.conexaoId || destino.chatId || "");

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

function destinoLimiteDiarioDisponivel(clienteId = "admin", destino = {}) {
  const limite = limiteDiarioDestino(destino);
  if (!limite) return { ok: true, limite: 0, usados: 0 };

  const usados = contarEnviosDestinoHoje(clienteId, destino);
  return {
    ok: usados < limite,
    limite,
    usados
  };
}

function intervaloTurboCupomMinutos(oferta = {}) {
  return cupomFastLaneTipo(oferta) === "real_detectado" ? 3 : null;
}

function resolverIntervaloConfiguradoDestino(destino = {}, configCliente = {}) {
  return (
    numeroIntervaloValido(destino.intervaloMinutos) ||
    numeroIntervaloValido(destino.intervalo) ||
    numeroIntervaloValido(configCliente.intervaloMinutos) ||
    numeroIntervaloValido(configCliente.intervaloEnvioMinutos) ||
    numeroIntervaloValido(config.intervaloEnvioMinutos) ||
    5
  );
}

function payloadIntervaloDestino(clienteId = "admin", destino = {}, oferta = {}, intervalo = {}, extras = {}) {
  return {
    clienteId,
    destinoId: destinoIdIntervalo(destino),
    canal: canalDestinoIntervalo(destino),
    ofertaId: oferta.id || oferta.ofertaId || oferta.engineOfertaId || "",
    ofertaTemCupomReal: intervalo.ofertaTemCupomReal === true,
    prioridadeCupomAtiva: intervalo.prioridadeCupomAtiva === true,
    intervaloConfigurado: intervalo.intervaloDestinoMin,
    intervaloAplicado: intervalo.intervaloAplicadoMin,
    ultimoEnvioEm: dataIsoIntervalo(intervalo.ultimoEnvio),
    proximoEnvioPermitidoEm: intervalo.proximoEnvioPermitidoEm || "",
    tentativaEm: intervalo.tentativaEm || new Date().toISOString(),
    permitido: intervalo.liberado === true,
    motivo: intervalo.motivo || "",
    ...extras
  };
}

function intervaloDestinoInfo(clienteId = "admin", destino = {}, configCliente = {}, oferta = {}) {
  const chaveControle = destinoChaveControle(clienteId, destino);
  const intervaloDestinoMin = resolverIntervaloConfiguradoDestino(destino, configCliente);
  const prioridadeCupomAtiva = destino.prioridadeCupomAtiva === true;
  const agora = Date.now();
  const ofertaTemCupomReal = cupomFastLaneTipo(oferta, agora) === "real_detectado";
  const turboCupomMin = prioridadeCupomAtiva && ofertaTemCupomReal
    ? intervaloTurboCupomMinutos(oferta)
    : null;
  const intervaloAplicadoMin = Number.isFinite(turboCupomMin)
    ? Math.max(3, turboCupomMin)
    : intervaloDestinoMin;
  const intervaloMs = Math.max(0, intervaloAplicadoMin) * 60 * 1000;
  const controleCliente = controleIntervaloCliente(clienteId);
  const controlePersistido = controleCliente[chaveControle] || {};
  const ultimoEnvioPersistido = timestampIntervalo(controlePersistido.ultimoEnvioEm);
  const ultimoEnvio = Math.max(Number(controleEnvio[chaveControle] || 0), ultimoEnvioPersistido);
  const restanteMs = Math.max(0, intervaloMs - (agora - ultimoEnvio));
  const proximoEnvioPermitidoEm = ultimoEnvio
    ? dataIsoIntervalo(ultimoEnvio + intervaloMs)
    : "";
  const tentativaEm = new Date(agora).toISOString();
  const motivo = restanteMs <= 0
    ? (ultimoEnvio ? "intervalo_cumprido" : "sem_envio_anterior")
    : "intervalo_aguardando";

  const info = {
    chaveControle,
    intervaloDestinoMin,
    intervaloAplicadoMin,
    turboCupomMin,
    fastLaneCupomTipo: cupomFastLaneTipo(oferta, agora),
    ofertaTemCupomReal,
    prioridadeCupomAtiva,
    intervaloMs,
    ultimoEnvio,
    liberado: restanteMs <= 0,
    restanteMs,
    proximoEnvioPermitidoEm,
    tentativaEm,
    motivo
  };

  logFilaIntervalo("[FILA-INTERVALO-AVALIADO]", payloadIntervaloDestino(clienteId, destino, oferta, info));

  if (prioridadeCupomAtiva && ofertaTemCupomReal) {
    logFilaIntervalo("[FILA-CUPOM-INTERVALO-MINIMO]", payloadIntervaloDestino(clienteId, destino, oferta, info, {
      minimoMinutos: 3
    }));
  }

  return info;
}

function proximaTentativaDestino(oferta, ms = 5 * 60 * 1000) {
  oferta.proximaTentativaEnvioEm = new Date(Date.now() + ms).toISOString();
}

function atualizarUltimoEnvioDestino(clienteId = "admin", destino = {}, oferta = {}, intervalo = {}) {
  const agora = Date.now();
  const chaveControle = intervalo.chaveControle || destinoChaveControle(clienteId, destino);
  const intervaloAplicadoMinutos = Number(intervalo.intervaloAplicadoMin || 5);
  const proximoMs = agora + Math.max(0, intervaloAplicadoMinutos) * 60 * 1000;
  const registro = {
    clienteId,
    destinoId: destinoIdIntervalo(destino),
    canal: canalDestinoIntervalo(destino),
    ultimoEnvioEm: dataIsoIntervalo(agora),
    proximoEnvioPermitidoEm: dataIsoIntervalo(proximoMs),
    ultimoTipoOferta: intervalo.ofertaTemCupomReal ? "cupom" : "comum",
    intervaloConfiguradoMinutos: intervalo.intervaloDestinoMin,
    intervaloAplicadoMinutos,
    prioridadeCupomAtiva: intervalo.prioridadeCupomAtiva === true,
    atualizadoEm: dataIsoIntervalo(agora)
  };

  controleEnvio[chaveControle] = agora;
  controleIntervaloCliente(clienteId)[chaveControle] = registro;
  salvarControleIntervaloCliente(clienteId);

  logFilaIntervalo("[FILA-ULTIMO-ENVIO-ATUALIZADO]", payloadIntervaloDestino(clienteId, destino, oferta, {
    ...intervalo,
    ultimoEnvio: agora,
    proximoEnvioPermitidoEm: registro.proximoEnvioPermitidoEm,
    tentativaEm: registro.atualizadoEm,
    liberado: true,
    motivo: "envio_confirmado"
  }));
}

// ========================== ENVIO DESTINO INTELIGENTE ============================

async function enviarParaDestinoInteligente(destino, oferta, mensagem, clienteId, configCliente, opcoes = {}) {
  let tentouEnvio = false;
  let confirmouEnvio = false;

  try {
    clienteId = String(clienteId || oferta.clienteId || "").trim();
    if (!clienteId) return { enviado: false, tentouEnvio: false, motivo: "clienteId_ausente" };
    configCliente = configCliente || configsPorCliente?.[clienteId] || {};

    if (
      normalizarMarketplaceRadar(oferta.marketplace || oferta.mercado || "") === "mercadolivre" &&
      normalizarTexto(oferta.origem || oferta.fonte || "") === "radar"
    ) {
      logRadarMlImagemDebug({
        clienteId,
        oferta,
        linkOriginal: oferta.linkOriginal || oferta.linkOriginalRadar || "",
        linkResolvido: oferta.linkResolvido || oferta.linkResolvidoRadar || "",
        imagemImportador: imagemOfertaRadar(oferta),
        imagemOfertaRadar: imagemOfertaRadar(oferta),
        imagemFila: oferta.imagem || ""
      });
    }

    if (!destinoAceitaOferta(destino, oferta)) {
      return { enviado: false, tentouEnvio: false, motivo: "nao_aceita" };
    }

    if (!opcoes.ignorarHorario && !destinoDentroHorario(destino)) {
      logOptimus("DESTINO", "Fora do horario", {
        destino: destino.nome
      });
      return { enviado: false, tentouEnvio: false, motivo: "fora_horario" };
    }


// =========================== WHATSAPP ================================

if (String(destino.tipo || "").toLowerCase() === "whatsapp") {
  const sock = sessoes[destino.conexaoId];
  const statusWhatsapp = statusSessao[destino.conexaoId];

  if (!sock) {
    logOptimus("WHATSAPP", "Sessao nao encontrada", {
      conexaoId: destino.conexaoId
    });
    return { enviado: false, tentouEnvio: false, motivo: "sessao_nao_encontrada" };
  }

  if (statusWhatsapp && !["open", "aberto"].includes(statusWhatsapp)) {
    logOptimus("WHATSAPP", "Sessao indisponivel", {
      conexaoId: destino.conexaoId,
      status: statusWhatsapp
    });
    return { enviado: false, tentouEnvio: false, motivo: "sessao_offline" };
  }

  const grupos = (destino.gruposWhatsapp || [])
    .map(g => {
      if (!g) return null;
      if (typeof g === "string") return g;
      return g.id || g.value || g.grupoId || null;
    })
    .filter(Boolean);

  if (!grupos.length) {
    logOptimus("WHATSAPP", "Destino sem grupos validos", {
      destino: destino.nome
    });
    return { enviado: false, tentouEnvio: false, motivo: "sem_grupos" };
  }

  for (const grupo of grupos) {
    if (!usuarioTemCreditos(clienteId, 1)) {
      logOptimus("AVISO", "Sem creditos", { clienteId });
      return { enviado: false, tentouEnvio: false, motivo: "sem_creditos" };
    }

    console.log("[EXECUTOR-IMAGEM-AUDITORIA]", {


      canal: "whatsapp",


      clienteId,


      destino: destino.nome || destino.id || "",


      tipoMidia: destino.tipoMidia || "",


      ofertaId: oferta.id || "",


      engineOfertaId: oferta.engineOfertaId || "",


      marketplace: oferta.marketplace || "",


      temImagem: Boolean(oferta.imagem),


      imagemPreview: String(oferta.imagem || "").slice(0, 140),


      vaiEnviarImagem: destino.tipoMidia !== "texto" && Boolean(oferta.imagem)


    });


    tentouEnvio = true;
    if (destino.tipoMidia === "texto" || !oferta.imagem) {
      await sock.sendMessage(grupo, { text: mensagem });
    } else {
      await sock.sendMessage(grupo, {
        image: {
          url: corrigirImagemUrl(oferta.imagem) || oferta.imagem
        },
        caption: mensagem
      });
    }

    confirmouEnvio = true;
    debitarCreditos(clienteId, 1);

    logOptimus("WHATSAPP", "Mensagem enviada", {
      clienteId,
      destino: destino.nome,
      grupo
    });

    oferta.destinosEnviados = oferta.destinosEnviados || [];
    oferta.destinosEnviados.push({
      clienteId,
      id: destino.id || "",
      destinoId: destino.id || "",
      conexaoId: destino.conexaoId || "",
      nome: destino.nome || "Destino",
      tipo: "whatsapp",
      grupo,
      creditos: 1,
      dataEnvio: new Date().toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo"
      })
    });

    await new Promise(r => setTimeout(r, 3000));
  }

  return { enviado: true, tentouEnvio: true };
}


    // ================= ENVIO TELEGRAM =================

    if (String(destino.tipo || "").toLowerCase() === "telegram") {
      const telegrams = listarTelegramsCliente(clienteId).map(normalizarTelegramFila);
      const idsSelecionados = idsTelegramDestinoFila(destino);
      const telegramsDiretos = telegramsDiretosDestinoFila(destino);

      let selecionados = idsSelecionados.length
        ? telegrams.filter(t => idsSelecionados.some(id => t.chaves.includes(id)))
        : telegrams.filter(t => t.ativo);

      if (telegramsDiretos.length) {
        selecionados = [...telegramsDiretos, ...selecionados];
      }

      if (!selecionados.length && telegrams.length === 1) {
        selecionados = telegrams.filter(t => t.ativo);
      }

      const vistosTelegram = new Set();
      selecionados = selecionados.filter(t => {
        const chave = `${t.botToken || ""}:${t.chatId || ""}`;
        if (vistosTelegram.has(chave)) return false;
        vistosTelegram.add(chave);
        return true;
      });

      if (!selecionados.length) {
        logOptimus("TELEGRAM", "Nenhum destino selecionado", {
          clienteId,
          destino: destino.nome
        });

        logFilaTelegramDebug({
          clienteId,
          ofertaId: oferta.id || "",
          destinoId: destino.id || destino.destinoId || destino.chatId || "",
          destinoNome: destino.nome || "Destino",
          tipo: destino.tipo || "telegram",
          compativel: true,
          motivoFiltro: "nenhum_telegram_selecionado",
          temBotToken: false,
          temChatId: false,
          vaiEnviar: false,
          resultado: "ignorado"
        });

        return { enviado: false, tentouEnvio: false, motivo: "nenhum_telegram_selecionado" };
      }

      let telegramEnviado = false;

      for (const tel of selecionados) {
        const temBotToken = Boolean(tel.botToken);
        const temChatId = Boolean(tel.chatId);

        if (!tel.ativo) {
          logFilaTelegramDebug({
            clienteId,
            ofertaId: oferta.id || "",
            destinoId: destino.id || destino.destinoId || tel.chatId || "",
            destinoNome: destino.nome || tel.nome || "Telegram",
            tipo: "telegram",
            compativel: true,
            motivoFiltro: "telegram_inativo",
            temBotToken,
            temChatId,
            vaiEnviar: false,
            resultado: "ignorado"
          });
          continue;
        }

        if (!temBotToken || !temChatId) {
          logFilaTelegramDebug({
            clienteId,
            ofertaId: oferta.id || "",
            destinoId: destino.id || destino.destinoId || tel.chatId || "",
            destinoNome: destino.nome || tel.nome || "Telegram",
            tipo: "telegram",
            compativel: true,
            motivoFiltro: "credenciais_ausentes",
            temBotToken,
            temChatId,
            vaiEnviar: false,
            resultado: "erro"
          });
          continue;
        }

        if (!usuarioTemCreditos(clienteId, 1)) {
          logOptimus("AVISO", "Sem creditos", { clienteId });
          logFilaTelegramDebug({
            clienteId,
            ofertaId: oferta.id || "",
            destinoId: destino.id || destino.destinoId || tel.chatId || "",
            destinoNome: destino.nome || tel.nome || "Telegram",
            tipo: "telegram",
            compativel: true,
            motivoFiltro: "sem_creditos",
            temBotToken,
            temChatId,
            vaiEnviar: false,
            resultado: "erro"
          });
          continue;
        }

        logFilaTelegramDebug({
          clienteId,
          ofertaId: oferta.id || "",
          destinoId: destino.id || destino.destinoId || tel.chatId || "",
          destinoNome: destino.nome || tel.nome || "Telegram",
          tipo: "telegram",
          compativel: true,
          motivoFiltro: "",
          temBotToken,
          temChatId,
          vaiEnviar: true,
          resultado: "tentando"
        });

        console.log("[EXECUTOR-IMAGEM-AUDITORIA]", {


          canal: "telegram",


          clienteId,


          destino: destino.nome || destino.id || tel.chatId || "",


          tipoMidia: destino.tipoMidia || "",


          ofertaId: oferta.id || "",


          engineOfertaId: oferta.engineOfertaId || "",


          marketplace: oferta.marketplace || "",


          temImagem: Boolean(oferta.imagem),


          imagemPreview: String(oferta.imagem || "").slice(0, 140),


          vaiEnviarImagem: destino.tipoMidia !== "texto" && Boolean(oferta.imagem)


        });


        tentouEnvio = true;
        if (destino.tipoMidia === "texto" || !oferta.imagem) {
          await axios.post(
            `https://api.telegram.org/bot${tel.botToken}/sendMessage`,
            {
              chat_id: tel.chatId,
              text: mensagem
            }
          );
        } else {
          await axios.post(
            `https://api.telegram.org/bot${tel.botToken}/sendPhoto`,
            {
              chat_id: tel.chatId,
              photo: corrigirImagemUrl(oferta.imagem) || oferta.imagem,
              caption: mensagem
            }
          );
        }

        debitarCreditos(clienteId, 1);
        telegramEnviado = true;
        confirmouEnvio = true;

        logOptimus("TELEGRAM", "Mensagem enviada", {
          clienteId,
          destino: destino.nome,
          chatId: tel.chatId
        });

        logFilaTelegramDebug({
          clienteId,
          ofertaId: oferta.id || "",
          destinoId: destino.id || destino.destinoId || tel.chatId || "",
          destinoNome: destino.nome || tel.nome || "Telegram",
          tipo: "telegram",
          compativel: true,
          motivoFiltro: "",
          temBotToken,
          temChatId,
          vaiEnviar: true,
          resultado: "enviado"
        });

        oferta.destinosEnviados = oferta.destinosEnviados || [];
        oferta.destinosEnviados.push({
          clienteId,
          id: destino.id || "",
          destinoId: destino.id || "",
          conexaoId: destino.conexaoId || "",
          nome: destino.nome || "Destino",
          tipo: "telegram",
          chatId: tel.chatId,
          creditos: 1,
          dataEnvio: new Date().toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo"
          })
        });

        await new Promise(r => setTimeout(r, 2000));
      }

      if (telegramEnviado) {
        return { enviado: true, tentouEnvio: true };
      }

      return { enviado: false, tentouEnvio, motivo: "telegram_nao_enviado" };
    }

  } catch (e) {
    console.log(
      "❌ erro destino inteligente:",
      destino?.nome,
      e.message
    );

    if (String(destino?.tipo || "").toLowerCase() === "telegram") {
      logFilaTelegramDebug({
        clienteId,
        ofertaId: oferta.id || "",
        destinoId: destino.id || destino.destinoId || destino.chatId || "",
        destinoNome: destino.nome || "Telegram",
        tipo: destino.tipo || "telegram",
        compativel: true,
        motivoFiltro: "erro_envio",
        temBotToken: false,
        temChatId: false,
        vaiEnviar: false,
        resultado: e.message || "erro"
      });
    }

    if (confirmouEnvio) {
      return { enviado: true, tentouEnvio: true, parcial: true, erro: e.message };
    }

    return { enviado: false, tentouEnvio, motivo: "erro", erro: e.message };
  }

  return { enviado: false, tentouEnvio, motivo: "nao_enviado" };
}

// ================= FUNCAO PROCESSA FILA =================

async function processarFila(clienteIdAlvo = null) {
  const clienteFila = clienteIdAlvo || "admin";

  if (enviandoAgoraPorCliente[clienteFila]) {
    console.log("[PERFORMANCE-RUNNER-SKIP]", {
      runner: "processarFila",
      clienteId: clienteFila,
      motivo: "envio_em_execucao"
    });
    return;
  }

  enviandoAgoraPorCliente[clienteFila] = true;
  let oferta = null;

  try {
    sanearExpiradosFila(clienteFila);

    oferta = selecionarProximaOfertaFila(clienteFila);

if (!oferta) {
  const diagnosticoFila = diagnosticosFilaPorCliente.get(String(clienteFila)) ||
    diagnosticarFilaCliente(clienteFila);

  if (deveLogarThrottle(`fila-processar-sem-elegivel:${clienteFila}`)) {
    logOptimus("FILA", "Nenhuma oferta pendente elegível", {
      clienteId: clienteFila,
      motivoPrincipal: diagnosticoFila.motivoPrincipal,
      diagnostico: diagnosticoFila
    });
  }
  return;
}

const clienteId = oferta.clienteId || "admin";

if (oferta.sessaoId === "sessao1") {
  oferta.sessaoId = normalizarSessaoId(clienteId, "sessao1");
  salvarFila(clienteId);
}

const configCliente =
  configsPorCliente?.[clienteId] || config;

const clienteAtivo =
  configCliente.automacaoAtiva === true;

if (!clienteAtivo) {
  logOptimus("FILA", "Automacao desligada para cliente", { clienteId });
  return;
}

    if (!podeRodarAgora()) {
      return;
    }

  const agora = Date.now();

    let idSessao =
  normalizarSessaoId(
    clienteId,
    oferta.sessaoId || oferta.idSessao || "sessao1"
  );

if (!sessoes[idSessao]) {
  idSessao =
    Object.keys(destinosPorSessao || {}).find(id =>
      String(id).startsWith(clienteId + "_") &&
      destinosPorSessao[id]?.length &&
      statusSessao[id] === "open"
    ) ||
    Object.keys(sessoes || {}).find(id =>
      String(id).startsWith(clienteId + "_")
    );
}

    if (!destinosPorSessao?.[idSessao]?.length) {
      const sessaoComDestino = Object.keys(destinosPorSessao || {})
        .find(id =>
        String(id).startsWith(clienteId + "_") &&
        destinosPorSessao[id]?.length &&
        statusSessao[id] === "open"
        );

      if (sessaoComDestino) {
        idSessao = sessaoComDestino;
      }
    }

    const sock = sessoes[idSessao];

    if (!sock) {
      logOptimus("WHATSAPP", "Nenhuma sessao conectada", {
        sessaoId: idSessao
      });
    } else {
      logOptimus("WHATSAPP", "Sessao escolhida", {
        sessaoId: idSessao,
        clienteId
      });
    }

    const destinosBrutos =
      oferta.destinos?.length
        ? oferta.destinos
        : oferta.grupos?.length
          ? oferta.grupos
          : destinosPorSessao?.[idSessao]?.length
            ? destinosPorSessao[idSessao]
            : configCliente?.destinosPorSessao?.[idSessao]?.length
              ? configCliente.destinosPorSessao[idSessao]
              : oferta.destino
                ? [oferta.destino]
                : oferta.grupoDestino
                  ? [oferta.grupoDestino]
                  : configCliente?.destinos?.length
                    ? configCliente.destinos
                    : [];

    const destinos = destinosBrutos
      .map(d => d?.id || d?.value || d?.jid || d)
      .filter(Boolean);

    logOptimus("DESTINO", "Destinos previstos", {
      total: destinos.length,
      destinos
    });

// ================= ENVIO DESTINOS INTELIGENTES =================

const usuarioOferta =
  usuarios.find(u => String(u.id) === String(clienteId)) || null;

const plano =
  getPlanoPorNome(usuarioOferta?.plano || "free") || {};

let enviouParaAlgumDestino = false;
let destinosEnviadosCount = 0;

let pulouPorIntervalo = false;
let pulouPorHorario = false;
let pulouPorLimiteDiario = false;
let houveFalhaReal = false;
const motivosSemEnvio = [];
const categoriaOfertaFila = oferta.categoria || oferta.categoriaProduto || classificarCategoriaOferta(oferta, oferta.termo || "");
const analiseDestinosFila = analisarDestinosCompativeisFila(clienteId, oferta, configCliente);
const destinosCompativeis = analiseDestinosFila.compativeis;
const destinosAtivosTotalDebug = analiseDestinosFila.destinosInteligentes.filter(destino => destino?.ativo !== false).length;
let destinosTentadosDebug = 0;
const fastLaneCupomTipo = cupomFastLaneTipo(oferta);

if (fastLaneCupomTipo === "real_detectado") {
  logOptimus("CUPOM", "Fast Lane aplicada", {
    clienteId,
    titulo: oferta.titulo || oferta.nome || "",
    cupom: oferta.cupom || "",
    tipo: fastLaneCupomTipo
  });
} else if (fastLaneCupomTipo === "provavel") {
  logOptimus("CUPOM", "Fast Lane provavel aplicada", {
    clienteId,
    titulo: oferta.titulo || oferta.nome || "",
    tipo: fastLaneCupomTipo
  });
} else {
  logOptimus("FILA", "Oferta comum usando intervalo normal", {
    clienteId,
    titulo: oferta.titulo || oferta.nome || ""
  });
}

for (const itemRejeitado of analiseDestinosFila.rejeitados) {
  const destino = itemRejeitado.destino;
  const analise = itemRejeitado.analise;
  const nomeDestino = destinoNomeLog(destino);

  logEnvioDestinoDebug({
    clienteId,
    oferta,
    destino,
    analise,
    destinosAtivosTotal: destinosAtivosTotalDebug,
    destinosCompativeis: destinosCompativeis.length,
    destinosTentados: destinosTentadosDebug,
    dentroHorario: destinoDentroHorario(destino),
    enviado: false,
    erro: analise.motivo || "nao_compativel"
  });

  if (String(destino.tipo || "").toLowerCase() === "telegram") {
    logFilaTelegramDebug({
      clienteId,
      ofertaId: oferta.id || "",
      destinoId: destino.id || destino.destinoId || destino.chatId || "",
      destinoNome: nomeDestino,
      tipo: destino.tipo || "telegram",
      compativel: false,
      motivoFiltro: analise.motivo || "nao_compativel",
      temBotToken: false,
      temChatId: false,
      vaiEnviar: false,
      resultado: "filtrado"
    });
  }

  if (analise.motivo === "marketplace") {
    logOptimus("DESTINO", "Rejeitada marketplace", {
      clienteId,
      destino: nomeDestino,
      marketplaceOferta: analise.marketplaceOferta
    });
  } else if (analise.motivo === "categoria") {
    logOptimus("DESTINO", "Rejeitada categoria", {
      clienteId,
      destino: nomeDestino,
      categoriaOferta: analise.categoriaOferta
    });
  } else {
    logOptimus("DESTINO", "Rejeitada", {
      clienteId,
      destino: nomeDestino,
      motivo: analise.motivo || "nao_compativel"
    });
  }
}

  logOptimus("DESTINO", "Compativeis encontrados", {
    total: destinosCompativeis.length
  });

if (!destinosCompativeis.length) {
  marcarOfertaRetida(oferta, analiseDestinosFila.motivoRetencao);
  salvarFila(clienteId);
  logExecutorDestinoDiagnostico({
    oferta,
    clienteId,
    destinosElegiveis: [],
    destinosTentados: 0,
    motivoSemEnvio: analiseDestinosFila.motivoRetencao || "sem_destino_compativel",
    dentroJanela: false,
    statusFinal: oferta.status || "retida"
  });
  logOptimus("FILA", "Oferta retida", {
    clienteId,
    titulo: oferta.titulo || oferta.nome || "",
    categoria: categoriaOfertaFila || "",
    marketplace: oferta.marketplace || oferta.mercado || "",
    motivoRetencao: oferta.motivoRetencao
  });
  return;
}

const destinosOrdenados = destinosCompativeis
  .map(item => {
    const intervalo = intervaloDestinoInfo(clienteId, item.destino, configCliente, oferta);
    return {
      ...item,
      intervalo,
      ultimoEnvio: intervalo.ultimoEnvio || 0
    };
  })
  .sort((a, b) => a.ultimoEnvio - b.ultimoEnvio);

for (const item of destinosOrdenados) {
  const destino = item.destino;
  const nomeDestino = destinoNomeLog(destino);
  const intervalo = item.intervalo;

  if (String(destino.tipo || "").toLowerCase() === "telegram") {
    logFilaTelegramDebug({
      clienteId,
      ofertaId: oferta.id || "",
      destinoId: destino.id || destino.destinoId || destino.chatId || "",
      destinoNome: nomeDestino,
      tipo: destino.tipo || "telegram",
      compativel: true,
      motivoFiltro: "",
      temBotToken: false,
      temChatId: false,
      vaiEnviar: true,
      resultado: "compativel"
    });
  }

  if (!destinoDentroHorario(destino)) {
    pulouPorHorario = true;
    motivosSemEnvio.push("fora_horario");
    logEnvioDestinoDebug({
      clienteId,
      oferta,
      destino,
      analise: item.analise,
      destinosAtivosTotal: destinosAtivosTotalDebug,
      destinosCompativeis: destinosCompativeis.length,
      destinosTentados: destinosTentadosDebug,
      dentroHorario: false,
      enviado: false,
      erro: "fora_horario"
    });
    logOptimus("DESTINO", "Rejeitada horario", {
      clienteId,
      destino: nomeDestino
    });
    if (String(destino.tipo || "").toLowerCase() === "telegram") {
      logFilaTelegramDebug({
        clienteId,
        ofertaId: oferta.id || "",
        destinoId: destino.id || destino.destinoId || destino.chatId || "",
        destinoNome: nomeDestino,
        tipo: destino.tipo || "telegram",
        compativel: true,
        motivoFiltro: "fora_horario",
        temBotToken: false,
        temChatId: false,
        vaiEnviar: false,
        resultado: "filtrado"
      });
    }
    continue;
  }

  const limite = destinoLimiteDiarioDisponivel(clienteId, destino);
  if (!limite.ok) {
    pulouPorLimiteDiario = true;
    motivosSemEnvio.push("limite_diario");
    logEnvioDestinoDebug({
      clienteId,
      oferta,
      destino,
      analise: item.analise,
      destinosAtivosTotal: destinosAtivosTotalDebug,
      destinosCompativeis: destinosCompativeis.length,
      destinosTentados: destinosTentadosDebug,
      enviado: false,
      erro: "limite_diario"
    });
    logOptimus("DESTINO", "Rejeitada limite diario", {
      clienteId,
      destino: nomeDestino,
      usados: limite.usados,
      limite: limite.limite
    });
    if (String(destino.tipo || "").toLowerCase() === "telegram") {
      logFilaTelegramDebug({
        clienteId,
        ofertaId: oferta.id || "",
        destinoId: destino.id || destino.destinoId || destino.chatId || "",
        destinoNome: nomeDestino,
        tipo: destino.tipo || "telegram",
        compativel: true,
        motivoFiltro: "limite_diario",
        temBotToken: false,
        temChatId: false,
        vaiEnviar: false,
        resultado: "filtrado"
      });
    }
    continue;
  }

  if (!intervalo.liberado) {
    pulouPorIntervalo = true;
    motivosSemEnvio.push("intervalo");
    logFilaIntervalo("[FILA-DESTINO-BLOQUEADO-INTERVALO]", payloadIntervaloDestino(clienteId, destino, oferta, intervalo));
    logEnvioDestinoDebug({
      clienteId,
      oferta,
      destino,
      analise: item.analise,
      destinosAtivosTotal: destinosAtivosTotalDebug,
      destinosCompativeis: destinosCompativeis.length,
      destinosTentados: destinosTentadosDebug,
      enviado: false,
      erro: "intervalo"
    });
    logOptimus("DESTINO", "Aguardando intervalo", {
      clienteId,
      destino: nomeDestino,
      intervaloMinutos: intervalo.intervaloAplicadoMin,
      intervaloOriginalMinutos: intervalo.intervaloDestinoMin,
      turboCupomMinutos: intervalo.turboCupomMin,
      restanteSegundos: Math.ceil(intervalo.restanteMs / 1000)
    });
    if (String(destino.tipo || "").toLowerCase() === "telegram") {
      logFilaTelegramDebug({
        clienteId,
        ofertaId: oferta.id || "",
        destinoId: destino.id || destino.destinoId || destino.chatId || "",
        destinoNome: nomeDestino,
        tipo: destino.tipo || "telegram",
        compativel: true,
        motivoFiltro: "intervalo",
        temBotToken: false,
        temChatId: false,
        vaiEnviar: false,
        resultado: "filtrado"
      });
    }
    continue;
  }

  logFilaIntervalo("[FILA-DESTINO-LIBERADO]", payloadIntervaloDestino(clienteId, destino, oferta, intervalo));

  if (intervalo.fastLaneCupomTipo === "real_detectado") {
    logOptimus("CUPOM", intervalo.prioridadeCupomAtiva ? "Cupom Turbo aplicado 3min" : "Cupom usando intervalo normal", {
      clienteId,
      destino: nomeDestino,
      cupom: oferta.cupom || "",
      score: oferta.radarScore || oferta.score || "",
      intervaloOriginalMinutos: intervalo.intervaloDestinoMin,
      intervaloAplicadoMinutos: intervalo.intervaloAplicadoMin
    });
  } else if (intervalo.fastLaneCupomTipo === "provavel") {
    logOptimus("CUPOM", "Cupom provavel usando intervalo normal", {
      clienteId,
      destino: nomeDestino,
      intervaloOriginalMinutos: intervalo.intervaloDestinoMin,
      intervaloAplicadoMinutos: intervalo.intervaloAplicadoMin
    });
  }

  const marketplaceOfertaLog = String(oferta.marketplace || oferta.mercado || "").toLowerCase();

  if (marketplaceOfertaLog === "mercadolivre" || marketplaceOfertaLog === "mercado_livre") {
    const linkFinal = oferta.linkFinal || oferta.linkAfiliado || oferta.link || oferta.linkOriginal || "";
    logOptimus("MERCADOLIVRE", "Envio preparado", {
      clienteId,
      marketplace: oferta.marketplace,
      titulo: oferta.titulo || oferta.nome || "",
      linkOriginal: oferta.linkOriginal || "",
      linkAfiliado: oferta.linkAfiliado || "",
      linkFinal
    });
  }

  const linkOfertaDestino = resolverLinkOfertaPorDestino({
    oferta,
    destino,
    clienteId,
    plano,
    recursos: plano?.recursos,
    configGlobal: config
  });
  const ofertaParaMensagem = linkOfertaDestino.oferta || oferta;

  const mensagem = montarMensagemOferta(ofertaParaMensagem, {
    destino,
    plano,
    clienteId
  });

  const enviado = await enviarParaDestinoInteligente(
    destino,
    oferta,
    mensagem,
    clienteId,
    configCliente
  );
  const resultadoEnvio =
    typeof enviado === "object" && enviado !== null
      ? enviado
      : { enviado: enviado === true, tentouEnvio: enviado === true, motivo: enviado === false ? "nao_enviado" : "" };
  const tentouEnvioReal = resultadoTentouEnvio(resultadoEnvio);
  if (tentouEnvioReal) destinosTentadosDebug += 1;
  if (resultadoEnvio.enviado !== true) {
    motivosSemEnvio.push(resultadoEnvio.motivo || resultadoEnvio.erro || "nao_enviado");
  }

  logEnvioDestinoDebug({
    clienteId,
    oferta,
    destino,
    analise: item.analise,
    destinosAtivosTotal: destinosAtivosTotalDebug,
    destinosCompativeis: destinosCompativeis.length,
    destinosTentados: destinosTentadosDebug,
    enviado: resultadoEnvio.enviado === true,
    erro: resultadoEnvio.enviado === true ? "" : (resultadoEnvio.erro || resultadoEnvio.motivo || "nao_enviado")
  });

  if (resultadoEnvio.enviado === true) {
    enviouParaAlgumDestino = true;
    destinosEnviadosCount += 1;
    atualizarUltimoEnvioDestino(clienteId, destino, oferta, intervalo);
    logOptimus("DESTINO", "Enviado", {
      clienteId,
      destino: nomeDestino,
      titulo: oferta.titulo || oferta.nome || ""
    });
  } else if (resultadoEnvio.motivo === "fora_horario") {
    pulouPorHorario = true;
  } else if (tentouEnvioReal) {
    houveFalhaReal = true;
  }
}

const decisaoSemEnvio = decidirStatusExecutorSemEnvio({
  destinosElegiveis: destinosCompativeis.length,
  destinosTentados: destinosTentadosDebug,
  houveFalhaReal,
  motivosSemEnvio
});
const dentroJanelaExecutor = destinosCompativeis.some(item => destinoDentroHorario(item.destino));

if (!enviouParaAlgumDestino && decisaoSemEnvio.statusFinal === "pendente") {
  oferta.status = "pendente";
  oferta.statusDetalhe = `Aguardando envio: ${decisaoSemEnvio.motivoSemEnvio}`;
  oferta.erro = "";
  oferta.erroEm = "";
  const menorEsperaIntervalo = destinosOrdenados
    .filter(item => !item.intervalo.liberado)
    .map(item => item.intervalo.restanteMs)
    .sort((a, b) => a - b)[0];
  proximaTentativaDestino(
    oferta,
    Math.max(30 * 1000, Math.min(menorEsperaIntervalo || 5 * 60 * 1000, 15 * 60 * 1000))
  );
  salvarFila(clienteId);
  logExecutorDestinoDiagnostico({
    oferta,
    clienteId,
    destinosElegiveis: destinosCompativeis,
    destinosTentados: destinosTentadosDebug,
    motivoSemEnvio: decisaoSemEnvio.motivoSemEnvio,
    dentroJanela: dentroJanelaExecutor,
    statusFinal: "pendente"
  });
  logOptimus("DESTINO", "Oferta aguardando destino liberar envio", {
    titulo: oferta.titulo || oferta.nome || "",
    clienteId,
    motivo: decisaoSemEnvio.motivoSemEnvio
  });

  if (pulouPorIntervalo && !pulouPorHorario && !pulouPorLimiteDiario) {
    setTimeout(() => {
      processarFila(clienteId).catch(e => {
        logOptimus("ERRO", "Falha ao continuar fila apos intervalo", {
          clienteId,
          erro: e.message
        });
      });
    }, 250);
  }

  return;
}

if (!enviouParaAlgumDestino) {
  logOptimus("ERRO", "Oferta nao enviada; marcando erro tecnico", {
    titulo: oferta.titulo || oferta.nome || ""
  });

  oferta.status = "erro";
  oferta.statusDetalhe = "Falha ao enviar para destinos";
  oferta.erro = "Nenhum destino confirmou envio";
  oferta.erroEm = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });

  logExecutorDestinoDiagnostico({
    oferta,
    clienteId,
    destinosElegiveis: destinosCompativeis,
    destinosTentados: destinosTentadosDebug,
    motivoSemEnvio: decisaoSemEnvio.motivoSemEnvio,
    dentroJanela: dentroJanelaExecutor,
    statusFinal: "erro"
  });
  salvarFila(clienteId);
  return;
}


ultimoEnvioFila = Date.now();

oferta.status = "enviado";
oferta.proximaTentativaEnvioEm = "";

oferta.enviadoEm = new Date().toLocaleString("pt-BR", {
  timeZone: "America/Sao_Paulo"
});

oferta.dataEnvio = oferta.enviadoEm;
oferta.statusDetalhe = `Enviada para ${destinosEnviadosCount} destino(s)`;

logExecutorDestinoDiagnostico({
  oferta,
  clienteId,
  destinosElegiveis: destinosCompativeis,
  destinosTentados: destinosTentadosDebug,
  motivoSemEnvio: "",
  dentroJanela: dentroJanelaExecutor,
  statusFinal: "enviado"
});

oferta.logsEnvio = oferta.logsEnvio || [];
oferta.logsEnvio.push({
  tipo: "sucesso",
  mensagem: oferta.statusDetalhe,
  data: oferta.enviadoEm
});

salvarFila(clienteId);

console.log("[ENVIO] Enviado com controle de tempo");

 } catch (e) {
  console.log("[ERRO] ERRO:", e.message);

  if (oferta) {
    oferta.status = "erro";
    oferta.erro = e.message;
    oferta.erroEm = new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo"
    });
    oferta.statusDetalhe = `Erro no envio: ${e.message}`;

    oferta.logsEnvio = oferta.logsEnvio || [];
    oferta.logsEnvio.push({
      tipo: "erro",
      mensagem: oferta.statusDetalhe,
      data: oferta.erroEm
    });

    salvarFila(oferta.clienteId || "admin");
  }

} finally {
  enviandoAgoraPorCliente[clienteFila] = false;
}
}

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require("@whiskeysockets/baileys");

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({
  origin: true,
  credentials: true
}));

app.options("*", cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: "10mb", verify: capturarRawBody }));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    req.path.startsWith("/conexoes") ||
    req.path.startsWith("/sessoes") ||
    req.path.startsWith("/conectar") ||
    req.path.startsWith("/desconectar") ||
    req.path.startsWith("/reset") ||
    req.path.startsWith("/limpar-sessao") ||
    req.path.startsWith("/login") ||
    req.path.startsWith("/config") ||
    req.path.startsWith("/status") ||
    req.path.startsWith("/qr") ||
    req.path.startsWith("/fila") ||
    req.path.startsWith("/automacao") ||
    req.path.startsWith("/destinos") ||
    req.path.startsWith("/grupos")
}));
const ROTAS_PERF_DIAGNOSTICO = [
  "/login",
  "/me",
  "/fila",
  "/sessoes",
  "/destinos",
  "/integracoes",
  "/grupos",
  "/status",
  "/radar/config",
  "/automacao"
];

function rotaPerfDiagnostico(path = "") {
  const alvo = String(path || "");
  return ROTAS_PERF_DIAGNOSTICO.some(rota =>
    alvo === rota ||
    alvo.startsWith(`${rota}/`) ||
    (rota === "/integracoes" && alvo === "/integracoes/alertas") ||
    (rota === "/automacao" && alvo === "/automacao/status")
  );
}

app.use((req, res, next) => {
  if (!rotaPerfDiagnostico(req.path)) return next();

  const inicio = process.hrtime.bigint();

  res.on("finish", () => {
    const duracaoMs = Number(process.hrtime.bigint() - inicio) / 1e6;
    const clienteId = (() => {
      try {
        return getClienteId(req) || "admin";
      } catch {
        return "admin";
      }
    })();

    console.log("[PERF]", {
      metodo: req.method,
      path: req.originalUrl || req.path,
      clienteId,
      duracaoMs: Math.round(duracaoMs),
      statusCode: res.statusCode
    });
  });

  return next();
});

// ============== POST FILA ENVIO =================

app.post("/fila", (req, res) => {
  try {
    const body = req.body || {};
    const clienteId = getClienteId(req);

    if (!clienteId) {
      return res.status(401).json({
        ok: false,
        erro: "Usuário não identificado"
      });
    }

    const resultado = adicionarManualNaFila(body, {
      fila,
      clienteId,
      salvarFila,
      classificarCategoriaOferta,
      normalizarTexto,
      deveIgnorarOfertaRepetida,
      registrarOfertaVista,
      prepararOfertaGlobal
    });

    if (resultado?.ok && !resultado?.ignorada) {
      logOptimus("FILA", "Oferta manual adicionada", {
        clienteId,
        id: resultado.oferta?.id,
        titulo: resultado.oferta?.titulo,
        categoria: resultado.oferta?.categoria,
        dataEntradaFila: resultado.oferta?.dataEntradaFila
      });
    }

    return res.json(resultado);

  } catch (e) {
    logOptimus("ERRO", "Erro ao adicionar oferta na fila", { erro: e.message });

    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

// ================= ENVIO MANUAL =================

app.post("/enviar-manual", async (req, res) => {
 console.log("[ENVIO] Envio manual recebido:", req.body?.titulo);

  try {
    const body = req.body || {};

    const categoriaManual =
      body.categoria &&
      body.categoria !== body.marketplace
        ? body.categoria
        : body.categoriaProduto &&
          body.categoriaProduto !== body.marketplace
            ? body.categoriaProduto
            : "geral";

   const agora = new Date().toLocaleString("pt-BR", {
  timeZone: "America/Sao_Paulo"
});

const categoriaDetectada = classificarCategoriaOferta(
  {
    titulo: body.titulo || body.nome || "",
    nome: body.nome || body.titulo || "",
    categoria: categoriaManual,
    marketplace: body.marketplace || ""
  },
  body.titulo || body.nome || ""
);

const oferta = {
  id:
    body.id ||
    `manual_${Date.now()}_${Math.random().toString(36).slice(2)}`,

  nome: body.nome || body.titulo || "Oferta",
  titulo: body.titulo || body.nome || "Oferta",
  preco: body.preco || body.precoAtual || "",
  precoAtual: body.precoAtual || body.preco || "",
  precoAntigo: body.precoAntigo || "",
  cupom: body.cupom ? String(body.cupom).trim() : "",
  avisoCupom: body.avisoCupom || "",
  parcelamento: body.parcelamento || "",
  link: body.link || body.linkAfiliado || "",
  linkAfiliado: body.linkAfiliado || body.link || "",
  imagem: body.imagem || "",
  marketplace: body.marketplace || "",

  categoria: categoriaDetectada,
  categoriaProduto: categoriaDetectada,

  origem: "manual",
  manual: true,
  clienteId: getClienteId(req),
  status: "pendente",
  statusDetalhe: "Na fila",
  criadoEm: body.criadoEm || agora,
  dataEntradaFila: agora
};

 const clienteId = oferta.clienteId || "admin";

if (deveIgnorarOfertaRepetida(oferta)) {
  return res.json({
    ok: true,
    ignorada: true,
    motivo: "Oferta repetida recentemente sem queda relevante de preço ou cupom novo.",
    oferta
  });
}

oferta.status = "pendente";
oferta.statusDetalhe = "Na fila";
validarCupomMonetarioOferta(oferta);
aplicarPrioridadeEnvioOferta(oferta);

registrarOfertaVista(oferta);

logPrioridadeFila(oferta);
filaOfertas.adicionarOfertaInicioFila(fila, oferta, {
  clienteId,
  origem: oferta.origem || "manual",
  logger: console
});
salvarFila(clienteId);

const configCliente =
  configsPorCliente?.[clienteId] || config;

const automacaoAnterior = configCliente.automacaoAtiva;
configCliente.automacaoAtiva = true;

await processarFila(clienteId);

configCliente.automacaoAtiva = automacaoAnterior;

    return res.json({
      ok: true,
      mensagem: "Oferta enviada manualmente",
      oferta
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

function decorarItemFilaParaResposta(item = {}) {
  const ehRadar = item?.origem === "radar" || item?.radar === true || item?.radarNaFila === true;

  if (!ehRadar) return item;

  const badgeOrigemAtual = item.badgeOrigem && typeof item.badgeOrigem === "object"
    ? item.badgeOrigem
    : {};

  return {
    ...item,
    origem: "radar",
    radar: true,
    fonte: item.fonte || "radar",
    origemLabel: item.origemLabel || "Radar",
    origemBadge: item.origemBadge || "Radar",
    origemIcone: item.origemIcone || "radar",
    exibirBadgeRadar: true,
    badgeOrigem: {
      id: "radar",
      label: "Radar",
      icone: "radar",
      cor: "cyan",
      ...badgeOrigemAtual
    }
  };
}

app.get("/fila", (req, res) => {
  const clienteId = getClienteId(req);

  sanearExpiradosFila(clienteId);

  const itensCliente = fila.filter((o) =>
    (o.clienteId || "admin") === clienteId
  );
  const resumo = {
    pendentesTotal: itensCliente.filter((o) => o.status === "pendente").length,
    enviadasTotal: itensCliente.filter((o) => o.status === "enviado").length,
    retidasTotal: itensCliente.filter((o) => o.status === "retida").length,
    errosTotal: itensCliente.filter((o) => o.status === "erro").length
  };

  const textoFiltroFila = valor => String(valor || "").trim().toLowerCase();
  const statusFiltro = textoFiltroFila(req.query.status);
  const marketplaceFiltro = textoFiltroFila(req.query.marketplace);
  const categoriaFiltro = textoFiltroFila(req.query.categoria);
  const canalFiltro = textoFiltroFila(req.query.canal);
  const contemFiltroFila = (valor, filtro) =>
    !filtro || textoFiltroFila(valor).includes(filtro);

  const itensFiltrados = itensCliente.filter(item => {
    if (statusFiltro && textoFiltroFila(item.status) !== statusFiltro) return false;
    if (marketplaceFiltro && textoFiltroFila(item.marketplace) !== marketplaceFiltro) return false;
    if (
      categoriaFiltro &&
      !contemFiltroFila(item.categoria || item.categoriaProduto, categoriaFiltro)
    ) {
      return false;
    }

    if (canalFiltro) {
      const canais = [
        item.canal,
        item.destinoCanal,
        item.tipoCanal,
        item.tipoMidia,
        item.destino?.canal,
        item.destino?.tipo,
        item.destino?.tipoMidia,
        item.destinoTipo,
        item.destinoNome
      ];

      if (!canais.some(canal => contemFiltroFila(canal, canalFiltro))) return false;
    }

    return true;
  });

  const limit = Math.max(1, Math.min(500, Math.floor(Number(req.query.limit) || 100)));
  const pageQuery = Math.floor(Number(req.query.page) || 0);
  const offsetQuery = Math.max(0, Math.floor(Number(req.query.offset) || 0));
  const page = Math.max(1, pageQuery || Math.floor(offsetQuery / limit) + 1);
  const offset = (page - 1) * limit;
  const totalFiltrado = itensFiltrados.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltrado / limit));
  const itensResposta = itensFiltrados
    .slice(offset, offset + limit)
    .map(decorarItemFilaParaResposta);

  res.json({
    ok: true,
    clienteId,
    total: itensCliente.length,
    totalFiltrado,
    page,
    limit,
    offset,
    totalPages,
    hasMore: page < totalPages,
    resumo,
    filtros: {
      status: statusFiltro,
      marketplace: marketplaceFiltro,
      categoria: categoriaFiltro,
      canal: canalFiltro
    },
    pendentes: resumo.pendentesTotal,
    enviados: resumo.enviadasTotal,
    retidas: resumo.retidasTotal,
    erros: resumo.errosTotal,
    itens: itensResposta,
    fila: itensResposta
  });
});

// =========== REDIRECIONADOR OPTIMUS ===========

app.get("/r/:codigo", (req, res) => {
  try {
    const codigo = req.params.codigo;

    config.linksGerados = config.linksGerados || {};

    const dados = config.linksGerados[codigo];

    if (!dados?.original) {
      return res.status(404).send("Link não encontrado");
    }

    dados.cliques = (dados.cliques || 0) + 1;
    dados.ultimoClique = new Date().toISOString();

    salvarConfig();

    return res.redirect(dados.original);

  } catch (e) {
    console.log("[ERRO] erro link optimus:", e.message);

    return res.status(500).send("Erro ao abrir link");
  }
});

// ================= TELEGRAM =================

app.get("/telegram", (req, res) => {

  const clienteId = exigirClienteAutenticado(req, res);
  if (!clienteId) return;

  const configCliente =
    configsPorCliente[clienteId] || {};

  res.json({
    ativo: configCliente.telegram?.ativo || false,
    destinos: configCliente.telegram?.destinos || []
  });
});


app.post("/telegram", (req, res) => {
  const body = req.body || {};

  const clienteId = exigirClienteAutenticado(req, res);
  if (!clienteId) return;

  configsPorCliente[clienteId] =
    configsPorCliente[clienteId] || {};

  const telegramAtual = configsPorCliente[clienteId].telegram || {};
  const destinosAtuais = Array.isArray(telegramAtual.destinos)
    ? telegramAtual.destinos
    : [];

  const destinosRecebidos = Array.isArray(body.destinos)
    ? body.destinos.map(normalizarTelegramDestinoRecebido).filter(Boolean)
    : [normalizarTelegramDestinoRecebido(body)].filter(Boolean);

  const destinos = destinosRecebidos.length
    ? mesclarDestinosTelegram(destinosAtuais, destinosRecebidos)
    : destinosAtuais;

  configsPorCliente[clienteId].telegram = {
    ...telegramAtual,
    ativo: true,
    destinos
  };

  salvarConfigsClientes();

  res.json({
    ok: true,
    telegram: configsPorCliente[clienteId].telegram
  });
});

function textoTelegram(valor) {
  return valor == null ? "" : String(valor).trim();
}

function normalizarTelegramDestinoRecebido(body = {}) {
  const entrada =
    body.destino && typeof body.destino === "object" ? body.destino :
    body.telegram && typeof body.telegram === "object" ? body.telegram :
    body;

  const id = textoTelegram(
    entrada.id || entrada.botId || entrada.telegramId || entrada.destinoId ||
    body.id || body.botId || body.telegramId || body.destinoId
  );
  const botToken = textoTelegram(
    entrada.botToken || entrada.token || entrada.telegramToken ||
    body.botToken || body.token || body.telegramToken
  );
  const chatId = textoTelegram(
    entrada.chatId || entrada.grupoId || entrada.canalId || entrada.channelId ||
    body.chatId || body.grupoId || body.canalId || body.channelId
  );

  if (!id && !botToken && !chatId) return null;

  return {
    ...entrada,
    id: id || textoTelegram(entrada.id) || `telegram_${Date.now()}`,
    botToken,
    chatId,
    nome: entrada.nome || entrada.apelido || entrada.label || chatId || id || "Telegram"
  };
}

function mesclarDestinosTelegram(atuais = [], recebidos = []) {
  const destinos = Array.isArray(atuais) ? [...atuais] : [];

  for (const destino of recebidos) {
    const chavesRecebidas = chavesTelegramDestino(destino);
    const indiceExistente = destinos.findIndex(item =>
      chavesTelegramDestino(item).some(chave => chavesRecebidas.includes(chave))
    );

    if (indiceExistente >= 0) {
      destinos[indiceExistente] = {
        ...destinos[indiceExistente],
        ...destino
      };
    } else {
      destinos.push(destino);
    }
  }

  return destinos;
}

function normalizarTelegramFila(telegram = {}) {
  const botToken = textoTelegram(
    telegram.botToken || telegram.token || telegram.telegramToken
  );
  const chatId = textoTelegram(
    telegram.chatId || telegram.grupoId || telegram.canalId || telegram.channelId
  );

  return {
    ...telegram,
    botToken,
    chatId,
    ativo: telegram.ativo !== false,
    chaves: chavesTelegramDestino(telegram)
  };
}

function telegramTemCredenciaisFila(telegram = {}) {
  const normalizado = normalizarTelegramFila(telegram);
  return normalizado.botToken && normalizado.chatId ? normalizado : null;
}

function idsTelegramDestinoFila(destino = {}) {
  const ids = [];

  if (Array.isArray(destino.telegramDestinos)) {
    for (const item of destino.telegramDestinos) {
      if (item && typeof item === "object") {
        ids.push(...chavesTelegramDestino(item));
      } else {
        ids.push(item);
      }
    }
  }

  ids.push(
    destino.telegramId,
    destino.botId,
    destino.destinoId,
    destino.idTelegram,
    destino.conexaoId,
    destino.sessao,
    destino.chatId,
    destino.grupoId,
    destino.canalId,
    destino.channelId
  );

  return ids.map(textoTelegram).filter(Boolean);
}

function telegramsDiretosDestinoFila(destino = {}) {
  const diretos = [];
  const direto = telegramTemCredenciaisFila(destino);
  if (direto) diretos.push(direto);

  if (Array.isArray(destino.telegramDestinos)) {
    for (const item of destino.telegramDestinos) {
      if (item && typeof item === "object") {
        const normalizado = telegramTemCredenciaisFila(item);
        if (normalizado) diretos.push(normalizado);
      }
    }
  }

  if (destino.telegram && typeof destino.telegram === "object") {
    const normalizado = telegramTemCredenciaisFila(destino.telegram);
    if (normalizado) diretos.push(normalizado);
  }

  return diretos;
}

function logFilaTelegramDebug(dados = {}) {
  console.log("[FILA-TELEGRAM-DEBUG]", {
    clienteId: dados.clienteId || "",
    ofertaId: dados.ofertaId || "",
    destinoId: dados.destinoId || "",
    destinoNome: dados.destinoNome || "",
    tipo: dados.tipo || "",
    compativel: dados.compativel === true,
    motivoFiltro: dados.motivoFiltro || "",
    temBotToken: dados.temBotToken === true,
    temChatId: dados.temChatId === true,
    vaiEnviar: dados.vaiEnviar === true,
    resultado: dados.resultado || ""
  });
}

function listarTelegramsCliente(clienteId) {
  const destinos = configsPorCliente?.[clienteId]?.telegram?.destinos;
  return Array.isArray(destinos) ? destinos : [];
}

function chavesTelegramDestino(destino = {}) {
  return [
    destino.id,
    destino.botId,
    destino.telegramId,
    destino.destinoId,
    destino.nome,
    destino.apelido,
    destino.username,
    destino.chatId,
    destino.grupoId,
    destino.canalId,
    destino.channelId
  ].map(textoTelegram).filter(Boolean);
}

function resolverTelegramTeste(body = {}, clienteId) {
  const entrada =
    body.destino && typeof body.destino === "object" ? body.destino :
    body.telegram && typeof body.telegram === "object" ? body.telegram :
    body;

  const id = textoTelegram(
    entrada.id || entrada.botId || entrada.telegramId || entrada.destinoId ||
    body.id || body.botId || body.telegramId || body.destinoId
  );

  let botToken = textoTelegram(
    entrada.botToken || entrada.token || entrada.telegramToken ||
    body.botToken || body.token || body.telegramToken
  );
  let chatId = textoTelegram(
    entrada.chatId || entrada.grupoId || entrada.canalId || entrada.channelId ||
    body.chatId || body.grupoId || body.canalId || body.channelId
  );

  if ((!botToken || !chatId) && id) {
    const salvo = listarTelegramsCliente(clienteId).find(t =>
      chavesTelegramDestino(t).includes(id)
    );

    if (salvo) {
      botToken = botToken || textoTelegram(
        salvo.botToken || salvo.token || salvo.telegramToken
      );
      chatId = chatId || textoTelegram(
        salvo.chatId || salvo.grupoId || salvo.canalId || salvo.channelId
      );
    }
  }

  return { botToken, chatId };
}

async function testarTelegram(req, res) {
  try {
    const clienteId = exigirClienteAutenticado(req, res);
    if (!clienteId) return;

    const body = {
      ...(req.body || {})
    };

    if (req.params?.id && !body.id) {
      body.id = req.params.id;
    }

    const telegram = resolverTelegramTeste(body, clienteId);

    if (!telegram.botToken || !telegram.chatId) {
      return res.status(400).json({
        ok: false,
        erro: "Token ou Chat ID ausente"
      });
    }

    await axios.post(
      `https://api.telegram.org/bot${telegram.botToken}/sendMessage`,
      {
        chat_id: telegram.chatId,
        text: "Teste Telegram Optimus Promo enviado com sucesso!"
      }
    );

    return res.json({
      ok: true,
      mensagem: "Teste enviado com sucesso"
    });

  } catch (e) {

    return res.status(400).json({
      ok: false,
      erro: e.response?.data || e.message
    });

  }
}

app.post("/telegram/testar", testarTelegram);
app.post("/telegram/:id/testar", testarTelegram);

// ============== DESTINOS INTELIGENTES =================

app.get("/destinos", (req, res) => {
  const clienteId = exigirClienteAutenticado(req, res);
  if (!clienteId) return;

  const destinos =
    normalizarDestinosContrato(destinosPorCliente?.[clienteId] || []);

  return res.json(destinos);
});

app.post("/destinos", (req, res) => {
  const clienteId = exigirClienteAutenticado(req, res);
  if (!clienteId) return;

  const destinos = normalizarDestinosContrato(req.body);

  if (!Array.isArray(destinos)) {
    return res.status(400).json({
      ok: false,
      erro: "Formato inválido"
    });
  }

  destinosPorCliente[clienteId] = destinos;

  salvarDestinosClientes();

  return res.json({
    ok: true,
    destinos: destinosPorCliente[clienteId]
  });
});

app.delete("/destinos/:id", (req, res) => {
  const clienteId = getClienteId(req);

  const { id } = req.params;

  destinosPorCliente[clienteId] =
    (normalizarDestinosContrato(destinosPorCliente?.[clienteId] || []))
      .filter(d => d.id !== id);

  salvarDestinosClientes();

  return res.json({
    ok: true
  });
});

// ================= AUTOMAÇÃO POR CLIENTE =================

app.get("/automacao/status", (req, res) => {
  const clienteId = getClienteId(req);

  if (!clienteId) {
    return res.status(401).json({
      ok: false,
      erro: "Usuário não identificado"
    });
  }

  const configCliente = configsPorCliente?.[clienteId] || {};
  const configFinal = {
    ...config,
    ...configCliente
  };

  const usuario = usuarios.find(
    u => String(u.id) === String(clienteId)
  );

  const itensCliente = fila.filter(o =>
    String(o.clienteId || "admin") === String(clienteId)
  );

  const hojeBR = new Date().toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });

  function dataEnvioOferta(oferta = {}) {
    const valor = oferta.enviadoEm || oferta.dataEnvio || "";
    if (!valor) return null;

    const dataDireta = new Date(valor);
    if (!Number.isNaN(dataDireta.getTime())) return dataDireta;

    const partes = String(valor).match(
      /(\d{2})\/(\d{2})\/(\d{4})(?:,?\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/
    );

    if (!partes) return null;

    const [, dia, mes, ano, hora = "00", minuto = "00", segundo = "00"] = partes;
    const data = new Date(
      Number(ano),
      Number(mes) - 1,
      Number(dia),
      Number(hora),
      Number(minuto),
      Number(segundo)
    );

    return Number.isNaN(data.getTime()) ? null : data;
  }

  function ofertaEnviadaHoje(oferta = {}) {
    const data = dataEnvioOferta(oferta);

    if (data) {
      return data.toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo"
      }) === hojeBR;
    }

    const valor = String(oferta.enviadoEm || oferta.dataEnvio || "");
    return valor.startsWith(hojeBR);
  }

  const enviadas = itensCliente
    .filter(o => o.status === "enviado" && (o.enviadoEm || o.dataEnvio));

  const ultimaOfertaEnviada = enviadas
    .map(oferta => ({
      oferta,
      data: dataEnvioOferta(oferta)
    }))
    .sort((a, b) => {
      const dataA = a.data ? a.data.getTime() : 0;
      const dataB = b.data ? b.data.getTime() : 0;
      return dataB - dataA;
    })[0]?.oferta || null;

  const destinosCliente = destinosPorCliente?.[clienteId];
  const listasDestinos = Array.isArray(destinosCliente)
    ? [destinosCliente]
    : Object.values(destinosCliente || {}).filter(Array.isArray);

  const destinosAtivos = listasDestinos
    .flat()
    .filter(destino => destino?.ativo === true)
    .length;

  const sessoesAtivas = Object.values(sessoesMeta || {})
    .filter(sessao => {
      const id = String(sessao.id || "");

      return (
        id.startsWith(clienteId + "_") ||
        id === clienteId ||
        (clienteId === "admin" && id.startsWith("admin_"))
      );
    })
    .filter(sessao => {
      const id = sessao.id;
      return statusSessao[id] === "open" || statusSessao[id] === "aberto";
    })
    .length;

  return res.json({
    ok: true,
    clienteId,
    ativa: configCliente.automacaoAtiva === true,
    pendentes: itensCliente.filter(o => o.status === "pendente").length,
    retidas: itensCliente.filter(o => o.status === "retida").length,
    erros: itensCliente.filter(o => o.status === "erro").length,
    enviadasHoje: enviadas.filter(ofertaEnviadaHoje).length,
    creditos: usuario?.creditos ?? null,
    sessoesAtivas,
    destinosAtivos,
    ultimoEnvio: ultimaOfertaEnviada?.enviadoEm || ultimaOfertaEnviada?.dataEnvio || null,
    config: {
      intervaloMinutos: configFinal.intervaloMinutos ?? configFinal.intervaloEnvioMinutos ?? null,
      horarioInicio: configFinal.horarioInicio ?? null,
      horarioFim: configFinal.horarioFim ?? null,
      pausarMadrugada: configFinal.pausarMadrugada ?? null
    },
    orquestrador: {
      marketplaceAtual: ordemMarketplaces?.[indiceMarketplaceAtual] ?? null,
      sequenciaPonderada: ordemMarketplaces,
      sequenciaCritica: ordemMarketplacesCritica,
      intervaloGlobalMinutos: config.intervaloFarejadorGlobalMinutos ?? 10,
      intervaloAtualMinutos: Math.round(intervaloOrquestradorAtualMs() / 60000),
      farejadorRodando,
      statusMarketplaces: statusOrquestradorMarketplaces
    }
  });
});

app.get("/automacao", (req, res) => {
  const clienteId = getClienteId(req);

  if (!clienteId) {
    return res.status(401).json({
      ok: false,
      erro: "Usuário não identificado"
    });
  }

  configsPorCliente[clienteId] = configsPorCliente[clienteId] || {};

  return res.json({
    ok: true,
    clienteId,
    ativo: configsPorCliente[clienteId].automacaoAtiva === true
  });
});

app.post("/automacao/toggle", (req, res) => {
  const clienteId = getClienteId(req);

  if (!clienteId) {
    return res.status(401).json({
      ok: false,
      erro: "Usuário não identificado"
    });
  }

  configsPorCliente[clienteId] = configsPorCliente[clienteId] || {};

  configsPorCliente[clienteId].automacaoAtiva =
    !configsPorCliente[clienteId].automacaoAtiva;

  salvarConfigsClientes();

  console.log("[INFO] Automao cliente:", {
    clienteId,
    ativo: configsPorCliente[clienteId].automacaoAtiva
  });

  return res.json({
    ok: true,
    clienteId,
    ativo: configsPorCliente[clienteId].automacaoAtiva
  });
});


app.delete("/fila/item/:id", (req, res) => {
  const clienteId = getClienteId(req);
  const id = req.params.id;

  const index = fila.findIndex(item =>
    String(item.id) === String(id) &&
    String(item.clienteId || "admin") === String(clienteId)
  );

  if (index === -1) {
    return res.status(404).json({
      ok: false,
      erro: "Item não encontrado para este usuário"
    });
  }

  fila.splice(index, 1);
  salvarFila(clienteId);

  return res.json({
    ok: true,
    message: "Item removido da fila"
  });
});

app.delete("/fila/limpar", (req, res) => {
  const clienteId = getClienteId(req);
  const status = req.query.status;

  const antes = fila.length;

  fila = fila.filter(item => {
    const dono = String(item.clienteId || "admin");

    const mesmoCliente =
      dono === String(clienteId);

    const mesmoStatus =
      status
        ? String(item.status) === String(status)
        : true;

    return !(mesmoCliente && mesmoStatus);
  });

  const removidos = antes - fila.length;

  salvarFila(clienteId);

  logOptimus("FILA", "Limpeza da fila", {
    clienteId,
    status: status || "todos",
    removidos
  });

  return res.json({
    ok: true,
    clienteId,
    status: status || "todos",
    removidos
  });
});

app.delete("/fila/:index", (req, res) => {
  const index = Number(req.params.index);
  const clienteId = getClienteId(req);

  if (isNaN(index) || index < 0 || index >= fila.length) {
    return res.status(400).send("Índice inválido");
  }

  const oferta = fila[index];

  if ((oferta.clienteId || "admin") !== clienteId) {
    return res.status(403).json({
      ok: false,
      erro: "Sem permissão para remover esta oferta"
    });
  }

  const removido = fila.splice(index, 1);

  salvarFila(clienteId);

  logOptimus("FILA", "Oferta removida", {
    clienteId,
    titulo: removido[0]?.nome || removido[0]?.titulo
  });

  res.json({
    ok: true,
    mensagem: "Removido com sucesso"
  });
});

app.post("/fila/:id/reprocessar", (req, res) => {
  const id = String(req.params.id || "").trim();
  const clienteId = getClienteId(req);

  const oferta = fila.find(item =>
    String(item.id || "") === id &&
    String(item.clienteId || "admin") === String(clienteId)
  );

  if (!oferta) {
    return res.status(404).json({
      ok: false,
      erro: "Oferta não encontrada"
    });
  }

  oferta.status = "pendente";
  oferta.statusDetalhe = "Reprocessada manualmente";
  delete oferta.motivoRetencao;
  delete oferta.retidaEm;
  delete oferta.proximaTentativaEnvioEm;
  oferta.reprocessadaEm = new Date().toISOString();

  salvarFila(clienteId);

  logOptimus("FILA", "Reprocessada manualmente", {
    clienteId,
    id,
    titulo: oferta.titulo || oferta.nome || ""
  });

  return res.json({
    ok: true,
    mensagem: "Oferta reprocessada manualmente",
    oferta
  });
});

// ============== POST FILA INDEX ===========================

app.post("/fila/item/:id/enviar-agora", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const clienteId = getClienteId(req);
  const oferta = fila.find(item =>
    String(item.id || "") === id &&
    String(item.clienteId || "admin") === String(clienteId)
  );

  if (!oferta) {
    return res.status(404).json({
      ok: false,
      erro: "Oferta nao encontrada"
    });
  }

  const resultado = await enviarOfertaAgoraDireto(oferta, clienteId);
  return res.status(resultado.statusHttp || 200).json(resultado);
});

app.post("/fila/:index/enviar-agora", async (req, res) => {
  const index = Number(req.params.index);
const clienteIdReq = getClienteId(req);

const filaCliente = fila.filter(o =>
  String(o.clienteId || "admin") === String(clienteIdReq)
);
const idBody = String(req.body?.id || req.body?.ofertaId || "").trim();

if (isNaN(index) || index < 0 || index >= filaCliente.length) {
  return res.status(400).json({
    ok: false,
    erro: "Índice inválido"
  });
}

let oferta = idBody
  ? filaCliente.find(item => String(item.id || "") === idBody)
  : filaCliente[index];

if (!oferta || oferta.status !== "pendente") {
  const pendentesCliente = filaCliente.filter(item => item.status === "pendente");
  oferta = pendentesCliente[index] || oferta;
}

const indexReal = fila.findIndex(o => o === oferta);

  if ((oferta.clienteId || "admin") !== clienteIdReq) {
    return res.status(403).json({
      ok: false,
      erro: "Sem permissão para enviar esta oferta"
    });
  }

  logOptimus("FILA", "Enviar Agora solicitado", {
    clienteId: clienteIdReq,
    titulo: oferta.titulo || oferta.nome,
    preco: oferta.precoAtual || oferta.preco,
    imagem: !!oferta.imagem,
    marketplace: oferta.marketplace,
    categoria: oferta.categoria
  });

if (indexReal >= 0) {
  fila.splice(indexReal, 1);
  filaOfertas.adicionarOfertaInicioFila(fila, oferta, {
    clienteId: clienteIdReq,
    origem: oferta.origem || "enviar_agora",
    logger: console
  });
}

  const resultado = await enviarOfertaAgoraDireto(oferta, clienteIdReq);
  return res.status(resultado.statusHttp || 200).json(resultado);
});

app.get("/config", (req, res) => {
  const clienteId = getClienteId(req);
  const isAdmin = isAdminMaster(req);

  if (isAdmin) {
    return res.json({
      ok: true,
      clienteId,
      config
    });
  }

  const configCliente = configsPorCliente?.[clienteId] || {};

  return res.json({
    ok: true,
    clienteId,
    config: {
      ...config,
      ...configCliente,
      marketplaces: {
        ...config.marketplaces,
        ...(configCliente.marketplaces || {})
      }
    }
  });
});

app.get("/minha-config", (req, res) => {
  const clienteId = getClienteId(req);
  const configCliente = getConfigCliente(clienteId);

  return res.json({
    ok: true,
    clienteId,
    config: {
      ...config,
      ...configCliente
    }
  });
});

app.get("/admin/usuarios", (req, res) => {
  if (!isAdminMaster(req)) {
    return res.status(403).json({
      ok: false,
      erro: "Acesso restrito ao Admin Master"
    });
  }

  return res.json({
    ok: true,
    usuarios
  });
});

app.get("/admin/planos", (req, res) => {
  if (!isAdminMaster(req)) {
    return res.status(403).json({
      ok: false,
      erro: "Acesso restrito ao Admin Master"
    });
  }

return res.json({
  ok: true,
  planos,
  lista: Object.values(planos || {})
 });
});

app.post("/admin/planos", (req, res) => {
  if (!isAdminMaster(req)) {
    return res.status(403).json({
      ok: false,
      erro: "Acesso restrito ao Admin Master"
    });
  }

  const body = req.body || {};

  if (!body.nome) {
    return res.status(400).json({
      ok: false,
      erro: "Nome do plano obrigatório"
    });
  }

  const nomePlano = String(body.nome || "").trim();
  const planoAnterior =
    planos[nomePlano] ||
    planos[nomePlano.toLowerCase()] ||
    {};
  const limitesBody = body.limites || {};
  const recursosBody = body.recursos || {};
  const limitesAnteriores = planoAnterior.limites || {};
  const recursosAnteriores = planoAnterior.recursos || {};

  const numeroPlano = (valor, fallback = 0) => {
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : fallback;
  };

  const booleanPlano = (chave, fallback = false) => {
    if (Object.prototype.hasOwnProperty.call(recursosBody, chave)) {
      return !!recursosBody[chave];
    }

    return !!fallback;
  };

  planos[nomePlano] = {
    nome: nomePlano,
    preco: String(body.preco ?? planoAnterior.preco ?? ""),

    marketplaces: Array.isArray(body.marketplaces)
      ? body.marketplaces
      : Array.isArray(planoAnterior.marketplaces)
        ? planoAnterior.marketplaces
        : [],

    limites: {
      sessoes: numeroPlano(limitesBody.sessoes, numeroPlano(limitesAnteriores.sessoes, 0)),
      destinos: numeroPlano(limitesBody.destinos, numeroPlano(limitesAnteriores.destinos, 0)),
      enviosDia: numeroPlano(limitesBody.enviosDia, numeroPlano(limitesAnteriores.enviosDia, 0)),
      creditos: numeroPlano(
        limitesBody.creditos ?? limitesBody.creditosMes ?? body.creditos,
        numeroPlano(limitesAnteriores.creditos ?? limitesAnteriores.creditosMes, 0)
      )
    },

    recursos: {
      linkOptimus: booleanPlano("linkOptimus", recursosAnteriores.linkOptimus),
      analytics: booleanPlano("analytics", recursosAnteriores.analytics),
      cupomInteligente: booleanPlano("cupomInteligente", recursosAnteriores.cupomInteligente),
      campanhas: booleanPlano("campanhas", recursosAnteriores.campanhas),
      mensageiro: booleanPlano("mensageiro", recursosAnteriores.mensageiro),
      templatePersonalizado: booleanPlano("templatePersonalizado", recursosAnteriores.templatePersonalizado),
      whatsapp: booleanPlano("whatsapp", recursosAnteriores.whatsapp),
      telegram: booleanPlano("telegram", recursosAnteriores.telegram),
      automacao: booleanPlano("automacao", recursosAnteriores.automacao),
      social: booleanPlano("social", recursosAnteriores.social)
    },

    atualizadoEm: new Date().toISOString()
  };

  salvarPlanos();

  return res.json({
    ok: true,
    plano: planos[nomePlano]
  });
});

app.delete("/admin/planos/:nome", (req, res) => {
  if (!isAdminMaster(req)) {
    return res.status(403).json({
      ok: false,
      erro: "Acesso restrito ao Admin Master"
    });
  }

  const { nome } = req.params;

  if (!planos[nome]) {
    return res.status(404).json({
      ok: false,
      erro: "Plano não encontrado"
    });
  }

  const usuariosUsandoPlano = usuarios.filter(
    u => String(u.plano).toLowerCase() === String(nome).toLowerCase()
  );

  if (usuariosUsandoPlano.length > 0) {
    return res.status(400).json({
      ok: false,
      erro: "Não é possível excluir plano em uso por usuários"
    });
  }

  delete planos[nome];

  salvarPlanos();

  return res.json({
    ok: true,
    mensagem: "Plano excluído com sucesso"
  });
});

app.delete("/admin/usuarios/:id", (req, res) => {
  if (!isAdminMaster(req)) {
    return res.status(403).json({
      ok: false,
      erro: "Acesso restrito ao Admin Master"
    });
  }

  const { id } = req.params;

  if (id === "admin") {
    return res.status(400).json({
      ok: false,
      erro: "Não é possível excluir o Admin Master principal"
    });
  }

  const antes = usuarios.length;

  usuarios = usuarios.filter(u => String(u.id) !== String(id));

  if (usuarios.length === antes) {
    return res.status(404).json({
      ok: false,
      erro: "Usuário não encontrado"
    });
  }

  delete configsPorCliente[id];
  delete destinosPorCliente[id];
  delete integracoesPorCliente[id];

  salvarUsuarios();
  salvarConfigsClientes();
  salvarDestinosClientes();
  salvarIntegracoesPersistidas();

  return res.json({
    ok: true,
    mensagem: "Usuário excluído com sucesso",
    id
  });
});

app.post("/admin/usuarios", (req, res) => {
  if (!isAdminMaster(req)) {
    return res.status(403).json({
      ok: false,
      erro: "Acesso restrito ao Admin Master"
    });
  }

  const body = req.body || {};

  if (!body.nome || !body.email || !body.senha) {
    return res.status(400).json({
      ok: false,
      erro: "Nome, email e senha obrigatórios"
    });
  }

  const existe = usuarios.find(
    u => u.email.toLowerCase() === body.email.toLowerCase()
  );

  if (existe) {
    return res.status(400).json({
      ok: false,
      erro: "Email já cadastrado"
    });
  }

  const novoUsuario = {
    id: gerarId(),
    nome: body.nome,
    email: body.email.toLowerCase(),
    senha: body.senha,
    papel: body.papel || "cliente",
    plano: body.plano || "free",
    creditos: Number(body.creditos || 0),
    ativo: true,
    criadoEm: new Date().toISOString()
  };

  usuarios.push(novoUsuario);

  salvarUsuarios();

  return res.json({
    ok: true,
    usuario: novoUsuario
  });
});

app.put("/admin/usuarios/:id", (req, res) => {
  if (!isAdminMaster(req)) {
    return res.status(403).json({
      ok: false,
      erro: "Acesso restrito"
    });
  }

  const { id } = req.params;

  const usuario = usuarios.find(
    u => String(u.id) === String(id)
  );

  if (!usuario) {
    return res.status(404).json({
      ok: false,
      erro: "Usuário não encontrado"
    });
  }

  const body = req.body || {};

  usuario.nome = body.nome || usuario.nome;

  usuario.email =
    (body.email || usuario.email).toLowerCase();

  if (body.senha) {
    usuario.senha = body.senha;
  }

  usuario.plano = body.plano || usuario.plano;

  usuario.papel = body.papel || usuario.papel;

  usuario.creditos = Number(
    body.creditos ?? usuario.creditos ?? 0
  );

  if (typeof body.ativo === "boolean") {
    usuario.ativo = body.ativo;
  }

  usuario.atualizadoEm =
    new Date().toISOString();

  salvarUsuarios();

  return res.json({
    ok: true,
    usuario
  });
});

app.post("/minha-config", (req, res) => {
  const clienteId = getClienteId(req);
  const body = req.body || {};

  configsPorCliente[clienteId] = {
    ...configsPorCliente[clienteId],
    ...body
  };

  salvarConfigsClientes();

  return res.json({
    ok: true,
    clienteId,
    config: configsPorCliente[clienteId]
  });
});

app.post("/config", (req, res) => {

  const clienteId = getClienteId(req);

  if (!clienteId) {
    return res.status(401).json({
      ok: false,
      erro: "Cliente não identificado"
    });
  }

  const body = req.body || {};

  configsPorCliente[clienteId] =
    configsPorCliente[clienteId] || {};

  const configCliente =
    configsPorCliente[clienteId];

  const isAdmin =
    isAdminMaster(req);

  // ================= MARKETPLACES =================

  configCliente.marketplaces = {
    ...(configCliente.marketplaces || {})
  };

  if (body.marketplaces) {

    for (const [nome, dados] of Object.entries(body.marketplaces)) {

      configCliente.marketplaces[nome] =
        configCliente.marketplaces[nome] || {};

      // usuário comum só liga/desliga
      configCliente.marketplaces[nome].ativo =
        dados?.ativo === true;

      // admin controla farejo global
      if (isAdmin) {

    config.marketplaces[nome] =
    config.marketplaces[nome] || {};

    if (dados.ativo != null) {
    config.marketplaces[nome].ativo =
    dados.ativo === true;
    }

        if (dados.intervaloFarejoMinutos != null) {
          config.marketplaces[nome].intervaloFarejoMinutos =
            Number(dados.intervaloFarejoMinutos);
        }

        if (dados.limitePorRodada != null) {
          config.marketplaces[nome].limitePorRodada =
            Number(dados.limitePorRodada);
        }

        if (dados.descontoMinimo != null) {
          config.marketplaces[nome].descontoMinimo =
            Number(dados.descontoMinimo);
        }

        if (dados.precoMinimo != null) {
          config.marketplaces[nome].precoMinimo =
            Number(dados.precoMinimo);
        }

      }
    }
  }

if (body.horarioInicio != null) {
  configCliente.horarioInicio = body.horarioInicio;

  if (isAdmin) {
    config.horarioInicio = body.horarioInicio;
  }
}

if (body.horarioFim != null) {
  configCliente.horarioFim = body.horarioFim;

  if (isAdmin) {
    config.horarioFim = body.horarioFim;
  }
}

if (body.pausarMadrugada != null) {
  configCliente.pausarMadrugada =
    body.pausarMadrugada === true;

  if (isAdmin) {
    config.pausarMadrugada =
      body.pausarMadrugada === true;
  }
}

  // ================= CONFIG CLIENTE =================

 if (body.automacaoAtiva != null) {
  configCliente.automacaoAtiva =
    body.automacaoAtiva === true;

  if (isAdmin) {
    config.automacaoAtiva =
      body.automacaoAtiva === true;
  }
}

  if (body.intervaloMinutos != null) {
    configCliente.intervaloMinutos =
      Number(body.intervaloMinutos);
  }

  if (body.intervaloEnvioMinutos != null) {
    configCliente.intervaloEnvioMinutos =
      Number(body.intervaloEnvioMinutos);
  }

  if (body.horarioInicio) {
    configCliente.horarioInicio =
      body.horarioInicio;
  }

  if (body.horarioFim) {
    configCliente.horarioFim =
      body.horarioFim;
  }

  salvarConfigsClientes();
  salvarConfig();

  return res.json({
    ok: true,
    clienteId,
    configCliente,
    configGlobal: isAdmin ? config : undefined
  });
});

// ===================== FUNCAO ADMIN MASTER ==============================

function isAdminMaster(req) {
  const clienteId = getClienteId(req);
  const usuario = usuarios.find(u => u.id === clienteId);

  return usuario?.papel === "admin_master";
}


// ===================== FUNCAO USUARIO ATUAL ============================

function getUsuarioAtual(req) {
  const clienteId = getClienteId(req);
  return usuarios.find(u => u.id === clienteId) || null;
}

function getPlanoUsuario(req) {
  const usuario = getUsuarioAtual(req);

  if (!usuario) return null;

  const nomePlano =
    String(usuario.plano || "")
      .trim()
      .toLowerCase();

  const planoEncontrado = Object.values(planos).find(
    p =>
      String(p.nome || "")
        .trim()
        .toLowerCase() === nomePlano
  );

  return planoEncontrado || null;
}

// ===================== FUNCAO RECURSOS ============================

function usuarioTemRecurso(req, recurso) {
  const usuario = getUsuarioAtual(req);

  if (!usuario) return false;

  if (usuario.papel === "admin_master") {
    return true;
  }

  const plano = getPlanoUsuario(req);

  return plano?.recursos?.[recurso] === true;
}

function clienteTemRecursoMensageiro(clienteId = "admin") {
  const usuario = usuarios.find(u => u.id === clienteId) || null;

  if (!usuario) return clienteId === "admin";
  if (usuario.papel === "admin_master") return true;

  const nomePlano = String(usuario.plano || "").trim().toLowerCase();
  const plano = Object.values(planos || {}).find(p =>
    String(p.nome || "").trim().toLowerCase() === nomePlano
  );

  return plano?.recursos?.mensageiro === true;
}

// ======================== FUNCAO GET INTEGRACOES ========================

function normalizarMarketplaceIntegracao(marketplace = "") {
  const mp = normalizarTexto(marketplace || "");
  const aliases = {
    ml: "mercadolivre",
    meli: "mercadolivre",
    mercadolivrebr: "mercadolivre",
    mercadolivre: "mercadolivre",
    ali: "aliexpress",
    aliexpress: "aliexpress",
    aliexpressbr: "aliexpress",
    feedawin: "awin",
    feedkabum: "awin"
  };

  return aliases[mp] || mp;
}

function chavesPossiveisIntegracao(marketplace = "") {
  const bruto = String(marketplace || "").trim();
  const lower = bruto.toLowerCase();
  const mp = normalizarMarketplaceIntegracao(bruto);
  const chaves = new Set([mp, lower, bruto]);

  if (mp === "mercadolivre") {
    ["mercadolivre", "mercado_livre", "mercadoLivre", "ml", "meli"].forEach(k => chaves.add(k));
  }

  if (mp === "aliexpress") {
    ["aliexpress", "ali_express", "aliExpress"].forEach(k => chaves.add(k));
  }

  if (mp === "awin") {
    ["awin", "feed_awin", "feedAwin", "feedkabum", "feed_kabum"].forEach(k => chaves.add(k));
  }

  return [...chaves].filter(Boolean);
}

function getIntegracaoCliente(clienteId = "admin", marketplace = "") {
  const cid = String(clienteId || "admin").trim() || "admin";
  const integracoesCliente = integracoesPorCliente?.[cid] || null;

  if (!integracoesCliente) return null;

  for (const chave of chavesPossiveisIntegracao(marketplace)) {
    if (integracoesCliente[chave]) {
      return integracoesCliente[chave];
    }
  }

  return null;
}

// ======================== FUNCAO GERAR ID ===============================

function gerarId() {
  return "user_" + Math.random().toString(36).substring(2, 10);
}


const JWT_SECRET = process.env.JWT_SECRET || "segredo";

// ======================== FUNCAO CLIENTE ID =============================

function getClienteId(req) {
  if (req.clienteId) return req.clienteId;

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) return "admin";

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded.clienteId || "admin";
  } catch {
    return "admin";
  }
}

function exigirClienteAutenticado(req, res) {
  if (req.clienteId) return req.clienteId;

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({
      ok: false,
      erro: "Cliente não autenticado"
    });
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const clienteId = decoded.clienteId || "";

    if (!clienteId) {
      res.status(401).json({
        ok: false,
        erro: "Cliente não autenticado"
      });
      return null;
    }

    req.clienteId = clienteId;
    return clienteId;
  } catch {
    res.status(401).json({
      ok: false,
      erro: "Cliente não autenticado"
    });
    return null;
  }
}

// ============ FUNCAO AUTH ===============================================

function auth(req, res, next) {

  if (req.method === "OPTIONS") {
    return next();
  }

  if (
    req.path === "/" ||
    req.path === "/login" ||
    (req.method === "GET" && req.path === "/branding") ||
    (req.method === "GET" && req.path === "/social/meta/callback") ||
    (req.method === "GET" && req.path === "/social/instagram/callback") ||
    req.path === "/social/instagram/webhook" ||
    req.path === "/kabum/importar" ||
    req.path === "/kabum/importar-teste" ||
    req.path === "/conectar" ||
    req.path.startsWith("/qr") ||
    req.path.startsWith("/status") ||
    req.path.startsWith("/reset")
  ) {
    return next();
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ erro: "Token inválido" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const clienteId = decoded.clienteId || "admin";

    const usuarioExiste = usuarios.find(u =>
      String(u.id) === String(clienteId)
    );

    if (!usuarioExiste || usuarioExiste.ativo === false) {
      return res.status(401).json({
        ok: false,
        erro: "Usuário não existe ou foi desativado"
      });
    }

    req.usuario = usuarioExiste;
    req.clienteId = clienteId;

    next();
  } catch {
    return res.status(401).json({ erro: "Não autorizado" });
  }
}

carregarConfig();


app.use(auth);
app.get("/admin/config/links-optimus", responderAdminConfigLinksOptimus);
app.put("/admin/config/links-optimus", salvarAdminConfigLinksOptimus);

function exigirAdminMasterEngine(req, res) {
  if (req.usuario?.papel !== "admin_master") {
    res.status(403).json({
      ok: false,
      erro: "Acesso restrito ao admin_master"
    });
    return false;
  }

  return true;
}

app.get("/engine/eventos", async (req, res) => {
  if (!exigirAdminMasterEngine(req, res)) return;

  try {
    const resultado = await consultarEventosEngine({
      marketplace: req.query.marketplace || "",
      origem: req.query.origem || "",
      grupoId: req.query.grupoId || "",
      limit: req.query.limit || ""
    });

    return res.status(resultado.ok ? 200 : 503).json(resultado);
  } catch (e) {
    console.log("[ENGINE-AUDITORIA-CONSULTA]", {
      rota: "/engine/eventos",
      ok: false,
      erro: e.message
    });
    return res.status(500).json({ ok: false, erro: e.message });
  }
});

app.get("/engine/jobs", async (req, res) => {
  if (!exigirAdminMasterEngine(req, res)) return;

  try {
    const resultado = await consultarJobsEngine({
      clienteId: req.query.clienteId || "",
      marketplace: req.query.marketplace || "",
      status: req.query.status || "",
      limit: req.query.limit || ""
    });

    return res.status(resultado.ok ? 200 : 503).json(resultado);
  } catch (e) {
    console.log("[ENGINE-AUDITORIA-CONSULTA]", {
      rota: "/engine/jobs",
      ok: false,
      erro: e.message
    });
    return res.status(500).json({ ok: false, erro: e.message });
  }
});

app.get("/engine/ofertas", async (req, res) => {
  if (!exigirAdminMasterEngine(req, res)) return;

  try {
    const resultado = await consultarOfertasEngine({
      marketplace: req.query.marketplace || "",
      clienteId: req.query.clienteId || "",
      status: req.query.status || "",
      limit: req.query.limit || ""
    });

    return res.status(resultado.ok ? 200 : 503).json(resultado);
  } catch (e) {
    console.log("[ENGINE-AUDITORIA-CONSULTA]", {
      rota: "/engine/ofertas",
      ok: false,
      erro: e.message
    });
    return res.status(500).json({ ok: false, erro: e.message });
  }
});
app.get("/engine/resumo", async (req, res) => {
  if (!exigirAdminMasterEngine(req, res)) return;

  try {
    const resultado = await consultarResumoEngine();
    return res.status(resultado.ok ? 200 : 503).json(resultado);
  } catch (e) {
    console.log("[ENGINE-AUDITORIA-CONSULTA]", {
      rota: "/engine/resumo",
      ok: false,
      erro: e.message
    });
    return res.status(500).json({ ok: false, erro: e.message });
  }
});



function listarClientesValidosEngineProcessor() {
  try {
    return Array.isArray(usuarios)
      ? usuarios.map(usuario => String(usuario?.id || "").trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

app.post("/engine/processar-pendentes", async (req, res) => {
  if (!exigirAdminMasterEngine(req, res)) return;

  try {
    const resultado = await processarJobsPendentesEngine({
      limite: req.body?.limite || 20,
      clientesValidos: listarClientesValidosEngineProcessor()
    });

    return res.status(resultado.ok ? 200 : 503).json(resultado);
  } catch (e) {
    console.log("[ENGINE-PROCESSADOR-ERRO]", {
      rota: "/engine/processar-pendentes",
      erro: e.message
    });
    return res.status(500).json({
      ok: false,
      processados: 0,
      diagnosticados: 0,
      erros: 1,
      erro: e.message
    });
  }
});

function listarMarketplacesAtivosEngineProcessor() {
  const mapa = {};

  try {
    for (const usuario of Array.isArray(usuarios) ? usuarios : []) {
      const clienteId = String(usuario?.id || "").trim();
      if (!clienteId) continue;
      const configCliente = configsPorCliente?.[clienteId] || {};
      mapa[clienteId] = configCliente.marketplaces || {};
    }
  } catch {}

  return mapa;
}

app.post("/engine/validar-jobs", async (req, res) => {
  if (!exigirAdminMasterEngine(req, res)) return;

  try {
    const resultado = await validarJobsDiagnosticadosEngine({
      limite: req.body?.limite || 20,
      clientesValidos: listarClientesValidosEngineProcessor(),
      integracoesPorCliente,
      marketplacesAtivosPorCliente: listarMarketplacesAtivosEngineProcessor()
    });

    return res.status(resultado.ok ? 200 : 503).json(resultado);
  } catch (e) {
    console.log("[ENGINE-PROCESSADOR-ERRO]", {
      rota: "/engine/validar-jobs",
      erro: e.message
    });
    return res.status(500).json({
      ok: false,
      processados: 0,
      erro_validacao: 1,
      erro: e.message
    });
  }
});

app.post("/engine/limpar-jobs-antigos", async (req, res) => {
  if (!exigirAdminMasterEngine(req, res)) return;

  try {
    const resultado = await limparJobsAntigosEngine({
      antesDoId: req.body?.antesDoId,
      status: req.body?.status || []
    });

    return res.status(resultado.ok ? 200 : 400).json(resultado);
  } catch (e) {
    console.log("[ENGINE-JOB-CLIENTE-ERRO]", {
      rota: "/engine/limpar-jobs-antigos",
      motivo: "limpeza_teste_clientes_antigos_falhou",
      erro: e.message
    });

    return res.status(500).json({
      ok: false,
      motivo: "limpeza_teste_clientes_antigos_falhou",
      erro: e.message,
      afetados: 0,
      porStatus: {},
      porCliente: {}
    });
  }
});
app.post("/engine/importar-prontos", async (req, res) => {
  if (!exigirAdminMasterEngine(req, res)) return;

  try {
    const resultado = await importarJobsProntosEngine({
      limite: req.body?.limite || 10,
      marketplace: req.body?.marketplace || "",
      deps: {
        importarMercadoLivre,
        importarAmazon,
        getIntegracaoCliente,
        gerarLinkAfiliadoMercadoLivre,
        resolverLinkOriginalRadar,
        importarProdutoKabumViaAwin,
        gerarDeepLinkAwin
      }
    });

    return res.status(resultado.ok ? 200 : 503).json(resultado);
  } catch (e) {
    console.log("[ENGINE-IMPORTER-ERRO]", {
      rota: "/engine/importar-prontos",
      erro: e.message
    });
    return res.status(500).json({
      ok: false,
      processados: 0,
      ofertaCriada: 0,
      erros: 1,
      motivos: { erro_importacao: 1 },
      erro: e.message
    });
  }
});
app.post("/engine/distribuir-ofertas", async (req, res) => {
  if (!exigirAdminMasterEngine(req, res)) return;

  try {
    const resultado = await distribuirOfertasEngine({
      limite: req.body?.limite || 10,
      marketplace: req.body?.marketplace || "",
      clienteId: req.body?.clienteId || "",
      contexto: {
        clientesValidos: listarClientesValidosEngineProcessor(),
        configsPorCliente,
        destinosPorCliente,
        configGlobal: config,
        marketplacesAtivosPorCliente: listarMarketplacesAtivosEngineProcessor()
      },
      deps: {
        readClienteJson,
        writeClienteJson,
        getClientePath,
        adicionarOfertaNaFilaGlobal: adicionarOfertaNaFilaGlobalEngine
      }
    });

    return res.status(resultado.ok ? 200 : 503).json(resultado);
  } catch (e) {
    console.log("[ENGINE-DISTRIBUIDOR-ERRO]", {
      rota: "/engine/distribuir-ofertas",
      erro: e.message
    });
    return res.status(500).json({
      ok: false,
      processadas: 0,
      adicionadasFila: 0,
      retidas: 0,
      erros: 1,
      motivos: { erro_distribuicao: 1 },
      erro: e.message
    });
  }
});
app.get("/fila/inteligencia/status", (req, res) => {
  try {
    const clienteId = getClienteId(req);

    if (req.usuario?.papel === "admin_master") {
      const clientes = Array.from(new Set([
        clienteId,
        ...usuarios.map(usuario => usuario?.id).filter(Boolean),
        ...listClientes()
      ]));

      const resultados = clientes.map(id => avaliarSaudeFilaCliente(id));

      return res.json({
        ok: true,
        modo: "admin_master",
        totalClientes: resultados.length,
        resultados
      });
    }

    return res.json({
      ok: true,
      modo: "cliente",
      resultado: avaliarSaudeFilaCliente(clienteId)
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.post("/fila/inteligencia/abastecer", async (req, res) => {
  try {
    const clienteToken = getClienteId(req);
    const clienteSolicitado = String(req.body?.clienteId || clienteToken || "admin");
    const clienteId =
      req.usuario?.papel === "admin_master"
        ? clienteSolicitado
        : clienteToken;
    const simulado = req.body?.simulado === true;

    return res.json(await abastecerFilaSeNecessario(clienteId, { simulado }));
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

function lerFilasRadarSomenteLeitura() {
  const itens = [];
  const vistos = new Set();

  function adicionar(oferta = {}, clienteIdOrigem = "") {
    if (!oferta || typeof oferta !== "object") return;

    const origemClienteId = String(
      oferta.clienteId ||
      clienteIdOrigem ||
      "admin"
    );

    const chave = [
      origemClienteId,
      oferta.id || "",
      oferta.linkAfiliado || oferta.link || "",
      normalizarTexto(oferta.titulo || oferta.nome || "")
    ].join("|");

    if (vistos.has(chave)) return;

    vistos.add(chave);
    itens.push({
      ...oferta,
      origemClienteId
    });
  }

  for (const oferta of fila || []) {
    adicionar(oferta, oferta?.clienteId || "admin");
  }

  for (const clienteIdOrigem of listClientes()) {
    try {
      const dados = readClienteJson(clienteIdOrigem, "fila.json", []);

      if (Array.isArray(dados)) {
        for (const oferta of dados) {
          adicionar(oferta, clienteIdOrigem);
        }
      }
    } catch (e) {
      console.log("[RADAR] Falha ao ler fila do cliente:", {
        clienteId: clienteIdOrigem,
        erro: e.message
      });
    }
  }

  if (fs.existsSync(FILA_FILE)) {
    try {
      const dadosLegados = JSON.parse(fs.readFileSync(FILA_FILE, "utf8") || "[]");

      if (Array.isArray(dadosLegados)) {
        for (const oferta of dadosLegados) {
          adicionar(oferta, oferta?.clienteId || "admin");
        }
      }
    } catch (e) {
      console.log("[RADAR] Falha ao ler fila legada:", e.message);
    }
  }

  return itens;
}

function radarConfigPadrao() {
  return {
    monitoramentoAtivo: true,
    sessaoWhatsappId: "",
    gruposMonitorados: [],
    sessoesWhatsappMonitoradas: [],
    telegramMonitorados: [],
    monitoramento: {
      horaInicial: "07:00",
      horaFinal: "00:50",
      intervaloMinutos: 6,
      maxPorDia: 180
    },
    categoriasPermitidas: [],
    templateMidia: {
      template: "padrao_optimus",
      tipoMidia: "imagem"
    }
  };
}

function getRadarConfigFile(clienteId = "admin") {
  return path.join(getClienteDir(clienteId), "radar-config.json");
}

function getRadarHistoricoFile(clienteId = "admin") {
  return path.join(getClienteDir(clienteId), "radar-historico.json");
}

function getRadarPreviewFile(clienteId = "admin") {
  return path.join(getClienteDir(clienteId), "radar-preview.json");
}

function getRadarDescartesFile(clienteId = "admin") {
  return path.join(getClienteDir(clienteId), "radar-descartes.json");
}

function getRadarTratadasFile(clienteId = "admin") {
  return path.join(getClienteDir(clienteId), "radar-tratadas.json");
}

function lerHistoricoRadar(clienteId = "admin") {
  try {
    const dados = readClienteJson(clienteId, "radar-historico.json", []);
    return Array.isArray(dados) ? dados : [];
  } catch (e) {
    console.log("[RADAR] Falha ao ler historico:", e.message);
    return [];
  }
}

async function enviarOfertaAgoraDireto(oferta = {}, clienteId = "admin") {
  const configCliente = configsPorCliente?.[clienteId] || config;

  if (!oferta || typeof oferta !== "object") {
    return {
      ok: false,
      statusHttp: 404,
      erro: "Oferta não encontrada"
    };
  }

  const estavaExpirada = ofertaExpiradaParaEnvio(oferta);

  if (estavaExpirada) {
    logOptimus("FILA", "Enviar Agora ignorou expiracao por acao manual", {
      clienteId,
      titulo: oferta.titulo || oferta.nome || "",
      expiraEm: oferta.expiraEm || ""
    });
  }

  const analiseDestinos = analisarDestinosCompativeisFila(clienteId, oferta, configCliente);

  if (!analiseDestinos.compativeis.length) {
    marcarOfertaRetida(oferta, analiseDestinos.motivoRetencao);
    salvarFila(clienteId);

    logOptimus("FILA", "Enviar Agora reteve oferta", {
      clienteId,
      titulo: oferta.titulo || oferta.nome || "",
      motivoRetencao: oferta.motivoRetencao
    });

    return {
      ok: false,
      statusHttp: 409,
      retida: true,
      motivo: oferta.motivoRetencao,
      mensagem: oferta.statusDetalhe,
      oferta
    };
  }

  const usuarioOferta =
    usuarios.find(u => String(u.id) === String(clienteId)) || null;
  const plano = getPlanoPorNome(usuarioOferta?.plano || "free") || {};

  let enviouParaAlgumDestino = false;
  let destinosEnviadosCount = 0;
  let pulouPorHorario = false;
  let pulouPorLimiteDiario = false;
  let ultimoMotivo = "";

  oferta.status = "pendente";
  oferta.statusDetalhe = estavaExpirada
    ? "Envio manual solicitado após expiração"
    : "Envio manual solicitado";
  oferta.erro = "";
  oferta.erroEm = "";
  oferta.proximaTentativaEnvioEm = "";
  oferta.envioManualIgnorouExpiracao = Boolean(estavaExpirada);
  delete oferta.motivoRetencao;
  delete oferta.retidaEm;

  for (const item of analiseDestinos.compativeis) {
    const destino = item.destino;
    const nomeDestino = destinoNomeLog(destino);

    if (!destinoDentroHorario(destino)) {
      logOptimus("DESTINO", "Enviar Agora ignorou horario por acao manual", {
        clienteId,
        destino: nomeDestino
      });
    }

    const limite = destinoLimiteDiarioDisponivel(clienteId, destino);
    if (!limite.ok) {
      pulouPorLimiteDiario = true;
      ultimoMotivo = "limite_diario";
      logOptimus("DESTINO", "Enviar Agora limite diario", {
        clienteId,
        destino: nomeDestino,
        usados: limite.usados,
        limite: limite.limite
      });
      continue;
    }

    const linkOfertaDestino = resolverLinkOfertaPorDestino({
      oferta,
      destino,
      clienteId,
      plano,
      recursos: plano?.recursos,
      configGlobal: config
    });
    const ofertaParaMensagem = linkOfertaDestino.oferta || oferta;

    const mensagem = montarMensagemOferta(ofertaParaMensagem, {
      destino,
      plano,
      clienteId
    });

    const resultadoEnvio = await enviarParaDestinoInteligente(
      destino,
      oferta,
      mensagem,
      clienteId,
      configCliente,
      { ignorarHorario: true, envioManual: true }
    );
    const resultado =
      typeof resultadoEnvio === "object" && resultadoEnvio !== null
        ? resultadoEnvio
        : { enviado: resultadoEnvio === true, motivo: resultadoEnvio === false ? "nao_enviado" : "" };

    if (resultado.enviado === true) {
      enviouParaAlgumDestino = true;
      destinosEnviadosCount += 1;
      controleEnvio[destinoChaveControle(clienteId, destino)] = Date.now();
      logOptimus("ENVIO", "Enviar Agora enviado", {
        clienteId,
        destino: nomeDestino,
        titulo: oferta.titulo || oferta.nome || ""
      });
    } else {
      ultimoMotivo = resultado.motivo || "nao_enviado";
      if (resultado.motivo === "fora_horario") pulouPorHorario = true;
    }
  }

  if (!enviouParaAlgumDestino) {
    oferta.status = "pendente";
    oferta.statusDetalhe = pulouPorHorario
      ? "Aguardando horario do destino"
      : pulouPorLimiteDiario
        ? "Aguardando limite diario do destino"
        : "Nenhum destino confirmou envio manual";
    salvarFila(clienteId);

    return {
      ok: false,
      statusHttp: 409,
      motivo: ultimoMotivo || "nao_enviado",
      mensagem: oferta.statusDetalhe,
      oferta
    };
  }

  ultimoEnvioFila = Date.now();
  oferta.status = "enviado";
  oferta.enviadoEm = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });
  oferta.dataEnvio = oferta.enviadoEm;
  oferta.statusDetalhe = `Enviada manualmente para ${destinosEnviadosCount} destino(s)`;
  oferta.logsEnvio = oferta.logsEnvio || [];
  oferta.logsEnvio.push({
    tipo: "sucesso",
    mensagem: oferta.statusDetalhe,
    data: oferta.enviadoEm
  });

  salvarFila(clienteId);

  return {
    ok: true,
    mensagem: "Envio manual processado",
    destinosEnviados: destinosEnviadosCount,
    oferta
  };
}

function lerPreviewRadar(clienteId = "admin") {
  try {
    const dados = readClienteJson(clienteId, "radar-preview.json", []);
    return Array.isArray(dados) ? dados : [];
  } catch (e) {
    console.log("[RADAR] Falha ao ler preview:", e.message);
    return [];
  }
}

function lerDescartesRadar(clienteId = "admin") {
  try {
    const dados = readClienteJson(clienteId, "radar-descartes.json", { ids: [], chaves: [] });
    return {
      ids: Array.isArray(dados.ids) ? dados.ids.map(String) : [],
      chaves: Array.isArray(dados.chaves) ? dados.chaves.map(String) : []
    };
  } catch (e) {
    console.log("[RADAR] Falha ao ler descartes:", e.message);
    return { ids: [], chaves: [] };
  }
}

function lerTratadasRadar(clienteId = "admin") {
  try {
    const dados = readClienteJson(clienteId, "radar-tratadas.json", { ids: [], chaves: [], itens: [] });
    return {
      ids: Array.isArray(dados.ids) ? dados.ids.map(String) : [],
      chaves: Array.isArray(dados.chaves) ? dados.chaves.map(String) : [],
      itens: Array.isArray(dados.itens) ? dados.itens : []
    };
  } catch (e) {
    console.log("[RADAR] Falha ao ler tratadas:", e.message);
    return { ids: [], chaves: [], itens: [] };
  }
}

function salvarHistoricoRadar(clienteId = "admin", eventos = []) {
  const ultimos = Array.isArray(eventos) ? eventos.slice(-200) : [];
  writeClienteJson(clienteId, "radar-historico.json", ultimos);
}

function salvarPreviewRadar(clienteId = "admin", eventos = []) {
  const ultimos = Array.isArray(eventos) ? eventos.slice(-200) : [];
  writeClienteJson(clienteId, "radar-preview.json", ultimos);
}

function salvarDescartesRadar(clienteId = "admin", descartes = {}) {
  const ids = [...new Set(Array.isArray(descartes.ids) ? descartes.ids.map(String).filter(Boolean) : [])];
  const chaves = [...new Set(Array.isArray(descartes.chaves) ? descartes.chaves.map(String).filter(Boolean) : [])];
  writeClienteJson(clienteId, "radar-descartes.json", {
    ids,
    chaves,
    atualizadoEm: new Date().toISOString()
  });
}

function salvarTratadasRadar(clienteId = "admin", tratadas = {}) {
  const ids = [...new Set(Array.isArray(tratadas.ids) ? tratadas.ids.map(String).filter(Boolean) : [])].slice(-5000);
  const chaves = [...new Set(Array.isArray(tratadas.chaves) ? tratadas.chaves.map(String).filter(Boolean) : [])].slice(-5000);
  const itens = Array.isArray(tratadas.itens) ? tratadas.itens.slice(-1000) : [];

  writeClienteJson(clienteId, "radar-tratadas.json", {
    ids,
    chaves,
    itens,
    atualizadoEm: new Date().toISOString()
  });
}

function resumirMensagemRadar(texto = "") {
  return String(texto || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function numeroRadar(valor = "") {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  const limpo = String(valor || "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const numero = Number(limpo);
  return Number.isFinite(numero) ? numero : 0;
}

function calcularEconomiaRadar(oferta = {}) {
  const atual = numeroRadar(oferta.precoAtual || oferta.preco || oferta.precoFinal || "");
  const antigo = numeroRadar(oferta.precoAntigo || oferta.precoDe || "");
  const economiaValor = antigo > atual && atual > 0 ? Number((antigo - atual).toFixed(2)) : 0;
  const economiaPercentual = economiaValor > 0 && antigo > 0 ? Math.round((economiaValor / antigo) * 100) : 0;

  return {
    economiaValor,
    economiaPercentual
  };
}

function precoChaveRadar(oferta = {}) {
  const numero = numeroRadar(
    oferta.precoAtual ||
    oferta.preco ||
    oferta.precoFinal ||
    oferta.valor ||
    ""
  );

  return numero > 0 ? numero.toFixed(2) : "";
}

function chavesRemocaoRadar(oferta = {}) {
  const titulo = normalizarTexto(oferta.titulo || oferta.nome || "");
  return [
    oferta.id ? `id:${oferta.id}` : "",
    oferta.linkOriginal ? `link:${String(oferta.linkOriginal).toLowerCase()}` : "",
    oferta.linkAfiliado ? `link:${String(oferta.linkAfiliado).toLowerCase()}` : "",
    oferta.link ? `link:${String(oferta.link).toLowerCase()}` : "",
    titulo ? `titulo:${titulo}` : ""
  ].filter(Boolean);
}

function chavesTratamentoRadar(oferta = {}) {
  const titulo = normalizarTexto(oferta.titulo || oferta.nome || "");
  const chaveCanonica = chaveCanonicaRadarOferta(oferta);
  const marketplace = normalizarMarketplaceRadar(
    oferta.marketplace ||
    oferta.mercado ||
    oferta.marketplaceOriginalRadar ||
    ""
  );
  const grupo = normalizarTexto(
    oferta.origemGrupoId ||
    oferta.remoteJid ||
    oferta.grupoId ||
    oferta.origemGrupoNome ||
    ""
  );
  const preco = precoChaveRadar(oferta);
  const links = [
    oferta.linkOriginal,
    oferta.linkResolvidoRadar,
    oferta.linkCapturado,
    oferta.linkAfiliado,
    oferta.linkFinal,
    oferta.link
  ]
    .map(link => String(link || "").trim().toLowerCase())
    .filter(Boolean);

  return [
    oferta.id ? `id:${oferta.id}` : "",
    chaveCanonica ? `canonica:${chaveCanonica}` : "",
    ...links.map(link => `link:${link}`),
    marketplace && titulo && preco ? `produto:${marketplace}|${titulo}|${preco}` : "",
    marketplace && titulo && grupo && preco ? `produto_grupo:${marketplace}|${titulo}|${grupo}|${preco}` : ""
  ].filter(Boolean);
}

function ofertaTratadaRadar(oferta = {}, tratadas = {}) {
  if (!oferta || typeof oferta !== "object") return false;
  if (oferta.radarTratada === true || oferta.jaTratadaRadar === true) return true;

  const statusRadar = normalizarTexto(oferta.statusRadar || "");
  if (["fila", "ignorada", "ignorado", "erro", "descartado", "enviado", "ja_tratada", "repetida"].includes(statusRadar)) {
    return true;
  }

  if (oferta.radarNaFila === true) return true;
  if (
    (oferta.origem === "radar" || oferta.radar === true) &&
    oferta.status === "pendente" &&
    oferta.radarPendenteAnalise !== true &&
    !["novo", "pendente_analise"].includes(statusRadar)
  ) {
    return true;
  }

  const ids = new Set(Array.isArray(tratadas.ids) ? tratadas.ids.map(String) : []);
  const chaves = new Set(Array.isArray(tratadas.chaves) ? tratadas.chaves.map(String) : []);
  if (oferta.id && ids.has(String(oferta.id))) return true;

  return chavesTratamentoRadar(oferta).some(chave => chaves.has(chave));
}

function registrarTratamentoRadar(clienteId = "admin", oferta = {}, statusRadar = "fila") {
  if (!oferta || typeof oferta !== "object") return false;

  const tratadas = lerTratadasRadar(clienteId);
  const ids = new Set(tratadas.ids || []);
  const chaves = new Set(tratadas.chaves || []);
  const agora = new Date().toISOString();

  if (oferta.id) ids.add(String(oferta.id));

  for (const chave of chavesTratamentoRadar(oferta)) {
    chaves.add(chave);
  }

  const itens = Array.isArray(tratadas.itens) ? tratadas.itens : [];
  itens.push({
    id: oferta.id || "",
    idOfertaFila: oferta.idOfertaFila || oferta.id || "",
    statusRadar,
    titulo: oferta.titulo || oferta.nome || "",
    marketplace: oferta.marketplace || oferta.mercado || "",
    origemGrupoId: oferta.origemGrupoId || oferta.remoteJid || oferta.grupoId || "",
    origemGrupoNome: oferta.origemGrupoNome || "",
    origemSessaoId: oferta.origemSessaoId || "",
    cupom: oferta.cupom || "",
    linkOriginal: oferta.linkOriginal || oferta.linkResolvidoRadar || "",
    linkAfiliado: oferta.linkAfiliado || oferta.linkFinal || oferta.link || "",
    dataTratamento: oferta.dataTratamento || agora,
    emFilaEm: oferta.emFilaEm || (statusRadar === "fila" ? agora : "")
  });

  salvarTratadasRadar(clienteId, {
    ids: [...ids],
    chaves: [...chaves],
    itens
  });

  return true;
}

function sincronizarTratadasRadarDeOfertas(clienteId = "admin", ofertas = []) {
  let total = 0;

  for (const oferta of ofertas) {
    if (!oferta || typeof oferta !== "object") continue;
    if (oferta.origem !== "radar" && oferta.radar !== true && oferta.radarNaFila !== true) continue;

    const statusRadar = oferta.statusRadar ||
      (oferta.radarNaFila || oferta.status === "pendente" ? "fila" : normalizarStatusOperacionalRadar(oferta.status || ""));

    if (!["fila", "ignorada", "ignorado", "erro", "descartado", "enviado"].includes(normalizarTexto(statusRadar))) {
      continue;
    }

    if (registrarTratamentoRadar(clienteId, oferta, normalizarTexto(statusRadar) || "fila")) {
      total++;
    }
  }

  return total;
}

function ofertaOcultadaRadar(oferta = {}, descartes = {}) {
  if (oferta.removidaRadar || oferta.ocultadaRadar) return true;
  const ids = new Set(Array.isArray(descartes.ids) ? descartes.ids.map(String) : []);
  const chaves = new Set(Array.isArray(descartes.chaves) ? descartes.chaves.map(String) : []);
  if (oferta.id && ids.has(String(oferta.id))) return true;
  return chavesRemocaoRadar(oferta).some(chave => chaves.has(chave));
}

function registrarDescartesOportunidadesRadar(clienteId = "admin", oportunidades = []) {
  const descartes = lerDescartesRadar(clienteId);
  const ids = new Set(descartes.ids || []);
  const chaves = new Set(descartes.chaves || []);

  for (const oferta of oportunidades) {
    if (!oferta || typeof oferta !== "object") continue;
    if (oferta.id) ids.add(String(oferta.id));
    for (const chave of chavesRemocaoRadar(oferta)) {
      chaves.add(chave);
    }
  }

  salvarDescartesRadar(clienteId, {
    ids: [...ids],
    chaves: [...chaves]
  });

  return oportunidades.length;
}

function beneficioResumoRadar(oferta = {}) {
  const beneficio = normalizarBeneficiosRadarOferta(oferta);
  return (
    beneficio.cupom ||
    beneficio.beneficioExtra ||
    beneficio.descontoPix ||
    beneficio.descontoApp ||
    beneficio.percentualCupom ||
    beneficio.valorCupom ||
    ""
  );
}

function dataHoraRadarAgora() {
  return new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });
}

function normalizarStatusPreviewRadar(status = "") {
  const texto = normalizarTexto(status);
  if (texto === "retida" || texto === "retido") return "retida";
  if (texto === "fila" || texto === "adicionado_fila" || texto === "adicionada_fila") return "adicionado_fila";
  if (texto === "ignorada" || texto === "ignorado") return "ignorado";
  if (texto === "sucesso") return "importado";
  if (texto === "erro") return "erro";
  if (texto === "importado") return "importado";
  if (texto === "detectado") return "detectado";
  return "erro";
}

function normalizarStatusOperacionalRadar(status = "") {
  const statusPreview = normalizarStatusPreviewRadar(status);
  if (statusPreview === "adicionado_fila") return "fila";
  if (statusPreview === "ignorado") return "ignorada";
  if (statusPreview === "erro") return "erro";
  if (statusPreview === "detectado" || statusPreview === "importado") return "detectada";
  return "erro";
}

function normalizarTipoLinkRadarOperacional(evento = {}) {
  const tipo = normalizarTexto(evento.tipoLink || evento.tipoLinkRadar || "");
  if (tipo === "produto") return "produto";
  if (tipo === "cupom_resgate" || tipo === "resgate_cupom" || tipo === "resgate") return "cupom_resgate";
  if (tipo === "intermediario") return "intermediario";

  if (evento.linkResgateCupom && evento.linkCapturado && String(evento.linkResgateCupom) === String(evento.linkCapturado)) {
    return "cupom_resgate";
  }

  if (evento.urlResolvida || evento.linkOriginal || evento.marketplaceDetectado || evento.marketplace) {
    return "produto";
  }

  return "desconhecido";
}

function statusCapturaRadarOperacional(evento = {}) {
  const captura = normalizarTexto(evento.statusCaptura || "");
  if (captura === "retida" || captura === "retido") return "retida";
  if (captura === "fila" || captura === "adicionado_fila" || captura === "adicionada_fila") return "fila";
  if (captura === "erro") return "erro";
  if (captura === "sucesso") return "sucesso";

  const statusRadar = normalizarTexto(evento.statusRadar || "");
  const status = normalizarStatusPreviewRadar(evento.status);

  if (statusRadar === "retida" || status === "retida") return "retida";
  if (statusRadar === "fila" || status === "adicionado_fila") return "fila";
  if (status === "erro") return "erro";
  if (status === "ignorado") return "erro";
  return "sucesso";
}

function motivoFinalRadarOperacional(evento = {}) {
  const motivo = textoRadarId(evento.motivoFinal || evento.motivoTecnico || evento.motivo || "");
  if (motivo === "sem_destino_compativel") return "retida_sem_destino";
  if (motivo === "retida_categoria_nao_marcada") return "retida_categoria_nao_marcada";
  if (motivo) return motivo;

  const status = statusCapturaRadarOperacional(evento);
  if (status === "fila") return "enviado_para_fila";
  if (status === "retida") return evento.motivoRetencao || "retida_sem_destino";
  if (status === "erro") return "erro";
  return "sucesso";
}

function montarEventoPreviewRadar(evento = {}) {
  const criadoEm = evento.criadoEm || new Date().toISOString();
  const dataHora = evento.dataHora || dataHoraRadarAgora();
  const beneficioExtra = evento.beneficioExtra || evento.beneficio || "";
  const economia = calcularEconomiaRadar(evento);
  const clienteIdsAdicionados = Array.isArray(evento.clienteIdsAdicionados)
    ? evento.clienteIdsAdicionados.filter(Boolean).map(String)
    : [];

  return {
    id: evento.id || `radar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    dataHora,
    criadoEm,
    capturadaEm: evento.capturadaEm || dataHora,
    origemTipo: evento.origemTipo || "",
    origemSessaoId: evento.origemSessaoId || "",
    origemGrupoId: evento.origemGrupoId || "",
    origemGrupoNome: evento.origemGrupoNome || "",
    textoResumo: resumirMensagemRadar(evento.textoResumo || evento.mensagemResumo || evento.texto || ""),
    mensagemResumo: resumirMensagemRadar(evento.mensagemResumo || evento.textoResumo || evento.texto || ""),
    imagem: evento.imagem || evento.image || evento.foto || evento.thumbnail || "",
    image: evento.imagem || evento.image || evento.foto || evento.thumbnail || "",
    linkCapturado: evento.linkCapturado || "",
    urlResolvida: evento.urlResolvida || evento.linkResolvidoRadar || "",
    linkOriginal: evento.linkOriginal || "",
    linkAfiliado: evento.linkAfiliado || "",
    marketplaceDetectado: evento.marketplaceDetectado || evento.marketplaceReal || evento.marketplace || "",
    tipoLink: normalizarTipoLinkRadarOperacional(evento),
    tipoLinkRadar: evento.tipoLinkRadar || "",
    statusCaptura: statusCapturaRadarOperacional(evento),
    motivoFinal: motivoFinalRadarOperacional(evento),
    motivoTecnico: evento.motivoTecnico || evento.motivo || "",
    statusHttp: evento.statusHttp || "",
    erroTecnico: evento.erroTecnico || "",
    idOfertaFila: evento.idOfertaFila || evento.ofertaFilaId || "",
    linksDetectados: Number(evento.linksDetectados || 1) || 1,
    marketplace: evento.marketplace || "",
    titulo: evento.titulo || "",
    preco: evento.preco || evento.precoAtual || "",
    precoAtual: evento.precoAtual || evento.preco || "",
    precoAntigo: evento.precoAntigo || "",
    categoria: evento.categoria || "",
    economiaValor: Number(evento.economiaValor ?? economia.economiaValor) || 0,
    economiaPercentual: Number(evento.economiaPercentual ?? economia.economiaPercentual) || 0,
    cupom: evento.cupom || "",
    cupomDetectado: Boolean(evento.cupom || evento.cupomDetectado || evento.cupomDetectadoTexto),
    avisoCupom: evento.avisoCupom || "",
    tipoCupom: evento.tipoCupom || "",
    cupomOrigem: evento.cupomOrigem || "",
    cupomDetectadoTexto: Boolean(evento.cupomDetectadoTexto),
    linkResgateCupom: evento.linkResgateCupom || "",
    beneficioExtra,
    beneficio: beneficioExtra,
    status: normalizarStatusPreviewRadar(evento.status),
    statusRadar: evento.statusRadar || normalizarStatusOperacionalRadar(evento.status),
    motivo: evento.motivo || "",
    clienteIdsAdicionados,
    clientesAdicionados: Array.isArray(evento.clientesAdicionados)
      ? evento.clientesAdicionados
      : clienteIdsAdicionados.map(clienteId => ({ clienteId })),
    adicionadas: Number(evento.adicionadas || clienteIdsAdicionados.length || 0) || 0
  };
}

function registrarPreviewRadar(clienteId = "admin", evento = {}) {
  try {
    const eventos = lerPreviewRadar(clienteId);
    const eventoPreview = montarEventoPreviewRadar(evento);
    eventos.push(eventoPreview);
    salvarPreviewRadar(clienteId, eventos);
    logDebug("[RADAR-DECISAO] preview registrado", {
      clienteId,
      status: eventoPreview.status,
      motivo: eventoPreview.motivo || "",
      grupo: eventoPreview.origemGrupoNome || eventoPreview.origemGrupoId || "",
      titulo: eventoPreview.titulo || "",
      cupom: eventoPreview.cupom || "",
      linkCapturado: eventoPreview.linkCapturado || ""
    });
  } catch (e) {
    console.log("[RADAR] Falha ao registrar preview:", e.message);
    logDebug("[RADAR-DECISAO] preview falhou", {
      clienteId,
      erro: e.message
    });
  }
}

function registrarHistoricoRadar(clienteId = "admin", evento = {}) {
  try {
    const eventos = lerHistoricoRadar(clienteId);
    const eventoPreview = montarEventoPreviewRadar(evento);
    eventos.push({
      id: eventoPreview.id,
      dataHora: eventoPreview.dataHora,
      criadoEm: eventoPreview.criadoEm,
      capturadaEm: eventoPreview.capturadaEm,
      origemTipo: evento.origemTipo || "",
      origemSessaoId: evento.origemSessaoId || "",
      origemGrupoId: evento.origemGrupoId || "",
      origemGrupoNome: evento.origemGrupoNome || "",
      textoResumo: eventoPreview.textoResumo,
      mensagemResumo: eventoPreview.mensagemResumo,
      imagem: eventoPreview.imagem,
      linkCapturado: evento.linkCapturado || "",
      urlResolvida: eventoPreview.urlResolvida,
      linkOriginal: evento.linkOriginal || "",
      linkAfiliado: evento.linkAfiliado || "",
      marketplaceDetectado: eventoPreview.marketplaceDetectado,
      tipoLink: eventoPreview.tipoLink,
      tipoLinkRadar: eventoPreview.tipoLinkRadar,
      statusCaptura: eventoPreview.statusCaptura,
      motivoFinal: eventoPreview.motivoFinal,
      motivoTecnico: eventoPreview.motivoTecnico,
      statusHttp: eventoPreview.statusHttp,
      erroTecnico: eventoPreview.erroTecnico,
      idOfertaFila: evento.idOfertaFila || "",
      marketplace: evento.marketplace || "",
      titulo: evento.titulo || "",
      preco: evento.preco || evento.precoAtual || "",
      precoAtual: eventoPreview.precoAtual,
      precoAntigo: eventoPreview.precoAntigo,
      categoria: evento.categoria || "",
      economiaValor: eventoPreview.economiaValor,
      economiaPercentual: eventoPreview.economiaPercentual,
      cupom: evento.cupom || "",
      cupomDetectado: eventoPreview.cupomDetectado,
      avisoCupom: eventoPreview.avisoCupom,
      tipoCupom: eventoPreview.tipoCupom,
      cupomOrigem: eventoPreview.cupomOrigem,
      cupomDetectadoTexto: eventoPreview.cupomDetectadoTexto,
      linkResgateCupom: eventoPreview.linkResgateCupom,
      beneficioExtra: eventoPreview.beneficioExtra,
      beneficio: eventoPreview.beneficio,
      status: evento.status || "erro",
      statusRadar: evento.statusRadar || eventoPreview.statusRadar,
      motivo: evento.motivo || "",
      linksDetectados: Number(evento.linksDetectados || 1) || 1,
      adicionadas: Number(evento.adicionadas || 0) || 0,
      clienteIdsAdicionados: eventoPreview.clienteIdsAdicionados,
      clientesAdicionados: eventoPreview.clientesAdicionados
    });
    salvarHistoricoRadar(clienteId, eventos);
    registrarPreviewRadar(clienteId, eventoPreview);
    logDebug("[RADAR-DECISAO] historico registrado", {
      clienteId,
      status: eventoPreview.status,
      motivo: eventoPreview.motivo || "",
      grupo: eventoPreview.origemGrupoNome || eventoPreview.origemGrupoId || "",
      titulo: eventoPreview.titulo || "",
      cupom: eventoPreview.cupom || "",
      linkCapturado: eventoPreview.linkCapturado || ""
    });
  } catch (e) {
    console.log("[RADAR] Falha ao registrar historico:", e.message);
    logDebug("[RADAR-DECISAO] historico falhou", {
      clienteId,
      erro: e.message
    });
  }
}

function fonteMonitoradaResumoRadar(item = {}, origemTipo = "whatsapp") {
  const id = textoRadarId(
    item.id ||
    item.grupoId ||
    item.chatId ||
    item.value ||
    item.jid ||
    item.remoteJid ||
    item.nome ||
    ""
  );
  const nome = textoRadarId(
    item.nome ||
    item.titulo ||
    item.label ||
    item.subject ||
    item.name ||
    id
  );

  return {
    origemTipo,
    origemSessaoId: textoRadarId(item.sessaoId || item.origemSessaoId || item.sessionId || ""),
    origemGrupoId: id,
    origemGrupoNome: nome || id
  };
}

function chaveFonteHistoricoRadar(fonte = {}) {
  return [
    fonte.origemTipo || "",
    fonte.origemTipo === "whatsapp" ? chaveRadarId(fonte.origemSessaoId || "") : "",
    chaveRadarId(fonte.origemGrupoId || fonte.origemGrupoNome || "")
  ].join(":");
}

function dataRadarEhHoje(valor = "", hoje = "") {
  if (!valor) return false;
  const texto = String(valor);
  if (hoje && texto.includes(hoje)) return true;

  const data = new Date(texto);
  if (Number.isNaN(data.getTime())) return false;

  return data.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  }) === hoje;
}

function montarResumoHistoricoRadar(clienteId = "admin", opcoes = {}) {
  const configRadar = carregarRadarConfigCliente(clienteId);
  const eventosPreview = lerPreviewRadar(clienteId);
  const eventosHistorico = lerHistoricoRadar(clienteId);
  const eventosPorId = new Map();
  for (const evento of [...eventosHistorico, ...eventosPreview]) {
    const chaveEvento = evento.id || `${evento.criadoEm || evento.dataHora || ""}:${evento.origemTipo || ""}:${evento.origemSessaoId || ""}:${evento.origemGrupoId || ""}:${evento.linkCapturado || evento.linkOriginal || evento.titulo || ""}`;
    eventosPorId.set(chaveEvento, evento);
  }
  const eventos = [...eventosPorId.values()];
  const hoje = new Date().toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });
  const mapa = new Map();
  const motivosDiagnosticoRadar = [
    "link_original_nao_resolvido",
    "importacao_incompleta",
    "importacao_sem_preco",
    "importacao_sem_titulo",
    "marketplace_nao_identificado",
    "redirect_bloqueado"
  ];
  const contadoresDiagnostico = Object.fromEntries(
    motivosDiagnosticoRadar.map(motivo => [motivo, 0])
  );

  const adicionarFonte = fonte => {
    const chave = chaveFonteHistoricoRadar(fonte);
    if (!chave.endsWith(":")) {
      mapa.set(chave, {
        ...fonte,
        tipo: fonte.origemTipo || "",
        grupoId: fonte.origemGrupoId || "",
        grupoNome: fonte.origemGrupoNome || "",
        ultimaCaptura: "",
        ultimaMensagemCapturada: "",
        ultimaOfertaCapturada: "",
        linksHoje: 0,
        linksDetectadosHoje: 0,
        adicionadasFila: 0,
        ofertasAdicionadasFila: 0,
        comCupom: 0,
        comCupomBeneficio: 0,
        cuponsDetectados: 0,
        beneficiosDetectados: 0,
        ignoradas: 0,
        erros: 0,
        totalCapturas: 0,
        totalFila: 0,
        totalIgnoradas: 0,
        totalErros: 0,
        economiaTotalGerada: 0,
        economiaMedia: 0,
        descontoMedioPercentual: 0,
        scoreGrupo: 0,
        principalMotivoRejeicao: "",
        totalEventos: 0,
        diagnostico: Object.fromEntries(
          motivosDiagnosticoRadar.map(motivo => [motivo, 0])
        )
      });
    }
  };

  for (const sessao of Array.isArray(configRadar.sessoesWhatsappMonitoradas) ? configRadar.sessoesWhatsappMonitoradas : []) {
    for (const grupo of Array.isArray(sessao.gruposMonitorados) ? sessao.gruposMonitorados : []) {
      adicionarFonte(fonteMonitoradaResumoRadar({ ...grupo, sessaoId: sessao.sessaoId }, "whatsapp"));
    }
  }

  for (const grupo of Array.isArray(configRadar.telegramMonitorados) ? configRadar.telegramMonitorados : []) {
    if (grupo?.ativo === false) continue;
    adicionarFonte(fonteMonitoradaResumoRadar(grupo, "telegram"));
  }

  const motivos = {};

  for (const evento of eventos) {
    const chave = chaveFonteHistoricoRadar(evento);
    if (!mapa.has(chave)) {
      adicionarFonte({
        origemTipo: evento.origemTipo,
        origemSessaoId: evento.origemSessaoId,
        origemGrupoId: evento.origemGrupoId,
        origemGrupoNome: evento.origemGrupoNome
      });
    }

    const resumo = mapa.get(chave);
    if (!resumo) continue;

    const status = normalizarStatusPreviewRadar(evento.statusCaptura || evento.statusRadar || evento.status);
    const eventoOperacional = montarEventoPreviewRadar(evento);
    const motivoDiagnostico = eventoOperacional.motivoFinal || eventoOperacional.motivoTecnico || evento.motivo || "";
    const dataEvento = evento.capturadaEm || evento.dataHora || evento.criadoEm || "";
    const textoResumo = evento.textoResumo || evento.mensagemResumo || "";
    const beneficio = evento.cupom || evento.beneficioExtra || evento.beneficio || evento.descontoPix || evento.descontoApp || "";
    const adicionadas = Number(evento.adicionadas || (Array.isArray(evento.clienteIdsAdicionados) ? evento.clienteIdsAdicionados.length : 0) || 0) || 0;
    const economiaValor = Number(evento.economiaValor || 0) || 0;
    const economiaPercentual = Number(evento.economiaPercentual || 0) || 0;

    resumo.totalEventos += 1;
    resumo.totalCapturas = resumo.totalEventos;
    resumo.ultimaCaptura = dataEvento || resumo.ultimaCaptura;
    resumo.ultimaMensagemCapturada = textoResumo || resumo.ultimaMensagemCapturada;
    resumo.ultimaOfertaCapturada = evento.titulo || resumo.ultimaOfertaCapturada;

    if (dataRadarEhHoje(dataEvento, hoje)) {
      resumo.linksDetectadosHoje += Number(evento.linksDetectados || 1) || 1;
      resumo.linksHoje = resumo.linksDetectadosHoje;
    }

    if (status === "adicionado_fila") {
      resumo.ofertasAdicionadasFila += adicionadas || 1;
      resumo.adicionadasFila = resumo.ofertasAdicionadasFila;
      resumo.totalFila = resumo.ofertasAdicionadasFila;
    } else if (status === "ignorado") {
      resumo.ignoradas += 1;
      resumo.totalIgnoradas = resumo.ignoradas;
      const motivo = evento.motivo || "nao_informado";
      motivos[chave] = motivos[chave] || {};
      motivos[chave][motivo] = (motivos[chave][motivo] || 0) + 1;
    } else if (status === "erro") {
      resumo.erros += 1;
      resumo.totalErros = resumo.erros;
      const motivo = evento.motivo || "erro";
      motivos[chave] = motivos[chave] || {};
      motivos[chave][motivo] = (motivos[chave][motivo] || 0) + 1;
    }

    if (Object.prototype.hasOwnProperty.call(contadoresDiagnostico, motivoDiagnostico)) {
      contadoresDiagnostico[motivoDiagnostico] += 1;
      resumo.diagnostico[motivoDiagnostico] = (resumo.diagnostico[motivoDiagnostico] || 0) + 1;
    }

    if (beneficio) {
      resumo.comCupomBeneficio += 1;
      resumo.comCupom = resumo.comCupomBeneficio;
    }

    if (evento.cupom) resumo.cuponsDetectados += 1;
    if (evento.beneficioExtra || evento.beneficio || evento.descontoPix || evento.descontoApp || evento.linkResgateCupom) {
      resumo.beneficiosDetectados += 1;
    }
    resumo.economiaTotalGerada += economiaValor;
    if (economiaPercentual > 0) {
      resumo.__somaDescontoPercentual = (resumo.__somaDescontoPercentual || 0) + economiaPercentual;
      resumo.__qtdDescontoPercentual = (resumo.__qtdDescontoPercentual || 0) + 1;
    }
  }

  for (const [chave, resumo] of mapa.entries()) {
    const motivoMaisComum = Object.entries(motivos[chave] || {})
      .sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    resumo.principalMotivoRejeicao = motivoMaisComum;
    resumo.economiaTotalGerada = Number((resumo.economiaTotalGerada || 0).toFixed(2));
    resumo.economiaMedia = resumo.totalFila > 0
      ? Number((resumo.economiaTotalGerada / resumo.totalFila).toFixed(2))
      : 0;
    resumo.descontoMedioPercentual = resumo.__qtdDescontoPercentual > 0
      ? Math.round(resumo.__somaDescontoPercentual / resumo.__qtdDescontoPercentual)
      : 0;
    resumo.scoreGrupo = Math.max(0, Math.min(100,
      Math.round(
        (resumo.totalFila || 0) * 12 +
        (resumo.cuponsDetectados || 0) * 10 +
        (resumo.beneficiosDetectados || 0) * 6 +
        Math.min(25, (resumo.descontoMedioPercentual || 0) / 2) -
        (resumo.totalIgnoradas || 0) * 3 -
        (resumo.totalErros || 0) * 5
      )
    ));
    delete resumo.__somaDescontoPercentual;
    delete resumo.__qtdDescontoPercentual;
  }

  const grupoFiltro = chaveRadarId(opcoes.grupoId || "");
  const tipoFiltro = normalizarTexto(opcoes.origemTipo || "");
  const sessaoFiltro = chaveRadarId(opcoes.sessaoId || "");
  const capturas = eventos
    .filter(evento => {
      if (!grupoFiltro) return true;

      return [
        evento.origemGrupoId,
        evento.grupoId,
        evento.remoteJid,
        evento.chatId,
        evento.origemGrupoNome,
        evento.grupoNome
      ].some(valor => chaveRadarId(valor || "") === grupoFiltro);
    })
    .filter(evento => !tipoFiltro || normalizarTexto(evento.origemTipo) === tipoFiltro)
    .filter(evento => !sessaoFiltro || chaveRadarId(evento.origemSessaoId || "") === sessaoFiltro)
    .slice(-Number(opcoes.limit || 20))
    .reverse()
    .map(evento => montarEventoPreviewRadar(evento));

  return {
    grupos: [...mapa.values()],
    capturas,
    eventos: capturas,
    diagnostico: contadoresDiagnostico,
    contadoresDiagnostico
  };
}

function listarSessoesWhatsappCliente(clienteId = "admin") {
  return Object.values(sessoesMeta || {})
    .filter(sessao => {
      const id = String(sessao.id || "");

      return (
        id.startsWith(clienteId + "_") ||
        id === clienteId ||
        (clienteId === "admin" && id.startsWith("admin_"))
      );
    })
    .map(sessao => {
      const id = sessao.id;
      const totalGrupos = gruposPorSessao[id]?.length || 0;

      const nomeAmigavel =
        sessao.nome ||
        sessao.nomeSessao ||
        sessao.apelido ||
        sessao.titulo ||
        sessao.label ||
        id;

      return {
        ...sessao,
        id,
        sessaoId: id,
        nome: nomeAmigavel,
        nomeAmigavel,
        nomeExibicao: nomeAmigavel,
        idTecnico: id,
        status: statusSessao[id] || "offline",
        conectado: statusSessao[id] === "open" || statusSessao[id] === "aberto",
        qrDisponivel: !!qrCodes[id],
        grupos: totalGrupos,
        totalGrupos,
        destinos: destinosPorSessao[id]?.length || 0
      };
    });
}

function listarTelegramRadarCliente(clienteId = "admin") {
  const configCliente = configsPorCliente?.[clienteId] || {};
  const destinos = configCliente.telegram?.destinos || [];

  if (!Array.isArray(destinos)) {
    return [];
  }

  return destinos.map((destino, index) => ({
    ...destino,
    id: String(destino.id || destino.chatId || destino.nome || `telegram_${index}`),
    nome: destino.nome || destino.titulo || destino.label || String(destino.chatId || `Telegram ${index + 1}`),
    chatId: destino.chatId || "",
    ativo: destino.ativo === true,
    status: destino.ativo === true ? "conectado" : "desconectado"
  }));
}

function carregarRadarConfigCliente(clienteId = "admin") {
  const padrao = radarConfigPadrao();

  try {
    const dados = readClienteJson(clienteId, "radar-config.json", padrao);

    const sessoesWhatsappMonitoradas = normalizarSessoesWhatsappMonitoradasRadar(dados);
    const gruposMonitoradosLegado = achatarGruposWhatsappMonitoradosRadar(sessoesWhatsappMonitoradas);
    const sessaoWhatsappIdLegado =
      dados.sessaoWhatsappId ||
      sessoesWhatsappMonitoradas[0]?.sessaoId ||
      "";

    return {
      monitoramentoAtivo: dados.monitoramentoAtivo !== false,
      sessaoWhatsappId: sessaoWhatsappIdLegado,
      gruposMonitorados: gruposMonitoradosLegado,
      sessoesWhatsappMonitoradas,
      telegramMonitorados: Array.isArray(dados.telegramMonitorados)
        ? dados.telegramMonitorados
        : [],
      monitoramento: {
        ...padrao.monitoramento,
        ...(dados.monitoramento && typeof dados.monitoramento === "object" ? dados.monitoramento : {})
      },
      categoriasPermitidas: Array.isArray(dados.categoriasPermitidas)
        ? dados.categoriasPermitidas
        : [],
      templateMidia: {
        ...padrao.templateMidia,
        ...(dados.templateMidia && typeof dados.templateMidia === "object" ? dados.templateMidia : {})
      }
    };
  } catch (e) {
    console.log("[RADAR] Falha ao carregar config:", {
      clienteId,
      erro: e.message
    });

    return padrao;
  }
}

function obterGrupoWhatsappIdTecnicoRadar(grupo = {}) {
  if (typeof grupo === "string" || typeof grupo === "number") {
    const id = textoRadarId(grupo);
    return chaveGrupoWhatsappTecnicaRadar(id) ? id : "";
  }

  if (!grupo || typeof grupo !== "object") return "";

  const candidatos = [
    grupo.remoteJid,
    grupo.grupoId,
    grupo.jid,
    grupo.chatId,
    grupo.value,
    grupo.id
  ];

  for (const candidato of candidatos) {
    const id = textoRadarId(candidato);
    if (chaveGrupoWhatsappTecnicaRadar(id)) return id;
  }

  return "";
}

function normalizarGrupoWhatsappRadar(grupo = {}, sessaoIdPadrao = "") {
  const sessaoIdResolvida = resolverSessaoWhatsappRadarCliente("admin", sessaoIdPadrao) || textoRadarId(sessaoIdPadrao);
  const idTecnico = obterGrupoWhatsappIdTecnicoRadar(grupo) || resolverGrupoWhatsappRadarPorSessao(sessaoIdResolvida, grupo);

  if (!idTecnico) return null;

  if (typeof grupo === "string" || typeof grupo === "number") {
    return {
      id: idTecnico,
      grupoId: idTecnico,
      remoteJid: idTecnico,
      nome: idTecnico,
      sessaoId: sessaoIdResolvida || sessaoIdPadrao,
      ativo: true,
      tipo: "whatsapp"
    };
  }

  if (!grupo || typeof grupo !== "object") return null;

  const nome = textoRadarId(
    grupo.nome ||
    grupo.titulo ||
    grupo.label ||
    grupo.subject ||
    grupo.name ||
    idTecnico
  );
  const sessaoId = resolverSessaoWhatsappRadarCliente("admin", grupo.sessaoId || grupo.origemSessaoId || grupo.sessionId || sessaoIdResolvida || sessaoIdPadrao) || textoRadarId(grupo.sessaoId || grupo.origemSessaoId || grupo.sessionId || sessaoIdResolvida || sessaoIdPadrao);

  return {
    ...grupo,
    id: idTecnico,
    grupoId: idTecnico,
    remoteJid: idTecnico,
    nome: nome || idTecnico,
    sessaoId,
    ativo: grupo.ativo !== false,
    tipo: "whatsapp"
  };
}

function normalizarSessoesWhatsappMonitoradasRadar(dados = {}) {
  const mapa = new Map();

  const adicionarSessao = (sessaoIdEntrada = "", grupos = []) => {
    const sessaoId = textoRadarId(sessaoIdEntrada);
    if (!sessaoId) return;

    const existentes = mapa.get(sessaoId) || [];
    const gruposMapa = new Map(existentes.map(grupo => [chaveRadarId(grupo.grupoId || grupo.id || grupo.nome), grupo]));

    for (const grupo of Array.isArray(grupos) ? grupos : []) {
      const normalizado = normalizarGrupoWhatsappRadar(grupo, sessaoId);
      const chave = chaveRadarId(normalizado?.grupoId || normalizado?.id || normalizado?.nome || "");
      if (normalizado && chave) gruposMapa.set(chave, normalizado);
    }

    mapa.set(sessaoId, [...gruposMapa.values()]);
  };

  if (Array.isArray(dados.sessoesWhatsappMonitoradas)) {
    for (const sessao of dados.sessoesWhatsappMonitoradas) {
      if (!sessao || typeof sessao !== "object") continue;
      adicionarSessao(sessao.sessaoId || sessao.id || sessao.sessionId, sessao.gruposMonitorados);
    }
  }

  const gruposLegados = Array.isArray(dados.gruposMonitorados) ? dados.gruposMonitorados : [];
  if (gruposLegados.length) {
    const gruposPorSessao = new Map();
    for (const grupo of gruposLegados) {
      const sessaoId = textoRadarId(
        (grupo && typeof grupo === "object" && (grupo.sessaoId || grupo.origemSessaoId || grupo.sessionId)) ||
        dados.sessaoWhatsappId ||
        ""
      );
      if (!sessaoId) continue;
      const lista = gruposPorSessao.get(sessaoId) || [];
      lista.push(grupo);
      gruposPorSessao.set(sessaoId, lista);
    }

    if (!gruposPorSessao.size && dados.sessaoWhatsappId) {
      gruposPorSessao.set(textoRadarId(dados.sessaoWhatsappId), gruposLegados);
    }

    for (const [sessaoId, grupos] of gruposPorSessao.entries()) {
      adicionarSessao(sessaoId, grupos);
    }
  }

  return [...mapa.entries()]
    .map(([sessaoId, gruposMonitorados]) => ({
      sessaoId,
      gruposMonitorados: gruposMonitorados.map(grupo => ({ ...grupo, sessaoId }))
    }))
    .filter(sessao => sessao.sessaoId && sessao.gruposMonitorados.length > 0);
}

function achatarGruposWhatsappMonitoradosRadar(sessoesWhatsappMonitoradas = []) {
  const grupos = [];

  for (const sessao of Array.isArray(sessoesWhatsappMonitoradas) ? sessoesWhatsappMonitoradas : []) {
    const sessaoId = textoRadarId(sessao?.sessaoId || "");
    for (const grupo of Array.isArray(sessao?.gruposMonitorados) ? sessao.gruposMonitorados : []) {
      const normalizado = normalizarGrupoWhatsappRadar(grupo, sessaoId);
      if (normalizado) grupos.push(normalizado);
    }
  }

  return grupos;
}

function mesclarSessoesWhatsappMonitoradasRadar(atual = [], entrada = []) {
  const mapa = new Map();

  for (const sessao of Array.isArray(atual) ? atual : []) {
    const sessaoId = textoRadarId(sessao?.sessaoId || "");
    if (!sessaoId) continue;
    mapa.set(sessaoId, {
      sessaoId,
      gruposMonitorados: Array.isArray(sessao.gruposMonitorados)
        ? sessao.gruposMonitorados.map(grupo => normalizarGrupoWhatsappRadar(grupo, sessaoId)).filter(Boolean)
        : []
    });
  }

  for (const sessao of Array.isArray(entrada) ? entrada : []) {
    const sessaoId = textoRadarId(sessao?.sessaoId || sessao?.id || sessao?.sessionId || "");
    if (!sessaoId) continue;
    const grupos = Array.isArray(sessao.gruposMonitorados)
      ? sessao.gruposMonitorados.map(grupo => normalizarGrupoWhatsappRadar(grupo, sessaoId)).filter(Boolean)
      : [];

    if (grupos.length) {
      mapa.set(sessaoId, { sessaoId, gruposMonitorados: grupos });
    } else {
      mapa.delete(sessaoId);
    }
  }

  return [...mapa.values()];
}

function numeroRadarConfig(valor, fallback) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? numero : fallback;
}

function normalizarHoraRadar(valor, fallback) {
  const texto = String(valor || "").trim();
  return /^\d{2}:\d{2}$/.test(texto) ? texto : fallback;
}

function salvarRadarConfigCliente(clienteId = "admin", dados = {}) {
  const padrao = radarConfigPadrao();
  const atual = carregarRadarConfigCliente(clienteId);
  const possuiCampo = campo => Object.prototype.hasOwnProperty.call(dados, campo);
  const monitoramentoBase = atual.monitoramento && typeof atual.monitoramento === "object"
    ? atual.monitoramento
    : padrao.monitoramento;
  const monitoramento = dados.monitoramento && typeof dados.monitoramento === "object"
    ? { ...monitoramentoBase, ...dados.monitoramento }
    : monitoramentoBase;
  const templateMidiaBase = atual.templateMidia && typeof atual.templateMidia === "object"
    ? atual.templateMidia
    : padrao.templateMidia;
  const templateMidia = dados.templateMidia && typeof dados.templateMidia === "object"
    ? { ...templateMidiaBase, ...dados.templateMidia }
    : templateMidiaBase;
  const sessaoWhatsappId = possuiCampo("sessaoWhatsappId")
    ? textoRadarId(dados.sessaoWhatsappId || "")
    : textoRadarId(atual.sessaoWhatsappId || "");
  let sessoesWhatsappMonitoradas = Array.isArray(atual.sessoesWhatsappMonitoradas)
    ? atual.sessoesWhatsappMonitoradas
    : normalizarSessoesWhatsappMonitoradasRadar(atual);

if (Array.isArray(dados.sessoesWhatsappMonitoradas)) {
  sessoesWhatsappMonitoradas = normalizarSessoesWhatsappMonitoradasRadar({
    sessoesWhatsappMonitoradas: dados.sessoesWhatsappMonitoradas
  });

  logDebug("🧪 RADAR NORMALIZACAO REPLACE", {
    recebido: dados.sessoesWhatsappMonitoradas,
    salvo: sessoesWhatsappMonitoradas
  });
}


  if (Array.isArray(dados.gruposMonitorados)) {
    const sessaoDestino =
      sessaoWhatsappId ||
      dados.gruposMonitorados
        .map(grupo => textoRadarId(grupo?.sessaoId || grupo?.origemSessaoId || grupo?.sessionId || ""))
        .find(Boolean) ||
      atual.sessaoWhatsappId ||
      "";
    const entradaLegada = normalizarSessoesWhatsappMonitoradasRadar({
      sessaoWhatsappId: sessaoDestino,
      gruposMonitorados: dados.gruposMonitorados
    });
    const possuiGrupoSessaoDestino = entradaLegada.some(sessao => sessao.sessaoId === sessaoDestino);

    sessoesWhatsappMonitoradas = mesclarSessoesWhatsappMonitoradasRadar(
      sessoesWhatsappMonitoradas,
      entradaLegada.length
        ? [
            ...entradaLegada,
            ...(sessaoDestino && !possuiGrupoSessaoDestino ? [{ sessaoId: sessaoDestino, gruposMonitorados: [] }] : [])
          ]
        : [{ sessaoId: sessaoDestino, gruposMonitorados: [] }]
    );
  }

  const gruposMonitorados = achatarGruposWhatsappMonitoradosRadar(sessoesWhatsappMonitoradas);
  const payload = {
    clienteId,
    monitoramentoAtivo: possuiCampo("monitoramentoAtivo")
      ? dados.monitoramentoAtivo !== false
      : atual.monitoramentoAtivo !== false,
    sessaoWhatsappId: sessaoWhatsappId || sessoesWhatsappMonitoradas[0]?.sessaoId || "",
    gruposMonitorados,
    sessoesWhatsappMonitoradas,
    telegramMonitorados: Array.isArray(dados.telegramMonitorados)
      ? dados.telegramMonitorados
      : Array.isArray(atual.telegramMonitorados)
        ? atual.telegramMonitorados
        : [],
    monitoramento: {
      horaInicial: normalizarHoraRadar(monitoramento.horaInicial, padrao.monitoramento.horaInicial),
      horaFinal: normalizarHoraRadar(monitoramento.horaFinal, padrao.monitoramento.horaFinal),
      intervaloMinutos: numeroRadarConfig(monitoramento.intervaloMinutos, padrao.monitoramento.intervaloMinutos),
      maxPorDia: numeroRadarConfig(monitoramento.maxPorDia, padrao.monitoramento.maxPorDia)
    },
    categoriasPermitidas: Array.isArray(dados.categoriasPermitidas)
      ? dados.categoriasPermitidas.map(c => String(c || "").trim()).filter(Boolean)
      : Array.isArray(atual.categoriasPermitidas)
        ? atual.categoriasPermitidas
        : [],
    templateMidia: {
      template: String(templateMidia.template || padrao.templateMidia.template),
      tipoMidia: String(templateMidia.tipoMidia || padrao.templateMidia.tipoMidia)
    },
    atualizadoEm: new Date().toISOString()
  };


logDebug("🧪 RADAR PAYLOAD FINAL", {
  sessoesWhatsappMonitoradas: payload.sessoesWhatsappMonitoradas,
  gruposMonitorados: payload.gruposMonitorados
});


writeClienteJson(clienteId, "radar-config.json", payload);

  return payload;
}

function textoRadarId(valor = "") {
  return String(valor || "").trim();
}

function resolverSessaoWhatsappRadarCliente(clienteId = "admin", sessaoEntrada = "") {
  const entrada = textoRadarId(sessaoEntrada);
  if (!entrada) return "";

  const normalizada = normalizarSessaoId(clienteId, entrada);
  const candidatosDiretos = [entrada, normalizada, `${clienteId}_${entrada}`]
    .map(textoRadarId)
    .filter(Boolean);

  for (const candidato of candidatosDiretos) {
    if (sessoesMeta[candidato] || statusSessao[candidato] || sessoes[candidato] || gruposPorSessao[candidato]?.length) {
      return candidato;
    }
  }

  const chaveEntrada = chaveRadarId(entrada);
  const encontrada = Object.values(sessoesMeta || {}).find(sessao => {
    const valores = [
      sessao?.id,
      sessao?.sessaoId,
      sessao?.nome,
      sessao?.nomeSessao,
      sessao?.apelido,
      sessao?.titulo,
      sessao?.label,
      sessao?.nomeExibicao,
      sessao?.nomeAmigavel
    ];

    return valores.some(valor => chaveRadarId(valor || "") === chaveEntrada);
  });

  return textoRadarId(encontrada?.id || encontrada?.sessaoId || "") || "";
}

function idsSessaoWhatsappRadar(clienteId = "admin", sessaoEntrada = "") {
  const entrada = textoRadarId(sessaoEntrada);
  const ids = new Set();
  const adicionar = valor => {
    const chave = chaveRadarId(valor || "");
    if (chave) ids.add(chave);
  };

  adicionar(entrada);
  adicionar(normalizarSessaoId(clienteId, entrada));
  adicionar(resolverSessaoWhatsappRadarCliente(clienteId, entrada));

  if (entrada.startsWith(`${clienteId}_`)) {
    const semCliente = entrada.slice(`${clienteId}_`.length);
    adicionar(semCliente);
    adicionar(normalizarSessaoId(clienteId, semCliente));
  }

  return ids;
}

function nomesWhatsappCompativeisRadar(a = "", b = "") {
  const nomeA = chaveRadarId(a || "");
  const nomeB = chaveRadarId(b || "");

  if (!nomeA || !nomeB) return false;
  if (nomeA === nomeB) return true;
  if (nomeA.length < 8 || nomeB.length < 8) return false;

  return nomeA.includes(nomeB) || nomeB.includes(nomeA);
}
function obterGruposReaisSessaoRadar(sessaoId = "") {
  const id = textoRadarId(sessaoId);
  const grupos = gruposPorSessao[id] || [];

  return grupos.map(grupo => ({
    id: textoRadarId(grupo.id || grupo.grupoId || grupo.value || grupo.jid || grupo.remoteJid || ""),
    grupoId: textoRadarId(grupo.grupoId || grupo.id || grupo.value || grupo.jid || grupo.remoteJid || ""),
    remoteJid: textoRadarId(grupo.remoteJid || grupo.grupoId || grupo.id || grupo.value || grupo.jid || ""),
    nome: textoRadarId(grupo.nome || grupo.name || grupo.subject || grupo.titulo || grupo.label || "")
  }));
}

function resolverGrupoWhatsappRadarPorSessao(sessaoId = "", grupo = {}) {
  const idTecnico = obterGrupoWhatsappIdTecnicoRadar(grupo);
  if (idTecnico) return idTecnico;

  const nomeGrupo = textoRadarId(
    typeof grupo === "string" || typeof grupo === "number"
      ? grupo
      : grupo?.nome || grupo?.titulo || grupo?.label || grupo?.subject || grupo?.name || grupo?.id || grupo?.grupoId || ""
  );
  const chaveGrupo = chaveRadarId(nomeGrupo);
  if (!chaveGrupo) return "";

  const gruposReais = obterGruposReaisSessaoRadar(sessaoId);
  const encontrado = gruposReais.find(item =>
    [item.nome, item.id, item.grupoId, item.remoteJid]
      .some(valor => chaveRadarId(valor || "") === chaveGrupo)
  );

  return textoRadarId(encontrado?.remoteJid || encontrado?.grupoId || encontrado?.id || "");
}

function registrarRadarListenerRecebido(evento = {}) {
  radarListenerRecentes.push({
    capturadoEm: new Date().toISOString(),
    sessaoId: textoRadarId(evento.sessaoId || ""),
    remoteJid: textoRadarId(evento.remoteJid || evento.grupoId || ""),
    grupoNome: textoRadarId(evento.grupoNome || ""),
    tamanhoTexto: Number(evento.tamanhoTexto || 0) || 0
  });

  if (radarListenerRecentes.length > 30) radarListenerRecentes.shift();
}
function chaveRadarId(valor = "") {
  return normalizarTexto(textoRadarId(valor));
}

function chaveGrupoWhatsappTecnicaRadar(valor = "") {
  const id = textoRadarId(valor);
  return id.includes("@g.us") ? id : "";
}

function extrairIdsMonitoradosRadar(lista = [], campos = []) {
  const ids = new Set();

  for (const item of Array.isArray(lista) ? lista : []) {
    if (typeof item === "string" || typeof item === "number") {
      const chave = chaveRadarId(item);
      if (chave) ids.add(chave);
      continue;
    }

    if (!item || typeof item !== "object") continue;

    for (const campo of campos) {
      const chave = chaveRadarId(item[campo]);
      if (chave) ids.add(chave);
    }
  }

  return ids;
}

function extrairIdsWhatsappMonitoradosRadar(lista = []) {
  const ids = new Set();
  const camposTecnicos = ["id", "grupoId", "value", "jid", "remoteJid"];

  for (const item of Array.isArray(lista) ? lista : []) {
    if (typeof item === "string" || typeof item === "number") {
      const chave = chaveGrupoWhatsappTecnicaRadar(item);
      if (chave) ids.add(chave);
      continue;
    }

    if (!item || typeof item !== "object") continue;

    for (const campo of camposTecnicos) {
      const chave = chaveGrupoWhatsappTecnicaRadar(item[campo]);
      if (chave) ids.add(chave);
    }
  }

  return ids;
}

function grupoWhatsappMonitoradoNaSessaoRadar(sessao = {}, grupoId = "", grupoNome = "") {
  const grupos = Array.isArray(sessao?.gruposMonitorados) ? sessao.gruposMonitorados : [];
  const ids = extrairIdsWhatsappMonitoradosRadar(grupos);
  const id = chaveGrupoWhatsappTecnicaRadar(grupoId);

  if (id && ids.has(id)) {
    return { ok: true, tipo: "id" };
  }

  const nome = chaveRadarId(grupoNome || "");
  if (!nome) return { ok: false, tipo: "" };

  const nomes = new Set();
  for (const grupo of grupos) {
    if (!grupo || typeof grupo !== "object") continue;
    for (const campo of ["nome", "titulo", "label", "subject", "name", "grupoNome"]) {
      const chave = chaveRadarId(grupo[campo] || "");
      if (chave) nomes.add(chave);
    }
  }

  if (nomes.has(nome)) return { ok: true, tipo: "nome" };

  for (const nomeMonitorado of nomes) {
    if (nomesWhatsappCompativeisRadar(nomeMonitorado, grupoNome)) {
      return { ok: true, tipo: "nome_normalizado" };
    }
  }

  return { ok: false, tipo: "" };
}
function extrairIdsTelegramMonitoradosRadar(lista = []) {
  const ids = new Set();

  for (const item of Array.isArray(lista) ? lista : []) {
    if (!item || typeof item !== "object" || item.ativo !== true) continue;

    for (const campo of ["id", "chatId", "grupoId"]) {
      const chave = chaveRadarId(item[campo]);
      if (chave) ids.add(chave);
    }
  }

  return ids;
}

function temFontesMonitoradasRadar(configRadar = {}) {
  return (
    (Array.isArray(configRadar.sessoesWhatsappMonitoradas) && configRadar.sessoesWhatsappMonitoradas.some(sessao => Array.isArray(sessao?.gruposMonitorados) && sessao.gruposMonitorados.length > 0)) ||
    (Array.isArray(configRadar.gruposMonitorados) && configRadar.gruposMonitorados.length > 0) ||
    (Array.isArray(configRadar.telegramMonitorados) && configRadar.telegramMonitorados.length > 0)
  );
}

function minutosHoraRadar(valor = "") {
  const partes = String(valor || "").split(":").map(Number);
  if (partes.length !== 2 || partes.some(n => !Number.isFinite(n))) return null;
  const [hora, minuto] = partes;
  if (hora < 0 || hora > 23 || minuto < 0 || minuto > 59) return null;
  return hora * 60 + minuto;
}

function radarDentroHorarioMonitoramento(configRadar = {}) {
  const cfg = configRadar.monitoramento || {};
  const inicio = minutosHoraRadar(cfg.horaInicial);
  const fim = minutosHoraRadar(cfg.horaFinal);

  if (inicio === null || fim === null) return true;

  const agora = new Date();
  const horaBR = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(agora);
  const atual = minutosHoraRadar(horaBR);

  if (atual === null) return true;
  if (inicio === fim) return true;
  if (inicio < fim) return atual >= inicio && atual <= fim;

  return atual >= inicio || atual <= fim;
}

function totalRadarCapturadoHoje() {
  const hoje = new Date().toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });

  const adminMasterId = obterClienteIdAdminMaster();
  const eventos = [
    ...lerHistoricoRadar(adminMasterId),
    ...lerPreviewRadar(adminMasterId)
  ];
  const vistos = new Set();

  return eventos.filter(evento => {
    const data = String(evento.capturadaEm || evento.dataEntradaRadar || evento.dataEntradaFila || "");
    if (!data.includes(hoje)) return false;

    const status = normalizarTexto(evento.statusCaptura || evento.statusRadar || evento.status || "");
    const enviadaFila = status === "fila" || status === "adicionado_fila" || status === "adicionada_fila";
    if (!enviadaFila) return false;

    const chave = [
      evento.idOfertaFila,
      evento.linkOriginal,
      evento.linkCapturado,
      evento.titulo,
      evento.origemGrupoId
    ].filter(Boolean).join("|").toLowerCase();

    if (chave && vistos.has(chave)) return false;
    if (chave) vistos.add(chave);

    return true;
  }).length;
}

function radarPodeCapturarAgora(configRadar = {}, opcoes = {}) {
  if (configRadar.monitoramentoAtivo === false) {
    return { ok: false, motivo: "radar_monitoramento_inativo" };
  }

  if (!radarDentroHorarioMonitoramento(configRadar)) {
    return { ok: false, motivo: "fora_do_horario_monitoramento" };
  }

  const maxPorDia = Number(configRadar.monitoramento?.maxPorDia || 0);
  if (maxPorDia > 0 && !opcoes.temBeneficioPrioritario && totalRadarCapturadoHoje() >= maxPorDia) {
    return { ok: false, motivo: "limite_diario_radar_atingido" };
  }

  return { ok: true };
}

function motivoRadarDebug(motivo = "") {
  const chave = String(motivo || "").trim();
  const mapa = {
    integracao_marketplace_ausente: "sem integração",
    sem_destino_compativel: "sem destino compatível",
    oferta_duplicada: "duplicada",
    oferta_repetida_na_memoria: "memória",
    limite_radar_pendente_total: "limite Radar",
    limite_radar_com_cupom: "limite Radar",
    limite_radar_sem_cupom: "limite Radar",
    limite_diario_radar_atingido: "limite Radar",
    marketplace_nao_permitido_no_plano: "marketplace bloqueado",
    marketplace_desativado_no_cliente: "marketplace bloqueado",
    fora_do_horario_monitoramento: "horário fora da janela",
    categoria_nao_permitida_radar: "categoria bloqueada",
    link_afiliado_nao_gerado: "link afiliado inválido",
    link_afiliado_igual_original: "link afiliado inválido",
    link_original_nao_resolvido: "link original não resolvido",
    link_produto_ml_nao_encontrado: "link_produto_ml_nao_encontrado",
    importacao_incompleta: "importacao_incompleta",
    oferta_sem_cupom_ou_desconto_relevante: "oferta sem cupom ou desconto relevante"
  };

  return mapa[chave] || chave || "motivo_nao_informado";
}

function logRadarRejeitado(motivo = "", contexto = {}) {
  console.log(`[RADAR] rejeitado: ${motivoRadarDebug(motivo)}`, {
    motivoTecnico: motivo || "",
    ...contexto
  });
}

function dataHoraRadarOferta(oferta = {}) {
  return textoRadarId(
    oferta.dataEntradaRadar ||
    oferta.capturadaEm ||
    oferta.dataCaptura ||
    oferta.dataEntradaFila ||
    oferta.criadoEm ||
    oferta.createdAt ||
    oferta.data ||
    ""
  );
}

function obterOrigemOfertaRadar(oferta = {}) {
  const origemTipoRaw =
    oferta.origemTipo ||
    oferta.tipoOrigem ||
    oferta.tipoFonte ||
    oferta.canalOrigem ||
    oferta.canal ||
    "";

  const origemGrupoId = textoRadarId(
    oferta.origemGrupoId ||
    oferta.grupoId ||
    oferta.chatId ||
    oferta.remoteJid ||
    oferta.jid ||
    ""
  );

  const origemGrupoNome = textoRadarId(
    oferta.origemGrupoNome ||
    oferta.grupoNome ||
    oferta.nomeGrupo ||
    oferta.chatNome ||
    oferta.nomeCanal ||
    oferta.canalNome ||
    ""
  );

  const origemSessaoId = textoRadarId(
    oferta.origemSessaoId ||
    oferta.sessaoId ||
    oferta.idSessao ||
    oferta.sessionId ||
    ""
  );

  const origemTipoNormalizada = normalizarTexto(origemTipoRaw);
  const origemLegada = normalizarTexto(oferta.origem || "");
  let origemTipo = "farejador";

  if (origemTipoNormalizada.includes("telegram")) {
    origemTipo = "telegram";
  } else if (origemTipoNormalizada.includes("whatsapp")) {
    origemTipo = "whatsapp";
  } else if (origemTipoNormalizada.includes("manual") || origemLegada === "manual") {
    origemTipo = "manual";
  } else if (origemTipoNormalizada.includes("farejador") || origemLegada === "farejador") {
    origemTipo = "farejador";
  } else if (origemGrupoId || origemGrupoNome || origemSessaoId) {
    origemTipo = "whatsapp";
  }

  return {
    origemGrupoId,
    origemGrupoNome,
    origemSessaoId,
    origemTipo
  };
}

function origemOfertaEstaMonitoradaRadar(oferta = {}, configRadar = {}) {
  if (!temFontesMonitoradasRadar(configRadar)) {
    return { ok: false, motivo: "radar_sem_fontes_monitoradas" };
  }

  const origem = obterOrigemOfertaRadar(oferta);
  const grupoId = chaveRadarId(origem.origemGrupoId);
  const grupoNome = chaveRadarId(origem.origemGrupoNome);
  const sessaoId = chaveRadarId(origem.origemSessaoId);
  const sessoesEntradaIds = idsSessaoWhatsappRadar("admin", origem.origemSessaoId);

  if (!["whatsapp", "telegram"].includes(origem.origemTipo)) {
    return {
      ok: false,
      motivo: "origem_nao_monitoravel",
      origem
    };
  }

  if (!grupoId && !grupoNome) {
    return {
      ok: false,
      motivo: "oferta_sem_origem_monitorada",
      origem
    };
  }

  if (origem.origemTipo === "telegram") {
    const telegramIds = extrairIdsTelegramMonitoradosRadar(configRadar.telegramMonitorados);

    const ok = grupoId && telegramIds.has(grupoId);

    return {
      ok,
      motivo: ok ? "" : "telegram_nao_monitorado",
      origem
    };
  }

  const sessoesWhatsappMonitoradas = Array.isArray(configRadar.sessoesWhatsappMonitoradas) && configRadar.sessoesWhatsappMonitoradas.length
    ? configRadar.sessoesWhatsappMonitoradas
    : normalizarSessoesWhatsappMonitoradasRadar(configRadar);

  const sessaoMonitorada = sessoesWhatsappMonitoradas.find(sessao => {
    const idsMonitorados = idsSessaoWhatsappRadar("admin", sessao?.sessaoId || "");
    return [...idsMonitorados].some(id => sessoesEntradaIds.has(id)) || idsMonitorados.has(sessaoId);
  });
  let grupoMonitorado = false;
  let totalGruposMonitoradosSessao = 0;
  let sessaoMonitoradaPorGrupo = null;
  let totalGruposMonitoradosGlobal = 0;

  let tipoMatchGrupo = "";

  if (sessaoMonitorada) {
    const gruposIds = extrairIdsWhatsappMonitoradosRadar(sessaoMonitorada.gruposMonitorados);
    totalGruposMonitoradosSessao = gruposIds.size;
    const match = grupoWhatsappMonitoradoNaSessaoRadar(sessaoMonitorada, origem.origemGrupoId, origem.origemGrupoNome);
    grupoMonitorado = match.ok;
    tipoMatchGrupo = match.tipo;
  }

  if (!grupoMonitorado && (grupoId || grupoNome)) {
    for (const sessao of sessoesWhatsappMonitoradas) {
      const gruposIds = extrairIdsWhatsappMonitoradosRadar(sessao?.gruposMonitorados);
      totalGruposMonitoradosGlobal += gruposIds.size;
      const match = grupoWhatsappMonitoradoNaSessaoRadar(sessao, origem.origemGrupoId, origem.origemGrupoNome);

      if (match.ok) {
        sessaoMonitoradaPorGrupo = sessao;
        grupoMonitorado = true;
        tipoMatchGrupo = match.tipo;
        break;
      }
    }
  }

  const ok = Boolean(grupoMonitorado && (sessaoMonitorada || sessaoMonitoradaPorGrupo));
  const validacao = ok && !sessaoMonitorada && sessaoMonitoradaPorGrupo
    ? `grupo_monitorado_em_outra_sessao_por_${tipoMatchGrupo || "id"}`
    : `sessao+grupo_por_${tipoMatchGrupo || "id"}`;

  return {
    ok,
    motivo: ok ? "" : "grupo_whatsapp_nao_monitorado",
    origem,
    diagnostico: {
      sessaoEncontrada: Boolean(sessaoMonitorada),
      sessoesEntradaIds: [...sessoesEntradaIds],
      sessaoEncontradaPorGrupo: Boolean(sessaoMonitoradaPorGrupo),
      sessaoOrigemId: origem.origemSessaoId,
      sessaoMonitoradaId: sessaoMonitorada?.sessaoId || sessaoMonitoradaPorGrupo?.sessaoId || "",
      totalGruposMonitoradosSessao,
      totalGruposMonitoradosGlobal,
      tipoMatchGrupo,
      validacao
    }
  };
}

function normalizarCupomRadar(oferta = {}) {
  const cupom = textoRadarId(oferta.cupom || oferta.codigoCupom || "").toUpperCase();
  const bloqueados = new Set([
    "VER NO APP",
    "COPIADO",
    "APPLIED",
    "APPEARANCE",
    "APPLINK",
    "CUPOM",
    "DESCONTO",
    "CONFIRA",
    "RESGATE",
    "COMPRAR",
    "COMPRE",
    "VER OFERTA",
    "PEGAR OFERTA",
    "ABRIR OFERTA",
    "BOTAO",
    "BUTTON",
    "TEMA",
    "APLICAR",
    "VALIDO"
  ]);
  const cupomOrigem = normalizarTexto(oferta.cupomOrigem || "");
  const cupomValido = Boolean(
    cupom &&
    !bloqueados.has(cupom) &&
    !/^(VER|CONFIRA|COMPR|PEGAR|ABRIR|APLICAR|RESGAT)/i.test(cupom) &&
    /^[A-Z0-9][A-Z0-9_-]{3,39}$/.test(cupom)
  );
  const cupomConfirmado = cupomValido && !["texto_grupo", "mensagem"].includes(cupomOrigem);
  const avisoCupom = textoRadarId(oferta.avisoCupom || oferta.aviso_cupom || "");
  const possivelCupom = !cupomConfirmado && Boolean(cupom || avisoCupom);
  const tipoCupom = textoRadarId(oferta.tipoCupom || oferta.cupomTipo || "");
  const valorCupom = textoRadarId(oferta.valorCupom || oferta.cupomValor || "");
  const percentualCupom = textoRadarId(oferta.percentualCupom || oferta.cupomPercentual || "");
  const descontoPix = textoRadarId(oferta.descontoPix || "");
  const descontoApp = textoRadarId(oferta.descontoApp || "");
  const beneficioExtra = textoRadarId(oferta.beneficioExtra || "");

  return {
    cupom: cupomValido ? cupom : "",
    cupomConfirmado,
    possivelCupom,
    tipoCupom,
    valorCupom,
    percentualCupom,
    descontoPix,
    descontoApp,
    beneficioExtra,
    avisoCupom: cupomConfirmado
      ? avisoCupom
      : (avisoCupom || (cupom ? `Possivel cupom: ${cupom}. Conferir antes de publicar.` : ""))
  };
}

function avisoCupomGenericoRadar(texto = "") {
  const normalizado = normalizarTexto(texto);

  return (
    !normalizado ||
    normalizado.includes("ha cupom desconto extra na pagina") ||
    normalizado.includes("cupom disponivel na pagina") ||
    normalizado.includes("confira cupom ou desconto") ||
    normalizado.includes("verifique na pagina") ||
    normalizado.includes("confira antes de finalizar") ||
    normalizado.includes("resgate antes de finalizar")
  );
}

function normalizarBeneficiosRadarOferta(oferta = {}) {
  const cupomRadar = normalizarCupomRadar(oferta);
  const avisoOriginal = textoRadarId(oferta.avisoCupom || "");
  const avisoUtil = avisoCupomGenericoRadar(avisoOriginal) ? "" : avisoOriginal;
  const textoBeneficio = normalizarTexto([
    avisoOriginal,
    cupomRadar.tipoCupom,
    oferta.beneficioExtra,
    oferta.descricaoBeneficio
  ].filter(Boolean).join(" "));
  const descontoPix =
    cupomRadar.descontoPix ||
    (/\bpix\b/.test(textoBeneficio) ? "Desconto PIX" : "");
  const descontoApp =
    cupomRadar.descontoApp ||
    (/\b(app|aplicativo)\b/.test(textoBeneficio) ? "Oferta exclusiva App" : "");
  const freteGratis = /frete gratis|frete free|frete 0/.test(textoBeneficio)
    ? "Frete gratis"
    : "";
  const acumulavel = /acumulavel|acumula/.test(textoBeneficio)
    ? "Cupom acumulavel"
    : "";
  const beneficioExtra =
    cupomRadar.beneficioExtra ||
    descontoPix ||
    descontoApp ||
    freteGratis ||
    acumulavel ||
    avisoUtil;

  return {
    cupom: cupomRadar.cupom,
    avisoCupom: avisoUtil,
    tipoCupom: cupomRadar.tipoCupom,
    valorCupom: cupomRadar.valorCupom,
    percentualCupom: cupomRadar.percentualCupom,
    descontoPix,
    descontoApp,
    beneficioExtra,
    cupomConfirmado: cupomRadar.cupomConfirmado,
    possivelCupom: cupomRadar.possivelCupom && Boolean(avisoUtil || beneficioExtra)
  };
}

async function enriquecerBeneficioRadarOferta(oferta = {}, contexto = {}) {
  try {
    const enriquecida = await aplicarCuponsAutomaticos(oferta, contexto);
    return {
      ...oferta,
      ...(enriquecida || {})
    };
  } catch (e) {
    console.log("[RADAR] beneficio nao enriquecido:", e.message);
    return oferta;
  }
}

function categoriaRadarReclassificada(oferta = {}) {
  const texto = normalizarTexto([
    oferta.titulo,
    oferta.nome,
    oferta.descricao,
    oferta.termo
  ].filter(Boolean).join(" "));

  if (/mop|esfregao|rodo|vassoura|multiuso|desinfetante|detergente|desengordurante|amaciante|sabaoliquido|sabaoempo|lavaroupas|tiramanchas|alvejante|aguasanitaria|limpavidro|limpapiso|papelhigienico|kitlimpeza|refilmop|esponjalimpeza/.test(texto)) {
    return "Limpeza";
  }

  if (/processadordealimentos|multiprocessador|liquidificador|mixer|batedeira/.test(texto)) {
    return "Eletroport\u00e1teis";
  }

  return classificarCategoriaOferta({
    ...oferta,
    categoria: "",
    categoriaProduto: ""
  }, oferta.titulo || oferta.nome || oferta.termo || "");
}

function categoriaDiversosRadar(valor = "") {
  return normalizarTexto(valor || "") === "diversos";
}

function categoriaGenericaRadar(valor = "") {
  const texto = normalizarTexto(valor || "");
  return !texto ||
    texto === "diversos" ||
    texto === "mercado livre" ||
    texto === "nao identificada" ||
    texto === "nao identificado";
}

function textoCompletoRadarOferta(oferta = {}) {
  return [
    oferta.mensagemOriginalRadar,
    oferta.textoOriginal,
    oferta.textoResumo,
    oferta.mensagemResumo,
    oferta.descricao,
    oferta.titulo,
    oferta.nome
  ].filter(Boolean).join("\n");
}

function tituloTextoRadarMl(oferta = {}) {
  const texto = textoCompletoRadarOferta(oferta);
  const titulo = extrairTituloKabumFallbackRadar(
    String(texto || "").replace(/https?:\/\/\S*(?:meli\.la|mercadolivre\.com\.br)\S*/gi, "")
  );

  return tituloGenericoMercadoLivreRadar(titulo) ? "" : titulo;
}

function categoriaManualTextoRadarMlDetalhada(texto = "") {
  const normalizado = normalizarTexto(texto || "");

  const regras = [
    {
      regra: "games_console",
      categoria: "Games e Console",
      padrao: /gamepass|gpupass|xbox|playstation|dualsense|ps5|nintendo|ultimate/
    },
    {
      regra: "esporte_suplementos",
      categoria: "Esporte e Suplementos",
      padrao: /whey|creatina|glutamine|pretreino|blackskull|fullcombat|fullshape|bcaa/
    },
    {
      regra: "perfumaria_farmacia_beleza",
      categoria: "Perfumaria, Farm\u00e1cia e Beleza",
      padrao: /oralb|colgate|gillette|oneblade|philipsoneblade|lolacosmetics|shampoo|condicionador|leavein|argan|perfume|perfum|fragrancia|fragrancias|edt|eaudeparfum|colonia|nautica|bodysplash|malbec|natura|boticario|eudora|rubyrose|protetorlabial|batom|lipbalm|gloss|mascaracapilar|kitcabelo|cabelo|isima|skincare|hidratante|maquiagem/
    },
    {
      regra: "alimentos_mercearia",
      categoria: "Alimentos e Mercearia",
      padrao: /heinz|ketchup|maionese|mostarda|ovomaltine|alpino|nestle|chocolate|achocolatado/
    },
    {
      regra: "gamer_hardware_texto_radar",
      categoria: "Gamer e Hardware",
      padrao: /watercooler|cooler|ventoinha|kitfan|fanrgb|fanargb|fan120mm|fanpc|gabinete|placamae|placadevideo|memoriaram|ssd|fontegamer/
    },
    {
      regra: "casa_moveis_decoracao",
      categoria: "Casa, M\u00f3veis e Decora\u00e7\u00e3o",
      padrao: /painel|madeira|mdf|ripado|cozinha|tigela|panela|cacarola|cadeira|mesa|prato|talher|copo|taca|xicara|jogodejantar|aparelhodejantar|dormir|jogodecama|roupadecama|travesseiro|edredom|cobertor|lencol|colchao|coberdrom/
    },
    {
      regra: "brinquedos_infantis",
      categoria: "Brinquedos e Artigos Infantis",
      padrao: /maquinadegarra|pelucia|brinquedo/
    },
    {
      regra: "limpeza",
      categoria: "Limpeza",
      padrao: /zipclean|limpagordura|espumamagica|tiramanchas|alvejante/
    },
    {
      regra: "ferramentas_jardim",
      categoria: "Ferramentas",
      padrao: /mangueira|mangueiramagica|expansivel|retratil|jardim|irrigacao|esguicho|lavadora|lavarcarro/
    },
    {
      regra: "moda",
      categoria: "Roupas e Moda Masculina",
      padrao: /techtshirt|tshirt|longsleeve|mangalonga|camiseta|camisa|blusa|cropped|legging|calca|short|shorts|modafeminina|feminina|mulher/
    }
  ];

  for (const regra of regras) {
    if (!regra.padrao.test(normalizado)) continue;
    if (regra.regra === "moda" && /feminina|mulher|cropped|legging|vestido|body/.test(normalizado)) {
      return {
        categoria: "Roupas e Moda Feminina",
        regra: "moda_feminina"
      };
    }
    return {
      categoria: regra.categoria,
      regra: regra.regra
    };
  }

  return {
    categoria: "",
    regra: ""
  };
}

function categoriaManualTextoRadarMl(texto = "") {
  return categoriaManualTextoRadarMlDetalhada(texto).categoria;
}

function aplicarFallbackCategoriaRadarMl(oferta = {}, clienteId = "admin") {
  const marketplace = normalizarMarketplaceRadar(oferta.marketplace || oferta.mercado || oferta.marketplaceOriginalRadar || "");
  if (marketplace !== "mercadolivre") return oferta;

  const tituloAntes = oferta.titulo || oferta.nome || "";
  const categoriaAntes = oferta.categoria || oferta.categoriaProduto || "";
  if (!categoriaDiversosRadar(categoriaAntes)) return oferta;

  const textoRadar = textoCompletoRadarOferta(oferta);
  const tituloTexto = tituloTextoRadarMl(oferta);
  const precisaTitulo = tituloGenericoMercadoLivreRadar(tituloAntes);
  const precisaCategoria = true;
  let tituloDepois = tituloAntes;
  let categoriaDepois = categoriaAntes;
  let motivo = "";

  if (precisaTitulo && tituloTexto) {
    tituloDepois = tituloTexto;
    motivo = "titulo_generico_substituido";
  }

  if (precisaCategoria && (tituloDepois || tituloTexto || textoRadar)) {
    const textoClassificacao = [
      tituloDepois,
      tituloTexto,
      textoRadar
    ].filter(Boolean).join(" ");
    const categoriaManualDetalhada = categoriaManualTextoRadarMlDetalhada(textoClassificacao);
    const categoriaManual = categoriaManualDetalhada.categoria;
    const categoriaClassificada = categoriaManual || classificarCategoriaOferta({
      ...oferta,
      titulo: tituloDepois || tituloTexto || oferta.titulo || oferta.nome || "",
      nome: tituloDepois || tituloTexto || oferta.nome || oferta.titulo || "",
      descricao: textoRadar,
      categoria: "",
      categoriaProduto: ""
    }, textoClassificacao);

    if (!categoriaGenericaRadar(categoriaClassificada)) {
      categoriaDepois = categoriaClassificada;
      motivo = categoriaManualDetalhada.regra || motivo || "categoria_diversos_reclassificada";
    }
  }

  const usouTextoRadar = Boolean(
    textoRadar &&
    (
      tituloDepois !== tituloAntes ||
      categoriaDepois !== categoriaAntes
    )
  );

  if (usouTextoRadar || precisaTitulo || precisaCategoria) {
    console.log("[RADAR-CATEGORIA-FALLBACK]", {
      clienteId,
      tituloImportador: tituloAntes,
      tituloRadar: tituloTexto,
      tituloAntes,
      tituloDepois,
      categoriaAntes,
      categoriaDepois,
      usouTextoRadar,
      regraAplicada: motivo || "sem_alteracao",
      motivo: motivo || "sem_alteracao"
    });
  }

  if (categoriaDiversosRadar(categoriaAntes) && !categoriaGenericaRadar(categoriaDepois) && categoriaDepois !== categoriaAntes) {
    console.log("[RADAR-CATEGORIA-TEXTO-FALLBACK]", {
      clienteId,
      tituloImportador: tituloAntes,
      textoRadarResumo: String(textoRadar || "").slice(0, 300),
      categoriaAntes,
      categoriaDepois,
      regraAplicada: motivo || "categoria_diversos_reclassificada"
    });
  }

  return {
    ...oferta,
    titulo: tituloDepois || tituloAntes,
    nome: tituloDepois || oferta.nome || oferta.titulo || "",
    categoria: categoriaDepois || categoriaAntes,
    categoriaProduto: categoriaDepois || oferta.categoriaProduto || categoriaAntes,
    fallbackCategoriaRadarMl: usouTextoRadar || oferta.fallbackCategoriaRadarMl === true
  };
}

function chaveDuplicidadeRadar(oferta = {}) {
  const titulo = normalizarTexto(oferta.titulo || oferta.nome || "");
  const marketplace = normalizarMarketplaceRadar(
    oferta.marketplace ||
    oferta.mercado ||
    oferta.marketplaceOriginalRadar ||
    ""
  );
  const preco = precoChaveRadar(oferta);
  const links = [
    oferta.linkOriginal,
    oferta.linkAfiliado,
    oferta.link,
    oferta.linkFinal
  ]
    .map(link => textoRadarId(link).toLowerCase())
    .filter(Boolean);

  return [
    ...links.map(link => `link:${link}`),
    marketplace && titulo && preco ? `produto:${marketplace}|${titulo}|${preco}` : "",
    !preco && marketplace && titulo ? `produto:${marketplace}|${titulo}` : ""
  ].filter(Boolean);
}

function deduplicarOportunidadesRadar(oportunidades = []) {
  const vistos = new Set();
  const unicas = [];

  for (const oportunidade of oportunidades) {
    const chaves = chaveDuplicidadeRadar(oportunidade);
    if (chaves.some(chave => vistos.has(chave))) continue;

    for (const chave of chaves) {
      vistos.add(chave);
    }

    unicas.push(oportunidade);
  }

  return unicas;
}

function validarSessaoRadarCliente(clienteId = "admin", sessaoWhatsappId = "") {
  const sessaoInformada = String(sessaoWhatsappId || "").trim();

  if (!sessaoInformada) {
    return { ok: true, sessaoWhatsappId: "" };
  }

  const sessaoNormalizada = normalizarSessaoId(clienteId, sessaoInformada);
  const sessaoResolvida = resolverSessaoWhatsappRadarCliente(clienteId, sessaoInformada);
  const existe =
    sessoesMeta[sessaoInformada] ||
    sessoesMeta[sessaoNormalizada] ||
    statusSessao[sessaoInformada] ||
    statusSessao[sessaoNormalizada] ||
    sessoes[sessaoInformada] ||
    sessoes[sessaoNormalizada] ||
    (sessaoResolvida && (sessoesMeta[sessaoResolvida] || statusSessao[sessaoResolvida] || sessoes[sessaoResolvida] || gruposPorSessao[sessaoResolvida]?.length));

  if (!existe) {
    return { ok: false, motivo: "sessao_whatsapp_nao_encontrada" };
  }

  return {
    ok: true,
    sessaoWhatsappId: sessaoResolvida || (sessoesMeta[sessaoInformada] || statusSessao[sessaoInformada] || sessoes[sessaoInformada]
      ? sessaoInformada
      : sessaoNormalizada)
  };
}

function normalizarMarketplaceRadar(marketplace = "") {
  const mp = normalizarTexto(marketplace || "");
  return mp === "kabum" ? "awin" : mp;
}

function destinosClienteNormalizados(clienteId = "admin") {
  const destinosCliente = destinosPorCliente?.[clienteId];

  if (Array.isArray(destinosCliente)) {
    return destinosCliente;
  }

  return Object.values(destinosCliente || {})
    .filter(Array.isArray)
    .flat();
}

function obterClienteIdAdminMaster() {
  // Radar e uma ferramenta interna do admin_master, mas a configuracao operacional
  // deve ser unica e canonica no cliente "admin". Nao usar configs legadas de
  // outros ids, para nao monitorar grupos antigos ou nao selecionados.
  return "admin";
}

function carregarRadarConfigAdminMaster() {
  return carregarRadarConfigCliente(obterClienteIdAdminMaster());
}

function getUsuarioClienteRadar(clienteId = "admin") {
  const cid = String(clienteId || "admin");
  const usuario = usuarios.find(u => String(u.id) === cid);

  if (usuario) return usuario;

  if (cid === "admin") {
    return {
      id: "admin",
      nome: "Admin",
      papel: "admin_master",
      plano: "master",
      ativo: true
    };
  }

  return null;
}

function listarClientesElegiveisRadar() {
  const mapa = new Map();
  const adminCliente = getUsuarioClienteRadar("admin");

  if (adminCliente?.ativo !== false) {
    mapa.set("admin", {
      ...adminCliente,
      id: "admin"
    });
  }

  for (const usuario of usuarios) {
    if (!usuario?.ativo) continue;

    const clienteId = String(usuario.id || "");
    if (!clienteId) continue;

    if (usuario.papel === "admin_master" && clienteId !== "admin") {
      continue;
    }

    mapa.set(clienteId, usuario);
  }

  return [...mapa.values()];
}

function extrairMensagemInternaRadar(conteudo = {}) {
  let atual = conteudo || {};

  for (let i = 0; i < 8; i++) {
    if (atual?.ephemeralMessage?.message) {
      atual = atual.ephemeralMessage.message;
      continue;
    }

    if (atual?.viewOnceMessage?.message) {
      atual = atual.viewOnceMessage.message;
      continue;
    }

    if (atual?.viewOnceMessageV2?.message) {
      atual = atual.viewOnceMessageV2.message;
      continue;
    }

    if (atual?.documentWithCaptionMessage?.message) {
      atual = atual.documentWithCaptionMessage.message;
      continue;
    }

    if (atual?.editedMessage?.message) {
      atual = atual.editedMessage.message;
      continue;
    }

    if (atual?.protocolMessage?.editedMessage) {
      atual = atual.protocolMessage.editedMessage;
      continue;
    }

    break;
  }

  return atual || {};
}

function extrairTextoMensagemRadar(mensagem = {}) {
  const conteudo = extrairMensagemInternaRadar(mensagem.message || {});

  return [
    conteudo.conversation,
    conteudo.extendedTextMessage?.text,
    conteudo.imageMessage?.caption,
    conteudo.videoMessage?.caption,
    conteudo.documentMessage?.caption,
    conteudo.buttonsResponseMessage?.selectedDisplayText,
    conteudo.listResponseMessage?.title,
    conteudo.templateButtonReplyMessage?.selectedDisplayText,
    conteudo.buttonsMessage?.contentText,
    conteudo.templateMessage?.hydratedTemplate?.hydratedContentText,
    conteudo.templateMessage?.hydratedFourRowTemplate?.hydratedContentText,
    conteudo.interactiveResponseMessage?.body?.text,
    conteudo.protocolMessage?.editedMessage?.conversation,
    conteudo.protocolMessage?.editedMessage?.extendedTextMessage?.text,
    conteudo.messageContextInfo?.quotedMessage?.conversation,
    conteudo.messageContextInfo?.quotedMessage?.extendedTextMessage?.text,
    conteudo.contextInfo?.quotedMessage?.conversation,
    conteudo.contextInfo?.quotedMessage?.extendedTextMessage?.text
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}


function limparLinkRadar(link = "") {
  return radarCupomMensagem.limparLinkRadar(link);
}

function extrairLinksRadar(texto = "") {
  return radarCupomMensagem.extrairLinksRadar(texto);
}

function normalizarCupomMensagemRadar(cupom = "") {
  return radarCupomMensagem.normalizarCupomMensagemRadar(cupom);
}

function extrairCupomTextoRadar(texto = "") {
  return radarCupomMensagem.extrairCupomTextoRadar(texto);
}

function trechoProximoLinkRadar(texto = "", link = "") {
  return radarCupomMensagem.trechoProximoLinkRadar(texto, link);
}

function textoIndicaResgateCupomRadar(texto = "") {
  return radarCupomMensagem.textoIndicaResgateCupomRadar(texto);
}

function analisarBeneficiosMensagemRadar(texto = "", links = []) {
  return radarCupomMensagem.analisarBeneficiosMensagemRadar(texto, links);
}

function obterNomeGrupoRadar(sessaoId = "", grupoId = "") {
  const grupos = gruposPorSessao[sessaoId] || [];
  const grupo = grupos.find(g =>
    [g.id, g.grupoId, g.value, g.jid, g.remoteJid]
      .filter(Boolean)
      .some(valor => String(valor) === String(grupoId))
  );

  return grupo?.nome || grupo?.name || grupo?.subject || grupo?.titulo || grupo?.label || "";
}

function detectarMarketplaceRadarLink(url = "") {
  const urlLower = String(url || "").toLowerCase();

  if (urlLower.includes("go.promozone.ai/mercadolivre") || urlLower.includes("promozone") && urlLower.includes("mercadolivre")) {
    return "mercadolivre";
  }

  if (urlLower.includes("go.promozone.ai/shopee") || urlLower.includes("promozone") && urlLower.includes("shopee")) {
    return "shopee";
  }

  if (
    urlLower.includes("go.promozone.ai/amazon") ||
    urlLower.includes("go.promozone.ai/amz/") ||
    urlLower.includes("promozone") && (urlLower.includes("amazon") || urlLower.includes("/amz/"))
  ) {
    return "amazon";
  }

  if (urlLower.includes("mercadolivre.com") || urlLower.includes("mercadolivre.com.br") || urlLower.includes("meli.la")) {
    return "mercadolivre";
  }

  if (urlLower.includes("shopee.com") || urlLower.includes("s.shopee.")) {
    return "shopee";
  }

  if (urlLower.includes("amazon.") || urlLower.includes("amzn.to")) {
    return "amazon";
  }

  if (urlLower.includes("aliexpress.")) {
    return "aliexpress";
  }

  if (urlLower.includes("kabum.com.br")) {
    return "kabum";
  }

  if (urlLower.includes("awin1.com") || urlLower.includes("awin.com")) {
    return "awin";
  }

  return detectarMarketplaceManual(url, "");
}

function imagemOfertaRadar(oferta = {}) {
  return String(
    oferta.imagem ||
    oferta.image ||
    oferta.foto ||
    oferta.thumbnail ||
    oferta.imageUrl ||
    ""
  ).trim();
}

function logRadarMlImagemDebug({
  clienteId = "admin",
  oferta = {},
  linkOriginal = "",
  linkResolvido = "",
  imagemImportador = "",
  imagemOfertaRadar = "",
  imagemFila = ""
} = {}) {
  const marketplace = normalizarMarketplaceRadar(oferta.marketplace || oferta.mercado || "");
  if (marketplace !== "mercadolivre") return;

  console.log("[RADAR-ML-IMAGEM-DEBUG]", {
    clienteId,
    titulo: oferta.titulo || oferta.nome || "",
    linkOriginal,
    linkResolvido,
    imagemImportador,
    imagemOfertaRadar,
    imagemFila,
    temImagemImportador: Boolean(imagemImportador),
    temImagemFila: Boolean(imagemFila)
  });
}

function extrairAmazonAsinRadar(pathname = "") {
  const match = String(pathname || "").match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  return match?.[1] || "";
}

function limparUrlProdutoRadar(url = "", marketplace = "") {
  const mp = normalizarMarketplaceRadar(marketplace || detectarMarketplaceRadarLink(url));

  try {
    const parsed = new URL(url);
    parsed.hash = "";

    if (mp === "amazon") {
      const asin = extrairAmazonAsinRadar(parsed.pathname);
      if (!asin) return "";
      parsed.pathname = `/dp/${asin}`;
      parsed.search = "";
      return parsed.toString();
    }

    if (mp === "shopee") {
      parsed.search = "";
      return parsed.toString();
    }

    if (mp === "mercadolivre") {
      parsed.search = "";
      return parsed.toString();
    }

    if (mp === "aliexpress") {
      const itemMatch = parsed.pathname.match(/\/item\/(\d+)\.html/i);
      if (itemMatch?.[1]) {
        parsed.pathname = `/item/${itemMatch[1]}.html`;
      }
      parsed.search = "";
      return parsed.toString();
    }

    if (mp === "kabum" || mp === "awin") {
      parsed.search = "";
      return parsed.toString();
    }

    parsed.search = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function isUrlIntermediariaMercadoLivreRadar(url = "") {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const pathUrl = parsed.pathname.toLowerCase();

    if (!host.includes("mercadolivre.com")) return false;
    if (host.includes("produto.mercadolivre.com.br") && /\/mlb-?\d+/i.test(parsed.pathname)) return false;
    if (/\/p\/mlb/i.test(pathUrl)) return false;

    return (
      pathUrl.startsWith("/social/") ||
      pathUrl.startsWith("/ofertas/") ||
      pathUrl === "/p" ||
      pathUrl.startsWith("/p/") ||
      pathUrl.includes("/campanha") ||
      pathUrl.includes("/promocoes") ||
      !/mlb-?\d+/i.test(parsed.pathname + parsed.search)
    );
  } catch {
    return false;
  }
}

function normalizarUrlExtraidaMercadoLivreRadar(link = "") {
  const texto = String(link || "")
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .trim();

  if (!texto) return "";
  if (texto.startsWith("//")) return `https:${texto}`;
  if (texto.startsWith("/")) return `https://www.mercadolivre.com.br${texto}`;
  if (texto.startsWith("www.")) return `https://${texto}`;
  return texto;
}

function extrairProdutoMercadoLivreDeHtmlRadar(html = "") {
  const texto = String(html || "");
  const candidatos = [
    ...texto.matchAll(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/gi),
    ...texto.matchAll(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/gi),
    ...texto.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/gi),
    ...texto.matchAll(/(?:href|data-href)=["']([^"']*(?:produto\.mercadolivre\.com\.br\/MLB|mercadolivre\.com\.br\/p\/MLB|permalink\/MLB)[^"']*)["']/gi),
    ...texto.matchAll(/"permalink"\s*:\s*"([^"]*MLB[^"]*)"/gi),
    ...texto.matchAll(/"url"\s*:\s*"([^"]*MLB[^"]*)"/gi),
    ...texto.matchAll(/"canonicalUrl"\s*:\s*"([^"]*MLB[^"]*)"/gi),
    ...texto.matchAll(/https?:\\?\/\\?\/[^"'<>\\\s]*(?:produto\.mercadolivre\.com\.br\\?\/MLB|mercadolivre\.com\.br\\?\/p\\?\/MLB|permalink\\?\/MLB)[^"'<>\\\s]*/gi)
  ]
    .map(match => normalizarUrlExtraidaMercadoLivreRadar(match[1] || match[0]))
    .filter(Boolean);

  const itemId =
    texto.match(/\b(MLB-?\d{6,})\b/i)?.[1]?.replace("-", "").toUpperCase() ||
    "";

  if (itemId) {
    candidatos.push(`https://produto.mercadolivre.com.br/${itemId}`);
  }

  for (const candidato of candidatos) {
    const limpo = limparUrlProdutoRadar(candidato, "mercadolivre");
    if (!limpo || isUrlIntermediariaMercadoLivreRadar(limpo)) continue;
    if (/produto\.mercadolivre\.com\.br\/MLB-?\d+/i.test(limpo) || /mercadolivre\.com\.br\/p\/MLB/i.test(limpo) || /mercadolivre\.com\.br\/permalink\/MLB/i.test(limpo)) {
      return limpo;
    }
  }

  return "";
}

function normalizarUrlExtraidaRadar(link = "", base = "") {
  const texto = String(link || "")
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .trim();

  if (!texto) return "";

  try {
    if (texto.startsWith("//")) return `https:${texto}`;
    if (texto.startsWith("http://") || texto.startsWith("https://")) return texto;
    if (texto.startsWith("/") && base) return new URL(texto, base).toString();
    if (texto.startsWith("www.")) return `https://${texto}`;
  } catch {}

  return texto;
}

function candidatosUrlHtmlRadar(html = "", base = "") {
  const texto = String(html || "");
  const candidatos = [
    ...texto.matchAll(/https?%3A%2F%2F[^"'<>\\\s]+/gi),
    ...texto.matchAll(/(?:url|u|target|redirect|destination|dest|link|to)=((?:https?%3A%2F%2F|https?:\/\/)[^"'<>\\\s&]+)/gi),
    ...texto.matchAll(/(?:window\.location(?:\.href)?|location\.href)\s*=\s*["']([^"']+)["']/gi),
    ...texto.matchAll(/content=["'][^"']*url=([^"']+)["']/gi),
    ...texto.matchAll(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/gi),
    ...texto.matchAll(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/gi),
    ...texto.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/gi),
    ...texto.matchAll(/"canonicalUrl"\s*:\s*"([^"]+)"/gi),
    ...texto.matchAll(/"permalink"\s*:\s*"([^"]+)"/gi),
    ...texto.matchAll(/"url"\s*:\s*"([^"]+)"/gi),
    ...texto.matchAll(/href=["']([^"']+)["']/gi)
  ];

  return [
    ...candidatos
  ]
    .map(match => {
      let valor = match[1] || match[0] || "";
      for (let i = 0; i < 3; i += 1) {
        try {
          const decodificado = decodeURIComponent(valor);
          if (decodificado === valor) break;
          valor = decodificado;
        } catch {
          break;
        }
      }
      return normalizarUrlExtraidaRadar(valor, base);
    })
    .filter(Boolean);
}

function extrairProdutoDeParametrosIntermediarioRadar(url = "", marketplace = "") {
  const mp = normalizarMarketplaceRadar(marketplace || detectarMarketplaceRadarLink(url));
  const chaves = [
    "url",
    "u",
    "target",
    "redirect",
    "redirect_url",
    "destination",
    "dest",
    "link",
    "to",
    "r"
  ];

  try {
    const parsed = new URL(url);
    const candidatos = [];

    for (const chave of chaves) {
      const valor = parsed.searchParams.get(chave);
      if (!valor) continue;

      let atual = valor;
      for (let tentativas = 0; tentativas < 3; tentativas += 1) {
        try {
          atual = decodeURIComponent(atual);
        } catch {
          break;
        }
      }

      candidatos.push(normalizarUrlExtraidaRadar(atual));
    }

    for (const candidato of candidatos.filter(Boolean)) {
      const marketplaceCandidato = normalizarMarketplaceRadar(detectarMarketplaceRadarLink(candidato) || mp);
      const limpo = limparUrlProdutoRadar(candidato, marketplaceCandidato);
      if (limpo && !isUrlIntermediariaRadar(limpo, marketplaceCandidato)) {
        return {
          url: limpo,
          marketplace: marketplaceCandidato
        };
      }
    }
  } catch {}

  return null;
}

function isUrlProdutoShopeeRadar(url = "") {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const pathUrl = parsed.pathname.toLowerCase();
    if (!host.includes("shopee.")) return false;
    if (host.startsWith("s.")) return false;
    if (pathUrl.includes("/voucher") || pathUrl.includes("/m/coupon") || pathUrl.includes("/buyer/login")) return false;
    return /\/product\/\d+\/\d+/.test(pathUrl) || /-i\.\d+\.\d+/.test(pathUrl) || /i\.\d+\.\d+/.test(pathUrl);
  } catch {
    return false;
  }
}

function isUrlProdutoAmazonRadar(url = "") {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!host.includes("amazon.")) return false;
    return Boolean(extrairAmazonAsinRadar(parsed.pathname));
  } catch {
    return false;
  }
}

function extrairProdutoMarketplaceDeHtmlRadar(html = "", marketplace = "", base = "") {
  const mp = normalizarMarketplaceRadar(marketplace);
  const candidatos = candidatosUrlHtmlRadar(html, base);
  const texto = String(html || "");

  if (mp === "mercadolivre") {
    return extrairProdutoMercadoLivreDeHtmlRadar(html);
  }

  if (mp === "amazon") {
    const asin =
      candidatos.map(candidato => {
        try {
          return extrairAmazonAsinRadar(new URL(candidato).pathname);
        } catch {
          return "";
        }
      }).find(Boolean) ||
      texto.match(/\b([A-Z0-9]{10})\b/)?.[1] ||
      "";

    if (asin) {
      return `https://www.amazon.com.br/dp/${asin}`;
    }
  }

  if (mp === "shopee") {
    for (const candidato of candidatos) {
      const limpo = limparUrlProdutoRadar(candidato, "shopee");
      if (limpo && isUrlProdutoShopeeRadar(limpo)) {
        return limpo;
      }
    }
  }

  return "";
}

function isUrlIntermediariaRadar(url = "", marketplace = "") {
  const mp = normalizarMarketplaceRadar(marketplace || detectarMarketplaceRadarLink(url));

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const pathUrl = parsed.pathname.toLowerCase();

    if (host.includes("promozone") || host.includes("awin1.com") || host.includes("awin.com")) return true;

    if (mp === "mercadolivre") {
      if (!host.includes("mercadolivre.com") && !host.includes("meli.la")) return true;
      return isUrlIntermediariaMercadoLivreRadar(url);
    }

    if (mp === "amazon") {
      if (host.includes("amzn.to")) return true;
      if (!host.includes("amazon.")) return true;
      return !isUrlProdutoAmazonRadar(url);
    }

    if (mp === "shopee") {
      if (host.startsWith("s.")) return true;
      if (!host.includes("shopee.")) return true;
      return !isUrlProdutoShopeeRadar(url);
    }
  } catch {
    return true;
  }

  return false;
}

async function baixarHtmlRadar(url = "") {
  try {
    const resposta = await axios.get(url, {
      maxRedirects: 3,
      timeout: 7000,
      responseType: "text",
      maxContentLength: 1024 * 768,
      validateStatus: () => true,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
      }
    });

    return {
      ok: resposta.status >= 200 && resposta.status < 400,
      status: resposta.status,
      html: resposta.data || "",
      urlFinal:
        resposta?.request?.res?.responseUrl ||
        resposta?.request?._redirectable?._currentUrl ||
        url
    };
  } catch (e) {
    return {
      ok: false,
      erro: e.message,
      html: "",
      urlFinal: url
    };
  }
}

async function extrairProdutoMercadoLivreIntermediarioRadar(url = "") {
  console.log("[RADAR] ML social detectado", { url });

  try {
    const resposta = await axios.get(url, {
      maxRedirects: 3,
      timeout: 7000,
      responseType: "text",
      maxContentLength: 1024 * 512,
      validateStatus: () => true,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
      }
    });
    const produto = extrairProdutoMercadoLivreDeHtmlRadar(resposta.data || "");

    if (produto) {
      console.log("[RADAR] ML produto extraído", {
        intermediaria: url,
        produto
      });
      return produto;
    }
  } catch (e) {
    console.log("[RADAR] ML produto não encontrado", {
      intermediaria: url,
      erro: e.message
    });
    return "";
  }

  console.log("[RADAR] ML produto não encontrado", {
    intermediaria: url
  });
  return "";
}

function importacaoRadarIncompleta(oferta = {}, marketplace = "") {
  return Boolean(motivoImportacaoRadarIncompleta(oferta, marketplace));
}

function motivoImportacaoRadarIncompleta(oferta = {}, marketplace = "") {
  const mp = normalizarMarketplaceRadar(marketplace || oferta.marketplace || "");
  const titulo = normalizarTexto(oferta.titulo || oferta.nome || "");
  const preco = textoRadarId(oferta.precoAtual || oferta.preco || "");
  const categoria = normalizarTexto(oferta.categoria || oferta.categoriaProduto || "");

  if (!titulo) return "importacao_sem_titulo";
  if (mp === "mercadolivre" && titulo === "produto mercado livre") return "importacao_incompleta";
  if (!preco) return "importacao_sem_preco";
  if (!categoria || categoria === "mercado livre" || categoria === "nao identificada" || categoria === "nao identificado") return "importacao_sem_categoria";

  return "";
}

function formatarPrecoRadarTexto(numero = 0) {
  return Number(numero).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function numeroPrecoRadarTexto(valor = "") {
  const texto = String(valor || "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
  const numero = Number(texto);
  return Number.isFinite(numero) && numero > 0 ? numero : 0;
}

function extrairPrecoFallbackTextoRadar(texto = "") {
  const original = String(texto || "");
  if (!original.trim()) return { ok: false, motivo: "texto_vazio" };

  if (/r\$\s*[\d.,]+\s*(?:a|ate|até|-)\s*r?\$?\s*[\d.,]+/i.test(original)) {
    return { ok: false, motivo: "faixa_preco" };
  }

  const padraoPor = /(?:\bpor\b|\bsai\s+por\b|\bsaindo\s+por\b|\bvalor\s+final\b|\bpreco\s+final\b)\s*:?\s*r\$\s*([0-9]{1,5}(?:\.[0-9]{3})*(?:,[0-9]{2})?)/gi;
  const candidatosPor = [...original.matchAll(padraoPor)]
    .map((match) => numeroPrecoRadarTexto(match[1]))
    .filter((numero) => numero > 0);
  const unicosPor = [...new Set(candidatosPor.map((numero) => numero.toFixed(2)))];

  if (unicosPor.length === 1) {
    return {
      ok: true,
      preco: formatarPrecoRadarTexto(Number(unicosPor[0])),
      origem: "por"
    };
  }
  if (unicosPor.length > 1) return { ok: false, motivo: "multiplos_precos_por" };

  const matches = [...original.matchAll(/r\$\s*([0-9]{1,5}(?:\.[0-9]{3})*(?:,[0-9]{2})?)/gi)];
  const candidatos = [];

  for (const match of matches) {
    const inicio = Math.max(0, match.index - 35);
    const fim = Math.min(original.length, match.index + match[0].length + 35);
    const contextoPreco = normalizarTexto(original.slice(inicio, fim));

    if (/\b(cupom|off|desconto|cashback|frete)\b/.test(contextoPreco)) continue;

    const numero = numeroPrecoRadarTexto(match[1]);
    if (numero > 0) candidatos.push(numero.toFixed(2));
  }

  const unicos = [...new Set(candidatos)];
  if (unicos.length === 1 && !/\b(de|era|antes)\s+r\$/i.test(original)) {
    return {
      ok: true,
      preco: formatarPrecoRadarTexto(Number(unicos[0])),
      origem: "preco_unico"
    };
  }

  if (matches.length > 0) {
    return {
      ok: false,
      motivo: unicos.length > 1 || candidatos.length !== matches.length ? "ambiguidade" : "preco_nao_confirmado"
    };
  }

  return { ok: false, motivo: "sem_preco_texto" };
}

function tituloGenericoMercadoLivreRadar(titulo = "") {
  const normalizado = normalizarTexto(titulo || "");
  return !normalizado || normalizado === "produto mercado livre";
}

function aplicarTituloFallbackTextoRadarMl(oferta = {}, contexto = {}) {
  const texto = contexto.textoOriginal || contexto.texto || contexto.mensagemOriginalRadar || "";
  const link = contexto.linkOriginal || contexto.link || "";
  const tituloAtual = oferta.titulo || oferta.nome || "";

  if (!tituloGenericoMercadoLivreRadar(tituloAtual)) return oferta;

  const tituloTexto = extrairTituloKabumFallbackRadar(
    String(texto || "").replace(/https?:\/\/\S*(?:meli\.la|mercadolivre\.com\.br)\S*/gi, "")
  );
  if (!tituloTexto || tituloGenericoMercadoLivreRadar(tituloTexto)) {
    console.log("ml_titulo_fallback_texto_radar_indisponivel", {
      link,
      tituloAtual: tituloAtual || ""
    });
    return oferta;
  }

  const categoria = classificarCategoriaOferta({
    ...oferta,
    titulo: tituloTexto,
    nome: tituloTexto,
    categoria: "",
    categoriaProduto: ""
  }, tituloTexto);

  console.log("ml_titulo_fallback_texto_radar_usado", {
    titulo: tituloTexto,
    categoria,
    link
  });

  return {
    ...oferta,
    titulo: tituloTexto,
    nome: tituloTexto,
    categoria,
    categoriaProduto: categoria,
    tituloOrigem: "texto_radar",
    fallbackTituloMercadoLivreRadar: true
  };
}

function aplicarPrecoFallbackTextoRadarMl(oferta = {}, contexto = {}) {
  const texto = contexto.textoOriginal || contexto.texto || contexto.mensagemOriginalRadar || "";
  const link = contexto.linkOriginal || contexto.link || "";
  const resultado = extrairPrecoFallbackTextoRadar(texto);

  if (!resultado.ok) {
    console.log("ml_preco_fallback_texto_radar_ambiguidade", {
      motivo: resultado.motivo,
      link
    });
    return oferta;
  }

  console.log("ml_preco_fallback_texto_radar_usado", {
    preco: resultado.preco,
    origem: resultado.origem,
    link
  });

  return {
    ...oferta,
    preco: oferta.preco || resultado.preco,
    precoAtual: oferta.precoAtual || resultado.preco,
    precoOrigem: "texto_radar",
    avisoPreco: "Preço extraído da mensagem do Radar"
  };
}
function limparLinhaTituloKabumRadar(linha = "") {
  return String(linha || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/www\.\S+/gi, "")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/^[\s\-_*•:|]+/g, "")
    .replace(/[\s\-_*•:|]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extrairTituloKabumFallbackRadar(texto = "") {
  const linhas = String(texto || "")
    .split(/\r?\n+/)
    .map(limparLinhaTituloKabumRadar)
    .filter(Boolean);

  const rejeitar = /^(?:r\$|por\b|de\b|cupom\b|use\b|frete\b|link\b|compre\b|aproveite\b|promo\b|oferta\b)/i;
  const candidatos = linhas.filter(linha => {
    if (linha.length < 8) return false;
    if (/https?:|kabum\.com\.br/i.test(linha)) return false;
    if (/^r\$\s*[\d.,]+$/i.test(linha)) return false;
    if (rejeitar.test(linha)) return false;
    if (/\b(cupom|frete|cashback|desconto|off)\b/i.test(linha) && linha.length < 35) return false;
    return /[a-zA-Z\u00C0-\u00FF]{3,}/.test(linha);
  });

  return (candidatos[0] || linhas.find(linha => /[a-zA-Z\u00C0-\u00FF]{3,}/.test(linha)) || "")
    .slice(0, 180)
    .trim();
}

function montarOfertaMercadoLivreRadarFallbackTexto(linkOriginal = "", contexto = {}) {
  const texto = contexto.textoOriginal || contexto.texto || contexto.mensagemOriginalRadar || "";
  const titulo = extrairTituloKabumFallbackRadar(texto);
  const precoExtraido = extrairPrecoFallbackTextoRadar(texto);
  const imagem = extrairImagemMensagemRadarRaw(contexto.raw || {});

  if (!titulo || !precoExtraido.ok) {
    return {
      ok: false,
      motivo: "mercadolivre_radar_dados_insuficientes",
      motivoTecnico: "mercadolivre_radar_dados_insuficientes",
      detalhes: {
        tituloOk: Boolean(titulo),
        precoOk: Boolean(precoExtraido.ok),
        motivoPreco: precoExtraido.motivo || ""
      }
    };
  }

  return {
    ok: true,
    oferta: {
      marketplace: "mercadolivre",
      titulo,
      nome: titulo,
      precoAtual: precoExtraido.preco,
      preco: precoExtraido.preco,
      precoOrigem: "texto_radar",
      avisoPreco: "Preco extraido da mensagem do Radar",
      imagem,
      image: imagem,
      linkOriginal,
      linkOriginalRadar: contexto.linkOriginalRadar || linkOriginal,
      linkResolvido: contexto.linkResolvido || linkOriginal,
      link: linkOriginal,
      linkAfiliado: "",
      linkFinal: "",
      categoria: classificarCategoriaOferta({
        marketplace: "mercadolivre",
        titulo,
        nome: titulo,
        categoria: "",
        categoriaProduto: ""
      }, titulo),
      origem: "radar",
      radar: true,
      status: "rascunho",
      tipoLinkRadar: "shortlink_meli_social",
      fallbackMercadoLivreRadarTexto: true,
      motivoFallback: "meli_social_importador_falhou_texto_radar"
    }
  };
}

function extrairImagemMensagemRadarRaw(raw = {}) {
  const vistos = new Set();

  function visitar(valor, profundidade = 0) {
    if (!valor || profundidade > 8) return "";
    if (typeof valor !== "object") return "";
    if (vistos.has(valor)) return "";
    vistos.add(valor);

    const candidatosUrl = [
      valor.imagem,
      valor.image,
      valor.foto,
      valor.thumbnail,
      valor.imageUrl,
      valor.photoUrl,
      valor.url,
      valor.directPath
    ].filter(v => typeof v === "string" && /^https?:\/\//i.test(v));

    if (candidatosUrl.length) return candidatosUrl[0];

    const miniatura = valor.jpegThumbnail || valor.thumbnail;
    if (Buffer.isBuffer(miniatura) && miniatura.length) {
      return `data:image/jpeg;base64,${miniatura.toString("base64")}`;
    }

    if (miniatura instanceof Uint8Array && miniatura.length) {
      return `data:image/jpeg;base64,${Buffer.from(miniatura).toString("base64")}`;
    }

    for (const chave of ["imageMessage", "extendedTextMessage", "message", "raw", "payload", "quotedMessage"]) {
      const encontrada = visitar(valor[chave], profundidade + 1);
      if (encontrada) return encontrada;
    }

    for (const item of Object.values(valor)) {
      const encontrada = visitar(item, profundidade + 1);
      if (encontrada) return encontrada;
    }

    return "";
  }

  return visitar(raw);
}

function erroKabumHtml403(e = {}) {
  return e?.status === 403 ||
    e?.response?.status === 403 ||
    /http\s*403|\b403\b|bloqueou scraping/i.test(String(e?.message || ""));
}

function montarOfertaKabumRadarFallback403(linkOriginal = "", contexto = {}) {
  const texto = contexto.textoOriginal || contexto.texto || contexto.mensagemOriginalRadar || "";
  const titulo = extrairTituloKabumFallbackRadar(texto);
  const precoExtraido = extrairPrecoFallbackTextoRadar(texto);
  const imagem = extrairImagemMensagemRadarRaw(contexto.raw || {});

  if (!titulo || !precoExtraido.ok) {
    return {
      ok: false,
      motivo: "kabum_radar_dados_insuficientes",
      motivoTecnico: "kabum_radar_dados_insuficientes",
      detalhes: {
        tituloOk: Boolean(titulo),
        precoOk: Boolean(precoExtraido.ok),
        motivoPreco: precoExtraido.motivo || ""
      }
    };
  }

  return {
    ok: true,
    oferta: {
      marketplace: "kabum",
      marketplaceOriginalRadar: "kabum",
      titulo,
      nome: titulo,
      precoAtual: precoExtraido.preco,
      preco: precoExtraido.preco,
      precoOrigem: "texto_radar",
      avisoPreco: "Preco extraido da mensagem do Radar",
      imagem,
      image: imagem,
      linkOriginal,
      linkOriginalRadar: linkOriginal,
      linkResolvido: linkOriginal,
      link: linkOriginal,
      linkAfiliado: "",
      linkFinal: "",
      categoria: "Gamer e Hardware",
      origem: "radar",
      radar: true,
      status: "rascunho",
      fallbackKabumRadar403: true,
      motivoFallback: "kabum_http_403_awin_radar"
    }
  };
}
function percentualDescontoRadar(oferta = {}, radar = {}) {
  const valores = [
    radar.descontoPercentual,
    oferta.descontoPercentual,
    oferta.desconto,
    oferta.percentualDesconto
  ];

  for (const valor of valores) {
    const numero = Number(String(valor || "").replace(",", ".").replace(/[^\d.]/g, ""));
    if (Number.isFinite(numero) && numero > 0) return numero;
  }

  return 0;
}

function beneficioRadarUtil(oferta = {}, cupomRadar = {}) {
  if (oferta.cupomSuspeito === true || oferta.cupomMonetarioIncompativel === true) return false;

  const campos = [
    cupomRadar.avisoCupom,
    cupomRadar.beneficioExtra,
    cupomRadar.valorCupom,
    cupomRadar.percentualCupom,
    cupomRadar.descontoPix,
    cupomRadar.descontoApp,
    oferta.avisoCupom,
    oferta.beneficioExtra,
    oferta.linkResgateCupom
  ];

  const texto = normalizarTexto(campos.filter(Boolean).join(" "));
  if (!texto || avisoCupomGenericoRadar(texto)) return false;

  return Boolean(
    cupomRadar.possivelCupom ||
    cupomRadar.valorCupom ||
    cupomRadar.percentualCupom ||
    cupomRadar.descontoPix ||
    cupomRadar.descontoApp ||
    oferta.linkResgateCupom ||
    /(?:r\$\s*)?\d+(?:[,.]\d{1,2})?\s*(?:off|%|por cento|reais)/i.test(campos.filter(Boolean).join(" ")) ||
    /\b(frete gratis|pix|app|aplicativo|cashback|cupom|coupon|promocode|desconto)\b/.test(texto)
  );
}

function oportunidadeRadarBoa(oferta = {}, radar = {}, cupomRadar = {}) {
  if (cupomRadar.cupomConfirmado) return true;
  if (beneficioRadarUtil(oferta, cupomRadar)) return true;
  if (radar.decisao === "aprovado") return true;
  if (Number(radar.radarScore || 0) >= 60) return true;
  if (percentualDescontoRadar(oferta, radar) >= 15) return true;

  return false;
}

function dominioMarketplaceConhecidoRadar(url = "") {
  try {
    const parsed = new URL(String(url || "").trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

    if (host === "meli.la" || host.endsWith(".meli.la")) return "mercadolivre";
    if (host === "mercadolivre.com.br" || host.endsWith(".mercadolivre.com.br")) return "mercadolivre";
    if (host === "kabum.com.br" || host.endsWith(".kabum.com.br")) return "kabum";
    if (host === "amazon.com.br" || host.endsWith(".amazon.com.br")) return "amazon";
    if (host === "aliexpress.com" || host.endsWith(".aliexpress.com")) return "aliexpress";
    if (host === "shopee.com.br" || host.endsWith(".shopee.com.br")) return "shopee";
  } catch {}

  return "";
}

function dominioRadar(url = "") {
  try {
    return new URL(String(url || "").trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function linkRedirectPermitidoRadar(url = "") {
  return dominioRedirectPermitido(url);
}

function linkMeliLaRadar(url = "") {
  const host = dominioRadar(url).replace(/^www\./, "");
  return host === "meli.la" || host.endsWith(".meli.la");
}

function urlMercadoLivreProdutoRadar(url = "") {
  try {
    const parsed = new URL(String(url || "").trim());
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname || "";

    if (!host.endsWith("mercadolivre.com.br")) return false;
    if (host.includes("produto.mercadolivre.com.br") && /\/MLB-?\d+/i.test(path)) return true;
    if (/\/p\/MLB/i.test(path)) return true;
    if (/MLB-?\d+/i.test(path)) return true;

    return false;
  } catch {
    return false;
  }
}

function logRadarPipelineDebug(dados = {}) {
  console.log("[RADAR-PIPELINE-DEBUG]", {
    clienteId: dados.clienteId || "",
    grupoNome: dados.grupoNome || "",
    linkOriginal: dados.linkOriginal || "",
    linkResolvido: dados.linkResolvido || "",
    marketplace: dados.marketplace || "",
    cupom: dados.cupom || "",
    precoTexto: dados.precoTexto || "",
    tituloTexto: dados.tituloTexto || "",
    importadorChamado: dados.importadorChamado === true,
    linkAfiliadoOk: dados.linkAfiliadoOk === true,
    adicionouFila: dados.adicionouFila === true,
    motivoRecusa: dados.motivoRecusa || ""
  });
}

function logRedirectRadar(dados = {}) {
  console.log("[RADAR-REDIRECT]", {
    urlOriginal: dados.urlOriginal || "",
    urlFinal: dados.urlFinal || "",
    dominioOriginal: dados.dominioOriginal || dominioRadar(dados.urlOriginal || ""),
    dominioFinal: dados.dominioFinal || dominioRadar(dados.urlFinal || ""),
    marketplaceDetectado: dados.marketplaceDetectado || "",
    resolveu: dados.resolveu === true,
    motivo: dados.motivo || ""
  });
}

function logRadarMlSocialResolvido(dados = {}) {
  console.log("[RADAR-ML-SOCIAL-RESOLVIDO]", {
    clienteId: dados.clienteId || "",
    urlSocial: dados.urlSocial || "",
    encontrouProduto: dados.encontrouProduto === true,
    linkProduto: dados.linkProduto || "",
    metodo: dados.metodo || "",
    motivo: dados.motivo || ""
  });
}

function logPromozoneRadar(dados = {}) {
  console.log("[RADAR-PROMOZONE]", {
    urlOriginal: dados.urlOriginal || "",
    urlResolvida: dados.urlResolvida || "",
    marketplaceDetectado: dados.marketplaceDetectado || "",
    redirectOk: dados.redirectOk === true
  });
}

async function resolverLinkOriginalRadar(url = "") {
  const capturada = limparLinkRadar(url);
  const dominioOriginal = dominioRadar(capturada);

  logDebug("[RADAR-LINK] resolver inicio", {
    capturada
  });

  if (!capturada) {
    logRedirectRadar({
      urlOriginal: capturada,
      urlFinal: "",
      dominioOriginal,
      dominioFinal: "",
      marketplaceDetectado: "",
      resolveu: false,
      motivo: "link_original_nao_resolvido"
    });

    return {
      ok: false,
      motivo: "link_original_nao_resolvido",
      motivoTecnico: "link_original_nao_resolvido",
      urlCapturada: capturada,
      linkOriginalRadar: capturada,
      linkResolvido: "",
      tipoLinkRadar: "produto"
    };
  }

  const marketplaceDireto = dominioMarketplaceConhecidoRadar(capturada);
  const camposCanonicosCapturada = camposIdentidadeCanonicaOferta({
    urlOriginal: capturada,
    linkOriginal: capturada
  });

  if (linkRedirectPermitidoRadar(capturada)) {
    const marketplacePromozoneSugerido = normalizarMarketplaceRadar(detectarMarketplaceRadarLink(capturada));
    const redirect = await resolverRedirectUniversal(capturada, {
      timeout: 4500,
      maxRedirects: 5
    });
    const resolvida = redirect.urlFinal || "";
    const marketplaceFinal = normalizarMarketplaceRadar(redirect.marketplaceDetectado || "");
    const motivoFalha = redirect.metodo === "erro_http"
      ? "promozone_redirect_bloqueado"
      : "promozone_redirect_nao_resolvido";
    const motivoLogFalha = redirect.metodo === "erro_http"
      ? (redirect.motivo || motivoFalha)
      : motivoFalha;
    const camposCanonicosRedirect = camposIdentidadeCanonicaOferta({
      ...redirect,
      marketplace: marketplaceFinal || marketplacePromozoneSugerido || "",
      urlOriginal: capturada,
      urlFinal: resolvida
    });

    if (!redirect.ok || !marketplaceFinal || !resolvida || resolvida === capturada) {
      console.log("[RADAR-REDIRECT-FALHOU]", JSON.stringify({
        linkOriginal: capturada,
        motivo: motivoLogFalha
      }));

      logPromozoneRadar({
        urlOriginal: capturada,
        urlResolvida: resolvida,
        marketplaceDetectado: marketplaceFinal || marketplacePromozoneSugerido || "",
        redirectOk: false
      });
      logRedirectRadar({
        urlOriginal: capturada,
        urlFinal: resolvida,
        dominioOriginal,
        dominioFinal: dominioRadar(resolvida),
        marketplaceDetectado: marketplaceFinal || marketplacePromozoneSugerido || "",
        resolveu: false,
        motivo: motivoLogFalha
      });

      return {
        ok: false,
        motivo: motivoFalha,
        motivoTecnico: motivoFalha,
        ...camposCanonicosRedirect,
        urlCapturada: capturada,
        urlResolvida: resolvida,
        linkOriginalRadar: capturada,
        linkResolvido: resolvida,
        marketplaceReal: marketplaceFinal || marketplacePromozoneSugerido || "",
        tipoLinkRadar: "promozone",
        statusHttp: redirect.statusHttp || "",
        erro: redirect.erro || ""
      };
    }

    const linkOriginalLimpo = limparUrlProdutoRadar(resolvida, marketplaceFinal) || resolvida;
    logProdutoCanonicoRadar({
      ...camposCanonicosRedirect,
      urlOriginal: capturada,
      urlFinal: resolvida
    });
    console.log("[RADAR-REDIRECT-RESOLVIDO]", JSON.stringify({
      linkOriginal: capturada,
      linkResolvido: linkOriginalLimpo,
      marketplaceDetectado: marketplaceFinal,
      status: "resolvido"
    }));
    logPromozoneRadar({
      urlOriginal: capturada,
      urlResolvida: resolvida,
      marketplaceDetectado: marketplaceFinal,
      redirectOk: true
    });
    logRedirectRadar({
      urlOriginal: capturada,
      urlFinal: resolvida,
      dominioOriginal,
      dominioFinal: dominioRadar(resolvida),
      marketplaceDetectado: marketplaceFinal,
      resolveu: true,
      motivo: "promozone_resolvido_marketplace"
    });

    return {
      ok: true,
      ...camposCanonicosRedirect,
      urlCapturada: capturada,
      urlResolvida: resolvida,
      linkOriginalRadar: capturada,
      linkResolvido: linkOriginalLimpo,
      marketplaceReal: marketplaceFinal,
      linkOriginalLimpo,
      tipoLinkRadar: "promozone",
      statusHttp: redirect.statusHttp || ""
    };
  }

  if (linkMeliLaRadar(capturada)) {
    try {
      const resposta = await axios.get(capturada, {
        maxRedirects: 5,
        timeout: 4500,
        validateStatus: () => true,
        responseType: "stream",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
        }
      });

      if (resposta.data?.destroy) resposta.data.destroy();

      const resolvida =
        resposta?.request?.res?.responseUrl ||
        resposta?.request?._redirectable?._currentUrl ||
        "";
      const dominioFinal = dominioRadar(resolvida);

      const marketplaceFinalMeli = dominioMarketplaceConhecidoRadar(resolvida);
      if (marketplaceFinalMeli !== "mercadolivre") {
        logRedirectRadar({
          urlOriginal: capturada,
          urlFinal: resolvida || capturada,
          dominioOriginal,
          dominioFinal,
          marketplaceDetectado: marketplaceFinalMeli || "",
          resolveu: false,
          motivo: "meli_la_redirect_nao_resolvido"
        });

        return {
          ok: false,
          motivo: "meli_la_redirect_nao_resolvido",
          motivoTecnico: "meli_la_redirect_nao_resolvido",
          urlCapturada: capturada,
          urlResolvida: resolvida || "",
          linkOriginalRadar: capturada,
          linkResolvido: resolvida || "",
          marketplaceReal: "mercadolivre",
          tipoLinkRadar: "shortlink_meli",
          statusHttp: resposta.status || ""
        };
      }

      const urlSocialMeli = isUrlIntermediariaMercadoLivreRadar(resolvida) && /mercadolivre\.com\.br\/social\//i.test(resolvida);
      let tipoLinkRadarMeli = urlMercadoLivreProdutoRadar(resolvida) ? "shortlink_meli" : "shortlink_meli_social";
      let linkOriginalLimpo = limparUrlProdutoRadar(resolvida, "mercadolivre") || resolvida;
      let metodoSocialMeli = "";
      let motivoSocialMeli = "";

      if (tipoLinkRadarMeli === "shortlink_meli_social") {
        const produtoParametro =
          extrairProdutoDeParametrosIntermediarioRadar(resolvida, "mercadolivre") ||
          extrairProdutoDeParametrosIntermediarioRadar(capturada, "mercadolivre");

        if (produtoParametro) {
          linkOriginalLimpo = produtoParametro.url || produtoParametro;
          tipoLinkRadarMeli = "shortlink_meli";
          metodoSocialMeli = "parametro";
          motivoSocialMeli = "produto_extraido_parametro";
        } else if (isUrlIntermediariaMercadoLivreRadar(resolvida)) {
          try {
            const paginaIntermediaria = await baixarHtmlRadar(resolvida);
            const produtoHtml = extrairProdutoMarketplaceDeHtmlRadar(
              paginaIntermediaria.html || "",
              "mercadolivre",
              paginaIntermediaria.urlFinal || resolvida
            );
            const produtoResolvido = produtoHtml || await extrairProdutoMercadoLivreIntermediarioRadar(resolvida);
            if (produtoResolvido) {
              linkOriginalLimpo = produtoResolvido;
              tipoLinkRadarMeli = "shortlink_meli";
              metodoSocialMeli = produtoHtml ? "html" : "fallback_intermediario";
              motivoSocialMeli = "produto_extraido_html_social";
            } else {
              motivoSocialMeli = paginaIntermediaria.ok === false
                ? (paginaIntermediaria.erro || `http_${paginaIntermediaria.status || "sem_status"}`)
                : "produto_nao_encontrado_html_social";
            }
          } catch (e) {
            motivoSocialMeli = e.message || "erro_baixar_html_social";
            logDebug("[RADAR-LINK] meli.la intermediario mantido para importador", {
              capturada,
              resolvida,
              erro: e.message
            });
          }
        }
      }

      if (urlSocialMeli) {
        logRadarMlSocialResolvido({
          clienteId: "admin",
          urlSocial: resolvida,
          encontrouProduto: tipoLinkRadarMeli !== "shortlink_meli_social",
          linkProduto: tipoLinkRadarMeli !== "shortlink_meli_social" ? linkOriginalLimpo : "",
          metodo: metodoSocialMeli || "html",
          motivo: motivoSocialMeli || (tipoLinkRadarMeli === "shortlink_meli_social" ? "produto_nao_encontrado_html_social" : "produto_extraido")
        });
      }

      if (urlSocialMeli && tipoLinkRadarMeli === "shortlink_meli_social") {
        logRedirectRadar({
          urlOriginal: capturada,
          urlFinal: resolvida,
          dominioOriginal,
          dominioFinal,
          marketplaceDetectado: "mercadolivre",
          resolveu: false,
          motivo: "radar_ml_social_sem_produto"
        });

        return {
          ok: false,
          motivo: "radar_ml_social_sem_produto",
          motivoTecnico: "radar_ml_social_sem_produto",
          urlCapturada: capturada,
          urlResolvida: resolvida || "",
          linkOriginalRadar: capturada,
          linkResolvido: resolvida || "",
          marketplaceReal: "mercadolivre",
          tipoLinkRadar: "shortlink_meli_social",
          statusHttp: resposta.status || ""
        };
      }

      if (tipoLinkRadarMeli === "shortlink_meli_social") {
        linkOriginalLimpo = resolvida;
      }

      logRedirectRadar({
        urlOriginal: capturada,
        urlFinal: resolvida,
        dominioOriginal,
        dominioFinal,
        marketplaceDetectado: "mercadolivre",
        resolveu: true,
        motivo: "meli_la_resolvido_marketplace"
      });

      return {
        ok: true,
        urlCapturada: capturada,
        urlResolvida: resolvida,
        linkOriginalRadar: capturada,
        linkResolvido: linkOriginalLimpo,
        marketplaceReal: "mercadolivre",
        linkOriginalLimpo,
        tipoLinkRadar: tipoLinkRadarMeli,
        statusHttp: resposta.status || ""
      };
    } catch (e) {
      logRedirectRadar({
        urlOriginal: capturada,
        urlFinal: "",
        dominioOriginal,
        dominioFinal: "",
        marketplaceDetectado: "mercadolivre",
        resolveu: false,
        motivo: "meli_la_redirect_nao_resolvido"
      });

      return {
        ok: false,
        motivo: "meli_la_redirect_nao_resolvido",
        motivoTecnico: "meli_la_redirect_nao_resolvido",
        urlCapturada: capturada,
        linkOriginalRadar: capturada,
        linkResolvido: "",
        marketplaceReal: "mercadolivre",
        tipoLinkRadar: "shortlink_meli",
        erro: e.message
      };
    }
  }

  if (marketplaceDireto) {
    const linkOriginalLimpo = limparUrlProdutoRadar(capturada, marketplaceDireto) || capturada;
    const camposCanonicosDireto = camposIdentidadeCanonicaOferta({
      marketplace: marketplaceDireto,
      urlOriginal: capturada,
      urlFinal: capturada
    });
    logProdutoCanonicoRadar({
      ...camposCanonicosDireto,
      urlOriginal: capturada,
      urlFinal: capturada
    });

    logRedirectRadar({
      urlOriginal: capturada,
      urlFinal: capturada,
      dominioOriginal,
      dominioFinal: dominioOriginal,
      marketplaceDetectado: marketplaceDireto,
      resolveu: true,
      motivo: "link_direto_marketplace"
    });

    return {
      ok: true,
      ...camposCanonicosDireto,
      urlCapturada: capturada,
      urlResolvida: capturada,
      linkOriginalRadar: capturada,
      linkResolvido: linkOriginalLimpo,
      marketplaceReal: marketplaceDireto,
      linkOriginalLimpo,
      tipoLinkRadar: "produto"
    };
  }

  try {
    const resposta = await axios.get(capturada, {
      maxRedirects: 5,
      timeout: 4500,
      validateStatus: () => true,
      responseType: "stream",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
      }
    });

    if (resposta.data?.destroy) resposta.data.destroy();

    const resolvida =
      resposta?.request?.res?.responseUrl ||
      resposta?.request?._redirectable?._currentUrl ||
      capturada;
    const dominioFinal = dominioRadar(resolvida);
    const marketplaceFinal = dominioMarketplaceConhecidoRadar(resolvida);

    if (!marketplaceFinal) {
      const motivo = resolvida && resolvida !== capturada
        ? "redirect_final_nao_marketplace"
        : "redirect_nao_resolvido";

      logRedirectRadar({
        urlOriginal: capturada,
        urlFinal: resolvida || "",
        dominioOriginal,
        dominioFinal,
        marketplaceDetectado: "",
        resolveu: false,
        motivo
      });

      return {
        ok: false,
        motivo,
        motivoTecnico: motivo,
        ...camposCanonicosCapturada,
        urlCapturada: capturada,
        urlResolvida: resolvida || "",
        linkOriginalRadar: capturada,
        linkResolvido: resolvida || "",
        marketplaceReal: "",
        tipoLinkRadar: "intermediario",
        statusHttp: resposta.status || ""
      };
    }

    const linkOriginalLimpo = limparUrlProdutoRadar(resolvida, marketplaceFinal) || resolvida;
    const camposCanonicosIntermediario = camposIdentidadeCanonicaOferta({
      marketplace: marketplaceFinal,
      urlOriginal: capturada,
      urlFinal: resolvida
    });
    logProdutoCanonicoRadar({
      ...camposCanonicosIntermediario,
      urlOriginal: capturada,
      urlFinal: resolvida
    });

    logRedirectRadar({
      urlOriginal: capturada,
      urlFinal: resolvida,
      dominioOriginal,
      dominioFinal,
      marketplaceDetectado: marketplaceFinal,
      resolveu: true,
      motivo: "redirect_resolvido_marketplace"
    });

    return {
      ok: true,
      ...camposCanonicosIntermediario,
      urlCapturada: capturada,
      urlResolvida: resolvida,
      linkOriginalRadar: capturada,
      linkResolvido: linkOriginalLimpo,
      marketplaceReal: marketplaceFinal,
      linkOriginalLimpo,
      tipoLinkRadar: "intermediario",
      statusHttp: resposta.status || ""
    };
  } catch (e) {
    logRedirectRadar({
      urlOriginal: capturada,
      urlFinal: "",
      dominioOriginal,
      dominioFinal: "",
      marketplaceDetectado: "",
      resolveu: false,
      motivo: e.message || "redirect_bloqueado"
    });

    logDebug("[RADAR-LINK] resolver erro", {
      capturada,
      erro: e.message
    });

    return {
      ok: false,
      motivo: "redirect_bloqueado",
      motivoTecnico: "redirect_bloqueado",
      ...camposCanonicosCapturada,
      urlCapturada: capturada,
      linkOriginalRadar: capturada,
      linkResolvido: "",
      erro: e.message
    };
  }
}

function motivoKabumIncompletoControlado(motivo = "") {
  return [
    "kabum_titulo_generico",
    "kabum_produto_nao_comprovado",
    "kabum_html_intermediario"
  ].includes(String(motivo || "").trim());
}

function logKabumRadarDescartadaIncompleta(motivo = "", erro = {}, resolucao = {}) {
  const diagnostico = erro?.kabumDiagnostico || {};
  const link = resolucao.linkOriginalLimpo || resolucao.urlResolvida || resolucao.urlCapturada || "";
  const host = diagnostico.host || (() => {
    try {
      return new URL(String(link || "")).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();

  console.log("[RADAR-KABUM-DESCARTADA-INCOMPLETA]", {
    motivo,
    host,
    temProdutoId: diagnostico.temProdutoId === true,
    temImagem: diagnostico.temImagem === true,
    tituloNormalizado: String(diagnostico.tituloNormalizado || "").slice(0, 120)
  });
}

async function importarOfertaRadarPorLink(url = "", contexto = {}) {
  const adminMasterId = obterClienteIdAdminMaster();
  const resolucao = await resolverLinkOriginalRadar(url);

  if (!resolucao.ok) {
    return {
      ok: false,
      motivo: resolucao.motivo || "link_original_nao_resolvido",
      resolucao
    };
  }

  const marketplaceDetectado = resolucao.marketplaceReal;
  const linkOriginalLimpo = resolucao.linkOriginalLimpo;

  try {
    if (marketplaceDetectado === "kabum") {
      try {
        const produtoKabum = await importarProdutoKabumViaAwin(linkOriginalLimpo, adminMasterId, {
          gerarDeepLinkAwin: async () => linkOriginalLimpo
        });

        const motivoIncompletaKabum = motivoImportacaoRadarIncompleta(produtoKabum || {}, "kabum");
        if (motivoIncompletaKabum) {
          return {
            ok: false,
            motivo: motivoIncompletaKabum,
            motivoTecnico: motivoIncompletaKabum,
            resolucao
          };
        }
        const produtoEnriquecido = await enriquecerBeneficioRadarOferta({
          ...produtoKabum,
          marketplace: produtoKabum.marketplace || "kabum",
          linkOriginal: linkOriginalLimpo
        }, {
          origem: "radar",
          marketplace: "kabum",
          linkOriginal: linkOriginalLimpo
        });
        const beneficioRadar = normalizarBeneficiosRadarOferta(produtoEnriquecido);

        return {
          ok: true,
          resolucao,
          oferta: {
            ...produtoEnriquecido,
            ...beneficioRadar,
            marketplace: produtoEnriquecido.marketplace || "kabum",
            linkOriginal: linkOriginalLimpo,
            linkCapturado: resolucao.urlCapturada,
            linkOriginalRadar: resolucao.linkOriginalRadar || resolucao.urlCapturada,
            linkResolvido: resolucao.linkResolvido || resolucao.linkOriginalLimpo || resolucao.urlResolvida,
            linkResolvidoRadar: resolucao.urlResolvida,
            origem: "radar",
            radar: true,
            status: "rascunho"
          }
        };
      } catch (e) {
        const motivoKabumControlado = e.motivo || e.codigo || e.message || "";
        if (motivoKabumIncompletoControlado(motivoKabumControlado)) {
          logKabumRadarDescartadaIncompleta(motivoKabumControlado, e, resolucao);
          return {
            ok: false,
            motivo: motivoKabumControlado,
            motivoTecnico: motivoKabumControlado,
            resolucao,
            detalhes: e.kabumDiagnostico || {}
          };
        }

        if (!erroKabumHtml403(e)) {
          throw e;
        }

        const fallbackKabum = montarOfertaKabumRadarFallback403(linkOriginalLimpo, contexto);
        if (!fallbackKabum.ok) {
          return {
            ok: false,
            motivo: fallbackKabum.motivo,
            motivoTecnico: fallbackKabum.motivoTecnico,
            resolucao,
            detalhes: fallbackKabum.detalhes || {}
          };
        }

        const produtoEnriquecido = await enriquecerBeneficioRadarOferta({
          ...fallbackKabum.oferta,
          linkOriginal: linkOriginalLimpo
        }, {
          origem: "radar",
          marketplace: "kabum",
          linkOriginal: linkOriginalLimpo
        });
        const beneficioRadar = normalizarBeneficiosRadarOferta(produtoEnriquecido);

        logOptimus("RADAR", "Fallback KaBuM/AWIN por HTTP 403", {
          linkOriginal: linkOriginalLimpo,
          titulo: produtoEnriquecido.titulo || "",
          preco: produtoEnriquecido.precoAtual || produtoEnriquecido.preco || ""
        });

        return {
          ok: true,
          resolucao: {
            ...resolucao,
            statusHttp: 403,
            erroTecnico: "KaBuM bloqueou scraping HTTP 403"
          },
          oferta: {
            ...produtoEnriquecido,
            ...beneficioRadar,
            marketplace: "kabum",
            marketplaceOriginalRadar: "kabum",
            linkOriginal: linkOriginalLimpo,
            linkCapturado: resolucao.urlCapturada,
            linkOriginalRadar: resolucao.linkOriginalRadar || resolucao.urlCapturada,
            linkResolvido: resolucao.linkResolvido || resolucao.linkOriginalLimpo || resolucao.urlResolvida,
            linkResolvidoRadar: resolucao.urlResolvida,
            origem: "radar",
            radar: true,
            status: "rascunho",
            fallbackKabumRadar403: true,
            motivoFallback: "kabum_http_403_awin_radar"
          }
        };
      }
    }

    const textoRadarImportadorMl = String(contexto.textoOriginal || contexto.texto || contexto.mensagemOriginalRadar || "");

    if (marketplaceDetectado === "mercadolivre") {
      console.log("[RADAR-ML-CONTEXTO-IMPORTADOR]", {
        temTextoRadar: Boolean(textoRadarImportadorMl.trim()),
        tamanhoTextoRadar: textoRadarImportadorMl.length,
        link: linkOriginalLimpo,
        marketplace: marketplaceDetectado
      });
    }

    const resultado = await importarProdutoManual({
      clienteId: adminMasterId,
      headers: {},
      body: {
        url: linkOriginalLimpo,
        marketplace: marketplaceDetectado
      }
    }, {
      getClienteId,
      integracoesPorCliente,
      getIntegracaoCliente,
      importarAmazon,
      importarAliExpress,
      importarMagalu,
      importarMercadoLivre: (url, clienteIdAlvo, depsMl = {}) => importarMercadoLivre(url, clienteIdAlvo, {
        ...depsMl,
        contextoRadar: {
          ...(depsMl.contextoRadar || {}),
          textoOriginal: textoRadarImportadorMl,
          mensagemOriginalRadar: textoRadarImportadorMl
        },
        textoOriginal: textoRadarImportadorMl,
        mensagemOriginalRadar: textoRadarImportadorMl
      }),
      importarShopee,
      gerarLinkAfiliadoMercadoLivre,
        resolverLinkOriginalRadar
      });

    if (resultado.status >= 400 || resultado.body?.ok === false) {
      const motivoFalhaImportador = resultado.body?.erro || "importacao_falhou";

      if (marketplaceDetectado === "mercadolivre" && resolucao.tipoLinkRadar === "shortlink_meli_social") {
        const fallbackMl = montarOfertaMercadoLivreRadarFallbackTexto(linkOriginalLimpo, {
          ...contexto,
          linkOriginalRadar: resolucao.linkOriginalRadar || resolucao.urlCapturada,
          linkResolvido: resolucao.linkResolvido || resolucao.linkOriginalLimpo || resolucao.urlResolvida
        });

        if (fallbackMl.ok) {
          const produtoEnriquecido = await enriquecerBeneficioRadarOferta({
            ...fallbackMl.oferta,
            marketplace: "mercadolivre",
            linkOriginal: linkOriginalLimpo
          }, {
            origem: "radar",
            marketplace: "mercadolivre",
            linkOriginal: linkOriginalLimpo
          });
          const beneficioRadar = normalizarBeneficiosRadarOferta(produtoEnriquecido);

          return {
            ok: true,
            resolucao: {
              ...resolucao,
              erroTecnico: motivoFalhaImportador
            },
            oferta: {
              ...produtoEnriquecido,
              ...beneficioRadar,
              marketplace: "mercadolivre",
              linkOriginal: linkOriginalLimpo,
              linkCapturado: resolucao.urlCapturada,
              linkOriginalRadar: resolucao.linkOriginalRadar || resolucao.urlCapturada,
              linkResolvido: resolucao.linkResolvido || resolucao.linkOriginalLimpo || resolucao.urlResolvida,
              linkResolvidoRadar: resolucao.urlResolvida,
              origem: "radar",
              radar: true,
              status: "rascunho",
              tipoLinkRadar: resolucao.tipoLinkRadar || "shortlink_meli_social",
              fallbackMercadoLivreRadarTexto: true,
              motivoFallback: "meli_social_importador_falhou_texto_radar"
            }
          };
        }
      }

      return {
        ok: false,
        motivo: motivoFalhaImportador,
        motivoTecnico: motivoFalhaImportador,
        resolucao
      };
    }

    let produtoImportadoRadar = resultado.body || {};

    if (marketplaceDetectado === "mercadolivre") {
      produtoImportadoRadar = aplicarTituloFallbackTextoRadarMl(produtoImportadoRadar, {
        textoOriginal: contexto.textoOriginal || contexto.texto || "",
        linkOriginal: linkOriginalLimpo
      });
    }

    let motivoIncompleta = motivoImportacaoRadarIncompleta(produtoImportadoRadar, marketplaceDetectado);

    if (marketplaceDetectado === "mercadolivre" && motivoIncompleta === "importacao_sem_preco") {
      produtoImportadoRadar = aplicarPrecoFallbackTextoRadarMl(produtoImportadoRadar, {
        textoOriginal: contexto.textoOriginal || contexto.texto || "",
        linkOriginal: linkOriginalLimpo
      });
      motivoIncompleta = motivoImportacaoRadarIncompleta(produtoImportadoRadar, marketplaceDetectado);
    }

    if (motivoIncompleta) {
      if (marketplaceDetectado === "mercadolivre" && resolucao.tipoLinkRadar === "shortlink_meli_social") {
        const fallbackMl = montarOfertaMercadoLivreRadarFallbackTexto(linkOriginalLimpo, {
          ...contexto,
          linkOriginalRadar: resolucao.linkOriginalRadar || resolucao.urlCapturada,
          linkResolvido: resolucao.linkResolvido || resolucao.linkOriginalLimpo || resolucao.urlResolvida
        });

        if (fallbackMl.ok) {
          const produtoEnriquecido = await enriquecerBeneficioRadarOferta({
            ...produtoImportadoRadar,
            ...fallbackMl.oferta,
            marketplace: "mercadolivre",
            linkOriginal: linkOriginalLimpo
          }, {
            origem: "radar",
            marketplace: "mercadolivre",
            linkOriginal: linkOriginalLimpo
          });
          const beneficioRadar = normalizarBeneficiosRadarOferta(produtoEnriquecido);

          return {
            ok: true,
            resolucao: {
              ...resolucao,
              erroTecnico: motivoIncompleta
            },
            oferta: {
              ...produtoEnriquecido,
              ...beneficioRadar,
              marketplace: "mercadolivre",
              linkOriginal: linkOriginalLimpo,
              linkCapturado: resolucao.urlCapturada,
              linkOriginalRadar: resolucao.linkOriginalRadar || resolucao.urlCapturada,
              linkResolvido: resolucao.linkResolvido || resolucao.linkOriginalLimpo || resolucao.urlResolvida,
              linkResolvidoRadar: resolucao.urlResolvida,
              origem: "radar",
              radar: true,
              status: "rascunho",
              tipoLinkRadar: resolucao.tipoLinkRadar || "shortlink_meli_social",
              fallbackMercadoLivreRadarTexto: true,
              motivoFallback: "meli_social_importador_incompleto_texto_radar"
            }
          };
        }
      }

      return {
        ok: false,
        motivo: motivoIncompleta,
        motivoTecnico: motivoIncompleta,
        resolucao
      };
    }
    const produtoEnriquecido = await enriquecerBeneficioRadarOferta({
      ...produtoImportadoRadar,
      marketplace: produtoImportadoRadar?.marketplace || marketplaceDetectado,
      linkOriginal: linkOriginalLimpo
    }, {
      origem: "radar",
      marketplace: marketplaceDetectado,
      linkOriginal: linkOriginalLimpo
    });
    const beneficioRadar = normalizarBeneficiosRadarOferta(produtoEnriquecido);

    return {
      ok: true,
      resolucao,
      oferta: {
        ...produtoEnriquecido,
        ...beneficioRadar,
        marketplace: produtoEnriquecido.marketplace || marketplaceDetectado,
        linkOriginal: linkOriginalLimpo,
        linkCapturado: resolucao.urlCapturada,
        linkOriginalRadar: resolucao.linkOriginalRadar || resolucao.urlCapturada,
            linkResolvido: resolucao.linkResolvido || resolucao.linkOriginalLimpo || resolucao.urlResolvida,
            linkResolvidoRadar: resolucao.urlResolvida,
        origem: "radar",
        radar: true,
        status: "rascunho",
        tipoLinkRadar: resolucao.tipoLinkRadar || "produto"
      }
    };
  } catch (e) {
    return {
      ok: false,
      motivo: e.message || "erro_importacao_radar",
      motivoTecnico: e.message || "erro_importacao_radar",
      erro: e.message || "",
      resolucao,
      contexto
    };
  }
}

async function adicionarRadarCapturadoNaFilaClientes(ofertaBase = {}, opcoes = {}) {
  const resultados = [];
  const radarConfigFontes = opcoes.radarConfigFontes || carregarRadarConfigAdminMaster();
  const clientesAtivos = listarClientesElegiveisRadar();

  logOptimus("RADAR", "Clientes elegiveis encontrados", { total: clientesAtivos.length });

  for (const usuario of clientesAtivos) {
    const clienteId = usuario.id;

    logOptimus("RADAR", "Cliente analisado", { clienteId });

    const resultado = await adicionarRadarNaFilaCliente(ofertaBase, clienteId, {
      radarConfigFontes
    });

    if (!resultado.ok || !resultado.adicionada) {
      logRadarRejeitado(resultado.motivo || "nao_adicionada", {
        clienteId
      });
    } else {
      logOptimus("SUCESSO", "Radar adicionou na fila", { clienteId });
    }

    logRadarPipelineDebug({
      clienteId,
      grupoNome: ofertaBase.origemGrupoNome || ofertaBase.grupoNome || "",
      linkOriginal: ofertaBase.linkOriginalRadar || ofertaBase.linkCapturado || ofertaBase.linkOriginal || "",
      linkResolvido: ofertaBase.linkResolvido || ofertaBase.linkResolvidoRadar || ofertaBase.urlResolvida || "",
      marketplace: ofertaBase.marketplace || ofertaBase.marketplaceDetectado || "",
      cupom: ofertaBase.cupom || "",
      precoTexto: ofertaBase.precoAtual || ofertaBase.preco || "",
      tituloTexto: ofertaBase.titulo || ofertaBase.nome || "",
      importadorChamado: true,
      linkAfiliadoOk: Boolean(resultado.oferta?.linkAfiliado || resultado.linkAfiliado),
      adicionouFila: Boolean(resultado.adicionada),
      motivoRecusa: resultado.adicionada ? "" : (resultado.motivo || "nao_adicionada")
    });

    resultados.push({
      clienteId,
      ok: !!resultado.ok,
      motivo: resultado.motivo || "",
      adicionada: !!resultado.adicionada,
      idOfertaFila: resultado.oferta?.id || "",
      linkAfiliado: resultado.oferta?.linkAfiliado || resultado.oferta?.linkFinal || resultado.oferta?.link || "",
      statusRadar: resultado.oferta?.statusRadar || "",
      statusFila: resultado.oferta?.status || "",
      retida: !!resultado.retida
    });
  }

  return resultados;
}

function classificarMotivoResumoRadar(motivo = "") {
  const texto = normalizarTexto(motivo);

  if (!texto) return "outros";
  if (texto.includes("semdestinocompativel") || texto.includes("semdestino") || texto.includes("destinocompativel")) return "categoria";
  if (texto.includes("memoria") || texto.includes("repetida_na_memoria")) return "memoria";
  if (texto.includes("duplicada") || texto.includes("repetida")) return "repetida";
  if (texto.includes("limiteradar") || texto.includes("filacheia") || texto.includes("pendentetotal") || texto.includes("limite_radar") || texto.includes("fila_cheia") || texto.includes("pendente_total")) return "fila";
  if (texto.includes("categoria") || texto.includes("destino_compativel") || texto.includes("sem_destino")) return "categoria";
  if (texto.includes("link_original") || texto.includes("intermediario") || texto.includes("marketplace_nao_identificado")) return "link";
  if (texto.includes("importacao")) return "importacao";

  return "outros";
}

function resumirResultadosRadarMensagem(resultados = []) {
  const resumo = {
    encontradas: 0,
    rejeitadasMemoria: 0,
    rejeitadasRepetida: 0,
    rejeitadasCategoria: 0,
    retidasDestino: 0,
    rejeitadasFila: 0,
    rejeitadasImportacao: 0,
    rejeitadasLink: 0,
    rejeitadasOutros: 0,
    adicionadas: 0
  };

  for (const item of Array.isArray(resultados) ? resultados : []) {
    if (item?.ok) resumo.encontradas += 1;
    const clientes = Array.isArray(item?.clientes) ? item.clientes : [];

    if (clientes.length) {
      for (const cliente of clientes) {
        if (cliente?.adicionada) {
          resumo.adicionadas += 1;
          continue;
        }

        const motivoCliente = cliente?.motivo || "";
        const statusCliente = normalizarTexto(cliente?.statusRadar || cliente?.statusFila || "");
        if (cliente?.retida || statusCliente === "retida") {
          resumo.retidasDestino += 1;
          continue;
        }

        const bucket = classificarMotivoResumoRadar(motivoCliente);
        if (bucket === "memoria") resumo.rejeitadasMemoria += 1;
        else if (bucket === "repetida") resumo.rejeitadasRepetida += 1;
        else if (bucket === "categoria") resumo.rejeitadasCategoria += 1;
        else if (bucket === "fila") resumo.rejeitadasFila += 1;
        else if (bucket === "importacao") resumo.rejeitadasImportacao += 1;
        else if (bucket === "link") resumo.rejeitadasLink += 1;
        else resumo.rejeitadasOutros += 1;
      }
      continue;
    }

    if (!item?.ok) {
      const bucket = classificarMotivoResumoRadar(item?.motivo || "");
      if (bucket === "memoria") resumo.rejeitadasMemoria += 1;
      else if (bucket === "repetida") resumo.rejeitadasRepetida += 1;
      else if (bucket === "categoria") resumo.rejeitadasCategoria += 1;
      else if (bucket === "fila") resumo.rejeitadasFila += 1;
      else if (bucket === "importacao") resumo.rejeitadasImportacao += 1;
      else if (bucket === "link") resumo.rejeitadasLink += 1;
      else resumo.rejeitadasOutros += 1;
    }
  }

  return resumo;
}

const RADAR_MARKETPLACE_JANELA_PADRAO_MIN = 120;
const radarMarketplaceEventos = [];

function normalizarMarketplaceResumoRadar(marketplace = "") {
  const mp = normalizarTexto(marketplace || "");
  if (mp === "ml" || mp === "mercadolivre" || mp === "mercadolivrebr" || mp === "mercadolivrecombr") return "mercadolivre";
  if (mp === "meli" || mp === "melila") return "mercadolivre";
  return mp || "desconhecido";
}

function marketplaceResumoRadarDoLink(link = "") {
  const direto = detectarMarketplaceRadarLink(link);
  if (direto) return normalizarMarketplaceResumoRadar(direto);
  if (/meli\.la/i.test(String(link || ""))) return "mercadolivre";
  if (/mercadolivre\.com\.br/i.test(String(link || ""))) return "mercadolivre";
  return "desconhecido";
}

function classificarMotivoResumoMarketplaceRadar(motivo = "") {
  const texto = normalizarTexto(motivo || "");
  if (!texto) return "outros";
  if (/duplicad|repetid|jaexiste|existe/.test(texto)) return "duplicidade";
  if (/memoria/.test(texto)) return "memoria";
  if (/categoria/.test(texto)) return "categoria";
  if (/destino/.test(texto)) return "destino";
  if (/integracao|credencial|cookie|semcredencial/.test(texto)) return "integracao";
  if (/sempreco|precoausente|importacaosempreco/.test(texto)) return "importacao_sem_preco";
  if (/afiliado|deeplink|linkcliente|linkigualoriginal|semlinkafiliado/.test(texto)) return "erro_de_afiliado";
  if (/importacao|importador/.test(texto)) return "importacao";
  return "outros";
}

function registrarRadarMarketplaceEvento(evento = {}) {
  const agora = Date.now();
  const item = {
    em: agora,
    marketplace: normalizarMarketplaceResumoRadar(evento.marketplace || ""),
    capturado: evento.capturado === true,
    redirectOk: evento.redirectOk === true,
    importadorChamado: evento.importadorChamado === true,
    importado: evento.importado === true,
    aprovado: evento.aprovado === true,
    adicionadoFila: evento.adicionadoFila === true,
    motivo: evento.motivo || ""
  };

  radarMarketplaceEventos.push(item);

  const limite = agora - RADAR_MARKETPLACE_JANELA_PADRAO_MIN * 60 * 1000;
  while (radarMarketplaceEventos.length && radarMarketplaceEventos[0].em < limite) {
    radarMarketplaceEventos.shift();
  }

  return item;
}

function logarResumoRadarMarketplace(marketplaces = [], janelaMinutos = RADAR_MARKETPLACE_JANELA_PADRAO_MIN) {
  const agora = Date.now();
  const limite = agora - Math.max(1, Number(janelaMinutos) || RADAR_MARKETPLACE_JANELA_PADRAO_MIN) * 60 * 1000;
  const lista = [...new Set(marketplaces.map(normalizarMarketplaceResumoRadar).filter(Boolean))];

  for (const marketplace of lista) {
    const eventos = radarMarketplaceEventos.filter(evento =>
      evento.em >= limite &&
      evento.marketplace === marketplace
    );
    const recusasPorMotivo = {};

    for (const evento of eventos) {
      if (evento.adicionadoFila) continue;
      const motivo = classificarMotivoResumoMarketplaceRadar(evento.motivo || "");
      recusasPorMotivo[motivo] = (recusasPorMotivo[motivo] || 0) + 1;
    }

    console.log("[RADAR-MARKETPLACE-RESUMO]", {
      janelaMinutos,
      marketplace,
      capturados: eventos.filter(evento => evento.capturado).length,
      redirectOk: eventos.filter(evento => evento.redirectOk).length,
      importadorChamado: eventos.filter(evento => evento.importadorChamado).length,
      importados: eventos.filter(evento => evento.importado).length,
      aprovados: eventos.filter(evento => evento.aprovado).length,
      adicionadosFila: eventos.filter(evento => evento.adicionadoFila).length,
      recusasPorMotivo
    });
  }
}

function detectarMarketplaceEngineRadar(dados = {}) {
  const candidatos = [
    dados.marketplace,
    dados.marketplaceDetectado,
    dados.marketplace_detectado,
    ...(Array.isArray(dados.linksExtraidos) ? dados.linksExtraidos : []),
    ...(Array.isArray(dados.links_extraidos) ? dados.links_extraidos : []),
    dados.textoOriginal,
    dados.texto
  ];

  for (const candidato of candidatos) {
    const texto = String(candidato || "").toLowerCase();
    if (!texto) continue;
    if (texto.includes("mercadolivre.com") || texto.includes("meli.la")) return "mercadolivre";
    if (texto.includes("shopee.")) return "shopee";
    if (texto.includes("amazon.") || texto.includes("amzn.to")) return "amazon";
    if (texto.includes("aliexpress.")) return "aliexpress";
    if (texto.includes("kabum.com.br")) return "awin";
    if (texto.includes("awin1.com") || texto.includes("awin.com")) return "awin";
    if (texto.includes("magazineluiza.com") || texto.includes("magalu.")) return "magalu";
  }

  return "";
}

function normalizarDestinoEngineRadar(valor = "") {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function destinoAtivoCompativelEngineRadar(clienteId = "", marketplace = "") {
  const destinos = destinosClienteNormalizados(clienteId);
  const marketplaceOferta = normalizarDestinoEngineRadar(marketplace);

  return destinos.some(destino => {
    if (destino?.ativo !== true) return false;

    const marketplacesDestino = (destino.marketplaces || [])
      .map(normalizarDestinoEngineRadar)
      .filter(Boolean);

    return !marketplacesDestino.length ||
      marketplacesDestino.includes("geral") ||
      marketplacesDestino.includes("todos") ||
      marketplacesDestino.includes("todas") ||
      marketplacesDestino.includes(marketplaceOferta);
  });
}

function adminOperacionalEngineRadar(usuario = {}) {
  const configAdmin = configsPorCliente?.admin || {};
  return Boolean(
    usuario?.engineOperacional === true ||
    usuario?.operacional === true ||
    usuario?.recebeEngine === true ||
    configAdmin?.engineOperacional === true ||
    configAdmin?.operacional === true ||
    configAdmin?.recebeEngine === true
  );
}

function listarClientesEngineRadar(dados = {}) {
  const marketplace = detectarMarketplaceEngineRadar(dados);
  const clientesIncluidos = [];
  const clientesIgnorados = [];
  const motivosIgnorados = {};

  function ignorar(clienteId, motivo) {
    clientesIgnorados.push({ clienteId, motivo });
    motivosIgnorados[motivo] = (motivosIgnorados[motivo] || 0) + 1;
  }

  try {
    const listaUsuarios = Array.isArray(usuarios) ? usuarios : [];

    for (const usuario of listaUsuarios) {
      const clienteId = String(usuario?.id || "").trim();
      if (!clienteId) continue;

      if (clienteId === "admin" && !adminOperacionalEngineRadar(usuario)) {
        ignorar(clienteId, "admin_sem_flag_operacional");
        continue;
      }

      if (usuario?.ativo === false) {
        ignorar(clienteId, "usuario_inativo");
        continue;
      }

      if (!marketplace) {
        ignorar(clienteId, "marketplace_nao_detectado");
        continue;
      }

      if (!usuarioPodeReceberMarketplace(usuario, marketplace)) {
        ignorar(clienteId, "plano_nao_permite_marketplace");
        continue;
      }

      const configCliente = configsPorCliente?.[clienteId] || {};
      if (configCliente.automacaoAtiva !== true) {
        ignorar(clienteId, "automacao_desligada");
        continue;
      }

      if (!clienteAceitaMarketplaceAtivo(clienteId, marketplace)) {
        ignorar(clienteId, "marketplace_desativado_no_cliente");
        continue;
      }

      const integracao = getIntegracaoCliente(clienteId, marketplace);
      if (!integracao) {
        ignorar(clienteId, "integracao_ausente");
        continue;
      }

      const cred = integracao?.credenciais || {};
      const credenciaisOk = marketplace === "mercadolivre"
        ? Boolean(cred.tag && cred.cookies)
        : usuarioTemIntegracaoMarketplace(clienteId, marketplace);

      if (!credenciaisOk) {
        ignorar(clienteId, "credenciais_incompletas");
        continue;
      }

      if (!destinoAtivoCompativelEngineRadar(clienteId, marketplace)) {
        ignorar(clienteId, "sem_destino_ativo_compativel");
        continue;
      }

      clientesIncluidos.push(clienteId);
    }

    console.log("[ENGINE-CLIENTES-ELEGIVEIS]", {
      marketplace,
      totalUsuarios: listaUsuarios.length,
      clientesIncluidos,
      clientesIgnorados,
      motivosIgnorados
    });

    return [...new Set(clientesIncluidos)];
  } catch (e) {
    console.log("[ENGINE-CLIENTES-ELEGIVEIS]", {
      marketplace,
      totalUsuarios: 0,
      clientesIncluidos: [],
      clientesIgnorados,
      motivosIgnorados: { erro: 1 },
      erro: e.message
    });
    return [];
  }
}
async function prepararLinksRedirectEngineRadar(dados = {}) {
  const linksCapturados = Array.isArray(dados.linksExtraidos) ? dados.linksExtraidos : [];
  const redirectsRadar = [];
  const identidadesCanonicas = [];
  const linksEngine = [];

  for (const link of linksCapturados) {
    if (!linkRedirectPermitidoRadar(link)) {
      const camposCanonicosLink = camposIdentidadeCanonicaOferta({ urlOriginal: link, linkOriginal: link });
      if (camposCanonicosLink.chaveCanonica) {
        identidadesCanonicas.push({
          linkOriginalCapturado: link,
          chaveCanonica: camposCanonicosLink.chaveCanonica,
          produtoIdCanonico: camposCanonicosLink.produtoIdCanonico,
          marketplaceCanonico: camposCanonicosLink.marketplaceCanonico
        });
      }
      linksEngine.push(link);
      continue;
    }

    const resolucao = await resolverLinkOriginalRadar(link);
    const linkResolvido = resolucao?.ok
      ? (resolucao.linkOriginalLimpo || resolucao.linkResolvido || resolucao.urlResolvida || "")
      : "";

    redirectsRadar.push({
      linkOriginalCapturado: link,
      linkResolvido,
      marketplaceDetectado: resolucao?.marketplaceReal || "",
      chaveCanonica: resolucao?.chaveCanonica || "",
      produtoIdCanonico: resolucao?.produtoIdCanonico || "",
      marketplaceCanonico: resolucao?.marketplaceCanonico || "",
      status: resolucao?.ok ? "resolvido" : "falhou",
      motivo: resolucao?.ok ? "" : (resolucao?.motivo || resolucao?.motivoTecnico || "redirect_falhou")
    });
    if (resolucao?.chaveCanonica) {
      identidadesCanonicas.push({
        linkOriginalCapturado: link,
        chaveCanonica: resolucao.chaveCanonica,
        produtoIdCanonico: resolucao.produtoIdCanonico || "",
        marketplaceCanonico: resolucao.marketplaceCanonico || ""
      });
    }
    linksEngine.push(linkResolvido || link);
  }

  const marketplaceDetectado = linksEngine
    .map(link => dominioMarketplaceConhecidoRadar(link))
    .find(Boolean) || dados.marketplaceDetectado || "";

  return {
    dados: {
      ...dados,
      linksExtraidos: linksEngine,
      marketplaceDetectado,
      chaveCanonica: identidadesCanonicas.length === 1 ? identidadesCanonicas[0].chaveCanonica : dados.chaveCanonica || "",
      metadata: {
        ...(dados.metadata || {}),
        linksOriginaisCapturados: linksCapturados,
        redirectsRadar,
        identidadesCanonicas
      }
    },
    redirectsRadar
  };
}

async function registrarEventoBrutoEngineRadar(dados = {}) {
  try {
    const linksDados = Array.isArray(dados.linksExtraidos) ? dados.linksExtraidos : [];
    const temRedirectConhecido = linksDados.some(linkRedirectPermitidoRadar);
    const temIdentidadeCanonica = linksDados.some(link =>
      Boolean(camposIdentidadeCanonicaOferta({ urlOriginal: link, linkOriginal: link }).chaveCanonica)
    );
    const preparacao = temRedirectConhecido || temIdentidadeCanonica
      ? await prepararLinksRedirectEngineRadar(dados)
      : { dados, redirectsRadar: [] };
    const dadosEngine = preparacao.dados;
    const resultado = await registrarEventoBruto(dadosEngine, {
      clientes: listarClientesEngineRadar(dadosEngine)
    });
    return { ...resultado, redirectsRadar: preparacao.redirectsRadar };
  } catch (e) {
    console.log("[ENGINE-EVENTO-BRUTO-ERRO]", {
      motivo: "radar_chamada_falhou",
      erro: e.message
    });
    return { ok: false, motivo: "radar_chamada_falhou", erro: e.message, redirectsRadar: [] };
  }
}

async function processarMensagemRadar({
  origemTipo,
  sessaoId,
  grupoId,
  grupoNome,
  texto,
  capturadaEm,
  raw
} = {}) {
  const tipo = normalizarTexto(origemTipo || "");
  const origemTipoFinal = tipo.includes("telegram") ? "telegram" : tipo.includes("whatsapp") ? "whatsapp" : "";
  const grupoIdTexto = textoRadarId(grupoId);
  const grupoNomeTexto = textoRadarId(grupoNome);
  const sessaoIdTexto = textoRadarId(sessaoId || (origemTipoFinal === "telegram" ? "telegram" : ""));

  if (!["whatsapp", "telegram"].includes(origemTipoFinal)) {
    logOptimus("CAPTURA", "Rejeitada", {
      motivo: "origem_tipo_invalida",
      origemTipo
    });
    logRadarRejeitado("origem_tipo_invalida", {
      origemTipo
    });
    return { ok: false, motivo: "origem_tipo_invalida" };
  }

  if (!grupoIdTexto) {
    logOptimus("CAPTURA", "Rejeitada", {
      motivo: "grupo_ou_chat_ausente",
      origemTipo: origemTipoFinal
    });
    logRadarRejeitado("grupo_ou_chat_ausente", {
      origemTipo: origemTipoFinal
    });
    return { ok: false, motivo: "grupo_ou_chat_ausente" };
  }

  const adminMasterId = obterClienteIdAdminMaster();
  const radarConfig = carregarRadarConfigAdminMaster();
  const origemBase = {
    origemTipo: origemTipoFinal,
    origemGrupoId: grupoIdTexto,
    origemGrupoNome: grupoNomeTexto,
    origemSessaoId: sessaoIdTexto,
    grupoId: grupoIdTexto,
    grupoNome: grupoNomeTexto,
    chatId: origemTipoFinal === "telegram" ? grupoIdTexto : "",
    sessaoId: sessaoIdTexto
  };
  const origemMonitorada = origemOfertaEstaMonitoradaRadar(origemBase, radarConfig);

  if (!origemMonitorada.ok) {
  logRadarBloqueadoMonitoramento({
    clienteId: adminMasterId,
    motivo: origemMonitorada.motivo,
    origemMonitorada,
    sessaoId: sessaoIdTexto,
    grupoId: grupoIdTexto,
    grupoNome: grupoNomeTexto
  });

  return { ok: false, motivo: origemMonitorada.motivo, ignorada: true };
}

  logOptimus("CAPTURA", "Mensagem recebida", {
    origemTipo: origemTipoFinal || origemTipo,
    sessaoId: sessaoIdTexto,
    grupoId: grupoIdTexto,
    grupoNome: grupoNomeTexto,
    tamanhoTexto: String(texto || "").length
  });

  logOptimus("CAPTURA", "Grupo monitorado confirmado", {
    origemTipo: origemTipoFinal,
    sessaoId: sessaoIdTexto,
    grupoId: grupoIdTexto,
    grupoNome: grupoNomeTexto
  });

const links = extrairLinksRadar(texto);
const marketplaceDetectadoLinks = links
  .map(link => detectarMarketplaceRadarLink(link))
  .find(Boolean) || "";

console.log("[RADAR-LINKS-DETECTADOS]", JSON.stringify({
  clienteId: adminMasterId,
  origem: origemTipoFinal,
  grupoNome: grupoNomeTexto,
  totalLinks: links.length,
  linksDetectados: links,
  marketplaceDetectado: marketplaceDetectadoLinks
}));

logDebug("🧪 RADAR LINKS EXTRAIDOS", {
  sessaoId: sessaoIdTexto,
  grupoId: grupoIdTexto,
  links,
  total: links.length,
  texto: String(texto || "").slice(0, 250)
});

const temRedirectConhecidoRadar = links.some(linkRedirectPermitidoRadar);
const registroEngineRadarPromise = registrarEventoBrutoEngineRadar({
  origem: "radar",
  origemTipo: origemTipoFinal,
  sessaoId: sessaoIdTexto,
  grupoId: grupoIdTexto,
  grupoNome: grupoNomeTexto,
  textoOriginal: texto,
  linksExtraidos: links,
  capturadoEm: capturadaEm || new Date()
});
const registroEngineRadar = temRedirectConhecidoRadar
  ? await registroEngineRadarPromise
  : null;

  logOptimus("RADAR", "Links detectados", {
    total: links.length,
    links,
    origemTipo: origemTipoFinal,
    grupo: grupoNomeTexto || grupoIdTexto
  });
  if (!links.length) {
    logOptimus("RADAR", "Sem links", {
      motivo: "sem_links",
      origemTipo: origemTipoFinal,
      grupo: grupoNomeTexto || grupoIdTexto
    });
    logRadarRejeitado("sem_links", {
      origemTipo: origemTipoFinal,
      grupo: grupoNomeTexto || grupoIdTexto
    });
    return { ok: false, motivo: "sem_links" };
  }

  const marketplacesLinksRadar = links
    .map(link => marketplaceResumoRadarDoLink(link))
    .filter(Boolean);
  const somenteAmazonRadar = marketplacesLinksRadar.length > 0 &&
    marketplacesLinksRadar.every(marketplace => marketplace === "amazon");

  if (somenteAmazonRadar) {
    logOptimus("RADAR", "Amazon encaminhada somente Engine V2", {
      links: links.length,
      origemTipo: origemTipoFinal,
      grupo: grupoNomeTexto || grupoIdTexto,
      motivo: "amazon_engine_v2"
    });
    registrarRadarMarketplaceEvento({
      marketplace: "amazon",
      capturado: true,
      motivo: "amazon_engine_v2"
    });

    return {
      ok: true,
      links: links.length,
      adicionadas: 0,
      resultados: links.map(link => ({
        link,
        ok: true,
        marketplace: "amazon",
        motivo: "amazon_engine_v2"
      }))
    };
  }

  const beneficiosMensagem = analisarBeneficiosMensagemRadar(texto, links);
  logOptimus("CUPOM", "Extracao da mensagem", {
    cupom: beneficiosMensagem.cupom || "",
    cupomOrigem: beneficiosMensagem.cupomOrigem || "",
    tipoCupom: beneficiosMensagem.tipoCupom || "",
    beneficioExtra: beneficiosMensagem.beneficioExtra || "",
    linkResgateCupom: beneficiosMensagem.linkResgateCupom || "",
    linksResgate: beneficiosMensagem.linksResgate || []
  });
  if (beneficiosMensagem.cupom || beneficiosMensagem.linkResgateCupom || beneficiosMensagem.beneficioExtra) {
    logOptimus("CUPOM", "Detectado", {
      cupom: beneficiosMensagem.cupom || "",
      tipoCupom: beneficiosMensagem.tipoCupom || "",
      beneficioExtra: beneficiosMensagem.beneficioExtra || "",
      linksResgate: beneficiosMensagem.linksResgate.length
    });
  }

  const capturaPermitida = radarPodeCapturarAgora(radarConfig, {
    temBeneficioPrioritario: Boolean(
      beneficiosMensagem.cupom ||
      beneficiosMensagem.linkResgateCupom ||
      beneficiosMensagem.beneficioExtra
    )
  });

  if (!capturaPermitida.ok) {
    logOptimus("CAPTURA", "Rejeitada", {
      motivo: capturaPermitida.motivo,
      origemTipo: origemTipoFinal,
      grupo: grupoNomeTexto || grupoIdTexto
    });
    logRadarRejeitado(capturaPermitida.motivo, {
      origemTipo: origemTipoFinal,
      grupo: grupoNomeTexto || grupoIdTexto
    });
    return capturaPermitida;
  }
  const resultados = [];
  const marketplacesResumoRadar = new Set();
  const dataCaptura = capturadaEm || new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });

  for (const link of links) {
    const marketplaceInicialResumo = marketplaceResumoRadarDoLink(link);
    marketplacesResumoRadar.add(marketplaceInicialResumo);

    logOptimus("RADAR", "Link capturado", {
      url: link,
      grupo: grupoNomeTexto || grupoIdTexto
    });
    if (linkRedirectPermitidoRadar(link)) {
      const redirect = registroEngineRadar?.redirectsRadar?.find(item => item.linkOriginalCapturado === link) || {};
      const registroOk = registroEngineRadar?.ok === true && redirect.status === "resolvido";

      logOptimus("RADAR", "Redirect encaminhado somente Engine V2", {
        url: link,
        linkResolvido: redirect.linkResolvido || "",
        marketplace: redirect.marketplaceDetectado || marketplaceInicialResumo,
        grupo: grupoNomeTexto || grupoIdTexto,
        motivo: registroOk ? "redirect_engine_v2" : (redirect.motivo || registroEngineRadar?.motivo || "redirect_engine_registro_falhou")
      });
      resultados.push({
        link,
        ok: registroOk,
        marketplace: redirect.marketplaceDetectado || marketplaceInicialResumo,
        motivo: registroOk ? "redirect_engine_v2" : (redirect.motivo || registroEngineRadar?.motivo || "redirect_engine_registro_falhou")
      });
      continue;
    }

    if (marketplaceInicialResumo === "amazon") {
      logOptimus("RADAR", "Amazon ignorada no fluxo legado", {
        url: link,
        grupo: grupoNomeTexto || grupoIdTexto,
        motivo: "amazon_engine_v2"
      });
      registrarRadarMarketplaceEvento({
        marketplace: "amazon",
        capturado: true,
        motivo: "amazon_engine_v2"
      });
      resultados.push({
        link,
        ok: true,
        marketplace: "amazon",
        motivo: "amazon_engine_v2"
      });
      continue;
    }

    const beneficiosLink = {
      ...beneficiosMensagem,
      ...(beneficiosMensagem.beneficiosPorLink?.[link] || {})
    };
    const linkEhResgate = beneficiosMensagem.linksResgate.includes(link);

    if (linkEhResgate) {
      const temOutroLinkProduto = links.some(linkMensagem => !beneficiosMensagem.linksResgate.includes(linkMensagem));
      registrarHistoricoRadar(adminMasterId, {
        origemTipo: origemTipoFinal,
        origemSessaoId: sessaoIdTexto,
        origemGrupoId: grupoIdTexto,
        origemGrupoNome: grupoNomeTexto,
        capturadaEm: dataCaptura,
        mensagemResumo: texto,
        linkCapturado: link,
        linkOriginal: "",
        marketplace: detectarMarketplaceRadarLink(link) || "",
        cupom: beneficiosMensagem.cupom || "",
        avisoCupom: beneficiosMensagem.avisoCupom || "",
        tipoCupom: "resgate",
        cupomOrigem: beneficiosMensagem.cupomOrigem || "",
        cupomDetectadoTexto: Boolean(beneficiosMensagem.cupomDetectadoTexto),
        beneficioExtra: beneficiosMensagem.beneficioExtra || link,
        linkResgateCupom: beneficiosMensagem.linkResgateCupom || link,
        status: temOutroLinkProduto ? "detectado" : "erro",
        statusRadar: temOutroLinkProduto ? "detectada" : "erro",
        statusCaptura: temOutroLinkProduto ? "sucesso" : "erro",
        motivo: temOutroLinkProduto ? "link_resgate_cupom_detectado" : "link_resgate_cupom_sem_produto",
        motivoTecnico: temOutroLinkProduto ? "link_resgate_cupom_detectado" : "link_resgate_cupom_sem_produto",
        motivoFinal: temOutroLinkProduto ? "link_resgate_cupom_detectado" : "link_resgate_cupom_sem_produto",
        tipoLink: "cupom_resgate",
        tipoLinkRadar: "resgate_cupom",
        marketplaceDetectado: detectarMarketplaceRadarLink(link) || "",
        urlResolvida: "",
        linksDetectados: 1
      });
      registrarRadarMarketplaceEvento({
        marketplace: detectarMarketplaceRadarLink(link) || marketplaceInicialResumo,
        capturado: true,
        motivo: temOutroLinkProduto ? "link_resgate_cupom_detectado" : "link_resgate_cupom_sem_produto"
      });
      logOptimus("CUPOM", "Link de resgate detectado", {
        link,
        tipoCupom: "resgate",
        temOutroLinkProduto
      });
      continue;
    }

    const importacao = await importarOfertaRadarPorLink(link, {
      origemTipo: origemTipoFinal,
      sessaoId: sessaoIdTexto,
      grupoId: grupoIdTexto,
      grupoNome: grupoNomeTexto,
      textoOriginal: texto,
      raw
    });
    const marketplaceImportacaoResumo = normalizarMarketplaceResumoRadar(
      importacao.resolucao?.marketplaceReal ||
      importacao.oferta?.marketplace ||
      marketplaceInicialResumo
    );
    marketplacesResumoRadar.add(marketplaceImportacaoResumo);

    if (!importacao.ok) {
      logOptimus("RADAR", "Importacao falhou", {
        motivo: importacao.motivo || "importacao_falhou",
        motivoTecnico: importacao.motivoTecnico || importacao.motivo || "importacao_falhou",
        link,
        urlResolvida: importacao.resolucao?.urlResolvida || "",
        linkOriginal: importacao.resolucao?.linkOriginalLimpo || "",
        marketplace: importacao.resolucao?.marketplaceReal || "",
        tipoLinkRadar: importacao.resolucao?.tipoLinkRadar || "produto"
      });
      logRadarRejeitado(importacao.motivo || "importacao_falhou", {
        link,
        urlResolvida: importacao.resolucao?.urlResolvida || "",
        marketplace: importacao.resolucao?.marketplaceReal || ""
      });
      logRadarPipelineDebug({
        clienteId: adminMasterId,
        grupoNome: grupoNomeTexto || grupoIdTexto,
        linkOriginal: importacao.resolucao?.linkOriginalRadar || link,
        linkResolvido: importacao.resolucao?.linkResolvido || importacao.resolucao?.urlResolvida || "",
        marketplace: importacao.resolucao?.marketplaceReal || detectarMarketplaceRadarLink(link) || "",
        cupom: beneficiosMensagem.cupom || "",
        precoTexto: "",
        tituloTexto: "",
        importadorChamado: Boolean(importacao.resolucao?.ok),
        linkAfiliadoOk: false,
        adicionouFila: false,
        motivoRecusa: importacao.motivoTecnico || importacao.motivo || "importacao_falhou"
      });

      registrarHistoricoRadar(adminMasterId, {
        origemTipo: origemTipoFinal,
        origemSessaoId: sessaoIdTexto,
        origemGrupoId: grupoIdTexto,
        origemGrupoNome: grupoNomeTexto,
        capturadaEm: dataCaptura,
        mensagemResumo: texto,
        linkCapturado: link,
        linkOriginal: importacao.resolucao?.linkOriginalLimpo || "",
        urlResolvida: importacao.resolucao?.urlResolvida || "",
        linkResolvidoRadar: importacao.resolucao?.urlResolvida || "",
        marketplace: importacao.resolucao?.marketplaceReal || "",
        marketplaceDetectado: importacao.resolucao?.marketplaceReal || detectarMarketplaceRadarLink(link) || "",
        tipoLink: importacao.resolucao?.tipoLinkRadar === "intermediario" ? "intermediario" : "produto",
        tipoLinkRadar: importacao.resolucao?.tipoLinkRadar || "produto",
        statusCaptura: "erro",
        motivoTecnico: importacao.motivoTecnico || importacao.motivo || "importacao_falhou",
        motivoFinal: importacao.motivoTecnico || importacao.motivo || "importacao_falhou",
        statusHttp: importacao.resolucao?.statusHttp || "",
        erroTecnico: importacao.resolucao?.erroTecnico || importacao.erro || "",
        cupom: beneficiosMensagem.cupom || "",
        avisoCupom: beneficiosMensagem.avisoCupom || "",
        tipoCupom: beneficiosMensagem.tipoCupom || "",
        cupomOrigem: beneficiosMensagem.cupomOrigem || "",
        cupomDetectadoTexto: Boolean(beneficiosMensagem.cupomDetectadoTexto),
        beneficioExtra: beneficiosMensagem.beneficioExtra || "",
        linkResgateCupom: beneficiosMensagem.linkResgateCupom || "",
        status: "erro",
        statusRadar: "erro",
        motivo: importacao.motivo || "importacao_falhou",
        linksDetectados: 1
      });
      registrarRadarMarketplaceEvento({
        marketplace: marketplaceImportacaoResumo,
        capturado: true,
        redirectOk: importacao.resolucao?.ok === true || Boolean(importacao.resolucao?.urlResolvida),
        importadorChamado: importacao.resolucao?.ok === true,
        motivo: importacao.motivoTecnico || importacao.motivo || "importacao_falhou"
      });
      resultados.push({ link, ok: false, motivo: importacao.motivo });
      continue;
    }

    logOptimus("RADAR", "Importacao concluida", {
      linkCapturado: link,
      urlResolvida: importacao.resolucao?.urlResolvida || "",
      linkOriginal: importacao.resolucao?.linkOriginalLimpo || importacao.oferta?.linkOriginal || "",
      marketplace: importacao.oferta?.marketplace || importacao.resolucao?.marketplaceReal || "",
      titulo: importacao.oferta?.titulo || importacao.oferta?.nome || "",
      preco: importacao.oferta?.precoAtual || importacao.oferta?.preco || "",
      categoria: importacao.oferta?.categoria || "",
      cupomImportado: importacao.oferta?.cupom || "",
      cupomMensagem: beneficiosLink.cupom || ""
    });
    const ofertaRadar = aplicarIdentidadeCanonicaRadar(prepararOfertaGlobal({
      ...importacao.oferta,
      cupom: importacao.oferta?.cupom || beneficiosLink.cupom || "",
      avisoCupom: importacao.oferta?.avisoCupom || beneficiosLink.avisoCupom || "",
      tipoCupom: importacao.oferta?.tipoCupom || beneficiosLink.tipoCupom || "",
      beneficioExtra: importacao.oferta?.beneficioExtra || beneficiosLink.beneficioExtra || "",
      linkResgateCupom: importacao.oferta?.linkResgateCupom || beneficiosLink.linkResgateCupom || "",
      cupomOrigem: importacao.oferta?.cupomOrigem || beneficiosLink.cupomOrigem || "",
      cupomDetectadoTexto: Boolean(importacao.oferta?.cupomDetectadoTexto || beneficiosLink.cupomDetectadoTexto),
      ...origemBase,
      origemClienteId: adminMasterId,
      origem: "radar",
      origemTipo: origemTipoFinal,
      radar: true,
      linkOriginal: importacao.resolucao?.linkOriginalLimpo || importacao.oferta.linkOriginal,
      linkCapturado: importacao.resolucao?.urlCapturada || link,
      urlResolvida: importacao.resolucao?.urlResolvida || importacao.oferta.linkResolvidoRadar || "",
      linkResolvidoRadar: importacao.resolucao?.urlResolvida || importacao.oferta.linkResolvidoRadar || "",
      marketplaceDetectado: importacao.resolucao?.marketplaceReal || importacao.oferta.marketplace || "",
      tipoLink: importacao.resolucao?.tipoLinkRadar === "intermediario" ? "intermediario" : "produto",
      tipoLinkRadar: importacao.resolucao?.tipoLinkRadar || "produto",
      motivoTecnico: "",
      link: importacao.resolucao?.linkOriginalLimpo || importacao.oferta.linkOriginal,
      linkAfiliado: "",
      linkFinal: "",
      imagem: imagemOfertaRadar(importacao.oferta),
      image: imagemOfertaRadar(importacao.oferta),
      mensagemOriginalRadar: texto.slice(0, 1000),
      capturadaEm: dataCaptura,
      dataEntradaRadar: dataCaptura
    }));
    logProdutoCanonicoRadar(ofertaRadar);

    logRadarMlImagemDebug({
      clienteId: adminMasterId,
      oferta: ofertaRadar,
      linkOriginal: ofertaRadar.linkOriginal || "",
      linkResolvido: ofertaRadar.linkResolvidoRadar || ofertaRadar.urlResolvida || "",
      imagemImportador: imagemOfertaRadar(importacao.oferta),
      imagemOfertaRadar: imagemOfertaRadar(ofertaRadar),
      imagemFila: ""
    });

    logOptimus("CUPOM", "Oferta preparada", {
      titulo: ofertaRadar.titulo || ofertaRadar.nome || "",
      cupom: ofertaRadar.cupom || "",
      avisoCupom: ofertaRadar.avisoCupom || "",
      tipoCupom: ofertaRadar.tipoCupom || "",
      cupomOrigem: ofertaRadar.cupomOrigem || "",
      beneficioExtra: ofertaRadar.beneficioExtra || "",
      linkResgateCupom: ofertaRadar.linkResgateCupom || ""
    });

    const clientes = await adicionarRadarCapturadoNaFilaClientes(ofertaRadar, {
      radarConfigFontes: radarConfig
    });
    const adicionadasLink = clientes.filter(cliente => cliente.adicionada).length;
    const houveRetidaDestino = clientes.some(cliente => cliente.retida);
    const primeiraRejeicao = clientes.find(cliente => !cliente.adicionada)?.motivo || "";
    const aprovadoLink = clientes.some(cliente => cliente.ok === true || cliente.adicionada === true);
    const beneficio = beneficioResumoRadar(ofertaRadar);
    const economiaRadar = calcularEconomiaRadar(ofertaRadar);
    const clienteIdsAdicionados = clientes
      .filter(cliente => cliente.adicionada)
      .map(cliente => cliente.clienteId)
      .filter(Boolean);
    const clientesAdicionados = clientes
      .filter(cliente => cliente.adicionada)
      .map(cliente => ({
        clienteId: cliente.clienteId,
        idOfertaFila: cliente.idOfertaFila || "",
        linkAfiliado: cliente.linkAfiliado || "",
        statusRadar: cliente.statusRadar || "fila",
        statusFila: cliente.statusFila || "pendente"
      }));
    const primeiraFila = clientesAdicionados[0] || {};

    logDebug("[RADAR-DECISAO] distribuicao concluida", {
      linkCapturado: importacao.resolucao?.urlCapturada || link,
      titulo: ofertaRadar.titulo || ofertaRadar.nome || "",
      marketplace: ofertaRadar.marketplace || "",
      cupom: ofertaRadar.cupom || "",
      clientesAnalisados: clientes.length,
      adicionadas: adicionadasLink,
      primeiraRejeicao: primeiraRejeicao || ""
    });

    registrarHistoricoRadar(adminMasterId, {
      origemTipo: origemTipoFinal,
      origemSessaoId: sessaoIdTexto,
      origemGrupoId: grupoIdTexto,
      origemGrupoNome: grupoNomeTexto,
      capturadaEm: dataCaptura,
      mensagemResumo: texto,
      imagem: ofertaRadar.imagem || ofertaRadar.image || ofertaRadar.foto || "",
      linkCapturado: importacao.resolucao?.urlCapturada || link,
      urlResolvida: importacao.resolucao?.urlResolvida || "",
      linkResolvidoRadar: importacao.resolucao?.urlResolvida || "",
      linkOriginal: ofertaRadar.linkOriginal || "",
      linkAfiliado: primeiraFila.linkAfiliado || "",
      idOfertaFila: primeiraFila.idOfertaFila || "",
      chaveCanonica: ofertaRadar.chaveCanonica || "",
      produtoIdCanonico: ofertaRadar.produtoIdCanonico || "",
      marketplaceCanonico: ofertaRadar.marketplaceCanonico || "",
      marketplace: ofertaRadar.marketplace || "",
      marketplaceDetectado: importacao.resolucao?.marketplaceReal || ofertaRadar.marketplace || "",
      tipoLink: importacao.resolucao?.tipoLinkRadar === "intermediario" ? "intermediario" : "produto",
      tipoLinkRadar: importacao.resolucao?.tipoLinkRadar || "produto",
      statusCaptura: adicionadasLink > 0 ? "fila" : (houveRetidaDestino || primeiraRejeicao?.startsWith("retida") ? "retida" : "erro"),
      motivoFinal: adicionadasLink > 0 ? "enviado_para_fila" : primeiraRejeicao || "nenhum_cliente_adicionado",
      motivoTecnico: adicionadasLink > 0 ? "" : primeiraRejeicao || "nenhum_cliente_adicionado",
      titulo: ofertaRadar.titulo || ofertaRadar.nome || "",
      preco: ofertaRadar.precoAtual || ofertaRadar.preco || "",
      precoAtual: ofertaRadar.precoAtual || ofertaRadar.preco || "",
      precoAntigo: ofertaRadar.precoAntigo || "",
      categoria: ofertaRadar.categoria || "",
      economiaValor: economiaRadar.economiaValor,
      economiaPercentual: economiaRadar.economiaPercentual,
      cupom: ofertaRadar.cupom || "",
      avisoCupom: ofertaRadar.avisoCupom || "",
      tipoCupom: ofertaRadar.tipoCupom || "",
      cupomOrigem: ofertaRadar.cupomOrigem || "",
      cupomDetectadoTexto: Boolean(ofertaRadar.cupomDetectadoTexto),
      linkResgateCupom: ofertaRadar.linkResgateCupom || "",
      beneficioExtra: ofertaRadar.beneficioExtra || beneficio,
      beneficio,
      status: adicionadasLink > 0 ? "fila" : (houveRetidaDestino ? "retida" : "ignorada"),
      statusRadar: adicionadasLink > 0 ? "fila" : (houveRetidaDestino ? "retida" : "ignorada"),
      motivo: adicionadasLink > 0 ? "" : primeiraRejeicao || "nenhum_cliente_adicionado",
      linksDetectados: 1,
      adicionadas: adicionadasLink,
      clienteIdsAdicionados,
      clientesAdicionados
    });
    registrarRadarMarketplaceEvento({
      marketplace: ofertaRadar.marketplace || marketplaceImportacaoResumo,
      capturado: true,
      redirectOk: importacao.resolucao?.ok === true || Boolean(importacao.resolucao?.urlResolvida),
      importadorChamado: importacao.resolucao?.ok === true,
      importado: Boolean(ofertaRadar.titulo || ofertaRadar.nome) && Boolean(ofertaRadar.precoAtual || ofertaRadar.preco),
      aprovado: aprovadoLink,
      adicionadoFila: adicionadasLink > 0,
      motivo: adicionadasLink > 0 ? "" : primeiraRejeicao || "nenhum_cliente_adicionado"
    });

    resultados.push({
      link,
      ok: true,
      marketplace: ofertaRadar.marketplace,
      clientes
    });
  }

  const resumoRodada = resumirResultadosRadarMensagem(resultados);
  const adicionadas = resumoRodada.adicionadas;

  if (resultados.length) {
    logOptimus("RADAR", "Resumo rodada", {
      origemTipo: origemTipoFinal,
      sessaoId: sessaoIdTexto,
      grupo: grupoNomeTexto || grupoIdTexto,
      links: links.length,
      ...resumoRodada
    });
    logarResumoRadarMarketplace([...marketplacesResumoRadar]);
    console.log("[RADAR] Mensagem monitorada processada:", {
      origemTipo: origemTipoFinal,
      sessaoId: sessaoIdTexto,
      grupo: grupoNomeTexto || grupoIdTexto,
      links: links.length,
      adicionadas
    });
  }

  return {
    ok: true,
    links: links.length,
    adicionadas,
    resultados
  };
}

async function processarMensagemRadarAutomatica({ mensagem, sessaoId, sock } = {}) {
  const remoteJid = mensagem?.key?.remoteJid || "";
  const textoExtraido = extrairTextoMensagemRadar(mensagem);
  const conteudo = extrairMensagemInternaRadar(mensagem?.message || {});
  const tiposMensagem = Object.keys(conteudo || {});

  registrarRadarListenerRecebido({
    sessaoId,
    remoteJid,
    grupoNome: obterNomeGrupoRadar(sessaoId, remoteJid),
    tamanhoTexto: textoExtraido.length
  });
  logOptimus("CAPTURA", "Upsert WhatsApp", {
    sessaoId,
    remoteJid,
    fromMe: Boolean(mensagem?.key?.fromMe),
    isGrupo: String(remoteJid || "").endsWith("@g.us"),
    tiposMensagem,
    tamanhoTexto: textoExtraido.length
  });

  if (!remoteJid || !remoteJid.endsWith("@g.us") || mensagem?.key?.fromMe) {
    logOptimus("CAPTURA", "Mensagem nao monitoravel", {
      sessaoId,
      remoteJid,
      fromMe: Boolean(mensagem?.key?.fromMe),
      motivo: "mensagem_nao_monitoravel"
    });
    return { ok: false, motivo: "mensagem_nao_monitoravel" };
  }

 logDebug("🧪 RADAR CHAMANDO PROCESSAR", {
  sessaoId,
  remoteJid,
  tamanhoTexto: textoExtraido.length
});

 return processarMensagemRadar({
    origemTipo: "whatsapp",
    sessaoId,
    grupoId: remoteJid,
    grupoNome: obterNomeGrupoRadar(sessaoId, remoteJid),
    texto: textoExtraido,
    raw: mensagem
  });
}

function normalizarMensagemTelegramRadar(payload = {}) {
  const mensagem =
    payload.message ||
    payload.channel_post ||
    payload.edited_message ||
    payload.edited_channel_post ||
    payload;
  const chat = mensagem.chat || payload.chat || {};
  const grupoId = textoRadarId(
    payload.grupoId ||
    payload.chatId ||
    chat.id ||
    mensagem.chatId ||
    ""
  );
  const grupoNome = textoRadarId(
    payload.grupoNome ||
    payload.nome ||
    chat.title ||
    chat.username ||
    chat.first_name ||
    ""
  );
  const texto = textoRadarId(
    payload.texto ||
    payload.text ||
    mensagem.text ||
    mensagem.caption ||
    ""
  );

  return {
    origemTipo: "telegram",
    sessaoId: "telegram",
    grupoId,
    grupoNome,
    texto,
    capturadaEm: payload.capturadaEm || new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo"
    }),
    raw: payload
  };
}

function clienteAceitaMarketplaceAtivo(clienteId = "admin", marketplace = "") {
  const configCliente = configsPorCliente?.[clienteId] || {};
  const regraCliente = configCliente.marketplaces?.[marketplace];

  return regraCliente?.ativo !== false;
}

function existeDestinoCompativelRadar(clienteId = "admin", oferta = {}) {
  const destinosCliente = destinosClienteNormalizados(clienteId);

  return destinosCliente.some(destino =>
    destinoAceitaOferta(destino, oferta)
  );
}

function radarImportanteParaRetencaoSemDestino(oferta = {}, radar = {}, cupomRadar = {}, tipoRadar = "") {
  const score = Number(radar.radarScore || oferta.radarScore || oferta.score || 0);
  const tipoRadarNormalizado = normalizarTexto(tipoRadar || oferta.tipoRadar || "");
  const tipoCupom = normalizarTexto(cupomRadar.tipoCupom || oferta.tipoCupom || "");

  return Boolean(
    cupomRadar.cupomConfirmado === true ||
    oferta.cupomConfirmado === true ||
    cupomRadar.cupom ||
    oferta.cupom ||
    cupomRadar.avisoCupom ||
    oferta.avisoCupom ||
    cupomRadar.cupomDetectado ||
    oferta.cupomDetectado ||
    cupomRadar.cupomDetectadoTexto ||
    oferta.cupomDetectadoTexto ||
    (tipoCupom && tipoCupom !== "nenhum") ||
    tipoRadarNormalizado === "radarcomcupom" ||
    score >= 60
  );
}

function linkChaveRetidaOferta(oferta = {}) {
  return String(
    oferta.linkOriginal ||
    oferta.linkAfiliado ||
    oferta.linkFinal ||
    oferta.link ||
    ""
  ).trim().toLowerCase();
}

function precoChaveRetidaOferta(oferta = {}) {
  return String(oferta.precoAtual || oferta.preco || oferta.valor || "")
    .trim()
    .replace(/\s+/g, "");
}

function chaveRetidaOferta(clienteId = "admin", oferta = {}) {
  const chaveCanonica = chaveCanonicaRadarOferta(oferta);
  if (chaveCanonica) {
    return [
      String(clienteId || oferta.clienteId || "admin"),
      "canonica",
      chaveCanonica,
      "retida"
    ].join("|");
  }

  return [
    String(clienteId || oferta.clienteId || "admin"),
    normalizarTexto(oferta.marketplace || oferta.mercado || ""),
    normalizarTexto(oferta.titulo || oferta.nome || ""),
    precoChaveRetidaOferta(oferta),
    linkChaveRetidaOferta(oferta),
    "retida"
  ].join("|");
}

function retidaEquivalenteJaExiste(clienteId = "admin", oferta = {}) {
  const chaveNova = chaveRetidaOferta(clienteId, oferta);

  return fila.some(item => {
    if (normalizarTexto(item.status || "") !== "retida") return false;
    return chaveRetidaOferta(item.clienteId || clienteId, item) === chaveNova;
  });
}

function retidaCanonicaJaExiste(clienteId = "admin", oferta = {}) {
  const chaveCanonica = chaveCanonicaRadarOferta(oferta);
  if (!chaveCanonica) return null;

  return fila.find(item => {
    if (String(item.clienteId || "admin") !== String(clienteId || "admin")) return false;
    if (normalizarTexto(item.status || "") !== "retida") return false;
    return chaveCanonicaRadarOferta(item) === chaveCanonica;
  }) || null;
}

function reterRadarSemDestinoCliente(clienteId = "admin", oferta = {}) {
  marcarOfertaRetida(oferta, "retida_sem_destino_compativel");
  oferta.statusRadar = "retida";
  oferta.radarNaFila = false;
  oferta.radarPendenteAnalise = false;
  oferta.motivo = "sem_destino_compativel";
  oferta.motivoTecnico = "sem_destino_compativel";
  oferta.motivoFinal = "retida_sem_destino_compativel";

  const chaveCanonicaRetida = chaveCanonicaRadarOferta(oferta);
  if (chaveCanonicaRetida && retidaCanonicaJaExiste(clienteId, oferta)) {
    console.log("[RADAR-RETIDA-CANONICA-DUPLICADA]", {
      clienteId,
      chaveCanonica: chaveCanonicaRetida,
      motivo: "retida_canonica_ja_existente"
    });

    return {
      ok: true,
      adicionada: false,
      retida: true,
      duplicada: true,
      motivo: "retida_sem_destino_compativel",
      oferta
    };
  }

  if (retidaEquivalenteJaExiste(clienteId, oferta)) {
    logOptimus("FILA", "Radar retido duplicado ignorado", {
      clienteId,
      titulo: oferta.titulo || oferta.nome || "",
      marketplace: oferta.marketplace || "",
      preco: oferta.precoAtual || oferta.preco || "",
      motivoRetencao: oferta.motivoRetencao
    });

    return {
      ok: true,
      adicionada: false,
      retida: true,
      duplicada: true,
      motivo: "retida_sem_destino_compativel",
      oferta
    };
  }

  filaOfertas.adicionarOfertaFila(fila, oferta, {
    clienteId,
    origem: oferta.origem || "radar_retido",
    logger: console
  });
  registrarTratamentoRadar(clienteId, oferta, "retida");
  salvarFila(clienteId);

  logOptimus("FILA", "Radar retido sem destino compativel", {
    clienteId,
    titulo: oferta.titulo || oferta.nome || "",
    categoria: oferta.categoria || "",
    marketplace: oferta.marketplace || "",
    tipoRadar: oferta.tipoRadar || "",
    cupom: oferta.cupom || "",
    cupomConfirmado: Boolean(oferta.cupomConfirmado),
    score: oferta.radarScore || oferta.score || "",
    motivoRetencao: oferta.motivoRetencao
  });

  return {
    ok: true,
    adicionada: false,
    retida: true,
    motivo: "retida_sem_destino_compativel",
    oferta
  };
}

function itemContaComoPendenteRadar(item = {}) {
  if (!item || typeof item !== "object") return false;
  if (item.removidaRadar || item.ocultadaRadar) return false;
  if (item.radarPendenteAnalise === true) return true;
  if (String(item.statusRadar || "") === "pendente_analise") return true;

  return false;
}

function linksSetRadarOferta(oferta = {}) {
  return new Set([
    oferta.linkOriginal,
    oferta.linkResolvidoRadar,
    oferta.linkCapturado,
    oferta.linkAfiliado,
    oferta.linkFinal,
    oferta.link
  ].map(link => String(link || "").trim().toLowerCase()).filter(Boolean));
}

function mesmoProdutoRadarPorCupom(oferta = {}, item = {}) {
  const titulo = normalizarTexto(oferta.titulo || oferta.nome || "");
  const marketplace = normalizarMarketplaceRadar(oferta.marketplace || oferta.mercado || "");
  const preco = precoChaveRadar(oferta);
  const linksOferta = linksSetRadarOferta(oferta);
  const linksItem = linksSetRadarOferta(item);
  const mesmoLink = [...linksItem].some(link => linksOferta.has(link));

  if (mesmoLink) return true;

  return Boolean(
    titulo &&
    titulo === normalizarTexto(item.titulo || item.nome || "") &&
    marketplace &&
    marketplace === normalizarMarketplaceRadar(item.marketplace || item.mercado || "") &&
    preco &&
    preco === precoChaveRadar(item)
  );
}

function logRadarCupomRepetidoDecisao({
  clienteId = "admin",
  cupom = "",
  oferta = {},
  anterior = {},
  mesmoProduto = false,
  bloqueou = false,
  motivo = ""
} = {}) {
  console.log("[RADAR-CUPOM-REPETIDO-DECISAO]", {
    clienteId,
    cupom,
    tituloAtual: oferta.titulo || oferta.nome || "",
    linkAtual: oferta.linkOriginal || oferta.linkResolvidoRadar || oferta.linkCapturado || oferta.link || oferta.linkAfiliado || "",
    tituloAnterior: anterior.titulo || anterior.nome || "",
    linkAnterior: anterior.linkOriginal || anterior.linkResolvidoRadar || anterior.linkCapturado || anterior.link || anterior.linkAfiliado || "",
    mesmoProduto,
    bloqueou,
    motivo
  });
}

function diagnosticarRadarCupomRepetido(clienteId = "admin", oferta = {}) {
  const cupom = normalizarTexto(oferta.cupom || "");
  if (!cupom) return { repetido: false, produtoDiferente: false };

  let repetido = false;
  let produtoDiferente = false;

  for (const item of fila) {
    if (String(item.clienteId || "admin") !== String(clienteId || "admin")) continue;
    if (normalizarTexto(item.cupom || "") !== cupom) continue;

    repetido = true;
    const mesmoProduto = mesmoProdutoRadarPorCupom(oferta, item);
    if (!mesmoProduto) produtoDiferente = true;

    logRadarCupomRepetidoDecisao({
      clienteId,
      cupom: oferta.cupom || item.cupom || "",
      oferta,
      anterior: item,
      mesmoProduto,
      bloqueou: false,
      motivo: mesmoProduto
        ? "cupom_repetido_mesmo_produto_validar_duplicidade_normal"
        : "cupom_repetido_produto_diferente_permitido"
    });
  }

  return { repetido, produtoDiferente };
}

function radarCupomRepetidoProdutoDiferente(clienteId = "admin", oferta = {}) {
  return diagnosticarRadarCupomRepetido(clienteId, oferta).produtoDiferente;
}
async function prepararOfertaRadarParaCliente(ofertaBase = {}, clienteId = "admin", opcoes = {}) {
  const usuario = getUsuarioClienteRadar(clienteId);

  if (!usuario || usuario.ativo === false) {
    return { ok: false, motivo: "cliente_inativo_ou_inexistente" };
  }

  const radarConfig = opcoes.radarConfigFontes || carregarRadarConfigAdminMaster();
  const origemMonitorada = origemOfertaEstaMonitoradaRadar(ofertaBase, radarConfig);

  if (!origemMonitorada.ok) {

logRadarBloqueadoMonitoramento({
    clienteId,
    motivo: origemMonitorada.motivo,
    origemMonitorada,
    sessaoId: ofertaBase.sessaoId,
    grupoId: ofertaBase.grupoId,
    grupoNome: ofertaBase.grupoNome
  });

    return { ok: false, motivo: origemMonitorada.motivo };
  }

console.log("✅ RADAR ORIGEM VALIDADA", {
  clienteId,
  grupoId: ofertaBase.grupoId,
  sessaoId: ofertaBase.sessaoId
});

  let ofertaPreparada = prepararOfertaGlobal({
    ...(ofertaBase || {}),
    ...origemMonitorada.origem
  });
  ofertaPreparada = aplicarIdentidadeCanonicaRadar(ofertaPreparada);
  logProdutoCanonicoRadar(ofertaPreparada);
  const cupomRadar = normalizarBeneficiosRadarOferta(ofertaPreparada);
  ofertaPreparada.cupom = cupomRadar.cupom;
  ofertaPreparada.avisoCupom = cupomRadar.avisoCupom;
  ofertaPreparada.tipoCupom = cupomRadar.tipoCupom;
  ofertaPreparada.valorCupom = cupomRadar.valorCupom;
  ofertaPreparada.percentualCupom = cupomRadar.percentualCupom;
  ofertaPreparada.descontoPix = cupomRadar.descontoPix;
  ofertaPreparada.descontoApp = cupomRadar.descontoApp;
  ofertaPreparada.beneficioExtra = cupomRadar.beneficioExtra;
  ofertaPreparada.cupomConfirmado = cupomRadar.cupomConfirmado;
  ofertaPreparada.possivelCupom = cupomRadar.possivelCupom;
  ofertaPreparada.categoria = categoriaRadarReclassificada(ofertaPreparada);
  ofertaPreparada = aplicarFallbackCategoriaRadarMl(ofertaPreparada, clienteId);

  const categoriasPermitidas = Array.isArray(radarConfig.categoriasPermitidas)
    ? radarConfig.categoriasPermitidas
    : [];

  if (categoriasPermitidas.length) {
    const categoriaOferta = normalizarTexto(ofertaPreparada.categoria || "");
    const permitido = categoriasPermitidas.some(categoria =>
      normalizarTexto(categoria) === categoriaOferta
    );

    if (!permitido) {
      return { ok: false, motivo: "categoria_nao_permitida_radar" };
    }
  }

  const marketplaceOriginal = normalizarTexto(
    ofertaPreparada.marketplace ||
    ofertaPreparada.mercado ||
    ofertaBase.marketplace ||
    ""
  );
  const marketplace = normalizarMarketplaceRadar(marketplaceOriginal);

  if (!marketplace) {
    return { ok: false, motivo: "marketplace_ausente" };
  }

  ofertaPreparada.marketplace = marketplace;

  if (marketplaceOriginal && marketplaceOriginal !== marketplace) {
    ofertaPreparada.marketplaceOriginalRadar = marketplaceOriginal;
  }

  if (!usuarioPodeReceberMarketplace(usuario, marketplace)) {
    return { ok: false, motivo: "marketplace_nao_permitido_no_plano" };
  }

  if (!clienteAceitaMarketplaceAtivo(clienteId, marketplace)) {
    return { ok: false, motivo: "marketplace_desativado_no_cliente" };
  }

  const kabumRadarAwin = marketplace === "awin" && (
    ofertaPreparada.fallbackKabumRadar403 === true ||
    normalizarTexto(ofertaPreparada.marketplaceOriginalRadar || ofertaBase.marketplaceOriginalRadar || "") === "kabum"
  );

  if (!usuarioTemIntegracaoMarketplace(clienteId, marketplace)) {
    if (kabumRadarAwin) {
      logOptimus("INTEGRACAO", "KaBuM/AWIN Radar sem integracao do cliente", {
        clienteId,
        motivo: "awin_kabum_integracao_ausente_cliente"
      });
      return { ok: false, motivo: "awin_kabum_integracao_ausente_cliente" };
    }

    return { ok: false, motivo: "integracao_marketplace_ausente" };
  }

  const radar = avaliarOfertaRadar(ofertaPreparada);
  const temBeneficioUtil = beneficioRadarUtil(ofertaPreparada, cupomRadar);
  const temCupomForte = cupomRadar.cupomConfirmado || temBeneficioUtil;
  const tipoRadar = temCupomForte ? "radarComCupom" : "radarSemCupom";
  const prioridadeFila = temCupomForte ? 80 : 40;
  const linkOriginal =
    ofertaPreparada.linkOriginal ||
    ofertaPreparada.linkResolvidoRadar ||
    ofertaPreparada.linkCapturado ||
    "";


  if (kabumRadarAwin) {
    const validacaoAwinKabum = validarAwinKabumManual(clienteId, linkOriginal);
    if (!validacaoAwinKabum.ok) {
      logOptimus("INTEGRACAO", "KaBuM/AWIN Radar sem integracao do cliente", {
        clienteId,
        motivo: "awin_kabum_integracao_ausente_cliente",
        faltando: validacaoAwinKabum.faltando || []
      });
      return { ok: false, motivo: "awin_kabum_integracao_ausente_cliente" };
    }
  }

  logOptimus("INTELIGENCIA", "Radar score", {
    clienteId,
    titulo: ofertaPreparada.titulo || ofertaPreparada.nome || "",
    marketplace,
    categoria: ofertaPreparada.categoria || "",
    cupom: ofertaPreparada.cupom || "",
    cupomOrigem: ofertaPreparada.cupomOrigem || "",
    tipoCupom: ofertaPreparada.tipoCupom || "",
    cupomConfirmado: Boolean(cupomRadar.cupomConfirmado),
    possivelCupom: Boolean(cupomRadar.possivelCupom),
    score: radar.radarScore,
    nivel: radar.nivel,
    decisao: radar.decisao,
    motivos: radar.motivos || [],
    alertas: radar.alertas || []
  });
  logOptimus("RADAR", "Tipo Radar", {
    clienteId,
    tipoRadar,
    origemTipoRadar: cupomRadar.cupomConfirmado
      ? "cupomConfirmado"
      : temBeneficioUtil
        ? "beneficioUtil"
        : "semCupomConfirmado"
  });

  if (!linkOriginal) {
    logOptimus("RADAR", "Reprovado", {
      clienteId,
      aprovado: false,
      motivo: "link_original_ausente"
    });
    return { ok: false, motivo: "link_original_ausente" };
  }

  if (!oportunidadeRadarBoa(ofertaPreparada, radar, cupomRadar)) {
    logOptimus("RADAR", "Reprovado", {
      clienteId,
      aprovado: false,
      motivo: "oferta_sem_cupom_ou_desconto_relevante",
      score: radar.radarScore,
      decisao: radar.decisao,
      desconto: percentualDescontoRadar(ofertaPreparada, radar),
      cupom: ofertaPreparada.cupom || "",
      cupomConfirmado: Boolean(cupomRadar.cupomConfirmado),
      beneficioUtil: Boolean(temBeneficioUtil)
    });
    return { ok: false, motivo: "oferta_sem_cupom_ou_desconto_relevante" };
  }

  const linkAfiliadoCliente = await gerarLinkAfiliadoCliente(
    clienteId,
    marketplace,
    linkOriginal,
    ofertaPreparada
  );

  if (!linkAfiliadoCliente) {
    const motivoLinkAfiliadoNaoGerado = ofertaPreparada.tipoLinkRadar === "shortlink_meli_social" ||
      ofertaPreparada.fallbackMercadoLivreRadarTexto === true
        ? "link_afiliado_nao_gerado_meli_social"
        : "link_afiliado_nao_gerado";

    logOptimus("INTEGRACAO", "Link afiliado nao gerado", {
      clienteId,
      aprovado: false,
      motivo: motivoLinkAfiliadoNaoGerado
    });
    return { ok: false, motivo: motivoLinkAfiliadoNaoGerado };
  }

  if (String(linkAfiliadoCliente).trim() === String(linkOriginal).trim()) {
    logOptimus("INTEGRACAO", "Link afiliado invalido", {
      clienteId,
      aprovado: false,
      motivo: "link_afiliado_igual_original"
    });
    return { ok: false, motivo: "link_afiliado_igual_original" };
  }

  logOptimus("INTEGRACAO", "Link afiliado cliente gerado", {
    clienteId,
    marketplace,
    linkOriginal,
    linkAfiliado: linkAfiliadoCliente
  });

  const agoraBR = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });

  const ofertaCliente = {
    ...ofertaPreparada,
    clienteId,
    origem: "radar",
    radar: true,
    fonte: "radar",
    origemLabel: "Radar",
    origemBadge: "Radar",
    origemIcone: "radar",
    exibirBadgeRadar: true,
    badgeOrigem: {
      id: "radar",
      label: "Radar",
      icone: "radar",
      cor: "cyan"
    },
    radarNaFila: true,
    statusRadar: "fila",
    radarPendenteAnalise: false,
    tipoRadar,
    prioridadeFila,
    marketplace,
    linkOriginal,
    linkOriginalRadar: ofertaPreparada.linkOriginalRadar || ofertaPreparada.linkCapturado || linkOriginal,
    linkResolvido: ofertaPreparada.linkResolvido || ofertaPreparada.linkResolvidoRadar || linkOriginal,
    linkAfiliado: linkAfiliadoCliente,
    link: linkAfiliadoCliente,
    linkFinal: linkAfiliadoCliente,
    imagem: imagemOfertaRadar(ofertaPreparada),
    image: imagemOfertaRadar(ofertaPreparada),
    status: "pendente",
    statusDetalhe: temCupomForte
      ? "Radar: cupom detectado"
      : cupomRadar.possivelCupom
      ? "Radar: possivel cupom, conferir"
      : "Radar: oportunidade",
    origemGrupoId: origemMonitorada.origem.origemGrupoId,
    origemGrupoNome: origemMonitorada.origem.origemGrupoNome,
    origemSessaoId: origemMonitorada.origem.origemSessaoId,
    origemTipo: origemMonitorada.origem.origemTipo,
    coletadoDe: origemMonitorada.origem.origemGrupoNome || origemMonitorada.origem.origemGrupoId,
    avisoCupom: cupomRadar.avisoCupom,
    tipoCupom: cupomRadar.tipoCupom,
    valorCupom: cupomRadar.valorCupom,
    percentualCupom: cupomRadar.percentualCupom,
    descontoPix: cupomRadar.descontoPix,
    descontoApp: cupomRadar.descontoApp,
    beneficioExtra: cupomRadar.beneficioExtra,
    cupomConfirmado: cupomRadar.cupomConfirmado,
    possivelCupom: cupomRadar.possivelCupom,
    destinosEnviados: [],
    logsEnvio: [],
    enviadoEm: "",
    dataEnvio: "",
    radarScore: radar.radarScore,
    radarNivel: radar.nivel,
    radarDecisao: radar.decisao,
    radarMotivos: radar.motivos,
    radarAlertas: radar.alertas,
    dataEntradaRadar: agoraBR,
    capturadaEm: ofertaPreparada.capturadaEm || agoraBR,
    dataTratamento: new Date().toISOString(),
    emFilaEm: new Date().toISOString(),
    dataEntradaFila: agoraBR,
    criadoEm: ofertaPreparada.criadoEm || agoraBR
  };

  validarCupomMonetarioOferta(ofertaCliente);
  aplicarPrioridadeEnvioOferta(ofertaCliente);
  ofertaCliente.prioridadeFila = ofertaCliente.prioridadeEnvio;

  logRadarMlImagemDebug({
    clienteId,
    oferta: ofertaCliente,
    linkOriginal,
    linkResolvido: ofertaCliente.linkResolvido || ofertaCliente.linkResolvidoRadar || "",
    imagemImportador: imagemOfertaRadar(ofertaPreparada),
    imagemOfertaRadar: imagemOfertaRadar(ofertaPreparada),
    imagemFila: ofertaCliente.imagem || ""
  });

  if (!existeDestinoCompativelRadar(clienteId, ofertaCliente)) {
    logOptimus("DESTINO", "Radar sem destino compativel", {
      clienteId,
      aprovado: false,
      motivo: "sem_destino_compativel",
      categoria: ofertaCliente.categoria || "",
      marketplace: ofertaCliente.marketplace || ""
    });
    if (radarImportanteParaRetencaoSemDestino(ofertaCliente, radar, cupomRadar, tipoRadar)) {
      if (ofertaJaExiste(ofertaCliente)) {
        logOptimus("RADAR", "Retencao sem destino ignorada por duplicidade", {
          clienteId,
          motivo: "oferta_duplicada",
          categoria: ofertaCliente.categoria || "",
          marketplace: ofertaCliente.marketplace || ""
        });
        return { ok: false, motivo: "oferta_duplicada" };
      }

      return reterRadarSemDestinoCliente(clienteId, ofertaCliente);
    }

    return { ok: false, motivo: "sem_destino_compativel" };
  }

  if (ofertaJaExiste(ofertaCliente)) {
    logOptimus("RADAR", "radar_duplicada_mesma_oferta", {
      clienteId,
      aprovado: false,
      motivo: "radar_duplicada_mesma_oferta"
    });
    return { ok: false, motivo: "oferta_duplicada" };
  }

  if (deveIgnorarOfertaRepetida(ofertaCliente)) {
    logOptimus("RADAR", "Reprovado", {
      clienteId,
      aprovado: false,
      motivo: "oferta_repetida_na_memoria"
    });
    return { ok: false, motivo: "oferta_repetida_na_memoria" };
  }

  logOptimus("SUCESSO", "Radar aprovado", {
    clienteId,
    aprovado: true,
    decisao: radar.decisao,
    tipoRadar,
    cupom: ofertaCliente.cupom || "",
    linkOriginal,
    linkAfiliado: linkAfiliadoCliente
  });

  return { ok: true, oferta: ofertaCliente };
}

async function adicionarRadarNaFilaCliente(ofertaBase = {}, clienteId = "admin", opcoes = {}) {
  const preparado = await prepararOfertaRadarParaCliente(ofertaBase, clienteId, opcoes);

  if (!preparado.ok) {
    return preparado;
  }

  const oferta = preparado.oferta;
  carregarFila(clienteId);

  const diagnosticoCupomRepetido = diagnosticarRadarCupomRepetido(clienteId, oferta);

  if (diagnosticoCupomRepetido.produtoDiferente) {
    logOptimus("RADAR", "radar_cupom_repetido_produto_diferente_permitido", {
      clienteId,
      cupom: oferta.cupom || "",
      titulo: oferta.titulo || oferta.nome || ""
    });
  }

  const duplicidadeRadar = duplicidadeRadarNaFilaCliente(oferta, clienteId);

  if (duplicidadeRadar.duplicada) {
    if (diagnosticoCupomRepetido.repetido) {
      logRadarCupomRepetidoDecisao({
        clienteId,
        cupom: oferta.cupom || "",
        oferta,
        anterior: duplicidadeRadar.itemDuplicado || {},
        mesmoProduto: true,
        bloqueou: true,
        motivo: `bloqueio_por_${duplicidadeRadar.motivo || "duplicidade_real"}`
      });
    }

    logRadarDuplicadaBloqueada(clienteId, oferta, duplicidadeRadar.motivo);
    return { ok: false, motivo: "radar_duplicada_bloqueada" };
  }

  const itensFilaRadarCliente = fila.filter(item =>
    String(item.clienteId || "admin") === String(clienteId) &&
    item.origem === "radar"
  );
  const pendentesRadar = itensFilaRadarCliente.filter(itemContaComoPendenteRadar);

  const totalRadar = pendentesRadar.length;
  const totalComCupom = pendentesRadar.filter(item =>
    item.tipoRadar === "radarComCupom"
  ).length;
  const totalSemCupom = pendentesRadar.filter(item =>
    item.tipoRadar === "radarSemCupom"
  ).length;
  const totalRadarNaFilaNormal = itensFilaRadarCliente.filter(item =>
    item.status === "pendente" &&
    (item.radarNaFila === true || String(item.statusRadar || "") === "fila" || !item.statusRadar)
  ).length;

  logOptimus("RADAR", "Pendentes analisados", {
    clienteId,
    totalRadar,
    totalComCupom,
    totalSemCupom,
    totalRadarNaFilaNormal,
    regra: "conta_apenas_statusRadar_pendente_analise"
  });

  if (totalRadar >= 10) {
    logOptimus("RADAR", "Reprovado", {
      clienteId,
      aprovado: false,
      motivo: "limite_radar_pendente_total",
      totalRadar,
      totalComCupom,
      totalSemCupom
    });
    return { ok: false, motivo: "limite_radar_pendente_total" };
  }

  if (oferta.tipoRadar === "radarComCupom" && totalComCupom >= 4) {
    logOptimus("RADAR", "Reprovado", {
      clienteId,
      aprovado: false,
      motivo: "limite_radar_com_cupom",
      totalRadar,
      totalComCupom,
      totalSemCupom
    });
    return { ok: false, motivo: "limite_radar_com_cupom" };
  }

  if (oferta.tipoRadar === "radarSemCupom" && totalSemCupom >= 6) {
    logOptimus("RADAR", "Reprovado", {
      clienteId,
      aprovado: false,
      motivo: "limite_radar_sem_cupom",
      totalRadar,
      totalComCupom,
      totalSemCupom
    });
    return { ok: false, motivo: "limite_radar_sem_cupom" };
  }

  if (!podeAdicionarOfertaAutomaticaFila(oferta, clienteId, "radar")) {
    return { ok: false, motivo: "performance_fila_limite" };
  }

  logPrioridadeFila(oferta);
  filaOfertas.adicionarOfertaFila(fila, oferta, {
    clienteId,
    origem: oferta.origem || "radar",
    logger: console
  });
  registrarOfertaVista(oferta);
  registrarTratamentoRadar(clienteId, oferta, "fila");
  salvarFila(clienteId);

  return {
    ok: true,
    adicionada: true,
    oferta
  };
}

app.get("/branding", (req, res) => {
  try {
    const branding = lerBrandingOficial();

    return res.json({
      ok: true,
      escopo: "oficial",
      branding
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.post("/branding", (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({
        ok: false,
        erro: "Cliente nao autenticado"
      });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.clienteId = decoded.clienteId || "";
    } catch {
      return res.status(401).json({
        ok: false,
        erro: "Token invalido"
      });
    }

    if (!isAdminMaster(req)) {
      return res.status(403).json({
        ok: false,
        erro: "Acesso restrito ao admin_master"
      });
    }

    const resultado = salvarBrandingOficial(req.body || {});

    if (!resultado.ok) {
      return res.status(400).json({
        ok: false,
        erro: resultado.erro || "Branding invalido"
      });
    }

    return res.json({
      ok: true,
      escopo: "oficial",
      branding: resultado.branding
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.delete("/branding", (req, res) => {
  try {
    if (!isAdminMaster(req)) {
      return res.status(403).json({
        ok: false,
        erro: "Acesso restrito ao admin_master"
      });
    }

    const branding = restaurarBrandingOficial();

    return res.json({
      ok: true,
      escopo: "oficial",
      restaurado: true,
      branding
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

function radarDebugAdminMaster(req, res) {
  if (req.usuario?.papel !== "admin_master") {
    res.status(403).json({
      ok: false,
      erro: "Acesso restrito ao admin_master"
    });
    return false;
  }

  return obterClienteIdAdminMaster();
}

function montarGrupoRadarDebug(grupo = {}, sessaoId = "") {
  const remoteJid = textoRadarId(
    grupo.remoteJid ||
    grupo.grupoId ||
    grupo.id ||
    grupo.jid ||
    grupo.value ||
    ""
  );

  if (!chaveGrupoWhatsappTecnicaRadar(remoteJid)) return null;

  return {
    id: remoteJid,
    grupoId: remoteJid,
    remoteJid,
    nome: textoRadarId(grupo.nome || grupo.titulo || grupo.label || grupo.subject || remoteJid),
    sessaoId,
    ativo: grupo.ativo !== false,
    tipo: "whatsapp"
  };
}

app.post("/radar/debug/salvar-whatsapp", (req, res) => {
  try {
    const clienteId = radarDebugAdminMaster(req, res);
    if (!clienteId) return;

    const body = req.body || {};
    const sessaoIdEntrada = textoRadarId(body.sessaoId || body.sessaoWhatsappId || body.sessionId || "");
    const sessaoValidada = validarSessaoRadarCliente(clienteId, sessaoIdEntrada);

    if (!sessaoValidada.ok) {
      return res.status(400).json({
        ok: false,
        erro: sessaoValidada.motivo || "sessao_whatsapp_invalida",
        sessaoId: sessaoIdEntrada
      });
    }

    const sessaoId = sessaoValidada.sessaoWhatsappId || sessaoIdEntrada;
    const gruposEntrada = Array.isArray(body.grupos)
      ? body.grupos
      : Array.isArray(body.gruposMonitorados)
        ? body.gruposMonitorados
        : [];
    const gruposMonitorados = gruposEntrada
      .map(grupo => montarGrupoRadarDebug(grupo, sessaoId))
      .filter(Boolean);

    if (!sessaoId) {
      return res.status(400).json({
        ok: false,
        erro: "sessaoId obrigatorio"
      });
    }

    if (!gruposMonitorados.length) {
      return res.status(400).json({
        ok: false,
        erro: "Nenhum grupo WhatsApp valido informado. Use remoteJid/grupoId terminando em @g.us.",
        recebidos: gruposEntrada.length
      });
    }

    const salvo = salvarRadarConfigCliente(clienteId, {
      monitoramentoAtivo: body.monitoramentoAtivo !== false,
      sessaoWhatsappId: sessaoId,
      sessoesWhatsappMonitoradas: [
        {
          sessaoId,
          gruposMonitorados
        }
      ]
    });
    const validacoes = gruposMonitorados.map(grupo => origemOfertaEstaMonitoradaRadar({
      origemTipo: "whatsapp",
      origemSessaoId: sessaoId,
      origemGrupoId: grupo.remoteJid,
      origemGrupoNome: grupo.nome
    }, salvo));

    return res.json({
      ok: true,
      clienteId,
      sessaoId,
      gruposRecebidos: gruposEntrada.length,
      gruposValidos: gruposMonitorados.length,
      salvo,
      validacoes
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.get("/radar/debug/config", (req, res) => {
  try {
    const clienteId = radarDebugAdminMaster(req, res);
    if (!clienteId) return;

    const config = carregarRadarConfigCliente(clienteId);
    const sessoesWhatsappMonitoradas = Array.isArray(config.sessoesWhatsappMonitoradas)
      ? config.sessoesWhatsappMonitoradas
      : [];
    const resumo = sessoesWhatsappMonitoradas.map(sessao => ({
      sessaoId: sessao.sessaoId,
      totalGrupos: Array.isArray(sessao.gruposMonitorados) ? sessao.gruposMonitorados.length : 0,
      grupos: (Array.isArray(sessao.gruposMonitorados) ? sessao.gruposMonitorados : []).map(grupo => ({
        nome: grupo.nome,
        id: grupo.id,
        grupoId: grupo.grupoId,
        remoteJid: grupo.remoteJid,
        chaveValida: Boolean(chaveGrupoWhatsappTecnicaRadar(grupo.remoteJid || grupo.grupoId || grupo.id))
      }))
    }));

    return res.json({
      ok: true,
      clienteId,
      config,
      resumo
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.get("/radar/debug/validar", (req, res) => {
  try {
    const clienteId = radarDebugAdminMaster(req, res);
    if (!clienteId) return;

    const sessaoId = textoRadarId(req.query.sessaoId || req.query.sessaoWhatsappId || req.query.sessionId || "");
    const grupoId = textoRadarId(req.query.grupoId || req.query.remoteJid || req.query.id || "");
    const grupoNome = textoRadarId(req.query.grupoNome || req.query.nome || "");
    const config = carregarRadarConfigCliente(clienteId);
    const resultado = origemOfertaEstaMonitoradaRadar({
      origemTipo: "whatsapp",
      origemSessaoId: sessaoId,
      origemGrupoId: grupoId,
      origemGrupoNome: grupoNome
    }, config);

    return res.json({
      ok: resultado.ok,
      clienteId,
      entrada: {
        sessaoId,
        grupoId,
        grupoNome
      },
      resultado,
      sessoesWhatsappMonitoradas: config.sessoesWhatsappMonitoradas
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});
function montarDiagnosticoRadarConfig(radarConfig = {}, sessoesWhatsapp = []) {
  const sessoesMonitoradas = Array.isArray(radarConfig.sessoesWhatsappMonitoradas)
    ? radarConfig.sessoesWhatsappMonitoradas
    : [];

  const gruposMonitorados = Array.isArray(radarConfig.gruposMonitorados)
    ? radarConfig.gruposMonitorados
    : [];

  const sessoes = sessoesWhatsapp.map(sessao => {
    const sessaoId = textoRadarId(sessao.sessaoId || sessao.id || "");
    const gruposReais = obterGruposReaisSessaoRadar(sessaoId);
    const monitorada = sessoesMonitoradas.find(item => chaveRadarId(item.sessaoId || "") === chaveRadarId(sessaoId));

    return {
      sessaoId,
      nome: sessao.nome || sessao.nomeExibicao || sessao.nomeAmigavel || "",
      status: sessao.status || "",
      conectado: Boolean(sessao.conectado),
      totalGruposReais: gruposReais.length,
      gruposReais,
      monitorada: Boolean(monitorada),
      gruposMonitorados: Array.isArray(monitorada?.gruposMonitorados) ? monitorada.gruposMonitorados : []
    };
  });

  const validacoesGruposMonitorados = gruposMonitorados.map(grupo => {
    const resultado = origemOfertaEstaMonitoradaRadar({
      origemTipo: "whatsapp",
      origemSessaoId: grupo.sessaoId || radarConfig.sessaoWhatsappId || "",
      origemGrupoId: grupo.remoteJid || grupo.grupoId || grupo.id || "",
      origemGrupoNome: grupo.nome || ""
    }, radarConfig);

    return {
      nome: grupo.nome || "",
      sessaoId: grupo.sessaoId || "",
      id: grupo.id || "",
      grupoId: grupo.grupoId || "",
      remoteJid: grupo.remoteJid || "",
      idTecnicoValido: Boolean(chaveGrupoWhatsappTecnicaRadar(grupo.remoteJid || grupo.grupoId || grupo.id || "")),
      validacao: resultado
    };
  });

  return {
    sessaoWhatsappId: radarConfig.sessaoWhatsappId || "",
    gruposMonitorados,
    sessoesWhatsappMonitoradas: sessoesMonitoradas,
    sessoesWhatsapp: sessoes,
    idsReaisRecebidosNoListener: [...radarListenerRecentes].slice(-20).reverse(),
    gruposCapturadosRecentementeBloqueados: [...radarBloqueiosRecentes].slice(-20).reverse(),
    validacoesGruposMonitorados
  };
}
app.get("/radar/config", (req, res) => {
  try {
    if (req.usuario?.papel !== "admin_master") {
      return res.status(403).json({
        ok: false,
        erro: "Acesso restrito ao admin_master"
      });
    }

    const clienteId = obterClienteIdAdminMaster();

    const radarConfig = carregarRadarConfigAdminMaster();
    const sessoesWhatsapp = listarSessoesWhatsappCliente(clienteId);
    const telegramDisponiveis = listarTelegramRadarCliente(clienteId);
    const diagnosticoVinculo = montarDiagnosticoRadarConfig(radarConfig, sessoesWhatsapp);
    logOptimus("RADAR", "Config carregada", {
      clienteId,
      sessoesWhatsappMonitoradas: Array.isArray(radarConfig.sessoesWhatsappMonitoradas) ? radarConfig.sessoesWhatsappMonitoradas.length : 0,
      gruposMonitorados: Array.isArray(radarConfig.gruposMonitorados) ? radarConfig.gruposMonitorados.length : 0
    });

    return res.json({
      monitoramentoAtivo: radarConfig.monitoramentoAtivo,
      sessaoWhatsappId: radarConfig.sessaoWhatsappId,
      gruposMonitorados: radarConfig.gruposMonitorados,
      sessoesWhatsappMonitoradas: radarConfig.sessoesWhatsappMonitoradas,
      telegramMonitorados: radarConfig.telegramMonitorados,
      monitoramento: radarConfig.monitoramento,
      categoriasPermitidas: radarConfig.categoriasPermitidas,
      templateMidia: radarConfig.templateMidia,
      sessoesWhatsapp,
      sessoes: sessoesWhatsapp,
      telegramDisponiveis,
      telegram: telegramDisponiveis,
      diagnosticoVinculo
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.post("/radar/config", (req, res) => {
  try {
    if (req.usuario?.papel !== "admin_master") {
      return res.status(403).json({
        ok: false,
        erro: "Acesso restrito ao admin_master"
      });
    }

    const clienteId = obterClienteIdAdminMaster();

    const body = req.body || {};
    const possuiCampo = campo => Object.prototype.hasOwnProperty.call(body, campo);
    const gruposMonitorados = body.gruposMonitorados;
    const sessoesWhatsappMonitoradas = body.sessoesWhatsappMonitoradas;
    const telegramMonitorados = body.telegramMonitorados;

    if (possuiCampo("gruposMonitorados") && !Array.isArray(gruposMonitorados)) {
      return res.status(400).json({
        ok: false,
        erro: "gruposMonitorados deve ser array"
      });
    }

    if (possuiCampo("sessoesWhatsappMonitoradas") && !Array.isArray(sessoesWhatsappMonitoradas)) {
      return res.status(400).json({
        ok: false,
        erro: "sessoesWhatsappMonitoradas deve ser array"
      });
    }

    if (possuiCampo("sessoesWhatsappMonitoradas")) {
      for (const sessao of sessoesWhatsappMonitoradas) {
        if (!sessao || typeof sessao !== "object" || Array.isArray(sessao)) {
          return res.status(400).json({
            ok: false,
            erro: "sessoesWhatsappMonitoradas deve conter objetos"
          });
        }

        if (!Array.isArray(sessao.gruposMonitorados)) {
          return res.status(400).json({
            ok: false,
            erro: "gruposMonitorados da sessao deve ser array"
          });
        }

        const sessaoValidada = validarSessaoRadarCliente(
          clienteId,
          sessao.sessaoId || sessao.id || sessao.sessionId
        );

        if (!sessaoValidada.ok) {
          return res.status(400).json({
            ok: false,
            erro: sessaoValidada.motivo
          });
        }
      }
    }

    if (possuiCampo("telegramMonitorados") && !Array.isArray(telegramMonitorados)) {
      return res.status(400).json({
        ok: false,
        erro: "telegramMonitorados deve ser array"
      });
    }

    if (possuiCampo("monitoramento") && (!body.monitoramento || typeof body.monitoramento !== "object" || Array.isArray(body.monitoramento))) {
      return res.status(400).json({
        ok: false,
        erro: "monitoramento deve ser objeto"
      });
    }

    if (possuiCampo("categoriasPermitidas") && !Array.isArray(body.categoriasPermitidas)) {
      return res.status(400).json({
        ok: false,
        erro: "categoriasPermitidas deve ser array"
      });
    }

    if (possuiCampo("templateMidia") && (!body.templateMidia || typeof body.templateMidia !== "object" || Array.isArray(body.templateMidia))) {
      return res.status(400).json({
        ok: false,
        erro: "templateMidia deve ser objeto"
      });
    }

    const dadosConfig = {};

    if (possuiCampo("monitoramentoAtivo")) {
      dadosConfig.monitoramentoAtivo = body.monitoramentoAtivo !== false;
    }

    if (possuiCampo("sessaoWhatsappId")) {
      const sessaoValidada = validarSessaoRadarCliente(
        clienteId,
        body.sessaoWhatsappId
      );

      if (!sessaoValidada.ok) {
        return res.status(400).json({
          ok: false,
          erro: sessaoValidada.motivo
        });
      }

      dadosConfig.sessaoWhatsappId = sessaoValidada.sessaoWhatsappId;
    }

    if (possuiCampo("sessoesWhatsappMonitoradas")) dadosConfig.sessoesWhatsappMonitoradas = sessoesWhatsappMonitoradas;
    if (possuiCampo("gruposMonitorados")) dadosConfig.gruposMonitorados = gruposMonitorados;
    if (possuiCampo("telegramMonitorados")) dadosConfig.telegramMonitorados = telegramMonitorados;
    if (possuiCampo("monitoramento")) dadosConfig.monitoramento = body.monitoramento;
    if (possuiCampo("categoriasPermitidas")) dadosConfig.categoriasPermitidas = body.categoriasPermitidas;
    if (possuiCampo("templateMidia")) dadosConfig.templateMidia = body.templateMidia;

    const radarConfig = salvarRadarConfigCliente(clienteId, dadosConfig);
    logOptimus("RADAR", "Config salva", {
      clienteId,
      sessoesWhatsappMonitoradas: Array.isArray(radarConfig.sessoesWhatsappMonitoradas) ? radarConfig.sessoesWhatsappMonitoradas.length : 0,
      gruposMonitorados: Array.isArray(radarConfig.gruposMonitorados) ? radarConfig.gruposMonitorados.length : 0
    });

    return res.json({
      ok: true,
      monitoramentoAtivo: radarConfig.monitoramentoAtivo,
      sessaoWhatsappId: radarConfig.sessaoWhatsappId,
      gruposMonitorados: radarConfig.gruposMonitorados,
      sessoesWhatsappMonitoradas: radarConfig.sessoesWhatsappMonitoradas,
      telegramMonitorados: radarConfig.telegramMonitorados,
      monitoramento: radarConfig.monitoramento,
      categoriasPermitidas: radarConfig.categoriasPermitidas,
      templateMidia: radarConfig.templateMidia
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.get("/radar/historico", (req, res) => {
  try {
    if (req.usuario?.papel !== "admin_master") {
      return res.status(403).json({
        ok: false,
        erro: "Acesso restrito ao admin_master"
      });
    }

    const clienteId = getClienteId(req);

    if (!clienteId) {
      return res.status(401).json({
        ok: false,
        erro: "Cliente nao autenticado"
      });
    }

    const pagina = paginaLimiteSeguro(req.query, 50, 200);
    const resumo = montarResumoHistoricoRadar(clienteId, {
      grupoId: req.query?.grupoId || "",
      origemTipo: req.query?.origemTipo || "",
      sessaoId: req.query?.sessaoId || "",
      limit: pagina.limit
    });

    return res.json({
      ok: true,
      clienteId,
      grupos: resumo.grupos,
      capturas: resumo.capturas,
      eventos: resumo.eventos,
      limite: pagina.limit,
      limit: pagina.limit,
      offset: 0,
      hasMore: false
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.get("/radar/preview", (req, res) => {
  try {
    if (req.usuario?.papel !== "admin_master") {
      return res.status(403).json({
        ok: false,
        erro: "Acesso restrito ao admin_master"
      });
    }

    const clienteId = getClienteId(req);

    if (!clienteId) {
      return res.status(401).json({
        ok: false,
        erro: "Cliente nao autenticado"
      });
    }

    const pagina = paginaLimiteSeguro(req.query, 50, 200);
    const resumo = montarResumoHistoricoRadar(clienteId, {
      grupoId: req.query?.grupoId || "",
      origemTipo: req.query?.origemTipo || "",
      sessaoId: req.query?.sessaoId || "",
      limit: pagina.limit
    });

    return res.json({
      ok: true,
      clienteId,
      grupos: resumo.grupos,
      eventos: resumo.eventos,
      capturas: resumo.capturas,
      limite: pagina.limit,
      limit: pagina.limit,
      offset: 0,
      hasMore: false
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.get("/radar/preview/:grupoId", (req, res) => {
  try {
    if (req.usuario?.papel !== "admin_master") {
      return res.status(403).json({
        ok: false,
        erro: "Acesso restrito ao admin_master"
      });
    }

    const clienteId = getClienteId(req);

    if (!clienteId) {
      return res.status(401).json({
        ok: false,
        erro: "Cliente nao autenticado"
      });
    }

    const pagina = paginaLimiteSeguro(req.query, 50, 200);
    const resumo = montarResumoHistoricoRadar(clienteId, {
      grupoId: req.params.grupoId || "",
      origemTipo: req.query?.origemTipo || "",
      sessaoId: req.query?.sessaoId || "",
      limit: pagina.limit
    });

    return res.json({
      ok: true,
      clienteId,
      grupos: resumo.grupos,
      eventos: resumo.eventos,
      capturas: resumo.capturas,
      limite: pagina.limit,
      limit: pagina.limit,
      offset: 0,
      hasMore: false
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

// Endpoint interno para plugar webhook/polling Telegram futuramente.
// Requer Bearer token de admin_master e processa somente chats ativos em telegramMonitorados.
app.post("/radar/telegram/inbound", async (req, res) => {
  try {
    if (req.usuario?.papel !== "admin_master") {
      return res.status(403).json({
        ok: false,
        motivo: "acesso_restrito_admin_master"
      });
    }

    const entrada = normalizarMensagemTelegramRadar(req.body || {});

    if (!entrada.grupoId) {
      return res.status(400).json({
        ok: false,
        motivo: "telegram_chat_id_obrigatorio"
      });
    }

    if (!entrada.texto) {
      return res.status(400).json({
        ok: false,
        motivo: "telegram_texto_obrigatorio"
      });
    }

    const resultado = await processarMensagemRadar(entrada);

    return res.json({
      ok: !!resultado.ok,
      origemTipo: "telegram",
      motivo: resultado.motivo || "",
      links: resultado.links || 0,
      adicionadas: resultado.adicionadas || 0,
      resultados: resultado.resultados || []
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      motivo: e.message
    });
  }
});

app.get("/radar", (req, res) => {
  try {
    if (req.usuario?.papel !== "admin_master") {
      return res.status(403).json({
        ok: false,
        erro: "Acesso restrito ao admin_master"
      });
    }

    const clienteId = String(req.query?.clienteId || getClienteId(req) || "admin");
    const pagina = paginaLimiteSeguro(req.query, 50, 200);
    const radarConfig = carregarRadarConfigCliente(clienteId);
    const descartesRadar = lerDescartesRadar(clienteId);
    const ofertasRadarCliente = lerFilasRadarSomenteLeitura()
      .filter((oferta) => String(oferta.origemClienteId || oferta.clienteId || "admin") === clienteId);

    sincronizarTratadasRadarDeOfertas(clienteId, ofertasRadarCliente);

    const tratadasRadar = lerTratadasRadar(clienteId);
    const resumoHistoricoRadar = montarResumoHistoricoRadar(clienteId, {
      limit: pagina.limit
    });
    const historicoOperacional = resumoHistoricoRadar.eventos;

    if (!temFontesMonitoradasRadar(radarConfig)) {
      return res.json({
        ok: true,
        total: 0,
        aviso: "Nenhum grupo monitorado configurado para o Radar.",
        clienteId,
        oportunidades: [],
        historicoOperacional,
        ultimasOfertasProcessadas: historicoOperacional,
        capturas: historicoOperacional,
        gruposPreview: resumoHistoricoRadar.grupos,
        diagnosticoRadar: resumoHistoricoRadar.diagnostico || resumoHistoricoRadar.contadoresDiagnostico || {}
      });
    }

    const oportunidades = deduplicarOportunidadesRadar(ofertasRadarCliente
      .filter((oferta) => !ofertaTratadaRadar(oferta, tratadasRadar))
      .filter((oferta) => !ofertaOcultadaRadar(oferta, descartesRadar))
      .filter((oferta) => origemOfertaEstaMonitoradaRadar(oferta, radarConfig).ok)
      .map((oferta) => {
        const origem = obterOrigemOfertaRadar(oferta);
        const cupomRadar = normalizarBeneficiosRadarOferta(oferta);
        const categoria = categoriaRadarReclassificada(oferta);
        const dataEntradaRadar = dataHoraRadarOferta(oferta);
        const capturadaEm = dataHoraRadarOferta({
          capturadaEm: oferta.capturadaEm,
          dataEntradaRadar,
          dataEntradaFila: oferta.dataEntradaFila,
          criadoEm: oferta.criadoEm
        });
        const economia = calcularEconomiaRadar(oferta);
        const ofertaRadar = {
          ...oferta,
          categoria,
          categoriaProduto: "",
          cupom: cupomRadar.cupom,
          avisoCupom: cupomRadar.avisoCupom,
          cupomConfirmado: cupomRadar.cupomConfirmado,
          possivelCupom: cupomRadar.possivelCupom
        };
        const radar = avaliarOfertaRadar(ofertaRadar, {
          termo: oferta.titulo || oferta.nome || "",
          possivelRepeticao: oferta.possivelRepeticao
        });

        return {
          id: oferta.id || "",
          idOfertaFila: oferta.id || oferta.idOfertaFila || "",
          titulo: oferta.titulo || oferta.nome || "",
          dataEntradaRadar,
          capturadaEm,
          imagem: oferta.imagem || oferta.image || oferta.foto || "",
          marketplace: oferta.marketplace || oferta.mercado || "",
          categoria: radar.categoria,
          precoAtual: oferta.precoAtual || oferta.preco || "",
          precoAntigo: oferta.precoAntigo || "",
          descontoPercentual: radar.descontoPercentual,
          economiaValor: economia.economiaValor,
          economiaPercentual: economia.economiaPercentual,
          cupom: cupomRadar.cupom,
          avisoCupom: cupomRadar.avisoCupom,
          tipoCupom: cupomRadar.tipoCupom,
          valorCupom: cupomRadar.valorCupom,
          percentualCupom: cupomRadar.percentualCupom,
          descontoPix: cupomRadar.descontoPix,
          descontoApp: cupomRadar.descontoApp,
          beneficioExtra: cupomRadar.beneficioExtra,
          cupomConfirmado: cupomRadar.cupomConfirmado,
          possivelCupom: cupomRadar.possivelCupom,
          linkOriginal: oferta.linkOriginal || "",
          link: oferta.link || "",
          linkAfiliado: oferta.linkAfiliado || "",
          statusRadar: oferta.statusRadar || (oferta.radarNaFila || oferta.status === "pendente" ? "fila" : normalizarStatusOperacionalRadar(oferta.status || "")),
          motivo: oferta.motivo || oferta.statusDetalhe || "",
          radarScore: radar.radarScore,
          radarNivel: radar.nivel,
          radarDecisao: radar.decisao,
          radar: {
            radarScore: radar.radarScore,
            nivel: radar.nivel,
            motivos: radar.motivos,
            alertas: radar.alertas,
            decisao: radar.decisao
          },
          origemClienteId: oferta.origemClienteId || oferta.clienteId || "admin",
          origemGrupoId: origem.origemGrupoId,
          origemGrupoNome: origem.origemGrupoNome,
          origemSessaoId: origem.origemSessaoId,
          origemTipo: origem.origemTipo,
          coletadoDe: origem.origemGrupoNome || origem.origemGrupoId,
          statusFila: oferta.status || ""
        };
      })
      .sort((a, b) => (b.radar.radarScore || 0) - (a.radar.radarScore || 0)));
    const oportunidadesPaginadas = aplicarLimiteLista(oportunidades, req.query, 50, 200);

    return res.json({
      ok: true,
      total: oportunidades.length,
      clienteId,
      limit: oportunidadesPaginadas.limit,
      offset: oportunidadesPaginadas.offset,
      hasMore: oportunidadesPaginadas.hasMore,
      oportunidades: oportunidadesPaginadas.itens,
      historicoOperacional,
      ultimasOfertasProcessadas: historicoOperacional,
      capturas: historicoOperacional,
      gruposPreview: resumoHistoricoRadar.grupos,
      diagnosticoRadar: resumoHistoricoRadar.diagnostico || resumoHistoricoRadar.contadoresDiagnostico || {}
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.delete("/radar/oportunidades", (req, res) => {
  try {
    if (req.usuario?.papel !== "admin_master") {
      return res.status(403).json({
        ok: false,
        erro: "Acesso restrito ao admin_master"
      });
    }

    const clienteId = String(req.query?.clienteId || getClienteId(req) || "admin");
    const radarConfig = carregarRadarConfigCliente(clienteId);
    const descartesRadar = lerDescartesRadar(clienteId);
    const idsSolicitados = Array.isArray(req.body?.ids)
      ? req.body.ids.map(String).filter(Boolean)
      : [];
    const limparTodas = req.body?.todas !== false;
    const idsSet = new Set(idsSolicitados);

    const oportunidades = lerFilasRadarSomenteLeitura()
      .filter((oferta) => String(oferta.origemClienteId || oferta.clienteId || "admin") === clienteId)
      .filter((oferta) => !ofertaOcultadaRadar(oferta, descartesRadar))
      .filter((oferta) => origemOfertaEstaMonitoradaRadar(oferta, radarConfig).ok)
      .filter((oferta) => limparTodas || idsSet.has(String(oferta.id || "")));

    const removidas = registrarDescartesOportunidadesRadar(clienteId, oportunidades);
    sincronizarTratadasRadarDeOfertas(clienteId, oportunidades.map(oferta => ({
      ...oferta,
      statusRadar: oferta.statusRadar || "descartado"
    })));

    return res.json({
      ok: true,
      clienteId,
      removidas
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.delete("/radar/oportunidades/:id", (req, res) => {
  try {
    if (req.usuario?.papel !== "admin_master") {
      return res.status(403).json({
        ok: false,
        erro: "Acesso restrito ao admin_master"
      });
    }

    const clienteId = String(req.query?.clienteId || getClienteId(req) || "admin");
    const radarConfig = carregarRadarConfigCliente(clienteId);
    const descartesRadar = lerDescartesRadar(clienteId);
    const id = String(req.params.id || "");
    const oportunidades = lerFilasRadarSomenteLeitura()
      .filter((oferta) => String(oferta.origemClienteId || oferta.clienteId || "admin") === clienteId)
      .filter((oferta) => !ofertaOcultadaRadar(oferta, descartesRadar))
      .filter((oferta) => origemOfertaEstaMonitoradaRadar(oferta, radarConfig).ok)
      .filter((oferta) => String(oferta.id || "") === id);

    const removidas = registrarDescartesOportunidadesRadar(clienteId, oportunidades.length ? oportunidades : [{ id }]);
    sincronizarTratadasRadarDeOfertas(clienteId, oportunidades.map(oferta => ({
      ...oferta,
      statusRadar: oferta.statusRadar || "descartado"
    })));

    return res.json({
      ok: true,
      clienteId,
      removidas
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.delete("/radar/preview", (req, res) => {
  try {
    if (req.usuario?.papel !== "admin_master") {
      return res.status(403).json({
        ok: false,
        erro: "Acesso restrito ao admin_master"
      });
    }

    const clienteId = getClienteId(req);

    if (!clienteId) {
      return res.status(401).json({
        ok: false,
        erro: "Cliente nao autenticado"
      });
    }

    const previewAtual = lerPreviewRadar(clienteId);
    const historicoAtual = lerHistoricoRadar(clienteId);
    const removidosPreview = previewAtual.length;
    const removidosHistorico = historicoAtual.length;

    for (const evento of [...previewAtual, ...historicoAtual]) {
      const status = normalizarTexto(evento.statusRadar || evento.status || "");
      if (["fila", "adicionado_fila", "adicionada_fila", "enviado", "ignorado", "ignorada", "erro", "descartado"].includes(status)) {
        registrarTratamentoRadar(clienteId, evento, status === "adicionado_fila" || status === "adicionada_fila" ? "fila" : status);
      }
    }

    salvarPreviewRadar(clienteId, []);
    salvarHistoricoRadar(clienteId, []);

    return res.json({
      ok: true,
      clienteId,
      removidosPreview,
      removidosHistorico
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.post("/radar/adicionar-fila", async (req, res) => {
  try {
    if (req.usuario?.papel !== "admin_master") {
      return res.status(403).json({
        ok: false,
        motivo: "acesso_restrito_admin_master"
      });
    }

    const clienteId = String(req.body?.clienteId || "admin");
    const oferta = req.body?.oferta || {};

    const resultado = await adicionarRadarNaFilaCliente(oferta, clienteId);

    if (!resultado.ok) {
      return res.json({
        ok: false,
        motivo: resultado.motivo
      });
    }

    return res.json({
      ok: true,
      adicionada: true,
      oferta: resultado.oferta
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      motivo: e.message
    });
  }
});

// =============== ROTA DO MENSAGEIRO =================

app.use("/mensageiro", criarRotasMensageiro({
  getClienteId,
  getPlanoUsuario,
  usuarioTemRecurso,
  getMensageiroCliente: mensageiro.getMensageiroCliente,
  setMensageiroCliente: mensageiro.setMensageiroCliente,
  getAtendimentoConfigCliente: mensageiro.getAtendimentoConfigCliente,
  setAtendimentoConfigCliente: mensageiro.setAtendimentoConfigCliente,
  encontrarGatilhoAtendimento: mensageiro.encontrarGatilhoAtendimento
}));

// =============== ROTA DO SOCIAL MODULE =================

app.use("/social", criarRotasSocial({
  getClienteId,
  getPlanoUsuario,
  usuarioTemRecurso
}));

// =============== ROTA DE TEMPLATES DE OFERTAS =================

app.use("/templates-ofertas", criarRotasTemplatesClientes({
  getClienteId,
  usuarioTemRecurso
}));


// ================= LOGIN ==========================

const AUTH_DEBUG_VERSION = "auth-multiusuario-2026-06-27-v2";

function pareceHashBcrypt(valor = "") {
  return /^\$2[aby]\$\d{2}\$/.test(String(valor || ""));
}

async function diagnosticarSenhaUsuario(usuario = {}, senhaInformada = "") {
  const senha = String(senhaInformada || "");
  const camposTexto = [
    ["senha", usuario.senha],
    ["password", usuario.password],
    ["pass", usuario.pass]
  ].map(([campo, valor]) => [campo, String(valor || "")]);
  const camposHash = [
    ["senhaHash", usuario.senhaHash],
    ["passwordHash", usuario.passwordHash],
    ["hash", usuario.hash],
    ["senha", usuario.senha],
    ["password", usuario.password]
  ].map(([campo, valor]) => [campo, String(valor || "")]);
  const diagnostico = {
    ok: false,
    camposPresentes: {
      senha: !!usuario.senha,
      password: !!usuario.password,
      pass: !!usuario.pass,
      senhaHash: !!usuario.senhaHash,
      passwordHash: !!usuario.passwordHash,
      hash: !!usuario.hash
    },
    tiposCampos: {
      senha: usuario.senha ? (pareceHashBcrypt(usuario.senha) ? "bcrypt" : "texto") : "ausente",
      password: usuario.password ? (pareceHashBcrypt(usuario.password) ? "bcrypt" : "texto") : "ausente",
      pass: usuario.pass ? "texto" : "ausente",
      senhaHash: usuario.senhaHash ? (pareceHashBcrypt(usuario.senhaHash) ? "bcrypt" : "nao_bcrypt") : "ausente",
      passwordHash: usuario.passwordHash ? (pareceHashBcrypt(usuario.passwordHash) ? "bcrypt" : "nao_bcrypt") : "ausente",
      hash: usuario.hash ? (pareceHashBcrypt(usuario.hash) ? "bcrypt" : "nao_bcrypt") : "ausente"
    },
    textoPuroPassou: false,
    campoTextoUsado: "",
    bcryptTentou: false,
    bcryptPassou: false,
    camposBcryptTentados: [],
    motivoFalha: ""
  };

  for (const [campo, valor] of camposTexto) {
    if (!valor) continue;
    if (valor === senha) {
      diagnostico.ok = true;
      diagnostico.textoPuroPassou = true;
      diagnostico.campoTextoUsado = campo;
      return diagnostico;
    }
  }

  for (const [campo, hash] of camposHash) {
    if (!pareceHashBcrypt(hash)) continue;
    diagnostico.bcryptTentou = true;
    diagnostico.camposBcryptTentados.push(campo);

    try {
      if (await bcrypt.compare(senha, hash)) {
        diagnostico.ok = true;
        diagnostico.bcryptPassou = true;
        return diagnostico;
      }
    } catch (e) {
      console.log("[AUTH] Falha ao comparar bcrypt:", e.message);
    }
  }

  diagnostico.motivoFalha = diagnostico.bcryptTentou
    ? "texto_puro_nao_bateu_e_bcrypt_nao_bateu"
    : "texto_puro_nao_bateu_e_nenhum_hash_bcrypt_valido";

  return diagnostico;
}

async function verificarSenhaUsuario(usuario = {}, senhaInformada = "") {
  const diagnostico = await diagnosticarSenhaUsuario(usuario, senhaInformada);
  return diagnostico.ok === true;
}

app.post("/login", async (req, res) => {
  const { user, pass } = req.body || {};

  const login = String(user || "").trim().toLowerCase();

  const usuario = usuarios.find(u =>
    String(u.email || "").toLowerCase() === login ||
    String(u.id || "").toLowerCase() === login
  );

  if (!usuario) {
    console.log("[AUTH-LOGIN]", {
      versao: AUTH_DEBUG_VERSION,
      usuarioInformado: login,
      usuarioEncontrado: false,
      totalUsuariosCarregados: Array.isArray(usuarios) ? usuarios.length : 0,
      idsCarregados: Array.isArray(usuarios) ? usuarios.map(u => u?.id).filter(Boolean).slice(0, 20) : []
    });
    return res.status(401).json({ erro: "Usuário inválido" });
  }

  if (usuario.ativo === false) {
    console.log("[AUTH-LOGIN]", {
      versao: AUTH_DEBUG_VERSION,
      usuarioInformado: login,
      usuarioEncontrado: true,
      usuarioId: usuario.id || "",
      ativo: false,
      motivoFalha: "usuario_inativo"
    });
    return res.status(403).json({ erro: "Usuário inativo" });
  }

 const diagnosticoSenha = await diagnosticarSenhaUsuario(usuario, pass);
 const senhaOk = diagnosticoSenha.ok === true;

 console.log("[AUTH-LOGIN]", {
   versao: AUTH_DEBUG_VERSION,
   usuarioInformado: login,
   usuarioEncontrado: true,
   usuarioId: usuario.id || "",
   email: usuario.email || "",
   papel: usuario.papel || "",
   ativo: usuario.ativo !== false,
   camposPresentes: diagnosticoSenha.camposPresentes,
   tiposCampos: diagnosticoSenha.tiposCampos,
   textoPuroPassou: diagnosticoSenha.textoPuroPassou,
   campoTextoUsado: diagnosticoSenha.campoTextoUsado,
   bcryptTentou: diagnosticoSenha.bcryptTentou,
   bcryptPassou: diagnosticoSenha.bcryptPassou,
   camposBcryptTentados: diagnosticoSenha.camposBcryptTentados,
   motivoFalha: diagnosticoSenha.motivoFalha || ""
 });

if (!senhaOk) {
  return res.status(401).json({ erro: "Senha inválida" });
}

  const token = jwt.sign(
    {
      clienteId: usuario.id,
      papel: usuario.papel || "cliente",
      plano: usuario.plano || "free"
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  return res.json({
    ok: true,
    token,
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      papel: usuario.papel,
      plano: usuario.plano,
      creditos: usuario.creditos,
      ativo: usuario.ativo
    }
  });
});

app.get("/", (req, res) => {
  res.json({
    status: "API ONLINE",
    uptime: process.uptime()
  });
});

app.get("/debug-usuarios", (req, res) => {
  res.json(usuarios);
});

app.post("/desconectar/:id", async (req, res) => {
  try {
    const clienteId = getClienteId(req);

  const id = normalizarSessaoId(
  clienteId,
  req.params.id
  );

    if (sessoes[id]) {
      try {
        await sessoes[id]?.logout?.();
      } catch (e) {
        console.log("[ERRO] erro logout:", e.message);
      }

      try {
        sessoes[id]?.end?.();
      } catch (e) {
        console.log("[ERRO] erro end:", e.message);
      }
    }

    delete sessoes[id];

    if (typeof qrCodes !== "undefined") {
      delete qrCodes[id];
    }

    if (typeof statusSessao !== "undefined") {
      delete statusSessao[id];
    }

    res.json({
      ok: true,
      message: "WhatsApp desconectado.",
      id
    });

  } catch (e) {
    res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.post("/limpar-sessao/:id", async (req, res) => {
  try {
    const clienteId = getClienteId(req);

    const id = normalizarSessaoId(
    clienteId,
    req.params.id
    );

    if (sessoes[id]) {
      try {
        await sessoes[id]?.logout?.();
      } catch (e) {
        console.log("[ERRO] erro logout ao limpar:", e.message);
      }

      try {
        sessoes[id]?.end?.();
      } catch (e) {
        console.log("[ERRO] erro end ao limpar:", e.message);
      }
    }

    delete sessoes[id];

    if (typeof qrCodes !== "undefined") {
      delete qrCodes[id];
    }

    if (typeof statusSessao !== "undefined") {
      delete statusSessao[id];
    }

    if (typeof destinosPorSessao !== "undefined") {
      delete destinosPorSessao[id];
    }

    const pastaAuth = `/data/auth_${id}`;

    if (fs.existsSync(pastaAuth)) {
      fs.rmSync(pastaAuth, {
        recursive: true,
        force: true
      });

      console.log("[WHATSAPP] Sesso limpa:", pastaAuth);
    }

    return res.json({
      ok: true,
      message: "Sessão limpa. Gere um novo QR Code.",
      id
    });

  } catch (e) {
    console.log("[ERRO] [WHATSAPP] erro limpar sesso:", e.message);

    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

// ================= ME ==========================

app.get("/me", (req, res) => {
  const clienteId = getClienteId(req);

  const usuario = usuarios.find(
    u => String(u.id) === String(clienteId)
  );

  if (!usuario) {
    return res.status(404).json({
      ok: false,
      erro: "Usuário não encontrado"
    });
  }

  renovarCreditosSeNecessario(usuario);

  const sessoesUsuario = Object.values(sessoesMeta || {}).filter(s =>
    String(s.id || "").startsWith(clienteId + "_") ||
    (clienteId === "admin" && !String(s.id || "").includes("_"))
  );

  const destinosUsuario =
    destinosPorCliente?.[clienteId] || {};

  const filaUsuario = fila.filter(o =>
    String(o.clienteId || "admin") === String(clienteId)
  );

  const hoje = new Date().toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });

  const enviosHoje = filaUsuario.filter(o =>
    String(o.enviadoEm || "").startsWith(hoje)
  ).length;

 const planoAtual = getPlanoUsuario(req) || {};

return res.json({
  ok: true,
  usuario: {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    plano: usuario.plano,
    creditos: usuario.creditos,
    papel: usuario.papel,
    ativo: usuario.ativo,
    marketplacesLiberados: planoAtual.marketplaces || [],
    recursos: planoAtual.recursos || {},
    limites: planoAtual.limites || {}
  },
  marketplacesLiberados: planoAtual.marketplaces || [],

    consumo: {
      enviosHoje,
      sessoes: sessoesUsuario.length,
      destinos: Object.keys(destinosUsuario).length,
      ofertasNaFila: filaUsuario.filter(o => o.status === "pendente").length,
      ofertasEnviadas: filaUsuario.filter(o => o.status === "enviado").length
    },
    status: {
      automacaoAtiva: configsPorCliente?.[clienteId]?.automacaoAtiva === true
    }
  });
});

// ================= INTEGRAÇÕES =================

const marketplaceRules = integracoesUtils.marketplaceRules;

const MENSAGEM_TESTE_OK = "Teste real OK. Link de teste convertido com sucesso.";
const MENSAGEM_NAO_CONFIGURADO_ML = "Preencha Tag ID e Cookies para testar.";
const MENSAGEM_NAO_CONFIGURADO_AMAZON = "Preencha tag e cookies da Amazon para testar.";
const MENSAGEM_COOKIES_INVALIDOS = "Não conseguimos converter um link de teste. Atualize os cookies e teste novamente.";
const MENSAGEM_FALHA_CONVERSAO_ML = "Não conseguimos validar a integração agora. Atualize os cookies e teste novamente.";
const MENSAGEM_FALHA_CONVERSAO_AMAZON = "Não conseguimos validar a integração da Amazon agora. Atualize os cookies e teste novamente.";
const MENSAGEM_TESTE_PENDENTE = "Credenciais salvas, teste real pendente.";
const MENSAGEM_ALERTA_ML = MENSAGEM_COOKIES_INVALIDOS;
const MENSAGEM_ALERTA_AMAZON = MENSAGEM_FALHA_CONVERSAO_AMAZON;

const {
  listarAlertasIntegracoes,
  registrarAlertaIntegracao,
  limparAlertaIntegracao
} = alertasIntegracoes;

function extrairTagMercadoLivreIntegracao(config = {}) {
  const credenciais = config?.credenciais || config || {};
  return String(
    credenciais.tag ||
    credenciais.codigoAfiliado ||
    credenciais.tagId ||
    credenciais.tagID ||
    credenciais.tag_id ||
    credenciais.trackingId ||
    credenciais.partnerTag ||
    credenciais.affiliateTag ||
    ""
  ).trim();
}

function credenciaisMercadoLivreValidas(credenciais = {}) {
  return !!(
    String(credenciais.cookies || "").trim() &&
    extrairTagMercadoLivreIntegracao(credenciais)
  );
}

function credenciaisAmazonValidas(config = {}) {
  const credenciais = config?.credenciais || {};
  const modo = String(config?.modo || credenciais.modo || "").toLowerCase();
  const tag = String(
    credenciais.trackingId ||
    credenciais.partnerTag ||
    credenciais.tag ||
    credenciais.affiliateTag ||
    credenciais.appId ||
    ""
  ).trim();

  if (modo === "api") {
    return !!(
      String(credenciais.appId || "").trim() &&
      String(credenciais.accessKey || "").trim() &&
      String(credenciais.secretKey || "").trim()
    );
  }

  if (modo === "cookies") {
    return !!(String(credenciais.cookies || "").trim() && tag);
  }

  return !!(
    tag ||
    (
      String(credenciais.appId || "").trim() &&
      String(credenciais.accessKey || "").trim() &&
      String(credenciais.secretKey || "").trim()
    )
  );
}

function registrarAlertaMercadoLivre(clienteId = "admin", tipo = "configuracao_incompleta", detalhes = {}) {
  const tipoNormalizado = String(tipo || "").toLowerCase();
  return registrarAlertaIntegracao(clienteId, "mercadolivre", {
    tipo: tipoNormalizado === "tag_invalida" ? "falha_conversao" : tipo,
    status: "atencao",
    mensagem: tipoNormalizado === "falha_conversao" || tipoNormalizado === "tag_invalida"
      ? MENSAGEM_FALHA_CONVERSAO_ML
      : MENSAGEM_COOKIES_INVALIDOS,
    detalhes
  });
}
function registrarAlertaAmazon(clienteId = "admin", tipo = "configuracao_incompleta", detalhes = {}) {
  const tipoNormalizado = String(tipo || "").toLowerCase();
  return registrarAlertaIntegracao(clienteId, "amazon", {
    tipo,
    status: "atencao",
    mensagem: tipoNormalizado === "cookie_invalido" || tipoNormalizado === "cookies_invalidos"
      ? MENSAGEM_COOKIES_INVALIDOS
      : MENSAGEM_FALHA_CONVERSAO_AMAZON,
    detalhes
  });
}
function salvarResultadoTesteIntegracao(clienteId = "admin", marketplace = "", resultado = {}) {
  const mp = String(marketplace || "").toLowerCase();
  if (!mp) return null;

  integracoesPorCliente[clienteId] = integracoesPorCliente[clienteId] || {};
  const atual = integracoesPorCliente[clienteId][mp] || { marketplace: mp, credenciais: {} };

  integracoesPorCliente[clienteId][mp] = {
    ...atual,
    ultimoTesteEm: new Date().toISOString(),
    ultimoStatus: resultado.status || "erro",
    ultimaMensagem: resultado.mensagem || ""
  };

  salvarIntegracoesPersistidas();
  return integracoesPorCliente[clienteId][mp];
}

function extrairTagAmazonIntegracao(config = {}) {
  const credenciais = config?.credenciais || {};
  return String(
    credenciais.trackingId ||
    credenciais.partnerTag ||
    credenciais.tag ||
    credenciais.affiliateTag ||
    credenciais.appId ||
    ""
  ).trim();
}

function credenciaisAmazonTesteValidas(config = {}) {
  const credenciais = config?.credenciais || {};
  const modo = String(config?.modo || credenciais.modo || "").toLowerCase();
  const tag = extrairTagAmazonIntegracao(config);
  const cookies = String(credenciais.cookies || "").trim();
  const temApi = !!(
    String(credenciais.appId || "").trim() &&
    String(credenciais.accessKey || "").trim() &&
    String(credenciais.secretKey || "").trim()
  );

  if (modo === "api") return temApi;
  if (modo === "cookies" || cookies) return !!(tag && cookies);

  return !!(tag && cookies) || temApi;
}
function normalizarStatusSalvoIntegracao(marketplace = "", status = "") {
  const mp = String(marketplace || "").toLowerCase();
  const valor = String(status || "").toLowerCase();

  if (mp === "mercadolivre" && valor === "tag_invalida") return "falha_conversao";
  if (mp === "amazon" && ["configuracao_invalida", "tag_invalida", "falha_geracao_link"].includes(valor)) return "falha_conversao";

  if (["ok", "teste_pendente", "nao_configurado", "cookies_invalidos", "falha_conversao"].includes(valor)) return valor;

  return valor || "teste_pendente";
}

function normalizarMensagemStatusIntegracao(marketplace = "", status = "", mensagem = "") {
  const mp = String(marketplace || "").toLowerCase();
  const statusNormalizado = normalizarStatusSalvoIntegracao(mp, status);

  if (statusNormalizado === "ok") return MENSAGEM_TESTE_OK;
  if (statusNormalizado === "teste_pendente") return MENSAGEM_TESTE_PENDENTE;
  if (statusNormalizado === "cookies_invalidos") return MENSAGEM_COOKIES_INVALIDOS;
  if (statusNormalizado === "nao_configurado") return mp === "mercadolivre"
    ? MENSAGEM_NAO_CONFIGURADO_ML
    : MENSAGEM_NAO_CONFIGURADO_AMAZON;
  if (statusNormalizado === "falha_conversao") return mp === "amazon"
    ? MENSAGEM_FALHA_CONVERSAO_AMAZON
    : MENSAGEM_FALHA_CONVERSAO_ML;

  return mensagem || MENSAGEM_TESTE_PENDENTE;
}
function statusResumoIntegracao(clienteId = "admin", marketplace = "") {
  const mp = String(marketplace || "").toLowerCase();
  const config = integracoesPorCliente?.[clienteId]?.[mp] || null;
  const credenciais = config?.credenciais || {};
  const ultimoStatus = String(config?.ultimoStatus || "").toLowerCase();

  const temCredenciais = mp === "mercadolivre"
    ? credenciaisMercadoLivreValidas(credenciais)
    : mp === "amazon"
      ? credenciaisAmazonTesteValidas(config || {})
      : Object.values(credenciais).some(v => String(v || "").trim());

  if (!config || !temCredenciais) {
    return {
      marketplace: mp,
      status: "nao_configurado",
      ultimoTesteEm: config?.ultimoTesteEm || null,
      ultimaMensagem: mp === "mercadolivre"
        ? MENSAGEM_NAO_CONFIGURADO_ML
        : MENSAGEM_NAO_CONFIGURADO_AMAZON,
      testado: Boolean(config?.ultimoTesteEm)
    };
  }

  if (!config.ultimoTesteEm) {
    return {
      marketplace: mp,
      status: "teste_pendente",
      ultimoTesteEm: null,
      ultimaMensagem: MENSAGEM_TESTE_PENDENTE,
      testado: false
    };
  }

  if (ultimoStatus) {
    let statusNormalizado = normalizarStatusSalvoIntegracao(mp, ultimoStatus);

    if (temCredenciais && statusNormalizado === "nao_configurado") {
      const mensagemAnterior = String(config.ultimaMensagem || "").toLowerCase();
      statusNormalizado = mensagemAnterior.includes("convers") || mensagemAnterior.includes("validar")
        ? "falha_conversao"
        : "teste_pendente";
    }

    const mensagemNormalizada = normalizarMensagemStatusIntegracao(mp, statusNormalizado, config.ultimaMensagem || "");

    return {
      marketplace: mp,
      status: statusNormalizado,
      ultimoTesteEm: config.ultimoTesteEm,
      ultimaMensagem: mensagemNormalizada,
      testado: statusNormalizado !== "teste_pendente"
    };
  }

  return {
    marketplace: mp,
    status: "teste_pendente",
    ultimoTesteEm: config.ultimoTesteEm,
    ultimaMensagem: MENSAGEM_TESTE_PENDENTE,
    testado: false
  };
}
function extrairCsrfMercadoLivreHtml(html = "") {
  const patterns = [
    /x-csrf-token["']?\s*[:=]\s*["']([^"']+)["']/i,
    /csrfToken["']?\s*[:=]\s*["']([^"']+)["']/i,
    /csrf-token["']?\s*content=["']([^"']+)["']/i,
    /_csrf["']?\s*[:=]\s*["']([^"']+)["']/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }

  return "";
}

function respostaTesteMercadoLivre(status, mensagem, tipo = status, detalhes = {}) {
  return {
    ok: status === "ok" || status === "afiliado_ok",
    status,
    tipo,
    mensagem,
    detalhes
  };
}

async function testarMercadoLivreCookies(clienteId = "admin", config = {}) {
  const credenciais = config?.credenciais || {};
  const cookies = String(credenciais.cookies || "").trim();
  const tag = extrairTagMercadoLivreIntegracao(credenciais);
  const urlTeste = "https://www.mercadolivre.com.br/ofertas";

  if (!cookies || !tag) {
    return respostaTesteMercadoLivre(
      !cookies ? "cookie_ausente" : "tag_ausente",
      MENSAGEM_NAO_CONFIGURADO_ML,
      !cookies ? "cookie_ausente" : "tag_ausente",
      { faltandoCookies: !cookies, faltandoTag: !tag }
    );
  }

  try {
    const response = await fetch("https://www.mercadolivre.com.br/afiliados/linkbuilder", {
      method: "GET",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Cookie": cookies
      }
    });

    const urlFinal = response.url || "";
    const html = await response.text().catch(() => "");
    const textoFalha = `${urlFinal}\n${html}`.toLowerCase();

    if (
      [401, 403, 419].includes(Number(response.status)) ||
      textoFalha.includes("account-verification") ||
      textoFalha.includes("suspicious-traffic")
    ) {
      const bloqueioMl = textoFalha.includes("suspicious-traffic");
      return respostaTesteMercadoLivre(
        bloqueioMl ? "bloqueio_ml" : "cookie_expirado",
        MENSAGEM_COOKIES_INVALIDOS,
        bloqueioMl ? "bloqueio_ml" : "cookie_expirado",
        { httpStatus: response.status, urlFinal }
      );
    }

    if (!response.ok) {
      return respostaTesteMercadoLivre(
        "cookie_expirado",
        MENSAGEM_COOKIES_INVALIDOS,
        "cookie_expirado",
        { httpStatus: response.status, urlFinal }
      );
    }

    const csrfToken = extrairCsrfMercadoLivreHtml(html);

    if (!csrfToken) {
      return respostaTesteMercadoLivre(
        "cookie_expirado",
        MENSAGEM_COOKIES_INVALIDOS,
        "cookie_expirado",
        { motivo: "csrf_nao_encontrado", httpStatus: response.status, urlFinal }
      );
    }

    const conversao = await fetch(
      "https://www.mercadolivre.com.br/affiliate-program/api/v2/stripe/user/links",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/plain, */*",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Origin": "https://www.mercadolivre.com.br",
          "Referer": "https://www.mercadolivre.com.br/afiliados/linkbuilder",
          "Cookie": cookies,
          "x-csrf-token": csrfToken
        },
        body: JSON.stringify({
          url: urlTeste,
          tag
        })
      }
    );

    const data = await conversao.json().catch(() => null);
    const linkAfiliado = String(data?.short_url || data?.shortUrl || data?.url || "").trim();

    if ([401, 403, 419].includes(Number(conversao.status))) {
      return respostaTesteMercadoLivre(
        "cookie_expirado",
        MENSAGEM_COOKIES_INVALIDOS,
        "cookie_expirado",
        { httpStatus: conversao.status }
      );
    }

    if (!conversao.ok || !/^https?:\/\/meli\.la\//i.test(linkAfiliado)) {
      return respostaTesteMercadoLivre(
        "falha_conversao",
        MENSAGEM_FALHA_CONVERSAO_ML,
        "falha_conversao",
        { httpStatus: conversao.status, linkAfiliado }
      );
    }

    return respostaTesteMercadoLivre(
      "afiliado_ok",
      MENSAGEM_TESTE_OK,
      "afiliado_ok",
      { linkAfiliado }
    );
  } catch (e) {
    return respostaTesteMercadoLivre(
      "falha_conversao",
      MENSAGEM_FALHA_CONVERSAO_ML,
      "erro_teste",
      { erro: e.message }
    );
  }
}

function respostaTesteAmazon(status, mensagem, tipo = status, detalhes = {}) {
  return {
    ok: status === "ok",
    status,
    tipo,
    mensagem,
    detalhes
  };
}

async function testarAmazonConfiguracao(config = {}) {
  const credenciais = config?.credenciais || {};
  const modo = String(config?.modo || credenciais.modo || "cookies").toLowerCase();
  const tag = extrairTagAmazonIntegracao(config);
  const cookies = String(credenciais.cookies || "").trim();

  if (modo === "api") {
    if (!credenciaisAmazonValidas(config || {})) {
      return respostaTesteAmazon(
        "nao_configurado",
        "Preencha as credenciais da API Amazon para testar.",
        "configuracao_invalida",
        { modo, camposPresentes: Object.keys(credenciais) }
      );
    }

    return respostaTesteAmazon(
      "teste_nao_implementado",
      MENSAGEM_TESTE_PENDENTE,
      "teste_nao_implementado",
      { modo, observacao: "Teste real automático preservado apenas para modo cookies." }
    );
  }

  if (!tag || !cookies) {
    return respostaTesteAmazon(
      "nao_configurado",
      MENSAGEM_NAO_CONFIGURADO_AMAZON,
      "configuracao_invalida",
      { modo, faltandoTag: !tag, faltandoCookies: !cookies, camposPresentes: Object.keys(credenciais) }
    );
  }

  try {
    const url = new URL("https://www.amazon.com.br/s?k=ofertas");
    url.searchParams.set("tag", tag);
    const linkAfiliado = url.toString();

    const response = await fetch(linkAfiliado, {
      method: "GET",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Cookie": cookies
      }
    });

    const urlFinal = response.url || "";
    const html = await response.text().catch(() => "");
    const textoFalha = `${urlFinal}\n${html}`.toLowerCase();

    if ([401, 403, 419, 429, 503].includes(Number(response.status)) ||
      textoFalha.includes("captcha") ||
      textoFalha.includes("robot check") ||
      textoFalha.includes("automated access") ||
      textoFalha.includes("digite os caracteres")) {
      return respostaTesteAmazon(
        "cookies_invalidos",
        MENSAGEM_COOKIES_INVALIDOS,
        "cookie_invalido",
        { modo, httpStatus: response.status, urlFinal }
      );
    }

    if (!response.ok) {
      return respostaTesteAmazon(
        "falha_conversao",
        MENSAGEM_FALHA_CONVERSAO_AMAZON,
        "falha_conversao",
        { modo, httpStatus: response.status, urlFinal }
      );
    }

    if (!linkAfiliado.includes(`tag=${encodeURIComponent(tag)}`) && !linkAfiliado.includes(`tag=${tag}`)) {
      return respostaTesteAmazon(
        "falha_conversao",
        MENSAGEM_FALHA_CONVERSAO_AMAZON,
        "falha_conversao",
        { modo, linkAfiliado }
      );
    }

    return respostaTesteAmazon(
      "ok",
      MENSAGEM_TESTE_OK,
      "teste_ok",
      { modo, linkAfiliado, httpStatus: response.status }
    );
  } catch (e) {
    return respostaTesteAmazon(
      "falha_conversao",
      MENSAGEM_FALHA_CONVERSAO_AMAZON,
      "erro_teste",
      { modo, erro: e.message }
    );
  }
}

function logTesteIntegracao(tag, dados = {}) {
  console.log(tag, JSON.stringify(dados));
}

function montarResultadoTesteIntegracao(marketplace, status, mensagem, tipo = status, detalhes = {}, ok = null) {
  return {
    ok: ok === null ? status === "ok" || status === "afiliado_ok" : ok === true,
    marketplace,
    status,
    mensagem,
    detalhes: detalhes || {},
    tipo,
    testadoEm: new Date().toISOString()
  };
}

function credenciaisShopeeTeste(credenciais = {}) {
  return {
    appId: String(credenciais.appId || credenciais.app_id || "").trim(),
    secret: String(credenciais.secret || credenciais.appSecret || credenciais.app_secret || "").trim()
  };
}

async function testarShopeeIntegracao(config = {}) {
  const credenciais = credenciaisShopeeTeste(config?.credenciais || {});
  const marketplace = "shopee";

  if (!credenciais.appId || !credenciais.secret) {
    return montarResultadoTesteIntegracao(
      marketplace,
      "credencial_ausente",
      "Preencha appId e secret da Shopee para testar.",
      "credencial_ausente",
      { faltandoAppId: !credenciais.appId, faltandoSecret: !credenciais.secret },
      false
    );
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const bodyPayload = {
      query: `
        query {
          productOfferV2(keyword: "oferta", page: 1, limit: 1) {
            nodes {
              itemId
              productName
              offerLink
            }
          }
        }
      `
    };
    const payload = JSON.stringify(bodyPayload);
    const baseString = `${credenciais.appId}${timestamp}${payload}${credenciais.secret}`;
    const sign = crypto
      .createHash("sha256")
      .update(baseString, "utf8")
      .digest("hex");

    const response = await fetch("https://open-api.affiliate.shopee.com.br/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `SHA256 Credential=${credenciais.appId}, Timestamp=${timestamp}, Signature=${sign}`
      },
      body: payload
    });

    const data = await response.json().catch(() => null);

    if ([401, 403].includes(Number(response.status)) || data?.errors?.length) {
      return montarResultadoTesteIntegracao(
        marketplace,
        "credencial_invalida",
        "Credenciais Shopee invalidas ou recusadas pela API.",
        "credencial_invalida",
        { httpStatus: response.status, errors: data?.errors || [] },
        false
      );
    }

    if (!response.ok) {
      return montarResultadoTesteIntegracao(
        marketplace,
        "falha_api",
        "Falha ao consultar a API da Shopee.",
        "falha_api",
        { httpStatus: response.status, resposta: data },
        false
      );
    }

    return montarResultadoTesteIntegracao(
      marketplace,
      "ok",
      "Shopee conectada com sucesso.",
      "teste_ok",
      {
        httpStatus: response.status,
        itens: data?.data?.productOfferV2?.nodes?.length || 0
      },
      true
    );
  } catch (e) {
    return montarResultadoTesteIntegracao(
      marketplace,
      "falha_api",
      "Erro ao testar a API da Shopee.",
      "erro_teste",
      { erro: e.message },
      false
    );
  }
}

function credenciaisAliExpressTeste(credenciais = {}) {
  return {
    appKey: String(credenciais.appKey || credenciais.app_key || "").trim(),
    secret: String(credenciais.secret || credenciais.appSecret || credenciais.app_secret || "").trim(),
    trackingId: String(credenciais.trackingId || credenciais.tracking_id || "").trim()
  };
}

function testarAliExpressIntegracao(config = {}) {
  const credenciais = credenciaisAliExpressTeste(config?.credenciais || {});
  const faltando = [];
  if (!credenciais.appKey) faltando.push("appKey");
  if (!credenciais.secret) faltando.push("secret");
  if (!credenciais.trackingId) faltando.push("trackingId");

  if (faltando.length) {
    return montarResultadoTesteIntegracao(
      "aliexpress",
      "credencial_ausente",
      "Preencha appKey, secret e trackingId da AliExpress para testar.",
      "credencial_ausente",
      { faltando },
      false
    );
  }

  return montarResultadoTesteIntegracao(
    "aliexpress",
    "teste_nao_implementado",
    "Credenciais AliExpress presentes; teste real leve ainda nao implementado.",
    "teste_nao_implementado",
    { camposPresentes: ["appKey", "secret", "trackingId"] },
    false
  );
}

async function testarAwinOuKabumIntegracao(clienteId = "admin", marketplace = "awin", config = {}) {
  const integracaoAwin = marketplace === "kabum"
    ? getIntegracaoCliente(clienteId, "awin")
    : config;
  const credenciais = normalizarCredenciaisAwin(integracaoAwin?.credenciais || {});
  const faltando = [];
  if (!credenciais.publisherId) faltando.push("publisherId");
  if (!credenciais.apiToken) faltando.push("apiToken");

  if (faltando.length) {
    return montarResultadoTesteIntegracao(
      marketplace,
      "credencial_ausente",
      marketplace === "kabum"
        ? "Preencha publisherId e apiToken da AWIN para testar KaBuM."
        : "Preencha publisherId e apiToken da AWIN para testar.",
      "credencial_ausente",
      { faltando },
      false
    );
  }

  try {
    const url = `https://api.awin.com/publishers/${credenciais.publisherId}/programmes`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${credenciais.apiToken}`
      },
      params: {
        relationship: "joined"
      },
      timeout: 15000
    });

    return montarResultadoTesteIntegracao(
      marketplace,
      "ok",
      marketplace === "kabum"
        ? "AWIN/KaBuM conectada com sucesso."
        : "AWIN conectada com sucesso.",
      "teste_ok",
      { totalProgramas: Array.isArray(response.data) ? response.data.length : 0 },
      true
    );
  } catch (e) {
    return montarResultadoTesteIntegracao(
      marketplace,
      "falha_api",
      marketplace === "kabum"
        ? "Falha ao consultar AWIN para KaBuM."
        : "Falha ao consultar API da AWIN.",
      "falha_api",
      { erro: e.response?.data || e.message },
      false
    );
  }
}

function normalizarResultadoTesteLegado(marketplace, resultado = {}) {
  return {
    ok: resultado.ok === true,
    marketplace,
    status: resultado.status || (resultado.ok ? "ok" : "falha"),
    mensagem: resultado.mensagem || resultado.ultimaMensagem || resultado.message || "",
    detalhes: resultado.detalhes || {},
    tipo: resultado.tipo || resultado.status || "",
    testadoEm: resultado.testadoEm || new Date().toISOString()
  };
}

function aplicarResultadoTesteIntegracao(clienteId = "admin", marketplace = "", resultado = {}) {
  const mp = normalizarMarketplaceIntegracao(marketplace);
  const configAtualizada = salvarResultadoTesteIntegracao(clienteId, mp, {
    status: resultado.status,
    mensagem: resultado.mensagem
  });

  if (resultado.ok) {
    limparAlertaIntegracao(clienteId, mp);
    logTesteIntegracao("[INTEGRACAO-ALERTA-LIMPO]", { clienteId, marketplace: mp });
  } else if (resultado.status !== "teste_nao_implementado") {
    registrarAlertaIntegracao(clienteId, mp, {
      tipo: resultado.tipo || resultado.status,
      status: "atencao",
      mensagem: resultado.mensagem,
      detalhes: resultado.detalhes || {}
    });
    logTesteIntegracao("[INTEGRACAO-ALERTA-REGISTRADO]", {
      clienteId,
      marketplace: mp,
      tipo: resultado.tipo || resultado.status
    });
  }

  return {
    ...resultado,
    message: resultado.mensagem,
    ultimoTesteEm: configAtualizada?.ultimoTesteEm || resultado.testadoEm,
    ultimoStatus: resultado.status,
    ultimaMensagem: resultado.mensagem
  };
}

async function executarTesteIntegracaoMarketplace(clienteId = "admin", marketplace = "", config = null) {
  const mp = normalizarMarketplaceIntegracao(marketplace);
  const integracao = config || getIntegracaoCliente(clienteId, mp);

  logTesteIntegracao("[INTEGRACAO-TESTE-INICIO]", {
    clienteId,
    marketplace: mp,
    temIntegracao: Boolean(integracao)
  });

  if (!integracao && mp !== "kabum") {
    return montarResultadoTesteIntegracao(
      mp,
      "nao_configurado",
      "Integracao nao configurada.",
      "nao_configurado",
      {},
      false
    );
  }

  let resultado;

  if (mp === "mercadolivre") {
    resultado = normalizarResultadoTesteLegado(mp, await testarMercadoLivreCookies(clienteId, integracao));
  } else if (mp === "amazon") {
    resultado = normalizarResultadoTesteLegado(mp, await testarAmazonConfiguracao(integracao));
  } else if (mp === "shopee") {
    resultado = await testarShopeeIntegracao(integracao);
  } else if (mp === "awin" || mp === "kabum") {
    resultado = await testarAwinOuKabumIntegracao(clienteId, mp, integracao);
  } else if (mp === "aliexpress") {
    resultado = testarAliExpressIntegracao(integracao);
  } else {
    resultado = montarResultadoTesteIntegracao(
      mp,
      "marketplace_nao_suportado",
      "Marketplace nao suportado para teste.",
      "marketplace_nao_suportado",
      {},
      false
    );
  }

  const final = aplicarResultadoTesteIntegracao(clienteId, mp, resultado);

  logTesteIntegracao(final.ok ? "[INTEGRACAO-TESTE-OK]" : "[INTEGRACAO-TESTE-FALHA]", {
    clienteId,
    marketplace: mp,
    status: final.status,
    mensagem: final.mensagem,
    testadoEm: final.testadoEm
  });

  return final;
}

function avaliarAlertasConfiguracaoIntegracoes(clienteId = "admin") {
  const integracoes = integracoesPorCliente?.[clienteId] || {};
  const ml = integracoes.mercadolivre;
  const amazon = integracoes.amazon;

  if (ml && ml.ativo !== false && !credenciaisMercadoLivreValidas(ml.credenciais || {})) {
    registrarAlertaMercadoLivre(clienteId, "configuracao_incompleta", {
      camposPresentes: Object.keys(ml.credenciais || {})
    });
  }

  if (amazon && amazon.ativo !== false && !credenciaisAmazonValidas(amazon)) {
    registrarAlertaAmazon(clienteId, "configuracao_incompleta", {
      modo: amazon.modo || amazon.credenciais?.modo || "",
      camposPresentes: Object.keys(amazon.credenciais || {})
    });
  }
}

function limparAlertaIntegracaoSeValida(clienteId = "admin", marketplace = "", config = {}) {
  const mp = String(marketplace || "").toLowerCase();

  if (mp === "mercadolivre" && credenciaisMercadoLivreValidas(config?.credenciais || config || {})) {
    limparAlertaIntegracao(clienteId, "mercadolivre");
  }

  if (mp === "amazon" && credenciaisAmazonValidas(config?.credenciais ? config : { credenciais: config, modo: config?.modo })) {
    limparAlertaIntegracao(clienteId, "amazon");
  }
}

function limparCredencial(config, allowed) {
  return integracoesUtils.limparCredencial(config, allowed);
}

function validarIntegracao(marketplace, body) {
  return integracoesUtils.validarIntegracao(marketplace, body);
}

function mascararIntegracao(config = {}) {
  return integracoesUtils.mascararIntegracao(config);
}

function normalizarCredenciaisAwin(config = {}) {
  return integracoesUtils.normalizarCredenciaisAwin(config);
}

function obterProgramaAwin(credenciais = {}, alvo = "kabum") {
  return integracoesUtils.obterProgramaAwin(credenciais, alvo);
}

function validarAwinKabumManual(clienteId = "admin", urlOriginal = "") {
  const integracao = getIntegracaoCliente(clienteId, "awin");
  const credenciais = normalizarCredenciaisAwin(integracao?.credenciais || {});
  const programaAwin = obterProgramaAwin(credenciais, urlOriginal || "kabum");
  const faltando = [];

  if (!credenciais.publisherId) faltando.push("publisherId");
  if (!credenciais.apiToken) faltando.push("apiToken");
  if (!programaAwin?.advertiserId) faltando.push("advertiserId");

  return {
    ok: faltando.length === 0,
    integracao,
    credenciais,
    programaAwin,
    faltando
  };
}

function obterClienteIdAutenticadoKabumManual(req) {
  if (req.clienteId) {
    return { ok: true, clienteId: req.clienteId, temTokenAuth: true };
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return { ok: false, clienteId: "", temTokenAuth: false };
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const clienteId = decoded.clienteId || "";

    if (!clienteId) {
      return { ok: false, clienteId: "", temTokenAuth: true };
    }

    return { ok: true, clienteId, temTokenAuth: true };
  } catch {
    return { ok: false, clienteId: "", temTokenAuth: true };
  }
}

function logKabumManual(dados = {}) {
  console.log("[KABUM-MANUAL]", {
    clienteId: dados.clienteId || "",
    temTokenAuth: Boolean(dados.temTokenAuth),
    integracaoAwinEncontrada: Boolean(dados.integracaoAwinEncontrada),
    camposFaltando: Array.isArray(dados.camposFaltando) ? dados.camposFaltando : [],
    chamouImportador: Boolean(dados.chamouImportador),
    tituloOk: Boolean(dados.tituloOk),
    precoOk: Boolean(dados.precoOk),
    imagemOk: Boolean(dados.imagemOk),
    deeplinkOk: Boolean(dados.deeplinkOk)
  });
}

//============= ROTA INTEGRACOES =======================================

app.get("/integracoes/alertas", (req, res) => {
  const clienteId = getClienteId(req);

  const status = {
    mercadolivre: statusResumoIntegracao(clienteId, "mercadolivre"),
    amazon: statusResumoIntegracao(clienteId, "amazon")
  };

  const alertas = listarAlertasIntegracoes(clienteId)
    .filter(alerta =>
      status[String(alerta.marketplace || "").toLowerCase()]?.status !== "ok"
    )
    .map(alerta => {
      const marketplace = String(alerta.marketplace || "").toLowerCase();
      const tipo = String(alerta.tipo || alerta.status || "").toLowerCase();

      if (marketplace === "mercadolivre" && tipo === "tag_invalida") {
        return {
          ...alerta,
          tipo: "falha_conversao",
          status: alerta.status || "atencao",
          mensagem: MENSAGEM_FALHA_CONVERSAO_ML
        };
      }

      return alerta;
    });

  return res.json({
    ok: true,
    status,
    alertas
  });
});
app.get("/integracoes", (req, res) => {
  const clienteId = getClienteId(req);
  const data = integracoesPorCliente[clienteId] || {};
  const resposta = {};

  const reveal =
    req.query.reveal === "1" ||
    req.query.reveal === "true";

  for (const [marketplace, config] of Object.entries(data)) {
    const credenciais = marketplace === "awin"
      ? normalizarCredenciaisAwin(config?.credenciais || {})
      : config?.credenciais || {};

    const camposConfigurados = Object.keys(credenciais).filter(k => {
      const valor = credenciais[k];

      return (
        valor !== undefined &&
        valor !== null &&
        String(valor).trim() !== ""
      );
    });

    const configurado = camposConfigurados.length > 0;

    const credenciaisResposta =
      reveal
        ? credenciais
        : mascararIntegracao(credenciais);

    resposta[marketplace] = {
      marketplace,
      nome: marketplaceRules?.[marketplace]?.nome || marketplace,
      configurado,
      status: configurado
        ? (config.status || "conectado")
        : "incompleto",
      camposConfigurados,
      credenciais: credenciaisResposta,
      atualizadoEm: config?.atualizadoEm || null
    };
  }

  return res.json({
    ok: true,
    clienteId,
    reveal,
    integracoes: resposta
  });
});


//============= ROTA POST INTEGRACOES MARTPLACES ====================

app.post("/integracoes/:marketplace", (req, res) => {
  const clienteId = getClienteId(req);
  const marketplace = req.params.marketplace.toLowerCase();

  const plano = getPlanoUsuario(req);

if (!isAdminMaster(req)) {
  const liberados = plano?.marketplaces || [];

  if (!liberados.includes(marketplace)) {
    return res.status(403).json({
      ok: false,
      erro: `Marketplace ${marketplace} não liberado no seu plano`
    });
  }
}

  const payload = req.body?.credenciais || req.body;

  const validacao = validarIntegracao(marketplace, payload);

  if (!validacao.ok) {
    if (marketplace === "mercadolivre") {
      registrarAlertaMercadoLivre(clienteId, "configuracao_incompleta", {
        campos: validacao.campos || []
      });
    }

    if (marketplace === "amazon") {
      registrarAlertaAmazon(clienteId, "configuracao_incompleta", {
        campos: validacao.campos || [],
        modo: payload?.modo || ""
      });
    }

    return res.status(400).json(validacao);
  }

  if (!integracoesPorCliente[clienteId]) {
    integracoesPorCliente[clienteId] = {};
  }

  integracoesPorCliente[clienteId][marketplace] = {
  marketplace,
  nome: marketplaceRules[marketplace]?.nome || marketplace,
  modo: validacao.modo || req.body.modo || null,
  credenciais: validacao.clean || payload,
  status: "configurado",
  atualizadoEm: new Date().toISOString()
};

salvarIntegracoesPersistidas();

limparAlertaIntegracaoSeValida(
  clienteId,
  marketplace,
  integracoesPorCliente[clienteId][marketplace]
);

return res.json({
  ok: true,
  message: `${marketplace} configurado com sucesso`,
  marketplace,
  status: "configurado"
});
});

app.delete("/integracoes/:marketplace", (req, res) => {
  try {
    const clienteId = getClienteId(req);
    const marketplace = req.params.marketplace.toLowerCase();

    if (!integracoesPorCliente[clienteId]) {
      integracoesPorCliente[clienteId] = {};
    }

    delete integracoesPorCliente[clienteId][marketplace];

    salvarIntegracoesPersistidas();
    limparAlertaIntegracao(clienteId, marketplace);

    return res.json({
      ok: true,
      marketplace,
      configurado: false,
      status: "nao_configurado",
      message: "Integração removida com sucesso"
    });

  } catch (e) {
    console.log("[ERRO] Erro ao remover integrao:", e.message);

    return res.status(500).json({
      ok: false,
      erro: "Erro interno ao remover integração"
    });
  }
});

app.post("/integracoes/:marketplace/test", async (req, res) => {
  {
    try {
      const clienteId = getClienteId(req);
      const marketplace = normalizarMarketplaceIntegracao(req.params.marketplace || "");
      const config = getIntegracaoCliente(clienteId, marketplace) ||
        (marketplace === "kabum" ? getIntegracaoCliente(clienteId, "awin") : null);

      console.log("[INTEGRACAO-TESTE-INICIO]", JSON.stringify({
        clienteId,
        marketplace
      }));

      const resultadoTeste = await testarIntegracaoMarketplace(clienteId, marketplace, config || {});
      const configAtualizada = salvarResultadoTesteIntegracao(clienteId, marketplace, {
        status: resultadoTeste.status,
        mensagem: resultadoTeste.mensagem
      });

      if (resultadoTeste.ok) {
        limparAlertaIntegracao(clienteId, marketplace);
        console.log("[INTEGRACAO-TESTE-OK]", JSON.stringify({
          clienteId,
          marketplace,
          status: resultadoTeste.status,
          codigo: resultadoTeste.codigo
        }));
      } else {
        registrarAlertaIntegracao(clienteId, marketplace, {
          tipo: resultadoTeste.codigo || resultadoTeste.status,
          status: "atencao",
          mensagem: resultadoTeste.mensagem,
          detalhes: resultadoTeste.detalhes || {}
        });

        const tagLog = resultadoTeste.status === "teste_nao_implementado"
          ? "[INTEGRACAO-TESTE-NAO-IMPLEMENTADO]"
          : "[INTEGRACAO-TESTE-FALHA]";

        console.log(tagLog, JSON.stringify({
          clienteId,
          marketplace,
          status: resultadoTeste.status,
          codigo: resultadoTeste.codigo
        }));
      }

      const resultado = {
        ...resultadoTeste,
        message: resultadoTeste.mensagem,
        ultimoTesteEm: configAtualizada?.ultimoTesteEm || resultadoTeste.testadoEm,
        ultimoStatus: resultadoTeste.status,
        ultimaMensagem: resultadoTeste.mensagem
      };

      const httpStatus = resultado.status === "credencial_ausente" ||
        resultado.status === "marketplace_nao_suportado"
        ? 400
        : 200;

      return res.status(httpStatus).json(resultado);
    } catch (e) {
      console.log("[INTEGRACAO-TESTE-FALHA]", JSON.stringify({
        marketplace: req.params.marketplace || "",
        erro: e.message
      }));

      return res.status(500).json({
        ok: false,
        marketplace: req.params.marketplace || "",
        status: "erro_interno",
        mensagem: "Erro interno ao testar integracao.",
        message: "Erro interno ao testar integracao.",
        detalhes: { erro: e.message },
        testadoEm: new Date().toISOString()
      });
    }
  }

  const clienteId = getClienteId(req);
  const marketplace = req.params.marketplace.toLowerCase();
  const config = integracoesPorCliente[clienteId]?.[marketplace];

  if (!config) {
    if (marketplace === "mercadolivre") {
      registrarAlertaMercadoLivre(clienteId, "configuracao_incompleta", {
        motivo: "nao_configurado"
      });

      return res.status(400).json({
        ok: false,
        marketplace: "mercadolivre",
        status: "nao_configurado",
        ultimoStatus: "nao_configurado",
        ultimaMensagem: MENSAGEM_NAO_CONFIGURADO_ML
      });
    }

    if (marketplace === "amazon") {
      registrarAlertaAmazon(clienteId, "configuracao_invalida", {
        motivo: "nao_configurado"
      });

      return res.status(400).json({
        ok: false,
        marketplace: "amazon",
        status: "nao_configurado",
        ultimoStatus: "nao_configurado",
        ultimaMensagem: MENSAGEM_NAO_CONFIGURADO_AMAZON
      });
    }

    return res.status(400).json({
      ok: false,
      erro: "Integração não configurada"
    });
  }

  const credenciais = config.credenciais || {};

  const temAlgumaCredencial = Object.values(credenciais)
    .some(v => String(v || "").trim());

  if (marketplace === "mercadolivre") {
    const resultadoTeste = await testarMercadoLivreCookies(clienteId, config);
    const configAtualizada = salvarResultadoTesteIntegracao(clienteId, "mercadolivre", {
      status: resultadoTeste.status,
      mensagem: resultadoTeste.mensagem
    });

    if (!resultadoTeste.ok) {
      registrarAlertaMercadoLivre(clienteId, resultadoTeste.tipo || resultadoTeste.status, resultadoTeste.detalhes || {});
    } else {
      limparAlertaIntegracao(clienteId, "mercadolivre");
    }

    return res.json({
      ok: resultadoTeste.ok,
      marketplace: "mercadolivre",
      status: resultadoTeste.status,
      ultimoTesteEm: configAtualizada?.ultimoTesteEm || null,
      ultimoStatus: resultadoTeste.status,
      ultimaMensagem: resultadoTeste.mensagem,
      detalhes: resultadoTeste.detalhes || {}
    });
  }
  if (marketplace === "amazon") {
    const resultadoTeste = await testarAmazonConfiguracao(config);
    const configAtualizada = salvarResultadoTesteIntegracao(clienteId, "amazon", {
      status: resultadoTeste.status,
      mensagem: resultadoTeste.mensagem
    });

    if (!resultadoTeste.ok) {
      registrarAlertaAmazon(clienteId, resultadoTeste.tipo || resultadoTeste.status, resultadoTeste.detalhes || {});
    } else {
      limparAlertaIntegracao(clienteId, "amazon");
    }

    return res.json({
      ok: resultadoTeste.ok,
      marketplace: "amazon",
      status: resultadoTeste.status,
      ultimoTesteEm: configAtualizada?.ultimoTesteEm || null,
      ultimoStatus: resultadoTeste.status,
      ultimaMensagem: resultadoTeste.mensagem,
      detalhes: resultadoTeste.detalhes || {}
    });
  }

  if (!temAlgumaCredencial) {
    if (marketplace === "mercadolivre") {
      registrarAlertaMercadoLivre(clienteId, "configuracao_incompleta", {
        motivo: "sem_credenciais"
      });
    }

    if (marketplace === "amazon") {
      registrarAlertaAmazon(clienteId, "configuracao_incompleta", {
        motivo: "sem_credenciais"
      });
    }

    return res.status(400).json({
      ok: false,
      erro: "Insira as credenciais antes de testar."
    });
  }

  if (marketplace === "awin") {
    try {
      const { publisherId, apiToken } = credenciais;

      if (!publisherId || !apiToken) {
        return res.status(400).json({
          ok: false,
          erro: "Awin sem publisherId ou apiToken"
        });
      }

      const url = `https://api.awin.com/publishers/${publisherId}/programmes`;

      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${apiToken}`
        },
        params: {
          relationship: "joined"
        },
        timeout: 15000
      });

      return res.json({
        ok: true,
        marketplace: "awin",
        status: "conectado",
        message: "Awin conectada com sucesso",
        totalProgramas: Array.isArray(response.data) ? response.data.length : 0
      });

    } catch (e) {
      return res.status(500).json({
        ok: false,
        marketplace: "awin",
        erro: "Erro ao consultar API da Awin",
        detalhe: e.response?.data || e.message
      });
    }
  }


  limparAlertaIntegracaoSeValida(clienteId, marketplace, config);

  return res.json({
    ok: true,
    marketplace,
    status: "credenciais_presentes",
    message: `${config.nome || marketplace} possui credenciais salvas.`
  });
});

// ================= AWIN IMPORTAR DEEP LINK MANUAL =================

async function gerarDeepLinkAwin(urlOriginal, clienteId = "admin") {
  const integracao =
  getIntegracaoCliente(clienteId, "awin");
  const credenciais = integracao?.credenciais || {};

  const { publisherId, apiToken } = credenciais;
  const programaAwin = obterProgramaAwin(credenciais, urlOriginal);
  const advertiserId = programaAwin?.advertiserId || "";

if (!publisherId || !apiToken || !advertiserId) {
  console.log("[AVISO] AWIN sem credenciais/programa:", {
    clienteId,
    programa: programaAwin?.nome || ""
  });
}
  if (!publisherId || !apiToken || !advertiserId) {
    throw new Error("Awin sem publisherId, apiToken ou programa advertiserId configurado.");
  }

  const response = await axios.post(
    `https://api.awin.com/publishers/${publisherId}/linkbuilder/generate`,
    {
      advertiserId: Number(advertiserId),
      destinationUrl: urlOriginal
    },
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json"
      },
      timeout: 15000
    }
  );

console.log("[INFO] AWIN Deeplink OK");

  return (
    response.data?.shortUrl ||
    response.data?.url ||
    response.data?.link ||
    response.data?.trackingLink ||
    response.data?.clickUrl ||
    ""
  );
}


app.get("/teste-kabum-rota", (req, res) => {
  return res.json({ ok: true, rota: "kabum ativa" });
});

async function importarKabumManualRequest(req, res, opcoes = {}) {
  let logContextKabum = {};

  try {
    const authKabum = obterClienteIdAutenticadoKabumManual(req);
    const clienteId = authKabum.clienteId;
    const body = req.body || {};
    const url = String(body.url || body.link || body.linkOriginal || "").trim();
    logContextKabum = {
      clienteId,
      temTokenAuth: authKabum.temTokenAuth
    };

    if (!authKabum.ok) {
      logKabumManual({
        clienteId,
        temTokenAuth: authKabum.temTokenAuth
      });

      return res.status(401).json({
        ok: false,
        erro: "Cliente não autenticado para importar KaBuM/AWIN"
      });
    }

    if (!url) {
      return res.status(400).json({
        ok: false,
        erro: "URL obrigatória"
      });
    }

    if (!/kabum\.com\.br/i.test(url)) {
      return res.status(400).json({
        ok: false,
        erro: "Informe uma URL da KaBuM"
      });
    }

    const validacaoAwin = validarAwinKabumManual(clienteId, url);

    if (!validacaoAwin.ok) {
      logKabumManual({
        clienteId,
        temTokenAuth: authKabum.temTokenAuth,
        integracaoAwinEncontrada: !!validacaoAwin.integracao,
        camposFaltando: validacaoAwin.faltando
      });

      return res.status(400).json({
        ok: false,
        marketplace: "kabum",
        erro: `Awin/KaBuM sem ${validacaoAwin.faltando.join(", ")} configurado.`,
        camposFaltando: validacaoAwin.faltando,
        clienteId
      });
    }

    logContextKabum = {
      clienteId,
      temTokenAuth: authKabum.temTokenAuth,
      integracaoAwinEncontrada: !!validacaoAwin.integracao,
      camposFaltando: [],
      chamouImportador: true
    };

    const produto = await importarProdutoKabumViaAwin(
      url,
      clienteId,
      {
        gerarDeepLinkAwin
      }
    );

    const camposProdutoFaltando = [];
    if (!produto?.titulo) camposProdutoFaltando.push("titulo");
    if (!produto?.precoAtual && !produto?.preco) camposProdutoFaltando.push("preco");
    if (!produto?.linkAfiliado && !produto?.link) camposProdutoFaltando.push("linkAfiliado");

    if (camposProdutoFaltando.length) {
      logKabumManual({
        clienteId,
        temTokenAuth: authKabum.temTokenAuth,
        integracaoAwinEncontrada: !!validacaoAwin.integracao,
        camposFaltando: camposProdutoFaltando,
        chamouImportador: true,
        tituloOk: !!produto?.titulo,
        precoOk: !!(produto?.precoAtual || produto?.preco),
        imagemOk: !!produto?.imagem,
        deeplinkOk: !!(produto?.linkAfiliado && produto.linkAfiliado !== url)
      });

      return res.status(400).json({
        ok: false,
        marketplace: "kabum",
        erro: `Produto KaBuM incompleto: ${camposProdutoFaltando.join(", ")}.`,
        camposFaltando: camposProdutoFaltando
      });
    }

    const novaOferta = {
      nome: produto.titulo,
      titulo: produto.titulo,
      preco: produto.preco || produto.precoAtual || "",
      precoAtual: produto.precoAtual || produto.preco || "",
      precoAntigo: produto.precoAntigo || "",
      cupom: produto.cupom || "",
      avisoCupom: produto.avisoCupom || "",
      avisoPagamento: produto.avisoPagamento || "",
      parcelamento: produto.parcelamento || "",
      linkOriginal: produto.linkOriginal || url,
      link: produto.linkAfiliado || produto.link || url,
      linkAfiliado: produto.linkAfiliado || produto.link || url,
      imagem: produto.imagem || "",
      marketplace: "kabum",
      categoria: produto.categoria || classificarCategoriaOferta(produto, ""),
      sessaoId: normalizarSessaoId(clienteId, "sessao1"),
      status: "pendente",
      statusDetalhe: "Na fila",
      clienteId
    };

    validarCupomMonetarioOferta(novaOferta);
    aplicarPrioridadeEnvioOferta(novaOferta);

    if (opcoes.teste !== true) {
      const adicionou = adicionarOfertaNaFila(fila, novaOferta, "manual-kabum-awin");

      if (adicionou) {
        logAwinEntradaFilaDebug({
          clienteId,
          oferta: novaOferta,
          origem: "manual-kabum-awin",
          permitido: true,
          motivo: "origem_manual_ou_radar"
        });
        logPrioridadeFila(novaOferta);
        salvarFila(clienteId);
      }
    }

    logKabumManual({
      clienteId,
      temTokenAuth: authKabum.temTokenAuth,
      integracaoAwinEncontrada: !!validacaoAwin.integracao,
      camposFaltando: [],
      chamouImportador: true,
      tituloOk: !!novaOferta.titulo,
      precoOk: !!(novaOferta.precoAtual || novaOferta.preco),
      imagemOk: !!novaOferta.imagem,
      deeplinkOk: !!(novaOferta.linkAfiliado && novaOferta.linkAfiliado !== url)
    });

    return res.json({
      ok: true,
      teste: opcoes.teste === true,
      produto: novaOferta,
      titulo: novaOferta.titulo,
      preco: novaOferta.preco,
      precoAtual: novaOferta.precoAtual,
      imagem: novaOferta.imagem,
      linkOriginal: novaOferta.linkOriginal,
      linkAfiliado: novaOferta.linkAfiliado,
      marketplace: novaOferta.marketplace
    });
  } catch (e) {
    console.error("[ERRO] KABUM IMPORTAR:", e.message);
    logKabumManual(logContextKabum);

    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
}

app.post("/kabum/importar", (req, res) => {
  return importarKabumManualRequest(req, res);
});

app.post("/kabum/importar-teste", (req, res) => {
  return importarKabumManualRequest(req, res, { teste: true });
});

app.post("/awin/gerar-link", async (req, res) => {
  try {
    const clienteId = getClienteId(req);
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        ok: false,
        erro: "URL obrigatória"
      });
    }

    if (url.includes("kabum.com.br")) {
      const produto = await importarProdutoKabumViaAwin(
      url,
      clienteId,
     {
     gerarDeepLinkAwin
    }
    );

      return res.json({
        ok: true,
        ...produto
      });
    }

    const linkAfiliado = await gerarDeepLinkAwin(url, clienteId);

  console.log("[INFO] AWIN link gerado com sucesso");

    if (!linkAfiliado) {
      return res.status(400).json({
        ok: false,
        erro: "Não foi possível gerar o link afiliado Awin"
      });
    }

    return res.json({
      ok: true,
      marketplace: "awin",
      linkOriginal: url,
      link: linkAfiliado,
      linkAfiliado
    });

  } catch (e) {
    console.error("[ERRO] ERRO GERAR LINK AWIN:", e.message);

    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

// ================= HELPERS DE IMPORTAÇÃO =================

function htmlDecode(str) {
  if (!str) return "";
  return String(str)
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .trim();
}

function extrairMeta(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["'][^>]*>`, "i")
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return htmlDecode(match[1]);
  }

  return "";
}

function extrairJsonLd(html) {
  const matches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  for (const match of matches) {
    try {
      const raw = htmlDecode(match[1]);
      const data = JSON.parse(raw);

      if (Array.isArray(data)) {
        const product = data.find((x) => x["@type"] === "Product");
        if (product) return product;
      }

      if (data["@type"] === "Product") return data;

      if (data["@graph"]) {
        const product = data["@graph"].find((x) => x["@type"] === "Product");
        if (product) return product;
      }
    } catch {}
  }

  return null;
}


// ================= FILTROS UNIVERSAIS DE OFERTAS =================

function pontuarOferta(oferta = {}, opcoes = {}) {
  let score = 0;

  const texto = normalizarTexto(`
    ${oferta.titulo || ""}
    ${oferta.nome || ""}
    ${oferta.descricao || ""}
    ${oferta.categoria || ""}
    ${oferta.marketplace || ""}
    ${oferta.origem || ""}
    ${oferta.link || ""}
    ${oferta.linkAfiliado || ""}
  `);

  if (texto.includes("envio do brasil")) score += 100;
  if (texto.includes("estoque no brasil")) score += 90;
  if (texto.includes("produto no brasil")) score += 80;
  if (texto.includes("brasil")) score += 40;
  if (texto.includes("brazil")) score += 40;

  if (oferta.imagem) score += 10;
  if (oferta.precoAtual || oferta.preco) score += 10;
  if (oferta.cupom) score += 15;
  if (oferta.precoAntigo) score += 8;

  const marcasFortes = [
  "logitech",
  "jbl",
  "xiaomi",
  "huawei",
  "kingston",
  "redragon",
  "hyperx",
  "aoc",
  "lg",
  "samsung",
  "philips",
  "cadence",
  "elgin",
  "tp-link",
  "intelbras",
  "dell"
];

if (
  marcasFortes.some(marca =>
    texto.includes(normalizarTexto(marca))
  )
) {
  score += 25;
}

if (texto.includes("oficial")) score += 10;
if (texto.includes("original")) score += 10;

if (texto.includes("premium")) score -= 8;
if (texto.includes("generico")) score -= 15;
if (texto.includes("replica")) score -= 20;

const vendas = Number(oferta.sales || oferta.vendas || 0);
const nota = Number(oferta.ratingStar || oferta.nota || 0);
const comissao = Number(oferta.commissionRate || oferta.comissao || 0);

if (vendas >= 5000) score += 35;
else if (vendas >= 1000) score += 25;
else if (vendas >= 100) score += 10;

if (nota >= 4.8) score += 25;
else if (nota >= 4.5) score += 15;
else if (nota >= 4.0) score += 5;

if (comissao >= 0.2) score += 20;
else if (comissao >= 0.1) score += 10;

if (produtoSuspeito(oferta)) {
  score -= 100;
}

if (
  texto.includes("ssd") &&
  texto.includes("1tb") &&
  !texto.includes("kingston") &&
  !texto.includes("sandisk") &&
  !texto.includes("wd") &&
  !texto.includes("western digital")
) {
  score -= 40;
}

if (
  texto.includes("micro sd") &&
  texto.includes("1tb")
) {
  score -= 50;
}

if (
  texto.includes("super armazenamento")
) {
  score -= 50;
}

if (
  texto.includes("alta velocidade")
) {
  score -= 20;
}

if (
  vendas <= 3 &&
  nota > 0 &&
  nota < 4
) {
  score -= 25;
}

  if (opcoes.preferirEnvioBrasil && texto.includes("brasil")) {
    score += 30;
  }

  return score;
}

function removerDuplicadas(ofertas = []) {
  const vistas = new Set();

for (const existente of fila || []) {
  const linkExistente = String(existente.linkAfiliado || existente.link || "")
    .split("?")[0]
    .toLowerCase()
    .trim();

  const tituloExistente = normalizarTexto(existente.titulo || existente.nome || "");

  if (linkExistente) vistas.add(linkExistente);
  if (tituloExistente) vistas.add(tituloExistente);
}

  return ofertas.filter((oferta) => {
    const link = String(oferta.linkAfiliado || oferta.link || "")
      .split("?")[0]
      .toLowerCase()
      .trim();

    const titulo = normalizarTexto(oferta.titulo || oferta.nome || "");

    const chave = link || titulo;

    if (!chave) return true;

    if (vistas.has(chave)) {
      console.log("[INFO] Duplicada removida pelo filtro universal:", oferta.titulo || oferta.nome);
      return false;
    }

    vistas.add(chave);
    return true;
  });
}

function ofertaPassaNosFiltros(oferta = {}, opcoes = {}) {
  const bloquearSemImagem = opcoes.bloquearSemImagem ?? true;
  const bloquearSemPreco = opcoes.bloquearSemPreco ?? true;

  if (produtoSuspeito(oferta)) {
  return { ok: false, motivo: "produto_suspeito" };
}

if (bloquearSemImagem && !oferta.imagem) {
    return { ok: false, motivo: "sem_imagem" };
  }

  if (bloquearSemPreco && !(oferta.precoAtual || oferta.preco)) {
    return { ok: false, motivo: "sem_preco" };
  }

  return { ok: true, motivo: "ok" };
}

function aplicarFiltrosUniversais(ofertas = [], opcoes = {}) {
  return removerDuplicadas(ofertas)
    .map((oferta) => ({
      ...oferta,
      score: pontuarOferta(oferta, opcoes),
    }))
    .filter((oferta) => {
      const resultado = ofertaPassaNosFiltros(oferta, opcoes);

      if (!resultado.ok) {
        console.log(
          "⏭️ Oferta ignorada pelo filtro universal:",
          resultado.motivo,
          oferta.titulo || oferta.nome || "sem título"
        );
      }

      return resultado.ok;
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}

function limparPreco(valor) {
  if (!valor) return "";

  let texto = String(valor).trim();

  texto = texto
    .replace("R$", "")
    .replace(/\s/g, "");

  if (/^\d+\.\d{1,2}$/.test(texto)) {
  const numero = Number(texto);
  return numero.toFixed(2).replace(".", ",");
}

  if (texto.includes(",")) {
    texto = texto.replace(/\./g, "").replace(",", ".");
    const numero = Number(texto);
    if (!Number.isFinite(numero)) return "";
    return numero.toFixed(2).replace(".", ",");
  }

  texto = texto.replace(/\D/g, "");

  if (!texto) return "";

  let numero = Number(texto);

  if (numero > 10000) {
  numero = numero / 100;
}

  return numero.toFixed(2).replace(".", ",");
}

function corrigirImagemUrl(imagem) {
  if (!imagem || typeof imagem !== "string") return null;

  let imagemFinal = imagem.trim();

  if (!imagemFinal.startsWith("http")) return null;

  if (imagemFinal.includes(".webp")) {
    imagemFinal = imagemFinal.replace(".webp", ".jpg");
  }

  return imagemFinal;
}
async function buscarCsrfTokenMercadoLivre(cookies, contexto = {}) {
  try {
    if (!cookies) return "";

    const response = await fetch(
      "https://www.mercadolivre.com.br/afiliados/linkbuilder",
      {
        method: "GET",
        headers: {
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Cookie": cookies
        }
      }
    );

    const html = await response.text();

    if (html.includes("suspicious-traffic-frontend")) {
    console.log("[AVISO] Mercado Livre bloqueou por trfego suspeito. Pulando rodada.");
    if (contexto.clienteId) {
      registrarAlertaMercadoLivre(contexto.clienteId, "suspicious_traffic", {
        origem: "csrf_linkbuilder"
      });
    }
    return;
    }

    const patterns = [
      /x-csrf-token["']?\s*[:=]\s*["']([^"']+)["']/i,
      /csrfToken["']?\s*[:=]\s*["']([^"']+)["']/i,
      /csrf-token["']?\s*content=["']([^"']+)["']/i,
      /_csrf["']?\s*[:=]\s*["']([^"']+)["']/i
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return match[1];
    }

    console.log("[INFO] ML CSRF: token no encontrado automaticamente");
    return "";
  } catch (e) {
    console.error("[ERRO] ERRO BUSCAR CSRF ML:", e.message);
    return "";
  }
}

function tipoUrlMercadoLivreAfiliado(url = "") {
  const texto = String(url || "").trim();
  if (!texto) return "vazia";
  if (/meli\.la/i.test(texto)) return "meli_la";

  try {
    const parsed = new URL(texto);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname || "";

    if (host.includes("mercadolivre.com.br") && path.toLowerCase().startsWith("/social/")) return "social";
    if (host.includes("produto.mercadolivre.com.br") && /\/MLB-?\d+/i.test(path)) return "produto_mlb";
    if (host.includes("mercadolivre.com.br") && /\/p\/MLB/i.test(path)) return "produto_p";
    if (host.includes("mercadolivre.com.br") && /\/permalink\/MLB/i.test(path)) return "permalink";
    if (host.includes("mercadolivre.com.br")) return "mercadolivre_outro";
  } catch {
    return "url_invalida";
  }

  return "outro";
}

function logMlAfiliadoFalhaDetalhe(dados = {}) {
  console.log("[ML-AFILIADO-FALHA-DETALHE]", {
    clienteId: dados.clienteId || "",
    motivo: dados.motivo || "",
    statusHttp: dados.statusHttp || null,
    temCsrf: dados.temCsrf === true,
    temTag: dados.temTag === true,
    urlTipo: dados.urlTipo || "",
    temCookies: dados.temCookies === true
  });
}

async function gerarLinkAfiliadoMercadoLivre(url, config, contexto = {}) {
  const credenciais = config?.credenciais || {};
  const cookies = credenciais.cookies || "";
  const tag = credenciais.tag || "";
  const clienteId = contexto.clienteId || "";
  const urlTipo = tipoUrlMercadoLivreAfiliado(url);

  try {
    if (String(url || "").includes("meli.la")) {
      console.log("[INFO] Link ML j encurtado detectado. No vou reutilizar para outro cliente.");
      logMlAfiliadoFalhaDetalhe({
        clienteId,
        motivo: "meli_la_bloqueado",
        statusHttp: null,
        temCsrf: false,
        temTag: !!tag,
        temCookies: !!cookies,
        urlTipo
      });
      return "";
    }

    if (!url || !cookies || !tag) {
      console.log("[INFO] ML AFILIADO: faltando cookies ou tag");
      logMlAfiliadoFalhaDetalhe({
        clienteId,
        motivo: !url ? "url_ausente" : (!cookies ? "cookies_ausentes" : "tag_ausente"),
        statusHttp: null,
        temCsrf: false,
        temTag: !!tag,
        temCookies: !!cookies,
        urlTipo
      });
      if (contexto.clienteId) {
        registrarAlertaMercadoLivre(contexto.clienteId, "configuracao_incompleta", {
          faltandoCookies: !cookies,
          faltandoTag: !tag
        });
      }
      return "";
    }

    const csrfToken = await buscarCsrfTokenMercadoLivre(cookies, contexto);

    if (!csrfToken) {
      console.log("[INFO] ML AFILIADO: csrfToken automtico no encontrado");
      logMlAfiliadoFalhaDetalhe({
        clienteId,
        motivo: "csrf_nao_encontrado",
        statusHttp: null,
        temCsrf: false,
        temTag: !!tag,
        temCookies: !!cookies,
        urlTipo
      });
      if (contexto.clienteId) {
        registrarAlertaMercadoLivre(contexto.clienteId, "cookie_invalido", {
          motivo: "csrf_nao_encontrado"
        });
      }
      return "";
    }

    const response = await fetch(
      "https://www.mercadolivre.com.br/affiliate-program/api/v2/stripe/user/links",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/plain, */*",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Origin": "https://www.mercadolivre.com.br",
          "Referer": "https://www.mercadolivre.com.br/afiliados/linkbuilder",
          "Cookie": cookies,
          "x-csrf-token": csrfToken
        },
        body: JSON.stringify({
          url,
          tag
        })
      }
    );

    const data = await response.json().catch(() => null);

    console.log("[INFO] ML afiliado respondeu");

    if (!response.ok) {
      console.log("[ERRO] ML AFILIADO ERRO STATUS:", response.status);
      logMlAfiliadoFalhaDetalhe({
        clienteId,
        motivo: "http_status_invalido",
        statusHttp: response.status,
        temCsrf: true,
        temTag: !!tag,
        temCookies: !!cookies,
        urlTipo
      });
      if (contexto.clienteId && [401, 403, 407, 419, 429].includes(Number(response.status))) {
        registrarAlertaMercadoLivre(contexto.clienteId, "cookie_invalido", {
          httpStatus: response.status,
          origem: "link_afiliado"
        });
      }
      return "";
    }

    if (contexto.clienteId) {
      limparAlertaIntegracao(contexto.clienteId, "mercadolivre");
    }

    const linkAfiliado = data?.short_url || data?.shortUrl || data?.url || "";
    if (!linkAfiliado) {
      logMlAfiliadoFalhaDetalhe({
        clienteId,
        motivo: "resposta_sem_link",
        statusHttp: response.status,
        temCsrf: true,
        temTag: !!tag,
        temCookies: !!cookies,
        urlTipo
      });
    }

    return linkAfiliado;
  } catch (e) {
    console.error("[ERRO] ERRO ML AFILIADO:", e.message);
    logMlAfiliadoFalhaDetalhe({
      clienteId,
      motivo: e.message || "erro_inesperado",
      statusHttp: null,
      temCsrf: false,
      temTag: !!tag,
      temCookies: !!cookies,
      urlTipo
    });
    return "";
  }
}
const encurtarUrl = async (url) => {
  try {
    const res = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
    return await res.text();
  } catch {
    return url;
  }
};


function gerarLinkMagalu(linkOriginal, promoterId) {
  if (!linkOriginal || !promoterId) return linkOriginal;

  const urlLimpa = String(linkOriginal).trim();
  const loja = String(promoterId).trim();

  // Se já for link da loja do influenciador, mantém
  if (urlLimpa.includes("magazinevoce.com.br")) {
    return urlLimpa;
  }

  // Converte link comum do Magalu para link da loja
  return urlLimpa.replace(
    "https://www.magazineluiza.com.br",
    `https://www.magazinevoce.com.br/${loja}`
  );
}

function extrairProductIdAliExpressManual(urlEntrada = "") {
  const urlTexto = String(urlEntrada || "");
  const candidatos = [
    urlTexto.match(/\/item\/(\d+)\.html/i)?.[1],
    urlTexto.match(/[?&](?:productId|product_id|itemId|item_id)=(\d+)/i)?.[1],
    urlTexto.match(/\b(1005\d{8,})\b/)?.[1]
  ].filter(Boolean);

  if (candidatos.length) return candidatos[0];

  try {
    const decodificada = decodeURIComponent(urlTexto);
    return decodificada.match(/\/item\/(\d+)\.html/i)?.[1] ||
      decodificada.match(/[?&](?:productId|product_id|itemId|item_id)=(\d+)/i)?.[1] ||
      decodificada.match(/\b(1005\d{8,})\b/)?.[1] ||
      "";
  } catch {
    return "";
  }
}

function listaAliExpress(valor) {
  if (Array.isArray(valor)) return valor;
  if (!valor) return [];
  return [valor];
}

function primeiroCampoAliExpress(objeto = {}, campos = []) {
  for (const campo of campos) {
    const valor = campo.split(".").reduce((atual, chave) => atual?.[chave], objeto);
    if (Array.isArray(valor) && valor.length) return valor[0];
    if (valor && typeof valor === "object" && Array.isArray(valor.string) && valor.string.length) return valor.string[0];
    if (valor && typeof valor === "object" && typeof valor.string === "string") return valor.string;
    if (valor !== undefined && valor !== null && String(valor).trim() !== "") return valor;
  }

  return "";
}

function extrairProdutoAliExpressResposta(data = {}) {
  const resposta = data?.aliexpress_affiliate_productdetail_get_response || data || {};
  const respResult = resposta?.resp_result || data?.resp_result || {};
  const result = respResult?.result || resposta?.result || data?.result || {};
  const produtos = result?.products || result?.product || data?.products || data?.product || {};
  const listaProdutos = [
    ...listaAliExpress(produtos?.product),
    ...listaAliExpress(produtos),
    ...listaAliExpress(result?.products?.product),
    ...listaAliExpress(result?.products),
    ...listaAliExpress(result?.product)
  ].filter(item => item && typeof item === "object" && !Array.isArray(item));

  return listaProdutos[0] || {};
}

function logAliExpressApiProdutoFalhou(dados = {}) {
  console.log("aliexpress_api_produto_falhou", {
    clienteId: dados.clienteId || "",
    productId: dados.productId || "",
    status: dados.status || "",
    codigo: dados.codigo || "",
    motivo: dados.motivo || "",
    temAppKey: Boolean(dados.temAppKey),
    temSecret: Boolean(dados.temSecret),
    temTrackingId: Boolean(dados.temTrackingId)
  });
}

async function importarAliExpress(urlEntrada, config = {}) {
  let productId = "";
  let linkAfiliadoFallback = urlEntrada;
  const clienteIdLog = config?.clienteId || config?.cliente || "";

  try {
    if (urlEntrada && !urlEntrada.startsWith("http")) {
      urlEntrada = "https://" + urlEntrada;
    }

    const ehBrasil =
      String(urlEntrada).includes("ship_from%22%3A%22BR") ||
      String(urlEntrada).includes('"ship_from":"BR"') ||
      String(urlEntrada).includes("%22ship_from%22%3A%22BR%22");

    productId = extrairProductIdAliExpressManual(urlEntrada);

    if (!productId) {
      const erro = new Error("Product ID nao encontrado no link AliExpress");
      erro.codigo = "product_id_ausente";
      throw erro;
    }

    const credenciais = config?.credenciais || {};
    const appKey = credenciais.appKey || "";
    const secret = credenciais.secret || credenciais.appSecret || "";
    const trackingId = credenciais.trackingId || "";

    console.log("[ALIEXPRESS-MANUAL] auditoria", {
      clienteId: clienteIdLog,
      productId,
      integracaoEncontrada: Boolean(config),
      temAppKey: Boolean(appKey),
      temSecret: Boolean(secret),
      temTrackingId: Boolean(trackingId)
    });

    if (!appKey || !secret || !trackingId) {
      const erro = new Error("Credenciais AliExpress incompletas");
      erro.codigo = "credenciais_incompletas";
      throw erro;
    }

    function timestampGMT8() {
      const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
      const pad = (n) => String(n).padStart(2, "0");
      return d.getUTCFullYear() + "-" +
        pad(d.getUTCMonth() + 1) + "-" +
        pad(d.getUTCDate()) + " " +
        pad(d.getUTCHours()) + ":" +
        pad(d.getUTCMinutes()) + ":" +
        pad(d.getUTCSeconds());
    }

    function assinar(params, appSecret) {
      const sortedKeys = Object.keys(params).sort();
      let base = appSecret;
      for (const key of sortedKeys) {
        if (key === "sign") continue;
        base += key + params[key];
      }
      base += appSecret;
      return crypto.createHash("md5").update(base, "utf8").digest("hex").toUpperCase();
    }

    const params = {
      method: "aliexpress.affiliate.productdetail.get",
      app_key: appKey,
      timestamp: timestampGMT8(),
      sign_method: "md5",
      format: "json",
      v: "2.0",
      product_ids: productId,
      fields: "product_title,product_main_image_url,product_small_image_urls,target_sale_price,sale_price,target_app_sale_price,app_sale_price,target_min_sale_price,min_sale_price,target_original_price,original_price,discount,promotion_link,promotion_link_short,product_detail_url,product_url,first_level_category_name,second_level_category_name",
      target_currency: "BRL",
      target_language: "PT",
      ship_to_country: "BR",
      tracking_id: trackingId
    };

    params.sign = assinar(params, secret);
    const body = new URLSearchParams(params);

    console.log("[ALIEXPRESS-MANUAL] chamada API", {
      clienteId: clienteIdLog,
      productId,
      method: params.method
    });

    const response = await fetch("https://api-sg.aliexpress.com/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
      },
      body
    });

    let data = null;
    try {
      data = await response.json();
    } catch (e) {
      const erro = new Error("Resposta AliExpress invalida");
      erro.status = response.status;
      erro.codigo = "json_invalido";
      erro.causa = e.message;
      throw erro;
    }

    const respostaApi = data?.aliexpress_affiliate_productdetail_get_response || data || {};
    const erroApi = data?.error_response || respostaApi?.error_response || null;
    const respResult = respostaApi?.resp_result || data?.resp_result || {};
    const codigoApi = erroApi?.code || respResult?.resp_code || respostaApi?.code || "";
    const mensagemApi = erroApi?.msg || erroApi?.sub_msg || respResult?.resp_msg || respostaApi?.msg || "";

    if (!response.ok || erroApi || (codigoApi && !["200", "20010000"].includes(String(codigoApi)))) {
      const erro = new Error(mensagemApi || "AliExpress API retornou erro");
      erro.status = response.status;
      erro.codigo = codigoApi || "api_erro";
      erro.raw = data;
      throw erro;
    }

    const produto = extrairProdutoAliExpressResposta(data);
    const tituloApi = primeiroCampoAliExpress(produto, ["product_title", "title", "productTitle"]);
    const precoApi = primeiroCampoAliExpress(produto, ["target_sale_price", "sale_price", "target_app_sale_price", "app_sale_price", "target_min_sale_price", "min_sale_price"]);
    const imagemApi = primeiroCampoAliExpress(produto, ["product_main_image_url", "product_small_image_urls", "product_small_image_urls.string", "image_url"]);

    console.log("[ALIEXPRESS-MANUAL] resposta API", {
      status: response.status,
      codigo: codigoApi || "ok",
      temTitulo: Boolean(tituloApi),
      temPreco: Boolean(precoApi),
      temImagem: Boolean(imagemApi),
      camposProduto: Object.keys(produto || {}).slice(0, 30)
    });

    const avisoCupom = ehBrasil
      ? "Produto no Brasil. Confira cupom ou desconto com moedas na pagina."
      : "Compra internacional. Pode haver imposto/taxa. Confira cupom ou desconto com moedas na pagina.";

    if (!produto || Object.keys(produto).length === 0) {
      const erro = new Error("AliExpress sem produto retornado pela API");
      erro.status = response.status;
      erro.codigo = codigoApi || "produto_ausente";
      erro.raw = data;
      throw erro;
    }

    let titulo = tituloApi || "Produto AliExpress";
    let imagem = imagemApi || "";
    let precoAtual = String(precoApi || "").trim();
    let precoAntigo = String(primeiroCampoAliExpress(produto, ["target_original_price", "original_price"]) || "").trim();

    if (precoAntigo === precoAtual) precoAntigo = "";

    console.log("[ALIEXPRESS-MANUAL] precos raw", {
      target_sale_price: produto.target_sale_price,
      sale_price: produto.sale_price,
      app_sale_price: produto.app_sale_price,
      target_app_sale_price: produto.target_app_sale_price,
      target_min_sale_price: produto.target_min_sale_price,
      min_sale_price: produto.min_sale_price,
      target_original_price: produto.target_original_price,
      original_price: produto.original_price
    });

    if (produto.discount === "0%" && limparPreco(precoAtual) === limparPreco(precoAntigo)) precoAntigo = "";

    try {
      const urlDecodificada = decodeURIComponent(urlEntrada);
      const match = urlDecodificada.match(/BRL!([\d.]+)!([\d.]+)/);
      if (match) {
        const antigo = match[1];
        const atual = match[2];
        if (parseFloat(atual) < parseFloat(antigo)) {
          precoAntigo = antigo;
          precoAtual = atual;
        }
      }
    } catch (e) {
      console.log("[ERRO] Erro ao extrair preco da URL:", e.message);
    }

    let linkAfiliado = primeiroCampoAliExpress(produto, ["promotion_link", "promotion_link_short", "product_detail_url", "product_url"]) || urlEntrada;
    if (linkAfiliado.includes("s.click.aliexpress.com/s/")) {
      try {
        const match = linkAfiliado.match(/https:\/\/s\.click\.aliexpress\.com\/e\/_[a-zA-Z0-9]+/i);
        if (match?.[0]) linkAfiliado = match[0];
      } catch (e) {
        console.log("[ERRO] Erro limpando link AliExpress:", e.message);
      }
    }

    const linkAliCurto = await gerarLinkCurtoAliExpress(linkAfiliado, credenciais);
    const linkFinal = gerarLinkOptimus(linkAliCurto || linkAfiliado, "aliexpress");

    return {
      marketplace: "aliexpress",
      titulo: htmlDecode(titulo || "Produto AliExpress"),
      precoAntigo: limparPreco(precoAntigo || ""),
      precoAtual: limparPreco(precoAtual || ""),
      cupom: "",
      linkOriginal: urlEntrada,
      linkAfiliado: linkFinal,
      imagem: corrigirImagemUrl(imagem) || imagem,
      categoria: primeiroCampoAliExpress(produto, ["first_level_category_name", "second_level_category_name"]) || "AliExpress",
      categoriaProduto: primeiroCampoAliExpress(produto, ["first_level_category_name", "second_level_category_name"]) || "AliExpress",
      avisoCupom,
      aviso: !imagem || titulo === "Produto AliExpress"
        ? "Dados parciais retornados pela API AliExpress."
        : ""
    };

  } catch (e) {
    const credenciais = config?.credenciais || {};
    logAliExpressApiProdutoFalhou({
      clienteId: clienteIdLog,
      productId,
      status: e.status || e.response?.status || "",
      codigo: e.codigo || e.code || "",
      motivo: e.causa || e.message || "erro_api",
      temAppKey: Boolean(credenciais.appKey),
      temSecret: Boolean(credenciais.secret || credenciais.appSecret),
      temTrackingId: Boolean(credenciais.trackingId)
    });

    try {
      const linkAliCurto = await gerarLinkCurtoAliExpress(urlEntrada, credenciais);
      linkAfiliadoFallback = gerarLinkOptimus(linkAliCurto || urlEntrada, "aliexpress");
    } catch (erroLink) {
      console.log("[ALIEXPRESS-MANUAL] afiliado fallback falhou", {
        motivo: erroLink.message || "erro_link_afiliado"
      });
    }

    console.error("[ERRO] ERRO ALIEXPRESS:", e.message);

    return {
      marketplace: "aliexpress",
      titulo: "Produto AliExpress",
      precoAntigo: "",
      precoAtual: "",
      cupom: "",
      linkOriginal: urlEntrada,
      linkAfiliado: linkAfiliadoFallback || urlEntrada,
      imagem: "",
      categoria: "AliExpress",
      aviso: "Erro ao consultar API AliExpress",
      erroTecnico: "aliexpress_api_produto_falhou",
      motivoErroAliExpress: e.message || "erro_api",
      statusApiAliExpress: e.status || e.response?.status || "",
      codigoApiAliExpress: e.codigo || e.code || ""
    };
  }
}

//================== FUNCAO IMPORTAR MAGALU =========================

async function importarMagalu(urlEntrada, config = {}) {
  try {
    const promoterId =
      config?.credenciais?.promoterId ||
      config?.promoterId ||
      "";

    const linkAfiliado = gerarLinkMagalu(urlEntrada, promoterId);

   const urlConsulta = String(urlEntrada)
  .replace(
    /https:\/\/www\.magazinevoce\.com\.br\/[^/]+/i,
    "https://www.magazineluiza.com.br"
  );

const response = await fetch(urlConsulta, {
  headers: {
    ...gerarHeadersStealth(),
    ...(getIntegracaoCliente("admin", "magalu")?.credenciais?.cookies
      ? {
          Cookie:
            getIntegracaoCliente("admin", "magalu").credenciais.cookies
        }
      : {})
  }
});

    const html = await response.text();


    const titulo =
      html.match(/<title>(.*?)<\/title>/i)?.[1]
        ?.replace(" | Magazine Luiza", "")
        ?.trim() ||
      "Produto Magalu";

    const imagem =
      html.match(/property="og:image" content="([^"]+)"/i)?.[1] || "";

    let precoAtual = "";

    const precoMatch =
      html.match(/"price":"([^"]+)"/i) ||
      html.match(/"finalPrice":"([^"]+)"/i);

    if (precoMatch?.[1]) {
      precoAtual = `R$ ${String(precoMatch[1]).replace(".", ",")}`;
    }

    return {
      marketplace: "magalu",
      titulo,
      precoAntigo: "",
      precoAtual,
      cupom: "",
      linkOriginal: urlEntrada,
      linkAfiliado,
      imagem,
      categoria: "Magalu",
      aviso: "Verifique se há cupons disponíveis na página"
    };
  } catch (e) {
    console.log("[API] erro importarMagalu:", e.message);

    return {
      marketplace: "magalu",
      titulo: "Produto Magalu",
      precoAntigo: "",
      precoAtual: "",
      cupom: "",
      linkOriginal: urlEntrada,
      linkAfiliado: urlEntrada,
      imagem: "",
      categoria: "Magalu",
      aviso: "Erro ao consultar Magalu"
    };
  }
}

async function buscarProdutosAliExpressAPI(termo) {
  const credenciais =
  getIntegracaoCliente("admin", "aliexpress")?.credenciais || {};

  const appKey = credenciais.appKey || "";
  const secret = credenciais.secret || "";
  const trackingId = credenciais.trackingId || "";

  if (!appKey || !secret || !trackingId) {
    console.log("[AVISO] AliExpress API sem credenciais.");
    return [];
  }

  function timestampGMT8() {
    const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const pad = n => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }

  function assinar(params, appSecret) {
    const sortedKeys = Object.keys(params).sort();
    let base = appSecret;

    for (const key of sortedKeys) {
      if (key !== "sign") base += key + params[key];
    }

    base += appSecret;

    return crypto
      .createHash("md5")
      .update(base, "utf8")
      .digest("hex")
      .toUpperCase();
  }

  const params = {
    method: "aliexpress.affiliate.product.query",
    app_key: appKey,
    timestamp: timestampGMT8(),
    sign_method: "md5",
    format: "json",
    v: "2.0",
    keywords: termo,
    target_currency: "BRL",
    target_language: "PT",
    ship_to_country: "BR",
    tracking_id: trackingId,
    page_no: "1",
    page_size: "10"
  };

  params.sign = assinar(params, secret);

  const response = await fetch("https://api-sg.aliexpress.com/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
    },
    body: new URLSearchParams(params)
  });

  const data = await response.json();

  const lista =
    data?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product ||
    data?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products ||
    [];

  return Array.isArray(lista) ? lista : [lista];
}

//================ IMPORTE MANUAL MAGALU ===================

app.post("/importar-magalu-manual", async (req, res) => {
  try {

    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        ok: false,
        erro: "URL obrigatória"
      });
    }

    const integracao =
    getIntegracaoCliente("admin", "magalu");

    const promoterId =
      integracao?.credenciais?.promoterId || "";

    const produto = await importarMagalu(url, {
      credenciais: { promoterId }
    });

    if (!produto?.precoAtual) {
      return res.status(400).json({
        ok: false,
        erro: "Produto inválido"
      });
    }

    const clienteId = getClienteId(req);

const novaOferta = {
  nome: produto.titulo,
  titulo: produto.titulo,
  preco: produto.precoAtual,
  precoAtual: produto.precoAtual,
  precoAntigo: produto.precoAntigo || "",
  cupom: produto.cupom || "",
  avisoCupom: produto.avisoCupom || "",
  parcelamento: produto.parcelamento || "",
  link: produto.linkAfiliado || url,
  linkAfiliado: produto.linkAfiliado || url,
  imagem: produto.imagem || "",
  marketplace: "magalu",
  categoria: classificarCategoriaOferta(produto, ""),
  sessaoId: normalizarSessaoId(clienteId, "sessao1"),
  status: "pendente",
  clienteId
};

novaOferta.status = novaOferta.status || "pendente";
novaOferta.statusDetalhe = novaOferta.statusDetalhe || "Na fila";
validarCupomMonetarioOferta(novaOferta);
aplicarPrioridadeEnvioOferta(novaOferta);

const adicionou = adicionarOfertaNaFila(fila, novaOferta, "manual-magalu");

if (adicionou) {
  logPrioridadeFila(novaOferta);
  salvarFila(clienteId);
}

    return res.json({
      ok: true,
      produto: novaOferta
    });

  } catch (e) {

    console.log("[API] erro importar manual Magalu:", e.message);

    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

// ================= AREA GLOBAL STEALTH  =================

const USER_AGENTS_STEALTH = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/136.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Mobile Safari/537.36"
];

function gerarHeadersStealth() {
  const userAgent =
    USER_AGENTS_STEALTH[
      Math.floor(Math.random() * USER_AGENTS_STEALTH.length)
    ];

  return {
    "User-Agent": userAgent,
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language":
      "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1"
  };
}

// =========== FILTRO GLOBAL DE CUPONS ===========

function limparCuponsInvalidos(cupons = []) {
  const blacklist = [
    "APPLE",
    "APPLICATION",
    "APPPROPS",
    "OFFSET",
    "OFFICIAL",
    "APPLY",
    "APPENDCHILD",
    "OFFERS",
    "OFFER",
    "OFFSETHEIGHT",
    "APPLEWEBKIT",
    "MELIDATA",
    "MELISEARCH",
    "MELISESSION",
    "MELISTORE",
    "MELIPAY",
    "MELICLIENT",
    "MELIDATA",
    "MELIMAIS",
    "MELIPLUS",
    "FUNCTION",
    "OBJECT",
    "RETURN",
    "SCRIPT",
    "WEBPACK",
    "WINDOW",
    "DOCUMENT",
    "NULL",
    "UNDEFINED"
  ];

  return [...new Set(
    cupons.filter(c =>
      c &&
      typeof c === "string" &&
      c.length >= 4 &&
      c.length <= 20 &&
      /^[A-Z0-9_-]+$/i.test(c) &&
      !blacklist.includes(c.toUpperCase())
    )
  )];
}

// ===================== FUNCAO VALIDAR CUPOM ========================

function validarCupomAutomaticamente(marketplace = "", cupom = "") {
  const mp = normalizarTexto(marketplace || "");
  const cp = String(cupom || "").trim().toUpperCase();

  if (!mp || !cp) return false;

  const status = config.cuponsStatus?.[mp]?.[cp];

  if (!status) return true;

  if (status.status === "expirado") return false;

  if ((status.falhas || 0) >= 3) return false;

  const ultima =
    status.ultimoSucesso ||
    status.ultimaDeteccao ||
    status.ultimaUtilizacao ||
    status.criadoEm;

  if (ultima) {
    const horasSemValidar =
      (Date.now() - new Date(ultima).getTime()) / (1000 * 60 * 60);

    if (horasSemValidar >= 24 && (status.confianca || 50) <= 50) {
      status.status = "expirado";
      status.expirouEm = new Date().toISOString();
      salvarConfig();

      console.log("[INFO] Cupom expirado por tempo:", mp, cp);
      return false;
    }
  }

  return true;
}

// =========== RESULTADO INTELIGENTE DE CUPOM ===========

function registrarResultadoCupom(marketplace = "", cupom = "", sucesso = false) {
  const mp = normalizarTexto(marketplace || "");
  const cp = String(cupom || "").trim().toUpperCase();

  if (!mp || !cp) return;

  config.cuponsStatus = config.cuponsStatus || {};
  config.cuponsStatus[mp] = config.cuponsStatus[mp] || {};

  const atual = config.cuponsStatus[mp][cp] || {
    falhas: 0,
    sucessos: 0,
    confianca: 50,
    status: "ativo"
  };

  if (sucesso) {
    atual.sucessos = (atual.sucessos || 0) + 1;
    atual.falhas = 0;
    atual.confianca = Math.min(100, (atual.confianca || 50) + 15);
    atual.status = "ativo";
    atual.ultimoSucesso = new Date().toISOString();
  } else {
    atual.falhas = (atual.falhas || 0) + 1;
    atual.confianca = Math.max(0, (atual.confianca || 50) - 20);
    atual.ultimaFalha = new Date().toISOString();

    if (atual.falhas >= 3 || atual.confianca <= 20) {
      atual.status = "expirado";
      atual.expirouEm = new Date().toISOString();
      console.log("[INFO] Cupom expirado automaticamente:", mp, cp);
    }
  }

  atual.ultimaUtilizacao = new Date().toISOString();

  config.cuponsStatus[mp][cp] = atual;
  salvarConfig();
}

// =========== INTELIGÊNCIA GLOBAL DE CUPONS ===========

function cupomEstaBloqueado(marketplace = "", cupom = "") {
  const mp = normalizarTexto(marketplace || "");
  const cp = String(cupom || "").trim().toUpperCase();

  const status = config.cuponsStatus || {};
  const dados = status?.[mp]?.[cp];

  return dados?.status === "expirado" && (dados?.falhas || 0) >= 3;
}

function registrarFalhaCupom(marketplace = "", cupom = "") {
  const mp = normalizarTexto(marketplace || "");
  const cp = String(cupom || "").trim().toUpperCase();

  if (!mp || !cp) return;

  config.cuponsStatus = config.cuponsStatus || {};
  config.cuponsStatus[mp] = config.cuponsStatus[mp] || {};

  const atual = config.cuponsStatus[mp][cp] || {
    falhas: 0,
    status: "ativo"
  };

  atual.falhas = (atual.falhas || 0) + 1;
  atual.ultimoTeste = new Date().toISOString();

  if (atual.falhas >= 3) {
    atual.status = "expirado";
    atual.expirouEm = new Date().toISOString();
    console.log("[INFO] Cupom marcado como expirado:", mp, cp);
  }

  config.cuponsStatus[mp][cp] = atual;
  salvarConfig();
}

function registrarSucessoCupom(marketplace = "", cupom = "") {
  const mp = normalizarTexto(marketplace || "");
  const cp = String(cupom || "").trim().toUpperCase();

  if (!mp || !cp) return;

  config.cuponsStatus = config.cuponsStatus || {};
  config.cuponsStatus[mp] = config.cuponsStatus[mp] || {};

  config.cuponsStatus[mp][cp] = {
    falhas: 0,
    status: "ativo",
    ultimoSucesso: new Date().toISOString()
  };

  salvarConfig();

  console.log("[INFO] Cupom validado como ativo:", mp, cp);
}

// =========== DECAIMENTO GLOBAL DE CUPONS ===========

function decairConfiancaCupons() {
  try {
    config.cuponsStatus = config.cuponsStatus || {};
    const agora = Date.now();

    for (const [marketplace, cupons] of Object.entries(config.cuponsStatus)) {
      for (const [cupom, status] of Object.entries(cupons)) {
        if (!status || status.status === "expirado") continue;

        const ultima =
          status.ultimoSucesso ||
          status.ultimaDeteccao ||
          status.ultimaUtilizacao ||
          status.criadoEm;

        if (!ultima) continue;

        const horas = (agora - new Date(ultima).getTime()) / (1000 * 60 * 60);

        if (horas >= 24) {
          status.confianca = Math.max(0, (status.confianca || 50) - 20);
          status.ultimaDecaida = new Date().toISOString();
        }

        if (horas >= 48 || status.confianca <= 20) {
          status.status = "expirado";
          status.expirouEm = new Date().toISOString();
          console.log("[INFO] Cupom expirado por decaimento:", marketplace, cupom);
        }
      }
    }

    salvarConfig();
  } catch (e) {
    console.log("[ERRO] erro decairConfiancaCupons:", e.message);
  }
}

// =========== NORMALIZADOR GLOBAL DE CATEGORIAS ===========

function normalizarCategoria(txt = "") {
  return String(txt || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ========================= CATEGORIA BASE ============================

function categoriaBase(txt = "") {
  return destinosUtils.categoriaBase(txt);
}

// =========== VALIDAR CATEGORIA DO DESTINO ===========

function categoriaPermitidaNoDestino(oferta, destino) {
  return destinosUtils.categoriaPermitidaNoDestino(oferta, destino);
}

//============ FUNCAO FAREJAR CUPOM MERCADO LIVRE ================
// DESATIVADA: não registrar cupons ML automaticamente

async function farejarCuponsMercadoLivre(html = "") {
  console.log("[INFO] farejarCuponsMercadoLivre desativado");
  return [];
}

// ===================== FUNCAO TIMES TAMP =============================

function timestampGMT8() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");

  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function assinar(params, appSecret) {
  const sortedKeys = Object.keys(params).sort();
  let base = appSecret;

  for (const key of sortedKeys) {
    if (key === "sign") continue;
    base += key + params[key];
  }

  base += appSecret;

  return crypto
    .createHash("md5")
    .update(base, "utf8")
    .digest("hex")
    .toUpperCase();
}

// ======================= FUNCAO LIMPAR LINK AMAZON =======================

function limparLinkAmazon(url = "") {
  try {
    const u = new URL(url);
    const asin =
    u.pathname.match(/\/dp\/([A-Z0-9]{10})/i)?.[1] ||
    u.pathname.match(/\/gp\/product\/([A-Z0-9]{10})/i)?.[1] ||
    u.pathname.match(/\/([A-Z0-9]{10})(?:\/|$)/i)?.[1];

    if (!asin) return url;

    const tag = u.searchParams.get("tag") || "d1egopcoff-20";

    return `https://www.amazon.com.br/dp/${asin}?tag=${tag}`;
  } catch (e) {
    return url;
  }
}

// =================== LINK CURTO OFICIAL ALIEXPRESS ===================

async function gerarLinkCurtoAliExpress(urlOriginal, credenciais = {}) {
  try {
    const appKey = credenciais.appKey || "";
    const secret = credenciais.secret || "";
    const trackingId = credenciais.trackingId || "";

    if (!appKey || !secret || !trackingId || !urlOriginal) {
      return urlOriginal;
    }

    const params = {
      method: "aliexpress.affiliate.link.generate",
      app_key: appKey,
      timestamp: timestampGMT8(),
      sign_method: "md5",
      format: "json",
      v: "2.0",
      promotion_link_type: "0",
      source_values: urlOriginal,
      tracking_id: trackingId
    };

    params.sign = assinar(params, secret);

    const response = await fetch("https://api-sg.aliexpress.com/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
      },
      body: new URLSearchParams(params)
    });

    const data = await response.json();

   console.log("[INFO] Ali link");

    const linkGerado =
      data?.aliexpress_affiliate_link_generate_response?.resp_result?.result?.promotion_links?.promotion_link?.[0]?.promotion_link ||
      data?.resp_result?.result?.promotion_links?.promotion_link?.[0]?.promotion_link ||
      "";

    return linkGerado || urlOriginal;

  } catch (e) {
    console.log("[ERRO] Erro gerar link curto AliExpress:", e.message);
    return urlOriginal;
  }
}

// ======================= FUNCAO PLANO NOME =========================================

function getPlanoPorNome(nome = "free") {
  const chave = normalizarTexto(nome || "free");

  if (planos?.[chave]) {
    return planos[chave];
  }

  const encontrado = Object.entries(planos || {}).find(([key, plano]) => {
    return (
      normalizarTexto(key) === chave ||
      normalizarTexto(plano?.nome || "") === chave
    );
  });

  return encontrado?.[1] || planos?.free || null;
}

// =============== FUNCAO GERAR LINK AFILIADO SHOPEE ========================================

async function gerarLinkShopeeCliente(clienteId, ofertaBase = {}) {
  try {
    const integracao = getIntegracaoCliente(clienteId, "shopee");

    logDebug("[INFO] CLIENTE:", clienteId);
    logDebug("[INFO] MARKETPLACE:", "shopee");
    logDebug("[INFO] Integrao encontrada?", !!integracao);
    logDebug("[INFO] Tem credenciais?", !!integracao?.credenciais);

    const appId = integracao?.credenciais?.appId || "";
    const secret = integracao?.credenciais?.secret || "";

    if (!appId || !secret) {
      return "";
    }

    const keyword = String(
      ofertaBase.titulo ||
      ofertaBase.nome ||
      ""
    )
      .replace(/"/g, "")
      .slice(0, 80);

    if (!keyword) {
      return "";
    }

    const timestamp = Math.floor(Date.now() / 1000);

    const bodyPayload = {
      query: `
        query {
          productOfferV2(
            keyword: "${keyword}",
            page: 1,
            limit: 5
          ) {
            nodes {
              productName
              productLink
              offerLink
              itemId
              shopId
            }
          }
        }
      `
    };

    const payload = JSON.stringify(bodyPayload);
    const baseString = `${appId}${timestamp}${payload}${secret}`;

    const sign = crypto
      .createHash("sha256")
      .update(baseString, "utf8")
      .digest("hex");

    const response = await fetch(
      "https://open-api.affiliate.shopee.com.br/graphql",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${sign}`
        },
        body: payload
      }
    );

    const data = await response.json().catch(() => null);
    const nodes = data?.data?.productOfferV2?.nodes || [];

    const ofertaTitulo = String(ofertaBase.titulo || ofertaBase.nome || "")
      .toLowerCase()
      .slice(0, 40);

    const produto =
      nodes.find(n =>
        String(n.productName || "")
          .toLowerCase()
          .includes(ofertaTitulo.slice(0, 20))
      ) || nodes[0];

    return produto?.offerLink || "";

  } catch (e) {
    console.log("[ERRO] erro gerarLinkShopeeCliente:", e.message);
    return "";
  }
}

// =============== FUNCAO GERAR LINK AFILIADO VARIOS MARKTPLACES  ============================

async function gerarLinkAfiliadoCliente(clienteId, marketplace, linkOriginal, ofertaBase = {}) {
  try {
    const mp = String(marketplace || "").toLowerCase();

    const integracao = getIntegracaoCliente(clienteId, mp);

    logDebug("[INFO] ====================================");
    logDebug("[INFO] CLIENTE:", clienteId);
    logDebug("[INFO] MARKETPLACE:", mp);
    logDebug("[INFO] Integrao encontrada?", !!integracao);
    logDebug("[INFO] Tem credenciais?", !!integracao?.credenciais);
    logDebug("[INFO] ====================================");

    const linkBase =
      linkOriginal ||
      ofertaBase.linkOriginal ||
      ofertaBase.link ||
      "";

    if (!linkBase) {
      return "";
    }

    if (mp === "mercadolivre") {
      const linkML = await gerarLinkAfiliadoMercadoLivre(
        linkBase,
        integracao,
        { clienteId }
      );

      return linkML || "";
    }

    if (mp === "shopee") {
      return await gerarLinkShopeeCliente(clienteId, ofertaBase);
    }

    if (mp === "amazon") {
  const trackingId =
    integracao?.credenciais?.trackingId ||
    integracao?.credenciais?.partnerTag ||
    integracao?.credenciais?.tag ||
    integracao?.credenciais?.affiliateTag ||
    "";

  if (!trackingId) {
    console.log("[AVISO] Amazon sem trackingId/tag afiliada:", {
      clienteId,
      credenciais: Object.keys(integracao?.credenciais || {})
    });
    registrarAlertaAmazon(clienteId, "tag_ausente", {
      credenciais: Object.keys(integracao?.credenciais || {})
    });
    return "";
  }

  try {
    const u = new URL(linkBase);
    u.searchParams.set("tag", trackingId);
    limparAlertaIntegracao(clienteId, "amazon");
    return u.toString();
  } catch {
    return "";
  }
}

    if (mp === "aliexpress") {
      const linkAli = await gerarLinkCurtoAliExpress(
        linkBase,
        integracao?.credenciais || {}
      );

      return linkAli || "";
    }

    if (mp === "awin") {
      const linkAwin = await gerarDeepLinkAwin(
        linkBase,
        clienteId
      );

      return linkAwin || "";
    }

    if (mp === "magalu") {
      const promoterId =
        integracao?.credenciais?.promoterId || "";

      if (!promoterId) {
        return "";
      }

      try {
        return gerarLinkMagalu(linkBase, promoterId) || "";
      } catch {
        return "";
      }
    }

    return "";

  } catch (e) {
    console.log("[ERRO]❌ Erro ao gerar link afiliado do cliente:", {
      clienteId,
      marketplace,
      erro: e.message
    });

    return "";
  }
}

// =========================== HEPERS DE WHATSAPP =================================

function normalizarSessaoId(clienteId, id = "sessao1") {

  const cliente = String(clienteId || "admin").trim();

  let sessao = String(id || "sessao1").trim();

  // remove duplicação
  if (sessao.startsWith(cliente + "_")) {
    sessao = sessao.slice((cliente + "_").length);
  }

  // evita admin_admin_sessao1
  sessao = sessao.replace(/^admin_/g, "");

  return `${cliente}_${sessao}`;
}

function resolverClienteMensageiroPorSessao(sessao = "") {
  const idSessao = String(sessao || "").trim();

  if (/^admin(?:_|$)/.test(idSessao)) {
    return {
      clienteIdMensageiro: "admin",
      origemResolucao: "prefixo_sessao"
    };
  }

  const usuarioPrefixo = (usuarios || [])
    .map(usuario => String(usuario?.id || "").trim())
    .filter(clienteId =>
      clienteId.startsWith("user_") &&
      (idSessao === clienteId || idSessao.startsWith(`${clienteId}_`))
    )
    .sort((a, b) => b.length - a.length)[0];

  if (usuarioPrefixo) {
    return {
      clienteIdMensageiro: usuarioPrefixo,
      origemResolucao: "prefixo_sessao"
    };
  }

  const matchUser = idSessao.match(/^(user_[^_]+)(?:_|$)/);
  if (matchUser?.[1]) {
    return {
      clienteIdMensageiro: matchUser[1],
      origemResolucao: "prefixo_sessao"
    };
  }

  const meta = sessoesMeta?.[idSessao] || {};
  const clienteMapa = String(
    meta.clienteId ||
    meta.clienteIdMensageiro ||
    meta.donoClienteId ||
    ""
  ).trim();

  if (clienteMapa) {
    return {
      clienteIdMensageiro: clienteMapa,
      origemResolucao: "mapa_sessao"
    };
  }

  return {
    clienteIdMensageiro: "admin",
    origemResolucao: "fallback"
  };
}
// ============== HELPERS DISTRIBUIDOR OFERTAS ==================================

function usuarioPodeReceberMarketplace(usuario, marketplace) {

  if (!usuario?.ativo) return false;

  if (usuario.papel === "admin_master") {
    return true;
  }

  const plano = getPlanoPorNome(usuario.plano) || {};

  const marketplacesLiberados = plano.marketplaces || [];

  return marketplacesLiberados.includes(
    normalizarTexto(marketplace || "")
  );
}

// ============ FUNCAO INTEGRACAO MARKET POR CLIENTE ID ===================

function usuarioTemIntegracaoMarketplace(clienteId, marketplace) {
  const mp = normalizarTexto(marketplace || "");

  const integracao = getIntegracaoCliente(clienteId, mp);
  const cred = integracao?.credenciais || {};

  logOptimus("INTEGRACAO", "Check cliente marketplace", {
    clienteId,
    marketplace: mp,
    temIntegracao: !!integracao,
    campos: Object.keys(cred)
  });

  if (!integracao) return false;

  if (mp === "amazon") {
    return !!(
      cred.tag ||
      cred.trackingId ||
      cred.partnerTag ||
      cred.appId ||
      cred.cookies
    );
  }

  if (mp === "mercadolivre") {
    return !!(
      cred.tag ||
      cred.cookies
    );
  }

  if (mp === "shopee") {
    return !!(
      cred.appId &&
      cred.secret
    );
  }

  if (mp === "aliexpress") {
    return !!(
      cred.appKey &&
      (cred.secret || cred.appSecret) &&
      cred.trackingId
    );
  }

  if (mp === "kabum") {
    const awin = getIntegracaoCliente(clienteId, "awin");
    const awinCred = awin?.credenciais || {};

    return !!(
      awinCred.publisherId &&
      awinCred.apiToken
    );
  }

  if (mp === "awin") {
    const awinCred = normalizarCredenciaisAwin(cred);
    return !!(
      awinCred.publisherId &&
      awinCred.apiToken
    );
  }

  return Object.keys(cred).length > 0;
}


// =============== FUNCAO DISTRIBUIDOR OFERTAS ======================================

async function distribuirOfertaParaClientes(ofertaBase) {

  ofertaBase = prepararOfertaGlobal(ofertaBase);

  for (const usuario of usuarios) {
    if (!usuario?.ativo) continue;

    const clienteId = usuario.id;
    const adminMaster = usuario.papel === "admin_master";

    const mp = normalizarTexto(ofertaBase.marketplace || "");

    console.log("🚨 DISTRIBUIDOR RECEBEU", {
      clienteId,
      titulo: ofertaBase.titulo,
      marketplace: mp
    });

    if (!usuarioPodeReceberMarketplace(usuario, mp)) {

      console.log("[INFO] Usurio no recebe marketplace pelo plano:", {
        clienteId,
        plano: usuario.plano,
        marketplace: mp
      });
      continue;
    }


logDebug("[DEBUG]✅ CHECK INTEGRAO:", {
  clienteId,
  marketplace: mp,
  integracao: !!getIntegracaoCliente(clienteId, mp),
  campos: Object.keys(getIntegracaoCliente(clienteId, mp)?.credenciais || {})
});

   if (!usuarioTemIntegracaoMarketplace(clienteId, mp)) {
     logOptimus("INTEGRACAO", "Usuario sem integracao configurada", {
     clienteId,
     marketplace: mp,
      titulo: ofertaBase.titulo
   });
   continue;
   }

    const linkOriginal =
      ofertaBase.linkOriginal ||
      ofertaBase.link ||
      ofertaBase.linkAfiliado ||
      "";

    const linkAfiliadoCliente = await gerarLinkAfiliadoCliente(
      clienteId,
      mp,
      linkOriginal,
      ofertaBase
    );

    logOptimus("INTEGRACAO", "Link cliente gerado", {
      clienteId,
      marketplace: mp,
      linkOriginal,
      linkAfiliadoCliente
    });

 if (!linkAfiliadoCliente) {
  logOptimus("INTEGRACAO", "Oferta bloqueada sem link afiliado proprio", {
    clienteId,
    marketplace: mp,
    titulo: ofertaBase.titulo
  });
  continue;
}

const linkAfiliadoIgualOriginal =
  String(linkAfiliadoCliente || "").trim() === String(linkOriginal || "").trim();

if (mp === "mercadolivre" && linkAfiliadoIgualOriginal) {
  logOptimus("MERCADOLIVRE", "Bloqueado link afiliado igual ao original", {
    clienteId,
    marketplace: mp,
    titulo: ofertaBase.titulo,
    linkOriginal
  });
  continue;
}

if (linkAfiliadoIgualOriginal) {
  console.log("[INFO] Link afiliado igual ao original, permitindo por enquanto:", {
    clienteId,
    marketplace: mp,
    titulo: ofertaBase.titulo,
    linkAfiliadoCliente,
    linkOriginal
  });
}

    const ofertaCliente = {
      ...ofertaBase,
      clienteId,
      marketplace: mp,
      linkOriginal,
      linkAfiliado: linkAfiliadoCliente,
      link: linkAfiliadoCliente,
      linkFinal: linkAfiliadoCliente,
      status: "pendente",
      destinosEnviados: [],
      logsEnvio: [],
      enviadoEm: "",
      dataEnvio: "",
      statusDetalhe: "Aguardando envio",
      criadoEm: new Date().toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo"
      })
    };

    const jaExisteCliente = fila.some(o =>
      String(o.clienteId || "admin") === String(clienteId) &&
      (
        String(o.link || o.linkAfiliado || "") === String(ofertaCliente.link || ofertaCliente.linkAfiliado || "") ||
        normalizarTexto(o.titulo || o.nome || "") === normalizarTexto(ofertaCliente.titulo || ofertaCliente.nome || "")
      )
    );

 if (jaExisteCliente) continue;

if (deveIgnorarOfertaRepetida(ofertaCliente)) {
  console.log("[INFO] Oferta automtica ignorada pela memria:", {
    clienteId,
    marketplace: ofertaCliente.marketplace,
    titulo: ofertaCliente.titulo
  });
  continue;
}

ofertaCliente.status = ofertaCliente.status || "pendente";
ofertaCliente.statusDetalhe = ofertaCliente.statusDetalhe || "Na fila";
validarCupomMonetarioOferta(ofertaCliente);
aplicarPrioridadeEnvioOferta(ofertaCliente);

// ⭐ SCORE V1
try {
  const resultadoScore = calcularScoreOferta(ofertaCliente);

  ofertaCliente.score = resultadoScore.score;
  ofertaCliente.nivelScore = resultadoScore.nivel;
  ofertaCliente.descontoScore = resultadoScore.desconto;
  ofertaCliente.motivosScore = resultadoScore.motivos;

    logDebug("[DEBUG] SCORE OFERTA:", {
    titulo: ofertaCliente.titulo || ofertaCliente.nome,
    score: ofertaCliente.score,
    nivel: ofertaCliente.nivelScore,
    motivos: ofertaCliente.motivosScore
  });


} catch (e) {
  console.log("[ERRO] Erro ao calcular score:", e.message);
}

if (reterShopeePrecoSuspeitoSeNecessario(ofertaCliente)) {
  registrarOfertaVista(ofertaCliente);
  filaOfertas.adicionarOfertaFila(fila, ofertaCliente, {
    clienteId,
    origem: ofertaCliente.origem || "distribuidor",
    logger: console
  });
  salvarFila(clienteId);
  continue;
}

const origemEntradaFila = ofertaCliente.origem || ofertaBase.origem || ofertaCliente.fonte || ofertaBase.fonte || "distribuidor";
if (bloquearAwinKabumAutoNaFila(ofertaCliente, origemEntradaFila, clienteId)) {
  continue;
}

registrarOfertaVista(ofertaCliente);

logPrioridadeFila(ofertaCliente);
filaOfertas.adicionarOfertaFila(fila, ofertaCliente, {
  clienteId,
  origem: ofertaCliente.origem || "distribuidor",
  logger: console
});

salvarFila(clienteId);

console.log("[INFO] Oferta distribuda para cliente:", {
  clienteId,
  titulo: ofertaCliente.titulo,
  marketplace: ofertaCliente.marketplace
});

  }
}

      async function buscarTermoAliExpress(termo, tipo) {
      try {
        if (adicionadasNestaRodada >= limitePorRodada) return;

        console.log(`[INFO] ${tipo} Busca AliExpress API:`, termo);

        const produtosAPI = await buscarProdutosAliExpressAPI(termo);

        console.log(`[INFO] ${termo}: ${produtosAPI.length} produtos AliExpress via API`);

        for (const item of produtosAPI.slice(0, 5)) {
          try {
            if (adicionadasNestaRodada >= limitePorRodada) return;

            const link =
              item.promotion_link ||
              item.product_detail_url ||
              item.product_url ||
              item.target_sale_url ||
              "";

            if (!link) continue;

            const linkOriginalAli =
              item.product_detail_url ||
              item.product_url ||
              item.target_sale_url ||
              link ||
              "";

            const itemIdAli =
              String(linkOriginalAli).match(/item\/(\d+)\.html/)?.[1] ||
              String(linkOriginalAli).match(/\/(\d{10,})/)?.[1] ||
              "";

            const chaveAli = itemIdAli
              ? `aliexpress_item_${itemIdAli}`
              : gerarChaveProduto(String(linkOriginalAli).split("?")[0]);

            if (produtoRepetidoRecentemente(chaveAli, 48)) {
              console.log("[AVISO] AliExpress item repetido ignorado:", chaveAli);
              continue;
            }

            const titulo =
              item.product_title ||
              item.title ||
              item.product_subject ||
              "Produto AliExpress";

            const chaveRepeticao =
              gerarChaveProduto(titulo + " aliexpress");

            if (produtoRepetidoRecentemente(chaveRepeticao, 48)) {
              console.log("[AVISO] AliExpress ttulo repetido ignorado:", titulo);
              continue;
            }

            const precoAtual =
              limparPreco(
                item.target_sale_price ||
                item.sale_price ||
                item.app_sale_price ||
                item.original_price
              );

            const precoAntigo =
              limparPreco(
                item.target_original_price ||
                item.original_price ||
                item.product_original_price
              );

            const imagem =
              item.product_main_image_url ||
              item.image_url ||
              item.product_small_image_urls?.string?.[0] ||
              "";

            const descontoTexto =
              item.discount ||
              item.discount_rate ||
              item.evaluate_rate ||
              "";

            const precoNumero = Number(
              String(precoAtual || "")
                .replace("R$", "")
                .replace(/\./g, "")
                .replace(",", ".")
                .trim()
            );

            const precoAntigoNumero = Number(
              String(precoAntigo || "")
                .replace("R$", "")
                .replace(/\./g, "")
                .replace(",", ".")
                .trim()
            );

            const desconto =
              precoAntigoNumero > precoNumero
                ? ((precoAntigoNumero - precoNumero) / precoAntigoNumero) * 100
                : Number(String(descontoTexto).replace(/\D/g, "")) || 0;

            const tituloLower = titulo.toLowerCase();

            const palavrasBloqueadas = [
              "cabelo",
              "peruca",
              "extensão",
              "extensões",
              "sapato",
              "sandália",
              "chinelo",
              "salto",
              "batom",
              "cílios",
              "unha",
              "bolsa",
              "sutiã",
              "calcinha",
              "wedding",
              "bridal"
            ];

            if (palavrasBloqueadas.some(p => tituloLower.includes(p))) {
              console.log("[AVISO] Produto bloqueado:", titulo);
              continue;
            }

            if (!precoNumero || !Number.isFinite(precoNumero)) continue;

            const precoMinimo = Number(cfg.precoMinimo) || 0;
            const descontoMinimo = Number(cfg.descontoMinimo) || 0;

            const descontoMinimoInternacional =
              Number(cfg.descontoMinimoInternacional) || descontoMinimo;

            const minimoDescontoAplicado =
              tipo === "🌍"
                ? descontoMinimoInternacional
                : descontoMinimo;

            if (precoNumero < precoMinimo) continue;
            if (desconto < minimoDescontoAplicado) continue;

           const clienteId = "admin";

           let novaOferta = {
              nome: titulo,
              titulo,
              preco: precoAtual,
              precoAtual,
              precoAntigo: precoAntigo || "",
              cupom: "",
              avisoCupom:
                desconto >= minimoDescontoAplicado
                  ? `${Math.round(desconto)}% OFF no AliExpress.`
                  : "",
              parcelamento: "",
              linkOriginal: linkOriginalAli || link,
              link: linkOriginalAli || link,
              linkAfiliado: "",
              imagem,
              marketplace: "aliexpress",
              categoria: "AliExpress",
              sessaoId: normalizarSessaoId(clienteId, "sessao1"),
              status: "pendente",
              clienteId
            };

            novaOferta = prepararOfertaGlobal(novaOferta);

            const jaExiste = ofertaJaExiste(novaOferta);

            if (!jaExiste) {
              novaOferta.criadoEm = new Date().toLocaleString("pt-BR", {
                timeZone: "America/Sao_Paulo"
              });

              ofertasEncontradas.push(novaOferta);
              adicionadasNestaRodada++;

              console.log("[INFO] Nova oferta AliExpress:", {
                titulo: novaOferta.titulo,
                preco: novaOferta.precoAtual,
                precoAntigo: novaOferta.precoAntigo,
                desconto: Math.round(desconto) + "%",
                link: novaOferta.linkAfiliado?.slice(0, 80)
              });
            }

            await new Promise(r => setTimeout(r, 1500));
          } catch (e) {
            console.log("[ERRO]❌ erro produto AliExpress API:", e.message);
          }
        }

    for (const termo of buscasBrasil) {
      await buscarTermoAliExpress(termo, "🇧🇷");
      if (adicionadasNestaRodada >= limitePorRodada) break;
    }

    if (cfg.permitirInternacionalForte && adicionadasNestaRodada < limitePorRodada) {
      for (const termo of buscasInternacional) {
        await buscarTermoAliExpress(termo, "🌍");
        if (adicionadasNestaRodada >= limitePorRodada) break;
      }
    }

    const ofertasFiltradas = aplicarFiltrosUniversais(
      ofertasEncontradas,
      {
        preferirEnvioBrasil: true,
        bloquearSemImagem: true,
        bloquearSemPreco: true
      }
    );

    console.log(
      ` 🔍Ofertas AliExpress filtros universais: ${ofertasFiltradas.length}`
    );

  for (const oferta of ofertasFiltradas) {
  await distribuirOfertaParaClientes(oferta);
  }

    console.log(`[FILA] AliExpress finalizado. Adicionadas: ${adicionadasNestaRodada}`);
  } catch (e) {
    console.log("[ERRO] erro farejador AliExpress:", e.message);
  }
}


// ================= FAREJADOR MAGALU =================

async function farejarMagalu() {
  try {
    if (!config.marketplaces?.magalu?.ativo) {
      console.log("[AVISO] Magalu desativada. Farejador ignorado.");
      return;
    }

    console.log("[INFO] Farejando ofertas Magalu...");

   const integracao =
   getIntegracaoCliente("admin", "magalu");

    const limitePorRodada =
      config.marketplaces?.magalu?.limitePorRodada || 3;

    const buscas = [
      "air fryer",
      "fone bluetooth",
      "smartwatch",
      "cadeira escritorio",
      "furadeira",
      "cafeteira",
      "liquidificador",
      "ventilador",
      "microondas",
      "notebook"
    ];

    const buscasDaRodada = [...buscas]
      .sort(() => Math.random() - 0.5)
      .slice(0, 1);

    let adicionadas = 0;

    for (const termo of buscasDaRodada) {
      if (adicionadas >= limitePorRodada) break;

      const urlBusca = `https://www.magazineluiza.com.br/busca/${encodeURIComponent(termo)}/`;

      console.log("[INFO] MAGALU BUSCA:", urlBusca);

      const response = await fetch(urlBusca, {
        headers: {
          ...gerarHeadersStealth(),
          ...(integracao?.credenciais?.cookies
            ? { Cookie: integracao.credenciais.cookies }
            : {})
        }
      });

      console.log("[INFO] MAGALU STATUS:", response.status);

      if (!response.ok) {

  console.log(
    "🛡️ Magalu bloqueou status:",
    response.status,
    "- parando rodada."
  );

  await new Promise(r => setTimeout(r, 15000));

  return;
}

const html = await response.text();

     const linksExtraidos = [
  ...html.matchAll(/href="([^"]*\/p\/[^"]+)"/g),
  ...html.matchAll(/href="([^"]*\/produto\/[^"]+)"/g),
  ...html.matchAll(/"url":"([^"]*magazineluiza\.com\.br[^"]*)"/g),
  ...html.matchAll(/"productUrl":"([^"]*)"/g),
  ...html.matchAll(/"canonicalUrl":"([^"]*)"/g)
  ]
        .map(m => m[1])
        .map(link => String(link).replace(/\\\//g, "/").replace(/&amp;/g, "&"))
        .map(link => {
          if (link.startsWith("/")) {
            return "https://www.magazineluiza.com.br" + link;
          }
          return link;
        })
        .filter(link =>
          link.includes("magazineluiza.com.br") &&
          link.includes("/p/") &&
          !link.includes("login") &&
          !link.includes("sacola")
        );

      const links = [...new Set(linksExtraidos)].slice(0, 5);

      console.log(`[INFO] ${termo}: ${links.length} links Magalu`);

      for (const link of links) {
        if (adicionadas >= limitePorRodada) break;

        try {
         const produto = await importarMagalu(link);

          console.log("[API] PRODUTO MAGALU IMPORTADO:", produto);

          if (!produto?.precoAtual) continue;

        const clienteId = getClienteId(req);

        let novaOferta = {
            nome: produto.titulo,
            titulo: produto.titulo,
            preco: produto.precoAtual,
            precoAtual: produto.precoAtual,
            precoAntigo: produto.precoAntigo || "",
            cupom: produto.cupom || "",
            avisoCupom: produto.avisoCupom || produto.aviso || "",
            parcelamento: produto.parcelamento || "",
            linkOriginal: produto.linkOriginal || link,
            link: produto.linkOriginal || link,
            linkAfiliado: "",
            imagem: produto.imagem || "",
            marketplace: "magalu",
            categoria: "Magalu",
            sessaoId: normalizarSessaoId(clienteId, "sessao1"),
            status: "pendente",
            clienteId
          };

          novaOferta = prepararOfertaGlobal(novaOferta);

          if (produtoSuspeito(novaOferta)) continue;
          if (ofertaJaExiste(novaOferta)) continue;

          await distribuirOfertaParaClientes(novaOferta);
          adicionadas++;

          console.log("[INFO] Nova oferta Magalu:", {
            titulo: novaOferta.titulo,
            preco: novaOferta.precoAtual,
            link: novaOferta.link
          });

          await new Promise(r => setTimeout(r, 3000 + Math.random() * 4000));
        } catch (e) {
          console.log("[ERRO] erro produto Magalu:", e.message);
        }
      }

      await new Promise(r => setTimeout(r, 5000 + Math.random() * 6000));
    }

    console.log(`[FILA] Magalu finalizado. Adicionadas: ${adicionadas}`);
  } catch (e) {
    console.log("[ERRO] erro farejador Magalu:", e.message);
  }
}

// ================= FAREJADOR AWIN =================

function precoNumeroAwinOferta(oferta = {}) {
  const valor = oferta.precoAtual || oferta.preco || oferta.search_price || "";
  const numero = Number(String(valor || "")
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "")
    .trim());

  return Number.isFinite(numero) && numero > 0 ? numero : 0;
}

function tituloBomAwinOferta(titulo = "") {
  const texto = normalizarTexto(titulo || "");
  if (texto.length < 12) return false;
  if (/^(produto|item|oferta|kit)$/.test(texto)) return false;
  return /[a-z]{4,}/.test(texto);
}

function imagemValidaAwinOferta(imagem = "") {
  return /^https?:\/\//i.test(String(imagem || "")) && !/logo|placeholder|no-image|sem-imagem/i.test(String(imagem || ""));
}

function destinoCompativelAwinOferta(clienteId = "admin", oferta = {}) {
  try {
    return destinosClienteNormalizados(clienteId).some(destino => destinoAceitaOferta(destino, oferta));
  } catch {
    return false;
  }
}

function chaveSimilarAwinOferta(oferta = {}) {
  const titulo = normalizarTexto(oferta.titulo || oferta.nome || "");
  const palavras = titulo.split(" ")
    .filter(p => p.length >= 4)
    .filter(p => !["para", "com", "sem", "preto", "branco", "branca", "azul", "vermelho", "kit"].includes(p))
    .slice(0, 4);

  return [
    normalizarTexto(oferta.categoria || ""),
    ...palavras
  ].filter(Boolean).join("|");
}

function pontuarCandidatoAwin(clienteId = "admin", oferta = {}, repeticoesCategoria = {}) {
  const preco = precoNumeroAwinOferta(oferta);
  const categoria = normalizarTexto(oferta.categoria || "");
  let score = 0;

  if (destinoCompativelAwinOferta(clienteId, oferta)) score += 1000;
  if (imagemValidaAwinOferta(oferta.imagem)) score += 120;
  if (tituloBomAwinOferta(oferta.titulo || oferta.nome || "")) score += 80;
  if (preco > 0) score += Math.max(0, 500 - Math.min(preco, 500));
  score -= Number(repeticoesCategoria[categoria] || 0) * 80;
  if (preco >= 1000) score -= 250;
  if (preco >= 2000) score -= 500;

  return score;
}

async function farejarAwin(clienteId = "admin", deps = {}) {

  const {
    config,
    integracoesPorCliente,
    getIntegracaoCliente,
    fila,
    salvarFila,
    prepararOfertaGlobal,
    ofertaJaExiste,
    classificarCategoriaOferta,
    aplicarFiltrosUniversais,
    gerarDeepLinkAwin,
    normalizarSessaoId
  } = deps;

  try {
    if (farejadoresAutoDesativados()) {
      logFarejadorAutoDesativado("awin", "farejador_awin", clienteId);
      return {
        produtosEncontrados: 0,
        ofertasMontadas: 0,
        aprovados: 0,
        adicionados: 0,
        principalMotivoZero: "farejadores_auto_desativados"
      };
    }

    console.log("[INFO] Farejando produtos reais Awin KaBuM...", {
      clienteId
    });

    const cfg = config.marketplaces?.awin || {};

    if (!cfg.ativo) {
      console.log("[AVISO] Awin desativada. Farejador ignorado.");
      return;
    }

    const integracaoAwin = typeof getIntegracaoCliente === "function"
      ? getIntegracaoCliente(clienteId, "awin")
      : integracoesPorCliente?.[clienteId]?.awin;

    if (!integracaoAwin?.credenciais) {
      console.log(
        "❌ Awin sem integração configurada:",
        clienteId
      );
      return;
    }

    const itensClienteAwin = Array.isArray(fila)
      ? fila.filter(item => String(item?.clienteId || "admin") === String(clienteId || "admin"))
      : [];
    const pendentesClienteAwin = itensClienteAwin.filter(item => String(item?.status || "") === "pendente").length;
    const pendentesAwin = itensClienteAwin.filter(item =>
      String(item?.status || "") === "pendente" &&
      normalizarTexto(item?.marketplace || item?.mercado || "") === "awin"
    ).length;
    const limiteAwinPendente = pendentesClienteAwin < 10
      ? Math.max(0, 2 - pendentesAwin)
      : 0;

    if (limiteAwinPendente <= 0) {
      console.log("[AWIN-FALLBACK-LIMITE]", {
        clienteId,
        pendentesCliente: pendentesClienteAwin,
        pendentesAwin,
        limiteAwinPendente: 2,
        motivo: pendentesAwin >= 2 ? "limite_awin_pendente" : "fila_nao_precisa_fallback_awin"
      });
      return {
        produtosEncontrados: 0,
        ofertasMontadas: 0,
        aprovados: 0,
        adicionados: 0,
        principalMotivoZero: pendentesAwin >= 2 ? "limite_awin_pendente" : "fila_nao_precisa_fallback_awin"
      };
    }

    const limitePorRodada = Math.min(3, Number(cfg.limitePorRodada || 3) || 3, limiteAwinPendente);
    const limiteCandidatosAwin = Math.max(30, limitePorRodada * 12);
    const precoMinimo = cfg.precoMinimo || 20;
    const feedFile = cfg.feedFile || "awin_kabum.csv";

    const caminhoFeed = path.join(__dirname, feedFile);

    if (!fs.existsSync(caminhoFeed)) {
      console.log(
        "❌ Feed Awin não encontrado:",
        caminhoFeed
      );
      return;
    }


    const produtos = [];

    await new Promise((resolve, reject) => {
    fs.createReadStream(caminhoFeed)
    .pipe(zlib.createGunzip())
    .pipe(csv())
    .on("data", (row) => {
      produtos.push(row);
    })
    .on("end", resolve)
    .on("error", reject);
    });

    console.log("[INFO] Produtos no feed Awin:", produtos.length);

    let candidatosAwin = 0;
    let ofertasEncontradas = [];

    for (const item of produtos) {
      if (ofertasEncontradas.length >= limiteCandidatosAwin) break;

      const titulo = item.product_name || item.name || "";
      const preco = Number(String(item.search_price || "0").replace(",", "."));
      const imagem = item.merchant_image_url || item.aw_image_url || "";
      const link = item.aw_deep_link || item.product_url || item.merchant_deep_link || "";
      const categoriaOriginal =
      item.merchant_category ||
      item.category_name ||
      item.aw_category ||
      "KaBuM";

     const categoria = classificarCategoriaOferta(
     {
     titulo,
     nome: titulo,
     descricao: item.description || item.product_short_description || "",
     categoria: categoriaOriginal
     },
    `${titulo} ${categoriaOriginal}`
     );

      if (!titulo || !link) continue;
      if (preco < precoMinimo) continue;

      if (produtoRepetidoRecentemente(titulo, 24)) {
        console.log("[AVISO] Awin repetido ignorado:", titulo);
        continue;
      }

     const clienteOfertaId = String(clienteId || "admin");

     const oferta = {
        id: Date.now() + "-" + Math.random().toString(36).slice(2),
        titulo,
        precoAtual: preco ? `R$ ${preco.toFixed(2).replace(".", ",")}` : "",
        precoAntigo: "",
        cupom: "",
        avisoCupom: "",
        parcelamento: "",
        imagem,
        linkOriginal: item.product_url || item.merchant_deep_link || link,
        link: item.product_url || item.merchant_deep_link || link,
        linkAfiliado: "",
        marketplace: "awin",
        loja: "KaBuM",
        categoria,
        categoriaOriginal,
        status: "pendente",
        clienteId: clienteOfertaId,
        sessaoId: normalizarSessaoId(clienteOfertaId, "sessao1"),
        criadoEm: new Date().toISOString()
      };

       ofertasEncontradas.push(oferta);
      candidatosAwin++;

      console.log("[INFO] Produto Awin encontrado:", titulo);
    }

    const ofertasFiltradas = aplicarFiltrosUniversais(
      ofertasEncontradas,
      {
        preferirEnvioBrasil: false,
        bloquearSemImagem: true,
        bloquearSemPreco: true,
      }
    );

    console.log(
      `🧠 Ofertas Awin após filtros universais: ${ofertasFiltradas.length}`
    );

   const repeticoesCategoriaAwin = {};
   for (const itemFila of Array.isArray(fila) ? fila : []) {
     if (String(itemFila?.clienteId || "admin") !== String(clienteId || "admin")) continue;
     const categoriaFila = normalizarTexto(itemFila?.categoria || "");
     if (categoriaFila) repeticoesCategoriaAwin[categoriaFila] = (repeticoesCategoriaAwin[categoriaFila] || 0) + 1;
   }

   const ofertasOrdenadas = [...ofertasFiltradas]
     .map(oferta => ({
       ...oferta,
       __awinScore: pontuarCandidatoAwin(clienteId, oferta, repeticoesCategoriaAwin)
     }))
     .sort((a, b) => {
       const score = Number(b.__awinScore || 0) - Number(a.__awinScore || 0);
       if (score !== 0) return score;
       return precoNumeroAwinOferta(a) - precoNumeroAwinOferta(b);
     });

   let adicionadasFila = 0;
   let ignoradosPorLimite = 0;
   let ignoradosParecidos = 0;
   let ignoradosSemDeeplink = 0;
   let ignoradosDuplicados = 0;
   const similaresRodada = new Set();
   const categoriasRodada = {};

   for (const oferta of ofertasOrdenadas) {
     if (adicionadasFila >= limitePorRodada) {
       ignoradosPorLimite += 1;
       continue;
     }

     const chaveSimilar = chaveSimilarAwinOferta(oferta);
     const categoriaOferta = normalizarTexto(oferta.categoria || "");
     if (chaveSimilar && similaresRodada.has(chaveSimilar)) {
       ignoradosParecidos += 1;
       continue;
     }
     if (categoriaOferta && Number(categoriasRodada[categoriaOferta] || 0) >= 1 && ofertasOrdenadas.length > limitePorRodada) {
       ignoradosParecidos += 1;
       continue;
     }
     const linkBaseAwin = oferta.linkOriginal || oferta.link || "";
     const linkAfiliadoCliente = typeof gerarDeepLinkAwin === "function"
       ? await gerarDeepLinkAwin(linkBaseAwin, clienteId)
       : "";

     if (!linkAfiliadoCliente) {
       logOptimus("INTEGRACAO", "Feed AWIN ignorado sem deeplink do cliente", {
         clienteId,
         marketplace: "awin",
         titulo: oferta.titulo
       });
       ignoradosSemDeeplink += 1;
       continue;
     }

     oferta.linkAfiliado = linkAfiliadoCliente;
     oferta.link = linkAfiliadoCliente;
     oferta.clienteId = clienteId;
     oferta.sessaoId = normalizarSessaoId(clienteId, "sessao1");

     const ofertaFinal = typeof prepararOfertaGlobal === "function"
       ? prepararOfertaGlobal(oferta)
       : oferta;

     if (typeof ofertaJaExiste === "function" && ofertaJaExiste(ofertaFinal)) {
       ignoradosDuplicados += 1;
       continue;
     }

     if (bloquearAwinKabumAutoNaFila(ofertaFinal, "feed_awin", clienteId)) {
       continue;
     }

      filaOfertas.adicionarOfertaFila(fila, ofertaFinal, {
        clienteId,
        origem: ofertaFinal.origem || "feed_awin",
        logger: console
      });
      adicionadasFila += 1;
     if (chaveSimilar) similaresRodada.add(chaveSimilar);
     if (categoriaOferta) categoriasRodada[categoriaOferta] = (categoriasRodada[categoriaOferta] || 0) + 1;

     if (typeof salvarFila === "function") {
       salvarFila(clienteId);
     }
   }

    const motivosAwin = {
      limite: ignoradosPorLimite,
      parecidos: ignoradosParecidos,
      sem_deeplink: ignoradosSemDeeplink,
      duplicados: ignoradosDuplicados
    };
    const motivoPrincipalAwin = Object.entries(motivosAwin)
      .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
      .find(([, total]) => Number(total || 0) > 0)?.[0] || "";

    console.log("[AWIN-LIMITE-RODADA]", {
      clienteId,
      candidatos: ofertasEncontradas.length,
      aprovados: ofertasOrdenadas.length,
      adicionados: adicionadasFila,
      limite: limitePorRodada,
      ignoradosPorLimite,
      motivoPrincipal: motivoPrincipalAwin || (adicionadasFila > 0 ? "" : "sem_candidato_aprovado")
    });

    console.log(`[INFO] Awin finalizado. Produtos adicionados: ${adicionadasFila}`);

    return {
      produtosEncontrados: produtos.length,
      ofertasMontadas: ofertasEncontradas.length,
      aprovados: ofertasOrdenadas.length,
      adicionados: adicionadasFila,
      principalMotivoZero: motivoPrincipalAwin || (adicionadasFila > 0 ? "" : "sem_candidato_aprovado")
    };
  } catch (e) {
    console.log("[ERRO]❌ erro farejador Awin:", e.message);
  }
}


// ================= IMPORTAR PRODUTO MANUAL UNIVERSAL =================

app.post("/importar-produto", async (req, res) => {
  try {
    const inicioRotaImportacaoMl = Date.now();
    const marketplaceEntradaImportacao = detectarMarketplaceManual(req.body?.url, req.body?.marketplace);
    const medirImportacaoManualMl = marketplaceEntradaImportacao === "mercadolivre";
    const clienteId = getClienteId(req);

    const resultado = await importarProdutoManual(req, {
      getClienteId,
      integracoesPorCliente,
      getIntegracaoCliente,

      importarAmazon,
      importarAliExpress,
      importarMagalu,
      importarMercadoLivre,
      importarShopee,

      gerarLinkAfiliadoMercadoLivre,
        resolverLinkOriginalRadar
      });

    const marketplaceResultado = String(resultado.body?.marketplace || "").toLowerCase();
    const avisoResultado = String(resultado.body?.aviso || "").toLowerCase();

    if (["mercadolivre", "amazon"].includes(marketplaceResultado)) {
      if (resultado.body?.manual === true && !resultado.body?.aviso) {
        if (marketplaceResultado === "mercadolivre") {
          const linkMlImportado = String(
            resultado.body?.linkAfiliado ||
            resultado.body?.linkFinal ||
            resultado.body?.link ||
            ""
          ).trim();

          if (/^https?:\/\/meli\.la\//i.test(linkMlImportado)) {
            salvarResultadoTesteIntegracao(clienteId, "mercadolivre", {
              status: "ok",
              mensagem: MENSAGEM_TESTE_OK
            });
          }
        }

        if (marketplaceResultado === "amazon") {
          const linkAmazonImportado = String(
            resultado.body?.linkAfiliado ||
            resultado.body?.linkFinal ||
            resultado.body?.link ||
            resultado.body?.linkOriginal ||
            ""
          ).trim();
          const tagAmazon = extrairTagAmazonIntegracao(integracoesPorCliente?.[clienteId]?.amazon || {});

          if (linkAmazonImportado && (!tagAmazon || linkAmazonImportado.includes(`tag=${encodeURIComponent(tagAmazon)}`) || linkAmazonImportado.includes(`tag=${tagAmazon}`))) {
            salvarResultadoTesteIntegracao(clienteId, "amazon", {
              status: "ok",
              mensagem: MENSAGEM_TESTE_OK
            });
          }
        }

        limparAlertaIntegracao(clienteId, marketplaceResultado);
      } else if (avisoResultado.includes("erro ao consultar")) {
        if (marketplaceResultado === "mercadolivre") {
          registrarAlertaMercadoLivre(clienteId, "importacao_falhou", {
            aviso: resultado.body?.aviso || ""
          });
        }

        if (marketplaceResultado === "amazon") {
          registrarAlertaAmazon(clienteId, "importacao_falhou", {
            aviso: resultado.body?.aviso || ""
          });
        }
      }
    }

    if (medirImportacaoManualMl) {
      console.log("[PERF][ML_IMPORTACAO_MANUAL_ROTA]", {
        clienteId,
        marketplaceResultado,
        duracaoMs: Date.now() - inicioRotaImportacaoMl,
        statusCode: resultado.status || 200,
        temAviso: !!resultado.body?.aviso
      });
    }

    return res
      .status(resultado.status || 200)
      .json(resultado.body);

  } catch (e) {
    console.log("[API] erro rota importar-produto:", e.message);

    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

// ================= WHATSAPP SESSOES =================

app.get("/sessoes", (req, res) => {
  const clienteId = getClienteId(req);
  const lista = listarSessoesWhatsappCliente(clienteId);

  return res.json({
    ok: true,
    sessoes: lista
  });
});

app.post("/sessoes", (req, res) => {
   console.log("[WHATSAPP] Nova sesso solicitada:", {
  nome: req.body?.nome,
  id: req.body?.id
});

  const clienteId = getClienteId(req);

  const planoUsuario = getPlanoUsuario(req);

  const limite = isAdminMaster(req)
  ? 999
  : Number(planoUsuario?.limites?.sessoes || 1);

 const sessoesCliente = Object.values(sessoesMeta)
  .filter(s => {
    const id = String(s.id || "");

    return (
      id.startsWith(clienteId + "_") ||
      id === clienteId ||
      (clienteId === "admin" && id.startsWith("admin_"))
    );
  });

  if (!isAdminMaster(req) && sessoesCliente.length >= limite) {
  return res.status(403).json({
    ok: false,
    erro: `Seu plano permite apenas ${limite} sessão(ões).`
  });
}

  try {
    const nome = req.body.nome || "WhatsApp";
    const tipo = req.body.tipo || "whatsapp";

    const idRecebido = String(req.body.id || "").trim();

    const nomeSessao =
    !idRecebido || idRecebido === "sessao1"
    ? gerarProximaSessaoId(clienteId)
    : idRecebido;

const id = normalizarSessaoId(
  clienteId,
  nomeSessao
);

    if (sessoesMeta[id]) {
      return res.status(400).json({
        ok: false,
        erro: "Sessão já existe"
      });
    }

    sessoesMeta[id] = {
      id,
      nome,
      tipo,
      criadoEm: new Date().toISOString()
    };

    salvarSessoesMeta();

console.log("[WHATSAPP]💾 Sesso criada e salva:", sessoesMeta[id]);

    return res.json({
      ok: true,
      sessao: sessoesMeta[id]
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.delete("/sessoes/:id", async (req, res) => {
  try {
  const clienteId = getClienteId(req);

  const id = normalizarSessaoId(
  clienteId,
  req.params.id
  );

const idsPossiveis = [...new Set([
  id,
  req.params.id
])];

    try {
      if (sessoes[id]?.sock?.logout) {
        await sessoes[id].sock.logout();
      }
    } catch (e) {
      console.log("[AVISO] logout ignorado ao excluir:", e.message);
    }

    try {
      sessoes[id]?.sock?.end?.();
    } catch (e) {
      console.log("[AVISO] end ignorado ao excluir:", e.message);
    }

for (const sid of idsPossiveis) {
  delete sessoes[sid];
  delete qrCodes[sid];
  delete statusSessao[sid];
  delete destinosPorSessao[sid];
  delete gruposPorSessao[sid];
  delete reconectando[sid];
  delete sessoesMeta[sid];

  fs.rmSync("/data/auth_" + sid, {
    recursive: true,
    force: true
  });
}

removerReferenciasSessao(idsPossiveis, clienteId);

const destinosCliente = destinosPorCliente?.[clienteId] || [];

const listasDestinosCliente = Array.isArray(destinosCliente)
  ? [destinosCliente]
  : Object.values(destinosCliente || {}).filter(Array.isArray);

for (const listaDestino of listasDestinosCliente) {
  for (const destino of listaDestino) {
    if (destino.conexaoId && idsPossiveis.includes(destino.conexaoId)) {
      destino.conexaoId = "";
    }

    if (Array.isArray(destino.sessoes)) {
      destino.sessoes = destino.sessoes.filter(
        s => !idsPossiveis.includes(s)
      );
    }

    if (Array.isArray(destino.sessoesWhatsapp)) {
      destino.sessoesWhatsapp = destino.sessoesWhatsapp.filter(
        s => !idsPossiveis.includes(s)
      );
    }
  }
}

salvarDestinosClientes();
salvarConfigsClientes();
salvarConfig();

    salvarSessoesMeta();

    return res.json({
      ok: true,
      message: "Sessão excluída com sucesso",
      id
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

app.post("/reset/:id", async (req, res) => {
 const clienteId = getClienteId(req);
 const id = normalizarSessaoId(clienteId, req.params.id);

  try {
    console.log("[WHATSAPP] Resetando sesso:", id);

    if (typeof reconectando !== "undefined") {
      reconectando[id] = false;
    }

    if (sessoes[id]) {

      try {
        await sessoes[id]?.logout?.();
      } catch (e) {
        console.log("[AVISO] logout ignorado:", e.message);
      }

      try {
        sessoes[id]?.end?.();
      } catch (e) {
        console.log("[AVISO] end ignorado:", e.message);
      }

      delete sessoes[id];
    }

    if (typeof qrCodes !== "undefined") {
      delete qrCodes[id];
    }

    if (typeof statusSessao !== "undefined") {
      delete statusSessao[id];
    }

    if (typeof destinosPorSessao !== "undefined") {
      delete destinosPorSessao[id];
    }

    delete gruposPorSessao[id];
    delete reconectando[id];
    delete sessoesMeta[id];

    removerReferenciasSessao([id], clienteId);
    salvarDestinosClientes();
    salvarConfigsClientes();
    salvarConfig();
    salvarSessoesMeta();


    fs.rmSync("/data/auth_" + id, {
      recursive: true,
      force: true
    });

    return res.json({
      ok: true,
      message: "Sessão resetada. Gere novo QR.",
      id
    });

  } catch (e) {
    console.log("[ERRO]❌ [WHATSAPP] erro reset sesso:", e.message);

    return res.status(500).json({
      ok: false,
      erro: e.message
    });
  }
});

// ===================== FUNÇÃO LIMETE SESSÃO WHATSAPP ========================

function obterLimiteSessoesCliente(clienteId) {
  const usuario = obterUsuario(clienteId);
  const nomePlano = String(usuario?.plano || "free").toLowerCase();
  const plano = getPlanoPorNome(nomePlano);

  return Number(
    plano?.limites?.sessoes ||
    usuario?.limites?.sessoes ||
    1
  );
}

function listarSessoesCliente(clienteId) {
  config.sessoesWhatsapp = config.sessoesWhatsapp || [];

  return config.sessoesWhatsapp.filter(id =>
    String(id).startsWith(`${clienteId}_`)
  );
}

function gerarProximaSessaoId(clienteId) {
  const sessoesCliente = listarSessoesCliente(clienteId);

  const numeros = sessoesCliente
    .map(id => {
      const match = String(id).match(/_sessao(\d+)$/);
      return match ? Number(match[1]) : 0;
    })
    .filter(n => Number.isFinite(n));

  const proximo = numeros.length
    ? Math.max(...numeros) + 1
    : 1;

  return `sessao${proximo}`;
}

// ========================== ROTA CONECTAR ================================

app.post("/conectar", async (req, res) => {
  const clienteId = getClienteId(req);

  if (!clienteId) {
    return res.status(401).json({ erro: "Usuário não identificado" });
  }

  config.sessoesWhatsapp = config.sessoesWhatsapp || [];

 const limiteSessoes = isAdminMaster(req)
  ? 999
  : obterLimiteSessoesCliente(clienteId);

const sessoesCliente = listarSessoesCliente(clienteId);

if (!isAdminMaster(req) && sessoesCliente.length >= limiteSessoes) {


    return res.status(403).json({
      ok: false,
      erro: `Seu plano permite até ${limiteSessoes} sessão(ões) WhatsApp.`,
      limite: limiteSessoes,
      usadas: sessoesCliente.length
    });
  }

  const idRecebido = String(
    req.body?.id ||
    req.body?.sessaoId ||
    ""
  ).trim();

  const idBase =
    !idRecebido || idRecebido === "sessao1"
      ? gerarProximaSessaoId(clienteId)
      : idRecebido;

  const sessaoId = normalizarSessaoId(clienteId, idBase);

  if (config.sessoesWhatsapp.includes(sessaoId)) {
    return res.status(400).json({
      ok: false,
      erro: "Já existe uma conexão com esse ID. Tente criar uma nova conexão novamente.",
      id: sessaoId
    });
  }

  config.sessoesWhatsapp.push(sessaoId);
  salvarConfig();

  console.log("[WHATSAPP]💾 Sesso WhatsApp salva para reconexo:", {
    clienteId,
    sessaoId,
    limiteSessoes,
    usadas: sessoesCliente.length + 1
  });

  iniciarWhatsApp(sessaoId, false);

  return res.json({
    ok: true,
    message: "Sessão iniciada",
    id: sessaoId
  });
});


// ================= FUNCAO CARREGAR SESSAO ID ==========================

async function carregarGruposSessao(id, opcoes = {}) {
  const resolucaoClienteMensageiro = opcoes.clienteId
    ? { clienteIdMensageiro: opcoes.clienteId, origemResolucao: "mapa_sessao" }
    : resolverClienteMensageiroPorSessao(id);
  const clienteId = resolucaoClienteMensageiro.clienteIdMensageiro;

  console.log("[WHATSAPP] Tentando carregar grupos da sesso:", {
    id,
    clienteId,
    origemResolucao: resolucaoClienteMensageiro.origemResolucao
  });

  const idNormalizado = normalizarSessaoId(clienteId, id);

  const sessao =
    sessoes[id] ||
    sessoes[idNormalizado] ||
    sessoes[`${clienteId}_${id}`];

  const sock = sessao?.sock || sessao;

  const chaveCache =
    sessoes[id] ? id :
    sessoes[idNormalizado] ? idNormalizado :
    sessoes[`${clienteId}_${id}`] ? `${clienteId}_${id}` :
    idNormalizado;

  const chavesCache = [...new Set([chaveCache, id, idNormalizado].filter(Boolean))];
  const cacheAntes = chavesCache
    .map(chave => gruposPorSessao[chave])
    .find(lista => Array.isArray(lista) && lista.length) || [];
  const totalAntesCache = cacheAntes.length;
  const meta = opcoes.meta && typeof opcoes.meta === "object" ? opcoes.meta : null;

  const registrarRefresh = ({ lista, gruposNovos = 0, usouCache = false, erro = "" }) => {
    const gruposResultado = Array.isArray(lista) ? lista : [];

    console.log("[WHATSAPP-GRUPOS-REFRESH]", {
      clienteId,
      sessaoId: id,
      totalAntesCache,
      totalDepoisRefresh: gruposResultado.length,
      gruposNovos,
      usouCache,
      erro
    });

    if (meta) {
      meta.clienteId = clienteId;
      meta.sessaoId = id;
      meta.totalAntesCache = totalAntesCache;
      meta.totalDepoisRefresh = gruposResultado.length;
      meta.gruposNovos = gruposNovos;
      meta.usouCache = usouCache;
      meta.erro = erro;
    }

    return gruposResultado;
  };

  const mesclarGrupos = (antigos = [], novos = []) => {
    const mapa = new Map();
    const normalizarGrupo = grupo => {
      const grupoId = String(grupo?.id || grupo?.grupoId || grupo?.jid || grupo?.remoteJid || "").trim();
      if (!grupoId) return null;

      return {
        ...grupo,
        id: grupoId,
        nome: String(grupo?.nome || grupo?.name || grupo?.subject || "Grupo sem nome").trim() || "Grupo sem nome"
      };
    };

    for (const grupo of antigos) {
      const normalizado = normalizarGrupo(grupo);
      if (normalizado) mapa.set(normalizado.id, normalizado);
    }

    let gruposNovos = 0;
    for (const grupo of novos) {
      const normalizado = normalizarGrupo(grupo);
      if (!normalizado) continue;
      if (!mapa.has(normalizado.id)) gruposNovos += 1;
      mapa.set(normalizado.id, {
        ...mapa.get(normalizado.id),
        ...normalizado
      });
    }

    return { lista: [...mapa.values()], gruposNovos };
  };

  const salvarCacheGrupos = lista => {
    for (const chave of chavesCache) {
      gruposPorSessao[chave] = lista;
    }
  };

  if (!sock) {
    console.log("[WHATSAPP] No carregou grupos: sem sesso", id);
    return registrarRefresh({
      lista: cacheAntes,
      usouCache: true,
      erro: "sessao_sem_socket"
    });
  }

  if (typeof sock.groupFetchAllParticipating !== "function") {
    console.log("[WHATSAPP] Sesso existe, mas no tem groupFetchAllParticipating:", id);
    return registrarRefresh({
      lista: cacheAntes,
      usouCache: true,
      erro: "groupFetchAllParticipating_indisponivel"
    });
  }

  try {
    const grupos = await sock.groupFetchAllParticipating();

    console.log(
      "👥 Grupos carregados:",
      Object.keys(grupos || {}).length
    );

    const listaRefresh = Object.entries(grupos || {}).map(([gid, g]) => ({
      id: gid,
      nome: g.subject || "Grupo sem nome"
    }));

    const { lista, gruposNovos } = mesclarGrupos(cacheAntes, listaRefresh);
    salvarCacheGrupos(lista);

    console.log(`[OK] Grupos carregados automaticamente: ${lista.length}`);

    return registrarRefresh({
      lista,
      gruposNovos,
      usouCache: false,
      erro: ""
    });
  } catch (e) {
    console.log("[ERRO] Erro ao carregar grupos:", e.message);
    return registrarRefresh({
      lista: cacheAntes,
      usouCache: true,
      erro: e.message || "erro_refresh_grupos"
    });
  }
}

//================= POST MAGALU =======================================
app.post("/magalu/gerar-link", (req, res) => {
  try {
    const { link } = req.body;

    const promoterId = integracoes?.magalu?.promoterId;

    if (!promoterId) {
      return res.status(400).json({
        ok: false,
        erro: "Magalu não configurada."
      });
    }

    if (!link) {
      return res.status(400).json({
        ok: false,
        erro: "Informe o link."
      });
    }

    const linkAfiliado = gerarLinkMagalu(link, promoterId);

    res.json({
      ok: true,
      marketplace: "magalu",
      linkOriginal: link,
      linkAfiliado
    });

  } catch (err) {
    console.error("[ERRO] Erro Magalu:", err);

    res.status(500).json({
      ok: false,
      erro: "Erro ao gerar link Magalu"
    });
  }
});


// ================= GRUPOS ID ==============================

app.get("/grupos/:id", async (req, res) => {
  try {
    const clienteId = getClienteId(req);
    const id = normalizarSessaoId(clienteId, req.params.id);
    const force = ["true", "1", "sim", "yes"].includes(String(req.query.force || req.query.refresh || "").toLowerCase());

    const status = statusSessao[id];

console.log("[INFO] ROTA /grupos buscando:", {
      id,
      force,
      temCache: !!gruposPorSessao[id]?.length,
      totalCache: gruposPorSessao[id]?.length || 0
    });

    const metaRefreshGrupos = {};
    const grupos = await carregarGruposSessao(id, { force: true, clienteId, meta: metaRefreshGrupos });

    return res.json({
      ok: true,
      id,
      total: grupos.length,
      grupos,
      gruposLista: grupos,
      cache: Boolean(metaRefreshGrupos.usouCache),
      atualizado: !metaRefreshGrupos.usouCache,
      refresh: metaRefreshGrupos
    });
  } catch (e) {
    console.log("[ERRO] Erro rota /grupos/:id:", e.message);

    return res.status(500).json({
      ok: false,
      erro: e.message,
      total: 0,
      grupos: [],
      gruposLista: []
    });
  }
});

app.post("/grupos/:id/refresh", async (req, res) => {
  try {
    const clienteId = getClienteId(req);
    const id = normalizarSessaoId(clienteId, req.params.id);
    const status = statusSessao[id];

const metaRefreshGrupos = {};
    const grupos = await carregarGruposSessao(id, { force: true, clienteId, meta: metaRefreshGrupos });

    return res.json({
      ok: true,
      id,
      total: grupos.length,
      grupos,
      gruposLista: grupos,
      cache: Boolean(metaRefreshGrupos.usouCache),
      atualizado: !metaRefreshGrupos.usouCache,
      refresh: metaRefreshGrupos
    });
  } catch (e) {
    console.log("[ERRO] Erro rota /grupos/:id/refresh:", e.message);
    return res.status(500).json({
      ok: false,
      erro: "Erro ao atualizar grupos"
    });
  }
});

// ================= ROTA QRCOD ID ==============================

app.get("/qr/:id", (req, res) => {
  const clienteId = getClienteId(req);
  const idOriginal = req.params.id;

  const id = normalizarSessaoId(clienteId, idOriginal);

console.log("[WHATSAPP] Buscando QR:", {
  clienteId,
  id,
  temQr: !!qrCodes[id],
  status: statusSessao[id]
});

  if (!qrCodes[id]) {
    return res.json({
      ok: false,
      status: statusSessao[id] || "loading",
      qr: null,
      qrCode: null,
      id
    });
  }

  return res.json({
    ok: true,
    status: "ready",
    qr: qrCodes[id],
    qrCode: qrCodes[id],
    id
  });
});

// ===================== ROTA STATUS ==========================

app.get("/status/:id", (req, res) => {
  const clienteId = getClienteId(req);

  const id = normalizarSessaoId(
    clienteId,
    req.params.id
  );

  return res.json({
    ok: true,
    id,
    status: statusSessao[id] || "offline",
    conectado: statusSessao[id] === "open" || statusSessao[id] === "aberto",
    qrDisponivel: !!qrCodes[id],
    grupos: gruposPorSessao[id]?.length || 0
  });
});

app.get("/fila/status", (req, res) => {
  const clienteId = getClienteId(req);

  const itensCliente = fila.filter(o =>
    String(o.clienteId || "admin") === String(clienteId)
  );

  return res.json({
    ok: true,
    clienteId,
    total: itensCliente.length,
    pendentes: itensCliente.filter(o => o.status === "pendente").length,
    enviados: itensCliente.filter(o => o.status === "enviado").length,
    retidas: itensCliente.filter(o => o.status === "retida").length,
    erros: itensCliente.filter(o => o.status === "erro").length
  });
});


// =================== POST DESTINOS ================================

app.post("/destinos/:id", (req, res) => {
  const destinos = normalizarDestinosContrato(req.body?.destinos);

  if (!Array.isArray(destinos)) {
    return res.status(400).json({ erro: "destinos deve ser array" });
  }

const planoUsuario = getPlanoUsuario(req);

const limiteDestinos = isAdminMaster(req)
  ? 999
  : Number(planoUsuario?.limites?.destinos || 3);

  if (destinos.length > limiteDestinos) {
    return res.status(403).json({
      ok: false,
      erro: `Seu plano permite apenas ${limiteDestinos} destino(s).`
    });
  }

  const clienteId = getClienteId(req);

  const id = normalizarSessaoId(
  clienteId,
  req.params.id
);

  destinosPorSessao[id] = destinos;

  if (!config.destinosPorSessao) {
    config.destinosPorSessao = {};
  }

  destinosPorCliente[clienteId] =
  destinosPorCliente[clienteId] || {};

 destinosPorCliente[clienteId][id] = destinos;

 salvarDestinosClientes();
  console.log("[DESTINO]💾 Destinos salvos na config:", id, destinos);

  return res.json({
    ok: true,
    destinos
  });
});

app.get("/destinos/:id", (req, res) => {
  const clienteId = getClienteId(req);

  const id = normalizarSessaoId(
  clienteId,
  req.params.id
 );

  const destinos =
    normalizarDestinosContrato(destinosPorCliente?.[clienteId]?.[id] || []);

  return res.json({
    ok: true,
    destinos
  });
});

// ================ CAMPANHAS =======================


function depsCampanhasManual() {
  return {
    destinosPorCliente,
    sessoes,
    configsPorCliente,
    usuarioTemCreditos,
    debitarCreditos,
    corrigirImagemUrl
  };
}
app.post(
  "/campanhas/midia/upload",
  express.raw({
    type: req => /^multipart\/form-data/i.test(String(req.headers["content-type"] || "")),
    limit: process.env.CAMPANHAS_MEDIA_MAX_BODY || "55mb"
  }),
  (req, res) => {
    try {
      const clienteId = getClienteId(req);
      limparMidiasOrfas({ clienteId });
      const multipart = parseMultipartFormData(
        Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
        req.headers["content-type"] || ""
      );
      const arquivo = multipart.arquivos.find(item => item.campo === "arquivo") || multipart.arquivos[0];
      if (!arquivo) throw new Error("campanhas_midia_arquivo_obrigatorio");
      const midia = salvarMidiaTemporaria({
        clienteId,
        buffer: arquivo.buffer,
        nomeOriginal: arquivo.nomeOriginal,
        mimeType: arquivo.mimeType,
        tipo: multipart.campos.tipo || multipart.campos.midiaTipo || ""
      });
      return res.json({ ok: true, clienteId, midia });
    } catch (e) {
      return res.status(400).json({ ok: false, erro: e.message || "campanhas_midia_upload_falhou" });
    }
  }
);

app.delete("/campanhas/midia/:midiaId", (req, res) => {
  try {
    const clienteId = getClienteId(req);
    const midia = excluirMidiaTemporaria(clienteId, req.params.midiaId);
    return res.json({ ok: true, clienteId, midia });
  } catch (e) {
    const status = e.message === "campanhas_midia_nao_encontrada" ? 404 : 400;
    return res.status(status).json({ ok: false, erro: e.message || "campanhas_midia_exclusao_falhou" });
  }
});


app.get("/campanhas/historico", (req, res) => {
  try {
    const clienteId = getClienteId(req);
    const limite = Number(req.query?.limite || req.query?.limit || 100);
    return res.json({
      ok: true,
      clienteId,
      historico: listarHistoricoCampanhas(clienteId, { limite })
    });
  } catch (e) {
    return res.status(400).json({ ok: false, erro: e.message || "campanhas_historico_consulta_falhou" });
  }
});

app.get("/campanhas/historico/:campanhaId", (req, res) => {
  try {
    const clienteId = getClienteId(req);
    const campanha = obterCampanhaHistorico(clienteId, req.params.campanhaId);
    if (!campanha) return res.status(404).json({ ok: false, erro: "campanha_historico_nao_encontrada" });
    return res.json({ ok: true, clienteId, campanha });
  } catch (e) {
    return res.status(400).json({ ok: false, erro: e.message || "campanhas_historico_consulta_falhou" });
  }
});
app.get("/campanhas/agendamentos", (req, res) => {
  try {
    const clienteId = getClienteId(req);
    const limite = Number(req.query?.limite || req.query?.limit || 100);
    const status = req.query?.status || "";
    return res.json({
      ok: true,
      clienteId,
      agendamentos: listarAgendamentosCampanhas(clienteId, { limite, status })
    });
  } catch (e) {
    return res.status(400).json({ ok: false, erro: e.message || "campanhas_agendamentos_consulta_falhou" });
  }
});

app.post("/campanhas/agendamentos", (req, res) => {
  try {
    const clienteId = getClienteId(req);
    const agendamento = salvarAgendamentoCampanha(clienteId, req.body || {});
    return res.json({ ok: true, clienteId, agendamento });
  } catch (e) {
    return res.status(400).json({ ok: false, erro: e.message || "campanhas_agendamento_criacao_falhou" });
  }
});

app.get("/campanhas/agendamentos/:agendamentoId", (req, res) => {
  try {
    const clienteId = getClienteId(req);
    const agendamento = obterAgendamentoCampanha(clienteId, req.params.agendamentoId);
    if (!agendamento) return res.status(404).json({ ok: false, erro: "campanhas_agendamento_nao_encontrado" });
    return res.json({ ok: true, clienteId, agendamento });
  } catch (e) {
    return res.status(400).json({ ok: false, erro: e.message || "campanhas_agendamento_consulta_falhou" });
  }
});

app.post("/campanhas/agendamentos/:agendamentoId/cancelar", (req, res) => {
  try {
    const clienteId = getClienteId(req);
    const agendamento = cancelarAgendamentoCampanha(clienteId, req.params.agendamentoId);
    return res.json({ ok: true, clienteId, agendamento });
  } catch (e) {
    const status = e.message === "campanhas_agendamento_nao_encontrado" ? 404 : 400;
    return res.status(status).json({ ok: false, erro: e.message || "campanhas_agendamento_cancelamento_falhou" });
  }
});

app.delete("/campanhas/agendamentos/:agendamentoId", (req, res) => {
  try {
    const clienteId = getClienteId(req);
    const agendamento = removerAgendamentoCampanha(clienteId, req.params.agendamentoId);
    return res.json({ ok: true, clienteId, agendamento });
  } catch (e) {
    const status = e.message === "campanhas_agendamento_nao_encontrado" ? 404 : 400;
    return res.status(status).json({ ok: false, erro: e.message || "campanhas_agendamento_exclusao_falhou" });
  }
});

app.post("/campanhas/agendamentos/:agendamentoId/executar", async (req, res) => {
  try {
    const clienteId = getClienteId(req);
    const resultado = await executarAgendamentoCampanha({
      clienteId,
      agendamentoId: req.params.agendamentoId,
      deps: depsCampanhasManual()
    });
    return res.status(resultado.ok ? 200 : 400).json({ clienteId, ...resultado });
  } catch (e) {
    const status = e.message === "campanhas_agendamento_nao_encontrado" ? 404 : 400;
    return res.status(status).json({ ok: false, erro: e.message || "campanhas_agendamento_execucao_falhou" });
  }
});
app.post("/campanhas/enviar", async (req, res) => {
  try {
    const clienteId = getClienteId(req);

    const {
      mensagem,
      imagemUrl,
      midiaId,
      destinosIds
    } = req.body || {};

    const resultado = await enviarCampanhaManual({
      clienteId,
      mensagem,
      imagemUrl,
      midiaId,
      destinosIds,
      destinosPorCliente,
      sessoes,
      configsPorCliente,
      usuarioTemCreditos,
      debitarCreditos,
      corrigirImagemUrl
    });

    return res.json({
      ok: true,
      ...resultado
    });

  } catch (e) {
    console.log("[ERRO]❌ Erro campanha manual:", e.message);

    return res.status(400).json({
      ok: false,
      erro: e.message
    });
  }
});
let campanhasAgendamentosRodando = false;
async function rodarAgendamentosCampanhasPendentes() {
  if (campanhasAgendamentosRodando) return;
  campanhasAgendamentosRodando = true;
  try {
    await executarAgendamentosPendentesTodosClientes({ deps: depsCampanhasManual() });
  } catch (e) {
    console.log("[CAMPANHAS-AGENDAMENTO-SCHEDULER-ERRO]", { erro: e.message });
  } finally {
    campanhasAgendamentosRodando = false;
  }
}

if (process.env.CAMPANHAS_AGENDAMENTOS_SCHEDULER !== "false" && !global.__optimusCampanhasAgendamentosScheduler) {
  global.__optimusCampanhasAgendamentosScheduler = true;
  setInterval(rodarAgendamentosCampanhasPendentes, Number(process.env.CAMPANHAS_AGENDAMENTOS_INTERVALO_MS || 60000));
}

// ================= TELEGRAM =================

async function enviarTelegram(oferta, mensagem) {
  try {
    if (!config.telegram?.ativo) {
      console.log("[TELEGRAM] Telegram desativado.");
      return;
    }

    const destinos = config.telegram?.destinos || [];

    if (!destinos.length) {
      console.log("[TELEGRAM] Nenhum destino Telegram configurado.");
      return;
    }

    for (const destino of destinos) {
      if (!destino.ativo) continue;

      const token = destino.botToken;
      const chatId = destino.chatId;

      if (!token || !chatId) {
        console.log("[TELEGRAM] Telegram destino incompleto:", destino.nome);
        continue;
      }

      if (oferta.imagem) {
        await axios.post(`https://api.telegram.org/bot${token}/sendPhoto`, {
          chat_id: chatId,
          photo: corrigirImagemUrl(oferta.imagem) || oferta.imagem,
          caption: mensagem
        });
      } else {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
          chat_id: chatId,
          text: mensagem
        });
      }

      console.log("[TELEGRAM] Telegram enviado:", destino.nome || chatId);

      await new Promise(r => setTimeout(r, 1500));
    }

  } catch (e) {
    console.log("[ERRO] [TELEGRAM] Erro Telegram:", e.message);
  }
}


// ================= FUNCÃO WHATSAPP =================

async function iniciarWhatsApp(id, force = false) {
  console.log("[WHATSAPP] Iniciando sesso:", id, "force:", force);

  const chaveSessao = id;
  const statusAtual = statusSessao[chaveSessao];

  if (!force && sessoes[id] && ["connecting", "qr", "open", "reconnecting"].includes(statusAtual)) {
    console.log("[WHATSAPP] Sesso j em andamento, no vou recriar:", id, statusAtual);
    return sessoes[id];
  }

  if (!force && qrCodes[id] && statusAtual === "qr") {
    console.log("[WHATSAPP] QR j ativo, no vou recriar:", id);
    return sessoes[id] || null;
  }

  if (force && sessoes[id]) {
    try {
      console.log("[WHATSAPP] Forando reincio da sesso:", id);
      sessoes[id].end?.();
    } catch (e) {
      console.log("[ERRO] [WHATSAPP] Erro ao encerrar sesso antiga:", e.message);
    }

    delete sessoes[id];
    qrCodes[id] = null;
  }

  statusSessao[id] = "connecting";
  reconectando[id] = false;

  const { state, saveCreds } = await useMultiFileAuthState("/data/auth_" + id);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    browser: ["Chrome", "Desktop", "1.0.0"]
  });

  sessoes[id] = sock;

  sock.ev.on("creds.update", saveCreds);

const resolucaoClienteMensageiro = resolverClienteMensageiroPorSessao(id);
const clienteIdMensageiro = resolucaoClienteMensageiro.clienteIdMensageiro;

console.log("[INFO] Cliente mensageiro resolvido:", {
  sessao: id,
  clienteIdMensageiro,
  origemResolucao: resolucaoClienteMensageiro.origemResolucao
});

// =============== EVENTO MENSAGEIRO =================

sock.ev.on("messages.upsert", async ({ messages = [] } = {}) => {
  try {
    for (const mensagem of messages) {
      await processarMensagemRadarAutomatica({
        mensagem,
        sessaoId: id,
        sock
      });

      await mensageiro.tratarMensagemPrivadaAtendimento({
        clienteId: clienteIdMensageiro,
        sessaoId: id,
        sock,
        mensagem,
        planoLiberado: clienteTemRecursoMensageiro(clienteIdMensageiro)
      });
    }
  } catch (e) {
    console.log("[MENSAGEIRO-ERRO]⚠️ messages.upsert:", e.message);
  }
});

sock.ev.on("group-participants.update", async (evento) => {

  console.log("[INFO] EVENTO GRUPO MENSAGEIRO:", {
    quando: new Date().toISOString(),
    clienteIdMensageiro,
    sessaoId: id,
    grupoId: evento?.id,
    acao: evento?.action,
    participantes: evento?.participants
  });

   try {
    await mensageiro.tratarEventoGrupoMensageiro({
      clienteId: clienteIdMensageiro,
      sessaoId: id,
      sock,
      evento
    });
  } catch (e) {
    console.log("[ERRO]⚠️ Erro evento Mensageiro:", e.message);
  }
});

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      console.log("[WHATSAPP]📲 QR RECEBIDO:", id);
      qrCodes[id] = await qrcode.toDataURL(qr);
      statusSessao[id] = "qr";
    }

    if (connection === "open") {
      console.log("[WHATSAPP] WHATSAPP CONECTADO:", id);

      statusSessao[id] = "open";
      qrCodes[id] = null;
      reconectando[id] = false;

sessoesMeta[id] = sessoesMeta[id] || {
  id,
  nome: id,
  tipo: "whatsapp",
  criadoEm: new Date().toISOString()
};

sessoesMeta[id].status = "open";
sessoesMeta[id].conectadoEm = new Date().toISOString();

salvarSessoesMeta();

  setTimeout(async () => {
  try {
    await carregarGruposSessao(id, {
  clienteId: clienteIdMensageiro
  });
  } catch (e) {
    console.log(
      "⚠️ Erro ao carregar grupos no pos conexao:",
      e.message
    );
  }
}, 3000);
    }

    if (connection === "close") {
      const motivo = lastDisconnect?.error?.output?.statusCode;

      console.log("[WHATSAPP] WHATSAPP DESCONECTADO:", id);
      console.log("[INFO] Motivo:", motivo);

    qrCodes[id] = null;
    delete sessoes[id];

      if (motivo === DisconnectReason.loggedOut) {
        statusSessao[id] = "loggedOut";
        reconectando[id] = false;
        return;
      }

      statusSessao[id] = "reconnecting";

      if (!reconectando[id]) {
        reconectando[id] = true;

        setTimeout(() => {
          iniciarWhatsApp(id).catch((e) => {
            console.error("[ERRO] ERRO AO RECONECTAR:", e);
            statusSessao[id] = "offline";
            reconectando[id] = false;
          });
        }, 5000);
      }
    }
  });

  return sock;
}



// ================= TESTE AWIN =================

async function testarAwinProdutos() {

  try {

    console.log("[INFO] TESTE AWIN INICIADO");

    const clienteId = "admin";

    const integracao =
    getIntegracaoCliente(clienteId, "awin");

    if (!integracao) {
      console.log("[INFO] Awin no configurada");
      return;
    }

    const {
      publisherId,
      apiToken
    } = integracao.credenciais || {};

    if (!publisherId || !apiToken) {
      console.log("[INFO] Credenciais Awin invlidas");
      return;
    }

    const url =
      `https://api.awin.com/publishers/${publisherId}/programmes`;

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${apiToken}`
      },
      params: {
        relationship: "joined"
      },
      timeout: 15000
    });

  } catch (e) {

    console.log(
      "❌ erro teste awin:",
      e.response?.data || e.message
    );

  }
}

// =========================== PROCESSOS ================================

const PORT = process.env.PORT || 3000;

function podeRodarAgora() {
  const agoraBR = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );

  const horaAtual = agoraBR.getHours() * 60 + agoraBR.getMinutes();

  console.log({
    pausarMadrugada: config.pausarMadrugada,
    inicio: config.horarioInicio,
    fim: config.horarioFim,
    horaServidorBR: `${String(agoraBR.getHours()).padStart(2, "0")}:${String(agoraBR.getMinutes()).padStart(2, "0")}`
  });

  if (!config.pausarMadrugada) return true;

  const [inicioH, inicioM] = (config.horarioInicio || "08:00").split(":").map(Number);
  const [fimH, fimM] = (config.horarioFim || "23:00").split(":").map(Number);

  const inicio = inicioH * 60 + inicioM;
  const fim = fimH * 60 + fimM;

  if (inicio <= fim) {
    return horaAtual >= inicio && horaAtual <= fim;
  }

  return horaAtual >= inicio || horaAtual <= fim;
}

carregarConfig();

initEngineDatabase()
  .then(() => {
    iniciarOrquestradorEngine({
      intervaloMs: 120000,
      processarJobsPendentesEngine,
      validarJobsDiagnosticadosEngine,
      importarJobsProntosEngine,
      distribuirOfertasEngine,
      getClientesValidos: listarClientesValidosEngineProcessor,
      getIntegracoesPorCliente: () => integracoesPorCliente,
      getMarketplacesAtivosPorCliente: listarMarketplacesAtivosEngineProcessor,
      getDepsImportador: () => ({
        importarMercadoLivre,
        importarAmazon,
        importarShopee,
        getIntegracaoCliente,
        gerarLinkAfiliadoMercadoLivre,
        resolverLinkOriginalRadar,
        importarProdutoKabumViaAwin,
        gerarDeepLinkAwin
      }),
      getContextoDistribuidor: () => ({
        clientesValidos: listarClientesValidosEngineProcessor(),
        configsPorCliente,
        destinosPorCliente,
        configGlobal: config,
        marketplacesAtivosPorCliente: listarMarketplacesAtivosEngineProcessor()
      }),
      getDepsDistribuidor: () => ({
        readClienteJson,
        writeClienteJson,
        getClientePath,
        adicionarOfertaNaFilaGlobal: adicionarOfertaNaFilaGlobalEngine
      })
    });
  })
  .catch((e) => {
    console.log("[ENGINE-DB-ERRO]", {
      motivo: "init_exception",
      erro: e.message
    });
  });

for (const usuario of usuarios) {
  carregarFila(usuario.id);
}


function garantirIdsFila() {
  let alterou = false;

  fila = fila.map((item) => {
    if (!item.id) {
      alterou = true;

      return {
        ...item,
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`
      };
    }

    return item;
  });

  if (alterou) {
    salvarFila();
    console.log("[FILA] IDs antigos da fila corrigidos");
  }
}

garantirIdsFila();

console.log("[BOOT] Dados iniciais carregados:", {
  fila: fila.length,
  usuarios: usuarios.length,
  integracoesClientes: Object.keys(integracoesPorCliente || {}).length,
  destinosClientes: Object.keys(destinosPorCliente || {}).length
});

app.listen(PORT, () => {
  console.log("[API]🟢🧠 API ONLINE NA PORTA " + PORT);

decairConfiancaCupons();

setInterval(() => {
  decairConfiancaCupons();
}, 4 * 60 * 60 * 1000);

  setTimeout(() => {
    console.log("[WHATSAPP] Reconectando sesses WhatsApp automaticamente...");

let sessoesParaReconectar = [
  ...new Set(config?.sessoesWhatsapp || [])
];

sessoesParaReconectar = sessoesParaReconectar
  .filter(id => id && id.includes("_"))
  .filter(id => !id.includes("_user_"))
  .filter(id => !/^user_[^_]+_user_/.test(id));

const sessoesFantasma = sessoesParaReconectar.filter(id => !sessaoPersistidaValida(id));

if (sessoesFantasma.length) {
  console.log("[INFO] Sesses fantasmas removidas da reconexo:", sessoesFantasma);
}

sessoesParaReconectar = sessoesParaReconectar.filter(sessaoPersistidaValida);

config.sessoesWhatsapp = sessoesParaReconectar;
salvarConfig();

    sessoesParaReconectar.forEach((id, index) => {
      setTimeout(() => {
        console.log("[WHATSAPP] Reconectando sesso:", id);
        iniciarWhatsApp(id);
      }, 3000 + index * 4000);
    });

  }, 3000);
});


// ================= ORQUESTRADOR GLOBAL DE MARKETPLACES =================

const ordemMarketplaces = [
  "mercadolivre",
  "amazon",
  "shopee",
  "aliexpress",
  "awin"
];

const ordemMarketplacesCritica = [
  "mercadolivre",
  "amazon",
  "shopee",
  "aliexpress",
  "awin"
];

const farejadoresMarketplaces = {
  mercadolivre: farejarMercadoLivreModulo,
  shopee: farejarShopee,
  amazon: farejarAmazon,
  aliexpress: farejarAliExpress,
  kabum: farejarKabum,
  awin: farejarAwin,
  magalu: farejarMagalu,
};

let indiceMarketplaceAtual = 0;
let farejadorRodando = false;
const statusOrquestradorMarketplaces = {};
let ultimaRodadaOrquestradorMs = 0;
const inicioOrquestradorMarketplacesMs = Date.now();

function categoriaLogMarketplace(marketplace = "") {
  const mp = normalizarTexto(marketplace || "");
  const mapa = {
    mercadolivre: "MERCADOLIVRE",
    mercado_livre: "MERCADOLIVRE",
    shopee: "SHOPEE",
    amazon: "AMAZON",
    aliexpress: "ALIEXPRESS",
    kabum: "KABUM",
    awin: "KABUM"
  };

  return mapa[mp] || "ORQUESTRADOR";
}

function obterStatusOrquestradorMarketplace(marketplace = "") {
  const mp = normalizarTexto(marketplace || "");
  if (!statusOrquestradorMarketplaces[mp]) {
    statusOrquestradorMarketplaces[mp] = {
      marketplace: mp,
      rodadas: 0,
      ultimoInicio: "",
      ultimaFinalizacao: "",
      ultimoErro: "",
      cooldownAte: 0
    };
  }

  return statusOrquestradorMarketplaces[mp];
}

function algumClienteComFilaNosStatus(statuses = []) {
  const permitidos = new Set(statuses);

  return usuarios.some(usuario => {
    if (!usuario?.ativo) return false;
    try {
      return permitidos.has(avaliarSaudeFilaCliente(usuario.id).status);
    } catch {
      return false;
    }
  });
}

function algumClienteComFilaCritica() {
  return algumClienteComFilaNosStatus(["critica"]);
}

function algumClienteComFilaBaixaOuCritica() {
  return algumClienteComFilaNosStatus(["critica", "baixa"]);
}

function intervaloOrquestradorAtualMs() {
  if (algumClienteComFilaCritica()) return 2 * 60 * 1000;
  if (algumClienteComFilaBaixaOuCritica()) return 3 * 60 * 1000;

  return Math.max(4, Number(config.intervaloFarejadorGlobalMinutos || 5) || 5) * 60 * 1000;
}

function selecionarProximoMarketplaceOrquestrador() {
  const sequencia = algumClienteComFilaCritica()
    ? ordemMarketplacesCritica
    : ordemMarketplaces;
  const agora = Date.now();

  for (let tentativas = 0; tentativas < sequencia.length; tentativas += 1) {
    const indice = indiceMarketplaceAtual % sequencia.length;
    const marketplace = sequencia[indice];
    indiceMarketplaceAtual = (indiceMarketplaceAtual + 1) % sequencia.length;
    const status = obterStatusOrquestradorMarketplace(marketplace);
    const cfg = config.marketplaces?.[marketplace];
    const farejador = farejadoresMarketplaces[marketplace];

    if (!cfg?.ativo || typeof farejador !== "function") {
      logOptimus("INTELIGENCIA", "Marketplace indisponivel pulado", {
        marketplace,
        ativo: Boolean(cfg?.ativo),
        temFarejador: typeof farejador === "function"
      });
      continue;
    }

    if (status.cooldownAte && status.cooldownAte > agora) {
      logOptimus("INTELIGENCIA", "Marketplace em cooldown", {
        marketplace,
        cooldownRestanteSegundos: Math.ceil((status.cooldownAte - agora) / 1000)
      });
      continue;
    }

    return marketplace;
  }

  return "";
}

async function rodarMarketplaceEspecifico(marketplace = "", opcoes = {}) {
let runnerLockKey = "";

// Farejador global roda apenas no ADMIN MASTER
const admin = usuarios.find(u => u.papel === "admin_master");

if (!admin) {
  console.log("[AVISO] Nenhum admin master encontrado. Farejador global bloqueado.");
  return;
}

  if (farejadoresAutoDesativados()) {
    logFarejadorAutoDesativado(marketplace || "todos", opcoes.origem || "orquestrador", admin.id || "admin");
    return;
  }

  if (farejadorRodando) {
    console.log("[PERFORMANCE-RUNNER-SKIP]", {
      runner: `farejador:${marketplace || "todos"}`,
      clienteId: admin.id || "admin",
      marketplace,
      origem: opcoes.origem || "orquestrador",
      motivo: "farejador_global_em_execucao"
    });
    return;
  }

  if (!config.automacaoAtiva) {
    console.log("[INFO] Farejador parado: automao global desligada");
    return;
  }

  if (!podeRodarAgora()) return;

  if (!marketplace) {
    logOptimus("INTELIGENCIA", "Nenhum marketplace disponivel para rodada");
    return;
  }

  const cfg = config.marketplaces?.[marketplace];


  if (!cfg?.ativo) {
    console.log(`[INFO] ${marketplace} desativado. Pulando.`);
    return;
  }

  const farejador = farejadoresMarketplaces[marketplace];

  if (typeof farejador !== "function") {
    console.log(`[INFO] Farejador no encontrado: ${marketplace}`);
    return;
  }

  runnerLockKey = iniciarRunnerHotfix(`farejador:${marketplace || "todos"}`, admin.id || "admin", console);
  if (!runnerLockKey) return;

  try {
    farejadorRodando = true;
    ultimaRodadaOrquestradorMs = Date.now();
    const statusMarketplace = obterStatusOrquestradorMarketplace(marketplace);
    const categoriaMarketplaceLog = categoriaLogMarketplace(marketplace);
    const inicioRodadaMs = Date.now();
    const totalFilaAntesRodada = Array.isArray(fila) ? fila.length : 0;
    const resumoAbastecimento = criarResumoAbastecimento(marketplace);
    const resumoGeralOrquestrador = {
      marketplace,
      rodada: 0,
      origem: opcoes.origem || "orquestrador",
      clientes: []
    };
    abastecimentoRodadaAtual = resumoAbastecimento;
    let clientesProcessadosRodada = 0;
    statusMarketplace.rodadas += 1;
    resumoGeralOrquestrador.rodada = statusMarketplace.rodadas;
    statusMarketplace.ultimoInicio = new Date().toISOString();
    statusMarketplace.ultimoErro = "";

logOptimus("ORQUESTRADOR", opcoes.origem === "boot_mercadolivre" ? "🚀 ML BOOT | Rodada inicial direta" : "Rodada iniciada", {
  marketplace,
  rodada: statusMarketplace.rodadas,
  intervaloAtualMinutos: Math.round(intervaloOrquestradorAtualMs() / 60000),
  origem: opcoes.origem || "orquestrador"
});

logOptimus(categoriaMarketplaceLog, "Início da rodada", {
  marketplace,
  rodada: statusMarketplace.rodadas,
  origem: opcoes.origem || "orquestrador"
});

for (const usuario of usuarios) {
  if (!usuario?.ativo) continue;

  const clienteId = usuario.id;
  const saudeFilaCliente = avaliarSaudeFilaCliente(clienteId);
  const resumoClienteOrquestrador = criarItemResumoClienteOrquestrador(clienteId, marketplace, saudeFilaCliente);
  resumoGeralOrquestrador.clientes.push(resumoClienteOrquestrador);

  if (!saudeFilaCliente.deveAbastecer) {
    resumoClienteOrquestrador.marketplaces[marketplace].principalMotivoZero = "fila_nao_precisa_abastecer";
    logOptimus("INTELIGENCIA", "Cliente sem necessidade de abastecimento pulado", {
      clienteId,
      marketplace,
      statusFila: saudeFilaCliente.status,
      pendentes: saudeFilaCliente.pendentes,
      minimo: saudeFilaCliente.minimo
    });
    continue;
  }

  const marketplacePlano = marketplace === "awin" ? "kabum" : marketplace;
  const planoPermiteMarketplace = usuarioPodeReceberMarketplace(usuario, marketplace) ||
    usuarioPodeReceberMarketplace(usuario, marketplacePlano);

  if (!planoPermiteMarketplace) {
    resumoClienteOrquestrador.marketplaces[marketplace].principalMotivoZero = "plano_nao_permite_marketplace";
    console.log("[INFO] Usurio no recebe marketplace pelo plano:", {
      clienteId,
      marketplace,
      marketplacePlano
    });
    continue;
  }

  const marketplaceIntegracao =
  marketplace === "kabum"
    ? "awin"
    : marketplace;

if (!usuarioTemIntegracaoMarketplace(clienteId, marketplaceIntegracao)) {
  resumoClienteOrquestrador.marketplaces[marketplace].principalMotivoZero = "integracao_ausente";
  logOptimus("INTEGRACAO", "Usuario sem integracao configurada", {
    clienteId,
    marketplace,
    marketplaceIntegracao
  });
  continue;
}

  console.log("[INFO] Farejando marketplace para cliente:", {
    clienteId,
    marketplace
  });

console.log("[INFO] CHAMANDO FAREJADOR:", {
  clienteId,
  marketplace,
  funcao: typeof farejador
});


const resumoAbastecimentoAntesCliente = clonarResumoAbastecimento(resumoAbastecimento);
const totalFilaClienteAntes = contarItensFilaClienteOrquestrador(clienteId);

const retornoFarejador = await farejador(clienteId, {
  config,
  integracoesPorCliente,
  getIntegracaoCliente,
  fila,
  salvarFila,
  prepararOfertaGlobal,
  ofertaJaExiste,
  prepararOfertaGlobal,
  ofertaJaExiste,
  deveIgnorarOfertaRepetida,
  registrarOfertaVista,
  classificarCategoriaOferta,
  classificarCategoriaOferta,
  gerarBuscasGlobais,
  gerarHeadersStealth,
  obterEstrategiaFarejador,
  ofertaTemBeneficioFarejador,
  farejarCuponsMercadoLivre,
  registrarAbastecimento,
  importarMercadoLivre: (url, clienteIdAlvo = clienteId) => {
    const clienteImportacao = clienteIdAlvo || clienteId;
    return importarMercadoLivre(url, clienteImportacao, {
      getIntegracaoCliente,
      gerarLinkAfiliadoMercadoLivre,
        resolverLinkOriginalRadar
      });
  },
  importarAmazon: importarAmazon,
  buscarOfertasShopee,
  normalizarSessaoId,
  aplicarFiltrosUniversais,
  distribuirOfertaParaClientes,
  encurtarUrl,
  gerarDeepLinkAwin: (url, clienteIdAlvo = clienteId) =>
    gerarDeepLinkAwin(url, clienteIdAlvo || clienteId),
  importarProdutoKabumViaAwin,
  bloquearAwinKabumAutoNaFila,
  logAwinEntradaFilaDebug,

});

const resumoAbastecimentoDepoisCliente = clonarResumoAbastecimento(resumoAbastecimento);
const deltaAbastecimentoCliente = diffResumoAbastecimento(resumoAbastecimentoAntesCliente, resumoAbastecimentoDepoisCliente);
const totalFilaClienteDepois = contarItensFilaClienteOrquestrador(clienteId);
const saudeFilaDepoisCliente = avaliarSaudeFilaCliente(clienteId);
resumoClienteOrquestrador.pendentesDepois = Number(saudeFilaDepoisCliente.pendentes || 0);
resumoClienteOrquestrador.marketplaces[marketplace] = normalizarRetornoFarejadorOrquestrador(
  retornoFarejador,
  marketplace,
  deltaAbastecimentoCliente,
  Math.max(0, totalFilaClienteDepois - totalFilaClienteAntes)
);
clientesProcessadosRodada += 1;
}

  statusMarketplace.ultimaFinalizacao = new Date().toISOString();
  const totalFilaDepoisRodada = Array.isArray(fila) ? fila.length : totalFilaAntesRodada;
  const adicionadasRodada = Math.max(0, totalFilaDepoisRodada - totalFilaAntesRodada);
  const duracaoSegundos = Math.round((Date.now() - inicioRodadaMs) / 1000);

  logOptimus(categoriaMarketplaceLog, "Fim da rodada", {
    marketplace,
    rodada: statusMarketplace.rodadas,
    clientesProcessados: clientesProcessadosRodada,
    encontradas: "nao_informado",
    adicionadas: adicionadasRodada,
    erros: 0,
    duracaoSegundos,
    origem: opcoes.origem || "orquestrador"
  });

  logOptimus("RESUMO", "Farejador rodada", {
    marketplace,
    rodada: statusMarketplace.rodadas,
    clientesProcessados: clientesProcessadosRodada,
    encontradas: "nao_informado",
    adicionadas: adicionadasRodada,
    erros: 0,
    origem: opcoes.origem || "orquestrador"
  });

  console.log("[PERFORMANCE-RODADA-RESUMO]", {
    runner: "orquestrador_marketplaces",
    marketplace,
    rodada: statusMarketplace.rodadas,
    clientesProcessados: clientesProcessadosRodada,
    adicionadas: adicionadasRodada,
    pendentesAntes: resumoGeralOrquestrador.clientes.reduce((total, item) => total + Number(item.pendentesAntes || 0), 0),
    pendentesDepois: resumoGeralOrquestrador.clientes.reduce((total, item) => total + Number(item.pendentesDepois || 0), 0),
    duracaoSegundos,
    origem: opcoes.origem || "orquestrador"
  });

  console.log("[ORQUESTRADOR-RESUMO-GERAL]", {
    ...resumoGeralOrquestrador,
    clientesProcessados: clientesProcessadosRodada,
    pendentesAntes: resumoGeralOrquestrador.clientes.reduce((total, item) => total + Number(item.pendentesAntes || 0), 0),
    pendentesDepois: resumoGeralOrquestrador.clientes.reduce((total, item) => total + Number(item.pendentesDepois || 0), 0),
    adicionadasCalculadasFila: adicionadasRodada,
    duracaoSegundos
  });

  logResumoAbastecimento(resumoAbastecimento, {
    rodada: statusMarketplace.rodadas,
    clientesProcessados: clientesProcessadosRodada,
    adicionadasCalculadasFila: adicionadasRodada,
    duracaoSegundos,
    origem: opcoes.origem || "orquestrador"
  });

  } catch (e) {
    const statusMarketplace = obterStatusOrquestradorMarketplace(marketplace);
    statusMarketplace.ultimoErro = e.message || "erro_rodada_marketplace";
    statusMarketplace.cooldownAte = Date.now() + 15 * 60 * 1000;
    logOptimus("ERRO", "Erro na rodada marketplace", {
      marketplace,
      erro: e.message,
      cooldownMinutos: 15,
      origem: opcoes.origem || "orquestrador"
    });
  } finally {
    abastecimentoRodadaAtual = null;
    farejadorRodando = false;
    finalizarRunnerHotfix(runnerLockKey);
  }
}

async function rodarProximoMarketplace() {
  if (farejadoresAutoDesativados()) {
    logFarejadorAutoDesativado("todos", "orquestrador", "admin");
    return;
  }

  const marketplace = selecionarProximoMarketplaceOrquestrador();
  return rodarMarketplaceEspecifico(marketplace, { origem: "orquestrador" });
}

if (!global.__optimusMlBootTimeoutRegistrado) {
  global.__optimusMlBootTimeoutRegistrado = true;
  if (farejadoresAutoDesativados()) {
    logFarejadorAutoDesativado("mercadolivre", "boot_mercadolivre", "admin");
  }
  if (!farejadoresAutoDesativados()) setTimeout(() => {
    logOptimus("MERCADOLIVRE", "🚀 ML BOOT | Disparo inicial apos deploy", {
      delaySegundos: 60
    });
    rodarMarketplaceEspecifico("mercadolivre", { origem: "boot_mercadolivre" });
  }, 60 * 1000);
}

if (!global.__optimusOrquestradorMarketplacesIntervalRegistrado) {
  global.__optimusOrquestradorMarketplacesIntervalRegistrado = true;
  if (farejadoresAutoDesativados()) {
    logFarejadorAutoDesativado("todos", "orquestrador_intervalo", "admin");
  }
  if (!farejadoresAutoDesativados()) setInterval(() => {
    const intervaloAtual = intervaloOrquestradorAtualMs();
    const ultimaRodada = ultimaRodadaOrquestradorMs || inicioOrquestradorMarketplacesMs;

    if (Date.now() - ultimaRodada < intervaloAtual) return;

    rodarProximoMarketplace();
  }, 30 * 1000);
}

// ================= PROCESSADOR DA FILA =================

let ultimoLogPausaFila = 0;

setInterval(() => {
  if (!podeRodarAgora()) {
    const agora = Date.now();

    if (agora - ultimoLogPausaFila > 5 * 60 * 1000) {
      logOptimus("FILA", "Fila pausada fora do horario configurado");
      ultimoLogPausaFila = agora;
    }

    return;
  }

  for (const usuario of usuarios) {
    if (!usuario?.ativo) continue;

    processarFila(usuario.id);
  }

}, 10 * 1000);
























