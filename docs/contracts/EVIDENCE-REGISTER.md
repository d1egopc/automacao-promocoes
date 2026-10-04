# Evidence Register

Este arquivo registra uma fotografia temporal. Confirme novamente antes de agir. Nao transforme IDs, metricas ou flags daqui em invariantes eternos.

## Prova de 2026-10-04

### Backend

- Branch remota canonica: `main`.
- SHA ativo/remoto: `a8492586a86a392e143515a9113013f2f7272c24`.
- Tree: `0d195c5bec6718dfac7a7f442c01d023005105b7`.
- Rollback conhecido: `64a76700a70205e14cab24cceed44da9d636338b`.
- Workflow de reconciliacao: run `37218628651`; jobs CI e Deploy VPS `success`.
- Container backend: `91268b4758d6e25ca597f6dac7075605546e6e55f349bfaef257981348494aa8`.
- Imagem backend: `sha256:b30612f659169fc253fa287f3c42ab7a693c9fc0beec70de7f238ee412020894`.
- Backend running; restart `0`; OOM `false`.
- PostgreSQL container: `0e54a0aa1673f9865516ed05c277a3a5f4831687cad2b9a3c111833583083af8`; healthy; restart `0`; OOM `false`.
- Mount: `/opt/optimus/data -> /data`, bind RW.
- Compose SHA-256: `46011cd1593e18878cb3607b32d450d3d0feeb78f2e850ef7ef4e081a760fb82`.
- Backend `.env` SHA-256: `ca676311cb241319864e8f965d5eca16c96b0d22bda3091874cebe4139a884b5`.
- Infra `.env` SHA-256: `8d4632829e6e1f61132f20595e51fef488834a46613fb630b1fceb8ec4f7f5db`.
- HTTP local/API publica: 200 na prova.
- Snapshot unico pos-reconciliacao: backend CPU `104.29%`, RSS `3.067 GiB`; PostgreSQL CPU `36.14%`, RSS `326.3 MiB`. Nao use uma amostra unica como baseline de capacidade.

Flags nao sensiveis observadas:

```text
FILA_PERSISTENCE_WORKER=1
FILA_PERSISTENCIA_CANARY_CLIENTES=user_pss60lus,user_b2oogwwl,user_g3qkc18m
FILA_VIVA_MUTATION_WORKER_ROLLOUT=global
FILA_V2_OPERACIONAL_ROLLOUT=global
FILA_V2_OPERACIONAL_ATIVA=0
FILA_V2_OPERACIONAL_CANARY_CLIENTES=user_pss60lus,user_b2oogwwl,user_g3qkc18m
FILA_TERMINAL_INDEX_AUTHORITY=1
FILA_TERMINAL_INDEX_AUTHORITY_CANARY_CLIENTES=user_pss60lus,user_b2oogwwl
FILA_TERMINAL_INDEX_AUTHORITY_FENCE=1
FILA_TERMINAL_INDEX_SHADOW=1
FILA_V2_EXECUTOR_GENERATION_AUTHORITY=1
FILA_V2_EXECUTOR_GENERATION_CANARY_CLIENTES=user_pss60lus,user_b2oogwwl
SOLENOID_ENABLED=1
SOLENOID_SHADOW=0
```

Canary/allowlists observadas devem ser relidas no runtime; nao sao contrato permanente.

### Frontend

- `main`/Production SHA: `c6c79d2d7540df3efdfb702ce117ee00fd9a82a0`.
- Tree: `4cebe6b49092bc7bf8eff371f7551965952e910f`.
- Deployment Production GitHub/Vercel: `6843364696`, status `success`.
- Rollback conhecido: `993bae63707b8d080df2b53d9ac9d3bf18fe7a54`.
- `https://www.optimuspromo.com.br`: HTTP 200 na prova.

### Extensao

