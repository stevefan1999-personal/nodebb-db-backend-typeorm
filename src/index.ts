import * as chrono from 'chrono-node'
import { differenceInMilliseconds, differenceInSeconds } from 'date-fns/fp'
import { Store } from 'express-session'
import * as _ from 'lodash'
import * as nconf from 'nconf'
import {
  In,
  DataSource,
  DataSourceOptions,
  Like,
  SelectQueryBuilder,
} from 'typeorm'
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

import {
  DbObject,
  entities,
  HashSetObject,
  StringObject,
  subscribers,
} from './entity'
import { DbObjectLive } from './entity/object'
import { SessionStore } from './session'
import { Utils } from './utils'

const logger = winston.createLogger({
  format: winston.format.cli(),
  level: 'debug',
  transports: [new winston.transports.Console()],
})

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

  async init(): Promise<void> {
    const conf = TypeORMDatabaseBackend.getConnectionOptions()
    try {
      this.#dataSource = await new DataSource({
        ...conf,
        entities,
        logger: new WinstonAdaptor(logger, 'all'),
        subscribers,
      }).initialize()
    } catch (err) {
      if (err instanceof Error) {
        winston.error(
          `NodeBB could not manifest a connection (for data store) with your specified TypeORM config with the following error: ${err.message}`,
        )
      }
      throw err
    }
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

  async createSessionStore(options: any): Promise<Store> {
    const conf = TypeORMDatabaseBackend.getConnectionOptions(options)
    try {
      const dataSource = await new DataSource({
        ...conf,
        entities: [(await import('./session/entity/session')).Session],
        logger: new WinstonAdaptor(logger, 'all'),
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

  async flushdb(): Promise<void> {
    await this.dataSource?.dropDatabase()
    await this.dataSource?.synchronize()
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

  // Implement StringQueryable
  async exists(key: string): Promise<boolean>
  async exists(key: string[]): Promise<boolean[]>
  async exists(key: unknown): Promise<boolean | boolean[]> {
    const repo = this.dataSource?.getRepository(DbObjectLive)
    if (Array.isArray(key)) {
      return _.chain(
        await repo
          ?.createQueryBuilder('o')
          .where({ key: In(key) })
          .select('o.key')
          .getMany(),
      )
        .keyBy('key')
        .mapValues(() => true)
        .thru((data) => key.map((x) => data[x] ?? false))
        .value()
    } else if (typeof key === 'string') {
      return ((await repo?.countBy({ key })) ?? 0) > 0
    }
    throw new Error('unexepected type')
  }

  async emptydb(): Promise<void> {
    await this.dataSource?.getRepository(DbObject).delete({})
  }

  async scan({ match }: { match: RedisStyleMatchString }): Promise<string[]> {
    return _.chain(
      await this.dataSource
        ?.getRepository(DbObjectLive)
        ?.createQueryBuilder('s')
        .where({
          key: Like(Utils.convertRedisStyleMatchToSqlWildCard(match)[0]),
        })
        .select('s.key')
        .getMany(),
    )
      .map('key')
      .value()
  }

  async delete(key: string): Promise<void> {
    await this.dataSource?.getRepository(DbObject)?.delete({ _key: key })
  }

  async deleteAll(keys: string[]): Promise<void> {
    await this.dataSource?.getRepository(DbObject)?.delete({ key: In(keys) })
  }

  async get(key: string): Promise<string | null> {
    return (
      await this.getQueryBuildByClassWithLiveObject(StringObject)
        .where({ key })
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
      ?.update({ key }, { expireAt })
  }

  async ttlInner(
    key: string,
    comparator: (a: Date, b: Date) => number,
  ): Promise<number> {
    const { expireAt } =
      (await this.dataSource?.getRepository(DbObject).findOneBy({ key })) ?? {}
    return expireAt ? comparator(expireAt, new Date()) : -1
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

  ttl(key: string): Promise<number> {
    return this.ttlInner(key, differenceInSeconds)
  }

  pttl(key: string): Promise<number> {
    return this.ttlInner(key, differenceInMilliseconds)
  }

  // Implement HashSetQueryable
  async setAdd(key: string, member: string | string[]): Promise<void> {
    await this.dataSource
      ?.getRepository(HashSetObject)
      .createQueryBuilder()
      .insert()
      .orIgnore()
      .values(
        (!Array.isArray(member) ? [member] : member).map((member) => {
          const data = new HashSetObject()
          data.key = key
          data.member = member
          return data
        }),
      )
      .execute()
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
      key: Array.isArray(key) ? In(key) : key,
      member: Array.isArray(member) ? In(member) : member,
    })
  }

  setsRemove(keys: string[], value: string): Promise<void> {
    return this.setRemove(keys, value)
  }

  async isSetMember(key: string, member: string): Promise<boolean> {
    return (
      ((await this.getQueryBuildByClassWithLiveObject(HashSetObject)
        ?.where({ key, member })
        .getCount()) ?? 0) > 0
    )
  }

  async isSetMembers(key: string, members: string[]): Promise<boolean[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashSetObject, 's')
        ?.where({ key, member: In(members) })
        .select('s.member')
        .getMany(),
    )
      .keyBy('member')
      .mapValues(() => true)
      .thru((data) => members.map((member) => data[member] ?? false))
      .value()
  }

  async isMemberOfSets(sets: string[], member: string): Promise<boolean[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashSetObject, 's')
        ?.where({ key: In(sets), member })
        .select('s.key')
        .getMany(),
    )
      .uniq()
      .keyBy('key')
      .mapValues(() => true)
      .thru((data) => sets.map((set) => data[set] ?? false))
      .value()
  }

  async getSetMembers(key: string): Promise<string[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashSetObject, 's')
        .where({ key })
        .select('s.member')
        .getMany(),
    )
      .map('member')
      .value()
  }

  setCount(key: string): Promise<number> {
    return this.getQueryBuildByClassWithLiveObject(HashSetObject, 's')
      .where({ key })
      .select('s.member')
      .getCount()
  }

  getSetsMembers(keys: string[]): Promise<string[][]> {
    return this.dataSource?.transaction(() =>
      Promise.all(keys.map(this.getSetMembers)),
    )
  }

  async setsCount(keys: string[]): Promise<number[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashSetObject, 's', 'l')
        .where({ key: In(keys) })
        .groupBy('l.key')
        .select('s.key')
        .addSelect('COUNT(*)', 'count')
        .getRawMany<{ key: string; count: number }>(),
    )
      .keyBy('key')
      .mapValues('count')
      .thru((data) => keys.map((key) => data[key] ?? 0))
      .value()
  }

  setRemoveRandom(key: string): Promise<string> {
    return this.dataSource?.transaction(async (entityManager) => {
      const repo = entityManager.getRepository(HashSetObject)
      const victim = await this.getQueryBuildByClassWithLiveObject(
        HashSetObject,
      )
        .where({ key })
        .orderBy('RANDOM()')
        .getOne()
      if (victim) {
        await repo.delete(_.pick(victim, ['_key', 'member']))
      }
      return victim?.member
    })
  }

  private getQueryBuildByClassWithLiveObject<T>(
    klass: { new (): T },
    baseAlias = 's',
    liveObjectAlias = 'l',
  ): SelectQueryBuilder<T> | null {
    return this.dataSource
      ?.getRepository(klass)
      .createQueryBuilder(baseAlias)
      .innerJoin(
        DbObjectLive,
        liveObjectAlias,
        `${liveObjectAlias}.key = ${baseAlias}.key`,
      )
  }
}

void (async function main(): Promise<void> {
  console.log('foo')
})()
