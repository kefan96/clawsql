/**
 * ClawSQL CLI - Notify Command
 *
 * Send notifications through OpenClaw channels.
 */

import { Command, CLIContext } from '../registry.js';

/**
 * Notify command
 */
export const notifyCommand: Command = {
  name: 'notify',
  description: 'Send alerts through OpenClaw channels (WhatsApp, Telegram, Slack, etc.)',
  usage: '/notify <channel> <message>',
  handler: async (args: string[], ctx: CLIContext) => {
    const formatter = ctx.formatter;

    if (args.length < 2) {
      console.log(formatter.error('Usage: /notify <channel> <message>'));
      console.log(formatter.info('  channel  - Destination (phone number, @username, or channel ID)'));
      console.log(formatter.info('  message  - Message to send'));
      console.log();
      console.log(formatter.info('Examples:'));
      console.log(formatter.info('  /notify +1234567890 "Cluster failover completed"'));
      console.log(formatter.info('  /notify @dba-team "Primary instance is down"'));
      return;
    }

    const channel = args[0];
    const message = args.slice(1).join(' ');

    try {
      const { sendNotification } = await import('../agent/openclaw-integration.js');
      await sendNotification(channel, message);
      console.log(formatter.success(`Message sent to ${channel}`));
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      console.log(formatter.error(`Failed to send notification: ${errMessage}`));
      console.log(formatter.info('Make sure OpenClaw gateway is running: openclaw gateway'));
    }
  },
};

export default notifyCommand;