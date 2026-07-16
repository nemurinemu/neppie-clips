import Database from 'better-sqlite3';

export const applySchema = (db: Database.Database) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_msg_id INTEGER UNIQUE NOT NULL,
      description TEXT,
      video_path TEXT NOT NULL,
      thumb_path TEXT,
      posted_at INTEGER,
      grouped_id TEXT
    );

    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      url TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sources_video_id ON sources(video_id);
    CREATE INDEX IF NOT EXISTS idx_videos_grouped_id ON videos(grouped_id);
  `);
};
