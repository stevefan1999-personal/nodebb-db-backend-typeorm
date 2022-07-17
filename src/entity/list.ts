import { Column, Entity, EventSubscriber } from 'typeorm'

import { ObjectType } from './object'
import { TypedObject, TypedObjectSubscriber } from './typed_object'

@Entity({ name: ObjectType.LIST })
export class ListObject extends TypedObject(ObjectType.LIST) {
  @Column({ type: 'simple-json' })
  array: any[] = []
}

@EventSubscriber()
export class ListObjectSubscriber extends TypedObjectSubscriber(ListObject) {}
