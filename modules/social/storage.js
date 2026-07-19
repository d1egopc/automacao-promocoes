const {
  readClienteJson,
  writeClienteJson,
  listClientes
} = require("../../utils/storage");
const { logSocial, logErroSocial } = require("./logs");

const ARQUIVOS = {
  config: "social-config.json",
  meta: "social-meta.json",
  templates: "social-templates.json",
  rascunhos: "social-rascunhos.json",
  agendamentos: "social-agendamentos.json",
  publicacoes: "social-publicacoes.json",
  oportunidades: "social-oportunidades.json",
  automatico: "social-automatico.json"
};

const REDES_SUPORTADAS = new Set(["instagram", "facebook", "telegram"]);
const STATUS_PUBLICACAO = new Set(["rascunho", "agendada", "pendente", "aguardando_aprovacao", "processando", "publicando", "publicada", "erro", "cancelada"]);
const ORIGENS_PUBLICACAO = new Set(["manual", "personalizada", "automatica", "automatico", "agendada"]);
const TIPOS_PUBLICACAO = new Set(["oferta", "livre"]);
const FORMATOS_PUBLICACAO = new Set(["feed", "reels"]);
const STATUS_INVALIDOS_OPORTUNIDADE = new Set([
  "retida",
  "retido",
  "erro",
  "reprovada",
  "reprovado",
  "expirada",
  "expirado",
  "bloqueada",
  "bloqueado",
  "inativa",
  "inativo",
  "pausada",
  "pausado",
  "cancelada",
  "cancelado",
  "descartada",
  "descartado"
]);
const STATUS_AGENDAMENTO_ATIVO_SOCIAL = new Set(["pendente", "agendada", "aguardando_aprovacao", "processando", "publicando"]);

function agoraIso() {
  return new Date().toISOString();
}

