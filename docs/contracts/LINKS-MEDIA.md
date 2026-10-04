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
