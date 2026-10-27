# Marketplaces

## Classificação Universal V3 — evidência existente, sem aquisição obrigatória

O contrato público `classificarCategoriaOferta` continua retornando uma string da taxonomia atual. `classificarCategoriaUniversal` reutiliza o mesmo classificador e acrescenta decisão sanitizada nos logs já existentes: categoria final, origem, fonte técnica fixa, motivo, confiança, divergência e baixa confiança. A confiança é qualitativa, não uma probabilidade calibrada. Não grava novos arquivos nem registra título, URL, credenciais ou afiliação nesses novos campos.

Corrigir categoria específica exige natureza factual inequívoca, como lubrificante de carretilhas/molinetes, brinquedo que imita ferramenta ou roupa de pesca com público explícito. Não classificar apenas por marca genérica, “linha”, “vara”, “óleo” ou “régua”. Roupa de pesca sem público/evidência suficiente permanece em Diversos; equipamento de camping não cria uma afinidade de pesca separada. Conteúdo adulto explícito não é classificado como infantil nem habilita uma categoria Adulto.

| Conector inspecionado | Dado efetivamente disponível no código | Uso e limite |
| --- | --- | --- |
| Mercado Livre | Importador HTML retorna `Mercado Livre`; identidade e fatos do produto existem, mas não entrega categoria oficial/ID/hierarquia à classificação | Aplicar identidade/título factual. Não presumir acesso à API de vendedores/categorias com credencial afiliada; nenhum lookup adicional |
| Shopee | Contrato importado retorna `Shopee`; GraphQL afiliado/conversor já existentes não fornecem hierarquia de categoria no DTO atual | Fallback existente; não solicitar scope de vendedor |
| Amazon | Importador HTML retorna `Amazon`; não há BrowseNode/ID/hierarquia no retorno atual | Fallback existente; token afiliado/tag não comprova acesso à Product Advertising API |
| AliExpress | A chamada afiliada já solicita `first_level_category_name` e `second_level_category_name`; ID de categoria só se presente na resposta | Preservar ambos os níveis e preferir o ramo específico conhecido. Mesmas chamadas productdetail/query e credenciais; fonte é distinguida e vínculo ao productId é obrigatório |
| Magalu | Parser já lê BreadcrumbList/meta e SKU, mas antes entregava apenas o penúltimo nome | Preservar até oito nomes. Promover a evidência oficial somente após HTTP 2xx, hostname oficial, SKU/canônica coerentes, título factual e ausência de bloqueio/divergência. Parse-only, HTML enviado, 403 e CAPTCHA não recebem proveniência oficial |
| KaBuM/AWIN | Importador HTML retorna `Gamer e Hardware`; AWIN usado para deeplink, sem feed de categoria/ID comprovado no caminho atual | Natureza factual pode corrigir casos inequívocos. Nenhum acesso AWIN feed é presumido |

O mapa externo aceita somente ramos conhecidos e tipos inequívocos da taxonomia interna, com limites de oito níveis/120 caracteres e identidade curta. ID opaco isolado e ramos amplos (“Sports & Entertainment”) não inventam categoria. Produto/tipo contraditório vence o rótulo externo; tipo e hierarquia oficiais incompatíveis sem título conclusivo ficam em baixa confiança. Os testes puros dos seis marketplaces/AWIN não comprovam disponibilidade real de API: somente AliExpress e o HTTP factual Magalu estão conectados a essa nova proveniência nesta candidata.

A origem oficial é marcada por objeto interno em memória, criado no conector após resposta/identidade válidas. JSON de cliente ou disco não restabelece essa marca; não basta declarar `fonte=oficial`. O cache técnico já existente do AliExpress preserva o produto validado, e o cache factual Magalu conserva somente a referência de prova já criada e os dados públicos permitidos. As regras de TTL, falha fechada para 403/CAPTCHA e limpeza de segredos desses caches permanecem. Categoria interna específica já persistida continua no contrato declarado, salvo correção factual restrita; não se declara “oficial” pela mera presença em cache.

