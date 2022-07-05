import { Column, Entity } from 'typeorm'

import { ObjectType } from './object'
import { TypedObject } from './typed_object'

@Entity({ name: ObjectType.STRING })
export class StringObject extends TypedObject(
  ObjectType.STRING,
  'fk__legacy_string__key',
) {
  @Column({ nullable: false })
  value: string
}
