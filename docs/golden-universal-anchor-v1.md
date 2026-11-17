# Golden Universal Anchor V1

Este documento descreve um contrato de teste. Ele não altera o runtime.

## Escopo

`AnchorContext` reúne evidências já produzidas por Radar, TeleRadar e Clonador:

- `jobId`, `eventoId`, `workspaceId` e `occurrenceId`;
- origem e links originais;
- papéis de link (`produto`, `cupom`, `app`, `pc`, `moedas`, `landing`);
- âncora selecionada e URL técnica;
- identidade oficial, seller, catálogo, anúncio e variante;
- título, categoria e imagem técnica;
- preço, preço anterior, cupom e condições capturados;
- deadline e tentativas.

Os dados comerciais são somente leitura para o caminho de enriquecimento. A recuperação pode preencher título, categoria e imagem, mas não substitui preço, cupom, condições, ocorrência, produto, variante ou link comercial.

## Semântica esperada

- **Fast path:** identidade e campos técnicos suficientes; zero chamadas Work.
- **Recovery path:** existe âncora de produto, faltam campos técnicos e o adapter/capability existente pode ser usado.
- **Blocked:** âncora ausente, identidade divergente, variante divergente, CAPTCHA, stale/futuro ou evidência insuficiente.

O teste é uma especificação Golden e não implementa o resolvedor universal. A integração futura deverá ocorrer no limite comum do importador, delegando a resolução aos adapters e capabilities existentes.

## Rejeições antes do adapter

O Golden inclui casos de link ausente, cupom/social sem produto, shortlink sem resolução e marketplace não detectado. Esses casos devem permanecer bloqueados antes de qualquer chamada Work.

## Mercado Livre P0

As fixtures preservam os casos `1183642`/`MLBU4982518129`/`MLB5153566447` e `1183692`/`MLBU4574541430`/`MLB4987156527`, incluindo `item_id` e `searchVariation`. O Golden não altera o validador ML.

## Gates

Node 24 é o gate principal. PostgreSQL 17 será necessário na próxima etapa para persistência real, idempotência, concorrência, TTL, fanout e ACK; esta etapa local permanece sem banco produtivo.
