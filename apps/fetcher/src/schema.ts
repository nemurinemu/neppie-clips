import Database from 'better-sqlite3';

const tableExists = (db: Database.Database, table: string) =>
  !!db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);

const hasColumn = (db: Database.Database, table: string, column: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
    (c) => c.name === column,
  );

const VIDEOS_DDL = `
  CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_msg_id INTEGER UNIQUE,
    source_platform TEXT NOT NULL DEFAULT 'telegram',
    share_id TEXT UNIQUE NOT NULL,
    description TEXT,
    added_at INTEGER,
    updated_at INTEGER,
    grouped_id TEXT,
    size_bytes INTEGER,
    width INTEGER,
    height INTEGER,
    has_vertical INTEGER NOT NULL DEFAULT 0,
    vertical_size_bytes INTEGER,
    needs_review INTEGER NOT NULL DEFAULT 0
  );
`;

const SOURCES_DDL = `
  CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    youtube_title TEXT,
    youtube_published_at TEXT
  );
`;

// Pre-Twitch schema keyed videos on telegram_msg_id. Move to a surrogate id
// (set equal to telegram_msg_id, so media filenames stay valid) and repoint
// sources at it. SQLite can't alter a primary key, hence the rebuild.
const migrateToSurrogateId = (db: Database.Database) => {
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      ${VIDEOS_DDL.replace('IF NOT EXISTS videos', 'videos_new')}
      INSERT INTO videos_new
        (id, telegram_msg_id, share_id, description, added_at, grouped_id, size_bytes, width, height)
      SELECT telegram_msg_id, telegram_msg_id, share_id, description, added_at, grouped_id, size_bytes, width, height
      FROM videos;

      ALTER TABLE sources RENAME TO sources_old;
      DROP TABLE videos;
      ALTER TABLE videos_new RENAME TO videos;

      ${SOURCES_DDL}
      INSERT INTO sources (id, video_id, url, youtube_title, youtube_published_at)
      SELECT id, video_id, url, youtube_title, youtube_published_at FROM sources_old;
      DROP TABLE sources_old;
    `);
  })();
  db.pragma('foreign_keys = ON');
  console.log('Migrated videos to surrogate ids');
};

export const applySchema = (db: Database.Database) => {
  if (tableExists(db, 'videos') && !hasColumn(db, 'videos', 'source_platform')) {
    migrateToSurrogateId(db);
  }
  // Columns added after these tables first shipped (dev DBs only).
  const addColumn = (table: string, column: string, ddl: string) => {
    if (tableExists(db, table) && !hasColumn(db, table, column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
  };
  addColumn('youtube_streams', 'published_at', 'TEXT');
  addColumn('youtube_streams', 'align_tried_at', 'INTEGER');
  addColumn('twitch_clips', 'vod_created_at', 'TEXT');
  addColumn('twitch_clips', 'missing_polls', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('twitch_clips', 'align_status', 'TEXT');
  addColumn('twitch_clips', 'align_tried_at', 'INTEGER');
  addColumn('twitch_clips', 'assigned_stream', 'TEXT');
  addColumn('twitch_clips', 'note', 'TEXT');

  db.exec(`
    ${VIDEOS_DDL}
    ${SOURCES_DDL}

    CREATE TABLE IF NOT EXISTS twitch_clips (
      video_id INTEGER PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
      clip_id TEXT UNIQUE NOT NULL,
      url TEXT NOT NULL,
      creator_id TEXT,
      created_at TEXT,
      duration REAL,
      thumbnail_url TEXT,
      vod_id TEXT,
      vod_offset INTEGER,
      vod_created_at TEXT,
      title TEXT,
      missing_polls INTEGER NOT NULL DEFAULT 0,
      align_status TEXT,
      align_tried_at INTEGER,
      assigned_stream TEXT,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS twitch_review (
      clip_id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT,
      created_at TEXT,
      seen_at INTEGER,
      status TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS youtube_streams (
      id TEXT PRIMARY KEY,
      title TEXT,
      started_at TEXT,
      ended_at TEXT,
      published_at TEXT,
      offset_seconds INTEGER,
      align_status TEXT,
      align_tried_at INTEGER,
      fetched_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_sources_video_id ON sources(video_id);
    CREATE INDEX IF NOT EXISTS idx_videos_grouped_id ON videos(grouped_id);
  `);
};
