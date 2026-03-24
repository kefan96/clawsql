/**
 * ClawSQL CLI - SQL Command
 *
 * Execute SQL queries via ProxySQL.
 */

import { Command, CLIContext } from '../registry.js';

/**
 * SQL command
 */
export const sqlCommand: Command = {
  name: 'sql',
  description: 'Execute SQL queries via ProxySQL',
  usage: '/sql <query>',
  handler: async (args: string[], ctx: CLIContext) => {
    const formatter = ctx.formatter;

    if (args.length === 0) {
      console.log(formatter.error('Missing query. Usage: /sql <query>'));
      console.log(formatter.info('Example: /sql SELECT * FROM users LIMIT 5'));
      return;
    }

    const query = args.join(' ');

    // Safety check for destructive operations
    const destructivePatterns = [
      /^\s*DROP\s+/i,
      /^\s*TRUNCATE\s+/i,
      /^\s*DELETE\s+FROM\s+/i,
      /^\s*UPDATE\s+.+\s+SET\s+/i,
      /^\s*ALTER\s+/i,
      /^\s*GRANT\s+/i,
      /^\s*REVOKE\s+/i,
    ];

    const isDestructive = destructivePatterns.some(pattern => pattern.test(query));

    if (isDestructive) {
      console.log(formatter.warning('⚠ This query may modify or delete data.'));
      console.log(formatter.info('For safety, destructive queries should be executed directly on MySQL.'));
      console.log(formatter.info('Use: mysql -h <host> -P <port> -u <user> -p'));
      return;
    }

    try {
      console.log(formatter.info(`Executing: ${query}`));

      // Execute query via ProxySQL MySQL interface
      // Note: This requires a MySQL connection to ProxySQL's MySQL port (6033)
      // Using SQL user configured in settings (defaults to root for demo mode)
      const mysql = await import('mysql2/promise');

      // Get admin credentials from settings
      const adminUser = ctx.settings.mysql.adminUser;
      const adminPassword = ctx.settings.mysql.adminPassword;

      const connection = await mysql.createConnection({
        host: ctx.settings.proxysql.host,
        port: ctx.settings.proxysql.mysqlPort,
        user: adminUser,
        password: adminPassword,
      });

      const [rows, fields] = await connection.execute(query);
      await connection.end();

      if (Array.isArray(rows) && rows.length > 0) {
        // Format as table
        const columns = fields.map((f: { name: string }) => ({
          key: f.name,
          header: f.name,
          width: 15,
        }));

        console.log(formatter.table(rows as Record<string, unknown>[], columns));
        console.log(formatter.info(`${rows.length} rows returned`));
      } else if (Array.isArray(rows)) {
        console.log(formatter.info('Query executed successfully. No rows returned.'));
      } else {
        console.log(formatter.success('Query executed successfully.'));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(formatter.error(`Query failed: ${message}`));

      // Provide helpful hints for common errors
      if (message.includes('Access denied')) {
        console.log(formatter.info('MySQL user may not be configured in ProxySQL.'));
        console.log(formatter.info('Add user to ProxySQL: INSERT INTO mysql_users (username, password, default_hostgroup) VALUES (...)'));
      } else if (message.includes('Connection refused')) {
        console.log(formatter.info('Make sure ProxySQL is running and accessible.'));
      }
    }
  },
};

export default sqlCommand;