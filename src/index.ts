import * as chrono from 'chrono-node'
import { differenceInMilliseconds, differenceInSeconds } from 'date-fns/fp'
import { Store } from 'express-session'
import * as _ from 'lodash'
import * as nconf from 'nconf'
import {
  DataSource,
  DataSourceOptions,
  In,
  LessThanOrEqual,
  Like,
  MoreThanOrEqual,
  Repository,
  SelectQueryBuilder,
} from 'typeorm'
import * as winston from 'winston'

import {
  HashQueryable,
  HashSetQueryable,
  INodeBBDatabaseBackend,
  ListQueryable,
  ObjectType,
  RedisStyleMatchString,
  RedisStyleRangeString,
  SortedSetQueryable,
  StringQueryable,
} from '../types'

import {
  DbObject,
  entities,
  HashObject,
  HashSetObject,
  ListObject,
  SortedSetObject,
  StringObject,
  subscribers,
} from './entity'
import { DbObjectLive } from './entity/object'
import { SessionStore } from './session'
import {
  cartesianProduct,
  convertRedisStyleMatchToSqlWildCard,
  fixRange,
  mapper,
  notOrder,
} from './utils'

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

type getSortedSetRangeInnerParams = {
  id: string | string[]
  sort: 'ASC' | 'DESC'
  start: number
} & (
  | {
      byRange: { stop: number }
    }
  | {
      byScore: {
        min: number | '-inf'
        max: number | '+inf'
        count: number
      }
    }
)

