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

@Entity({ name: ObjectType.SORTED_SET })
@Index(['id', 'score'])
@Index(['id', 'member'])
export class SortedSetObject extends TypedObject(ObjectType.SORTED_SET) {
  @PrimaryColumn()
  @Index()
  member: string

  @Column()
  @Index()
  score: number
}

@EventSubscriber()
export class SortedSetObjectSubscriber
  implements EntitySubscriberInterface<SortedSetObject>
{
  listenTo(): any {
    return SortedSetObject
  }

  async beforeInsert(event: InsertEvent<SortedSetObject>): Promise<void> {
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
