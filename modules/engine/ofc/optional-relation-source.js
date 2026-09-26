"use strict";

// Somente catalogo PostgreSQL; nao inicializa nem modifica a fonte opcional.
function criarDisponibilidadeRelacao({ relacao, coluna, clock = Date.now, revalidacaoMs = 300000, retryErroMs = 15000 } = {}) {
  let cache = null;
  let emCurso = null;
  function desconhecido(motivo = "fonte_opcional_indisponivel") {
    const observadoEmMs = clock();
    cache = { estado: "DESCONHECIDO", motivo, observadoEmMs, revalidarEmMs: observadoEmMs + retryErroMs };
    return { ...cache };
  }
  return {
    desconhecido,
    async observar(consultar) {
      if (cache && clock() < cache.revalidarEmMs) return { ...cache, cache: true };
      if (emCurso) return emCurso;
      emCurso = (async () => {
        try {
          const resultado = coluna
            ? await consultar(`SELECT EXISTS (SELECT 1 FROM pg_attribute
                WHERE attrelid = to_regclass($1) AND attname = $2 AND NOT attisdropped) AS existe`, [relacao, coluna])
            : await consultar("SELECT to_regclass($1) IS NOT NULL AS existe", [relacao]);
          const existe = resultado?.resultado?.rows?.[0]?.existe;
          if (resultado?.ok !== true || typeof existe !== "boolean") {
            return desconhecido(resultado?.motivo || "catalogo_opcional_inconclusivo");
          }
          const observadoEmMs = clock();
          cache = {
            estado: existe ? "DISPONIVEL" : "AUSENTE",
            motivo: existe ? "" : "relacao_opcional_ausente",
            observadoEmMs,
            revalidarEmMs: observadoEmMs + revalidacaoMs
          };
          return { ...cache, cache: false };
        } catch {
          return desconhecido("erro_catalogo_opcional");
        }
      })();
      try { return await emCurso; }
      finally { emCurso = null; }
    }
  };
}

module.exports = { criarDisponibilidadeRelacao };
