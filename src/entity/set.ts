import {
  Entity,
  EntitySubscriberInterface,
  EventSubscriber,
  Index,
  InsertEvent,
  PrimaryColumn,
} from 'typeorm'

import { DbObject, ObjectType } from './object'
import { TypedObject } from './typed_object'

@Entity({ name: ObjectType.SET })
@Index(['key', 'member'])
export class HashSetObject extends TypedObject(ObjectType.SET) {
  @PrimaryColumn()
  @Index()
  member: string
}

@EventSubscriber()
export class HashSetObjectSubscriber
  implements EntitySubscriberInterface<HashSetObject>
{
  listenTo(): any {
    return HashSetObject
  }

  async beforeInsert(event: InsertEvent<HashSetObject>): Promise<void> {
    await event.manager
      .getRepository(DbObject)
      .createQueryBuilder()
      .insert()
      .orUpdate(['type'], ['_key', 'type'])
      .values({
        key: event.entity.key,
        type: event.entity.type,
      })
      .execute()
  }
}
