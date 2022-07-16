import * as chrono from 'chrono-node'
import { differenceInMilliseconds, differenceInSeconds } from 'date-fns/fp'
import { Store } from 'express-session'
import * as _ from 'lodash'
import {
  DataSource,
  DataSourceOptions,
  EntityManager,
  In,
  LessThanOrEqual,
  Like,
  MoreThanOrEqual,
  Repository,
  SelectQueryBuilder,
} from 'typeorm'

import {
  FileBasedDatabaseConnectionOptions,
  HashQueryable,
  HashSetQueryable,
  INodeBBDatabaseBackend,
  ListQueryable,
  Mutable,
  NumberTowardsMaxima,
  NumberTowardsMinima,
  ObjectType,
  RedisStyleMatchString,
  RedisStyleRangeString,
  RemoteBasedDatabaseConnectionOptions,
  SortedSetQueryable,
  SortedSetScanBaseParameters,
  SortedSetTheoryOperation,
  SqliteFamilyDatabaseConnectionOptions,
  StringQueryable,
  SupportedDatabaseConnectionOptions,
  ValueAndScore,
} from '../types'

import {
  databasePersonality,
  PopularDatabaseType,
  resolveDatabaseType,
  resolveDatabaseTypeByDriver,
} from './database_personality'
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
} from './utils'

import type { Provider } from 'nconf'
import type { Logger } from 'winston'

