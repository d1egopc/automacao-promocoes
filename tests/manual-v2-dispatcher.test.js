const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  enviarOfertaManualV2,
  adaptarOfertaManualParaTemplate
} = require("../modules/manual-v2/manual-dispatcher");

const ofertaA = {
  id: "oferta_a",
  clienteId: "cliente_a",
  marketplace: "amazon",
  titulo: "Oferta Manual A",
  precoAtual: "99,90",
  precoAnterior: "149,90",
  urlOriginal: "https://amazon.com.br/dp/produto",
  urlAfiliada: "https://amzn.to/produto",
  imagem: "https://img.example/produto.jpg",
  categoria: "eletronicos",
  cupom: "MANUAL10",
  status: "salva"
};

const ofertaB = {
  id: "oferta_b",
  clienteId: "cliente_b",
  marketplace: "shopee",
  titulo: "Oferta Manual B",
  precoAtual: "49,90",
  urlOriginal: "https://shopee.com.br/produto",
  status: "salva"
};

const ofertas = {
  cliente_a: [ofertaA],
  cliente_b: [ofertaB]
};

const destinosPorCliente = {
  cliente_a: [
    {
      id: "wa_ok",
      nome: "WA Ofertas",
      tipo: "whatsapp",
      ativo: true,
      conexaoId: "sessao_a",
      gruposWhatsapp: ["120363@g.us"]
    },
    {
      id: "wa_down",
      nome: "WA Desconectado",
      tipo: "whatsapp",
      ativo: true,
      conexaoId: "sessao_down",
      gruposWhatsapp: ["999@g.us"]
    },
    {
      id: "tg_ok",
      nome: "TG Ofertas",
      tipo: "telegram",
      ativo: true,
      telegramDestinos: ["chat_ok"]
    },
    {
      id: "tg_sem_config",
      nome: "TG Sem Config",
      tipo: "telegram",
      ativo: true,
      telegramDestinos: ["chat_sem_config"]
    }
  ],
  cliente_b: [
    {
      id: "wa_b",
      nome: "WA Cliente B",
      tipo: "whatsapp",
      ativo: true,
      conexaoId: "sessao_b",
      gruposWhatsapp: ["cliente_b@g.us"]
    }
  ]
};

const configsPorCliente = {
  cliente_a: {
    telegram: {
      destinos: [
        {
          id: "bot_ok",
          nome: "Bot OK",
          botToken: "123456:SEGREDO",
          chatId: "chat_ok",
          ativo: true
        },
        {
          id: "bot_sem_config",
          nome: "Bot Sem Config",
          botToken: "",
          chatId: "chat_sem_config",
          ativo: true
        }
      ]
    }
  },
  cliente_b: {
    telegram: {
      destinos: [
        {
          id: "bot_b",
          botToken: "cliente_b:SEGREDO",
          chatId: "chat_b",
          ativo: true
        }
      ]
    }
  }
};

function baseDeps(overrides = {}) {
  const chamadas = {
    wa: [],
    tg: [],
    debitos: [],
    templates: []
  };

  const deps = {
    buscarOfertaManualV2: (clienteId, ofertaId) =>
      (ofertas[clienteId] || []).find((oferta) => oferta.id === ofertaId) || null,
    destinosPorCliente,
    configsPorCliente,
    sessoes: {
      sessao_a: { id: "sock_a" },
      sessao_b: { id: "sock_b" }
    },
    statusSessao: {
      sessao_a: "open",
      sessao_down: "offline",
      sessao_b: "aberto"
    },
    plano: {
      recursos: {
        whatsapp: true,
        telegram: true
      }
    },
    usuarioTemCreditos: () => true,
    debitarCreditos: (clienteId, quantidade) => {
      chamadas.debitos.push({ clienteId, quantidade });
      return true;
    },
    montarMensagemOferta: (oferta, opcoes) => {
      chamadas.templates.push({ oferta, opcoes });
      return `MSG ${oferta.titulo} ${oferta.precoAtual} ${oferta.linkAfiliado}`;
    },
    enviarWhatsApp: async (payload) => {
      chamadas.wa.push(payload);
    },
    enviarTelegram: async (payload) => {
      chamadas.tg.push(payload);
    },
    now: (() => {
      let tick = 0;
      return () => {
        tick += 1;
        return `2026-08-15T12:00:0${tick}.000Z`;
      };
    })()
  };

  return {
    deps: {
      ...deps,
      ...overrides
    },
    chamadas
  };
}

function assertSemSegredos(retorno) {
  const serializado = JSON.stringify(retorno);
  for (const termo of ["SEGREDO", "botToken", "token", "secret", "cookie"]) {
    assert.ok(!serializado.includes(termo), `retorno nao pode expor ${termo}`);
  }
}

