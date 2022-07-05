import { Column, Entity } from 'typeorm'

import { ObjectType } from './object'
import { TypedObject } from './typed_object'

@Entity({ name: ObjectType.SET })
export class HashSetObject extends TypedObject(
  ObjectType.SET,
  'fk__legacy_set__key',
) {
  @Column({ nullable: false, primary: true, type: 'simple-json' })
  member: Set<string>
}
