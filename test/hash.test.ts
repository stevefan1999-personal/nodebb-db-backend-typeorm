import { suite, test } from '@testdeck/jest'
import { Inject, Service } from 'typedi'

import { DATABASE } from './setup'

import type { TypeORMDatabaseBackend } from '~/index'

@suite
@Service()
export class HashTest {
  static db: TypeORMDatabaseBackend
  db: TypeORMDatabaseBackend

  constructor(
    @Inject(DATABASE)
    private readonly dbFactory: () => TypeORMDatabaseBackend,
  ) {}

  async before(): Promise<void> {
    if (!HashTest.db) {
      this.db = HashTest.db = this.dbFactory()
    }
    await this.db.flushdb()
  }

  static async after(): Promise<void> {
    await HashTest.db.close()
  }

  @test
  async 'test object'(): Promise<void> {
    await this.db.setObjectField(['test', 'test1'], 'foo', 'bar')
    expect(await this.db.getObjectField('test', 'foo')).toBe('bar')
    expect(await this.db.getObjectField('test1', 'foo')).toBe('bar')

    await this.db.setObjectField('test', 'bar', 1234)
    expect(await this.db.getObjectField('test', 'bar')).toBe(1234)

    await this.db.setObject(['test', 'test1'], {
      abcd: { test: 1234 },
      hello: 'world',
    })

    expect(await this.db.getObjectField('test', 'abcd')).toStrictEqual(
      await this.db.getObjectField('test1', 'abcd'),
    )

    expect(await this.db.getObjectKeys('test')).toIncludeAllMembers([
      'foo',
      'bar',
      'abcd',
      'hello',
    ])

    expect(await this.db.getObjectValues('test')).toIncludeAllMembers([
      { test: 1234 },
      'world',
      1234,
      'bar',
    ])
    expect(await this.db.getObject('test', [])).toStrictEqual({
      abcd: { test: 1234 },
      bar: 1234,
      foo: 'bar',
      hello: 'world',
    })
    expect(
      await this.db.getObject('test', ['foo', 'foo1', 'bar', 'abcd']),
    ).toStrictEqual({
      abcd: { test: 1234 },
      bar: 1234,
      foo: 'bar',
      foo1: null,
    })

    expect(await this.db.isObjectField('test', 'abcd')).toBeTruthy()
    await this.db.deleteObjectField('test', 'abcd')

    expect(await this.db.isObjectFields('test', ['abcd', 'foo'])).toBeTruthy()

    expect(await this.db.incrObjectField('test1', 'count')).toBe(1)

    expect(await this.db.getObjectField('test1', 'count')).toBe(1)

    expect(
      await this.db.incrObjectField(['test1', 'test6'], 'count'),
    ).toStrictEqual([2, 1])

    expect(
      await this.db.getObjectsFields(['test1', 'test6'], ['count']),
    ).toStrictEqual([{ count: 2 }, { count: 1 }])

    await this.db.incrObjectFieldByBulk([
      ['test1', { count: 2 }],
      ['test6', { count: 3 }],
    ])

    expect(
      await this.db.getObjectsFields(['test1', 'test6'], ['count']),
    ).toStrictEqual([{ count: 4 }, { count: 4 }])
  }
}