(async function main() {
  {
    const { deps, chamadas } = baseDeps();
    const retorno = await enviarOfertaManualV2({
      clienteId: "cliente_a",
      ofertaId: "oferta_a",
      destinosIds: ["wa_ok"]
    }, deps);

    assert.strictEqual(retorno.ok, true);
    assert.strictEqual(retorno.enviados, 1);
    assert.strictEqual(retorno.erros, 0);
    assert.strictEqual(retorno.creditosDebitados, 1);
    assert.strictEqual(chamadas.wa.length, 1);
    assert.strictEqual(chamadas.tg.length, 0);
    assert.strictEqual(chamadas.debitos.length, 1);
    assert.strictEqual(chamadas.debitos[0].clienteId, "cliente_a");
    assert.ok(chamadas.wa[0].mensagem.includes("Oferta Manual A"));
    assertSemSegredos(retorno);
  }

  {
    const { deps, chamadas } = baseDeps();
    const retorno = await enviarOfertaManualV2({
      clienteId: "cliente_a",
      ofertaId: "oferta_a",
      destinosIds: ["tg_ok"]
    }, deps);

    assert.strictEqual(retorno.ok, true);
    assert.strictEqual(retorno.enviados, 1);
    assert.strictEqual(retorno.creditosDebitados, 1);
    assert.strictEqual(chamadas.wa.length, 0);
    assert.strictEqual(chamadas.tg.length, 1);
    assert.strictEqual(chamadas.tg[0].tel.botToken, "123456:SEGREDO", "token interno pode chegar apenas na primitiva mockada");
    assert.strictEqual(chamadas.debitos.length, 1);
    assertSemSegredos(retorno);
  }

  {
    const { deps, chamadas } = baseDeps({
      enviarWhatsApp: async () => {
        throw new Error("falha_wa_mock");
      }
    });
    const retorno = await enviarOfertaManualV2({
      clienteId: "cliente_a",
      ofertaId: "oferta_a",
      destinosIds: ["wa_ok"]
    }, deps);

    assert.strictEqual(retorno.ok, false);
    assert.strictEqual(retorno.enviados, 0);
    assert.strictEqual(retorno.erros, 1);
    assert.strictEqual(retorno.creditosDebitados, 0);
    assert.strictEqual(chamadas.debitos.length, 0);
    assert.strictEqual(retorno.resultados[0].erro, "falha_wa_mock");
  }

  {
    const { deps, chamadas } = baseDeps();
    deps.enviarTelegram = async (payload) => {
      chamadas.tg.push(payload);
      throw new Error("falha_tg_mock");
    };
    const retorno = await enviarOfertaManualV2({
      clienteId: "cliente_a",
      ofertaId: "oferta_a",
      destinosIds: ["tg_ok"]
    }, deps);

    assert.strictEqual(retorno.ok, false);
    assert.strictEqual(retorno.enviados, 0);
    assert.strictEqual(retorno.erros, 1);
    assert.strictEqual(retorno.creditosDebitados, 0);
    assert.strictEqual(chamadas.debitos.length, 0);
    assert.strictEqual(retorno.resultados[0].erro, "falha_tg_mock");
    assertSemSegredos(retorno);
  }

  {
    const { deps, chamadas } = baseDeps();
    deps.enviarTelegram = async (payload) => {
      chamadas.tg.push(payload);
      throw new Error("falha_tg_mock");
    };
    const retorno = await enviarOfertaManualV2({
      clienteId: "cliente_a",
      ofertaId: "oferta_a",
      destinosIds: ["wa_ok", "tg_ok"]
    }, deps);

    assert.strictEqual(retorno.ok, true);
    assert.strictEqual(retorno.enviados, 1);
    assert.strictEqual(retorno.erros, 1);
    assert.strictEqual(retorno.creditosDebitados, 1);
    assert.strictEqual(chamadas.wa.length, 1);
    assert.strictEqual(chamadas.tg.length, 1);
    assert.strictEqual(chamadas.debitos.length, 1);
  }

  {
    const { deps, chamadas } = baseDeps();
    const retorno = await enviarOfertaManualV2({
      clienteId: "cliente_a",
      ofertaId: "oferta_a",
      destinosIds: ["wa_down", "tg_sem_config"]
    }, deps);

    assert.strictEqual(retorno.ok, false);
    assert.strictEqual(retorno.enviados, 0);
    assert.strictEqual(retorno.erros, 2);
    assert.strictEqual(retorno.creditosDebitados, 0);
    assert.strictEqual(chamadas.wa.length, 0);
    assert.strictEqual(chamadas.tg.length, 0);
    assert.strictEqual(chamadas.debitos.length, 0);
    assert.deepStrictEqual(retorno.resultados.map((item) => item.erro), [
      "Sessao WhatsApp desconectada",
      "Telegram nao configurado"
    ]);
  }

  {
    const { deps, chamadas } = baseDeps();
    const retorno = await enviarOfertaManualV2({
      clienteId: "cliente_a",
      ofertaId: "oferta_a",
      destinosIds: ["wa_b"]
    }, deps);

    assert.strictEqual(retorno.ok, false);
    assert.strictEqual(retorno.resultados[0].erro, "Destino nao encontrado");
    assert.strictEqual(chamadas.wa.length, 0);
    assert.strictEqual(chamadas.debitos.length, 0);
  }

  {
    const { deps, chamadas } = baseDeps();
    const retorno = await enviarOfertaManualV2({
      clienteId: "cliente_a",
      ofertaId: "oferta_a",
      destinosIds: []
    }, deps);

    assert.strictEqual(retorno.ok, false);
    assert.strictEqual(retorno.resultados[0].erro, "Nenhum destino selecionado");
    assert.strictEqual(chamadas.wa.length, 0);
    assert.strictEqual(chamadas.tg.length, 0);
    assert.strictEqual(chamadas.debitos.length, 0);
  }

  {
    const { deps, chamadas } = baseDeps();
    const inexistente = await enviarOfertaManualV2({
      clienteId: "cliente_a",
      ofertaId: "oferta_inexistente",
      destinosIds: ["wa_ok"]
    }, deps);
    const outroCliente = await enviarOfertaManualV2({
      clienteId: "cliente_a",
      ofertaId: "oferta_b",
      destinosIds: ["wa_ok"]
    }, deps);

    assert.strictEqual(inexistente.ok, false);
    assert.strictEqual(inexistente.resultados[0].erro, "Oferta Manual V2 nao encontrada");
    assert.strictEqual(outroCliente.ok, false);
    assert.strictEqual(outroCliente.resultados[0].erro, "Oferta Manual V2 nao encontrada");
    assert.strictEqual(chamadas.wa.length, 0);
    assert.strictEqual(chamadas.debitos.length, 0);
  }

  {
    const { deps, chamadas } = baseDeps({
      plano: {
        recursos: {
          whatsapp: false,
          telegram: true
        }
      }
    });
    const retorno = await enviarOfertaManualV2({
      clienteId: "cliente_a",
      ofertaId: "oferta_a",
      destinosIds: ["wa_ok"]
    }, deps);

    assert.strictEqual(retorno.ok, false);
    assert.strictEqual(retorno.resultados[0].erro, "Canal indisponivel no plano atual");
    assert.strictEqual(chamadas.wa.length, 0);
    assert.strictEqual(chamadas.debitos.length, 0);
  }

  {
    const { deps, chamadas } = baseDeps({
      usuarioTemCreditos: () => false
    });
    const retorno = await enviarOfertaManualV2({
      clienteId: "cliente_a",
      ofertaId: "oferta_a",
      destinosIds: ["wa_ok"]
    }, deps);

    assert.strictEqual(retorno.ok, false);
    assert.strictEqual(retorno.resultados[0].erro, "Sem creditos");
    assert.strictEqual(chamadas.wa.length, 0);
    assert.strictEqual(chamadas.debitos.length, 0);
  }

  {
    const adaptada = adaptarOfertaManualParaTemplate(ofertaA);
    assert.strictEqual(adaptada.titulo, "Oferta Manual A");
    assert.strictEqual(adaptada.nome, "Oferta Manual A");
    assert.strictEqual(adaptada.preco, "99,90");
    assert.strictEqual(adaptada.precoAntigo, "149,90");
    assert.strictEqual(adaptada.linkAfiliado, "https://amzn.to/produto");
    assert.strictEqual(adaptada.categoriaProduto, "eletronicos");
    assert.strictEqual(adaptada.manualV2, true);
  }

  {
    const { deps, chamadas } = baseDeps();
    await enviarOfertaManualV2({
      clienteId: "cliente_a",
      ofertaId: "oferta_a",
      destinosIds: ["wa_ok"]
    }, deps);

    assert.strictEqual(chamadas.templates.length, 1);
    assert.strictEqual(chamadas.templates[0].oferta.manualV2, true);
    assert.strictEqual(chamadas.templates[0].oferta.linkAfiliado, "https://amzn.to/produto");
    assert.strictEqual(chamadas.templates[0].opcoes.clienteId, "cliente_a");
    assert.strictEqual(chamadas.templates[0].opcoes.canal, "whatsapp");
  }

  {
    const fonte = fs.readFileSync(
      path.join(__dirname, "..", "modules", "manual-v2", "manual-dispatcher.js"),
      "utf8"
    );
    const proibidos = [
      "utils/fila-ofertas",
      "processarFila",
      "adicionarOfertaInicioFila",
      "prepararOfertaGlobal",
      "enviarParaDestinoInteligente",
      "enviarOfertaAgoraDireto",
      "enviarCampanhaManual",
      "Engine",
      "Radar",
      "Distributor",
      "Oferta Universal",
      "fila.json",
      "/enviar-manual"
    ];

    for (const termo of proibidos) {
      assert.ok(!fonte.includes(termo), `manual-dispatcher nao pode referenciar ${termo}`);
    }
  }

  console.log("manual-v2-dispatcher.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
