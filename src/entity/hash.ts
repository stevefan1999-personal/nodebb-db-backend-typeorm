import { Column, Entity, EventSubscriber, Index, PrimaryColumn } from 'typeorm'

import { ObjectType } from './object'
import { TypedObject, TypedObjectSubscriber } from './typed_object'

@Entity({ name: ObjectType.HASH })
@Index(['id', 'key'])
export class HashObject extends TypedObject(ObjectType.HASH) {
  @PrimaryColumn({ name: '_key' })
  @Index()
  key: string

  @Column({ type: 'simple-json' })
  value: any
}

@EventSubscriber()
export class HashObjectSubscriber extends TypedObjectSubscriber(HashObject) {}
