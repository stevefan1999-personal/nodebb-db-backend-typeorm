import {
  Column,
  Entity,
  Index,
  IsNull,
  PrimaryColumn,
  ViewEntity,
} from 'typeorm'

export enum ObjectType {
  HASH = 'hash',
  LIST = 'list',
  SET = 'set',
  STRING = 'string',
  SORTED_SET = 'zset',
}

@Entity({ name: 'object' })
export class DbObject {
  @PrimaryColumn()
  id: string

  @PrimaryColumn({
    enum: ObjectType,
    enumName: 'object_type',
    type: 'simple-enum',
  })
  type: ObjectType

  @Column({ nullable: true })
  @Index()
  expireAt?: Date
}

@ViewEntity('object_live', {
  expression(conn) {
    return conn
      .getRepository(DbObject)
      .createQueryBuilder('o')
      .select(['id', 'type'])
      .where({ expireAt: IsNull() })
      .orWhere('o.expireAt > CURRENT_TIMESTAMP')
  },
})
export class DbObjectLive {
  @PrimaryColumn()
  id: string

  @PrimaryColumn({
    enum: ObjectType,
    enumName: 'object_type',
    type: 'simple-enum',
  })
  type: ObjectType
}
