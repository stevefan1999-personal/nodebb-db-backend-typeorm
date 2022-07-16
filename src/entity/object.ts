import {
  Column,
  Entity,
  Index,
  IsNull,
  PrimaryColumn,
  ViewEntity,
} from 'typeorm'

import { entities } from './index'

import type {
  HashObject,
  HashSetObject,
  ListObject,
  SortedSetObject,
  StringObject,
} from './index'

export enum ObjectType {
  HASH = 'hash',
  LIST = 'list',
  SET = 'set',
  STRING = 'string',
  SORTED_SET = 'zset',
}

@Entity({ name: 'object' })
export class DbObject {
  @PrimaryColumn()
  id: string

  @PrimaryColumn({
    enum: ObjectType,
    enumName: 'object_type',
    type: 'simple-enum',
  })
  type: ObjectType

  @Column({ nullable: true })
  @Index()
  expireAt?: Date

  async tryIntoHash(): Promise<HashObject> {
    if (this.type !== ObjectType.HASH) {
      throw new TypeError('not a hash object')
    }
    return entities.HashObject.findOneByOrFail({
      id: this.id,
      type: this.type,
    })
  }

  async tryIntoList(): Promise<ListObject> {
    if (this.type !== ObjectType.LIST) {
      throw new TypeError('not a list object')
    }
    return entities.ListObject.findOneByOrFail({
      id: this.id,
      type: this.type,
    })
  }

  async tryIntoHashSet(): Promise<HashSetObject> {
    if (this.type !== ObjectType.SET) {
      throw new TypeError('not a set object')
    }
    return entities.HashSetObject.findOneByOrFail({
      id: this.id,
      type: this.type,
    })
  }

  async tryIntoString(): Promise<StringObject> {
    if (this.type !== ObjectType.STRING) {
      throw new TypeError('not a string object')
    }
    return entities.StringObject.findOneByOrFail({
      id: this.id,
      type: this.type,
    })
  }

  async tryIntoSortedSet(): Promise<SortedSetObject> {
    if (this.type !== ObjectType.SORTED_SET) {
      throw new TypeError('not a zset object')
    }
    return entities.SortedSetObject.findOneByOrFail({
      id: this.id,
      type: this.type,
    })
  }
}

@ViewEntity('object_live', {
  expression(conn) {
    return conn
      .getRepository(DbObject)
      .createQueryBuilder('o')
      .select(['id', 'type'])
      .where({ expireAt: IsNull() })
      .orWhere('o.expireAt > CURRENT_TIMESTAMP')
  },
})
export class DbObjectLive {
  @PrimaryColumn()
  id: string

  @PrimaryColumn({
    enum: ObjectType,
    enumName: 'object_type',
    type: 'simple-enum',
  })
  type: ObjectType
}
