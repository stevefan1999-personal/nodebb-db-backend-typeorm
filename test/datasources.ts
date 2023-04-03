import { DataSourceOptions } from 'typeorm'
import { WinstonAdaptor } from 'typeorm-logger-adaptor/logger/winston'
import winston from 'winston'

import { SupportedDatabaseConnectionOptions } from '../types'

import type { TypeORMDatabaseBackend } from '~/index'

export enum DataSource {
  MysqlBaseline = 'local:docker:mysql:5.7.38-debian',
  PostgresBaseline = 'local:docker:postgres:10.21-alpine',
  SqliteBaseline = 'local:none:sqlite',
  MssqlBaseline = 'local:docker:azure-sql-edge:1.0.6',
}

export const dataSources: Record<DataSource, DataSourceOptions> = {
  [DataSource.PostgresBaseline]: {
    database: 'postgres',
    dropSchema: true,
    host: 'localhost',
    logging: true,
    password: 'test',
    port: 15432,
    synchronize: true,
    type: 'postgres',
    username: 'postgres',
  },
  [DataSource.MysqlBaseline]: {
    database: 'test',
    dropSchema: true,
    host: 'localhost',
    password: 'test',
    port: 13306,
    synchronize: true,
    type: 'mysql',
    username: 'root',
  },
  [DataSource.SqliteBaseline]: {
    database: './test.db',
    dropSchema: true,
    enableWAL: true,
    synchronize: true,
    type: 'better-sqlite3',
  },
  [DataSource.MssqlBaseline]: {
    database: 'master',
    dropSchema: true,
    host: 'localhost',
    options: { encrypt: false, trustServerCertificate: true },
    password: 'StrongPassword@123',
    port: 11433,
    synchronize: true,
    type: 'mssql',
    username: 'sa',
  },
}

export const logger = winston.createLogger({
  format: winston.format.cli(),
  level: 'debug',
  transports: [new winston.transports.Console()],
})

// I can use a memo function but I need to flush the database every time, so no
export async function initDataSourceAndCache(
  ds: DataSource,
): Promise<TypeORMDatabaseBackend> {
  const db = await getBackendInstance()
  if (!(ds in dataSources)) {
    throw new Error(`${ds} is not a valid data source`)
  }
  const dataSource = dataSources[ds] as SupportedDatabaseConnectionOptions
  if (process.env.TEST_LOG_SQL && JSON.parse(process.env.TEST_LOG_SQL)) {
    dataSource.logger = new WinstonAdaptor(logger, 'all')
  }

  await db.init(dataSource)
  return db
}

export async function getBackendInstance(): Promise<TypeORMDatabaseBackend> {
  if (
    process.env.TEST_OBFUSCATED_DISTRIBUTION &&
    JSON.parse(process.env.TEST_OBFUSCATED_DISTRIBUTION)
  ) {
    console.log('Using obfuscated distribution')
    const { TypeORMDatabaseBackend } = await import('../output/index.cjs')
    return new TypeORMDatabaseBackend()
  } else {
    console.log('Using normal imports')
    const { TypeORMDatabaseBackend } = await import('~/index')
    return new TypeORMDatabaseBackend()
  }
}
