"use strict";

const { getEnginePool } = require("../engine/database");
const {
  bloquearEstadoFairness,
  registrarOrigemAtendidaFairness
} = require("../engine/origem-fairness.repository");
const {
  ORIGEM_FLUXO_OPTIMUS,
  ORIGEM_FLUXO_CLONADOR_GRUPOS,
  resolverOrigemFluxo
} = require("../../utils/origem-fluxo");

const ETAPA_FILA_FAIRNESS = "fila_final";
const LANE_FILA_FAIRNESS = "selecao";
const ORIGENS_PROTEGIDAS = new Set([
  ORIGEM_FLUXO_OPTIMUS,
  ORIGEM_FLUXO_CLONADOR_GRUPOS
]);

function texto(valor = "") {
  return String(valor || "").trim();
}

function origemProtegida(candidato = {}) {
  const origem = resolverOrigemFluxo(candidato?.oferta || candidato);
  return ORIGENS_PROTEGIDAS.has(origem) ? origem : "";
}

function idCandidato(candidato = {}) {
  const oferta = candidato?.oferta || candidato || {};
  return texto(oferta.id || oferta.ofertaId || oferta.engineOfertaId || "");
}

function adicionarUnico(lista = [], candidato, vistos = new Set()) {
  if (!candidato) return;
  const id = idCandidato(candidato);
  const chave = id || candidato;
  if (vistos.has(chave)) return;
  vistos.add(chave);
  lista.push(candidato);
}

function resumirPool(candidatePool = []) {
  const pool = Array.isArray(candidatePool) ? candidatePool : [];
  const heads = {
    optimus: "",
    clonador_grupos: ""
  };
  for (const candidato of pool) {
    const origem = origemProtegida(candidato);
    if (origem && !heads[origem]) heads[origem] = idCandidato(candidato);
  }
  return {
    baseline: pool[0] || null,
    baselineItemId: idCandidato(pool[0]),
    baselineOrigem: origemProtegida(pool[0]),
    optimusHeadItemId: heads.optimus,
    cloneHeadItemId: heads.clonador_grupos,
    candidatePoolSize: pool.length
  };
}

function ordenarCandidatePool(candidatePool = [], ultimaOrigemAtendida = "") {
  const pool = Array.isArray(candidatePool) ? candidatePool.filter(Boolean).slice(0, 3) : [];
  const resumo = resumirPool(pool);
  const baseline = resumo.baseline;
  const baselineOrigem = resumo.baselineOrigem;

  // Um baseline sem origem reconhecivel e legado: mantemos sua precedencia
  // historica e nao inventamos uma terceira origem para a memoria.
  if (baseline && !baselineOrigem) {
    return {
      ordem: [baseline],
      origemPreferida: "",
      motivo: "baseline_legacy",
      disputaReal: false,
      resumo
    };
  }

  const heads = new Map();
  for (const candidato of pool) {
    const origem = origemProtegida(candidato);
    if (origem && !heads.has(origem)) heads.set(origem, candidato);
  }
  const optimus = heads.get(ORIGEM_FLUXO_OPTIMUS);
  const clone = heads.get(ORIGEM_FLUXO_CLONADOR_GRUPOS);
  const ambos = Boolean(optimus && clone);
  const ultima = texto(ultimaOrigemAtendida).toLowerCase();
  let preferida = "";
  let motivo = "";

  if (ambos) {
    if (ultima === ORIGEM_FLUXO_OPTIMUS) {
      preferida = ORIGEM_FLUXO_CLONADOR_GRUPOS;
      motivo = "fairness_turn";
    } else if (ultima === ORIGEM_FLUXO_CLONADOR_GRUPOS) {
      preferida = ORIGEM_FLUXO_OPTIMUS;
      motivo = "fairness_turn";
    } else {
      const indiceOptimus = pool.indexOf(optimus);
      const indiceClone = pool.indexOf(clone);
      preferida = indiceOptimus <= indiceClone ? ORIGEM_FLUXO_OPTIMUS : ORIGEM_FLUXO_CLONADOR_GRUPOS;
      motivo = "fairness_sem_memoria";
    }
  } else if (optimus) {
    preferida = ORIGEM_FLUXO_OPTIMUS;
    motivo = "only_optimus";
  } else if (clone) {
    preferida = ORIGEM_FLUXO_CLONADOR_GRUPOS;
    motivo = "only_clone";
  } else {
    return { ordem: baseline ? [baseline] : [], origemPreferida: "", motivo: "baseline_legacy", disputaReal: false, resumo };
  }

  const ordem = [];
  const vistos = new Set();
  adicionarUnico(ordem, heads.get(preferida), vistos);
  // A outra origem e o baseline ja eram elegiveis pelo mesmo ranking; servem
  // somente como reposicao bounded, sem ampliar a busca global.
  adicionarUnico(ordem, heads.get(preferida === ORIGEM_FLUXO_OPTIMUS
    ? ORIGEM_FLUXO_CLONADOR_GRUPOS
    : ORIGEM_FLUXO_OPTIMUS), vistos);
  adicionarUnico(ordem, baseline, vistos);

  return { ordem, origemPreferida: preferida, motivo, disputaReal: ambos, resumo };
}

