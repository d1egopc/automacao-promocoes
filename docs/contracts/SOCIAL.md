# Social

## Papel

Social e consumidor separado das ofertas. Nao e o dispatcher de destinos. Mudancas em oferta, fila, imagem, link, cupom, beneficio ou frescor devem validar o contrato de entrada do Social.

## Implementacao comprovada

- Adaptadores: Instagram, Facebook e Telegram em `modules/social/index.js`.
- Publicador Instagram suporta imagem, publicacao livre e Reel.
- Origens aceitas pelo publicador incluem manual, personalizada, automatica e agendada.
- Formatos incluem feed e reel conforme o adapter/publicador.
- O automatico seleciona ofertas, respeita limites/configuracao, cria agendamentos e pode exigir aprovacao manual.
- Scheduler publica agendamentos com idempotency key por workspace/agendamento/formato.
- Arte visual usa `social-art-renderer` e templates proprios.

## Contrato de entrada

Preserve identidade/oferta, titulo, imagem/midia, preco, beneficio/cupom, link afiliado, marketplace, frescor e workspace. Campo ausente nao deve ser inventado no Social.

## Invariantes

- Publicacao e agendamento sao isolados por `clienteId`.
- Oferta repetida, ja agendada ou publicada nao deve ser duplicada.
- Link afiliado e URL de destino mantem seus papeis.
- Alteracao de elegibilidade/frescor no engine exige smoke Social.
- Falha Social nao deve corromper fila nem transformar envio comercial em confirmado.

## Mudanca segura

Valide manual, personalizada, automatica e agendada conforme o escopo. Nao misture configuracao Meta/Instagram de workspaces diferentes e nao registre tokens em logs/docs.
