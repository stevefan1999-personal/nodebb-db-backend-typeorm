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

@ViewEntity('zset_reordered', {
  expression(conn) {
    if (false) {
      return conn
        .createQueryBuilder(SortedSetObject, 'z')
        .select('z.id', 'id')
        .addSelect('z.member', 'member')
        .addSelect('z.score', 'score')
        .addSelect(
          `RANK() OVER (PARTITION BY z.id ORDER BY z.score ASC, z.member ASC) - 1`,
          'rank',
        )
        .addSelect(
          `-(RANK() OVER (PARTITION BY z.id ORDER BY z.score DESC, z.member DESC))`,
          'rank_back',
        )
    } else {
      const helper = (qb, condition) =>
        qb
          .from(SortedSetObject, 'z')
          .leftJoinAndSelect(
            SortedSetObject,
            'z1',
            `z.id = z1.id AND (${condition})`,
          )
          .select('z.id', 'id')
          .addSelect('z.member', 'member')
          .addSelect('z.score', 'score')
          .groupBy('z.id')
          .addGroupBy('z.member')
          .addGroupBy('z.score')

      return conn
        .createQueryBuilder()
        .addFrom((qb) => {
          const condition = `z.score > z1.score or (z.score = z1.score and z.member >= z1.member)`
          return helper(qb, condition).addSelect(`COUNT(z1.id) - 1`, 'rank')
        }, 'front')
        .addFrom((qb) => {
          const condition = `z.score < z1.score or (z.score = z1.score and z.member <= z1.member)`
          return helper(qb, condition).addSelect(`-COUNT(z1.id)`, 'rank')
        }, 'back')
        .where(`front.id = back.id and front.member = back.member`)
        .addSelect('front.id', 'id')
        .addSelect('front.member', 'member')
        .addSelect('front.score', 'score')
        .addSelect('front.rank', 'rank')
        .addSelect('back.rank', 'rank_back')
    }
  },
})
export class ReorderedSortedSetObject {
  @PrimaryColumn()
  readonly id: string

  @Column()
  readonly member: string

  @PrimaryColumn({ type: 'int' })
  readonly score: number

  @Column({ type: 'int' })
  readonly rank: number

  @Column({ type: 'int' })
  @Index()
  readonly rank_back: number
}

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
