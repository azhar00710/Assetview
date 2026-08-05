-- Application users, roles, and role assignments (simple email/password RBAC)

CREATE TABLE IF NOT EXISTS app_role (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    permissions     JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_system       BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_app_role_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS app_user (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    display_name    VARCHAR(200) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at   TIMESTAMPTZ,
    CONSTRAINT uq_app_user_email UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS app_user_role (
    user_id         UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    role_id         UUID NOT NULL REFERENCES app_role(id) ON DELETE CASCADE,
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_app_user_email ON app_user (email);
CREATE INDEX IF NOT EXISTS idx_app_user_active ON app_user (is_active);
CREATE INDEX IF NOT EXISTS idx_app_user_role_role ON app_user_role (role_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_app_role_updated') THEN
      CREATE TRIGGER trg_app_role_updated
        BEFORE UPDATE ON app_role
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_app_user_updated') THEN
      CREATE TRIGGER trg_app_user_updated
        BEFORE UPDATE ON app_user
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
  END IF;
END $$;
