import { config } from '../config';
import { deviceLogin, validate } from '../twitch/auth';

const main = async () => {
  const token = await deviceLogin((uri, code) => {
    console.log(`Open ${uri} and enter the code: ${code}`);
    console.log('Waiting for approval...');
  });
  const who = await validate(token.access_token);
  console.log(
    `Logged in as ${who.login} (${who.user_id}) with scopes ${who.scopes.join(', ')}`,
  );
  console.log(`Token saved to ${config.twitchTokenPath}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
