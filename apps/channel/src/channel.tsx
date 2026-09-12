import { required } from './env';
import { createInternApp, loadVerifiedBindings } from './intern/slack/app';

const name = required('CHANNEL_CODE');
export const internApp = createInternApp({
  name,
  dataDir: process.env.INTERN_DATA_DIR ?? '../../.data/intern',
  userToken: process.env.INTERN_SLACK_USER_TOKEN,
  botToken: process.env.INTERN_SLACK_BOT_TOKEN,
  bindings: loadVerifiedBindings(process.env.INTERN_VERIFIED_DM_BINDINGS, name),
});
export const channel = internApp.channel;