function criarLoggerSeguro(logger = console) {
  return (dados = {}) => {
    try {
      (typeof logger?.log === "function" ? logger : console).log("[FILA-FAIRNESS-ORIGEM]", JSON.stringify(dados));
    } catch {}
  };
}

function dadosTelemetria(plano = {}, extras = {}) {
  const resumo = plano.resumo || {};
  return {
    clienteId: texto(extras.clienteId),
    baselineItemId: texto(resumo.baselineItemId),
    baselineOrigem: texto(resumo.baselineOrigem),
    optimusHeadItemId: texto(resumo.optimusHeadItemId),
    cloneHeadItemId: texto(resumo.cloneHeadItemId),
    candidatePoolSize: Number(resumo.candidatePoolSize || 0),
    ultimaOrigemAtendida: texto(extras.ultimaOrigemAtendida),
    origemPreferida: texto(plano.origemPreferida),
    origemEscolhida: texto(extras.origemEscolhida),
    motivo: texto(extras.motivo || plano.motivo),
    advisoryResultado: texto(extras.advisoryResultado),
    revalidacaoResultado: texto(extras.revalidacaoResultado),
    atendimentoConsumido: extras.atendimentoConsumido === true,
    novaOrigemAtendida: texto(extras.novaOrigemAtendida),
    causasFallback: Array.isArray(extras.causasFallback)
      ? extras.causasFallback.map(texto).filter(Boolean).slice(0, 3)
      : []
  };
}

