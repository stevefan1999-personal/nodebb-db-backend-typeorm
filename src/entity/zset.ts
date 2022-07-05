import { Column, Entity, Index } from 'typeorm'

import { ObjectType } from './object'
import { TypedObject } from './typed_object'

@Entity({ name: ObjectType.SORTED_SET })
@Index('idx__legacy_zset__key__score', ['_key', 'score'])
export class SortedSetObject extends TypedObject(
  ObjectType.SORTED_SET,
  'fk__legacy_zset__key',
) {
  @Column({ nullable: false, primary: true })
  value: string

  @Column({ nullable: false })
  score: number
}
