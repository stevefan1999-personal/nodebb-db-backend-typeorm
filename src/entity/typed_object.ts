import {
  BaseEntity,
  Check,
  Column,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
} from 'typeorm'

import { DbObject, ObjectType } from './object'

export const TypedObject = (
  type: ObjectType,
  foreignKeyConstraintName: string,
) => {
  class TypedObjectInner extends BaseEntity {
    static TYPE = type

    @PrimaryColumn({ nullable: false })
    _key: string

    @Column({
      default: type,
      enum: ObjectType,
      nullable: false,
      type: 'simple-enum',
    })
    @Check(`"type" = '${type}'`)
    type: ObjectType

    @OneToOne(() => DbObject, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
    @JoinColumn([
      {
        foreignKeyConstraintName,
        name: '_key',
        referencedColumnName: '_key',
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
