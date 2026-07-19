import { TelegramClient } from 'teleproto';
import { initConfig } from '../config';
import { input, password } from '@inquirer/prompts';
import { StringSession } from 'teleproto/sessions';

const main = async () => {
  const config = initConfig();
  const stringSession = new StringSession('');
  const client = new TelegramClient(
    stringSession,
    config.apiId,
    config.apiHash,
    {
      connectionRetries: 5,
    },
  );

  await client.start({
    phoneNumber: async () => await input({ message: 'Phone number: ' }),
    password: async () => await password({ message: '2FA code (if any): ' }),
    phoneCode: async () => await input({ message: 'Code sent to you: ' }),
    onError: (err) => console.log(err),
  });

  console.log('Session string:');
  console.log(client.session.save());

  await client.disconnect();
};

main();
