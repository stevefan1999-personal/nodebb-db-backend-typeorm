import { suite, test, timeout } from '@testdeck/jest'
import { Inject, Service } from 'typedi'

import { DATABASE } from './setup'

import type { TypeORMDatabaseBackend } from '~/index'

@suite
@timeout(60000)
@Service()
export class ListTest {
  static db: TypeORMDatabaseBackend
  db: TypeORMDatabaseBackend

  constructor(
    @Inject(DATABASE)
    private readonly dbFactory: () => TypeORMDatabaseBackend,
  ) {}

  async before(): Promise<void> {
    if (!ListTest.db) {
      this.db = ListTest.db = this.dbFactory()
    }
    await this.db.flushdb()
  }

  static async after(): Promise<void> {
    await ListTest.db.close()
  }

  @test
  async 'test append'(): Promise<void> {
    await this.db.listAppend('test', 'a')
    await this.db.listAppend('test', 'b')
    await this.db.listAppend('test', 'c')
    await this.db.listAppend('test', 'd')
    expect(await this.db.listLength('test')).toBe(4)
    expect(await this.db.getListRange('test', 0, 3)).toStrictEqual([
      'a',
      'b',
      'c',
      'd',
    ])
    expect(await this.db.listRemoveLast('test')).toEqual('d')
    expect(await this.db.listRemoveLast('test')).toEqual('c')
    expect(await this.db.listRemoveLast('test')).toEqual('b')
    expect(await this.db.listRemoveLast('test')).toEqual('a')
  }

  @test
  async 'test prepend'(): Promise<void> {
    await this.db.listPrepend('test', 'a')
    await this.db.listPrepend('test', 'b')
    await this.db.listPrepend('test', 'c')
    await this.db.listPrepend('test', 'd')
    expect(await this.db.listLength('test')).toBe(4)
    expect(await this.db.getListRange('test', 0, 3)).toStrictEqual([
      'd',
      'c',
      'b',
      'a',
    ])

    expect(await this.db.listRemoveLast('test')).toEqual('a')
    expect(await this.db.listRemoveLast('test')).toEqual('b')
    expect(await this.db.listRemoveLast('test')).toEqual('c')
    expect(await this.db.listRemoveLast('test')).toEqual('d')
  }

  async runTrim({
    expected,
    input,
    trim: { start, stop },
    name = 'test',
  }: {
    name?: string
    expected: string[]
    input: string[]
    trim: { start: number; stop: number }
  }): Promise<void> {
    for (const value of input) {
      await this.db.listAppend(name, value)
    }
    expect(await this.db.listLength(name)).toBe(input.length)
    await this.db.listTrim(name, start, stop)
    expect(await this.db.listLength(name)).toBe(expected.length)
    expect(await this.db.getListRange(name, 0, -1)).toStrictEqual(expected)
  }

  // Case when start > 0, stop > start, e.g. {start: 1, stop: 4}
  // Ex1: [0 {1 2 3 4} 5 6 7] {start: 1, stop: 4}
  // Ex2: [0 1 2 3 {4 5} 6 7] {start: 4, stop: 5}
  // Ex2: [0 1 2 {3 4 5 6} 7] {start: 3, stop: 6}
  @test
  async 'test trim > normal > ex1'(): Promise<void> {
    await this.runTrim({
      expected: ['1', '2', '3', '4'],
      input: ['0', '1', '2', '3', '4', '5', '6', '7'],
      trim: { start: 1, stop: 4 },
    })
  }

  @test
  async 'test trim > normal > ex2'(): Promise<void> {
    await this.runTrim({
      expected: ['4', '5'],
      input: ['0', '1', '2', '3', '4', '5', '6', '7'],
      trim: { start: 4, stop: 5 },
    })
  }

  @test
  async 'test trim > normal > ex3'(): Promise<void> {
    await this.runTrim({
      expected: ['3', '4', '5', '6'],
      input: ['0', '1', '2', '3', '4', '5', '6', '7'],
      trim: { start: 3, stop: 6 },
    })
  }

  // Case when start >= 0, stop < 0, e.g.
  // Ex1. [0 1 {2 3 4 5 6} 7] {start: 2, stop: -2}
  // Ex2. [a {b c} d e] {start: 1, stop -3}
  // Ex3. [0 {1 2 3 4 5} 6 7 8 9 10] {start: 1, stop: -6}
  @test
  async 'test trim > negative end > ex1'(): Promise<void> {
    await this.runTrim({
      expected: ['2', '3', '4', '5', '6'],
      input: ['0', '1', '2', '3', '4', '5', '6', '7'],
      trim: { start: 2, stop: -2 },
    })

    await this.runTrim({
      expected: ['b', 'c'],
      input: ['a', 'b', 'c', 'd', 'e'],
      name: 'test1',
      trim: { start: 1, stop: -3 },
    })
  }

  @test
  async 'test trim > negative end > ex2'(): Promise<void> {
    await this.runTrim({
      expected: ['b', 'c'],
      input: ['a', 'b', 'c', 'd', 'e'],
      trim: { start: 1, stop: -3 },
    })
  }

  @test
  async 'test trim > negative end > ex3'(): Promise<void> {
    await this.runTrim({
      expected: ['1', '2', '3', '4', '5'],
      input: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
      trim: { start: 1, stop: -6 },
    })
  }

  // Case when start < 0, stop > start
  // Ex1. [0 1 2 3 {4 5 6} 7] {start: -4, stop: -2}
  // Ex2. [2 {4 6 8 10 12}] {start: -5, stop: -1}
  // Ex3. [a b c d {e f g} h i j] {start: -6, stop: -4}
  @test
  async 'test trim > negative both > ex1'(): Promise<void> {
    await this.runTrim({
      expected: ['4', '5', '6'],
      input: ['0', '1', '2', '3', '4', '5', '6', '7'],
      trim: { start: -4, stop: -2 },
    })
  }

  @test
  async 'test trim > negative both > ex2'(): Promise<void> {
    await this.runTrim({
      expected: ['4', '6', '8', '10', '12'],
      input: ['2', '4', '6', '8', '10', '12'],
      trim: { start: -5, stop: -1 },
    })
  }

  @test
  async 'test trim > negative both > ex3'(): Promise<void> {
    await this.runTrim({
      expected: ['e', 'f', 'g'],
      input: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
      trim: { start: -6, stop: -4 },
    })
  }

  @test
  async 'test list'(): Promise<void> {
    await this.db.listAppend('test', 'a')
    await this.db.listPrepend('test', 'b')
    await this.db.listAppend('test', 'c')
    await this.db.listPrepend('test', 'd')
    //
    expect(await this.db.listLength('test')).toBe(4)
    expect(await this.db.getListRange('test', 0, 4)).toStrictEqual([
      'd',
      'b',
      'a',
      'c',
    ])
    //
    expect(await this.db.getListRange('test', 2, 2)).toStrictEqual(['a'])

    expect(await this.db.listRemoveLast('test')).toEqual('c')
    expect(await this.db.listLength('test')).toBe(3)
    expect(await this.db.getListRange('test', 0, 3)).toStrictEqual([
      'd',
      'b',
      'a',
    ])
  }
}
