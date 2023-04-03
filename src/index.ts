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
  ReorderedListObject,
  ReorderedSortedSetObject,
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
  intervalToSqlFunction,
  mapper,
} from './utils'

import type { Provider } from 'nconf'
import type { Logger } from 'winston'

const nconf: Provider = require.main.require('nconf')
const winston: Logger = require.main.require('winston')

type getSortedSetRangeInnerParams = {
  id: string | string[]
  sort?: 'ASC' | 'DESC'
  start?: number
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
    return resolveDatabaseTypeByDriver(this.dataSource?.driver)
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

      return typeorm
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

      return {
        ...typeorm,
        ssl:
          knownDatabaseType !== PopularDatabaseType.Oracle
            ? (typeorm as any).ssl
            : {},
      } as DataSourceOptions
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

      if (this.databaseType === PopularDatabaseType.Sqlite) {
        this.#dataSource.driver.isReturningSqlSupported = () => true
      }
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
    keyOrKeys: string | string[],
    memberOrMembers: string | string[],
  ): Promise<void> {
    const values = cartesianProduct([
      Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys],
      Array.isArray(memberOrMembers) ? memberOrMembers : [memberOrMembers],
    ]).map(([id, member]) => ({ ...new HashSetObject(), id, member }))
    await this.dataSource
      ?.getRepository(HashSetObject)
      .createQueryBuilder()
      .insert()
      .orIgnore()
      .values(values)
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
      .thru(mapper((data, id) => id in data, ids))
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
        .getRawMany<Pick<HashSetObject, 'id'> & { count: number }>(),
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
    await this.getQueryBuildByClassWithLiveObject(ListObject)
      .insert()
      .values({
        ...new ListObject(),
        id,
        slot: () =>
          this.getQueryBuildByClassWithLiveObject(ListObject, {
            baseAlias: 'l',
            subquery: true,
          })
            .select('COALESCE(MIN(l.slot) - 1, 0)')
            .where('l.id = :id')
            .getQuery(),
        value,
      })
      .setParameters({ id })
      .updateEntity(false)
      .execute()
  }

  async listAppend(id: string, value: string): Promise<void> {
    await this.getQueryBuildByClassWithLiveObject(ListObject)
      .insert()
      .values({
        ...new ListObject(),
        id,
        slot: () =>
          this.getQueryBuildByClassWithLiveObject(ListObject, {
            baseAlias: 'l',
            subquery: true,
          })
            .select('COALESCE(MAX(l.slot) + 1, 0)')
            .where('l.id = :id')
            .getQuery(),
        value,
      })
      .setParameter('id', id)
      .updateEntity(false)
      .execute()
  }

  async listRemoveLast(id: string): Promise<string | null> {
    if (!this.dataSource.driver.isReturningSqlSupported('delete')) {
      return this.dataSource.transaction(async (em) => {
        const { slot, value } =
          (await this.getQueryBuildByClassWithLiveObject(ReorderedListObject, {
            baseAlias: 'l',
            em,
          })
            .orderBy('l.rank', 'DESC')
            .select('l.slot', 'slot')
            .addSelect('l.value', 'value')
            .limit(1)
            .getRawOne()) ?? {}

        if (value) {
          await em.delete(ListObject, { id, slot })
        }
        return value ?? null
      })
    }
    const slot = this.getQueryBuildByClassWithLiveObject(ReorderedListObject, {
      baseAlias: 'l',
      subquery: true,
    })
      .orderBy('l.rank', 'DESC')
      .select('l.slot', 'slot')
      .limit(1)

    const baseQuery = this.dataSource
      .createQueryBuilder()
      .delete()
      .from(ListObject)
      .where({
        id,
      })
      .andWhere(`slot = ${slot.getQuery()}`)

    return (
      (await baseQuery.returning(['value']).execute()).raw?.[0]?.value ?? null
    )
  }

  async listRemoveAll(id: string, value: string | string[]): Promise<void> {
    await this.getQueryBuildByClassWithLiveObject(ListObject)
      .delete()
      .where({ id, value: Array.isArray(value) ? In(value) : value })
      .execute()
  }

  async listTrim(id: string, start: number, stop: number): Promise<void> {
    const base = this.getQueryBuildByClassWithLiveObject(ListObject)
      .delete()
      .setParameters({ id, start, stop })
      .where('id = :id')

    // Out of range indexes will not produce an error: if start is larger than the end of the list, or start > end,
    // the result will be an empty list (which causes key to be removed).
    // If end is larger than the end of the list, Redis will treat it like the last element of the list.

    if (start > stop && ((start > 0 && stop > 0) || (start < 0 && stop < 0))) {
      await base.execute()
      return
    }

    let slots = this.getQueryBuildByClassWithLiveObject(ReorderedListObject, {
      baseAlias: 'gr',
      subquery: true,
    })
      .where('gr.id = :id')
      .select('gr.slot', 'slot')
    if (stop > start) {
      if (start >= 0) {
        slots = slots.andWhere(`rank >= :start and rank <= :stop`)
      }
      if (stop < 0) {
        slots = slots.andWhere(`rank_back >= :start and rank_back <= :stop`)
      }
    } else if (start >= 0 && stop < 0) {
      slots = slots
        .andWhere(`rank_back <= :stop`)
        .orderBy('rank', 'ASC')
        .offset(start)
      slots =
        (start > 0
          ? databasePersonality[this.databaseType]?.quirks?.fixLimit?.(slots)
          : slots) ?? slots
    }

    if (slots) {
      const sq = this.dataSource
        .createQueryBuilder()
        .subQuery()
        .from(() => slots, 'slots')
      await base.andWhere(`slot NOT IN ${sq.getQuery()}`).execute()
    }
  }

  async getListRange(
    id: string,
    start: number,
    stop: number,
  ): Promise<string[]> {
    const { offset, limit } = fixRange(start, stop)

    let queryBuilder1 = this.getQueryBuildByClassWithLiveObject(
      ReorderedListObject,
      { baseAlias: 'gr' },
    )
      .orderBy('gr.rank', 'ASC')
      .where({ id })
      .select('gr.value', 'value')
      .offset(offset)
    if (limit > 0) {
      queryBuilder1 = queryBuilder1.limit(limit)
    }

    return _.map(await queryBuilder1.getRawMany(), 'value')
  }

  async listLength(id: string): Promise<number> {
    return this.getQueryBuildByClassWithLiveObject(ListObject)
      .where({ id })
      .getCount()
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
          .thru(
            _.flow([
              mapper((data, key) => [key, data[key] ?? null], keys),
              Object.fromEntries,
            ]),
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
      await repo.save(
        await Promise.all(
          data
            .flatMap(([key, match]) =>
              cartesianProduct([[key], Object.entries(match)]),
            )
            .map(([key, [field, value]]) =>
              this.incrObjectFieldHelper(repo, key, field, value),
            ),
        ),
      )
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
        .getRawMany<Pick<HashObject, 'key'>>(),
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
      .orUpdate(['value'], ['id', '_key'])
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
        .orderBy('score')
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
        .getMany(),
    )
      .groupBy('id')
      .mapValues((x) => _.chain(x).orderBy('score').map('member').value())
      .thru(mapper((data, id) => data[id] ?? [], ids))
      .value()
  }

  async isMemberOfSortedSets(
    ids: string[],
    member: string,
  ): Promise<boolean[]> {
    return _.chain(
      await this.getQueryBuildByClassWithLiveObject(SortedSetObject, {
        baseAlias: 'z',
      })
        .where({
          id: In(ids),
          member,
        })
        .select('z.id', 'id')
        .getRawMany<Pick<SortedSetObject, 'id'>>(),
    )
      .keyBy('id')
      .thru(mapper((data, id) => id in data, ids))
      .value()
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
      .thru(mapper((x, member) => member in x, members))
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
      if (!(scores.length && members.length)) {
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

  async sortedSetLexCount(
    id: string,
    min: RedisStyleRangeString | '-',
    max: RedisStyleRangeString | '+',
  ): Promise<number> {
    return this.getSortedSetRangeBaseQuery({
      byLex: { max, min },
      id,
    }).getCount()
  }

  getSortedSetRankBaseQuery(
    ids: string[],
    members: string[],
  ): SelectQueryBuilder<ReorderedSortedSetObject> {
    return this.getQueryBuildByClassWithLiveObject(ReorderedSortedSetObject, {
      baseAlias: 'z',
    })
      .where({ id: In(ids), member: In(members) })
      .select('z.id', 'id')
      .addSelect('z.member', 'member')
  }

  async sortedSetRank(id: string, member: string): Promise<number | null> {
    const rank = (
      await this.getSortedSetRankBaseQuery([id], [member])
        .addSelect('z.rank', 'rank')
        .getRawMany<Pick<ReorderedSortedSetObject, 'id' | 'member' | 'rank'>>()
    )?.[0]?.rank
    return rank ? Number(rank) : null
  }

  async sortedSetRanks(
    id: string,
    members: string[],
  ): Promise<(number | null)[]> {
    return _.chain(
      await this.getSortedSetRankBaseQuery([id], members)
        .addSelect('z.rank', 'rank')
        .getRawMany<Pick<ReorderedSortedSetObject, 'id' | 'member' | 'rank'>>(),
    )
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
    _min: RedisStyleRangeString | '-',
    _max: RedisStyleRangeString | '+',
  ): Promise<void> {
    throw new Error('Method not implemented.')
  }

  async sortedSetRevRank(id: string, member: string): Promise<number> {
    const rank = (
      await this.getSortedSetRankBaseQuery([id], [member])
        .addSelect('z.rank_back', 'rank_back')
        .getRawMany<
          Pick<ReorderedSortedSetObject, 'id' | 'member' | 'rank_back'>
        >()
    )?.[0]?.rank_back
    return Number.isFinite(rank) || typeof rank === 'string'
      ? Math.abs(Number(rank)) - 1
      : null
  }

  async sortedSetRevRanks(id: string, members: string[]): Promise<number[]> {
    return _.chain(
      await this.getSortedSetRankBaseQuery([id], members)
        .addSelect('z.rank_back', 'rank_back')
        .getRawMany<
          Pick<ReorderedSortedSetObject, 'id' | 'member' | 'rank_back'>
        >(),
    )
      .keyBy('member')
      .mapValues('rank_back')
      .thru(
        mapper((x: Record<string, number | string>, member) => {
          const rank = x[member]
          return Number.isFinite(rank) || typeof rank === 'string'
            ? Math.abs(Number(rank)) - 1
            : null
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
    const values = cartesianProduct([
      ids,
      Array.isArray(scores) ? scores : [scores],
      [member],
    ]).map(([id, score, member_]) => ({
      ...new SortedSetObject(),
      id,
      member: member_,
      score,
    }))
    await this.dataSource
      ?.getRepository(SortedSetObject)
      .createQueryBuilder()
      .insert()
      .orUpdate(['score'], ['id', 'member'])
      .values(values)
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
      await this.getSortedSetRankBaseQuery(ids as string[], members as string[])
        .addSelect('z.rank', 'rank')
        .getRawMany<Pick<ReorderedSortedSetObject, 'id' | 'member' | 'rank'>>(),
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
    return _.chain(
      await this.getSortedSetRankBaseQuery(ids, members)
        .addSelect('z.rank_back', 'rank_back')
        .getRawMany<
          Pick<ReorderedSortedSetObject, 'id' | 'member' | 'rank_back'>
        >(),
    )
      .groupBy('id')
      .mapValues((x) =>
        _.chain(x).keyBy('member').mapValues('rank_back').value(),
      )
      .thru(
        mapper((data, [id, member]) => {
          const rank = data[id]?.[member]
          return Number.isFinite(rank) || typeof rank === 'string'
            ? Math.abs(Number(rank)) - 1
            : null
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
      subquery = false,
      em = this.dataSource?.manager,
      repo = em?.getRepository(klass),
      queryBuilder = subquery
        ? em?.createQueryBuilder().subQuery().from(klass, baseAlias)
        : repo?.createQueryBuilder(baseAlias),
    }: {
      baseAlias?: string
      liveObjectAlias?: string
      em?: EntityManager
      repo?: Repository<T>
      queryBuilder?: SelectQueryBuilder<T>
      subquery?: boolean
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
    sort = 'ASC',
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
      const binaryCollation =
        databasePersonality[this.databaseType]?.quirks?.collation?.binary
      const collate = binaryCollation ? `COLLATE ${binaryCollation}` : ''
      if (min !== '-') {
        const [operator, minText] = intervalToSqlFunction(min, 'min')

        baseQuery = baseQuery.andWhere(
          `z.member ${operator} :minText ${collate}`,
          {
            minText,
          },
        )
      }
      if (max !== '+') {
        const [operator, maxText] = intervalToSqlFunction(max, 'max')
        baseQuery = baseQuery.andWhere(
          `z.member ${operator} :maxText ${collate}`,
          { maxText },
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
