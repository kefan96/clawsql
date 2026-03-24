/**
 * ClawSQL CLI - Help Command
 *
 * Shows available commands and their usage.
 */

import { Command, CLIContext, listCommands } from '../registry.js';

/**
 * Help command
 */
export const helpCommand: Command = {
  name: 'help',
  description: 'Show available commands',
  usage: '/help [command]',
  handler: async (args: string[], ctx: CLIContext) => {
    const formatter = ctx.formatter;

    // If a specific command is requested
    if (args.length > 0) {
      const cmdName = args[0].replace(/^\//, '');
      const commands = listCommands();
      const cmd = commands.find(c => c.name === cmdName);

      if (cmd) {
        console.log(formatter.header(`Command: /${cmd.name}`));
        console.log(formatter.keyValue('Description', cmd.description));
        console.log(formatter.keyValue('Usage', cmd.usage));
        console.log();
        return;
      }

      console.log(formatter.error(`Unknown command: ${cmdName}`));
      return;
    }

    // Show all commands
    const commands = listCommands();
    console.log(formatter.header('Available Commands'));

    const tableData = commands.map(cmd => ({
      command: `/${cmd.name}`,
      description: cmd.description,
    }));

    console.log(formatter.table(tableData, [
      { key: 'command', header: 'Command', width: 25 },
      { key: 'description', header: 'Description', width: 50 },
    ]));

    console.log();
    console.log(formatter.info('Type /help <command> for detailed usage.'));
    console.log(formatter.info('Press Ctrl+D or type /exit to quit.'));
    console.log();
  },
};

export default helpCommand;