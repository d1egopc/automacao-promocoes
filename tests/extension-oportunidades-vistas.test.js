const assert = require("assert");
const vistas = require("../optimus-capture/services/oportunidades-vistas");

(async () => {
  const memoria = {};
  const storage = {
    async get(chave) { return { [chave]: memoria[chave] }; },
    async set(dados) { Object.assign(memoria, dados); }
  };
  const registro = vistas.criarRegistroVistas({ storage });
  const ml = { marketplace: "mercadolivre", quantidade: 1, titulo: "Mercado Livre", mensagem: "Ofertas oficiais disponíveis agora", urlDestino: "https://www.mercadolivre.com.br/ofertas", validoAte: "2026-09-10T12:05:00.000Z" };
  const amazon = { marketplace: "amazon", quantidade: 1, titulo: "Amazon", mensagem: "Ofertas do Dia disponíveis agora", urlDestino: "https://www.amazon.com.br/gp/goldbox" };

  assert.deepStrictEqual(await registro.calcularNovas("cliente_a", [ml]), [vistas.assinaturaOportunidade(ml)]);
  await registro.marcarComoVistas("cliente_a", [ml]);
  assert.deepStrictEqual(await registro.calcularNovas("cliente_a", [{ ...ml, validoAte: "2026-09-10T12:10:00.000Z" }]), []);
  assert.deepStrictEqual(await registro.calcularNovas("cliente_a", [ml, amazon]), [vistas.assinaturaOportunidade(amazon)]);
  assert.deepStrictEqual(await registro.calcularNovas("cliente_a", []), []);
  assert.deepStrictEqual(await registro.calcularNovas("cliente_a", [ml]), [vistas.assinaturaOportunidade(ml)], "sinal que saiu e voltou deve ser novo");
  assert.deepStrictEqual(await registro.calcularNovas("cliente_b", [ml]), [vistas.assinaturaOportunidade(ml)], "estado visto nao pode cruzar usuarios");
  console.log("extension-oportunidades-vistas.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
