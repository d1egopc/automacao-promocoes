# Destinations and Queue

## Destinos

Destinos pertencem a um workspace e carregam canal, sessao/grupo ou conta, categorias/marketplaces permitidos, janela, intervalo, capacidade, midia e template. Nao escolha destino de outro workspace nem use substring para igualar IDs.

Tipos/canais comprovados no sistema incluem WhatsApp, Telegram e Discord. Valide cada canal apenas nos modulos que realmente o implementam.

## Elegibilidade

Separe sempre:

- sem oportunidade: zero destinos aplicaveis para a oferta;
- nao enviada: existia destino aplicavel, zero confirmacoes e nenhuma falha tecnica;
- parcial: algum destino confirmou, mas nao todos;
- erro: falha tecnica real com zero confirmacoes;
- enviada: todos os destinos aplicaveis confirmaram.

Janela fechada, categoria/marketplace incompativel, limite, bloqueio ou retencao devem manter causa comprovada. Nao converta ausencia de causa em `sem_imagem` ou outro motivo inferido.

## Fila operacional

O caminho inclui fila legada, Fila V2/VIVA, executor, checkpoints, proof, intents, removal fences, generation authority e terminal index. Fontes principais ficam em `modules/fila`, `modules/executor` e `modules/engine`.

Invariantes:

- VIVA mutation nao pode congelar a main thread.
- ACK, proof, manifest e DB devem convergir por generation.
- Removal fence so e limpa depois de checkpoint duravel que cubra a remocao.
- Recovery deve falhar fechado em hash/generation/manifest incoerente.
- Terminal deve aparecer exatamente uma vez; item removido nao ressuscita.
- Decisoes de prioridade sao monotonicas quando ha piso comercial comprovado.

## Listas

O intervalo minimo operacional confirmado e 2,5 minutos. Frontend nao deve oferecer valor menor; backend permanece protecao final. Configuracao `intervaloMs=0` representa estado parado/nao configurado e nao deve ser migrada silenciosamente.

## Mudanca

Fila, scheduler, fairness, cadencia, Solenoide e persistencia sao alto risco. Comece em READ-ONLY e exija rollback explicito.
