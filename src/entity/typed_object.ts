import {
  BaseEntity,
  Check,
  Column,
  EntitySubscriberInterface,
  InsertEvent,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm'

import { DbObject, ObjectType } from './object'

export const TypedObject = (type: ObjectType) => {
  class TypedObjectInner extends BaseEntity {
    static TYPE = type

    @PrimaryColumn()
    id: string

    @Column({
      default: type,
      enum: ObjectType,
      enumName: 'object_type',
      type: 'simple-enum',
    })
    @Check(`"type" = '${type}'`)
    type: ObjectType = type

    @ManyToOne(() => DbObject, {
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
      orphanedRowAction: 'delete',
    })
    @JoinColumn([
      {
        name: 'id',
        referencedColumnName: 'id',
      },
      {
        name: 'type',
        referencedColumnName: 'type',
      },
    ])
    parent: DbObject
  }

  return TypedObjectInner
}

export const TypedObjectSubscriber = <
  T extends { id: string; type: ObjectType },
>(
  klass: new () => T,
) => {
  class TypedObjectSubscriberInner implements EntitySubscriberInterface<T> {
    listenTo(): any {
      return klass
    }

    async beforeInsert(event: InsertEvent<T>): Promise<void> {
      const repo = event.manager.getRepository(DbObject)

      await repo
        .createQueryBuilder()
        .insert()
        .orIgnore()
        .values({
          id: event.entity.id,
          type: event.entity.type,
        })
        .execute()
    }
  }

  return TypedObjectSubscriberInner
}
