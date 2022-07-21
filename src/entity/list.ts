import {
  Column,
  Entity,
  EventSubscriber,
  Index,
  PrimaryColumn,
  ViewEntity,
} from 'typeorm'

import { ObjectType } from './object'
import { TypedObject, TypedObjectSubscriber } from './typed_object'

@Entity({ name: ObjectType.LIST })
export class ListObject extends TypedObject(ObjectType.LIST) {
  @Column()
  value: string

  @PrimaryColumn({ default: 0, type: 'int' })
  @Index()
  slot = 0
}

@ViewEntity('list_reordered', {
  expression(conn) {
    const listObjectSelectQueryBuilder = (qb, condition) =>
      qb
        .from(ListObject, 'l')
        .leftJoinAndSelect(ListObject, 'l1', `l.id = l1.id AND (${condition})`)
        .select('l.id', 'id')
        .addSelect('l.slot', 'slot')
        .addSelect('l.value', 'value')
        .groupBy('l.id')
        .addGroupBy('l.slot')

    if (true) {
      return conn
        .createQueryBuilder(ListObject, 'l')
        .select('l.id', 'id')
        .addSelect('l.value', 'value')
        .addSelect('l.slot', 'slot')
        .addSelect(
          `RANK() OVER (PARTITION BY l.id ORDER BY l.slot ASC) - 1`,
          'rank',
        )
        .addSelect(
          `-(RANK() OVER (PARTITION BY l.id ORDER BY l.slot DESC))`,
          'rankBack',
        )
    } else {
      return conn
        .createQueryBuilder()
        .addFrom((qb) => {
          return listObjectSelectQueryBuilder(
            qb,
            [`l.slot >= l1.slot`].map((q) => `(${q})`).join(' OR '),
          ).addSelect(`COUNT(l1.id) - 1`, 'rank')
        }, 'front')
        .addFrom((qb) => {
          return listObjectSelectQueryBuilder(
            qb,
            [`l.slot <= l1.slot`].map((q) => `(${q})`).join(' OR '),
          ).addSelect(`-COUNT(l1.id)`, 'rank')
        }, 'back')
        .where(`front.id = back.id and front.slot = back.slot`)
        .addSelect('front.id', 'id')
        .addSelect('front.value', 'value')
        .addSelect('front.slot', 'slot')
        .addSelect('back.rank', 'rank')
        .addSelect('back.rank', 'rankBack')
    }
  },
})
@Index(['id', 'slot'])
@Index(['id', 'rank'])
export class ReorderedListObject {
  @PrimaryColumn()
  readonly id: string

  @Column()
  readonly value: string

  @PrimaryColumn({ type: 'int' })
  @Index()
  readonly slot: number

  @Column({ type: 'int' })
  @Index()
  readonly rank: number

  @Column({ type: 'int' })
  @Index()
  readonly rankBack: number
}

@EventSubscriber()
export class ListObjectSubscriber extends TypedObjectSubscriber(ListObject) {}
