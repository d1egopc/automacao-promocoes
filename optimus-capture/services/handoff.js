(function publicarHandoff(global) {
  function texto(valor) {
    return String(valor ?? "").trim();
  }

  function bytesAleatorios(qtd) {
    const bytes = new Uint8Array(qtd);
    const cryptoApi = global.crypto || (typeof require !== "undefined" ? require("crypto").webcrypto : null);
    if (!cryptoApi?.getRandomValues) throw new Error("crypto_indisponivel");
    cryptoApi.getRandomValues(bytes);
    return bytes;
  }

  function base64UrlBytes(bytes) {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(bytes).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    }
    let binario = "";
    for (const byte of bytes) binario += String.fromCharCode(byte);
    return btoa(binario).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  }

  async function sha256Bytes(valor) {
    if (global.crypto?.subtle) {
      const dados = new TextEncoder().encode(valor);
      return new Uint8Array(await global.crypto.subtle.digest("SHA-256", dados));
    }
    if (typeof require !== "undefined") {
      return require("crypto").createHash("sha256").update(valor).digest();
    }
    throw new Error("crypto_indisponivel");
  }

  function gerarTokenUrlSeguro(bytes = 32) {
    return base64UrlBytes(bytesAleatorios(bytes));
  }

  async function criarCodeChallenge(codeVerifier) {
    return base64UrlBytes(await sha256Bytes(texto(codeVerifier)));
  }

  function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function motivoApi(erro) {
    return texto(erro?.body?.motivo || erro?.body?.erro || erro?.message);
  }

  function urlConexao(api, handoffId, state) {
    const base = texto(api?.APP_BASE || api?.API_BASE || "https://go.optimuspromo.com.br").replace(/\/$/, "");
    const params = new URLSearchParams({ handoffId, state });
    return `${base}/capture/connect?${params.toString()}`;
  }

  async function conectarComOptimus(opcoes = {}) {
    const api = opcoes.api || global.OptimusCaptureApi;
    const chromeTabs = opcoes.chromeTabs || global.chrome?.tabs;
    const abrirUrl = typeof opcoes.abrirUrl === "function" ? opcoes.abrirUrl : null;
    const intervaloMs = Number(opcoes.intervaloMs || 2000);
    const maxTentativas = Number(opcoes.maxTentativas || 90);
    const esperarImpl = opcoes.esperar || esperar;
    const onStatus = typeof opcoes.onStatus === "function" ? opcoes.onStatus : () => undefined;

    if (!api?.iniciarCaptureHandoff || !api?.trocarCaptureHandoff) throw new Error("api_handoff_indisponivel");
    if (!abrirUrl && !chromeTabs?.create) throw new Error("chrome_tabs_indisponivel");

    const codeVerifier = gerarTokenUrlSeguro(48);
    const state = gerarTokenUrlSeguro(32);
    const codeChallenge = await criarCodeChallenge(codeVerifier);
    onStatus("Criando conexao segura...");
    const iniciado = await api.iniciarCaptureHandoff({ state, codeChallenge });
    const handoffId = texto(iniciado?.handoffId);
    if (!handoffId) throw new Error("handoff_id_ausente");

    const url = urlConexao(api, handoffId, state);
    if (abrirUrl) {
      await abrirUrl(url);
    } else {
      await chromeTabs.create({ url, active: true });
    }
    onStatus("Autorize no Optimus. A extensao vai concluir automaticamente.");

    for (let tentativa = 0; tentativa < maxTentativas; tentativa += 1) {
      try {
        const resposta = await api.trocarCaptureHandoff({ handoffId, state, codeVerifier });
        if (resposta?.token) {
          onStatus("Conexao autorizada.");
          return resposta;
        }
      } catch (erro) {
        const motivo = motivoApi(erro);
        if (erro?.status === 409 && motivo === "capture_handoff_nao_autorizado") {
          await esperarImpl(intervaloMs);
          continue;
        }
        throw erro;
      }
      await esperarImpl(intervaloMs);
    }

    throw new Error("capture_handoff_timeout");
  }

  const handoff = {
    gerarTokenUrlSeguro,
    criarCodeChallenge,
    conectarComOptimus,
    urlConexao
  };
  global.OptimusCaptureHandoff = handoff;
  if (typeof module !== "undefined" && module.exports) module.exports = handoff;
})(typeof globalThis !== "undefined" ? globalThis : window);
