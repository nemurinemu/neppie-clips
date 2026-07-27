import Database from 'better-sqlite3';

export const applySchema = (db: Database.Database) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      telegram_msg_id INTEGER PRIMARY KEY,
      share_id TEXT UNIQUE NOT NULL,
      description TEXT,
      added_at INTEGER,
      grouped_id TEXT,
      size_bytes INTEGER,
      width INTEGER,
      height INTEGER
    );

    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL REFERENCES videos(telegram_msg_id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      youtube_title TEXT,
      youtube_published_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sources_video_id ON sources(video_id);
    CREATE INDEX IF NOT EXISTS idx_videos_grouped_id ON videos(grouped_id);
  `);
};
