import Database from 'better-sqlite3';
import { initConfig } from './config';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Entity } from 'telegram/define';
import { NewMessage } from 'telegram/events';
import { applySchema } from './schema';
import { processVideo } from './process-video';
import { EditedMessage } from 'telegram/events/EditedMessage';
import { parseCaption } from './parse-caption';

const main = async () => {
  const config = initConfig();
  const db = new Database(config.dbDir);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applySchema(db);

  const client = new TelegramClient(
    new StringSession(config.tgSession),
    config.apiId,
    config.apiHash,
    { connectionRetries: 5 },
  );
  await client.connect();

  const channel = await client.getEntity(config.channelname);
  await backfill(client, channel, db);
  listenLive(client, channel, db);

  console.log('Clip fetcher running: backfill finished, listening for updates');
};

const backfill = async (
  client: TelegramClient,
  channel: Entity,
  db: Database.Database,
) => {
  const messages: Api.Message[] = [];
  for await (const msg of client.iterMessages(channel, { reverse: true })) {
    messages.push(msg);
  }

  const groups = new Map<string, Api.Message[]>();
  const singles: Api.Message[] = [];

  for (const msg of messages) {
    if (!msg.video) continue;
    if (msg.groupedId) {
      const key = msg.groupedId.toString();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(msg);
    } else {
      singles.push(msg);
    }
  }

  for (const group of groups.values()) {
    const caption = group.find((m) => m.message)?.message ?? '';
    if (!caption) continue;
    for (const msg of group) await processVideo(client, msg, caption, db);
  }
  for (const msg of singles) {
    const caption = msg.message;
    if (!caption) continue;
    await processVideo(client, msg, caption, db);
  }
};

const handleEdit = async (
  client: TelegramClient,
  msg: Api.Message,
  db: Database.Database,
) => {
  if (!msg.video) return;

  const existingRow = db
    .prepare('SELECT id FROM videos WHERE telegram_msg_id = ?')
    .get(msg.id) as { id: number } | undefined;

  if (!existingRow && !msg.groupedId) {
    if (msg.message) {
      await processVideo(client, msg, msg.message, db);
      return;
    }
  }
  if (!existingRow) return;

  let caption = msg.message;
  let affectedIds: number[];

  if (msg.groupedId) {
    const groupKey = msg.groupedId.toString();
    const siblings = db
      .prepare('SELECT id FROM videos WHERE grouped_id = ?')
      .all(groupKey) as { id: number }[];
    if (!caption) return;
    affectedIds = siblings.map((s) => s.id);
  } else {
    if (!caption) return;
    affectedIds = [existingRow.id];
  }

  const { description, sources } = parseCaption(caption);

  const updateStmt = db.prepare(
    'UPDATE videos SET description = ? WHERE id = ?',
  );
  const deleteSourcesStmt = db.prepare(
    'DELETE FROM sources WHERE video_id = ?',
  );
  const insertSourceStmt = db.prepare(
    'INSERT INTO sources (video_id, url) VALUES (?, ?)',
  );

  const tx = db.transaction((ids: number[]) => {
    for (const id of ids) {
      updateStmt.run(description, id);
      deleteSourcesStmt.run(id);
      for (const url of sources) insertSourceStmt.run(id, url);
    }
  });
  tx(affectedIds);

  console.log(
    `Updated caption for ${affectedIds.length} video(s), group ${msg.groupedId ?? msg.id}`,
  );
};

const listenLive = async (
  client: TelegramClient,
  channel: Entity,
  db: Database.Database,
) => {
  const pending = new Map<
    string,
    { messages: Api.Message[]; timer: NodeJS.Timeout }
  >();

  client.addEventHandler(
    async (event) => {
      const msg: Api.Message = event.message;
      if (!msg.video) return;
      if (!msg.groupedId) {
        if (!msg.message) return;
        await processVideo(client, msg, msg.message, db);
        return;
      }
      const key = msg.groupedId?.toString();
      if (!pending.has(key)) {
        pending.set(key, { messages: [], timer: setTimeout(() => {}, 0) });
      }
      const entry = pending.get(key)!;
      entry.messages.push(msg);
      clearTimeout(entry.timer);
      entry.timer = setTimeout(async () => {
        const caption = entry.messages.find((m) => m.message)?.message ?? '';
        if (!caption) return;
        for (const m of entry.messages)
          await processVideo(client, msg, caption, db);
        pending.delete(key);
      }, 1500);
    },
    new NewMessage({ chats: [channel] }),
  );
  client.addEventHandler(
    async (event) => {
      await handleEdit(client, event.message, db);
    },
    new EditedMessage({ chats: [channel] }),
  );
};

main().catch((err) => {
  console.error('Fetcher crashed:', err);
  process.exit(1);
});
