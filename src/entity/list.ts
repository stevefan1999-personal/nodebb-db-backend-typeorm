import {
  Column,
  Entity,
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
} from 'typeorm'

import { DbObject, ObjectType } from './object'
import { TypedObject } from './typed_object'

@Entity({ name: ObjectType.LIST })
export class ListObject extends TypedObject(
  ObjectType.LIST,
  'fk__legacy_list__key',
) {
  @Column({ nullable: false, type: 'simple-json' })
  array: any[]
}

@EventSubscriber()
export class ListObjectSubscriber
  implements EntitySubscriberInterface<ListObject>
{
  listenTo(): any {
    return ListObject
  }

  async beforeInsert(event: InsertEvent<ListObject>): Promise<void> {
    await event.manager.getRepository(DbObject).save({
      key: event.entity.key,
      type: event.entity.type,
    })
  }
}
