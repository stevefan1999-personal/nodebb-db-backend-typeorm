import * as chrono from 'chrono-node'
import { differenceInMilliseconds, differenceInSeconds } from 'date-fns/fp'
import { Store } from 'express-session'
import * as _ from 'lodash'
import * as nconf from 'nconf'
import { Any, DataSource, DataSourceOptions, Like } from 'typeorm'
import * as winston from 'winston'

import {
  INodeBBDatabaseBackend,
  ObjectType,
  RedisStyleMatchString,
  StringQueryable,
} from '../types'

import { DbObject, entities, StringObject } from './entity'
import { DbObjectLive } from './entity/object'
import { SessionStore } from './session'
import { Utils } from './utils'

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

export class TypeORMDatabaseBackend
  implements INodeBBDatabaseBackend, StringQueryable
{
  #dataSource?: DataSource = null

  get dataSource(): DataSource | null {
    return this.#dataSource?.isInitialized ? this.#dataSource : null
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
      this.#dataSource = await new DataSource({
        ...conf,
        entities,
      }).initialize()
      await this.dataSource?.synchronize()
    } catch (err) {
      if (err instanceof Error) {
        winston.error(
          `NodeBB could not manifest a connection (for data store) with your specified TypeORM config with the following error: ${err.message}`,
        )
      }
      throw err
    }
  }

  async createSessionStore(options: any): Promise<Store> {
    const conf = TypeORMDatabaseBackend.getConnectionOptions(options)
    try {
      const dataSource = await new DataSource({
        ...conf,
        entities: [(await import('./session/entity/session')).Session],
      }).initialize()
      await dataSource.synchronize()
      return new SessionStore(dataSource)
    } catch (err) {
      if (err instanceof Error) {
        winston.error(
          `NodeBB could not manifest a connection (for session store) with your specified TypeORM config with the following error: ${err.message}`,
        )
      }
      throw err
    }
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

  // Implement StringQueryable
  async exists(key: string): Promise<boolean>
  async exists(key: string[]): Promise<boolean[]>
  async exists(key: unknown): Promise<boolean | boolean[]> {
    const repo = this.dataSource?.getRepository(StringObject)
    if (Array.isArray(key)) {
      const data = (
        (await repo
          ?.createQueryBuilder()
          .select('_key')
          .where({ _key: Any(key) })
          .getRawMany()) ?? []
      ).map(({ _key }) => _key)
      return key.map((k) => !!data.find(k))
    } else if (typeof key === 'string') {
      return !!(await repo.findOneBy({ _key: key }))
    }
    throw new Error('unexepected type')
  }

  async scan({ match }: { match: RedisStyleMatchString }): Promise<string[]> {
    const [query, hasWildcard] =
      Utils.convertRedisStyleMatchToSqlWildCard(match)
    return (
      (await this.dataSource
        ?.getRepository(DbObjectLive)
        ?.createQueryBuilder()
        .select('_key')
        .where({ _key: hasWildcard ? Like(query) : query })
        .getRawMany()) ?? []
    ).map(({ _key }: { _key: string }) => _key)
  }

  async delete(key: string): Promise<void> {
    await this.dataSource?.getRepository(DbObject)?.delete({ _key: key })
  }

  async deleteAll(keys: string[]): Promise<void> {
    await this.dataSource?.getRepository(DbObject)?.delete({ _key: Any(keys) })
  }

  async get(key: string): Promise<string | null> {
    return (
      (await this.dataSource
        ?.getRepository(StringObject)
        ?.createQueryBuilder()
        .innerJoinAndSelect(DbObjectLive, 's')
        .where({ _key: key })
        .getOne()) ?? { value: null }
    ).value
  }

  async set(key: string, value: string): Promise<void> {
    const obj = new StringObject()
    obj._key = key
    obj.value = value
    await this.dataSource?.getRepository(StringObject)?.save(obj)
  }

  async increment(key: string): Promise<number> {
    const repo = this.dataSource?.getRepository(StringObject)
    const data = await repo?.findOneBy({ _key: key })
    if (data) {
      let value = Number.parseInt(data.value)
      if (value != null) {
        value += 1
        data.value = `${value}`
      }
      await repo.update({ _key: key }, data)
      return value
    } else {
      const obj = new StringObject()
      obj._key = key
      obj.value = '1'
      await repo.insert(obj)
      return 1
    }
  }

  async rename(oldkey: string, newkey: string): Promise<void> {
    const repo = this.dataSource?.getRepository(StringObject)
    await repo?.delete({ _key: newkey })
    await repo?.update({ _key: oldkey }, { _key: newkey })
  }

  type(key: string): Promise<ObjectType> {
    throw new Error('Method not implemented.')
  }

  async expireInner(key: string, expireAt: Date): Promise<void> {
    await this.dataSource
      ?.getRepository(DbObject)
      ?.update({ _key: key }, { expireAt })
  }

  expire(key: string, seconds: number): Promise<void> {
    return this.expireInner(key, chrono.parseDate(`${seconds} from now`))
  }

  expireAt(key: string, timestampInSeconds: number): Promise<void> {
    return this.expireInner(key, new Date(timestampInSeconds * 1000))
  }

  pexpire(key: string, ms: number): Promise<void> {
    return this.expireInner(
      key,
      chrono.parseDate(`${ms} milliseconds from now`),
    )
  }

  pexpireAt(key: string, timestampInMs: number): Promise<void> {
    return this.expireInner(key, new Date(timestampInMs))
  }

  async ttlInner(
    key: string,
    comparator: (a: Date, b: Date) => number,
  ): Promise<number> {
    const data = await this.dataSource
      ?.getRepository(DbObject)
      .findOneBy({ _key: key })
    if (data?.expireAt != null) {
      return comparator(data.expireAt, new Date())
    }
    return -1
  }

  ttl(key: string): Promise<number> {
    return this.ttlInner(key, differenceInSeconds)
  }

  pttl(key: string): Promise<number> {
    return this.ttlInner(key, differenceInMilliseconds)
  }
}

void (async function main(): Promise<void> {
  console.log('foo')
})()
