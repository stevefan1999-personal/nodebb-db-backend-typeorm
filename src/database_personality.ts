import { DeleteQueryBuilder, QueryBuilder, SelectQueryBuilder } from 'typeorm'
import { DriverUtils } from 'typeorm/driver/DriverUtils'

import type { Driver, DatabaseType } from 'typeorm'

export enum PopularDatabaseType {
  PostgreSql = 'postgres',
  MySql = 'mysql',
  Oracle = 'oracle',
  Sqlite = 'sqlite',
  Mssql = 'mssql',

  // aliases
  SqlServer = Mssql,
  Postgres = PostgreSql,
  MariaDb = MySql,
}

type DatabasePersonality = {
  quirks?: {
    collation?: { binary?: string }
    specialFunction?: {
      random?: string
    }
    fixLimit?: <T>(qb: SelectQueryBuilder<T>) => SelectQueryBuilder<T>
  }
  sensibleDefault?: {
    port?: number
    username?: string
  }
}

export const databasePersonality: Record<
  PopularDatabaseType,
  DatabasePersonality
> = {
  [PopularDatabaseType.Mssql]: {
    quirks: {
      collation: { binary: 'Latin1_General_BIN2' },
      specialFunction: { random: 'NEWID()' },
    },
    sensibleDefault: {
      port: 1433,
      username: 'sa',
    },
  },
  [PopularDatabaseType.MySql]: {
    quirks: {
      collation: { binary: 'utf8_bin' },
      fixLimit<T>(qb: SelectQueryBuilder<T>): SelectQueryBuilder<T> {
        // Give it a very big integer
        return qb.limit(Number.MAX_SAFE_INTEGER)
      },
      specialFunction: { random: 'RAND()' },
    },
    sensibleDefault: {
      port: 3306,
      username: 'root',
    },
  },
  [PopularDatabaseType.Oracle]: {
    quirks: {
      collation: { binary: 'BINARY' },
      specialFunction: { random: 'DBMS_RANDOM.VALUE()' },
    },
    sensibleDefault: {
      port: 1521,
      username: 'scott',
    },
  },
  [PopularDatabaseType.PostgreSql]: {
    quirks: {
      collation: { binary: `"C"` },
      specialFunction: { random: 'RANDOM()' },
    },
    sensibleDefault: {
      port: 5432,
      username: 'postgres',
    },
  },
  [PopularDatabaseType.Sqlite]: {
    quirks: {
      collation: { binary: 'BINARY' },
      specialFunction: { random: 'RANDOM()' },
    },
  },
}

export function resolveDatabaseTypeByDriver(
  driver: Driver,
): PopularDatabaseType | null {
  if (DriverUtils.isMySQLFamily(driver)) {
    return PopularDatabaseType.MySql
  } else if (DriverUtils.isPostgresFamily(driver)) {
    return PopularDatabaseType.PostgreSql
  } else if (DriverUtils.isSQLiteFamily(driver)) {
    return PopularDatabaseType.Sqlite
  } else if (driver.options.type === 'oracle') {
    return PopularDatabaseType.Oracle
  } else if (driver.options.type === 'mssql') {
    return PopularDatabaseType.Mssql
  }
  return null
}

export function resolveDatabaseType(
  type: DatabaseType,
): PopularDatabaseType | null {
  // cheeki breeki
  const driver = { options: { type } } as Driver
  return resolveDatabaseTypeByDriver(driver)
}
