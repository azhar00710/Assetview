-- Custom P&ID symbol library for Smart Identification (admin-managed raster symbols)

CREATE TABLE IF NOT EXISTS pid_symbol (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol_key      VARCHAR(64) UNIQUE NOT NULL,
    label           VARCHAR(200) NOT NULL,
    abbr            VARCHAR(20),
    category        VARCHAR(20) NOT NULL DEFAULT 'general'
                    CHECK (category IN ('instrument', 'valve', 'pump', 'equipment', 'piping', 'general')),
    keywords        TEXT[] NOT NULL DEFAULT '{}',
    render_type     VARCHAR(10) NOT NULL DEFAULT 'raster'
                    CHECK (render_type IN ('raster', 'vector')),
    storage_key     VARCHAR(500),
    mime_type       VARCHAR(100) DEFAULT 'image/png',
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pid_symbol_category ON pid_symbol(category);
CREATE INDEX IF NOT EXISTS idx_pid_symbol_active ON pid_symbol(is_active) WHERE is_active = true;

CREATE TRIGGER trg_pid_symbol_updated
    BEFORE UPDATE ON pid_symbol
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