export class TypeORMDatabaseBackend
  implements
    INodeBBDatabaseBackend,
    StringQueryable,
    HashSetQueryable,
    ListQueryable,
    HashQueryable,
    SortedSetQueryable
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

  async init(args?: DataSourceOptions): Promise<void> {
    const conf = TypeORMDatabaseBackend.getConnectionOptions(args)
    try {
      this.#dataSource = await new DataSource({
        ...conf,
        entities,
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
  async exists(id: string | string[]): Promise<boolean | boolean[]> {
    const repo = this.dataSource?.getRepository(DbObjectLive)
    if (Array.isArray(id)) {
      return _.chain(
        await repo
          ?.createQueryBuilder('o')
          .where({ id: In(id) })
          .select('o.id')
          .getMany(),
      )
        .keyBy('id')
        .thru((data) => id.map((x) => x in data))
        .value()
    } else if (typeof id === 'string') {
      return ((await repo?.countBy({ id })) ?? 0) > 0
    }
    throw new Error('unexpected type')
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
          id: Like(convertRedisStyleMatchToSqlWildCard(match)[0]),
        })
        .select('s.id')
        .getMany(),
    )
      .map('id')
      .value()
  }

  async delete(id: string): Promise<void> {
    await this.dataSource?.getRepository(DbObject)?.delete({ id })
  }

  async deleteAll(ids: string[]): Promise<void> {
    await this.dataSource?.getRepository(DbObject)?.delete({ id: In(ids) })
  }

  async get(id: string): Promise<string | null> {
    return (
      await this.getQueryBuildByClassWithLiveObject(StringObject)
        .where({ id })
        .getOne()
    )?.value
  }

  async set(id: string, value: string): Promise<void> {
    const obj = new StringObject()
    obj.id = id
    obj.value = value
    await this.dataSource?.getRepository(StringObject)?.save(obj)
  }

  async increment(id: string): Promise<number> {
    const repo = this.dataSource?.getRepository(StringObject)
    const data = await repo?.findOne({ where: { id } })
    if (data) {
      let value = Number.parseInt(data.value)
      if (value != null) {
        value += 1
        data.value = `${value}`
      }
      await repo.update({ id }, data)
      return value
    } else {
      const obj = new StringObject()
      obj.id = id
      obj.value = '1'
      await repo.insert(obj)
      return 1
    }
  }

  async rename(oldId: string, newId: string): Promise<void> {
    const repo = this.dataSource?.getRepository(DbObject)
    await repo?.delete({ id: newId })
    await repo?.update({ id: oldId }, { id: newId })
  }

  type(id: string): Promise<ObjectType> {
    throw new Error('Method not implemented.')
  }

  async expireInner(id: string, expireAt: Date): Promise<void> {
    await this.dataSource?.getRepository(DbObject)?.update({ id }, { expireAt })
  }

  async ttlInner(
    id: string,
    comparator: (a: Date, b: Date) => number,
  ): Promise<number> {
    const expireAt = (
      await this.dataSource?.getRepository(DbObject).findOne({ where: { id } })
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
        ).map(([id, member]) => {
          const data = new HashSetObject()
          data.id = id
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
    id: string | string[],
    member: string | string[],
  ): Promise<void> {
    await this.dataSource?.getRepository(HashSetObject)?.delete({
      id: Array.isArray(id) ? In(id) : id,
      member: Array.isArray(member) ? In(member) : member,
    })
  }

  setsRemove(keys: string[], value: string): Promise<void> {
    return this.setRemove(keys, value)
  }

  async isSetMember(id: string, member: string): Promise<boolean> {
    return (
      ((await this.getQueryBuildByClassWithLiveObject(HashSetObject)
        ?.where({ id, member })
        .getCount()) ?? 0) > 0
    )
  }

  async isSetMembers(id: string, members: string[]): Promise<boolean[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashSetObject, {
        baseAlias: 's',
      })
        ?.where({ id, member: In(members) })
        .select('s.member')
        .getMany(),
    )
      .keyBy('member')
      .thru((data) => members.map((member) => member in data))
      .value()
  }

  async isMemberOfSets(ids: string[], member: string): Promise<boolean[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashSetObject, {
        baseAlias: 's',
      })
        ?.where({ id: In(ids), member })
        .select('s.id')
        .getMany(),
    )
      .keyBy('id')
      .thru((data) => ids.map((set) => set in data))
      .value()
  }

  async getSetMembers(id: string): Promise<string[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashSetObject, {
        baseAlias: 's',
      })
        .where({ id })
        .select('s.member')
        .getMany(),
    )
      .map('member')
      .value()
  }

  setCount(id: string): Promise<number> {
    return this.getQueryBuildByClassWithLiveObject(HashSetObject)
      .where({ id })
      .getCount()
  }

  async getSetsMembers(ids: string[]): Promise<string[][]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashSetObject, {
        baseAlias: 's',
      })
        ?.where({ id: In(ids) })
        .select(['s.id', 's.member'])
        .getMany(),
    )
      .groupBy('id')
      .mapValues((x) => _.map(x, 'member'))
      .thru((data) => ids.map((key) => data[key] ?? []))
      .value()
  }

  async setsCount(ids: string[]): Promise<number[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashSetObject, {
        baseAlias: 's',
        liveObjectAlias: 'l',
      })
        .where({ id: In(ids) })
        .groupBy('l.id')
        .select('s.id')
        .addSelect('COUNT(*)', 'count')
        .getRawMany<{ id: string; count: number }>(),
    )
      .keyBy('id')
      .mapValues('count')
      .thru((data) => ids.map((key) => data[key] ?? 0))
      .value()
  }

  setRemoveRandom(id: string): Promise<string> {
    return this.dataSource?.transaction(async (em) => {
      const victim = await this.getQueryBuildByClassWithLiveObject(
        HashSetObject,
      )
        .where({ id })
        .orderBy('RANDOM()')
        .getOne()
      if (victim) {
        await em
          .getRepository(HashSetObject)
          .delete(_.pick(victim, ['id', 'member']))
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
        `${liveObjectAlias}.id = ${baseAlias}.id`,
      )
  }

  // Implement ListQueryable
  listPrepend(id: string, value: string): Promise<void> {
    return this.dataSource?.transaction('SERIALIZABLE', async (em) => {
      const obj =
        (await em.getRepository(ListObject).findOne({ where: { id } })) ??
        _.thru(new ListObject(), (l) => {
          l.id = id
          return l
        })
      obj.array = [value, ...obj.array]
      await obj.save()
    })
  }

  listAppend(id: string, value: string): Promise<void> {
    return this.dataSource?.transaction('SERIALIZABLE', async (em) => {
      const obj =
        (await em.getRepository(ListObject).findOne({ where: { id } })) ??
        _.thru(new ListObject(), (l) => {
          l.id = id
          return l
        })
      obj.array = [...obj.array, value]
      await obj.save()
    })
  }

  listRemoveLast(id: string): Promise<any> {
    return this.dataSource?.transaction('SERIALIZABLE', async (em) => {
      const obj = await this.getQueryBuildByClassWithLiveObject(ListObject, {
        em,
      })
        .where({ id })
        .getOneOrFail()
      const ret = obj.array.pop()
      await obj.save()
      return ret
    })
  }

  listRemoveAll(id: string, value: string | string[]): Promise<void> {
    return this.dataSource?.transaction('SERIALIZABLE', async (em) => {
      const obj = await this.getQueryBuildByClassWithLiveObject(ListObject, {
        em,
      })
        .where({ id })
        .getOneOrFail()
      obj.array = _.without(obj.array, value)
      await obj.save()
    })
  }

  listTrim(id: string, start: number, stop: number): Promise<void> {
    return this.dataSource?.transaction('SERIALIZABLE', async (em) => {
      const obj = await this.getQueryBuildByClassWithLiveObject(ListObject, {
        em,
      })
        .where({ id })
        .getOneOrFail()
      obj.array.splice(start, stop - start + (stop < 0 ? obj.array.length : 0))
      await obj.save()
    })
  }

  getListRange(id: string, start: number, stop: number): Promise<any[]> {
    return this.dataSource?.transaction('SERIALIZABLE', async (em) => {
      return (
        await this.getQueryBuildByClassWithLiveObject(ListObject, {
          em,
        })
          .where({ id })
          .getOneOrFail()
      ).array.slice(start, stop)
    })
  }

  listLength(id: string): Promise<number> {
    return this.dataSource?.transaction(
      'SERIALIZABLE',
      async (em) =>
        (
          await this.getQueryBuildByClassWithLiveObject(ListObject, {
            em,
          })
            .where({ id })
            .getOneOrFail()
        ).array.length,
    )
  }

  // Implement HashQueryable
  decrObjectField(
    id: string | string[],
    key: string,
  ): Promise<number | number[]> {
    return this.incrObjectFieldBy(id, key, -1)
  }

  async deleteObjectField(id: string, key: string): Promise<void> {
    await this.dataSource?.getRepository(HashObject).delete({ id, key })
  }

  async deleteObjectFields(id: string, keys: string[]): Promise<void> {
    await this.dataSource
      ?.getRepository(HashObject)
      .delete({ id, key: In(keys) })
  }

  async getObject(id: string, keys: string[]): Promise<object> {
    if (keys.length > 0) {
      return this.getObjectFields(id, keys)
    }

    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashObject, {
        baseAlias: 'h',
      })
        .where({ id })
        .select(['h.key', 'h.value'])
        .getMany(),
    )
      .keyBy('key')
      .mapValues('value')
      .value()
  }

  async getObjectField(id: string, key: string): Promise<any> {
    return (
      await this.getQueryBuildByClassWithLiveObject(HashObject, {
        baseAlias: 'h',
      })
        .where({ id, key })
        .select('h.value')
        .getOne()
    )?.value
  }

  async getObjectFields(
    id: string,
    keys: string[],
  ): Promise<{ [key: string]: any }> {
    return keys.length == 0
      ? this.getObject(id, keys)
      : _.chain(
          await this.getQueryBuildByClassWithLiveObject(HashObject, {
            baseAlias: 'h',
          })
            .where({ id, key: In(keys) })
            .select(['h.key', 'h.value'])
            .getMany(),
        )
          .keyBy('key')
          .mapValues('value')
          .thru((x) =>
            _.chain(keys)
              .map((key) => [key, x[key] ?? null])
              .fromPairs()
              .value(),
          )
          .value()
  }

  async getObjectKeys(id: string): Promise<string[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashObject, {
        baseAlias: 'h',
      })
        .where({ id })
        .select(['h.key'])
        .getMany(),
    )
      .map('key')
      .value()
  }

  async getObjectValues(id: string): Promise<any[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashObject, {
        baseAlias: 'h',
      })
        .where({ id })
        .select(['h.value'])
        .getMany(),
    )
      .map('value')
      .value()
  }

  async getObjects(ids: string[], keys: string[] = []): Promise<any[]> {
    if (!Array.isArray(ids) || !ids.length) {
      return []
    }

    if (keys.length) {
      return this.getObjectsFields(ids, keys)
    }

    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashObject, {
        baseAlias: 'h',
      })
        .where({ id: In(ids) })
        .select(['h.id', 'h.key', 'h.value'])
        .getMany(),
    )
      .groupBy('id')
      .mapValues((x) => _.chain(x).keyBy('key').mapValues('value').value())
      .thru((x) => ids.map((key) => x[key] ?? {}))
      .value()
  }

  async getObjectsFields(
    ids: string[],
    keys: string[] = [],
  ): Promise<{ [p: string]: any }[]> {
    if (!Array.isArray(ids) || !ids.length) {
      return []
    }

    if (!Array.isArray(keys) || !keys.length) {
      return this.getObjects(ids)
    }

    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashObject, {
        baseAlias: 'h',
      })
        .where({ id: In(ids), key: In(keys) })
        .select(['h.id', 'h.key', 'h.value'])
        .getMany(),
    )
      .groupBy('id')
      .mapValues((x) => _.chain(x).keyBy('key').mapValues('value').value())
      .thru((x) => ids.map((key) => x[key]))
      .value()
  }

  incrObjectField(
    idOrIds: string | string[],
    key: string,
  ): Promise<number | number[]> {
    return this.incrObjectFieldBy(idOrIds, key, 1)
  }

  async incrObjectFieldHelper(
    repo: Repository<HashObject>,
    id: string,
    key: string,
    incrValue: number,
  ): Promise<HashObject> {
    const data =
      (await repo.findOne({
        where: {
          id,
          key,
        },
      })) ??
      _.thru(new HashObject(), (x) => {
        x.id = id
        x.key = key
        x.value = 0
        return x
      })
    if (Number.isFinite(data.value)) {
      data.value += incrValue
    }
    return data
  }

  incrObjectFieldBy(
    idOrIds: string | string[],
    key: string,
    value: number,
  ): Promise<number | number[]> {
    return this.dataSource?.transaction(async (em) => {
      const repo = em.getRepository(HashObject)

      if (Array.isArray(idOrIds)) {
        return _.chain(
          await repo.save(
            await Promise.all(
              idOrIds.map((id) =>
                this.incrObjectFieldHelper(repo, id, key, value),
              ),
            ),
          ),
        )
          .keyBy('id')
          .thru((x) => idOrIds.map((k) => x[k]?.value ?? -1))
          .value()
      } else {
        return (
          (
            await repo.save(
              await this.incrObjectFieldHelper(repo, idOrIds, key, value),
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

  async isObjectField(id: string, key: string): Promise<boolean> {
    return (
      (await this.getQueryBuildByClassWithLiveObject(HashObject)
        .where({ id, key })
        .getCount()) > 0
    )
  }

  async isObjectFields(id: string, keys: string[]): Promise<boolean[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(HashObject, {
        baseAlias: 'h',
      })
        .where({ id, key: In(keys) })
        .select('h.key')
        .getMany(),
    )
      .keyBy('key')
      .thru((x) => keys.map((key) => key in x))
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
      .orUpdate(['value'], ['id', 'key'])
      .values(
        cartesianProduct(
          !Array.isArray(key) ? [key] : key,
          Object.entries(data) as any[],
        ).map(([id, [key, value]]) => {
          const x = new HashObject()
          x.id = id
          x.key = key
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
      .orUpdate(['value'], ['id', 'key'])
      .values(
        args.flatMap(([key, data]) => {
          // eslint-disable-next-line no-prototype-builtins
          if (data.hasOwnProperty('')) {
            delete data['']
          }

          return cartesianProduct(
            Array.isArray(key) ? key : [key],
            Object.entries(data) as any[],
          ).map(([id, [key, value]]) => {
            const x = new HashObject()
            x.id = id
            x.key = key
            x.value = value
            return x
          })
        }),
      )
      .execute()
  }

  setObjectField(
    id: string | string[],
    key: string,
    value: any,
  ): Promise<void> {
    return this.setObject(id, { [key]: value })
  }

  // Implement SortedSetQueryable
  getSortedSetIntersect(params: {
    sets: string[]
    start?: number
    stop?: number
    weights?: number[]
    withScores?: boolean
    aggregate?: 'SUM' | 'MIN' | 'MAX'
  }): Promise<string[] | { value: string; score: number }[]> {
    throw new Error('Method not implemented.')
  }

  getSortedSetMembers(key: string): Promise<string> {
    throw new Error('Method not implemented.')
  }

  async getSortedSetRangeInner(
    args: getSortedSetRangeInnerParams & { withScores: true },
  ): Promise<ValueAndScore[]>
  async getSortedSetRangeInner(
    args: getSortedSetRangeInnerParams & { withScores: false },
  ): Promise<string[]>
  async getSortedSetRangeInner({
    id,
    sort,
    start,
    withScores = false,
    ...rest
  }: getSortedSetRangeInnerParams & { withScores?: boolean }): Promise<
    string[] | ValueAndScore[]
  > {
    let offset: number
    let relationReversed = false
    let limit: number
    if ('byRange' in rest) {
      ;({ offset, relationReversed, limit } = fixRange(
        start,
        rest.byRange.stop,
      ))
    } else if ('byScore' in rest) {
      ;[offset, limit] = [start, rest.byScore.count]
    }

    let qb = this.getQueryBuildByClassWithLiveObject(SortedSetObject, {
      baseAlias: 'z',
    })
      .where({
        id: Array.isArray(id) ? In(id) : id,
      })
      .addOrderBy('z.score', relationReversed ? notOrder(sort) : sort)
      .offset(offset)

    if ('byScore' in rest) {
      const { min, max } = rest.byScore
      if (Number.isFinite(min) && min !== '-inf') {
        qb = qb.andWhere({ score: MoreThanOrEqual(min) })
      }
      if (Number.isFinite(max) && max !== '+inf') {
        qb = qb.andWhere({ score: LessThanOrEqual(max) })
      }
    }

    if (limit) {
      qb = qb.limit(limit)
    }

    if (relationReversed) {
      qb = this.dataSource
        .createQueryBuilder()
        .addCommonTableExpression(qb, 'base')
        .from('base', 'base')
        .addOrderBy('base.score', sort) as SelectQueryBuilder<SortedSetObject>
    }

    const ret = (await qb.getRawMany<{ member: string; score: number }>()).map(
      ({ member, score }) => (withScores ? { score, value: member } : member),
    )
    return withScores ? (ret as ValueAndScore[]) : (ret as string[])
  }

  getSortedSetRange(
    id: string | string[],
    start: number,
    stop: number,
  ): Promise<string[]> {
    return this.getSortedSetRangeInner({
      byRange: { stop },
      id,
      sort: 'ASC',
      start,
      withScores: false,
    })
  }

  getSortedSetRangeByLex(
    key: string,
    min: `(${number}` | `[${number}`,
    max: `(${number}` | `[${number}`,
    start: number,
    count: number,
  ): Promise<string[]> {
    throw new Error('Method not implemented.')
  }

  getSortedSetRangeByScore(
    key: string,
    start: number,
    count: number,
    min: string,
    max: number,
  ): Promise<string[]> {
    throw new Error('Method not implemented.')
  }

  getSortedSetRangeByScoreWithScores(
    id: string,
    start: number,
    count: number,
    min: number | '-inf',
    max: number | '+inf',
  ): Promise<ValueAndScore[]> {
    return this.getSortedSetRangeInner({
      byScore: { count, max, min },
      id,
      sort: 'ASC',
      start,
      withScores: true,
    })
  }

  getSortedSetRangeWithScores(
    id: string,
    start: number,
    stop: number,
  ): Promise<ValueAndScore[]> {
    return this.getSortedSetRangeInner({
      byRange: { stop },
      id,
      sort: 'ASC',
      start,
      withScores: true,
    })
  }

  getSortedSetRevIntersect(params: {
    sets: string[]
    start?: number
    stop?: number
    weights?: number[]
    withScores?: boolean
    aggregate?: 'SUM' | 'MIN' | 'MAX'
  }): Promise<string[] | { value: string; score: number }[]> {
    throw new Error('Method not implemented.')
  }

  getSortedSetRevRange(
    id: string | string[],
    start: number,
    stop: number,
  ): Promise<string[]> {
    return this.getSortedSetRangeInner({
      byRange: { stop },
      id,
      sort: 'DESC',
      start,
      withScores: false,
    })
  }

  getSortedSetRevRangeByLex(
    key: string,
    max: `(${number}` | `[${number}`,
    min: `(${number}` | `[${number}`,
    start: number,
    count: number,
  ): Promise<string[]> {
    throw new Error('Method not implemented.')
  }

  getSortedSetRevRangeByScore(
    id: string,
    start: number,
    count: number,
    max: number | '+inf',
    min: number | '-inf',
  ): Promise<string[]> {
    return this.getSortedSetRangeInner({
      byScore: { count, max, min },
      id,
      sort: 'DESC',
      start,
      withScores: false,
    })
  }

  getSortedSetRevRangeByScoreWithScores(
    id: string,
    start: number,
    count: number,
    max: number | '+inf',
    min: number | '-inf',
  ): Promise<ValueAndScore[]> {
    return this.getSortedSetRangeInner({
      byScore: { count, max, min },
      id,
      sort: 'DESC',
      start,
      withScores: true,
    })
  }

  getSortedSetRevRangeWithScores(
    id: string,
    start: number,
    stop: number,
  ): Promise<ValueAndScore[]> {
    return this.getSortedSetRangeInner({
      byRange: { stop },
      id,
      sort: 'DESC',
      start,
      withScores: true,
    })
  }

  getSortedSetRevUnion(params: {
    sets: string[]
    start?: number
    stop?: number
    weights?: number[]
    withScores?: boolean
    aggregate?: 'SUM' | 'MIN' | 'MAX'
  }): Promise<string[] | { value: string; score: number }[]> {
    throw new Error('Method not implemented.')
  }

  getSortedSetScan(params: {
    key: string
    match: string
    limit: number
    withScores?: boolean
  }): Promise<string[] | { value: string; score: number }[]> {
    throw new Error('Method not implemented.')
  }

  getSortedSetUnion(params: {
    sets: string[]
    start?: number
    stop?: number
    weights?: number[]
    withScores?: boolean
    aggregate?: 'SUM' | 'MIN' | 'MAX'
  }): Promise<string[] | { value: string; score: number }[]> {
    throw new Error('Method not implemented.')
  }

  getSortedSetsMembers(keys: string[]): Promise<string[]> {
    throw new Error('Method not implemented.')
  }

  isMemberOfSortedSets(keys: string[], value: string): Promise<boolean[]> {
    throw new Error('Method not implemented.')
  }

  isSortedSetMember(key: string, value: string): Promise<boolean> {
    throw new Error('Method not implemented.')
  }

  isSortedSetMembers(key: string, values: string[]): Promise<boolean[]> {
    throw new Error('Method not implemented.')
  }

  processSortedSet(
    setKey: string,
    processFn: (ids: number[]) => void | Promise<void>,
    options: { withScores?: boolean; batch?: number; interval?: number },
  ): Promise<any> {
    throw new Error('Method not implemented.')
  }

  sortedSetAdd(
    key: string,
    score: number | number[],
    value: string,
  ): Promise<void> {
    throw new Error('Method not implemented.')
  }

  sortedSetAddBulk(
    data: [key: string, score: number, value: string][],
  ): Promise<void> {
    throw new Error('Method not implemented.')
  }

  sortedSetCard(key: string): Promise<number> {
    throw new Error('Method not implemented.')
  }

  sortedSetCount(key: string, min: string, max: number): Promise<number> {
    throw new Error('Method not implemented.')
  }

  sortedSetIncrBy(
    key: string,
    increment: number,
    value: string,
  ): Promise<number> {
    throw new Error('Method not implemented.')
  }

  sortedSetIncrByBulk(
    data: [key: string, increment: number, value: string][],
  ): Promise<number[]> {
    throw new Error('Method not implemented.')
  }

  sortedSetIntersectCard(keys: string[]): Promise<number> {
    throw new Error('Method not implemented.')
  }

  sortedSetLexCount(
    key: string,
    min: `(${number}` | `[${number}`,
    max: `(${number}` | `[${number}`,
  ): Promise<number> {
    throw new Error('Method not implemented.')
  }

  sortedSetRank(key: string, value: string): Promise<number> {
    throw new Error('Method not implemented.')
  }

  sortedSetRanks(key: string, values: string[]): Promise<number[]> {
    throw new Error('Method not implemented.')
  }

  sortedSetRemove(key: string, value: string): Promise<void> {
    throw new Error('Method not implemented.')
  }

  sortedSetRemoveBulk(data: [key: string, member: string][]): Promise<void> {
    throw new Error('Method not implemented.')
  }

  sortedSetRemoveRangeByLex(
    key: string,
    min: `(${number}` | `[${number}`,
    max: `(${number}` | `[${number}`,
  ): Promise<void> {
    throw new Error('Method not implemented.')
  }

  sortedSetRevRank(key: string, value: string): Promise<number> {
    throw new Error('Method not implemented.')
  }

  sortedSetRevRanks(key: string, values: string[]): Promise<number[]> {
    throw new Error('Method not implemented.')
  }

  sortedSetScore(key: string, value: string): Promise<number> {
    throw new Error('Method not implemented.')
  }

  sortedSetScores(key: string, values: string[]): Promise<number[]> {
    throw new Error('Method not implemented.')
  }

  sortedSetUnionCard(keys: string[]): Promise<number> {
    throw new Error('Method not implemented.')
  }

  sortedSetsAdd(
    keys: string[],
    scores: number[],
    value: string,
  ): Promise<void> {
    throw new Error('Method not implemented.')
  }

  sortedSetsCard(keys: string[]): Promise<number[]> {
    throw new Error('Method not implemented.')
  }

  sortedSetsCardSum(keys: string[]): Promise<number> {
    throw new Error('Method not implemented.')
  }

  sortedSetsRanks(keys: string[], values: string[]): Promise<number[]> {
    throw new Error('Method not implemented.')
  }

  sortedSetsRemove(keys: string[], value: string): Promise<void> {
    throw new Error('Method not implemented.')
  }

  sortedSetsRemoveRangeByScore(
    keys: string[],
    min: number | '-inf',
    max: number | '+inf',
  ): Promise<void> {
    throw new Error('Method not implemented.')
  }

  sortedSetsRevRanks(keys: string[], values: string[]): Promise<number[]> {
    throw new Error('Method not implemented.')
  }

  sortedSetsScore(keys: string[], value: string): Promise<number[]> {
    throw new Error('Method not implemented.')
  }
}
