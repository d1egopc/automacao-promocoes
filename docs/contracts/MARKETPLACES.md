# Marketplaces

## Regra comum

Cada marketplace tem identidade, links, prova de afiliacao e semantica de preco proprios. Nao copie fallback de um marketplace para outro. Mudancas devem cobrir adapter do engine, Manual V2, extensao, templates e consumidores afetados.

## Mercado Livre

- Identidade MLB aceita forma compacta e hifenizada e converge para a mesma identidade canonica.
- URL e `productId` divergentes falham fechados.
- Cupom exige contexto explicito de cupom; tokens tecnicos como `80MM`, `650W` ou `DDR5` nao sao cupons.
- Preserve permalink/canonical, titulo, imagem e fallbacks comprovados do Work Task/backend.
- Fontes: `modules/engine/importer/adapters/mercadolivre.adapter.js`, `modules/manual-v2/adapters/mercadolivre.manual.adapter.js`, `optimus-capture/adapters/mercadolivre.js`.

## Amazon

- Preserve preco, preco anterior e condicao explicitamente ligada ao preco.
- Condicao comprovada de Pix/NuPay usa `observacoes`; nao presuma para outras ofertas.
- Nao derive desconto total por matematica. Percentual so existe com evidencia explicita.
- Preserve tag/afiliacao e diferencie beneficio de pagina de codigo de cupom.
- Fontes: `modules/engine/importer/adapters/amazon.adapter.js`, `modules/manual-v2/adapters/amazon.manual.adapter.js`, `optimus-capture/adapters/amazon.js`.

## Shopee

- Link de produto e link de resgate tem papeis distintos.
- Beneficio sem codigo nao deve virar codigo inventado.
- Preserve `A partir de` quando capturado como parte da condicao de preco.
- Fontes: `modules/engine/importer/adapters/shopee.adapter.js`, `modules/manual-v2/adapters/shopee.manual.adapter.js`, `modules/manual-v2/shopee-shortlink.js`.

## AliExpress

- Preserve produto, app/moda/moedas, tracking e beneficio em papeis separados.
- Prova assinada deve vincular workspace e produto.
- Achado legado sem URL/identidade verificavel permanece bloqueado; link afiliado salvo nao basta.
- Brasil/Internacional, impostos, taxas e observacoes so aparecem quando presentes nos dados.
- Preco, cupom, moedas, variantes, quantidade, ordem e contexto capturados pelo
  Radar/TeleRadar permanecem soberanos sobre o enriquecimento tecnico da API.
- Cupom explicitamente rotulado pode ser alfanumerico ou numerico; texto de
  beneficio, preco ou instrucao sem rotulo de codigo nao vira cupom por heuristica.
- Cada ocorrencia APP/moedas e PC e convertida e validada separadamente com as
  credenciais da workspace. A mesma mensagem pode transportar 2, 3 ou 4 links;
  deduplicacao so ocorre para a mesma ocorrencia/URL comprovadamente repetida.
- APP factual, afiliado e assinado pode seguir sozinho quando o PC falha; o PC
  original continua auditavel e nao e substituido por APP. Um PC canonico gerado
  exige ProductDetail e identidade consistentes, conversao propria e prova da
  mesma workspace.
- IDs de produtos secundarios ou variantes conflitantes nao podem contaminar o
  produto principal. Sem identidade ou variante factual, a oferta permanece
  retida.
- Cobertura executavel: `tests/aliexpress-app-pc-fallback-oficial.test.js`,
  `tests/aliexpress-app-moedas-contrato.test.js`,
  `tests/aliexpress-preco-variantes-radar.test.js` e
  `tests/links-comerciais-v2-aliexpress-shopee.test.js`.
- Fontes: `modules/engine/importer/adapters/aliexpress.adapter.js`, `modules/manual-v2/adapters/aliexpress.manual.adapter.js`, `optimus-capture/adapters/aliexpress.js`.

## Magalu

- Preserve URL original antes da conversao e a prova assinada do workspace.
- Nao use apenas o link Magazine Voce como prova completa de identidade/origem.
- Fontes: `modules/engine/importer/adapters/magalu.adapter.js`, `modules/manual-v2/adapters/magalu.manual.adapter.js`, `optimus-capture/adapters/magalu.js`.

## KaBuM / AWIN

- Captura da extensao prioriza preco Pix estruturado em `number-flow-react[data]`, mantem fallback legado e separa parcelamento.
- Backend usa adapter/importador AWIN quando aplicavel; preserve tracking e identidade.
- Fontes: `modules/engine/importer/adapters/awin.adapter.js`, `modules/manual-v2/adapters/kabum-awin.manual.adapter.js`, `optimus-capture/adapters/kabum.js`.

## Gate minimo

Teste os seis marketplaces nos fluxos de captura/preview, Salvar, `+ Lista`, Enviar agora e pipeline automatico sempre que um contrato compartilhado mudar.
