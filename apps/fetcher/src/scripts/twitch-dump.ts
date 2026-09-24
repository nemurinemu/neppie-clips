import { config } from '../config';
import { getOwnUserId, getUserId, listClips } from '../twitch/api';

// Usage: pnpm twitch-dump [days]   (default: from TWITCH_CLIPS_SINCE)
const main = async () => {
  const days = Number(process.argv[2]);
  const from = Number.isFinite(days)
    ? new Date(Date.now() - days * 86_400_000)
    : config.twitchClipsSince;
  const to = new Date();

  const [me, broadcaster] = await Promise.all([
    getOwnUserId(),
    getUserId(config.twitchBroadcaster),
  ]);
  const t0 = Date.now();
  const all = await listClips(broadcaster, from, to);
  const mine = all
    .filter((c) => c.creator_id === me)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  console.log(
    `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}: ` +
      `${all.length} clips on ${config.twitchBroadcaster}, ${mine.length} mine ` +
      `(${mine.filter((c) => c.video_id).length} with VOD) in ${Date.now() - t0} ms`,
  );
  const byMonth: Record<string, number> = {};
  for (const c of mine) {
    const m = c.created_at.slice(0, 7);
    byMonth[m] = (byMonth[m] ?? 0) + 1;
  }
  console.log('mine by month:', byMonth);
  for (const c of mine.slice(-5)) {
    console.log(`  ${c.created_at}  ${c.id}  "${c.title}"`);
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