const nconf: Provider = require.main.require('nconf')
const winston: Logger = require.main.require('winston')

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
        min: NumberTowardsMinima
        max: NumberTowardsMaxima
        count: number
      }
    }
  | {
      byLex: {
        min?: RedisStyleRangeString | '-'
        max?: RedisStyleRangeString | '+'
        count?: number
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

  get databaseType(): PopularDatabaseType | null {
    return resolveDatabaseTypeByDriver(
      this.dataSource?.manager.connection.driver,
    )
  }

  static getConnectionOptions(
    options: SupportedDatabaseConnectionOptions = nconf.get('typeorm'),
  ): DataSourceOptions {
    if (!options.type) {
      throw new Error('[[error:no-database-type-specified]]')
    }
    const knownDatabaseType = resolveDatabaseType(options.type)

    if (knownDatabaseType === PopularDatabaseType.Sqlite) {
      const typeorm = options as Mutable<FileBasedDatabaseConnectionOptions>

      if (!typeorm.database) {
        winston.warn('You have no database file, using "./nodebb.db"')
        typeorm.database = './nodebb.db'
      }

      const connOptions = {
        database: typeorm.database,
        type: typeorm.type,
      }

      return _.merge(
        connOptions,
        ((typeorm as any).options ??
          {}) as SqliteFamilyDatabaseConnectionOptions,
      )
    } else {
      const typeorm = options as Mutable<RemoteBasedDatabaseConnectionOptions>

      const sensibleDefaultByType =
        databasePersonality[knownDatabaseType]?.sensibleDefault
      if ('host' in typeorm && !typeorm.host) {
        typeorm.host = '127.0.0.1'
      }
      if ('port' in typeorm && !typeorm.port) {
        typeorm.port = sensibleDefaultByType?.port
      }
      if ('username' in typeorm && !typeorm.username) {
        typeorm.username = sensibleDefaultByType?.username
      }
      if ('database' in typeorm && !typeorm.database) {
        winston.warn('You have no database name, using "nodebb"')
        typeorm.database = 'nodebb'
      }
      const connOptions = {
        database: typeorm.database,
        host: typeorm.host,
        password: typeorm.password,
        port: typeorm.port,
        ssl:
          knownDatabaseType !== PopularDatabaseType.Oracle
            ? (typeorm as any).ssl
            : {},
        type: typeorm.type,
        username: typeorm.username,
      }

      return _.merge(
        connOptions,
        ((typeorm as any).options ??
          {}) as RemoteBasedDatabaseConnectionOptions,
      )
    }
  }

  async init(args?: SupportedDatabaseConnectionOptions): Promise<void> {
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
  async exists(id: string): Promise<boolean>
  async exists(ids: string[]): Promise<boolean[]>
  async exists(idOrIds: string | string[]): Promise<boolean | boolean[]> {
    const repo = this.dataSource?.getRepository(DbObjectLive)

    const ifSortedSetHasMembers = async (id: string): Promise<boolean> =>
      (await this.type(id)) !== ObjectType.SORTED_SET ||
      (await this.getQueryBuildByClassWithLiveObject(SortedSetObject)
        .where({ id })
        .getCount()) > 0

    if (Array.isArray(idOrIds)) {
      return Promise.all(
        _.chain(
          await repo
            ?.createQueryBuilder()
            .where({ id: In(idOrIds) })
            .select('id')
            .getRawMany<Pick<DbObjectLive, 'id'>>(),
        )
          .keyBy('id')
          .thru(
            mapper(
              async (data, id) => id in data && ifSortedSetHasMembers(id),
              idOrIds,
            ),
          )
          .value(),
      )
    } else if (typeof idOrIds === 'string') {
      return (
        ((await repo?.countBy({ id: idOrIds })) ?? 0) > 0 &&
        ifSortedSetHasMembers(idOrIds)
      )
    }
    throw new Error('unexpected type')
  }

  async emptydb(): Promise<void> {
    await this.dataSource?.getRepository(DbObject).delete({})
  }

  async scan({ match }: { match: RedisStyleMatchString }): Promise<string[]> {
    return _.map(
      await this.dataSource
        ?.getRepository(DbObjectLive)
        ?.createQueryBuilder()
        .where({
          id: Like(convertRedisStyleMatchToSqlWildCard(match)[0]),
        })
        .select('id')
        .getRawMany<Pick<DbObjectLive, 'id'>>(),
      'id',
    )
  }

  async delete(id: string): Promise<void> {
    await this.dataSource?.getRepository(DbObject)?.delete({ id })
  }

  async deleteAll(ids: string[]): Promise<void> {
    await this.dataSource?.getRepository(DbObject)?.delete({ id: In(ids) })
  }

  async get(id: string): Promise<string | null> {
    return String(
      (
        await this.getQueryBuildByClassWithLiveObject(StringObject)
          .where({ id })
          .getOne()
      )?.value,
    )
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
      if (typeof data.value === 'number' && Number.isFinite(data.value)) {
        data.value += 1
        await repo.update({ id }, data)
        return data.value
      }
      throw new Error(`Expected number (id=${id})`)
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

  async type(id: string): Promise<ObjectType> {
    return (
      await this.getQueryBuildByClassWithLiveObject(DbObjectLive)
        .where({ id })
        .getOne()
    )?.type
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
      .thru(mapper((data, member) => member in data, members))
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
      .thru(mapper((x, id) => id in x, ids))
      .value()
  }

  async getSetMembers(id: string): Promise<string[]> {
    return _.map(
      await this.getQueryBuildByClassWithLiveObject(HashSetObject, {
        baseAlias: 's',
      })
        .where({ id })
        .select('s.member', 'member')
        .getRawMany<Pick<HashSetObject, 'member'>>(),
      'member',
    )
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
      .thru(mapper((data, key) => data[key] ?? [], ids))
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
      .thru(mapper((x, id) => x[id] ?? 0, ids))
      .value()
  }

  async setRemoveRandom(id: string): Promise<string> {
    const victim = await this.getQueryBuildByClassWithLiveObject(HashSetObject)
      .where({ id })
      .orderBy(
        databasePersonality[this.databaseType]?.quirks?.specialFunction
          ?.random ?? 'RANDOM()',
      ) // Educated guess
      .getOne()
    await this.dataSource
      ?.getRepository(HashSetObject)
      .delete(_.pick(victim, ['id', 'member']))
    return victim?.member
  }

  // Implement ListQueryable

  async listPrepend(id: string, value: string): Promise<void> {
    const obj =
      (await this.dataSource
        .getRepository(ListObject)
        .findOne({ where: { id } })) ??
      _.thru(new ListObject(), (l) => {
        l.id = id
        return l
      })
    obj.array = [value, ...obj.array]
    await obj.save()
  }

  async listAppend(id: string, value: string): Promise<void> {
    const obj =
      (await this.dataSource
        .getRepository(ListObject)
        .findOne({ where: { id } })) ??
      _.thru(new ListObject(), (l) => {
        l.id = id
        return l
      })
    obj.array = [...obj.array, value]
    await obj.save()
  }

  async listRemoveLast(id: string): Promise<any> {
    const obj = await this.getQueryBuildByClassWithLiveObject(ListObject)
      .where({ id })
      .getOneOrFail()
    const ret = obj.array.pop()
    await obj.save()
    return ret
  }

  async listRemoveAll(id: string, value: string | string[]): Promise<void> {
    const obj = await this.getQueryBuildByClassWithLiveObject(ListObject)
      .where({ id })
      .getOneOrFail()
    obj.array = _.without(obj.array, value)
    await obj.save()
  }

  async listTrim(id: string, start: number, stop: number): Promise<void> {
    const obj = await this.getQueryBuildByClassWithLiveObject(ListObject)
      .where({ id })
      .getOneOrFail()
    obj.array.splice(start, stop - start + (stop < 0 ? obj.array.length : 0))
    await obj.save()
  }

  async getListRange(id: string, start: number, stop: number): Promise<any[]> {
    return (
      await this.getQueryBuildByClassWithLiveObject(ListObject)
        .where({ id })
        .getOneOrFail()
    ).array.slice(start, stop)
  }

  async listLength(id: string): Promise<number> {
    return (
      (
        await this.getQueryBuildByClassWithLiveObject(ListObject)
          .where({ id })
          .getOne()
      )?.array.length ?? 0
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
  ): Promise<Record<string, any>> {
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
    return _.map(
      await this.getQueryBuildByClassWithLiveObject(HashObject, {
        baseAlias: 'h',
      })
        .where({ id })
        .select('h.key', 'key')
        .getRawMany<Pick<HashObject, 'key'>>(),
      'key',
    )
  }

  async getObjectValues(id: string): Promise<any[]> {
    return _.map(
      await this.getQueryBuildByClassWithLiveObject(HashObject, {
        baseAlias: 'h',
      })
        .where({ id })
        .getMany(),
      'value',
    )
  }

  getObjects(ids: string[], keys: string[] = []): Promise<any[]> {
    return this.getObjectsInner(ids, keys)
  }

  getObjectsFields(
    ids: string[],
    keys: string[] = [],
  ): Promise<Record<string, any>[]> {
    return this.getObjectsInner(ids, keys)
  }

  incrObjectField(
    idOrIds: string | string[],
    key: string,
  ): Promise<number | number[]> {
    return this.incrObjectFieldBy(idOrIds, key, 1)
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
          .thru(mapper((data, id) => data[id]?.value ?? -1, idOrIds))
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
    data: [key: string, batch: Record<string, number>][],
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
      .thru(mapper((x, key) => key in x, keys))
      .value()
  }

  async setObject(
    keyOrKeys: string | string[],
    data: Record<string, any>,
  ): Promise<void> {
    return this.setObjectBulk([[keyOrKeys, data]])
  }

  async setObjectBulk(
    args: [key: string | string[], data: Record<string, any>][],
  ): Promise<void> {
    await this.dataSource
      ?.getRepository(HashObject)
      .createQueryBuilder()
      .insert()
      .orUpdate(['value'], ['id', 'key'])
      .values(
        args
          .filter(([__, data]) => Object.keys(data).length > 0)
          .flatMap(([key, data]) => {
            // eslint-disable-next-line no-prototype-builtins
            if (data.hasOwnProperty('')) {
              delete data['']
            }

            return cartesianProduct([
              Array.isArray(key) ? key : [key],
              Object.entries(data),
            ])
          })
          .map(([id, [key, value]]) => ({
            ...new HashObject(),
            id,
            key,
            value,
          })),
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

  async getSortedSetMembers(id: string): Promise<string[]> {
    return _.map(
      await this.getQueryBuildByClassWithLiveObject(SortedSetObject)
        .where({ id })
        .select('member')
        .addSelect('RANK() OVER (ORDER BY score)')
        .getRawMany<Pick<SortedSetObject, 'member'>>(),
      'member',
    )
  }

  getSortedSetIntersect(
    params: SortedSetTheoryOperation & { withScores: false },
  ): Promise<string[]>

  getSortedSetIntersect(
    params: SortedSetTheoryOperation & { withScores: true },
  ): Promise<ValueAndScore[]>
  async getSortedSetIntersect({
    withScores,
    aggregate,
    sets,
    start,
    stop,
    weights,
  }: SortedSetTheoryOperation & {
    withScores?: boolean
  }): Promise<ValueAndScore[] | string[]> {
    const baseQuery = this.getSortedSetUnionBaseQuery({
      aggregate,
      sets,
      sort: 'ASC',
      start,
      stop,
      weights,
    }).having('COUNT(*) = :length', { length: sets.length })

    return withScores
      ? baseQuery.addSelect('z.member', 'value').getRawMany<ValueAndScore>()
      : _.map(
          await baseQuery
            .addSelect('z.member', 'member')
            .getRawMany<Pick<SortedSetObject, 'member'>>(),
          'member',
        )
  }
  async getSortedSetRange(
    id: string | string[],
    start: number,
    stop: number,
  ): Promise<string[]> {
    return _.map(
      await this.getSortedSetRangeBaseQuery({
        byRange: { stop },
        id,
        sort: 'ASC',
        start,
      })
        .select('z.member', 'member')
        .getRawMany<Pick<SortedSetObject, 'member'>>(),
      'member',
    )
  }

  async getSortedSetRangeByLex(
    id: string,
    min: RedisStyleRangeString | '-',
    max: RedisStyleRangeString | '+',
    start?: number,
    count?: number,
  ): Promise<string[]> {
    return _.map(
      await this.getSortedSetRangeBaseQuery({
        byLex: {
          count,
          max,
          min,
        },
        id,
        sort: 'ASC',
        start,
      })
        .select('z.member', 'member')
        .getRawMany<Pick<SortedSetObject, 'member'>>(),
      'member',
    )
  }

  async getSortedSetRangeByScore(
    id: string,
    start: number,
    count: number,
    min: NumberTowardsMinima,
    max: NumberTowardsMaxima,
  ): Promise<string[]> {
    return _.map(
      await this.getSortedSetRangeBaseQuery({
        byScore: { count, max, min },
        id,
        sort: 'ASC',
        start,
      })
        .select('z.member', 'member')
        .getRawMany<Pick<SortedSetObject, 'member'>>(),
      'member',
    )
  }

  getSortedSetRangeByScoreWithScores(
    id: string,
    start: number,
    count: number,
    min: NumberTowardsMinima,
    max: NumberTowardsMaxima,
  ): Promise<ValueAndScore[]> {
    return this.getSortedSetRangeBaseQuery({
      byScore: { count, max, min },
      id,
      sort: 'ASC',
      start,
    })
      .select('z.member', 'value')
      .addSelect('z.score', 'score')
      .getRawMany<ValueAndScore>()
  }

  getSortedSetRangeWithScores(
    id: string,
    start: number,
    stop: number,
  ): Promise<ValueAndScore[]> {
    return this.getSortedSetRangeBaseQuery({
      byRange: { stop },
      id,
      sort: 'ASC',
      start,
    })
      .select('z.member', 'value')
      .addSelect('z.score', 'score')
      .getRawMany<ValueAndScore>()
  }

  getSortedSetRevIntersect(
    params: SortedSetTheoryOperation & { withScores: true },
  ): Promise<ValueAndScore[]>

  getSortedSetRevIntersect(
    params: SortedSetTheoryOperation & { withScores?: false },
  ): Promise<string[]>
  async getSortedSetRevIntersect({
    withScores,
    aggregate,
    sets,
    start,
    stop,
    weights,
  }: SortedSetTheoryOperation & { withScores?: boolean }): Promise<
    string[] | ValueAndScore[]
  > {
    const baseQuery = this.getSortedSetUnionBaseQuery({
      aggregate,
      sets,
      sort: 'DESC',
      start,
      stop,
      weights,
    }).having('COUNT(*) = :length', { length: sets.length })

    return withScores
      ? baseQuery.addSelect('z.member', 'value').getRawMany<ValueAndScore>()
      : _.map(
          await baseQuery
            .addSelect('z.member', 'member')
            .getRawMany<Pick<SortedSetObject, 'member'>>(),
          'member',
        )
  }
  async getSortedSetRevRange(
    id: string | string[],
    start: number,
    stop: number,
  ): Promise<string[]> {
    return _.map(
      await this.getSortedSetRangeBaseQuery({
        byRange: { stop },
        id,
        sort: 'DESC',
        start,
      })
        .select('z.member', 'member')
        .getRawMany<Pick<SortedSetObject, 'member'>>(),
      'member',
    )
  }

  async getSortedSetRevRangeByLex(
    id: string,
    max: RedisStyleRangeString | '+',
    min: RedisStyleRangeString | '-',
    start?: number,
    count?: number,
  ): Promise<string[]> {
    return _.map(
      await this.getSortedSetRangeBaseQuery({
        byLex: { count, max, min },
        id,
        sort: 'DESC',
        start,
      })
        .select('z.member', 'member')
        .getRawMany<Pick<SortedSetObject, 'member'>>(),
      'member',
    )
  }

  async getSortedSetRevRangeByScore(
    id: string,
    start: number,
    count: number,
    max: NumberTowardsMaxima,
    min: NumberTowardsMinima,
  ): Promise<string[]> {
    return _.map(
      await this.getSortedSetRangeBaseQuery({
        byScore: { count, max, min },
        id,
        sort: 'DESC',
        start,
      })
        .select('z.member', 'member')
        .getRawMany<Pick<SortedSetObject, 'member'>>(),
      'member',
    )
  }

  getSortedSetRevRangeByScoreWithScores(
    id: string,
    start: number,
    count: number,
    max: NumberTowardsMaxima,
    min: NumberTowardsMinima,
  ): Promise<ValueAndScore[]> {
    return this.getSortedSetRangeBaseQuery({
      byScore: { count, max, min },
      id,
      sort: 'DESC',
      start,
    })
      .select('z.member', 'value')
      .addSelect('z.score', 'score')
      .getRawMany<ValueAndScore>()
  }

  getSortedSetRevRangeWithScores(
    id: string,
    start: number,
    stop: number,
  ): Promise<ValueAndScore[]> {
    return this.getSortedSetRangeBaseQuery({
      byRange: { stop },
      id,
      sort: 'DESC',
      start,
    })
      .select('z.member', 'value')
      .addSelect('z.score', 'score')
      .getRawMany<ValueAndScore>()
  }

  getSortedSetRevUnion(
    params: SortedSetTheoryOperation & { withScores: true },
  ): Promise<ValueAndScore[]>

  getSortedSetRevUnion(
    params: SortedSetTheoryOperation & { withScores?: false },
  ): Promise<string[]>
  async getSortedSetRevUnion({
    aggregate,
    sets,
    start,
    stop,
    weights,
    withScores,
  }: SortedSetTheoryOperation & { withScores?: boolean }): Promise<
    string[] | ValueAndScore[]
  > {
    const baseQuery = this.getSortedSetUnionBaseQuery({
      aggregate,
      sets,
      sort: 'DESC',
      start,
      stop,
      weights,
    })
    return withScores
      ? baseQuery.select('z.member', 'value').getRawMany<ValueAndScore>()
      : _.map(
          await baseQuery
            .select('z.member', 'member')
            .getRawMany<Pick<SortedSetObject, 'member'>>(),
          'member',
        )
  }
  getSortedSetScan(
    params: SortedSetScanBaseParameters & { withScores: true },
  ): Promise<ValueAndScore[]>

  getSortedSetScan(
    params: SortedSetScanBaseParameters & { withScores?: false },
  ): Promise<string[]>
  async getSortedSetScan({
    key,
    match,
    limit,
    withScores,
  }: SortedSetScanBaseParameters & {
    withScores?: boolean
  }): Promise<string[] | ValueAndScore[]> {
    let baseQuery = this.getQueryBuildByClassWithLiveObject(SortedSetObject, {
      baseAlias: 'z',
    }).where({
      id: key,
      member: Like(convertRedisStyleMatchToSqlWildCard(match)[0]),
    })

    baseQuery =
      (limit > 0
        ? baseQuery.limit(limit)
        : databasePersonality[this.databaseType]?.quirks?.fixLimit?.(
            baseQuery,
          )) ?? baseQuery

    if (withScores) {
      return baseQuery
        .select('z.member', 'value')
        .addSelect('z.score', 'score')
        .getRawMany<ValueAndScore>()
    }
    return _.map(
      await baseQuery
        .select('z.member', 'member')
        .getRawMany<Pick<SortedSetObject, 'member'>>(),
      'member',
    )
  }
  getSortedSetUnion(
    params: SortedSetTheoryOperation & { withScores: true },
  ): Promise<ValueAndScore[]>

  getSortedSetUnion(
    params: SortedSetTheoryOperation & { withScores?: false },
  ): Promise<string[]>
  async getSortedSetUnion({
    aggregate,
    sets,
    start,
    stop,
    weights,
    withScores,
  }: SortedSetTheoryOperation & { withScores?: boolean }): Promise<
    string[] | ValueAndScore[]
  > {
    const baseQuery = this.getSortedSetUnionBaseQuery({
      aggregate,
      sets,
      sort: 'ASC',
      start,
      stop,
      weights,
    })

    return withScores
      ? baseQuery.addSelect('z.member', 'value').getRawMany<ValueAndScore>()
      : _.map(
          await baseQuery
            .select('z.member', 'member')
            .getRawMany<Pick<SortedSetObject, 'member'>>(),
          'member',
        )
  }
  async getSortedSetsMembers(ids: string[]): Promise<string[][]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(SortedSetObject, {
        baseAlias: 'z',
      })
        .where({ id: In(ids) })
        .addGroupBy('z.id')
        .addGroupBy('z.member')
        .addOrderBy('z.score', 'ASC')
        .getMany(),
    )
      .groupBy('id')
      .mapValues((x) => _.chain(x).map('member').orderBy('score').value())
      .thru(mapper((data, id) => data[id] ?? [], ids))
      .value()
  }

  getSortedSetsMembers(keys: string[]): Promise<string[]> {
    throw new Error('Method not implemented.')
  }

  async isSortedSetMember(id: string, member: string): Promise<boolean> {
    return (
      (await this.getQueryBuildByClassWithLiveObject(SortedSetObject)
        .where({
          id,
          member,
        })
        .getCount()) > 0
    )
  }

  async isSortedSetMembers(id: string, members: string[]): Promise<boolean[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(SortedSetObject)
        .where({ id, member: In(members) })
        .select('member')
        .getRawMany<Pick<SortedSetObject, 'member'>>(),
    )
      .keyBy('member')
      .thru((x) => members.map((member) => member in x))
      .value()
  }

  processSortedSet(
    _setKey: string,
    _processFn: (ids: number[]) => void | Promise<void>,
    _options: { withScores?: boolean; batch?: number; interval?: number },
  ): Promise<any> {
    throw new Error('Method not implemented.')
  }

  sortedSetAdd(id: string, score: number, value: string): Promise<void>
  sortedSetAdd(id: string, scores: number[], values: string[]): Promise<void>
  async sortedSetAdd(
    id: string,
    scoreOrScores: number | number[],
    valueOrValues: string | string[],
  ): Promise<void> {
    if (!id) {
      return
    }

    if (Array.isArray(scoreOrScores) && Array.isArray(valueOrValues)) {
      return this.sortedSetAddBulk([[id, scoreOrScores, valueOrValues]])
    }
    if (!Number.isFinite(scoreOrScores)) {
      throw new Error(`[[error:invalid-score, ${scoreOrScores}]]`)
    }

    await this.dataSource
      ?.getRepository(SortedSetObject)
      .createQueryBuilder()
      .insert()
      .orUpdate(['score'], ['id', 'member'])
      .values({
        ...new SortedSetObject(),
        id,
        member: valueOrValues as string,
        score: scoreOrScores as number,
      })
      .execute()
  }
  async sortedSetAddBulk(
    data: [id: string, scores: number[], members: string[]][],
  ): Promise<void> {
    const values: SortedSetObject[] = []
    for (const [id, scores, members] of data) {
      if (!scores.length || !members.length) {
        return
      }
      if (scores.length !== members.length) {
        throw new Error('[[error:invalid-data]]')
      }
      for (const [score, member] of _.zip(scores, members)) {
        const value = new SortedSetObject()
        value.id = id
        value.member = member
        value.score = score
        values.push(value)
      }
    }

    await this.dataSource
      ?.getRepository(SortedSetObject)
      .createQueryBuilder()
      .insert()
      .orUpdate(['score'], ['id', 'member'])
      .values(values)
      .execute()
  }

  sortedSetCard(id: string): Promise<number> {
    return this.getQueryBuildByClassWithLiveObject(SortedSetObject)
      .where({ id })
      .getCount()
  }

  async sortedSetCount(
    id: string,
    min: NumberTowardsMinima,
    max: NumberTowardsMaxima,
  ): Promise<number> {
    let baseQuery = this.getQueryBuildByClassWithLiveObject(
      SortedSetObject,
    ).where({ id })
    if (min != '-inf') {
      baseQuery = baseQuery.andWhere({ score: MoreThanOrEqual(min) })
    }
    if (max != '+inf') {
      baseQuery = baseQuery.andWhere({ score: LessThanOrEqual(max) })
    }
    return baseQuery.getCount()
  }

  sortedSetIncrBy(
    _id: string,
    _increment: number,
    _member: string,
  ): Promise<number> {
    throw new Error('Method not implemented.')
  }

  sortedSetIncrByBulk(
    _data: [id: string, increment: number, member: string][],
  ): Promise<number[]> {
    throw new Error('Method not implemented.')
  }

  async sortedSetIntersectCard(ids: string[]): Promise<number> {
    const baseQuery = this.getQueryBuildByClassWithLiveObject(SortedSetObject, {
      baseAlias: 'z',
    })
      .where({ id: In(ids) })
      .groupBy('z.member')
      .having('COUNT(*) = :length', { length: ids.length })
      .select('count(*)', 'c')
    return (await baseQuery.getRawMany())?.length
  }

  sortedSetLexCount(
    _id: string,
    _min: RedisStyleRangeString,
    _max: RedisStyleRangeString,
  ): Promise<number> {
    throw new Error('Method not implemented.')
  }

  async getSortedSetRankInner(
    sort: 'ASC' | 'DESC',
    ids: string[],
    members: string[],
  ): Promise<
    (Pick<SortedSetObject, 'id' | 'member'> & { rank: number | string })[]
  > {
    const cmp = sort === 'ASC' ? '>' : '<'
    let baseQuery = this.getQueryBuildByClassWithLiveObject(SortedSetObject, {
      baseAlias: 'z',
    })
    const [orderScore, orderMember] = [
      `z.score ${cmp} z1.score`,
      `z.score = z1.score and z.member ${cmp} z1.member`,
    ]

    baseQuery = baseQuery
      .leftJoinAndSelect(
        SortedSetObject,
        'z1',
        `z.id = z1.id and ((${orderScore}) or (${orderMember}))`,
      )
      .select('z.id', 'id')
      .addSelect('z.member', 'member')
      .addSelect(`COUNT(z1.id)`, 'rank')
      .andWhere({ id: In(ids), member: In(members) })
      .groupBy('z.member')
      .addGroupBy('z.id')
    return baseQuery?.getRawMany<
      Pick<SortedSetObject, 'id' | 'member'> & { rank: number | string }
    >()
  }

  async sortedSetRank(id: string, member: string): Promise<number | null> {
    const rank = (await this.getSortedSetRankInner('ASC', [id], [member]))?.[0]
      ?.rank
    return rank ? Number(rank) : null
  }

  async sortedSetRanks(
    id: string,
    members: string[],
  ): Promise<(number | null)[]> {
    return _.chain(await this.getSortedSetRankInner('ASC', [id], members))
      .keyBy('member')
      .mapValues('rank')
      .thru(
        mapper((x, member) => {
          const rank = x[member]
          return (typeof rank === 'string' ? Number(rank) : rank) ?? null
        }, members),
      )
      .value()
  }

  async sortedSetRemove(
    key: string | string[],
    value: string | string[],
  ): Promise<void> {
    await this.dataSource?.getRepository(SortedSetObject).delete({
      id: Array.isArray(key) ? In(key) : key,
      member: Array.isArray(value) ? In(value) : value,
    })
  }

  sortedSetRemoveBulk(_data: [key: string, member: string][]): Promise<void> {
    throw new Error('Method not implemented.')
  }

  sortedSetRemoveRangeByLex(
    _key: string,
    _min: RedisStyleRangeString,
    _max: RedisStyleRangeString,
  ): Promise<void> {
    throw new Error('Method not implemented.')
  }

  async sortedSetRevRank(id: string, member: string): Promise<number> {
    const rank = (await this.getSortedSetRankInner('DESC', [id], [member]))?.[0]
      ?.rank
    return rank ? Number(rank) : null
  }

  async sortedSetRevRanks(id: string, members: string[]): Promise<number[]> {
    return _.chain(await this.getSortedSetRankInner('DESC', [id], members))
      .keyBy('member')
      .mapValues('rank')
      .thru(
        mapper((x: Record<string, number | string>, member) => {
          const rank = x[member]
          return (typeof rank === 'string' ? Number(rank) : rank) ?? null
        }, members),
      )
      .value()
  }

  async sortedSetScore(id: string, member: string): Promise<number | null> {
    return (
      (
        await this.getQueryBuildByClassWithLiveObject(SortedSetObject)
          .where({ id, member })
          .getOne()
      )?.score ?? null
    )
  }

  async sortedSetScores(id: string, members: string[]): Promise<number[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(SortedSetObject)
        .where({ id, member: In(members) })
        .select(['member', 'score'])
        .getRawMany<Pick<SortedSetObject, 'member' | 'score'>>(),
    )
      .keyBy('member')
      .mapValues('score')
      .thru(
        mapper((x: Record<string, number>, member) => {
          const score = x[member]
          return (typeof score === 'string' ? Number(score) : score) ?? null
        }, members),
      )
      .value()
  }

  async sortedSetUnionCard(id: string[]): Promise<number> {
    return Number(
      (
        await this.getQueryBuildByClassWithLiveObject(SortedSetObject)
          .where({
            id: In(id),
          })
          .select('COUNT(DISTINCT(member))', 'count')
          .getRawOne()
      )?.count ?? 0,
    )
  }

  async sortedSetsAdd(
    ids: string[],
    scores: number | number[],
    member: string,
  ): Promise<void> {
    await this.dataSource
      ?.getRepository(SortedSetObject)
      .createQueryBuilder()
      .insert()
      .orUpdate(['score'], ['id', 'member'])
      .values(
        cartesianProduct([
          ids,
          Array.isArray(scores) ? scores : [scores],
          [member],
        ]).map(([id, score, member_]) => ({
          ...new SortedSetObject(),
          id,
          member: member_,
          score,
        })),
      )
      .execute()
  }

  async sortedSetsCard(keys: string[]): Promise<number[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(SortedSetObject)
        .where({ id: In(keys) })
        .groupBy('id')
        .select('id')
        .addSelect('COUNT(id)', 'count')
        .getRawMany<Pick<SortedSetObject, 'id'> & { count: number }>(),
    )
      .keyBy('id')
      .mapValues('count')
      .thru(
        mapper((x, key) => {
          const count = x[key]
          return (typeof count === 'string' ? Number(count) : count) ?? 0
        }, keys),
      )
      .value()
  }

  async sortedSetsCardSum(ids: string[]): Promise<number> {
    return this.getQueryBuildByClassWithLiveObject(SortedSetObject)
      .where({ id: In(ids) })
      .getCount()
  }

  async sortedSetsRanks<T extends readonly [] | readonly string[]>(
    ids: T,
    members: { [K in keyof T]: any },
  ): Promise<number[]> {
    return _.chain(
      await this.getSortedSetRankInner(
        'ASC',
        ids as string[],
        members as string[],
      ),
    )
      .groupBy('id')
      .mapValues((x) => _.chain(x).keyBy('member').mapValues('rank').value())
      .thru(
        mapper((x, [id, member]) => {
          const rank = x[id]?.[member]
          return (typeof rank === 'string' ? Number(rank) : rank) ?? null
        }, _.zip(ids, members)),
      )
      .value()
  }

  async sortedSetsRemove(ids: string[], member: string): Promise<void> {
    await this.dataSource?.getRepository(SortedSetObject).delete({
      id: In(ids),
      member,
    })
  }

  sortedSetsRemoveRangeByScore(
    _keys: string[],
    _min: NumberTowardsMinima,
    _max: NumberTowardsMaxima,
  ): Promise<void> {
    throw new Error('Method not implemented.')
  }

  async sortedSetsRevRanks(
    ids: string[],
    members: string[],
  ): Promise<number[]> {
    return _.chain(await this.getSortedSetRankInner('DESC', ids, members))
      .groupBy('id')
      .mapValues((x) => _.chain(x).keyBy('member').mapValues('rank').value())
      .thru(
        mapper((data, [id, member]) => {
          const rank = data[id]?.[member]
          return (typeof rank === 'string' ? Number(rank) : rank) ?? null
        }, cartesianProduct([ids, members])),
      )
      .value()
  }

  async sortedSetsScore(ids: string[], member: string): Promise<number[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(SortedSetObject)
        .where({ id: In(ids), member })
        .select(['id', 'score'])
        .getRawMany<Pick<SortedSetObject, 'id' | 'score'>>(),
    )
      .keyBy('id')
      .mapValues('score')
      .thru(mapper((data: Record<string, number>, id) => data[id] ?? null, ids))
      .value()
  }

  // Helpers

  private getQueryBuildByClassWithLiveObject<T>(
    klass: { new (): T },
    {
      baseAlias = 'b',
      liveObjectAlias = 'lo',
      em = this.dataSource?.manager,
      repo = em?.getRepository(klass),
      queryBuilder = repo?.createQueryBuilder(baseAlias),
    }: {
      baseAlias?: string
      liveObjectAlias?: string
      em?: EntityManager
      repo?: Repository<T>
      queryBuilder?: SelectQueryBuilder<T>
    } = {},
  ): SelectQueryBuilder<T> | null {
    return queryBuilder?.innerJoin(
      DbObjectLive,
      liveObjectAlias,
      `${liveObjectAlias}.id = ${baseAlias}.id`,
    )
  }
  private getSortedSetUnionBaseQuery({
    sets,
    weights = [],
    aggregate = 'SUM',
    start = 0,
    stop = -1,
    sort,
  }: SortedSetTheoryOperation): SelectQueryBuilder<SortedSetObject> {
    const isPostgres = this.databaseType === PopularDatabaseType.Postgres

    if (sets.length < weights.length) {
      weights = weights.slice(0, sets.length)
    }
    while (sets.length > weights.length) {
      weights.push(1)
    }

    const dotEntries = _.zip(sets, weights)
    const cases = dotEntries
      .map((__, i) => {
        // Postgres related quirks
        if (isPostgres) {
          return `WHEN z.id = :i_${i} THEN :w_${i}::NUMERIC`
        }
        return `WHEN z.id = :i_${i} THEN :w_${i}`
      })
      .join(' ')
    const baseQuery = this.getQueryBuildByClassWithLiveObject(SortedSetObject, {
      baseAlias: 'z',
    })
      .setParameters(
        _.chain(dotEntries)
          .map(([set, weight], i) => [
            [`i_${i}`, set],
            [`w_${i}`, weight],
          ])
          .flatten()
          .fromPairs()
          .value(),
      )
      .where({ id: In(sets) })
      .groupBy('z.member')
      .select(`${aggregate}(z.score * CASE ${cases} END)`, 'score')
      .orderBy('score', sort)
      .offset(start)
    const limit = stop - start + 1

    return (
      (limit > 0
        ? baseQuery.limit(limit)
        : databasePersonality[this.databaseType]?.quirks?.fixLimit?.(
            baseQuery,
          )) ?? baseQuery
    )
  }

  private async incrObjectFieldHelper(
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

  private getSortedSetRangeBaseQuery({
    id,
    sort,
    start = 0,
    ...rest
  }: getSortedSetRangeInnerParams): SelectQueryBuilder<SortedSetObject> {
    let limit: number
    let baseQuery = this.getQueryBuildByClassWithLiveObject(SortedSetObject, {
      baseAlias: 'z',
    })
      .where({
        id: Array.isArray(id) ? In(id) : id,
      })
      .addOrderBy('z.score', sort)

    if ('byRange' in rest) {
      let offset: number
      ;({ offset, limit } = fixRange(start, rest.byRange.stop))
      baseQuery = baseQuery.offset(offset)
    } else if ('byScore' in rest) {
      const { min, max, count } = rest.byScore
      limit = count
      baseQuery = baseQuery.offset(start)
      if (Number.isFinite(min) && min !== '-inf') {
        baseQuery = baseQuery.andWhere({ score: MoreThanOrEqual(min) })
      }
      if (Number.isFinite(max) && max !== '+inf') {
        baseQuery = baseQuery.andWhere({ score: LessThanOrEqual(max) })
      }
    } else if ('byLex' in rest) {
      const { min, max, count } = rest.byLex
      limit = count
      baseQuery = baseQuery.orderBy('z.member', sort).offset(start)
      // Educated guess
      const collate =
        databasePersonality[this.databaseType]?.quirks?.collation?.binary ??
        'BINARY'
      if (min !== '-') {
        const [operator, params] =
          convertRedisStyleRangeStringToTypeormCriterion(min, 'min')

        baseQuery = baseQuery.andWhere(
          `z.member ${operator} COLLATE ${collate}`,
          params,
        )
      }
      if (max !== '+') {
        const [operator, params] =
          convertRedisStyleRangeStringToTypeormCriterion(max, 'max')
        baseQuery = baseQuery.andWhere(
          `z.member ${operator} COLLATE ${collate}`,
          params,
        )
      }
    }
    return (
      (limit > 0
        ? baseQuery.limit(limit)
        : databasePersonality[this.databaseType]?.quirks?.fixLimit?.(
            baseQuery,
          )) ?? baseQuery
    )
  }

  async getObjectsInner(ids: string[], keys: string[]): Promise<any[]> {
    if (!(Array.isArray(ids) && ids.length > 0)) {
      return []
    }

    let qb = this.getQueryBuildByClassWithLiveObject(HashObject, {
      baseAlias: 'h',
    }).where({ id: In(ids) })
    if (Array.isArray(keys) && keys.length > 0) {
      qb = qb.andWhere({ key: In(keys) })
    }

    return _.chain(await qb.select(['h.id', 'h.key', 'h.value']).getMany())
      .groupBy('id')
      .mapValues((x) => _.chain(x).keyBy('key').mapValues('value').value())
      .thru(mapper((x, id) => x[id] ?? {}, ids))
      .value()
  }
}

export { SessionStore }
