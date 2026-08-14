const {
  readClienteJson,
  writeClienteJson
} = require("./storage");

const ARQUIVO = "alertas-integracoes.json";
const ARQUIVO_SAUDE = "saude-integracoes.json";

function normalizarMarketplace(marketplace = "") {
  return String(marketplace || "").trim().toLowerCase();
}

function normalizarIntegracaoId(integracaoId = "") {
  return String(integracaoId || "").trim().toLowerCase();
}

function chaveSaude(marketplace = "", integracaoId = "") {
  const mp = normalizarMarketplace(marketplace);
  const id = normalizarIntegracaoId(integracaoId);
  return id ? `${mp}:${id}` : mp;
}

function agoraIso() {
  return new Date().toISOString();
}

function logSaudeFailOpen(etapa = "", erro = {}) {
  try {
    console.warn("[SAUDE-INTEGRACOES-FAIL-OPEN]", JSON.stringify({
      etapa,
      erro: erro?.code || erro?.name || "erro_observabilidade"
    }));
  } catch {
    // Observabilidade nunca deve interferir no fluxo principal.
  }
}

function executarSaudeFailOpen(etapa = "", fn = () => null, fallback = null) {
  try {
    return fn();
  } catch (erro) {
    logSaudeFailOpen(etapa, erro);
    return fallback;
  }
}

function detalhesSanitizados(valor = {}) {
  if (!valor || typeof valor !== "object") return {};
  const saida = {};
  const segredo = /cookie|secret|token|authorization|password|senha|apikey|api_key|access|refresh|header|payload|html|raw|resposta|stack|url|link/i;

  for (const [chave, item] of Object.entries(valor)) {
    if (segredo.test(chave)) continue;
    if (item === undefined || item === null) continue;
    if (typeof item === "string") {
      saida[chave] = item.slice(0, 160);
    } else if (typeof item === "number" || typeof item === "boolean") {
      saida[chave] = item;
    } else if (Array.isArray(item)) {
      saida[chave] = item.slice(0, 5).map(v =>
        typeof v === "string" || typeof v === "number" || typeof v === "boolean"
          ? v
          : "[omitido]"
      );
    }
  }

  return saida;
}

function classificarCodigoSaude(codigo = "", detalhes = {}) {
  const cod = String(codigo || "").toLowerCase();
  const statusHttp = Number(detalhes?.httpStatus || detalhes?.statusHttp || 0);
  const diagnostico = `${cod} ${detalhes?.motivo || ""} ${detalhes?.codigoApi || ""}`.toLowerCase();

  if (["ok", "afiliado_ok", "teste_ok", "cookie_valido", "api_valida", "sucesso_pipeline"].includes(cod)) {
    return "saudavel";
  }

  if (/captcha|bloqueio|suspicious|anti.?bot|robot|timeout|erro_rede|\brede\b|rate.?limit|429|5\d\d/.test(diagnostico)) {
    return "desconhecida";
  }

  if ([
    "cookie_expirado",
    "cookie_invalido",
    "cookies_invalidos",
    "cookie_ausente",
    "tag_ausente",
    "credencial_ausente",
    "credencial_invalida",
    "invalid_credentials",
    "token_invalido",
    "configuracao_invalida",
    "programa_invalido",
    "nao_configurado"
  ].includes(cod)) {
    return "invalida";
  }

  if ([401, 403, 419].includes(statusHttp) && /credencial|credential|cookie|login|signin|token|auth|expirad|invalid/.test(diagnostico)) {
    return "invalida";
  }
  return "desconhecida";
}

function mensagemSaude(status = "desconhecida", codigo = "") {
  if (status === "saudavel") return "Integracao funcionando";
  if (status === "invalida") return "Integracao invalida ou expirada";
  if (String(codigo || "") === "teste_paapi_nao_disponivel") return "Teste real PA-API ainda nao disponivel";
  if (String(codigo || "") === "teste_magalu_nao_disponivel") return "Teste real Magalu ainda nao disponivel";
  return "Saude da integracao desconhecida";
}

