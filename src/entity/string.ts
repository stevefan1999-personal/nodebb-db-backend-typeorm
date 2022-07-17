import { Column, Entity, EventSubscriber } from 'typeorm'

import { ObjectType } from './object'
import { TypedObject, TypedObjectSubscriber } from './typed_object'

@Entity({ name: ObjectType.STRING })
export class StringObject extends TypedObject(ObjectType.STRING) {
  @Column('simple-json')
  value: string | number
}

@EventSubscriber()
export class StringObjectSubscriber extends TypedObjectSubscriber(
  StringObject,
) {}
