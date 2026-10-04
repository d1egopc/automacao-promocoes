# Multi-tenancy

## Identidade

`clienteId`/workspace e fronteira de seguranca, nao apenas filtro de UI. A normalizacao oficial vive em `modules/workspace`, com identidade, registry e channel registry.

## Recursos isolados

- usuarios, planos e features;
- sessoes WhatsApp e contas/canais;
- destinos, categorias, templates e janelas;
- filas, VIVA, proof, checkpoints, intents, fences e terminal index;
- Radar, Teleradar e Clonador;
- Manual V2, Ofertas, Listas, Achados e Vitrine privada;
- Mensageiro e Social;
- Historico, arquivos em `/data` e linhas no PostgreSQL;
- integracoes, afiliacao, tracking e credenciais.

## Regras

- Resolva workspace da autenticacao/contexto oficial; nao aceite `clienteId` arbitrario do payload quando o servidor ja conhece o tenant.
- Valide sessao, grupo e destino contra o mesmo workspace.
- Inclua workspace em chaves de dedupe, locks, caches, arquivos, jobs e idempotencia.
- Queries devem filtrar tenant no proprio acesso, nao apenas depois de ler.
- Caminhos em disco passam por normalizacao segura; rejeite traversal e IDs invalidos.
- Nao use fallback para `admin`, primeiro cliente, primeira sessao ou primeiro destino em fluxo comercial.
- Logs podem registrar identificador operacional necessario, nunca tokens/segredos.

## Gate

Todo patch transversal precisa de teste com pelo menos dois workspaces, incluindo colisao de IDs comerciais. Persistencia/concorrencia multiworkspace eleva a tarefa para Nivel 3 ou 4.
