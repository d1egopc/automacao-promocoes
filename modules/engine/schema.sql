CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'engine_ofertas' THEN
    NEW.atualizada_em = NOW();
  ELSE
    NEW.atualizado_em = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS engine_eventos_brutos (
  id BIGSERIAL PRIMARY KEY,
  uuid UUID DEFAULT gen_random_uuid() UNIQUE,
  origem TEXT NOT NULL DEFAULT 'radar',
  fonte TEXT DEFAULT 'radar',
  origem_tipo TEXT,
  sessao_id TEXT,
  grupo_id TEXT,
  grupo_nome TEXT,
  texto_original TEXT,
  links_extraidos JSONB NOT NULL DEFAULT '[]'::jsonb,
  marketplace_detectado TEXT,
  hash_evento TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  capturado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE engine_eventos_brutos ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();
ALTER TABLE engine_eventos_brutos ADD COLUMN IF NOT EXISTS fonte TEXT DEFAULT 'radar';
ALTER TABLE engine_eventos_brutos ADD COLUMN IF NOT EXISTS marketplace_detectado TEXT;
ALTER TABLE engine_eventos_brutos ADD COLUMN IF NOT EXISTS hash_evento TEXT;
ALTER TABLE engine_eventos_brutos ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS engine_links (
  id BIGSERIAL PRIMARY KEY,
  uuid UUID DEFAULT gen_random_uuid() UNIQUE,
  evento_id BIGINT NOT NULL REFERENCES engine_eventos_brutos(id) ON DELETE CASCADE,
  url_original TEXT NOT NULL,
  url_normalizada TEXT,
  url_expandida TEXT,
  dominio_original TEXT,
  dominio_final TEXT,
  redirect_ok BOOLEAN,
  motivo_redirect TEXT,
  marketplace_detectado TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE engine_links ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();
ALTER TABLE engine_links ADD COLUMN IF NOT EXISTS url_expandida TEXT;
ALTER TABLE engine_links ADD COLUMN IF NOT EXISTS dominio_original TEXT;
ALTER TABLE engine_links ADD COLUMN IF NOT EXISTS dominio_final TEXT;
ALTER TABLE engine_links ADD COLUMN IF NOT EXISTS redirect_ok BOOLEAN;
ALTER TABLE engine_links ADD COLUMN IF NOT EXISTS motivo_redirect TEXT;
ALTER TABLE engine_links ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS engine_ofertas (
  id BIGSERIAL PRIMARY KEY,
  uuid UUID DEFAULT gen_random_uuid() UNIQUE,
  evento_id BIGINT REFERENCES engine_eventos_brutos(id) ON DELETE CASCADE,
  link_id BIGINT REFERENCES engine_links(id) ON DELETE SET NULL,
  marketplace TEXT,
  titulo TEXT,
  titulo_normalizado TEXT,
  preco NUMERIC(12,2),
  preco_original NUMERIC(12,2),
  moeda TEXT DEFAULT 'BRL',
  cupom TEXT,
  tipo_cupom TEXT,
  beneficio_extra TEXT,
  imagem TEXT,
  link_original TEXT,
  link_expandido TEXT,
  link_afiliado TEXT,
  categoria TEXT,
  score NUMERIC(6,2),
  prioridade INTEGER DEFAULT 0,
  origem TEXT,
  status TEXT DEFAULT 'capturada',
  motivo_status TEXT,
  capturada_em TIMESTAMPTZ,
  criada_em TIMESTAMPTZ DEFAULT NOW(),
  atualizada_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS engine_jobs_cliente (
  id BIGSERIAL PRIMARY KEY,
  uuid UUID DEFAULT gen_random_uuid() UNIQUE,
  evento_id BIGINT NOT NULL REFERENCES engine_eventos_brutos(id) ON DELETE CASCADE,
  oferta_id BIGINT REFERENCES engine_ofertas(id) ON DELETE SET NULL,
  cliente_id TEXT NOT NULL,
  marketplace_detectado TEXT,
  marketplace TEXT,
  categoria TEXT,
  score NUMERIC(6,2),
  prioridade INTEGER DEFAULT 0,
  link_afiliado TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  tentativas INTEGER DEFAULT 0,
  motivo_final TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE engine_jobs_cliente ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();
ALTER TABLE engine_jobs_cliente ADD COLUMN IF NOT EXISTS oferta_id BIGINT;
ALTER TABLE engine_jobs_cliente ADD COLUMN IF NOT EXISTS prioridade INTEGER DEFAULT 0;
ALTER TABLE engine_jobs_cliente ADD COLUMN IF NOT EXISTS score NUMERIC(6,2);
ALTER TABLE engine_jobs_cliente ADD COLUMN IF NOT EXISTS categoria TEXT;
ALTER TABLE engine_jobs_cliente ADD COLUMN IF NOT EXISTS marketplace TEXT;
ALTER TABLE engine_jobs_cliente ADD COLUMN IF NOT EXISTS link_afiliado TEXT;
ALTER TABLE engine_jobs_cliente ADD COLUMN IF NOT EXISTS tentativas INTEGER DEFAULT 0;
ALTER TABLE engine_jobs_cliente ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_engine_jobs_cliente_oferta_id'
  ) THEN
    ALTER TABLE engine_jobs_cliente
      ADD CONSTRAINT fk_engine_jobs_cliente_oferta_id
      FOREIGN KEY (oferta_id) REFERENCES engine_ofertas(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS engine_processamentos (
  id BIGSERIAL PRIMARY KEY,
  uuid UUID DEFAULT gen_random_uuid() UNIQUE,
  job_id BIGINT NOT NULL REFERENCES engine_jobs_cliente(id) ON DELETE CASCADE,
  etapa TEXT,
  status TEXT,
  motivo TEXT,
  detalhes JSONB DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE engine_processamentos ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();
ALTER TABLE engine_processamentos ADD COLUMN IF NOT EXISTS detalhes JSONB DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_engine_eventos_brutos_uuid
  ON engine_eventos_brutos (uuid);
CREATE INDEX IF NOT EXISTS idx_engine_eventos_brutos_capturado_em
  ON engine_eventos_brutos (capturado_em);
CREATE INDEX IF NOT EXISTS idx_engine_eventos_brutos_grupo_id
  ON engine_eventos_brutos (grupo_id);
CREATE INDEX IF NOT EXISTS idx_engine_eventos_brutos_origem_tipo
  ON engine_eventos_brutos (origem_tipo);
CREATE INDEX IF NOT EXISTS idx_engine_eventos_brutos_marketplace_detectado
  ON engine_eventos_brutos (marketplace_detectado);
CREATE UNIQUE INDEX IF NOT EXISTS idx_engine_eventos_brutos_hash_evento_unique
  ON engine_eventos_brutos (hash_evento)
  WHERE hash_evento IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_engine_eventos_brutos_criado_em
  ON engine_eventos_brutos (criado_em);
CREATE INDEX IF NOT EXISTS idx_engine_eventos_brutos_dedupe
  ON engine_eventos_brutos (grupo_id, criado_em);

CREATE UNIQUE INDEX IF NOT EXISTS idx_engine_links_uuid
  ON engine_links (uuid);
CREATE INDEX IF NOT EXISTS idx_engine_links_evento_id
  ON engine_links (evento_id);
CREATE INDEX IF NOT EXISTS idx_engine_links_marketplace_detectado
  ON engine_links (marketplace_detectado);
CREATE INDEX IF NOT EXISTS idx_engine_links_url_original
  ON engine_links (url_original);
CREATE INDEX IF NOT EXISTS idx_engine_links_url_expandida
  ON engine_links (url_expandida);

CREATE UNIQUE INDEX IF NOT EXISTS idx_engine_ofertas_uuid
  ON engine_ofertas (uuid);
CREATE INDEX IF NOT EXISTS idx_engine_ofertas_evento_id
  ON engine_ofertas (evento_id);
CREATE INDEX IF NOT EXISTS idx_engine_ofertas_link_id
  ON engine_ofertas (link_id);
CREATE INDEX IF NOT EXISTS idx_engine_ofertas_marketplace
  ON engine_ofertas (marketplace);
CREATE INDEX IF NOT EXISTS idx_engine_ofertas_categoria
  ON engine_ofertas (categoria);
CREATE INDEX IF NOT EXISTS idx_engine_ofertas_score
  ON engine_ofertas (score);
CREATE INDEX IF NOT EXISTS idx_engine_ofertas_prioridade
  ON engine_ofertas (prioridade);
CREATE INDEX IF NOT EXISTS idx_engine_ofertas_status
  ON engine_ofertas (status);
CREATE INDEX IF NOT EXISTS idx_engine_ofertas_capturada_em
  ON engine_ofertas (capturada_em);
CREATE INDEX IF NOT EXISTS idx_engine_ofertas_titulo_normalizado
  ON engine_ofertas (titulo_normalizado);
CREATE INDEX IF NOT EXISTS idx_engine_ofertas_link_original
  ON engine_ofertas (link_original);
CREATE INDEX IF NOT EXISTS idx_engine_ofertas_link_expandido
  ON engine_ofertas (link_expandido);

CREATE UNIQUE INDEX IF NOT EXISTS idx_engine_jobs_cliente_uuid
  ON engine_jobs_cliente (uuid);
CREATE INDEX IF NOT EXISTS idx_engine_jobs_cliente_cliente_id
  ON engine_jobs_cliente (cliente_id);
CREATE INDEX IF NOT EXISTS idx_engine_jobs_cliente_evento_id
  ON engine_jobs_cliente (evento_id);
CREATE INDEX IF NOT EXISTS idx_engine_jobs_cliente_oferta_id
  ON engine_jobs_cliente (oferta_id);
CREATE INDEX IF NOT EXISTS idx_engine_jobs_cliente_status_idx
  ON engine_jobs_cliente (status);
CREATE INDEX IF NOT EXISTS idx_engine_jobs_cliente_marketplace
  ON engine_jobs_cliente (marketplace);
CREATE INDEX IF NOT EXISTS idx_engine_jobs_cliente_categoria
  ON engine_jobs_cliente (categoria);
CREATE INDEX IF NOT EXISTS idx_engine_jobs_cliente_prioridade
  ON engine_jobs_cliente (prioridade);
CREATE INDEX IF NOT EXISTS idx_engine_jobs_cliente_criado_em
  ON engine_jobs_cliente (criado_em);
CREATE INDEX IF NOT EXISTS idx_engine_jobs_cliente_status
  ON engine_jobs_cliente (cliente_id, status, criado_em);

CREATE UNIQUE INDEX IF NOT EXISTS idx_engine_processamentos_uuid
  ON engine_processamentos (uuid);
CREATE INDEX IF NOT EXISTS idx_engine_processamentos_job_id
  ON engine_processamentos (job_id);
CREATE INDEX IF NOT EXISTS idx_engine_processamentos_etapa
  ON engine_processamentos (etapa);
CREATE INDEX IF NOT EXISTS idx_engine_processamentos_status
  ON engine_processamentos (status);
CREATE INDEX IF NOT EXISTS idx_engine_processamentos_criado_em
  ON engine_processamentos (criado_em);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_engine_ofertas_atualizada_em'
  ) THEN
    CREATE TRIGGER trg_engine_ofertas_atualizada_em
      BEFORE UPDATE ON engine_ofertas
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_engine_jobs_cliente_atualizado_em'
  ) THEN
    CREATE TRIGGER trg_engine_jobs_cliente_atualizado_em
      BEFORE UPDATE ON engine_jobs_cliente
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END;
$$;