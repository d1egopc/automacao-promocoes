"use strict";

const crypto = require("crypto");
const { resolverFilaItemId } = require("./fila-claims-shadow.service");
const { resolverOrigemFluxo } = require("../../utils/origem-fluxo");

function texto(valor = "", limite = 160) {
  return String(valor || "").trim().slice(0, limite);
}

function agoraMonotono() {
  return typeof process.hrtime?.bigint === "function" ? process.hrtime.bigint() : null;
}

function duracaoMs(inicioMonotono, inicioFallback) {
  if (typeof inicioMonotono === "bigint") return Number(process.hrtime.bigint() - inicioMonotono) / 1e6;
  return Math.max(0, Date.now() - Number(inicioFallback || Date.now()));
}

function gerarAttemptId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex").replace(
    /^(........)(....)(....)(....)(............)$/,
    "$1-$2-4$3-8$4-$5"
  );
}

function chaveDestinoEntrega(destino = {}) {
  const tipo = texto(destino?.tipo || destino?.canal || "", 40).toLowerCase();
  const id = texto(destino?.id || destino?.destinoId || "");
  return tipo && id ? `${tipo}:${id}` : "";
}

function hashCurto(valor = "") {
  const bruto = String(valor || "");
  if (!bruto) return "";
  return crypto.createHash("sha256").update(bruto).digest("hex").slice(0, 24);
}

function chaveAlvoEntrega(canal = "", alvo = {}) {
  const tipo = texto(canal, 40).toLowerCase();
  if (tipo === "whatsapp") {
    const grupoId = texto(alvo?.grupoId || alvo?.id || alvo?.value || alvo);
    return grupoId ? `grupo:${grupoId}` : "";
  }
  if (tipo === "discord") {
    const channelId = texto(alvo?.channelId || alvo?.canalId || alvo?.grupo || alvo?.id || alvo);
    return channelId ? `canal:${channelId}` : "";
  }
  if (tipo === "telegram") {
    const integracaoId = texto(alvo?.id || alvo?.botId || alvo?.telegramId || alvo?.destinoId);
    if (integracaoId) return `integracao:${integracaoId}`;
    const chatId = texto(alvo?.chatId || alvo?.grupoId || alvo?.canalId || alvo?.channelId);
    const credencial = hashCurto(alvo?.botToken || alvo?.token || alvo?.telegramToken || "");
    return chatId && credencial ? `credencial:${credencial}:${chatId}` : "";
  }
  return "";
}

function dadosSeguro(contexto = {}, extras = {}) {
  return {
    clienteId: texto(contexto.clienteId),
    filaItemId: texto(contexto.filaItemId),
    origemFluxo: texto(contexto.origemFluxo),
    canal: texto(contexto.canal, 40),
    resultado: texto(contexto.resultado, 80),
    estado: texto(contexto.estado, 40),
    ...extras
  };
}

function clientDoAdvisory(advisoryHandle = null) {
  const client = advisoryHandle?.client;
  return client && typeof client.query === "function" ? client : null;
}

