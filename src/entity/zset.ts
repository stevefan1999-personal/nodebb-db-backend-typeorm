import {
  Column,
  DataSource,
  Entity,
  EventSubscriber,
  Index,
  PrimaryColumn,
  SelectQueryBuilder,
  ViewEntity,
} from 'typeorm'

import {
  databasePersonality,
  resolveDatabaseTypeByDriver,
} from '~/database_personality'

import { ObjectType } from './object'
import { TypedObject, TypedObjectSubscriber } from './typed_object'

@Entity({ name: ObjectType.SORTED_SET })
@Index(['id', 'score'])
@Index(['id', 'member'])
export class SortedSetObject extends TypedObject(ObjectType.SORTED_SET) {
  @PrimaryColumn()
  @Index()
  member: string

  @Column({ type: 'real' })
  @Index()
  score: number
}

@EventSubscriber()
export class SortedSetObjectSubscriber extends TypedObjectSubscriber(
  SortedSetObject,
) {}

abstract class ReorderedSortedSetObjectBase {
  @PrimaryColumn()
  readonly id: string

  @Column()
  readonly member: string

  @PrimaryColumn({ type: 'int' })
  @Index()
  readonly score: number

  @Column({ type: 'int' })
  @Index()
  readonly rank: number
}

function makeOrder(
  conn: DataSource,
  sort: '<' | '>',
): SelectQueryBuilder<SortedSetObject> {
  const addStandardRows = (
    qb: SelectQueryBuilder<SortedSetObject>,
  ): SelectQueryBuilder<SortedSetObject> =>
    qb
      .addSelect('z.id', 'id')
      .addSelect('z.member', 'member')
      .addSelect('z.score', 'score')

  let withRank: SelectQueryBuilder<SortedSetObject>

  if (false) {
    const order = sort === '>' ? 'ASC' : 'DESC'
    withRank = conn
      .createQueryBuilder(SortedSetObject, 'z')
      .addSelect(
        `RANK() OVER (PARTITION BY z.id ORDER BY z.score ${order}, z.member ${order}) - 1`,
        'rank',
      )
      .addSelect(
        `RANK() OVER (PARTITION BY z.id ORDER BY z.score ${order}, z.member ${order}) - 1`,
        'rank_back',
      )
  } else {
    const sorts = [
      `z.score ${sort} z1.score`,
      `z.score = z1.score and (z.member ${sort} z1.member)`,
    ]

    const conditions = sorts.map((q) => `(${q})`).join(' OR ')
    withRank = conn
      .createQueryBuilder(SortedSetObject, 'z')
      .leftJoinAndSelect(
        SortedSetObject,
        'z1',
        `z.id = z1.id AND (${conditions})`,
      )
      .select(`COUNT(z1.id)`, 'rank')
      .groupBy('z.id')
      .addGroupBy('z.member')
  }

  return addStandardRows(withRank)
}

@ViewEntity('zset_reordered', {
  expression: (conn) => makeOrder(conn, '>'),
})
export class ReorderedSortedSetObject extends ReorderedSortedSetObjectBase {}

@ViewEntity('zset_reordered_rev', {
  expression: (conn) => makeOrder(conn, '<'),
})
export class ReorderedSortedSetObjectReversed extends ReorderedSortedSetObjectBase {}

@ViewEntity('zset_lex_ordered', {
  expression(conn) {
    const binaryCollation =
      databasePersonality[resolveDatabaseTypeByDriver(conn.driver)].quirks
        ?.collation?.binary
    const collate = binaryCollation ? `COLLATE ${binaryCollation}` : ``
    return conn
      .createQueryBuilder(SortedSetObject, 'z')
      .leftJoinAndSelect(
        SortedSetObject,
        'z1',
        `z.id = z1.id and (z.member > z1.member ${collate})`,
      )
      .select('z.id', 'id')
      .addSelect('z.member', 'member')
      .addSelect(`COUNT(z1.id)`, 'rank')
      .groupBy('z.id')
      .addGroupBy('z.member')
  },
})
export class LexReorderedSortedSetObject {
  @PrimaryColumn()
  readonly id: string

  @Column()
  readonly member: string

  @Column({ type: 'int' })
  @Index()
  readonly rank: number
}