As palavras das regras existentes são normalizadas/deduplicadas uma vez no boot, preservando o scorer em teste determinístico contra a base. Não há nova chamada externa, consulta PostgreSQL, fila, timer, escrita síncrona ou dependência da extensão no despacho. A extensão/Worker compartilhada continua com suas capabilities atuais de identidade/imagem; não há capability de categoria homologada, e nenhuma foi criada. PC desligado não bloqueia a classificação nem o RIO.

Radar/TeleRadar/Clonador continuam entrando nos adapters/normalização/serviço universal existentes; ofertas manuais e farejadores continuam usando o classificador compartilhado. A categoria é persistida em `engine_ofertas.categoria` e projetada no Template Universal pelo bloco já existente. Não modificar renderer, roteamento, destinos, ACK ou reprocessar ofertas persistidas.

Compatibilidade futura específica/abrangente é apenas projeto: uma relação como Climatização → Eletrodomésticos deverá ser opcional e decidida pelo destino, com teste de envio único. Nenhum pai/filho, expansão de seleção ou afinidade múltipla foi ativado nesta versão.

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

- Preserve produto/PC, App, Moda, Moedas e Resgate como ocorrencias e papeis comerciais distintos; nao fabrique link ausente nem substitua um PC nao resolvido pelo productId de outro papel.
- Landing oficial de Moedas com productId factual pode enriquecer titulo, imagem e categoria pela API existente, mas nao comprova a identidade de outro link da mensagem. Sem detalhes oficiais suficientes, falhe fechado.
- O Radar continua autoridade de preco, cupom e beneficios capturados; moedas nao viram desconto presumido. Converta cada link comercial pela integracao da propria workspace, preservando a URL original da ocorrencia e sua prova de afiliacao.
- Prova assinada deve vincular workspace e produto.
- Achado legado sem URL/identidade verificavel permanece bloqueado; link afiliado salvo nao basta.
- Brasil/Internacional, impostos, taxas e observacoes so aparecem quando presentes nos dados.
- Fontes: `modules/engine/importer/adapters/aliexpress.adapter.js`, `modules/manual-v2/adapters/aliexpress.manual.adapter.js`, `optimus-capture/adapters/aliexpress.js`.

## Magalu

- Preserve URL original antes da conversao e a prova assinada do workspace.
- Nao use apenas o link Magazine Voce como prova completa de identidade/origem.
- Fontes: `modules/engine/importer/adapters/magalu.adapter.js`, `modules/manual-v2/adapters/magalu.manual.adapter.js`, `optimus-capture/adapters/magalu.js`.

### Espera por identidade e imagem — candidata focal de 27/10/2026

- A espera por `magalu_identity_v1` não deve consumir o orçamento de `magalu_image_v1`. Reutilizar o scheduler e a chave `localWorkerImageRetry` existentes, com fase/capability explícitas e uma única transição identidade → imagem. Cada fase conserva três esperas de 30/120/300 segundos; não aceitar regressão de fase, reiniciar orçamento legado/desconhecido ou reabrir job terminal. Frescor, TTL, CAS, deduplicação e destino permanecem sob as autoridades existentes.
- Evidência real: evento Telegram 197029/Worker 27879/job 1007554; três esperas `sem_link_produto_confirmado` antes da identidade validada e terminal `sem_imagem` depois. O compartilhamento indevido do orçamento é reproduzido na baseline exata 0cfac157 e corrigido em fixture. A Telemetria não expõe o estado histórico da tarefa de imagem, a URL canônica ou o productId deste evento; a reprodução não os inventa nem garante recuperação daquele job.
- A fixture `tests/fixtures/magalu-197029-retry.sanitized.json` distingue a cronologia observada dos dados comerciais/produto sintéticos. `tests/magalu-recovery-retry.test.cjs` valida limites, CAS, transição, preservação comercial, isolamento e reutilização dos caches/conversores oficiais. Identidade validada não é prova de afiliação. Imagem e afiliação continuam obrigatórias para a oferta seguir ao RIO. Nenhum reprocessamento retroativo é autorizado por esta candidata.

## KaBuM / AWIN

