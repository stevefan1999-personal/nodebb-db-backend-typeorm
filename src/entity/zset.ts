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
@Index('idx__legacy_zset__key__score', ['_key', 'score'])
export class SortedSetObject extends TypedObject(
  ObjectType.SORTED_SET,
  'fk__legacy_zset__key',
) {
  @Column({ nullable: false, primary: true })
  value: string

  @Column({ nullable: false })
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
    await event.manager.getRepository(DbObject).save({
      key: event.entity.key,
      type: event.entity.type,
    })
  }
}
