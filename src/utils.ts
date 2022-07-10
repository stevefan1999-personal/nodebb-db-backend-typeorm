import { MoreThan, MoreThanOrEqual } from 'typeorm'
import { FindOperator } from 'typeorm/find-options/FindOperator'

import { RedisStyleMatchString, RedisStyleRangeString } from '../types'

export function fixRange(
  start: number,
  stop: number,
): {
  offset: number
  limit?: number
} {
  // given an example of [1 2 3 4 5 6]

  // if we have something like {start:0, stop: -2}
  // we certainly cant make assumption about row sizes but
  if (start === 0 && stop < 0) {
    // we can flip the rows around
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

export function validateInput<T>(arrays: T[][]): void {
  if (!Array.isArray(arrays)) {
    throw new TypeError('Argument must be an array of arrays')
  }

  arrays.forEach(validateArray)
  validateDimensions(arrays)
  validateCombinations(arrays)
}

function validateArray<T>(array: T[]): void {
  if (!Array.isArray(array)) {
    throw new TypeError(`Argument must be an array: ${array}`)
  }
}

// Maximum number of nested `for` loops. In my machine, it's 604 but it is
// engine-specific so we use a safe number. Above the limit, a max call stack
// error is thrown by the engine.
function validateDimensions({ length }: { length: number }): void {
  if (length >= MAX_DIMENSIONS) {
    throw new TypeError(
      `Too many arrays (${length}): please use the 'big-cartesian' library instead of 'fast-cartesian'`,
    )
  }
}

const MAX_DIMENSIONS = 1e2

// Max array size in JavaScript. This is the limit of th e final return value.
function validateCombinations<T>(arrays: T[][]): void {
  const size = arrays.reduce((n, array) => n * array.length, 1)

  if (size >= MAX_SIZE) {
    const sizeStr = Number.isFinite(size) ? ` (${size.toExponential(0)})` : ''
    throw new TypeError(
      `Too many combinations${sizeStr}: please use the 'big-cartesian' library instead of 'fast-cartesian'`,
    )
  }
}

// eslint-disable-next-line no-magic-numbers
const MAX_SIZE = 2 ** 32

export function cartesianProduct<InputArrays extends any[][]>(
  factors: [...InputArrays],
): InputArrays extends []
  ? []
  : {
      [index in keyof InputArrays]: InputArrays[index] extends Array<
        infer InputElement
      >
        ? InputElement
        : never
    }[]

export function cartesianProduct(arrays: any[]): any[] {
  validateInput(arrays)

  if (arrays.length === 0) {
    return []
  }

  const loopFunc = getLoopFunc(arrays.length)
  const result: any[] = []
  loopFunc(arrays, result)
  return result
}

function getLoopFunc(length: number): (arrays: any[], results: any[]) => void {
  const cachedLoopFunc = cache[length]

  if (cachedLoopFunc !== undefined) {
    return cachedLoopFunc
  }

  const loopFunc = mGetLoopFunc(length)
  cache[length] = loopFunc
  return loopFunc
}

const cache: {
  [length: number]: (arrays: any[], results: [any, any][]) => void
} = {}

// Create a function with `new Function()` that does:
//   function(arrays, results) {
//     for (const value0 of arrays[0]) {
//       for (const value1 of arrays[1]) {
//         // and so on
//         results.push([value0, value1])
//       }
//     }
//   }
function mGetLoopFunc(length: number): (arrays: any[], results: any[]) => void {
  const indexes = Array.from({ length }, (_, index) => String(index))
  const start = indexes
    .map((index) => `for (const value${index} of arrays[${index}]) {`)
    .join('\n')
  const middle = indexes.map((index) => `value${index}`).join(', ')
  const end = '}\n'.repeat(length)

  // eslint-disable-next-line no-new-func
  // @ts-ignore
  return new Function(
    'arrays',
    'result',
    `${start}\nresult.push([${middle}])\n${end}`,
  )
}
