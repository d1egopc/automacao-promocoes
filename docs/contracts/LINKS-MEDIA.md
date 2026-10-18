# Links and Media

## Papeis de link

Nao trate URLs diferentes como intercambiaveis:

- link de produto/original: identifica a pagina e o produto;
- canonical/permalink/PC: identidade ou pagina canonica quando o marketplace fornece;
- link afiliado/final: destino comercial atribuido ao workspace;
- link de resgate: ativa cupom/beneficio e pode nao ser pagina do produto;
- app/moda link: papel especifico do marketplace/app;
- shortlink/redirect: precisa ser resolvido pelo contrato oficial antes de provar identidade;
- tracking/publisher/tag: evidencia de atribuicao, nao substituto isolado de identidade.

Nao fabrique identidade a partir de link afiliado, tracking, marketplace ou aparencia da URL. Quando URL original, `productId` e prova apontarem para produtos diferentes, rejeite.

## Afiliacao

- Reutilize os conversores e validadores oficiais; nao crie uma segunda logica.
- Provas assinadas devem permanecer vinculadas a workspace, produto e URLs compativeis.
- Registro legado sem evidencia suficiente permanece bloqueado.
- Nunca afrouxe o gate para fazer um item antigo passar.

## AliExpress APP/PC e ocorrencias

- Radar e TeleRadar permanecem autoridades para preco, cupom, moedas, beneficios,
  variantes, ordem e papel de cada ocorrencia capturada.
- Cada ocorrencia APP/moedas e PC conserva `urlOriginal`, expansao, papel, ordem e
  proveniencia; a conversao de uma ocorrencia nunca substitui outra.
- Uma mensagem pode conter duas, tres ou quatro ocorrencias validas. O contrato
  nao limita artificialmente a um APP e um PC: ocorrencias do mesmo produto podem
  ser preservadas, enquanto IDs canonicos divergentes sao separados ou bloqueados.
- Produto principal e links de produtos secundarios nao podem compartilhar
  titulo, imagem, preco ou afiliacao por inferencia. Links secundarios ficam
  auditaveis e nao contaminam o CTA do principal sem identidade comprovada.
- Se o PC falhar, somente um APP com ProductDetail factual, prova assinada e
  afiliacao propria da workspace pode seguir sozinho. O PC falho permanece no
  registro capturado e nunca e copiado para o campo PC.
- PC canonico alternativo exige ProductDetail coerente, identidade reconciliada e
  nova conversao propria; redirect, login ou ID coincidente isolado nao bastam.
- As invariantes sao exercitadas por
  `tests/aliexpress-app-pc-fallback-oficial.test.js`,
  `tests/aliexpress-app-moedas-contrato.test.js` e
  `tests/links-comerciais-v2-aliexpress-shopee.test.js`.

## Titulo e imagem

- Preserve origem e fallback comprovado.
- Fallback de texto Radar nao equivale a dado oficial do marketplace.
- Imagem ausente nao deve inventar motivo `sem_imagem` sem causa persistida.
- Nao adicione lookup remoto, recaptura ou download no hot path de leitura.
- UI deve preservar proporcao, preferindo `object-fit: contain` quando a tarefa e apenas visual.

## Verificacao

- Links comerciais: `modules/radar/links-comerciais.js`, `modules/engine/link-role.service.js`, `modules/engine/preparacao-links.service.js`.
- Identidade Manual V2: `modules/manual-v2/ofertas-v2-identidade.js`.
- Captura/extensao: `modules/manual-v2/manual-capture.service.js` e `optimus-capture/adapters`.
- Midia Radar: `modules/radar/whatsapp-media-materializer.js`.

Alterar o papel de qualquer link e mudanca de contrato comercial e requer decisao humana.
