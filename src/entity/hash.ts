import { Column, Entity } from 'typeorm'

import { ObjectType } from './object'
import { TypedObject } from './typed_object'

@Entity({ name: ObjectType.HASH })
export class HashObject extends TypedObject(
  ObjectType.HASH,
  'fk__legacy_hash__key',
) {
  @Column({ nullable: false, type: 'simple-json' })
  data: { [key: string]: any }
}
