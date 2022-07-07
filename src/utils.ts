import { MoreThan, MoreThanOrEqual } from 'typeorm'
import { FindOperator } from 'typeorm/find-options/FindOperator'

import { RedisStyleMatchString, RedisStyleRangeString } from '../types'

export function convertRedisStyleMatchToSqlWildCard(
  input: RedisStyleMatchString,
): [query: string, hasWildcard: boolean] {
  let query = input
  let hasWildcard = false
  if (query.startsWith('*')) {
    query = `%${query.slice(1)}`
    hasWildcard = true
  }
  if (query.endsWith('*')) {
    query = `${query.slice(0, -1)}%`
    hasWildcard = true
  }
  return [query, hasWildcard]
}

export function convertRedisStyleRangeStringToTypeormCriterion(
  input: RedisStyleRangeString,
): FindOperator<number> {
  const [first, ...rest] = input
  if (first === '(') {
    return MoreThan(Number(rest.join()))
  }
  if (first === '[') {
    return MoreThanOrEqual(Number(rest.join()))
  }
  return MoreThanOrEqual(Number(input))
}

export const cartesianProduct = <T>(...sets: T[][]): T[][] =>
  sets.reduce<T[][]>(
    (accSets, set) =>
      accSets.flatMap((accSet) => set.map((value) => [...accSet, value])),
    [[]],
  )
