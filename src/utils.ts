import { MoreThan, MoreThanOrEqual } from 'typeorm'
import { FindOperator } from 'typeorm/find-options/FindOperator'

import { RedisStyleMatchString, RedisStyleRangeString } from '../types'

export class Utils {
  static convertRedisStyleMatchToSqlWildCard(
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

  static convertRedisStyleRangeStringToTypeormCriterion(
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
}
