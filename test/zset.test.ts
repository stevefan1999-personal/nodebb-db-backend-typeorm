import { suite, test, timeout } from '@testdeck/jest'
import * as _ from 'lodash'
import { Inject, Service } from 'typedi'

import { DATABASE } from './setup'

import type { TypeORMDatabaseBackend } from '~/index'

@suite
@timeout(60000)
@Service()
export class SortedSetTest {
  static db: TypeORMDatabaseBackend
  db: TypeORMDatabaseBackend

  constructor(
    @Inject(DATABASE)
    private readonly dbFactory: () => TypeORMDatabaseBackend,
  ) {}

  async before(): Promise<void> {
    if (!SortedSetTest.db) {
      this.db = SortedSetTest.db = this.dbFactory()
    }
    await this.db.flushdb()
  }

  static async after(): Promise<void> {
    await SortedSetTest.db.close()
  }

  @test
  async 'test basic usage'(): Promise<void> {
    await this.db.sortedSetAdd('test', 10, 'foo')
    await this.db.sortedSetAdd('test', 20, 'bar')
    await this.db.sortedSetAdd('test1', 3, 'qux')
    await this.db.sortedSetAdd('test1', 2, 'bar')
    //
    expect(await this.db.getSortedSetsMembers(['test', 'test1'])).toStrictEqual(
      [
        ['foo', 'bar'],
        ['bar', 'qux'],
      ],
    )
    //
    await this.db.sortedSetAddBulk([
      ['interCard1', [0, 0, 0], ['value1', 'value2', 'value3']],
      ['interCard2', [0, 0, 0], ['value2', 'value3', 'value4']],
      ['interCard3', [0, 0, 0], ['value3', 'value4', 'value5']],
      ['interCard4', [0, 0, 0], ['value4', 'value5', 'value6']],
    ])

    await this.db.sortedSetAdd(
      'sortedSetTest1',
      [1.1, 1.2, 1.3],
      ['value1', 'value2', 'value3'],
    )
    await this.db.sortedSetAdd('sortedSetTest2', [1, 4], ['value1', 'value4'])
    await this.db.sortedSetAdd('sortedSetTest3', [2, 4], ['value2', 'value4'])
    expect(
      await this.db.sortedSetsRanks(
        ['sortedSetTest1', 'sortedSetTest2'],
        ['value1', 'value4'],
      ),
    ).toStrictEqual([0, 1])
    expect(
      await this.db.sortedSetRanks('sortedSetTest1', [
        'value2',
        'value1',
        'value3',
        'value4',
      ]),
    ).toStrictEqual([1, 0, 2, null])

    expect(
      await this.db.sortedSetRevRanks('sortedSetTest1', [
        'value2',
        'value1',
        'value3',
        'value4',
      ]),
    ).toStrictEqual([1, 2, 0, null])

    expect(
      await this.db.sortedSetUnionCard(['sortedSetTest2', 'sortedSetTest3']),
    ).toBe(3)

    expect(
      await this.db.sortedSetIntersectCard([
        'interCard1',
        'interCard2',
        'interCard3',
      ]),
    ).toBe(1)

    expect(
      await this.db.sortedSetIntersectCard(['interCard1', 'interCard4']),
    ).toBe(0)

    expect(await this.db.sortedSetCount('sortedSetTest1', '-inf', 1.2)).toBe(2)

    expect(await this.db.sortedSetCount('sortedSetTest1', '-inf', '+inf')).toBe(
      3,
    )

    expect(
      await this.db.isSortedSetMembers('sortedSetTest1', [
        'value1',
        'value2',
        'value5',
      ]),
    ).toStrictEqual([true, true, false])
  }

