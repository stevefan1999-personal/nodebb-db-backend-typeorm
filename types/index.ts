import { Store } from 'express-session'

export { HashQueryable } from './hash'
export { ListQueryable } from './list'
export { SetQueryable } from './set'
export { StringQueryable } from './string'
export { SortedSetQueryable } from './zset'

export interface INodeBBDatabaseBackend {
  init(): Promise<void>

  createSessionStore(options: any): Promise<Store>

  createIndices(callback: () => void): Promise<void>

  checkCompatibility(callback: () => void): Promise<void>

  checkCompatibilityVersion(
    version: string,
    callback: () => void,
  ): Promise<void>

  info(db: any): Promise<any>

  close(): Promise<void>

  flushdb(): Promise<void>

  emptydb(): Promise<void>
}

export type RedisStyleMatchString =
  | string
  | `*${string}`
  | `${string}*`
  | `*${string}*`
export type RedisStyleRangeString = `${'(' | '['}${string}`

export enum ObjectType {
  HASH = 'hash',
  LIST = 'list',
  SET = 'set',
  STRING = 'string',
  SORTED_SET = 'zset',
}
