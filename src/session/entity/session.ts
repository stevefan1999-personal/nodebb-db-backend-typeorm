import { Column, Entity, Index, PrimaryColumn } from 'typeorm'

@Entity()
export class Session {
  @PrimaryColumn()
  public id: string

  @Index()
  @Column()
  public expiredAt: Date

  @Column('simple-json', { default: '{}', nullable: false })
  public json: { [key: string]: any }
}