  @test
  async 'test membership query'(): Promise<void> {
    await this.db.sortedSetAdd('foo', 0, 'bar')
    expect(await this.db.isSortedSetMember('foo', 'bar')).toBeTruthy()
    expect(await this.db.isSortedSetMember('foo', 'baz')).toBeFalsy()
    expect(await this.db.isSortedSetMembers('foo', ['bar'])).toStrictEqual([
      true,
    ])
    expect(
      await this.db.isSortedSetMembers('foo', ['bar', 'baz']),
    ).toStrictEqual([true, false])
  }

  @test
  async 'test getSortedSetMembers'(): Promise<void> {
    await this.db.sortedSetAdd('foo1', 1, 'baz')
    await this.db.sortedSetAdd('foo1', 2, 'qux')
    await this.db.sortedSetAdd('foo1', 1.5, 'poo')
    expect(await this.db.getSortedSetMembers('foo1')).toStrictEqual([
      'baz',
      'poo',
      'qux',
    ])
  }

  @test
  async 'test sortedSetLexCount'(): Promise<void> {
    await this.db.sortedSetAdd(
      'sortedSetLex',
      [0, 0, 0, 0],
      ['a', 'b', 'c', 'd'],
    )
    expect(await this.db.sortedSetLexCount('sortedSetLex', '-', '+')).toBe(4)
    expect(await this.db.sortedSetLexCount('sortedSetLex', 'a', 'd')).toBe(4)
    expect(await this.db.sortedSetLexCount('sortedSetLex', '[a', '[d')).toBe(4)
    expect(await this.db.sortedSetLexCount('sortedSetLex', '(a', '(d')).toBe(2)
  }

  @test
  async 'test getSortedSetsMembers'(): Promise<void> {
    await this.db.sortedSetAdd('foo', 1, 'baz')
    await this.db.sortedSetAdd('foo', 2, 'qux')
    await this.db.sortedSetAdd('foo', 1.5, 'poo')

    await this.db.sortedSetAdd('bar', 3, 'qux')
    await this.db.sortedSetAdd('bar', 2, 'baz')
    await this.db.sortedSetAdd('bar', 1, 'poo')

    expect(await this.db.getSortedSetsMembers(['foo', 'bar'])).toSatisfy(
      (arr) =>
        _.isMatch(arr, [
          ['baz', 'poo', 'qux'],
          ['poo', 'baz', 'qux'],
        ]),
    )
  }

  @test
  async 'test isMemberOfSortedSets'(): Promise<void> {
    await this.db.sortedSetAdd('foo', 1, 'bar')
    await this.db.sortedSetAdd('foo', 2, 'baz')

    await this.db.sortedSetAdd('bar', 1, 'poo')
    await this.db.sortedSetAdd('bar', 2, 'baz')

    expect(
      await this.db.isMemberOfSortedSets(['foo', 'bar'], 'bar'),
    ).toStrictEqual([true, false])

    expect(
      await this.db.isMemberOfSortedSets(['foo', 'bar'], 'baz'),
    ).toStrictEqual([true, true])
  }

  @test
  async 'test existence check'(): Promise<void> {
    expect(await this.db.sortedSetScore('doesnotexist', 'value1')).toBeNull()
  }

