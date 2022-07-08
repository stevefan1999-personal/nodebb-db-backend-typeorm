import {
  BaseEntity,
  Check,
  Column,
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
