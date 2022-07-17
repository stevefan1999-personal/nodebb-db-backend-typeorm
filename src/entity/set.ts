import { Entity, EventSubscriber, Index, PrimaryColumn } from 'typeorm'

import { ObjectType } from './object'
import { TypedObject, TypedObjectSubscriber } from './typed_object'

@Entity({ name: ObjectType.SET })
@Index(['id', 'member'])
export class HashSetObject extends TypedObject(ObjectType.SET) {
  @PrimaryColumn()
  @Index()
  member: string
}

@EventSubscriber()
export class HashSetObjectSubscriber extends TypedObjectSubscriber(
  HashSetObject,
) {}