  @test
  async 'test range'(): Promise<void> {
    await this.db.sortedSetAdd('dupezset1', [1, 2], ['value 1', 'value 2'])
    await this.db.sortedSetAdd('dupezset2', [2, 3], ['value 2', 'value 3'])
    await this.db.sortedSetAdd(
      'dupezset3',
      [1, 2, 3],
      ['value 1', 'value 2', 'value3'],
    )
    await this.db.sortedSetAdd('dupezset4', [0, 5], ['value 0', 'value5'])

    expect(
      await this.db.getSortedSetRange(['dupezset1', 'dupezset2'], 0, -1),
    ).toEqual(['value 1', 'value 2', 'value 2', 'value 3'])

    expect(
      await this.db.getSortedSetRevRange(['dupezset3', 'dupezset4'], 0, 1),
    ).toEqual(['value5', 'value3'])

    const negatives: { keys: number[]; values: string[] } = {
      keys: [],
      values: [],
    }

    for (const [k, v] of _.shuffle(
      Object.entries({
        1: 10,
        2: 15,
        3: 20,
        4: 25,
        5: 30,
      }),
    )) {
      negatives.keys.push(Number(k))
      negatives.values.push(String(v))
    }

    await this.db.sortedSetAdd('negatives', negatives.keys, negatives.values)
    expect(await this.db.getSortedSetRange('negatives', -4, -2)).toEqual([
      '15',
      '20',
      '25',
    ])
    expect(await this.db.getSortedSetRevRange('negatives', -4, -2)).toEqual([
      '25',
      '20',
      '15',
    ])
    expect(await this.db.getSortedSetRevRange('negatives', -5, -1)).toEqual([
      '30',
      '25',
      '20',
      '15',
      '10',
    ])

    await this.db.sortedSetAdd(
      'sortedSetTest1',
      [1.1, 1.2, 1.3],
      ['value1', 'value2', 'value3'],
    )
    expect(await this.db.getSortedSetRange(['sortedSetTest1'], 0, -1)).toEqual([
      'value1',
      'value2',
      'value3',
    ])
  }

  @test
  async 'test emptiness query'(): Promise<void> {
    await this.db.sortedSetAdd('emptyTest', [0], ['0'])
    await this.db.sortedSetRemove('emptyTest', '0')
    expect(await this.db.exists('emptyTest')).toBeFalsy()
  }

  @test
  async 'test card'(): Promise<void> {
    await this.db.sortedSetAdd('test', 10, 'foo')
    await this.db.sortedSetAdd('test', 20, 'bar')
    expect(await this.db.sortedSetCard('test')).toBe(2)

    await this.db.sortedSetAdd('test', 15, 'baz')
    expect(await this.db.sortedSetCard('test')).toBe(3)
  }

  @test
  async 'test rank'(): Promise<void> {
    await this.db.sortedSetAdd('test', [10, 20, 15], ['foo', 'bar', 'baz'])

    expect(await this.db.sortedSetRank('test', 'baz')).toBe(1)
    expect(
      await this.db.sortedSetRanks('test', ['bar', 'foo', 'baz']),
    ).toStrictEqual([2, 0, 1])

    expect(
      await this.db.sortedSetsRanks(
        ['test', 'test1', 'test'],
        ['bar', 'foo', 'baz'],
      ),
    ).toStrictEqual([2, null, 1])
  }

  @test
  async 'test intersect card'(): Promise<void> {
    await this.db.sortedSetAddBulk([
      ['zset1', [1, 2, 3, 4, 5], ['one', 'two', 'three', 'four', 'five']],
      ['zset2', [1, 2, 3, 4], ['one', 'two', 'three', 'four']],
      ['zset3', [1, 2, 3], ['one', 'two', 'three']],
      ['zset4', [1, 2], ['one', 'two']],
    ])

    expect(await this.db.sortedSetIntersectCard(['zset1', 'zset2'])).toEqual(4)
    expect(await this.db.sortedSetIntersectCard(['zset1', 'zset3'])).toEqual(3)
    expect(await this.db.sortedSetIntersectCard(['zset1', 'zset4'])).toEqual(2)
    expect(await this.db.sortedSetIntersectCard(['zset2', 'zset3'])).toEqual(3)
    expect(await this.db.sortedSetIntersectCard(['zset2', 'zset4'])).toEqual(2)
    expect(await this.db.sortedSetIntersectCard(['zset3', 'zset4'])).toEqual(2)
    expect(
      await this.db.sortedSetIntersectCard(['zset1', 'zset2', 'zset3']),
    ).toEqual(3)
    expect(
      await this.db.sortedSetIntersectCard(['zset1', 'zset2', 'zset4']),
    ).toEqual(2)
    expect(
      await this.db.sortedSetIntersectCard(['zset1', 'zset3', 'zset4']),
    ).toEqual(2)

    expect(
      await this.db.sortedSetIntersectCard(['zset2', 'zset3', 'zset4']),
    ).toEqual(2)
  }

