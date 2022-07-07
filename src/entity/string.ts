import {
  Column,
  Entity,
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
} from 'typeorm'

import { DbObject, ObjectType } from './object'
import { TypedObject } from './typed_object'

@Entity({ name: ObjectType.STRING })
export class StringObject extends TypedObject(
  ObjectType.STRING,
  'fk__legacy_string__key',
) {
  @Column()
  value: string
}

@EventSubscriber()
export class StringObjectSubscriber
  implements EntitySubscriberInterface<StringObject>
{
  listenTo(): any {
    return StringObject
  }

  async beforeInsert(event: InsertEvent<StringObject>): Promise<void> {
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
