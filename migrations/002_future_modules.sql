-- Data model PREPARED for future phases (editor, audio, subtitles, brand kit,
-- thumbnails, export). No Phase 1 feature writes to these tables yet.
-- The editor is NON-DESTRUCTIVE: clips reference immutable media rows.

CREATE TABLE timelines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL DEFAULT 'Main',
  fps REAL NOT NULL DEFAULT 30,
  width INTEGER NOT NULL DEFAULT 1920,
  height INTEGER NOT NULL DEFAULT 1080,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX timelines_project_idx ON timelines(tenant_id, project_id);

CREATE TABLE timeline_tracks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  timeline_id TEXT NOT NULL REFERENCES timelines(id),
  kind TEXT NOT NULL CHECK (kind IN ('VIDEO','AUDIO','TEXT','OVERLAY','LOGO','SUBTITLE','EFFECT')),
  audio_role TEXT CHECK (audio_role IN ('VIDEO_AUDIO','VOICE','NARRATION','BGM','SFX','AMBIENT')),
  name TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL,
  muted INTEGER NOT NULL DEFAULT 0,
  solo INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  volume REAL NOT NULL DEFAULT 1.0,
  opacity REAL NOT NULL DEFAULT 1.0,
  settings_json TEXT NOT NULL DEFAULT '{}' -- e.g. auto-ducking config
);
CREATE INDEX tracks_timeline_idx ON timeline_tracks(timeline_id, position);

CREATE TABLE timeline_clips (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  track_id TEXT NOT NULL REFERENCES timeline_tracks(id),
  media_id TEXT REFERENCES media(id),      -- NULL for text/generated clips
  scene_id TEXT REFERENCES scenes(id),
  start_ms INTEGER NOT NULL,              -- position on the timeline
  duration_ms INTEGER NOT NULL,
  source_in_ms INTEGER NOT NULL DEFAULT 0, -- trim in/out within the source (non-destructive)
  source_out_ms INTEGER,
  speed REAL NOT NULL DEFAULT 1.0,
  reverse INTEGER NOT NULL DEFAULT 0,
  freeze_frame_ms INTEGER,
  volume REAL NOT NULL DEFAULT 1.0,
  fade_in_ms INTEGER NOT NULL DEFAULT 0,
  fade_out_ms INTEGER NOT NULL DEFAULT 0,
  transform_json TEXT NOT NULL DEFAULT '{}', -- crop, position, scale, rotation, flip, zoom/pan, opacity
  text_json TEXT,                            -- text content + style + effect preset
  effects_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX clips_track_idx ON timeline_clips(track_id, start_ms);

CREATE TABLE keyframes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  clip_id TEXT NOT NULL REFERENCES timeline_clips(id),
  property TEXT NOT NULL CHECK (property IN ('POSITION_X','POSITION_Y','SCALE','ROTATION','OPACITY','BLUR','VOLUME')),
  time_ms INTEGER NOT NULL,
  value REAL NOT NULL,
  easing TEXT NOT NULL DEFAULT 'linear'
);
CREATE INDEX keyframes_clip_idx ON keyframes(clip_id, property, time_ms);

CREATE TABLE transitions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  track_id TEXT NOT NULL REFERENCES timeline_tracks(id),
  from_clip_id TEXT REFERENCES timeline_clips(id),
  to_clip_id TEXT REFERENCES timeline_clips(id),
  type TEXT NOT NULL CHECK (type IN ('FADE','CROSS_DISSOLVE','BLUR','ZOOM','SLIDE','SWIPE','PUSH','FLASH','GLITCH','CAMERA_SHAKE','FILM_BURN')),
  duration_ms INTEGER NOT NULL DEFAULT 500,
  params_json TEXT NOT NULL DEFAULT '{}'
);

-- Saved presets for text effects, video effects and transitions ("SAVE AS PRESET").
CREATE TABLE effect_presets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK (kind IN ('TEXT_EFFECT','VIDEO_EFFECT','TRANSITION','TEXT_STYLE','SUBTITLE_STYLE')),
  name TEXT NOT NULL,
  params_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE subtitles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  language TEXT NOT NULL DEFAULT 'en',
  cues_json TEXT NOT NULL DEFAULT '[]',
  style_preset_id TEXT REFERENCES effect_presets(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE brand_kits (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  channel_name TEXT NOT NULL DEFAULT '',
  logo_media_id TEXT REFERENCES media(id),
  watermark_media_id TEXT REFERENCES media(id),
  watermark_position TEXT NOT NULL DEFAULT 'BOTTOM_RIGHT',
  watermark_opacity REAL NOT NULL DEFAULT 0.8,
  intro_media_id TEXT REFERENCES media(id),
  outro_media_id TEXT REFERENCES media(id),
  subscribe_animation_media_id TEXT REFERENCES media(id),
  default_font TEXT NOT NULL DEFAULT '',
  text_style_preset_id TEXT REFERENCES effect_presets(id),
  subtitle_style_preset_id TEXT REFERENCES effect_presets(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE thumbnail_designs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL DEFAULT 'Thumbnail',
  width INTEGER NOT NULL DEFAULT 1280,
  height INTEGER NOT NULL DEFAULT 720,
  background_media_id TEXT REFERENCES media(id),  -- best frame / external / character image
  layers_json TEXT NOT NULL DEFAULT '[]',          -- title text, logo, effects
  template_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE exports (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  timeline_id TEXT REFERENCES timelines(id),
  preset TEXT NOT NULL CHECK (preset IN ('1080p','720p','CUSTOM')),
  aspect_ratio TEXT NOT NULL DEFAULT '16:9',
  container TEXT NOT NULL DEFAULT 'mp4',
  video_codec TEXT NOT NULL DEFAULT 'h264',
  output_media_id TEXT REFERENCES media(id),
  job_id TEXT REFERENCES jobs(id),
  created_at TEXT NOT NULL
);