  @test
  async 'test intersect'(): Promise<void> {
    await this.db.sortedSetAddBulk([
      ['zset1', [1, 2], ['one', 'two']],
      ['zset2', [1, 2, 3], ['one', 'two', 'three']],
      ['zset3', [3, 4, 5], ['foo', 'bar', 'baz']],
      ['zset4', [5, 4, 3], ['foo', 'bar', 'baz']],
      ['zset5', [3, 4, 5], ['foo', 'bar', 'baz']],
    ])

    expect(
      await this.db.getSortedSetIntersect({
        sets: ['zset1', 'zset2'],
        sort: 'ASC',
        weights: [2, 3],
        withScores: false,
      }),
    ).toEqual(['one', 'two'])

    expect(
      await this.db.getSortedSetRevIntersect({
        sets: ['zset3', 'zset4', 'zset5'],
        weights: [2, 3, 4],
        withScores: true,
      }),
    ).toEqual([
      { score: 39, value: 'baz' },
      { score: 36, value: 'bar' },
      { score: 33, value: 'foo' },
    ])

    expect(
      await this.db.getSortedSetRevIntersect({
        sets: ['zset3', 'zset4', 'zset5'],
        weights: [2, 3, 4],
        withScores: false,
      }),
    ).toEqual(['baz', 'bar', 'foo'])

    expect(
      await this.db.getSortedSetRevIntersect({
        sets: ['zset3', 'zset4', 'zset5'],
        start: 1,
        weights: [2, 3, 4],
        withScores: true,
      }),
    ).toEqual([
      { score: 36, value: 'bar' },
      { score: 33, value: 'foo' },
    ])

    expect(
      await this.db.getSortedSetRevIntersect({
        aggregate: 'MIN',
        sets: ['zset3', 'zset4', 'zset5'],
        weights: [2, 3, 4],
        withScores: true,
      }),
    ).toEqual([
      { score: 9, value: 'baz' },
      { score: 8, value: 'bar' },
      { score: 6, value: 'foo' },
    ])

    await this.db.sortedSetAdd(
      'interSet1',
      [1, 2, 3],
      ['value1', 'value2', 'value3'],
    )
    await this.db.sortedSetAdd(
      'interSet2',
      [4, 5, 6],
      ['value2', 'value3', 'value5'],
    )
    expect(
      await this.db.getSortedSetRevIntersect({
        sets: ['interSet1', 'interSet2'],
        start: 0,
        stop: 2,
      }),
    ).toEqual(['value3', 'value2'])
  }

  @test
  async 'test lexicographic query'(): Promise<void> {
    await this.db.sortedSetAdd(
      'sortedSetLex',
      [0, 0, 0, 0],
      ['a', 'b', 'c', 'd'],
    )

    expect(
      await this.db.getSortedSetRangeByLex('sortedSetLex', '(a', '(d'),
    ).toEqual(['b', 'c'])

    expect(
      await this.db.getSortedSetRangeByLex('sortedSetLex', '-', '+', 0, 2),
    ).toEqual(['a', 'b'])

    await this.db.sortedSetAdd(
      'sortedSetLexSearch',
      [0, 0, 0],
      ['baris:usakli:1', 'baris usakli:2', 'baris soner:3'],
    )
    const query = 'baris:'
    const min = query
    const max =
      query.slice(0, -1) +
      String.fromCharCode(query.charCodeAt(query.length - 1) + 1)
    expect(
      await this.db.getSortedSetRangeByLex(
        'sortedSetLexSearch',
        min,
        max,
        0,
        -1,
      ),
    ).toStrictEqual(['baris:usakli:1'])

    expect(
      await this.db.getSortedSetRevRangeByLex('sortedSetLex', 'd', 'a'),
    ).toStrictEqual(['d', 'c', 'b', 'a'])
  }
}
