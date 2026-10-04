# Ingress: Radar, Teleradar and Clonador

## Radar

Radar extrai e normaliza texto, preco, produto, cupom, links e midia antes do importer. Preserve proveniencia (`texto_radar` nao e igual a API/marketplace) e as regras de precedencia em `modules/radar`.

Componentes principais:

- `radar-mirror.js` e `espelho-comercial.js`;
- `comercial-precedencia.js` e `bloco-comercial-canonico.js`;
- `cupom-semantico.js` e `preco-semantico.js`;
- `produto-canonico.js`, `links-comerciais.js` e resolvers de redirect;
- gates/materializacao de midia WhatsApp.

## Teleradar

O envelope e o contexto carregam `clientId`, `workspaceId`, escopo, feature e conta interna. Checkpoint, dedupe, handoff, allowlist e configuracao operacional devem permanecer no mesmo contexto. Contexto incompleto falha fechado.

Fontes: `modules/teleradar/envelope.contract.js`, `checkpoint.repository.js`, `dedupe.repository.js`, `source-allowlist.service.js`, `radar-ingress.adapter.js` e control plane.

## Clonador de grupos

- A requisicao precisa resolver `clienteId`.
- Sessao deve pertencer ao workspace.
- Grupo deve pertencer a sessao/workspace.
- Destinos configurados devem pertencer ao workspace.
- Configuracao, fontes, destinos, buffer e historico sao filtrados por `clienteId`.
- Mensagem propria, feature indisponivel e contexto ausente sao rejeitados/ignorados com motivo, nao roteados para outro tenant.

Fontes: `modules/clonador-grupos/service.js`, `repository.js`, `bridge.js` e `destinos-restricao.contract.js`.

## Invariantes

- Nunca compartilhe configuracao entre Radar, Teleradar e Clonador por conveniencia.
- Nunca substitua sessao/grupo faltante por "primeiro disponivel" de outro workspace.
- Dedupe deve incluir o contexto que impede contaminacao entre tenants.
- Mudanca de parsing precisa validar links, cupom, titulo, imagem, prioridade e fila.
