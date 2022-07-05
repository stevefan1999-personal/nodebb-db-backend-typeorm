import { RedisStyleMatchString, RedisStyleRangeString } from './index'

type SortedSetTheoryOperation = {
  sets: string[]
  start?: number
  stop?: number
  weights?: number[]
  withScores?: boolean
  aggregate?: 'SUM' | 'MIN' | 'MAX'
}

export interface SortedSetQueryable {
  getSortedSetRange(key: string, start: number, stop: number): Promise<string[]>

  getSortedSetRevRange(
    key: string,
    start: number,
    stop: number,
  ): Promise<string[]>

  getSortedSetRangeWithScores(
    key: string,
    start: number,
    stop: number,
  ): Promise<{ value: string; score: number }[]>

  getSortedSetRevRangeWithScores(
    key: string,
    start: number,
    stop: number,
  ): Promise<{ value: string; score: number }[]>

  getSortedSetRangeByScore(
    key: string,
    start: number,
    count: number,
    min: string,
    max: number,
  ): Promise<string[]>

  getSortedSetRevRangeByScore(
    key: string,
    start: number,
    count: number,
    max: string,
    min: number,
  ): Promise<string[]>

  getSortedSetRangeByScoreWithScores(
    key: string,
    start: number,
    count: number,
    min: string,
    max: number,
  ): Promise<{ value: string; score: number }[]>

  getSortedSetRevRangeByScoreWithScores(
    key: string,
    start: number,
    count: number,
    max: string,
    min: number,
  ): Promise<{ value: string; score: number }[]>

  sortedSetCount(key: string, min: string, max: number): Promise<number>

  sortedSetCard(key: string): Promise<number>

  sortedSetsCard(keys: string[]): Promise<number[]>

  sortedSetsCardSum(keys: string[]): Promise<number>

  sortedSetRank(key: string, value: string): Promise<number>

  sortedSetRevRank(key: string, value: string): Promise<number>

  sortedSetsRanks(keys: string[], values: string[]): Promise<number[]>

  sortedSetsRevRanks(keys: string[], values: string[]): Promise<number[]>

  sortedSetRanks(key: string, values: string[]): Promise<number[]>

  sortedSetRevRanks(key: string, values: string[]): Promise<number[]>

  sortedSetScore(key: string, value: string): Promise<number>

  sortedSetsScore(keys: string[], value: string): Promise<number[]>

  sortedSetScores(key: string, values: string[]): Promise<number[]>

  isSortedSetMember(key: string, value: string): Promise<boolean>

  isSortedSetMembers(key: string, values: string[]): Promise<boolean[]>

  isMemberOfSortedSets(keys: string[], value: string): Promise<boolean[]>

  getSortedSetMembers(key: string): Promise<string>

  getSortedSetsMembers(keys: string[]): Promise<string[]>

  sortedSetIncrBy(
    key: string,
    increment: number,
    value: string,
  ): Promise<number>

  sortedSetIncrByBulk(
    data: [key: string, increment: number, value: string][],
  ): Promise<number[]>

  getSortedSetRangeByLex(
    key: string,
    min: RedisStyleRangeString,
    max: RedisStyleRangeString,
    start: number,
    count: number,
  ): Promise<string[]>

  getSortedSetRevRangeByLex(
    key: string,
    max: RedisStyleRangeString,
    min: RedisStyleRangeString,
    start: number,
    count: number,
  ): Promise<string[]>

  sortedSetLexCount(
    key: string,
    min: RedisStyleRangeString,
    max: RedisStyleRangeString,
  ): Promise<number>

  sortedSetRemoveRangeByLex(
    key: string,
    min: RedisStyleRangeString,
    max: RedisStyleRangeString,
  ): Promise<void>

  getSortedSetScan(params: {
    key: string
    match: RedisStyleMatchString
    limit: number
    withScores?: boolean
  }): Promise<string[] | { value: string; score: number }[]>

  processSortedSet(
    setKey: string,
    processFn: (ids: number[]) => Promise<void> | void,
    options: { withScores?: boolean; batch?: number; interval?: number },
  ): Promise<any>

  // ??? wtf nodebb
  sortedSetAdd(
    key: string,
    score: number | number[],
    value: string,
  ): Promise<void>

  sortedSetsAdd(keys: string[], scores: number[], value: string): Promise<void>

  sortedSetAddBulk(
    data: [key: string, score: number, value: string][],
  ): Promise<void>

  sortedSetIntersectCard(keys: string[]): Promise<number>

  getSortedSetIntersect(
    params: SortedSetTheoryOperation,
  ): Promise<string[] | { value: string; score: number }[]>

  getSortedSetRevIntersect(
    params: SortedSetTheoryOperation,
  ): Promise<string[] | { value: string; score: number }[]>

  sortedSetRemove(key: string, value: string): Promise<void>

  sortedSetsRemove(keys: string[], value: string): Promise<void>

  sortedSetsRemoveRangeByScore(
    keys: string[],
    min: number | '-inf',
    max: number | '+inf',
  ): Promise<void>

  sortedSetRemoveBulk(data: [key: string, member: string][]): Promise<void>

  sortedSetUnionCard(keys: string[]): Promise<number>

  getSortedSetUnion(
    params: SortedSetTheoryOperation,
  ): Promise<string[] | { value: string; score: number }[]>

  getSortedSetRevUnion(
    params: SortedSetTheoryOperation,
  ): Promise<string[] | { value: string; score: number }[]>
}
