"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

function contem(trecho, mensagem) {
  assert.ok(fonte.includes(trecho), mensagem);
}

contem('app.get("/fila", auth, (req, res) => {', "GET /fila deve permanecer protegido por auth");
contem('app.get("/fila/status", (req, res) => {', "GET /fila/status deve continuar existindo");
contem("filtrarItensHistoricoFila(itensCliente, req.query)", "GET /fila deve aplicar o recorte filtrado central");
contem("filtrarItensHistoricoFila(itensCliente, req.query)", "GET /fila/status deve reaproveitar o mesmo recorte");
contem("calcularMetricasHistoricoFila(itensFiltrados)", "metricas devem ser calculadas sobre o recorte, nao sobre a pagina");
contem("processadas,", "metricas devem expor processadas");
contem("taxaEnvio", "metricas devem expor taxaEnvio");
contem("enviadas / processadas * 100", "formula da taxa deve estar documentada no payload");
contem("itemDentroPeriodoFila(item, periodoFiltro)", "periodo hoje/7d deve participar do filtro");
contem('filtro === "hoje"', "periodo hoje deve ser suportado");
contem('filtro === "7d"', "periodo 7d deve ser suportado");
contem("itemCombinaBuscaFila(item, qFiltro)", "busca q deve participar do filtro");
contem("item.titulo", "busca deve considerar titulo");
contem("item.nome", "busca deve considerar nome");
contem("normalizarMarketplaceHistoricoFila(item.marketplace)", "marketplace deve ser normalizado por aliases");
contem('["awin", "awin1", "kabum", "awinkabum"]', "AWIN/KaBuM legado deve compartilhar filtro canonico");
contem("canalItemFila(item, canalFiltro)", "canal deve participar do filtro");
contem("destinoItemFila(item, destinoFiltro)", "destino deve participar do filtro");
contem("destinosEnviados.flatMap", "fanout persistido deve participar de canal/destino");
contem("statusVisualFila(item)", "status visual deve ser camada separada do status interno");
contem("FILA_MOTIVOS_AGUARDANDO_VISUAL", "intervalo/fora da janela/limite diario devem poder ficar em aguardando visual");
contem("FILA_MOTIVOS_ERRO_VISUAL", "motivos de atencao devem poder entrar em erros visualmente");

assert.ok(
  !fonte.includes("HISTORICO_DETALHADO_MS = 12 * 60 * 60 * 1000"),
  "Historico visual nao deve transformar 12h em politica da fila"
);

console.log("fila-historico-v2-leitura.test.js OK");

