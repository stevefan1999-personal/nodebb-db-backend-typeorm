import {
  Column,
  Entity,
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  PrimaryColumn,
} from 'typeorm'

import { DbObject, ObjectType } from './object'
import { TypedObject } from './typed_object'

@Entity({ name: ObjectType.HASH })
export class HashObject extends TypedObject(
  ObjectType.HASH,
  'fk__legacy_hash__key',
) {
  @PrimaryColumn()
  hashKey: string

  @Column({ type: 'simple-json' })
  value: object
}

@EventSubscriber()
export class HashObjectSubscriber
  implements EntitySubscriberInterface<HashObject>
{
  listenTo(): any {
    return HashObject
  }

  async beforeInsert(event: InsertEvent<HashObject>): Promise<void> {
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
