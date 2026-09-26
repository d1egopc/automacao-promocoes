-- Fase 1D: proposta preparada localmente. NAO executada pela aplicacao.
-- Aplicacao exige autorizacao separada e deve preceder o deploy do repository.
-- Sem backfill: atualizado_em/criado_em nao provam horario de confirmacao.
ALTER TABLE fila_checkpoints_entrega ADD COLUMN IF NOT EXISTS confirmado_em TIMESTAMPTZ;

-- Executar fora de transacao, em etapa controlada separada.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fila_checkpoint_confirmado_em
  ON fila_checkpoints_entrega (confirmado_em)
  WHERE estado = 'enviado' AND confirmado_em IS NOT NULL;
