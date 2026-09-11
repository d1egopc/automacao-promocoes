(function publicarOportunidadesVistas(global) {
  const CHAVE_BASE = "optimus_capture_oportunidades_vistas_v1";

  function textoEstavel(valor = "") {
    return String(valor ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
  }

  function urlEstavel(valor = "") {
    try {
      const url = new URL(String(valor || ""));
      return url.protocol === "https:" ? `${url.origin}${url.pathname}` : "";
    } catch {
      return "";
    }
  }

  function assinaturaOportunidade(oportunidade = {}) {
    return JSON.stringify([
      textoEstavel(oportunidade.marketplace),
      Math.max(0, Math.floor(Number(oportunidade.quantidade || 0))),
      textoEstavel(oportunidade.titulo),
      textoEstavel(oportunidade.mensagem),
      urlEstavel(oportunidade.urlDestino)
    ]);
  }

  function assinaturasDaLista(lista = []) {
    return [...new Set((Array.isArray(lista) ? lista : [])
      .filter((item) => Number(item?.quantidade || 0) > 0)
      .map(assinaturaOportunidade))];
  }

  function criarRegistroVistas({ storage = global.chrome?.storage?.local } = {}) {
    let escopoAtual = "";
    let vistas = new Set();

    function chave(escopo) {
      return `${CHAVE_BASE}:${encodeURIComponent(String(escopo || "anon").slice(0, 120))}`;
    }

    async function carregar(escopo) {
      const proximoEscopo = String(escopo || "anon");
      if (proximoEscopo === escopoAtual) return;
      escopoAtual = proximoEscopo;
      vistas = new Set();
      try {
        const dados = await storage?.get?.(chave(escopoAtual));
        const salvas = dados?.[chave(escopoAtual)];
        if (Array.isArray(salvas)) vistas = new Set(salvas.filter((item) => typeof item === "string").slice(-50));
      } catch {}
    }

    async function persistir() {
      try {
        await storage?.set?.({ [chave(escopoAtual)]: [...vistas].slice(-50) });
      } catch {}
    }

    async function calcularNovas(escopo, lista) {
      await carregar(escopo);
      const atuais = assinaturasDaLista(lista);
      const conjuntoAtual = new Set(atuais);
      const vistasAindaAtivas = new Set([...vistas].filter((item) => conjuntoAtual.has(item)));
      const alterou = vistasAindaAtivas.size !== vistas.size;
      vistas = vistasAindaAtivas;
      if (alterou) await persistir();
      return atuais.filter((item) => !vistas.has(item));
    }

    async function marcarComoVistas(escopo, lista) {
      await carregar(escopo);
      vistas = new Set(assinaturasDaLista(lista));
      await persistir();
    }

    return { calcularNovas, marcarComoVistas };
  }

  const api = { CHAVE_BASE, assinaturaOportunidade, criarRegistroVistas };
  global.OptimusCaptureOportunidadesVistas = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
