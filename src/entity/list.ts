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
export class ListObject extends TypedObject(ObjectType.LIST) {
  @Column({ type: 'simple-json' })
  array: any[] = []
}

@EventSubscriber()
export class ListObjectSubscriber
  implements EntitySubscriberInterface<ListObject>
{
  listenTo(): any {
    return ListObject
  }

  async beforeInsert(event: InsertEvent<ListObject>): Promise<void> {
    await event.manager
      .getRepository(DbObject)
      .createQueryBuilder()
      .insert()
      .orUpdate(['type'], ['id', 'type'])
      .values({
        id: event.entity.id,
        type: event.entity.type,
      })
      .execute()
  }
}
