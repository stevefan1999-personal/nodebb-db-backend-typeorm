import _ from 'lodash'
import winston from 'winston'

import { cartesianProduct } from '~/utils'

import {
  baselines,
  DatabaseCreationFailed,
  DataSource,
  initDataSourceAndCache,
} from './datasources'

export function testWithBaseline(
  _target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor,
): void {
  let newParametersSymbol: any[]
  if (descriptor.value.__testdeck_parametersSymbol?.length > 0) {
    const symbols: [symbol: any, index: number][] =
      descriptor.value.__testdeck_parametersSymbol
        .reverse()
        .map((symbol: any, i: number) => [symbol, i])

    newParametersSymbol = []
    for (const [[symbol, i], baseline] of cartesianProduct([
      symbols,
      baselines,
    ])) {
      const symbol2 = _.cloneDeep(symbol)
      const baseName = symbol2.name ?? `${propertyKey} ${i}`
      symbol2.name = `${baseName} <${baseline}>`
      symbol2.params = [symbol2.params, baseline]
      newParametersSymbol.push(symbol2)
    }
    newParametersSymbol.reverse()
  } else {
    newParametersSymbol = baselines.map((baseline) => ({
      name: baseline,
      params: [undefined, baseline],
    }))
  }

  const origMethod = descriptor.value

  descriptor.value = function (
    done: () => void,
    [params, baseline]: [any, DataSource],
  ) {
    void (async function run() {
      try {
        const db = await initDataSourceAndCache(baseline)
        await origMethod(...(params ?? []), db, done)
      } catch (e) {
        if (e instanceof DatabaseCreationFailed) {
          console.warn(`[skipped]: ${baseline}`, e)
        } else {
          throw e
        }
      } finally {
        done()
      }
    })()
  }

  // Testdeck related symbol fix
  descriptor.value.__testdeck_name = origMethod.__testdeck_name
  if (newParametersSymbol.length > 0) {
    descriptor.value.__testdeck_parametersSymbol = newParametersSymbol
  }
}
