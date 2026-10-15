# Platform Topology

## Fontes canonicas

| Superficie | Repositorio / fonte | Referencia a verificar |
| --- | --- | --- |
| Backend | `d1egopc/automacao-promocoes`, pasta `BACKEND-OFICIAL-2026` | `origin/main`, checkout local e SHA ativo na VPS, conferidos separadamente |
| Frontend | `d1egopc/optimuspromo-frontend` | branch Git e deployment Production da Vercel, conferidos separadamente |
| Extensao | subtree `optimus-capture` do backend | tree Git, tag/artefato distribuido e instalacao local, conferidos separadamente |

SHAs e deployments datados ficam em [EVIDENCE-REGISTER.md](EVIDENCE-REGISTER.md). Nenhuma branch, tag ou numero do manifesto prova sozinho o runtime ativo.

## Runtime de producao

- Backend: Hostinger VPS, checkout `/opt/optimus/backend`.
- Compose: `/opt/optimus/infra/compose.yml`; servicos comprovados `backend`, `postgres` e `social-art-renderer`.
- Dados backend: bind mount `/opt/optimus/data -> /data`.
- API/gateway: `https://go.optimuspromo.com.br`, reverse proxy para `127.0.0.1:3000`.
- Frontend: Vercel, dominio `https://www.optimuspromo.com.br`.
- Railway e legado, nao baseline nem alvo de producao.

## Mapa funcional

Produtores de ofertas:

- Radar e Teleradar.
- Clonador de grupos.
- Farejadores/importadores de marketplaces.
- Captura Manual V2 e extensao.

Transformadores e coordenadores:

- `modules/engine/importer`, Inteligencia Universal, fidelidade comercial, normalizadores e preparacao de links.
- Demand Scheduler, Solenoide, cadencia e regras de elegibilidade.

Persistencia e estado operacional:

- Fila, Fila V2/VIVA, checkpoints, proof, intents, removal fences, terminal index e PostgreSQL.

Consumidores:

- Executor/dispatcher para WhatsApp, Telegram e Discord quando configurados.
- Social para publicacao/agendamento.
- Historico, Achados e Vitrine como projecoes/experiencias de leitura, com rotas especificas.

## Regra de dependencia

Uma mudanca em produtor ou transformador pode atingir fila, envio, Historico, Achados, Vitrine e Social. Antes de alterar contratos transversais, liste todos os consumidores e execute os smokes correspondentes.

## Fontes de verificacao

- Entrada/orquestracao: `index.js`, `modules/engine`, `modules/radar`, `modules/teleradar`, `modules/clonador-grupos`.
- Estado: `modules/fila`, `modules/executor`, `modules/demand-scheduler`, `modules/solenoide`.
- Experiencias: `modules/manual-v2`, `modules/vitrine`, `modules/social`, `modules/mensageiro`.
- Isolamento: `modules/workspace`, `modules/auth` e repositories com `clienteId`.
