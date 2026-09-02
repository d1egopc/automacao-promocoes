"use strict";

const {
  normalizarNomeVariavel,
  normalizarTipoVariavel,
  normalizarValorParaArmazenamento,
  converterValorDescriptografado,
  validarChaveMestraDisponivel,
  criptografarValor,
  descriptografarValor,
  mascararValorDescriptografado
} = require("./platform-variables.crypto");
const {
  criarPlatformVariablesRepository
} = require("./platform-variables.repository");

function erroNaoEncontrado(nome) {
  const erro = new Error(`Variavel ${nome} nao encontrada`);
  erro.codigo = "variavel_nao_encontrada";
  erro.statusCode = 404;
  return erro;
}

const VARIAVEIS_SECRET_OBRIGATORIAS = new Set([
  "DISCORD_CLIENT_SECRET",
  "DISCORD_BOT_TOKEN",
  "META_APP_SECRET",
  "INSTAGRAM_APP_SECRET",
  "INSTAGRAM_OAUTH_STATE_SECRET",
  "INSTAGRAM_WEBHOOK_VERIFY_TOKEN"
]);

function tipoEfetivoVariavel(nome, tipo) {
  return VARIAVEIS_SECRET_OBRIGATORIAS.has(normalizarNomeVariavel(nome)) ? "secret" : tipo;
}

function payloadSeguro(registro, { env = process.env, incluirValor = true } = {}) {
  const valor = descriptografarValor(registro, { env });
  const tipo = tipoEfetivoVariavel(registro.name || registro.nome, registro.type || registro.tipo);
  const ehSecret = tipo === "secret";
  return {
    nome: registro.name || registro.nome,
    tipo,
    configured: true,
    masked: ehSecret ? mascararValorDescriptografado(valor, tipo) : null,
    value: !ehSecret && incluirValor ? converterValorDescriptografado(valor, tipo) : undefined,
    keyVersion: Number(registro.key_version || registro.keyVersion || 1),
    sensitive: true,
    description: registro.description || "",
    createdAt: registro.created_at || registro.createdAt || null,
    updatedAt: registro.updated_at || registro.updatedAt || null,
    updatedBy: registro.updated_by || registro.updatedBy || null
  };
}

function criarPlatformVariablesService({ repository = criarPlatformVariablesRepository(), env = process.env } = {}) {
  let schemaPronto = false;
  let schemaPromise = null;

  async function garantirSchema() {
    if (schemaPronto) return;
    if (!schemaPromise) {
      schemaPromise = repository.prepararSchema().then(() => {
        schemaPronto = true;
      }).finally(() => {
        schemaPromise = null;
      });
    }
    await schemaPromise;
  }

  return {
    async garantirSchema() {
      await garantirSchema();
      return { ok: true };
    },

    async listar() {
      validarChaveMestraDisponivel(env);
      await garantirSchema();
      const registros = await repository.listar();
      return registros.map(registro => payloadSeguro(registro, { env }));
    },

    async obterPublico(nome) {
      validarChaveMestraDisponivel(env);
      await garantirSchema();
      const nomeNormalizado = normalizarNomeVariavel(nome);
      const registro = await repository.buscar(nomeNormalizado);
      if (!registro) throw erroNaoEncontrado(nomeNormalizado);
      return payloadSeguro(registro, { env });
    },

    async salvar({ nome, tipo, valor, description, usuarioId }) {
      validarChaveMestraDisponivel(env);
      await garantirSchema();
      const nomeNormalizado = normalizarNomeVariavel(nome);
      const tipoNormalizado = tipoEfetivoVariavel(nomeNormalizado, normalizarTipoVariavel(tipo));
      const valorNormalizado = normalizarValorParaArmazenamento(valor, tipoNormalizado);
      const criptografado = criptografarValor(valorNormalizado, { env });
      const registro = await repository.salvar({
        nome: nomeNormalizado,
        tipo: tipoNormalizado,
        description: String(description || "").trim(),
        updatedBy: usuarioId || null,
        ...criptografado
      });
      return payloadSeguro(registro, { env });
    },

    async excluir(nome, usuarioId) {
      validarChaveMestraDisponivel(env);
      await garantirSchema();
      const nomeNormalizado = normalizarNomeVariavel(nome);
      const removido = await repository.excluir(nomeNormalizado, usuarioId || null);
      if (!removido) throw erroNaoEncontrado(nomeNormalizado);
      return { ok: true };
    },

    async getPlatformVariable(nome, options = {}) {
      validarChaveMestraDisponivel(env);
      const nomeNormalizado = normalizarNomeVariavel(nome);
      await garantirSchema();
      const registro = await repository.buscar(nomeNormalizado);
      if (!registro) {
        if (options.envFallback === true && Object.prototype.hasOwnProperty.call(env, nomeNormalizado)) {
          return {
            ok: true,
            source: "env",
            nome: nomeNormalizado,
            value: env[nomeNormalizado]
          };
        }
        if (Object.prototype.hasOwnProperty.call(options, "defaultValue")) {
          return {
            ok: true,
            source: "default",
            nome: nomeNormalizado,
            value: options.defaultValue
          };
        }
        return { ok: false, source: "missing", nome: nomeNormalizado, value: null };
      }

      const valor = descriptografarValor(registro, { env });
      return {
        ok: true,
        source: "platform_variables",
        nome: nomeNormalizado,
        tipo: registro.type,
        value: converterValorDescriptografado(valor, registro.type)
      };
    }
  };
}

const platformVariablesServicePadrao = criarPlatformVariablesService();

module.exports = {
  criarPlatformVariablesService,
  platformVariablesServicePadrao,
  getPlatformVariable: (...args) => platformVariablesServicePadrao.getPlatformVariable(...args)
};