function listarAlertasIntegracoes(clienteId = "admin") {
  return readClienteJson(clienteId, ARQUIVO, []);
}

function listarSaudeIntegracoes(clienteId = "admin") {
  const dados = readClienteJson(clienteId, ARQUIVO_SAUDE, []);
  return Array.isArray(dados) ? dados : [];
}

function obterSaudeIntegracao(clienteId = "admin", marketplace = "", integracaoId = "") {
  const chave = chaveSaude(marketplace, integracaoId);
  return listarSaudeIntegracoes(clienteId).find(item => chaveSaude(item.marketplace, item.integracaoId) === chave) || null;
}

function salvarSaudeIntegracoes(clienteId = "admin", lista = []) {
  writeClienteJson(clienteId, ARQUIVO_SAUDE, Array.isArray(lista) ? lista : []);
  return lista;
}

function registrarSaudeIntegracao(clienteId = "admin", marketplace = "", estado = {}) {
  const mp = normalizarMarketplace(marketplace || estado.marketplace || "");
  if (!mp) return listarSaudeIntegracoes(clienteId);

  const integracaoId = normalizarIntegracaoId(estado.integracaoId || "");
  const chave = chaveSaude(mp, integracaoId);
  const lista = listarSaudeIntegracoes(clienteId);
  const anterior = lista.find(item => chaveSaude(item.marketplace, item.integracaoId) === chave) || {};
  const status = ["saudavel", "invalida", "desconhecida"].includes(String(estado.status || ""))
    ? String(estado.status)
    : "desconhecida";
  const agora = estado.timestamp || agoraIso();

  const proximo = {
    marketplace: mp,
    ...(integracaoId ? { integracaoId } : {}),
    status,
    codigo: String(estado.codigo || anterior.codigo || status),
    mensagem: String(estado.mensagem || mensagemSaude(status, estado.codigo || anterior.codigo || "")),
    ultimaProvaPositivaEm: status === "saudavel"
      ? agora
      : (estado.ultimaProvaPositivaEm || anterior.ultimaProvaPositivaEm || null),
    ultimaFalhaQualificadaEm: status === "invalida"
      ? agora
      : (estado.ultimaFalhaQualificadaEm || anterior.ultimaFalhaQualificadaEm || null),
    origem: String(estado.origem || anterior.origem || "sensor"),
    atualizadoEm: agora,
    detalhes: detalhesSanitizados(estado.detalhes || {})
  };

  const novaLista = lista.filter(item => chaveSaude(item.marketplace, item.integracaoId) !== chave);
  novaLista.push(proximo);
  return salvarSaudeIntegracoes(clienteId, novaLista);
}

function saudeAPartirResultado(marketplace = "", resultado = {}, origem = "manual", anterior = null) {
  const codigo = String(resultado.codigo || resultado.status || "desconhecida").toLowerCase();
  const detalhes = detalhesSanitizados(resultado.detalhes || {});
  const statusBase = classificarCodigoSaude(codigo, detalhes);
  const transitorio = statusBase === "desconhecida";
  const status = transitorio && anterior?.status ? anterior.status : statusBase;
  const codigoFinal = transitorio && anterior?.status ? (anterior.codigo || codigo) : codigo;

  return {
    marketplace: normalizarMarketplace(marketplace || resultado.marketplace || ""),
    status,
    codigo: codigoFinal,
    mensagem: resultado.mensagem || mensagemSaude(status, codigoFinal),
    origem,
    detalhes
  };
}

