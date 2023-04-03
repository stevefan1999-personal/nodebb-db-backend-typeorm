// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import proxymise = require('proxymise')
import { Container, Token } from 'typedi'

import { DataSource, initDataSourceAndCache } from './datasources'

import type { TypeORMDatabaseBackend } from '~/index'

jest.setTimeout(60000)

export const DATABASE = new Token<TypeORMDatabaseBackend>('DATABASE')

const ds =
  (process.env.TEST_DATASOURCE as DataSource) ?? DataSource.SqliteBaseline

if (process.env.TEST_DATASOURCE !== ds) {
  console.log('No data source selected, using the default SQLite provider')
}

Container.set<TypeORMDatabaseBackend>(DATABASE, () =>
  proxymise(initDataSourceAndCache(ds)),
)
