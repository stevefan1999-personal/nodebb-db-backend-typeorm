import {
  BaseEntity,
  BeforeInsert,
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
        referencedColumnName: '_key',
      },
      {
        foreignKeyConstraintName,
        name: 'type',
        referencedColumnName: 'type',
      },
    ])
    parent: DbObject

    @BeforeInsert()
    private async addToMasterTable(): Promise<void> {
      await TypedObjectInner.getRepository()
        .manager.getRepository(DbObject)
        .save({
          _key: this._key,
          type: this.type,
        })
    }
  }

  return TypedObjectInner
}
