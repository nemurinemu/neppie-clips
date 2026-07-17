# neppie-clips

Neppie clip fetcher + api + frontend :)

## Dev setup

1. Create `.env.development` based on `.env.example`;

2. Go to https://my.telegram.org and get your api_id and api_hash;

3. Run `pnpm i` to install dependencies;

4. Run `pnpm create-session` and log into the telegram in the command prompt to get your session and paste it into .env;

5. Create YouTube Data API v3 api key in Google Cloud Console and paste it into .env

6. Run `pnpm dev` and enjoy

## Deployment

[PM2](https://pm2.keymetrics.io/) is used for handling the bot process on my deploy server. If you don't intend using it, edit the deploy script.

Create `.env.production` based on `.env.example`, then run:

```bash
$ pnpm install

$ pnpm prod:deploy
```
