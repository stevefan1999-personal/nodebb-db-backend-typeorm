import { Column, Entity, EventSubscriber, Index, PrimaryColumn } from 'typeorm'

import { ObjectType } from './object'
import { TypedObject, TypedObjectSubscriber } from './typed_object'

@Entity({ name: ObjectType.SORTED_SET })
@Index(['id', 'score'])
@Index(['id', 'member'])
export class SortedSetObject extends TypedObject(ObjectType.SORTED_SET) {
  @PrimaryColumn()
  @Index()
  member: string

  @Column()
  @Index()
  score: number
}

@EventSubscriber()
export class SortedSetObjectSubscriber extends TypedObjectSubscriber(
  SortedSetObject,
) {}
