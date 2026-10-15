# Browser Extension

## Fonte oficial

- Fonte de desenvolvimento: subtree `optimus-capture` da main reconciliada do backend. Verifique sua tree Git e o `manifest.json` antes de empacotar.
- A tag `extension/v0.2.0` e o ZIP draft registram um artefato historico, nao necessariamente a tree mais recente da main ou a extensao instalada em cada navegador.
- Uma extensao unpacked observada no PC nao comprova distribuicao oficial. Nao substitua a subtree atual por copia antiga com o mesmo numero de versao.

Versao, tag, commit/tree, ZIP/hash e estado de distribuicao datados ficam no [EVIDENCE-REGISTER.md](EVIDENCE-REGISTER.md).

## Fluxos

- Captura da aba atual alimenta formulario editavel e Preview local.
- Preview e padrao da oferta; mensagem final usa o template do destino.
- Salvar no Optimus cria Oferta normal.
- `+ Lista` usa `origem="captura_extensao"`, insere diretamente na Lista, nao cria Oferta fantasma e nao entra no Auto Dispatcher.
- Oferta existente no painel usa o contrato legado `origem="ofertas" + ofertaId`.
- Enviar agora permanece uma acao separada.
- Idempotencia/dedupe deve impedir dupla escrita e duplo envio.

## UX e performance

- Mostre resumo, formulario e Preview assim que os dados basicos estiverem disponiveis.
- Conversao/afiliacao pode concluir assincronamente; bloqueie somente a acao que depende dela.
- Edicao do usuario e autoridade e nao pode ser sobrescrita por recaptura.
- Nao adicione request, timer, observer pesado, biblioteca ou imagem extra sem justificativa.
- Preview reativo deve ser DOM/CSS/local e sem request adicional.

## Marketplaces

Adapters oficiais: Mercado Livre, Amazon, Shopee, AliExpress, Magalu e KaBuM. Mudanca compartilhada exige smoke nos seis. Preserve os contratos em [MARKETPLACES.md](MARKETPLACES.md).

## Empacotamento

Gere ZIP diretamente da tree comprovada. `manifest.json` fica na raiz. Exclua `.git`, testes, logs, backups, worktrees, tokens/cookies e temporarios. Calcule SHA-256, tamanho e contagem antes de submeter ao gate humano.