- Tag: `extension/v0.2.0`.
- Commit: `612a4d02414005d8849809b2b5d18a1d84b1a346`.
- Tree: `d724a8620a1f0ecb53601ae71d76eaa671a321b0`.
- ZIP: `optimus-capture-0.2.0.zip`.
- SHA-256: `e26b3434cd44ef7f7e51406496253fa9fa3965f2d3e219d7501f3634f50c892e`.
- Tamanho: `2055326` bytes; `32` arquivos; manifest na raiz.
- Release GitHub `403117665`, draft; asset uploaded; nao distribuida.
- Backend minimo registrado: `985d526ebac8db835b301e6c5ca80c43418be7ff`.
- Na prova, Chrome Default e Profile 9 apontavam uma extensao unpacked para `C:\Users\Liva D1EGOPC\Documents\BACKEND-OFICIAL-2026\optimus-capture`. Isso comprova o checkout local observado, nao uma distribuicao oficial aos usuarios.

## Incidente John Frank / VIVA removal fence - 2026-10-04

Workspace afetada: `user_g3qkc18m`.

### Sintoma e causa comprovada

- A workspace nao conseguia ativar a automacao porque um removal fence terminal legado permanecia sem cobertura completa no VIVA.
- A terminalizacao removia apenas a entrada com `item.id === entrada.id`.
- Aliases que representavam a mesma identidade canonica permaneciam no VIVA e impediam a conclusao segura de proof/checkpoint.
- O fail-closed atuou corretamente: a fila nao foi liberada enquanto a divergencia permaneceu.

### Correcao estrutural

- Patch: `92d2e33ef093bc8640ef49e47529055c5f16d8b3` (`fix(viva): remove terminal aliases before fence proof`).
- Contrato corrigido: antes da publicacao valida de proof/checkpoint, a terminalizacao remove todos os representantes que `entradasReferemMesmoItemFilaV2()` reconhece como o mesmo item.
- A correcao vale para novas terminalizacoes em todas as workspaces.
- O patch nao relaxa o fail-closed e nao transforma automaticamente estados legados anteriores ao patch.

### Recovery legado controlado

- O recovery da workspace foi executado de forma isolada e controlada.
- Foram removidos somente tres aliases comprovados; `unrelatedRemoved=[]`.
- Ressurreicao: zero.
- Duplicacao terminal: zero; o terminal afetado permaneceu exatamente uma vez no historico.
- Os fences antigos foram resolvidos pelo fluxo oficial depois da reconciliacao de authority, checkpoint e proof.
- O runtime global permaneceu em `mtime`; o uso de `generation` ficou restrito ao controlador one-shot e nao alterou env ou flags.
- Outras workspaces permaneceram isoladas e operacionais.

### Retomada operacional comprovada

- A automacao foi ativada posteriormente pelo fluxo normal `POST /automacao/toggle`, sem edicao manual de persistencia.
- Estado final observado: `automacaoAtiva=true`, sessao WhatsApp `open` e destino `OFERTAS SMART` ativo.
- Primeiro envio real apos o recovery:
  - oferta `84815` / `engine_84815_1791149902582`;
  - marketplace Mercado Livre;
  - destino `OFERTAS SMART`;
  - canal WhatsApp;
  - confirmacao real do provedor;
  - duracao do envio `617 ms`.
- Veredito: `JOHN RECUPERADO E AUTOMACAO OPERACIONAL`.

### Aprendizado permanente

- Estados legados criados antes do patch podem exigir recovery controlado se ainda contiverem aliases cobertos por removal fence.
- Nunca apagar fence, fabricar proof ou liberar authority sem cobertura comprovada.
- Uma workspace degradada nao pode contaminar nem bloquear outras workspaces.
- Este incidente e caso de referencia para uma futura frente `Workspace Health Guard / Self-Healing`.
- Objetivo futuro do Health Guard: detectar workspace degradada, reconhecer estados de recovery conhecidos, tentar somente recovery deterministico seguro, preservar fail-closed e escalar para humano quando a prova falhar.
- Esta secao registra evidencia do incidente; os contratos normativos de fila permanecem em [DESTINATIONS-QUEUE.md](DESTINATIONS-QUEUE.md) e de isolamento em [MULTITENANCY.md](MULTITENANCY.md).

## Protecoes administrativas

Na prova, `main` dos dois repositorios retornou `protected=false`. Ativar bloqueio de force-push, exclusao e checks obrigatorios exige decisao humana e permissao administrativa.

## Atualizacao

Ao atualizar esta fotografia, registre data, fonte do dado e apenas informacao nao sensivel. Nunca cole token, cookie, senha, chave privada ou valor de secret/env.
