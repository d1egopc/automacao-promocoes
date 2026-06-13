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
    required: ["publisherId", "apiToken", "loja"],
    allowed: ["publisherId", "apiToken", "loja", "advertiserId"]
  }
};

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
  mascararIntegracao
};
