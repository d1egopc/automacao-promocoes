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
