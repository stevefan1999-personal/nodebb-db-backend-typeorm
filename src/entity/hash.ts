import {
  Column,
  Entity,
  EntitySubscriberInterface,
  EventSubscriber,
  Index,
  InsertEvent,
  PrimaryColumn,
} from 'typeorm'

import { DbObject, ObjectType } from './object'
import { TypedObject } from './typed_object'

@Entity({ name: ObjectType.HASH })
@Index(['id', 'key'])
export class HashObject extends TypedObject(ObjectType.HASH) {
  @PrimaryColumn()
  @Index()
  key: string

  @Column({ type: 'simple-json' })
  value: any
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
      .orUpdate(['type'], ['id', 'type'])
      .values({
        id: event.entity.id,
        type: event.entity.type,
      })
      .execute()
  }
}
