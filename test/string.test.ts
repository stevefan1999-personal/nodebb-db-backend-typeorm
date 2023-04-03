import { suite, test, timeout } from '@testdeck/jest'
import { Inject, Service } from 'typedi'

import { DATABASE } from './setup'

import type { TypeORMDatabaseBackend } from '~/index'

@suite
@timeout(60000)
@Service()
export class StringTest {
  static db: TypeORMDatabaseBackend
  db: TypeORMDatabaseBackend

  constructor(
    @Inject(DATABASE)
    private readonly dbFactory: () => TypeORMDatabaseBackend,
  ) {}

  async before(): Promise<void> {
    if (!StringTest.db) {
      this.db = StringTest.db = this.dbFactory()
    }
    await this.db.flushdb()
  }

  static async after(): Promise<void> {
    await StringTest.db.close()
  }

  @test
  async 'test simple string'(): Promise<void> {
    await this.db.set('test', '3456')
    expect(await this.db.exists('test')).toBeTruthy()
    expect(await this.db.get('test')).toBe('3456')
    expect(await this.db.scan({ match: 'test' })).toIncludeSameMembers(['test'])

    await this.db.delete('test')
    await this.db.increment('test')
    await this.db.rename('test', 'test1')
    expect(await this.db.exists('test')).toBeFalsy()
    expect(await this.db.exists('test1')).toBeTruthy()
  }
}