- Captura da extensao prioriza preco Pix estruturado em `number-flow-react[data]`, mantem fallback legado e separa parcelamento.
- Backend usa adapter/importador AWIN quando aplicavel; preserve tracking e identidade.
- Fontes: `modules/engine/importer/adapters/awin.adapter.js`, `modules/manual-v2/adapters/kabum-awin.manual.adapter.js`, `optimus-capture/adapters/kabum.js`.

## Gate minimo

Teste os seis marketplaces nos fluxos de captura/preview, Salvar, `+ Lista`, Enviar agora e pipeline automatico sempre que um contrato compartilhado mudar.

## Mapa de regressao executavel existente

Estes arquivos existem na main oficial; sua presenca nao significa que o CI de producao os execute ou que uma oferta real tenha sido comprovada:

- Mercado Livre: Engine/identidade/imagem/Work em `tests/mercadolivre-identidade-canonica.test.js`, `tests/mercadolivre-imagem-oficial-fallback.test.js` e `tests/mercadolivre-work-backend-order.test.js`; Manual V2 em `tests/manual-v2-import-mercadolivre.test.js`; extensao em `tests/optimus-capture-extension.test.js` e `tests/optimus-capture-local-worker-ml-image.test.js`.
- Amazon: Engine/afiliacao em `tests/amazon-shortlink-afiliacao.test.js`; Manual V2 em `tests/manual-v2-import-amazon.test.js`; titulo/imagem/captura da extensao em `tests/optimus-capture-extension.test.js`.
- Shopee: Engine, produto/resgate, titulo e afiliacao em `tests/shopee-resgate-ocorrencias.test.js`, `tests/shopee-rio-titulo-beneficio.test.js` e `tests/shopee-afiliacao-workspace.test.js`; Manual V2 em `tests/manual-v2-import-shopee.test.js`; extensao em `tests/optimus-capture-extension.test.js`.
- AliExpress: Engine, APP/PC/Moedas e prova por workspace em `tests/aliexpress-app-moedas-contrato.test.js`, `tests/aliexpress-moedas-productdetail-engine.test.js` e `tests/aliexpress-afiliacao-workspace.test.js`; Manual V2 em `tests/manual-v2-import-aliexpress.test.js`; extensao em `tests/optimus-capture-extension.test.js`.
- Magalu: Engine/identidade/imagem/afiliacao em `tests/magalu-v2-golden-path.test.js`, `tests/magalu-identity-engine-importer.test.js` e `tests/magalu-image-resolver.test.js`; Manual V2 em `tests/manual-v2-import-magalu.test.js`; extensao/Work em `tests/optimus-capture-magalu.test.js` e `tests/magalu-local-worker-identity.test.js`.
- KaBuM/AWIN: Engine/importador e preco em `tests/kabum-hotfix.test.js` e `tests/destinos-compatibilidade-kabum-awin.test.js`; Manual V2 em `tests/manual-v2-import-kabum.test.js`; extensao e Launcher em `tests/optimus-capture-extension.test.js` e `tests/optimus-capture-launcher.test.js`.

Para alteracao compartilhada de links, classificacao, imagem, afiliacao ou template, acrescente `tests/engine-v2-marketplaces-fidelidade.test.js`, `tests/link-conversao-ocorrencia-marketplaces.test.js`, `tests/contrato-comercial-final-universal.test.js`, `tests/imagem-link-contrato-universal.test.js`, `tests/template-universal-visual-contract.test.js`, `tests/dynamic-link-resolvers.test.js` e `tests/redirect-resolver-shortlinks-seguros.test.js`. Compare qualquer falha com a baseline; nao enfraqueca assertions para fechar o gate.

## Lacuna do CI oficial

Na revisao desta main, `.github/workflows/deploy-backend-vps.yml` roda bootstrap, financeiro e configuracao de links, mas nao chama as suites acima de Engine, Manual V2 ou extensao dos seis marketplaces. Antes de publicar mudanca **compartilhada** nessas areas, a matriz acima e os testes transversais impactados devem ser gate obrigatorio em CI Linux Node 24 do candidato, com falhas comparadas a sua baseline. Isto e uma exigencia proposta de homologacao; o workflow ainda nao foi alterado. PostgreSQL 17 isolado continua necessario quando a mudanca tocar selecao, claim ou persistencia SQL, nao por toda edicao documental.