function registrarResultadoSaudeIntegracao(clienteId = "admin", marketplace = "", resultado = {}, origem = "manual") {
  return executarSaudeFailOpen("registrar_resultado", () => {
    const mp = normalizarMarketplace(marketplace || resultado.marketplace || "");
    const integracaoId = normalizarIntegracaoId(resultado.integracaoId || resultado.saude?.integracaoId || "");
    const anterior = obterSaudeIntegracao(clienteId, mp, integracaoId);
    const estado = saudeAPartirResultado(mp, resultado, origem, anterior);
    if (integracaoId) estado.integracaoId = integracaoId;
    registrarSaudeIntegracao(clienteId, mp, estado);

    if (Array.isArray(resultado.saudeFilhas)) {
      for (const filha of resultado.saudeFilhas) {
        const marketplaceFilha = normalizarMarketplace(filha.marketplace || mp);
        const integracaoIdFilha = normalizarIntegracaoId(filha.integracaoId || "");
        if (!marketplaceFilha || !integracaoIdFilha) continue;
        const anteriorFilha = obterSaudeIntegracao(clienteId, marketplaceFilha, integracaoIdFilha);
        const estadoFilha = saudeAPartirResultado(marketplaceFilha, filha, origem, anteriorFilha);
        estadoFilha.integracaoId = integracaoIdFilha;
        registrarSaudeIntegracao(clienteId, marketplaceFilha, estadoFilha);
      }
    }

    return obterSaudeIntegracao(clienteId, mp, integracaoId);
  }, null);
}

function registrarSucessoIntegracao(
  clienteId = "admin",
  marketplace = "",
  detalhes = {},
  origem = "sensor"
) {
  return executarSaudeFailOpen("registrar_sucesso", () => {
    const mp = normalizarMarketplace(marketplace);
    const integracaoId = normalizarIntegracaoId(detalhes?.integracaoId || "");
    limparAlertaIntegracao(clienteId, mp);
    registrarSaudeIntegracao(clienteId, mp, {
      status: "saudavel",
      codigo: detalhes?.codigo || "sucesso_pipeline",
      mensagem: "Integracao funcionando",
      origem: String(detalhes?.origem || origem),
      integracaoId,
      detalhes
    });
    return obterSaudeIntegracao(clienteId, mp, integracaoId);
  }, {
    ok: false,
    erro: "saude_integracoes_indisponivel",
    marketplace: normalizarMarketplace(marketplace)
  });
}

function registrarAlertaIntegracao(
  clienteId = "admin",
  marketplace = "",
  alerta = {}
) {
  return executarSaudeFailOpen("registrar_alerta", () => {
    const alertas = listarAlertasIntegracoes(clienteId);
    const mp = normalizarMarketplace(marketplace);

    const novaLista = alertas.filter(
      item => normalizarMarketplace(item.marketplace) !== mp
    );

    novaLista.push({
      marketplace: mp,
      tipo: alerta.tipo || "desconhecido",
      status: alerta.status || "atencao",
      mensagem: alerta.mensagem || "",
      detalhes: detalhesSanitizados(alerta.detalhes || {}),
      ultimaOcorrencia: new Date().toISOString()
    });

    writeClienteJson(clienteId, ARQUIVO, novaLista);
    registrarResultadoSaudeIntegracao(clienteId, mp, {
      status: alerta.tipo || alerta.status || "desconhecido",
      codigo: alerta.tipo || alerta.status || "desconhecido",
      mensagem: alerta.mensagem || "",
      detalhes: alerta.detalhes || {}
    }, "sensor");

    return novaLista;
  }, []);
}

function limparAlertaIntegracao(
  clienteId = "admin",
  marketplace = ""
) {
  return executarSaudeFailOpen("limpar_alerta", () => {
    const alertas = listarAlertasIntegracoes(clienteId);
    const mp = normalizarMarketplace(marketplace);

    const novaLista = alertas.filter(
      item => normalizarMarketplace(item.marketplace) !== mp
    );

    writeClienteJson(clienteId, ARQUIVO, novaLista);
    registrarSaudeIntegracao(clienteId, mp, {
      status: "desconhecida",
      codigo: "alerta_limpo_sem_prova",
      mensagem: "Saude da integracao desconhecida",
      origem: "sensor"
    });

    return novaLista;
  }, []);
}

module.exports = {
  listarAlertasIntegracoes,
  registrarAlertaIntegracao,
  limparAlertaIntegracao,
  listarSaudeIntegracoes,
  obterSaudeIntegracao,
  registrarSaudeIntegracao,
  registrarResultadoSaudeIntegracao,
  registrarSucessoIntegracao,
  classificarCodigoSaude,
  detalhesSanitizados
};