function criarCheckpointEntregaFuncional({ repository, logger = console, gerarAttemptIdImpl = gerarAttemptId, now = () => Date.now() } = {}) {
  if (!repository || typeof repository.criarCheckpointEntrega !== "function" ||
    typeof repository.transicionarCheckpointEntrega !== "function" ||
    typeof repository.registrarCreditoDebitadoCheckpointEntrega !== "function") {
    throw new Error("fila_checkpoint_entrega_repository_invalido");
  }

  const logar = (evento, dados) => {
    try {
      (typeof logger?.log === "function" ? logger : console).log(evento, JSON.stringify(dados));
    } catch {}
  };

  async function executar({
    clienteId = "",
    oferta = {},
    destinoChave = "",
    alvoChave = "",
    canal = "",
    advisoryHandle = null,
    enviar,
    falhaConfirmada = () => false,
    permitirNovaTentativaAposFalhaConfirmada = false
  } = {}) {
    const contexto = {
      clienteId: texto(clienteId || oferta?.clienteId || "admin"),
      filaItemId: resolverFilaItemId(oferta),
      destinoChave: texto(destinoChave),
      alvoChave: texto(alvoChave),
      canal: texto(canal, 40),
      origemFluxo: texto(resolverOrigemFluxo(oferta)),
      advisoryHandle,
      attemptId: "",
      estado: "",
      resultado: "",
      inicioMonotono: agoraMonotono(),
      inicioFallback: now()
    };
    const client = clientDoAdvisory(advisoryHandle);

    const finalizar = (resultado, extras = {}) => {
      contexto.resultado = resultado;
      logar("[FILA-CHECKPOINT-ENTREGA-FIM]", dadosSeguro(contexto, {
        duracaoMs: Math.round(duracaoMs(contexto.inicioMonotono, contexto.inicioFallback)),
        ...extras
      }));
    };

    if (!contexto.filaItemId || !contexto.destinoChave || !contexto.alvoChave || !contexto.canal || !client || typeof enviar !== "function") {
      contexto.estado = "";
      finalizar("identidade_ou_advisory_ausente");
      return { ok: false, resultado: contexto.resultado, contexto };
    }

    contexto.attemptId = texto(gerarAttemptIdImpl());
    if (!contexto.attemptId) {
      finalizar("attempt_id_ausente");
      return { ok: false, resultado: contexto.resultado, contexto };
    }

    const opcoesRepository = { client };
    try {
      const criado = await repository.criarCheckpointEntrega({
        ...contexto,
        attemptId: contexto.attemptId
      }, opcoesRepository);
      if (criado?.criado !== true) {
        const existente = typeof repository.obterCheckpointEntrega === "function"
          ? await repository.obterCheckpointEntrega(contexto, opcoesRepository)
          : null;
        if (
          permitirNovaTentativaAposFalhaConfirmada === true &&
          existente?.estado === "falha_confirmada" &&
          typeof repository.prepararNovaTentativaCheckpointEntrega === "function"
        ) {
          const nova = await repository.prepararNovaTentativaCheckpointEntrega({
            ...contexto,
            attemptIdAnterior: existente.attemptId,
            attemptId: contexto.attemptId
          }, opcoesRepository);
          if (nova?.preparada !== true) {
            contexto.estado = existente.estado;
            finalizar("checkpoint_existente");
            return { ok: false, resultado: contexto.resultado, contexto };
          }
        } else {
          contexto.estado = existente?.estado || criado?.checkpoint?.estado || "";
          finalizar("checkpoint_existente");
          return { ok: false, resultado: contexto.resultado, contexto };
        }
      }

      contexto.estado = "preparado";
      const iniciado = await repository.transicionarCheckpointEntrega({
        ...contexto,
        attemptId: contexto.attemptId,
        deEstado: "preparado",
        paraEstado: "envio_iniciado"
      }, opcoesRepository);
      if (iniciado?.transicionado !== true) {
        finalizar("envio_iniciado_nao_persistido");
        return { ok: false, resultado: contexto.resultado, contexto };
      }
      contexto.estado = "envio_iniciado";
      logar("[FILA-CHECKPOINT-ENTREGA]", dadosSeguro(contexto, { resultado: "envio_iniciado" }));
    } catch {
      finalizar("checkpoint_indisponivel");
      return { ok: false, resultado: contexto.resultado, contexto };
    }

    try {
      const resposta = await enviar();
      const enviado = await repository.transicionarCheckpointEntrega({
        ...contexto,
        attemptId: contexto.attemptId,
        deEstado: "envio_iniciado",
        paraEstado: "enviado",
        providerMessageId: resposta?.providerMessageId || null
      }, opcoesRepository);
      if (enviado?.transicionado !== true) {
        finalizar("enviado_nao_persistido", { respostaExternaConfirmada: true });
        return { ok: false, resultado: contexto.resultado, respostaExternaConfirmada: true, contexto };
      }
      contexto.estado = "enviado";
      finalizar("enviado");
      return { ok: true, resultado: "enviado", resposta: resposta?.valor, contexto };
    } catch (erro) {
      if (falhaConfirmada(erro) === true) {
        try {
          const falha = await repository.transicionarCheckpointEntrega({
            ...contexto,
            attemptId: contexto.attemptId,
            deEstado: "envio_iniciado",
            paraEstado: "falha_confirmada"
          }, opcoesRepository);
          if (falha?.transicionado === true) {
            contexto.estado = "falha_confirmada";
            finalizar("falha_confirmada");
            return { ok: false, resultado: "falha_confirmada", erro, contexto };
          }
        } catch {}
      }
      finalizar("envio_iniciado_ambiguo");
      return { ok: false, resultado: "envio_iniciado_ambiguo", erro, contexto };
    }
  }

  async function registrarCreditoDebitado(contexto = {}) {
    if (!contexto?.attemptId || contexto?.estado !== "enviado") return { registrado: false, motivo: "checkpoint_nao_enviado" };
    const client = clientDoAdvisory(contexto.advisoryHandle);
    if (!client) return { registrado: false, motivo: "advisory_client_ausente" };
    try {
      const resultado = await repository.registrarCreditoDebitadoCheckpointEntrega({
        clienteId: contexto.clienteId,
        filaItemId: contexto.filaItemId,
        destinoChave: contexto.destinoChave,
        alvoChave: contexto.alvoChave,
        attemptId: contexto.attemptId
      }, { client });
      return resultado;
    } catch {
      return { registrado: false, motivo: "evidencia_credito_indisponivel" };
    }
  }

  return { executar, registrarCreditoDebitado };
}

module.exports = {
  criarCheckpointEntregaFuncional,
  chaveDestinoEntrega,
  chaveAlvoEntrega
};
