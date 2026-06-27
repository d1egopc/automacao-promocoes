const marketplaceRules = {
  shopee: {
    nome: "Shopee",
    required: ["appId", "secret"],
    allowed: ["appId", "secret"]
  },
  amazon: {
    nome: "Amazon",
    modes: {
      api: {
        required: ["appId", "accessKey", "secretKey"],
        allowed: ["modo", "appId", "accessKey", "secretKey"]
      },
      cookies: {
        required: ["cookies", "tag"],
        allowed: ["modo", "cookies", "tag"]
      }
    }
  },
  mercadolivre: {
    nome: "Mercado Livre",
    required: ["cookies", "tag"],
    allowed: ["cookies", "tag"]
  },
  aliexpress: {
    nome: "AliExpress",
    required: ["appKey", "secret", "trackingId"],
    allowed: ["appKey", "secret", "trackingId"]
  },
  magalu: {
    nome: "Magalu",
    required: ["promoterId"],
    allowed: ["promoterId"]
  },
  awin: {
    nome: "Awin",
    required: ["publisherId", "apiToken"],
    allowed: ["publisherId", "apiToken", "programas", "loja", "advertiserId"]
  }
};

const AWIN_PROGRAMAS_PADRAO = {
  kabum: "17729"
};

function normalizarNomeProgramaAwin(nome = "") {
  return String(nome || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .trim();
}

function normalizarProgramasAwin(body = {}) {
  const origem = Array.isArray(body.programas)
    ? [...body.programas]
    : [];
  const programas = [];
  const vistos = new Set();

  if (!origem.length) {
    origem.push({
      nome: body.loja || "kabum",
      advertiserId: body.advertiserId || AWIN_PROGRAMAS_PADRAO.kabum,
      ativo: true
    });
  }

  for (const item of origem) {
    const nome = normalizarNomeProgramaAwin(item?.nome || item?.loja || "");
    if (!nome || vistos.has(nome)) continue;

    const advertiserId = String(
      item?.advertiserId || AWIN_PROGRAMAS_PADRAO[nome] || ""
    ).trim();

    if (!advertiserId) continue;

    vistos.add(nome);
    programas.push({
      nome,
      advertiserId,
      ativo: item?.ativo !== false
    });
  }

  return programas;
}

function normalizarCredenciaisAwin(body = {}) {
  return {
    publisherId: String(body.publisherId || "").trim(),
    apiToken: String(body.apiToken || "").trim(),
    programas: normalizarProgramasAwin(body)
  };
}

function obterProgramaAwin(credenciais = {}, alvo = "kabum") {
  const programas = normalizarProgramasAwin(credenciais);
  const texto = normalizarNomeProgramaAwin(alvo);
  const porUrl = String(alvo || "").toLowerCase();
  let nome = texto;
  let alvoConhecido = false;

  if (porUrl.includes("kabum.com")) {
    nome = "kabum";
    alvoConhecido = true;
  }
  if (porUrl.includes("magalu.com") || porUrl.includes("magazineluiza.com")) {
    nome = "magalu";
    alvoConhecido = true;
  }
  if (porUrl.includes("carrefour.com")) {
    nome = "carrefour";
    alvoConhecido = true;
  }
  if (porUrl.includes("casasbahia.com")) {
    nome = "casas_bahia";
    alvoConhecido = true;
  }

  const encontrado = programas.find(item =>
    item.nome === nome && item.ativo !== false
  );

  if (encontrado) return encontrado;
  if (alvoConhecido) return null;
  if (nome && !porUrl.startsWith("http")) return null;

  return programas.find(item => item.ativo !== false) || null;
}

function limparCredencial(config, allowed) {
  const clean = {};

  for (const field of allowed) {
    if (config[field] !== undefined && config[field] !== null) {
      clean[field] = String(config[field]).trim();
    }
  }

  return clean;
}

function validarIntegracao(marketplace, body) {
  const rule = marketplaceRules[marketplace];

  if (!rule) return { ok: false, erro: "Marketplace n\u00e3o suportado" };

  if (marketplace === "awin") {
    const clean = normalizarCredenciaisAwin(body);
    const missing = rule.required.filter((field) => !clean[field]);

    if (missing.length) {
      return {
        ok: false,
        erro: "Campos obrigat\u00f3rios ausentes",
        campos: missing
      };
    }

    return { ok: true, clean };
  }

  if (marketplace === "amazon") {
    let modo = body.modo;

    if (!modo) {
      if (body.cookies && body.tag) {
        modo = "cookies";
      } else {
        modo = "api";
      }
    }

    const modeRule = rule.modes[modo];

    if (!modeRule) return { ok: false, erro: "Modo Amazon inv\u00e1lido" };

    const missing = modeRule.required.filter((field) => !body[field]);

    if (missing.length) {
      return {
        ok: false,
        erro: "Campos obrigat\u00f3rios ausentes",
        campos: missing
      };
    }

    return {
      ok: true,
      modo,
      clean: limparCredencial({ ...body, modo }, modeRule.allowed)
    };
  }

  const missing = rule.required.filter((field) => !body[field]);

  if (missing.length) {
    return {
      ok: false,
      erro: "Campos obrigat\u00f3rios ausentes",
      campos: missing
    };
  }

  return {
    ok: true,
    clean: limparCredencial(body, rule.allowed)
  };
}

function mascararIntegracao(config = {}) {
  const masked = {};

  for (const [key, valor] of Object.entries(config || {})) {
    if (key === "programas" && Array.isArray(valor)) {
      masked.programas = valor.map(item => ({
        nome: item.nome,
        advertiserId: item.advertiserId ? "\u2022".repeat(16) : "",
        ativo: item.ativo !== false
      }));
      continue;
    }

    const temValor =
      valor !== undefined &&
      valor !== null &&
      String(valor).trim() !== "";

    masked[key] = temValor ? "\u2022".repeat(16) : "";
  }

  return masked;
}

module.exports = {
  marketplaceRules,
  limparCredencial,
  validarIntegracao,
  mascararIntegracao,
  normalizarCredenciaisAwin,
  normalizarProgramasAwin,
  obterProgramaAwin,
  AWIN_PROGRAMAS_PADRAO
};







