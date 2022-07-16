import { suite, test, timeout } from '@testdeck/jest'

import { TestSuiteBase } from './suite_base'

@suite()
@timeout(60000)
export class StringTest extends TestSuiteBase {
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
