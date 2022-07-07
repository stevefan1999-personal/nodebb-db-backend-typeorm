import {
  BaseEntity,
  Check,
  Column,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm'

import { DbObject, ObjectType } from './object'

export const TypedObject = (
  type: ObjectType,
  foreignKeyConstraintName: string,
) => {
  class TypedObjectInner extends BaseEntity {
    static TYPE = type

    @PrimaryColumn({ name: '_key' })
    key: string

    @Column({
      default: type,
      enum: ObjectType,
      type: 'simple-enum',
    })
    @Check(`"type" = '${type}'`)
    type: ObjectType = type

    @OneToOne(() => DbObject, {
      nullable: false,
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
      orphanedRowAction: 'delete',
    })
    @JoinColumn([
      {
        foreignKeyConstraintName,
        name: '_key',
        referencedColumnName: 'key',
      },
      {
        foreignKeyConstraintName,
        name: 'type',
        referencedColumnName: 'type',
      },
    ])
    parent: DbObject
  }

  return TypedObjectInner
}