function criarFairnessOrigemFila({
  pool = null,
  catracaAdvisory,
  logger = console,
  bloquearEstado = bloquearEstadoFairness,
  registrarAtendimento = registrarOrigemAtendidaFairness
} = {}) {
  if (!catracaAdvisory || typeof catracaAdvisory.adquirir !== "function" || typeof catracaAdvisory.finalizar !== "function") {
    throw new Error("fila_fairness_advisory_invalido");
  }
  const logar = criarLoggerSeguro(logger);

  async function selecionar({ clienteId = "", candidatePool = [], revalidar } = {}) {
    const cliente = texto(clienteId) || "admin";
    const baselinePlano = ordenarCandidatePool(candidatePool, "");
    if (!baselinePlano.ordem.length) {
      logar(dadosTelemetria(baselinePlano, { clienteId: cliente, motivo: "sem_candidato" }));
      return { ok: true, ignorado: true, motivo: "sem_candidato", skipped: [] };
    }
    if (baselinePlano.motivo === "baseline_legacy") {
      logar(dadosTelemetria(baselinePlano, { clienteId: cliente, motivo: "baseline_legacy" }));
      return {
        ok: true,
        candidato: baselinePlano.ordem[0],
        advisory: null,
        legacy: true,
        skipped: [],
        plano: baselinePlano
      };
    }
    if (typeof revalidar !== "function") throw new Error("fila_fairness_revalidar_invalido");

    const pgPool = pool || getEnginePool();
    if (!pgPool || typeof pgPool.connect !== "function") {
      logar(dadosTelemetria(baselinePlano, { clienteId: cliente, motivo: "pg_fail_closed", advisoryResultado: "erro" }));
      return { ok: false, motivo: "pg_fail_closed", skipped: [] };
    }

    let client = null;
    let emTransacao = false;
    let advisory = null;
    let erroLiberacaoClient = null;
    const skipped = [];
    try {
      client = await pgPool.connect();
      await client.query("BEGIN");
      emTransacao = true;
      const chave = { clienteId: cliente, etapa: ETAPA_FILA_FAIRNESS, lane: LANE_FILA_FAIRNESS };
      const candidatosReprovados = new Set();
      let estado = null;
      let plano = baselinePlano;

      while (true) {
        estado = await bloquearEstado(client, chave);
        const candidatosRestantes = (Array.isArray(candidatePool) ? candidatePool : [])
          .filter(candidato => !candidatosReprovados.has(idCandidato(candidato) || candidato));
        const planoOriginal = ordenarCandidatePool(candidatePool, estado.ultimaOrigemAtendida);
        plano = {
          ...ordenarCandidatePool(candidatosRestantes, estado.ultimaOrigemAtendida),
          // Uma rejeicao nao consome turno, mas a origem aprovada no fallback
          // ainda resolveu uma disputa que existia no mesmo pool original.
          disputaReal: planoOriginal.disputaReal
        };
        let reiniciarSelecao = false;

        for (const candidato of plano.ordem) {
        const tentativa = await catracaAdvisory.adquirir({
          clienteId: cliente,
          oferta: candidato.oferta || candidato,
          client
        });
        if (tentativa.resultado === "erro") {
          const erroAdvisory = new Error("fila_fairness_advisory_indisponivel");
          erroAdvisory.codigo = "fila_fairness_advisory_indisponivel";
          throw erroAdvisory;
        }
        if (tentativa.resultado !== "adquirido") {
          skipped.push({ candidato, motivo: tentativa.resultado === "ocupado" ? "advisory_ocupado" : tentativa.resultado });
          continue;
        }
        advisory = tentativa;
        const validacao = await revalidar(candidato);
        if (!validacao?.ok) {
          const motivoRevalidacao = texto(validacao?.motivo || "gate_reprovado");
          skipped.push({ candidato, motivo: motivoRevalidacao, dados: validacao?.dados || null });
          let erroCleanup = null;

          // A revalidacao roda dentro da transacao que bloqueia a memoria de
          // fairness. Mesmo quando a rejeicao e esperada, a sessao deve sair
          // dessa transacao antes de tentar o unlock session-scoped.
          if (emTransacao) {
            try {
              await client.query("ROLLBACK");
            } catch (erroRollback) {
              erroCleanup = erroRollback;
            }
            emTransacao = false;
          }
          try {
            const finalizacao = await catracaAdvisory.finalizar(advisory, { statusFinal: "pendente" });
            if (finalizacao?.liberacao !== "liberado") {
              erroCleanup ||= new Error("fila_fairness_advisory_cleanup_incompleto");
            }
          } catch (erroUnlock) {
            erroCleanup ||= erroUnlock;
          }
          advisory = null;

          // Nenhum fallback pode reutilizar uma sessao cuja transacao ou
          // advisory nao foi comprovadamente limpo. O finally a descarta.
          if (erroCleanup) {
            erroLiberacaoClient ||= erroCleanup;
            throw erroCleanup;
          }
          if (motivoRevalidacao === "anti_repeat_indisponivel" || motivoRevalidacao === "duplicidade_indisponivel") {
            logar(dadosTelemetria(plano, {
              clienteId: cliente,
              ultimaOrigemAtendida: estado.ultimaOrigemAtendida,
              motivo: motivoRevalidacao,
              advisoryResultado: "liberado",
              revalidacaoResultado: "indisponivel",
              causasFallback: skipped.map(item => item.motivo)
            }));
            return { ok: true, ignorado: true, motivo: motivoRevalidacao, skipped, plano, estado };
          }

          // O rollback soltou o lock da memoria. Reabre uma transacao curta e
          // recompõe apenas o mesmo candidate pool bounded antes do fallback.
          candidatosReprovados.add(idCandidato(candidato) || candidato);
          await client.query("BEGIN");
          emTransacao = true;
          reiniciarSelecao = true;
          break;
        }

        const origemEscolhida = origemProtegida(candidato);
        const origemAtendida = plano.disputaReal ? origemEscolhida : "";
        if (origemAtendida) {
          await registrarAtendimento(client, chave, origemAtendida);
          await client.query("COMMIT");
        } else {
          // A linha eventualmente criada para bloquear a memoria e apenas
          // transitoria quando nao existe disputa. O rollback preserva a
          // capacidade integral da origem isolada sem gravar turno vazio.
          await client.query("ROLLBACK");
        }
        emTransacao = false;

        // A mesma sessao que protegeu a memoria mantem o advisory durante o
        // envio. A catraca passa a ser responsavel pelo release no finally.
        if (advisory?.handle) advisory.handle.clientProprio = true;
        const telemetria = dadosTelemetria(plano, {
          clienteId: cliente,
          ultimaOrigemAtendida: estado.ultimaOrigemAtendida,
          origemEscolhida,
          motivo: skipped.length ? "fallback_candidate_pool" : plano.motivo,
          advisoryResultado: "adquirido",
          revalidacaoResultado: "aprovado",
          atendimentoConsumido: Boolean(origemAtendida),
          novaOrigemAtendida: origemAtendida,
          causasFallback: skipped.map(item => item.motivo)
        });
        logar(telemetria);
        return { ok: true, candidato, advisory, skipped, plano, estado, telemetria };
      }

        if (reiniciarSelecao) continue;

        await client.query("ROLLBACK");
        emTransacao = false;
        logar(dadosTelemetria(plano, {
          clienteId: cliente,
          ultimaOrigemAtendida: estado.ultimaOrigemAtendida,
          motivo: skipped.at(-1)?.motivo || "gate_reprovado",
          advisoryResultado: skipped.some(item => item.motivo === "advisory_ocupado") ? "ocupado" : "nao_adquirido",
          revalidacaoResultado: "reprovado",
          causasFallback: skipped.map(item => item.motivo)
        }));
        return { ok: true, ignorado: true, motivo: skipped.at(-1)?.motivo || "sem_candidato_elegivel", skipped, plano, estado };
      }
    } catch (erro) {
      // Uma query pode deixar a transacao abortada. Primeiro a encerra; so
      // depois o unlock session-scoped volta a ser executavel nessa sessao.
      if (emTransacao) {
        try {
          await client.query("ROLLBACK");
        } catch (erroRollback) {
          // Se nao foi possivel recuperar a sessao, ela nao pode voltar
          // conscientemente ao pool como uma conexao saudavel.
          erroLiberacaoClient = erroRollback;
        }
        emTransacao = false;
      }
      if (advisory?.resultado === "adquirido") {
        try {
          const finalizacao = await catracaAdvisory.finalizar(advisory, { statusFinal: "pendente" });
          if (finalizacao?.liberacao === "erro" || finalizacao?.liberacao === "nao_liberado") {
            erroLiberacaoClient ||= new Error("fila_fairness_advisory_cleanup_incompleto");
          }
        } catch (erroUnlock) {
          erroLiberacaoClient ||= erroUnlock;
        }
        advisory = null;
      }
      logar(dadosTelemetria(baselinePlano, {
        clienteId: cliente,
        motivo: "pg_fail_closed",
        advisoryResultado: "erro",
        revalidacaoResultado: "nao_executada"
      }));
      return { ok: false, motivo: "pg_fail_closed", erro: texto(erro?.message || erro), skipped };
    } finally {
      // Em sucesso, o handle transferiu ownership para o finally do Executor.
      if (client && !advisory?.handle?.clientProprio && typeof client.release === "function") {
        client.release(erroLiberacaoClient || undefined);
      }
    }
  }

  return { selecionar };
}

module.exports = {
  ETAPA_FILA_FAIRNESS,
  LANE_FILA_FAIRNESS,
  origemProtegida,
  resumirPool,
  ordenarCandidatePool,
  criarFairnessOrigemFila
};
