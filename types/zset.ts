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
  getSortedSetIntersect(
    params: SortedSetTheoryOperation,
  ): Promise<string[] | { value: string; score: number }[]>

  getSortedSetMembers(key: string): Promise<string>

  getSortedSetRange(key: string, start: number, stop: number): Promise<string[]>

  getSortedSetRangeByLex(
    key: string,
    min: RedisStyleRangeString,
    max: RedisStyleRangeString,
    start: number,
    count: number,
  ): Promise<string[]>

  getSortedSetRangeByScore(
    key: string,
    start: number,
    count: number,
    min: string,
    max: number,
  ): Promise<string[]>

  getSortedSetRangeByScoreWithScores(
    key: string,
    start: number,
    count: number,
    min: string,
    max: number,
  ): Promise<{ value: string; score: number }[]>

  getSortedSetRangeWithScores(
    key: string,
    start: number,
    stop: number,
  ): Promise<{ value: string; score: number }[]>

  getSortedSetRevIntersect(
    params: SortedSetTheoryOperation,
  ): Promise<string[] | { value: string; score: number }[]>

  getSortedSetRevRange(
    key: string,
    start: number,
    stop: number,
  ): Promise<string[]>

  getSortedSetRevRangeByLex(
    key: string,
    max: RedisStyleRangeString,
    min: RedisStyleRangeString,
    start: number,
    count: number,
  ): Promise<string[]>

  getSortedSetRevRangeByScore(
    key: string,
    start: number,
    count: number,
    max: string,
    min: number,
  ): Promise<string[]>

  getSortedSetRevRangeByScoreWithScores(
    key: string,
    start: number,
    count: number,
    max: string,
    min: number,
  ): Promise<{ value: string; score: number }[]>

  getSortedSetRevRangeWithScores(
    key: string,
    start: number,
    stop: number,
  ): Promise<{ value: string; score: number }[]>

  getSortedSetRevUnion(
    params: SortedSetTheoryOperation,
  ): Promise<string[] | { value: string; score: number }[]>

  getSortedSetScan(params: {
    key: string
    match: RedisStyleMatchString
    limit: number
    withScores?: boolean
  }): Promise<string[] | { value: string; score: number }[]>

  getSortedSetUnion(
    params: SortedSetTheoryOperation,
  ): Promise<string[] | { value: string; score: number }[]>

  getSortedSetsMembers(keys: string[]): Promise<string[]>

  isMemberOfSortedSets(keys: string[], value: string): Promise<boolean[]>

  isSortedSetMember(key: string, value: string): Promise<boolean>

  isSortedSetMembers(key: string, values: string[]): Promise<boolean[]>

  processSortedSet(
    setKey: string,
    processFn: (ids: number[]) => Promise<void> | void,
    options: { withScores?: boolean; batch?: number; interval?: number },
  ): Promise<any>

  sortedSetAdd(
    key: string,
    score: number | number[],
    value: string,
  ): Promise<void>

  sortedSetAddBulk(
    data: [key: string, score: number, value: string][],
  ): Promise<void>

  sortedSetCard(key: string): Promise<number>

  sortedSetCount(key: string, min: string, max: number): Promise<number>

  sortedSetIncrBy(
    key: string,
    increment: number,
    value: string,
  ): Promise<number>

  sortedSetIncrByBulk(
    data: [key: string, increment: number, value: string][],
  ): Promise<number[]>

  sortedSetIntersectCard(keys: string[]): Promise<number>

  sortedSetLexCount(
    key: string,
    min: RedisStyleRangeString,
    max: RedisStyleRangeString,
  ): Promise<number>

  sortedSetRank(key: string, value: string): Promise<number>

  sortedSetRanks(key: string, values: string[]): Promise<number[]>

  sortedSetRemove(key: string, value: string): Promise<void>

  sortedSetRemoveBulk(data: [key: string, member: string][]): Promise<void>

  sortedSetRemoveRangeByLex(
    key: string,
    min: RedisStyleRangeString,
    max: RedisStyleRangeString,
  ): Promise<void>

  sortedSetRevRank(key: string, value: string): Promise<number>

  sortedSetRevRanks(key: string, values: string[]): Promise<number[]>

  sortedSetScore(key: string, value: string): Promise<number>

  sortedSetScores(key: string, values: string[]): Promise<number[]>

  sortedSetUnionCard(keys: string[]): Promise<number>

  sortedSetsAdd(keys: string[], scores: number[], value: string): Promise<void>

  sortedSetsCard(keys: string[]): Promise<number[]>

  sortedSetsCardSum(keys: string[]): Promise<number>

  sortedSetsRanks(keys: string[], values: string[]): Promise<number[]>

  sortedSetsRemove(keys: string[], value: string): Promise<void>

  sortedSetsRemoveRangeByScore(
    keys: string[],
    min: number | '-inf',
    max: number | '+inf',
  ): Promise<void>

  sortedSetsRevRanks(keys: string[], values: string[]): Promise<number[]>

  sortedSetsScore(keys: string[], value: string): Promise<number[]>
}
