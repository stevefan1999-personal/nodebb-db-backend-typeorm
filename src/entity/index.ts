import 'reflect-metadata'

import { HashObject } from './hash'
import { ListObject } from './list'
import { DbObject, ObjectType } from './object'
import { HashSetObject } from './set'
import { StringObject } from './string'
import { SortedSetObject } from './zset'

export const entities = {
  DbObject,
  HashObject,
  HashSetObject,
  ListObject,
  SortedSetObject,
  StringObject,
}

export {
  HashObject,
  ListObject,
  DbObject,
  ObjectType,
  HashSetObject,
  StringObject,
  SortedSetObject,
}
