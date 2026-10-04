# Browser Extension

## Fonte oficial

- Versao: `0.2.0`.
- Tag: `extension/v0.2.0`.
- Commit: `612a4d02414005d8849809b2b5d18a1d84b1a346`.
- Tree: `d724a8620a1f0ecb53601ae71d76eaa671a321b0`.
- Artefato atual esta em release draft e nao foi distribuido automaticamente.
- A copia `0.1.0` embutida em checkouts antigos do backend nao e fonte oficial.

Valores temporais de ZIP/hash ficam no `EVIDENCE-REGISTER`.

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
