import { sql, type CreateSqliteDriver } from "@evolu/common";

const READ_EVERY_MS = 4 * 60_000;

/**
 * Chrome keeps OPFS in memory for Incognito and other ephemeral profiles, and
 * there a database file nobody read for about ten minutes reads as empty
 * through its open handle until the page reloads: every query then fails
 * with "no such table". Reading the file every few minutes keeps it intact.
 */
export const guardOpfsIdle =
  (createSqliteDriver: CreateSqliteDriver): CreateSqliteDriver =>
  async (name, options) => {
    const driver = await createSqliteDriver(name, options);
    if (options?.memory !== true)
      setInterval(
        () => driver.exec(sql`select 1 from evolu_config limit 1;`, false),
        READ_EVERY_MS,
      );
    return driver;
  };
