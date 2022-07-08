import 'jest-extended'
import { suite, test } from '@testdeck/jest'

import { TypeORMDatabaseBackend } from '../src'

@suite
export class TestSuite {
  private db: TypeORMDatabaseBackend

  async before(): Promise<void> {
    this.db = new TypeORMDatabaseBackend()
    await this.db.init({
      database: './test.db',
      dropSchema: true,
      synchronize: true,
      type: 'sqlite',
    })
    await this.db.flushdb()
  }

  async after(): Promise<void> {
    await this.db.close()
    delete this.db
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

  @test
  async 'test set'(): Promise<void> {
    await this.db.setAdd('test', '1234')
    await this.db.setAdd('test', ['5678', 'abcd'])
    await this.db.setsAdd(['test', 'test1'], ['5678', 'abcd'])
    expect(await this.db.exists('test')).toBeTruthy()
    expect(await this.db.setCount('test')).toBe(3)
    expect(await this.db.getSetMembers('test')).toIncludeSameMembers([
      '1234',
      '5678',
      'abcd',
    ])

    expect(
      await this.db.getSetsMembers(['test', 'test1']),
    ).toIncludeSameMembers([
      ['1234', '5678', 'abcd'],
      ['5678', 'abcd'],
    ])
    expect(await this.db.isSetMember('test', '1234')).toBeTruthy()
    expect(
      await this.db.isMemberOfSets(['test', 'test1'], '1234'),
    ).toStrictEqual([true, false])

    await this.db.setRemoveRandom('test1')
    expect(await this.db.setCount('test1')).toBe(1)
  }

  @test
  async 'test list'(): Promise<void> {
    await this.db.listAppend('test', 'a')
    await this.db.listPrepend('test', 'b')
    await this.db.listAppend('test', 'c')
    await this.db.listPrepend('test', 'd')

    expect(await this.db.listLength('test')).toBe(4)
    expect(await this.db.getListRange('test', 0, 4)).toStrictEqual([
      'd',
      'b',
      'a',
      'c',
    ])

    expect(await this.db.getListRange('test', 2, 3)).toStrictEqual(['a'])

    await this.db.listRemoveLast('test')
    expect(await this.db.listLength('test')).toBe(3)
    expect(await this.db.getListRange('test', 0, 3)).toStrictEqual([
      'd',
      'b',
      'a',
    ])
  }
}
