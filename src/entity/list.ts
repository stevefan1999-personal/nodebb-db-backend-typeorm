import { Column, Entity } from 'typeorm'

import { ObjectType } from './object'
import { TypedObject } from './typed_object'

@Entity({ name: ObjectType.LIST })
export class ListObject extends TypedObject(
  ObjectType.LIST,
  'fk__legacy_list__key',
) {
  @Column({ nullable: false, type: 'simple-json' })
  array: any[]
}
