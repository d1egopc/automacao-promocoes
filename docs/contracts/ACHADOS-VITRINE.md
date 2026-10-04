# Achados, Ofertas and Vitrine

## Superficies

- Ofertas/Manual V2: `modules/manual-v2/manual-offers.*`.
- Achados: `modules/manual-v2/ofertas-v2-achados.js` e rotas Manual V2.
- Listas: `modules/manual-v2/ofertas-v2-listas.js`.
- Vitrine backend: `modules/vitrine`.
- Frontend oficial: componentes/rotas no repositorio `optimuspromo-frontend`.

## Contratos comerciais

- Achado vindo do RIO/engine deve preservar identidade, URL original, afiliado e prova de workspace quando legitimamente obtidos.
- Magalu preserva URL original antes da conversao e exige prova assinada.
- AliExpress novo recebe prova pelo contrato oficial; legado so pode ser revalidado quando identidade/origem forem comprovaveis.
- Legado sem evidencia suficiente permanece bloqueado; nao force por link afiliado salvo.
- `+ Lista` nao afrouxa o gate de afiliacao.
- `captura_extensao` entra diretamente em Lista sem poluir Ofertas ou Auto Dispatcher.
- Fluxo legado `origem="ofertas" + ofertaId` continua valido.

## Exibicao

- Nome e logo de marketplace sao apresentacao; IDs internos permanecem canonicos.
- Imagens de Vitrine usam area consistente e `object-fit: contain`, sem crop/deformacao.
- Cupom/preco podem ser reorganizados visualmente, sem mudar regra comercial.
- Mudanca visual nao deve adicionar request nem alterar filtros, links, selecao ou modal behavior.

## Validade e expiracao

Quando imagem, link ou cupom deixam de ser validos, preserve o fato historico e aplique somente o contrato de validade da superficie. Nao recapture ou substitua automaticamente em read path. Mudanca de frescor/expiracao exige auditoria dos produtores e consumidores, incluindo Social.

## Gate

Teste Achados, Minha Vitrine, Vitrine publica e modal; valide origem, marketplace, imagem, preco, cupom, links e isolamento de workspace. Alteracao de criterio de entrada/saida e contrato comercial, nao simples UX.