function criarId(prefixo = "social") {
  return `${prefixo}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function normalizarOrigemSocial(valor = "", fallback = "manual") {
  const origem = texto(valor || fallback).toLowerCase();
  return ORIGENS_PUBLICACAO.has(origem) ? origem : fallback;
}

function normalizarTipoPublicacao(valor = "", fallback = "oferta") {
  const tipo = texto(valor || fallback).toLowerCase();
  return TIPOS_PUBLICACAO.has(tipo) ? tipo : fallback;
}

function normalizarFormatoPublicacao(valor = "", fallback = "feed") {
  const formato = texto(valor || fallback).toLowerCase();
  return FORMATOS_PUBLICACAO.has(formato) ? formato : fallback;
}

function normalizarFormatosPublicacao(valor = []) {
  const formatos = lista(valor)
    .map(item => normalizarFormatoPublicacao(item, ""))
    .filter(Boolean);
  return Array.from(new Set(formatos)).filter(item => FORMATOS_PUBLICACAO.has(item));
}

function objetoOpcional(valor) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : null;
}

function objeto(valor) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function numero(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;

  const limpo = texto(valor)
    .replace(/R\$/gi, "")
    .replace(/\s/g, "")
    .trim();

  if (!limpo) return null;

  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const resultado = Number(normalizado);
  return Number.isFinite(resultado) ? resultado : null;
}

function inteiro(valor, fallback = 0, min = 0, max = 9999) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function hora(valor = "", fallback = "") {
  const v = texto(valor);
  return /^\d{2}:\d{2}$/.test(v) ? v : fallback;
}

function urlHttpsOpcional(valor = "") {
  const v = texto(valor);
  if (!v) return "";
  try {
    const parsed = new URL(v);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

const DATA_MINIMA_CONFIAVEL_MS = Date.UTC(2000, 0, 1);
const DATA_MAXIMA_CONFIAVEL_MS = Date.UTC(2100, 0, 1);
const CAMPOS_DATA_RECENCIA = [
  "dataEntradaFila",
  "emFilaEm",
  "dataTratamento",
  "recebidoEm",
  "capturadaEm",
  "dataEntradaRadar",
  "criadoEm",
  "dataCriacao",
  "createdAt",
  "atualizadoEm"
];

function timestampNumericoMs(valor) {
  if (typeof valor !== "number" && typeof valor !== "string") return 0;
  const bruto = typeof valor === "number" ? valor : texto(valor);
  if (bruto === "") return 0;
  if (typeof bruto === "string" && !/^\d{10,13}$/.test(bruto)) return 0;
  const n = Number(bruto);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const ms = n < 1000000000000 ? n * 1000 : n;
  return ms >= DATA_MINIMA_CONFIAVEL_MS && ms <= DATA_MAXIMA_CONFIAVEL_MS ? ms : 0;
}

function dataPtBrMs(valor = "") {
  const v = texto(valor);
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return 0;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const ano = Number(m[3]);
  const hora = Number(m[4] || 0);
  const minuto = Number(m[5] || 0);
  const segundo = Number(m[6] || 0);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hora > 23 || minuto > 59 || segundo > 59) return 0;
  const calendario = new Date(Date.UTC(ano, mes - 1, dia));
  if (
    calendario.getUTCFullYear() !== ano ||
    calendario.getUTCMonth() !== mes - 1 ||
    calendario.getUTCDate() !== dia
  ) return 0;
  const ms = Date.UTC(ano, mes - 1, dia, hora + 3, minuto, segundo);
  return ms >= DATA_MINIMA_CONFIAVEL_MS && ms <= DATA_MAXIMA_CONFIAVEL_MS ? ms : 0;
}

function dataMs(valor = "") {
  const numerico = timestampNumericoMs(valor);
  if (numerico) return numerico;
  const raw = texto(valor);
  if (!raw) return 0;
  const iso = Date.parse(raw);
  if (Number.isFinite(iso)) return iso;
  return dataPtBrMs(raw);
}

function normalizarChave(valor = "") {
  return texto(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function temImagemValida(valor = "") {
  const imagem = texto(valor);
  return /^https?:\/\//i.test(imagem);
}

function temLinkValido(valor = "") {
  const link = texto(valor);
  return /^https?:\/\//i.test(link);
}

function idOfertaOficialSocial(item = {}) {
  const candidatos = [
    item.ofertaId,
    item.ofertaUniversalId,
    item.engineOfertaId,
    item.engineOfertaUuid,
    item.produtoId,
    item.productId,
    item.sku,
    item.id
  ];
  return texto(candidatos.find(valor => {
    const id = texto(valor);
    return id && !id.startsWith("social_");
  }));
}

function idsOfertaSocial(item = {}) {
  return new Set([
    item.ofertaId,
    item.ofertaUniversalId,
    item.engineOfertaId,
    item.engineOfertaUuid,
    item.produtoId,
    item.productId,
    item.sku,
    item.id
  ].map(texto).filter(Boolean));
}

function dataRecenciaOportunidade(item = {}) {
  for (const campo of CAMPOS_DATA_RECENCIA) {
    const valor = item?.[campo];
    if (valor === null || valor === undefined || valor === "") continue;
    if (dataMs(valor) > 0) return texto(valor);
  }
  return "";
}

function recenciaOportunidade(criadoEm = "", agoraMs = Date.now(), idadeMaximaHoras = 6) {
  const ms = dataMs(criadoEm);
  const recenciaConfiavel = ms > 0;
  const idadeEmMinutos = recenciaConfiavel ? Math.max(0, Math.floor((agoraMs - ms) / 60000)) : null;
  const idadeMaximaMinutos = Math.max(1, Number(idadeMaximaHoras || 6) || 6) * 60;
  const idadeAcimaLimite = recenciaConfiavel && idadeEmMinutos > idadeMaximaMinutos;

  return {
    idadeEmMinutos,
    recenciaConfiavel,
    antigaParaAutomatico: !recenciaConfiavel || idadeAcimaLimite,
    motivoForaAutomatico: !recenciaConfiavel
      ? "sem_data_confiavel"
      : (idadeAcimaLimite ? "idade_acima_limite" : null)
  };
}

function statusOportunidadeInvalido(item = {}) {
  const v2 = item.inteligenciaUniversalV2 || {};
  const candidatos = [
    item.status,
    item.statusOperacional,
    item.statusSocial,
    item.statusOferta,
    v2.status
  ].map(valor => texto(valor).toLowerCase()).filter(Boolean);
  return candidatos.find(status => STATUS_INVALIDOS_OPORTUNIDADE.has(status)) || "";
}

function cupomExplicitamenteExpirado(item = {}) {
  const expiraEm = texto(item.expiraEm || item.validadeCupom || item.cupomExpiraEm);
  if (expiraEm && dataMs(expiraEm) > 0 && dataMs(expiraEm) < Date.now()) return true;
  return texto(item.statusDetalhe).toLowerCase().includes("expirado");
}

function oportunidadeBloqueadaOuInativa(item = {}) {
  return item.ativo === false ||
    item.bloqueada === true ||
    item.bloqueado === true ||
    item.inativa === true ||
    item.inativo === true ||
    item.disponivel === false ||
    item.publicavel === false ||
    item.statusBloqueio === true;
}

function caminhoLogicoCliente(clienteId = "admin", tipo = "") {
  return `${process.env.DATA_DIR || "/data"}/clientes/${texto(clienteId || "admin")}/${ARQUIVOS[tipo] || ""}`;
}

function resumoMetaStorage(meta = {}) {
  return {
    conectado: meta.conectado === true,
    tokenPresente: Boolean(texto(meta.token?.accessToken || meta.accessToken)),
    paginasTotal: lista(meta.paginas).length
  };
}

function normalizarRede(rede = "") {
  const valor = texto(rede).toLowerCase();
  return REDES_SUPORTADAS.has(valor) ? valor : "";
}

function criarConfigPadrao(clienteId = "admin") {
  return {
    clienteId,
    ativo: false,
    redes: {
      instagram: { ativo: false, conectado: false, credenciaisConfiguradas: false },
      facebook: { ativo: false, conectado: false, credenciaisConfiguradas: false },
      telegram: { ativo: false, conectado: false, destinos: [] }
    },
    preferencias: {
      usarOfertaUniversal: true,
      publicarAutomaticamente: false,
      exigirAprovacaoManual: true
    },
    criadoEm: agoraIso(),
    atualizadoEm: agoraIso()
  };
}

function criarMetaPadrao(clienteId = "admin") {
  return {
    clienteId,
    status: "desconectado",
    conectado: false,
    facebook: {
      conectado: false,
      pageId: "",
      pageName: "",
      pageUsername: ""
    },
    instagram: {
      conectado: false,
      instagramBusinessAccountId: "",
      username: "",
      name: ""
    },
    ativos: {
      status: "pendente",
      motivo: "",
      atualizadoEm: ""
    },
    token: {
      accessToken: "",
      tokenType: "",
      expiresIn: null,
      expiresAt: "",
      recebidoEm: ""
    },
    paginas: [],
    atualizadoEm: agoraIso()
  };
}

function criarConfigAutomaticoPadrao(clienteId = "admin") {
  return {
    clienteId,
    ativo: false,
    templatePadraoId: "padrao-instagram",
    horarios: [],
    quantidadeDiaria: 5,
    limiteDiarioAutomaticoAtivo: true,
    maxPublicacoesAutomaticasPorDia: 5,
    formatos: ["feed"],
    janelaFuncionamento: {
      inicio: "08:00",
      fim: "22:00"
    },
    intervaloMinimoMinutos: 40,
    idadeMaximaHoras: 6,
    marketplacesPermitidos: [],
    categoriasPermitidas: [],
    scoreMinimo: 70,
    exigirCupom: false,
    permitirOfertaComum: true,
    limparAutomaticamenteOportunidadesAntigas: false,
    aprovacaoManual: false,
    evitarProdutoRepetidoDias: 30,
    gatilho: {
      ativo: false,
      palavra: "PROMO",
      respostaPublica: ""
    },
    cta: {
      destino: "bio",
      linkGrupo: "",
      whatsapp: "",
      linkBio: ""
    },
    criadoEm: agoraIso(),
    atualizadoEm: agoraIso()
  };
}

function temToken(valor = "") {
  return Boolean(texto(valor));
}

function sanitizarConexaoMeta(meta = {}) {
  const token = meta.token && typeof meta.token === "object" ? meta.token : {};

  return {
    clienteId: texto(meta.clienteId),
    status: meta.conectado ? "conectado" : "desconectado",
    conectado: meta.conectado === true,
    facebook: {
      conectado: meta.facebook?.conectado === true,
      pageId: texto(meta.facebook?.pageId),
      pageName: texto(meta.facebook?.pageName),
      pageUsername: texto(meta.facebook?.pageUsername)
    },
    instagram: {
      conectado: meta.instagram?.conectado === true,
      instagramBusinessAccountId: texto(meta.instagram?.instagramBusinessAccountId),
      username: texto(meta.instagram?.username),
      name: texto(meta.instagram?.name)
    },
    ativos: {
      status: texto(meta.ativos?.status || "pendente"),
      motivo: texto(meta.ativos?.motivo),
      atualizadoEm: texto(meta.ativos?.atualizadoEm)
    },
    token: {
      presente: temToken(token.accessToken),
      tokenType: texto(token.tokenType),
      expiresIn: token.expiresIn ?? null,
      expiresAt: texto(token.expiresAt),
      recebidoEm: texto(token.recebidoEm)
    },
    paginas: lista(meta.paginas).map(pagina => ({
      id: texto(pagina.id),
      name: texto(pagina.name),
      username: texto(pagina.username),
      instagramBusinessAccountId: texto(pagina.instagramBusinessAccountId),
      instagramUsername: texto(pagina.instagramUsername),
      instagramName: texto(pagina.instagramName),
      conectado: pagina.conectado === true
    })),
    atualizadoEm: texto(meta.atualizadoEm)
  };
}

function normalizarConfig(clienteId, dados = {}) {
  const padrao = criarConfigPadrao(clienteId);
  const redes = dados.redes && typeof dados.redes === "object" ? dados.redes : {};

  return {
    ...padrao,
    ...dados,
    clienteId,
    ativo: dados.ativo === true,
    redes: {
      instagram: {
        ...padrao.redes.instagram,
        ...(redes.instagram && typeof redes.instagram === "object" ? redes.instagram : {}),
        ativo: redes.instagram?.ativo === true
      },
      facebook: {
        ...padrao.redes.facebook,
        ...(redes.facebook && typeof redes.facebook === "object" ? redes.facebook : {}),
        ativo: redes.facebook?.ativo === true
      },
      telegram: {
        ...padrao.redes.telegram,
        ...(redes.telegram && typeof redes.telegram === "object" ? redes.telegram : {}),
        ativo: redes.telegram?.ativo === true,
        destinos: lista(redes.telegram?.destinos).map(item => ({
          id: texto(item.id || criarId("destino")),
          nome: texto(item.nome),
          tipo: texto(item.tipo || "canal"),
          destino: texto(item.destino || item.chatId || item.url),
          ativo: item.ativo !== false
        })).filter(item => item.destino)
      }
    },
    preferencias: {
      ...padrao.preferencias,
      ...(dados.preferencias && typeof dados.preferencias === "object" ? dados.preferencias : {}),
      usarOfertaUniversal: true,
      publicarAutomaticamente: false
    },
    atualizadoEm: agoraIso()
  };
}

function normalizarTemplate(clienteId, template = {}, index = 0) {
  const rede = normalizarRede(template.rede) || "instagram";
  const gatilhoEntrada = objeto(template.gatilho);
  const ctaEntrada = objeto(template.cta);
  const visual = objeto(template.visual || template.visualConfig || template.templateVisual);
  const mensagemDirect = texto(
    template.mensagemDirect ||
    template.mensagemPrivada ||
    gatilhoEntrada.mensagemDirect ||
    gatilhoEntrada.textoDirect ||
    gatilhoEntrada.mensagemPrivada
  );
  const respostaPublica = texto(template.respostaPublica || gatilhoEntrada.respostaPublica);
  const palavraGatilho = texto(gatilhoEntrada.palavra || gatilhoEntrada.keyword || "PROMO").slice(0, 40);

  return {
    id: texto(template.id || criarId("template")),
    clienteId,
    nome: texto(template.nome || `Template Social ${index + 1}`),
    rede,
    ativo: template.ativo !== false,
    padrao: template.padrao === true || template.padraoAutomatico === true,
    formato: texto(template.formato || "post"),
    conteudo: texto(template.conteudo || ""),
    legenda: texto(template.legenda || template.conteudo || ""),
    visual,
    gatilho: {
      ativo: gatilhoEntrada.ativo === true,
      palavra: palavraGatilho,
      ctaPublico: texto(gatilhoEntrada.ctaPublico || "").slice(0, 220),
      respostaPublica: respostaPublica.slice(0, 220),
      mensagemDirect: mensagemDirect.slice(0, 300),
      textoDirect: mensagemDirect.slice(0, 300)
    },
    respostaPublica: respostaPublica.slice(0, 220),
    mensagemPrivada: mensagemDirect.slice(0, 300),
    cta: Object.keys(ctaEntrada).length ? ctaEntrada : null,
    camposOfertaUniversal: lista(template.camposOfertaUniversal).map(texto).filter(Boolean),
    criadoEm: template.criadoEm || agoraIso(),
    atualizadoEm: agoraIso()
  };
}

function normalizarAgendamento(clienteId, agendamento = {}, index = 0) {
  const redes = lista(agendamento.redes)
    .map(normalizarRede)
    .filter(Boolean);
  const statusEntrada = texto(agendamento.status || "pendente");
  const status = statusEntrada === "rascunho" ? "pendente" : statusEntrada;
  const tipoPublicacao = normalizarTipoPublicacao(agendamento.tipoPublicacao || agendamento.tipo, "oferta");
  const origem = normalizarOrigemSocial(agendamento.origem, "agendada");

  return {
    id: texto(agendamento.id || criarId("agendamento")),
    clienteId,
    nome: texto(agendamento.nome || `Agendamento Social ${index + 1}`),
    ativo: agendamento.ativo !== false,
    redes,
    origem,
    tipoPublicacao,
    formato: normalizarFormatoPublicacao(agendamento.formato || agendamento.formatoPublicacao, "feed"),
    status: STATUS_PUBLICACAO.has(status) ? status : "pendente",
    motivo: texto(agendamento.motivo),
    ofertaId: texto(agendamento.ofertaId || agendamento.oportunidadeId),
    imagemUrl: texto(agendamento.imagemUrl || agendamento.imagem),
    videoUrl: texto(agendamento.videoUrl || agendamento.video_url || agendamento.mediaUrl || agendamento.midiaUrl),
    mimeType: texto(agendamento.mimeType || agendamento.videoMimeType || agendamento.mediaMimeType || agendamento.midiaMimeType),
    legenda: texto(agendamento.legenda || agendamento.mensagem),
    templateId: texto(agendamento.templateId || (tipoPublicacao === "livre" ? "livre-instagram" : "padrao-instagram")),
    gatilho: objetoOpcional(agendamento.gatilho),
    respostaPublica: texto(agendamento.respostaPublica || agendamento.gatilho?.respostaPublica),
    mensagemPrivada: texto(agendamento.mensagemPrivada || agendamento.mensagemDirect || agendamento.textoDirect || agendamento.gatilho?.textoDirect),
    direct: objetoOpcional(agendamento.direct),
    redirect: objetoOpcional(agendamento.redirect),
    urlDestino: texto(agendamento.urlDestino || agendamento.linkDestino || agendamento.linkAfiliado || agendamento.direct?.urlDestino || agendamento.direct?.url || agendamento.redirect?.urlDestino || agendamento.redirect?.url || agendamento.cta?.urlDestino || agendamento.cta?.url),
    cta: objetoOpcional(agendamento.cta),
    linkAfiliado: texto(agendamento.linkAfiliado || agendamento.urlDestino),
    agendadoPara: texto(agendamento.agendadoPara || agendamento.horarioExecucao),
    horario: texto(agendamento.horario),
    timezone: texto(agendamento.timezone || "America/Sao_Paulo"),
    regras: agendamento.regras && typeof agendamento.regras === "object" ? agendamento.regras : {},
    automatico: agendamento.automatico && typeof agendamento.automatico === "object" ? agendamento.automatico : null,
    publicacaoId: texto(agendamento.publicacaoId),
    erro: agendamento.erro && typeof agendamento.erro === "object" ? agendamento.erro : null,
    criadoEm: agendamento.criadoEm || agoraIso(),
    atualizadoEm: agoraIso()
  };
}

function normalizarRascunho(clienteId, rascunho = {}, index = 0) {
  const status = texto(rascunho.status || "rascunho");
  const tipoPublicacao = normalizarTipoPublicacao(rascunho.tipoPublicacao || rascunho.tipo, "oferta");
  const origem = normalizarOrigemSocial(rascunho.origem, tipoPublicacao === "livre" ? "personalizada" : "manual");

  return {
    id: texto(rascunho.id || criarId("rascunho")),
    clienteId,
    nome: texto(rascunho.nome || `Rascunho Social ${index + 1}`),
    origem,
    tipoPublicacao,
    formato: normalizarFormatoPublicacao(rascunho.formato || rascunho.formatoPublicacao, "feed"),
    status: STATUS_PUBLICACAO.has(status) ? status : "rascunho",
    ofertaId: texto(rascunho.ofertaId || rascunho.oportunidadeId),
    imagemUrl: texto(rascunho.imagemUrl || rascunho.imagem),
    videoUrl: texto(rascunho.videoUrl || rascunho.video_url || rascunho.mediaUrl || rascunho.midiaUrl),
    mimeType: texto(rascunho.mimeType || rascunho.videoMimeType || rascunho.mediaMimeType || rascunho.midiaMimeType),
    legenda: texto(rascunho.legenda || rascunho.mensagem),
    templateId: texto(rascunho.templateId || (tipoPublicacao === "livre" ? "livre-instagram" : "padrao-instagram")),
    gatilho: objetoOpcional(rascunho.gatilho),
    respostaPublica: texto(rascunho.respostaPublica || rascunho.gatilho?.respostaPublica),
    mensagemPrivada: texto(rascunho.mensagemPrivada || rascunho.mensagemDirect || rascunho.textoDirect || rascunho.gatilho?.textoDirect),
    direct: objetoOpcional(rascunho.direct),
    redirect: objetoOpcional(rascunho.redirect),
    urlDestino: texto(rascunho.urlDestino || rascunho.linkDestino || rascunho.linkAfiliado || rascunho.direct?.urlDestino || rascunho.direct?.url || rascunho.redirect?.urlDestino || rascunho.redirect?.url || rascunho.cta?.urlDestino || rascunho.cta?.url),
    cta: objetoOpcional(rascunho.cta),
    linkAfiliado: texto(rascunho.linkAfiliado || rascunho.urlDestino),
    agendadoPara: texto(rascunho.agendadoPara || rascunho.horarioExecucao),
    agendamentoId: texto(rascunho.agendamentoId),
    publicacaoId: texto(rascunho.publicacaoId),
    erro: objetoOpcional(rascunho.erro),
    criadoEm: rascunho.criadoEm || agoraIso(),
    atualizadoEm: agoraIso()
  };
}

function resumirOfertaUniversal(oferta = {}) {
  const v2 = oferta.inteligenciaUniversalV2 || {};

  return {
    id: texto(oferta.id || oferta.ofertaId || criarId("oferta")),
    ofertaUniversal: oferta.ofertaUniversal === true || texto(oferta.versaoOfertaUniversal).startsWith("v2"),
    versaoOfertaUniversal: texto(oferta.versaoOfertaUniversal),
    titulo: texto(oferta.titulo || oferta.nome),
    marketplace: texto(oferta.marketplace),
    categoria: texto(v2.categoria || oferta.categoria),
    precoAtual: oferta.precoAtual ?? oferta.preco,
    precoOriginal: oferta.precoOriginal ?? oferta.precoAntigo,
    valorEfetivo: v2.valorEfetivo ?? oferta.valorEfetivo,
    cupom: texto(oferta.cupom || oferta.cupomCodigo),
    score: v2.score ?? oferta.score,
    prioridade: v2.prioridade ?? oferta.prioridade,
    linkAfiliado: texto(oferta.linkAfiliado || oferta.linkFinal || oferta.link),
    imagem: texto(oferta.imagem),
    origem: texto(oferta.origem)
  };
}

function normalizarPublicacao(clienteId, publicacao = {}, index = 0) {
  const status = texto(publicacao.status || "rascunho");

  return {
    id: texto(publicacao.id || criarId("publicacao")),
    clienteId,
    redes: lista(publicacao.redes).map(normalizarRede).filter(Boolean),
    status: STATUS_PUBLICACAO.has(status) ? status : "rascunho",
    formato: normalizarFormatoPublicacao(publicacao.formato || publicacao.formatoPublicacao, "feed"),
    modo: texto(publicacao.modo || "manual"),
    oferta: publicacao.oferta ? resumirOfertaUniversal(publicacao.oferta) : (publicacao.ofertaUniversal || null),
    conteudo: publicacao.conteudo && typeof publicacao.conteudo === "object" ? publicacao.conteudo : {},
    agendadoPara: texto(publicacao.agendadoPara),
    motivo: texto(publicacao.motivo),
    criadoEm: publicacao.criadoEm || agoraIso(),
    atualizadoEm: agoraIso()
  };
}

function lerCliente(clienteId, tipo, fallback) {
  try {
    return readClienteJson(clienteId, ARQUIVOS[tipo], fallback);
  } catch (e) {
    logErroSocial({ clienteId, tipo, erro: e.message });
    return fallback;
  }
}

function escreverCliente(clienteId, tipo, dados) {
  try {
    writeClienteJson(clienteId, ARQUIVOS[tipo], dados);
    return true;
  } catch (e) {
    logErroSocial({ clienteId, tipo, erro: e.message });
    return false;
  }
}

function getConfigSocial(clienteId = "admin") {
  const config = normalizarConfig(clienteId, lerCliente(clienteId, "config", criarConfigPadrao(clienteId)));
  const meta = sanitizarConexaoMeta(getConexaoMetaSocial(clienteId));

  return {
    ...config,
    redes: {
      ...config.redes,
      facebook: {
        ...config.redes.facebook,
        conectado: meta.facebook.conectado,
        credenciaisConfiguradas: meta.token.presente,
        pageId: meta.facebook.pageId,
        pageName: meta.facebook.pageName
      },
      instagram: {
        ...config.redes.instagram,
        conectado: meta.instagram.conectado,
        credenciaisConfiguradas: meta.token.presente,
        instagramBusinessAccountId: meta.instagram.instagramBusinessAccountId,
        username: meta.instagram.username
      }
    },
    conexoes: {
      meta
    }
  };
}

function normalizarConfigAutomatico(clienteId = "admin", config = {}) {
  const padrao = criarConfigAutomaticoPadrao(clienteId);
  const janela = config.janelaFuncionamento && typeof config.janelaFuncionamento === "object"
    ? config.janelaFuncionamento
    : {};
  const gatilho = config.gatilho && typeof config.gatilho === "object" ? config.gatilho : {};
  const cta = config.cta && typeof config.cta === "object" ? config.cta : {};
  const destino = texto(cta.destino || padrao.cta.destino).toLowerCase();
  const quantidadeDiaria = inteiro(
    config.quantidadeDiaria ?? config.maxPublicacoesAutomaticasPorDia,
    padrao.quantidadeDiaria,
    1,
    20
  );
  const formatos = normalizarFormatosPublicacao(config.formatos || config.formatosPublicacao);

  return {
    ...padrao,
    ...config,
    clienteId,
    ativo: config.ativo === true,
    templatePadraoId: texto(config.templatePadraoId || padrao.templatePadraoId),
    horarios: lista(config.horarios).map(item => hora(item)).filter(Boolean).slice(0, 24),
    quantidadeDiaria,
    limiteDiarioAutomaticoAtivo: true,
    maxPublicacoesAutomaticasPorDia: quantidadeDiaria,
    formatos: formatos.length ? formatos : padrao.formatos,
    janelaFuncionamento: {
      inicio: hora(janela.inicio, padrao.janelaFuncionamento.inicio),
      fim: hora(janela.fim, padrao.janelaFuncionamento.fim)
    },
    intervaloMinimoMinutos: inteiro(config.intervaloMinimoMinutos, padrao.intervaloMinimoMinutos, 10, 1440),
    idadeMaximaHoras: inteiro(config.idadeMaximaHoras, padrao.idadeMaximaHoras, 1, 168),
    marketplacesPermitidos: lista(config.marketplacesPermitidos).map(texto).filter(Boolean),
    categoriasPermitidas: lista(config.categoriasPermitidas).map(texto).filter(Boolean),
    scoreMinimo: inteiro(config.scoreMinimo, padrao.scoreMinimo, 0, 100),
    exigirCupom: config.exigirCupom === true,
    permitirOfertaComum: config.permitirOfertaComum !== false,
    limparAutomaticamenteOportunidadesAntigas: config.limparAutomaticamenteOportunidadesAntigas === true,
    aprovacaoManual: config.aprovacaoManual === true,
    evitarProdutoRepetidoDias: inteiro(config.evitarProdutoRepetidoDias, padrao.evitarProdutoRepetidoDias, 0, 365),
    gatilho: {
      ativo: gatilho.ativo === true,
      palavra: texto(gatilho.palavra || padrao.gatilho.palavra).slice(0, 40),
      respostaPublica: texto(gatilho.respostaPublica).slice(0, 220)
    },
    cta: {
      destino: ["bio", "grupo", "whatsapp"].includes(destino) ? destino : "bio",
      linkGrupo: urlHttpsOpcional(cta.linkGrupo),
      whatsapp: texto(cta.whatsapp).slice(0, 120),
      linkBio: urlHttpsOpcional(cta.linkBio)
    },
    criadoEm: config.criadoEm || agoraIso(),
    atualizadoEm: agoraIso()
  };
}

function setConfigSocial(clienteId = "admin", dados = {}) {
  const config = normalizarConfig(clienteId, {
    ...getConfigSocial(clienteId),
    ...(dados && typeof dados === "object" ? dados : {})
  });

  escreverCliente(clienteId, "config", config);
  logSocial("[SOCIAL-CONFIG]", { clienteId, atualizado: true });
  return config;
}

function listarTemplatesSocial(clienteId = "admin") {
  return lista(lerCliente(clienteId, "templates", [])).map((item, index) =>
    normalizarTemplate(clienteId, item, index)
  );
}

function salvarTemplateSocial(clienteId = "admin", dados = {}) {
  const atuais = listarTemplatesSocial(clienteId);
  const novo = normalizarTemplate(clienteId, dados, atuais.length);
  const semAtual = atuais
    .filter(item => item.id !== novo.id)
    .map(item => (novo.padrao ? { ...item, padrao: false } : item));
  const templates = [...semAtual, novo];

  escreverCliente(clienteId, "templates", templates);
  const config = getConfigAutomaticoSocial(clienteId);
  if (novo.padrao) {
    setConfigAutomaticoSocial(clienteId, {
      ...config,
      templatePadraoId: novo.id
    });
  } else if (texto(config.templatePadraoId) === novo.id && !templates.some(item => item.padrao === true)) {
    setConfigAutomaticoSocial(clienteId, {
      ...config,
      templatePadraoId: "padrao-instagram"
    });
  }
  logSocial("[SOCIAL-TEMPLATE]", { clienteId, id: novo.id, rede: novo.rede });
  return novo;
}

function removerTemplateSocial(clienteId = "admin", id = "") {
  const templateId = texto(id);
  if (!templateId || templateId === "padrao-instagram") return null;

  const atuais = listarTemplatesSocial(clienteId);
  const existente = atuais.find(item => item.id === templateId) || null;
  if (!existente) return null;

  const templates = atuais.filter(item => item.id !== templateId);
  escreverCliente(clienteId, "templates", templates);

  const config = getConfigAutomaticoSocial(clienteId);
  if (texto(config.templatePadraoId) === templateId || existente.padrao === true) {
    setConfigAutomaticoSocial(clienteId, {
      ...config,
      templatePadraoId: "padrao-instagram"
    });
  }

  logSocial("[SOCIAL-TEMPLATE-EXCLUIDO]", {
    clienteId,
    id: templateId,
    eraPadrao: existente.padrao === true
  });
  return existente;
}

function listarAgendamentosSocial(clienteId = "admin") {
  return lista(lerCliente(clienteId, "agendamentos", [])).map((item, index) =>
    normalizarAgendamento(clienteId, item, index)
  );
}

function listarRascunhosSocial(clienteId = "admin") {
  return lista(lerCliente(clienteId, "rascunhos", [])).map((item, index) =>
    normalizarRascunho(clienteId, item, index)
  );
}

function getRascunhoSocial(clienteId = "admin", id = "") {
  const rascunhoId = texto(id);
  if (!rascunhoId) return null;
  return listarRascunhosSocial(clienteId).find(item => item.id === rascunhoId) || null;
}

function salvarRascunhoSocial(clienteId = "admin", dados = {}) {
  const atuais = listarRascunhosSocial(clienteId);
  const existente = texto(dados.id)
    ? atuais.find(item => item.id === texto(dados.id))
    : null;
  const novo = normalizarRascunho(clienteId, {
    ...(existente || {}),
    ...dados,
    status: dados.status || existente?.status || "rascunho",
    criadoEm: existente?.criadoEm || dados.criadoEm
  }, atuais.length);
  const rascunhos = [...atuais.filter(item => item.id !== novo.id), novo].slice(-500);

  escreverCliente(clienteId, "rascunhos", rascunhos);
  logSocial("[SOCIAL-RASCUNHO]", {
    clienteId,
    id: novo.id,
    origem: novo.origem,
    tipoPublicacao: novo.tipoPublicacao,
    status: novo.status
  });
  return novo;
}

function removerRascunhoSocial(clienteId = "admin", id = "") {
  const rascunhoId = texto(id);
  const atuais = listarRascunhosSocial(clienteId);
  const existente = atuais.find(item => item.id === rascunhoId) || null;
  if (!existente) return null;
  escreverCliente(clienteId, "rascunhos", atuais.filter(item => item.id !== rascunhoId));
  logSocial("[SOCIAL-RASCUNHO-EXCLUIDO]", { clienteId, id: rascunhoId });
  return existente;
}

function salvarAgendamentoSocial(clienteId = "admin", dados = {}) {
  const atuais = listarAgendamentosSocial(clienteId);
  const existente = texto(dados.id)
    ? atuais.find(item => item.id === texto(dados.id))
    : null;
  const novo = normalizarAgendamento(clienteId, {
    ...(existente || {}),
    ...dados,
    criadoEm: existente?.criadoEm || dados.criadoEm
  }, atuais.length);
  const semAtual = atuais.filter(item => item.id !== novo.id);
  const agendamentos = [...semAtual, novo];

  escreverCliente(clienteId, "agendamentos", agendamentos);
  logSocial("[SOCIAL-AGENDAMENTO]", { clienteId, id: novo.id, redes: novo.redes });
  return novo;
}

function getAgendamentoSocial(clienteId = "admin", id = "") {
  const agendamentoId = texto(id);
  if (!agendamentoId) return null;
  return listarAgendamentosSocial(clienteId).find(item => item.id === agendamentoId) || null;
}

const STATUS_AGENDAMENTO_LIMPEZA_ATIVA = new Set(["pendente", "agendada", "aguardando_aprovacao"]);
const MODOS_LIMPEZA_AGENDAMENTOS = new Set(["erro", "cancelada", "publicada", "agendada", "tudo"]);

function agendamentoEntraNaLimpeza(agendamento = {}, modo = "") {
  const status = texto(agendamento.status || "pendente").toLowerCase();
  if (modo === "tudo") return true;
  if (["erro", "cancelada", "publicada"].includes(modo)) return status === modo;
  if (modo === "agendada") {
    return agendamento.ativo !== false && STATUS_AGENDAMENTO_LIMPEZA_ATIVA.has(status);
  }
  return false;
}

function removerAgendamentoSocial(clienteId = "admin", id = "") {
  const agendamentoId = texto(id);
  const atuais = listarAgendamentosSocial(clienteId);
  const existente = atuais.find(item => item.id === agendamentoId) || null;
  if (!existente) return null;
  escreverCliente(clienteId, "agendamentos", atuais.filter(item => item.id !== agendamentoId));
  logSocial("[SOCIAL-AGENDAMENTO-EXCLUIDO]", { clienteId, id: agendamentoId });
  return existente;
}

function limparAgendamentosSocial(clienteId = "admin", modoEntrada = "") {
  const modo = texto(modoEntrada).toLowerCase();
  if (!MODOS_LIMPEZA_AGENDAMENTOS.has(modo)) {
    const erro = new Error("modo_limpeza_agendamentos_invalido");
    erro.codigo = "modo_limpeza_agendamentos_invalido";
    throw erro;
  }

  const atuais = listarAgendamentosSocial(clienteId);
  const removidos = [];
  const mantidos = [];

  for (const agendamento of atuais) {
    if (agendamentoEntraNaLimpeza(agendamento, modo)) {
      removidos.push(agendamento);
    } else {
      mantidos.push(agendamento);
    }
  }

  escreverCliente(clienteId, "agendamentos", mantidos);
  logSocial("[SOCIAL-AGENDAMENTOS-LIMPEZA]", {
    clienteId,
    modo,
    removidos: removidos.length,
    restantes: mantidos.length
  });

  return {
    modo,
    totalAntes: atuais.length,
    removidos: removidos.length,
    restantes: mantidos.length
  };
}

function listarPublicacoesSocial(clienteId = "admin", limite = 100) {
  return lista(lerCliente(clienteId, "publicacoes", []))
    .map((item, index) => normalizarPublicacao(clienteId, item, index))
    .slice(-limite)
    .reverse();
}

function registrarPublicacaoSocial(clienteId = "admin", dados = {}) {
  const atuais = lista(lerCliente(clienteId, "publicacoes", []));
  const publicacao = normalizarPublicacao(clienteId, {
    ...dados,
    status: dados.status || "rascunho",
    motivo: dados.motivo || "publicacao_social_nao_implementada"
  }, atuais.length);
  const publicacoes = [...atuais.filter(item => item.id !== publicacao.id), publicacao].slice(-500);

  escreverCliente(clienteId, "publicacoes", publicacoes);
  logSocial("[SOCIAL-PUBLICACAO]", {
    clienteId,
    id: publicacao.id,
    redes: publicacao.redes,
    status: publicacao.status,
    motivo: publicacao.motivo
  });
  return publicacao;
}

function normalizarControleOportunidadesSocial(clienteId = "admin", dados = {}) {
  const base = dados && typeof dados === "object" && !Array.isArray(dados) ? dados : {};
  const ocultas = base.ocultas && typeof base.ocultas === "object" && !Array.isArray(base.ocultas)
    ? base.ocultas
    : {};
  return {
    clienteId,
    ocultas,
    atualizadoEm: texto(base.atualizadoEm)
  };
}

function getControleOportunidadesSocial(clienteId = "admin") {
  return normalizarControleOportunidadesSocial(
    clienteId,
    lerCliente(clienteId, "oportunidades", { clienteId, ocultas: {}, atualizadoEm: "" })
  );
}

function salvarControleOportunidadesSocial(clienteId = "admin", controle = {}) {
  const normalizado = normalizarControleOportunidadesSocial(clienteId, {
    ...controle,
    atualizadoEm: agoraIso()
  });
  escreverCliente(clienteId, "oportunidades", normalizado);
  return normalizado;
}

function oportunidadeEstaOculta(controle = {}, item = {}) {
  const ids = idsOfertaSocial(item);
  const chave = texto(item._chaveSocialOportunidade || item.chaveCanonica || item.chave);
  for (const id of ids) {
    if (controle.ocultas?.[id]) return true;
  }
  return Boolean(chave && controle.ocultas?.[chave]);
}

function publicacaoInstagramDaOferta(clienteId = "admin", ofertaId = "") {
  const alvo = texto(ofertaId);
  if (!alvo) return null;
  return lista(readClienteJson(clienteId, "social-publicacoes.json", []))
    .find(item =>
      texto(item?.rede || "instagram") === "instagram" &&
      texto(item?.ofertaId) === alvo &&
      ["publicada", "concluida", "sucesso", "processando"].includes(texto(item?.status || item?.statusGeral).toLowerCase())
    ) || null;
}

function agendamentoAtivoDaOferta(clienteId = "admin", ofertaId = "", ignorarAgendamentoId = "") {
  const alvo = texto(ofertaId);
  const ignorar = texto(ignorarAgendamentoId);
  if (!alvo) return null;
  return listarAgendamentosSocial(clienteId)
    .find(item =>
      texto(item?.ofertaId) === alvo &&
      (!ignorar || texto(item?.id) !== ignorar) &&
      item?.ativo !== false &&
      STATUS_AGENDAMENTO_ATIVO_SOCIAL.has(texto(item?.status || "pendente").toLowerCase())
    ) || null;
}

function encontrarItemFilaSocial(clienteId = "admin", ofertaId = "") {
  const alvo = texto(ofertaId);
  if (!alvo) return null;
  const clienteSeguro = texto(clienteId || "admin");
  return lista(readClienteJson(clienteSeguro, "fila.json", []))
    .filter(item => !texto(item?.clienteId) || texto(item?.clienteId) === clienteSeguro)
    .find(item => idsOfertaSocial(item).has(alvo)) || null;
}

function validarOportunidadeSocialManual(clienteId = "admin", ofertaId = "", opcoes = {}) {
  const clienteSeguro = texto(clienteId || "admin");
  const item = encontrarItemFilaSocial(clienteSeguro, ofertaId);
  const id = texto(ofertaId);
  if (!item) return { ok: false, motivo: "oferta_nao_encontrada" };

  const statusInvalido = statusOportunidadeInvalido(item);
  if (statusInvalido) return { ok: false, motivo: "oferta_status_invalido", status: statusInvalido };
  if (cupomExplicitamenteExpirado(item)) return { ok: false, motivo: "oferta_cupom_expirado" };
  if (oportunidadeBloqueadaOuInativa(item)) return { ok: false, motivo: "oferta_bloqueada_inativa" };

  const imagem = texto(item.imagem || item.image || item.thumbnail);
  if (!temImagemValida(imagem)) return { ok: false, motivo: "imagem_ausente" };

  const linkAfiliado = texto(item.linkAfiliado || item.linkFinal || item.link_afiliado);
  if (!temLinkValido(linkAfiliado)) return { ok: false, motivo: "oferta_link_ausente" };

  if (publicacaoInstagramDaOferta(clienteSeguro, id)) return { ok: false, motivo: "oferta_ja_publicada" };
  if (agendamentoAtivoDaOferta(clienteSeguro, id, opcoes.ignorarAgendamentoId)) return { ok: false, motivo: "oferta_ja_agendada" };

  return { ok: true, motivo: "", ofertaId: id };
}

function limparOportunidadesSocial(clienteId = "admin", { modo = "galeria", idadeMaximaHoras = 6, agora = new Date() } = {}) {
  const clienteSeguro = texto(clienteId || "admin");
  const controle = getControleOportunidadesSocial(clienteSeguro);
  const fila = lista(readClienteJson(clienteSeguro, "fila.json", []))
    .filter(item => !texto(item?.clienteId) || texto(item?.clienteId) === clienteSeguro);
  const agoraMs = agora instanceof Date ? agora.getTime() : Number(agora || Date.now());
  const limiteMinutos = Math.max(1, Number(idadeMaximaHoras || 6) || 6) * 60;
  const ofertasVisiveis = modo === "galeria"
    ? new Set(listarOportunidadesSocial(clienteSeguro, 50).map(item => texto(item.ofertaId)).filter(Boolean))
    : null;
  let ocultadas = 0;

  for (const item of fila) {
    const ofertaId = idOfertaOficialSocial(item);
    if (!ofertaId) continue;
    if (ofertasVisiveis && !ofertasVisiveis.has(ofertaId)) continue;
    if (modo === "antigas") {
      const recencia = recenciaOportunidade(dataRecenciaOportunidade(item), agoraMs, idadeMaximaHoras);
      if (!recencia.recenciaConfiavel || recencia.idadeEmMinutos <= limiteMinutos) continue;
    }
    if (!controle.ocultas[ofertaId]) ocultadas += 1;
    controle.ocultas[ofertaId] = {
      motivo: modo === "antigas" ? "limpeza_antigas" : "limpeza_galeria",
      ocultadaEm: agoraIso()
    };
  }

  salvarControleOportunidadesSocial(clienteSeguro, controle);
  logSocial("[SOCIAL-OPORTUNIDADES-LIMPEZA]", {
    clienteId: clienteSeguro,
    modo,
    ocultadas
  });

  return { ok: true, clienteId: clienteSeguro, modo, ocultadas };
}

function listarOportunidadesSocial(clienteId = "admin", limite = 100) {
  const limiteSeguro = Math.max(1, Math.min(50, Number(limite || 50) || 50));
  const clienteSeguro = texto(clienteId || "admin");
  const configAutomatico = getConfigAutomaticoSocial(clienteSeguro);
  const controle = getControleOportunidadesSocial(clienteSeguro);
  const agora = Date.now();
  const itens = lista(readClienteJson(clienteSeguro, "fila.json", []))
    .filter(item => !texto(item?.clienteId) || texto(item?.clienteId) === clienteSeguro);
  const vistas = new Set();
  const oportunidades = [];

  for (const item of itens) {
    const v2 = item.inteligenciaUniversalV2 || {};
    const titulo = texto(item.titulo || item.nome);
    const marketplace = texto(item.marketplace);
    const imagem = texto(item.imagem || item.image || item.thumbnail);
    const linkAfiliado = texto(item.linkAfiliado || item.linkFinal || item.link_afiliado);
    const linkOriginal = texto(item.linkOriginal || item.urlOriginal || item.url || item.link);
    const linkReferencia = linkAfiliado || linkOriginal;
    const precoAtual = numero(v2.valorEfetivo ?? item.valorEfetivo ?? item.precoAtual ?? item.preco);
    const precoOriginal = numero(item.precoOriginal ?? item.precoAntigo ?? item.precoDe);
    const score = numero(v2.score?.score ?? v2.score ?? item.score ?? item.radarScore);
    const prioridade = numero(v2.prioridade ?? item.prioridade ?? item.prioridadeEnvio ?? item.prioridadeFila);
    const cupom = texto(item.cupom || item.cupomCodigo || item.cupomInfo?.cupom);
    const expiraEm = texto(item.expiraEm || item.validadeCupom || item.cupomExpiraEm);
    const statusOperacional = texto(item.status).toLowerCase();
    const statusV2 = texto(v2.status).toLowerCase();
    const expirado =
      ["expirada", "expirado"].includes(statusOperacional) ||
      texto(item.statusDetalhe).toLowerCase().includes("expirado") ||
      (expiraEm && dataMs(expiraEm) > 0 && dataMs(expiraEm) < Date.now());
    const bloqueada =
      ["retida", "erro", "reprovada"].includes(statusOperacional) ||
      ["retida", "erro", "reprovada"].includes(statusV2);
    const aprovadoV2 =
      v2.ok === true ||
      ["aprovada", "aprovado"].includes(statusV2) ||
      item.ofertaUniversal === true ||
      texto(item.versaoOfertaUniversal).startsWith("v2");
    const ofertaId = idOfertaOficialSocial(item);
    const linkAfiliadoPresente = temLinkValido(linkAfiliado);

    if (oportunidadeEstaOculta(controle, item)) continue;
    if (!ofertaId || !titulo || !marketplace || !temImagemValida(imagem)) continue;
    if (precoAtual === null || precoAtual <= 0) continue;
    if (expirado) continue;
    if (bloqueada) continue;
    if (!aprovadoV2 && !(score !== null && score >= 60) && !cupom) continue;

    const chave =
      texto(item.produtoId || item.productId || item.sku) ||
      normalizarChave(linkOriginal) ||
      normalizarChave(linkReferencia) ||
      normalizarChave(ofertaId) ||
      `${normalizarChave(titulo)}|${normalizarChave(marketplace)}`;

    if (!chave || vistas.has(chave)) continue;
    vistas.add(chave);

    const criadoEm = dataRecenciaOportunidade(item);
    const recencia = recenciaOportunidade(criadoEm, agora, configAutomatico.idadeMaximaHoras);
    const idBase = texto(item.id || item.ofertaId || item.produtoId || chave);
    const motivoIndisponivel = linkAfiliadoPresente ? "" : "sem_link_afiliado";

    oportunidades.push({
      id: `social_${normalizarChave(idBase).replace(/[^a-z0-9_-]/g, "_").slice(0, 80) || criarId("oportunidade")}`,
      ofertaId,
      ofertaUniversalId: texto(item.ofertaUniversalId || item.id || item.ofertaId),
      titulo,
      imagem,
      marketplace,
      categoria: texto(v2.categoria || item.categoria),
      preco: precoAtual,
      precoAtual,
      precoOriginal,
      valorEfetivo: numero(v2.valorEfetivo ?? item.valorEfetivo),
      cupom,
      score,
      prioridade,
      origem: texto(item.origem || "fila"),
      linkAfiliadoPresente,
      publicavel: linkAfiliadoPresente,
      motivoIndisponivel,
      criadoEm,
      idadeEmMinutos: recencia.idadeEmMinutos,
      recenciaConfiavel: recencia.recenciaConfiavel,
      antigaParaAutomatico: recencia.antigaParaAutomatico,
      motivoForaAutomatico: recencia.motivoForaAutomatico,
      expiraEm,
      statusSocial: "nova",
      _ordenacao: {
        cupom: cupom ? 1 : 0,
        score: score ?? 0,
        prioridade: prioridade ?? 0,
        criadoEm: dataMs(criadoEm)
      }
    });
  }

  oportunidades.sort((a, b) =>
    b._ordenacao.cupom - a._ordenacao.cupom ||
    b._ordenacao.score - a._ordenacao.score ||
    b._ordenacao.prioridade - a._ordenacao.prioridade ||
    b._ordenacao.criadoEm - a._ordenacao.criadoEm
  );

  const resultado = oportunidades
    .slice(0, limiteSeguro)
    .map(({ _ordenacao, ...item }) => item);

  logSocial("[SOCIAL-OPORTUNIDADES-FONTE]", {
    clienteId,
    fonte: "fila_cliente",
    totalFonte: itens.length,
    elegiveis: oportunidades.length,
    retornadas: resultado.length
  });

  return resultado;
}

function getConfigAutomaticoSocial(clienteId = "admin") {
  return normalizarConfigAutomatico(
    clienteId,
    lerCliente(clienteId, "automatico", criarConfigAutomaticoPadrao(clienteId))
  );
}

const STATUS_LIMITE_DIARIO_AUTOMATICO = new Set(["pendente", "agendada", "aguardando_aprovacao", "processando", "publicando", "publicada"]);

function chaveDiaAgendamentoSocial(agendamento = {}) {
  const valor = texto(agendamento.agendadoPara || agendamento.horario);
  return /^\d{4}-\d{2}-\d{2}/.test(valor) ? valor.slice(0, 10) : "";
}

function ocupaLimiteAutomaticoSocial(agendamento = {}) {
  if (texto(agendamento.origem) !== "automatico") return false;
  const status = texto(agendamento.status || "pendente").toLowerCase();
  return STATUS_LIMITE_DIARIO_AUTOMATICO.has(status);
}

function scoreAgendamentoAutomatico(agendamento = {}) {
  const automatico = agendamento.automatico && typeof agendamento.automatico === "object" ? agendamento.automatico : {};
  const score = Number(automatico.score ?? agendamento.score ?? 0);
  return Number.isFinite(score) ? score : 0;
}

function reconciliarLimiteDiarioAutomaticoSocial(clienteId = "admin", config = {}) {
  if (config.limiteDiarioAutomaticoAtivo !== true) return { canceladasExcedentes: 0 };

  const limite = inteiro(config.quantidadeDiaria ?? config.maxPublicacoesAutomaticasPorDia, 5, 1, 20);
  const atuais = listarAgendamentosSocial(clienteId);
  const agora = Date.now();
  const grupos = new Map();

  for (const agendamento of atuais) {
    if (!ocupaLimiteAutomaticoSocial(agendamento)) continue;
    const dia = chaveDiaAgendamentoSocial(agendamento);
    if (!dia) continue;
    if (!grupos.has(dia)) grupos.set(dia, []);
    grupos.get(dia).push(agendamento);
  }

  const cancelarIds = new Set();
  for (const [dia, itens] of grupos.entries()) {
    if (itens.length <= limite) continue;

    const naoCancelaveis = itens.filter(item => {
      const status = texto(item.status || "").toLowerCase();
      const data = Date.parse(texto(item.agendadoPara || item.horario));
      return status === "publicada" || status === "processando" || status === "publicando" || !(Number.isFinite(data) && data > agora);
    });
    const vagasParaFuturos = Math.max(0, limite - naoCancelaveis.length);
    const futurosCancelaveis = itens
      .filter(item => !naoCancelaveis.some(fixo => fixo.id === item.id))
      .sort((a, b) =>
        scoreAgendamentoAutomatico(b) - scoreAgendamentoAutomatico(a) ||
        Date.parse(texto(a.agendadoPara || a.horario)) - Date.parse(texto(b.agendadoPara || b.horario)) ||
        texto(a.id).localeCompare(texto(b.id))
      );

    for (const excedente of futurosCancelaveis.slice(vagasParaFuturos)) {
      cancelarIds.add(excedente.id);
    }

    if (cancelarIds.size) {
      logSocial("[SOCIAL-AUTO-LIMITE-DIARIO]", {
        clienteId,
        data: dia,
        limiteAtivo: true,
        limite,
        publicadas: itens.filter(item => texto(item.status).toLowerCase() === "publicada").length,
        pendentes: itens.filter(item => texto(item.status).toLowerCase() !== "publicada").length,
        vagas: Math.max(0, limite - itens.length),
        criadas: 0,
        canceladasExcedentes: cancelarIds.size,
        motivo: "limite_diario_reduzido"
      });
    }
  }

  if (!cancelarIds.size) return { canceladasExcedentes: 0 };

  const atualizados = atuais.map(item => cancelarIds.has(item.id)
    ? { ...item, ativo: false, status: "cancelada", motivo: "limite_diario_reduzido", atualizadoEm: agoraIso() }
    : item
  );
  escreverCliente(clienteId, "agendamentos", atualizados);
  return { canceladasExcedentes: cancelarIds.size };
}

function setConfigAutomaticoSocial(clienteId = "admin", dados = {}) {
  const atual = getConfigAutomaticoSocial(clienteId);
  const entrada = dados && typeof dados === "object" ? { ...dados } : {};
  if (Object.prototype.hasOwnProperty.call(entrada, "quantidadeDiaria") &&
    !Object.prototype.hasOwnProperty.call(entrada, "maxPublicacoesAutomaticasPorDia")) {
    entrada.maxPublicacoesAutomaticasPorDia = entrada.quantidadeDiaria;
  }
  if (!Object.prototype.hasOwnProperty.call(entrada, "quantidadeDiaria") &&
    Object.prototype.hasOwnProperty.call(entrada, "maxPublicacoesAutomaticasPorDia")) {
    entrada.quantidadeDiaria = entrada.maxPublicacoesAutomaticasPorDia;
  }
  const config = normalizarConfigAutomatico(clienteId, {
    ...atual,
    ...entrada
  });
  escreverCliente(clienteId, "automatico", config);
  const limiteReduzido = Number(config.quantidadeDiaria) < Number(atual.quantidadeDiaria);
  const reconciliacao = limiteReduzido
    ? reconciliarLimiteDiarioAutomaticoSocial(clienteId, config)
    : { canceladasExcedentes: 0 };
  logSocial("[SOCIAL-AUTOMATICO-CONFIG]", {
    clienteId,
    ativo: config.ativo,
    quantidadeDiaria: config.quantidadeDiaria,
    limiteDiarioAutomaticoAtivo: config.limiteDiarioAutomaticoAtivo,
    maxPublicacoesAutomaticasPorDia: config.maxPublicacoesAutomaticasPorDia,
    canceladasExcedentes: reconciliacao.canceladasExcedentes,
    scoreMinimo: config.scoreMinimo
  });
  return config;
}

function getConexaoMetaSocial(clienteId = "admin") {
  const padrao = criarMetaPadrao(clienteId);
  const dados = lerCliente(clienteId, "meta", padrao);
  const paginas = lista(dados.paginas).map(pagina => ({
    id: texto(pagina.id),
    name: texto(pagina.name),
    username: texto(pagina.username),
    accessToken: texto(pagina.accessToken),
    instagramBusinessAccountId: texto(pagina.instagramBusinessAccountId),
    instagramUsername: texto(pagina.instagramUsername),
    instagramName: texto(pagina.instagramName),
    conectado: pagina.conectado === true
  }));
  const paginaPrincipal = paginas.find(pagina => pagina.conectado) || paginas[0] || {};
  const instagramConectado = Boolean(paginaPrincipal.instagramBusinessAccountId);
  const token = dados.token && typeof dados.token === "object" ? dados.token : {};
  const accessToken = texto(dados.accessToken || token.accessToken);

  const conexao = {
    ...padrao,
    ...dados,
    clienteId,
    status: accessToken ? "conectado" : "desconectado",
    conectado: Boolean(accessToken),
    facebook: {
      ...padrao.facebook,
      ...(dados.facebook && typeof dados.facebook === "object" ? dados.facebook : {}),
      conectado: Boolean(paginaPrincipal.id),
      pageId: texto(dados.facebook?.pageId || paginaPrincipal.id),
      pageAccessToken: texto(dados.facebook?.pageAccessToken || paginaPrincipal.accessToken),
      pageName: texto(dados.facebook?.pageName || paginaPrincipal.name),
      pageUsername: texto(dados.facebook?.pageUsername || paginaPrincipal.username)
    },
    instagram: {
      ...padrao.instagram,
      ...(dados.instagram && typeof dados.instagram === "object" ? dados.instagram : {}),
      conectado: instagramConectado,
      instagramBusinessAccountId: texto(dados.instagram?.instagramBusinessAccountId || paginaPrincipal.instagramBusinessAccountId),
      username: texto(dados.instagram?.username || paginaPrincipal.instagramUsername),
      name: texto(dados.instagram?.name || paginaPrincipal.instagramName)
    },
    token: {
      ...padrao.token,
      ...token,
      accessToken
    },
    ativos: {
      ...padrao.ativos,
      ...(dados.ativos && typeof dados.ativos === "object" ? dados.ativos : {})
    },
    paginas,
    atualizadoEm: texto(dados.atualizadoEm || agoraIso())
  };

  logSocial("[SOCIAL-META-STORAGE-LER]", {
    clienteId,
    caminhoLogico: caminhoLogicoCliente(clienteId, "meta"),
    ...resumoMetaStorage(conexao)
  });

  return conexao;
}

function setConexaoMetaSocial(clienteId = "admin", dados = {}) {
  const atual = getConexaoMetaSocial(clienteId);
  const atualizado = {
    ...atual,
    ...(dados && typeof dados === "object" ? dados : {}),
    clienteId,
    atualizadoEm: agoraIso()
  };

  const gravou = escreverCliente(clienteId, "meta", atualizado);
  logSocial("[SOCIAL-META-STORAGE-SALVAR]", {
    clienteId,
    caminhoLogico: caminhoLogicoCliente(clienteId, "meta"),
    gravou,
    ...resumoMetaStorage({
      ...atualizado,
      conectado: Boolean(atualizado.token?.accessToken || atualizado.accessToken)
    })
  });

  if (!gravou) {
    throw new Error("social_meta_storage_salvar_falhou");
  }

  logSocial("[SOCIAL-META-CONEXAO]", {
    clienteId,
    conectado: Boolean(atualizado.token?.accessToken || atualizado.accessToken),
    paginas: lista(atualizado.paginas).length
  });
  return getConexaoMetaSocial(clienteId);
}

function selecionarAtivoMetaSocial(clienteId = "admin", selecao = {}) {
  const atual = getConexaoMetaSocial(clienteId);
  const pageId = texto(selecao.pageId || selecao.paginaId || selecao.facebookPageId);
  const instagramId = texto(selecao.instagramBusinessAccountId || selecao.instagramId);

  if (!pageId) {
    throw new Error("social_meta_pageId_obrigatorio");
  }

  const paginas = lista(atual.paginas);
  const paginaSelecionada = paginas.find(pagina => texto(pagina.id) === pageId);

  if (!paginaSelecionada) {
    throw new Error("social_meta_pagina_nao_autorizada");
  }

  if (instagramId && texto(paginaSelecionada.instagramBusinessAccountId) !== instagramId) {
    throw new Error("social_meta_instagram_nao_autorizado");
  }

  const paginasAtualizadas = paginas.map(pagina => ({
    ...pagina,
    conectado: texto(pagina.id) === pageId
  }));
  const instagramSelecionado = instagramId || texto(paginaSelecionada.instagramBusinessAccountId);
  const atualizado = setConexaoMetaSocial(clienteId, {
    ...atual,
    facebook: {
      conectado: true,
      pageId: texto(paginaSelecionada.id),
      pageAccessToken: texto(paginaSelecionada.accessToken),
      pageName: texto(paginaSelecionada.name),
      pageUsername: texto(paginaSelecionada.username)
    },
    instagram: {
      conectado: Boolean(instagramSelecionado),
      instagramBusinessAccountId: instagramSelecionado,
      username: texto(paginaSelecionada.instagramUsername),
      name: texto(paginaSelecionada.instagramName)
    },
    paginas: paginasAtualizadas,
    ativos: {
      ...(atual.ativos || {}),
      status: "ativo_selecionado",
      atualizadoEm: agoraIso()
    }
  });

  logSocial("[SOCIAL-META-ATIVO-SELECIONADO]", {
    clienteId,
    pageId: texto(paginaSelecionada.id),
    instagramBusinessAccountId: instagramSelecionado,
    instagramConectado: Boolean(instagramSelecionado)
  });

  return atualizado;
}

function limparConexaoMetaSocial(clienteId = "admin") {
  const desconectado = criarMetaPadrao(clienteId);
  escreverCliente(clienteId, "meta", desconectado);
  logSocial("[SOCIAL-META-DESCONECTADO]", { clienteId });
  return sanitizarConexaoMeta(desconectado);
}

module.exports = {
  ARQUIVOS,
  REDES_SUPORTADAS,
  criarConfigPadrao,
  getConfigSocial,
  setConfigSocial,
  listarTemplatesSocial,
  salvarTemplateSocial,
  removerTemplateSocial,
  listarRascunhosSocial,
  getRascunhoSocial,
  salvarRascunhoSocial,
  removerRascunhoSocial,
  listarAgendamentosSocial,
  salvarAgendamentoSocial,
  getAgendamentoSocial,
  removerAgendamentoSocial,
  limparAgendamentosSocial,
  criarConfigAutomaticoPadrao,
  getConfigAutomaticoSocial,
  setConfigAutomaticoSocial,
  listarPublicacoesSocial,
  registrarPublicacaoSocial,
  listarOportunidadesSocial,
  validarOportunidadeSocialManual,
  limparOportunidadesSocial,
  criarMetaPadrao,
  getConexaoMetaSocial,
  setConexaoMetaSocial,
  selecionarAtivoMetaSocial,
  limparConexaoMetaSocial,
  sanitizarConexaoMeta,
  resumirOfertaUniversal,
  listClientes
};
