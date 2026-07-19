const { CANAIS_PERMITIDOS, getBlocoCatalogo, tiposBlocosOficiais } = require("./catalogo-blocos");

const SCHEMA_VERSION = 1;

function erroValidacao(codigo, detalhes = {}) {
  const erro = new Error(codigo);
  erro.codigo = codigo;
  erro.statusCode = 400;
  erro.detalhes = detalhes;
  return erro;
}

function textoLimpo(valor = "") {
  return String(valor ?? "").trim();
}

function validarNome(nome) {
  const texto = textoLimpo(nome);
  if (texto.length < 2) throw erroValidacao("template_nome_invalido");
  if (texto.length > 80) throw erroValidacao("template_nome_muito_longo");
  return texto;
}

function validarDescricao(descricao = "") {
  const texto = textoLimpo(descricao);
  if (texto.length > 200) throw erroValidacao("template_descricao_muito_longa");
  return texto;
}

function validarCanais(canais) {
  const entrada = Array.isArray(canais) && canais.length ? canais : ["whatsapp", "telegram"];
  const vistos = new Set();
  const saida = [];

  for (const canal of entrada) {
    const normalizado = textoLimpo(canal).toLowerCase();
    if (!CANAIS_PERMITIDOS.includes(normalizado)) {
      throw erroValidacao("template_canal_invalido", { canal: normalizado });
    }
    if (!vistos.has(normalizado)) {
      vistos.add(normalizado);
      saida.push(normalizado);
    }
  }

  if (!saida.length) throw erroValidacao("template_canais_obrigatorios");
  return saida;
}

function validarRodape(rodape = {}) {
  const entrada = rodape && typeof rodape === "object" ? rodape : {};
  const texto = String(entrada.texto ?? "");
  if (texto.length > 2000) throw erroValidacao("template_rodape_muito_longo");
  return { ativo: Boolean(entrada.ativo), texto };
}

function blocosPadrao() {
  return tiposBlocosOficiais().map(tipo => {
    const item = getBlocoCatalogo(tipo);
    return {
      id: item.tipo,
      tipo: item.tipo,
      ativo: item.ativoPorPadrao === true,
      ordem: item.ordemPadrao
    };
  });
}

function validarBlocos(blocos) {
  const entrada = Array.isArray(blocos) && blocos.length ? blocos : blocosPadrao();
  const vistos = new Set();
  const saida = [];

  for (const bloco of entrada) {
    const tipo = textoLimpo(bloco?.tipo || bloco?.id).toLowerCase();
    const catalogo = getBlocoCatalogo(tipo);
    if (!catalogo) throw erroValidacao("template_bloco_invalido", { tipo, permitidos: tiposBlocosOficiais() });
    if (vistos.has(tipo)) throw erroValidacao("template_bloco_duplicado", { tipo });
    vistos.add(tipo);
    const ordemNumero = Number(bloco?.ordem);
    saida.push({
      id: tipo,
      tipo,
      ativo: typeof bloco?.ativo === "boolean" ? bloco.ativo : true,
      ordem: Number.isFinite(ordemNumero) ? ordemNumero : catalogo.ordemPadrao
    });
  }

  return saida.sort((a, b) => a.ordem - b.ordem || a.tipo.localeCompare(b.tipo));
}

function normalizarTemplatePayload(payload = {}, contexto = {}) {
  const agora = contexto.agora || new Date().toISOString();
  const existente = contexto.existente || {};
  const clienteId = textoLimpo(contexto.clienteId || existente.clienteId || "admin") || "admin";

  return {
    schemaVersion: SCHEMA_VERSION,
    id: contexto.id || existente.id || "",
    clienteId,
    nome: validarNome(payload.nome ?? existente.nome),
    descricao: validarDescricao(payload.descricao ?? existente.descricao ?? ""),
    ativo: typeof payload.ativo === "boolean" ? payload.ativo : (typeof existente.ativo === "boolean" ? existente.ativo : true),
    canais: validarCanais(payload.canais ?? existente.canais),
    blocos: validarBlocos(payload.blocos ?? existente.blocos),
    rodape: validarRodape(payload.rodape ?? existente.rodape),
    criadoEm: existente.criadoEm || agora,
    atualizadoEm: agora
  };
}

module.exports = {
  SCHEMA_VERSION,
  erroValidacao,
  normalizarTemplatePayload,
  validarBlocos,
  validarCanais,
  validarRodape,
  blocosPadrao
};
