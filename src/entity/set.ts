import {
  Entity,
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  PrimaryColumn,
} from 'typeorm'

import { DbObject, ObjectType } from './object'
import { TypedObject } from './typed_object'

@Entity({ name: ObjectType.SET })
export class HashSetObject extends TypedObject(
  ObjectType.SET,
  'fk__legacy_set__key',
) {
  @PrimaryColumn()
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
    await event.manager.getRepository(DbObject).save({
      key: event.entity.key,
      type: event.entity.type,
    })
  }
}
