import { Column, Entity, Index, PrimaryColumn, Unique } from 'typeorm'

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
@Unique(['_key', 'type'])
export class DbObject {
  @PrimaryColumn({ nullable: false })
  _key: string

  @Column({
    enum: ObjectType,
    nullable: false,
    type: 'simple-enum',
  })
  type: ObjectType

  @Column()
  @Index('idx__legacy_object__expireAt')
  expireAt?: Date

  async tryIntoHash(): Promise<HashObject> {
    if (this.type !== ObjectType.HASH) {
      throw new TypeError('not a hash object')
    }
    return entities.HashObject.findOneByOrFail({
      _key: this._key,
      type: this.type,
    })
  }

  async tryIntoList(): Promise<ListObject> {
    if (this.type !== ObjectType.LIST) {
      throw new TypeError('not a list object')
    }
    return entities.ListObject.findOneByOrFail({
      _key: this._key,
      type: this.type,
    })
  }

  async tryIntoHashSet(): Promise<HashSetObject> {
    if (this.type !== ObjectType.SET) {
      throw new TypeError('not a set object')
    }
    return entities.HashSetObject.findOneByOrFail({
      _key: this._key,
      type: this.type,
    })
  }

  async tryIntoString(): Promise<StringObject> {
    if (this.type !== ObjectType.STRING) {
      throw new TypeError('not a string object')
    }
    return entities.StringObject.findOneByOrFail({
      _key: this._key,
      type: this.type,
    })
  }

  async tryIntoSortedSet(): Promise<SortedSetObject> {
    if (this.type !== ObjectType.SORTED_SET) {
      throw new TypeError('not a zset object')
    }
    return entities.SortedSetObject.findOneByOrFail({
      _key: this._key,
      type: this.type,
    })
  }
}
