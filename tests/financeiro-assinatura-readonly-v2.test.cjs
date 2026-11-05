"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const criarRotas = require("../modules/financeiro/checkout.routes");

async function executar() {
  const usuario = {
    id: "workspace_sintetico", ativo: true, plano: "beta_teste",
    creditos: 300, cicloAtualFim: "2026-10-01T00:00:00.000Z",
    assinaturaStatus: "nao_aplicavel"
  };
  const antes = JSON.stringify(usuario);
  let leituras = 0;
  let falharLeitura = false;
  const app = express();
  app.use((req, _res, next) => {
    req.clienteId = usuario.id;
    req.usuario = usuario;
    next();
  });
  app.use("/financeiro", criarRotas({
    getPlanos: () => ({
      beta_teste: { id: "beta_teste", nome: "Free Beta", entradaBeta: true,
        renovacaoCreditos: "sem_renovacao", creditosModelo: "ciclo",
        limites: { creditosPorCiclo: 300, cicloDias: 30 } }
    }),
    renovarFinanceiroUsuario: () => { throw new Error("renovacao_proibida_em_GET"); },
    lerSaldoCreditos: async () => {
      leituras += 1;
      if (falharLeitura) throw new Error("segredo_sintetico_nao_expor");
      return usuario.creditos;
    }
  }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/financeiro/assinatura`;
  try {
    const respostas = await Promise.all(Array.from({ length: 12 }, () => fetch(url)));
    assert.deepEqual(respostas.map(r => r.status), Array(12).fill(200));
    for (const resposta of respostas) {
      const corpo = await resposta.json();
      assert.equal(corpo.creditos, 300);
      assert.equal(corpo.cicloAtualFim, usuario.cicloAtualFim);
    }
    assert.equal(leituras, 12);
    assert.equal(JSON.stringify(usuario), antes, "GET nao modifica ciclo, saldo ou revisao");

    falharLeitura = true;
    const falha = await fetch(url);
    assert.equal(falha.status, 503);
    assert.deepEqual(await falha.json(), { ok: false, codigo: "assinatura_leitura_indisponivel" });
    assert.equal(JSON.stringify(usuario), antes, "falha de ledger nao modifica usuario");
    falharLeitura = false;
    assert.equal((await fetch(url)).status, 200, "processo permanece ativo apos falha");
  } finally {
    await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  }
}

executar().then(() => console.log("financeiro-assinatura-readonly-v2.test.cjs OK"))
  .catch(error => { console.error(error); process.exitCode = 1; });
