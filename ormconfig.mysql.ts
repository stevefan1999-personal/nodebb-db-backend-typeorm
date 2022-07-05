import { DataSource } from 'typeorm'
import { entities } from './src/entity'

export default new DataSource({
  entities,
  migrations: ['./src/migration/mysql/*.ts'],
  type: 'mysql',
})
