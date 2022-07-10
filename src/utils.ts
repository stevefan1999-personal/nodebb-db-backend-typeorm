import { MoreThan, MoreThanOrEqual } from 'typeorm'
import { FindOperator } from 'typeorm/find-options/FindOperator'

import { RedisStyleMatchString, RedisStyleRangeString } from '../types'

export function notOrder(sort: 'ASC' | 'DESC'): 'ASC' | 'DESC' {
  return sort === 'ASC' ? 'DESC' : 'ASC'
}

export function fixRange(
  start: number,
  stop: number,
): {
  offset: number
  relationReversed: boolean
  limit?: number
} {
  let relationReversed = false
  // given an example of [1 2 3 4 5 6]

  // if we have something like {start:0, stop: -2}
  // we certainly cant make assumption about row sizes but
  if (start === 0 && stop < 0) {
    // we can flip the rows around
    relationReversed = true
    // now the rows are [6 5 4 3 2 1]
    // we want to skip the first row (since we want from 0 until the penultimate entry)
    // which means offset by one -> [5 4 3 2 1]
    ;[start, stop] = [Math.abs(stop + 1), -1]
    // now we can flip this around and get [1 2 3 4 5] which is what we wanted
  } else if (start < 0 && stop > start) {
    // otherwise if we have something like {start: -4, stop: -2}
    // that mean we need element starting from penultimate until last 4 row
    // we can flip the rows around -> [6 5 4 3 2 1] and we want to start at second row
    // and select until fourth row -> [6 5 {4 3 2} 1] and then flip this around again
    // using our example -> [1 {2 3 4} 5 6] -> [2 3 4] selected which is 1..3
    // which is {start: abs(oldStop) + 1, stop: abs(oldStart) + 1}
    ;[start, stop] = [Math.abs(stop + 1), Math.abs(start + 1)]
  }
  // TODO: handle case such as {start: 1, end: -2} -> [1 {2 3 4} 5 6]
  // TODO: handle case such as {start: -1, end: -2}

  let limit = stop - start + 1
  if (limit <= 0) limit = undefined

  return {
    limit,
    offset: start,
    relationReversed,
  }
}

export const mapper =
  <T, U, V>(f: (base: T, input: U) => V, us: U[]) =>
  (x: T) =>
    us.map((member) => f(x, member))

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
