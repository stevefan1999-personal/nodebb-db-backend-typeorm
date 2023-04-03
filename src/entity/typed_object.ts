import {
  BaseEntity,
  Check,
  Column,
  EntitySubscriberInterface,
  InsertEvent,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Relation,
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
    parent: Relation<DbObject>
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
      const {
        entity: { id, type },
        manager,
      } = event
      await manager
        .getRepository(DbObject)
        .createQueryBuilder()
        .insert()
        .orIgnore()
        .values({ id, type })
        .execute()
    }
  }

  return TypedObjectSubscriberInner
}
