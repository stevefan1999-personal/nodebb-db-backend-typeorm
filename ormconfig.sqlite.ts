import { DataSource } from 'typeorm'
import { entities } from './src/entity'

export default new DataSource({
  database: './store.db',
  entities,
  migrations: ['./src/migration/sqlite/*.ts'],
  type: 'sqlite',
})
