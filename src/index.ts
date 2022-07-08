import * as chrono from 'chrono-node'
import { differenceInMilliseconds, differenceInSeconds } from 'date-fns/fp'
import { Store } from 'express-session'
import * as _ from 'lodash'
import * as nconf from 'nconf'
import {
  DataSource,
  DataSourceOptions,
  In,
  Like,
  SelectQueryBuilder,
} from 'typeorm'
import { WinstonAdaptor } from 'typeorm-logger-adaptor/logger/winston'
import * as winston from 'winston'

import {
  HashQueryable,
  HashSetQueryable,
  INodeBBDatabaseBackend,
  ListQueryable,
  ObjectType,
  RedisStyleMatchString,
  StringQueryable,
} from '../types'

import {
  DbObject,
  entities,
  HashObject,
  HashSetObject,
  ListObject,
  StringObject,
  subscribers,
} from './entity'
import { DbObjectLive } from './entity/object'
import { SessionStore } from './session'
import { cartesianProduct, convertRedisStyleMatchToSqlWildCard } from './utils'

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
  implements
    INodeBBDatabaseBackend,
    StringQueryable,
    HashSetQueryable,
    ListQueryable,
    HashQueryable
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
        .thru((data) => key.map((x) => x in data))
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
          key: Like(convertRedisStyleMatchToSqlWildCard(match)[0]),
        })
        .select('s.key')
        .getMany(),
    )
      .map('key')
      .value()
  }

  async delete(key: string): Promise<void> {
    await this.dataSource?.getRepository(DbObject)?.delete({ key })
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
    obj.key = key
    obj.value = value
    await this.dataSource?.getRepository(StringObject)?.save(obj)
  }

  async increment(key: string): Promise<number> {
    const repo = this.dataSource?.getRepository(StringObject)
    const data = await repo?.findOne({ where: { key } })
    if (data) {
      let value = Number.parseInt(data.value)
      if (value != null) {
        value += 1
        data.value = `${value}`
      }
      await repo.update({ key }, data)
      return value
    } else {
      const obj = new StringObject()
      obj.key = key
      obj.value = '1'
      await repo.insert(obj)
      return 1
    }
  }

  async rename(oldkey: string, newkey: string): Promise<void> {
    const repo = this.dataSource?.getRepository(DbObject)
    await repo?.delete({ key: newkey })
    await repo?.update({ key: oldkey }, { key: newkey })
  }

  type(_key: string): Promise<ObjectType> {
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
    const expireAt = (
      await this.dataSource?.getRepository(DbObject).findOne({ where: { key } })
    )?.expireAt
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
  async setAdd(
    key: string | string[],
    member: string | string[],
  ): Promise<void> {
    await this.dataSource
      ?.getRepository(HashSetObject)
      .createQueryBuilder()
      .insert()
      .orIgnore()
      .values(
        cartesianProduct(
          !Array.isArray(key) ? [key] : key,
          !Array.isArray(member) ? [member] : member,
        ).map(([key, member]) => {
          const data = new HashSetObject()
          data.key = key
          data.member = member
          return data
        }),
      )
      .execute()
  }

  async setsAdd(keys: string[], member: string | string[]): Promise<void> {
    return this.setAdd(keys, member)
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
      await this.getQueryBuildByClassWithLiveObject(HashSetObject, {
        baseAlias: 's',
      })
        ?.where({ key, member: In(members) })
        .select('s.member')
        .getMany(),
    )
      .keyBy('member')
      .thru((data) => members.map((member) => member in data))
      .value()
  }

  async isMemberOfSets(sets: string[], member: string): Promise<boolean[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashSetObject, {
        baseAlias: 's',
      })
        ?.where({ key: In(sets), member })
        .select('s.key')
        .getMany(),
    )
      .uniq()
      .keyBy('key')
      .thru((data) => sets.map((set) => set in data))
      .value()
  }

  async getSetMembers(key: string): Promise<string[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashSetObject, {
        baseAlias: 's',
      })
        .where({ key })
        .select('s.member')
        .getMany(),
    )
      .map('member')
      .value()
  }

  setCount(key: string): Promise<number> {
    return this.getQueryBuildByClassWithLiveObject(HashSetObject)
      .where({ key })
      .getCount()
  }

  async getSetsMembers(keys: string[]): Promise<string[][]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashSetObject, {
        baseAlias: 's',
      })
        ?.where({ key: In(keys) })
        .select(['s.key', 's.member'])
        .getMany(),
    )
      .groupBy('key')
      .mapValues((x) => _.map(x, 'member'))
      .thru((data) => keys.map((key) => data[key] ?? []))
      .value()
  }

  async setsCount(keys: string[]): Promise<number[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashSetObject, {
        baseAlias: 's',
        liveObjectAlias: 'l',
      })
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
        await repo.delete(_.pick(victim, ['key', 'member']))
      }
      return victim?.member
    })
  }

  private getQueryBuildByClassWithLiveObject<T>(
    klass: { new (): T },
    {
      baseAlias = 's',
      liveObjectAlias = 'l',
      em = this.dataSource?.manager,
    } = {},
  ): SelectQueryBuilder<T> | null {
    return em
      ?.getRepository(klass)
      .createQueryBuilder(baseAlias)
      .innerJoin(
        DbObjectLive,
        liveObjectAlias,
        `${liveObjectAlias}.key = ${baseAlias}.key`,
      )
  }

  // Implement ListQueryable
  listPrepend(key: string, value: string): Promise<void> {
    return this.dataSource?.transaction('SERIALIZABLE', async (em) => {
      const obj =
        (await em.getRepository(ListObject).findOne({ where: { key } })) ??
        _.thru(new ListObject(), (l) => {
          l.key = key
          return l
        })
      obj.array = [value, ...obj.array]
      await obj.save()
    })
  }

  listAppend(key: string, value: string): Promise<void> {
    return this.dataSource?.transaction('SERIALIZABLE', async (em) => {
      const obj =
        (await em.getRepository(ListObject).findOne({ where: { key } })) ??
        _.thru(new ListObject(), (l) => {
          l.key = key
          return l
        })
      obj.array = [...obj.array, value]
      await obj.save()
    })
  }

  listRemoveLast(key: string): Promise<any> {
    return this.dataSource?.transaction('SERIALIZABLE', async (em) => {
      const obj = await this.getQueryBuildByClassWithLiveObject(ListObject, {
        em,
      })
        .where({ key })
        .getOneOrFail()
      const ret = obj.array.pop()
      await obj.save()
      return ret
    })
  }

  listRemoveAll(key: string, value: string | string[]): Promise<void> {
    return this.dataSource?.transaction('SERIALIZABLE', async (em) => {
      const obj = await this.getQueryBuildByClassWithLiveObject(ListObject, {
        em,
      })
        .where({ key })
        .getOneOrFail()
      obj.array = _.without(obj.array, value)
      await obj.save()
    })
  }

  listTrim(key: string, start: number, stop: number): Promise<void> {
    return this.dataSource?.transaction('SERIALIZABLE', async (em) => {
      const obj = await this.getQueryBuildByClassWithLiveObject(ListObject, {
        em,
      })
        .where({ key })
        .getOneOrFail()
      obj.array.splice(start, stop - start + (stop < 0 ? obj.array.length : 0))
      await obj.save()
    })
  }

  getListRange(key: string, start: number, stop: number): Promise<any[]> {
    return this.dataSource?.transaction('SERIALIZABLE', async (em) =>
      (
        await this.getQueryBuildByClassWithLiveObject(ListObject, {
          em,
        })
          .where({ key })
          .getOneOrFail()
      ).array.slice(start, stop),
    )
  }

  listLength(key: string): Promise<number> {
    return this.dataSource?.transaction(
      'SERIALIZABLE',
      async (em) =>
        (
          await this.getQueryBuildByClassWithLiveObject(ListObject, {
            em,
          })
            .where({ key })
            .getOneOrFail()
        ).array.length,
    )
  }

  // Implement HashQueryable
  decrObjectField(
    key: string | string[],
    field: string,
  ): Promise<number | number[]> {
    return this.incrObjectFieldBy(key, field, -1)
  }

  async deleteObjectField(key: string, field: string): Promise<void> {
    await this.dataSource
      ?.getRepository(HashObject)
      .delete({ hashKey: field, key })
  }

  async deleteObjectFields(key: string, fields: string[]): Promise<void> {
    await this.dataSource
      ?.getRepository(HashObject)
      .delete({ hashKey: In(fields), key })
  }

  async getObject(key: string, fields: string[]): Promise<object> {
    if (fields.length > 0) {
      return this.getObjectFields(key, fields)
    }

    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashObject, {
        baseAlias: 'h',
      })
        .where({ key })
        .select(['h.hashKey', 'h.value'])
        .getMany(),
    )
      .keyBy('hashKey')
      .mapValues('value')
      .value()
  }

  async getObjectField(key: string, field: string): Promise<any> {
    return (
      await this.getQueryBuildByClassWithLiveObject(HashObject, {
        baseAlias: 'h',
      })
        .where({ hashKey: field, key })
        .select('h.value')
        .getOne()
    )?.value
  }

  async getObjectFields(
    key: string,
    fields: string[],
  ): Promise<{ [key: string]: any }> {
    return fields.length == 0
      ? this.getObject(key, fields)
      : _.chain(
          await this.getQueryBuildByClassWithLiveObject(HashObject, {
            baseAlias: 'h',
          })
            .where({ hashKey: In(fields), key })
            .select(['h.hashKey', 'h.value'])
            .getMany(),
        )
          .keyBy('hashKey')
          .mapValues('value')
          .thru((x) =>
            _.chain(fields)
              .map((field) => [field, x[field]])
              .fromPairs()
              .value(),
          )
          .value()
  }

  async getObjectKeys(key: string): Promise<string[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashObject, {
        baseAlias: 'h',
      })
        .where({ key })
        .select(['h.hashKey'])
        .getMany(),
    )
      .map('hashKey')
      .value()
  }

  async getObjectValues(key: string): Promise<any[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashObject, {
        baseAlias: 'h',
      })
        .where({ key })
        .select(['h.value'])
        .getMany(),
    )
      .map('value')
      .value()
  }

  async getObjects(keys: string[], fields: string[] = []): Promise<any[]> {
    if (!Array.isArray(keys) || !keys.length) {
      return []
    }

    if (fields.length) {
      return this.getObjectsFields(keys, fields)
    }

    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashObject, {
        baseAlias: 'h',
      })
        .where({ key: In(keys) })
        .select(['h.key', 'h.hashKey', 'h.value'])
        .getMany(),
    )
      .groupBy('key')
      .mapValues((x) => _.chain(x).keyBy('hashKey').mapValues('value').value())
      .thru((x) => keys.map((key) => x[key] ?? {}))
      .value()
  }

  async getObjectsFields(
    keys: string[],
    fields: string[] = [],
  ): Promise<{ [p: string]: any }[]> {
    if (!Array.isArray(keys) || !keys.length) {
      return []
    }

    if (!Array.isArray(fields) || !fields.length) {
      return this.getObjects(keys)
    }

    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashObject, {
        baseAlias: 'h',
      })
        .where({ hashKey: In(fields), key: In(keys) })
        .select(['h.key', 'h.hashKey', 'h.value'])
        .getMany(),
    )
      .groupBy('key')
      .mapValues((x) => _.chain(x).keyBy('hashKey').mapValues('value').value())
      .thru((x) => keys.map((key) => x[key]))
      .value()
  }

  incrObjectField(
    key: string | string[],
    field: string,
  ): Promise<number | number[]> {
    return this.incrObjectFieldBy(key, field, 1)
  }

  async incrObjectFieldHelper(
    repo: Repository<HashObject>,
    key: string,
    hashKey: string,
    incrValue: number,
  ): Promise<HashObject> {
    const data =
      (await repo.findOne({
        where: {
          hashKey,
          key,
        },
      })) ??
      _.thru(new HashObject(), (x) => {
        x.key = key
        x.hashKey = hashKey
        x.value = 0
        return x
      })
    if (Number.isFinite(data.value)) {
      data.value += incrValue
    }
    return data
  }

  incrObjectFieldBy(
    key: string | string[],
    field: string,
    value: number,
  ): Promise<number | number[]> {
    return this.dataSource?.transaction(async (em) => {
      const repo = em.getRepository(HashObject)

      if (Array.isArray(key)) {
        return _.chain(
          await repo.save(
            await Promise.all(
              key.map((k) => this.incrObjectFieldHelper(repo, k, field, value)),
            ),
          ),
        )
          .keyBy('key')
          .thru((x) => key.map((k) => x[k]?.value ?? -1))
          .value()
      } else {
        return (
          (
            await repo.save(
              await this.incrObjectFieldHelper(repo, key, field, value),
            )
          )?.value ?? -1
        )
      }
    })
  }

  incrObjectFieldByBulk(
    data: [key: string | string[], batch: [field: string, value: number][]][],
  ): Promise<void> {
    return this.dataSource?.transaction(async (em) => {
      const repo = em.getRepository(HashObject)
      const values = data
        .map(
          ([key, kv]) =>
            cartesianProduct(
              Array.isArray(key) ? key : [key],
              kv as any,
            ) as any[],
        )
        .map(([key, [field, value]]) =>
          this.incrObjectFieldHelper(repo, key, field, value),
        )
      await repo.save(await Promise.all(values))
    })
  }

  async isObjectField(key: string, field: string): Promise<boolean> {
    return (
      (await this.getQueryBuildByClassWithLiveObject(HashObject)
        .where({ hashKey: field, key })
        .getCount()) > 0
    )
  }

  async isObjectFields(key: string, fields: string[]): Promise<boolean[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashObject, {
        baseAlias: 'h',
      })
        .where({ hashKey: In(fields), key })
        .select('h.hashKey')
        .getMany(),
    )
      .keyBy('hashKey')
      .thru((x) => fields.map((field) => field in x))
      .value()
  }

  async setObject(
    key: string | string[],
    data: { [p: string]: any },
  ): Promise<void> {
    // eslint-disable-next-line no-prototype-builtins
    if (data.hasOwnProperty('')) {
      delete data['']
    }
    if (!Object.keys(data).length) {
      return
    }

    await this.dataSource
      ?.getRepository(HashObject)
      .createQueryBuilder()
      .insert()
      .orUpdate(['value'], ['_key', 'hashKey'])
      .values(
        cartesianProduct(
          !Array.isArray(key) ? [key] : key,
          Object.entries(data) as any[],
        ).map(([key, [hashKey, value]]) => {
          const x = new HashObject()
          x.key = key
          x.hashKey = hashKey
          x.value = value
          return x
        }),
      )
      .execute()
  }

  async setObjectBulk(
    args: [key: string | string[], data: { [key: string]: any }][],
  ): Promise<void> {
    await this.dataSource
      ?.getRepository(HashObject)
      .createQueryBuilder()
      .insert()
      .orUpdate(['value'], ['_key', 'hashKey'])
      .values(
        args.flatMap(([key, data]) => {
          // eslint-disable-next-line no-prototype-builtins
          if (data.hasOwnProperty('')) {
            delete data['']
          }

          return cartesianProduct(
            Array.isArray(key) ? key : [key],
            Object.entries(data) as any[],
          ).map(([key, [hashKey, value]]) => {
            const x = new HashObject()
            x.key = key
            x.hashKey = hashKey
            x.value = value
            return x
          })
        }),
      )
      .execute()
  }

  setObjectField(
    key: string | string[],
    field: string,
    value: any,
  ): Promise<void> {
    return this.setObject(key, { [field]: value })
  }
}

void (async function main(): Promise<void> {
  nconf.defaults({
    typeorm: {
      database: './store.db',
      type: 'sqlite',
    },
  })

  const db = new TypeORMDatabaseBackend()
  await db.init()
  await db.flushdb()
  logger.info(`set: ${await db.set('test', '3456')}`)
  logger.info(`exists: ${await db.exists('test')}`)
  logger.info(`get: ${await db.get('test')}`)
  logger.info(`scan: ${await db.scan({ match: 'test' })}`)
  logger.info(`delete: ${await db.delete('test')}`)
  logger.info(`increment: ${await db.increment('test')}`)
  logger.info(`rename: ${await db.rename('test', 'test1')}`)
  logger.info(`exists: ${await db.exists('test')}`)
  logger.info(`setAdd: ${await db.setAdd('test', '1234')}`)
  logger.info(`setAdd: ${await db.setAdd('test', ['5678', 'abcd'])}`)
  logger.info(`exists: ${await db.exists(['test', 'test1'])}`)
  logger.info(`setCount: ${await db.setCount('test')}`)
  logger.info(`getSetMembers: ${await db.getSetMembers('test')}`)
  logger.info(`isSetMembers: ${await db.isSetMember('test', '1234')}`)
})()
