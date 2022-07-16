import { suite, test, timeout } from '@testdeck/jest'

import { TestSuiteBase } from './suite_base'

@suite()
@timeout(60000)
export class ListTest extends TestSuiteBase {
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
