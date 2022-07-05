import { Store } from 'express-session'
import * as _ from 'lodash'
import * as nconf from 'nconf'
import { DataSource, DataSourceOptions } from 'typeorm'
import * as winston from 'winston'

import { INodeBBDatabaseBackend } from '../types'

import { DbObject, entities } from './entity'

const sensibleDefault: { [key: string]: { username?: string; port?: number } } =
  {
    mysql: {
      port: 3306,
      username: 'root',
    },
    postgres: {
      port: 5432,
      username: 'postgres',
    },
  }

export class TypeORMDatabaseBackend implements INodeBBDatabaseBackend {
  #dataSource?: DataSource = null

  get dataSource(): DataSource | null {
    return this.#dataSource?.isInitialized ? this.#dataSource : null
  }

  static async createConnection(
    options: DataSourceOptions,
  ): Promise<DataSource> {
    return new DataSource({
      ...options,
      entities,
    }).initialize()
  }

  static getConnectionOptions(
    typeorm: any = nconf.get('typeorm'),
  ): DataSourceOptions {
    if (!typeorm.type) {
      throw new Error('[[error:no-database-type-specified]]')
    }

    if (typeorm.type === 'sqlite') {
      if (!typeorm.database) {
        winston.warn('You have no database file, using "./nodebb.db"')
        typeorm.database = './nodebb.db'
      }
    } else {
      const sensibleDefaultByType = sensibleDefault[typeorm.type]
      if (!typeorm.host) {
        typeorm.host = '127.0.0.1'
      }
      if (!typeorm.port && sensibleDefaultByType?.port) {
        typeorm.port = sensibleDefaultByType.port
      }
      if (!typeorm.username && sensibleDefaultByType?.port) {
        typeorm.port = sensibleDefaultByType.port
      }
      if (!typeorm.database) {
        winston.warn('You have no database name, using "nodebb"')
        typeorm.database = 'nodebb'
      }
    }

    const connOptions = {
      database: typeorm.database,
      host: typeorm.host,
      password: typeorm.password,
      port: typeorm.port,
      ssl: typeorm.ssl,
      type: typeorm.type,
      username: typeorm.username,
    }

    return _.merge(connOptions, typeorm.options || {})
  }

  async init(): Promise<void> {
    const conf = TypeORMDatabaseBackend.getConnectionOptions()
    try {
      this.#dataSource = await TypeORMDatabaseBackend.createConnection(conf)
      await this.dataSource?.synchronize()
    } catch (err) {
      if (err instanceof Error) {
        winston.error(
          `NodeBB could not manifest a connection with your specified TypeORM config with the following error: ${err.message}`,
        )
      }
      throw err
    }
  }

  async createSessionStore(_options: any): Promise<Store> {
    throw 'not implemented'
  }

  async createIndices(callback: any): Promise<void> {
    await this.dataSource?.synchronize()
    callback()
  }

  async checkCompatibility(callback: any): Promise<void> {
    return this.checkCompatibilityVersion('', callback)
  }

  async checkCompatibilityVersion(
    _version: string,
    callback: any,
  ): Promise<void> {
    callback()
  }

  async info(_db: any): Promise<any> {
    // noop, not supported
    return {}
  }

  async close(): Promise<void> {
    await this.dataSource?.destroy()
    this.#dataSource = null
  }

  async flushdb(): Promise<void> {
    await this.dataSource?.dropDatabase()
  }

  async emptydb(): Promise<void> {
    await this.dataSource?.getRepository(DbObject).delete({})
  }
}

void (async function main(): Promise<void> {
  console.log('foo')
})()
