import { BetterSqlite3ConnectionOptions } from 'typeorm/driver/better-sqlite3/BetterSqlite3ConnectionOptions'
import { MysqlConnectionOptions } from 'typeorm/driver/mysql/MysqlConnectionOptions'
import { OracleConnectionOptions } from 'typeorm/driver/oracle/OracleConnectionOptions'
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions'
import { SqliteConnectionOptions } from 'typeorm/driver/sqlite/SqliteConnectionOptions'
import { SqlServerConnectionOptions } from 'typeorm/driver/sqlserver/SqlServerConnectionOptions'

export type SqliteFamilyDatabaseConnectionOptions =
  | SqliteConnectionOptions
  | BetterSqlite3ConnectionOptions
export type FileBasedDatabaseConnectionOptions =
  SqliteFamilyDatabaseConnectionOptions
export type RemoteBasedDatabaseConnectionOptions =
  | MysqlConnectionOptions
  | PostgresConnectionOptions
  | OracleConnectionOptions
  | SqlServerConnectionOptions
export type SupportedDatabaseConnectionOptions =
  | RemoteBasedDatabaseConnectionOptions
  | FileBasedDatabaseConnectionOptions
