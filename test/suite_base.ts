import 'jest-extended'

import type { TypeORMDatabaseBackend } from '~/index'

export abstract class TestSuiteBase {
  protected db: TypeORMDatabaseBackend

  async before(): Promise<void> {
    if (false) {
      const { TypeORMDatabaseBackend } = await import('../output/index.cjs')
      this.db = new TypeORMDatabaseBackend()
    } else {
      const { TypeORMDatabaseBackend } = await import('~/index')
      this.db = new TypeORMDatabaseBackend()
    }
    // await this.db.init({
    //   database: ':memory:',
    //   dropSchema: true,
    //   synchronize: true,
    //   type: 'sqlite',
    // })

    // await this.db.init({
    //   database: 'test',
    //   dropSchema: true,
    //   host: 'localhost',
    //   password: 'test',
    //   port: 13306,
    //   synchronize: true,
    //   type: 'mysql',
    //   username: 'root',
    // })

    await this.db.init({
      database: 'postgres',
      dropSchema: true,
      host: 'localhost',
      logging: true,
      password: 'test',
      port: 15432,
      synchronize: true,
      type: 'postgres',
      username: 'postgres',
    })

    await this.db.flushdb()
  }

  async after(): Promise<void> {
    await this.db.close()
    delete this.db
  }
}
