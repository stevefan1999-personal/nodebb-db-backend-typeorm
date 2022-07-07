import * as chrono from 'chrono-node'
import { differenceInMilliseconds, differenceInSeconds } from 'date-fns/fp'
import { Store } from 'express-session'
import * as _ from 'lodash'
import * as nconf from 'nconf'
import { Any, DataSource, DataSourceOptions, Like } from 'typeorm'
import { WinstonAdaptor } from 'typeorm-logger-adaptor/logger/winston'
import * as winston from 'winston'
import { Logger } from 'winston'

import {
  HashSetQueryable,
  INodeBBDatabaseBackend,
  ObjectType,
  RedisStyleMatchString,
  StringQueryable,
} from '../types'

import { DbObject, entities, HashSetObject, StringObject } from './entity'
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
  implements INodeBBDatabaseBackend, StringQueryable, HashSetQueryable
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
        logger: new WinstonAdaptor(winston as unknown as Logger, 'all'),
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
        logger: new WinstonAdaptor(winston as unknown as Logger, 'all'),
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
    const repo = this.dataSource?.getRepository(DbObjectLive)
    if (Array.isArray(key)) {
      const data = new Set(
        (
          (await repo
            ?.createQueryBuilder()
            .select('_key')
            .where({ _key: Any(key) })
            .getRawMany()) ?? []
        ).map(({ _key }) => _key),
      )
      return key.map(data.has)
    } else if (typeof key === 'string') {
      return ((await repo?.findAndCountBy({ _key: key })) ?? 0) > 0
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
      await this.dataSource
        ?.getRepository(StringObject)
        ?.createQueryBuilder()
        .innerJoinAndMapOne('_key', DbObjectLive, 's')
        .where({ _key: key })
        .getOne()
    )?.value
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

  // Implement HashSetQueryable
  async setAdd(key: string, member: string | string[]): Promise<void> {
    if (Array.isArray(member)) {
      for (const val of member) {
        await this.setAdd(key, val)
      }
      return
    }

    const repo = this.dataSource?.getRepository(HashSetObject)
    const data = new HashSetObject()
    data._key = key
    data.member = member
    await repo?.save(data)
  }

  async setsAdd(keys: string[], member: string | string[]): Promise<void> {
    for (const key of _.uniq(keys)) {
      await this.setAdd(key, member)
    }
  }

  async setRemove(
    key: string | string[],
    member: string | string[],
  ): Promise<void> {
    await this.dataSource?.getRepository(HashSetObject)?.delete({
      _key: Array.isArray(key) ? Any(key) : key,
      member: Array.isArray(member) ? Any(member) : member,
    })
  }

  setsRemove(keys: string[], value: string): Promise<void> {
    return this.setRemove(keys, value)
  }

  async isSetMember(key: string, member: string): Promise<boolean> {
    return (
      ((await this.dataSource
        ?.getRepository(HashSetObject)
        .createQueryBuilder()
        .where({ _key: key, member })
        .getCount()) ?? 0) > 0
    )
  }

  async isSetMembers(key: string, member: string[]): Promise<boolean[]> {
    const memberSet = new Set(
      (
        (await this.dataSource
          ?.getRepository(HashSetObject)
          .createQueryBuilder()
          .select('_key')
          .where({ _key: key, member: Any(member) })
          .innerJoin(DbObjectLive, 'l')
          .getRawMany()) ?? []
      ).map(({ member }) => member),
    )

    return member.map(memberSet.has)
  }

  async isMemberOfSets(sets: string[], member: string): Promise<boolean[]> {
    const data = new Set(
      (
        (await this.dataSource
          ?.getRepository(HashSetObject)
          ?.createQueryBuilder()
          .where({ _key: Any(sets), member })
          .innerJoinAndMapMany('_key', DbObjectLive, 'l')
          .getRawMany()) ?? []
      ).map(({ _key }) => _key),
    )
    return sets.map(data.has)
  }

  async getSetMembers(key: string): Promise<string[]> {
    return (
      (await this.dataSource
        ?.getRepository(HashSetObject)
        ?.createQueryBuilder()
        .where({ _key: key })
        .select('member')
        .innerJoin(DbObjectLive, 'l')
        .getRawMany()) ?? []
    ).map(({ member }) => member)
  }

  getSetsMembers(keys: string[]): Promise<string[][]> {
    return this.dataSource?.transaction(() =>
      Promise.all(keys.map(this.getSetMembers)),
    )
  }

  async setCount(key: string): Promise<number> {
    return (
      (await this.dataSource
        ?.getRepository(HashSetObject)
        ?.createQueryBuilder()
        .where({ _key: key })
        .select('member')
        .innerJoin(DbObjectLive, 'l')
        .getCount()) ?? 0
    )
  }

  setsCount(keys: string[]): Promise<number[]> {
    return this.dataSource?.transaction(() =>
      Promise.all(keys.map(this.setCount)),
    )
  }

  setRemoveRandom(key: string): Promise<string> {
    return this.dataSource?.transaction(async (entityManager) => {
      const repo = entityManager.getRepository(HashSetObject)
      const victim = await repo
        .createQueryBuilder()
        .where({ _key: key })
        .innerJoin(DbObjectLive, 'l')
        .orderBy('RANDOM()')
        .getOne()
      if (victim) {
        await repo.delete(_.pick(victim, ['_key', 'member']))
      }
      return victim?.member
    })
  }
}

void (async function main(): Promise<void> {
  console.log('foo')
})()
