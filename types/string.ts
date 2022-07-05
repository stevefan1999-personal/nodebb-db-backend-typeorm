import { ObjectType, RedisStyleMatchString } from './index'

export interface StringQueryable {
  exists(key: string): Promise<boolean>

  exists(key: string[]): Promise<boolean[]>

  scan(params: { match: RedisStyleMatchString }): Promise<string[]>

  delete(key: string): Promise<void>

  deleteAll(keys: string[]): Promise<void>

  get(key: string): Promise<string>

  set(key: string, value: string): Promise<void>

  increment(key: string): Promise<number>

  rename(oldkey: string, newkey: string): Promise<void>

  type(key: string): Promise<ObjectType>

  expire(key: string, seconds: number): Promise<void>

  expireAt(key: string, timestamp: Date): Promise<void>

  pexpire(key: string, ms: number): Promise<void>

  pexpireAt(key: string, timestamp: Date): Promise<void>

  ttl(key: string): Promise<number>

  pttl(key: string): Promise<number>
}
