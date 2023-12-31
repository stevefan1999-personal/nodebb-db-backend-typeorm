import 'reflect-metadata'

import { HashObject, HashObjectSubscriber } from './hash'
import { ListObject, ListObjectSubscriber, ReorderedListObject } from './list'
import { DbObject, DbObjectLive, ObjectType } from './object'
import { HashSetObject, HashSetObjectSubscriber } from './set'
import { StringObject, StringObjectSubscriber } from './string'
import {
  ReorderedSortedSetObject,
  SortedSetObject,
  SortedSetObjectSubscriber,
} from './zset'

export const entities = {
  DbObject,
  DbObjectLive,
  HashObject,
  HashSetObject,
  ListObject,
  ReorderedListObject,
  ReorderedSortedSetObject,
  SortedSetObject,
  StringObject,
}

export const subscribers = {
  HashObjectSubscriber,
  HashSetObjectSubscriber,
  ListObjectSubscriber,
  SortedSetObjectSubscriber,
  StringObjectSubscriber,
}

export {
  DbObject,
  HashObject,
  HashObjectSubscriber,
  HashSetObject,
  HashSetObjectSubscriber,
  ListObject,
  ListObjectSubscriber,
  ObjectType,
  ReorderedListObject,
  ReorderedSortedSetObject,
  SortedSetObject,
  SortedSetObjectSubscriber,
  StringObject,
  StringObjectSubscriber,
}
