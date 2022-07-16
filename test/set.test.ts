import { suite, test, timeout } from '@testdeck/jest'

import { TestSuiteBase } from './suite_base'

@suite()
@timeout(60000)
export class HashSetTest extends TestSuiteBase {
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
      await this.db.isSetMembers('test', ['1234', 'nonexistent', 'abcd']),
    ).toStrictEqual([true, false, true])

    expect(
      await this.db.isMemberOfSets(['test', 'test1'], '1234'),
    ).toStrictEqual([true, false])

    await this.db.setRemoveRandom('test1')
    expect(await this.db.setCount('test1')).toBe(1)
  }
}
