-- ASK AI VIDEO STUDIO — core schema (Phase 1)
-- Every tenant-owned row carries tenant_id; every query is tenant-scoped server-side.
-- IDs are immutable UUIDv4 strings. Timestamps are ISO-8601 UTC strings.

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'FREE' CHECK (plan IN ('FREE','PRO','BUSINESS','INTERNAL')),
  created_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  created_at TEXT NOT NULL,
  disabled_at TEXT
);
CREATE UNIQUE INDEX users_email_uq ON users(lower(email));
CREATE INDEX users_tenant_idx ON users(tenant_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,           -- sha256 of the cookie token; raw token never stored
  user_id TEXT NOT NULL REFERENCES users(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  aspect_ratio TEXT NOT NULL DEFAULT '16:9',
  scene_duration_sec INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  thumbnail_media_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX projects_tenant_status_idx ON projects(tenant_id, status, updated_at DESC);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT REFERENCES projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('image','video','audio','script','other')),
  storage_key TEXT NOT NULL UNIQUE,      -- relative key under PRIVATE_STORAGE_ROOT; never a user filename
  thumb_key TEXT,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  original_filename TEXT,                -- display only
  source TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX media_tenant_project_idx ON media(tenant_id, project_id, kind);

CREATE TABLE scenes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  position INTEGER NOT NULL,
  scene_code TEXT NOT NULL DEFAULT '',   -- SCENE_ID from the master script
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  characters TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  assets TEXT NOT NULL DEFAULT '',
  image_prompt TEXT NOT NULL DEFAULT '',
  video_prompt TEXT NOT NULL DEFAULT '',
  dialogue TEXT NOT NULL DEFAULT '',
  camera TEXT NOT NULL DEFAULT '',
  lighting TEXT NOT NULL DEFAULT '',
  audio_notes TEXT NOT NULL DEFAULT '',
  bgm_notes TEXT NOT NULL DEFAULT '',
  sfx_notes TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT NOT NULL DEFAULT '',
  continuity_notes TEXT NOT NULL DEFAULT '',
  duration_sec REAL NOT NULL DEFAULT 10,
  aspect_ratio TEXT NOT NULL DEFAULT '16:9',
  extra_json TEXT NOT NULL DEFAULT '{}',  -- unknown importer fields, preserved verbatim
  image_source TEXT NOT NULL DEFAULT 'FLOW' CHECK (image_source IN ('FLOW','EXTERNAL','UPLOAD','FOLDER','ASSET')),
  image_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (image_status IN ('PENDING','QUEUED','GENERATING','CANDIDATES','APPROVED','REJECTED','FAILED','SKIPPED')),
  video_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (video_status IN ('PENDING','QUEUED','GENERATING','COMPLETED','FAILED','SKIPPED')),
  approved_candidate_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX scenes_project_pos_idx ON scenes(tenant_id, project_id, deleted_at, position);

CREATE TABLE image_candidates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  scene_id TEXT NOT NULL REFERENCES scenes(id),
  media_id TEXT NOT NULL REFERENCES media(id),
  source TEXT NOT NULL CHECK (source IN ('FLOW','EXTERNAL','UPLOAD','FOLDER','ASSET','SIMULATED')),
  status TEXT NOT NULL DEFAULT 'CANDIDATE' CHECK (status IN ('CANDIDATE','APPROVED','REJECTED')),
  job_id TEXT UNIQUE,                    -- idempotency: at most one candidate per generation job
  imported_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT REFERENCES users(id)
);
CREATE INDEX candidates_scene_idx ON image_candidates(tenant_id, scene_id, status);
-- Guarantees at most ONE approved image per scene at the database level.
CREATE UNIQUE INDEX candidates_one_approved_uq ON image_candidates(scene_id) WHERE status = 'APPROVED';

CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  appearance TEXT NOT NULL DEFAULT '',
  costume TEXT NOT NULL DEFAULT '',
  continuity TEXT NOT NULL DEFAULT '',
  voice_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX characters_tenant_idx ON characters(tenant_id, archived_at, name);

CREATE TABLE character_images (
  character_id TEXT NOT NULL REFERENCES characters(id),
  media_id TEXT NOT NULL REFERENCES media(id),
  tenant_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (character_id, media_id)
);

CREATE TABLE project_characters (
  project_id TEXT NOT NULL REFERENCES projects(id),
  character_id TEXT NOT NULL REFERENCES characters(id),
  tenant_id TEXT NOT NULL,
  PRIMARY KEY (project_id, character_id)
);

CREATE TABLE library_assets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('VEHICLE','LOCATION','PROP','LOGO','REFERENCE')),
  description TEXT NOT NULL DEFAULT '',
  preview_media_id TEXT REFERENCES media(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX assets_tenant_idx ON library_assets(tenant_id, archived_at, category, name);

CREATE TABLE project_assets (
  project_id TEXT NOT NULL REFERENCES projects(id),
  asset_id TEXT NOT NULL REFERENCES library_assets(id),
  tenant_id TEXT NOT NULL,
  PRIMARY KEY (project_id, asset_id)
);

-- A generation run groups the per-scene jobs of one "Generate images" action.
CREATE TABLE generation_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','PAUSED','COMPLETED','CANCELLED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX runs_project_idx ON generation_runs(tenant_id, project_id, created_at DESC);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  scene_id TEXT REFERENCES scenes(id),
  run_id TEXT REFERENCES generation_runs(id),
  sequence INTEGER NOT NULL DEFAULT 0,   -- scene order at enqueue time (resume ordering)
  type TEXT NOT NULL CHECK (type IN ('IMAGE_GENERATE','VIDEO_GENERATE')),
  provider TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('QUEUED','PREPARING','GENERATING','DOWNLOADING','COMPLETED','FAILED','PAUSED','SKIPPED','CANCELLED','INTERRUPTED')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  idempotency_key TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  error_summary TEXT,                    -- SAFE user-facing text only
  locked_by TEXT,
  heartbeat_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX jobs_queue_idx ON jobs(state, created_at);
CREATE INDEX jobs_project_idx ON jobs(tenant_id, project_id, run_id, sequence);
CREATE INDEX jobs_scene_idx ON jobs(tenant_id, scene_id, type, state);
-- At most one non-terminal job per idempotency key.
CREATE UNIQUE INDEX jobs_active_idem_uq ON jobs(idempotency_key)
  WHERE state IN ('QUEUED','PREPARING','GENERATING','DOWNLOADING','PAUSED','INTERRUPTED');

-- Future: multiple isolated, manually authenticated Flow browser profiles.
-- NO passwords, cookies or tokens are ever stored here; profile data lives in
-- <PRIVATE_STORAGE_ROOT>/browser-profiles/<tenant>/<profile_key>/.
CREATE TABLE provider_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  profile_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NOT_CONNECTED' CHECK (status IN ('NOT_CONNECTED','SIGNED_IN','NEEDS_ATTENTION','CANNOT_CONTINUE','DISABLED')),
  is_selected INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, provider, profile_key)
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}',  -- redacted
  created_at TEXT NOT NULL
);
CREATE INDEX audit_tenant_idx ON audit_log(tenant_id, created_at DESC);
