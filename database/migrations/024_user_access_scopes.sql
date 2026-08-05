-- User project & location access scopes for RBAC

CREATE TABLE IF NOT EXISTS app_user_project (
    user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    project_id  UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS app_user_location (
    user_id      UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    location_id  UUID NOT NULL REFERENCES location(id) ON DELETE CASCADE,
    assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_app_user_project_project ON app_user_project (project_id);
CREATE INDEX IF NOT EXISTS idx_app_user_location_location ON app_user_location (location_id);
